// Story 24.10: the two statements the public site sends, in a module with NO imports so scripts/public-site-reader-sql.test.sh can load the
// exact text under Node's type stripping and run it against the migrated local schema as `public_site_reader`. db.ts imports them from here.
// One unnamed statement each, no session state; `$1` is the lowercase page name.

/** The visible page of a name. */
export const PAGE_SQL = "select template, schema_version, content from public_site.pages where name = $1 limit 1";

/** The CURRENT name of an old name inside its 12 months, only while the current page is visible. */
export const REDIRECT_SQL = "select name from public_site.page_redirects where old_name = $1 limit 1";

// Story 24.11: the report. The reader role is default_transaction_read_only, so the one write runs as a short read-write transaction on ONE
// checked-out connection: `begin read write`, the call, `commit`. `public_site.submit_page_report` is the only function the role may execute; it resolves the
// visible page itself and answers 'ok', 'rate_limited', 'not_found' or 'invalid'. $1 page name, $2 reason code, $3 details, $4 source hash.
export const BEGIN_RW_SQL = "begin read write";
export const SUBMIT_REPORT_SQL = "select public_site.submit_page_report($1, $2, $3, $4) as result";
export const COMMIT_SQL = "commit";

// Story 25.3: the directory reads. Only the three 25.2 views, one unnamed statement each, `$n` params, no quote characters in the text (so
// scripts/public-site-reader-sql.test.sh can load the exact text and run it as the reader). The views promise no order: gyms are ordered here
// (`lower(name), page_name`, 20 per page); countries and cities are ordered by the handler with the locale's collator.

/** Every country with a published gym (names, the country view's own count and flag). */
export const DIRECTORY_COUNTRIES_SQL = "select country_code, name_en, name_fr, published_count, indexable from public_site.directory_country";

/** One country. `$1` is the upper-case alpha-2 code. */
export const DIRECTORY_COUNTRY_SQL =
  "select country_code, name_en, name_fr, published_count, indexable from public_site.directory_country where country_code = $1 limit 1";

/** The gyms the city rows list, per country: the page's count `S` (the country view counts by the snapshot country and can disagree inside the refresh window). */
export const DIRECTORY_CITY_TOTALS_SQL =
  "select country_code, sum(published_count)::integer as listed_count from public_site.directory_city group by country_code";

/** The cities of a country that have a published gym. `$1` is the upper-case alpha-2 code. */
export const DIRECTORY_CITIES_SQL =
  "select city_slug, city_name, published_count, indexable from public_site.directory_city where country_code = $1";

/** One city. `$1` country code, `$2` the exact city slug. */
export const DIRECTORY_CITY_SQL =
  "select city_slug, city_name, published_count, indexable from public_site.directory_city where country_code = $1 and city_slug = $2 limit 1";

/** The categories offered as filter links: those present in the city. */
export const DIRECTORY_CATEGORIES_SQL =
  "select distinct category from public_site.directory_gym where country_code = $1 and city_slug = $2";

/** One page of a city's gyms. `$3` the category code or null, `$4` the 1-based page. `total` is over all pages (absent past the last page). */
export const DIRECTORY_GYMS_SQL =
  "select city_name, category, name, page_name, logo_key, (count(*) over ())::integer as total " +
  "from public_site.directory_gym " +
  "where country_code = $1 and city_slug = $2 and ($3::text is null or category = $3::text) " +
  "order by lower(name), page_name limit 20 offset ($4::integer - 1) * 20";

// Story 25.5: the two crawler reads. Same rules as above: one unnamed statement each, `$n` params, no quote characters in the text. The cities are the
// ones the unfiltered city page serves as indexable; the pages are the AD-46 snapshot (the directory views carry neither hours nor plans), ordered by
// byte order of the page name so the cut at the cap is deterministic.

/** The cities whose row says indexable (a thin city is absent). The country rule is applied by the caller, from the country rows and the city totals. */
export const CRAWL_CITIES_SQL = "select country_code, city_slug from public_site.directory_city where indexable order by country_code, city_slug";

/** The visible pages for `/llms.txt`. `$1` is the number of rows wanted (the cap plus one, to know whether the list was cut). */
export const CRAWL_PAGES_SQL =
  "select name, template, schema_version, content from public_site.pages order by name collate \"C\" limit $1::integer";

// Story 25.7: the Africa map and the old city slug. Same rules as above: one unnamed statement each, `$n` params, no quote characters in the text.

/**
 * The cities the map may draw a dot for: those with coordinates (the city's OWN lat/lng, never a gym position) and at least one visible gym (the view
 * holds only such cities). This is the ONLY directory statement that names lat or lng, and it reads directory_city only.
 */
export const DIRECTORY_MAP_CITIES_SQL =
  "select country_code, city_slug, city_name, lat, lng, published_count from public_site.directory_city where lat is not null and lng is not null";

/** The CURRENT slug of an old city slug inside its 12 months, only while the current city has a visible gym. `$1` upper-case alpha-2, `$2` the old slug. */
export const DIRECTORY_CITY_REDIRECT_SQL =
  "select city_slug from public_site.directory_city_redirect where country_code = $1 and old_slug = $2 limit 1";
