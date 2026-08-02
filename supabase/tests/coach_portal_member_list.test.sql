-- Story 5.2: Coach Portal -- Assigned Member List. Tests
-- `private.is_assigned_coach()` and the RLS narrowing/additive policies
-- (0040_coach_portal_member_list_rls.sql). Mirrors
-- coach_member_assignment.test.sql's fixture-seeding/session-simulation
-- conventions (`set local role authenticated` +
-- `set_config('request.jwt.claims', ...)`, fixtures seeded up front as the
-- connecting role, `reset role` before reading back committed state).
--
-- The critical regression this file exists to catch (Scope Notes, story
-- file): a naive correlated subquery written directly inside the coach RLS
-- policies (no SECURITY DEFINER on the helper) would silently return zero
-- rows for every coach, always, because coach_assignments'/members' own RLS
-- blocks the helper's internal reads for the calling coach session -- no
-- error, just a wrong empty result. The base-table assertions below (direct
-- `members` queries, not just `subscriptions_current`) are what would have
-- caught that.

begin;
select plan(20);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000014001', 'Coach Portal Member List Test Tier', 5000, 50000, 30);

insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-000000014011', 'Coach Portal Gym A', '00000000-0000-0000-0000-000000014001', 30),
  ('00000000-0000-0000-0000-000000014012', 'Coach Portal Gym B', '00000000-0000-0000-0000-000000014001', 30);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000014021'), -- Gym A owner
  ('00000000-0000-0000-0000-000000014022'), -- Gym A manager
  ('00000000-0000-0000-0000-000000014023'), -- Gym A receptionist
  ('00000000-0000-0000-0000-000000014024'), -- Gym A coach 1
  ('00000000-0000-0000-0000-000000014025'), -- Gym A coach 2
  ('00000000-0000-0000-0000-000000014026'), -- Gym A member 1 (assigned to coach 1, active)
  ('00000000-0000-0000-0000-000000014027'), -- Gym A member 2 (assigned to coach 1, expired)
  ('00000000-0000-0000-0000-000000014028'), -- Gym A member 3 (assigned to coach 2)
  ('00000000-0000-0000-0000-000000014029'), -- Gym A member 4 (assignment to coach 1 has ended)
  ('00000000-0000-0000-0000-000000014030'), -- Gym A member 5 (never assigned to any coach)
  ('00000000-0000-0000-0000-000000014031'), -- Gym B owner
  ('00000000-0000-0000-0000-000000014032'), -- Gym B coach 1
  ('00000000-0000-0000-0000-000000014033'); -- Gym B member 1 (assigned to Gym B coach 1)

insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000014071', '00000000-0000-0000-0000-000000014011', '00000000-0000-0000-0000-000000014021', 'owner', 'Coach Portal Gym A Owner', current_date),
  ('00000000-0000-0000-0000-000000014072', '00000000-0000-0000-0000-000000014011', '00000000-0000-0000-0000-000000014022', 'manager', 'Coach Portal Gym A Manager', current_date),
  ('00000000-0000-0000-0000-000000014073', '00000000-0000-0000-0000-000000014011', '00000000-0000-0000-0000-000000014023', 'receptionist', 'Coach Portal Gym A Receptionist', current_date),
  ('00000000-0000-0000-0000-000000014074', '00000000-0000-0000-0000-000000014011', '00000000-0000-0000-0000-000000014024', 'coach', 'Coach Portal Gym A Coach 1', current_date),
  ('00000000-0000-0000-0000-000000014075', '00000000-0000-0000-0000-000000014011', '00000000-0000-0000-0000-000000014025', 'coach', 'Coach Portal Gym A Coach 2', current_date),
  ('00000000-0000-0000-0000-000000014076', '00000000-0000-0000-0000-000000014011', '00000000-0000-0000-0000-000000014026', 'member', 'Coach Portal Gym A Member 1', current_date),
  ('00000000-0000-0000-0000-000000014077', '00000000-0000-0000-0000-000000014011', '00000000-0000-0000-0000-000000014027', 'member', 'Coach Portal Gym A Member 2', current_date),
  ('00000000-0000-0000-0000-000000014078', '00000000-0000-0000-0000-000000014011', '00000000-0000-0000-0000-000000014028', 'member', 'Coach Portal Gym A Member 3', current_date),
  ('00000000-0000-0000-0000-000000014079', '00000000-0000-0000-0000-000000014011', '00000000-0000-0000-0000-000000014029', 'member', 'Coach Portal Gym A Member 4', current_date),
  ('00000000-0000-0000-0000-000000014080', '00000000-0000-0000-0000-000000014011', '00000000-0000-0000-0000-000000014030', 'member', 'Coach Portal Gym A Member 5', current_date),
  ('00000000-0000-0000-0000-000000014091', '00000000-0000-0000-0000-000000014012', '00000000-0000-0000-0000-000000014031', 'owner', 'Coach Portal Gym B Owner', current_date),
  ('00000000-0000-0000-0000-000000014092', '00000000-0000-0000-0000-000000014012', '00000000-0000-0000-0000-000000014032', 'coach', 'Coach Portal Gym B Coach 1', current_date),
  ('00000000-0000-0000-0000-000000014093', '00000000-0000-0000-0000-000000014012', '00000000-0000-0000-0000-000000014033', 'member', 'Coach Portal Gym B Member 1', current_date);

insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000014101', '00000000-0000-0000-0000-000000014011', 'Coach Portal Test Monthly A', 'monthly', 15000, 'XAF', 'monthly', 30),
  ('00000000-0000-0000-0000-000000014102', '00000000-0000-0000-0000-000000014012', 'Coach Portal Test Monthly B', 'monthly', 15000, 'XAF', 'monthly', 30);

insert into subscriptions (id, gym_id, member_id, plan_id, status, start_date, expiry_date) values
  ('00000000-0000-0000-0000-000000014111', '00000000-0000-0000-0000-000000014011', '00000000-0000-0000-0000-000000014076', '00000000-0000-0000-0000-000000014101', 'active', current_date - 10, current_date + 20),
  ('00000000-0000-0000-0000-000000014112', '00000000-0000-0000-0000-000000014011', '00000000-0000-0000-0000-000000014077', '00000000-0000-0000-0000-000000014101', 'expired', current_date - 50, current_date - 20),
  ('00000000-0000-0000-0000-000000014113', '00000000-0000-0000-0000-000000014011', '00000000-0000-0000-0000-000000014078', '00000000-0000-0000-0000-000000014101', 'active', current_date - 10, current_date + 20),
  ('00000000-0000-0000-0000-000000014114', '00000000-0000-0000-0000-000000014011', '00000000-0000-0000-0000-000000014079', '00000000-0000-0000-0000-000000014101', 'active', current_date - 10, current_date + 20),
  ('00000000-0000-0000-0000-000000014116', '00000000-0000-0000-0000-000000014011', '00000000-0000-0000-0000-000000014080', '00000000-0000-0000-0000-000000014101', 'active', current_date - 10, current_date + 20),
  ('00000000-0000-0000-0000-000000014115', '00000000-0000-0000-0000-000000014012', '00000000-0000-0000-0000-000000014093', '00000000-0000-0000-0000-000000014102', 'active', current_date - 10, current_date + 20);

