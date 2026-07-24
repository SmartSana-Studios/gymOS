-- Story 3.5: Check-Out -- Manual & Auto-Timeout. Tests
-- run_check_in_auto_timeout_job(), check_out(), and check_out_member()
-- (0024_check_out_manual_auto_timeout.sql). Session-simulation conventions
-- match manual_renewal_reset.test.sql (`set local role authenticated` +
-- `set_config('request.jwt.claims', ...)`, fixtures seeded up front as the
-- connecting role, `reset role` before asserting on committed table state).
-- The cron job is called directly (no real cron timing), following
-- subscription_lifecycle_cron.test.sql's convention.

begin;
select plan(24);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000012001', 'Check-Out Test Tier', 5000, 50000, 20);

-- Gym A: check_out()/check_out_member() role/permission coverage (default
-- checkin_timeout_hours = 8, unused by these assertions).
-- Gym B: cross-tenant check_out_member() coverage.
-- Gym C / Gym D: cron-job coverage -- deliberately different
-- checkin_timeout_hours so one member's 3-hour-old session is stale relative
-- to its own gym while the other's identical 3-hour-old session is not,
-- proving the job reads each row's own gym's timeout rather than a fixed
-- global value.
insert into gyms (id, name, tier_id, capacity, checkin_timeout_hours) values
  ('00000000-0000-0000-0000-000000012011', 'Check-Out Gym A', '00000000-0000-0000-0000-000000012001', 30, 8),
  ('00000000-0000-0000-0000-000000012012', 'Check-Out Gym B', '00000000-0000-0000-0000-000000012001', 30, 8),
  ('00000000-0000-0000-0000-000000012013', 'Check-Out Gym C (cron stale)', '00000000-0000-0000-0000-000000012001', 30, 1),
  ('00000000-0000-0000-0000-000000012014', 'Check-Out Gym D (cron control)', '00000000-0000-0000-0000-000000012001', 30, 8);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000012021'), -- Gym A: fresh member with an open check-in (member path success)
  ('00000000-0000-0000-0000-000000012022'), -- Gym A: member with no open check-in (member path rejection)
  ('00000000-0000-0000-0000-000000012023'), -- Gym A: owner
  ('00000000-0000-0000-0000-000000012024'), -- Gym A: manager
  ('00000000-0000-0000-0000-000000012025'), -- Gym A: receptionist
  ('00000000-0000-0000-0000-000000012026'), -- Gym A: coach
  ('00000000-0000-0000-0000-000000012027'), -- Gym A: member X (checked out by owner)
  ('00000000-0000-0000-0000-000000012028'), -- Gym A: member Y (checked out by manager)
  ('00000000-0000-0000-0000-000000012029'), -- Gym A: member Z (checked out by receptionist)
  ('00000000-0000-0000-0000-000000012030'), -- Gym A: member W (coach-rejection target)
  ('00000000-0000-0000-0000-000000012031'), -- Gym B: owner (cross-tenant staff)
  ('00000000-0000-0000-0000-000000012032'), -- Gym A: member V (cross-tenant target)
  ('00000000-0000-0000-0000-000000012033'), -- Gym C: member (cron stale)
  ('00000000-0000-0000-0000-000000012034'), -- Gym D: member (cron control)
  ('00000000-0000-0000-0000-000000012035'); -- Gym A: deactivated member with an open check-in (check_out() rejection)

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000012041', '00000000-0000-0000-0000-000000012011', '00000000-0000-0000-0000-000000012021', 'member', 'Check-Out Fresh Member'),
  ('00000000-0000-0000-0000-000000012042', '00000000-0000-0000-0000-000000012011', '00000000-0000-0000-0000-000000012022', 'member', 'Check-Out No-Open Member'),
  ('00000000-0000-0000-0000-000000012043', '00000000-0000-0000-0000-000000012011', '00000000-0000-0000-0000-000000012023', 'owner', 'Check-Out Gym A Owner'),
  ('00000000-0000-0000-0000-000000012044', '00000000-0000-0000-0000-000000012011', '00000000-0000-0000-0000-000000012024', 'manager', 'Check-Out Gym A Manager'),
  ('00000000-0000-0000-0000-000000012045', '00000000-0000-0000-0000-000000012011', '00000000-0000-0000-0000-000000012025', 'receptionist', 'Check-Out Gym A Receptionist'),
  ('00000000-0000-0000-0000-000000012046', '00000000-0000-0000-0000-000000012011', '00000000-0000-0000-0000-000000012026', 'coach', 'Check-Out Gym A Coach'),
  ('00000000-0000-0000-0000-000000012047', '00000000-0000-0000-0000-000000012011', '00000000-0000-0000-0000-000000012027', 'member', 'Check-Out Member X'),
  ('00000000-0000-0000-0000-000000012048', '00000000-0000-0000-0000-000000012011', '00000000-0000-0000-0000-000000012028', 'member', 'Check-Out Member Y'),
  ('00000000-0000-0000-0000-000000012049', '00000000-0000-0000-0000-000000012011', '00000000-0000-0000-0000-000000012029', 'member', 'Check-Out Member Z'),
  ('00000000-0000-0000-0000-000000012050', '00000000-0000-0000-0000-000000012011', '00000000-0000-0000-0000-000000012030', 'member', 'Check-Out Member W'),
  ('00000000-0000-0000-0000-000000012051', '00000000-0000-0000-0000-000000012012', '00000000-0000-0000-0000-000000012031', 'owner', 'Check-Out Gym B Owner'),
  ('00000000-0000-0000-0000-000000012052', '00000000-0000-0000-0000-000000012011', '00000000-0000-0000-0000-000000012032', 'member', 'Check-Out Member V'),
  ('00000000-0000-0000-0000-000000012053', '00000000-0000-0000-0000-000000012013', '00000000-0000-0000-0000-000000012033', 'member', 'Check-Out Gym C Cron Member'),
  ('00000000-0000-0000-0000-000000012054', '00000000-0000-0000-0000-000000012014', '00000000-0000-0000-0000-000000012034', 'member', 'Check-Out Gym D Cron Member');

