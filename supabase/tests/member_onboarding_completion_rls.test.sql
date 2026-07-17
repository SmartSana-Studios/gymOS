-- Story 2.7: Member App -- Goal, Experience & Plan Confirmation. New RLS
-- policy and trigger from 0020_member_goal_experience_plan_confirmation.sql
-- -- self_update_own_member_onboarding_fields (UPDATE) plus
-- protect_self_managed_member_columns (BEFORE UPDATE trigger pinning every
-- column except goal/experience_level/onboarding_completed_at back to OLD
-- on a self-update). Session-simulation conventions match
-- member_management_rls.test.sql: fixture rows seeded up front as the
-- connecting role, then `set local role authenticated` +
-- `set_config('request.jwt.claims', ...)` per simulated session.
-- Cross-member denial uses the CTE `returning` pattern
-- (rls_tenant_isolation.test.sql), not a follow-up SELECT, which would
-- return NULL from lack of RLS visibility rather than proving denial.
--
-- Subscription self-read (gym_staff_read_own_subscriptions' self-access
-- exists-clause) is already covered by member_management_rls.test.sql
-- section (g) -- not repeated here. This file adds the one genuinely
-- untested read: a member-claim session reading `plans` for its own gym via
-- gym_staff_read_own_plans (0017), which has no role check at all.

begin;
select plan(14);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000008001', 'Onboarding Completion Test Tier', 5000, 50000, 30);

insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-000000008011', 'Onboarding Completion Test Gym A', '00000000-0000-0000-0000-000000008001', 30),
  ('00000000-0000-0000-0000-000000008012', 'Onboarding Completion Test Gym B', '00000000-0000-0000-0000-000000008001', 30);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000008021'), -- Member A (self-update, the row under test)
  ('00000000-0000-0000-0000-000000008022'); -- Member A2 (a different member, same gym -- cross-member denial)

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000008031', '00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-000000008021', 'member', 'Member A'),
  ('00000000-0000-0000-0000-000000008032', '00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-000000008022', 'member', 'Member A2');

insert into plans (id, gym_id, name, plan_type, price, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000008041', '00000000-0000-0000-0000-000000008011', 'Onboarding Completion Test Plan', 'monthly', 15000, 'monthly', 30),
  ('00000000-0000-0000-0000-000000008042', '00000000-0000-0000-0000-000000008012', 'Gym B Test Plan', 'monthly', 15000, 'monthly', 30);

-- ============================================================================
-- (a) Member A can UPDATE its own goal/experience_level/onboarding_completed_at.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008011","app_role":"member"}',
  true
);

select lives_ok(
  $$update members set goal = 'lose_weight', experience_level = 'beginner', onboarding_completed_at = now()
    where id = '00000000-0000-0000-0000-000000008031'$$,
  'a member can UPDATE their own goal/experience_level/onboarding_completed_at'
);

select is(
  (select goal from members where id = '00000000-0000-0000-0000-000000008031'),
  'lose_weight',
  'the goal change actually persisted'
);

select is(
  (select experience_level from members where id = '00000000-0000-0000-0000-000000008031'),
  'beginner',
  'the experience_level change actually persisted'
);

select ok(
  (select onboarding_completed_at from members where id = '00000000-0000-0000-0000-000000008031') is not null,
  'the onboarding_completed_at change actually persisted'
);

-- ============================================================================
-- (b) Column-guard trigger: a self-update that also tries to flip
-- role/deactivated_at/gym_id/name in the same statement is matched/returned
-- (the row update succeeds at the row level), but those columns stay pinned
-- to their prior values -- protect_self_managed_member_columns fires
-- transparently, not as a rejected UPDATE (same assertion style as
-- users_self_service_rls.test.sql's protect_self_managed_user_columns
-- coverage). goal/experience_level are included in the same statement to
-- prove the pin-back is column-selective, not a blanket revert.
-- ============================================================================
update members
set goal = 'build_muscle', experience_level = 'intermediate', onboarding_completed_at = now(),
    role = 'owner', deactivated_at = now(), gym_id = '00000000-0000-0000-0000-000000008012', name = 'Hacked Name'
where id = '00000000-0000-0000-0000-000000008031';

select is(
  (select role from members where id = '00000000-0000-0000-0000-000000008031')::text,
  'member',
  'a self-update attempting to also set role=owner is silently pinned back to its prior value'
);

select is(
  (select deactivated_at from members where id = '00000000-0000-0000-0000-000000008031'),
  null,
  'a self-update attempting to also set deactivated_at is silently pinned back to its prior (null) value'
);

select is(
  (select gym_id from members where id = '00000000-0000-0000-0000-000000008031')::text,
  '00000000-0000-0000-0000-000000008011',
  'a self-update attempting to also change gym_id is silently pinned back to its prior value'
);

select is(
  (select name from members where id = '00000000-0000-0000-0000-000000008031'),
  'Member A',
  'a self-update attempting to also change name is silently pinned back to its prior value'
);

select is(
  (select goal from members where id = '00000000-0000-0000-0000-000000008031'),
  'build_muscle',
  'goal still updates correctly in the same statement that attempted the pinned columns'
);

select is(
  (select experience_level from members where id = '00000000-0000-0000-0000-000000008031'),
  'intermediate',
  'experience_level still updates correctly in the same statement that attempted the pinned columns'
);

-- ============================================================================
-- (c) Member A can SELECT plans for its own gym (gym_staff_read_own_plans,
-- 0017 -- no role check at all, so a member-claim session already qualifies;
-- asserted explicitly since no existing test covers a member session here).
-- ============================================================================
select is(
  (select count(*)::int from plans where id = '00000000-0000-0000-0000-000000008041'),
  1,
  'a member-claim session can SELECT its own gym''s plan'
);

-- gym_staff_read_own_plans has no role check at all (0017) -- the
-- gym_id = private.gym_id() clause is the only thing standing between a
-- member and another gym's plans, so it needs its own negative-case proof,
-- not just the positive case above (Review finding).
select is(
  (select count(*)::int from plans where id = '00000000-0000-0000-0000-000000008042'),
  0,
  'a member-claim session cannot SELECT a different gym''s plan'
);

-- ============================================================================
-- (d) Member A2 (a different member, same gym) cannot UPDATE Member A's row
-- via this policy -- user_id = auth.uid() excludes it regardless of gym_id
-- match. CTE `returning` proves 0 rows affected, not a follow-up SELECT
-- (which would return NULL from lack of visibility rather than proving
-- denial).
-- ============================================================================
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008011","app_role":"member"}',
  true
);

with updated as (
  update members set goal = 'improve_fitness'
  where id = '00000000-0000-0000-0000-000000008031'
  returning id
)
select is((select count(*) from updated)::int, 0, 'a different member cannot UPDATE another member''s row via self_update_own_member_onboarding_fields');

reset role;
select is(
  (select goal from members where id = '00000000-0000-0000-0000-000000008031'),
  'build_muscle',
  'Member A''s goal is unchanged after the denied cross-member update attempt (verified as the connecting role, bypassing RLS visibility)'
);

select * from finish();
rollback;
