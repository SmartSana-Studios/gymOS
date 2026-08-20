-- Story 9.3: Staff Edit, Deactivation & Immediate Access Revocation
-- (FR-089/FR-090/FR-091). Tests `update_staff_role()`,
-- `deactivate_staff_member()`, `private.current_gym_status()`, the
-- `gym_staff_read_own_members` live-state RLS retrofit (AC #4), and the
-- `log_audit_event()` `is_super_admin_live()` fix (AC #5)
-- (0063_staff_edit_deactivation.sql). Session-simulation shape copied
-- verbatim from staff_creation_role_ceiling_enforcement.test.sql /
-- staff_password_resend.test.sql.

begin;
select plan(55);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000019001', 'Staff Edit Test Tier', 5000, 50000, 20);

insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-000000019011', 'Staff Edit Gym A', '00000000-0000-0000-0000-000000019001', 30),
  ('00000000-0000-0000-0000-000000019012', 'Staff Edit Gym B', '00000000-0000-0000-0000-000000019001', 30);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000019021'), -- Gym A owner
  ('00000000-0000-0000-0000-000000019022'), -- Gym A supervisor (primary)
  ('00000000-0000-0000-0000-000000019023'), -- Gym A manager
  ('00000000-0000-0000-0000-000000019024'), -- Gym A receptionist
  ('00000000-0000-0000-0000-000000019025'), -- Gym A coach
  ('00000000-0000-0000-0000-000000019026'), -- Gym A member
  ('00000000-0000-0000-0000-000000019027'), -- Gym A second supervisor (ceiling target)
  ('00000000-0000-0000-0000-000000019028'), -- Gym A already-deactivated receptionist
  ('00000000-0000-0000-0000-000000019029'), -- Gym B owner
  ('00000000-0000-0000-0000-000000019030'), -- Gym B manager (cross-gym target)
  ('00000000-0000-0000-0000-000000019101'),
  ('00000000-0000-0000-0000-000000019102'),
  ('00000000-0000-0000-0000-000000019103'),
  ('00000000-0000-0000-0000-000000019104'),
  ('00000000-0000-0000-0000-000000019105'),
  ('00000000-0000-0000-0000-000000019106'),
  ('00000000-0000-0000-0000-000000019107'),
  ('00000000-0000-0000-0000-000000019108'),
  ('00000000-0000-0000-0000-000000019109'),
  ('00000000-0000-0000-0000-000000019110'),
  ('00000000-0000-0000-0000-000000019111'),
  ('00000000-0000-0000-0000-000000019112'),
  ('00000000-0000-0000-0000-000000019113'),
  ('00000000-0000-0000-0000-000000019114'),
  ('00000000-0000-0000-0000-000000019201'),
  ('00000000-0000-0000-0000-000000019202'),
  ('00000000-0000-0000-0000-000000019203'),
  ('00000000-0000-0000-0000-000000019204'),
  ('00000000-0000-0000-0000-000000019205'),
  ('00000000-0000-0000-0000-000000019206'),
  ('00000000-0000-0000-0000-000000019207'),
  ('00000000-0000-0000-0000-000000019208'),
  ('00000000-0000-0000-0000-000000019210'),
  ('00000000-0000-0000-0000-000000019211'),
  ('00000000-0000-0000-0000-000000019212'),
  ('00000000-0000-0000-0000-000000019213'),
  ('00000000-0000-0000-0000-000000019214'),
  ('00000000-0000-0000-0000-000000019215'), -- Gym A second Owner (code review: Owner-rejected-Owner ceiling target)
  ('00000000-0000-0000-0000-000000019220'), -- Manager for current_gym_status()-suspended wiring test
  ('00000000-0000-0000-0000-000000019221'), -- Manager for AC #4's dedicated stale-JWT regression
  ('00000000-0000-0000-0000-000000019230'); -- Super Admin actor for log_audit_event() fix coverage

insert into members (id, gym_id, user_id, role, name, phone, deactivated_at) values
  ('00000000-0000-0000-0000-000000019071', '00000000-0000-0000-0000-000000019011', '00000000-0000-0000-0000-000000019021', 'owner', 'Edit Gym A Owner', '+237600100021', null),
  ('00000000-0000-0000-0000-000000019072', '00000000-0000-0000-0000-000000019011', '00000000-0000-0000-0000-000000019022', 'supervisor', 'Edit Gym A Supervisor', '+237600100022', null),
  ('00000000-0000-0000-0000-000000019073', '00000000-0000-0000-0000-000000019011', '00000000-0000-0000-0000-000000019023', 'manager', 'Edit Gym A Manager', '+237600100023', null),
  ('00000000-0000-0000-0000-000000019074', '00000000-0000-0000-0000-000000019011', '00000000-0000-0000-0000-000000019024', 'receptionist', 'Edit Gym A Receptionist', '+237600100024', null),
  ('00000000-0000-0000-0000-000000019075', '00000000-0000-0000-0000-000000019011', '00000000-0000-0000-0000-000000019025', 'coach', 'Edit Gym A Coach', '+237600100025', null),
  ('00000000-0000-0000-0000-000000019076', '00000000-0000-0000-0000-000000019011', '00000000-0000-0000-0000-000000019026', 'member', 'Edit Gym A Member', '+237600100026', null),
  ('00000000-0000-0000-0000-000000019077', '00000000-0000-0000-0000-000000019011', '00000000-0000-0000-0000-000000019027', 'supervisor', 'Edit Gym A Second Supervisor', '+237600100027', null),
  ('00000000-0000-0000-0000-000000019078', '00000000-0000-0000-0000-000000019011', '00000000-0000-0000-0000-000000019028', 'receptionist', 'Edit Gym A Deactivated Receptionist', '+237600100028', now()),
  ('00000000-0000-0000-0000-000000019079', '00000000-0000-0000-0000-000000019012', '00000000-0000-0000-0000-000000019029', 'owner', 'Edit Gym B Owner', '+237600100029', null),
  ('00000000-0000-0000-0000-000000019080', '00000000-0000-0000-0000-000000019012', '00000000-0000-0000-0000-000000019030', 'manager', 'Edit Gym B Manager', '+237600100030', null),
  -- update_staff_role() targets
  ('00000000-0000-0000-0000-000000019181', '00000000-0000-0000-0000-000000019011', '00000000-0000-0000-0000-000000019101', 'manager', 'UT1 Owner To Supervisor', '+237600100101', null),
  ('00000000-0000-0000-0000-000000019182', '00000000-0000-0000-0000-000000019011', '00000000-0000-0000-0000-000000019102', 'receptionist', 'UT2 Owner To Manager', '+237600100102', null),
  ('00000000-0000-0000-0000-000000019183', '00000000-0000-0000-0000-000000019011', '00000000-0000-0000-0000-000000019103', 'coach', 'UT3 Owner To Receptionist', '+237600100103', null),
  ('00000000-0000-0000-0000-000000019184', '00000000-0000-0000-0000-000000019011', '00000000-0000-0000-0000-000000019104', 'manager', 'UT4 Owner To Coach', '+237600100104', null),
  ('00000000-0000-0000-0000-000000019185', '00000000-0000-0000-0000-000000019011', '00000000-0000-0000-0000-000000019105', 'coach', 'UT5 Owner Rejected Owner', '+237600100105', null),
  ('00000000-0000-0000-0000-000000019186', '00000000-0000-0000-0000-000000019011', '00000000-0000-0000-0000-000000019106', 'receptionist', 'UT6 Supervisor To Manager', '+237600100106', null),
  ('00000000-0000-0000-0000-000000019187', '00000000-0000-0000-0000-000000019011', '00000000-0000-0000-0000-000000019107', 'coach', 'UT7 Supervisor To Receptionist', '+237600100107', null),
  ('00000000-0000-0000-0000-000000019188', '00000000-0000-0000-0000-000000019011', '00000000-0000-0000-0000-000000019108', 'manager', 'UT8 Supervisor To Coach', '+237600100108', null),
  ('00000000-0000-0000-0000-000000019189', '00000000-0000-0000-0000-000000019011', '00000000-0000-0000-0000-000000019109', 'coach', 'UT9 Supervisor Rejected Supervisor', '+237600100109', null),
  ('00000000-0000-0000-0000-000000019190', '00000000-0000-0000-0000-000000019011', '00000000-0000-0000-0000-000000019110', 'coach', 'UT10 Supervisor Rejected Owner', '+237600100110', null),
  ('00000000-0000-0000-0000-000000019191', '00000000-0000-0000-0000-000000019011', '00000000-0000-0000-0000-000000019111', 'coach', 'UT11 Manager Caller Rejected', '+237600100111', null),
  ('00000000-0000-0000-0000-000000019192', '00000000-0000-0000-0000-000000019011', '00000000-0000-0000-0000-000000019112', 'coach', 'UT12 Receptionist Caller Rejected', '+237600100112', null),
  ('00000000-0000-0000-0000-000000019193', '00000000-0000-0000-0000-000000019011', '00000000-0000-0000-0000-000000019113', 'coach', 'UT13 Coach Caller Rejected', '+237600100113', null),
  ('00000000-0000-0000-0000-000000019194', '00000000-0000-0000-0000-000000019011', '00000000-0000-0000-0000-000000019114', 'coach', 'UT14 Member Caller Rejected', '+237600100114', null),
  -- deactivate_staff_member() targets
  ('00000000-0000-0000-0000-000000019281', '00000000-0000-0000-0000-000000019011', '00000000-0000-0000-0000-000000019201', 'manager', 'DT1 Owner Deactivates Manager', '+237600100201', null),
  ('00000000-0000-0000-0000-000000019282', '00000000-0000-0000-0000-000000019011', '00000000-0000-0000-0000-000000019202', 'receptionist', 'DT2 Owner Deactivates Receptionist', '+237600100202', null),
  ('00000000-0000-0000-0000-000000019283', '00000000-0000-0000-0000-000000019011', '00000000-0000-0000-0000-000000019203', 'coach', 'DT3 Owner Deactivates Coach', '+237600100203', null),
  ('00000000-0000-0000-0000-000000019284', '00000000-0000-0000-0000-000000019011', '00000000-0000-0000-0000-000000019204', 'supervisor', 'DT4 Owner Deactivates Supervisor', '+237600100204', null),
  ('00000000-0000-0000-0000-000000019285', '00000000-0000-0000-0000-000000019011', '00000000-0000-0000-0000-000000019205', 'manager', 'DT5 Supervisor Deactivates Manager', '+237600100205', null),
  ('00000000-0000-0000-0000-000000019286', '00000000-0000-0000-0000-000000019011', '00000000-0000-0000-0000-000000019206', 'receptionist', 'DT6 Supervisor Deactivates Receptionist', '+237600100206', null),
  ('00000000-0000-0000-0000-000000019287', '00000000-0000-0000-0000-000000019011', '00000000-0000-0000-0000-000000019207', 'coach', 'DT7 Supervisor Deactivates Coach', '+237600100207', null),
  ('00000000-0000-0000-0000-000000019288', '00000000-0000-0000-0000-000000019011', '00000000-0000-0000-0000-000000019208', 'owner', 'DT8 Supervisor Rejected Owner', '+237600100208', null),
  ('00000000-0000-0000-0000-000000019295', '00000000-0000-0000-0000-000000019011', '00000000-0000-0000-0000-000000019215', 'owner', 'DT15 Owner Rejected Owner', '+237600100215', null),
  ('00000000-0000-0000-0000-000000019290', '00000000-0000-0000-0000-000000019011', '00000000-0000-0000-0000-000000019210', 'coach', 'DT10 Manager Caller Rejected', '+237600100210', null),
  ('00000000-0000-0000-0000-000000019291', '00000000-0000-0000-0000-000000019011', '00000000-0000-0000-0000-000000019211', 'coach', 'DT11 Receptionist Caller Rejected', '+237600100211', null),
  ('00000000-0000-0000-0000-000000019292', '00000000-0000-0000-0000-000000019011', '00000000-0000-0000-0000-000000019212', 'coach', 'DT12 Coach Caller Rejected', '+237600100212', null),
  ('00000000-0000-0000-0000-000000019293', '00000000-0000-0000-0000-000000019011', '00000000-0000-0000-0000-000000019213', 'coach', 'DT13 Member Caller Rejected', '+237600100213', null),
  ('00000000-0000-0000-0000-000000019294', '00000000-0000-0000-0000-000000019011', '00000000-0000-0000-0000-000000019214', 'coach', 'DT14 Empty Reason Rejected', '+237600100214', null),
  ('00000000-0000-0000-0000-000000019320', '00000000-0000-0000-0000-000000019011', '00000000-0000-0000-0000-000000019220', 'manager', 'GS1 Manager For Suspended Gym Test', '+237600100220', null),
  ('00000000-0000-0000-0000-000000019321', '00000000-0000-0000-0000-000000019011', '00000000-0000-0000-0000-000000019221', 'manager', 'AC4 Manager For Stale JWT Regression', '+237600100221', null);

-- ============================================================================
-- (a) update_staff_role(): Owner can assign Supervisor/Manager/Receptionist/
-- Coach (AC #1) -- 4 role changes, one with a full audit-metadata check.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000019021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000019011","app_role":"owner"}',
  true
);

select lives_ok(
  $$select update_staff_role('00000000-0000-0000-0000-000000019181', 'UT1 Renamed', 'supervisor')$$,
  'an owner-claim session can change a Manager''s role to Supervisor'
);

select lives_ok(
  $$select update_staff_role('00000000-0000-0000-0000-000000019182', 'UT2 Renamed', 'manager')$$,
  'an owner-claim session can change a Receptionist''s role to Manager'
);

select lives_ok(
  $$select update_staff_role('00000000-0000-0000-0000-000000019183', 'UT3 Renamed', 'receptionist')$$,
  'an owner-claim session can change a Coach''s role to Receptionist'
);

select lives_ok(
  $$select update_staff_role('00000000-0000-0000-0000-000000019184', 'UT4 Renamed', 'coach')$$,
  'an owner-claim session can change a Manager''s role to Coach'
);

select throws_like(
  $$select update_staff_role('00000000-0000-0000-0000-000000019185', 'UT5 Renamed', 'owner')$$,
  '%update_staff_role: caller is not authorized to assign role owner%',
  'an owner-claim session cannot assign the Owner role via update_staff_role -- no role may ever create/assign Owner through this path'
);

reset role;

select is(
  (select role::text from members where id = '00000000-0000-0000-0000-000000019181'),
  'supervisor',
  'UT1''s role was actually updated in the database'
);

select is(
  (select name from members where id = '00000000-0000-0000-0000-000000019181'),
  'UT1 Renamed',
  'UT1''s name was updated alongside its role'
);

select is(
  (select count(*)::int from audit_log
   where action_type = 'staff_role_updated'
     and target_entity_id = '00000000-0000-0000-0000-000000019181'
     and metadata->>'previous_role' = 'manager'
     and metadata->>'new_role' = 'supervisor'
     and metadata->>'previous_name' = 'UT1 Owner To Supervisor'
     and metadata->>'new_name' = 'UT1 Renamed'),
  1,
  'an audit_log row was written with action_type=staff_role_updated and both previous/new role+name in metadata'
);

-- ============================================================================
-- (b) Supervisor can assign Manager/Receptionist/Coach but NOT Supervisor or
-- Owner (AC #1's Supervisor ceiling).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000019022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000019011","app_role":"supervisor"}',
  true
);

select lives_ok(
  $$select update_staff_role('00000000-0000-0000-0000-000000019186', 'UT6 Renamed', 'manager')$$,
  'a supervisor-claim session can change a Receptionist''s role to Manager'
);

select lives_ok(
  $$select update_staff_role('00000000-0000-0000-0000-000000019187', 'UT7 Renamed', 'receptionist')$$,
  'a supervisor-claim session can change a Coach''s role to Receptionist'
);

select lives_ok(
  $$select update_staff_role('00000000-0000-0000-0000-000000019188', 'UT8 Renamed', 'coach')$$,
  'a supervisor-claim session can change a Manager''s role to Coach'
);

select throws_like(
  $$select update_staff_role('00000000-0000-0000-0000-000000019189', 'UT9 Renamed', 'supervisor')$$,
  '%update_staff_role: caller is not authorized to assign role supervisor%',
  'a supervisor-claim session cannot assign the Supervisor role'
);

select throws_like(
  $$select update_staff_role('00000000-0000-0000-0000-000000019190', 'UT10 Renamed', 'owner')$$,
  '%update_staff_role: caller is not authorized to assign role owner%',
  'a supervisor-claim session cannot assign the Owner role'
);

-- ============================================================================
-- (c) Manager, Receptionist, Coach, and a plain Member caller are all
-- rejected outright (else branch).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000019023","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000019011","app_role":"manager"}',
  true
);

select throws_like(
  $$select update_staff_role('00000000-0000-0000-0000-000000019191', 'UT11 Renamed', 'coach')$$,
  '%update_staff_role: caller is not authorized to edit staff%',
  'a manager-claim session cannot edit any staff role'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000019024","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000019011","app_role":"receptionist"}',
  true
);

select throws_like(
  $$select update_staff_role('00000000-0000-0000-0000-000000019192', 'UT12 Renamed', 'coach')$$,
  '%update_staff_role: caller is not authorized to edit staff%',
  'a receptionist-claim session cannot edit any staff role'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000019025","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000019011","app_role":"coach"}',
  true
);

select throws_like(
  $$select update_staff_role('00000000-0000-0000-0000-000000019193', 'UT13 Renamed', 'receptionist')$$,
  '%update_staff_role: caller is not authorized to edit staff%',
  'a coach-claim session cannot edit any staff role'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000019026","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000019011","app_role":"member"}',
  true
);

select throws_like(
  $$select update_staff_role('00000000-0000-0000-0000-000000019194', 'UT14 Renamed', 'receptionist')$$,
  '%update_staff_role: caller is not authorized to edit staff%',
  'a plain member-claim session cannot edit any staff role'
);

-- ============================================================================
-- (d) AC #2: an Owner attempting update_staff_role() against their own
-- member_id with a *different* p_role is rejected outright; the same Owner
-- submitting their own member_id with p_role equal to their own current
-- role (a name-only edit) succeeds.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000019021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000019011","app_role":"owner"}',
  true
);

