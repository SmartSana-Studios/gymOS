#!/usr/bin/env bash
# Story 30.6 (NFR-029, FR-226): the server-time BASELINE of the engagement reads at the scale of a full gym. NOT a gate: it is not wired into
# scripts/ci-local.sh or .github/workflows/ci.yml, and its numbers only inform (a person records them in docs/decisions.md). Needs the local Supabase
# stack. Seeds a throwaway gym on the local database, runs the calls, and removes everything on exit (set -u trap; also at the start of a run).
#
#   scripts/engagement-load.sh               (a few minutes; the verdict is the LAST line: "load: measured" or "load: FAILED")
#   LOAD_ONLY=1 scripts/engagement-load.sh   (skips the max(member_cap) run: only the 2,000-member run)
#
# Scale. The gym is seeded twice, one after the other, and both runs print:
#   * max(tiers.member_cap) read at run time (a NULL cap is "unlimited" and is ignored; with no capped tier this run is skipped), and
#   * 2,000 members (the scale 30.5 timed my_visit_days at).
# Each member gets two years of attendance (about 8 visit days a month, so about a month of current history each, plus 23 months behind it), one
# check-in a day, one in ten members with no visit this month (unranked), and a mix of hidden, visible and notice-unseen members.
#
# Calls. For each of gym_leaderboard(current month), my_engagement(), my_visit_days(current month) and my_first_visit_day(), 50 calls as 50
# DIFFERENT members, 10 at a time, each in its own session as role `authenticated` with that member's claims. The figure is the time inside the
# function (clock_timestamp around one call), in milliseconds, so it is the server time the 2-second target (NFR-029) is measured against; the
# phone, the network and PostgREST are not in it (the on-device 4G figure is the owner's end-of-epic check). Prints p50, p95 and max per function.
# After the calls, EXPLAIN of the board's day query at that scale says whether it scans attendance_events sequentially (the 30.6 rule: add a
# supporting index only when the p95 of gym_leaderboard passes 1 second and the plan is a sequential scan; idx_attendance_events_gym_visit_day of
# 0173 already exists).
#
# The engagement epoch is set for the run (to the Monday of this week, only when it is NULL) so my_engagement does its real work, and put back on
# exit, with the audit rows that change wrote.
set -uo pipefail
DB=${DB_CONTAINER:-supabase_db_gym_os}
# Runs inside the DB container (it has bash and psql); from the host the script re-executes itself there, detached and polled. In the foreground
# `docker exec` has ended a script right after its first heredoc with exit 0 (Epic 20 retro R-1), so the verdict is the transcript's last line.
if [ -z "${LOAD_INSIDE:-}" ]; then
  docker exec -i "$DB" sh -c "cat > /tmp/ci-eng-load.sh" < "$0"
  docker exec "$DB" sh -c "rm -f /tmp/ci-eng-load.out"
  docker exec -d -e LOAD_INSIDE=1 -e LOAD_ONLY="${LOAD_ONLY:-}" -e LOAD_KEEP="${LOAD_KEEP:-}" "$DB" sh -c "bash /tmp/ci-eng-load.sh > /tmp/ci-eng-load.out 2>&1"
  shown=0
  for _ in $(seq 1 "${LOAD_TIMEOUT_POLLS:-900}"); do
    docker exec "$DB" sh -c "grep -q '^load:' /tmp/ci-eng-load.out 2>/dev/null" && break
    sleep 2
  done
  docker exec "$DB" sh -c "cat /tmp/ci-eng-load.out 2>/dev/null"
  docker exec "$DB" sh -c "grep -q '^load: measured' /tmp/ci-eng-load.out 2>/dev/null"
  exit $?
fi
psql_() { PGPASSWORD=postgres psql -U postgres -h 127.0.0.1 -At -v ON_ERROR_STOP=1 "$@"; }

T=00000000-0000-0000-0030-f00000000001
G=00000000-0000-0000-0030-f00000000002
# Fixture ids: users 00000000-0000-0000-0030-f1<10 hex digits>, members ...-f2<...>. The pattern below is what cleanup deletes.
STARTED=$(psql_ -c "select clock_timestamp()")
OLD_EPOCH=$(psql_ -c "select coalesce(release_week_start::text, '') from platform_engagement_config")
CALLS=50
PARALLEL=10

