#!/usr/bin/env bash
# Story 27.2 (NFR-021): a real two-session race on the member lock that private.record_check_in takes FIRST, for every gym. pgTAP runs
# one session, so it can show that the lock statement is the first statement of the body (record_check_in.test.sql) but not that a second
# caller actually waits. Needs the local Supabase stack. Commits fixtures under throwaway gyms and removes them on exit.
#
#   scripts/check-in-member-lock-race.sh        (the verdict is the LAST line of the transcript: "race: all passed" or "race: FAILED")
#
# Case 1 (gym that does NOT charge for sessions) and case 2 (gym that does): a third session holds the member lock for 2 s; a scan
#   (check_in()) starts behind it. The scan must be seen WAITING on a lock (pg_stat_activity) and must not finish before the holder commits.
#   Before 0174 the non-charging scan did not take the lock at all, so case 1 is the one that proves this story.
# Case 3 and 4 (non-charging, then charging): two simultaneous scans for one member behind the holder. Exactly one open attendance row
#   afterwards, exactly one scan succeeded and the other was refused with "already has an open check-in"; at the charging gym exactly one
#   guest session is consumed.
set -uo pipefail
DB=${DB_CONTAINER:-supabase_db_gym_os}
# Runs inside the DB container (it has bash and psql); from the host the script re-executes itself there, detached and polled. In the
# foreground `docker exec` has ended a script right after its first heredoc with exit 0 (Epic 20 retro R-1), so the verdict is the
# transcript's last line, never an exit code.
if [ -z "${RACE_INSIDE:-}" ]; then
  docker exec -i "$DB" sh -c "cat > /tmp/ci-race.sh" < "$0"
  docker exec "$DB" sh -c "rm -f /tmp/ci-race.out"
  docker exec -d -e RACE_INSIDE=1 "$DB" sh -c "bash /tmp/ci-race.sh > /tmp/ci-race.out 2>&1"
  for _ in $(seq 1 ${RACE_TIMEOUT_POLLS:-120}); do
    docker exec "$DB" sh -c "grep -q '^race:' /tmp/ci-race.out 2>/dev/null" && break
    sleep 2
  done
  docker exec "$DB" sh -c "cat /tmp/ci-race.out 2>/dev/null"
  docker exec "$DB" sh -c "grep -q '^race: all passed' /tmp/ci-race.out 2>/dev/null"
  exit $?
fi
psql_() { PGPASSWORD=postgres psql -U postgres -h 127.0.0.1 -At -v ON_ERROR_STOP=1 "$@"; }

T=00000000-0000-0000-0000-00000027f000
G_OFF=00000000-0000-0000-0000-00000027f001
G_ON=00000000-0000-0000-0000-00000027f002
PLAN_M=00000000-0000-0000-0000-00000027f010
PLAN_P=00000000-0000-0000-0000-00000027f011
HOLD_S=2   # seconds the lock holder keeps the member lock

cleanup() {
  psql_ <<SQL >/dev/null
delete from loyalty_events where gym_id in ('$G_OFF', '$G_ON');
delete from loyalty_progress where gym_id in ('$G_OFF', '$G_ON');
delete from audit_log where gym_id in ('$G_OFF', '$G_ON');
delete from session_attempts where gym_id in ('$G_OFF', '$G_ON');
delete from guest_sessions where gym_id in ('$G_OFF', '$G_ON');
delete from attendance_events where gym_id in ('$G_OFF', '$G_ON');
delete from front_desk_alerts where gym_id in ('$G_OFF', '$G_ON');
delete from payments where gym_id in ('$G_OFF', '$G_ON');
delete from subscriptions where gym_id in ('$G_OFF', '$G_ON');
delete from plans where gym_id in ('$G_OFF', '$G_ON');
delete from members where gym_id in ('$G_OFF', '$G_ON');
delete from users where id::text like '00000000-0000-0000-0000-00000027f%';
delete from auth.users where id::text like '00000000-0000-0000-0000-00000027f%';
delete from gyms where id in ('$G_OFF', '$G_ON');
delete from tiers where id = '$T';
SQL
}
trap 'cleanup; rm -f /tmp/ci-race-a.$$ /tmp/ci-race-b.$$' EXIT
cleanup

psql_ <<SQL
insert into tiers (id, name, monthly_price, annual_price, member_cap) values ('$T', 'Lock Race Tier', 6000, 60000, null);
insert into gyms (id, name, tier_id, status, charge_guests_per_session, registration_fee) values
  ('$G_OFF', 'Lock Race Off', '$T', 'active', false, 0),
  ('$G_ON',  'Lock Race On',  '$T', 'active', true,  0);
insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days) values
  ('$PLAN_M', '$G_OFF', 'Race Monthly', 'monthly',         15000, 'XAF', 'monthly', 30),
  ('$PLAN_P', '$G_ON',  'Race PPS',     'pay_per_session', 2000,  'XAF', 'monthly', null);
SQL

