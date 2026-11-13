// Story 25.3: every row of the I/O matrix, the header table, the noindex signal, the Cameroon order, 21-gym paging and the country window.
// The reader is an in-memory world that behaves like the three 25.2 views and the SQL of readerSql.ts (order, filter, 20 per page).
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { CHROME, contentSecurityPolicy, extractStyleBlock, styleHash } from "@gymos/page-templates";
import * as headersModule from "./headers";
import { handleDirectory, parseCategory, parsePage, type DirectoryDeps, type DirectoryRequest } from "./handler";
import { validateJsonLd } from "@gymos/page-templates/src/structuredData.fixtures";
import { notFoundResponse } from "@/lib/gym-site/notFound";
import { DIRECTORY_PAGE_SIZE, type CityRow, type CountryRow, type DirectoryReader, type GymRow, type MapCityRow } from "./types";

const ROOT = "gymosapps.com";
const MEDIA = "https://media.example.com";
const WWW = `https://www.${ROOT}`;

vi.mock("./headers", async (importOriginal) => {
  const real = await importOriginal<typeof import("./headers")>();
  return { ...real, directoryHeaders: vi.fn(real.directoryHeaders) };
});

// ---- the world ----
interface World {
  countries: CountryRow[];
  cities: Record<string, CityRow[]>;
  gyms: Record<string, GymRow[]>;
  /** Story 25.7: rows of directory_city that carry coordinates. */
  mapCities?: MapCityRow[];
  /** Story 25.7: `CC/old-slug` to the current slug, as directory_city_redirect yields it (already filtered by expiry and visibility). */
  redirects?: Record<string, string>;
}
const country = (code: string, nameEn: string, nameFr: string, publishedCount: number, indexable = publishedCount >= 3): CountryRow => ({ countryCode: code, nameEn, nameFr, publishedCount, indexable });
const city = (slug: string, name: string, publishedCount: number, indexable = publishedCount >= 3): CityRow => ({ citySlug: slug, cityName: name, publishedCount, indexable });
const gym = (name: string, over: Partial<GymRow> = {}): GymRow => ({ cityName: "Douala", category: "gym", name, pageName: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "gym", logoKey: null, ...over });
const gyms = (n: number, over: Partial<GymRow> = {}): GymRow[] => Array.from({ length: n }, (_, i) => gym(`Gym ${String(i + 1).padStart(2, "0")}`, { pageName: `gym-${i + 1}`, ...over }));

function reader(w: World, calls: string[] = []): DirectoryReader {
  return {
    async readCountries() {
      calls.push("countries");
      return w.countries;
    },
    async readCountry(cc) {
      calls.push("country");
      return w.countries.find((c) => c.countryCode === cc) ?? null;
    },
    async readCityTotals() {
      calls.push("totals");
      return Object.entries(w.cities).map(([cc, rows]) => ({ countryCode: cc, listedCount: rows.reduce((n, r) => n + r.publishedCount, 0) }));
    },
    async readCities(cc) {
      calls.push("cities");
      return w.cities[cc] ?? [];
    },
    async readCity(cc, slug) {
      calls.push("city");
      return (w.cities[cc] ?? []).find((c) => c.citySlug === slug) ?? null;
    },
    async readCategories(cc, slug) {
      calls.push("categories");
      return [...new Set((w.gyms[`${cc}/${slug}`] ?? []).map((g) => g.category).filter((c): c is string => c !== null))];
    },
    async readGyms(cc, slug, category, page) {
      calls.push(`gyms:${category ?? "-"}:${page}`);
      const all = (w.gyms[`${cc}/${slug}`] ?? []).filter((g) => category === null || g.category === category);
      const sorted = [...all].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.pageName.localeCompare(b.pageName));
      const rows = sorted.slice((page - 1) * DIRECTORY_PAGE_SIZE, page * DIRECTORY_PAGE_SIZE);
      return { rows, total: rows.length ? all.length : 0 };
    },
    async readMapCities() {
      calls.push("mapCities");
      return w.mapCities ?? [];
    },
    async readCitySlugRedirect(cc, slug) {
      calls.push(`redirect:${cc}/${slug}`);
      return w.redirects?.[`${cc}/${slug}`] ?? null;
    },
  };
}

const empty: World = { countries: [], cities: {}, gyms: {} };
// Cameroon with a thin Douala and a full Yaoundé, Senegal with a thin Dakar
const world = (): World => ({
  countries: [country("SN", "Senegal", "Sénégal", 1), country("CM", "Cameroon", "Cameroun", 4), country("CD", "Democratic Republic of the Congo", "République démocratique du Congo", 1)],
  cities: {
    CM: [city("yaounde", "Yaoundé", 3), city("douala", "Douala", 1)],
    SN: [city("dakar", "Dakar", 1)],
    CD: [city("kinshasa", "Kinshasa", 1)],
  },
  gyms: {
    "CM/douala": [gym("Grace Fit", { category: "pilates_studio" })],
    "CM/yaounde": [gym("Alpha Box", { cityName: "Yaoundé" }), gym("beta yoga", { cityName: "Yaoundé", category: "yoga_studio", logoKey: "00000001-aaaa-4bbb-8ccc-000000000001.webp" }), gym("Gamma", { cityName: "Yaoundé" })],
    "SN/dakar": [gym("Teranga", { cityName: "Dakar" })],
    "CD/kinshasa": [gym("Kin Fit", { cityName: "Kinshasa" })],
  },
});

function deps(w: World, over: Partial<DirectoryDeps> = {}, calls: string[] = []): DirectoryDeps & { logs: [string, unknown][] } {
  const logs: [string, unknown][] = [];
  return { config: { rootDomain: ROOT, mediaOrigin: MEDIA, reportKey: undefined }, reader: reader(w, calls), log: (e, f) => logs.push([e, f]), ...over, logs };
}

const ask = (d: DirectoryDeps, locale: string, segments: string[] = [], query = ""): Promise<Response> =>
  handleDirectory({ locale, segments, query: new URLSearchParams(query) } satisfies DirectoryRequest, d);
