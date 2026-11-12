// Story 25.3: the pieces around the handler: the reader's SQL and mapping, the route, the proxy's bare-path redirect and the Gyms links.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { proxy } from "@/proxy";
import { createReader, type Queryable } from "@/lib/gym-site/db";
import * as sql from "@/lib/gym-site/readerSql";
import { notFoundResponse } from "@/lib/gym-site/notFound";
import { COPY } from "@/lib/copy";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { DIRECTORY_COPY } from "./copy";

const DIRECTORY_SQL = Object.entries(sql).filter(([k]) => k.startsWith("DIRECTORY_")) as [string, string][];

describe("the directory statements (readerSql.ts)", () => {
  it("are the seven reads, each one unnamed statement over the three directory views only", () => {
    expect(DIRECTORY_SQL.map(([k]) => k).sort()).toEqual(
      ["DIRECTORY_CATEGORIES_SQL", "DIRECTORY_CITIES_SQL", "DIRECTORY_CITY_SQL", "DIRECTORY_CITY_TOTALS_SQL", "DIRECTORY_COUNTRIES_SQL", "DIRECTORY_COUNTRY_SQL", "DIRECTORY_GYMS_SQL"],
    );
    for (const [name, text] of DIRECTORY_SQL) {
      expect(text, name).toMatch(/^select /);
      expect(text, name).not.toContain(";");
      expect(text, name).not.toContain("'"); // scripts/public-site-reader-sql.test.sh binds only $1 to $4 and refuses a quote
      const relations = [...text.matchAll(/\b(?:from|join)\s+([a-z_.]+)/g)].map((m) => m[1]);
      for (const r of relations) expect(["public_site.directory_country", "public_site.directory_city", "public_site.directory_gym"], `${name}: ${r}`).toContain(r);
      expect(relations.length, name).toBeGreaterThan(0);
    }
  });
  it("order and page the gyms in SQL: lower(name), page_name, 20 per page", () => {
    expect(sql.DIRECTORY_GYMS_SQL).toContain("order by lower(name), page_name limit 20 offset ($4::integer - 1) * 20");
  });
  it("offer the categories as a plain distinct select", () => {
    expect(sql.DIRECTORY_CATEGORIES_SQL).toBe("select distinct category from public_site.directory_gym where country_code = $1 and city_slug = $2");
  });
  it("select no internal id, banner, hours, plan, contact or position column", () => {
    for (const [name, text] of DIRECTORY_SQL) expect(text, name).not.toMatch(/\b(id|gym_id|city_id|lat|lng|content|banner|hours|plans?|phone|whatsapp)\b/);
  });
});

describe("the reader's directory methods", () => {
  function pool(rows: Record<string, unknown>[]) {
    const calls: [string, unknown[]][] = [];
    const q: Queryable = { query: async (text, values) => (calls.push([text, values]), { rows }) };
    return { calls, reader: createReader(() => q) };
  }
  it("pass the statement and its parameters, and map the rows", async () => {
    const g = pool([{ city_name: "Douala", category: "gym", name: "Grace", page_name: "grace", logo_key: null, total: 21 }]);
    expect(await g.reader.readGyms("CM", "douala", "gym", 2)).toEqual({ rows: [{ cityName: "Douala", category: "gym", name: "Grace", pageName: "grace", logoKey: null }], total: 21 });
    expect(g.calls).toEqual([[sql.DIRECTORY_GYMS_SQL, ["CM", "douala", "gym", 2]]]);

    const c = pool([{ country_code: "CM", name_en: "Cameroon", name_fr: "Cameroun", published_count: 4, indexable: true }]);
    expect(await c.reader.readCountry("CM")).toEqual({ countryCode: "CM", nameEn: "Cameroon", nameFr: "Cameroun", publishedCount: 4, indexable: true });
    expect(c.calls).toEqual([[sql.DIRECTORY_COUNTRY_SQL, ["CM"]]]);
    expect(await c.reader.readCountries()).toHaveLength(1);

    const t = pool([{ country_code: "CM", listed_count: 4 }]);
    expect(await t.reader.readCityTotals()).toEqual([{ countryCode: "CM", listedCount: 4 }]);

    const k = pool([{ city_slug: "douala", city_name: "Douala", published_count: 1, indexable: false }]);
    expect(await k.reader.readCity("CM", "douala")).toEqual({ citySlug: "douala", cityName: "Douala", publishedCount: 1, indexable: false });
    expect(await k.reader.readCities("CM")).toHaveLength(1);

    const cat = pool([{ category: "gym" }, { category: null }, { category: "yoga_studio" }]);
    expect(await cat.reader.readCategories("CM", "douala")).toEqual(["gym", "yoga_studio"]);
  });
  it("absent rows are null, an empty page has total 0", async () => {
    const e = pool([]);
    expect(await e.reader.readCountry("ZZ")).toBeNull();
    expect(await e.reader.readCity("ZZ", "x")).toBeNull();
    expect(await e.reader.readGyms("CM", "douala", null, 9)).toEqual({ rows: [], total: 0 });
  });
});

