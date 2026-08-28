-- Story 11.4: Tenant Suspension Enforcement (FR-131/FR-132, NFR-018, AD-3).
-- Pure enforcement retrofit on top of Story 11.2's already-shipped
-- `gyms.status = 'suspended'` transition (0071) and Story 11.3's already-
-- shipped reversal (`complete_verified_saas_billing_payment()`, 0072). No
-- new table, no new billing logic -- this migration only adds RLS policies.
--
-- private.current_gym_status() (0063) already exists but is called from
-- exactly one policy today (gym_staff_read_own_members). NFR-018 requires
-- suspension to be enforced "at the RLS/auth-hook layer" for every gym-
-- scoped table, not just that one -- this migration is that retrofit.
--
-- Mechanism: one new `AS RESTRICTIVE` policy, named identically
-- ("tenant_active_gate") on every gym-scoped operational table, rather than
-- editing each table's existing PERMISSIVE policies individually. Postgres
-- ANDs every RESTRICTIVE policy against the OR of all PERMISSIVE ones for a
-- given command (confirmed against current Postgres RLS docs -- restrictive
-- policies are combined with AND, and are evaluated in addition to,
-- never instead of, permissive policies), so this adds the gate without
-- touching a single existing policy's business logic -- lower regression
-- risk than editing ~15 already-shipped, already-reviewed policy bodies.
-- `AS RESTRICTIVE` has never been used anywhere in this schema before this
-- migration; recorded as a new pattern in docs/decisions.md.
--
-- `FOR ALL` is a deliberate, narrow exception to AD-1's "never FOR ALL"
-- convention. AD-1 targets differentiated per-action business policies
-- (a table's own SELECT/INSERT/UPDATE/DELETE rules, which must stay
-- explicit and per-action); this is a single uniform tenant-liveness gate
-- that must apply identically to every action a suspended gym's session
-- could attempt, so collapsing it to one `FOR ALL` restrictive policy is
-- more correct here, not less, than four repeated identical policies would
-- be. Same reasoning for the repeated-verbatim policy name across every
-- table (not this codebase's usual descriptive-unique-name convention) --
-- deliberate, so `grep "tenant_active_gate" supabase/migrations/` finds
-- every site this migration touches in one shot.
--
-- The `OR private.is_super_admin()` clause is load-bearing, not defensive
-- boilerplate. `members`/`payments`/`audit_log` each carry a Super-Admin
-- escalated-read PERMISSIVE policy (0012_super_admin_data_access_escalation.sql)
-- that Story 1.7's audit-logged support-escalation flow (FR-072) depends
-- on. Since a RESTRICTIVE policy applies regardless of which PERMISSIVE
-- policy would otherwise pass, a bare `current_gym_status() = 'active'`
-- gate on those three tables would lock Super Admin out of investigating or
-- overriding a suspended gym -- the opposite of what a suspended gym needs
-- (Story 11.5's Super Admin Billing view, backlog, depends on this access
-- continuing to work). Applied uniformly to every gated table below, not
-- just those three, so no future Super-Admin escalation policy on another
-- table silently regresses the same way.
--
-- `current_gym_status() = 'active'` (not `<> 'suspended'`) is used
-- deliberately: `deactivated` is a distinct, more severe Super-Admin
-- lifecycle action (0011_super_admin_tier_gym_lifecycle.sql) than a
-- billing-driven suspension, and every other already-shipped piece of this
-- machinery already treats `deactivated` as the stricter state --
-- `initiate_saas_billing_payment()` (0072) explicitly rejects `deactivated`
-- gyms while permitting `suspended` ones, and `run_saas_billing_lifecycle_job()`
-- (0071) excludes already-`deactivated` gyms from its own suspend
-- transition. It would be inconsistent for a fully deactivated gym's staff
-- to retain data access while a merely-suspended gym's staff does not, so
-- this gate denies both non-active states uniformly. Confirmed with the
-- user before implementation.
--
-- NULL-safety: a `super_admin`-role session has no `gym_id` claim at all
-- (`private.gym_id()` returns NULL), so `private.current_gym_status()`
-- returns NULL and `NULL = 'active'` evaluates to NULL (falsy) under a
-- RESTRICTIVE USING clause -- correctly falling through to the
-- `OR private.is_super_admin()` clause rather than a NULL-unsafe silent
-- pass. Asserted via pgTAP in tenant_suspension_enforcement.test.sql.
--
-- Deliberately NOT touched by this migration (regression guards, verified
-- via pgTAP): `gyms` itself (the "read own gym" policy, 0009, stays open to
-- every role regardless of status -- both apps need it to detect and
-- render the suspended state); `custom_access_token_hook()` (0009, keeps
-- minting valid claims for a suspended gym's users so the Owner's escape
-- valve keeps working); `initiate_saas_billing_payment()` /
-- `update_own_owner_notification_email()` (0072, both SECURITY DEFINER --
-- table owner bypasses RLS by default, no FORCE ROW LEVEL SECURITY
-- anywhere in this schema, so neither RPC is affected by any policy added
-- here).
--
-- Table list re-derived from the current schema at implementation time
-- (`grep -rn "gym_id uuid not null references gyms" supabase/migrations/`
-- plus a manual audit of every table's actual policy set), not copied
-- verbatim from the story's own table -- it was written as a starting
-- point, not a final list, and two corrections were needed:
--   1. `audit_log` is added even though its own `gym_id` column is
--      nullable (0007) -- the gate reads the *caller's* own gym status via
--      private.current_gym_status(), never the target row's gym_id, so
--      nullability of the gated table's own column is irrelevant. It has a
--      real gym-scoped staff-facing read policy
--      (manager_or_owner_read_own_audit_log, 0049) the story's own table
--      omitted, and its super_admin_read_audit_log policy (0012) is one of
--      the three the OR-is_super_admin() clause above was written to
--      protect -- so it belongs in scope regardless.
--   2. `gym_payment_credentials` (0052) is deliberately left OUT despite
--      having a `gym_id not null` column: RLS is enabled but the table
--      carries zero PERMISSIVE policies granting direct `authenticated`
--      access -- every read/write goes through `connect_gym_payment_credentials()`/
--      `disconnect_gym_payment_credentials()`, both SECURITY DEFINER. A
--      RESTRICTIVE policy here would be a no-op (nothing PERMISSIVE exists
--      for it to restrict), the same reasoning that already excludes
--      `saas_billing_payments`/`saas_billing_notices`.
--
-- `payment_discrepancies` (gym_id nullable, `missing_internal_record` rows
-- have none) is included below -- it carries a real staff-facing read
-- policy (gym_staff_read_own_payment_discrepancies, 0032, owner/manager/
-- receptionist) and gating it keeps suspension enforcement uniform across
-- every operational surface staff can reach. Confirmed with the user
-- before implementation (either answer was defensible; this one was
-- chosen for consistency with every other gated table).
--
-- No dynamic DDL: each policy is written out explicitly per table,
-- matching this codebase's established one-CREATE-POLICY-statement-per-
-- table style everywhere else -- no migration in this schema generates DDL
-- via a `DO $$ ... EXECUTE format(...) $$` loop, and this one doesn't
-- start that precedent.

create policy "tenant_active_gate" on members
  as restrictive
  for all
  using (private.current_gym_status() = 'active' or private.is_super_admin())
  with check (private.current_gym_status() = 'active' or private.is_super_admin());

create policy "tenant_active_gate" on payments
  as restrictive
  for all
  using (private.current_gym_status() = 'active' or private.is_super_admin())
  with check (private.current_gym_status() = 'active' or private.is_super_admin());

create policy "tenant_active_gate" on subscriptions
  as restrictive
  for all
  using (private.current_gym_status() = 'active' or private.is_super_admin())
  with check (private.current_gym_status() = 'active' or private.is_super_admin());

create policy "tenant_active_gate" on refunds
  as restrictive
  for all
  using (private.current_gym_status() = 'active' or private.is_super_admin())
  with check (private.current_gym_status() = 'active' or private.is_super_admin());

create policy "tenant_active_gate" on attendance_events
  as restrictive
  for all
  using (private.current_gym_status() = 'active' or private.is_super_admin())
  with check (private.current_gym_status() = 'active' or private.is_super_admin());

create policy "tenant_active_gate" on plans
  as restrictive
  for all
  using (private.current_gym_status() = 'active' or private.is_super_admin())
  with check (private.current_gym_status() = 'active' or private.is_super_admin());

create policy "tenant_active_gate" on classes
  as restrictive
  for all
  using (private.current_gym_status() = 'active' or private.is_super_admin())
  with check (private.current_gym_status() = 'active' or private.is_super_admin());

create policy "tenant_active_gate" on class_sessions
  as restrictive
  for all
  using (private.current_gym_status() = 'active' or private.is_super_admin())
  with check (private.current_gym_status() = 'active' or private.is_super_admin());

create policy "tenant_active_gate" on class_bookings
  as restrictive
  for all
  using (private.current_gym_status() = 'active' or private.is_super_admin())
  with check (private.current_gym_status() = 'active' or private.is_super_admin());

create policy "tenant_active_gate" on progress_entries
  as restrictive
  for all
  using (private.current_gym_status() = 'active' or private.is_super_admin())
  with check (private.current_gym_status() = 'active' or private.is_super_admin());

create policy "tenant_active_gate" on progress_photos
  as restrictive
  for all
  using (private.current_gym_status() = 'active' or private.is_super_admin())
  with check (private.current_gym_status() = 'active' or private.is_super_admin());

create policy "tenant_active_gate" on coach_assignments
  as restrictive
  for all
  using (private.current_gym_status() = 'active' or private.is_super_admin())
  with check (private.current_gym_status() = 'active' or private.is_super_admin());

create policy "tenant_active_gate" on member_preferences
  as restrictive
  for all
  using (private.current_gym_status() = 'active' or private.is_super_admin())
  with check (private.current_gym_status() = 'active' or private.is_super_admin());

create policy "tenant_active_gate" on session_notes
  as restrictive
  for all
  using (private.current_gym_status() = 'active' or private.is_super_admin())
  with check (private.current_gym_status() = 'active' or private.is_super_admin());

create policy "tenant_active_gate" on front_desk_alerts
  as restrictive
  for all
  using (private.current_gym_status() = 'active' or private.is_super_admin())
  with check (private.current_gym_status() = 'active' or private.is_super_admin());

create policy "tenant_active_gate" on audit_log
  as restrictive
  for all
  using (private.current_gym_status() = 'active' or private.is_super_admin())
  with check (private.current_gym_status() = 'active' or private.is_super_admin());

create policy "tenant_active_gate" on payment_discrepancies
  as restrictive
  for all
  using (private.current_gym_status() = 'active' or private.is_super_admin())
  with check (private.current_gym_status() = 'active' or private.is_super_admin());