fail=0
# member <n> in gym <g>: user 00000027f2<n>, member 00000027f3<n>, payment 00000027f4<n>
mk_member() { # mk_member <n> <gym> <plan> <expiry-sql>
  local n=$1 g=$2 plan=$3 expiry=$4
  psql_ <<SQL >/dev/null
insert into auth.users (id) values ('00000000-0000-0000-0000-00000027f2$n');
insert into members (id, gym_id, user_id, role, name, join_date) values ('00000000-0000-0000-0000-00000027f3$n', '$g', '00000000-0000-0000-0000-00000027f2$n', 'member', 'Lock Race $n', current_date);
insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date) values ('$g', '00000000-0000-0000-0000-00000027f3$n', '$plan', 'active', current_date, $expiry);
SQL
}
mk_session() { # a verified session payment and its usable session
  local n=$1 g=$2
  psql_ <<SQL >/dev/null
insert into payments (id, gym_id, member_id, amount, currency, method, status, purpose) values ('00000000-0000-0000-0000-00000027f4$n', '$g', '00000000-0000-0000-0000-00000027f3$n', 2000, 'XAF', 'cash', 'verified', 'session');
insert into guest_sessions (gym_id, member_id, payment_id, usable_until) values ('$g', '00000000-0000-0000-0000-00000027f3$n', '00000000-0000-0000-0000-00000027f4$n', now() + interval '5 days');
SQL
}
scan_sql() { # scan_sql <n> <gym>: one scan as member <n>; prints OK <id> or ERR <message>
  local n=$1 g=$2
  echo "begin; set local role authenticated; select set_config('request.jwt.claims', '{\"sub\":\"00000000-0000-0000-0000-00000027f2$n\",\"role\":\"authenticated\",\"gym_id\":\"$g\",\"app_role\":\"member\"}', true); select 'OK ' || coalesce((select id::text from check_in()), 'null'); commit;"
}
hold_lock() { # hold_lock <n>: take the member lock for HOLD_S seconds in a third session
  psql_ -c "begin; select 1 from members where id = '00000000-0000-0000-0000-00000027f3$1' for no key update; select pg_sleep($HOLD_S); commit;" >/dev/null
}
waiting_count() { # sessions currently waiting on a lock inside check_in()
  psql_ -c "select count(*) from pg_stat_activity where wait_event_type = 'Lock' and query like '%check_in()%' and query not like '%pg_stat_activity%'"
}
now_ms() { local t=${EPOCHREALTIME/./}; echo $((t / 1000)); }   # bash 5: the container date has no sub-second format

# ---- cases 1 and 2: a single scan must wait for the lock holder ----
for case in "1 01 $G_OFF $PLAN_M current_date+30 non-charging" "2 02 $G_ON $PLAN_P null charging"; do
  set -- $case
  c=$1 n=$2 g=$3 plan=$4 expiry=$5 label=$6
  mk_member "$n" "$g" "$plan" "$expiry"
  [ "$label" = charging ] && mk_session "$n" "$g"
  hold_lock "$n" & holder=$!
  sleep 0.6
  start=$(now_ms)
  out=$(psql_ -c "$(scan_sql "$n" "$g")" 2>&1 | tail -1) & scan=$!
  # sample the wait while the holder still holds the lock
  sleep 0.8
  w=$(waiting_count)
  wait "$scan"; wait "$holder"
  end=$(now_ms)
  elapsed=$((end - start))
  rows=$(psql_ -c "select count(*) from attendance_events where member_id = '00000000-0000-0000-0000-00000027f3$n'")
  if [ "${w:-0}" -ge 1 ] && [ "$elapsed" -ge 1000 ] && [ "$rows" = 1 ]; then
    echo "ok   case $c ($label): the scan waited on the member lock (waiting sessions=$w, ${elapsed} ms) and then checked in (rows=$rows)"
  else
    echo "FAIL case $c ($label): waiting sessions=$w, elapsed=${elapsed} ms (needs >= 1000 and a waiter), attendance rows=$rows"; fail=1
  fi
done

# ---- cases 3 and 4: two simultaneous scans, one member ----
for case in "3 03 $G_OFF $PLAN_M current_date+30 non-charging" "4 04 $G_ON $PLAN_P null charging"; do
  set -- $case
  c=$1 n=$2 g=$3 plan=$4 expiry=$5 label=$6
  mk_member "$n" "$g" "$plan" "$expiry"
  [ "$label" = charging ] && mk_session "$n" "$g"
  hold_lock "$n" & holder=$!
  sleep 0.6
  psql_ -c "$(scan_sql "$n" "$g")" > /tmp/ci-race-a.$$ 2>&1 & a=$!
  sleep 0.2
  psql_ -c "$(scan_sql "$n" "$g")" > /tmp/ci-race-b.$$ 2>&1 & b=$!
  wait "$a"; wait "$b"; wait "$holder"
  ok_count=$(cat /tmp/ci-race-a.$$ /tmp/ci-race-b.$$ | grep -c "^OK ")
  refused=$(cat /tmp/ci-race-a.$$ /tmp/ci-race-b.$$ | grep -c "already has an open check-in")
  open_rows=$(psql_ -c "select count(*) from attendance_events where member_id = '00000000-0000-0000-0000-00000027f3$n' and checked_out_at is null")
  all_rows=$(psql_ -c "select count(*) from attendance_events where member_id = '00000000-0000-0000-0000-00000027f3$n'")
  consumed=$(psql_ -c "select count(*) from guest_sessions where member_id = '00000000-0000-0000-0000-00000027f3$n' and consumed_at is not null")
  want_consumed=0; [ "$label" = charging ] && want_consumed=1
  if [ "$ok_count" = 1 ] && [ "$refused" = 1 ] && [ "$open_rows" = 1 ] && [ "$all_rows" = 1 ] && [ "$consumed" = "$want_consumed" ]; then
    echo "ok   case $c ($label): two simultaneous scans -> one success, one refused, one open row, sessions consumed=$consumed"
  else
    echo "FAIL case $c ($label): successes=$ok_count refused=$refused open rows=$open_rows rows=$all_rows consumed=$consumed (want 1/1/1/1/$want_consumed)"
    cat /tmp/ci-race-a.$$ /tmp/ci-race-b.$$; fail=1
  fi
  rm -f /tmp/ci-race-a.$$ /tmp/ci-race-b.$$
done

[ "$fail" = 0 ] && echo "race: all passed" || { echo "race: FAILED"; exit 1; }