describe("the route", () => {
  afterEach(() => vi.unstubAllEnvs());
  async function get(url: string, params: { locale: string; path?: string[] }) {
    const route = await import("@/app/[locale]/gyms/[[...path]]/route");
    return route.GET(new Request(url), { params: Promise.resolve(params) });
  }
  it("is a Node, force-dynamic Route Handler", async () => {
    const route = await import("@/app/[locale]/gyms/[[...path]]/route");
    expect(route.runtime).toBe("nodejs");
    expect(route.dynamic).toBe("force-dynamic");
  });
  it("answers the uniform not-found for a locale that is not en or fr, without a database", async () => {
    vi.stubEnv("PUBLIC_SITE_ROOT_DOMAIN", "gymosapps.com");
    vi.stubEnv("PUBLIC_SITE_MEDIA_ORIGIN", "https://media.example.com");
    const res = await get("https://www.gymosapps.com/de/gyms", { locale: "de" });
    const want = notFoundResponse("gymosapps.com");
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(await want.text());
  });
  it("other methods are the uniform not-found", async () => {
    vi.stubEnv("PUBLIC_SITE_ROOT_DOMAIN", "gymosapps.com");
    const route = await import("@/app/[locale]/gyms/[[...path]]/route");
    for (const m of [route.POST, route.PUT, route.PATCH, route.DELETE, route.OPTIONS]) expect(m().status).toBe(404);
  });
});

describe("the proxy: the bare /gyms path (assumption: one 307 by Accept-Language)", () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => vi.stubEnv("PUBLIC_SITE_ROOT_DOMAIN", "gymosapps.com"));
  const req = (host: string, path: string, headers: Record<string, string> = {}) => new NextRequest(`https://${host}${path}`, { headers: { host, ...headers } });
  it("GET /gyms/cm with Accept-Language fr is a 307 to /fr/gyms/cm", () => {
    const res = proxy(req("www.gymosapps.com", "/gyms/cm", { "accept-language": "fr-FR,fr;q=0.9" }));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/fr/gyms/cm");
  });
  it("bare /gyms, a trailing slash (stripped, so Next adds no second hop), deeper paths and the query all redirect once; English is the default", () => {
    for (const [path, want] of [["/gyms", "/en/gyms"], ["/gyms/", "/en/gyms"], ["/gyms/cm/", "/en/gyms/cm"], ["/gyms/cm/douala", "/en/gyms/cm/douala"], ["/gyms/cm/douala?category=gym", "/en/gyms/cm/douala"]] as const) {
      const res = proxy(req("www.gymosapps.com", path));
      expect(res.status, path).toBe(307);
      const loc = new URL(res.headers.get("location")!);
      expect(loc.pathname, path).toBe(want);
      expect(loc.search, path).toBe(path.includes("?") ? "?category=gym" : "");
    }
  });
  it("the apex and a preview host redirect too; a path that merely starts with gyms does not", () => {
    expect(proxy(req("gymosapps.com", "/gyms")).status).toBe(307);
    expect(proxy(req("gym-os-landing.vercel.app", "/gyms/cm")).status).toBe(307);
    expect(proxy(req("www.gymosapps.com", "/gymsx")).headers.get("x-middleware-next")).toBe("1");
    expect(proxy(req("www.gymosapps.com", "/en/gyms")).headers.get("x-middleware-next")).toBe("1");
    expect(proxy(req("www.gymosapps.com", "/en/gyms/cm/douala")).headers.get("x-middleware-next")).toBe("1");
  });
  it("a gym host keeps the 24.10 decision: /gyms is rewritten to the gym page route, never redirected", () => {
    const res = proxy(req("fit.gymosapps.com", "/gyms/cm", { "accept-language": "fr" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-rewrite")).toContain("/gym-site");
    expect(res.headers.get("location")).toBeNull();
    const reserved = proxy(req("mail.gymosapps.com", "/gyms"));
    expect(reserved.headers.get("x-middleware-rewrite")).toContain("/gym-site");
  });
});

describe("the Gyms link on the home page", () => {
  it("is in the dictionary in both languages", () => {
    expect(COPY.en.nav.gyms).toBe("Gyms");
    expect(COPY.fr.nav.gyms).toBe("Salles");
    expect(DIRECTORY_COPY.en.gyms).toBe(COPY.en.nav.gyms);
    expect(DIRECTORY_COPY.fr.gyms).toBe(COPY.fr.nav.gyms);
  });
  it("is a plain link in the header (desktop nav row) and the footer, to /{locale}/gyms", () => {
    for (const locale of ["en", "fr"] as const) {
      const header = renderToStaticMarkup(createElement(SiteHeader, { nav: COPY[locale].nav, locale, contact: { href: "https://wa.me/1", label: "Contact" } }));
      expect(header).toContain(`<a href="/${locale}/gyms" class="inline-flex min-h-11 items-center whitespace-nowrap rounded-lg px-3.5 transition-colors hover:text-on-navy">${COPY[locale].nav.gyms}</a>`);
      const footer = renderToStaticMarkup(createElement(SiteFooter, { copy: COPY[locale], locale }));
      expect(footer).toContain(`href="/${locale}/gyms"`);
      expect(footer).toContain(`${COPY[locale].nav.gyms}</a>`);
    }
  });
});
