// Story 25.5: every row of the I/O matrix of the crawler files, the header table, the not-found outcomes, and the gate reach: the index and every <loc> of it
// fetched through the real handlers, and every consumer of the indexable decision enumerated.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SEO_CACHE_CONTROL } from "@gymos/page-templates";
import { handleDirectory, type DirectoryDeps } from "@/lib/directory/handler";
import { notFoundResponse } from "@/lib/gym-site/notFound";
import type { CrawlReader } from "@/lib/directory/types";
import { handleCrawl, type CrawlDeps, type CrawlRequest } from "./handler";
import { SITEMAP_CHUNK_SIZE } from "./entries";
import { COUNTRY_NAMES, THIN, gym, gymsIn, worldReader, type WorldGym } from "./testkit";

const ROOT = "gymosapps.com";
const MEDIA = "https://media.example.com";
const WWW = `https://www.${ROOT}`;

function deps(gyms: readonly WorldGym[], over: Partial<CrawlDeps> = {}, calls: string[] = []): CrawlDeps & { logs: [string, unknown][] } {
  const logs: [string, unknown][] = [];
  return { config: { rootDomain: ROOT, mediaOrigin: MEDIA, reportKey: undefined }, reader: worldReader(gyms, calls), log: (e, f) => logs.push([e, f]), ...over, logs };
}
const locs = (xml: string): string[] => [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]!);
const snapshot = async (r: Response) => ({ status: r.status, headers: [...r.headers.entries()].sort(), body: await r.text() });
const NOT_FOUND = snapshot(notFoundResponse(ROOT));

/** The sitemap as a crawler reads it: the index, then every file it lists, as paths. */
async function sitemapPaths(d: CrawlDeps): Promise<string[]> {
  const index = await handleCrawl({ kind: "index" }, d);
  expect(index.status).toBe(200);
  const files = locs(await index.text());
  const out: string[] = [];
  for (const loc of files) {
    const m = /^https:\/\/www\.gymosapps\.com\/sitemaps\/(.+)$/.exec(loc);
    expect(m, loc).not.toBeNull();
    const res = await handleCrawl({ kind: "chunk", file: m![1]! }, d);
    expect(res.status, loc).toBe(200);
    out.push(...locs(await res.text()).map((l) => l.slice(WWW.length)));
  }
  return out;
}

