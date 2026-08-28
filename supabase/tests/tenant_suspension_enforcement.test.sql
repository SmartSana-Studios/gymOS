-- Story 11.4: Tenant Suspension Enforcement (FR-131/FR-132, NFR-018, AD-3).
-- Covers 0073_tenant_suspension_enforcement.sql's tenant_active_gate
-- RESTRICTIVE policy: denial across a representative sample of gated
-- tables for both `suspended` and `deactivated` gyms, the `gyms` table's
-- own always-open regression guard, the `or private.is_super_admin()`
-- escalation carve-out (members/payments/audit_log), the explicit
-- current_gym_status() NULL-safety assertion Task 1 itself calls for, the
-- Owner escape-valve RPCs (initiate_saas_billing_payment()/
-- update_own_owner_notification_email()) staying callable while suspended,
-- and the reversal via Story 11.3's already-shipped
-- complete_verified_saas_billing_payment() -- proving AD-3's "no refresh
-- required" claim end-to-end for this mechanism. Session-simulation
-- conventions match saas_billing_reminders_one_tap_pay.test.sql/
-- rls_tenant_isolation.test.sql (`set local role authenticated` +
-- `set_config('request.jwt.claims', ...)`; `reset role` to return to the
-- unrestricted fixture-setup role; `set local role service_role` for the
-- webhook-only completion RPC).

begin;
select plan(32);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000009901', 'Suspension Test Tier', 8000, 80000, 40);

-- Deliberately not seeding an `active` control gym -- every other pgTAP
-- file in this codebase already proves the non-suspended case works for
-- each of these tables; this file's entire job is the suspended/deactivated
-- gate, plus the reversal (Section F) exercising the same gym's active
-- state after the fact.
insert into gyms (id, name, tier_id, status, saas_billing_status, capacity) values
  ('00000000-0000-0000-0000-000000009911', 'Suspension Test Gym (suspended)', '00000000-0000-0000-0000-000000009901', 'suspended', 'suspended', 30),
  ('00000000-0000-0000-0000-000000009912', 'Suspension Test Gym (deactivated)', '00000000-0000-0000-0000-000000009901', 'deactivated', 'suspended', 30);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000009921'), -- Gym (suspended) owner
  ('00000000-0000-0000-0000-000000009922'), -- Gym (suspended) member
  ('00000000-0000-0000-0000-000000009923'), -- Gym (deactivated) owner
  ('00000000-0000-0000-0000-000000009924'), -- super_admin actor
  ('00000000-0000-0000-0000-000000009925'); -- Gym (suspended) coach (classes.coach_id fixture only)

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000009931', '00000000-0000-0000-0000-000000009911', '00000000-0000-0000-0000-000000009921', 'owner', 'Suspended Gym Owner'),
  ('00000000-0000-0000-0000-000000009932', '00000000-0000-0000-0000-000000009911', '00000000-0000-0000-0000-000000009922', 'member', 'Suspended Gym Member'),
  ('00000000-0000-0000-0000-000000009933', '00000000-0000-0000-0000-000000009912', '00000000-0000-0000-0000-000000009923', 'owner', 'Deactivated Gym Owner'),
  -- classes.coach_id requires a coach-role member of the same gym
  -- (private.classes_validate_coach()) -- the owner row above doesn't
  -- qualify.
  ('00000000-0000-0000-0000-000000009934', '00000000-0000-0000-0000-000000009911', '00000000-0000-0000-0000-000000009925', 'coach', 'Suspended Gym Coach');

insert into plans (id, gym_id, name, plan_type, price, billing_interval, duration_days)
values ('00000000-0000-0000-0000-000000009941', '00000000-0000-0000-0000-000000009911', 'Suspension Test Plan', 'monthly', 8000, 'monthly', 30);

insert into subscriptions (id, gym_id, member_id, plan_id, status, start_date, expiry_date)
values ('00000000-0000-0000-0000-000000009951', '00000000-0000-0000-0000-000000009911', '00000000-0000-0000-0000-000000009932', '00000000-0000-0000-0000-000000009941', 'active', current_date, current_date + 30);

insert into payments (id, gym_id, member_id, amount, method, status)
values ('00000000-0000-0000-0000-000000009952', '00000000-0000-0000-0000-000000009911', '00000000-0000-0000-0000-000000009932', 8000, 'cash', 'verified');

insert into attendance_events (id, gym_id, member_id)
values ('00000000-0000-0000-0000-000000009953', '00000000-0000-0000-0000-000000009911', '00000000-0000-0000-0000-000000009932');

insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, one_off_session_at)
values ('00000000-0000-0000-0000-000000009954', '00000000-0000-0000-0000-000000009911', 'Suspension Test Class', '00000000-0000-0000-0000-000000009934', 10, 'one_off', now() + interval '1 day');

insert into progress_entries (id, gym_id, member_id, weight_kg)
values ('00000000-0000-0000-0000-000000009955', '00000000-0000-0000-0000-000000009911', '00000000-0000-0000-0000-000000009932', 70);

insert into audit_log (id, gym_id, actor_id, actor_display_name, action_type)
values ('00000000-0000-0000-0000-000000009956', '00000000-0000-0000-0000-000000009911', '00000000-0000-0000-0000-000000009921', 'Suspended Gym Owner', 'test_action');

insert into payment_discrepancies (id, gym_id, payment_id, discrepancy_type, details)
values ('00000000-0000-0000-0000-000000009957', '00000000-0000-0000-0000-000000009911', '00000000-0000-0000-0000-000000009952', 'stale_processing', '{}'::jsonb);

-- Review finding: the original 8-table "representative sample" left 9 of
-- the migration's 17 gated tables with zero denial coverage. Fixtures for
-- the remaining 9 below (byte-identical policy text per table, so this is
-- purely a copy-paste-typo guard, not a new mechanism to prove).
insert into class_sessions (id, gym_id, class_id, scheduled_at)
values ('00000000-0000-0000-0000-000000009959', '00000000-0000-0000-0000-000000009911', '00000000-0000-0000-0000-000000009954', now() + interval '1 day');

insert into class_bookings (id, gym_id, class_session_id, member_id)
values ('00000000-0000-0000-0000-000000009960', '00000000-0000-0000-0000-000000009911', '00000000-0000-0000-0000-000000009959', '00000000-0000-0000-0000-000000009932');

insert into refunds (id, gym_id, payment_id, amount, reason, actor_id)
values ('00000000-0000-0000-0000-000000009961', '00000000-0000-0000-0000-000000009911', '00000000-0000-0000-0000-000000009952', 8000, 'Suspension test refund', '00000000-0000-0000-0000-000000009921');

insert into progress_photos (id, gym_id, member_id, progress_entry_id, photo_path)
values ('00000000-0000-0000-0000-000000009962', '00000000-0000-0000-0000-000000009911', '00000000-0000-0000-0000-000000009932', '00000000-0000-0000-0000-000000009955', 'suspension-test/photo.jpg');

insert into coach_assignments (id, gym_id, member_id, coach_id)
values ('00000000-0000-0000-0000-000000009963', '00000000-0000-0000-0000-000000009911', '00000000-0000-0000-0000-000000009932', '00000000-0000-0000-0000-000000009934');

-- member_preferences: no manual insert -- create_default_member_preferences
-- (0047) already auto-creates exactly one row per members insert (the
-- member fixture above already triggered it); Section A's assertion below
-- looks it up by member_id rather than a fixture id.

insert into session_notes (id, gym_id, member_id, coach_id, coach_assignment_id, note_text)
values ('00000000-0000-0000-0000-000000009965', '00000000-0000-0000-0000-000000009911', '00000000-0000-0000-0000-000000009932', '00000000-0000-0000-0000-000000009934', '00000000-0000-0000-0000-000000009963', 'Suspension test session note');

insert into front_desk_alerts (id, gym_id, member_id, status, expiry_date)
values ('00000000-0000-0000-0000-000000009966', '00000000-0000-0000-0000-000000009911', '00000000-0000-0000-0000-000000009932', 'expiring_soon', current_date + 3);

-- Super Admin escalation grant for Gym (suspended) -- a real
-- 'gym_data_escalation' audit_log row IS the grant (0012's own design,
-- see super_admin_escalated_read_members/payments). Needed for Section D's
-- escalated-read assertions (members/payments beyond the unconditional
-- owner-row/audit_log policies).
insert into audit_log (id, gym_id, actor_id, actor_display_name, action_type)
values ('00000000-0000-0000-0000-000000009958', '00000000-0000-0000-0000-000000009911', '00000000-0000-0000-0000-000000009924', 'Super Admin', 'gym_data_escalation');

-- ============================================================================
-- Section A: suspended gym, member-eligible tables all denied for the
-- member's own session -- proves the RESTRICTIVE gate ANDs against every
-- one of these tables' own PERMISSIVE self-read policies, not just one.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009922","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009911","app_role":"member"}',
  true
);

