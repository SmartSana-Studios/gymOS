#!/usr/bin/env bash
# Rehearse the Epic 22 rollbacks (0133 .. 0124) on the LOCAL database, inside ONE transaction that is always rolled back,
# so the database is left exactly as it was. Proves, on a database that has all of 0124-0133 applied:
#   * every rollback script runs, in reverse order, without an error;
#   * afterwards the Epic 22 objects are gone (the eight private tables, the 43 functions, the cron job, the
#     auth.mfa_factors guard trigger) and nothing it should keep is missing.
# It does NOT prove the rolled-back definitions equal what production had: that comparison needs a snapshot of
# production before the deploy (docs/runbooks/deploy-epic-22.md, "Rollback rehearsal").
#
#   bash scripts/rollback-rehearsal.sh        (needs the local Supabase stack: supabase_db_gym_os)
set -euo pipefail
cd "$(dirname "$0")/.."
DB="${DB_CONTAINER:-supabase_db_gym_os}"

docker ps --format '{{.Names}}' | grep -qx "$DB" || { echo "local database container '$DB' is not running" >&2; exit 2; }
head=$(docker exec "$DB" psql -U postgres -d postgres -Atc "select max(version) from supabase_migrations.schema_migrations")
[ "$head" = "0133" ] || { echo "expected the local ledger at 0133 (all of 0124-0133 applied), found '$head'" >&2; exit 2; }

sql=$(mktemp); trap 'rm -f "$sql"' EXIT
{
  echo "begin;"
  for v in 0133 0132 0131 0130 0129 0128 0127 0126 0125 0124; do
    f=$(ls scripts/rollback-$v-*.sql)
    echo "\\echo ROLLBACK_START $v"; cat "$f"; echo; echo "\\echo ROLLBACK_OK $v"
  done
  cat <<'SQL'
\echo CHECK
select 'epic tables left: ' || count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'private' and c.relkind = 'r'
    and c.relname in ('platform_flags','session_limits_config','support_session_state','support_stepup','super_admin_lockout',
                      'super_admin_recovery_code','super_admin_recovery_email','super_admin_recovery_pending');
select 'epic functions left: ' || count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public','private')
    and (p.proname like 'recovery\_%' or p.proname like 'stepup\_%' or p.proname like 'authorize\_action' or p.proname = 'capability_roles'
         or p.proname in ('session_gate_touch','session_limit','super_admin_locked','super_admin_aal2_required',
                          'guard_last_verified_factor','guard_super_admin_not_owner','guard_owner_not_super_admin','end_user_sessions','support_session_state_purge'));
select 'epic cron jobs left: ' || count(*) from cron.job where jobname in ('super_admin_recovery_apply', 'support_session_state_purge');
select 'mfa guard trigger left: ' || count(*) from pg_trigger where tgname = 'guard_last_verified_factor' and not tgisinternal;
select 'custom_access_token_hook present: ' || (to_regprocedure('public.custom_access_token_hook(jsonb)') is not null);
select 'log_audit_event present: ' || (to_regprocedure('public.log_audit_event(text, text, text, text, jsonb, text)') is not null or exists (select 1 from pg_proc where proname = 'log_audit_event'));
rollback;
SQL
} > "$sql"

out=$(docker exec -i "$DB" psql -U postgres -d postgres -At -v ON_ERROR_STOP=1 < "$sql" 2>&1) || { echo "$out" | tail -15; echo "REHEARSAL FAILED: a rollback script errored" >&2; exit 1; }
ok=$(printf '%s\n' "$out" | grep -c '^ROLLBACK_OK')
echo "rollbacks that ran cleanly: $ok of 10"
printf '%s\n' "$out" | sed -n '/^CHECK/,$p' | grep -v '^CHECK' | grep -v '^ROLLBACK$' || true
fail=0
[ "$ok" = 10 ] || fail=1
printf '%s\n' "$out" | grep -q 'epic tables left: 0$'    || fail=1
printf '%s\n' "$out" | grep -q 'epic functions left: 0$' || fail=1
printf '%s\n' "$out" | grep -q 'epic cron jobs left: 0$' || fail=1
printf '%s\n' "$out" | grep -q 'mfa guard trigger left: 0$' || fail=1
printf '%s\n' "$out" | grep -q 'custom_access_token_hook present: true$' || fail=1
printf '%s\n' "$out" | grep -q 'log_audit_event present: true$' || fail=1
after=$(docker exec "$DB" psql -U postgres -d postgres -Atc "select max(version) from supabase_migrations.schema_migrations; select to_regclass('private.platform_flags') is not null")
[ "$after" = $'0133\nt' ] || { echo "the database was NOT left as it was: $after" >&2; fail=1; }
[ "$fail" = 0 ] && echo "rollback rehearsal: all passed (the database was left untouched)" || { echo "rollback rehearsal: FAILED" >&2; exit 1; }