describe("matrix: nothing published", () => {
  it("the index has one file; it lists /en, /fr and the top directory page in both locales; llms.txt is the header only", async () => {
    const d = deps([]);
    const index = await handleCrawl({ kind: "index" }, d);
    expect(index.status).toBe(200);
    expect(locs(await index.text())).toEqual([`${WWW}/sitemaps/1.xml`]);
    expect(await sitemapPaths(d)).toEqual(["/en", "/fr", "/en/gyms", "/fr/gyms"]);

    const llms = await (await handleCrawl({ kind: "llms" }, d)).text();
    expect(llms).toMatch(/^# GymOS gyms\n/);
    expect(llms).not.toContain("## ");
    expect(llms).not.toContain("url:");
  });
});

describe("matrix: thin and ready", () => {
  const gyms = [...gymsIn("CM", "douala", 2), ...gymsIn("CM", "yaounde", THIN)];
  it("the city with 3 gyms is listed in both locales, the city with 2 is not; both pages are still served", async () => {
    const d = deps(gyms);
    const paths = await sitemapPaths(d);
    expect(paths).toContain("/en/gyms/cm/yaounde");
    expect(paths).toContain("/fr/gyms/cm/yaounde");
    expect(paths.some((p) => p.includes("douala"))).toBe(false);
    for (const city of ["douala", "yaounde"]) {
      const res = await handleDirectory({ locale: "en", segments: ["cm", city], query: new URLSearchParams() }, dirDeps(gyms));
      expect(res.status, city).toBe(200);
    }
  });
  it("order: marketing, top page, then the country (both locales) and its cities", async () => {
    expect(await sitemapPaths(deps(gyms))).toEqual(["/en", "/fr", "/en/gyms", "/fr/gyms", "/en/gyms/cm", "/fr/gyms/cm", "/en/gyms/cm/yaounde", "/fr/gyms/cm/yaounde"]);
  });
  it("a city enters at 3 gyms and leaves below it on the next read, with no other change", async () => {
    const two = [...gymsIn("CM", "douala", 2), ...gymsIn("SN", "dakar", 3)];
    expect(await sitemapPaths(deps(two))).not.toContain("/en/gyms/cm/douala");
    expect(await sitemapPaths(deps([...two, gym("cm-douala-3", "CM", "douala")]))).toContain("/en/gyms/cm/douala");
    expect(await sitemapPaths(deps(two))).not.toContain("/en/gyms/cm/douala");
  });
});

describe("matrix: country disagrees", () => {
  // 4 gyms in a city of Cameroon, one of whose snapshots says Senegal: the country view counts 3 for CM, the city rows list 4
  const gyms = [...gymsIn("CM", "yaounde", 3), gym("cm-yaounde-x", "CM", "yaounde", { snapshotCountry: "SN" })];
  it("the country page is absent from the sitemap and noindex, its indexable city is present", async () => {
    const paths = await sitemapPaths(deps(gyms));
    expect(paths).not.toContain("/en/gyms/cm");
    expect(paths).not.toContain("/fr/gyms/cm");
    expect(paths).toContain("/en/gyms/cm/yaounde");
    const res = await handleDirectory({ locale: "en", segments: ["cm"], query: new URLSearchParams() }, dirDeps(gyms));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
  });
  it("a country whose own flag is false is not listed even when its rows agree with its count and a city is indexable", async () => {
    const gyms = gymsIn("CM", "yaounde", 3);
    const reader = worldReader(gyms);
    const flagOff = { ...reader, readCountries: async () => (await reader.readCountries()).map((c) => ({ ...c, indexable: false })) };
    const paths = await sitemapPaths(deps(gyms, { reader: flagOff }));
    expect(paths).not.toContain("/en/gyms/cm");
    expect(paths).toContain("/en/gyms/cm/yaounde");
  });
  it("a city whose country is not on the top page is not listed", async () => {
    // the snapshots say a country the countries table does not know (ZZ): no country row, so the top page does not list the country
    const paths = await sitemapPaths(deps(gymsIn("CM", "yaounde", 3, { snapshotCountry: "ZZ" })));
    expect(paths).toEqual(["/en", "/fr", "/en/gyms", "/fr/gyms"]);
  });
});

describe("matrix: removed gym", () => {
  const before = [...gymsIn("CM", "yaounde", 3), gym("grace", "CM", "yaounde", { name: "Grace Removed" })];
  it("is gone from llms.txt, the counts fall, and a city that becomes thin leaves the sitemap on the next read", async () => {
    const d1 = deps(before);
    expect(await (await handleCrawl({ kind: "llms" }, d1)).text()).toContain("## Grace Removed");
    expect(await sitemapPaths(d1)).toContain("/en/gyms/cm/yaounde");

    const after = before.filter((g) => g.pageName !== "grace" && g.pageName !== "cm-yaounde-3");
    const d2 = deps(after);
    const llms = await (await handleCrawl({ kind: "llms" }, d2)).text();
    expect(llms).not.toContain("Grace Removed");
    expect(llms).not.toContain("grace.gymosapps.com");
    const paths = await sitemapPaths(d2);
    expect(paths).not.toContain("/en/gyms/cm/yaounde");
    expect(paths).not.toContain("/en/gyms/cm"); // the country is thin too now
  });
});

describe("matrix: many entries", () => {
  /** A reader with `n` indexable cities in one country, without building a gym per city. */
  function bigReader(n: number): CrawlReader {
    const slugs = Array.from({ length: n }, (_, i) => `city-${i + 1}`);
    return {
      readCountries: async () => [{ countryCode: "CM", nameEn: "Cameroon", nameFr: "Cameroun", publishedCount: n * 3, indexable: true }],
      readCityTotals: async () => [{ countryCode: "CM", listedCount: n * 3 }],
      readIndexableCities: async () => slugs.map((citySlug) => ({ countryCode: "CM", citySlug })),
      readLlmsPages: async () => [],
    };
  }
  const base = { config: { rootDomain: ROOT, mediaOrigin: MEDIA, reportKey: undefined }, log: () => undefined };

  it("25,001 cities at the real size: 50,008 entries, two files of at most 50,000 <url>, every <loc> absolute", async () => {
    const d: CrawlDeps = { ...base, reader: bigReader(25_001) };
    expect(SITEMAP_CHUNK_SIZE).toBe(50_000);
    const index = locs(await (await handleCrawl({ kind: "index" }, d)).text());
    expect(index).toEqual([`${WWW}/sitemaps/1.xml`, `${WWW}/sitemaps/2.xml`]);
    const sizes: number[] = [];
    for (const n of [1, 2]) {
      const xml = await (await handleCrawl({ kind: "chunk", file: `${n}.xml` }, d)).text();
      sizes.push((xml.match(/<url>/g) ?? []).length);
      for (const l of locs(xml)) expect(l.startsWith(`${WWW}/`)).toBe(true);
    }
    expect(sizes).toEqual([50_000, 8]);
    expect((await handleCrawl({ kind: "chunk", file: "3.xml" }, d)).status).toBe(404);
  });
  it("a lower size (the handler's dep) gives more files, the index lists /sitemaps/1.xml ... /sitemaps/N.xml, and no entry is in two files", async () => {
    const d: CrawlDeps = { ...base, reader: bigReader(10), chunkSize: 8 };
    const index = locs(await (await handleCrawl({ kind: "index" }, d)).text());
    // 4 + 2 + 20 = 26 entries
    expect(index).toEqual([1, 2, 3, 4].map((n) => `${WWW}/sitemaps/${n}.xml`));
    const all: string[] = [];
    for (let n = 1; n <= 4; n++) {
      const l = locs(await (await handleCrawl({ kind: "chunk", file: `${n}.xml` }, d)).text());
      expect(l.length).toBeLessThanOrEqual(8);
      all.push(...l);
    }
    expect(all).toHaveLength(26);
    expect(new Set(all).size).toBe(26);
  });
});

describe("matrix: llms.txt cap", () => {
  it("asks the reader for one row more than the cap, prints the cap's blocks and the cut line", async () => {
    const calls: string[] = [];
    const d = deps(gymsIn("CM", "yaounde", 4), { llmsCap: 3 }, calls);
    const llms = await (await handleCrawl({ kind: "llms" }, d)).text();
    expect(calls).toContain("llms:4");
    expect(llms.split("\n").filter((l) => l.startsWith("## "))).toHaveLength(3);
    expect(llms.trimEnd().split("\n").pop()).toBe("The list is cut at 3 gyms; more exist.");
  });

  it("prints no cut line when the gyms fit exactly in the cap", async () => {
    const calls: string[] = [];
    const d = deps(gymsIn("CM", "yaounde", 3), { llmsCap: 3 }, calls);
    const llms = await (await handleCrawl({ kind: "llms" }, d)).text();
    expect(calls).toContain("llms:4");
    expect(llms.split("\n").filter((l) => l.startsWith("## "))).toHaveLength(3);
    expect(llms).not.toContain("is cut at");
  });
});

describe("matrix: hostile text", () => {
  const hostile = "</loc>\n## Evil\nurl: https://evil.example/";
  it("a gym name is one line in llms.txt and appears nowhere in a sitemap", async () => {
    const gyms = [...gymsIn("CM", "yaounde", 2), gym("hostile", "CM", "yaounde", { name: hostile })];
    const d = deps(gyms);
    const llms = await (await handleCrawl({ kind: "llms" }, d)).text();
    expect(llms).toContain("## </loc> ## Evil url: https://evil.example/");
    expect(llms.split("\n").filter((l) => l.startsWith("## "))).toHaveLength(3);
    expect(llms.split("\n").filter((l) => l.startsWith("url: "))).toHaveLength(3);
    for (const n of [1]) {
      const xml = await (await handleCrawl({ kind: "chunk", file: `${n}.xml` }, d)).text();
      expect(xml).not.toContain("Evil");
    }
  });
});

describe("the outcomes that are not a 200 are the uniform not-found", () => {
  const throwing = (code: string | undefined): CrawlReader => {
    const fail = async () => {
      throw Object.assign(new Error("password authentication failed for user secret-gym-name"), code ? { code } : {});
    };
    return { readCountries: fail, readCityTotals: fail, readIndexableCities: fail, readLlmsPages: fail };
  };
  const requests: [string, CrawlRequest][] = [
    ["index", { kind: "index" }],
    ["chunk 1", { kind: "chunk", file: "1.xml" }],
    ["llms", { kind: "llms" }],
  ];
  for (const [label, req] of requests) {
    it(`a database error on ${label}: the uniform not-found, crawl_db_error with the code only, no partial body`, async () => {
      const d = deps([], { reader: throwing("57P01") });
      const res = await handleCrawl(req, d);
      expect(await snapshot(res)).toEqual(await NOT_FOUND);
      expect(d.logs).toEqual([["crawl_db_error", { code: "57P01" }]]);
      expect(JSON.stringify(d.logs)).not.toContain("secret-gym-name");
    });
  }
  it("an error with no code logs unknown", async () => {
    const d = deps([], { reader: throwing(undefined) });
    await handleCrawl({ kind: "index" }, d);
    expect(d.logs).toEqual([["crawl_db_error", { code: "unknown" }]]);
  });
  it("a missing root domain is the uniform not-found for all four, with nothing read", async () => {
    const calls: string[] = [];
    const d = deps([], { config: { rootDomain: undefined, mediaOrigin: MEDIA, reportKey: undefined } }, calls);
    for (const req of [{ kind: "robots" }, { kind: "index" }, { kind: "chunk", file: "1.xml" }, { kind: "llms" }] as CrawlRequest[]) {
      expect(await snapshot(await handleCrawl(req, d)), req.kind).toEqual(await NOT_FOUND);
    }
    expect(calls).toEqual([]);
  });
  it("a missing media origin (the pages themselves are then not-found) is the uniform not-found for the index, a file and llms.txt, logged by variable name", async () => {
    const calls: string[] = [];
    const d = deps([], { config: { rootDomain: ROOT, mediaOrigin: undefined, reportKey: undefined } }, calls);
    for (const req of [{ kind: "index" }, { kind: "chunk", file: "1.xml" }, { kind: "llms" }] as CrawlRequest[]) {
      expect(await snapshot(await handleCrawl(req, d)), req.kind).toEqual(await NOT_FOUND);
    }
    expect(d.logs.every(([e, f]) => e === "crawl_config_missing" && JSON.stringify(f) === '{"variable":"PUBLIC_SITE_MEDIA_ORIGIN"}')).toBe(true);
    expect(calls).toEqual([]);
    expect((await handleCrawl({ kind: "robots" }, d)).status).toBe(200);
  });
  it("a method that is not GET is the uniform not-found, with nothing read", async () => {
    const calls: string[] = [];
    const d = deps([], {}, calls);
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      for (const req of [{ kind: "robots" }, { kind: "index" }, { kind: "chunk", file: "1.xml" }, { kind: "llms" }] as const) {
        expect(await snapshot(await handleCrawl({ ...req, method }, d)), `${method} ${req.kind}`).toEqual(await NOT_FOUND);
      }
    }
    expect(calls).toEqual([]);
  });
  it("a chunk outside 1..N, or not matching ^[1-9][0-9]*\\.xml$, is the uniform not-found; the malformed ones read nothing", async () => {
    const calls: string[] = [];
    const d = deps(gymsIn("CM", "yaounde", 3), {}, calls);
    for (const file of ["0.xml", "01.xml", "-1.xml", "1", "1.xml.bak", "1.XML", "a.xml", ".xml", "1.5.xml", " 1.xml", "1.xml ", "1%2exml", "99999999999999999999999.xml", "1\n.xml"]) {
      expect(await snapshot(await handleCrawl({ kind: "chunk", file }, d)), file).toEqual(await NOT_FOUND);
    }
    expect(calls).toEqual([]);
    expect(await snapshot(await handleCrawl({ kind: "chunk", file: "2.xml" }, d))).toEqual(await NOT_FOUND);
    expect((await handleCrawl({ kind: "chunk", file: "1.xml" }, d)).status).toBe(200);
  });
});

