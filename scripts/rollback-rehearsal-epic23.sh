#!/usr/bin/env bash
# Rehearse the Epic 23 rollbacks (0149 .. 0134) on the LOCAL database, inside ONE transaction that is always rolled back,
# so the database is left exactly as it was. Proves, on a database that has all of 0134-0149 applied:
#   * every rollback script runs, in reverse order, without an error;
#   * afterwards the Epic 23 objects are gone (support tables, support functions, the two support cron jobs, the proxy
#     columns) and the Epic 22 objects the epic built on are still there.
# It does NOT prove the rolled-back definitions equal what production had (production has none of 0134-0149 yet, so the
# comparison is against the previous migration, which the retro diffed by text), and it does not undo `alter type ... add
# value` (an enum value cannot be dropped: 0134 leaves 'support' in member_role on purpose).
#
#   bash scripts/rollback-rehearsal-epic23.sh   (needs the local Supabase stack: supabase_db_gym_os, ledger at 0149)
set -euo pipefail
cd "$(dirname "$0")/.."
DB="${DB_CONTAINER:-supabase_db_gym_os}"
VERSIONS="0149 0148 0147 0146 0145 0144 0143 0142 0141 0140 0139 0138 0137 0136 0135 0134"
N=$(echo $VERSIONS | wc -w)

docker ps --format '{{.Names}}' | grep -qx "$DB" || { echo "local database container '$DB' is not running" >&2; exit 2; }
head=$(docker exec "$DB" psql -U postgres -d postgres -Atc "select max(version) from supabase_migrations.schema_migrations")
[ "$head" = "0149" ] || { echo "expected the local ledger at 0149 (all of 0134-0149 applied), found '$head'" >&2; exit 2; }

sql=$(mktemp); trap 'rm -f "$sql"' EXIT
{
  echo "begin;"
  echo "update private.support_accounts set locked_at = null;   -- rehearsal only (rolled back): the 0144 rollback refuses while an account is locked"
  for v in $VERSIONS; do
    f=$(ls scripts/rollback-$v-*.sql)
    echo "\\echo ROLLBACK_START $v"; cat "$f"; echo; echo "\\echo ROLLBACK_OK $v"
  done
  cat <<'SQL'
\echo CHECK
select 'support tables left: ' || count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public','private') and c.relkind = 'r'
    and (c.relname like 'support\_%' or c.relname = 'gym_support_proxies')
    and c.relname not in ('support_session_state', 'support_stepup');   -- these two are Epic 22 (0127) and stay
select 'support functions left: ' || count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public','private') and p.proname like '%support%'
    and p.proname not in ('custom_access_token_hook', 'support_session_state_purge');   -- the purge is Epic 22 (0127) and stays
select 'support cron jobs left: ' || count(*) from cron.job where jobname like 'support\_%' and jobname <> 'support_session_state_purge';
select 'epic 22 tables kept: ' || count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'private' and c.relkind = 'r' and c.relname in ('platform_flags','session_limits_config','support_session_state', 'support_stepup','super_admin_lockout');
select 'authorize_action present: ' || (to_regprocedure('public.authorize_action(uuid, uuid, text)') is not null);
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
printf '%s\n' "$out" | grep -q 'support tables left: 0$'    || fail=1
printf '%s\n' "$out" | grep -q 'support functions left: 0$' || fail=1
printf '%s\n' "$out" | grep -q 'support cron jobs left: 0$' || fail=1
printf '%s\n' "$out" | grep -q 'epic 22 tables kept: 5$' || fail=1
printf '%s\n' "$out" | grep -q 'authorize_action present: true$' || fail=1
printf '%s\n' "$out" | grep -q 'custom_access_token_hook present: true$' || fail=1
printf '%s\n' "$out" | grep -q 'log_audit_event present: true$' || fail=1
after=$(docker exec "$DB" psql -U postgres -d postgres -Atc "select max(version) from supabase_migrations.schema_migrations; select to_regclass('private.support_accounts') is not null")
[ "$after" = $'0149\nt' ] || { echo "the database was NOT left as it was: $after" >&2; fail=1; }
[ "$fail" = 0 ] && echo "epic 23 rollback rehearsal: all passed (the database was left untouched)" || { echo "epic 23 rollback rehearsal: FAILED" >&2; exit 1; }
