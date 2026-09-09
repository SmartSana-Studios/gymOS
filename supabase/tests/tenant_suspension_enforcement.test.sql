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
--
-- Story 11.8 additions (Sections G, G2, H, I): the SECURITY DEFINER half of
-- the same gate. tenant_active_gate stops direct table access but not
-- SECURITY DEFINER functions, which execute as the table owner and so bypass
-- RLS entirely (no table in this schema sets FORCE ROW LEVEL SECURITY).
-- 0090_suspension_enforcement_in_rpcs.sql adds an explicit
-- private.current_gym_status() guard to the 18 write-RPCs that scope
-- themselves to the caller's own gym. Section G proves all 18 are refused
-- while suspended, G2 proves the guard fails CLOSED on a NULL status (the
-- `is distinct from` vs `<>` trap), H proves the exclusion list still works
-- -- the half that stops a suspended gym becoming permanently unrecoverable
-- -- and I proves the RPC-level reversal mirrors Section F's table-level one.

begin;
select plan(88);

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

-- Story 11.8 Section H: a payment left mid-flight when the gym was
-- suspended. complete_verified_payment() is service_role-granted and
-- resolves its gym from this row rather than from a caller claim, which is
-- why it stays off the gated list -- a webhook landing after suspension must
-- still reconcile instead of failing.
insert into payments (id, gym_id, member_id, amount, method, status)
values ('00000000-0000-0000-0000-000000009968', '00000000-0000-0000-0000-000000009911', '00000000-0000-0000-0000-000000009932', 8000, 'mobile_money', 'processing'),
       ('00000000-0000-0000-0000-000000009969', '00000000-0000-0000-0000-000000009911', '00000000-0000-0000-0000-000000009932', 8000, 'mobile_money', 'processing');

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

-- Super Admin escalation grant for Gym (suspended). Needed for Section D's
-- escalated-read assertions (members/payments beyond the unconditional
-- owner-row/audit_log policies).
--
-- Story 1.15 update: this used to be an audit_log row, because under 0012
-- the 'gym_data_escalation' audit row itself WAS the grant. 0085 moved the
-- grant to gym_data_escalations so it could carry a 24-hour TTL and be
-- revoked, and the members/payments policies now read that table instead --
-- so a bare audit row grants nothing and Section D's two escalated-read
-- assertions failed against it. Seeded live (unexpired, unrevoked) here:
-- this file is about the tenant-suspension gate, and a grant that had
-- lapsed for an unrelated reason would silently stop testing what these
-- two assertions are actually for.
insert into gym_data_escalations (id, gym_id, actor_id, reason, expires_at)
values ('00000000-0000-0000-0000-000000009967', '00000000-0000-0000-0000-000000009911', '00000000-0000-0000-0000-000000009924', 'suspension test escalation', now() + interval '24 hours');

-- The matching accountability record, as escalate_gym_data_access() would
-- have written it in the same transaction. Kept because Section D also
-- asserts on audit_log readability for this gym.
insert into audit_log (id, gym_id, actor_id, actor_display_name, action_type, target_entity_id, target_entity_type)
values ('00000000-0000-0000-0000-000000009958', '00000000-0000-0000-0000-000000009911', '00000000-0000-0000-0000-000000009924', 'Super Admin', 'gym_data_escalation', '00000000-0000-0000-0000-000000009967', 'gym_data_escalations');

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
-- Section G (Story 11.8): the SECURITY DEFINER half of the same gate.
--
-- Sections A-C above prove tenant_active_gate stops DIRECT table access. It
-- cannot stop a SECURITY DEFINER function: those execute as the table owner,
-- and RLS does not apply to the owner without FORCE ROW LEVEL SECURITY, which
-- no table in this schema sets. Until 0090 every write-RPC below went straight
-- through on a fully suspended gym -- the "denied by the UI only" state
-- NFR-018 explicitly rejects. Each assertion here fails against 0089.
--
-- Code review 2026-09-09: this block used to claim that its throwaway
-- arguments proved guard PLACEMENT -- "if a guard were ever moved below a
-- validation step, the error text would change and the matching assertion here
-- would fail". That was true of exactly two of the eighteen calls. The other
-- sixteen pass real fixture ids that survive every downstream validation, so
-- moving a guard to the last line before the write leaves this whole section
-- green. These assertions prove the gate DENIES; they do not prove where it
-- sits. Placement is asserted mechanically, against pg_proc rather than
-- against error text, by assertion 7 of suspension_rpc_coverage.test.sql.
-- ============================================================================
set local role authenticated;

