// Story 25.3: the rows the directory pages read from the three 25.2 views (public_site.directory_country, directory_city, directory_gym), as the
// reader returns them. No internal id exists in any of them; the lat/lng of directory_city are read by a later story (the map), not here.

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
}

/** Gyms per page of a city listing (the SQL text in readerSql.ts has the same 20). */
export const DIRECTORY_PAGE_SIZE = 20;
