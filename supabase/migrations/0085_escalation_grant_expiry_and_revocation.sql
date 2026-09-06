-- Escalation Grant Expiry & Revocation (Story 1.15). Gives the Story 1.7
-- escalation grant a lifecycle: a 24-hour TTL and manual revocation by any
-- Super Admin. This REVERSES Story 1.7's Decision 1 ("the audit_log row IS
-- the grant", docs/decisions.md) and is the explicit revisit condition that
-- decision wrote for itself ("revisit with a TTL/revocation mechanism only
-- if a future security review calls for it", docs/decisions.md:1234).
--
-- Why the audit_log row can no longer be the grant, in two words: append-only.
--   1. 0007_audit_log.sql:108 revokes update/delete/truncate from every role
--      including service_role. Revocation could therefore only be expressed
--      as a newer superseding row with a "latest row wins" predicate -- i.e.
--      mutable state emulated on a substrate deliberately built to forbid it.
--   2. Decisively: log_audit_event() derives actor_id from auth.uid() and
--      never accepts it as a parameter (deliberate, so authorship cannot be
--      forged). When Super Admin B revokes A's grant the revocation row
--      carries actor_id = B, but the escalation predicate matches
--      actor_id = auth.uid() -- so A's own session would never see B's
--      revocation. Third-party revocation is not expressible at all.
--
-- audit_log therefore returns to being a pure accountability record, which
-- is what 0007's own header says it is for. Every escalation AND every
-- revocation is still written there (both RPCs below call log_audit_event()),
-- so the Gym Detail Audit trail tab keeps showing the complete history.

-- ============================================================================
-- Task 1: gym_data_escalations -- the grant record itself.
-- ============================================================================
create table gym_data_escalations (
  id uuid primary key default gen_random_uuid(),
  -- `on delete cascade` on BOTH FKs here, deliberately UNLIKE audit_log's
  -- `on delete set null` (0007). This is the single most likely thing a
  -- reviewer flags as an inconsistency with 0007, so: the two tables hold
  -- different kinds of thing. audit_log is an evidentiary record whose
  -- content must survive the deletion of everything it refers to -- a gym
  -- offboarding must never be blocked by, nor erase, the trail of what was
  -- done to it. This table is live authorization state. Deleting a gym or a
  -- user SHOULD destroy their grants; a grant pointing at a deleted gym is
  -- not evidence, it is a dangling permission. The evidentiary record of
  -- every escalation lives in audit_log and survives independently.
  gym_id uuid not null references gyms(id) on delete cascade,
  actor_id uuid not null references users(id) on delete cascade,
  reason text not null,
  granted_at timestamptz not null default now(),
  -- A real stored column rather than computing `granted_at + interval '24
  -- hours'` inside the RLS predicate: it makes the deadline directly
  -- renderable in the UI (AC #3's "expires at" column), and lets a future
  -- story vary the window per grant without touching the predicate at all.
  expires_at timestamptz not null,
  revoked_at timestamptz,
  -- `on delete set null` here, unlike the two FKs above: this column is
  -- evidentiary (who revoked it), not authorization state. Deleting the
  -- revoking admin's user row must not resurrect a revoked grant, which is
  -- exactly what `on delete cascade` on a revoked row would do.
  revoked_by uuid references users(id) on delete set null,
  revoke_reason text
);

-- Partial, matching the exact shape private.has_active_gym_data_escalation()
-- below queries: (gym_id, actor_id) among non-revoked rows. expires_at is
-- deliberately not in the index -- it is a range predicate evaluated after
-- the equality lookup, and the active set per (gym, actor) is tiny.
create index idx_gym_data_escalations_active
  on gym_data_escalations (gym_id, actor_id)
  where revoked_at is null;

alter table gym_data_escalations enable row level security;

-- See 0002 for why baseline table-level GRANTs are required alongside RLS
-- (Postgres checks the base table grant before RLS is ever consulted).
-- `anon` is deliberately not granted, matching every other table here.
grant select, insert, update, delete on gym_data_escalations to authenticated, service_role;

-- Platform-wide and unfiltered, NOT scoped to actor_id = auth.uid(): AC #3
-- requires a Super Admin to see OTHER admins' active grants on a gym in
-- order to revoke them. Reading who holds access is itself an
-- accountability feature, not a leak -- the grant row's `reason` is the
-- same free text already visible to every Super Admin in the audit trail.
create policy "super_admin_read_gym_data_escalations" on gym_data_escalations
  for select
  using (private.is_super_admin());

-- No INSERT/UPDATE/DELETE policy for any role. The two security definer
-- RPCs below are the only sanctioned write path, matching audit_log's
-- log_audit_event() and payment_providers' activate_payment_provider()
-- "single blessed write path" posture (0029:27-36). In particular this
-- means a Super Admin cannot hand-extend their own expires_at.

-- ============================================================================
-- Task 2: the predicate helper, and the two rewritten 0012 policies.
-- ============================================================================
-- Deliberately NOT `security definer`. The only callers are the two policies
-- below, which already AND in private.is_super_admin() -- and a Super Admin
-- can read this table directly via the policy above anyway. This is exactly
-- how 0012's current inline `exists (select ... from audit_log ...)` works:
-- it relies on super_admin_read_audit_log rather than bypassing RLS. Adding
-- `security definer` would be a strictly wider bypass than needed.
--
-- No recursion risk: gym_data_escalations' own policy calls only
-- private.is_super_admin(), which reads the JWT, not a table.
create function private.has_active_gym_data_escalation(p_gym_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from gym_data_escalations e
    where e.gym_id = p_gym_id
      and e.actor_id = auth.uid()
      and e.revoked_at is null
      and e.expires_at > now()
  );
$$;

-- `alter policy` rather than drop-and-recreate: this project's established
-- pattern for revising a shipped policy (0040:58,64; 0061:156; 0063:330).
-- The policy names, tables and command stay exactly as 0012 created them --
-- only the USING expression changes -- so `grep` for the policy name still
-- lands on 0012 as the origin and on this migration as the revision.
alter policy "super_admin_escalated_read_members" on members
  using (
    private.is_super_admin()
    and private.has_active_gym_data_escalation(members.gym_id)
  );

alter policy "super_admin_escalated_read_payments" on payments
  using (
    private.is_super_admin()
    and private.has_active_gym_data_escalation(payments.gym_id)
  );

-- Deliberately NOT touched, for the avoidance of doubt:
--
--  * super_admin_read_audit_log (0012) -- the audit trail's readability is
--    not part of this change, and SA-03's Audit trail tab depends on it.
--
--  * idx_audit_log_gym_actor_action (0012) -- this composite index existed
--    solely to serve the escalation-check subquery that this migration just
--    deleted, so it is now unused BY THIS FEATURE. It is left in place
--    anyway: audit_log is queried by (gym_id, ...) from several other
--    surfaces, dropping an index is not this story's business, and an index
--    that is merely no longer optimal costs write throughput on one
--    append-only table rather than correctness. Do not "clean it up" as a
--    drive-by.

-- ============================================================================
-- Task 3: the two write RPCs.
--
-- Both are `security definer`, which bypasses RLS ENTIRELY -- so each must
-- self-enforce private.is_super_admin() internally. That internal check is
-- the only gate, exactly as log_audit_event(), platform_metrics() and
-- activate_payment_provider() already document.
-- ============================================================================
create function escalate_gym_data_access(p_gym_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grant_id uuid;
begin
  if not private.is_super_admin() then
    raise exception 'permission denied';
  end if;

  -- Mandatory reason, mirroring the escalation dialog's existing contract
  -- (escalateGymAccessSchema). Enforced here too because `security definer`
  -- means this function is reachable directly over PostgREST by any
  -- authenticated Super Admin session, not only through the app's form.
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'a reason is required to escalate gym data access';
  end if;

  -- A NEW ROW ON EVERY ESCALATION, even when an active grant already exists.
  -- Story 1.7 Task 4 decided explicitly that a repeat escalation is a
  -- legitimate distinct event ("a new reason, a new point-in-time record"),
  -- and that decision still holds here. No no-op guard, and deliberately no
  -- "extend the existing row's expires_at" either -- the `exists` predicate
  -- is indifferent to how many active rows there are, and extending would
  -- silently rewrite the deadline the UI already showed someone.
  --
  -- 24 hours is hardcoded (user decision, 2026-09-06). Changing the window
  -- later requires a migration. That is the intended trade: an explicit,
  -- auditable, migration-gated security control over a runtime-tunable one.
  insert into gym_data_escalations (gym_id, actor_id, reason, expires_at)
  values (p_gym_id, auth.uid(), p_reason, now() + interval '24 hours')
  returning id into v_grant_id;

  -- Same transaction as the insert above, so a grant can never exist
  -- without its audit record (and vice versa). log_audit_event() remains
  -- the single canonical write path into audit_log -- this does not
  -- hand-roll an INSERT.
  --
  -- target_entity_id is now the GRANT's id (was the gym's id in 0012-era
  -- rows written via logGymDataEscalation): the audit row's subject is the
  -- specific grant, and services/gyms.ts's listActiveEscalations joins back
  -- on exactly this to recover each holder's display name.
  perform log_audit_event(
    p_action_type := 'gym_data_escalation',
    p_gym_id := p_gym_id,
    p_target_entity_id := v_grant_id::text,
    p_target_entity_type := 'gym_data_escalations',
    p_metadata := jsonb_build_object('reason', p_reason)
  );

  return v_grant_id;
end;
$$;

create function revoke_gym_data_access(p_gym_id uuid, p_actor_id uuid, p_reason text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_revoked_count integer;
begin
  if not private.is_super_admin() then
    raise exception 'permission denied';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'a reason is required to revoke gym data access';
  end if;

  -- EVERY currently-active grant for that (gym, actor) pair, not one id:
  -- the repeat-escalation rule above means several may legitimately be open
  -- at once, and revoking only the newest would leave the older ones still
  -- satisfying the `exists` predicate -- i.e. a revocation that silently
  -- does nothing.
  --
  -- Any Super Admin may revoke any grant, including another admin's (user
  -- decision, 2026-09-06). All Super Admins are peers with no role above
  -- them and every revocation is audit-logged, so this is self-policing
  -- rather than hierarchical.
  update gym_data_escalations
  set revoked_at = now(),
      revoked_by = auth.uid(),
      revoke_reason = p_reason
  where gym_id = p_gym_id
    and actor_id = p_actor_id
    and revoked_at is null
    and expires_at > now();

  get diagnostics v_revoked_count = row_count;

  -- Revoking zero rows is NOT an error -- the grant may have expired or
  -- been revoked by someone else a moment earlier, and both are the
  -- outcome the caller wanted. The count is returned so the caller can
  -- tell the difference and word its confirmation honestly.
  perform log_audit_event(
    p_action_type := 'gym_data_escalation_revoked',
    p_gym_id := p_gym_id,
    p_target_entity_id := p_actor_id::text,
    p_target_entity_type := 'users',
    p_metadata := jsonb_build_object('reason', p_reason, 'revoked_count', v_revoked_count)
  );

  return v_revoked_count;
end;
$$;

-- audit_log.action_type is free text, not an enum (0007:40, and that
-- migration's own comment explains why) -- so 'gym_data_escalation_revoked'
-- needs no enum migration.

-- Postgres grants EXECUTE to PUBLIC on new functions by default -- 0007:222-227
-- documents why that default must be explicitly revoked rather than assumed
-- away. `anon` is deliberately excluded; `service_role` is not granted either,
-- since both of these derive the actor from auth.uid() and are meaningless
-- without a real session.
revoke execute on function escalate_gym_data_access from public;
revoke execute on function revoke_gym_data_access from public;
grant execute on function escalate_gym_data_access to authenticated;
grant execute on function revoke_gym_data_access to authenticated;

-- ============================================================================
-- Migration behaviour: legacy grants go inert (AC #7). Deliberate, one-way.
--
-- private.has_active_gym_data_escalation() reads ONLY gym_data_escalations,
-- which starts empty. Every pre-existing 'gym_data_escalation' audit_log row
-- therefore stops granting anything the moment this migration applies.
--
-- This is NOT backfilled, for two reasons. Any legacy grant is by definition
-- older than 24 hours, so a faithful backfill would produce nothing but
-- already-expired rows. And re-granting historical access silently, without
-- a fresh reason, is the exact opposite of what this story exists to do.
-- Anyone who still needs access re-escalates in one click and generates a
-- fresh, current, audited reason.
--
-- Stated plainly here because a future reader finding an empty
-- gym_data_escalations table sitting next to years of gym_data_escalation
-- audit rows will otherwise reasonably assume data loss.
-- ============================================================================
