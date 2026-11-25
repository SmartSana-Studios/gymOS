#!/usr/bin/env bash
# Story 28.2 (NFR-021): real two-session races on a Single-use gym. pgTAP runs one session, so it can assert the sequential equivalent and the
# backstops (single_use_check_in.negative.test.sql) but not the real interleaving. Needs the local Supabase stack. Commits fixtures under a
# throwaway gym and removes them on exit.
#
#   scripts/single-use-race.sh        (the verdict is the LAST line of the transcript: "race: all passed" or "race: FAILED")
#
# Case 1 (two simultaneous scans, one member, two usable paid sessions, behind a third session that holds the member lock): exactly one visit
#   is created, exactly one session is consumed (a single_use / visit row bound to that visit), exactly one stamp is earned; the other scan is
#   refused "already has an open check-in" and costs nothing (no attempt, no alert).
# Case 2 (an open visit past the limit, two simultaneous scans, two usable sessions): the stale visit is closed exactly once (one audit row,
#   at checked_in_at + limit), exactly one new visit and one new consumed session; the other scan is refused "already has an open check-in".
# Case 3 (refund of the only unused paid session vs a scan, both orders): exactly one outcome. Scan first -> a visit, the session consumed and
#   kept_consumed by the refund, the stamp earned then reversed (ledger 0/0). Refund first -> the session voided, the scan denied (one attempt,
#   no attendance row). Both outcomes must have occurred.
# Case 4 (Story 28.3: a class mark vs a scan, one member, two usable paid sessions, behind a third session that holds the member lock, the
#   arrival order forced by when each statement is started). Scan queued first -> one visit row, the class lands inside the open visit and costs
#   nothing: no class row, one consumed session, one stamp. Class queued first -> one class row and one visit row, two consumed sessions, two
#   stamps, one attendance row (the class wrote none). Either way each need consumed exactly one session, and the booking is attended.
set -uo pipefail
DB=${DB_CONTAINER:-supabase_db_gym_os}
N=${SINGLE_USE_RACE_ITERATIONS:-6}
# Runs inside the DB container (it has bash and psql); from the host the script re-executes itself there, detached and polled. In the
# foreground `docker exec` has ended a script right after its first heredoc with exit 0 (Epic 20 retro R-1), so the verdict is the
# transcript's last line, never an exit code.
if [ -z "${RACE_INSIDE:-}" ]; then
  docker exec -i "$DB" sh -c "cat > /tmp/su-race.sh" < "$0"
  docker exec "$DB" sh -c "rm -f /tmp/su-race.out"
  docker exec -d -e RACE_INSIDE=1 -e SINGLE_USE_RACE_ITERATIONS="$N" "$DB" sh -c "bash /tmp/su-race.sh > /tmp/su-race.out 2>&1"
  for _ in $(seq 1 ${RACE_TIMEOUT_POLLS:-150}); do
    docker exec "$DB" sh -c "grep -q '^race:' /tmp/su-race.out 2>/dev/null" && break
    sleep 2
  done
  docker exec "$DB" sh -c "cat /tmp/su-race.out 2>/dev/null"
  docker exec "$DB" sh -c "grep -q '^race: all passed' /tmp/su-race.out 2>/dev/null"
  exit $?
fi
psql_() { PGPASSWORD=postgres psql -U postgres -h 127.0.0.1 -At -v ON_ERROR_STOP=1 "$@"; }

T=00000000-0000-0000-0000-00000028f000
G=00000000-0000-0000-0000-00000028f001
OWNER_U=00000000-0000-0000-0000-00000028f200
PLAN=00000000-0000-0000-0000-00000028f010
HOLD_S=2   # seconds the lock holder keeps the member lock

cleanup() {
  psql_ <<SQL >/dev/null
delete from audit_log where gym_id = '$G';
delete from session_attempts where gym_id = '$G';
delete from refunds where gym_id = '$G';
delete from guest_sessions where gym_id = '$G';
delete from class_bookings where gym_id = '$G';
delete from class_sessions where gym_id = '$G';
delete from classes where gym_id = '$G';
delete from loyalty_events where gym_id = '$G';
delete from loyalty_progress where gym_id = '$G';
delete from attendance_events where gym_id = '$G';
delete from front_desk_alerts where gym_id = '$G';
delete from payments where gym_id = '$G';
delete from subscriptions where gym_id = '$G';
delete from plans where gym_id = '$G';
delete from members where gym_id = '$G';
delete from users where id::text like '00000000-0000-0000-0000-00000028f2%';
delete from auth.users where id::text like '00000000-0000-0000-0000-00000028f2%';
delete from gyms where id = '$G';
delete from tiers where id = '$T';
SQL
}
trap 'cleanup; rm -f /tmp/su-race-a.$$ /tmp/su-race-b.$$' EXIT
cleanup