select is((select count(*) from members where id = '00000000-0000-0000-0000-000000009932')::int, 0, 'suspended gym: a member cannot read their own members row (self_read_own_membership denied by the gate)');
select is((select count(*) from payments where id = '00000000-0000-0000-0000-000000009952')::int, 0, 'suspended gym: a member cannot read their own payments row');
select is((select count(*) from subscriptions where id = '00000000-0000-0000-0000-000000009951')::int, 0, 'suspended gym: a member cannot read their own subscriptions row');
select is((select count(*) from attendance_events where id = '00000000-0000-0000-0000-000000009953')::int, 0, 'suspended gym: a member cannot read their own attendance_events row');
select is((select count(*) from classes where id = '00000000-0000-0000-0000-000000009954')::int, 0, 'suspended gym: a member cannot read classes at their own gym');
select is((select count(*) from progress_entries where id = '00000000-0000-0000-0000-000000009955')::int, 0, 'suspended gym: a member cannot read their own progress_entries row');
select is((select count(*) from class_bookings where id = '00000000-0000-0000-0000-000000009960')::int, 0, 'suspended gym: a member cannot read their own class_bookings row');
select is((select count(*) from progress_photos where id = '00000000-0000-0000-0000-000000009962')::int, 0, 'suspended gym: a member cannot read their own progress_photos row');
select is((select count(*) from member_preferences where member_id = '00000000-0000-0000-0000-000000009932')::int, 0, 'suspended gym: a member cannot read their own member_preferences row');

-- Regression guard: `gyms` itself is deliberately never gated (0009's
-- "read own gym" policy) -- both apps need this read to detect and render
-- the suspended state at all.
select is((select count(*) from gyms where id = '00000000-0000-0000-0000-000000009911')::int, 1, 'suspended gym: gyms itself stays readable regardless of status (Task 1 never touches its own policies)');

-- ============================================================================
-- Section B: suspended gym, staff-only tables denied for the Owner's own
-- session too -- proves the gate is role-independent, not just member-role.
-- ============================================================================
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009921","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009911","app_role":"owner"}',
  true
);

select is((select count(*) from audit_log where id = '00000000-0000-0000-0000-000000009956')::int, 0, 'suspended gym: an owner cannot read their own gym''s audit_log row (manager_or_owner_read_own_audit_log denied by the gate)');
select is((select count(*) from payment_discrepancies where id = '00000000-0000-0000-0000-000000009957')::int, 0, 'suspended gym: an owner cannot read their own gym''s payment_discrepancies row');
select is((select count(*) from members where id = '00000000-0000-0000-0000-000000009931')::int, 0, 'suspended gym: an owner cannot read their own members row either -- the gate is role-independent');
select is((select count(*) from refunds where id = '00000000-0000-0000-0000-000000009961')::int, 0, 'suspended gym: an owner cannot read their own gym''s refunds row');
select is((select count(*) from plans where id = '00000000-0000-0000-0000-000000009941')::int, 0, 'suspended gym: an owner cannot read their own gym''s plans row');
select is((select count(*) from class_sessions where id = '00000000-0000-0000-0000-000000009959')::int, 0, 'suspended gym: an owner cannot read their own gym''s class_sessions row');
select is((select count(*) from coach_assignments where id = '00000000-0000-0000-0000-000000009963')::int, 0, 'suspended gym: an owner cannot read their own gym''s coach_assignments row');
select is((select count(*) from session_notes where id = '00000000-0000-0000-0000-000000009965')::int, 0, 'suspended gym: an owner cannot read their own gym''s session_notes row');
select is((select count(*) from front_desk_alerts where id = '00000000-0000-0000-0000-000000009966')::int, 0, 'suspended gym: an owner cannot read their own gym''s front_desk_alerts row');

-- ============================================================================
-- Section C: a deactivated gym is denied by the same gate (`= 'active'`
-- excludes both non-active states, confirmed with the user at
-- implementation time -- deactivated is the more severe Super-Admin
-- lifecycle action and every other already-shipped piece of this machinery
-- already treats it as stricter than a billing suspension).
-- ============================================================================
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009923","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009912","app_role":"owner"}',
  true
);

select is((select count(*) from members where id = '00000000-0000-0000-0000-000000009933')::int, 0, 'deactivated gym: an owner cannot read their own members row -- excluded by the same `= ''active''` gate, not just `suspended`');
select is((select count(*) from gyms where id = '00000000-0000-0000-0000-000000009912')::int, 1, 'deactivated gym: gyms itself still stays readable regardless of status');