const page = async (d: DirectoryDeps, locale: string, segments: string[] = [], query = "") => {
  const res = await ask(d, locale, segments, query);
  return { res, html: await res.text() };
};
const snapshot = async (r: Response) => ({ status: r.status, headers: [...r.headers.entries()].sort(), body: await r.text() });
const noindexMeta = (html: string) => /<meta name="robots" content="noindex"\/>/.test(html);
const headerOf = (res: Response, name: string) => res.headers.get(name);
/** Story 25.4: executable script stays banned; the only `<script` allowed is ONE inert application/ld+json block whose text is JSON with no literal `<`. `blocks` is how many are expected (0 or 1). */
function expectLdJsonBlocks(html: string, blocks: 0 | 1): void {
  expect([...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0])).toEqual(blocks ? ['<script type="application/ld+json">'] : []);
  expect(html.match(/<\/script>/g) ?? []).toHaveLength(blocks);
  for (const m of html.matchAll(/<script type="application\/ld\+json">([^]*?)<\/script>/g)) {
    expect(m[1]).not.toMatch(/[<>&]/);
    expect(() => JSON.parse(m[1]!)).not.toThrow();
  }
}
const ldJson = (html: string): Record<string, unknown> => JSON.parse(/<script type="application\/ld\+json">([^]*?)<\/script>/.exec(html)![1]!);
const ogOf = (html: string): Record<string, string> => {
  const unescape = (v: string) => v.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  return Object.fromEntries([...html.matchAll(/<meta property="(og:[a-z:]+)" content="([^"]*)">/g)].map((m) => [m[1]!, unescape(m[2]!)]));
};
const titleOf = (html: string) => /<title>([^]*?)<\/title>/.exec(html)![1]!.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const h2s = (html: string) => [...html.matchAll(/<h2>([^<]*)<\/h2>/g)].map((m) => m[1]!);

describe("parsing", () => {
  it("category: one known code, else ignored (unknown, repeated, empty)", () => {
    expect(parseCategory(new URLSearchParams("category=yoga_studio"))).toBe("yoga_studio");
    expect(parseCategory(new URLSearchParams("category=nonsense"))).toBeNull();
    expect(parseCategory(new URLSearchParams("category=gym&category=other"))).toBeNull();
    expect(parseCategory(new URLSearchParams("category="))).toBeNull();
    expect(parseCategory(new URLSearchParams("category=constructor"))).toBeNull();
    expect(parseCategory(new URLSearchParams(""))).toBeNull();
  });
  it("page: a positive integer, else 1", () => {
    for (const [q, n] of [["page=2", 2], ["page=x", 1], ["page=0", 1], ["page=-3", 1], ["page=2.5", 1], ["page=02", 1], ["page=", 1], ["", 1], ["page=99999999999", 1]] as const) {
      expect(parsePage(new URLSearchParams(q)), q).toBe(n);
    }
  });
});

describe("matrix: nothing published", () => {
  it("/en/gyms is 200, shows the empty message, is indexable and lists nothing", async () => {
    const { res, html } = await page(deps(empty), "en");
    expect(res.status).toBe(200);
    expect(html).toContain("No gyms are listed yet.");
    expect(html).not.toContain('class="cards"');
    expect(headerOf(res, "x-robots-tag")).toBeNull();
    expect(noindexMeta(html)).toBe(false);
    expect(html).toContain("<h1>Find a gym <span");
  });
  it("French empty message", async () => {
    const { html } = await page(deps(empty), "fr");
    expect(html).toContain("Aucune salle n&#x27;est encore répertoriée.");
    expect(html).toContain('<html lang="fr">');
  });
});

describe("matrix: Cameroon plus another country", () => {
  it("Cameroon first, the rest by localized name, all on the same card", async () => {
    const { html } = await page(deps(world()), "en");
    expect(h2s(html)).toEqual(["Cameroon", "Democratic Republic of the Congo", "Senegal"]);
    const fr = await page(deps(world()), "fr");
    expect(h2s(fr.html)).toEqual(["Cameroun", "République démocratique du Congo", "Sénégal"]);
  });
  it("collation follows the locale: an accented name sorts with its base letter", async () => {
    const w = world();
    w.countries.push(country("ET", "Ethiopia", "Éthiopie", 1), country("GA", "Gabon", "Gabon", 1));
    w.cities.ET = [city("addis", "Addis", 1)];
    w.cities.GA = [city("libreville", "Libreville", 1)];
    const fr = await page(deps(w), "fr");
    expect(h2s(fr.html)).toEqual(["Cameroun", "Éthiopie", "Gabon", "République démocratique du Congo", "Sénégal"]);
  });
  it("the Cameroon card has the same markup as any other card (no badge, no extra wording)", async () => {
    const { html } = await page(deps(world()), "en");
    const cards = [...html.matchAll(/<li class="card">([^]*?)<\/li>/g)].map((m) => m[1]!);
    expect(cards).toHaveLength(3);
    const shape = (c: string) => c.replace(/href="[^"]*"/, 'href=""').replace(/<h2>[^<]*<\/h2>/, "<h2></h2>").replace(/<p>[^<]*<\/p>/, "<p></p>");
    expect(shape(cards[0]!)).toBe(shape(cards[1]!));
    expect(shape(cards[1]!)).toBe(shape(cards[2]!));
    expect(html).not.toMatch(/Douala|Yaound|Franc|XAF|Afri/i);
  });
  it("cards and the count sentence use S, the sum of the city rows", async () => {
    const w = world();
    w.countries[1]!.publishedCount = 99; // the country view disagrees (refresh window)
    const { html } = await page(deps(w), "en");
    expect(html).toContain("4 gyms</p>"); // Cameroon: 3 + 1 from the city rows
    expect(html).not.toContain("99 gyms");
    expect(html).toContain("6 gyms in 3 countries");
  });
  it("the count sentence is a sentence with plural forms in both languages", async () => {
    const w: World = { countries: [country("SN", "Senegal", "Sénégal", 1)], cities: { SN: [city("dakar", "Dakar", 1)] }, gyms: {} };
    expect((await page(deps(w), "en")).html).toContain("1 gym in 1 country");
    expect((await page(deps(w), "fr")).html).toContain("1 salle dans 1 pays");
    expect((await page(deps(world()), "fr")).html).toContain("6 salles dans 3 pays");
  });
});

describe("matrix: country page and the country window", () => {
  it("lists the cities with counts, links to the city pages, in order of name", async () => {
    const { res, html } = await page(deps(world()), "en", ["cm"]);
    expect(res.status).toBe(200);
    expect(h2s(html)).toEqual(["Douala", "Yaoundé"]);
    expect(html).toContain('href="/en/gyms/cm/douala"');
    expect(html).toContain("4 gyms in 2 cities");
    expect(html).toContain('<h1>Gyms in <span class="accent">Cameroon</span></h1>');
    expect(html).toContain("<title>Gyms in Cameroon | GymOS</title>");
  });
  it("is indexable when the country view and the rows agree and the flag is set", async () => {
    const { res, html } = await page(deps(world()), "en", ["cm"]);
    expect(headerOf(res, "x-robots-tag")).toBeNull();
    expect(noindexMeta(html)).toBe(false);
  });
  it("is noindex when the views disagree (S != the country count), without a second copy of the threshold", async () => {
    const w = world();
    w.countries[1] = country("CM", "Cameroon", "Cameroun", 5, true); // country view says 5, the rows add to 4
    const { res, html } = await page(deps(w), "en", ["cm"]);
    expect(res.status).toBe(200);
    expect(headerOf(res, "x-robots-tag")).toBe("noindex");
    expect(noindexMeta(html)).toBe(true);
    expect(html).toContain("4 gyms in 2 cities"); // the count is S
  });
  it("is noindex when the country view's own flag is false (a thin country)", async () => {
    const { res, html } = await page(deps(world()), "en", ["sn"]);
    expect(headerOf(res, "x-robots-tag")).toBe("noindex");
    expect(noindexMeta(html)).toBe(true);
  });
  it("S = 0: not listed on the top page and the URL is the uniform not-found", async () => {
    const w = world();
    w.countries.push(country("KE", "Kenya", "Kenya", 2)); // the country view counts gyms, the city rows list none
    const top = await page(deps(w), "en");
    expect(h2s(top.html)).not.toContain("Kenya");
    expect(top.html).not.toContain("Kenya");
    const res = await ask(deps(w), "en", ["ke"]);
    expect(await snapshot(res)).toEqual(await snapshot(notFoundResponse(ROOT)));
  });
  it("city rows for a country the country view does not know are neither listed nor served", async () => {
    const w = world();
    w.cities.NG = [city("lagos", "Lagos", 2)];
    expect((await page(deps(w), "en")).html).not.toContain("Lagos");
    expect((await ask(deps(w), "en", ["ng"])).status).toBe(404);
  });
});

describe("matrix: city page", () => {
  it("lists gyms ordered by name, with category label, city, canonical subdomain link, monogram or logo", async () => {
    const { res, html } = await page(deps(world()), "en", ["cm", "yaounde"]);
    expect(res.status).toBe(200);
    expect(h2s(html)).toEqual(["Alpha Box", "beta yoga", "Gamma"]);
    expect(html).toContain('href="https://alpha-box.gymosapps.com/"');
    expect(html).toContain("Gym · Yaoundé");
    expect(html).toContain("Yoga Studio · Yaoundé");
    expect(html).toContain(`src="${MEDIA}/storage/v1/object/public/gym-page-media/00000001-aaaa-4bbb-8ccc-000000000001.webp"`);
    // the h2 in the same link names the gym, so the logo is decorative
    expect(html).toContain('alt=""');
    expect(html).not.toContain('alt="beta yoga"');
    expect(html).toContain('<span class="mono" aria-hidden="true">A</span>');
    expect(html).toContain("3 gyms in Yaoundé");
    expect(html).toContain('<h1>Gyms in <span class="accent">Yaoundé</span></h1>');
  });
  it("French labels", async () => {
    const { html } = await page(deps(world()), "fr", ["cm", "yaounde"]);
    expect(html).toContain("Studio Yoga · Yaoundé");
    expect(html).toContain("Salle de sport · Yaoundé");
    expect(html).toContain("3 salles à Yaoundé");
    expect(html).toContain('<h1>Salles à <span class="accent">Yaoundé</span></h1>');
    expect(html).toContain('aria-label="Fil d&#x27;Ariane"');
  });
  it("shows no banner, hours, plans or contact: only name, category, city and logo reach the markup", async () => {
    const { html } = await page(deps(world()), "en", ["cm", "yaounde"]);
    expect(html).not.toMatch(/banner|opening hours|plans|tel:|wa\.me|whatsapp/i);
  });
  it("a gym whose logo key is not a media key gets the monogram, never a URL", async () => {
    const w = world();
    w.gyms["CM/douala"] = [gym("Grace Fit", { logoKey: "../../evil.png" })];
    const { html } = await page(deps(w), "en", ["cm", "douala"]);
    expect(html).not.toContain("evil");
    expect(html).toContain('class="mono"');
  });
  it("a thin city: same markup, noindex in the meta tag and X-Robots-Tag", async () => {
    const thin = await page(deps(world()), "en", ["cm", "douala"]);
    expect(thin.res.status).toBe(200);
    expect(headerOf(thin.res, "x-robots-tag")).toBe("noindex");
    expect(noindexMeta(thin.html)).toBe(true);
    // a visitor sees the same page: no "few results" wording
    expect(thin.html).not.toMatch(/few|thin|only \d/i);
    const full = await page(deps(world()), "en", ["cm", "yaounde"]);
    expect(headerOf(full.res, "x-robots-tag")).toBeNull();
    expect(noindexMeta(full.html)).toBe(false);
  });
  it("unknown city, unknown country, a city of another country: the uniform not-found", async () => {
    for (const segs of [["cm", "nowhere"], ["zz", "douala"], ["sn", "douala"], ["cm", "yaounde", "extra"]]) {
      expect(await snapshot(await ask(deps(world()), "en", segs)), segs.join("/")).toEqual(await snapshot(notFoundResponse(ROOT)));
    }
  });
});

describe("matrix: category filter", () => {
  const filtered = () => page(deps(world()), "en", ["cm", "yaounde"], "category=yoga_studio");
  it("shows only that category; the canonical is the unfiltered listing; no noindex even for a thin city", async () => {
    const { res, html } = await filtered();
    expect(h2s(html)).toEqual(["beta yoga"]);
    expect(html).toContain(`<link rel="canonical" href="${WWW}/en/gyms/cm/yaounde"/>`);
    expect(noindexMeta(html)).toBe(false);
    expect(headerOf(res, "x-robots-tag")).toBeNull();
    const thin = await page(deps(world()), "en", ["cm", "douala"], "category=pilates_studio");
    expect(thin.res.status).toBe(200);
    expect(headerOf(thin.res, "x-robots-tag")).toBeNull();
    expect(noindexMeta(thin.html)).toBe(false);
    expect(thin.html).toContain(`<link rel="canonical" href="${WWW}/en/gyms/cm/douala"/>`);
  });
  it("offers pills for present categories only; the current one has aria-current and a check glyph", async () => {
    const { html } = await filtered();
    const nav = html.match(/<nav aria-label="Categories">[^]*?<\/nav>/)![0];
    expect(nav).toContain('href="/en/gyms/cm/yaounde">All</a>');
    expect(nav).toContain('href="/en/gyms/cm/yaounde?category=gym">Gym</a>');
    expect(nav).toContain('href="/en/gyms/cm/yaounde?category=yoga_studio" aria-current="page"><span aria-hidden="true">✓</span>Yoga Studio</a>');
    expect(nav).not.toContain("Pilates");
    expect(nav).not.toContain("Fitness");
    expect(nav.match(/aria-current/g)).toHaveLength(1);
  });
  it("the count sentence of a filtered view is the filtered total, the unfiltered view keeps the city count", async () => {
    const filteredView = await filtered();
    expect(filteredView.html).toContain("1 gym in Yaoundé");
    expect(filteredView.html).not.toContain("3 gyms in Yaoundé");
    const all = await page(deps(world()), "en", ["cm", "yaounde"]);
    expect(all.html).toContain("3 gyms in Yaoundé");
    const stale = await page(deps(world()), "en", ["cm", "yaounde"], "category=fitness_center");
    expect(stale.html).toContain("0 gyms in Yaoundé");
    expect(stale.html).toContain("No gyms listed under Fitness Center in Yaoundé yet.");
    const gym = await page(deps(world()), "en", ["cm", "yaounde"], "category=gym");
    expect(gym.html).not.toContain("No gyms listed under Gym");
  });
  it("a city with its country's name keeps both breadcrumb entries", async () => {
    const w = world();
    w.countries.push(country("SG", "Singapore", "Singapour", 1));
    w.cities.SG = [city("singapore", "Singapore", 1)];
    w.gyms["SG/singapore"] = [gym("Lion Fit", { cityName: "Singapore" })];
    const { html } = await page(deps(w), "en", ["sg", "singapore"]);
    const nav = html.match(/<nav class="crumbs"[^]*?<\/nav>/)![0];
    expect(nav.match(/<li>/g)).toHaveLength(3);
    expect(nav).toContain('<a href="/en/gyms/sg">Singapore</a>');
    expect(nav).toContain('<span aria-current="page">Singapore</span>');
  });
  it("with no filter, All is the current pill", async () => {
    const { html } = await page(deps(world()), "en", ["cm", "yaounde"]);
    expect(html).toMatch(/aria-current="page"><span aria-hidden="true">✓<\/span>All<\/a>/);
  });
  it("an unknown or repeated category is ignored: the unfiltered view with an unfiltered canonical", async () => {
    for (const q of ["category=nonsense", "category=gym&category=yoga_studio", "category="]) {
      const { res, html } = await page(deps(world()), "en", ["cm", "yaounde"], q);
      expect(res.status, q).toBe(200);
      expect(h2s(html), q).toHaveLength(3);
      expect(html, q).toContain(`<link rel="canonical" href="${WWW}/en/gyms/cm/yaounde"/>`);
    }
    // a thin city stays noindex when the filter is ignored
    const thin = await page(deps(world()), "en", ["cm", "douala"], "category=nonsense");
    expect(headerOf(thin.res, "x-robots-tag")).toBe("noindex");
  });
  it("a valid category with no gym in the city: the PS-06 text and a show-all link, in both languages", async () => {
    const en = await page(deps(world()), "en", ["cm", "yaounde"], "category=fitness_center");
    expect(en.res.status).toBe(200);
    expect(en.html).toContain("No gyms listed under Fitness Center in Yaoundé yet.");
    expect(en.html).toContain('<a href="/en/gyms/cm/yaounde">Show all gyms in Yaoundé</a>');
    expect(h2s(en.html)).toEqual([]);
    expect(headerOf(en.res, "x-robots-tag")).toBeNull();
    const fr = await page(deps(world()), "fr", ["cm", "yaounde"], "category=fitness_center");
    expect(fr.html).toContain("Aucune salle répertoriée dans la catégorie Centre de fitness à Yaoundé pour l&#x27;instant.");
    expect(fr.html).toContain("Voir toutes les salles à Yaoundé");
  });
  it("category labels come from the chrome dictionary", () => {
    expect(CHROME.en.categories.yoga_studio).toBe("Yoga Studio");
  });
});

describe("matrix: 21 gyms", () => {
  const w = (): World => ({ countries: [country("CM", "Cameroon", "Cameroun", 21)], cities: { CM: [city("douala", "Douala", 21)] }, gyms: { "CM/douala": gyms(21) } });
  it("20 on page 1 with numbered links; ?page=2 shows 1", async () => {
    const p1 = await page(deps(w()), "en", ["cm", "douala"]);
    expect(h2s(p1.html)).toHaveLength(20);
    const pager = p1.html.match(/<nav class="pager"[^]*?<\/nav>/)![0];
    expect(pager).toContain('href="/en/gyms/cm/douala" aria-label="Page 1" aria-current="page">1</a>');
    expect(pager).toContain('href="/en/gyms/cm/douala?page=2" aria-label="Page 2">2</a>');
    expect(pager).not.toContain("?page=3");
    expect(p1.html).toContain(`<link rel="canonical" href="${WWW}/en/gyms/cm/douala"/>`);
    const p2 = await page(deps(w()), "en", ["cm", "douala"], "page=2");
    expect(h2s(p2.html)).toEqual(["Gym 21"]);
    // page 2 is self-canonical
    expect(p2.html).toContain(`<link rel="canonical" href="${WWW}/en/gyms/cm/douala?page=2"/>`);
    expect(p2.html).toContain('aria-label="Page 2" aria-current="page">2</a>');
  });
  it("?page=3 is the uniform not-found; ?page=x is page 1", async () => {
    expect(await snapshot(await ask(deps(w()), "en", ["cm", "douala"], "page=3"))).toEqual(await snapshot(notFoundResponse(ROOT)));
    const x = await page(deps(w()), "en", ["cm", "douala"], "page=x");
    expect(x.res.status).toBe(200);
    expect(h2s(x.html)).toHaveLength(20);
  });
  it("20 gyms or fewer: no pager", async () => {
    const world20: World = { ...w(), gyms: { "CM/douala": gyms(20) } };
    const { html } = await page(deps(world20), "en", ["cm", "douala"]);
    expect(html).not.toContain('class="pager"');
  });
  it("a filtered view pages inside the filter, and its canonical is unfiltered without page", async () => {
    const mixed: World = { ...w(), gyms: { "CM/douala": [...gyms(21, { category: "yoga_studio" }), gym("Zed")] } };
    const p2 = await page(deps(mixed), "en", ["cm", "douala"], "category=yoga_studio&page=2");
    expect(h2s(p2.html)).toEqual(["Gym 21"]);
    expect(p2.html).toContain(`<link rel="canonical" href="${WWW}/en/gyms/cm/douala"/>`);
    expect(p2.html).toContain('href="/en/gyms/cm/douala?category=yoga_studio&amp;page=2"');
    expect(headerOf(p2.res, "x-robots-tag")).toBeNull();
  });
  it("a page past the last of a filtered view is not-found", async () => {
    const mixed: World = { ...w(), gyms: { "CM/douala": [...gyms(3, { category: "yoga_studio" }), gym("Zed")] } };
    expect((await ask(deps(mixed), "en", ["cm", "douala"], "category=yoga_studio&page=2")).status).toBe(404);
  });
});

describe("matrix: removed gym", () => {
  it("a gym that leaves the world is absent from the page, the count and the cards on the next read", async () => {
    const w = world();
    const before = await page(deps(w), "en", ["cm", "yaounde"]);
    expect(before.html).toContain("Gamma");
    w.gyms["CM/yaounde"] = w.gyms["CM/yaounde"]!.filter((g) => g.name !== "Gamma");
    w.cities.CM![0] = city("yaounde", "Yaoundé", 2);
    w.countries[1] = country("CM", "Cameroon", "Cameroun", 3);
    const after = await page(deps(w), "en", ["cm", "yaounde"]);
    expect(after.html).not.toContain("Gamma");
    expect(after.html).toContain("2 gyms in Yaoundé");
    expect(headerOf(after.res, "x-robots-tag")).toBe("noindex"); // now thin
    const top = await page(deps(w), "en");
    expect(top.html).toContain("3 gyms</p>");
  });
});

describe("matrix: unknown place and locale", () => {
  it("/en/gyms/zz, /de/gyms, /en/gyms/CM and malformed segments are the uniform not-found", async () => {
    const nf = await snapshot(notFoundResponse(ROOT));
    const calls: string[] = [];
    for (const [locale, segs] of [["en", ["zz"]], ["de", []], ["en", ["CM"]], ["en", ["cmr"]], ["en", ["c"]], ["en", ["cm", "Douala"]], ["en", ["cm", "dou ala"]], ["en", ["cm", "a--b"]], ["en", ["cm", "x".repeat(61)]], ["EN", []], ["en", ["cm", "douala", "x", "y"]]] as const) {
      expect(await snapshot(await ask(deps(world(), {}, calls), locale, [...segs])), `${locale}/${segs.join("/")}`).toEqual(nf);
    }
    // a malformed place never reaches the database
    expect(calls.filter((c) => c === "city")).toHaveLength(0);
  });
});

describe("matrix: hostile text", () => {
  it("a gym name is escaped text, never markup", async () => {
    const w = world();
    w.gyms["CM/douala"] = [gym("</script><img src=x onerror=alert(1)>", { pageName: "hostile", cityName: "<b>Douala</b>" })];
    const { html } = await page(deps(w), "en", ["cm", "douala"]);
    expectLdJsonBlocks(html, 1);
    expect(html).not.toContain("</script><img");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&lt;b&gt;Douala&lt;/b&gt;");
    // and in an attribute
    w.gyms["CM/douala"] = [gym('"><script>1</script>', { pageName: "hostile2", logoKey: "00000001-aaaa-4bbb-8ccc-000000000001.webp" })];
    const attr = await page(deps(w), "en", ["cm", "douala"]);
    expectLdJsonBlocks(attr.html, 1);
    expect(attr.html).toContain('alt=""');
    expect(attr.html).toContain("&quot;&gt;&lt;script&gt;1&lt;/script&gt;");
  });
  it("a hostile city or country name is escaped in the breadcrumb, title and heading", async () => {
    const w = world();
    w.cities.CM![1] = city("douala", "<script>x</script>", 1);
    w.countries[1] = country("CM", "<i>Cameroon</i>", "<i>Cameroun</i>", 4);
    const { html } = await page(deps(w), "en", ["cm", "douala"]);
    expectLdJsonBlocks(html, 1);
    expect(html).not.toContain("<i>");
  });
  it("a gym with an invalid page name is dropped (no link to a malformed host)", async () => {
    const w = world();
    w.gyms["CM/douala"] = [gym("Bad", { pageName: "-evil.example.com/" }), gym("Good", { pageName: "good" })];
    const { html } = await page(deps(w), "en", ["cm", "douala"]);
    expect(html).not.toContain("evil");
    expect(h2s(html)).toEqual(["Good"]);
  });
});

describe("canonical, hreflang and the language link", () => {
  it("are built from the configured origin, never from the request host; http for localhost", async () => {
    const { html } = await page(deps(world()), "fr", ["cm", "yaounde"]);
    expect(html).toContain(`<link rel="canonical" href="${WWW}/fr/gyms/cm/yaounde"/>`);
    expect(html).toContain(`<link rel="alternate" hrefLang="en" href="${WWW}/en/gyms/cm/yaounde"/>`);
    expect(html).toContain(`hrefLang="fr" href="${WWW}/fr/gyms/cm/yaounde"`);
    expect(html).toContain(`hrefLang="x-default" href="${WWW}/en/gyms/cm/yaounde"`);
    const local = deps(world(), { config: { rootDomain: "localhost:3200", mediaOrigin: MEDIA, reportKey: undefined } });
    const l = await page(local, "en", ["cm", "yaounde"]);
    expect(l.html).toContain('<link rel="canonical" href="http://www.localhost:3200/en/gyms/cm/yaounde"/>');
    expect(l.html).toContain('href="http://alpha-box.localhost:3200/"');
  });
  it("the language link keeps the path and the effective query in the other locale, written in that language", async () => {
    const top = await page(deps(world()), "en");
    expect(top.html).toContain(`<a class="chip" href="${WWW}/fr/gyms" lang="fr" hrefLang="fr">Français</a>`);
    const city = await page(deps(world()), "fr", ["cm", "yaounde"], "category=gym&page=1&junk=1");
    expect(city.html).toContain(`href="${WWW}/en/gyms/cm/yaounde?category=gym" lang="en" hrefLang="en">English</a>`);
  });
  it("the top and country pages have a self canonical and the three alternates", async () => {
    const top = await page(deps(world()), "en");
    expect(top.html).toContain(`<link rel="canonical" href="${WWW}/en/gyms"/>`);
    expect(top.html).toContain(`hrefLang="x-default" href="${WWW}/en/gyms"`);
    const c = await page(deps(world()), "fr", ["cm"]);
    expect(c.html).toContain(`<link rel="canonical" href="${WWW}/fr/gyms/cm"/>`);
    expect(c.html).toContain(`hrefLang="en" href="${WWW}/en/gyms/cm"`);
  });
  it("breadcrumbs: plain links to the parents, the current page is not a link", async () => {
    const { html } = await page(deps(world()), "en", ["cm", "yaounde"]);
    const nav = html.match(/<nav class="crumbs"[^]*?<\/nav>/)![0];
    expect(nav).toContain('<a href="/en/gyms">Gyms</a>');
    expect(nav).toContain('<a href="/en/gyms/cm">Cameroon</a>');
    expect(nav).toContain('<span aria-current="page">Yaoundé</span>');
  });
  it("the home page link and the Gyms link point at the locale's pages", async () => {
    const { html } = await page(deps(world()), "fr", ["cm"]);
    expect(html).toContain('<a class="brand" href="/fr" aria-label="Accueil GymOS">GymOS</a>');
    expect(html).toContain('<a href="/fr/gyms">Salles</a>');
  });
});

describe("the document", () => {
  it("has landmarks, one h1, a skip link first, a lang, and the hero keeps its column for the map", async () => {
    const { html } = await page(deps(world()), "en");
    expect(html.startsWith("<!doctype html><html lang=\"en\">")).toBe(true);
    expect(html.match(/<h1>/g)).toHaveLength(1);
    expect(html.match(/<header /g)).toHaveLength(1);
    expect(html.match(/<main /g)).toHaveLength(1);
    expect(html.match(/<footer /g)).toHaveLength(1);
    expect(html.indexOf('class="skip"')).toBeLessThan(html.indexOf("<header"));
    expect(html).toContain('class="hero hero-top has-map"');
    expect(html).toContain(".hero-top .hero-copy{max-width:50%}");
  });
  it("is script-free: no script element, no style attribute, no handler attribute, no external URL but the media origin", async () => {
    const all = [
      await page(deps(world()), "en"),
      await page(deps(world()), "fr", ["cm"]),
      await page(deps(world()), "en", ["cm", "yaounde"], "category=yoga_studio"),
    ];
    for (const { html } of all) {
      expect(html).not.toMatch(/<script(?![^>]*type="application\/ld\+json")/i);
      expect([...html.matchAll(/<script\b/gi)].length).toBeLessThanOrEqual(1);
      expect(html).not.toMatch(/\sstyle=/i);
      expect(html).not.toMatch(/\son[a-z]+=/i);
      expect(html).not.toMatch(/<iframe|<form|<link rel="(stylesheet|preload|prefetch)"/i);
      const external = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => new URL(m[1]!).origin);
      for (const o of external) expect([MEDIA, WWW].includes(o) || o.endsWith(`.${ROOT}`), o).toBe(true);
    }
  });
  it("carries the 400-weight/800 fonts from its own origin only", async () => {
    const { html } = await page(deps(world()), "en");
    const fonts = [...html.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1]);
    expect(fonts).toEqual(["/fonts/bricolage-grotesque-800.woff2", "/fonts/figtree-variable.woff2"]);
    expect(html).toContain("font-display:swap");
  });
  it("every font URL in the CSS is a real, non-empty woff2 file under public/", async () => {
    const { html } = await page(deps(world()), "en");
    const urls = [...html.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1]!);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      const file = new URL(`../../public${url}`, import.meta.url);
      const bytes = readFileSync(file); // throws when the file was renamed or deleted
      expect(bytes.length, url).toBeGreaterThan(1000);
      expect(bytes.subarray(0, 4).toString("latin1"), `${url} is not a woff2 file`).toBe("wOF2");
    }
  });
  it("uses the tokens of the main site: navy hero, 76 px cards, 80 px rows, 44 px targets", async () => {
    const { html } = await page(deps(world()), "en");
    for (const token of ["#0F1B2D", "min-height:76px", "min-height:80px", "min-height:44px", "width:48px;height:48px", "grid-template-columns:repeat(3"]) expect(html).toContain(token);
    // no motion but the map's halo (opacity only, under no-preference); no transition anywhere
    expect(html).not.toMatch(/transition/);
    expect(html.match(/animation/g)).toHaveLength(1);
    expect(html).toContain("@media (prefers-reduced-motion:no-preference){.map-halo{animation:halo 2.6s ease-in-out infinite}}");
  });
});

