// Story 25.5: the pieces around the handler: the two reads (SQL text and mapping), the four routes, and the proxy letting the paths through on `www.`.
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { proxy } from "@/proxy";
import { createReader, type Queryable } from "@/lib/gym-site/db";
import * as sql from "@/lib/gym-site/readerSql";
import { notFoundResponse } from "@/lib/gym-site/notFound";

const CRAWL_SQL = Object.entries(sql).filter(([k]) => k.startsWith("CRAWL_")) as [string, string][];

describe("the crawler statements (readerSql.ts)", () => {
  it("are the two reads, each one unnamed statement over the directory city view or the snapshot view only", () => {
    expect(CRAWL_SQL.map(([k]) => k).sort()).toEqual(["CRAWL_CITIES_SQL", "CRAWL_PAGES_SQL"]);
    const allowed = ["public_site.directory_city", "public_site.pages"];
    for (const [name, text] of CRAWL_SQL) {
      expect(text, name).toMatch(/^select /);
      expect(text, name).not.toContain(";");
      expect(text, name).not.toContain("'"); // scripts/public-site-reader-sql.test.sh binds only $1 to $4 and refuses a quote
      const relations = [...text.matchAll(/\b(?:from|join)\s+([a-z_.]+)/g)].map((m) => m[1]);
      expect(relations, name).toHaveLength(1);
      expect(allowed, name).toContain(relations[0]);
    }
  });
  it("the cities are those whose row says indexable, ordered; the pages are ordered by byte order of the name and limited by a parameter", () => {
    expect(sql.CRAWL_CITIES_SQL).toBe("select country_code, city_slug from public_site.directory_city where indexable order by country_code, city_slug");
    expect(sql.CRAWL_PAGES_SQL).toBe('select name, template, schema_version, content from public_site.pages order by name collate "C" limit $1::integer');
  });
  it("select no internal id, position or contact column", () => {
    for (const [name, text] of CRAWL_SQL) expect(text, name).not.toMatch(/\b(id|gym_id|city_id|lat|lng|phone|whatsapp|published_at|updated_at)\b/);
  });
});

describe("the reader's crawler methods", () => {
  function pool(rows: Record<string, unknown>[]) {
    const calls: [string, unknown[]][] = [];
    const q: Queryable = { query: async (text, values) => (calls.push([text, values]), { rows }) };
    return { calls, reader: createReader(() => q) };
  }
  it("map the indexable cities and send no parameter", async () => {
    const p = pool([{ country_code: "CM", city_slug: "douala" }]);
    expect(await p.reader.readIndexableCities()).toEqual([{ countryCode: "CM", citySlug: "douala" }]);
    expect(p.calls).toEqual([[sql.CRAWL_CITIES_SQL, []]]);
  });
  it("pass the limit and keep the snapshot unparsed", async () => {
    const content = { name: "A" };
    const p = pool([{ name: "grace", template: "classic", schema_version: 1, content }]);
    expect(await p.reader.readLlmsPages(5001)).toEqual([{ name: "grace", template: "classic", schema_version: 1, content }]);
    expect(p.calls).toEqual([[sql.CRAWL_PAGES_SQL, [5001]]]);
  });
  it("share the countries and the city totals with the directory pages", async () => {
    const p = pool([{ country_code: "CM", name_en: "Cameroon", name_fr: "Cameroun", published_count: 4, indexable: true }]);
    expect(await p.reader.readCountries()).toHaveLength(1);
    expect(p.calls[0]![0]).toBe(sql.DIRECTORY_COUNTRIES_SQL);
  });
});

describe("the routes", () => {
  beforeEach(() => {
    vi.stubEnv("PUBLIC_SITE_ROOT_DOMAIN", "gymosapps.com");
    vi.stubEnv("PUBLIC_SITE_MEDIA_ORIGIN", "https://media.example.com");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("each is a Node, force-dynamic Route Handler (never Next's cached sitemap.ts)", async () => {
    for (const route of [await import("@/app/robots.txt/route"), await import("@/app/sitemap-index.xml/route"), await import("@/app/llms.txt/route"), await import("@/app/sitemaps/[file]/route")]) {
      expect(route.runtime).toBe("nodejs");
      expect(route.dynamic).toBe("force-dynamic");
    }
  });
  it("/robots.txt needs no database", async () => {
    const route = await import("@/app/robots.txt/route");
    const res = await route.GET();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("User-agent: *\nAllow: /\n\nSitemap: https://www.gymosapps.com/sitemap-index.xml\n");
  });
  it("with no reader configuration the index, a file and llms.txt are the uniform not-found, logged by code", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const index = await import("@/app/sitemap-index.xml/route");
    const llms = await import("@/app/llms.txt/route");
    const chunk = await import("@/app/sitemaps/[file]/route");
    const want = await notFoundResponse("gymosapps.com").text();
    for (const res of [await index.GET(), await llms.GET(), await chunk.GET(new Request("https://www.gymosapps.com/sitemaps/1.xml"), { params: Promise.resolve({ file: "1.xml" }) })]) {
      expect(res.status).toBe(404);
      expect(await res.text()).toBe(want);
    }
    expect(log.mock.calls.map((c) => JSON.parse(String(c[0])))).toEqual(Array(3).fill({ event: "crawl_db_error", code: "reader_config_missing" }));
    log.mockRestore();
  });
  it("a malformed chunk name never reaches the database", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const chunk = await import("@/app/sitemaps/[file]/route");
    const res = await chunk.GET(new Request("https://www.gymosapps.com/sitemaps/x.xml"), { params: Promise.resolve({ file: "x.xml" }) });
    expect(res.status).toBe(404);
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
  it("other methods are the uniform not-found", async () => {
    for (const route of [await import("@/app/robots.txt/route"), await import("@/app/sitemap-index.xml/route"), await import("@/app/llms.txt/route"), await import("@/app/sitemaps/[file]/route")]) {
      for (const m of [route.POST, route.PUT, route.PATCH, route.DELETE, route.OPTIONS]) expect(m().status).toBe(404);
    }
  });
});

describe("the proxy on www and the apex", () => {
  beforeEach(() => vi.stubEnv("PUBLIC_SITE_ROOT_DOMAIN", "gymosapps.com"));
  afterEach(() => vi.unstubAllEnvs());
  it("passes the four paths through untouched: no rewrite, no redirect", () => {
    for (const host of ["www.gymosapps.com", "gymosapps.com"]) {
      for (const path of ["/robots.txt", "/sitemap-index.xml", "/sitemaps/1.xml", "/llms.txt"]) {
        const res = proxy(new NextRequest(`https://${host}${path}`, { headers: { host } }));
        expect(res.headers.get("x-middleware-next"), `${host}${path}`).toBe("1");
        expect(res.headers.get("x-middleware-rewrite")).toBeNull();
        expect(res.headers.get("location")).toBeNull();
      }
    }
  });
});
