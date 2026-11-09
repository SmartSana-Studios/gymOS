import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { baseContent } from "@gymos/page-templates/src/conformance/fixtures";
import type { PageReportResult } from "@gymos/types";
import { createReader, type TxClient } from "./db";
import { clientAddress, readFormBody } from "./formBody";
import { handleGymSite, sourceHash, type GymSiteDeps, type GymSiteRequest } from "./handler";
import { notFoundResponse } from "./notFound";
import { BEGIN_RW_SQL, COMMIT_SQL, SUBMIT_REPORT_SQL } from "./readerSql";

const ROOT = "gymosapps.com";
const KEY = "unit-test-report-key-0123456789";
const row = (over: Record<string, unknown> = {}) => ({ template: "classic", schema_version: 1, content: baseContent(), ...over });

function deps(over: Partial<GymSiteDeps> = {}): GymSiteDeps & { logs: [string, unknown][]; reports: Parameters<GymSiteDeps["submitReport"]>[0][] } {
  const logs: [string, unknown][] = [];
  const reports: Parameters<GymSiteDeps["submitReport"]>[0][] = [];
  return {
    config: { rootDomain: ROOT, mediaOrigin: "https://media.example.com", reportKey: KEY },
    readPage: async () => row(),
    readRedirect: async () => null,
    submitReport: async (r) => (reports.push(r), "ok"),
    log: (e, f) => logs.push([e, f]),
    ...over,
    logs,
    reports,
  };
}
const get = (d: GymSiteDeps, path: string, accept: string | null = null) => handleGymSite({ tenantName: "fit", tenantPath: path, acceptLanguage: accept }, d);
const post = (d: GymSiteDeps, form: Record<string, string> | "bad", over: Partial<GymSiteRequest> = {}) =>
  handleGymSite(
    { method: "POST", tenantName: "fit", tenantPath: "/report", acceptLanguage: null, clientAddress: "203.0.113.9", readForm: async () => (form === "bad" ? { kind: "bad" } : { kind: "ok", params: new URLSearchParams(form) }), ...over },
    d,
  );
const snap = async (r: Response) => ({ status: r.status, headers: [...r.headers.entries()].sort(), body: await r.text() });
const GOOD = { reason: "impersonation", details: "It pretends to be a bank." };

