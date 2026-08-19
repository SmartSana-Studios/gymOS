-- Story 9.1 negative privilege contract: `members` has no direct write path
-- for a staff role -- `create_staff_member()` (SECURITY DEFINER) is the only
-- way a non-'member'-role row can ever be created; `manager_or_owner_insert_own_members`
-- (0018) still pins its own `with check` to `role = 'member'` only, and this
-- story adds no new INSERT policy at all. Also confirms the RLS read
-- widening (0061) covers exactly what Task 2 specifies: 'supervisor' can now
-- read the full gym roster, tenant-isolated the same as every other staff
-- role already covered, while 'coach' remains deliberately excluded (Story
-- 5.2's own narrowing, which a careless copy of this story's own Dev Notes
-- text would have silently reverted -- see 0061's own header comment).

begin;
select plan(7);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000017201', 'Staff Creation Negative Test Tier', 5000, 50000, 20);

insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-000000017211', 'Staff Creation Negative Gym A', '00000000-0000-0000-0000-000000017201', 30),
  ('00000000-0000-0000-0000-000000017212', 'Staff Creation Negative Gym B', '00000000-0000-0000-0000-000000017201', 30);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000017221'), -- Gym A owner
  ('00000000-0000-0000-0000-000000017222'), -- Gym A supervisor
  ('00000000-0000-0000-0000-000000017223'), -- Gym A coach
  ('00000000-0000-0000-0000-000000017224'), -- Gym B supervisor
  ('00000000-0000-0000-0000-000000017231'); -- a brand-new user_id, no members row -- INSERT target only

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000017271', '00000000-0000-0000-0000-000000017211', '00000000-0000-0000-0000-000000017221', 'owner', 'Staff Creation Negative Gym A Owner'),
  ('00000000-0000-0000-0000-000000017272', '00000000-0000-0000-0000-000000017211', '00000000-0000-0000-0000-000000017222', 'supervisor', 'Staff Creation Negative Gym A Supervisor'),
  ('00000000-0000-0000-0000-000000017273', '00000000-0000-0000-0000-000000017211', '00000000-0000-0000-0000-000000017223', 'coach', 'Staff Creation Negative Gym A Coach'),
  ('00000000-0000-0000-0000-000000017274', '00000000-0000-0000-0000-000000017212', '00000000-0000-0000-0000-000000017224', 'supervisor', 'Staff Creation Negative Gym B Supervisor');

-- ============================================================================
-- (a) An owner-claim session cannot directly INSERT a staff-role members row
-- -- manager_or_owner_insert_own_members's `with check` still pins
-- `role = 'member'` only (0018), unchanged by this story. Confirms the RPC
-- path is the ONLY way a staff row gets created, not a new gap this story
-- introduces.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000017221","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000017211","app_role":"owner"}',
  true
);

select throws_like(
  $$insert into members (gym_id, user_id, role, name)
    values ('00000000-0000-0000-0000-000000017211', '00000000-0000-0000-0000-000000017231', 'coach', 'Bypassed Coach')$$,
  '%row-level security%',
  'an owner-claim session cannot directly INSERT a staff-role (non-''member'') members row, bypassing create_staff_member()'
);

reset role;

-- ============================================================================
-- (b) A supervisor-claim session cannot directly INSERT ANY members row --
-- manager_or_owner_insert_own_members's role check is `['manager','owner']`
-- only, never 'supervisor', even for role = 'member'.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000017222","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000017211","app_role":"supervisor"}',
  true
);

select throws_like(
  $$insert into members (gym_id, user_id, role, name)
    values ('00000000-0000-0000-0000-000000017211', '00000000-0000-0000-0000-000000017231', 'member', 'Bypassed Member')$$,
  '%row-level security%',
  'a supervisor-claim session cannot directly INSERT into members at all -- manager_or_owner_insert_own_members never covers ''supervisor'''
);

reset role;

-- ============================================================================
-- (c) anon cannot INSERT into members (no table-level grant at all).
-- ============================================================================
set local role anon;

select throws_like(
  $$insert into members (gym_id, user_id, role, name)
    values ('00000000-0000-0000-0000-000000017211', '00000000-0000-0000-0000-000000017231', 'coach', 'Anon Bypass')$$,
  '%permission denied%',
  'anon cannot INSERT into members (no table-level grant at all)'
);

reset role;

-- ============================================================================
-- (d) A Supervisor session can now SELECT the full gym roster via the
-- widened gym_staff_read_own_members (AC #5) -- 3 rows: the owner, itself,
-- and the coach.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000017222","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000017211","app_role":"supervisor"}',
  true
);

select is(
  (select count(*)::int from members where gym_id = '00000000-0000-0000-0000-000000017211'),
  3,
  'a supervisor-claim session can SELECT its own gym''s full 3-row staff roster'
);

reset role;

-- ============================================================================
-- (e) A cross-gym Supervisor sees none of Gym A's staff (tenant isolation).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000017224","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000017212","app_role":"supervisor"}',
  true
);

select is(
  (select count(*)::int from members where gym_id = '00000000-0000-0000-0000-000000017211'),
  0,
  'a cross-gym supervisor-claim session sees 0 of Gym A''s staff rows'
);

reset role;

-- ============================================================================
-- (f) Coach remains deliberately excluded from gym_staff_read_own_members
-- (Story 5.2's own narrowing, 0040) -- this story's widening must not
-- accidentally re-include it. No coach_assignments seeded, so
-- coach_read_assigned_members contributes nothing -- the only row a coach
-- session sees is their own, via the separate self_read_own_membership
-- policy (0013, `user_id = auth.uid()`, unconditional on role), not the
-- gym-wide staff-read policy this story touches.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000017223","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000017211","app_role":"coach"}',
  true
);

select is(
  (select count(*)::int from members where gym_id = '00000000-0000-0000-0000-000000017211'),
  1,
  'a coach-claim session sees exactly 1 members row (their own, via self_read_own_membership) -- gym_staff_read_own_members remains deliberately excluding ''coach'' after this story''s widening'
);

select is(
  (select id from members where gym_id = '00000000-0000-0000-0000-000000017211' and user_id = auth.uid()),
  '00000000-0000-0000-0000-000000017273'::uuid,
  'the one visible row is the coach''s own, not another staff member''s row leaking through the widened policy'
);

reset role;

select * from finish();
rollback;
