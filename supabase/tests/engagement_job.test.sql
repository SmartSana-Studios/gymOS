-- Story 30.3 (AD-19, AD-53, NFR-029): the engagement_settle job (migration 0186), as far as one rolled-back transaction can show it.
--
-- private.engagement_settle_job() is a PROCEDURE that COMMITs after every member, and a COMMIT is refused inside a transaction block, so this
-- file cannot call it (it asserts that refusal, which is why the job is built from three functions it CAN call). It proves: the schedule, the
-- shape of the procedure (invoker, no SET clause), the candidate rule row by row (gym status, deactivated, role, dirty, stale settled_through,
-- NULL with history, up to date, epoch unset, epoch after the last closed week), keyset batches, the per-member function (settled, skipped,
-- an error that rolls the member's own writes back), ten members of which one fails, a re-run, and the job_runs row. The real call, the commit
-- after every member, `skip locked` against a second session and the epoch unset on the real procedure are scripts/engagement-race.sh, phase B.
--
-- The candidate rule reads the real gym-local day, so the dates here are relative to it (the last closed Monday) or fixed in the past
-- (visit days in March 2026); settle itself is driven with the real day too, as the job does.
--
-- Fixture ids: 00000000-0000-0000-0037-00000000nnnn. Gym 1001 (A, active), 1002 (S, suspended), users 2xxx, members 3xxx.

begin;
select plan(60);

create function pg_temp.id(p_kind int, p_n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0037-' || lpad((p_kind * 1000 + p_n)::text, 12, '0'))::uuid $f$;
create function pg_temp.m(p_n int) returns uuid language sql immutable as $f$ select pg_temp.id(3, p_n) $f$;

insert into tiers (id, name, monthly_price, annual_price, member_cap) values (pg_temp.id(0, 1), 'JB Tier', 6000, 60000, null);
-- A suspended gym is seeded suspended in its INSERT (a bare UPDATE of gyms.status is silently reverted).
insert into gyms (id, name, tier_id, status, timezone) values
  (pg_temp.id(1, 1), 'JB Gym A', pg_temp.id(0, 1), 'active', 'Africa/Douala'),
  (pg_temp.id(1, 2), 'JB Gym S', pg_temp.id(0, 1), 'suspended', 'Africa/Douala'),
  -- Two active gyms 25 hours apart (UTC+14 and UTC-11): at any instant at least one of them is on a different calendar date than UTC, so a
  -- `today` taken from the session or the UTC date instead of private.gym_today cannot hide behind Douala (UTC+1).
  (pg_temp.id(1, 3), 'JB Gym East', pg_temp.id(0, 1), 'active', 'Pacific/Kiritimati'),
  (pg_temp.id(1, 4), 'JB Gym West', pg_temp.id(0, 1), 'active', 'Pacific/Pago_Pago');
insert into auth.users (id, email, email_confirmed_at) select pg_temp.id(2, n), 'jb-' || n || '@x.example', now() from generate_series(1, 60) n;
-- 1 dirty, 2 stale settled_through, 3 history and no state row, 4 up to date, 5 no visit, 6 deactivated and dirty, 7 coach and dirty,
-- 8 member of the suspended gym and dirty, 9 owner and dirty, 10 visit only this week (the open week), 11 only pre-... history (a visit in March 2026).
-- 20-29: the ten members of the failing-member run (25 refuses). 30-33: keyset members.
insert into members (id, gym_id, user_id, role, name, join_date, deactivated_at)
select pg_temp.m(n),
       pg_temp.id(1, case when n = 8 then 2 else 1 end),
       pg_temp.id(2, n),
       (case when n = 7 then 'coach' when n = 9 then 'owner' else 'member' end)::member_role,
       'JB Member ' || n, date '2026-01-05',
       case when n = 6 then now() end
from generate_series(1, 60) n;

-- 61 (gym East) and 62 (gym West): dirty members, so each is a candidate whatever the week arithmetic says.
insert into auth.users (id, email, email_confirmed_at) select pg_temp.id(2, n), 'jb-' || n || '@x.example', now() from generate_series(61, 62) n;
insert into members (id, gym_id, user_id, role, name, join_date)
select pg_temp.m(n), pg_temp.id(1, case n when 61 then 3 else 4 end), pg_temp.id(2, n), 'member', 'JB Member ' || n, date '2026-01-05' from generate_series(61, 62) n;

create function pg_temp.visit(p_n int, p_day date) returns void language plpgsql as $f$
begin
  insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, checkout_type, visit_day)
  select m.gym_id, m.id, (p_day + time '10:00') at time zone 'Africa/Douala', (p_day + time '11:00') at time zone 'Africa/Douala', 'manual', p_day
  from members m where m.id = pg_temp.m(p_n);
end $f$;
create function pg_temp.today() returns date language sql stable as $f$ select private.gym_today(pg_temp.id(1, 1)) $f$;
create function pg_temp.lastclosed() returns date language sql stable as $f$ select private.week_start_of(pg_temp.today()) - 7 $f$;
create function pg_temp.num(p_member uuid) returns int language sql immutable as $f$ select (right(p_member::text, 4))::int - 3000 $f$;
-- The candidate members of the fixture gyms as a sorted list of member numbers (the last four digits of their ids, minus 3000).
create function pg_temp.cnums(p_after uuid default null, p_limit int default 1000) returns text language sql stable as $f$
  select coalesce(string_agg(pg_temp.num(c.member_id)::text, ',' order by c.member_id), '-')
  from private.engagement_settle_candidates(p_after, p_limit) c
  where c.gym_id in (pg_temp.id(1, 1), pg_temp.id(1, 2))
$f$;
create function pg_temp.settle_one(p_n int) returns text language sql as $f$
  select private.engagement_settle_member(pg_temp.m(p_n), (select gym_id from members where id = pg_temp.m(p_n)), pg_temp.today())
$f$;
create function pg_temp.nfacts(p_lo int, p_hi int) returns int language sql stable as $f$
  select count(*)::int from engagement_facts where member_id between pg_temp.m(p_lo) and pg_temp.m(p_hi) $f$;

-- ============================================================================
-- Schedule and shape
-- ============================================================================
select is((select count(*)::int from cron.job where jobname = 'engagement_settle'), 1, 'one engagement_settle cron job');
select is((select schedule from cron.job where jobname = 'engagement_settle'), '5 * * * *', 'it runs at five past every hour');
select is((select command from cron.job where jobname = 'engagement_settle'), 'call private.engagement_settle_job();', 'and calls the procedure');
select is((select p.prokind::text from pg_proc p where p.oid = 'private.engagement_settle_job()'::regprocedure), 'p', 'the job is a PROCEDURE');
select ok((select not p.prosecdef and p.proconfig is null from pg_proc p where p.oid = 'private.engagement_settle_job()'::regprocedure),
          'SECURITY INVOKER with no SET clause (either forbids COMMIT)');
select ok((select p.prosrc ~ 'commit;' from pg_proc p where p.oid = 'private.engagement_settle_job()'::regprocedure), 'it commits (after every member)');
select ok((select p.prosrc !~* 'commit' from pg_proc p where p.oid = 'private.engagement_settle_member(uuid, uuid, date)'::regprocedure),
          'the function with the exception block never COMMITs (a COMMIT inside an exception block is refused; the procedure commits after it returns)');
select ok((select p.prosrc ~* 'skip locked' and position('for no key update' in p.prosrc) < position('settle_engagement' in p.prosrc)
           from pg_proc p where p.oid = 'private.engagement_settle_member(uuid, uuid, date)'::regprocedure),
          'the member function takes the lock with skip locked BEFORE it settles');
select is((select count(*)::int from pg_proc p where p.oid in ('private.engagement_settle_candidates(uuid, integer)'::regprocedure, 'private.engagement_settle_member(uuid, uuid, date)'::regprocedure,
            'private.engagement_settle_record_run(timestamptz, integer, integer, text)'::regprocedure, 'private.engagement_settle_job()'::regprocedure)
            and (p.prosrc ~* 'check_in|record_check_in')), 0, 'the job shares no function or code path with check_in() (AD-19)');
select is(
  (select count(*)::int from unnest(array['private.engagement_settle_candidates(uuid, integer)', 'private.engagement_settle_member(uuid, uuid, date)',
     'private.engagement_settle_record_run(timestamptz, integer, integer, text)', 'private.engagement_settle_job()']) f,
     unnest(array['anon', 'authenticated', 'service_role', 'public']) r
   where has_function_privilege(r, to_regprocedure(f), 'execute')),
  0, 'none of the four is executable by anon, authenticated, service_role or PUBLIC');
select throws_ok($$call private.engagement_settle_job()$$, '2D000', null, 'the procedure COMMITs, so a call inside a transaction block is refused (the real call is proven in engagement-race.sh phase B)');

-- ============================================================================
-- The state of the fixtures (the epoch is still unset)
-- ============================================================================
select pg_temp.visit(n, date '2026-03-03') from generate_series(1, 11) n where n <> 5;
select pg_temp.visit(10, pg_temp.today());
insert into engagement_state (member_id, gym_id, dirty_from) values
  (pg_temp.m(1), pg_temp.id(1, 1), date '2026-03-02'),
  (pg_temp.m(6), pg_temp.id(1, 1), date '2026-03-02'),
  (pg_temp.m(7), pg_temp.id(1, 1), date '2026-03-02'),
  (pg_temp.m(8), pg_temp.id(1, 2), date '2026-03-02'),
  (pg_temp.m(9), pg_temp.id(1, 1), date '2026-03-02');
insert into engagement_state (member_id, gym_id, settled_through) values
  (pg_temp.m(2), pg_temp.id(1, 1), date '2026-03-02'),
  (pg_temp.m(4), pg_temp.id(1, 1), pg_temp.lastclosed());
-- Member 11's only visit is the one in March, and member 10's is today: set 10 back to "this week" only by deleting the March visit.
delete from attendance_events where member_id = pg_temp.m(10) and visit_day = date '2026-03-03';

select is((select release_week_start from platform_engagement_config), null::date, 'the epoch is unset (dark)');
select is(pg_temp.cnums(), '-', 'dark: no candidate at all, whatever is dirty or stale');

-- An epoch after the last closed week: only the dirty members (a mark is always settled) are candidates.
update platform_engagement_config set release_week_start = pg_temp.lastclosed() + 14;
select is(pg_temp.cnums(), '1', 'epoch after the last closed week: only the dirty active member (the stale and history-only members have no closed week to settle)');

update platform_engagement_config set release_week_start = pg_temp.lastclosed();
select is(pg_temp.cnums(), '1,2,3,11', 'epoch = the last closed Monday: that week is counted, so stale and history-only members are candidates again (member 10, whose only visit is in the open week, still is not)');
update platform_engagement_config set release_week_start = pg_temp.lastclosed() + 7;
select is(pg_temp.cnums(), '1', 'epoch = the open week: no closed week is counted, only the dirty member remains');

update platform_engagement_config set release_week_start = date '2026-03-02';
select is(pg_temp.cnums(), '1,2,3,11', 'epoch 2026-03-02: dirty (1), stale settled_through (2), history and no state row (3), March history (11); NOT member 10, whose only visit day is in the open week');
select is(pg_temp.cnums(), (select string_agg(n::text, ',' order by pg_temp.m(n)) from unnest(array[1, 2, 3, 11]) n), 'ordered by member id');
-- Parity: needs_settle of the view is "is a candidate", for every epoch-set, non-deactivated, role-member, active-gym member of the fixture.
select is(
  (select count(*)::int from unnest(array[1, 2, 3, 4, 5, 10, 11]) n
   where (select v.needs_settle from private.engagement_state_view(pg_temp.m(n)) v)
         is distinct from (pg_temp.m(n) in (select c.member_id from private.engagement_settle_candidates(null, 1000) c))),
  0, 'the view''s needs_settle equals "is a candidate" for every such fixture member (dirty, stale, history-only, up to date, no visit, open-week-only)');
select is((select count(*)::int from unnest(array[1, 2, 3, 4, 5, 10, 11]) n where (select v.needs_settle from private.engagement_state_view(pg_temp.m(n)) v)), 4,
          'and the parity is not vacuous: four of them need a settle');
select is(position(',4,' in ',' || pg_temp.cnums() || ','), 0, 'an up-to-date member (settled through the last closed week) is not a candidate');
select is(position(',5,' in ',' || pg_temp.cnums() || ','), 0, 'a member with no visit day and no mark is not a candidate');
select is(position(',6,' in ',' || pg_temp.cnums() || ','), 0, 'a deactivated member is not a candidate, dirty or not');
select is(position(',7,' in ',' || pg_temp.cnums() || ','), 0, 'a coach is not a candidate');
select is(position(',9,' in ',' || pg_temp.cnums() || ','), 0, 'an owner is not a candidate');
select is(position(',8,' in ',' || pg_temp.cnums() || ','), 0, 'a member of a suspended gym is not a candidate');
select is((select count(*)::int from private.engagement_settle_candidates(null, 1000) c where c.today <> private.gym_today(c.gym_id)), 0, 'each candidate carries its gym-local day');

-- A gym far from Douala: the candidate's `today` is that gym's own day, whichever side of the UTC date it falls on.
insert into engagement_state (member_id, gym_id, dirty_from) values
  (pg_temp.m(61), pg_temp.id(1, 3), date '2026-03-02'),
  (pg_temp.m(62), pg_temp.id(1, 4), date '2026-03-02');
select ok(private.gym_today(pg_temp.id(1, 3)) <> current_date or private.gym_today(pg_temp.id(1, 4)) <> current_date,
          'fixture: at least one far-zone gym is on a different calendar date than the session date, so the checks below are not vacuous');
select is((select count(*)::int from private.engagement_settle_candidates(null, 1000) c where c.gym_id in (pg_temp.id(1, 3), pg_temp.id(1, 4))), 2,
          'a dirty member of each far-zone gym is a candidate');
select is((select count(*)::int from private.engagement_settle_candidates(null, 1000) c
           where c.gym_id in (pg_temp.id(1, 3), pg_temp.id(1, 4)) and c.today = private.gym_today(c.gym_id)), 2,
          'each far-zone candidate carries its own gym-local day (not the session or UTC date)');
delete from engagement_state where member_id in (pg_temp.m(61), pg_temp.m(62));

-- Keyset batches: after a given id, at most p_limit rows, in id order.
select is(pg_temp.cnums(pg_temp.m(1), 2), '2,3', 'keyset: after member 1, a batch of 2 is 2 and 3');
select is(pg_temp.cnums(pg_temp.m(3), 2), '11', 'keyset: the next batch is 11 only');
select is(pg_temp.cnums(pg_temp.m(11), 2), '-', 'keyset: after the last candidate there is nothing');
select is(pg_temp.cnums(null, 1), '1', 'a batch of one starts at the smallest id');
select is((select count(*)::int from private.engagement_settle_candidates(null, 0) c where c.gym_id = pg_temp.id(1, 1)), 1, 'a limit below one is one');

-- ============================================================================
-- One member: settled, skipped, an error that undoes the member's own writes
-- ============================================================================
select is(pg_temp.settle_one(3), 'settled', 'a member is settled');
select cmp_ok(pg_temp.nfacts(3, 3), '>', 0, 'and week facts exist for them');
select is((select settled_through from engagement_state where member_id = pg_temp.m(3)), pg_temp.lastclosed(), 'settled_through is the last closed Monday');
select is(pg_temp.cnums(), '1,2,11', 'the settled member is no longer a candidate');
select is(private.engagement_settle_member(gen_random_uuid(), pg_temp.id(1, 1), pg_temp.today()), 'skipped', 'a member row that is not there is skipped');
select is(private.engagement_settle_member(pg_temp.m(1), pg_temp.id(1, 2), pg_temp.today()), 'skipped', 'a member given the wrong gym is skipped (the locked read matches nothing)');
select is(pg_temp.nfacts(1, 1), 0, 'and wrote nothing');
select is(pg_temp.settle_one(10), 'settled', 'a member whose only visit is this week is settled: nothing to write');
select is(pg_temp.nfacts(10, 10), 0, 'no fact for it (the open week never gets one)');
select is(pg_temp.cnums(), '1,2,11', 'and it is still not a candidate (nothing to settle until its first week closes)');

create function pg_temp.refuse() returns trigger language plpgsql as $f$
begin
  if new.member_id = pg_temp.m(2) then raise exception 'jb refuses member 2'; end if;
  return new;
end $f$;
create trigger refuse before insert on engagement_facts for each row execute function pg_temp.refuse();
select is(pg_temp.settle_one(2), 'error:member ' || pg_temp.m(2) || ': jb refuses member 2', 'a settle that raises is returned as error:member <id>: <message>, not raised');
select is(pg_temp.nfacts(2, 2), 0, 'the failed member has no fact (its partial writes were rolled back)');
select is((select settled_through::text from engagement_state where member_id = pg_temp.m(2)), '2026-03-02', 'its watermark is unchanged by the failed settle');
drop trigger refuse on engagement_facts;

-- ============================================================================
-- Ten members, one of which fails: nine settled, the failure reported by the member function
-- ============================================================================
select pg_temp.visit(n, date '2026-03-03') from generate_series(20, 29) n;
create function pg_temp.refuse25() returns trigger language plpgsql as $f$
begin
  if new.member_id = pg_temp.m(25) then raise exception 'jb refuses member 25'; end if;
  return new;
end $f$;
create trigger refuse25 before insert on engagement_facts for each row execute function pg_temp.refuse25();
-- The job's loop without its COMMITs: the candidates of the ten, each given to the member function.
create function pg_temp.run_ten() returns text language plpgsql as $f$
declare
  r record;
  v_res text;
  v_out text := '';
begin
  for r in select * from private.engagement_settle_candidates(null, 1000) c
           where c.member_id between pg_temp.m(20) and pg_temp.m(29) order by c.member_id loop
    v_res := private.engagement_settle_member(r.member_id, r.gym_id, r.today);
    v_out := v_out || pg_temp.num(r.member_id) || '=' || left(v_res, 7) || ' ';
  end loop;
  return rtrim(v_out);
end $f$;
select is(pg_temp.cnums(null, 1000) like '%20,21,22,23,24,25,26,27,28,29%', true, 'the ten members are candidates');
select is(pg_temp.run_ten(), '20=settled 21=settled 22=settled 23=settled 24=settled 25=error:m 26=settled 27=settled 28=settled 29=settled',
          'nine are settled and the failing member is reported without stopping the others');
select is((select count(distinct member_id)::int from engagement_facts where member_id between pg_temp.m(20) and pg_temp.m(29)), 9, 'nine members have facts');
select is(pg_temp.nfacts(25, 25), 0, 'the failing one has none');
select is(pg_temp.cnums(null, 1000), '1,2,11,25', 'the failing member stays a candidate for the next run (with the others)');
-- A re-run settles nothing.
create function pg_temp.fact_total() returns int language sql stable as $f$ select count(*)::int from engagement_facts $f$;
create temp table before_rerun as select pg_temp.fact_total() as n;
select pg_temp.run_ten();
select is(pg_temp.fact_total(), (select n from before_rerun), 'a re-run writes no fact');
drop trigger refuse25 on engagement_facts;
select is(pg_temp.settle_one(25), 'settled', 'with the refusal gone the failing member settles on the next run');
select is(pg_temp.cnums(null, 1000), '1,2,11', 'and is no longer a candidate');

-- ============================================================================
-- The job_runs row
-- ============================================================================
select private.engagement_settle_record_run(timestamptz '2026-03-23 03:05:00+00', 10, 0, null);
select is((select status::text || '|' || coalesce(error, 'null') from job_runs where job_name = 'engagement_settle' and started_at = timestamptz '2026-03-23 03:05:00+00'),
          'success|null', 'a run with no failure is logged success with no error');
select private.engagement_settle_record_run(timestamptz '2026-03-23 04:05:00+00', 10, 1, 'boom');
select is((select status::text || '|' || error from job_runs where job_name = 'engagement_settle' and started_at = timestamptz '2026-03-23 04:05:00+00'),
          'failure|1 of 10 members failed; first: boom', 'a failed run names the count, the total and the first error');
select private.engagement_settle_record_run(timestamptz '2026-03-23 05:05:00+00', 0, 1, 'read exploded');
select is((select status::text || '|' || error from job_runs where job_name = 'engagement_settle' and started_at = timestamptz '2026-03-23 05:05:00+00'),
          'failure|candidate read failed: read exploded', 'a failed candidate read (no member reached) says so instead of "1 of 0 members failed"');
select is((select count(*)::int from job_runs where job_name = 'engagement_settle' and started_at::date = date '2026-03-23' and finished_at >= started_at and finished_at is not null), 3, 'each run has finished_at after started_at (the three fixture runs; the real cron job may have logged its own)');

select * from finish();
rollback;
