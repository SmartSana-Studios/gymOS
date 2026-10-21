#!/usr/bin/env bash
# Story 23.5: a real two-session race between the Owner switch setter and assign_support on one gym, against the LOCAL
# database (never production). Fixtures are committed (the sessions must see each other) and removed on exit.
#
#   run 1: switch ON, the Owner turns it OFF and holds the transaction open; assign_support starts meanwhile.
#          Expected: assign waits on private.support_gym_lock, then sees the switch off -> 'pending', no membership.
#   run 2: switch OFF, the Owner turns it ON and holds; assign_support starts meanwhile.
#          Expected: assign waits, then sees the switch on -> 'active' with a membership.
#   run 3: a pending assignment, switch ON, the Owner turns it OFF and holds; confirm_support_assignment starts meanwhile.
#          Expected: confirm waits, then refuses 'switch_off' (without the lock it would activate a membership under a switch that is off).
#   run 4: a suspended-by-switch assignment, switch OFF, the Owner turns it ON and holds; unassign_support starts meanwhile.
#          Expected: unassign waits, then ends the (restored) assignment and leaves no active membership.
#   Both: "an active support membership implies an active assignment and the switch on" holds afterwards, and assign finished
#   only after the Owner's transaction committed (compared by clock_timestamp()).
#
#   scripts/support-assignments-race.test.sh
# Like scripts/session-refund-race.sh it re-executes itself inside the DB container, detached and polled (a foreground
# `docker exec` has ended long scripts early with exit 0). The verdict is the last 'support-assignments-race:' line.
set -uo pipefail
DB=${DB_CONTAINER:-supabase_db_gym_os}
if [ -z "${RACE_INSIDE:-}" ]; then
  docker exec -i "$DB" sh -c "cat > /tmp/sa-race.sh" < "$0"
  docker exec "$DB" sh -c "rm -f /tmp/sa-race.out"
  docker exec -d -e RACE_INSIDE=1 "$DB" sh -c "bash /tmp/sa-race.sh > /tmp/sa-race.out 2>&1"
  for _ in $(seq 1 ${RACE_TIMEOUT_POLLS:-60}); do
    docker exec "$DB" sh -c "grep -q '^support-assignments-race:' /tmp/sa-race.out 2>/dev/null" && break
    sleep 2
  done
  docker exec "$DB" sh -c "cat /tmp/sa-race.out 2>/dev/null"
  docker exec "$DB" sh -c "grep -q '^support-assignments-race: all ok' /tmp/sa-race.out 2>/dev/null"
  exit $?
fi

psql_() { PGPASSWORD=postgres psql -U postgres -h 127.0.0.1 -At -v ON_ERROR_STOP=1 "$@" 2>&1; }
sql() { psql_ -c "$1"; }
P=00000000-0000-4000-8000-0000000235
GYM=${P}01; OWNER=${P}02; SADMIN=${P}03; SUP=${P}04; SESS=${P}05; TIER=${P}06
ORIG_FLAG=$(sql "select enabled from private.platform_flags where flag='super_admin_aal2'")

cleanup() {
  sql "delete from audit_log where target_entity_id in ('$SUP', '$GYM');
       delete from members where gym_id = '$GYM'; delete from support_assignments where gym_id = '$GYM';
       delete from private.support_accounts where user_id = '$SUP';
       delete from auth.sessions where id = '$SESS'; delete from gyms where id = '$GYM'; delete from tiers where id = '$TIER';
       delete from auth.users where id in ('$OWNER', '$SADMIN', '$SUP');
       update private.platform_flags set enabled = '$ORIG_FLAG' where flag = 'super_admin_aal2';" >/dev/null
}
trap cleanup EXIT
cleanup

sql "insert into tiers (id, name, monthly_price, annual_price, member_cap) values ('$TIER', 'Race Tier', 5000, 50000, 30);
     insert into gyms (id, name, tier_id, capacity, status, allow_gymos_support) values ('$GYM', 'Race Gym', '$TIER', 30, 'active', true);
     insert into auth.users (id, email, email_confirmed_at) values ('$OWNER', 'race-owner@x.example', now()), ('$SADMIN', 'race-admin@x.example', now()), ('$SUP', 'race-sup@gymosapps.com', now());
     update users set is_super_admin = true where id = '$SADMIN';
     insert into members (gym_id, user_id, role, name) values ('$GYM', '$OWNER', 'owner', 'Race Owner');
     insert into private.support_accounts (user_id, activated_at) values ('$SUP', now());
     insert into auth.sessions (id, user_id, created_at, updated_at) values ('$SESS', '$SADMIN', now(), now());
     update private.platform_flags set enabled = true where flag = 'super_admin_aal2';" >/dev/null || { echo "support-assignments-race: FAILED (fixture setup)"; exit 1; }

fail=0
check() { [ "$2" = "$3" ] && echo "ok   $1" || { echo "FAIL $1: expected '$3', got '$2'"; fail=1; }; }