select throws_like(
  $$select update_staff_role('00000000-0000-0000-0000-000000019071', 'Self Escalation Attempt', 'supervisor')$$,
  '%update_staff_role: cannot edit your own role%',
  'an owner-claim session attempting to change their own role is rejected outright, regardless of target role'
);

select lives_ok(
  $$select update_staff_role('00000000-0000-0000-0000-000000019071', 'Edit Gym A Owner Renamed', 'owner')$$,
  'an owner-claim session can submit a name-only self-edit (p_role echoing their own current role back unchanged)'
);

reset role;

select is(
  (select name from members where id = '00000000-0000-0000-0000-000000019071'),
  'Edit Gym A Owner Renamed',
  'the Owner''s own name-only self-edit actually updated the row'
);

select is(
  (select role::text from members where id = '00000000-0000-0000-0000-000000019071'),
  'owner',
  'the Owner''s own role is unchanged after the name-only self-edit'
);

-- Same regression for a Supervisor's own row (their current role,
-- 'supervisor', is likewise never in their own assignable-roles list).
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000019022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000019011","app_role":"supervisor"}',
  true
);

select lives_ok(
  $$select update_staff_role('00000000-0000-0000-0000-000000019072', 'Edit Gym A Supervisor Renamed', 'supervisor')$$,
  'a supervisor-claim session can submit a name-only self-edit despite ''supervisor'' never being in their own assignable-roles ceiling'
);