-- Member 1 -> Coach 1 (active), Member 2 -> Coach 1 (active assignment, but
-- the member's *subscription* status is expired -- AC #2's "expired members
-- remain visible" case), Member 3 -> Coach 2, Member 4's assignment to
-- Coach 1 has already ended (ended_at not null -- must NOT grant access),
-- Member 5 has no coach_assignments row at all (genuinely never assigned --
-- Task 8's fixture literally calls for this case, distinct from Member 4's
-- ended-assignment case).
insert into coach_assignments (id, gym_id, member_id, coach_id, started_at, ended_at) values
  ('00000000-0000-0000-0000-000000014121', '00000000-0000-0000-0000-000000014011', '00000000-0000-0000-0000-000000014076', '00000000-0000-0000-0000-000000014074', now() - interval '30 days', null),
  ('00000000-0000-0000-0000-000000014122', '00000000-0000-0000-0000-000000014011', '00000000-0000-0000-0000-000000014077', '00000000-0000-0000-0000-000000014074', now() - interval '30 days', null),
  ('00000000-0000-0000-0000-000000014123', '00000000-0000-0000-0000-000000014011', '00000000-0000-0000-0000-000000014078', '00000000-0000-0000-0000-000000014075', now() - interval '30 days', null),
  ('00000000-0000-0000-0000-000000014124', '00000000-0000-0000-0000-000000014011', '00000000-0000-0000-0000-000000014079', '00000000-0000-0000-0000-000000014074', now() - interval '60 days', now() - interval '30 days'),
  ('00000000-0000-0000-0000-000000014125', '00000000-0000-0000-0000-000000014012', '00000000-0000-0000-0000-000000014093', '00000000-0000-0000-0000-000000014092', now() - interval '30 days', null);

-- ============================================================================
-- (a) Critical regression test for the Scope Notes bug: as Coach 1, a direct
-- base-table `members` query for their own assigned member returns exactly
-- 1 row. A naive (non-SECURITY-DEFINER) helper would silently return 0 here.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000014024","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000014011","app_role":"coach"}',
  true
);

select is(
  (select count(*)::int from members where id = '00000000-0000-0000-0000-000000014076'),
  1,
  'Coach 1 can read Member 1''s base members row directly -- the SECURITY DEFINER helper works, not silently zero'
);

-- ============================================================================
-- (b) An ended assignment grants no access -- Member 4's Coach-1 assignment
-- has ended_at set, so Coach 1 must not see Member 4 at all.
-- ============================================================================
select is(
  (select count(*)::int from members where id = '00000000-0000-0000-0000-000000014079'),
  0,
  'Coach 1 cannot read Member 4 -- their assignment to Coach 1 has already ended'
);

-- ============================================================================
-- (c) AC #3: Coach 1 cannot see Member 3, who is assigned to Coach 2.
-- ============================================================================
select is(
  (select count(*)::int from members where id = '00000000-0000-0000-0000-000000014078'),
  0,
  'Coach 1 cannot read Member 3 -- assigned to Coach 2, not Coach 1'
);

-- ============================================================================
-- (c2) Member 5 has no coach_assignments row at all (genuinely unassigned,
-- not just an ended assignment) -- Coach 1 must not see them either.
-- ============================================================================
select is(
  (select count(*)::int from members where id = '00000000-0000-0000-0000-000000014080'),
  0,
  'Coach 1 cannot read Member 5 -- never assigned to any coach'
);

-- ============================================================================
-- (d) AC #2: subscriptions_current, queried as Coach 1, returns exactly
-- Member 1 (active) and Member 2 (expired) -- both visible, in particular
-- the expired one -- and never Member 3 (Coach 2's) or Member 4 (ended).
-- ============================================================================
select is(
  (select array_agg(member_id order by member_id) from subscriptions_current where gym_id = '00000000-0000-0000-0000-000000014011'),
  array[
    '00000000-0000-0000-0000-000000014076',
    '00000000-0000-0000-0000-000000014077'
  ]::uuid[],
  'Coach 1 sees exactly Member 1 and Member 2 via subscriptions_current -- never Coach 2''s member or the ended-assignment member'
);

select is(
  (select array_agg(status order by member_id) from subscriptions_current where gym_id = '00000000-0000-0000-0000-000000014011'),
  array['active', 'expired']::subscription_status[],
  'Member 1 is active and Member 2 is expired -- both remain visible (AC #2)'
);

-- ============================================================================
-- (e) Coach 2 sees only their 1 assigned member (Member 3).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000014025","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000014011","app_role":"coach"}',
  true
);

select is(
  (select array_agg(member_id) from subscriptions_current where gym_id = '00000000-0000-0000-0000-000000014011'),
  array['00000000-0000-0000-0000-000000014078']::uuid[],
  'Coach 2 sees exactly Member 3, their only assigned member'
);

