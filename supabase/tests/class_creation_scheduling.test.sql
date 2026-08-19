-- Story 12.1: Class Creation & Scheduling. New tables (classes,
-- class_sessions), RLS policies, and materializer functions from
-- 0057_class_creation_scheduling.sql. Fixture/session-simulation
-- conventions match membership_plans_rls.test.sql/quiet_gym_alerts.test.sql:
-- deterministic UUIDs, transaction + plan(...), finish(), rollback.

begin;
select plan(24);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000007001', 'Classes Test Tier', 5000, 50000, 30);

insert into gyms (id, name, tier_id, timezone) values
  ('00000000-0000-0000-0000-000000007011', 'Classes Gym A', '00000000-0000-0000-0000-000000007001', 'Africa/Douala'),
  ('00000000-0000-0000-0000-000000007012', 'Classes Gym B', '00000000-0000-0000-0000-000000007001', 'Africa/Douala');

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000007021'), -- Gym A owner
  ('00000000-0000-0000-0000-000000007022'), -- Gym A manager
  ('00000000-0000-0000-0000-000000007023'), -- Gym B owner
  ('00000000-0000-0000-0000-000000007024'), -- Gym A receptionist
  ('00000000-0000-0000-0000-000000007025'), -- Gym A coach
  ('00000000-0000-0000-0000-000000007026'); -- Gym B coach

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000007031', '00000000-0000-0000-0000-000000007011', '00000000-0000-0000-0000-000000007021', 'owner', 'Classes Gym A Owner'),
  ('00000000-0000-0000-0000-000000007032', '00000000-0000-0000-0000-000000007011', '00000000-0000-0000-0000-000000007022', 'manager', 'Classes Gym A Manager'),
  ('00000000-0000-0000-0000-000000007033', '00000000-0000-0000-0000-000000007012', '00000000-0000-0000-0000-000000007023', 'owner', 'Classes Gym B Owner'),
  ('00000000-0000-0000-0000-000000007034', '00000000-0000-0000-0000-000000007011', '00000000-0000-0000-0000-000000007024', 'receptionist', 'Classes Gym A Receptionist'),
  ('00000000-0000-0000-0000-000000007035', '00000000-0000-0000-0000-000000007011', '00000000-0000-0000-0000-000000007025', 'coach', 'Classes Gym A Coach'),
  ('00000000-0000-0000-0000-000000007036', '00000000-0000-0000-0000-000000007012', '00000000-0000-0000-0000-000000007026', 'coach', 'Classes Gym B Coach');

-- ============================================================================
-- Manager/Owner can INSERT a class in their own gym.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000007021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000007011","app_role":"owner"}',
  true
);

select lives_ok(
  $$insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, one_off_session_at)
    values ('00000000-0000-0000-0000-000000007041', '00000000-0000-0000-0000-000000007011', 'Owner-Created Yoga', '00000000-0000-0000-0000-000000007035', 10, 'one_off', now() + interval '3 days')$$,
  'an owner-claim session can INSERT a class into its own gym'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000007022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000007011","app_role":"manager"}',
  true
);

select lives_ok(
  $$insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, recurrence_days, recurrence_time, recurrence_start_date)
    values ('00000000-0000-0000-0000-000000007042', '00000000-0000-0000-0000-000000007011', 'Manager-Created Spin', '00000000-0000-0000-0000-000000007035', 15, 'recurring', array[1,3]::smallint[], '09:00', current_date)$$,
  'a manager-claim session can INSERT a recurring class into its own gym'
);

-- ============================================================================
-- Cross-gym INSERT attempt is rejected (RLS-violation error).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000007023","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000007012","app_role":"owner"}',
  true
);

select throws_like(
  $$insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, one_off_session_at)
    values ('00000000-0000-0000-0000-000000007043', '00000000-0000-0000-0000-000000007011', 'Cross-Tenant Attempt', '00000000-0000-0000-0000-000000007035', 10, 'one_off', now() + interval '1 day')$$,
  '%row-level security%',
  'an owner-claim session at a different gym cannot INSERT into gym A''s classes'
);