-- ============================================================================
-- (e) A cross-gym target and an already-deactivated target are both
-- rejected (not found).
-- ============================================================================
select throws_like(
  $$select update_staff_role('00000000-0000-0000-0000-000000019080', 'Cross Gym Attempt', 'manager')$$,
  '%update_staff_role: target not found or not eligible%',
  'a supervisor-claim session cannot edit a staff member in a different gym'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000019021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000019011","app_role":"owner"}',
  true
);

select throws_like(
  $$select update_staff_role('00000000-0000-0000-0000-000000019078', 'Deactivated Attempt', 'manager')$$,
  '%update_staff_role: target not found or not eligible%',
  'an owner-claim session cannot edit an already-deactivated staff member'
);

reset role;

-- ============================================================================
-- (f) deactivate_staff_member(): Owner deactivates Manager/Receptionist/
-- Coach/Supervisor -- 4 assertions, one with a full audit-metadata check.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000019021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000019011","app_role":"owner"}',
  true
);

select lives_ok(
  $$select deactivate_staff_member('00000000-0000-0000-0000-000000019281', 'No longer with the gym')$$,
  'an owner-claim session can deactivate a Manager'
);

select lives_ok(
  $$select deactivate_staff_member('00000000-0000-0000-0000-000000019282', 'No longer with the gym')$$,
  'an owner-claim session can deactivate a Receptionist'
);

