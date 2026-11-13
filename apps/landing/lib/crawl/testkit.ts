// Story 25.5 (tests only): an in-memory world that answers the reads of the directory pages AND of the crawler files the way the 25.2 views and the SQL of
// readerSql.ts do, from one list of visible gyms. Removing a gym from the list is "unpublish, takedown or suspension": every count, flag and row follows.
// Not imported by any route or handler.
import { baseContent } from "@gymos/page-templates/src/conformance/fixtures";
import type { PageContentSnapshotV1 } from "@gymos/types";
import { DIRECTORY_PAGE_SIZE, type CityRow, type CountryRow, type CrawlReader, type DirectoryReader, type GymRow, type LlmsPageRow } from "@/lib/directory/types";

/** The threshold of the views (private.directory_indexable_min). */
export const THIN = 3;

export interface WorldGym {
  pageName: string;
  name: string;
  /** The city's country (upper-case alpha-2): what `directory_city` groups by. */
  country: string;
  citySlug: string;
  cityName: string;
  category?: string;
  /** The country the gym's snapshot says (`directory_country` counts by it). Default: the city's country. */
  snapshotCountry?: string;
  /** Overrides on the snapshot the page is rendered from. */
  content?: Partial<PageContentSnapshotV1>;
}

export const COUNTRY_NAMES: Record<string, [string, string]> = {
  CM: ["Cameroon", "Cameroun"],
  SN: ["Senegal", "Sénégal"],
  CD: ["Democratic Republic of the Congo", "République démocratique du Congo"],
  NG: ["Nigeria", "Nigéria"],
};

export const gym = (pageName: string, country: string, citySlug: string, over: Partial<WorldGym> = {}): WorldGym => ({
  pageName,
  name: pageName.toUpperCase(),
  country,
  citySlug,
  cityName: citySlug.charAt(0).toUpperCase() + citySlug.slice(1),
  category: "gym",
  ...over,
});

/** `n` gyms in one city. */
export const gymsIn = (country: string, citySlug: string, n: number, over: Partial<WorldGym> = {}): WorldGym[] =>
  Array.from({ length: n }, (_, i) => gym(`${country.toLowerCase()}-${citySlug}-${i + 1}`, country, citySlug, over));

export function snapshotOf(g: WorldGym): PageContentSnapshotV1 {
  return { ...baseContent(), name: g.name, city: g.cityName, country: g.snapshotCountry ?? g.country, ...(g.category ? { category: g.category as "gym" } : {}), ...g.content };
}

type Reader = DirectoryReader & CrawlReader;

export function worldReader(gyms: readonly WorldGym[], calls: string[] = []): Reader {
  const cityRows = () => {
    const m = new Map<string, CityRow & { countryCode: string }>();
    for (const g of gyms) {
      const key = `${g.country}/${g.citySlug}`;
      const row = m.get(key) ?? { countryCode: g.country, citySlug: g.citySlug, cityName: g.cityName, publishedCount: 0, indexable: false };
      row.publishedCount += 1;
      row.indexable = row.publishedCount >= THIN;
      m.set(key, row);
    }
    return [...m.values()];
  };
  const countryRows = (): CountryRow[] => {
    const m = new Map<string, number>();
    for (const g of gyms) m.set(g.snapshotCountry ?? g.country, (m.get(g.snapshotCountry ?? g.country) ?? 0) + 1);
    return [...m.entries()]
      .filter(([code]) => COUNTRY_NAMES[code])
      .map(([code, n]) => ({ countryCode: code, nameEn: COUNTRY_NAMES[code]![0], nameFr: COUNTRY_NAMES[code]![1], publishedCount: n, indexable: n >= THIN }));
  };
  const rowOf = (g: WorldGym): GymRow => ({ cityName: g.cityName, category: g.category ?? null, name: g.name, pageName: g.pageName, logoKey: null });
  return {
    async readCountries() {
      calls.push("countries");
      return countryRows();
    },
    async readCountry(cc) {
      calls.push("country");
      return countryRows().find((c) => c.countryCode === cc) ?? null;
    },
    async readCityTotals() {
      calls.push("totals");
      const m = new Map<string, number>();
      for (const c of cityRows()) m.set(c.countryCode, (m.get(c.countryCode) ?? 0) + c.publishedCount);
      return [...m.entries()].map(([countryCode, listedCount]) => ({ countryCode, listedCount }));
    },
    async readCities(cc) {
      calls.push("cities");
      return cityRows().filter((c) => c.countryCode === cc);
    },
    async readCity(cc, slug) {
      calls.push("city");
      return cityRows().find((c) => c.countryCode === cc && c.citySlug === slug) ?? null;
    },
    async readCategories(cc, slug) {
      calls.push("categories");
      return [...new Set(gyms.filter((g) => g.country === cc && g.citySlug === slug).map((g) => g.category).filter((c): c is string => Boolean(c)))];
    },
    async readGyms(cc, slug, category, page) {
      calls.push("gyms");
      const all = gyms.filter((g) => g.country === cc && g.citySlug === slug && (category === null || g.category === category));
      const sorted = [...all].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.pageName.localeCompare(b.pageName));
      const rows = sorted.slice((page - 1) * DIRECTORY_PAGE_SIZE, page * DIRECTORY_PAGE_SIZE).map(rowOf);
      return { rows, total: rows.length ? all.length : 0 };
    },
    async readMapCities() {
      calls.push("mapCities");
      return [];
    },
    async readCitySlugRedirect() {
      calls.push("citySlugRedirect");
      return null;
    },
    async readIndexableCities() {
      calls.push("indexableCities");
      return cityRows().filter((c) => c.indexable).map((c) => ({ countryCode: c.countryCode, citySlug: c.citySlug }));
    },
    async readLlmsPages(limit) {
      calls.push(`llms:${limit}`);
      const rows: LlmsPageRow[] = [...gyms]
        .sort((a, b) => (a.pageName < b.pageName ? -1 : a.pageName > b.pageName ? 1 : 0))
        .slice(0, limit)
        .map((g) => ({ name: g.pageName, template: "classic", schema_version: 1, content: snapshotOf(g) }));
      return rows;
    },
  };
}
