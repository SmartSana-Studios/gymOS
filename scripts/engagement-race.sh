#!/usr/bin/env bash
# Story 30.2 (NFR-028, AD-53, AD-29): a real multi-session race between private.settle_engagement and a late offline private.record_check_in
# for ONE member. pgTAP runs one session, so it can show that the lock statement is the first statement of settle but not that a settle
# which starts first really cannot miss a visit that commits just before it. Needs the local Supabase stack. Commits fixtures under a
# throwaway gym (and sets the engagement epoch, restoring it on exit) and removes them on exit.
#
#   scripts/engagement-race.sh [iterations]     (default 8; the verdict is the LAST line: "race: all passed" or "race: FAILED")
#
# Per iteration, one member who already has two visit days (goal 3) in the week 2026-03-02, p_up_to = 2026-03-09 (that week has just closed):
#   * a third session holds the member lock;
#   * behind it, a settle and an OFFLINE check-in whose recorded time is Sunday 2026-03-08 of that week start at the same moment, in an
#     order that alternates by iteration (odd: settle queued first, even: check-in queued first);
#   * whichever commits first, afterwards: (1) the week is NOT left `missed` with the visit present and dirty_from unset, and (2) after one
#     more settle the week is revision-correct (met, 3 visits), derived state equals rebuild as jsonb, and dirty_from is clear;
#   * no session may report a deadlock.
# The case that catches a settle whose lock is not its first statement is "check-in queued first": a settle that reads member_visit_days
# before taking the lock counts two days, writes `missed`, and clears the dirty_from mark the check-in set while it was waiting.
#
# STAND-IN: the check-in session sets engagement_state.dirty_from itself, in the same transaction as the real private.record_check_in, as a
# stand-in for the mark Story 30.3 adds to record_check_in. Story 30.3 removes the stand-in (the mark then comes from record_check_in).
#
# Mutation check (Story 30.2, run once): move the settle lock after the member_visit_days read -> this script fails; restore it.
set -uo pipefail
DB=${DB_CONTAINER:-supabase_db_gym_os}
N=${1:-8}
# Runs inside the DB container (it has bash and psql); from the host the script re-executes itself there, detached and polled. In the
# foreground `docker exec` has ended a script right after its first heredoc with exit 0 (Epic 20 retro R-1), so the verdict is the
# transcript's last line, never an exit code.
if [ -z "${RACE_INSIDE:-}" ]; then
  docker exec -i "$DB" sh -c "cat > /tmp/ci-eng-race.sh" < "$0"
  docker exec "$DB" sh -c "rm -f /tmp/ci-eng-race.out"
  docker exec -d -e RACE_INSIDE=1 "$DB" sh -c "bash /tmp/ci-eng-race.sh $N > /tmp/ci-eng-race.out 2>&1"
  for _ in $(seq 1 ${RACE_TIMEOUT_POLLS:-150}); do
    docker exec "$DB" sh -c "grep -q '^race:' /tmp/ci-eng-race.out 2>/dev/null" && break
    sleep 2
  done
  docker exec "$DB" sh -c "cat /tmp/ci-eng-race.out 2>/dev/null"
  docker exec "$DB" sh -c "grep -q '^race: all passed' /tmp/ci-eng-race.out 2>/dev/null"
  exit $?
fi
psql_() { PGPASSWORD=postgres psql -U postgres -h 127.0.0.1 -At -v ON_ERROR_STOP=1 "$@"; }

T=00000000-0000-0000-0000-00000030f000
G=00000000-0000-0000-0000-00000030f001
PLAN=00000000-0000-0000-0000-00000030f010
HOLD_S=3          # seconds the lock holder keeps the member lock
WEEK=2026-03-02   # the epoch and the week under test
UP_TO=2026-03-09  # the week has just closed
LATE_AT='2026-03-08 20:00:00+01'   # Sunday evening, Africa/Douala: gym-local visit day 2026-03-08
STARTED=$(psql_ -c "select clock_timestamp()")
OLD_EPOCH=$(psql_ -c "select coalesce(release_week_start::text, '') from platform_engagement_config")

