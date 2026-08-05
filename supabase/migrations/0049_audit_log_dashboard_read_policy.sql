-- Story 7.2: Audit Log Dashboard Page (FR-068, FR-079/080/081, AD-12). Adds
-- the gym-scoped Manager/Owner read policy that 0007_audit_log.sql and
-- 0012_super_admin_data_access_escalation.sql both explicitly deferred to
-- this story -- audit_log has been deny-all for gym staff since creation.
-- Coexists (OR'd) with the existing super_admin_read_audit_log policy
-- (0012) -- that policy is not touched here.

-- Mirrors manager_or_owner_read_own_coach_assignments (0039) and
-- manager_or_owner_read_own_session_notes (0041) exactly -- not
-- gym_staff_read_own_members/gym_staff_read_own_subscriptions (0018), which
-- wrongly include receptionist/coach for this story's scope (AC #3: only
-- Manager/Owner may browse the audit log).
--
-- No `gym_id is not null` guard is needed: private.gym_id() is never null
-- for an authenticated Manager/Owner session, and pg_cron job-failure rows
-- (nullable gym_id, 0007_audit_log.sql) never match by construction --
-- `null = null` evaluates to UNKNOWN in SQL, which a `USING` clause treats
-- as excluding the row, same practical effect as a false comparison.
create policy "manager_or_owner_read_own_audit_log" on audit_log
  for select
  using (
    gym_id = private.gym_id()
    and (auth.jwt() ->> 'app_role') = any(array['manager', 'owner'])
  );

-- No new index: idx_audit_log_gym_id, idx_audit_log_actor_id,
-- idx_audit_log_created_at (0007) and the composite
-- idx_audit_log_gym_actor_action (0012) already cover this page's
-- gym_id + created_at range + actor_id equality access pattern.
