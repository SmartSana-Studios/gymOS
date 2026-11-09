#!/usr/bin/env bash
# Story 24.10 review pass 2: the landing reader's two statements (apps/landing/lib/gym-site/readerSql.ts, the same constants db.ts sends) were
# only matched by a regex against a mocked pg, so a wrong column or table name kept every stage green and answered a cached 404 for every gym
# page. This loads the EXACT text under Node's type stripping and runs it as `public_site_reader` against the migrated local schema, inside
# one rolled-back transaction (fixtures: one visible page with a redirect from an old name, one unpublished page).
#
#   scripts/public-site-reader-sql.test.sh
#   READER_SQL_FILE=<path.ts> scripts/public-site-reader-sql.test.sh   # known-bad run: a module exporting PAGE_SQL and REDIRECT_SQL
#
# Story 24.11 adds the report: the three statements the landing app sends for a report (begin read write, public_site.submit_page_report, commit) run
# in a session that has the role's own setting (default_transaction_read_only = on) AND the role, against rows committed for the run and removed again.
# That proves the reader can store a report only inside `begin read write`, that the function resolves the visible page itself, that the rate limit holds
# and that the role can call nothing else.
#
# Needs the local Supabase stack and Node 22.18 or later. The first block never commits; the report block commits its own fixtures and removes them.
set -uo pipefail
cd "$(dirname "$0")/.."
DB=${DB_CONTAINER:-supabase_db_gym_os}
SRC=${READER_SQL_FILE:-apps/landing/lib/gym-site/readerSql.ts}

load() { # load <export name>
  node --no-warnings --input-type=module -e 'const m = await import(new URL(process.argv[1], "file://" + process.cwd() + "/").href); process.stdout.write(String(m[process.argv[2]] ?? ""))' "$SRC" "$1"
}
PAGE_SQL=$(load PAGE_SQL) || { echo "FAIL could not load PAGE_SQL from $SRC (Node 22.18 or later is needed to import TypeScript)"; exit 1; }
REDIRECT_SQL=$(load REDIRECT_SQL) || { echo "FAIL could not load REDIRECT_SQL from $SRC"; exit 1; }
[ -n "$PAGE_SQL" ] && [ -n "$REDIRECT_SQL" ] || { echo "FAIL $SRC does not export PAGE_SQL and REDIRECT_SQL"; exit 1; }
BEGIN_RW_SQL=$(load BEGIN_RW_SQL); SUBMIT_REPORT_SQL=$(load SUBMIT_REPORT_SQL); COMMIT_SQL=$(load COMMIT_SQL)
[ -n "$BEGIN_RW_SQL" ] && [ -n "$SUBMIT_REPORT_SQL" ] && [ -n "$COMMIT_SQL" ] || { echo "FAIL $SRC does not export BEGIN_RW_SQL, SUBMIT_REPORT_SQL and COMMIT_SQL"; exit 1; }
case "$PAGE_SQL$REDIRECT_SQL$SUBMIT_REPORT_SQL" in *"'"*) echo "FAIL a reader statement contains a quote; the harness binds only \$1 to \$4"; exit 1;; esac

TIER=00000000-0000-0000-0000-000000000a1f
G1=00000000-0000-0000-0000-00000000a1f1
G2=00000000-0000-0000-0000-00000000a1f2

out=$({
  cat <<SQL
begin;
grant public_site_reader to postgres with set true;
insert into tiers (id, name, monthly_price, annual_price, member_cap) values ('$TIER', 'Reader SQL Tier', 5000, 50000, 30);
insert into gyms (id, name, tier_id, capacity, status) values
  ('$G1', 'Reader Sql Visible',     '$TIER', 30, 'active'),
  ('$G2', 'Reader Sql Unpublished', '$TIER', 30, 'active');
insert into public.page_names (id, gym_id, name, state, origin) values
  ('00000000-0000-0000-0000-0000000a1fa1', '$G1', 'rsq-visible',     'active', 'claim'),
  ('00000000-0000-0000-0000-0000000a1fa2', '$G2', 'rsq-unpublished', 'active', 'claim');
insert into public.page_names (id, gym_id, name, state, origin, reserved_until) values
  ('00000000-0000-0000-0000-0000000a1fb1', '$G1', 'rsq-old-name', 'redirect', 'rename', now() + interval '6 months');
insert into public.gym_pages (gym_id, page_name_id, template, published_at, content) values
  ('$G1', '00000000-0000-0000-0000-0000000a1fa1', 'classic', now(), '{"city":"Douala"}'),
  ('$G2', '00000000-0000-0000-0000-0000000a1fa2', 'classic', null, '{}');
set local role public_site_reader;
prepare page_q as $PAGE_SQL;
prepare redirect_q as $REDIRECT_SQL;
\echo CASE page_visible
execute page_q('rsq-visible');
\echo CASE page_unpublished
execute page_q('rsq-unpublished');
\echo CASE page_unknown
execute page_q('rsq-nobody');
\echo CASE redirect_old
execute redirect_q('rsq-old-name');
\echo CASE redirect_unknown
execute redirect_q('rsq-nobody');
\echo CASE END
reset role;
rollback;
SQL
} | docker exec -i -e PGPASSWORD=postgres "$DB" psql -U postgres -h 127.0.0.1 -At -v ON_ERROR_STOP=1 2>&1)
rc=$?

fail=0
check() { # check <case> <expected, one line or empty>
  local got
  got=$(printf '%s\n' "$out" | awk -v c="CASE $1" '$0 == c {on=1; next} /^CASE /{on=0} on' | grep -v '^$')
  if [ "$got" = "$2" ]; then echo "ok   $1"; else echo "FAIL $1: expected [$2] got [$got]"; fail=1; fi
}