select lives_ok(
  $$select deactivate_staff_member('00000000-0000-0000-0000-000000019283', 'No longer with the gym')$$,
  'an owner-claim session can deactivate a Coach'
);

select lives_ok(
  $$select deactivate_staff_member('00000000-0000-0000-0000-000000019284', 'Stepping down')$$,
  'an owner-claim session can deactivate a Supervisor'
);

-- Code review fix: the ceiling contract ("Owner may deactivate any
-- non-owner staff role... never Owner") previously had no explicit guard
-- for an Owner caller targeting another Owner -- only the Supervisor
-- branch restricted its targets. Unreachable via any RPC today (no path
-- can ever assign 'owner' to a second member), but the raw-insert fixture
-- above (DT15) proves the raise fires anyway for a bypassed/malformed
-- call, mirroring update_staff_role()'s own "type-level impossible"
-- coverage style (UT5/UT10 above).
select throws_like(
  $$select deactivate_staff_member('00000000-0000-0000-0000-000000019295', 'Attempted ceiling violation')$$,
  '%deactivate_staff_member: caller is not authorized to deactivate role owner%',
  'an owner-claim session cannot deactivate another Owner (target-role ceiling)'
);

reset role;

select ok(
  (select deactivated_at from members where id = '00000000-0000-0000-0000-000000019281') is not null,
  'DT1''s deactivated_at was actually set'
);

select is(
  (select count(*)::int from audit_log
   where action_type = 'staff_deactivated'
     and target_entity_id = '00000000-0000-0000-0000-000000019281'
     and metadata->>'target_name' = 'DT1 Owner Deactivates Manager'
     and metadata->>'target_role' = 'manager'
     and metadata->>'reason' = 'No longer with the gym'),
  1,
  'an audit_log row was written with action_type=staff_deactivated, actor, reason, and timestamp (created_at column)'
);

-- ============================================================================
-- (g) Supervisor can deactivate Manager/Receptionist/Coach, but is rejected
-- by the target-role ceiling for Owner/Supervisor targets (direct
-- extrapolation from staff_account_for_reset()'s own precedent, 0062).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000019022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000019011","app_role":"supervisor"}',
  true
);

select lives_ok(
  $$select deactivate_staff_member('00000000-0000-0000-0000-000000019285', 'No longer with the gym')$$,
  'a supervisor-claim session can deactivate a Manager'
);

select lives_ok(
  $$select deactivate_staff_member('00000000-0000-0000-0000-000000019286', 'No longer with the gym')$$,
  'a supervisor-claim session can deactivate a Receptionist'
);

select lives_ok(
  $$select deactivate_staff_member('00000000-0000-0000-0000-000000019287', 'No longer with the gym')$$,
  'a supervisor-claim session can deactivate a Coach'
);

select throws_like(
  $$select deactivate_staff_member('00000000-0000-0000-0000-000000019288', 'Attempted ceiling violation')$$,
  '%deactivate_staff_member: caller is not authorized to deactivate role owner%',
  'a supervisor-claim session cannot deactivate an Owner (target-role ceiling)'
);

select throws_like(
  $$select deactivate_staff_member('00000000-0000-0000-0000-000000019077', 'Attempted ceiling violation')$$,
  '%deactivate_staff_member: caller is not authorized to deactivate role supervisor%',
  'a supervisor-claim session cannot deactivate another Supervisor (target-role ceiling)'
);

-- ============================================================================
-- (h) Manager, Receptionist, Coach, and a plain Member caller are all
-- rejected outright.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000019023","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000019011","app_role":"manager"}',
  true
);