-- --- member-role RPCs -------------------------------------------------------
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009922","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009911","app_role":"member"}',
  true
);

select throws_like($$select check_in(now(), gen_random_uuid())$$, '%is not active%', 'suspended gym: check_in() is refused (attendance_events + front_desk_alerts writes blocked)');
select throws_like($$select check_out()$$, '%is not active%', 'suspended gym: check_out() is refused');
select throws_like($$select initiate_member_payment()$$, '%is not active%', 'suspended gym: initiate_member_payment() is refused');
select throws_like($$select book_class_session('00000000-0000-0000-0000-000000009959')$$, '%is not active%', 'suspended gym: book_class_session() is refused');
select throws_like($$select cancel_class_booking('00000000-0000-0000-0000-000000009960')$$, '%is not active%', 'suspended gym: cancel_class_booking() is refused');

-- --- owner/manager/receptionist-role RPCs -----------------------------------
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009921","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009911","app_role":"owner"}',
  true
);

select throws_like($$select check_out_member('00000000-0000-0000-0000-000000009932')$$, '%is not active%', 'suspended gym: check_out_member() is refused');
select throws_like($$select confirm_renewal('00000000-0000-0000-0000-000000009932', 'cash', 'suspension test', false)$$, '%is not active%', 'suspended gym: confirm_renewal() is refused (subscriptions + payments writes blocked)');
select throws_like($$select renew_subscription('00000000-0000-0000-0000-000000009932', 'suspension test')$$, '%is not active%', 'suspended gym: renew_subscription() is refused');
select throws_like($$select assign_coach('00000000-0000-0000-0000-000000009932', '00000000-0000-0000-0000-000000009934')$$, '%is not active%', 'suspended gym: assign_coach() is refused');
select throws_like($$select mark_class_attendance('00000000-0000-0000-0000-000000009960')$$, '%is not active%', 'suspended gym: mark_class_attendance() is refused');
select throws_like($$select create_class('Suspended Class', null, '00000000-0000-0000-0000-000000009934', 10, 'one_off', now() + interval '2 days', null, null, null)$$, '%is not active%', 'suspended gym: create_class() is refused');
select throws_like($$select update_class('00000000-0000-0000-0000-000000009954', 'Renamed', null, '00000000-0000-0000-0000-000000009934', 10, 'one_off', now() + interval '2 days', null, null, null)$$, '%is not active%', 'suspended gym: update_class() is refused');
select throws_like($$select materialize_class_sessions('00000000-0000-0000-0000-000000009954', false)$$, '%is not active%', 'suspended gym: materialize_class_sessions() is refused');

-- The three staff RPCs gate on private.current_member_role() rather than the
-- app_role claim. Code review 2026-09-09 moved 0090's guard BELOW that role
-- resolution: with the gate above it, an unauthorized caller at a suspended gym
-- learned the gym's status instead of being told they lack authorization, which
-- let any member probe suspension state through a staff-only RPC. These
-- assertions therefore run as a caller who genuinely holds the required role,
-- reaches the gate, and is refused by it.
select throws_like($$select create_staff_member(gen_random_uuid(), 'New Staff', '+237600000000', 'receptionist')$$, '%is not active%', 'suspended gym: create_staff_member() is refused');
select throws_like($$select update_staff_role('00000000-0000-0000-0000-000000009934', 'Renamed Coach', 'manager')$$, '%is not active%', 'suspended gym: update_staff_role() is refused');
select throws_like($$select deactivate_staff_member('00000000-0000-0000-0000-000000009934', 'suspension test')$$, '%is not active%', 'suspended gym: deactivate_staff_member() is refused');

