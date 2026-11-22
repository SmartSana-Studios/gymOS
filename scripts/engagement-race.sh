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
# The mark that tells settle a week needs a recount comes from the REAL private.record_check_in (Story 30.3 adds it): the check-in session
# runs nothing but that function. (Story 30.2 used a stand-in here, an upsert beside the call; it is gone.)
#
# Phase B (Story 30.3) runs the real hourly job, private.engagement_settle_job(), by `call`, on committed fixtures. A procedure that COMMITs
# cannot run inside a transaction block, so pgTAP (one rolled-back transaction) cannot prove these; the pieces it can call are in
# engagement_job.test.sql. Here: ten members with one that refuses (nine settled and committed, status failure, the count and the first
# message), a re-run (success, nothing settled, no fact written), the commit after every member (a failure AFTER the loop leaves the members
# settled), a member whose lock another session holds (skipped, settled on the next run) and the epoch unset (success, no member touched).
#
# Mutation checks (run once, Story 30.2 and 30.3): move the settle lock after the member_visit_days read -> phase A fails; remove the dirty mark
# from record_check_in -> phase A fails; drop `skip locked` from private.engagement_settle_member -> phase B fails; restore all.
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
drop trigger if exists zz_eng_job_refuse on public.engagement_facts;
drop trigger if exists zz_eng_job_boom on public.job_runs;
drop function if exists public.zz_eng_job_refuse();
drop function if exists public.zz_eng_job_boom();
delete from job_runs where job_name = 'engagement_settle' and started_at >= '$STARTED';
delete from audit_log where gym_id = '$G';
delete from attendance_events where gym_id = '$G';
delete from front_desk_alerts where gym_id = '$G';
delete from subscriptions where gym_id = '$G';
delete from plans where gym_id = '$G';
delete from members where gym_id = '$G';
delete from users where id::text like '00000000-0000-0000-0000-00000030f2%' or id::text like '00000000-0000-0000-0000-00000030f6%';
delete from auth.users where id::text like '00000000-0000-0000-0000-00000030f2%' or id::text like '00000000-0000-0000-0000-00000030f6%';
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
# The offline check-in: the real function, which writes the dirty mark itself.
checkin_sql() {
  echo "begin;
select set_config('request.jwt.claims', '{\"sub\":\"${U}$1\",\"role\":\"authenticated\",\"gym_id\":\"$G\",\"app_role\":\"member\"}', true);
select 'CHECKIN ' || (select outcome from private.record_check_in('${M}$1', '$G', 'qr', null, timestamptz '$LATE_AT', gen_random_uuid()));
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


# ============================================================================================================================
# Phase B: the real job, by `call`, on committed fixtures (Story 30.3). The facts of a member are deleted with the member, so each scenario
# starts from an empty gym.
# ============================================================================================================================
JM=00000000-0000-0000-0000-00000030f5   # job member prefix; the member of scenario slot <nn> is ${JM}<nn>
JU=00000000-0000-0000-0000-00000030f6
wipe_members() {
  psql_ <<SQL >/dev/null
delete from attendance_events where gym_id = '$G';
delete from subscriptions where gym_id = '$G';
delete from members where gym_id = '$G';
delete from users where id::text like '00000000-0000-0000-0000-00000030f2%' or id::text like '00000000-0000-0000-0000-00000030f6%';
delete from auth.users where id::text like '00000000-0000-0000-0000-00000030f2%' or id::text like '00000000-0000-0000-0000-00000030f6%';
SQL
}
job_member() { # job_member <nn>: three counted visit days (Mon-Wed, goal 3, a met week) in the long-closed week 2026-03-02, never settled
  psql_ <<SQL >/dev/null
insert into auth.users (id) values ('${JU}$1');
insert into members (id, gym_id, user_id, role, name, join_date) values ('${JM}$1', '$G', '${JU}$1', 'member', 'Eng Job $1', date '2026-01-05');
insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, checkout_type, visit_day) values
  ('$G', '${JM}$1', timestamptz '2026-03-02 10:00:00+01', timestamptz '2026-03-02 11:00:00+01', 'manual', date '2026-03-02'),
  ('$G', '${JM}$1', timestamptz '2026-03-03 10:00:00+01', timestamptz '2026-03-03 11:00:00+01', 'manual', date '2026-03-03'),
  ('$G', '${JM}$1', timestamptz '2026-03-04 10:00:00+01', timestamptz '2026-03-04 11:00:00+01', 'manual', date '2026-03-04');
SQL
}
jfacts() { psql_ -c "select count(*) from engagement_facts where member_id = '${JM}$1'"; }
jlast() { psql_ -c "select status || '|' || coalesce(error, '') from job_runs where job_name = 'engagement_settle' and started_at >= '$STARTED' order by started_at desc limit 1"; }
jruns() { psql_ -c "select count(*) from job_runs where job_name = 'engagement_settle' and started_at >= '$STARTED'"; }
jcall() { psql_ -c "call private.engagement_settle_job()" 2>&1; }
bcheck() { # bcheck <name> <actual> <expected>
  if [ "$2" = "$3" ]; then echo "ok   phase B: $1"; else echo "FAIL phase B: $1 (got '$2', want '$3')"; fail=1; fi
}
bpositive() { # bcheck <name> <actual>: a count above zero
  if [ "${2:-0}" -gt 0 ] 2>/dev/null; then echo "ok   phase B: $1 ($2)"; else echo "FAIL phase B: $1 (got '$2', want > 0)"; fail=1; fi
}

