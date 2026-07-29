-- Story 3.6: Occupancy Display & Admin Attendance Page. Tests the new
-- "gym_staff_read_own_attendance_events" RLS policy and the
-- `member_occupancy_band()` SECURITY DEFINER function (0025 migration).
-- Session-simulation conventions match member_management_rls.test.sql
-- (`set local role authenticated` + `set_config('request.jwt.claims', ...)`)
-- -- read-visibility assertions run directly under the simulated session
-- (no `reset role` needed, since we want to know what that session itself
-- can see), matching that file's own established idiom for plain SELECT
-- RLS checks.

begin;
select plan(12);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000009001', 'Occupancy Test Tier', 5000, 50000, 200);

-- Gym A: real capacity, used for both the RLS section and the occupancy
-- band's low/medium/busy thresholds. Gym B: cross-tenant negative-test
-- target only, no attendance data of its own needed. Gym C: capacity left
-- null, to exercise member_occupancy_band()'s "no capacity configured yet"
-- null-return path.
insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-000000009011', 'Occupancy Gym A', '00000000-0000-0000-0000-000000009001', 100),
  ('00000000-0000-0000-0000-000000009012', 'Occupancy Gym B', '00000000-0000-0000-0000-000000009001', 30);
insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-000000009013', 'Occupancy Gym C', '00000000-0000-0000-0000-000000009001', null);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000009021'), -- Gym A owner
  ('00000000-0000-0000-0000-000000009022'), -- Gym A manager
  ('00000000-0000-0000-0000-000000009023'), -- Gym A receptionist
  ('00000000-0000-0000-0000-000000009024'), -- Gym A coach
  ('00000000-0000-0000-0000-000000009025'), -- Gym B owner
  ('00000000-0000-0000-0000-000000009026'), -- Gym A member-role session (occupancy band caller)
  ('00000000-0000-0000-0000-000000009027'); -- Gym C member-role session (null-capacity caller)

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000009041', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009021', 'owner', 'Occupancy Gym A Owner'),
  ('00000000-0000-0000-0000-000000009042', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009022', 'manager', 'Occupancy Gym A Manager'),
  ('00000000-0000-0000-0000-000000009043', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009023', 'receptionist', 'Occupancy Gym A Receptionist'),
  ('00000000-0000-0000-0000-000000009044', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009024', 'coach', 'Occupancy Gym A Coach'),
  ('00000000-0000-0000-0000-000000009045', '00000000-0000-0000-0000-000000009012', '00000000-0000-0000-0000-000000009025', 'owner', 'Occupancy Gym B Owner'),
  ('00000000-0000-0000-0000-000000009046', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009026', 'member', 'Occupancy Gym A Member Session'),
  ('00000000-0000-0000-0000-000000009047', '00000000-0000-0000-0000-000000009013', '00000000-0000-0000-0000-000000009027', 'member', 'Occupancy Gym C Member Session');

-- Two CLOSED attendance_events rows for Gym A, used only for the RLS
-- visibility section below -- deliberately closed (checked_out_at set) so
-- they don't count toward member_occupancy_band()'s open-session math later
-- (which filters on checked_out_at is null), keeping the RLS section and
-- the occupancy-band section's fixture data independent of each other.
insert into attendance_events (id, gym_id, member_id, checked_in_at, checked_out_at, checkout_type) values
  ('00000000-0000-0000-0000-000000009051', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009046', now() - interval '2 hours', now() - interval '1 hour', 'manual'),
  ('00000000-0000-0000-0000-000000009052', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009046', now() - interval '4 hours', now() - interval '3 hours', 'manual');

-- ============================================================================
-- (a) Owner/manager/receptionist-claim sessions can SELECT attendance_events
-- for their own gym (AC #1's read policy).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"owner"}',
  true
);

select lives_ok(
  $$select * from attendance_events where gym_id = '00000000-0000-0000-0000-000000009011'$$,
  'an owner-claim session can select from attendance_events for its own gym'
);

select is(
  (select count(*)::int from attendance_events where gym_id = '00000000-0000-0000-0000-000000009011'),
  2,
  'the owner-claim session sees both seeded attendance_events rows'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"manager"}',
  true
);

select is(
  (select count(*)::int from attendance_events where gym_id = '00000000-0000-0000-0000-000000009011'),
  2,
  'a manager-claim session can select its own gym''s attendance_events'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009023","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"receptionist"}',
  true
);

select is(
  (select count(*)::int from attendance_events where gym_id = '00000000-0000-0000-0000-000000009011'),
  2,
  'a receptionist-claim session can select its own gym''s attendance_events'
);

-- ============================================================================
-- (b) A coach-claim session's select returns 0 rows -- RLS-denied, not an
-- error (Scope Note #1: Coach is deliberately excluded, unlike
-- gym_staff_read_own_members).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009024","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"coach"}',
  true
);

select is(
  (select count(*)::int from attendance_events where gym_id = '00000000-0000-0000-0000-000000009011'),
  0,
  'a coach-claim session sees 0 rows on its own gym''s attendance_events -- RLS-denied, not an error'
);

-- ============================================================================
-- (c) A cross-tenant staff session's select against another gym's rows
-- returns 0 rows.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009025","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009012","app_role":"owner"}',
  true
);

select is(
  (select count(*)::int from attendance_events where gym_id = '00000000-0000-0000-0000-000000009011'),
  0,
  'a Gym B owner-claim session sees 0 rows when filtering explicitly by Gym A''s gym_id'
);

-- ============================================================================
-- (d) A member-claim session sees only its own attendance_events rows
-- directly -- as of Story 3.7 (0026_member_app_home_screen_status_display.sql),
-- member_read_own_attendance_events grants a member session read access to
-- its own rows (for the Home screen's "recent activity" feed), but never
-- another member's or the gym's aggregate rows. member_occupancy_band()'s
-- "never expose the raw checked-in count/capacity" guarantee (Scope Note #2
-- there) is unaffected -- that guarantee is about the function's own return
-- shape, not about attendance_events row visibility in general.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009026","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"member"}',
  true
);