psql_ <<SQL
insert into tiers (id, name, monthly_price, annual_price, member_cap) values ('$T', 'SU Race Tier', 6000, 60000, null);
insert into gyms (id, name, tier_id, status, charge_guests_per_session, registration_fee, session_validity,
                  loyalty_enabled, loyalty_guest_threshold, loyalty_renewal_threshold, loyalty_reward_days)
  values ('$G', 'SU Race Gym', '$T', 'active', true, 0, 'single_use', true, 4, 3, 10);
insert into auth.users (id) values ('$OWNER_U');
insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days)
  values ('$PLAN', '$G', 'SU Race PPS', 'pay_per_session', 2000, 'XAF', 'monthly', null);
-- Story 28.3: a manager (marks attendance and coaches the class) and one class.
insert into auth.users (id) values ('00000000-0000-0000-0000-00000028f2a1');
insert into members (id, gym_id, user_id, role, name, join_date)
  values ('00000000-0000-0000-0000-00000028f3a1', '$G', '00000000-0000-0000-0000-00000028f2a1', 'manager', 'SU Race Manager', current_date);
insert into auth.users (id) values ('00000000-0000-0000-0000-00000028f2a2');
insert into members (id, gym_id, user_id, role, name, join_date)
  values ('00000000-0000-0000-0000-00000028f3a2', '$G', '00000000-0000-0000-0000-00000028f2a2', 'coach', 'SU Race Coach', current_date);
insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, one_off_session_at)
  values ('00000000-0000-0000-0000-00000028f0c0', '$G', 'SU Race Class', '00000000-0000-0000-0000-00000028f3a2', 50, 'one_off', now() + interval '1 day');
SQL

fail=0
# member <hex>: user 00000028f2<hex>, member 00000028f3<hex>, payments 00000028f4<hex>, 00000028f5<hex>
mk_member() { # mk_member <hex>
  psql_ <<SQL >/dev/null
insert into auth.users (id) values ('00000000-0000-0000-0000-00000028f2$1');
insert into members (id, gym_id, user_id, role, name, join_date) values ('00000000-0000-0000-0000-00000028f3$1', '$G', '00000000-0000-0000-0000-00000028f2$1', 'member', 'SU Race $1', current_date);
insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date) values ('$G', '00000000-0000-0000-0000-00000028f3$1', '$PLAN', 'active', current_date, null);
SQL
}
mk_session() { # mk_session <hex> <payment-prefix f4|f5>
  psql_ <<SQL >/dev/null
insert into payments (id, gym_id, member_id, amount, currency, method, status, purpose) values ('00000000-0000-0000-0000-00000028$2$1', '$G', '00000000-0000-0000-0000-00000028f3$1', 2000, 'XAF', 'cash', 'verified', 'session');
insert into guest_sessions (gym_id, member_id, payment_id, usable_until, created_at) values ('$G', '00000000-0000-0000-0000-00000028f3$1', '00000000-0000-0000-0000-00000028$2$1', now() + interval '5 days', now() - interval '1 day');
SQL
}
scan_sql() { # scan_sql <hex>: one scan as the member; prints OK <id>, OK null (denied) or the error
  echo "begin; set local role authenticated; select set_config('request.jwt.claims', '{\"sub\":\"00000000-0000-0000-0000-00000028f2$1\",\"role\":\"authenticated\",\"gym_id\":\"$G\",\"app_role\":\"member\"}', true); select 'OK ' || coalesce((select id::text from check_in()), 'null'); commit;"
}
hold_lock() { # hold_lock <hex>
  psql_ -c "begin; select 1 from members where id = '00000000-0000-0000-0000-00000028f3$1' for no key update; select pg_sleep($HOLD_S); commit;" >/dev/null
}
Mid() { echo "00000000-0000-0000-0000-00000028f3$1"; }