select is(
  (select count(*)::int from members where id = '00000000-0000-0000-0000-000000014080'),
  0,
  'Coach 2 cannot read Member 5 -- never assigned to any coach'
);

-- ============================================================================
-- (f) Regression check: Owner/Manager/Receptionist still see the full Gym A
-- roster on `members`/`subscriptions_current` -- confirms the ALTER POLICY
-- narrowing removed only 'coach', not the roles it was never meant to touch.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000014021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000014011","app_role":"owner"}',
  true
);

select is(
  (select count(*)::int from members where gym_id = '00000000-0000-0000-0000-000000014011'),
  10,
  'an owner-claim session still sees the full Gym A roster (5 staff + 5 members) on members'
);

select is(
  (select count(*)::int from subscriptions_current where gym_id = '00000000-0000-0000-0000-000000014011'),
  5,
  'an owner-claim session still sees all 5 Gym A members'' subscriptions via subscriptions_current'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000014022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000014011","app_role":"manager"}',
  true
);

select is(
  (select count(*)::int from members where gym_id = '00000000-0000-0000-0000-000000014011'),
  10,
  'a manager-claim session still sees the full Gym A roster on members'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000014023","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000014011","app_role":"receptionist"}',
  true
);

select is(
  (select count(*)::int from members where gym_id = '00000000-0000-0000-0000-000000014011'),
  10,
  'a receptionist-claim session still sees the full Gym A roster on members'
);

select is(
  (select count(*)::int from subscriptions_current where gym_id = '00000000-0000-0000-0000-000000014011'),
  5,
  'a receptionist-claim session still sees all 5 Gym A members'' subscriptions via subscriptions_current'
);

-- ============================================================================
-- (g) Cross-gym tenant isolation: a coach session authenticated against Gym
-- A sees zero rows for Gym B's members/coach_assignments, even though Gym
-- B has a coincidentally identical coach->member assignment shape.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000014024","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000014011","app_role":"coach"}',
  true
);

select is(
  (select count(*)::int from members where id = '00000000-0000-0000-0000-000000014093'),
  0,
  'a Gym A coach-claim session sees 0 rows for Gym B''s assigned member -- tenant isolation'
);

select is(
  (select count(*)::int from subscriptions_current where gym_id = '00000000-0000-0000-0000-000000014012'),
  0,
  'a Gym A coach-claim session sees 0 rows for Gym B via subscriptions_current -- tenant isolation'
);

-- ============================================================================
-- (h) private.is_assigned_coach() called directly. `reset role` first --
-- this helper is granted to authenticated generally, but exercising it
-- directly still needs an authenticated session with a real auth.uid() to
-- match against.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000014024","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000014011","app_role":"coach"}',
  true
);

select is(
  (select private.is_assigned_coach('00000000-0000-0000-0000-000000014076')),
  true,
  'private.is_assigned_coach() returns true for a real, active assignment'
);

-- Same uid, a deliberately mismatched app_role claim ("owner") -- the
-- helper itself never inspects app_role, only auth.uid()/gym_id, so this
-- proves it isn't accidentally role-gated internally (that gating lives in
-- the outer RLS policy, not this helper) -- "called directly (as any role)"
-- from Task 8's spec.
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000014024","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000014011","app_role":"owner"}',
  true
);

select is(
  (select private.is_assigned_coach('00000000-0000-0000-0000-000000014076')),
  true,
  'private.is_assigned_coach() returns true regardless of the caller''s app_role claim'
);

select is(
  (select private.is_assigned_coach('00000000-0000-0000-0000-000000014079')),
  false,
  'private.is_assigned_coach() returns false for an ended assignment'
);

select lives_ok(
  $$select private.is_assigned_coach('00000000-0000-0000-0000-000000000999')$$,
  'private.is_assigned_coach() never raises for a nonexistent member id'
);

select is(
  (select private.is_assigned_coach('00000000-0000-0000-0000-000000000999')),
  false,
  'private.is_assigned_coach() returns false for a nonexistent member id'
);

reset role;
select * from finish();
rollback;