select is(
  (select count(*)::int from attendance_events where gym_id = '00000000-0000-0000-0000-000000009011'),
  2,
  'a member-claim session sees exactly its own 2 seeded attendance_events rows -- member_read_own_attendance_events (Story 3.7), not the pure deny-all it was before this story'
);

-- ============================================================================
-- (e) member_occupancy_band(): representative percentages against Gym A's
-- capacity of 100. Filler members/check-ins are inserted incrementally
-- (10, then +40 to reach 50, then +30 to reach 80) so each threshold is
-- tested against the same gym without needing three separate gyms.
--
-- Each filler batch runs under `reset role` (the connecting/superuser role,
-- same as every fixture insert above) -- `authenticated` has no INSERT
-- privilege on `auth.users`, which the member-claim session set above is
-- restricted to. The member claim is re-established immediately after each
-- batch to call the function itself.
-- ============================================================================
reset role;
with new_users as (
  insert into auth.users (id)
  select gen_random_uuid() from generate_series(1, 10)
  returning id
),
new_members as (
  insert into members (gym_id, user_id, role, name)
  select '00000000-0000-0000-0000-000000009011', id, 'member', 'Occupancy Filler ' || id
  from new_users
  returning id
)
insert into attendance_events (gym_id, member_id, checked_in_at)
select '00000000-0000-0000-0000-000000009011', id, now()
from new_members;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009026","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"member"}',
  true
);

select is(
  member_occupancy_band(),
  'low',
  'member_occupancy_band() returns ''low'' at 10/100 (10%%) checked in'
);

reset role;
with new_users as (
  insert into auth.users (id)
  select gen_random_uuid() from generate_series(1, 40)
  returning id
),
new_members as (
  insert into members (gym_id, user_id, role, name)
  select '00000000-0000-0000-0000-000000009011', id, 'member', 'Occupancy Filler ' || id
  from new_users
  returning id
)
insert into attendance_events (gym_id, member_id, checked_in_at)
select '00000000-0000-0000-0000-000000009011', id, now()
from new_members;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009026","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"member"}',
  true
);

select is(
  member_occupancy_band(),
  'medium',
  'member_occupancy_band() returns ''medium'' at 50/100 (50%%) checked in'
);

reset role;
with new_users as (
  insert into auth.users (id)
  select gen_random_uuid() from generate_series(1, 30)
  returning id
),
new_members as (
  insert into members (gym_id, user_id, role, name)
  select '00000000-0000-0000-0000-000000009011', id, 'member', 'Occupancy Filler ' || id
  from new_users
  returning id
)
insert into attendance_events (gym_id, member_id, checked_in_at)
select '00000000-0000-0000-0000-000000009011', id, now()
from new_members;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009026","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"member"}',
  true
);

select is(
  member_occupancy_band(),
  'busy',
  'member_occupancy_band() returns ''busy'' at 80/100 (80%%) checked in'
);

-- ============================================================================
-- (f) A gym with no capacity configured (gyms.capacity is null) returns
-- null, not an error -- an expected, non-error state (Scope Note #2).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009027","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009013","app_role":"member"}',
  true
);

select is(
  member_occupancy_band(),
  null::text,
  'member_occupancy_band() returns null when the gym has no capacity configured'
);

-- ============================================================================
-- (g) A non-member-role session (e.g. owner) is denied -- the function is
-- member-only, mirroring check_in()/check_out()'s own self-check shape.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"owner"}',
  true
);

select throws_like(
  $$select member_occupancy_band()$$,
  '%permission denied%',
  'an owner-claim session cannot call member_occupancy_band() -- member-only'
);

select * from finish();
rollback;