describe("hero texture (owner review 2026-11-13)", () => {
  const TEXTURE = ".top{background-color:#0F1B2D;background-image:radial-gradient(60% 90% at 12% 0%,rgba(224,151,31,.1),rgba(224,151,31,0) 70%),linear-gradient(to bottom,rgba(15,27,45,0) 35%,#0F1B2D 100%),radial-gradient(circle,rgba(255,255,255,.08) 1.2px,transparent 1.7px);background-size:auto,auto,28px 28px;color:#FFFFFF}";
  it("the navy band of the top, country and city pages carries the glow and the dot grid, in CSS only", async () => {
    for (const segments of [[], ["cm"], ["cm", "douala"]]) {
      const { html } = await page(deps(world()), "en", segments);
      expect(html, segments.join("/") || "top").toContain(TEXTURE);
      expect(html.match(/<header class="top on-navy">/g)).toHaveLength(1);
      // the CSP allows no image, so the texture is gradients: the only url() calls in the page are the two self-hosted fonts
      expect([...html.matchAll(/url\(([^)]*)\)/g)].map((m) => m[1])).toEqual(["/fonts/bricolage-grotesque-800.woff2", "/fonts/figtree-variable.woff2"]);
      expect(html).not.toMatch(/<style[^>]*>[^]*data:/);
    }
  });
  it("stays faint: the dots are at most 8 % white and the glow at most 10 % accent (read from the rendered page), so text contrast on the navy is unchanged", async () => {
    const { html } = await page(deps(world()), "en");
    const rule = /\.top\{[^}]*\}/.exec(html)![0];
    const layers = [...rule.matchAll(/rgba\((\d+),(\d+),(\d+),(\.?\d+(?:\.\d+)?)\)/g)].map((m) => ({ rgb: m.slice(1, 4).join(","), a: Number(m[4]) }));
    const max = (rgb: string) => Math.max(0, ...layers.filter((l) => l.rgb === rgb).map((l) => l.a));
    expect(layers.length).toBeGreaterThan(0);
    expect(max("255,255,255")).toBeGreaterThan(0);
    expect(max("255,255,255")).toBeLessThanOrEqual(0.08);
    expect(max("224,151,31")).toBeGreaterThan(0);
    expect(max("224,151,31")).toBeLessThanOrEqual(0.1);
    expect(layers.every((l) => ["255,255,255", "224,151,31", "15,27,45"].includes(l.rgb))).toBe(true);
  });
});

