import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { baseContent } from "@gymos/page-templates/src/conformance/fixtures";
import { FONT_ALLOWLIST } from "@gymos/page-templates/src/contract";

vi.mock("@/lib/gym-site/db", () => ({ reader: { readPage: vi.fn(), readRedirect: vi.fn(), submitReport: vi.fn() } }));

import nextConfig from "@/next.config";
import { GET, POST, PUT, DELETE, PATCH, OPTIONS } from "@/app/gym-site/route";
import { config, proxy } from "@/proxy";
import { reader } from "@/lib/gym-site/db";
import { GYM_SITE_PATH, TENANT_NAME_HEADER, TENANT_PATH_HEADER } from "./names";
import { notFoundResponse } from "./notFound";

const here = dirname(fileURLToPath(import.meta.url));
const landing = join(here, "..", "..");
const readPage = vi.mocked(reader.readPage);
const readRedirect = vi.mocked(reader.readRedirect);
const submitReport = vi.mocked(reader.submitReport);

async function snap(r: Response) {
  return { status: r.status, headers: [...r.headers.entries()].sort(), body: await r.text() };
}

beforeEach(() => {
  vi.stubEnv("PUBLIC_SITE_ROOT_DOMAIN", "gymosapps.com");
  vi.stubEnv("PUBLIC_SITE_MEDIA_ORIGIN", "https://media.example.com");
  vi.stubEnv("PUBLIC_SITE_REPORT_KEY", "wiring-report-key-0123456789");
  readPage.mockReset().mockImplementation(async (n) => (n === "fit" ? { template: "classic", schema_version: 1, content: baseContent() } : null));
  readRedirect.mockReset().mockResolvedValue(null);
  submitReport.mockReset().mockResolvedValue("ok");
});
afterEach(() => vi.unstubAllEnvs());

/** The proxy, then (when it rewrites) the route handler with exactly the request headers the proxy produced. */
async function viaProxy(host: string, path: string, headers: Record<string, string> = {}, init: { method?: "GET" | "POST"; body?: string } = {}): Promise<Response> {
  const res = proxy(new NextRequest(`https://${host}${path}`, { method: init.method ?? "GET", body: init.body, headers: { host, ...headers } }));
  if (!res.headers.get("x-middleware-rewrite")) return res;
  expect(new URL(res.headers.get("x-middleware-rewrite")!).pathname).toBe(GYM_SITE_PATH);
  const forwarded: Record<string, string> = {};
  for (const h of [TENANT_NAME_HEADER, TENANT_PATH_HEADER]) {
    const v = res.headers.get(`x-middleware-request-${h}`);
    if (v !== null) forwarded[h] = v;
  }
  const forward = { headers: { host, ...headers, ...forwarded } };
  if (init.method === "POST") return POST(new Request(`https://${host}${GYM_SITE_PATH}`, { method: "POST", body: init.body, ...forward }));
  return GET(new Request(`https://${host}${GYM_SITE_PATH}`, forward));
}