describe("headers: every 200 takes the one crawler header set", () => {
  const types: [string, CrawlRequest, string][] = [
    ["robots", { kind: "robots" }, "text/plain; charset=utf-8"],
    ["index", { kind: "index" }, "application/xml; charset=utf-8"],
    ["chunk", { kind: "chunk", file: "1.xml" }, "application/xml; charset=utf-8"],
    ["llms", { kind: "llms" }, "text/plain; charset=utf-8"],
  ];
  for (const [label, req, type] of types) {
    it(`${label}: exact headers, a 5 minute CDN cache, no cookie`, async () => {
      const res = await handleCrawl(req, deps(gymsIn("CM", "yaounde", 3)));
      expect(res.status).toBe(200);
      expect(Object.fromEntries(res.headers.entries())).toEqual({
        "cache-control": "public, s-maxage=300",
        "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
        "content-type": type,
        "referrer-policy": "strict-origin-when-cross-origin",
        "strict-transport-security": "max-age=63072000; includeSubDomains",
        "x-content-type-options": "nosniff",
      });
      expect(res.headers.get("cache-control")).toBe(SEO_CACHE_CONTROL);
      expect(res.headers.get("set-cookie")).toBeNull();
    });
  }
});

describe("robots.txt", () => {
  it("allows everything, disallows nothing, and names the index at the configured www origin", async () => {
    const body = await (await handleCrawl({ kind: "robots" }, deps([]))).text();
    expect(body).toBe(`User-agent: *\nAllow: /\n\nSitemap: ${WWW}/sitemap-index.xml\n`);
    expect(body).not.toMatch(/disallow/i);
  });
  it("uses http for localhost, with the port the root domain carries", async () => {
    const d = deps([], { config: { rootDomain: "localhost:3200", mediaOrigin: MEDIA, reportKey: undefined } });
    expect(await (await handleCrawl({ kind: "robots" }, d)).text()).toContain("Sitemap: http://www.localhost:3200/sitemap-index.xml");
    const index = locs(await (await handleCrawl({ kind: "index" }, d)).text());
    expect(index).toEqual(["http://www.localhost:3200/sitemaps/1.xml"]);
  });
});