# ---- case 1: two simultaneous scans, a fresh member, two usable sessions ----
for i in $(seq 1 3); do
  hex=$(printf '%02x' "$i")
  mk_member "$hex"; mk_session "$hex" f4; mk_session "$hex" f5
  hold_lock "$hex" & holder=$!
  sleep 0.6
  psql_ -c "$(scan_sql "$hex")" > /tmp/su-race-a.$$ 2>&1 & a=$!
  sleep 0.2
  psql_ -c "$(scan_sql "$hex")" > /tmp/su-race-b.$$ 2>&1 & b=$!
  wait "$a"; wait "$b"; wait "$holder"
  ok_count=$(cat /tmp/su-race-a.$$ /tmp/su-race-b.$$ | grep -c "^OK [0-9a-f]")
  refused=$(cat /tmp/su-race-a.$$ /tmp/su-race-b.$$ | grep -c "already has an open check-in")
  M=$(Mid "$hex")
  rows=$(psql_ -c "select count(*) from attendance_events where member_id = '$M'")
  open_rows=$(psql_ -c "select count(*) from attendance_events where member_id = '$M' and checked_out_at is null")
  consumed=$(psql_ -c "select count(*) from guest_sessions where member_id = '$M' and consumed_at is not null")
  bound=$(psql_ -c "select count(*) from guest_sessions s join attendance_events a on a.id = s.covered_attendance_id where s.member_id = '$M' and s.consumed_at is not null and s.validity_mode = 'single_use' and s.covered_kind = 'visit' and s.covered_day is null")
  stamps=$(psql_ -c "select count(*) from loyalty_events where member_id = '$M' and event_type = 'stamp_earned'")
  noise=$(psql_ -c "select (select count(*) from session_attempts where member_id = '$M') + (select count(*) from front_desk_alerts where member_id = '$M')")
  if [ "$ok_count" = 1 ] && [ "$refused" = 1 ] && [ "$rows" = 1 ] && [ "$open_rows" = 1 ] && [ "$consumed" = 1 ] && [ "$bound" = 1 ] && [ "$stamps" = 1 ] && [ "$noise" = 0 ]; then
    echo "ok   case 1 iteration $i: two simultaneous scans -> one visit, one session consumed and bound, one stamp, the other refused at no cost"
  else
    echo "FAIL case 1 iteration $i: successes=$ok_count refused=$refused rows=$rows open=$open_rows consumed=$consumed bound=$bound stamps=$stamps attempts+alerts=$noise (want 1/1/1/1/1/1/1/0)"
    cat /tmp/su-race-a.$$ /tmp/su-race-b.$$; fail=1
  fi
  rm -f /tmp/su-race-a.$$ /tmp/su-race-b.$$
done

# ---- case 2: an open visit past the limit (181 min, covered), two simultaneous scans, two usable sessions ----
hex=10
mk_member "$hex"; mk_session "$hex" f4; mk_session "$hex" f5
M=$(Mid "$hex")
psql_ <<SQL >/dev/null
insert into attendance_events (id, gym_id, member_id, checked_in_at, source) values ('00000000-0000-0000-0000-00000028f6$hex', '$G', '$M', now() - interval '181 minutes', 'qr');
insert into loyalty_events (id, gym_id, member_id, event_type, counter, origin_id) values ('00000000-0000-0000-0000-00000028f7$hex', '$G', '$M', 'reward_granted', 'guest', gen_random_uuid());
insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until, created_at, consumed_at, validity_mode, covered_kind, covered_attendance_id)
values ('$G', '$M', '00000000-0000-0000-0000-00000028f7$hex', now() + interval '5 days', now() - interval '1 day', now() - interval '181 minutes', 'single_use', 'visit', '00000000-0000-0000-0000-00000028f6$hex');
SQL
hold_lock "$hex" & holder=$!
sleep 0.6
psql_ -c "$(scan_sql "$hex")" > /tmp/su-race-a.$$ 2>&1 & a=$!
sleep 0.2
psql_ -c "$(scan_sql "$hex")" > /tmp/su-race-b.$$ 2>&1 & b=$!
wait "$a"; wait "$b"; wait "$holder"
ok_count=$(cat /tmp/su-race-a.$$ /tmp/su-race-b.$$ | grep -c "^OK [0-9a-f]")
refused=$(cat /tmp/su-race-a.$$ /tmp/su-race-b.$$ | grep -c "already has an open check-in")
rows=$(psql_ -c "select count(*) from attendance_events where member_id = '$M'")
open_rows=$(psql_ -c "select count(*) from attendance_events where member_id = '$M' and checked_out_at is null")
closed_ok=$(psql_ -c "select count(*) from attendance_events where id = '00000000-0000-0000-0000-00000028f6$hex' and checkout_type = 'auto' and checked_out_at = checked_in_at + interval '180 minutes'")
audits=$(psql_ -c "select count(*) from audit_log where action_type = 'attendance_stale_check_in_auto_closed' and target_entity_id = '00000000-0000-0000-0000-00000028f6$hex' and metadata ->> 'reason' = 'visit_limit'")
consumed=$(psql_ -c "select count(*) from guest_sessions where member_id = '$M' and consumed_at is not null")
if [ "$ok_count" = 1 ] && [ "$refused" = 1 ] && [ "$rows" = 2 ] && [ "$open_rows" = 1 ] && [ "$closed_ok" = 1 ] && [ "$audits" = 1 ] && [ "$consumed" = 2 ]; then
  echo "ok   case 2: two simultaneous scans on a stale visit -> closed once at +limit (one audit row), one new visit, one new session consumed"
