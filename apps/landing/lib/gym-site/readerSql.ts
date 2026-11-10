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