describe("the proxy matcher selects every path", () => {
  for (const path of ["/", "/fr", "/gym-site", "/robots.txt", "/sitemap.xml", "/report", "/_next/image", "/_next/static/chunks/a.js", "/anything/at/all"]) {
    it(`${path} is matched, on a gym host and on a marketing host`, () => {
      for (const host of ["fit.gymosapps.com", "www.gymosapps.com"]) {
        expect(unstable_doesMiddlewareMatch({ config, url: `https://${host}${path}` }), `${host}${path}`).toBe(true);
      }
    });
  }

  it("a gym host answers the uniform not-found for /_next/image and /_next/static, and for /gym-site; a marketing host passes them through", async () => {
    const expected = await snap(notFoundResponse("gymosapps.com"));
    for (const path of ["/_next/image", "/_next/static/chunks/a.js", "/gym-site", "/robots.txt.bak", "/Report"]) {
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

describe("Story 24.11: the sitemap, robots and report routes, through the proxy", () => {
  const FORM = { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": "203.0.113.9" };
  const body = (o: Record<string, string>) => new URLSearchParams(o).toString();

  it("/sitemap.xml and /robots.txt answer on a visible page, with a 5 minute cache", async () => {
    const s = await viaProxy("fit.gymosapps.com", "/sitemap.xml");
    expect(s.status).toBe(200);
    expect(s.headers.get("cache-control")).toBe("public, s-maxage=300");
    expect(await s.text()).toContain("<loc>https://fit.gymosapps.com/</loc>");
    const r = await viaProxy("fit.gymosapps.com", "/robots.txt");
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("Sitemap: https://fit.gymosapps.com/sitemap.xml");
  });
  it("a hidden page (the view has no row) answers the uniform not-found on every path of the host, GET and POST", async () => {
    const expected = await snap(notFoundResponse("gymosapps.com"));
    for (const path of ["/", "/fr", "/sitemap.xml", "/robots.txt", "/report"]) {
      expect(await snap(await viaProxy("hidden.gymosapps.com", path)), `GET ${path}`).toEqual(expected);
    }
    expect(await snap(await viaProxy("hidden.gymosapps.com", "/report", FORM, { method: "POST", body: body({ reason: "privacy", details: "x" }) }))).toEqual(expected);
    expect(submitReport).not.toHaveBeenCalled();
  });
  it("a reserved or malformed label (too short, double hyphen, a second label level, a trailing dot) composes proxy + handler into the same uniform not-found with no database read", async () => {
    const expected = await snap(notFoundResponse("gymosapps.com"));
    for (const host of ["mail.gymosapps.com", "ab.gymosapps.com", "a--b.gymosapps.com", "a.fit.gymosapps.com", "ab.gymosapps.com.", "a.fit.gymosapps.com."]) {
      for (const path of ["/", "/sitemap.xml", "/report"]) expect(await snap(await viaProxy(host, path)), `${host} ${path}`).toEqual(expected);
    }
    expect(await snap(await viaProxy("ab.gymosapps.com", "/report", FORM, { method: "POST", body: body({ reason: "privacy", details: "x" }) }))).toEqual(expected);
    expect(readPage).not.toHaveBeenCalled();
    expect(readRedirect).not.toHaveBeenCalled();
    expect(submitReport).not.toHaveBeenCalled();
  });
  it("the report form is served, and a POST is answered in the same response (no redirect), stored with a keyed hash and no cookie", async () => {
    const form = await viaProxy("fit.gymosapps.com", "/report");
    expect(form.status).toBe(200);
    expect(await form.text()).toContain('<form method="post" action="/report">');
    const res = await viaProxy("fit.gymosapps.com", "/report", FORM, { method: "POST", body: body({ reason: "privacy", details: "A real report" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toContain("Thank you. We&#39;ll review this page.");
    expect(submitReport).toHaveBeenCalledTimes(1);
    const sent = submitReport.mock.calls[0]![0];
    expect(sent).toMatchObject({ name: "fit", reason: "privacy", details: "A real report" });
    expect(sent.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(sent)).not.toContain("203.0.113.9");
  });
  it("the visitor's address reaches the source hash: different x-forwarded-for values give different hashes, x-real-ip wins, and no header is a third bucket", async () => {
    const hashFor = async (headers: Record<string, string>) => {
      submitReport.mockClear();
      const res = await viaProxy("fit.gymosapps.com", "/report", { "content-type": "application/x-www-form-urlencoded", ...headers }, { method: "POST", body: body({ reason: "privacy", details: "x" }) });
      expect(res.status).toBe(200);
      return submitReport.mock.calls[0]![0].sourceHash;
    };
    const a = await hashFor({ "x-forwarded-for": "203.0.113.9" });
    const b = await hashFor({ "x-forwarded-for": "198.51.100.7" });
    const none = await hashFor({});
    const realIp = await hashFor({ "x-real-ip": "198.51.100.7", "x-forwarded-for": "203.0.113.9" });
    expect(new Set([a, b, none]).size).toBe(3);
    expect(realIp).toBe(b);
    expect(await hashFor({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" })).toBe(a);
  });

  it("a POST to the page or any other path is the uniform not-found and reads nothing", async () => {
    const expected = await snap(notFoundResponse("gymosapps.com"));
    for (const path of ["/", "/fr", "/sitemap.xml", "/robots.txt", "/de"]) {
      const res = await viaProxy("fit.gymosapps.com", path, FORM, { method: "POST", body: body({ reason: "privacy", details: "x" }) });
      expect(await snap(res), path).toEqual(expected);
    }
    expect(readPage).not.toHaveBeenCalled();
    expect(submitReport).not.toHaveBeenCalled();
  });
  it("PUT, PATCH, DELETE and OPTIONS are the same uniform not-found", async () => {
    const expected = await snap(notFoundResponse("gymosapps.com"));
    for (const h of [PUT, PATCH, DELETE, OPTIONS]) expect(await snap(h())).toEqual(expected);
  });
  it("a missing report key turns every /report answer into the uniform not-found", async () => {
    vi.stubEnv("PUBLIC_SITE_REPORT_KEY", "");
    const expected = await snap(notFoundResponse("gymosapps.com"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await snap(await viaProxy("fit.gymosapps.com", "/report"))).toEqual(expected);
    expect(await snap(await viaProxy("fit.gymosapps.com", "/report", FORM, { method: "POST", body: body({ reason: "privacy", details: "x" }) }))).toEqual(expected);
    expect(submitReport).not.toHaveBeenCalled();
    expect(logged).toHaveBeenCalledWith(JSON.stringify({ event: "gym_site_config_missing", variable: "PUBLIC_SITE_REPORT_KEY" }));
    logged.mockRestore();
    // the page itself, the sitemap and robots are not affected
    expect((await viaProxy("fit.gymosapps.com", "/sitemap.xml")).status).toBe(200);
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