-- --- coach-role RPCs --------------------------------------------------------
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009925","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009911","app_role":"coach"}',
  true
);

select throws_like($$select add_session_note('00000000-0000-0000-0000-000000009932', 'suspension test note')$$, '%is not active%', 'suspended gym: add_session_note() is refused');
select throws_like($$select edit_session_note('00000000-0000-0000-0000-000000009965', 'edited suspension test note')$$, '%is not active%', 'suspended gym: edit_session_note() is refused');

-- ============================================================================
-- Section G2: the guard must fail CLOSED (AC #5).
--
-- private.current_gym_status() returns NULL both for a session carrying no
-- gym_id claim and for one whose gym_id claim resolves to no gyms row. Inside
-- plpgsql `NULL <> 'active'` evaluates to NULL, the `if` does not fire, and the
-- function proceeds to WRITE -- the exact inverse of the RLS case, where a NULL
-- in a USING clause is falsy and so fails closed. 0090 therefore uses
-- `is distinct from`, which is true for NULL.
--
-- Code review 2026-09-09: this section previously drove check_in() alone, so
-- 17 of the 18 had no NULL-path coverage at all and a regression to `<>` in any
-- of them would have gone unnoticed here. It now covers every function whose
-- guard precedes any DB-dependent lookup -- 14 of the 18. The other four
-- (check_in, create_staff_member, deactivate_staff_member, update_staff_role)
-- deliberately resolve the caller's member row or role BEFORE the gate, so an
-- unresolvable gym claim is refused by that earlier step instead; they are
-- asserted separately below as still failing CLOSED, which is the property
-- AC #5 actually cares about. The mechanical check that no guard has drifted
-- back to `<>` in ANY of the 18 lives in suspension_rpc_coverage.test.sql,
-- which matches the fail-closed predicate itself rather than a substring.
-- ============================================================================

-- (a) No gym_id claim at all: refused by each function's pre-existing gym_id
-- null check, which 0090 deliberately left in front of its own guard.
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009922","role":"authenticated","app_role":"member"}',
  true
);
select throws_ok($$select check_in(now(), gen_random_uuid())$$, 'permission denied', 'claim-less session: check_in() is denied before reaching the status guard');