wipe() {
  psql_ <<SQL >/dev/null 2>&1
delete from attendance_events where gym_id = '$G';
delete from members where gym_id = '$G';
delete from users where id::text like '00000000-0000-0000-0030-f1%';
delete from auth.users where id::text like '00000000-0000-0000-0030-f1%';
SQL
}
cleanup() {
  wipe
  psql_ <<SQL >/dev/null 2>&1
delete from audit_log where gym_id = '$G';
delete from gyms where id = '$G';
delete from tiers where id = '$T';
SQL
  # The facts went with their members (there are none: nothing here settles), so the epoch guard allows the epoch back to what it was.
  if [ -z "$OLD_EPOCH" ]; then
    psql_ -c "update platform_engagement_config set release_week_start = null" >/dev/null 2>&1 || echo "warning: could not restore the epoch to NULL"
  else
    psql_ -c "update platform_engagement_config set release_week_start = date '$OLD_EPOCH'" >/dev/null 2>&1 || echo "warning: could not restore the epoch to $OLD_EPOCH"
  fi
  psql_ -c "delete from audit_log where action_type = 'platform_engagement_config_updated' and gym_id is null and created_at >= '$STARTED'" >/dev/null 2>&1
}
if [ -n "${LOAD_KEEP:-}" ]; then
  # Debug only: leave the seeded gym and the epoch in place for inspection. The next run (no LOAD_KEEP) cleans the fixtures but would read the epoch
  # left here as the original one, so put the epoch back by hand (`update platform_engagement_config set release_week_start = null`) first.
  trap 'echo "LOAD_KEEP: fixtures and the epoch left in place"' EXIT
else
  trap cleanup EXIT
fi
cleanup

psql_ <<SQL || { echo "FAIL: could not create the throwaway gym"; echo "load: FAILED"; exit 1; }
insert into tiers (id, name, monthly_price, annual_price, member_cap) values ('$T', 'Engagement Load Tier', 6000, 60000, null);
insert into gyms (id, name, tier_id, status, timezone, charge_guests_per_session) values ('$G', 'Engagement Load Gym', '$T', 'active', 'Africa/Douala', false);
SQL
if [ -z "$OLD_EPOCH" ]; then
  psql_ -c "update platform_engagement_config set release_week_start = date_trunc('week', (now() at time zone 'Africa/Douala'))::date" >/dev/null || { echo "FAIL: could not set the epoch"; echo "load: FAILED"; exit 1; }
fi

uid() { echo "00000000-0000-0000-0030-f1$(printf '%010x' "$1")"; }
mid() { echo "00000000-0000-0000-0030-f2$(printf '%010x' "$1")"; }
CUR=$(psql_ -c "select date_trunc('month', private.gym_today('$G'))::date")

seed() { # seed <members>
  local n=$1
  wipe
  psql_ <<SQL >/dev/null || return 1
insert into auth.users (id, email, email_confirmed_at)
select ('00000000-0000-0000-0030-f1' || lpad(to_hex(i), 10, '0'))::uuid, 'load-' || i || '@x.example', now() from generate_series(1, $n) i;
insert into members (id, gym_id, user_id, role, name, join_date)
select ('00000000-0000-0000-0030-f2' || lpad(to_hex(i), 10, '0'))::uuid, '$G', ('00000000-0000-0000-0030-f1' || lpad(to_hex(i), 10, '0'))::uuid, 'member',
       'LOAD' || i || ' MEMBER' || (i % 97), date '2024-01-05'
from generate_series(1, $n) i;
-- About 8 visit days a month for two years: one check-in every 3.8 days back from today (one in ten members starts 40 days back: no visit this month).
insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, checkout_type, visit_day)
select '$G', ('00000000-0000-0000-0030-f2' || lpad(to_hex(i), 10, '0'))::uuid,
       ((d.day) + time '06:00' + (i % 600) * interval '1 minute') at time zone 'Africa/Douala',
       ((d.day) + time '07:00' + (i % 600) * interval '1 minute') at time zone 'Africa/Douala',
       'manual', d.day
from generate_series(1, $n) i,
     lateral (select (private.gym_today('$G') - ((k * 3.8)::int + (i % 3) + case when i % 10 = 0 then 40 else 0 end))::date as day from generate_series(0, 191) k) d;
-- Mixed choices: two in three chose on the notice, and a third of those are hidden (the flag is the one the two writers switch).
begin;
select set_config('app.leaderboard_write', 'on', true);
update member_preferences set leaderboard_notice_seen_at = now(), leaderboard_hidden = (abs(hashtext(member_id::text)) % 3 = 0)
 where gym_id = '$G' and abs(hashtext(member_id::text)) % 3 <> 1;
select set_config('app.leaderboard_write', 'off', true);
commit;
SQL
  # Freshly inserted rows have no hint bits and no visibility map, and autovacuum would start on them in the middle of the calls: settle both first so
  # the calls measure the function, not the aftermath of the seed.
  psql_ -c "vacuum (analyze) attendance_events, members, member_preferences, auth.users, public.users" >/dev/null || return 1
}

