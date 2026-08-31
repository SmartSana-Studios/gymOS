-- Story 12.4: Member App Classes Surfaces. Tests
-- list_bookable_class_sessions()/list_my_class_bookings()
-- (0078_member_app_classes_surfaces.sql) -- both SECURITY DEFINER RPCs,
-- read-only. Fixture/session-simulation conventions match
-- class_booking_with_capacity_enforcement.test.sql (`set local role
-- authenticated` + `set_config('request.jwt.claims', ...)`, fixtures seeded
-- up front as postgres). Neither RPC has a subscription-eligibility check
-- (unlike book_class_session()), so no tiers/plans/subscriptions fixtures
-- are needed beyond the one tiers row gyms.tier_id requires.
--
-- Highest-risk regression (Dev Notes Testing Requirements): booked_count
-- must reflect *every* member's bookings on a session, not just the
-- caller's -- proven below with 2 distinct members booked on the same
-- session (s1).

begin;
select plan(12);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000009001', 'Classes Surfaces Test Tier', 5000, 50000, 30);

insert into gyms (id, name, tier_id) values
  ('00000000-0000-0000-0000-000000009011', 'Classes Surfaces Gym A', '00000000-0000-0000-0000-000000009001'),
  ('00000000-0000-0000-0000-000000009012', 'Classes Surfaces Gym B', '00000000-0000-0000-0000-000000009001');

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000009021'), -- Gym A: coach (class owner)
  ('00000000-0000-0000-0000-000000009022'), -- Gym A: member 1 (primary caller)
  ('00000000-0000-0000-0000-000000009023'), -- Gym A: member 2 (second booker on s1, proves the booked_count aggregate)
  ('00000000-0000-0000-0000-000000009024'), -- Gym A: receptionist (role-check rejection, list_bookable_class_sessions)
  ('00000000-0000-0000-0000-000000009025'), -- Gym A: manager (role-check rejection, list_my_class_bookings)
  ('00000000-0000-0000-0000-000000009026'), -- Gym B: coach
  ('00000000-0000-0000-0000-000000009027'), -- Gym B: member (cross-gym session; also the target of the forced mismatched-gym booking row)
  ('00000000-0000-0000-0000-000000009028'), -- Gym A: member 3 (books the inside-cutoff session)
  ('00000000-0000-0000-0000-000000009029'); -- Gym A: deactivated member (deactivated-member guard, both RPCs)