insert into members (id, gym_id, user_id, role, name, deactivated_at) values
  ('00000000-0000-0000-0000-000000012056', '00000000-0000-0000-0000-000000012011', '00000000-0000-0000-0000-000000012035', 'member', 'Check-Out Deactivated Member', now());

insert into attendance_events (id, gym_id, member_id) values
  ('00000000-0000-0000-0000-000000012061', '00000000-0000-0000-0000-000000012011', '00000000-0000-0000-0000-000000012041'), -- Fresh Member: open
  ('00000000-0000-0000-0000-000000012062', '00000000-0000-0000-0000-000000012011', '00000000-0000-0000-0000-000000012047'), -- Member X: open
  ('00000000-0000-0000-0000-000000012063', '00000000-0000-0000-0000-000000012011', '00000000-0000-0000-0000-000000012048'), -- Member Y: open
  ('00000000-0000-0000-0000-000000012064', '00000000-0000-0000-0000-000000012011', '00000000-0000-0000-0000-000000012049'), -- Member Z: open
  ('00000000-0000-0000-0000-000000012065', '00000000-0000-0000-0000-000000012011', '00000000-0000-0000-0000-000000012050'), -- Member W: open (coach-rejection target)
  ('00000000-0000-0000-0000-000000012066', '00000000-0000-0000-0000-000000012011', '00000000-0000-0000-0000-000000012052'), -- Member V: open (cross-tenant target)
  ('00000000-0000-0000-0000-000000012069', '00000000-0000-0000-0000-000000012011', '00000000-0000-0000-0000-000000012056'); -- Deactivated Member: open (check_out() deactivated-guard target)

-- Both gyms' cron fixtures share the same 3-hour-old checked_in_at -- only
-- Gym C's 1-hour timeout makes its row stale; Gym D's 8-hour timeout does not.
insert into attendance_events (id, gym_id, member_id, checked_in_at) values
  ('00000000-0000-0000-0000-000000012067', '00000000-0000-0000-0000-000000012013', '00000000-0000-0000-0000-000000012053', now() - interval '3 hours'),
  ('00000000-0000-0000-0000-000000012068', '00000000-0000-0000-0000-000000012014', '00000000-0000-0000-0000-000000012054', now() - interval '3 hours');

-- ============================================================================
-- (a) AC #1, member path: a member-claim session with an open check-in
-- calling check_out() succeeds and sets checked_out_at/checkout_type.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000012021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000012011","app_role":"member"}',
  true
);

select lives_ok(
  $$select check_out()$$,
  'a member-claim session with an open check-in can check out'
);

reset role;

select ok(
  (select checked_out_at is not null from attendance_events where id = '00000000-0000-0000-0000-000000012061'),
  'the fresh member''s row has checked_out_at set after check_out()'
);

select is(
  (select checkout_type from attendance_events where id = '00000000-0000-0000-0000-000000012061'),
  'manual',
  'the fresh member''s row has checkout_type = manual after check_out()'
);

-- ============================================================================
-- (b) A member-claim session with no open check-in calling check_out() is
-- rejected.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000012022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000012011","app_role":"member"}',
  true
);

select throws_like(
  $$select check_out()$$,
  '%has no open check-in%',
  'a member-claim session with no open check-in cannot call check_out()'
);

-- ============================================================================
-- (b2) A deactivated member's session token calling check_out() is rejected
-- (defense in depth, mirroring check_in()'s identical guard) and their open
-- session remains untouched.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000012035","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000012011","app_role":"member"}',
  true
);

select throws_like(
  $$select check_out()$$,
  '%member is deactivated%',
  'a deactivated member-claim session cannot call check_out()'
);

reset role;
select ok(
  (select checked_out_at is null from attendance_events where id = '00000000-0000-0000-0000-000000012069'),
  'the deactivated member''s session remains open after the rejected check_out() attempt'
);

