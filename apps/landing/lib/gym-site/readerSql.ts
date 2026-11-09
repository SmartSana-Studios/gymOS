// Story 24.10: the two statements the public site sends, in a module with NO imports so scripts/public-site-reader-sql.test.sh can load the
// exact text under Node's type stripping and run it against the migrated local schema as `public_site_reader`. db.ts imports them from here.
// One unnamed statement each, no session state; `$1` is the lowercase page name.

/** The visible page of a name. */
export const PAGE_SQL = "select template, schema_version, content from public_site.pages where name = $1 limit 1";

/** The CURRENT name of an old name inside its 12 months, only while the current page is visible. */
export const REDIRECT_SQL = "select name from public_site.page_redirects where old_name = $1 limit 1";