-- (b) A gym_id claim pointing at a gyms row that does not exist. This is the
-- case that reaches 0090's guard with current_gym_status() = NULL, and the one
-- a `<>` comparison would let through to the write.
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009922","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009999","app_role":"member"}',
  true
);
select throws_like($$select check_out()$$, '%is not active%', 'unresolvable gym_id claim: check_out() -- current_gym_status() is NULL and the guard still fires (`is distinct from`, not `<>`)');
select throws_like($$select initiate_member_payment()$$, '%is not active%', 'unresolvable gym_id claim: initiate_member_payment() fails closed');
select throws_like($$select book_class_session('00000000-0000-0000-0000-000000009959')$$, '%is not active%', 'unresolvable gym_id claim: book_class_session() fails closed');
select throws_like($$select cancel_class_booking('00000000-0000-0000-0000-000000009960')$$, '%is not active%', 'unresolvable gym_id claim: cancel_class_booking() fails closed');

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009921","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009999","app_role":"owner"}',
  true
);
select throws_like($$select check_out_member('00000000-0000-0000-0000-000000009932')$$, '%is not active%', 'unresolvable gym_id claim: check_out_member() fails closed');
select throws_like($$select confirm_renewal('00000000-0000-0000-0000-000000009932', 'cash', 'null-status test', false)$$, '%is not active%', 'unresolvable gym_id claim: confirm_renewal() fails closed');
select throws_like($$select renew_subscription('00000000-0000-0000-0000-000000009932', 'null-status test')$$, '%is not active%', 'unresolvable gym_id claim: renew_subscription() fails closed');
select throws_like($$select assign_coach('00000000-0000-0000-0000-000000009932', '00000000-0000-0000-0000-000000009934')$$, '%is not active%', 'unresolvable gym_id claim: assign_coach() fails closed');
select throws_like($$select mark_class_attendance('00000000-0000-0000-0000-000000009960')$$, '%is not active%', 'unresolvable gym_id claim: mark_class_attendance() fails closed');
select throws_like($$select create_class('Null Status Class', null, '00000000-0000-0000-0000-000000009934', 10, 'one_off', now() + interval '2 days', null, null, null)$$, '%is not active%', 'unresolvable gym_id claim: create_class() fails closed');
select throws_like($$select update_class('00000000-0000-0000-0000-000000009954', 'Renamed', null, '00000000-0000-0000-0000-000000009934', 10, 'one_off', now() + interval '2 days', null, null, null)$$, '%is not active%', 'unresolvable gym_id claim: update_class() fails closed');
select throws_like($$select materialize_class_sessions('00000000-0000-0000-0000-000000009954', false)$$, '%is not active%', 'unresolvable gym_id claim: materialize_class_sessions() fails closed');

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009925","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009999","app_role":"coach"}',
  true
);
select throws_like($$select add_session_note('00000000-0000-0000-0000-000000009932', 'null-status note')$$, '%is not active%', 'unresolvable gym_id claim: add_session_note() fails closed');
select throws_like($$select edit_session_note('00000000-0000-0000-0000-000000009965', 'null-status note')$$, '%is not active%', 'unresolvable gym_id claim: edit_session_note() fails closed');

-- (c) The four functions whose guard sits below a DB-dependent lookup. They
-- must still be DENIED under a NULL status -- by the earlier step rather than
-- by the gate. Asserting `throws` (not the message) is the point: what AC #5
-- requires is that nothing writes, not which raise wins the race.
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009922","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009999","app_role":"member"}',
  true
);
select throws_ok($$select check_in(now(), gen_random_uuid())$$, null, 'unresolvable gym_id claim: check_in() still fails closed (refused by its member lookup, which precedes the gate by design)');

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009921","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009999","app_role":"owner"}',
  true
);
select throws_ok($$select create_staff_member(gen_random_uuid(), 'New Staff', '+237600000000', 'receptionist')$$, null, 'unresolvable gym_id claim: create_staff_member() still fails closed (refused by its role ceiling, which precedes the gate by design)');
select throws_ok($$select update_staff_role('00000000-0000-0000-0000-000000009934', 'Renamed Coach', 'manager')$$, null, 'unresolvable gym_id claim: update_staff_role() still fails closed');
select throws_ok($$select deactivate_staff_member('00000000-0000-0000-0000-000000009934', 'null-status test')$$, null, 'unresolvable gym_id claim: deactivate_staff_member() still fails closed');