-- ============================================================================
-- (c) AC #1, staff path: owner-, manager-, and receptionist-claim sessions
-- can each call check_out_member() on an open session and succeed.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000012023","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000012011","app_role":"owner"}',
  true
);

select lives_ok(
  $$select check_out_member('00000000-0000-0000-0000-000000012047')$$,
  'an owner-claim session can check out Member X'
);

reset role;
select is(
  (select checkout_type from attendance_events where id = '00000000-0000-0000-0000-000000012062'),
  'manual',
  'Member X''s row has checkout_type = manual after owner check-out'
);

select is(
  (select count(*)::int from audit_log where target_entity_id = '00000000-0000-0000-0000-000000012047' and action_type = 'attendance_manual_checkout'),
  1,
  'check_out_member() writes exactly one attendance_manual_checkout audit_log row for Member X'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000012024","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000012011","app_role":"manager"}',
  true
);

select lives_ok(
  $$select check_out_member('00000000-0000-0000-0000-000000012048')$$,
  'a manager-claim session can check out Member Y'
);

reset role;
select is(
  (select checkout_type from attendance_events where id = '00000000-0000-0000-0000-000000012063'),
  'manual',
  'Member Y''s row has checkout_type = manual after manager check-out'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000012025","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000012011","app_role":"receptionist"}',
  true
);

select lives_ok(
  $$select check_out_member('00000000-0000-0000-0000-000000012049')$$,
  'a receptionist-claim session can check out Member Z'
);

reset role;
select is(
  (select checkout_type from attendance_events where id = '00000000-0000-0000-0000-000000012064'),
  'manual',
  'Member Z''s row has checkout_type = manual after receptionist check-out'
);

-- ============================================================================
-- (d) A coach-claim session calling check_out_member() is rejected.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000012026","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000012011","app_role":"coach"}',
  true
);

select throws_like(
  $$select check_out_member('00000000-0000-0000-0000-000000012050')$$,
  '%permission denied%',
  'a coach-claim session cannot call check_out_member()'
);

-- ============================================================================
-- (e) Cross-tenant: a Gym B staff-claim session's check_out_member() call
-- against a Gym A member's id is rejected, and the Gym A member's session
-- remains open.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000012031","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000012012","app_role":"owner"}',
  true
);

select throws_like(
  $$select check_out_member('00000000-0000-0000-0000-000000012052')$$,
  '%not found%',
  'a Gym B owner-claim session cannot check out Gym A''s Member V -- gym-scoped lookup reports not-found'
);

reset role;
select ok(
  (select checked_out_at is null from attendance_events where id = '00000000-0000-0000-0000-000000012066'),
  'Member V''s session remains open after the rejected cross-tenant check-out attempt'
);

-- ============================================================================
-- (f) AC #2/#3, cron job: seed fixtures above already have a stale (Gym C)
-- and a control (Gym D) open session. Calling the job directly closes only
-- the stale one, with checkout_type = auto, and writes a job_runs success row.
-- ============================================================================
select lives_ok(
  $$select run_check_in_auto_timeout_job()$$,
  'run_check_in_auto_timeout_job() executes without error against seeded fixtures'
);

select is(
  (select checked_out_at from attendance_events where id = '00000000-0000-0000-0000-000000012067'),
  (select checked_in_at + interval '1 hour' from attendance_events where id = '00000000-0000-0000-0000-000000012067'),
  'the stale Gym C session''s checked_out_at is exactly checked_in_at + the gym''s checkin_timeout_hours'
);

select is(
  (select checkout_type from attendance_events where id = '00000000-0000-0000-0000-000000012067'),
  'auto',
  'the stale Gym C session was auto-closed with checkout_type = auto'
);

select ok(
  (select checked_out_at is null from attendance_events where id = '00000000-0000-0000-0000-000000012068'),
  'the control Gym D session (within its own gym''s longer timeout) is still open'
);

select is(
  (select count(*)::int from job_runs where job_name = 'check_in_auto_timeout' and status = 'success'),
  1,
  'exactly one success row is written to job_runs'
);

select is(
  (select count(*)::int from audit_log where target_entity_id = '00000000-0000-0000-0000-000000012067'),
  0,
  'no audit_log row is written for the auto-closed session'
);

-- ============================================================================
-- (g) Idempotency: calling the job a second time immediately is lives_ok and
-- leaves the already-closed session's checked_out_at unchanged.
-- ============================================================================
select lives_ok(
  $$select run_check_in_auto_timeout_job()$$,
  'run_check_in_auto_timeout_job() can be called a second time without error'
);

select is(
  (select checked_out_at from attendance_events where id = '00000000-0000-0000-0000-000000012067'),
  (select checked_in_at + interval '1 hour' from attendance_events where id = '00000000-0000-0000-0000-000000012067'),
  'a second consecutive run leaves the already-closed session''s checked_out_at unchanged'
);

select * from finish();
rollback;
