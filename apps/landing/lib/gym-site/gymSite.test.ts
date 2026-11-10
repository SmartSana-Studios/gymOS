import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { baseContent } from "@gymos/page-templates/src/conformance/fixtures";
import { proxy } from "@/proxy";
import { handleGymSite, type GymSiteDeps } from "./handler";
import { createReader, isRetryable } from "./db";
import { readConfig, readReaderConfig } from "./env";
import { notFoundParts, notFoundResponse } from "./notFound";
import { decideGymRequest } from "./request";

const ROOT = "gymosapps.com";
const MEDIA = "https://media.example.com";
const config = { rootDomain: ROOT, mediaOrigin: MEDIA, reportKey: "test-report-key-0123456789" };
const row = (over: Record<string, unknown> = {}) => ({ template: "classic", schema_version: 1, content: baseContent(), ...over });

function deps(over: Partial<GymSiteDeps> = {}): GymSiteDeps & { logs: [string, unknown][] } {
  const logs: [string, unknown][] = [];
  return {
    config,
    readPage: async () => null,
    readRedirect: async () => null,
    submitReport: async () => "ok",
    log: (e, f) => logs.push([e, f]),
    ...over,
    logs,
  };
}
const ask = (d: GymSiteDeps, name: string | null, path: string | null, accept: string | null = null) => handleGymSite({ tenantName: name, tenantPath: path, acceptLanguage: accept }, d);
async function snapshot(r: Response) {
  return { status: r.status, headers: [...r.headers.entries()].sort(), body: await r.text() };
}