describe("card chevron (owner review 2026-11-13)", () => {
  it("is two CSS borders on an empty aria-hidden span, not a font glyph and not an SVG", async () => {
    const { html } = await page(deps(world()), "en");
    expect(html).toContain('<span class="arrow" aria-hidden="true"></span>');
    expect(html).toContain(".arrow{flex:none;width:10px;height:10px;margin-right:6px;border-top:2.5px solid #BA6500;border-right:2.5px solid #BA6500;transform:rotate(45deg)}");
    expect(html).not.toContain("→");
    // the country page lists cities with the same cards and still has no <svg> (the 25.7 "no map elsewhere" rule)
    const country = await page(deps(world()), "en", ["cm"]);
    expect(country.html).toContain('<span class="arrow" aria-hidden="true"></span>');
    expect(country.html).not.toContain("<svg");
  });
});

describe("headers: every outcome goes through the one function", () => {
  type Outcome = { name: string; run: () => Promise<Response>; expect: "page" | "notFound"; indexable?: boolean };
  const w21: World = { countries: [country("CM", "Cameroon", "Cameroun", 21)], cities: { CM: [city("douala", "Douala", 21)] }, gyms: { "CM/douala": gyms(21) } };
  const throwing: DirectoryReader = { ...reader(world()), readCountries: async () => { throw Object.assign(new Error("connection string with secret"), { code: "53300" }); } };
  const outcomes: Outcome[] = [
    { name: "top", run: () => ask(deps(world()), "en"), expect: "page", indexable: true },
    { name: "top, French", run: () => ask(deps(world()), "fr"), expect: "page", indexable: true },
    { name: "top, empty", run: () => ask(deps(empty), "en"), expect: "page", indexable: true },
    { name: "country", run: () => ask(deps(world()), "en", ["cm"]), expect: "page", indexable: true },
    { name: "country, thin", run: () => ask(deps(world()), "en", ["sn"]), expect: "page", indexable: false },
    { name: "city", run: () => ask(deps(world()), "en", ["cm", "yaounde"]), expect: "page", indexable: true },
    { name: "city, thin", run: () => ask(deps(world()), "en", ["cm", "douala"]), expect: "page", indexable: false },
    { name: "filtered", run: () => ask(deps(world()), "en", ["cm", "douala"], "category=pilates_studio"), expect: "page", indexable: true },
    { name: "filtered, stale", run: () => ask(deps(world()), "en", ["cm", "yaounde"], "category=fitness_center"), expect: "page", indexable: true },
    { name: "paged", run: () => ask(deps(w21), "en", ["cm", "douala"], "page=2"), expect: "page", indexable: true },
    { name: "paged beyond the last", run: () => ask(deps(w21), "en", ["cm", "douala"], "page=3"), expect: "notFound" },
    { name: "bad locale", run: () => ask(deps(world()), "de"), expect: "notFound" },
    { name: "unknown country", run: () => ask(deps(world()), "en", ["zz"]), expect: "notFound" },
    { name: "unknown city", run: () => ask(deps(world()), "en", ["cm", "zz"]), expect: "notFound" },
    { name: "database error", run: () => ask(deps(world(), { reader: throwing }), "en"), expect: "notFound" },
    { name: "no media origin", run: () => ask(deps(world(), { config: { rootDomain: ROOT, mediaOrigin: undefined, reportKey: undefined } }), "en"), expect: "notFound" },
    { name: "no root domain", run: () => ask(deps(world(), { config: { rootDomain: undefined, mediaOrigin: MEDIA, reportKey: undefined } }), "en"), expect: "notFound" },
    { name: "render error", run: () => ask(deps(world(), { renderToStaticMarkup: () => { throw new TypeError("boom"); } }), "en"), expect: "notFound" },
    { name: "a document without a style block", run: () => ask(deps(world(), { renderToStaticMarkup: () => "<html><head></head><body></body></html>" }), "en"), expect: "notFound" },
    { name: "a document with two style blocks", run: () => ask(deps(world(), { renderToStaticMarkup: () => "<html><head><style>a{}</style><style>b{}</style></head><body></body></html>" }), "en"), expect: "notFound" },
    { name: "a document without a </head> (nowhere to inject the tags)", run: () => ask(deps(world(), { renderToStaticMarkup: () => "<html><body>no head</body></html>" }), "en"), expect: "notFound" },
  ];
  const headerFn = vi.mocked(headersModule.directoryHeaders);

  for (const o of outcomes) {
    it(`${o.name}`, async () => {
      headerFn.mockClear();
      const res = await o.run();
      if (o.expect === "notFound") {
        expect(headerFn).not.toHaveBeenCalled();
        expect(await snapshot(res)).toEqual(await snapshot(notFoundResponse(o.name === "no root domain" ? undefined : ROOT)));
        return;
      }
      expect(res.status).toBe(200);
      expect(headerFn).toHaveBeenCalledTimes(1);
      const html = await res.text();
      const style = extractStyleBlock(html);
      expect(style.ok).toBe(true);
      const given = headerFn.mock.calls[0]![0];
      expect(given).toEqual({ mediaOrigin: MEDIA, styleText: style.ok ? style.text : "", indexable: o.indexable });
      // the response carries exactly the function's output, nothing else, nothing less
      expect(Object.fromEntries(res.headers.entries())).toEqual(Object.fromEntries(Object.entries(headerFn.mock.results[0]!.value as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])));
      // one flag: the meta tag and the header together
      expect(noindexMeta(html)).toBe(!o.indexable);
      expect(headerOf(res, "x-robots-tag")).toBe(o.indexable ? null : "noindex");
    });
  }

  it("the header table (exact)", async () => {
    const res = await ask(deps(world()), "en", ["cm", "douala"]);
    const html = await res.text();
    const hash = styleHash(extractStyleBlock(html).ok ? (extractStyleBlock(html) as { text: string }).text : "");
    expect(Object.fromEntries(res.headers.entries())).toEqual({
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, s-maxage=60",
      "content-security-policy": contentSecurityPolicy(MEDIA, hash),
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      "strict-transport-security": "max-age=63072000; includeSubDomains",
      "x-robots-tag": "noindex",
    });
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("content-security-policy")).toBe(
      `default-src 'none'; img-src ${MEDIA}; style-src '${hash}'; font-src 'self'; connect-src 'none'; script-src 'none'; base-uri 'none'; form-action 'self'; object-src 'none'; frame-ancestors 'none'`,
    );
  });
  it("s-maxage is at most 300 and no response sets a cookie", async () => {
    for (const o of outcomes) {
      const res = await o.run();
      expect(res.headers.get("set-cookie"), o.name).toBeNull();
      const max = Number(/s-maxage=(\d+)/.exec(res.headers.get("cache-control") ?? "")?.[1]);
      expect(max, o.name).toBeLessThanOrEqual(300);
    }
  });
  it("every non-200 outcome logs no data: a database error logs the code only", async () => {
    const d = deps(world(), { reader: throwing });
    await ask(d, "en");
    expect(d.logs).toEqual([["directory_db_error", { code: "53300" }]]);
    expect(JSON.stringify(d.logs)).not.toContain("secret");
    const r = deps(world(), { renderToStaticMarkup: () => { throw new TypeError("gym name leaked"); } });
    await ask(r, "en");
    expect(r.logs).toEqual([["directory_render_error", { name: "TypeError" }]]);
  });
  it("a style-block failure logs directory_style_block with the count; a missing </head> logs directory_render_error", async () => {
    const log = async (html: string) => {
      const d = deps(world(), { renderToStaticMarkup: () => html });
      await ask(d, "en");
      return d.logs;
    };
    expect(await log("<html><head></head><body></body></html>")).toEqual([["directory_style_block", { count: 0 }]]);
    expect(await log("<html><head><style>a{}</style><style>b{}</style></head><body></body></html>")).toEqual([["directory_style_block", { count: 2 }]]);
    expect(await log("<html><body>no head</body></html>")).toEqual([["directory_render_error", { name: "Error" }]]);
  });
  it("a world that reads only the directory views: the reader interface has no other read (25.7 added the map and the old-slug reads)", () => {
    expect(Object.keys(reader(world())).sort()).toEqual(["readCategories", "readCities", "readCity", "readCitySlugRedirect", "readCityTotals", "readCountries", "readCountry", "readGyms", "readMapCities"]);
  });
});