insert into members (id, gym_id, user_id, role, name, deactivated_at) values
  ('00000000-0000-0000-0000-000000009041', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009021', 'coach', 'Story 12.4 Coach A', null),
  ('00000000-0000-0000-0000-000000009042', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009022', 'member', 'Classes Surfaces Gym A Member 1', null),
  ('00000000-0000-0000-0000-000000009043', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009023', 'member', 'Classes Surfaces Gym A Member 2', null),
  ('00000000-0000-0000-0000-000000009044', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009024', 'receptionist', 'Classes Surfaces Gym A Receptionist', null),
  ('00000000-0000-0000-0000-000000009045', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009025', 'manager', 'Classes Surfaces Gym A Manager', null),
  ('00000000-0000-0000-0000-000000009046', '00000000-0000-0000-0000-000000009012', '00000000-0000-0000-0000-000000009026', 'coach', 'Classes Surfaces Gym B Coach', null),
  ('00000000-0000-0000-0000-000000009047', '00000000-0000-0000-0000-000000009012', '00000000-0000-0000-0000-000000009027', 'member', 'Classes Surfaces Gym B Member', null),
  ('00000000-0000-0000-0000-000000009048', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009028', 'member', 'Classes Surfaces Gym A Member 3', null),
  ('00000000-0000-0000-0000-000000009049', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009029', 'member', 'Classes Surfaces Gym A Deactivated Member', now());

insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, one_off_session_at) values
  ('00000000-0000-0000-0000-000000009061', '00000000-0000-0000-0000-000000009011', 'Classes Surfaces Class A', '00000000-0000-0000-0000-000000009041', 10, 'one_off', now() + interval '3 days'),
  ('00000000-0000-0000-0000-000000009062', '00000000-0000-0000-0000-000000009012', 'Classes Surfaces Class B', '00000000-0000-0000-0000-000000009046', 10, 'one_off', now() + interval '3 days');

insert into class_sessions (id, gym_id, class_id, scheduled_at) values
  ('00000000-0000-0000-0000-0000000090a1', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009061', now() + interval '1 hour'),   -- s4: inside the 120-minute default cutoff
  ('00000000-0000-0000-0000-0000000090a2', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009061', now() + interval '3 days'),   -- s1: booked by 2 members (booked_count aggregate)
  ('00000000-0000-0000-0000-0000000090a3', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009061', now() + interval '5 days'),   -- s2: unbooked, my_booking_id null
  ('00000000-0000-0000-0000-0000000090a4', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009061', now() - interval '1 day'),    -- s_past: excluded from both RPCs
  ('00000000-0000-0000-0000-0000000090a5', '00000000-0000-0000-0000-000000009012', '00000000-0000-0000-0000-000000009062', now() + interval '3 days');   -- sB: Gym B, excluded from Gym A's results

insert into class_bookings (id, gym_id, class_session_id, member_id) values
  ('00000000-0000-0000-0000-0000000090b1', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-0000000090a2', '00000000-0000-0000-0000-000000009042'), -- member 1 books s1
  ('00000000-0000-0000-0000-0000000090b2', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-0000000090a2', '00000000-0000-0000-0000-000000009043'), -- member 2 also books s1
  ('00000000-0000-0000-0000-0000000090b3', '00000000-0000-0000-0000-000000009012', '00000000-0000-0000-0000-0000000090a5', '00000000-0000-0000-0000-000000009047'), -- Gym B member books sB
  ('00000000-0000-0000-0000-0000000090b4', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-0000000090a1', '00000000-0000-0000-0000-000000009048'), -- member 3 books s4 (inside-cutoff)
  -- Forced fixture rows below bypass the normal booking flow (book_class_session()
  -- itself would reject both) to exercise list_my_class_bookings()'s own guards
  -- directly: a mismatched gym_id (defense-in-depth scoping) and a past session.
  ('00000000-0000-0000-0000-0000000090b5', '00000000-0000-0000-0000-000000009012', '00000000-0000-0000-0000-0000000090a5', '00000000-0000-0000-0000-000000009042'), -- member 1's real member row, but gym_id set to Gym B (mismatched -- proves the redundant cb.gym_id = v_gym_id guard)
  ('00000000-0000-0000-0000-0000000090b6', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-0000000090a4', '00000000-0000-0000-0000-000000009042'); -- member 1 booked the past session directly (proves the cs.scheduled_at > now() guard)

-- ============================================================================
-- list_bookable_class_sessions()
-- ============================================================================

-- (a) Role check: a Receptionist-claim session cannot call it at all.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009024","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"receptionist"}',
  true
);

select throws_like(
  $$select * from list_bookable_class_sessions()$$,
  '%caller is not a member%',
  'a receptionist-claim session cannot call list_bookable_class_sessions()'
);

reset role;

-- (a2) A deactivated member-claim session is rejected too, despite having a
-- real member row, mirroring book_class_session()'s own guard.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009029","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"member"}',
  true
);

select throws_like(
  $$select * from list_bookable_class_sessions()$$,
  '%member is deactivated%',
  'a deactivated member cannot call list_bookable_class_sessions()'
);

reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"member"}',
  true
);

-- (b) Ordered chronologically, gym-scoped: exactly s4, s1, s2 in that order
-- -- s_past (excluded: already occurred) and sB (excluded: different gym)
-- are both absent, proving all three guards together.
select is(
  (select array_agg(class_session_id) from list_bookable_class_sessions()),
  array[
    '00000000-0000-0000-0000-0000000090a1',
    '00000000-0000-0000-0000-0000000090a2',
    '00000000-0000-0000-0000-0000000090a3'
  ]::uuid[],
  'list_bookable_class_sessions() returns exactly the gym''s bookable sessions, ordered chronologically (past and cross-gym sessions excluded)'
);

-- (c) booked_count for s1 reflects both members' bookings, not just the caller's.
select is(
  (select booked_count from list_bookable_class_sessions() where class_session_id = '00000000-0000-0000-0000-0000000090a2'),
  2::bigint,
  'booked_count is aggregated across all members'' bookings on the session, not scoped to the caller'
);

-- (d) coach_name is resolved correctly -- proves the SECURITY DEFINER bypass
-- of member_read_gym_staff_members's coach-role exclusion actually works.
select is(
  (select coach_name from list_bookable_class_sessions() where class_session_id = '00000000-0000-0000-0000-0000000090a2'),
  'Story 12.4 Coach A',
  'coach_name is resolved for the caller even though member_read_gym_staff_members would otherwise exclude a coach-role row'
);

-- (e) my_booking_id matches the caller's real booking id when they have one.
select is(
  (select my_booking_id from list_bookable_class_sessions() where class_session_id = '00000000-0000-0000-0000-0000000090a2'),
  '00000000-0000-0000-0000-0000000090b1'::uuid,
  'my_booking_id matches the caller''s own real booking id for a session they''ve booked'
);

-- (f) my_booking_id is null when the caller hasn't booked.
select is(
  (select my_booking_id from list_bookable_class_sessions() where class_session_id = '00000000-0000-0000-0000-0000000090a3'),
  null::uuid,
  'my_booking_id is null for a session the caller hasn''t booked'
);

reset role;

-- ============================================================================
-- list_my_class_bookings()
-- ============================================================================

-- (g) Role check: a Manager-claim session cannot call it at all.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009025","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"manager"}',
  true
);

select throws_like(
  $$select * from list_my_class_bookings()$$,
  '%caller is not a member%',
  'a manager-claim session cannot call list_my_class_bookings()'
);

reset role;

-- (g2) A deactivated member-claim session is rejected too, despite having a
-- real member row, mirroring book_class_session()'s own guard.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009029","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"member"}',
  true
);

select throws_like(
  $$select * from list_my_class_bookings()$$,
  '%member is deactivated%',
  'a deactivated member cannot call list_my_class_bookings()'
);

reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"member"}',
  true
);

-- (h) Returns only the caller's own real, future, same-gym booking -- proves
-- three guards at once: member 2's booking on the exact same session (s1)
-- is excluded (never another member's, even on a shared session), the
-- forced past-session booking is excluded, and the forced mismatched-gym_id
-- booking is excluded.
select is(
  (select array_agg(booking_id) from list_my_class_bookings()),
  array['00000000-0000-0000-0000-0000000090b1']::uuid[],
  'list_my_class_bookings() returns only the caller''s own future, correctly-scoped booking'
);

-- (i) can_cancel is true well before the gym's default 120-minute cutoff.
select is(
  (select can_cancel from list_my_class_bookings() where booking_id = '00000000-0000-0000-0000-0000000090b1'),
  true,
  'can_cancel is true for a booking well outside the cancellation cutoff'
);

reset role;

-- (j) can_cancel is false inside the cutoff (a different member's booking on
-- s4, scheduled 1 hour out, inside the 120-minute default cutoff).
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009028","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"member"}',
  true
);

select is(
  (select can_cancel from list_my_class_bookings() where booking_id = '00000000-0000-0000-0000-0000000090b4'),
  false,
  'can_cancel is false for a booking inside the cancellation cutoff'
);

reset role;

select * from finish();
rollback;