describe("the proxy: every outcome for a host and a path", () => {
  const cases: [string, string, string | undefined, string][] = [
    ["apex", "gymosapps.com", "/", "marketing"],
    ["www", "www.gymosapps.com", "/privacy", "marketing"],
    ["preview", "gym-os-landing-abc.vercel.app", "/", "marketing"],
    ["unknown root", "fit.example.org", "/", "marketing"],
    ["gym page", "fit.gymosapps.com", "/", "page"],
    ["gym page, language code", "fit.gymosapps.com", "/fr", "page"],
    ["gym host, robots.txt (judged by the handler, 24.11)", "fit.gymosapps.com", "/robots.txt", "page"],
    ["gym host, sitemap.xml (judged by the handler, 24.11)", "fit.gymosapps.com", "/sitemap.xml", "page"],
    ["gym host, report (judged by the handler, 24.11)", "fit.gymosapps.com", "/report", "page"],
    ["gym page, any other path (judged by the handler)", "fit.gymosapps.com", "/other", "page"],
    ["font on a gym host", "fit.gymosapps.com", "/fonts/barlow-800.woff2", "asset"],
    ["grammar", "ab.gymosapps.com", "/", "not-found"],
    ["xn--", "xn--abc.gymosapps.com", "/", "not-found"],
    ["reserved", "mail.gymosapps.com", "/", "not-found"],
    ["two labels", "a.fit.gymosapps.com", "/", "not-found"],
    ["font on a bad host", "mail.gymosapps.com", "/fonts/barlow-800.woff2", "not-found"],
  ];
  for (const [label, host, path, kind] of cases) {
    it(`${label}: ${host}${path} is ${kind}`, () => {
      expect(decideGymRequest(host, path ?? "/", ROOT).kind).toBe(kind);
    });
  }
  it("gym hosting is off when no root domain is configured", () => {
    expect(decideGymRequest("fit.gymosapps.com", "/", undefined).kind).toBe("marketing");
  });

  afterEach(() => vi.unstubAllEnvs());
  const req = (host: string, path = "/", headers: Record<string, string> = {}) => new NextRequest(`https://${host}${path}`, { headers: { host, ...headers } });

  it("a gym host is rewritten to the one route with proxy-set tenant headers", () => {
    vi.stubEnv("PUBLIC_SITE_ROOT_DOMAIN", ROOT);
    const res = proxy(req("fit.gymosapps.com", "/fr?x=1"));
    expect(res.headers.get("x-middleware-rewrite")).toBe("https://fit.gymosapps.com/gym-site");
    expect(res.headers.get("x-middleware-request-x-tenant-name")).toBe("fit");
    expect(res.headers.get("x-middleware-request-x-tenant-path")).toBe("/fr");
  });
  it("a spoofed inbound x-tenant-name is overwritten on a gym host and deleted everywhere else", () => {
    vi.stubEnv("PUBLIC_SITE_ROOT_DOMAIN", ROOT);
    const spoof = { "x-tenant-name": "other", "x-tenant-path": "/fr", "X-Tenant-Extra": "1" };
    const gym = proxy(req("fit.gymosapps.com", "/", spoof));
    expect(gym.headers.get("x-middleware-request-x-tenant-name")).toBe("fit");
    expect(gym.headers.get("x-middleware-request-x-tenant-path")).toBe("/");
    expect(gym.headers.get("x-middleware-override-headers")).not.toContain("x-tenant-extra");
    const apex = proxy(req("gymosapps.com", "/privacy", spoof));
    expect(apex.headers.get("x-middleware-request-x-tenant-name")).toBeNull();
    expect(apex.headers.get("x-middleware-override-headers")).not.toMatch(/x-tenant/);
    const direct = proxy(req("www.gymosapps.com", "/gym-site", spoof));
    expect(direct.headers.get("x-middleware-request-x-tenant-name")).toBeNull();
  });
  it("a bad label is rewritten to the same route as a page, with NO tenant header (Story 24.12: one path for every hidden cause)", async () => {
    vi.stubEnv("PUBLIC_SITE_ROOT_DOMAIN", ROOT);
    for (const host of ["mail.gymosapps.com", "ab.gymosapps.com", "a.fit.gymosapps.com"]) {
      const res = proxy(req(host, "/", { "x-tenant-name": "fit", "x-tenant-path": "/" }));
      expect(res.headers.get("x-middleware-rewrite"), host).toBe(`https://${host}/gym-site`);
      expect(res.headers.get("x-middleware-request-x-tenant-name"), host).toBeNull();
      expect(res.headers.get("x-middleware-request-x-tenant-path"), host).toBeNull();
    }
    // with no tenant the handler answers the uniform not-found without reading the database
    const readPage = vi.fn(async () => null);
    const readRedirect = vi.fn(async () => null);
    const answer = await ask(deps({ readPage, readRedirect }), null, null);
    expect(await snapshot(answer)).toEqual(await snapshot(notFoundResponse(ROOT)));
    expect(readPage).not.toHaveBeenCalled();
    expect(readRedirect).not.toHaveBeenCalled();
  });
  it("the apex still redirects `/` to a locale and marketing paths pass through", () => {
    vi.stubEnv("PUBLIC_SITE_ROOT_DOMAIN", ROOT);
    const home = proxy(req("gymosapps.com", "/", { "accept-language": "fr-CM" }));
    expect(home.status).toBe(307);
    expect(home.headers.get("location")).toBe("https://gymosapps.com/fr");
    expect(proxy(req("www.gymosapps.com", "/en")).headers.get("x-middleware-next")).toBe("1");
    expect(proxy(req("gym-os.vercel.app", "/")).status).toBe(307);
  });
  it("a font on a gym host is passed through to the static file", () => {
    vi.stubEnv("PUBLIC_SITE_ROOT_DOMAIN", ROOT);
    expect(proxy(req("fit.gymosapps.com", "/fonts/barlow-700.woff2")).headers.get("x-middleware-next")).toBe("1");
  });
});

