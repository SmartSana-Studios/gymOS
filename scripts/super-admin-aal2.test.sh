#!/usr/bin/env bash
# Story 22.6: exercises scripts/enable-super-admin-aal2.mjs and scripts/reset-super-admin-factors.mjs
# against the LOCAL database (never production). Fixtures (one Super Admin, factors named qa22-6-*,
# one session, audit rows by operator qa-22-6) are created and removed by this script; the flag is
# restored to its original value on exit. Needs the local Supabase stack, node and the `pg` module
# (PG_MODULE_DIR=<dir>/node_modules, or `npm i pg@8` is run into a temp dir).
#
#   scripts/super-admin-aal2.test.sh
set -uo pipefail
cd "$(dirname "$0")/.."
DB=${DB_CONTAINER:-supabase_db_gym_os}
EMAIL=qa22-6-super@example.test
UID_FIX=00000000-0000-4000-8000-000000002206
UID_NS=00000000-0000-4000-8000-000000002207
EMAIL_NS=qa22-6-regular@example.test
OP=qa-22-6

sql() { docker exec -i -e PGPASSWORD=postgres "$DB" psql -U postgres -h 127.0.0.1 -At -v ON_ERROR_STOP=1 -c "$1" 2>&1; }

# pg module for the scripts.
if [ -z "${PG_MODULE_DIR:-}" ] || [ ! -d "${PG_MODULE_DIR}/pg" ]; then
  TMPPG=$(mktemp -d)
  (cd "$TMPPG" && npm i --silent --no-audit --no-fund pg@8 >/dev/null 2>&1) || { echo "SKIP: pg module unavailable (set PG_MODULE_DIR)"; exit 1; }
  export PG_MODULE_DIR="$TMPPG/node_modules"
fi
PWFILE=$(mktemp); echo postgres > "$PWFILE"
export PROD_HOST=127.0.0.1 PROD_PORT=${LOCAL_DB_PORT:-54322} PROD_USER=postgres PROD_DB=postgres PROD_SSL=0 PROD_PASSWORD_FILE="$PWFILE"

ORIG_FLAG=$(sql "select enabled from private.platform_flags where flag='super_admin_aal2'")
cleanup() {
  sql "delete from auth.sessions where user_id in ('$UID_FIX','$UID_NS'); select set_config('gymos.factor_reset','on',true); delete from auth.mfa_factors where friendly_name like 'qa22-6-%'; delete from public.audit_log where actor_display_name='operator:$OP'; delete from private.super_admin_recovery_pending where user_id = '$UID_FIX'; delete from private.super_admin_recovery_email where user_id = '$UID_FIX'; delete from auth.users where id in ('$UID_FIX','$UID_NS'); update private.platform_flags set enabled = '$ORIG_FLAG' where flag='super_admin_aal2';" >/dev/null
  rm -f "$PWFILE"
}
trap cleanup EXIT

others=$(sql "select count(*) from public.users u where u.is_super_admin and u.id <> '$UID_FIX'")
if [ "$others" != "0" ]; then echo "SKIP: local DB has other Super Admins; fixtures would be ambiguous"; exit 1; fi
sql "select set_config('gymos.factor_reset','on',true); delete from auth.mfa_factors where friendly_name like 'qa22-6-%'; delete from auth.users where id='$UID_FIX';" >/dev/null
sql "insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values ('$UID_FIX','00000000-0000-0000-0000-000000000000','authenticated','authenticated','$EMAIL',now(),now()); update public.users set is_super_admin = true where id='$UID_FIX'; insert into auth.sessions (id, user_id, created_at, updated_at) values (gen_random_uuid(),'$UID_FIX',now(),now());" >/dev/null || { echo "FAIL fixture setup"; exit 1; }

factors() { # $1 verified count, $2 unverified count
  sql "select set_config('gymos.factor_reset','on',true); delete from auth.mfa_factors where friendly_name like 'qa22-6-%';" >/dev/null
  local i
  for ((i=1;i<=$1;i++)); do sql "insert into auth.mfa_factors (id,user_id,friendly_name,factor_type,status,created_at,updated_at,secret) values (gen_random_uuid(),'$UID_FIX','qa22-6-v$i','totp','verified',now(),now(),'QA226SECRET');" >/dev/null; done
  for ((i=1;i<=$2;i++)); do sql "insert into auth.mfa_factors (id,user_id,friendly_name,factor_type,status,created_at,updated_at,secret) values (gen_random_uuid(),'$UID_FIX','qa22-6-u$i','totp','unverified',now(),now(),'QA226SECRET');" >/dev/null; done
}
flag() { sql "select enabled from private.platform_flags where flag='super_admin_aal2'"; }
setflag() { sql "update private.platform_flags set enabled = $1 where flag='super_admin_aal2'" >/dev/null; }
audit_n() { sql "select count(*) from public.audit_log where actor_display_name='operator:$OP' and action_type='$1'"; }

