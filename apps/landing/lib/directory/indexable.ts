// Story 25.5 (AD-50): the decisions the directory pages and the sitemap must make the same way, in ONE module so they cannot drift.
//
// `countryIsIndexable` is the country page's own rule (25.3): the country view's flag AND the city rows agreeing with the view's count (`S`, the sum of
// the city rows, is what the page shows; while it differs from the view's own count the page is not offered to crawlers). The country page calls it for
// its `noindex`, and the sitemap calls it to decide whether the country is listed, so a page and its sitemap entry cannot disagree.
// The route grammar (`COUNTRY_SEGMENT`, `CITY_SEGMENT`) and `directoryPath` live here for the same reason: the sitemap lists only URLs the pages serve.
import type { Locale } from "@/lib/i18n";
import type { CountryRow } from "./types";

/** `s` is the sum of the country's city rows (`directory_city.published_count`). A country with no listed gym is neither listed nor served. */
export function countryIsIndexable(country: Pick<CountryRow, "indexable" | "publishedCount">, s: number): boolean {
  return country.indexable && s === country.publishedCount && s > 0;
}

/** The country segment as a URL carries it (lowercase ISO alpha-2). */
export const COUNTRY_SEGMENT = /^[a-z]{2}$/;
/** The city segment (an ASCII-folded slug), at most `CITY_SEGMENT_MAX` characters. */
export const CITY_SEGMENT = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const CITY_SEGMENT_MAX = 60;

export const isCitySegment = (slug: string): boolean => slug.length <= CITY_SEGMENT_MAX && CITY_SEGMENT.test(slug);

/** `/{locale}/gyms[/{rest}...]`: the path of a directory page, with no trailing slash. */
export const directoryPath = (locale: Locale, ...rest: string[]): string => `/${[locale, "gyms", ...rest].join("/")}`;