describe("the uniform not-found", () => {
  it("is byte-identical across every cause: bad input, no row, bad content, unknown template, database error", async () => {
    const hostile = baseContent();
    const causes: Record<string, () => Promise<Response>> = {
      "no tenant header": () => ask(deps(), null, "/"),
      "grammar": () => ask(deps(), "ab", "/"),
      "reserved": () => ask(deps(), "mail", "/"),
      "unknown (no row, no redirect)": () => ask(deps(), "fit", "/"),
      "other path": () => ask(deps(), "fit", "/other"),
      "robots, no row": () => ask(deps(), "fit", "/robots.txt"),
      "sitemap, no row": () => ask(deps(), "fit", "/sitemap.xml"),
      "report form, no row": () => ask(deps(), "fit", "/report"),
      "report post, no row": () => handleGymSite({ method: "POST", tenantName: "fit", tenantPath: "/report", acceptLanguage: null, readForm: async () => ({ kind: "ok", params: new URLSearchParams({ reason: "privacy", details: "x" }) }) }, deps()),
      "post to the page": () => handleGymSite({ method: "POST", tenantName: "fit", tenantPath: "/", acceptLanguage: null }, deps({ readPage: async () => row() })),
      "robots, unknown template": () => ask(deps({ readPage: async () => row({ template: "nope" }) }), "fit", "/robots.txt"),
      "sitemap, bad content": () => ask(deps({ readPage: async () => row({ content: { ...hostile, extra: 1 } }) }), "fit", "/sitemap.xml"),
      "report, bad content": () => ask(deps({ readPage: async () => row({ content: { ...hostile, name: 5 } }) }), "fit", "/report"),
      "sitemap, database error": () => ask(deps({ readPage: async () => { throw new Error("x"); } }), "fit", "/sitemap.xml"),
      "sitemap, other case": () => ask(deps({ readPage: async () => row() }), "fit", "/Sitemap.xml"),
      "report, trailing slash": () => ask(deps({ readPage: async () => row() }), "fit", "/report/"),
      "sitemap, no complete language": () => ask(deps({ readPage: async () => row({ content: (() => { const c = baseContent(); delete c.about_en; delete c.about_fr; return c; })() }) }), "fit", "/sitemap.xml"),
      "unknown code": () => ask(deps({ readPage: async () => row() }), "fit", "/de"),
      "extra key": () => ask(deps({ readPage: async () => row({ content: { ...hostile, extra: 1 } }) }), "fit", "/"),
      "wrong type": () => ask(deps({ readPage: async () => row({ content: { ...hostile, name: 5 } }) }), "fit", "/"),
      "version 2": () => ask(deps({ readPage: async () => row({ schema_version: 2 }) }), "fit", "/"),
      "unknown template": () => ask(deps({ readPage: async () => row({ template: "nope" }) }), "fit", "/"),
      "database error": () => ask(deps({ readPage: async () => { throw Object.assign(new Error("boom"), { code: "53300" }); } }), "fit", "/"),
      "redirect lookup error": () => ask(deps({ readRedirect: async () => { throw new Error("x"); } }), "fit", "/"),
      "no complete language": () => ask(deps({ readPage: async () => row({ content: (() => { const c = baseContent(); delete c.about_en; delete c.about_fr; return c; })() }) }), "fit", "/"),
      "missing media origin": () => ask(deps({ config: { rootDomain: ROOT, mediaOrigin: undefined, reportKey: undefined }, readPage: async () => row() }), "fit", "/"),
    };
    const expected = await snapshot(notFoundResponse(ROOT));
    for (const [cause, run] of Object.entries(causes)) expect(await snapshot(await run()), cause).toEqual(expected);
  });

  it("is a 404 with the 30 s cache, the exact policy, both languages in one block and no cause", async () => {
    const p = notFoundParts(ROOT);
    expect(p.status).toBe(404);
    expect(p.headers["Cache-Control"]).toBe("public, s-maxage=30");
    expect(p.headers["Content-Security-Policy"]).toMatch(/^default-src 'none'; img-src 'none'; style-src 'sha256-[A-Za-z0-9+/=]+'; font-src 'self'; connect-src 'none'; script-src 'none'; base-uri 'none'; form-action 'self'; object-src 'none'; frame-ancestors 'none'$/);
    expect(p.headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(p.headers["Strict-Transport-Security"]).toBe("max-age=63072000; includeSubDomains");
    expect(p.headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(p.headers["Set-Cookie"]).toBeUndefined();
    expect(p.body).toContain("This page isn't available.");
    expect(p.body).toContain("Cette page n'est pas disponible.");
    expect(p.body).toContain('href="https://www.gymosapps.com/en/gyms/"');
    expect(p.body).toContain('href="https://www.gymosapps.com/fr/gyms/"');
    expect(p.body).not.toMatch(/<html[^>]* lang=/);
    expect(p.body).not.toMatch(/taken down|suspended|reserved|under review|no longer|unpublished/i);
    expect(p.body).not.toContain("<script");
  });

  it("the CSP style hash is the hash of the one emitted style block", async () => {
    const { createHash } = await import("node:crypto");
    const p = notFoundParts(ROOT);
    const css = /<style>([\s\S]*?)<\/style>/.exec(p.body)![1]!;
    expect(p.headers["Content-Security-Policy"]).toContain(`'sha256-${createHash("sha256").update(css).digest("base64")}'`);
  });
});

describe("the page route", () => {
  const live = deps({ readPage: async (n) => (n === "fit" ? row() : null) });

  it("visible page: 200, French by Accept-Language, exact headers, no cookie, link to /en, hreflang", async () => {
    const r = await ask(live, "fit", "/", "fr-CM,fr;q=0.9,en;q=0.5");
    expect(r.status).toBe(200);
    const body = await r.text();
    expect(body).toContain('<html lang="fr">');
    expect(body).toContain('<a href="/en" hrefLang="en" lang="en">English</a>');
    for (const l of ["en", "fr", "x-default"]) expect(body).toContain(`hrefLang="${l}"`);
    expect(r.headers.get("set-cookie")).toBeNull();
    expect(r.headers.get("cache-control")).toBe("public, s-maxage=60");
    expect(r.headers.get("vary")).toBe("Accept-Language");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(r.headers.get("strict-transport-security")).toBe("max-age=63072000; includeSubDomains");
    const hash = /style-src '(sha256-[^']+)'/.exec(r.headers.get("content-security-policy")!)![1]!;
    const { createHash } = await import("node:crypto");
    const css = /<style>([\s\S]*?)<\/style>/.exec(body)![1]!;
    expect(hash).toBe(`sha256-${createHash("sha256").update(css).digest("base64")}`);
    expect(r.headers.get("content-security-policy")).toBe(
      `default-src 'none'; img-src ${MEDIA}; style-src '${hash}'; font-src 'self'; connect-src 'none'; script-src 'none'; base-uri 'none'; form-action 'self'; object-src 'none'; frame-ancestors 'none'`,
    );
    expect(body).not.toMatch(/<script|__NEXT_DATA__/);
  });

  it("one complete language: that language, no link, no hreflang, for a visitor who prefers the other", async () => {
    const c = baseContent();
    delete c.about_fr;
    delete c.services_fr;
    const r = await ask(deps({ readPage: async () => row({ content: c }) }), "fit", "/", "fr");
    const body = await r.text();
    expect(body).toContain('<html lang="en">');
    expect(body).not.toContain("hrefLang");
  });

  it("incomplete code: /fr with an incomplete French serves English, 200, no hreflang", async () => {
    const c = baseContent();
    delete c.about_fr;
    delete c.services_fr;
    const r = await ask(deps({ readPage: async () => row({ content: c }) }), "fit", "/fr", "fr");
    expect(r.status).toBe(200);
    const body = await r.text();
    expect(body).toContain('<html lang="en">');
    expect(body).not.toContain("hrefLang");
  });

  it("unknown code /de is the uniform not-found with s-maxage=30", async () => {
    const r = await ask(live, "fit", "/de");
    expect(r.status).toBe(404);
    expect(r.headers.get("cache-control")).toBe("public, s-maxage=30");
  });

  it("hostile text is inert: no element is created from it", async () => {
    const c = baseContent();
    c.name = "&lt;script&gt;alert(1)&lt;/script&gt;";
    c.about_en = `<script>alert(1)</script><img src=x onerror=alert(1)>\n${c.about_en}`;
    const r = await ask(deps({ readPage: async () => row({ content: c }) }), "fit", "/", "en");
    const body = await r.text();
    expect(body).not.toContain("<script");
    expect(body).not.toContain("<img src=x");
    expect(body).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("bad content is logged without gym data and answers the uniform not-found", async () => {
    const d = deps({ readPage: async () => row({ content: { ...baseContent(), name: 5, secret: "GYM-SECRET" } }) });
    const r = await ask(d, "fit", "/");
    expect(r.status).toBe(404);
    expect(d.logs).toHaveLength(1);
    expect(d.logs[0]![0]).toBe("gym_site_content_invalid");
    expect(JSON.stringify(d.logs)).not.toMatch(/GYM-SECRET|GRACE FIT/);
  });

  it("a database error is logged with a code only", async () => {
    const d = deps({ readPage: async () => { throw Object.assign(new Error("password authentication failed for hunter2"), { code: "28P01" }); } });
    const r = await ask(d, "fit", "/");
    expect(r.status).toBe(404);
    expect(JSON.stringify(d.logs)).toBe('[["gym_site_db_error",{"code":"28P01"}]]');
  });
});

describe("redirects after a rename", () => {
  const d = deps({ readRedirect: async (n) => (n === "old-name" ? "new-name" : null) });
  it("an old name answers 301 to the current name, path /, one hop, 5 minutes", async () => {
    for (const path of ["/", "/fr"]) {
      const r = await ask(d, "old-name", path);
      expect(r.status).toBe(301);
      expect(r.headers.get("location")).toBe("https://new-name.gymosapps.com/");
      expect(r.headers.get("cache-control")).toBe("public, max-age=300, s-maxage=300");
      expect(r.headers.get("set-cookie")).toBeNull();
    }
  });
  it("an old name on an unsupported path is the uniform not-found", async () => {
    expect((await ask(d, "old-name", "/anything")).status).toBe(404);
  });
  it("the current page hidden (the view has no row) is the uniform not-found, never a redirect", async () => {
    expect(await snapshot(await ask(deps({ readRedirect: async () => null }), "old-name", "/"))).toEqual(await snapshot(notFoundResponse(ROOT)));
  });
  it("a visible page wins over the redirect lookup (it is not even asked)", async () => {
    const asked = vi.fn(async () => "x-y-z");
    const r = await ask(deps({ readPage: async () => row(), readRedirect: asked }), "fit", "/");
    expect(r.status).toBe(200);
    expect(asked).not.toHaveBeenCalled();
  });
  it("a hostile target from the view is not followed", async () => {
    expect((await ask(deps({ readRedirect: async () => "evil.com/x" }), "old-name", "/")).status).toBe(404);
  });
});

describe("no database call for a name that cannot be a page", () => {
  it("grammar, reserved, other path, a direct request", async () => {
    const page = vi.fn(async () => null);
    const redirect = vi.fn(async () => null);
    const d = deps({ readPage: page, readRedirect: redirect });
    await ask(d, "ab", "/");
    await ask(d, "mail", "/");
    await ask(d, "gymos-x", "/");
    await ask(d, "fit", "/nope");
    await ask(d, null, null);
    expect(page).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("the reader (database module)", () => {
  const ok = { rows: [{ template: "classic", schema_version: 1, content: {}, name: "n" }] };
  it("selects only from public_site views, with the name as a parameter", async () => {
    const calls: [string, unknown[]][] = [];
    const r = createReader(() => ({ query: async (t, v) => (calls.push([t, v]), ok) }), 0);
    await r.readPage("fit");
    await r.readRedirect("old");
    expect(calls.map((c) => c[1])).toEqual([["fit"], ["old"]]);
    for (const [text] of calls) {
      expect(text).toMatch(/from public_site\.(pages|page_redirects) where/);
      expect(text).not.toMatch(/\bset\b|prepare|;/i);
    }
  });
  it("retries once on 53300 and then succeeds", async () => {
    let n = 0;
    const r = createReader(() => ({ query: async () => { if (n++ === 0) throw Object.assign(new Error("too many"), { code: "53300" }); return ok; } }), 0);
    expect(await r.readPage("fit")).toMatchObject({ template: "classic" });
    expect(n).toBe(2);
  });
  it("retries once on a connect timeout, then gives up", async () => {
    let n = 0;
    const r = createReader(() => ({ query: async () => { n++; throw new Error("timeout exceeded when trying to connect"); } }), 0);
    await expect(r.readPage("fit")).rejects.toThrow(/timeout/);
    expect(n).toBe(2);
  });
  it("does not retry another error", async () => {
    let n = 0;
    const r = createReader(() => ({ query: async () => { n++; throw Object.assign(new Error("denied"), { code: "42501" }); } }), 0);
    await expect(r.readPage("fit")).rejects.toThrow();
    expect(n).toBe(1);
    expect(isRetryable({ code: "53300" })).toBe(true);
  });
  it("returns null for no row", async () => {
    const r = createReader(() => ({ query: async () => ({ rows: [] }) }), 0);
    expect(await r.readPage("x")).toBeNull();
    expect(await r.readRedirect("x")).toBeNull();
  });
});

describe("configuration", () => {
  it("reads five separate reader variables and nothing from Supabase", () => {
    expect(readReaderConfig({})).toBeUndefined();
    expect(readReaderConfig({ PUBLIC_SITE_READER_HOST: "h", PUBLIC_SITE_READER_PORT: "6543", PUBLIC_SITE_READER_DATABASE: "postgres", PUBLIC_SITE_READER_USER: "public_site_reader.ref", PUBLIC_SITE_READER_PASSWORD: "p" })).toEqual({
      host: "h", port: 6543, database: "postgres", user: "public_site_reader.ref", password: "p",
    });
    expect(readReaderConfig({ PUBLIC_SITE_READER_HOST: "h", PUBLIC_SITE_READER_PORT: "x", PUBLIC_SITE_READER_DATABASE: "d", PUBLIC_SITE_READER_USER: "u", PUBLIC_SITE_READER_PASSWORD: "p" })).toBeUndefined();
  });
  it("the root domain defaults to localhost in development and is off in production when unset", () => {
    expect(readConfig({}).rootDomain).toBe("localhost");
    expect(readConfig({ NODE_ENV: "production" }).rootDomain).toBeUndefined();
    expect(readConfig({ PUBLIC_SITE_ROOT_DOMAIN: " GymOSApps.com ", PUBLIC_SITE_MEDIA_ORIGIN: "https://x.example.com/path" })).toEqual({ rootDomain: "gymosapps.com", mediaOrigin: "https://x.example.com", reportKey: undefined });
    expect(readConfig({ PUBLIC_SITE_MEDIA_ORIGIN: "javascript:alert(1)" }).mediaOrigin).toBeUndefined();
  });
  it("the report key needs 16 characters after trimming; a shorter one is refused and logged once as too short", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(readConfig({ PUBLIC_SITE_REPORT_KEY: "short" }).reportKey).toBeUndefined();
      expect(err).toHaveBeenCalledTimes(1);
      expect(String(err.mock.calls[0]![0])).toContain('"reason":"too_short"');
      expect(readConfig({ PUBLIC_SITE_REPORT_KEY: "a".repeat(15) }).reportKey).toBeUndefined();
      expect(readConfig({ PUBLIC_SITE_REPORT_KEY: "a".repeat(16) }).reportKey).toBe("a".repeat(16));
      expect(readConfig({ PUBLIC_SITE_REPORT_KEY: `  ${"b".repeat(16)}  ` }).reportKey).toBe("b".repeat(16));
      expect(readConfig({ PUBLIC_SITE_REPORT_KEY: `  ${"b".repeat(14)}  ` }).reportKey).toBeUndefined();
      expect(readConfig({}).reportKey).toBeUndefined();
    } finally {
      err.mockRestore();
    }
  });
});
