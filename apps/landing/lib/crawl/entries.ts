// Story 25.5 (AD-50, AD-52): which URLs the `www.` sitemap lists, as data, from the same rows the directory pages read. A pure function: no I/O, no
// request, the origin is passed in (the configured `www.` origin, never the request Host).
//
// In order: the marketing pages `/en` and `/fr`; the top directory page in both locales; then, per country (by code), the country page when its OWN rule
// says indexable (`countryIsIndexable`, the function the country page calls for its `noindex`) and then each of its indexable cities, each in both
// locales. A city is listed only when its country is on the top page (S > 0) and its row says indexable. No gym page, no filtered or paged view: a
// sitemap may list only its own host, and a filtered view canonicalizes to the unfiltered listing.
// Every entry carries the three alternates the page itself declares (`en`, `fr`, `x-default` = the English URL).
import { locales, type Locale } from "@/lib/i18n";
import { countryIsIndexable, directoryPath, isCitySegment } from "@/lib/directory/indexable";
import type { CityTotalRow, CountryRow, CrawlCityRow } from "@/lib/directory/types";

/** Entries per sitemap file (the protocol's limit). The handler can lower it for tests. */
export const SITEMAP_CHUNK_SIZE = 50_000;

export interface SitemapEntry {
  loc: string;
  alternates: { en: string; fr: string; xDefault: string };
}

export interface CrawlData {
  countries: CountryRow[];
  totals: CityTotalRow[];
  /** The cities whose row says indexable. */
  cities: CrawlCityRow[];
}

/** One page, one entry per locale; the three alternates are the same on both. */
function perLocale(www: string, pathOf: (locale: Locale) => string): SitemapEntry[] {
  const url = (l: Locale) => `${www}${pathOf(l)}`;
  const alternates = { en: url("en"), fr: url("fr"), xDefault: url("en") };
  return locales.map((l) => ({ loc: url(l), alternates }));
}

const byCode = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const COUNTRY_CODE = /^[A-Z]{2}$/;

export function buildEntries(www: string, data: CrawlData): SitemapEntry[] {
  const entries: SitemapEntry[] = [...perLocale(www, (l) => `/${l}`), ...perLocale(www, (l) => directoryPath(l))];

  // S of each country: the gyms its city rows list (the same sum the top and country pages use)
  const s = new Map(data.totals.map((t) => [t.countryCode, t.listedCount]));
  const citiesOf = new Map<string, string[]>();
  for (const c of data.cities) {
    const list = citiesOf.get(c.countryCode) ?? [];
    list.push(c.citySlug);
    citiesOf.set(c.countryCode, list);
  }

  const seen = new Set<string>();
  for (const country of [...data.countries].sort((a, b) => byCode(a.countryCode, b.countryCode))) {
    const code = country.countryCode;
    const listed = s.get(code) ?? 0;
    // not on the top page (no gym in its city rows), a malformed code or a repeated row: nothing of this country is listed
    if (listed <= 0 || !COUNTRY_CODE.test(code) || seen.has(code)) continue;
    seen.add(code);
    const cc = code.toLowerCase();
    if (countryIsIndexable(country, listed)) entries.push(...perLocale(www, (l) => directoryPath(l, cc)));
    for (const slug of [...new Set(citiesOf.get(code) ?? [])].sort(byCode)) {
      // a slug the city page would refuse is never advertised
      if (isCitySegment(slug)) entries.push(...perLocale(www, (l) => directoryPath(l, cc, slug)));
    }
  }
  return entries;
}

/** The number of files: at least one (the marketing and top pages are always listed). */
export function chunkCount(total: number, size: number): number {
  return Math.max(1, Math.ceil(total / size));
}

/** File `n` (1-based) of the entries, at most `size` of them. */
export function chunkOf(entries: readonly SitemapEntry[], n: number, size: number): SitemapEntry[] {
  return entries.slice((n - 1) * size, n * size);
}
