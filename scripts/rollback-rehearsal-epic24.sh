#!/usr/bin/env bash
# Rehearse the Epic 24 rollbacks (0168 .. 0160) on the LOCAL database, inside ONE transaction that is always rolled back,
# so the database is left exactly as it was. Proves, on a database that has all of 0160-0168 applied:
#   * every rollback script runs, in reverse order, without an error;
#   * afterwards the Epic 24 objects are gone (public_site schema, gym_pages, page names, media, takedown, report and appeal
#     tables, the two cron jobs, the reader role, plans.is_public), PUBLIC has USAGE on schema public again, and the Epic 22 and
#     23 objects the epic built on are still there.
# It does NOT undo Storage: rolling back 0162 deletes the two buckets only while they hold no objects (a purge of page media
# must run first), and it does not prove the rolled-back definitions equal what production had (production has none of 0160-0168
# yet, so the comparison is against 0159, which the rollbacks restore by text).
# The local ledger is NOT checked: the 24.x migrations were applied here outside it (it stays at 0159); the objects are checked instead.
#
#   bash scripts/rollback-rehearsal-epic24.sh   (needs the local Supabase stack: supabase_db_gym_os, 0160-0168 applied)
set -euo pipefail
cd "$(dirname "$0")/.."
DB="${DB_CONTAINER:-supabase_db_gym_os}"
VERSIONS="0168 0167 0166 0165 0164 0163 0162 0161 0160"
N=$(echo $VERSIONS | wc -w)

docker ps --format '{{.Names}}' | grep -qx "$DB" || { echo "local database container '$DB' is not running" >&2; exit 2; }
there=$(docker exec "$DB" psql -U postgres -d postgres -Atc "select (to_regclass('public_site.pages') is not null) and (to_regclass('private.page_takedowns') is not null) and (to_regclass('public.page_names') is not null)")
[ "$there" = "t" ] || { echo "the local database does not have 0160-0168 applied (public_site.pages, page_names or page_takedowns is missing)" >&2; exit 2; }

sql=$(mktemp); trap 'rm -f "$sql"' EXIT
{
  echo "begin;"
  for v in $VERSIONS; do
    f=$(ls scripts/rollback-$v-*.sql)
    echo "\\echo ROLLBACK_START $v"; cat "$f"; echo; echo "\\echo ROLLBACK_OK $v"
  done
  cat <<'SQL'
\echo CHECK
select 'public_site schema left: ' || count(*) from pg_namespace where nspname = 'public_site';
select 'epic 24 tables left: ' || count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'r' and ((n.nspname = 'public' and c.relname in ('gym_pages', 'page_names', 'page_name_words', 'gym_page_media'))
     or (n.nspname = 'private' and c.relname in ('page_takedowns', 'page_reports', 'page_appeals')));
select 'epic 24 cron jobs left: ' || count(*) from cron.job where jobname in ('page_media_purge', 'page_names_sweep');
select 'reader role left: ' || count(*) from pg_roles where rolname = 'public_site_reader';
select 'list_published_pages left: ' || count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'list_published_pages';
select 'plans.is_public left: ' || count(*) from information_schema.columns where table_schema = 'public' and table_name = 'plans' and column_name in ('is_public', 'public_label_en', 'public_label_fr');
select 'gym page columns left on gyms: ' || count(*) from information_schema.columns where table_schema = 'public' and table_name = 'gyms' and column_name like 'page\_%' escape '\';
select 'PUBLIC has USAGE on schema public: ' || exists (select 1 from pg_namespace n, aclexplode(n.nspacl) a where n.nspname = 'public' and a.grantee = 0 and a.privilege_type = 'USAGE');
select 'authorize_action present: ' || exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'authorize_action');   -- by name: its argument list has changed since Epic 23
select 'custom_access_token_hook present: ' || (to_regprocedure('public.custom_access_token_hook(jsonb)') is not null);
select 'log_audit_event present: ' || exists (select 1 from pg_proc where proname = 'log_audit_event');
rollback;
SQL
} > "$sql"

out=$(docker exec -i "$DB" psql -U postgres -d postgres -At -v ON_ERROR_STOP=1 < "$sql" 2>&1) || { echo "$out" | tail -15; echo "REHEARSAL FAILED: a rollback script errored" >&2; exit 1; }
ok=$(printf '%s\n' "$out" | grep -c '^ROLLBACK_OK')
echo "rollbacks that ran cleanly: $ok of $N"
printf '%s\n' "$out" | sed -n '/^CHECK/,$p' | grep -v '^CHECK' | grep -v '^ROLLBACK$' || true
fail=0
[ "$ok" = "$N" ] || fail=1
for want in 'public_site schema left: 0' 'epic 24 tables left: 0' 'epic 24 cron jobs left: 0' 'reader role left: 0' 'list_published_pages left: 0' 'plans.is_public left: 0' \
            'gym page columns left on gyms: 0' 'PUBLIC has USAGE on schema public: true' 'authorize_action present: true' \
            'custom_access_token_hook present: true' 'log_audit_event present: true'; do
  printf '%s\n' "$out" | grep -qx -- "$want" || { echo "MISSING: $want" >&2; fail=1; }
done
after=$(docker exec "$DB" psql -U postgres -d postgres -Atc "select (to_regclass('public_site.pages') is not null) and (to_regclass('public.page_names') is not null) and exists (select 1 from pg_roles where rolname = 'public_site_reader')")
[ "$after" = "t" ] || { echo "the database was NOT left as it was" >&2; fail=1; }
[ "$fail" = 0 ] && echo "epic 24 rollback rehearsal: all passed (the database was left untouched)" || { echo "epic 24 rollback rehearsal: FAILED" >&2; exit 1; }