else
  echo "FAIL case 2: successes=$ok_count refused=$refused rows=$rows open=$open_rows closed_ok=$closed_ok audits=$audits consumed=$consumed (want 1/1/2/1/1/1/2)"
  cat /tmp/su-race-a.$$ /tmp/su-race-b.$$; fail=1
fi
rm -f /tmp/su-race-a.$$ /tmp/su-race-b.$$

# ---- case 3: refund of the only unused session vs a scan, both arrival orders ----
n_voided=0
n_consumed=0
for i in $(seq 1 "$N"); do
  hex=$(printf '%02x' $((32 + i)))
  mk_member "$hex"; mk_session "$hex" f4
  M=$(Mid "$hex")
  P=00000000-0000-0000-0000-00000028f4$hex
  hold_lock "$hex" & holder=$!
  sleep 0.5
  refund_sql="insert into refunds (gym_id, payment_id, amount, reason, actor_id) values ('$G', '$P', 2000, 'race', '$OWNER_U');"
  if [ $((i % 2)) -eq 0 ]; then
    psql_ -c "$refund_sql" >/dev/null & r=$!; sleep 0.2
    psql_ -c "$(scan_sql "$hex")" > /tmp/su-race-a.$$ 2>&1 & s=$!
  else
    psql_ -c "$(scan_sql "$hex")" > /tmp/su-race-a.$$ 2>&1 & s=$!; sleep 0.2
    psql_ -c "$refund_sql" >/dev/null & r=$!
  fi
  wait "$r"; wait "$s"; wait "$holder"
  row=$(psql_ -c "select (voided_at is not null)::int || '|' || (consumed_at is not null)::int from guest_sessions where payment_id = '$P'")
  outcome=$(psql_ -c "select metadata ->> 'outcome' from audit_log where action_type = 'session_refund_applied' and target_entity_id = '$M'")
  att=$(psql_ -c "select count(*) from attendance_events where member_id = '$M'")
  attempts=$(psql_ -c "select count(*) from session_attempts where member_id = '$M' and source = 'check_in'")
  ledger=$(psql_ -c "select coalesce(sum(case event_type when 'stamp_earned' then 1 when 'stamp_reversed' then -1 else 0 end), 0)::int || '/' || coalesce((select guest_stamps from loyalty_progress where gym_id = '$G' and member_id = '$M'), 0) from loyalty_events where gym_id = '$G' and member_id = '$M' and counter = 'guest'")
  scanres=$(cat /tmp/su-race-a.$$ | grep "^OK " | tail -1)
  rm -f /tmp/su-race-a.$$
  case "$row/$outcome/$att/$attempts" in
    1\|0/voided/0/1) [ "$scanres" = "OK null" ] && { n_voided=$((n_voided + 1)); echo "ok   case 3 iteration $i: refund first -> session voided, scan denied (one attempt, no visit)"; } || { echo "FAIL case 3 iteration $i: refund first but scan said '$scanres'"; fail=1; } ;;
    0\|1/kept_consumed/1/0) n_consumed=$((n_consumed + 1)); echo "ok   case 3 iteration $i: scan first -> visit, session consumed, refund kept_consumed" ;;
    *) echo "FAIL case 3 iteration $i: voided|consumed=$row refund=$outcome attendance=$att attempts=$attempts scan='$scanres'"; fail=1 ;;
  esac
  if [ "$ledger" != "0/0" ]; then echo "FAIL case 3 iteration $i: loyalty ledger net/progress=$ledger (expected 0/0)"; fail=1; fi
