-- Story 12.1 negative privilege contract: the internal materialization
-- helper and the daily top-up job are server-only, even though
-- service_role/Postgres can operate them. Mirrors
-- quiet_gym_alerts.negative.test.sql's shape; asserts each privilege
-- individually rather than a comma-joined any-of check.

begin;
select plan(14);

select ok(not has_function_privilege('authenticated', 'private.materialize_sessions_for_class(uuid)', 'EXECUTE'), 'authenticated cannot execute the internal session materializer');
select ok(not has_function_privilege('anon', 'private.materialize_sessions_for_class(uuid)', 'EXECUTE'), 'anon cannot execute the internal session materializer');
select ok(not has_function_privilege('authenticated', 'run_class_session_materializer_job()', 'EXECUTE'), 'authenticated cannot execute the daily top-up job');
select ok(not has_function_privilege('anon', 'run_class_session_materializer_job()', 'EXECUTE'), 'anon cannot execute the daily top-up job');

set local role authenticated;
select throws_like(
  $$select private.materialize_sessions_for_class('00000000-0000-0000-0000-000000000001')$$,
  '%permission denied%',
  'authenticated cannot call the internal session materializer directly'
);
select throws_like(
  $$select run_class_session_materializer_job()$$,
  '%permission denied%',
  'authenticated cannot forge a run of the daily top-up job'
);
reset role;

set local role anon;
select throws_like(
  $$select private.materialize_sessions_for_class('00000000-0000-0000-0000-000000000001')$$,
  '%permission denied%',
  'anon cannot call the internal session materializer directly'
);
select throws_like(
  $$select run_class_session_materializer_job()$$,
  '%permission denied%',
  'anon cannot forge a run of the daily top-up job'
);
reset role;

-- A Receptionist session has zero effective INSERT/UPDATE privilege on
-- classes (RLS has no policy for that role/action combo) and zero
-- privilege on class_sessions entirely -- every class_sessions write goes
-- through the materializer functions above, never a direct client write.
insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000007101', 'Classes Negative Test Tier', 5000, 50000, 30);

insert into gyms (id, name, tier_id) values
  ('00000000-0000-0000-0000-000000007111', 'Classes Negative Test Gym', '00000000-0000-0000-0000-000000007101');

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000007121'), -- receptionist
  ('00000000-0000-0000-0000-000000007122'), -- owner
  ('00000000-0000-0000-0000-000000007124'); -- coach

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000007131', '00000000-0000-0000-0000-000000007111', '00000000-0000-0000-0000-000000007121', 'receptionist', 'Negative Test Receptionist'),
  ('00000000-0000-0000-0000-000000007132', '00000000-0000-0000-0000-000000007111', '00000000-0000-0000-0000-000000007122', 'owner', 'Negative Test Owner'),
  ('00000000-0000-0000-0000-000000007134', '00000000-0000-0000-0000-000000007111', '00000000-0000-0000-0000-000000007124', 'coach', 'Negative Test Coach');

-- Real fixture class, seeded as postgres (bypasses RLS), used below to
-- exercise class_sessions' all-roles write-denial and the Receptionist-
-- rejection path of the new RPCs against a real class id.
insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, one_off_session_at) values
  ('00000000-0000-0000-0000-000000007141', '00000000-0000-0000-0000-000000007111', 'Negative Test Fixture Class', '00000000-0000-0000-0000-000000007134', 5, 'one_off', now() + interval '1 day');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000007121","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000007111","app_role":"receptionist"}',
  true
);

select throws_like(
  $$insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, one_off_session_at)
    values ('00000000-0000-0000-0000-000000007142', '00000000-0000-0000-0000-000000007111', 'Forged Class', '00000000-0000-0000-0000-000000007134', 5, 'one_off', now() + interval '1 day')$$,
  '%row-level security%',
  'a receptionist-claim session cannot INSERT into classes (RLS-violation error)'
);

select throws_like(
  $$insert into class_sessions (id, gym_id, class_id, scheduled_at)
    values ('00000000-0000-0000-0000-000000007151', '00000000-0000-0000-0000-000000007111', '00000000-0000-0000-0000-000000007141', now() + interval '1 day')$$,
  '%row-level security%',
  'a receptionist-claim session cannot INSERT into class_sessions -- no write policy exists for any role'
);

select throws_like(
  $$select materialize_class_sessions('00000000-0000-0000-0000-000000007141', false)$$,
  '%permission denied%',
  'a receptionist-claim session cannot call materialize_class_sessions -- its own internal role check, not just RLS on classes/class_sessions'
);

select throws_like(
  $$select create_class('Forged Class', null, '00000000-0000-0000-0000-000000007134', 5, 'one_off', now() + interval '1 day', null, null, null)$$,
  '%permission denied%',
  'a receptionist-claim session cannot call create_class'
);

select throws_like(
  $$select update_class('00000000-0000-0000-0000-000000007141', 'Renamed', null, '00000000-0000-0000-0000-000000007134', 5, 'one_off', now() + interval '1 day', null, null, null)$$,
  '%permission denied%',
  'a receptionist-claim session cannot call update_class'
);

reset role;

-- class_sessions is write-denied for every role, not just Receptionist --
-- there is no INSERT/UPDATE/DELETE policy for authenticated at all
-- (every write goes through the SECURITY DEFINER materializer functions,
-- which run as postgres and bypass RLS).
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000007122","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000007111","app_role":"owner"}',
  true
);

select throws_like(
  $$insert into class_sessions (id, gym_id, class_id, scheduled_at)
    values ('00000000-0000-0000-0000-000000007152', '00000000-0000-0000-0000-000000007111', '00000000-0000-0000-0000-000000007141', now() + interval '2 days')$$,
  '%row-level security%',
  'an owner-claim session cannot INSERT into class_sessions either -- no write policy exists for any role'
);

reset role;

select * from finish();
rollback;
