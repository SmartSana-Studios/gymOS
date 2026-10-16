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
  sql "delete from auth.sessions where user_id in ('$UID_FIX','$UID_NS'); delete from auth.mfa_factors where friendly_name like 'qa22-6-%'; delete from public.audit_log where actor_display_name='operator:$OP'; delete from auth.users where id in ('$UID_FIX','$UID_NS'); update private.platform_flags set enabled = '$ORIG_FLAG' where flag='super_admin_aal2';" >/dev/null
  rm -f "$PWFILE"
}
trap cleanup EXIT

others=$(sql "select count(*) from public.users u where u.is_super_admin and u.id <> '$UID_FIX'")
if [ "$others" != "0" ]; then echo "SKIP: local DB has other Super Admins; fixtures would be ambiguous"; exit 1; fi
sql "delete from auth.mfa_factors where friendly_name like 'qa22-6-%'; delete from auth.users where id='$UID_FIX';" >/dev/null
sql "insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values ('$UID_FIX','00000000-0000-0000-0000-000000000000','authenticated','authenticated','$EMAIL',now(),now()); update public.users set is_super_admin = true where id='$UID_FIX'; insert into auth.sessions (id, user_id, created_at, updated_at) values (gen_random_uuid(),'$UID_FIX',now(),now());" >/dev/null || { echo "FAIL fixture setup"; exit 1; }

factors() { # $1 verified count, $2 unverified count
  sql "delete from auth.mfa_factors where friendly_name like 'qa22-6-%';" >/dev/null
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
run node $RESET $EMAIL --apply --operator $OP <<<"reset $EMAIL"
check "reset apply exit 0" "$rc" "0"
check "  factors gone" "$(sql "select count(*) from auth.mfa_factors where user_id='$UID_FIX'")" "0"
check "  sessions gone" "$(sql "select count(*) from auth.sessions where user_id='$UID_FIX'")" "0"
check "  flag off" "$(flag)" "f"
check "  one audit row" "$(audit_n super_admin_factors_reset)" "1"
check "  audit has no secret" "$(sql "select count(*) from public.audit_log where actor_display_name='operator:$OP' and metadata::text like '%QA226SECRET%'")" "0"

[ "$fail" = 0 ] && echo "super-admin-aal2: all passed" || { echo "super-admin-aal2: FAILED"; exit 1; }