done
if [ "$n_voided" -lt 1 ] || [ "$n_consumed" -lt 1 ]; then
  echo "FAIL case 3: expected both outcomes, got refund-first=$n_voided scan-first=$n_consumed"; fail=1
fi

# ---- case 4 (Story 28.3): a class mark vs a scan, the queue order forced, both orders twice ----
mark_sql() { # mark_sql <booking>: one class mark as the manager; prints OK <attended_at is set>
  echo "begin; set local role authenticated; select set_config('request.jwt.claims', '{\"sub\":\"00000000-0000-0000-0000-00000028f2a1\",\"role\":\"authenticated\",\"gym_id\":\"$G\",\"app_role\":\"manager\"}', true); select 'OK ' || (select (attended_at is not null)::text from mark_class_attendance('$1')); commit;"
}
for i in $(seq 1 4); do
  hex=$(printf '%02x' $((60 + i)))
  mk_member "$hex"; mk_session "$hex" f4; mk_session "$hex" f5
  M=$(Mid "$hex")
  CS=00000000-0000-0000-0000-00000028f8$hex
  B=00000000-0000-0000-0000-00000028f9$hex
  psql_ <<SQL >/dev/null
insert into class_sessions (id, gym_id, class_id, scheduled_at) values ('$CS', '$G', '00000000-0000-0000-0000-00000028f0c0', now() + interval '1 day' + make_interval(mins => $i));
insert into class_bookings (id, gym_id, class_session_id, member_id) values ('$B', '$G', '$CS', '$M');
SQL
  hold_lock "$hex" & holder=$!
  sleep 0.6
  if [ $((i % 2)) -eq 1 ]; then
    order="scan first"
    psql_ -c "$(scan_sql "$hex")" > /tmp/su-race-a.$$ 2>&1 & a=$!
    sleep 0.4
    psql_ -c "$(mark_sql "$B")" > /tmp/su-race-b.$$ 2>&1 & b=$!
    want="1/0/1/1/1/1"      # visit rows / class rows / consumed / stamps / attendance rows / attended
  else
    order="class first"
    psql_ -c "$(mark_sql "$B")" > /tmp/su-race-b.$$ 2>&1 & b=$!
    sleep 0.4
    psql_ -c "$(scan_sql "$hex")" > /tmp/su-race-a.$$ 2>&1 & a=$!
    want="1/1/2/2/1/1"
  fi
  wait "$a"; wait "$b"; wait "$holder"
  visit_rows=$(psql_ -c "select count(*) from guest_sessions s join attendance_events a on a.id = s.covered_attendance_id where s.member_id = '$M' and s.consumed_at is not null and s.validity_mode = 'single_use' and s.covered_kind = 'visit'")
  class_rows=$(psql_ -c "select count(*) from guest_sessions where member_id = '$M' and consumed_at is not null and validity_mode = 'single_use' and covered_kind = 'class' and covered_booking_id = '$B' and covered_day is null and covered_attendance_id is null")
  consumed=$(psql_ -c "select count(*) from guest_sessions where member_id = '$M' and consumed_at is not null")
  stamps=$(psql_ -c "select count(*) from loyalty_events where member_id = '$M' and event_type = 'stamp_earned'")
  att=$(psql_ -c "select count(*) from attendance_events where member_id = '$M'")
  attended=$(psql_ -c "select (attended_at is not null)::int from class_bookings where id = '$B'")
  scan_ok=$(grep -c "^OK [0-9a-f]" /tmp/su-race-a.$$)
  mark_ok=$(grep -c "^OK true" /tmp/su-race-b.$$)
  got="$visit_rows/$class_rows/$consumed/$stamps/$att/$attended"
  if [ "$got" = "$want" ] && [ "$scan_ok" = 1 ] && [ "$mark_ok" = 1 ]; then
    echo "ok   case 4 iteration $i ($order): visit/class/consumed/stamps/attendance/attended = $got"
  else
    echo "FAIL case 4 iteration $i ($order): visit/class/consumed/stamps/attendance/attended = $got (want $want), scan ok=$scan_ok mark ok=$mark_ok"
    cat /tmp/su-race-a.$$ /tmp/su-race-b.$$; fail=1
  fi
  rm -f /tmp/su-race-a.$$ /tmp/su-race-b.$$
done

[ "$fail" = 0 ] && echo "race: all passed" || { echo "race: FAILED"; exit 1; }