-- ============================================================================
-- Section G3 (code review 2026-09-09): the DEACTIVATED status.
--
-- 0090's header asserts that both 'suspended' and 'deactivated' are blocked,
-- and 0073's `= 'active'` semantics were a deliberate, user-confirmed decision
-- in Story 11.4. Nothing exercised it at the RPC layer: gym ...9912 existed in
-- this file but was used only for two table-level reads, so every one of
-- Section G's 18 assertions ran against a *suspended* gym and the deactivated
-- half of the claim was untested. These use the same guard-early RPCs as G2(b).
-- ============================================================================
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009922","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009912","app_role":"member"}',
  true
);
select throws_like($$select check_out()$$, '%is not active%', 'deactivated gym: check_out() is refused -- `= active` blocks deactivated as well as suspended');
select throws_like($$select initiate_member_payment()$$, '%is not active%', 'deactivated gym: initiate_member_payment() is refused');
select throws_like($$select book_class_session('00000000-0000-0000-0000-000000009959')$$, '%is not active%', 'deactivated gym: book_class_session() is refused');

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009921","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009912","app_role":"owner"}',
  true
);
select throws_like($$select renew_subscription('00000000-0000-0000-0000-000000009932', 'deactivated test')$$, '%is not active%', 'deactivated gym: renew_subscription() is refused');
select throws_like($$select assign_coach('00000000-0000-0000-0000-000000009932', '00000000-0000-0000-0000-000000009934')$$, '%is not active%', 'deactivated gym: assign_coach() is refused');
select throws_like($$select create_class('Deactivated Class', null, '00000000-0000-0000-0000-000000009934', 10, 'one_off', now() + interval '2 days', null, null, null)$$, '%is not active%', 'deactivated gym: create_class() is refused');

-- ============================================================================
-- Section H: the exclusion list must keep working while suspended (AC #2).
--
-- This is the half that prevents a permanent lockout. Section E already covers
-- the two Owner escape valves; these are the remaining paths that a careless
-- "gate every SECURITY DEFINER function" pass would have broken.
--
-- Code review 2026-09-09 corrected two things here. The claim that "every one
-- of them writes a gated table" is false: of the 19 documented exclusions only
-- 10 write one. escalate/revoke_gym_data_access, list_own_active_gym_memberships,
-- switch_active_gym, custom_access_token_hook and the four saas-billing RPCs
-- write none, so those entries can never match secdef_gated_writers and are
-- inert in both of suspension_rpc_coverage.test.sql's exclusion assertions --
-- they are asserted behaviourally here instead, which is the coverage that
-- actually matters for them.
--
-- Coverage is 11 of 19, not the 19 Task 3 implied. Not asserted here, and why:
-- record_out_of_band_saas_billing_payment and apply_saas_billing_credit both
-- lift the suspension as their whole purpose, so calling them mid-file would
-- invalidate every assertion after them; and the four private cron senders plus
-- private.create_default_member_preferences and
-- private.materialize_sessions_for_class are service_role-only helpers reached
-- through run_*_job(), which this file has no fixture for. Tracked in
-- deferred-work.md rather than left as an implied claim.
-- ============================================================================
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009921","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009911","app_role":"owner"}',
  true
);

-- log_audit_event() is the highest-risk entry on the exclusion list: it writes
-- the gated audit_log and is called BY many other RPCs, including the Super
-- Admin escalation path below and the payment webhook. Gating it would make
-- every one of those callers fail on a suspended gym.
select lives_ok(
  $$select log_audit_event('suspension_test_action', '00000000-0000-0000-0000-000000009911')$$,
  'suspended gym: log_audit_event() still succeeds -- gating it would cascade into every recovery path that audits'
);
-- Read the row back as the unrestricted fixture-setup role, exactly as
-- Section E does for its own write: the Owner's own session cannot SELECT
-- audit_log at a suspended gym -- tenant_active_gate denies that read, and
-- correctly so. Asserting through the owner session here would prove nothing
-- about whether log_audit_event()'s INSERT landed.
reset role;
select is(
  (select count(*) from audit_log where gym_id = '00000000-0000-0000-0000-000000009911' and action_type = 'suspension_test_action')::int,
  1,
  'suspended gym: the audit row actually landed in the gated audit_log table'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009921","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009911","app_role":"owner"}',
  true
);

-- 0074 exists precisely because tenant_active_gate broke the multi-gym
-- switcher; gating these would re-break Story 11.4's own fix.
select lives_ok($$select list_own_active_gym_memberships()$$, 'suspended gym: list_own_active_gym_memberships() still succeeds -- the Owner must be able to see and leave a suspended gym');
select lives_ok($$select switch_active_gym('00000000-0000-0000-0000-000000009911')$$, 'suspended gym: switch_active_gym() still succeeds');