// ---- Story 25.4: structured data and Open Graph on every directory page ----
describe("structured data: ItemList and Open Graph", () => {
  const w21: World = { countries: [country("CM", "Cameroon", "Cameroun", 21)], cities: { CM: [city("douala", "Douala", 21)] }, gyms: { "CM/douala": gyms(21) } };
  const emptyCity: World = { countries: [country("CM", "Cameroon", "Cameroun", 3)], cities: { CM: [city("yaounde", "Yaoundé", 3), city("douala", "Douala", 0)] }, gyms: { "CM/yaounde": gyms(3) } };
  const metaDescription = (html: string) => /<meta name="description" content="([^"]*)"/.exec(html)![1]!.replace(/&amp;/g, "&").replace(/&#x27;/g, "'");
  const canonical = (html: string) => /<link rel="canonical" href="([^"]+)"/.exec(html)![1]!;

  it("a city page lists each shown gym at its canonical subdomain URL with positions 1..n in order", async () => {
    const { html } = await page(deps(world()), "en", ["cm", "yaounde"]);
    expectLdJsonBlocks(html, 1);
    const j = ldJson(html);
    expect(validateJsonLd(j, "ItemList")).toEqual([]);
    expect(j).toEqual({
      "@context": "https://schema.org",
      "@type": "ItemList",
      itemListElement: [
        { "@type": "ListItem", position: 1, url: `https://alpha-box.${ROOT}/`, name: "Alpha Box" },
        { "@type": "ListItem", position: 2, url: `https://beta-yoga.${ROOT}/`, name: "beta yoga" },
        { "@type": "ListItem", position: 3, url: `https://gamma.${ROOT}/`, name: "Gamma" },
      ],
    });
  });

  it("21 gyms, page 2: one ListItem at position 21; page 1: 20 items", async () => {
    const p2 = await page(deps(w21), "en", ["cm", "douala"], "page=2");
    expect(validateJsonLd(ldJson(p2.html), "ItemList", { firstPosition: 21 })).toEqual([]);
    expect(ldJson(p2.html).itemListElement).toEqual([{ "@type": "ListItem", position: 21, url: `https://gym-21.${ROOT}/`, name: "Gym 21" }]);
    const p1 = await page(deps(w21), "en", ["cm", "douala"]);
    expect(ldJson(p1.html).itemListElement).toHaveLength(20);
    expect(validateJsonLd(ldJson(p1.html), "ItemList")).toEqual([]);
  });

  it("a filtered view lists the filtered rows", async () => {
    const { html } = await page(deps(world()), "en", ["cm", "yaounde"], "category=yoga_studio");
    expect((ldJson(html).itemListElement as { name: string }[]).map((i) => i.name)).toEqual(["beta yoga"]);
  });

  it("a hostile gym name is a JSON string: escaped in the block, JSON.parse returns the original", async () => {
    const name = "</script><img src=x onerror=alert(1)> & \"q\"";
    const w = world();
    w.gyms["CM/douala"] = [gym(name, { pageName: "hostile" })];
    const { html } = await page(deps(w), "en", ["cm", "douala"]);
    expectLdJsonBlocks(html, 1);
    expect((ldJson(html).itemListElement as { name: string }[])[0]!.name).toBe(name);
    expect(html.match(/<\/script>/g)).toHaveLength(1);
  });

  it("a gym with an invalid page name is not in the list; positions follow the shown rows", async () => {
    const w = world();
    w.gyms["CM/douala"] = [gym("Bad", { pageName: "-evil.example.com/" }), gym("Good", { pageName: "good" })];
    const { html } = await page(deps(w), "en", ["cm", "douala"]);
    expect(ldJson(html).itemListElement).toEqual([{ "@type": "ListItem", position: 1, url: `https://good.${ROOT}/`, name: "Good" }]);
  });

  // The consumer list: every directory outcome that is a page. A new outcome added here is judged without touching the checks.
  const consumers: { name: string; run: () => Promise<Response>; items: number | null }[] = [
    { name: "top", run: () => ask(deps(world()), "en"), items: null },
    { name: "top, French", run: () => ask(deps(world()), "fr"), items: null },
    { name: "top, empty", run: () => ask(deps(empty), "en"), items: null },
    { name: "country", run: () => ask(deps(world()), "en", ["cm"]), items: null },
    { name: "country, French, thin", run: () => ask(deps(world()), "fr", ["sn"]), items: null },
    { name: "city", run: () => ask(deps(world()), "en", ["cm", "yaounde"]), items: 3 },
    { name: "city, French, thin", run: () => ask(deps(world()), "fr", ["cm", "douala"]), items: 1 },
    { name: "filtered", run: () => ask(deps(world()), "en", ["cm", "douala"], "category=pilates_studio"), items: 1 },
    { name: "filtered, stale (no gym in the category)", run: () => ask(deps(world()), "en", ["cm", "yaounde"], "category=fitness_center"), items: null },
    { name: "paged, page 1", run: () => ask(deps(w21), "en", ["cm", "douala"]), items: 20 },
    { name: "paged, page 2", run: () => ask(deps(w21), "en", ["cm", "douala"], "page=2"), items: 1 },
    { name: "empty city", run: () => ask(deps(emptyCity), "en", ["cm", "douala"]), items: null },
  ];
  for (const c of consumers) {
    it(`${c.name}: the og tags are present and match the page, ${c.items === null ? "no ItemList" : `an ItemList of ${c.items}`}`, async () => {
      const res = await c.run();
      expect(res.status).toBe(200);
      const html = await res.text();
      const og = ogOf(html);
      expect(og["og:type"]).toBe("website");
      expect(og["og:title"]).toBe(titleOf(html));
      expect(og["og:description"]).toBe(metaDescription(html));
      expect(og["og:url"]).toBe(canonical(html));
      expect(og["og:url"].startsWith(`${WWW}/`)).toBe(true);
      expect(og).not.toHaveProperty("og:image");
      expect(Object.keys(og).sort()).toEqual(["og:description", "og:title", "og:type", "og:url"]);
      expectLdJsonBlocks(html, c.items === null ? 0 : 1);
      if (c.items !== null) expect(ldJson(html).itemListElement).toHaveLength(c.items);
    });
  }

  it("the CSP and header strings are unchanged by the block", async () => {
    const res = await ask(deps(world()), "en", ["cm", "yaounde"]);
    const html = await res.text();
    const hash = styleHash((extractStyleBlock(html) as { text: string }).text);
    expect(res.headers.get("content-security-policy")).toBe(contentSecurityPolicy(MEDIA, hash));
    expect(res.headers.get("content-security-policy")).toContain("script-src 'none'");
  });

  it("og tags carry hostile text as escaped attribute values", async () => {
    const w = world();
    w.cities.CM![1] = city("douala", 'A"B<i>&\'', 1);
    const { html } = await page(deps(w), "en", ["cm", "douala"]);
    expect(html).toContain("&quot;");
    expect(html).not.toContain('content="A"B');
    expect(ogOf(html)["og:title"]).toBe(titleOf(html));
  });
});

