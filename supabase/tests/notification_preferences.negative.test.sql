-- Story 6.4 negative privilege contract: member_preferences is
-- authenticated/service_role-writable but strictly self-scoped -- anon
-- cannot touch it at all, and gym staff (Manager/Owner/Receptionist) have no
-- staff-facing read/write policy at all, so any staff-role RLS assertion
-- here confirms denial, not access.

begin;
select plan(11);

select ok(
  not has_table_privilege('anon', 'member_preferences', 'SELECT,INSERT,UPDATE,DELETE'),
  'anon has no member_preferences table access at all'
);

select ok(
  has_table_privilege('authenticated', 'member_preferences', 'SELECT')
    and has_table_privilege('authenticated', 'member_preferences', 'INSERT')
    and has_table_privilege('authenticated', 'member_preferences', 'UPDATE'),
  'authenticated has the baseline SELECT/INSERT/UPDATE grant (RLS still scopes it to self)'
);

select ok(
  not has_table_privilege('authenticated', 'member_preferences', 'DELETE'),
  'authenticated has no DELETE grant -- matches the no-self-delete policy design'
);

select ok(
  has_table_privilege('service_role', 'member_preferences', 'SELECT')
    and has_table_privilege('service_role', 'member_preferences', 'INSERT')
    and has_table_privilege('service_role', 'member_preferences', 'UPDATE')
    and has_table_privilege('service_role', 'member_preferences', 'DELETE'),
  'service_role has the full baseline table-level grant'
);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000009101', 'Notification Prefs Negative Test Tier', 5000, 50000, 30);

insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-000000009111', 'Notification Prefs Negative Test Gym', '00000000-0000-0000-0000-000000009101', 30);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000009121'), -- Member (the row under test)
  ('00000000-0000-0000-0000-000000009122'), -- Manager
  ('00000000-0000-0000-0000-000000009123'), -- Owner
  ('00000000-0000-0000-0000-000000009124'); -- Receptionist

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000009131', '00000000-0000-0000-0000-000000009111', '00000000-0000-0000-0000-000000009121', 'member', 'Negative Test Member'),
  ('00000000-0000-0000-0000-000000009132', '00000000-0000-0000-0000-000000009111', '00000000-0000-0000-0000-000000009122', 'manager', 'Negative Test Manager'),
  ('00000000-0000-0000-0000-000000009133', '00000000-0000-0000-0000-000000009111', '00000000-0000-0000-0000-000000009123', 'owner', 'Negative Test Owner'),
  ('00000000-0000-0000-0000-000000009134', '00000000-0000-0000-0000-000000009111', '00000000-0000-0000-0000-000000009124', 'receptionist', 'Negative Test Receptionist');

-- ============================================================================
-- Gym staff (Manager/Owner/Receptionist) have no staff-facing policy on
-- member_preferences -- only the self policies exist, and none of these
-- staff sessions own the member's row, so both SELECT and UPDATE must
-- resolve to zero rows, not an error (RLS filters silently).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009122","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009111","app_role":"manager"}',
  true
);
select is(
  (select count(*)::int from member_preferences where member_id = '00000000-0000-0000-0000-000000009131'),
  0,
  'a Manager cannot SELECT a member''s preferences row -- no staff-facing read policy exists'
);
with updated as (
  update member_preferences set quiet_gym_alerts_opted_out = true
  where member_id = '00000000-0000-0000-0000-000000009131'
  returning member_id
)
select is((select count(*) from updated)::int, 0, 'a Manager cannot UPDATE a member''s preferences row -- no staff-facing write policy exists');
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009123","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009111","app_role":"owner"}',
  true
);
select is(
  (select count(*)::int from member_preferences where member_id = '00000000-0000-0000-0000-000000009131'),
  0,
  'an Owner cannot SELECT a member''s preferences row -- no staff-facing read policy exists'
);
with updated as (
  update member_preferences set quiet_gym_alerts_opted_out = true
  where member_id = '00000000-0000-0000-0000-000000009131'
  returning member_id
)
select is((select count(*) from updated)::int, 0, 'an Owner cannot UPDATE a member''s preferences row -- no staff-facing write policy exists');
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009124","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009111","app_role":"receptionist"}',
  true
);
select is(
  (select count(*)::int from member_preferences where member_id = '00000000-0000-0000-0000-000000009131'),
  0,
  'a Receptionist cannot SELECT a member''s preferences row -- no staff-facing read policy exists'
);
with updated as (
  update member_preferences set quiet_gym_alerts_opted_out = true
  where member_id = '00000000-0000-0000-0000-000000009131'
  returning member_id
)
select is((select count(*) from updated)::int, 0, 'a Receptionist cannot UPDATE a member''s preferences row -- no staff-facing write policy exists');
reset role;

select is(
  (select quiet_gym_alerts_opted_out from member_preferences where member_id = '00000000-0000-0000-0000-000000009131'),
  false,
  'the member''s row is unchanged after all three denied staff-role update attempts (verified as the connecting role, bypassing RLS visibility)'
);

select * from finish();
rollback;