select throws_like(
  $$select deactivate_staff_member('00000000-0000-0000-0000-000000019290', 'Rejected')$$,
  '%deactivate_staff_member: caller is not authorized to deactivate staff%',
  'a manager-claim session cannot deactivate any staff member'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000019024","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000019011","app_role":"receptionist"}',
  true
);

select throws_like(
  $$select deactivate_staff_member('00000000-0000-0000-0000-000000019291', 'Rejected')$$,
  '%deactivate_staff_member: caller is not authorized to deactivate staff%',
  'a receptionist-claim session cannot deactivate any staff member'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000019025","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000019011","app_role":"coach"}',
  true
);

select throws_like(
  $$select deactivate_staff_member('00000000-0000-0000-0000-000000019292', 'Rejected')$$,
  '%deactivate_staff_member: caller is not authorized to deactivate staff%',
  'a coach-claim session cannot deactivate any staff member'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000019026","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000019011","app_role":"member"}',
  true
);

select throws_like(
  $$select deactivate_staff_member('00000000-0000-0000-0000-000000019293', 'Rejected')$$,
  '%deactivate_staff_member: caller is not authorized to deactivate staff%',
  'a plain member-claim session cannot deactivate any staff member'
);

-- ============================================================================
-- (i) An empty/whitespace-only reason is rejected; a cross-gym or
-- already-deactivated target is rejected even for an eligible Owner caller.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000019021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000019011","app_role":"owner"}',
  true
);