# The Owner turns the switch, then keeps the transaction open for a few seconds (a busy query: pg_sleep is avoided on purpose).
owner_sql() {
  echo "begin; set local role authenticated;
select set_config('request.jwt.claims', '{\"sub\":\"$OWNER\",\"role\":\"authenticated\",\"aal\":\"aal2\",\"app_role\":\"owner\",\"gym_id\":\"$GYM\"}', true);
select set_allow_gymos_support('$GYM', $1);
reset role;
select 'owner_started';
select count(*) > 0 from generate_series(1, 25000000);
select 'owner_commit_at:' || clock_timestamp();
commit;"
}
admin_sql() { # $1 = the SQL expression under test (default: assign)
  echo "begin; set local role authenticated;
select set_config('request.jwt.claims', '{\"sub\":\"$SADMIN\",\"role\":\"authenticated\",\"aal\":\"aal2\",\"app_role\":\"super_admin\",\"session_id\":\"$SESS\"}', true);
select 'admin_start:' || clock_timestamp();
select 'result:' || ok || ':' || code from ${1:-"assign_support('$SUP', '$GYM', 'race test')"};
select 'admin_done:' || clock_timestamp();
commit;"
}

race() { # $1 = new switch value, $2 = expected result, $3 = expected active memberships, $4 = SQL under test (default: assign)
  [ -n "${4:-}" ] || sql "delete from members where role = 'support' and gym_id = '$GYM'; delete from support_assignments where gym_id = '$GYM';" >/dev/null
  owner_sql "$1" | psql_ > /tmp/sa-owner.out &
  local owner_pid=$!
  for _ in $(seq 1 50); do grep -q owner_started /tmp/sa-owner.out 2>/dev/null && break; sleep 0.1; done
  admin_sql "${4:-}" | psql_ > /tmp/sa-admin.out
  wait $owner_pid
  local res start done_ commit_
  res=$(sed -n 's/^result://p' /tmp/sa-admin.out | head -1)
  start=$(sed -n 's/^admin_start://p' /tmp/sa-admin.out | head -1)
  done_=$(sed -n 's/^admin_done://p' /tmp/sa-admin.out | head -1)
  commit_=$(sed -n 's/^owner_commit_at://p' /tmp/sa-owner.out | head -1)
  [ -n "$res" ] || { echo "---- admin session output:"; cat /tmp/sa-admin.out; echo "---- owner session output:"; cat /tmp/sa-owner.out; }
  check "switch -> $1: result" "$res" "$2"
  check "switch -> $1: call started before the Owner committed" "$(sql "select '$start'::timestamptz < '$commit_'::timestamptz")" "t"
  check "switch -> $1: call finished only after the Owner committed (it waited on the lock)" "$(sql "select '$done_'::timestamptz >= '$commit_'::timestamptz")" "t"
  check "switch -> $1: active support memberships" "$(sql "select count(*) from members where gym_id = '$GYM' and role = 'support' and deactivated_at is null")" "$3"
  check "switch -> $1: invariant (active membership implies active assignment and switch on)" "$(sql "select count(*) from members m where m.role = 'support' and m.deactivated_at is null and not exists (select 1 from support_assignments a join gyms g on g.id = a.gym_id where a.support_user_id = m.user_id and a.gym_id = m.gym_id and a.state = 'active' and g.allow_gymos_support)")" "0"
}

race false "true:pending" "0"
# Reset the fixture to switch OFF for the second direction (the guard trigger needs the setter flag).
sql "select set_config('gymos.allow_support_setter', 'on', true); update gyms set allow_gymos_support = false where id = '$GYM';" >/dev/null
race true "true:active" "1"

# Run as the real Super Admin / Owner for the seeds of runs 3 and 4 (outside the race).
as_admin() { echo "begin; set local role authenticated;
select set_config('request.jwt.claims', '{\"sub\":\"$SADMIN\",\"role\":\"authenticated\",\"aal\":\"aal2\",\"app_role\":\"super_admin\",\"session_id\":\"$SESS\"}', true);
$1
commit;" | psql_; }
as_owner() { echo "begin; set local role authenticated;
select set_config('request.jwt.claims', '{\"sub\":\"$OWNER\",\"role\":\"authenticated\",\"aal\":\"aal2\",\"app_role\":\"owner\",\"gym_id\":\"$GYM\"}', true);
$1
commit;" | psql_; }
reset_gym() { # $1 = switch value
  sql "delete from members where role = 'support' and gym_id = '$GYM'; delete from support_assignments where gym_id = '$GYM';
       select set_config('gymos.allow_support_setter', 'on', true); update gyms set allow_gymos_support = $1 where id = '$GYM';" >/dev/null
}

# Run 3: confirm vs the Owner switching OFF.
reset_gym false
as_admin "select assign_support('$SUP', '$GYM', 'race seed');" >/dev/null
sql "select set_config('gymos.allow_support_setter', 'on', true); update gyms set allow_gymos_support = true where id = '$GYM';" >/dev/null
AID=$(sql "select id from support_assignments where gym_id = '$GYM' and state = 'pending'")
race false "false:switch_off" "0" "confirm_support_assignment('$AID', 'race test')"

# Run 4: unassign vs the Owner switching ON (the assignment was suspended by the switch).
reset_gym true
as_admin "select assign_support('$SUP', '$GYM', 'race seed');" >/dev/null
as_owner "select set_allow_gymos_support('$GYM', false);" >/dev/null
AID=$(sql "select id from support_assignments where gym_id = '$GYM' and state = 'suspended'")
race true "true:ended" "0" "unassign_support('$AID', 'race test')"

[ "$fail" = "0" ] && echo "support-assignments-race: all ok" || echo "support-assignments-race: FAILED"
