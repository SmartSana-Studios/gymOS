-- Story 1.8: Gym Owner Login & Role-Filtered Dashboard Shell. New RLS
-- policy from 0013_dashboard_shell_self_read.sql -- self_read_own_membership.
-- Session-simulation conventions match gym_data_escalation_rls.test.sql:
-- all fixture rows seeded up front as the connecting role, then
-- `set local role authenticated` + `set_config('request.jwt.claims', ...)`
-- per simulated session.

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
-- An owner-claim session sees exactly its own row -- not the gym's other
-- members (regression: this policy must not accidentally become a
-- roster-read, which is Epic 2's job, not this story's).
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
  (select count(*) from members where user_id = '00000000-0000-0000-0000-000000004022')::int, 0,
  'an owner-claim session sees 0 rows when querying a different user_id at the same gym -- self-read only, not a roster-read'
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
  'a coach-claim session sees 0 rows when querying the gym owner''s user_id -- self-read only'
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
