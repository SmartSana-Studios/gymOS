import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { baseContent } from "@gymos/page-templates/src/conformance/fixtures";
import { FONT_ALLOWLIST } from "@gymos/page-templates/src/contract";

vi.mock("@/lib/gym-site/db", () => ({ reader: { readPage: vi.fn(), readRedirect: vi.fn() } }));

import nextConfig from "@/next.config";
import { GET } from "@/app/gym-site/route";
import { config, proxy } from "@/proxy";
import { reader } from "@/lib/gym-site/db";
import { GYM_SITE_PATH, TENANT_NAME_HEADER, TENANT_PATH_HEADER } from "./names";
import { notFoundResponse } from "./notFound";

const here = dirname(fileURLToPath(import.meta.url));
const landing = join(here, "..", "..");
const readPage = vi.mocked(reader.readPage);
const readRedirect = vi.mocked(reader.readRedirect);

async function snap(r: Response) {
  return { status: r.status, headers: [...r.headers.entries()].sort(), body: await r.text() };
}

beforeEach(() => {
  vi.stubEnv("PUBLIC_SITE_ROOT_DOMAIN", "gymosapps.com");
  vi.stubEnv("PUBLIC_SITE_MEDIA_ORIGIN", "https://media.example.com");
  readPage.mockReset().mockImplementation(async (n) => (n === "fit" ? { template: "classic", schema_version: 1, content: baseContent() } : null));
  readRedirect.mockReset().mockResolvedValue(null);
});
afterEach(() => vi.unstubAllEnvs());

/** The proxy, then (when it rewrites) the route handler with exactly the request headers the proxy produced. */
async function viaProxy(host: string, path: string, headers: Record<string, string> = {}): Promise<Response> {
  const res = proxy(new NextRequest(`https://${host}${path}`, { headers: { host, ...headers } }));
  if (!res.headers.get("x-middleware-rewrite")) return res;
  expect(new URL(res.headers.get("x-middleware-rewrite")!).pathname).toBe(GYM_SITE_PATH);
  const forwarded: Record<string, string> = {};
  for (const h of [TENANT_NAME_HEADER, TENANT_PATH_HEADER]) {
    const v = res.headers.get(`x-middleware-request-${h}`);
    if (v !== null) forwarded[h] = v;
  }
  return GET(new Request(`https://${host}${GYM_SITE_PATH}`, { headers: { host, ...forwarded } }));
}

describe("the proxy matcher selects every path", () => {
  for (const path of ["/", "/fr", "/gym-site", "/robots.txt", "/_next/image", "/_next/static/chunks/a.js", "/anything/at/all"]) {
    it(`${path} is matched, on a gym host and on a marketing host`, () => {
      for (const host of ["fit.gymosapps.com", "www.gymosapps.com"]) {
        expect(unstable_doesMiddlewareMatch({ config, url: `https://${host}${path}` }), `${host}${path}`).toBe(true);
      }
    });
  }

  it("a gym host answers the uniform not-found for /_next/image and /_next/static, and for /gym-site; a marketing host passes them through", async () => {
    const expected = await snap(notFoundResponse("gymosapps.com"));
    for (const path of ["/_next/image", "/_next/static/chunks/a.js", "/gym-site", "/robots.txt"]) {
      expect(await snap(await viaProxy("fit.gymosapps.com", path)), path).toEqual(expected);
      const marketing = proxy(new NextRequest(`https://www.gymosapps.com${path}`, { headers: { host: "www.gymosapps.com" } }));
      expect(marketing.headers.get("x-middleware-next"), `marketing ${path}`).toBe("1");
      expect(marketing.headers.get("x-middleware-rewrite")).toBeNull();
    }
  });
});

describe("the route handler, fed by the proxy", () => {
  it("renders a 200 page for the headers the proxy produces", async () => {
    const r = await viaProxy("fit.gymosapps.com", "/fr");
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('<html lang="fr">');
    expect(readPage).toHaveBeenCalledWith("fit");
  });
  it("a spoofed tenant header reaches nothing: the proxy's values win", async () => {
    const r = await viaProxy("fit.gymosapps.com", "/", { [TENANT_NAME_HEADER]: "other", [TENANT_PATH_HEADER]: "/de" });
    expect(r.status).toBe(200);
    expect(readPage).toHaveBeenCalledWith("fit");
  });
  it("a request with no tenant headers is the uniform not-found and reads nothing", async () => {
    const r = await GET(new Request("https://www.gymosapps.com/gym-site"));
    expect(await snap(r)).toEqual(await snap(notFoundResponse("gymosapps.com")));
    expect(readPage).not.toHaveBeenCalled();
  });
});

describe("the self-hosted fonts and their cache rule", () => {
  it("every allowlisted font exists under public/ and is a woff2 file", () => {
    for (const f of Object.values(FONT_ALLOWLIST)) {
      const bytes = readFileSync(join(landing, "public", f.path));
      expect(bytes.subarray(0, 4).toString("latin1"), f.path).toBe("wOF2");
    }
  });
  it("next.config caches /fonts/:file for a year, immutable", async () => {
    const rules = await nextConfig.headers!();
    const rule = rules.find((r) => r.source === "/fonts/:file");
    expect(rule?.headers).toContainEqual({ key: "Cache-Control", value: "public, max-age=31536000, immutable" });
  });
});