fail=0
check() { # $1 name, $2 actual, $3 expected
  [ "$2" = "$3" ] && echo "ok   $1" || { echo "FAIL $1: expected '$3', got '$2'"; fail=1; }
}
has() { case "$2" in *"$3"*) echo "ok   $1" ;; *) echo "FAIL $1: expected to contain '$3', got: $2"; fail=1 ;; esac; }
ENABLE=scripts/enable-super-admin-aal2.mjs
RESET=scripts/reset-super-admin-factors.mjs
run() { out=$("$@" 2>&1); rc=$?; }

setflag false
for combo in "0 0" "1 0" "3 0" "0 1"; do
  set -- $combo; factors "$1" "$2"
  run node $ENABLE --apply --operator $OP <<<"enable super admin aal2"
  check "enable refuses with $1 verified / $2 unverified (exit 1)" "$rc" "1"
  check "  flag unchanged" "$(flag)" "f"
done
has "enable short lists who" "$out" "needs exactly 2"

factors 2 0
run node $ENABLE
check "enable dry-run exit 0" "$rc" "0"
check "enable dry-run leaves flag off" "$(flag)" "f"
has "enable dry-run prints factor names" "$out" "qa22-6-v1"
run node $ENABLE --apply
check "enable --apply without --operator exits 2" "$rc" "2"
run node $ENABLE --apply --operator $OP <<<"wrong"
check "enable wrong confirmation exit 1" "$rc" "1"
check "  flag still off" "$(flag)" "f"
run node $ENABLE --apply --operator $OP <<<"enable super admin aal2"
check "enable ready exit 0" "$rc" "0"
check "  flag on" "$(flag)" "t"
check "  one audit row" "$(audit_n super_admin_aal2_enabled)" "1"
check "  audit has no secret" "$(sql "select count(*) from public.audit_log where actor_display_name='operator:$OP' and metadata::text like '%QA226SECRET%'")" "0"
check "  output has no secret" "$(case "$out" in *QA226SECRET*) echo leak;; *) echo clean;; esac)" "clean"
run node $ENABLE --apply --operator $OP <<<"enable super admin aal2"
check "enable repeat exit 0" "$rc" "0"
has "enable repeat says already on" "$out" "already on"
check "  still one audit row" "$(audit_n super_admin_aal2_enabled)" "1"

# 0129: the factor-reset bypass is honoured only for an operator session; GoTrue's own role cannot switch the guard off.
out_aa=$(docker exec -i -e PGPASSWORD=postgres "$DB" psql -U supabase_auth_admin -h 127.0.0.1 -d postgres -v ON_ERROR_STOP=1 -At 2>&1 <<SQLEOF
begin;
select set_config('gymos.factor_reset', 'on', true);
delete from auth.mfa_factors where user_id = '$UID_FIX';
rollback;
SQLEOF
)
has "auth-admin session cannot bypass the last-factor guard" "$out_aa" "last_verified_factor"
check "  both factors are still there" "$(sql "select count(*) from auth.mfa_factors where user_id='$UID_FIX'")" "2"

# Story 22 retro item 54: audited flag-off mode (bootstrap window); factors and sessions untouched.
DISABLE=scripts/disable-super-admin-aal2.mjs
run node $DISABLE
check "disable dry-run exit 0" "$rc" "0"
check "  dry-run leaves flag on" "$(flag)" "t"
run node $DISABLE --apply
check "disable --apply without --operator exits 2" "$rc" "2"
run node $DISABLE --apply --operator $OP <<<"wrong"
check "disable wrong confirmation exit 1" "$rc" "1"
check "  flag still on" "$(flag)" "t"
run node $DISABLE --apply --operator $OP <<<"disable super admin aal2"
check "disable apply exit 0" "$rc" "0"
check "  flag off" "$(flag)" "f"
check "  one disable audit row" "$(audit_n super_admin_aal2_disabled)" "1"
check "  factors untouched" "$(sql "select count(*) from auth.mfa_factors where user_id='$UID_FIX'")" "2"
check "  sessions untouched" "$(sql "select count(*) from auth.sessions where user_id='$UID_FIX'")" "1"
run node $DISABLE --apply --operator $OP <<<"disable super admin aal2"
check "disable repeat exit 0 (already off)" "$rc" "0"
check "  still one disable audit row" "$(audit_n super_admin_aal2_disabled)" "1"
run node $ENABLE --apply --operator $OP <<<"enable super admin aal2"
check "re-enable after the window exit 0" "$rc" "0"
check "  flag on again" "$(flag)" "t"