select throws_like(
  $$select deactivate_staff_member('00000000-0000-0000-0000-000000019294', '   ')$$,
  '%deactivate_staff_member: reason is required%',
  'a whitespace-only reason is rejected'
);

select throws_like(
  $$select deactivate_staff_member('00000000-0000-0000-0000-000000019294', '')$$,
  '%deactivate_staff_member: reason is required%',
  'an empty-string reason is rejected'
);

select throws_like(
  $$select deactivate_staff_member('00000000-0000-0000-0000-000000019080', 'Cross gym attempt')$$,
  '%deactivate_staff_member: target not found or not eligible%',
  'an owner-claim session cannot deactivate a staff member in a different gym'
);

select throws_like(
  $$select deactivate_staff_member('00000000-0000-0000-0000-000000019078', 'Already deactivated attempt')$$,
  '%deactivate_staff_member: target not found or not eligible%',
  'an owner-claim session cannot deactivate an already-deactivated staff member'
);

-- ============================================================================
-- (j) Self-deactivation is blocked outright, for both an Owner and a
-- Supervisor caller, regardless of role-ceiling eligibility.
-- ============================================================================
select throws_like(
  $$select deactivate_staff_member('00000000-0000-0000-0000-000000019071', 'Stepping down')$$,
  '%deactivate_staff_member: cannot deactivate your own account%',
  'an owner-claim session cannot deactivate their own account'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000019022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000019011","app_role":"supervisor"}',
  true
);

