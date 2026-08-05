-- Story 1.7: Escalated Gym Data Access (FR-072). New RLS policies from
-- 0012_super_admin_data_access_escalation.sql -- super_admin_read_audit_log,
-- super_admin_escalated_read_members, super_admin_escalated_read_payments.
-- Session-simulation conventions match gyms_super_admin_rls.test.sql. All
-- fixture rows (including the 'gym_data_escalation' audit_log row that IS
-- the access grant, per the migration's design note) are seeded up front as
-- the connecting role, same convention as every other RLS test file --
-- actor Y (no escalation) stands in for the "before escalation" case
-- instead of toggling one session's own state mid-transaction.

begin;
select plan(9);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000003001', 'Escalation Test Tier', 5000, 50000, 30);

insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-000000003011', 'Escalation Gym A', '00000000-0000-0000-0000-000000003001', 30),
  ('00000000-0000-0000-0000-000000003012', 'Escalation Gym B', '00000000-0000-0000-0000-000000003001', 30);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000003021'), -- super_admin actor X (escalated to Gym A)
  ('00000000-0000-0000-0000-000000003022'), -- super_admin actor Y (never escalates)
  ('00000000-0000-0000-0000-000000003023'), -- Gym A owner
  ('00000000-0000-0000-0000-000000003024'), -- Gym A coach (non-owner)
  ('00000000-0000-0000-0000-000000003025'); -- Gym B coach (non-owner)

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000003031', '00000000-0000-0000-0000-000000003011', '00000000-0000-0000-0000-000000003023', 'owner', 'Gym A Owner'),
  ('00000000-0000-0000-0000-000000003032', '00000000-0000-0000-0000-000000003011', '00000000-0000-0000-0000-000000003024', 'coach', 'Gym A Coach'),
  ('00000000-0000-0000-0000-000000003033', '00000000-0000-0000-0000-000000003012', '00000000-0000-0000-0000-000000003025', 'coach', 'Gym B Coach');

insert into payments (id, gym_id, member_id, amount, method, status) values
  ('00000000-0000-0000-0000-000000003041', '00000000-0000-0000-0000-000000003011', '00000000-0000-0000-0000-000000003032', 5000, 'cash', 'verified'),
  ('00000000-0000-0000-0000-000000003042', '00000000-0000-0000-0000-000000003012', '00000000-0000-0000-0000-000000003033', 5000, 'cash', 'verified');

-- The escalation grant itself: a 'gym_data_escalation' audit_log row for
-- (Gym A, actor X), simulating what log_audit_event() would have written.
insert into audit_log (gym_id, actor_id, actor_display_name, action_type, target_entity_id, target_entity_type, metadata)
values (
  '00000000-0000-0000-0000-000000003011',
  '00000000-0000-0000-0000-000000003021',
  'Super Admin X',
  'gym_data_escalation',
  '00000000-0000-0000-0000-000000003011',
  'gym',
  '{"reason": "test escalation"}'::jsonb
);

-- ============================================================================
-- Actor Y: a super_admin who never escalated to Gym A -- AC #1's regression
-- guard. Sees only the existing role='owner' scope (Story 1.5), never the
-- coach row or any payments, for a gym it otherwise has full visibility into.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000003022","role":"authenticated","app_role":"super_admin"}',
  true
);

select is(
  (select count(*) from members where gym_id = '00000000-0000-0000-0000-000000003011' and role = 'coach')::int, 0,
  'a super_admin with no escalation of their own sees 0 non-owner members rows for Gym A'
);

select is(
  (select count(*) from payments where gym_id = '00000000-0000-0000-0000-000000003011')::int, 0,
  'a super_admin with no escalation of their own sees 0 payments rows for Gym A'
);

-- ============================================================================
-- Actor X: escalated to Gym A -- sees Gym A's non-owner members and
-- payments (AC #2's "access is granted").
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000003021","role":"authenticated","app_role":"super_admin"}',
  true
);

select is(
  (select count(*) from members where gym_id = '00000000-0000-0000-0000-000000003011' and role = 'coach')::int, 1,
  'super_admin actor X (escalated to Gym A) sees Gym A''s coach (non-owner) members row'
);

select is(
  (select name from members where gym_id = '00000000-0000-0000-0000-000000003011' and role = 'coach'),
  'Gym A Coach',
  'the visible non-owner row is the expected coach, confirming real row-level access, not a miscount'
);

select is(
  (select count(*) from payments where gym_id = '00000000-0000-0000-0000-000000003011')::int, 1,
  'super_admin actor X (escalated to Gym A) sees Gym A''s payments row'
);

-- ============================================================================
-- Actor X's Gym A escalation does not leak into Gym B -- escalation is
-- per-gym, not global once granted anywhere.
-- ============================================================================
select is(
  (select count(*) from members where gym_id = '00000000-0000-0000-0000-000000003012' and role = 'coach')::int, 0,
  'actor X''s Gym A escalation grants no visibility into Gym B''s non-owner members rows'
);

select is(
  (select count(*) from payments where gym_id = '00000000-0000-0000-0000-000000003012')::int, 0,
  'actor X''s Gym A escalation grants no visibility into Gym B''s payments rows'
);

-- ============================================================================
-- super_admin_read_audit_log: platform-wide for super_admin (scoped to this
-- test's own fixture gym_id, not a bare unfiltered count -- the local dev
-- database can carry other committed audit_log rows from unrelated manual
-- testing, same class of fragility Story 1.6 hit with tier-name fixture
-- collisions). A regular gym-scoped owner session ALSO sees this row now --
-- Story 7.2's manager_or_owner_read_own_audit_log policy
-- (0049_audit_log_dashboard_read_policy.sql) OR's in a gym-scoped
-- Manager/Owner grant alongside this Super-Admin-only policy; this test
-- previously asserted the pre-7.2 deny-all state, which no longer holds.
-- ============================================================================
select is(
  (select count(*) from audit_log where gym_id = '00000000-0000-0000-0000-000000003011')::int, 1,
  'super_admin sees the one audit_log row seeded in this test for Gym A (platform-wide read access)'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000003023","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000003011","app_role":"owner"}',
  true
);

select is(
  (select count(*) from audit_log where gym_id = '00000000-0000-0000-0000-000000003011')::int, 1,
  'an owner-claim session for its own gym now sees that gym''s audit_log row -- Story 7.2''s manager_or_owner_read_own_audit_log policy grants this, coexisting (OR''d) with the Super-Admin-only policy asserted above'
);

select * from finish();
rollback;