run node $RESET nobody@example.test --apply --operator $OP <<<"reset nobody@example.test"
check "reset unknown email exit 1" "$rc" "1"
sql "delete from auth.users where id='$UID_NS'; insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values ('$UID_NS','00000000-0000-0000-0000-000000000000','authenticated','authenticated','$EMAIL_NS',now(),now()); insert into auth.mfa_factors (id,user_id,friendly_name,factor_type,status,created_at,updated_at,secret) values (gen_random_uuid(),'$UID_NS','qa22-6-ns1','totp','verified',now(),now(),'QA226SECRET'); insert into auth.sessions (id, user_id, created_at, updated_at) values (gen_random_uuid(),'$UID_NS',now(),now());" >/dev/null || { echo "FAIL non-admin fixture setup"; fail=1; }
run node $RESET $EMAIL_NS --apply --operator $OP <<<"reset $EMAIL_NS"
check "reset refuses a non-Super-Admin (exit 1)" "$rc" "1"
check "  non-admin factors untouched" "$(sql "select count(*) from auth.mfa_factors where user_id='$UID_NS'")" "1"
check "  non-admin sessions untouched" "$(sql "select count(*) from auth.sessions where user_id='$UID_NS'")" "1"
check "  flag untouched" "$(flag)" "t"
check "  no reset audit row" "$(audit_n super_admin_factors_reset)" "0"
run node $RESET $EMAIL
check "reset dry-run exit 0" "$rc" "0"
check "  dry-run keeps factors" "$(sql "select count(*) from auth.mfa_factors where user_id='$UID_FIX'")" "2"
# Story 22.7: seed a wrong-code lock, session state and a step-up grant for the target
sql "insert into private.super_admin_lockout (user_id, failed_count, locked_at) values ('$UID_FIX', 5, now()) on conflict (user_id) do update set failed_count = 5, locked_at = now(); insert into private.support_session_state (session_id, user_id, started_at, last_seen_at) values (gen_random_uuid(), '$UID_FIX', now(), now()); insert into private.support_stepup (user_id, action, subject_id, expires_at) values ('$UID_FIX', 'create_super_admin', 'qa@example.test', now() + interval '5 minutes');" >/dev/null || { echo "FAIL 22.7 seed"; fail=1; }
run node $RESET $EMAIL --apply --operator $OP <<<"reset $EMAIL"
check "  lock cleared" "$(sql "select count(*) from private.super_admin_lockout where user_id='$UID_FIX'")" "0"
check "  session state cleared" "$(sql "select count(*) from private.support_session_state where user_id='$UID_FIX'")" "0"
check "  step-up grants cleared" "$(sql "select count(*) from private.support_stepup where user_id='$UID_FIX'")" "0"
check "reset apply exit 0" "$rc" "0"
check "  factors gone" "$(sql "select count(*) from auth.mfa_factors where user_id='$UID_FIX'")" "0"
check "  sessions gone" "$(sql "select count(*) from auth.sessions where user_id='$UID_FIX'")" "0"
check "  flag off" "$(flag)" "f"
check "  one audit row" "$(audit_n super_admin_factors_reset)" "1"
check "  audit has no secret" "$(sql "select count(*) from public.audit_log where actor_display_name='operator:$OP' and metadata::text like '%QA226SECRET%'")" "0"

# ---- Story 22.8: one verified factor + verified recovery email; operator cancel; reset supersedes ----
setflag false
factors 1 0
run node $ENABLE
check "enable refuses one factor without a recovery email (exit 1)" "$rc" "1"
sql "insert into private.super_admin_recovery_email (user_id, email) values ('$UID_FIX', 'qa22-8@rec.example.test')" >/dev/null
run node $ENABLE
check "enable dry-run accepts one factor + recovery email (exit 0)" "$rc" "0"
has "  names the rule" "$out" "one verified factor + verified recovery email"
check "  flag untouched" "$(flag)" "f"
factors 0 0
run node $ENABLE
check "enable refuses a recovery email alone (exit 1)" "$rc" "1"

pending() { sql "select count(*) from private.super_admin_recovery_pending where user_id='$UID_FIX' and cancelled_at is null and applied_at is null"; }
addpending() { sql "insert into private.super_admin_recovery_pending (user_id, apply_at, cancel_token_hash) values ('$UID_FIX', now() + interval '30 minutes', 'qa22-8-hash')" >/dev/null; }
addpending
run node $RESET $EMAIL --cancel-recovery
check "cancel-recovery dry-run exit 0" "$rc" "0"
check "  dry-run leaves it pending" "$(pending)" "1"
run node $RESET $EMAIL --cancel-recovery --apply --operator $OP <<<"cancel recovery $EMAIL"
check "cancel-recovery apply exit 0" "$rc" "0"
check "  no longer pending" "$(pending)" "0"
check "  one cancel audit row" "$(audit_n super_admin_recovery_cancelled)" "1"
run node $RESET $EMAIL --cancel-recovery --apply --operator $OP <<<"cancel recovery $EMAIL"
check "cancel-recovery with nothing pending exit 0" "$rc" "0"
addpending
run node $RESET $EMAIL --apply --operator $OP <<<"reset $EMAIL"
check "full reset exit 0" "$rc" "0"
check "  reset also cancels a scheduled recovery" "$(pending)" "0"

[ "$fail" = 0 ] && echo "super-admin-aal2: all passed" || { echo "super-admin-aal2: FAILED"; exit 1; }