select throws_like(
  $$select deactivate_staff_member('00000000-0000-0000-0000-000000019072', 'Stepping down')$$,
  '%deactivate_staff_member: cannot deactivate your own account%',
  'a supervisor-claim session cannot deactivate their own account'
);

reset role;

-- ============================================================================
-- (k) private.current_gym_status(): correct value for a gym-scoped caller,
-- NULL for a caller with no gym_id claim (mirrors current_member_role()'s
-- own NULL-on-absence test).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000019021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000019011","app_role":"owner"}',
  true
);

select is(
  private.current_gym_status()::text,
  'active',
  'private.current_gym_status() correctly resolves ''active'' for a gym-scoped caller'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000019021","role":"authenticated"}', true);

select is(
  private.current_gym_status(),
  null,
  'private.current_gym_status() returns NULL for a caller with no gym_id claim'
);

reset role;

-- ============================================================================
-- (l) Task 5's own wiring proof: a Manager whose gym has since been flipped
-- to 'suspended' is denied by gym_staff_read_own_members's retrofitted
-- policy on their very next select, using their original still-active-gym-
-- issued simulated JWT claims (no new claims/session).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000019220","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000019011","app_role":"manager"}',
  true
);

select ok(
  (select count(*) from members) > 0,
  'a Manager caller can read the gym roster while their gym is active'
);

reset role;

-- protect_super_admin_only_gym_columns (0014) silently pins `status` back
-- to its prior value for any non-super_admin-claim session, regardless of
-- Postgres role -- `reset role` alone (switching back to the superuser
-- Postgres role) does not bypass it, since the trigger reads the
-- request.jwt.claims GUC, not the Postgres role. Mirrors
-- tiers_and_gym_lifecycle_rls.test.sql's own super_admin-claim convention
-- for changing gym status.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000019021","role":"authenticated","app_role":"super_admin"}', true);
update gyms set status = 'suspended' where id = '00000000-0000-0000-0000-000000019011';
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000019220","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000019011","app_role":"manager"}',
  true
);

