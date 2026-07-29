-- Story 3.7: Member App -- Home Screen & Status Display. Tests the new
-- "member_read_own_attendance_events" RLS policy (0026 migration), which
-- backs the Home screen's "recent activity" feed (AC #3). Session-simulation
-- conventions match occupancy_display_admin_attendance_page.test.sql
-- (`set local role authenticated` + `set_config('request.jwt.claims', ...)`,
-- `reset role` before asserting via a superuser-role count).

begin;
select plan(6);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000009101', 'Home Screen Test Tier', 5000, 50000, 200);

insert into gyms (id, name, tier_id) values
  ('00000000-0000-0000-0000-000000009111', 'Home Screen Test Gym', '00000000-0000-0000-0000-000000009101');

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000009121'), -- Member A (own-row read)
  ('00000000-0000-0000-0000-000000009122'), -- Member B (other-member negative test)
  ('00000000-0000-0000-0000-000000009123'), -- Gym owner (0025 staff policy, unaffected)
  ('00000000-0000-0000-0000-000000009124'); -- Coach (deny-all-by-default, unaffected)

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000009141', '00000000-0000-0000-0000-000000009111', '00000000-0000-0000-0000-000000009121', 'member', 'Home Screen Member A'),
  ('00000000-0000-0000-0000-000000009142', '00000000-0000-0000-0000-000000009111', '00000000-0000-0000-0000-000000009122', 'member', 'Home Screen Member B'),
  ('00000000-0000-0000-0000-000000009143', '00000000-0000-0000-0000-000000009111', '00000000-0000-0000-0000-000000009123', 'owner', 'Home Screen Owner'),
  ('00000000-0000-0000-0000-000000009144', '00000000-0000-0000-0000-000000009111', '00000000-0000-0000-0000-000000009124', 'coach', 'Home Screen Coach');

insert into attendance_events (id, gym_id, member_id, checked_in_at, checked_out_at) values
  ('00000000-0000-0000-0000-000000009151', '00000000-0000-0000-0000-000000009111', '00000000-0000-0000-0000-000000009141', now() - interval '2 hours', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000009152', '00000000-0000-0000-0000-000000009111', '00000000-0000-0000-0000-000000009142', now() - interval '3 hours', now() - interval '2 hours');

-- ============================================================================
-- (a) A member-claim session can SELECT its own attendance_events row via
-- the new member_read_own_attendance_events policy.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009121","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009111","app_role":"member"}',
  true
);

select lives_ok(
  $$select * from attendance_events where gym_id = '00000000-0000-0000-0000-000000009111'$$,
  'a member-claim session can select from attendance_events for its own gym'
);

select is(
  (select count(*)::int from attendance_events where gym_id = '00000000-0000-0000-0000-000000009111'),
  1,
  'member A sees exactly its own attendance_events row, not member B''s'
);

select is(
  (select member_id from attendance_events where gym_id = '00000000-0000-0000-0000-000000009111' limit 1),
  '00000000-0000-0000-0000-000000009141'::uuid,
  'the visible row belongs to member A, the calling member'
);

-- ============================================================================
-- (b) A member-claim session cannot SELECT another member's row in the same
-- gym directly (member B's row id, filtered explicitly).
-- ============================================================================
select is(
  (select count(*)::int from attendance_events where id = '00000000-0000-0000-0000-000000009152'),
  0,
  'member A cannot select member B''s attendance_events row even filtering by its id directly'
);

-- ============================================================================
-- (c) The pre-existing gym_staff_read_own_attendance_events policy (0025) is
-- unaffected -- an owner-claim session still sees both rows.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009123","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009111","app_role":"owner"}',
  true
);

select is(
  (select count(*)::int from attendance_events where gym_id = '00000000-0000-0000-0000-000000009111'),
  2,
  'an owner-claim session still sees both attendance_events rows -- 0025 staff policy unaffected'
);

-- ============================================================================
-- (d) Deny-all-by-default for a non-member/non-staff role (coach) is
-- unaffected -- still 0 rows.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009124","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009111","app_role":"coach"}',
  true
);

select is(
  (select count(*)::int from attendance_events where gym_id = '00000000-0000-0000-0000-000000009111'),
  0,
  'a coach-claim session still sees 0 rows on attendance_events -- deny-all-by-default unaffected'
);

select * from finish();
rollback;