cleanup() {
  psql_ <<SQL >/dev/null
delete from audit_log where gym_id = '$G';
delete from attendance_events where gym_id = '$G';
delete from front_desk_alerts where gym_id = '$G';
delete from subscriptions where gym_id = '$G';
delete from plans where gym_id = '$G';
delete from members where gym_id = '$G';
delete from users where id::text like '00000000-0000-0000-0000-00000030f2%';
delete from auth.users where id::text like '00000000-0000-0000-0000-00000030f2%';
delete from gyms where id = '$G';
delete from tiers where id = '$T';
SQL
  # The facts went with their members, so the epoch guard allows the epoch back to what it was.
  if [ -n "${OLD_EPOCH+x}" ]; then
    if [ -z "$OLD_EPOCH" ]; then
      psql_ -c "update platform_engagement_config set release_week_start = null" >/dev/null 2>&1 || echo "warning: could not restore the epoch to NULL"
    else
      psql_ -c "update platform_engagement_config set release_week_start = date '$OLD_EPOCH'" >/dev/null 2>&1 || echo "warning: could not restore the epoch to $OLD_EPOCH"
    fi
    psql_ -c "delete from audit_log where action_type = 'platform_engagement_config_updated' and gym_id is null and created_at >= '$STARTED'" >/dev/null 2>&1
  fi
}
trap 'cleanup; rm -f /tmp/ci-eng-a.$$ /tmp/ci-eng-b.$$' EXIT
cleanup

psql_ <<SQL
insert into tiers (id, name, monthly_price, annual_price, member_cap) values ('$T', 'Engagement Race Tier', 6000, 60000, null);
insert into gyms (id, name, tier_id, status, timezone, charge_guests_per_session) values ('$G', 'Engagement Race Gym', '$T', 'active', 'Africa/Douala', false);
insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days) values
  ('$PLAN', '$G', 'Race Monthly', 'monthly', 15000, 'XAF', 'monthly', 30);
update platform_engagement_config set release_week_start = date '$WEEK';
SQL
if [ "$(psql_ -c "select release_week_start::text from platform_engagement_config")" != "$WEEK" ]; then
  echo "FAIL: could not set the epoch to $WEEK"; echo "race: FAILED"; exit 1
fi

fail=0
M=00000000-0000-0000-0000-00000030f3   # member prefix; the member of iteration <nn> is ${M}<nn> (two hex digits after the prefix)
U=00000000-0000-0000-0000-00000030f2

mk_member() { # mk_member <nn>: a member with an active subscription and two counted visit days (Mon, Wed) in the week under test
  local nn=$1
  psql_ <<SQL >/dev/null
insert into auth.users (id) values ('${U}${nn}');
insert into members (id, gym_id, user_id, role, name, join_date) values ('${M}${nn}', '$G', '${U}${nn}', 'member', 'Eng Race $nn', date '2026-01-05');
insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date) values ('$G', '${M}${nn}', '$PLAN', 'active', date '2026-01-05', date '2030-01-01');
insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, checkout_type, visit_day) values
  ('$G', '${M}${nn}', timestamptz '2026-03-02 10:00:00+01', timestamptz '2026-03-02 11:00:00+01', 'manual', date '2026-03-02'),
  ('$G', '${M}${nn}', timestamptz '2026-03-04 10:00:00+01', timestamptz '2026-03-04 11:00:00+01', 'manual', date '2026-03-04');
SQL
}
hold_lock() { # hold_lock <nn>: take the member lock for HOLD_S seconds in a third session
  psql_ -c "begin; select 1 from members where id = '${M}$1' for no key update; select pg_sleep($HOLD_S); commit;" >/dev/null
}
settle_sql() { echo "begin; select 'SETTLED ' || private.settle_engagement('${M}$1', '$G', date '$UP_TO'); commit;"; }
# The offline check-in, with the stand-in dirty mark in the SAME transaction (see the header).
checkin_sql() {
  echo "begin;
select set_config('request.jwt.claims', '{\"sub\":\"${U}$1\",\"role\":\"authenticated\",\"gym_id\":\"$G\",\"app_role\":\"member\"}', true);
select 'CHECKIN ' || (select outcome from private.record_check_in('${M}$1', '$G', 'qr', null, timestamptz '$LATE_AT', gen_random_uuid()));
insert into engagement_state (member_id, gym_id, dirty_from) values ('${M}$1', '$G', date '$WEEK')
  on conflict (member_id) do update set dirty_from = least(coalesce(engagement_state.dirty_from, excluded.dirty_from), excluded.dirty_from);
commit;"
}
waiting_count() { # sessions currently waiting on a lock inside settle or record_check_in
  psql_ -c "select count(*) from pg_stat_activity where wait_event_type = 'Lock' and (query like '%settle_engagement%' or query like '%record_check_in%') and query not like '%pg_stat_activity%'"
}
week_fact() { psql_ -c "select coalesce((select revision || ':' || outcome || ':' || goal || ':' || visits from engagement_facts where member_id = '${M}$1' and kind = 'week' and subject_key = '$WEEK' order by revision desc limit 1), 'none')"; }
dirty_of() { psql_ -c "select coalesce((select coalesce(dirty_from::text, 'null') from engagement_state where member_id = '${M}$1'), 'nostate')"; }