phase_b() {
  wipe_members
  local others
  others=$(psql_ -c "select count(*) from private.engagement_settle_candidates(null, 100000) where gym_id <> '$G'")
  if [ "$others" != 0 ]; then
    echo "FAIL phase B: $others engagement candidates exist outside the fixture gym; the job would settle them. Run on a pristine database."
    fail=1; return
  fi

  # B1: ten members, one whose fact insert is refused. Nine are settled and committed; the run is a failure that names the count and the first message.
  local i nn n_ok=0
  for i in $(seq 1 10); do job_member "$(printf '%02x' "$i")"; done
  psql_ <<SQL >/dev/null
create function public.zz_eng_job_refuse() returns trigger language plpgsql as \$f\$ begin if new.member_id = '${JM}05' then raise exception 'job test: member 05 refuses'; end if; return new; end \$f\$;
create trigger zz_eng_job_refuse before insert on public.engagement_facts for each row execute function public.zz_eng_job_refuse();
SQL
  jcall > /dev/null
  for i in 1 2 3 4 6 7 8 9 10; do
    if [ "$(jfacts "$(printf '%02x' "$i")")" -gt 0 ]; then n_ok=$((n_ok + 1)); fi
  done
  bcheck "ten members, one refusing: nine are settled and committed" "$n_ok" 9
  bcheck "the refusing member has no fact" "$(jfacts 05)" 0
  bcheck "the run is a failure naming the count and the first error" "$(jlast)" "failure|1 of 10 members failed; first: job test: member 05 refuses"

  # B2: the refusal is gone: the next run settles the one left (success), and a run after that settles nothing and writes no fact.
  psql_ -c "drop trigger zz_eng_job_refuse on public.engagement_facts" >/dev/null
  jcall > /dev/null
  bpositive "the next run settles the member that failed" "$(jfacts 05)"
  bcheck "and that run is a success" "$(jlast)" "success|"
  local before after
  before=$(psql_ -c "select count(*) from engagement_facts where gym_id = '$G'")
  jcall > /dev/null
  after=$(psql_ -c "select count(*) from engagement_facts where gym_id = '$G'")
  bcheck "a re-run writes no fact" "$after" "$before"
  bcheck "a re-run is a success" "$(jlast)" "success|"
  bcheck "and no candidate is left" "$(psql_ -c "select count(*) from private.engagement_settle_candidates(null, 100) where gym_id = '$G'")" 0

  # B3: a COMMIT after every member. The run log insert is made to fail AFTER the loop: the call errors, yet the members are settled.
  local runs_before
  for nn in 0b 0c 0d; do job_member "$nn"; done
  psql_ <<SQL >/dev/null
create function public.zz_eng_job_boom() returns trigger language plpgsql as \$f\$ begin raise exception 'job test: run log refuses'; end \$f\$;
create trigger zz_eng_job_boom before insert on public.job_runs for each row when (new.job_name = 'engagement_settle') execute function public.zz_eng_job_boom();
SQL
  runs_before=$(jruns)
  local out
  out=$(jcall)
  psql_ -c "drop trigger zz_eng_job_boom on public.job_runs" >/dev/null
  case "$out" in *"run log refuses"*) echo "ok   phase B: the run log failure surfaced (the call errored)" ;; *) echo "FAIL phase B: the call did not fail; output: $out"; fail=1 ;; esac
  bcheck "the log row was not written" "$(jruns)" "$runs_before"
  bpositive "member 0b was settled and committed before the failure" "$(jfacts 0b)"
  bpositive "member 0c was settled and committed before the failure" "$(jfacts 0c)"
  bpositive "member 0d was settled and committed before the failure" "$(jfacts 0d)"

  # B4: a member whose lock another session holds is skipped (not a failure) and settled on the next run.
  job_member 0e; job_member 0f
  psql_ -c "begin; select 1 from members where id = '${JM}0e' for no key update; select pg_sleep(8); commit;" >/dev/null & local holder=$!
  sleep 1.5
  jcall > /dev/null
  bcheck "the locked member was skipped" "$(jfacts 0e)" 0
  bpositive "the other member was settled" "$(jfacts 0f)"
  bcheck "a skipped member is not a failure" "$(jlast)" "success|"
  wait "$holder"
  jcall > /dev/null
  bpositive "the next run settles the member that was locked" "$(jfacts 0e)"

  # B5: the epoch unset: success, no member touched (a dirty mark and an unsettled member are left exactly as they were).
  wipe_members
  job_member 10
  psql_ <<SQL >/dev/null
insert into engagement_state (member_id, gym_id, dirty_from) values ('${JM}10', '$G', date '2026-03-02');
update platform_engagement_config set release_week_start = null;
SQL
  local state_before state_after
  state_before=$(psql_ -c "select dirty_from || '|' || coalesce(settled_through::text, 'null') || '|' || updated_at from engagement_state where member_id = '${JM}10'")
  jcall > /dev/null
  state_after=$(psql_ -c "select dirty_from || '|' || coalesce(settled_through::text, 'null') || '|' || updated_at from engagement_state where member_id = '${JM}10'")
  bcheck "epoch unset: the run is a success" "$(jlast)" "success|"
  bcheck "epoch unset: no fact exists" "$(jfacts 10)" 0
  bcheck "epoch unset: the member's state is untouched" "$state_after" "$state_before"
}
phase_b

[ "$fail" = 0 ] && echo "race: all passed" || { echo "race: FAILED"; exit 1; }