describe("/sitemap.xml and /robots.txt", () => {
  it("the sitemap lists exactly the page's own root, with the exact headers", async () => {
    const r = await get(deps(), "/sitemap.xml");
    expect(r.status).toBe(200);
    expect(await r.text()).toBe(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://fit.gymosapps.com/</loc></url>\n</urlset>\n`,
    );
    expect(r.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    expect(r.headers.get("cache-control")).toBe("public, s-maxage=300");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("set-cookie")).toBeNull();
  });
  it("robots allows everything and cites that sitemap", async () => {
    const r = await get(deps(), "/robots.txt");
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("User-agent: *\nAllow: /\n\nSitemap: https://fit.gymosapps.com/sitemap.xml\n");
    expect(r.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(r.headers.get("cache-control")).toBe("public, s-maxage=300");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
  });
  it("both reuse readPage (one call each, no other read) and never follow an old name", async () => {
    const d = deps({ readPage: vi.fn(async () => null), readRedirect: vi.fn(async () => "new-name") });
    for (const p of ["/sitemap.xml", "/robots.txt", "/report"]) expect(await snap(await get(d, p))).toEqual(await snap(notFoundResponse(ROOT)));
    expect(d.readRedirect).not.toHaveBeenCalled();
    expect(d.readPage).toHaveBeenCalledTimes(3);
  });
  it("a hidden page answers the uniform not-found, byte for byte, on all three", async () => {
    const d = deps({ readPage: async () => null });
    const expected = await snap(notFoundResponse(ROOT));
    for (const p of ["/sitemap.xml", "/robots.txt", "/report"]) expect(await snap(await get(d, p)), p).toEqual(expected);
    expect(await snap(await post(d, GOOD))).toEqual(expected);
  });
});

describe("/report (GET)", () => {
  it("is the plain form in the visitor's language, else the page's default language", async () => {
    expect(await (await get(deps(), "/report", "fr-CM,fr;q=0.9")).text()).toContain('<html lang="fr">');
    expect(await (await get(deps(), "/report", "de")).text()).toContain('<html lang="en">');
    const frDefault = baseContent();
    frDefault.default_language = "fr";
    expect(await (await get(deps({ readPage: async () => row({ content: frDefault }) }), "/report", "de")).text()).toContain('<html lang="fr">');
  });
  it("has no script, no cookie and the AD-44 policy with form-action 'self'", async () => {
    const r = await get(deps(), "/report");
    const body = await r.text();
    expect(body).not.toMatch(/<script/);
    expect(r.headers.get("set-cookie")).toBeNull();
    expect(r.headers.get("content-security-policy")).toContain("form-action 'self'");
    expect(r.headers.get("content-security-policy")).toContain("script-src 'none'");
  });
  it("a missing report key is one logged config line and the uniform not-found", async () => {
    const d = deps({ config: { rootDomain: ROOT, mediaOrigin: "https://media.example.com", reportKey: undefined } });
    expect(await snap(await get(d, "/report"))).toEqual(await snap(notFoundResponse(ROOT)));
    expect(d.logs).toEqual([["gym_site_config_missing", { variable: "PUBLIC_SITE_REPORT_KEY" }]]);
  });
});

describe("/report (POST)", () => {
  it("a valid report is stored with a keyed hash of the address, and answered with the confirmation page in the same response", async () => {
    const d = deps();
    const r = await post(d, GOOD, { acceptLanguage: "fr" });
    expect(r.status).toBe(200);
    expect(r.headers.get("location")).toBeNull();
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("set-cookie")).toBeNull();
    expect(await r.text()).toContain("Merci. Nous allons examiner cette page.");
    expect(d.reports).toEqual([{ name: "fit", reason: "impersonation", details: "It pretends to be a bank.", sourceHash: createHmac("sha256", KEY).update("203.0.113.9").digest("hex") }]);
    expect(JSON.stringify(d.reports)).not.toContain("203.0.113.9");
  });
  it("the hash depends on the key and on the address, and a missing address shares one bucket", () => {
    expect(sourceHash(KEY, "203.0.113.9")).toMatch(/^[0-9a-f]{64}$/);
    expect(sourceHash(KEY, "203.0.113.9")).not.toBe(sourceHash(KEY, "203.0.113.10"));
    expect(sourceHash(KEY, "203.0.113.9")).not.toBe(sourceHash(KEY + "x", "203.0.113.9"));
    expect(sourceHash(KEY, null)).toBe(sourceHash(KEY, undefined));
    expect(sourceHash(KEY, "")).toBe(sourceHash(KEY, "unknown"));
  });
  it("the honeypot filled: the confirmation is shown and nothing is stored", async () => {
    const d = deps();
    const r = await post(d, { ...GOOD, hp_field_x: "http://spam.example" });
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("Thank you.");
    expect(d.reports).toEqual([]);
  });
  it("validation errors return the form with an error list and store nothing", async () => {
    const d = deps();
    for (const bad of [{ details: "x" } as Record<string, string>, { reason: "nonsense", details: "x" }, { reason: "privacy", details: "" }, { reason: "privacy", details: "a".repeat(1001) }]) {
      const r = await post(d, bad);
      expect(r.status).toBe(400);
      expect(r.headers.get("cache-control")).toBe("no-store");
      expect(await r.text()).toContain('role="alert"');
    }
    expect(d.reports).toEqual([]);
  });
  it("a rate limit answers a message that does not name the page", async () => {
    const d = deps({ submitReport: async () => "rate_limited" });
    const r = await post(d, GOOD);
    expect(r.status).toBe(429);
    const body = await r.text();
    expect(body).toContain("Too many reports from this connection. Try again later.");
    expect(body).not.toMatch(/fit\.gymosapps|<form/);
  });
  it("the database judging the page not visible any more is the uniform not-found", async () => {
    expect(await snap(await post(deps({ submitReport: async () => "not_found" }), GOOD))).toEqual(await snap(notFoundResponse(ROOT)));
  });
  it("a database failure or an unexpected 'invalid' returns the form with the failure line, logging a code only", async () => {
    const d = deps({ submitReport: async () => { throw Object.assign(new Error("password for hunter2"), { code: "08006" }); } });
    const r = await post(d, GOOD);
    expect(r.status).toBe(503);
    expect(await r.text()).toContain("We couldn&#39;t send your report");
    expect(JSON.stringify(d.logs)).toBe('[["gym_site_db_error",{"code":"08006"}]]');
    const inv = await post(deps({ submitReport: async () => "invalid" as PageReportResult }), GOOD);
    expect(inv.status).toBe(503);
  });
  it("a body that is not a readable url-encoded form returns the form with the failure line", async () => {
    const d = deps();
    const r = await post(d, "bad");
    expect(r.status).toBe(503);
    expect(d.reports).toEqual([]);
  });
  it("reads the body only for /report", async () => {
    const readForm = vi.fn(async () => ({ kind: "ok", params: new URLSearchParams(GOOD) }) as const);
    for (const path of ["/", "/fr", "/sitemap.xml", "/robots.txt"]) {
      expect(await snap(await handleGymSite({ method: "POST", tenantName: "fit", tenantPath: path, acceptLanguage: null, readForm }, deps()))).toEqual(await snap(notFoundResponse(ROOT)));
    }
    expect(readForm).not.toHaveBeenCalled();
  });
});