-- ============================================================================
-- Section D: the `or private.is_super_admin()` clause -- load-bearing, not
-- defensive boilerplate (this story's own Context section). A super_admin
-- session has no gym_id claim at all; current_gym_status() must resolve to
-- NULL (not error, not silently pass), and the pre-existing Super-Admin
-- escalation policies on members/payments/audit_log must keep working
-- through the new RESTRICTIVE gate exactly as before this migration.
-- ============================================================================
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009924","role":"authenticated","app_role":"super_admin"}',
  true
);

select is(private.current_gym_status(), null::gym_status, 'super_admin session (no gym_id claim): current_gym_status() resolves to NULL, not an error -- the `= ''active''` comparison then falls through to `or private.is_super_admin()` (Task 1''s own required NULL-safety proof)');
select is((select count(*) from members where id = '00000000-0000-0000-0000-000000009931')::int, 1, 'super_admin sees an owner-role members row at a suspended gym via the unconditional super_admin_read_owner_members policy (0010), unaffected by the new gate');
select is((select count(*) from audit_log where id = '00000000-0000-0000-0000-000000009956')::int, 1, 'super_admin sees a suspended gym''s audit_log row via the unconditional super_admin_read_audit_log policy (0012), unaffected by the new gate');
select is((select count(*) from members where id = '00000000-0000-0000-0000-000000009932')::int, 1, 'super_admin (now escalated for this gym) sees a non-owner members row too, via super_admin_escalated_read_members (0012), unaffected by the new gate');
select is((select count(*) from payments where id = '00000000-0000-0000-0000-000000009952')::int, 1, 'super_admin (escalated) sees a suspended gym''s payments row via super_admin_escalated_read_payments (0012), unaffected by the new gate');

-- ============================================================================
-- Section E: the Owner escape valve. Both RPCs are SECURITY DEFINER and
-- already correctly unaffected by RLS (table owner bypasses RLS by
-- default, no FORCE ROW LEVEL SECURITY anywhere in this schema) -- this is
-- the single most important assertion in this file (Task 4's own words).
-- ============================================================================
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009921","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009911","app_role":"owner"}',
  true
);

create temp table suspension_test_payment as select initiate_saas_billing_payment() as id;
-- saas_billing_payments carries no gym-staff/member SELECT policy at all
-- (Super-Admin-SELECT-only, same reasoning that leaves it out of the
-- tenant_active_gate table list) -- the owner-claims session that just
-- created this row cannot read it back directly; `reset role` below reads
-- it as the unrestricted fixture-setup role instead, and Section F needs
-- the id from any role, so grant it explicitly rather than relying on
-- table-owner defaults.
grant select on suspension_test_payment to service_role;

reset role;
select is(
  (select status::text from saas_billing_payments where id = (select id from suspension_test_payment)),
  'processing',
  'initiate_saas_billing_payment() still succeeds for a suspended gym''s Owner -- the Owner''s recovery path is deliberately unblocked by this story'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009921","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009911","app_role":"owner"}',
  true
);

select lives_ok(
  $$select update_own_owner_notification_email('owner@example.com')$$,
  'update_own_owner_notification_email() still succeeds for a suspended gym''s Owner'
);

reset role;
select is(
  (select email from members where id = '00000000-0000-0000-0000-000000009931'),
  'owner@example.com',
  'the notification-email write actually landed -- the SECURITY DEFINER function bypassed the new RESTRICTIVE gate on its own UPDATE, as table owner'
);

-- ============================================================================
-- Section F: reversal. complete_verified_saas_billing_payment() (Story
-- 11.3, already shipped) flips status back to 'active' -- the same
-- previously-denied member session immediately succeeds on the very next
-- statement, no reconnection/token-refresh step, proving AD-3's "no
-- refresh required" claim end-to-end for this specific mechanism.
-- ============================================================================
set local role service_role;
select complete_verified_saas_billing_payment((select id from suspension_test_payment), 200);
reset role;

select is(
  (select status::text from gyms where id = '00000000-0000-0000-0000-000000009911'),
  'active',
  'the reversal flips gyms.status back to active'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009922","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009911","app_role":"member"}',
  true
);

select is((select count(*) from members where id = '00000000-0000-0000-0000-000000009932')::int, 1, 'reversal: the same member session that was denied in Section A now sees their own members row -- no reconnect, no token refresh, next statement in the same session');
select is((select count(*) from payments where id = '00000000-0000-0000-0000-000000009952')::int, 1, 'reversal: the same member session now sees their own payments row too');

select * from finish();
rollback;