-- ============================================================================
-- Receptionist INSERT attempt is rejected (RLS-violation error, not a
-- silent no-op) -- and their UPDATE attempt affects 0 rows.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000007024","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000007011","app_role":"receptionist"}',
  true
);

select throws_like(
  $$insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, one_off_session_at)
    values ('00000000-0000-0000-0000-000000007044', '00000000-0000-0000-0000-000000007011', 'Receptionist Attempted Class', '00000000-0000-0000-0000-000000007035', 10, 'one_off', now() + interval '1 day')$$,
  '%row-level security%',
  'a receptionist-claim session cannot INSERT a class (RLS-violation error)'
);

with attempted as (
  update classes set capacity = 999
  where id = '00000000-0000-0000-0000-000000007041'
  returning id
)
select is(
  (select count(*)::int from attempted),
  0,
  'a receptionist-claim session''s UPDATE affects 0 rows -- silently denied, not an error'
);

select is(
  (select count(*)::int from classes),
  2,
  'a receptionist-claim session can SELECT its own gym''s classes'
);

reset role;

-- ============================================================================
-- classes_schedule_matches_type CHECK constraint traps -- the exact NULL-
-- defeats-CHECK risk 0017's own comment documents. Both directions.
-- ============================================================================
select throws_like(
  $$insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, one_off_session_at, recurrence_days)
    values ('00000000-0000-0000-0000-000000007045', '00000000-0000-0000-0000-000000007011', 'Bad One-Off', '00000000-0000-0000-0000-000000007035', 5, 'one_off', now() + interval '1 day', array[1]::smallint[])$$,
  '%classes_schedule_matches_type%',
  'a one-off class with a stray recurring field set is rejected'
);

select throws_like(
  $$insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, recurrence_days, recurrence_time)
    values ('00000000-0000-0000-0000-000000007046', '00000000-0000-0000-0000-000000007011', 'Bad Recurring', '00000000-0000-0000-0000-000000007035', 5, 'recurring', array[1]::smallint[], '09:00')$$,
  '%classes_schedule_matches_type%',
  'a recurring class missing recurrence_start_date is rejected'
);

-- ============================================================================
-- private.materialize_sessions_for_class(): one-off produces exactly one
-- session at the right timestamp.
-- ============================================================================
select private.materialize_sessions_for_class('00000000-0000-0000-0000-000000007041');

select is(
  (select count(*)::int from class_sessions where class_id = '00000000-0000-0000-0000-000000007041'),
  1,
  'materializing a one-off class produces exactly one class_sessions row'
);

select is(
  (select scheduled_at from class_sessions where class_id = '00000000-0000-0000-0000-000000007041'),
  (select one_off_session_at from classes where id = '00000000-0000-0000-0000-000000007041'),
  'the one-off session''s scheduled_at matches the class''s one_off_session_at'
);