describe("the form body and the visitor's address", () => {
  const req = (body: string, headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" }) => new Request("https://fit.gymosapps.com/report", { method: "POST", body, headers });
  it("reads a url-encoded form", async () => {
    const r = await readFormBody(req("reason=privacy&details=a%20b"));
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.params.get("details")).toBe("a b");
  });
  it("refuses another content type and a body over the cap, without buffering it", async () => {
    expect(await readFormBody(req("reason=privacy", { "content-type": "application/json" }))).toEqual({ kind: "bad" });
    expect(await readFormBody(req("a=" + "x".repeat(40_000)))).toEqual({ kind: "bad" });
    expect(await readFormBody(req("a=" + "x".repeat(100)), 50)).toEqual({ kind: "bad" });
  });
  it("takes the address from x-real-ip, else the first x-forwarded-for entry, else none", () => {
    expect(clientAddress(new Headers({ "x-real-ip": "198.51.100.2", "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe("198.51.100.2");
    expect(clientAddress(new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe("203.0.113.9");
    expect(clientAddress(new Headers())).toBeNull();
  });
});

describe("the reader's report transaction", () => {
  function fakePool(script: { connectFails?: number; failAt?: string; result?: unknown } = {}) {
    const log: string[] = [];
    const client: TxClient & { released: boolean | undefined } = {
      released: undefined,
      async query(text: string, values?: unknown[]) {
        log.push(text);
        if (script.failAt === text) throw Object.assign(new Error("boom"), { code: "XX000" });
        if (text === SUBMIT_REPORT_SQL) return { rows: [{ result: script.result ?? "ok" }], values } as never;
        return { rows: [] };
      },
      release(destroy) {
        client.released = destroy;
      },
    };
    let connects = 0;
    return {
      log,
      client,
      pool: {
        query: async () => ({ rows: [] }),
        connect: async () => {
          if (connects++ < (script.connectFails ?? 0)) throw new Error("timeout exceeded when trying to connect");
          return client;
        },
      },
    };
  }
  const report = { name: "fit", reason: "privacy", details: "x", sourceHash: "a".repeat(64) };

  it("runs begin read write, the one function call and commit on one connection, then releases it", async () => {
    const f = fakePool();
    expect(await createReader(() => f.pool, 0).submitReport(report)).toBe("ok");
    expect(f.log).toEqual([BEGIN_RW_SQL, SUBMIT_REPORT_SQL, COMMIT_SQL]);
    expect(f.client.released).toBe(false);
  });
  it("calls only public_site.submit_page_report", () => {
    expect(SUBMIT_REPORT_SQL).toMatch(/^select public_site\.submit_page_report\(\$1, \$2, \$3, \$4\)/);
    expect(BEGIN_RW_SQL).toBe("begin read write");
    expect(COMMIT_SQL).toBe("commit");
  });
  it("rolls back and destroys the connection when a statement fails", async () => {
    const f = fakePool({ failAt: SUBMIT_REPORT_SQL });
    await expect(createReader(() => f.pool, 0).submitReport(report)).rejects.toThrow("boom");
    expect(f.log).toEqual([BEGIN_RW_SQL, SUBMIT_REPORT_SQL, "rollback"]);
    expect(f.client.released).toBe(true);
  });
  it("retries once on a connect timeout", async () => {
    const f = fakePool({ connectFails: 1 });
    expect(await createReader(() => f.pool, 0).submitReport(report)).toBe("ok");
  });
  it("gives up after the retry", async () => {
    const f = fakePool({ connectFails: 2 });
    await expect(createReader(() => f.pool, 0).submitReport(report)).rejects.toThrow(/timeout/);
  });
  it("refuses a result the database does not define", async () => {
    const f = fakePool({ result: "surprise" });
    await expect(createReader(() => f.pool, 0).submitReport(report)).rejects.toMatchObject({ code: "report_result_unexpected" });
  });
});