describe("the sitemap documents", () => {
  it("every <url> has the three alternates equal to the page's own hreflang, a lone <loc> and no lastmod, changefreq or priority", async () => {
    const d = deps(gymsIn("CM", "yaounde", 3));
    const xml = await (await handleCrawl({ kind: "chunk", file: "1.xml" }, d)).text();
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n')).toBe(true);
    expect(xml).not.toMatch(/lastmod|changefreq|priority/);
    const urls = [...xml.matchAll(/<url>(.*?)<\/url>/g)].map((m) => m[1]!);
    expect(urls).toHaveLength(8);
    for (const u of urls) {
      const loc = /<loc>([^<]*)<\/loc>/.exec(u)![1]!;
      const alt = Object.fromEntries([...u.matchAll(/<xhtml:link rel="alternate" hreflang="([^"]+)" href="([^"]+)"\/>/g)].map((m) => [m[1]!, m[2]!]));
      expect(Object.keys(alt)).toEqual(["en", "fr", "x-default"]);
      expect(alt["x-default"]).toBe(alt.en);
      expect([alt.en, alt.fr]).toContain(loc);
      expect(alt.fr!).toBe(alt.en!.replace(/\/en(\/|$)/, "/fr$1"));
    }
  });
  it("lists no gym page and no filtered or paged view", async () => {
    const paths = await sitemapPaths(deps([...gymsIn("CM", "yaounde", 25), ...gymsIn("SN", "dakar", 3)]));
    for (const p of paths) {
      expect(p).toMatch(/^\/(en|fr)(\/gyms(\/[a-z]{2}(\/[a-z0-9-]+)?)?)?$/);
      expect(p).not.toMatch(/[?#]/);
    }
    expect(paths).toContain("/en/gyms/sn/dakar");
  });
});

// ---- the gate reach (Epic 22 retro 66, 77) ----
function dirDeps(gyms: readonly WorldGym[]): DirectoryDeps {
  return { config: { rootDomain: ROOT, mediaOrigin: MEDIA, reportKey: undefined }, reader: worldReader(gyms), log: () => undefined };
}

describe("gate reach: the index and every <loc> through the real handlers", () => {
  // a mixed world: a full city + a thin city + a thin country + a country that disagrees with its rows
  const gyms = [
    ...gymsIn("CM", "yaounde", 4),
    ...gymsIn("CM", "douala", 2),
    ...gymsIn("SN", "dakar", 3),
    ...gymsIn("NG", "lagos", 2),
    ...gymsIn("CD", "kinshasa", 3, { snapshotCountry: "SN" }),
  ];

  it("each listed URL answers 200 with no noindex (header or meta), and none is a gym page or a filtered view", async () => {
    const paths = await sitemapPaths(deps(gyms));
    expect(paths.length).toBeGreaterThan(6);
    const dd = dirDeps(gyms);
    for (const p of paths) {
      if (p === "/en" || p === "/fr") continue; // the marketing pages are Next pages: scripts/landing-gate/check-http.mjs fetches them against the built server
      const [, locale, , ...segments] = p.split("/");
      const res = await handleDirectory({ locale: locale!, segments, query: new URLSearchParams() }, dd);
      expect(res.status, p).toBe(200);
      expect(res.headers.get("x-robots-tag"), p).toBeNull();
      expect(await res.text(), p).not.toMatch(/<meta name="robots" content="noindex"/);
    }
  });

  it("each listed entry declares the same three alternates as the page it points at (hreflang en, fr, x-default)", async () => {
    const d = deps(gyms);
    const dd = dirDeps(gyms);
    const index = await handleCrawl({ kind: "index" }, d);
    let checked = 0;
    for (const file of locs(await index.text())) {
      const xml = await (await handleCrawl({ kind: "chunk", file: file.slice(`${WWW}/sitemaps/`.length) }, d)).text();
      for (const [, loc, links] of xml.matchAll(/<url><loc>([^<]*)<\/loc>(.*?)<\/url>/g)) {
        const path = loc!.slice(WWW.length);
        if (path === "/en" || path === "/fr") continue; // marketing pages: the built-server run (check-http) fetches them
        const entry = Object.fromEntries([...links!.matchAll(/hreflang="([^"]+)" href="([^"]+)"/g)].map((m) => [m[1], m[2]]));
        const [, locale, , ...segments] = path.split("/");
        const html = await (await handleDirectory({ locale: locale!, segments, query: new URLSearchParams() }, dd)).text();
        const page = Object.fromEntries([...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/gi)].map((m) => [m[1], m[2]]));
        expect(entry, path).toEqual(page);
        expect(Object.keys(page).sort(), path).toEqual(["en", "fr", "x-default"]);
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(8);
  });

  it("a directory page is listed exactly when it is indexable: every country and city page of the world, in both locales", async () => {
    const listed = new Set(await sitemapPaths(deps(gyms)));
    const dd = dirDeps(gyms);
    const reader = worldReader(gyms);
    const pages: string[][] = [[]];
    for (const c of await reader.readCountries()) pages.push([c.countryCode.toLowerCase()]);
    for (const cc of Object.keys(COUNTRY_NAMES)) for (const city of await reader.readCities(cc)) pages.push([cc.toLowerCase(), city.citySlug]);
    let checked = 0;
    for (const segments of pages) {
      for (const locale of ["en", "fr"]) {
        const res = await handleDirectory({ locale, segments, query: new URLSearchParams() }, dd);
        if (res.status !== 200) continue; // a page that is not served (a country with no listed gym) must not be listed either
        checked++;
        const path = `/${[locale, "gyms", ...segments].join("/")}`;
        const indexable = res.headers.get("x-robots-tag") === null;
        expect(listed.has(path), `${path} (indexable: ${indexable})`).toBe(indexable);
      }
    }
    expect(checked).toBeGreaterThanOrEqual(10);
    // and nothing listed is a page that is not served
    for (const p of listed) expect(["/en", "/fr"].includes(p) || (await handleDirectory({ locale: p.split("/")[1]!, segments: p.split("/").slice(3), query: new URLSearchParams() }, dd)).status === 200, p).toBe(true);
  });

  it("the index lists every file, and a file beyond it is the uniform not-found", async () => {
    const d = deps(gyms, { chunkSize: 5 });
    const files = locs(await (await handleCrawl({ kind: "index" }, d)).text());
    expect(files.length).toBeGreaterThan(1);
    for (const f of files) expect((await handleCrawl({ kind: "chunk", file: f.split("/").pop()! }, d)).status, f).toBe(200);
    expect((await handleCrawl({ kind: "chunk", file: `${files.length + 1}.xml` }, d)).status).toBe(404);
  });
});

describe("gate reach: every consumer of the indexable decision is enumerated", () => {
  const landing = fileURLToPath(new URL("../..", import.meta.url));
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      if (f === "node_modules" || f === ".next") return [];
      if (statSync(p).isDirectory()) return sources(p);
      return /\.(ts|tsx)$/.test(f) && !/\.test\.ts$/.test(f) && f !== "testkit.ts" ? [p] : [];
    });
  }
  const files = [...sources(join(landing, "lib")), ...sources(join(landing, "app")), join(landing, "proxy.ts")];
  const using = (re: RegExp) => files.filter((f) => re.test(readFileSync(f, "utf8"))).map((f) => relative(landing, f)).sort();

  it("the country rule is defined once and called by the country page and the sitemap only", () => {
    expect(using(/\bcountryIsIndexable\b/)).toEqual(["lib/crawl/entries.ts", "lib/directory/handler.ts", "lib/directory/indexable.ts"]);
  });
  it("the `indexable` flag is read by the reader, the three pages (handler, headers, markup), the shared rule and the sitemap, and by nothing else", () => {
    expect(using(/\bindexable\b/)).toEqual([
      "lib/crawl/entries.ts",
      "lib/directory/handler.ts",
      "lib/directory/headers.ts",
      "lib/directory/indexable.ts",
      "lib/directory/markup.tsx",
      "lib/directory/types.ts",
      "lib/gym-site/db.ts",
      "lib/gym-site/readerSql.ts",
    ]);
  });
  it("the city flag reaches the sitemap only through the one SQL text (where indexable) and the country rule only through countryIsIndexable", () => {
    const entries = readFileSync(join(landing, "lib/crawl/entries.ts"), "utf8");
    expect(entries).toContain("countryIsIndexable(country, listed)");
    expect(entries).not.toMatch(/\.indexable\b/);
  });
});