for i in $(seq 1 "$N"); do
  nn=$(printf '%02x' "$i")
  mk_member "$nn"
  if [ $((i % 2)) = 1 ]; then first=settle; second=checkin; else first=checkin; second=settle; fi
  hold_lock "$nn" & holder=$!
  sleep 0.6
  if [ "$first" = settle ]; then
    psql_ -c "$(settle_sql "$nn")" > /tmp/ci-eng-a.$$ 2>&1 & a=$!
  else
    psql_ -c "$(checkin_sql "$nn")" > /tmp/ci-eng-a.$$ 2>&1 & a=$!
  fi
  sleep 0.9
  if [ "$second" = settle ]; then
    psql_ -c "$(settle_sql "$nn")" > /tmp/ci-eng-b.$$ 2>&1 & b=$!
  else
    psql_ -c "$(checkin_sql "$nn")" > /tmp/ci-eng-b.$$ 2>&1 & b=$!
  fi
  sleep 0.5
  w=$(waiting_count)
  wait "$a"; wait "$b"; wait "$holder"

  out=$(cat /tmp/ci-eng-a.$$ /tmp/ci-eng-b.$$)
  deadlock=$(echo "$out" | grep -ci "deadlock")
  checked=$(echo "$out" | grep -c "CHECKIN checked_in")
  settled=$(echo "$out" | grep -c "^SETTLED ")
  visits=$(psql_ -c "select count(*) from member_visit_days where member_id = '${M}$nn'")
  fact_after=$(week_fact "$nn")
  dirty_after=$(dirty_of "$nn")

  # (1) the week is never left missed with the visit present and nothing marking it dirty
  stuck=0
  if [ "$visits" = 3 ] && [ "$fact_after" != "1:met:3:3" ] && [ "$fact_after" != "2:met:3:3" ] && { [ "$dirty_after" = null ] || [ "$dirty_after" = nostate ]; }; then stuck=1; fi

  # (2) one more settle: counted in the right week, derived equals rebuild, mark cleared
  psql_ -c "select private.settle_engagement('${M}$nn', '$G', date '$UP_TO')" >/dev/null
  fact_final=$(week_fact "$nn")
  dirty_final=$(dirty_of "$nn")
  same=$(psql_ -c "select (select to_jsonb(d) from private.engagement_derived_state('${M}$nn') d) = (select to_jsonb(r) from private.rebuild_engagement('${M}$nn', date '$UP_TO') r)")
  rows=$(psql_ -c "select count(*) from engagement_facts where member_id = '${M}$nn'")

  if [ "$deadlock" = 0 ] && [ "$checked" = 1 ] && [ "$settled" = 1 ] && [ "$visits" = 3 ] && [ "$stuck" = 0 ] \
     && { [ "$fact_final" = "1:met:3:3" ] || [ "$fact_final" = "2:met:3:3" ]; } && [ "$dirty_final" = null ] && [ "$same" = t ] && [ "${w:-0}" -ge 2 ]; then
    echo "ok   iteration $i ($first queued first): both sessions waited behind the holder (waiting=$w), week fact $fact_final, dirty_from clear, derived = rebuild, ledger rows=$rows (before the extra settle: $fact_after, dirty $dirty_after)"
  else
    echo "FAIL iteration $i ($first queued first): deadlocks=$deadlock check-ins=$checked settles=$settled visit days=$visits (want 3) waiting=$w (want >= 2)"
    echo "     fact before the extra settle=$fact_after dirty=$dirty_after stuck=$stuck; after: fact=$fact_final (want 1:met:3:3 or 2:met:3:3) dirty=$dirty_final (want null) derived=rebuild:$same"
    echo "$out" | sed 's/^/     | /'
    fail=1
  fi
  rm -f /tmp/ci-eng-a.$$ /tmp/ci-eng-b.$$
done

[ "$fail" = 0 ] && echo "race: all passed" || { echo "race: FAILED"; exit 1; }
