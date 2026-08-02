-- Story 1.8: Gym Owner Login & Role-Filtered Dashboard Shell. New RLS
-- policy from 0013_dashboard_shell_self_read.sql -- self_read_own_membership.
-- Session-simulation conventions match gym_data_escalation_rls.test.sql:
-- all fixture rows seeded up front as the connecting role, then
-- `set local role authenticated` + `set_config('request.jwt.claims', ...)`
-- per simulated session.
--
-- As of Story 2.3 (0018_member_management.sql), `members` also carries
-- gym_staff_read_own_members -- scoped to gym_id = private.gym_id() and
-- gated to owner/manager/receptionist/coach -- so a same-gym query by a
-- different user_id (test 3 below) is no longer 0 rows for those roles: an
-- owner/manager/receptionist/coach session now legitimately sees its own
-- gym's full roster (AC #5, member search/list), not just its own row.
--
-- As of Story 5.2 (0040_coach_portal_member_list_rls.sql), `coach` is
-- dropped from gym_staff_read_own_members' role array (AC #3's assignment-
-- scoped narrowing) -- test 5 below reverts to asserting a coach-claim
-- session sees 0 rows for a different user_id (the gym owner, who is never
-- one of that coach's assigned members), the pure self-read-only shape this
-- test originally proved before Story 2.3 broadened it for every staff role
-- including coach. This file's cross-tenant (test 4) and
-- same-identity-two-gyms (tests 6-7) assertions are unaffected --
-- gym_staff_read_own_members is still gym_id-scoped, so it grants no
-- visibility across tenants or into a claim's non-active gym.

begin;
select plan(8);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000004001', 'Self Read Test Tier', 5000, 50000, 30);

insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-000000004011', 'Self Read Gym A', '00000000-0000-0000-0000-000000004001', 30),
  ('00000000-0000-0000-0000-000000004012', 'Self Read Gym B', '00000000-0000-0000-0000-000000004001', 30);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000004021'), -- Gym A owner
  ('00000000-0000-0000-0000-000000004022'), -- Gym A coach
  ('00000000-0000-0000-0000-000000004023'), -- Gym B owner (also happens to be a different user)
  ('00000000-0000-0000-0000-000000004024'); -- same person, membership at both Gym A and Gym B

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000004031', '00000000-0000-0000-0000-000000004011', '00000000-0000-0000-0000-000000004021', 'owner', 'Gym A Owner'),
  ('00000000-0000-0000-0000-000000004032', '00000000-0000-0000-0000-000000004011', '00000000-0000-0000-0000-000000004022', 'coach', 'Gym A Coach'),
  ('00000000-0000-0000-0000-000000004033', '00000000-0000-0000-0000-000000004012', '00000000-0000-0000-0000-000000004023', 'owner', 'Gym B Owner'),
  ('00000000-0000-0000-0000-000000004034', '00000000-0000-0000-0000-000000004011', '00000000-0000-0000-0000-000000004024', 'receptionist', 'Multi-Gym Staffer A'),
  ('00000000-0000-0000-0000-000000004035', '00000000-0000-0000-0000-000000004012', '00000000-0000-0000-0000-000000004024', 'manager', 'Multi-Gym Staffer B');

-- ============================================================================
-- self_read_own_membership itself still scopes an owner-claim session to
-- exactly its own row when queried by its own user_id (test just below).
-- The *other* gym member (test at line ~64) is now also visible, but via
-- gym_staff_read_own_members (Story 2.3), a second, independent policy --
-- not because this policy's own shape changed.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000004021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000004011","app_role":"owner"}',
  true
);

select is(
  (select count(*) from members where user_id = '00000000-0000-0000-0000-000000004021')::int, 1,
  'an owner-claim session sees exactly its own membership row'
);

select is(
  (select name from members where user_id = '00000000-0000-0000-0000-000000004021'),
  'Gym A Owner',
  'the visible row is the expected owner, confirming real row-level access, not a miscount'
);

select is(
  (select count(*) from members where user_id = '00000000-0000-0000-0000-000000004022')::int, 1,
  'an owner-claim session sees 1 row when querying a different user_id at the same gym -- as of Story 2.3, gym_staff_read_own_members legitimately grants this (full-roster visibility, AC #5), no longer the pure self-read-only shape this assertion originally proved'
);

-- ============================================================================
-- A coach-claim session likewise sees only its own row, not the gym's
-- owner/manager rows.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000004022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000004011","app_role":"coach"}',
  true
);

select is(
  (select count(*) from members where user_id = '00000000-0000-0000-0000-000000004022')::int, 1,
  'a coach-claim session sees exactly its own membership row'
);

select is(
  (select count(*) from members where user_id = '00000000-0000-0000-0000-000000004021')::int, 0,
  'a coach-claim session sees 0 rows when querying the gym owner''s user_id -- as of Story 5.2 (0040_coach_portal_member_list_rls.sql), gym_staff_read_own_members no longer includes ''coach'', and the owner is not one of this coach''s assigned members via coach_read_assigned_members -- reverting the Story 2.3-era full-roster visibility this assertion previously proved for coach specifically (AC #3: a coach sees only their own row plus assigned members)'
);

-- ============================================================================
-- Cross-tenant: a session sees 0 rows querying a different gym's member's
-- user_id, even though self_read_own_membership's USING clause has no
-- gym_id check by design (the policy scopes by user_id alone; a caller only
-- ever sees rows matching *their own* auth.uid(), so a query for a
-- different user_id -- regardless of gym -- correctly returns 0 rather than
-- relying on gym_id filtering to enforce tenant isolation here).
-- ============================================================================
select is(
  (select count(*) from members where user_id = '00000000-0000-0000-0000-000000004023')::int, 0,
  'a Gym A coach-claim session sees 0 rows querying Gym B owner''s user_id -- self-read is scoped by identity, not gym'
);

-- ============================================================================
-- Same identity, two gyms: self_read_own_membership's USING clause has no
-- gym_id check by design (0013_dashboard_shell_self_read.sql's own comment:
-- "the row already belongs to the caller regardless of which gym it's
-- scoped to"). A session claimed for Gym A must still see BOTH of its own
-- membership rows (Gym A and Gym B) when querying by user_id alone, proving
-- RLS itself does not narrow by gym_id -- tenant-scoping for the
-- currently-active gym is enforced at the application query layer
-- (services/session.ts's own .eq('gym_id', gymId) filter), not by this
-- policy. Assert this exact shape rather than assuming it away.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000004024","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000004011","app_role":"receptionist"}',
  true
);

select is(
  (select count(*) from members where user_id = '00000000-0000-0000-0000-000000004024')::int, 2,
  'a session claimed for Gym A sees BOTH of its own membership rows (Gym A and Gym B) -- self_read_own_membership does not gym_id-scope, by design'
);

select is(
  (select array_agg(gym_id order by gym_id) from members where user_id = '00000000-0000-0000-0000-000000004024'),
  array['00000000-0000-0000-0000-000000004011', '00000000-0000-0000-0000-000000004012']::uuid[],
  'the two visible rows are exactly the Gym A and Gym B memberships, confirming real cross-gym visibility, not a miscount'
);

select * from finish();
rollback;