-- ============================================================================
-- Recurring: produces the right count of rows across the 4-week window for
-- a given day-of-week pattern (Mon+Wed, so 2/week * 4 weeks -- allowing for
-- the current week's partial coverage, so between 7 and 9 sessions).
-- on conflict do nothing proven idempotent by calling it twice.
-- ============================================================================
select private.materialize_sessions_for_class('00000000-0000-0000-0000-000000007042');

select ok(
  (select count(*)::int from class_sessions where class_id = '00000000-0000-0000-0000-000000007042') between 7 and 9,
  'materializing a recurring Mon+Wed class produces between 7 and 9 sessions across the 4-week window'
);

select ok(
  bool_and(extract(dow from scheduled_at at time zone 'Africa/Douala')::smallint = any(array[1,3]::smallint[])),
  'every materialized recurring session falls on a Monday or Wednesday (local time)'
) from class_sessions where class_id = '00000000-0000-0000-0000-000000007042';

select private.materialize_sessions_for_class('00000000-0000-0000-0000-000000007042');
select ok(
  (select count(*)::int from class_sessions where class_id = '00000000-0000-0000-0000-000000007042') between 7 and 9,
  'calling the materializer twice does not duplicate recurring sessions (on conflict do nothing)'
);

-- ============================================================================
-- materialize_class_sessions(p_reschedule => true): deletes only future
-- sessions, leaves a past-dated fixture session untouched (AC #7).
-- ============================================================================
insert into class_sessions (id, gym_id, class_id, scheduled_at) values
  ('00000000-0000-0000-0000-000000007051', '00000000-0000-0000-0000-000000007011', '00000000-0000-0000-0000-000000007041', now() - interval '10 days');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000007021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000007011","app_role":"owner"}',
  true
);

update classes set one_off_session_at = now() + interval '20 days'
where id = '00000000-0000-0000-0000-000000007041';

select lives_ok(
  $$select materialize_class_sessions('00000000-0000-0000-0000-000000007041', true)$$,
  'an owner-claim session can call materialize_class_sessions with p_reschedule = true'
);

reset role;

select ok(
  exists(select 1 from class_sessions where id = '00000000-0000-0000-0000-000000007051'),
  'a past-dated fixture session survives a reschedule (future-only delete)'
);

select is(
  (select count(*)::int from class_sessions where class_id = '00000000-0000-0000-0000-000000007041' and scheduled_at > now()),
  1,
  'the reschedule regenerates exactly one future session matching the new one_off_session_at'
);

-- ============================================================================
-- create_class()/update_class(): atomic interactive entry points (Review
-- fix) -- the class row write and session materialization succeed or fail
-- together in one transaction, and update_class computes "did the schedule
-- change" itself via typed IS DISTINCT FROM comparisons in the same
-- transaction, rather than the dashboard's previous JS-side comparison of
-- serialized strings (which mismatched in format on nearly every edit,
-- making it a near-permanent false positive).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000007021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000007011","app_role":"owner"}',
  true
);

create temporary table atomic_test (class_id uuid, session_id uuid);

do $$
declare
  v_class_id uuid;
  v_session_id uuid;
begin
  v_class_id := create_class(
    'Atomic Create Test', null, '00000000-0000-0000-0000-000000007035', 8,
    'one_off', now() + interval '5 days', null, null, null
  );
  select id into v_session_id from class_sessions where class_id = v_class_id;
  insert into atomic_test (class_id, session_id) values (v_class_id, v_session_id);
end;
$$;

select isnt((select class_id from atomic_test), null, 'create_class returns a new class id');

select is(
  (select count(*)::int from class_sessions where class_id = (select class_id from atomic_test)),
  1,
  'create_class materializes exactly one session atomically with the insert'
);

select update_class(
  (select class_id from atomic_test), 'Atomic Create Test Renamed', null,
  '00000000-0000-0000-0000-000000007035', 8, 'one_off', now() + interval '5 days', null, null, null
);

select ok(
  exists(select 1 from class_sessions where id = (select session_id from atomic_test)),
  'update_class with only the name changed (schedule fields resubmitted unchanged) leaves the existing session row untouched'
);

select update_class(
  (select class_id from atomic_test), 'Atomic Create Test Renamed', null,
  '00000000-0000-0000-0000-000000007035', 8, 'one_off', now() + interval '9 days', null, null, null
);

select ok(
  not exists(select 1 from class_sessions where id = (select session_id from atomic_test)),
  'update_class with a genuinely changed one_off_session_at deletes the old session row'
);

select is(
  (select count(*)::int from class_sessions where class_id = (select class_id from atomic_test) and scheduled_at > now()),
  1,
  'update_class with a genuinely changed schedule regenerates exactly one new future session'
);

reset role;

-- ============================================================================
-- run_class_session_materializer_job(): extends an existing recurring
-- class's window and records a job_runs row.
-- ============================================================================
delete from class_sessions where class_id = '00000000-0000-0000-0000-000000007042';

select run_class_session_materializer_job();

select ok(
  (select count(*)::int from class_sessions where class_id = '00000000-0000-0000-0000-000000007042') between 7 and 9,
  'run_class_session_materializer_job() re-extends a recurring class''s window'
);

select is(
  (select count(*)::int from class_sessions where class_id = '00000000-0000-0000-0000-000000007041'),
  2,
  'run_class_session_materializer_job() does not touch a one-off class (still just the past fixture + the one reschedule-materialized session)'
);

select is(
  (select status from job_runs where job_name = 'class_session_materializer' order by started_at desc limit 1),
  'success',
  'run_class_session_materializer_job() records a success row in job_runs'
);

select * from finish();
rollback;
