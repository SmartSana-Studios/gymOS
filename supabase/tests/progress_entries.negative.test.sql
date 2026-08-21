-- Story 10.1 negative privilege contract: progress_entries is
-- authenticated/service_role-writable but strictly self-scoped -- anon
-- cannot touch it at all, and gym staff (Manager/Owner/Receptionist/
-- Supervisor) have no staff-facing read/write policy at all (FR-095:
-- "Manager/Owner visibility into member progress data is not planned"), so
-- any staff-role
-- RLS assertion here confirms denial, not access. Story 10.2 later adds a
-- coach-scoped read grant (coach_read_assigned_progress_entries), gated on
-- private.is_assigned_coach() -- the Coach fixture below is deliberately
-- never assigned to the test member, so it still gets 0 rows: this
-- confirms the new coach policy correctly denies an *unassigned* coach, not
-- that no coach policy exists at all (see progress_entries.test.sql for the
-- positive assigned-coach-succeeds/ended-assignment-denied/cross-gym-denied
-- coverage).

begin;
select plan(16);

select ok(
  not has_table_privilege('anon', 'progress_entries', 'SELECT,INSERT,UPDATE,DELETE'),
  'anon has no progress_entries table access at all'
);

select ok(
  has_table_privilege('authenticated', 'progress_entries', 'SELECT')
    and has_table_privilege('authenticated', 'progress_entries', 'INSERT')
    and has_table_privilege('authenticated', 'progress_entries', 'UPDATE'),
  'authenticated has the baseline SELECT/INSERT/UPDATE grant (RLS still scopes it to self)'
);

select ok(
  not has_table_privilege('authenticated', 'progress_entries', 'DELETE'),
  'authenticated has no DELETE grant -- soft-delete only, via UPDATE'
);

select ok(
  has_table_privilege('service_role', 'progress_entries', 'SELECT')
    and has_table_privilege('service_role', 'progress_entries', 'INSERT')
    and has_table_privilege('service_role', 'progress_entries', 'UPDATE')
    and has_table_privilege('service_role', 'progress_entries', 'DELETE'),
  'service_role has the full baseline table-level grant'
);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000009301', 'Progress Entries Negative Test Tier', 5000, 50000, 30);

insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-000000009311', 'Progress Entries Negative Test Gym', '00000000-0000-0000-0000-000000009301', 30);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000009321'), -- Member (the row under test)
  ('00000000-0000-0000-0000-000000009322'), -- Manager
  ('00000000-0000-0000-0000-000000009323'), -- Owner
  ('00000000-0000-0000-0000-000000009324'), -- Receptionist
  ('00000000-0000-0000-0000-000000009325'), -- Coach
  ('00000000-0000-0000-0000-000000009326'); -- Supervisor (Review finding -- AC #1 names Supervisor explicitly)

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000009331', '00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009321', 'member', 'Negative Test Member'),
  ('00000000-0000-0000-0000-000000009332', '00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009322', 'manager', 'Negative Test Manager'),
  ('00000000-0000-0000-0000-000000009333', '00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009323', 'owner', 'Negative Test Owner'),
  ('00000000-0000-0000-0000-000000009334', '00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009324', 'receptionist', 'Negative Test Receptionist'),
  ('00000000-0000-0000-0000-000000009335', '00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009325', 'coach', 'Negative Test Coach'),
  ('00000000-0000-0000-0000-000000009336', '00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009326', 'supervisor', 'Negative Test Supervisor');

insert into progress_entries (member_id, gym_id, weight_kg, client_entry_id)
values ('00000000-0000-0000-0000-000000009331', '00000000-0000-0000-0000-000000009311', 70, '00000000-0000-0000-0000-000000009341');

-- ============================================================================
-- Gym staff (Manager/Owner/Receptionist/Coach) have no staff-facing policy
-- on progress_entries -- only the self policies exist, and none of these
-- staff sessions own the member's row, so both SELECT and UPDATE must
-- resolve to zero rows, not an error (RLS filters silently).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009322","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009311","app_role":"manager"}',
  true
);
select is(
  (select count(*)::int from progress_entries where member_id = '00000000-0000-0000-0000-000000009331'),
  0,
  'a Manager cannot SELECT a member''s progress_entries row -- no staff-facing read policy exists'
);
with updated as (
  update progress_entries set deactivated_at = now()
  where member_id = '00000000-0000-0000-0000-000000009331'
  returning id
)
select is((select count(*) from updated)::int, 0, 'a Manager cannot UPDATE a member''s progress_entries row -- no staff-facing write policy exists');
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009323","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009311","app_role":"owner"}',
  true
);
select is(
  (select count(*)::int from progress_entries where member_id = '00000000-0000-0000-0000-000000009331'),
  0,
  'an Owner cannot SELECT a member''s progress_entries row -- no staff-facing read policy exists'
);
with updated as (
  update progress_entries set deactivated_at = now()
  where member_id = '00000000-0000-0000-0000-000000009331'
  returning id
)
select is((select count(*) from updated)::int, 0, 'an Owner cannot UPDATE a member''s progress_entries row -- no staff-facing write policy exists');
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009324","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009311","app_role":"receptionist"}',
  true
);
select is(
  (select count(*)::int from progress_entries where member_id = '00000000-0000-0000-0000-000000009331'),
  0,
  'a Receptionist cannot SELECT a member''s progress_entries row -- no staff-facing read policy exists'
);
with updated as (
  update progress_entries set deactivated_at = now()
  where member_id = '00000000-0000-0000-0000-000000009331'
  returning id
)
select is((select count(*) from updated)::int, 0, 'a Receptionist cannot UPDATE a member''s progress_entries row -- no staff-facing write policy exists');
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009325","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009311","app_role":"coach"}',
  true
);
select is(
  (select count(*)::int from progress_entries where member_id = '00000000-0000-0000-0000-000000009331'),
  0,
  'an unassigned Coach cannot SELECT a member''s progress_entries row -- coach_read_assigned_progress_entries (Story 10.2) requires an active assignment, which does not exist here'
);
with updated as (
  update progress_entries set deactivated_at = now()
  where member_id = '00000000-0000-0000-0000-000000009331'
  returning id
)
select is((select count(*) from updated)::int, 0, 'a Coach cannot UPDATE a member''s progress_entries row -- no staff-facing write policy exists');
reset role;

-- Review finding: AC #1 explicitly names Supervisor among the roles that
-- must never read this data; only Manager/Owner/Receptionist/Coach were
-- previously covered here.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009326","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009311","app_role":"supervisor"}',
  true
);
select is(
  (select count(*)::int from progress_entries where member_id = '00000000-0000-0000-0000-000000009331'),
  0,
  'a Supervisor cannot SELECT a member''s progress_entries row -- no staff-facing read policy exists'
);
with updated as (
  update progress_entries set deactivated_at = now()
  where member_id = '00000000-0000-0000-0000-000000009331'
  returning id
)
select is((select count(*) from updated)::int, 0, 'a Supervisor cannot UPDATE a member''s progress_entries row -- no staff-facing write policy exists');
reset role;

select ok(
  (select deactivated_at from progress_entries where member_id = '00000000-0000-0000-0000-000000009331') is null,
  'the member''s row is unchanged after all five denied staff-role update attempts (verified as the connecting role, bypassing RLS visibility)'
);

-- ============================================================================
-- progress-photos Storage bucket: gym staff has no folder-scoped access to
-- a member's photo folder either (anon's own storage.objects table
-- privilege is a platform-wide baseline set outside this migration, not
-- re-asserted here).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009322","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009311","app_role":"manager"}',
  true
);
select throws_like(
  $$insert into storage.objects (bucket_id, name, owner)
    values ('progress-photos', '00000000-0000-0000-0000-000000009321/hacked.jpg', auth.uid())$$,
  '%row-level security%',
  'a Manager cannot insert into a member''s progress-photos folder -- folder-scoped to the uploader''s own auth.uid()'
);
reset role;

select * from finish();
rollback;
