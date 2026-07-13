-- Escalated Gym Data Access (Story 1.7, FR-072). Super Admin access to a
-- gym's individual member/payment records requires an explicit,
-- audit-logged support escalation -- not a blanket RLS exemption
-- (architecture.md Data Boundaries). Migration numbering continues the
-- established chronological-deviation-from-architecture.md's-illustrative-
-- sequence pattern (Stories 1.3-1.6's own precedent).

-- ============================================================================
-- super_admin_read_audit_log: platform-wide SELECT, no row filter -- same
-- unrestricted shape as super_admin_read_all_gyms/super_admin_read_tiers
-- (0010_super_admin_gym_provisioning.sql). audit_log has had RLS enabled
-- with zero policies since 0007_audit_log.sql (deliberate deny-all --
-- Epic 7 Story 7.2 owns the gym-admin-facing Manager/Owner-scoped read
-- policy, not touched here). This is additive and narrower in audience
-- (Super Admin only) -- it backs both SA-03's Audit Trail tab and the
-- escalation-state check below.
-- ============================================================================
create policy "super_admin_read_audit_log" on audit_log
  for select
  using (private.is_super_admin());

-- ============================================================================
-- Escalated read access to members/payments. No new table backs the grant --
-- a 'gym_data_escalation' audit_log row (written by log_audit_event(), see
-- services/gyms.ts's logGymDataEscalation) IS the grant, matching AC #2's
-- own wording ("access is granted... the escalation is audit-logged" -- one
-- event, not two). Scoped per (actor, gym): escalating for gym A never
-- grants visibility into gym B, and a different Super Admin who never
-- escalated to gym A still sees only role='owner' rows there via the
-- existing super_admin_read_owner_members policy (0010). No expiry/
-- revocation in V1 (docs/decisions.md) -- once granted, permanent for that
-- actor+gym pair.
-- ============================================================================
create policy "super_admin_escalated_read_members" on members
  for select
  using (
    private.is_super_admin()
    and exists (
      select 1 from audit_log al
      where al.gym_id = members.gym_id
        and al.actor_id = auth.uid()
        and al.action_type = 'gym_data_escalation'
    )
  );

create policy "super_admin_escalated_read_payments" on payments
  for select
  using (
    private.is_super_admin()
    and exists (
      select 1 from audit_log al
      where al.gym_id = payments.gym_id
        and al.actor_id = auth.uid()
        and al.action_type = 'gym_data_escalation'
    )
  );

-- 0007_audit_log.sql's existing indexes (gym_id, actor_id, created_at) are
-- all single-column -- none of them alone serves the (gym_id, actor_id,
-- action_type) triple both EXISTS subqueries above filter on. Since the
-- escalation grant is permanent (no expiry, docs/decisions.md) and
-- escalateGymAccess deliberately allows unlimited repeat escalations,
-- audit_log grows unboundedly per gym over time -- add the composite index
-- now, at the same migration that introduces the first query shaped this
-- way, rather than waiting for it to show up as a production slowdown.
create index idx_audit_log_gym_actor_action on audit_log (gym_id, actor_id, action_type);