# One timed call as member <i>: prints "MS <milliseconds>" (the time inside the function).
timed_call() { # timed_call <function-name> <i>
  local fn=$1 i=$2 u m call
  u=$(uid "$i"); m=$(mid "$i")
  case "$fn" in
    gym_leaderboard) call="perform count(*) from public.gym_leaderboard(date '$CUR')";;
    my_engagement) call="perform count(*) from public.my_engagement()";;
    my_visit_days) call="perform count(*) from public.my_visit_days(date '$CUR')";;
    my_first_visit_day) call="perform public.my_first_visit_day()";;
  esac
  psql_ 2>&1 <<SQL | sed -n 's/.*NOTICE:  MS \(.*\)/\1/p'
begin;
select set_config('request.jwt.claims', '{"sub":"$u","role":"authenticated","gym_id":"$G","app_role":"member"}', true);
set local role authenticated;
do \$\$ declare t0 timestamptz; begin t0 := clock_timestamp(); $call; raise notice 'MS %', round((extract(epoch from clock_timestamp() - t0) * 1000)::numeric, 2); end \$\$;
commit;
SQL
}
export -f timed_call uid mid psql_ 2>/dev/null

measure() { # measure <function-name> <members>: 50 calls as different members, 10 at a time; prints the line, sets P95
  local fn=$1 n=$2 out
  out=$(for k in $(seq 1 "$CALLS"); do echo $(( k * n / CALLS )); done | CUR=$CUR G=$G xargs -P "$PARALLEL" -I{} bash -c "timed_call $fn {}" | sort -n)
  local count; count=$(echo "$out" | grep -c .)
  if [ "$count" -lt "$CALLS" ]; then echo "FAIL: $fn answered $count of $CALLS calls"; FAILED=1; return; fi
  local p50 p95 max
  p50=$(echo "$out" | sed -n "$(( (CALLS + 1) / 2 ))p")
  p95=$(echo "$out" | sed -n "$(( (CALLS * 95 + 99) / 100 ))p")
  max=$(echo "$out" | tail -1)
  printf '  %-20s p50 %8s ms   p95 %8s ms   max %8s ms   (n=%s, %s at a time)\n' "$fn" "$p50" "$p95" "$max" "$count" "$PARALLEL"
  P95=$p95
}

FAILED=0
OVER=0
run_scale() { # run_scale <members> <label>
  local n=$1 label=$2
  echo "== $label: $n members, two years of attendance each =="
  local t0=$SECONDS
  seed "$n" || { echo "FAIL: seeding $n members failed"; FAILED=1; return; }
  local events; events=$(psql_ -c "select count(*) from attendance_events where gym_id = '$G'")
  local ranked; ranked=$(psql_ -c "select count(distinct member_id) from attendance_events where gym_id = '$G' and visit_day >= date '$CUR'")
  echo "  seeded in $((SECONDS - t0)) s: $events check-ins, $ranked members with a visit this month"
  if [ -n "${LOAD_KEEP:-}" ]; then echo "  LOAD_KEEP: seeded, calls skipped"; return; fi
  for fn in gym_leaderboard my_engagement my_visit_days my_first_visit_day; do
    P95=0
    measure "$fn" "$n"
    if [ "$fn" = gym_leaderboard ] && [ "${P95%.*}" -ge 1000 ] 2>/dev/null; then OVER=1; fi
  done
  echo "  plan of the board's day query (a sequential scan of attendance_events here would be the signal to add an index):"
  psql_ -c "explain select c.member_id, c.visit_day, min(c.checked_in_at) from attendance_counted c where c.gym_id = '$G' and c.visit_day >= date '$CUR' and c.visit_day < (date '$CUR' + interval '1 month')::date group by 1, 2" | sed 's/^/    /' | head -12
}

CAP=$(psql_ -c "select coalesce(max(member_cap), 0) from tiers where member_cap is not null and id <> '$T'")
echo "engagement load baseline, $(date -u +%Y-%m-%dT%H:%M:%SZ): server time inside the function, $CALLS calls as different members, $PARALLEL at a time"
echo "largest finite tier member_cap read at run time: ${CAP:-0} (NULL caps, the unlimited tiers, are ignored)"
if [ -n "${LOAD_ONLY:-}" ]; then
  echo "== max(member_cap): skipped (LOAD_ONLY=$LOAD_ONLY) =="
elif [ "${CAP:-0}" -gt 0 ] && [ "${CAP:-0}" -ne 2000 ]; then
  run_scale "$CAP" "max(member_cap)"
else
  echo "== max(member_cap): skipped (no finite cap, or it is 2,000 and the second run covers it) =="
fi
run_scale 2000 "2,000 members"

if [ "$OVER" = 1 ]; then echo "NOTE: the p95 of gym_leaderboard passed 1 second at one of these scales: check the plan above and add the supporting index (30.6 rule)."; fi
if [ "$FAILED" = 0 ]; then echo "load: measured"; else echo "load: FAILED"; fi