-- self_read_own_membership (0013, `user_id = auth.uid()`) is a separate,
-- unconditional permissive policy that always lets a session see its own
-- single row regardless of gym status/role -- so the roster read never
-- drops to literally 0 rows for a caller with a real membership row. The
-- actual proof of Task 5's wiring is that every *other* row (the roster
-- read gym_staff_read_own_members alone would have granted) disappears.
select is(
  (select count(*)::int from members where user_id != '00000000-0000-0000-0000-000000019220'),
  0,
  'the same Manager caller, reusing the same simulated JWT, can no longer see any OTHER staff member''s row once their gym flips to suspended (their own row stays visible via self_read_own_membership alone) -- proves current_gym_status() is wired into the policy, not just unit-tested in isolation'
);

reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000019021","role":"authenticated","app_role":"super_admin"}', true);
update gyms set status = 'active' where id = '00000000-0000-0000-0000-000000019011';
reset role;

-- ============================================================================
-- (m) AC #4's own dedicated regression -- the literal "next request, not
-- next refresh" scenario. A Manager's session can read the roster; in the
-- same transaction (no new JWT/claims issued), an Owner demotes that
-- Manager to Coach (excluded from gym_staff_read_own_members's own
-- allowlist); re-running the exact same query under the Manager's original,
-- now-stale simulated JWT claims (still claiming app_role=manager) is now
-- denied -- proving the policy re-evaluated private.current_member_role()
-- live rather than trusting the stale app_role claim still present in the
-- simulated JWT.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000019221","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000019011","app_role":"manager"}',
  true
);

select ok(
  (select count(*) from members) > 0,
  'AC #4 regression setup: the Manager''s own stale-claims session can read the roster before the demotion'
);

reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000019021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000019011","app_role":"owner"}',
  true
);

select lives_ok(
  $$select update_staff_role('00000000-0000-0000-0000-000000019321', 'AC4 Demoted To Coach', 'coach')$$,
  'AC #4 regression: an Owner, in the same transaction, demotes the Manager to Coach (no token refresh occurs)'
);

reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000019221","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000019011","app_role":"manager"}',
  true
);

-- Same self_read_own_membership caveat as (l) above -- assert no OTHER
-- staff row is visible, not a bare zero.
select is(
  (select count(*)::int from members where user_id != '00000000-0000-0000-0000-000000019221'),
  0,
  'AC #4''s own regression: the demoted staff member''s next request can no longer see any OTHER staff row, reusing their original stale app_role=manager JWT claims -- no token refresh window, proving the live check, not the stale claim, is what the policy actually evaluates'
);

reset role;

-- ============================================================================
-- (n) log_audit_event() fix: is_super_admin_live() reads the live
-- users.is_super_admin column, not the JWT claim.
-- ============================================================================
-- service_role write, no request.jwt.claims -- mirrors
-- users_self_service_rls.test.sql's own Story 1.12 regression-guard
-- convention (provision-super-admin.mjs's real promote path), and avoids
-- protect_self_managed_user_columns (0015) silently pinning is_super_admin
-- back for what it would otherwise see as a same-`sub` self-update.
select set_config('request.jwt.claims', '{}', true);
set local role service_role;
update users set is_super_admin = true where id = '00000000-0000-0000-0000-000000019230';
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000019230","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000019011","app_role":"super_admin"}',
  true
);

select lives_ok(
  $$select log_audit_event('test_super_admin_writes_other_gym', '00000000-0000-0000-0000-000000019012'::uuid)$$,
  'a real Super Admin actor (live users.is_super_admin=true) can write an audit event for a gym other than the one in their own gym_id claim -- the cross-tenant check is correctly exempted'
);

reset role;

-- Simulate a demotion mid-session: users.is_super_admin flips false, but a
-- stale JWT claim from an earlier login still says app_role=super_admin --
-- this is the actual regression AC #5 is about; the old JWT-claim-only
-- check would have incorrectly bypassed the cross-tenant guard here.
select set_config('request.jwt.claims', '{}', true);
set local role service_role;
update users set is_super_admin = false where id = '00000000-0000-0000-0000-000000019230';
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000019230","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000019011","app_role":"super_admin"}',
  true
);

select throws_like(
  $$select log_audit_event('test_demoted_super_admin_writes_other_gym', '00000000-0000-0000-0000-000000019012'::uuid)$$,
  '%log_audit_event: p_gym_id does not match the caller''s own gym%',
  'a demoted-from-super-admin actor (live users.is_super_admin=false, stale JWT still claims super_admin) is now correctly rejected by the cross-tenant check -- proves the fix reads the live column, not the stale claim'
);

reset role;

select * from finish();
rollback;