// ---- Story 25.7: the Africa map on the top page and the 301 from an old city slug ----
describe("Africa map (25.7)", () => {
  const mapCity = (countryCode: string, citySlug: string, cityName: string, lat: number, lng: number, publishedCount: number): MapCityRow => ({ countryCode, citySlug, cityName, lat, lng, publishedCount });
  // Douala (1 gym) and Yaoundé (3) in Cameroon, Dakar (1) in Senegal; Kinshasa (CD) has a gym but no coordinates
  const mapWorld = (): World => ({
    ...world(),
    mapCities: [mapCity("CM", "douala", "Douala", 4.0511, 9.7679, 1), mapCity("CM", "yaounde", "Yaoundé", 3.848, 11.5021, 3), mapCity("SN", "dakar", "Dakar", 14.7167, -17.4677, 1)],
  });
  const svgOf = (html: string) => /<svg[^]*?<\/svg>/.exec(html)![0];
  // the visible dots (layer 2) and the 44-unit hit zones (layer 1): two links per city, both to the same page
  const linksOf = (html: string, cls: string) => [...svgOf(html).matchAll(/<a [^>]*>/g)].map((m) => m[0]).filter((l) => l.endsWith(`class="${cls}">`));
  const dotLinks = (html: string) => linksOf(html, "map-dot");
  const zoneLinks = (html: string) => linksOf(html, "map-zone");

  it("normal: one dot per city with coordinates, each a root-relative tabindex=-1 link; the SVG is aria-hidden; countries with a gym use the lit fill", async () => {
    const { res, html } = await page(deps(mapWorld()), "en");
    expect(res.status).toBe(200);
    expect(html).toContain('<figure class="map">');
    // from 1024 px the map runs down into the light band; main makes room so the first card row is not covered
    expect(html).toContain('<main id="content" class="after-map">');
    expect(html).toContain("main.after-map{padding-top:104px}");
    expect(html).toMatch(/<svg class="map-svg" viewBox="0 0 760 \d+" aria-hidden="true" focusable="false">/);
    expect(dotLinks(html)).toEqual([
      '<a href="/en/gyms/cm/yaounde" tabindex="-1" class="map-dot">',
      '<a href="/en/gyms/cm/douala" tabindex="-1" class="map-dot">',
      '<a href="/en/gyms/sn/dakar" tabindex="-1" class="map-dot">',
    ]);
    // the dots: radius 5 + 3.2 sqrt(gyms), capped at 20 (map.test.ts)
    expect([...svgOf(html).matchAll(/<circle class="map-pt" cx="[\d.]+" cy="[\d.]+" r="([\d.]+)"/g)].map((m) => m[1])).toEqual(["10.54", "8.2", "8.2"]);
    // the hit circle is transparent (CSS fill); the attribute is 44 view-box units, and the CSS `r` rules below raise it on small screens (the CSS-px size at 320, 360
    // and 390 px is the recorded trade-off in decisions.md, not computed here)
    expect(svgOf(html).match(/class="map-hit"[^>]* r="44"/g)).toHaveLength(3);
    expect(html).toContain("@media (max-width:640px){.map-label{display:none}.map-hit{r:56px}}");
    const lit = [...svgOf(html).matchAll(/<path d="[^"]*" class="lit"/g)];
    expect(lit).toHaveLength(3); // CM, SN, CD have a listed gym
    expect(html).toContain("Each dot is a city with gyms. Larger means more gyms.");
    // the caption describes an aria-hidden SVG, so it is hidden from assistive technology too (it stays visible)
    expect(html).toContain('<figcaption aria-hidden="true">Each dot is a city with gyms. Larger means more gyms.</figcaption>');
    expect(html).toContain("@media (max-width:360px){.map-hit{r:72px}}");
    // the country cards link to the country pages, from which the cities are reachable
    expect(html).toContain('href="/en/gyms/cm"');
    expect(html).toContain('href="/en/gyms/sn"');
  });
  it("the label (city name and count) is CSS-only, hidden under 640 px; the halo breathes only under no-preference reduced motion", async () => {
    const { html } = await page(deps(mapWorld()), "en");
    expect(svgOf(html)).toContain('<text class="map-label"');
    expect(svgOf(html)).toContain(">Douala · 1 gym</text>");
    expect(svgOf(html)).toContain(">Yaoundé · 3 gyms</text>");
    expect(html).toContain(".map-zone:hover .map-label,.map-zone:focus .map-label,.map-zone:focus-visible .map-label,.map-dot:hover .map-label,.map-dot:focus .map-label,.map-dot:focus-visible .map-label{opacity:1}");
    expect(html).toContain("@media (max-width:640px){.map-label{display:none}");
    expect(html).toContain("@media (prefers-reduced-motion:no-preference){.map-halo{animation:halo 2.6s ease-in-out infinite}}");
    expect(html).toContain(".map-halo{fill:#E0971F;opacity:.22;pointer-events:none}");
    expect(html).toContain(".map-pt{fill:#E0971F;stroke:#0F1B2D;stroke-width:2;vector-effect:non-scaling-stroke}");
    expect(html).toContain(".map-land path{fill:#17253B;stroke:#0F1B2D");
    expect(html).toContain(".map-land .lit{fill:#2B4163}");
    expect(html).toContain("min-width:1024px");
    expect(html).toContain("margin:0 0 -112px"); // 64 px into the light band (the hero's 48 px foot padding is cancelled)
  });
  it("a dot's own body wins its own click: every hit zone is drawn before every visible dot, and each zone links to the same page as its dot", async () => {
    const { html } = await page(deps(mapWorld()), "en");
    const svg = svgOf(html);
    expect(zoneLinks(html).map((l) => /href="([^"]*)"/.exec(l)![1])).toEqual(dotLinks(html).map((l) => /href="([^"]*)"/.exec(l)![1]));
    expect(zoneLinks(html)).toHaveLength(3);
    // no circle of a dot body (halo or point) before the last hit circle, so no zone can lie on top of a body
    const lastHit = svg.lastIndexOf('class="map-hit"');
    expect(lastHit).toBeGreaterThan(-1);
    expect(svg.indexOf('class="map-halo"')).toBeGreaterThan(lastHit);
    expect(svg.indexOf('class="map-pt"')).toBeGreaterThan(lastHit);
    // the zone carries a label too, so hovering the space around a dot shows the name
    expect(svg.match(/>Douala · 1 gym<\/text>/g)).toHaveLength(2);
    // the halo does not take clicks (it is wider than its dot and would cover a neighbour)
    expect(html).toContain("pointer-events:none}");
  });
  it("the label's text-anchor grows toward the inside of the map, and a dot near the top edge gets its label below it", async () => {
    const w = mapWorld();
    w.countries.push(country("SO", "Somalia", "Somalie", 1), country("TN", "Tunisia", "Tunisie", 1));
    w.cities.SO = [city("mogadishu", "Mogadishu", 1)];
    w.cities.TN = [city("tunis", "Tunis", 1)];
    w.mapCities!.push(mapCity("SO", "mogadishu", "Mogadishu", 2.0469, 45.3182, 1), mapCity("TN", "tunis", "Tunis", 36.8065, 10.1815, 1));
    const { html } = await page(deps(w), "en");
    const svg = svgOf(html);
    const labelOf = (name: string) => [...svg.matchAll(/<text class="map-label" x="[\d.]+" y="([\d.]+)" text-anchor="(\w+)">([^<]*)<\/text>/g)].filter((m) => m[3]!.startsWith(name)).map((m) => ({ y: Number(m[1]), anchor: m[2] }));
    const dotOf = (name: string, href: string) => {
      const m = new RegExp(`href="${href}"[^>]*class="map-dot"><circle class="map-halo"[^>]*></circle><circle class="map-pt" cx="[\\d.]+" cy="([\\d.]+)" r="([\\d.]+)"`).exec(svg)!;
      return { cy: Number(m[1]), r: Number(m[2]), name };
    };
    for (const l of labelOf("Dakar")) expect(l.anchor).toBe("start");
    for (const l of labelOf("Mogadishu")) expect(l.anchor).toBe("end");
    for (const l of labelOf("Douala")) expect(l.anchor).toBe("middle");
    expect(labelOf("Dakar")).toHaveLength(2);
    expect(labelOf("Mogadishu")).toHaveLength(2);
    // placement: above the dot, or below it when the dot is within 40 units of the top edge
    const tunis = dotOf("Tunis", "/en/gyms/tn/tunis");
    expect(tunis.cy).toBeLessThan(40);
    for (const l of labelOf("Tunis")) expect(l.y).toBeCloseTo(tunis.cy + tunis.r + 22, 5);
    const douala = dotOf("Douala", "/en/gyms/cm/douala");
    expect(douala.cy).toBeGreaterThanOrEqual(40);
    for (const l of labelOf("Douala")) expect(l.y).toBeCloseTo(douala.cy - douala.r - 10, 5);
  });
  it("AD-44: one style block, no style attribute, no script, nothing external, no style/image/href-to-elsewhere inside the SVG", async () => {
    for (const locale of ["en", "fr"]) {
      const { res, html } = await page(deps(mapWorld()), locale);
      expect(html.match(/<style/g)).toHaveLength(1);
      expect(html).not.toMatch(/\sstyle=/i);
      expect(html).not.toMatch(/<script/i);
      const svg = svgOf(html);
      expect(svg).not.toMatch(/<style|<image|<use|<foreignObject|xlink:href|https?:/i);
      for (const m of svg.matchAll(/href="([^"]*)"/g)) expect(m[1]).toMatch(/^\/(en|fr)\/gyms\/[a-z]{2}\/[a-z0-9-]+$/);
      expect(res.headers.get("content-security-policy")).toContain("script-src 'none'");
      expect(res.headers.get("content-security-policy")).toContain(`style-src '${styleHash((extractStyleBlock(html) as { text: string }).text)}'`);
    }
  });
  it("French caption and links, from the same data", async () => {
    const { html } = await page(deps(mapWorld()), "fr");
    expect(html).toContain("Chaque point est une ville qui compte des salles. Plus grand, plus de salles.");
    expect(dotLinks(html)[0]).toContain('href="/fr/gyms/cm/yaounde"');
    expect(svgOf(html)).toContain(">Yaoundé · 3 salles</text>");
  });
  it("a city without coordinates has no dot but stays listed and counted", async () => {
    const { html } = await page(deps(mapWorld()), "en");
    expect(dotLinks(html).some((l) => l.includes("kinshasa"))).toBe(false);
    expect(html).toContain("Democratic Republic of the Congo");
    expect(html).toContain("6 gyms in 3 countries");
  });
  it("a country off the map is in the cards and the count, with no dot and no fill", async () => {
    const w = mapWorld();
    w.countries.push(country("FR", "France", "France", 1));
    w.cities.FR = [city("paris", "Paris", 1)];
    w.mapCities!.push(mapCity("FR", "paris", "Paris", 48.8566, 2.3522, 1));
    const { html } = await page(deps(w), "en");
    expect(html).toContain("<h2>France</h2>");
    expect(html).toContain("7 gyms in 4 countries");
    expect(dotLinks(html)).toHaveLength(3);
    expect(svgOf(html)).not.toContain("paris");
    expect([...svgOf(html).matchAll(/class="lit"/g)]).toHaveLength(3);
  });
  it("the dot position is the city's own, never a gym's: the gym rows carry no coordinates and the reader's map read is the only one", async () => {
    const calls: string[] = [];
    await page(deps(mapWorld(), {}, calls), "en");
    expect(calls.filter((c) => c === "mapCities")).toHaveLength(1);
    expect(calls).not.toContain("gyms:-:1");
  });
  it("nothing published: the empty message and no map markup (no figure, no svg, no hero column, no map CSS class on the hero)", async () => {
    const { res, html } = await page(deps({ ...empty, mapCities: [mapCity("CM", "douala", "Douala", 4.0511, 9.7679, 1)] }), "en");
    expect(res.status).toBe(200);
    expect(html).toContain("No gyms are listed yet.");
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("<figure");
    expect(html).not.toContain('hero-top has-map"');
    expect(html).not.toContain('class="after-map"');
    expect(html).toContain('<main id="content">');
  });
  it("no map on a country page or a city page", async () => {
    for (const segments of [["cm"], ["cm", "yaounde"], ["cm", "douala"]]) {
      const { html } = await page(deps(mapWorld()), "en", segments);
      expect(html, segments.join("/")).not.toContain("<svg");
      expect(html, segments.join("/")).not.toContain("<figure");
      expect(html, segments.join("/")).not.toContain('has-map"');
    }
  });
  it("the map read failing is a database error: the uniform not-found, logged like any other read", async () => {
    const d = deps(mapWorld(), { reader: { ...reader(mapWorld()), readMapCities: async () => { throw Object.assign(new Error("secret"), { code: "57014" }); } } });
    const res = await ask(d, "en");
    expect(await snapshot(res)).toEqual(await snapshot(notFoundResponse(ROOT)));
    expect(d.logs).toEqual([["directory_db_error", { code: "57014" }]]);
  });
});

describe("old city slug redirects (25.7)", () => {
  const renamed = (): World => ({ ...world(), redirects: { "CM/old-douala": "douala" } });
  const notFoundSnap = async () => snapshot(notFoundResponse(ROOT));

  it("a renamed city's old slug is one 301 to the current slug on the constant www origin, with an empty body and the cache bound", async () => {
    const res = await ask(deps(renamed()), "en", ["cm", "old-douala"]);
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(`${WWW}/en/gyms/cm/douala`);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300, s-maxage=300");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("strict-transport-security")).toBe("max-age=63072000; includeSubDomains");
    expect(await res.text()).toBe("");
    expect(res.headers.get("set-cookie")).toBeNull();
  });
  it("keeps the locale, drops the query string, and never takes the origin from the request", async () => {
    const res = await ask(deps(renamed()), "fr", ["cm", "old-douala"], "category=gym&page=2&x=https://evil.example");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(`${WWW}/fr/gyms/cm/douala`);
  });
  it("the Cache-Control is the shared constant and at most five minutes", async () => {
    const { REDIRECT_CACHE_CONTROL } = await import("@gymos/page-templates");
    const res = await ask(deps(renamed()), "en", ["cm", "old-douala"]);
    expect(res.headers.get("cache-control")).toBe(REDIRECT_CACHE_CONTROL);
    expect(Number(/s-maxage=(\d+)/.exec(REDIRECT_CACHE_CONTROL)![1])).toBeLessThanOrEqual(300);
  });
  it("the localhost scheme follows the configured root domain, like every other directory URL", async () => {
    const res = await ask(deps(renamed(), { config: { rootDomain: "localhost", mediaOrigin: MEDIA, reportKey: undefined } }), "en", ["cm", "old-douala"]);
    expect(res.headers.get("location")).toBe("http://www.localhost/en/gyms/cm/douala");
  });
  it("expired, never a slug, or a current city with no visible gym: the reader yields no row and the answer is the uniform not-found, byte for byte", async () => {
    const want = await notFoundSnap();
    for (const slug of ["expired-slug", "never-a-slug", "old-unpublished"]) {
      const res = await ask(deps(renamed()), "en", ["cm", slug]);
      expect(await snapshot(res), slug).toEqual(want);
    }
  });
  it("a redirect for a country with no such city is still the uniform not-found", async () => {
    expect(await snapshot(await ask(deps(renamed()), "en", ["zz", "old-douala"]))).toEqual(await notFoundSnap());
  });
  it("a stored slug that is not a valid city segment (or is the requested slug itself) is never put into a Location header", async () => {
    const want = await notFoundSnap();
    for (const bad of ["Bad Slug", "a/../b", "x\r\nSet-Cookie: a=b", "-x", "x".repeat(61), "", "old-douala"]) {
      const res = await ask(deps({ ...world(), redirects: { "CM/old-douala": bad } }), "en", ["cm", "old-douala"]);
      expect(await snapshot(res), JSON.stringify(bad)).toEqual(want);
    }
  });
  it("a city that exists is never redirected, and the redirect read is not made for it", async () => {
    const calls: string[] = [];
    const res = await ask(deps({ ...world(), redirects: { "CM/douala": "yaounde" } }, {}, calls), "en", ["cm", "douala"]);
    expect(res.status).toBe(200);
    expect(calls.some((c) => c.startsWith("redirect:"))).toBe(false);
  });
  it("a page past the last of an existing city is the not-found, not a redirect lookup", async () => {
    const calls: string[] = [];
    const w21: World = { countries: [country("CM", "Cameroon", "Cameroun", 21)], cities: { CM: [city("douala", "Douala", 21)] }, gyms: { "CM/douala": gyms(21) }, redirects: { "CM/douala": "yaounde" } };
    const res = await ask(deps(w21, {}, calls), "en", ["cm", "douala"], "page=3");
    expect(await snapshot(res)).toEqual(await notFoundSnap());
    expect(calls.some((c) => c.startsWith("redirect:"))).toBe(false);
  });
  it("a reader error on the redirect read is the uniform not-found, logged as directory_db_error", async () => {
    const d = deps(renamed(), { reader: { ...reader(renamed()), readCitySlugRedirect: async () => { throw Object.assign(new Error("secret"), { code: "53300" }); } } });
    expect(await snapshot(await ask(d, "en", ["cm", "old-douala"]))).toEqual(await notFoundSnap());
    expect(d.logs).toEqual([["directory_db_error", { code: "53300" }]]);
  });
  it("the redirect lookup uses the upper-case country code and the exact old slug", async () => {
    const calls: string[] = [];
    await ask(deps(renamed(), {}, calls), "en", ["cm", "old-douala"]);
    expect(calls).toContain("redirect:CM/old-douala");
  });
  it("the country and top pages never redirect", async () => {
    const r = { ...renamed(), redirects: { "CM/old-douala": "douala", "ZZ/": "x" } };
    expect((await ask(deps(r), "en", ["zz"])).status).toBe(404);
    expect((await ask(deps(r), "en")).status).toBe(200);
  });
});
