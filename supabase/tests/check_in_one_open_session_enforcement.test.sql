-- Story 3.4: Member Check-In & One-Open-Session Enforcement. Tests
-- check_in() (0023_member_check_in_one_open_session_enforcement.sql) -- a
-- SECURITY DEFINER RPC, not a raw RLS-gated INSERT, so most assertions call
-- the function directly under a simulated session rather than asserting on
-- INSERT statements themselves. Session-simulation conventions match
-- manual_renewal_reset.test.sql (`set local role authenticated` +
-- `set_config('request.jwt.claims', ...)`, fixtures seeded up front as the
-- connecting role, `reset role` before asserting on committed table state).

begin;
select plan(14);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000009001', 'Check-In Test Tier', 5000, 50000, 10);

insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-000000009011', 'Check-In Gym A', '00000000-0000-0000-0000-000000009001', 30),
  ('00000000-0000-0000-0000-000000009012', 'Check-In Gym B', '00000000-0000-0000-0000-000000009001', 30);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000009021'), -- Gym A: fresh member (Task 4, assertions a/b/e)
  ('00000000-0000-0000-0000-000000009022'), -- Gym A: coach (permission-denied)
  ('00000000-0000-0000-0000-000000009023'), -- Gym A: owner (permission-denied)
  ('00000000-0000-0000-0000-000000009024'), -- Gym A: stale-session member (assertion c)
  ('00000000-0000-0000-0000-000000009025'); -- Gym B: fresh member (cross-tenant, assertion f)

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000009041', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009021', 'member', 'Check-In Gym A Fresh Member'),
  ('00000000-0000-0000-0000-000000009042', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009022', 'coach', 'Check-In Gym A Coach'),
  ('00000000-0000-0000-0000-000000009043', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009023', 'owner', 'Check-In Gym A Owner'),
  ('00000000-0000-0000-0000-000000009044', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009024', 'member', 'Check-In Gym A Stale Member'),
  ('00000000-0000-0000-0000-000000009045', '00000000-0000-0000-0000-000000009012', '00000000-0000-0000-0000-000000009025', 'member', 'Check-In Gym B Fresh Member');

-- Stale Member: an open check-in seeded further in the past than Gym A's
-- checkin_timeout_hours (default 8, unchanged in this fixture -- the
-- "gym's actual configured value" option from Task 4, deterministic since
-- 9 hours always exceeds the 8-hour default).
insert into attendance_events (id, gym_id, member_id, checked_in_at) values
  ('00000000-0000-0000-0000-000000009051', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009044', now() - interval '9 hours');

-- ============================================================================
-- (a) A member-claim session with no open check-in succeeds and inserts
-- exactly one open attendance_events row.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"member"}',
  true
);

select lives_ok(
  $$select check_in()$$,
  'a member-claim session with no open check-in can check in'
);

reset role;

select is(
  (select count(*)::int from attendance_events where member_id = '00000000-0000-0000-0000-000000009041' and checked_out_at is null),
  1,
  'exactly one open attendance_events row exists for the fresh member after check-in'
);

-- ============================================================================
-- (b) The same member checking in again immediately (open, non-stale
-- session) is rejected -- no second row inserted.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"member"}',
  true
);

select throws_like(
  $$select check_in()$$,
  '%already has an open check-in%',
  'a member with an open, non-stale check-in is rejected on a second check-in attempt'
);

reset role;

select is(
  (select count(*)::int from attendance_events where member_id = '00000000-0000-0000-0000-000000009041'),
  1,
  'no second row was inserted for the fresh member after the rejected repeat check-in'
);

-- ============================================================================
-- (c) AC #3: a member with a stale open check-in (older than
-- checkin_timeout_hours) auto-closes the stale row and records a new one,
-- with exactly one audit_log entry for the auto-close.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009024","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"member"}',
  true
);

select lives_ok(
  $$select check_in()$$,
  'a member with a stale open check-in can check in -- the stale session is auto-closed first'
);

reset role;

select is(
  (select checkout_type from attendance_events where id = '00000000-0000-0000-0000-000000009051'),
  'auto',
  'the stale row was auto-closed with checkout_type = auto'
);

select is(
  (select checked_out_at from attendance_events where id = '00000000-0000-0000-0000-000000009051'),
  (select checked_in_at + interval '8 hours' from attendance_events where id = '00000000-0000-0000-0000-000000009051'),
  'the stale row''s checked_out_at is exactly checked_in_at + the gym''s checkin_timeout_hours'
);

select is(
  (select count(*)::int from attendance_events where member_id = '00000000-0000-0000-0000-000000009044' and checked_out_at is null),
  1,
  'a new open attendance_events row now exists for the stale-session member'
);

select is(
  (select count(*)::int from audit_log
   where action_type = 'attendance_stale_check_in_auto_closed'
     and target_entity_id = '00000000-0000-0000-0000-000000009051'),
  1,
  'exactly one audit_log row was written for the auto-closed stale row'
);

-- ============================================================================
-- (d) A coach-claim and an owner-claim session are both denied -- check_in()
-- is member self-service only.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"coach"}',
  true
);

select throws_like(
  $$select check_in()$$,
  '%permission denied%',
  'a coach-claim session cannot call check_in()'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009023","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"owner"}',
  true
);

select throws_like(
  $$select check_in()$$,
  '%permission denied%',
  'an owner-claim session cannot call check_in()'
);

-- ============================================================================
-- (e) The partial unique index itself rejects a second concurrent open row
-- for the same member_id at the raw SQL level, independent of check_in()'s
-- own pre-check -- proves AC #2's literal "enforced via a partial unique
-- index" wording. The fresh member from (a)/(b) still has an open row.
-- ============================================================================
reset role;

select throws_like(
  $$insert into attendance_events (gym_id, member_id) values ('00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009041')$$,
  '%idx_attendance_events_one_open_per_member%',
  'the partial unique index rejects a second open row for the same member_id at the raw SQL level'
);

-- ============================================================================
-- (f) Cross-tenant: a Gym B member-claim session's check_in() call only
-- ever inserts against Gym B's gym_id, never Gym A's, even with fixtures
-- present in both gyms.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009025","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009012","app_role":"member"}',
  true
);

select lives_ok(
  $$select check_in()$$,
  'a Gym B member-claim session can check in'
);

reset role;

select is(
  (select gym_id from attendance_events where member_id = '00000000-0000-0000-0000-000000009045'),
  '00000000-0000-0000-0000-000000009012',
  'the Gym B member''s check-in was recorded against Gym B, not Gym A'
);

select * from finish();
rollback;