reset role;

-- The auth hook must keep minting claims for a suspended gym, or the Owner
-- cannot authenticate at all -- and therefore cannot pay to un-suspend.
select lives_ok(
  $$select custom_access_token_hook('{"user_id":"00000000-0000-0000-0000-000000009921","claims":{}}'::jsonb)$$,
  'suspended gym: custom_access_token_hook() still mints claims -- gating it would lock the Owner out of login itself'
);

-- Super Admin support access must work BECAUSE the gym is suspended.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009924","role":"authenticated","app_role":"super_admin"}',
  true
);
select lives_ok(
  $$select escalate_gym_data_access('00000000-0000-0000-0000-000000009911', 'suspension test escalation')$$,
  'suspended gym: escalate_gym_data_access() still succeeds -- Super Admin support access is needed because the gym is suspended, not despite it'
);
select lives_ok(
  $$select revoke_gym_data_access('00000000-0000-0000-0000-000000009911', '00000000-0000-0000-0000-000000009924', 'suspension test revocation')$$,
  'suspended gym: revoke_gym_data_access() still succeeds'
);

-- A member's payment landing after suspension must still reconcile. This RPC
-- is service_role-granted and resolves its gym from the payment row, never
-- from a caller claim -- which is why it is excluded rather than gated.
reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select lives_ok(
  $$select complete_verified_payment('00000000-0000-0000-0000-000000009968', 100)$$,
  'suspended gym: complete_verified_payment() still succeeds -- a webhook arriving after suspension must reconcile, not fail'
);
reset role;
select is(
  (select status::text from payments where id = '00000000-0000-0000-0000-000000009968'),
  'verified',
  'suspended gym: the webhook write actually landed on the gated payments table'
);

-- complete_flagged_payment() is the subject of Story 11.8's own premise
-- correction #1 -- deferred-work.md listed it as needing a gate, and §C
-- correctly overrode that because it is a service_role webhook resolving its
-- gym from the payment row rather than from a caller claim. It had no test.
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select lives_ok(
  $$select complete_flagged_payment('00000000-0000-0000-0000-000000009969')$$,
  'suspended gym: complete_flagged_payment() still succeeds -- the exclusion the deferred note got wrong, now pinned by a test'
);
reset role;
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


-- ============================================================================
-- Section I (Story 11.8): RPC-level reversal, matching Section F's table-level
-- one. The gym is `active` again as of Section F. The same sessions that were
-- refused in Section G now get through and actually write -- on the very next
-- statement, no reconnection and no token refresh, because
-- private.current_gym_status() reads the gyms row live rather than anything
-- baked into the JWT (AC #3).
--
-- Code review 2026-09-09: `set local role authenticated` was missing here, so
-- these assertions ran as the unrestricted setup role -- the claims-based guard
-- was still exercised, but "the same previously-denied session" was not
-- literally what re-ran, and the authenticated grant path was never proven to
-- recover. Section F's last statement is a `reset role`, so this is required.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009922","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009911","app_role":"member"}',
  true
);

select lives_ok(
  $$select check_out()$$,
  'reversal: the same member session refused by check_out() in Section G now succeeds -- next statement, no reconnect'
);
select isnt(
  (select checked_out_at from attendance_events where id = '00000000-0000-0000-0000-000000009953'),
  null,
  'reversal: check_out() actually wrote -- the guard is off, not merely quiet'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009921","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009911","app_role":"owner"}',
  true
);

select lives_ok(
  $$select assign_coach('00000000-0000-0000-0000-000000009932', '00000000-0000-0000-0000-000000009934')$$,
  'reversal: a staff RPC refused in Section G now succeeds too -- the gate reverses for every role, not just members'
);

select * from finish();
rollback;
