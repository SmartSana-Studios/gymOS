// Story 25.3: the rows the directory pages read from the three 25.2 views (public_site.directory_country, directory_city, directory_gym), as the
// reader returns them. No internal id exists in any of them; the lat/lng of directory_city are read only by the map statement (Story 25.7).

export interface CountryRow {
  countryCode: string;
  nameEn: string;
  nameFr: string;
  /** The 25.2 country view counts by the snapshot's country; the pages use the sum of the city rows instead (see handler.ts, `S`). */
  publishedCount: number;
  indexable: boolean;
}

/** `sum(directory_city.published_count)` of one country: the gyms the city rows list. */
export interface CityTotalRow {
  countryCode: string;
  listedCount: number;
}

export interface CityRow {
  citySlug: string;
  cityName: string;
  publishedCount: number;
  indexable: boolean;
}

/** Story 25.7: a city the map may draw: its own coordinates (never a gym position) and its gym count. */
export interface MapCityRow {
  /** Upper-case alpha-2, as the view carries it. */
  countryCode: string;
  citySlug: string;
  cityName: string;
  lat: number;
  lng: number;
  publishedCount: number;
}

export interface GymRow {
  cityName: string;
  category: string | null;
  name: string;
  /** The subdomain label of the gym's page. */
  pageName: string;
  logoKey: string | null;
}

export interface GymPage {
  rows: GymRow[];
  /** Gyms matching the filter in the city, over all pages. 0 when the requested page is past the last. */
  total: number;
}

/** The directory reads of `createReader` (db.ts), as an interface so the handler is a test with fakes. */
export interface DirectoryReader {
  readCountries(): Promise<CountryRow[]>;
  readCountry(countryCode: string): Promise<CountryRow | null>;
  readCityTotals(): Promise<CityTotalRow[]>;
  readCities(countryCode: string): Promise<CityRow[]>;
  readCity(countryCode: string, citySlug: string): Promise<CityRow | null>;
  /** The distinct category codes of the city's gyms (null categories excluded). */
  readCategories(countryCode: string, citySlug: string): Promise<string[]>;
  /** One page of gyms ordered by `lower(name), page_name`. `category` null is the unfiltered list. `page` is 1-based. */
  readGyms(countryCode: string, citySlug: string, category: string | null, page: number): Promise<GymPage>;
  /** Story 25.7: the cities with coordinates and a published gym, in no particular order. */
  readMapCities(): Promise<MapCityRow[]>;
  /** Story 25.7: the CURRENT slug of an old city slug (`countryCode` upper case) inside its 12 months while the current city has a visible gym, else null. */
  readCitySlugRedirect(countryCode: string, oldSlug: string): Promise<string | null>;
}

/** Gyms per page of a city listing (the SQL text in readerSql.ts has the same 20). */
export const DIRECTORY_PAGE_SIZE = 20;

/** Story 25.5: a city the sitemap may list: its row has `indexable` set (`directory_city`). Whether its country is listed is decided from the country rows. */
export interface CrawlCityRow {
  /** Upper-case alpha-2, as the views carry it. */
  countryCode: string;
  citySlug: string;
}

/** Story 25.5: a row of `public_site.pages` as `/llms.txt` reads it: the page name and the unparsed snapshot (the handler parses it strictly, like the page does). */
export interface LlmsPageRow {
  name: string;
  template: unknown;
  schema_version: unknown;
  content: unknown;
}

/**
 * Story 25.5: the reads of the crawler responses. The countries and the city totals are the directory page's own reads (the sitemap applies the same
 * rules to the same rows); the other two are new: the cities with `indexable` set, and the visible page snapshots (hours and plans live only there).
 */
export interface CrawlReader extends Pick<DirectoryReader, "readCountries" | "readCityTotals"> {
  /** Every city with `indexable` set, ordered by country code then slug. */
  readIndexableCities(): Promise<CrawlCityRow[]>;
  /** At most `limit` visible pages ordered by page name (byte order). */
  readLlmsPages(limit: number): Promise<LlmsPageRow[]>;
}