if [ "$rc" != 0 ] || printf '%s\n' "$out" | grep -q 'ERROR:'; then
  echo "FAIL psql reported an error running the reader statements as public_site_reader:"
  printf '%s\n' "$out" | grep -E 'ERROR|LINE|psql:' | head -8 | sed 's/^/     /'
  exit 1
fi
printf '%s\n' "$out" | grep -q '^CASE END$' || { echo "FAIL the script did not reach its end"; exit 1; }

check page_visible 'classic|1|{"city": "Douala"}'
check page_unpublished ''
check page_unknown ''
check redirect_old 'rsq-visible'
check redirect_unknown ''

# ---- Story 24.11: the report, as the role (committed fixtures, always removed) ----
RT=00000000-0000-0000-0000-000000000a2f
RG=00000000-0000-0000-0000-00000000a2f1
RH=$(printf 'ab%.0s' $(seq 32))
psqlpg() { docker exec -i -e PGPASSWORD=postgres "$DB" psql -U postgres -h 127.0.0.1 -At "$@" 2>&1; }
cleanup() {
  psqlpg -v ON_ERROR_STOP=0 <<SQL >/dev/null
delete from gyms where id = '$RG';
delete from tiers where id = '$RT';
SQL
}
trap cleanup EXIT
cleanup
psqlpg -v ON_ERROR_STOP=1 <<SQL >/dev/null || { echo "FAIL could not create the report fixtures"; exit 1; }
insert into tiers (id, name, monthly_price, annual_price, member_cap) values ('$RT', 'Reader Report Tier', 5000, 50000, 30);
insert into gyms (id, name, tier_id, capacity, status) values ('$RG', 'Reader Report Gym', '$RT', 30, 'active');
insert into public.page_names (id, gym_id, name, state, origin) values ('00000000-0000-0000-0000-0000000a2fa1', '$RG', 'rsq-report', 'active', 'claim');
insert into public.gym_pages (gym_id, page_name_id, template, published_at, content) values ('$RG', '00000000-0000-0000-0000-0000000a2fa1', 'classic', now(), '{"city":"Douala"}');
SQL
# the session has the role's own settings: read-only by default, then the role (this is what a login as public_site_reader gives)
rep=$(psqlpg -q -v ON_ERROR_STOP=1 <<SQL
grant public_site_reader to postgres with set true;
set default_transaction_read_only = on;
set role public_site_reader;
prepare report_q as $SUBMIT_REPORT_SQL;
\echo CASE report_ok
$BEGIN_RW_SQL;
execute report_q('rsq-report', 'privacy', 'It copies a logo', '$RH');
$COMMIT_SQL;
\echo CASE report_unknown
$BEGIN_RW_SQL;
execute report_q('rsq-nobody', 'privacy', 'x', '$RH');
$COMMIT_SQL;
\echo CASE report_invalid
$BEGIN_RW_SQL;
execute report_q('rsq-report', 'bogus', 'x', '$RH');
$COMMIT_SQL;
\echo CASE report_limited
$BEGIN_RW_SQL;
execute report_q('rsq-report', 'privacy', 'two', '$RH');
execute report_q('rsq-report', 'privacy', 'three', '$RH');
execute report_q('rsq-report', 'privacy', 'four', '$RH');
execute report_q('rsq-report', 'privacy', 'five', '$RH');
execute report_q('rsq-report', 'privacy', 'six', '$RH');
$COMMIT_SQL;
\echo CASE END
SQL
)
rc2=$?
if [ "$rc2" != 0 ] || printf '%s\n' "$rep" | grep -q 'ERROR:'; then
  echo "FAIL psql reported an error running the report statements as public_site_reader:"
  printf '%s\n' "$rep" | grep -E 'ERROR|LINE|psql:' | head -8 | sed 's/^/     /'
  fail=1
else
  out=$rep
  check report_ok 'ok'
  check report_unknown 'not_found'
  check report_invalid 'invalid'
  check report_limited 'ok
ok
ok
ok
rate_limited'
  stored=$(psqlpg -c "select count(*) || '|' || bool_and(source_hash = '$RH') || '|' || min(reason) from private.page_reports where gym_id = '$RG'")
  if [ "$stored" = "5|true|privacy" ]; then echo "ok   report_stored"; else echo "FAIL report_stored: expected [5|true|privacy] got [$stored]"; fail=1; fi
fi

# a bare call is refused by the role's read-only default (why the app wraps it in begin read write), and nothing else can be called
ro=$(psqlpg -v ON_ERROR_STOP=0 <<SQL
grant public_site_reader to postgres with set true;
set default_transaction_read_only = on;
set role public_site_reader;
select public_site.submit_page_report('rsq-report', 'privacy', 'bare', '$(printf 'cd%.0s' $(seq 32))');
select private.gym_id();
select public.take_down_gym_page('$RG', 'privacy', null);
select count(*) from private.page_reports;
SQL
)
if printf '%s\n' "$ro" | grep -q 'cannot execute INSERT in a read-only transaction' || printf '%s\n' "$ro" | grep -qi 'read-only transaction'; then echo "ok   report_bare_call_refused"; else echo "FAIL report_bare_call_refused: [$ro]"; fail=1; fi
denied=$(printf '%s\n' "$ro" | grep -c 'permission denied')
if [ "$denied" = 3 ]; then echo "ok   report_other_calls_denied"; else echo "FAIL report_other_calls_denied: expected 3 permission errors, got $denied: [$ro]"; fail=1; fi
[ "$fail" = 0 ] && echo "public-site reader SQL: 5/5 page cases and 6 report cases ok"
exit "$fail"
