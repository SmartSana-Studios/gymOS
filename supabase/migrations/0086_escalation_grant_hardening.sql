-- Escalation Grant Hardening (Story 1.15 code review, 2026-09-06).
--
-- 0085 shipped the grant lifecycle and its core guarantees hold: the TTL and
-- revocation live in the RLS predicate, not in application code, and there is
-- no write policy on gym_data_escalations. This migration closes the gaps a
-- three-layer adversarial review found around that core. It changes no
-- authorization semantics -- every access decision this migration leaves in
-- place is the same decision 0085 made.
--
-- Why a new migration rather than editing 0085: 0085 may already be applied.

-- ============================================================================
-- 1. search_path hardening (review finding: demonstrated pg_temp forgery)
-- ============================================================================
-- `set search_path = public` does NOT pin relation lookup: Postgres searches
-- pg_temp FIRST for relation names whenever pg_temp is not explicitly named.
-- An authenticated session that can execute DDL could therefore create
-- `pg_temp.gym_data_escalations` with a row of its own choosing, and
-- private.has_active_gym_data_escalation() would read the forged table --
-- granting itself every gym's members and payments with no grant row, no
-- audit entry, no TTL and nothing to revoke.
--
-- This was demonstrated against a local database during review. It is not
-- reachable over PostgREST today (which accepts no DDL), which is why it is
-- hardening rather than an incident. Naming pg_temp LAST makes the real
-- public schema win every lookup.
--
-- NOTE: `set search_path = public` appears throughout this project's earlier
-- migrations. Those are not fixed here -- this migration's scope is the three
-- functions that gate tenant PII. A project-wide sweep is separate work.
alter function private.has_active_gym_data_escalation(uuid)
  set search_path = public, pg_temp;

-- ============================================================================
-- 2. Table-level write privileges (review finding: no matching revoke)
-- ============================================================================
-- 0085 granted `insert, update, delete` to authenticated and service_role and
-- relied solely on the ABSENCE of a write policy to stop writes. That is a
-- real gate but a fragile one: 0007_audit_log.sql:89-96 documents why, for a
-- table holding accountability-critical state, only a grant-level revoke
-- "survives a future migration accidentally adding a broader
-- `grant ... on all tables in schema public`" -- RLS alone cannot.
--
-- gym_data_escalations is not configuration like payment_providers (0029,
-- whose grants 0085 copied). It IS the authorization state gating tenant
-- member and payment data, so it takes audit_log's posture, not 0029's.
--
-- service_role matters most here: it carries `bypassrls`, so for that role the
-- missing write policy stops nothing at all. 0085:273-278 already withheld
-- EXECUTE on both RPCs from service_role as "meaningless without a real
-- session" -- while leaving it direct UPDATE on the same rows, a strictly
-- wider capability than the RPC it was denied.
--
-- Neither RPC needs these grants: both are SECURITY DEFINER and execute as
-- the function owner, not the caller.
revoke insert, update, delete on gym_data_escalations
  from authenticated, service_role, anon, public;

-- ============================================================================
-- 3. Column-level read privileges (review decision, 2026-09-06)
-- ============================================================================
-- 0085's SELECT policy is deliberately unfiltered -- AC #3 requires a Super
-- Admin to see OTHER admins' grants in order to revoke them, and that stays.
-- What changes is WHICH COLUMNS that reach.
--
-- The policy comment justified exposing `reason` on the grounds that it is
-- "the same free text already visible to every Super Admin in the audit
-- trail". The app does not agree with that premise: gyms/[id]/page.tsx
-- redacts other admins' escalation reasons before they reach the client,
-- because a free-text reason can itself describe individual member or payment
-- detail. The unfiltered policy published a second, unredacted copy of that
-- text (plus the new revoke_reason) at
-- /rest/v1/gym_data_escalations?select=reason.
--
-- AC #3 needs identity and timing, not motive. `reason` and `revoke_reason`
-- stay readable to service_role (backend/compliance paths) and remain fully
-- present in audit_log, which is the accountability record of record.
--
-- revoked_at and expires_at MUST stay granted to authenticated:
-- private.has_active_gym_data_escalation() is deliberately NOT security
-- definer (0085:91-96), so it reads this table as the calling role and column
-- privileges apply to it.
revoke select on gym_data_escalations from authenticated;
grant select (id, gym_id, actor_id, granted_at, expires_at, revoked_at)
  on gym_data_escalations to authenticated;

-- ============================================================================
-- 4. Reading active grants on the DATABASE clock (review finding)
-- ============================================================================
-- The service layer filtered `expires_at` with `new Date().toISOString()` --
-- the Next.js server's clock -- while RLS compares against Postgres `now()`.
-- Any skew between the two makes the "Access granted -- expires {time}"
-- indicator and the Active data access list disagree with what RLS actually
-- permits: a grant omitted from the list cannot be revoked from the UI while
-- it is still granting reads, and a lapsed grant can still render as live.
--
-- These two functions move that comparison to the one clock that decides.
-- Both are SECURITY INVOKER (the default) on purpose: the SELECT policy above
-- is the gate, exactly as 0085 intended, and neither needs to see more than
-- the caller already may.
--
-- ONE ROW PER HOLDER, not per grant. Repeat escalation inserts a new row every
-- time (0085:176-182, deliberate) while revoke_gym_data_access() revokes every
-- active grant for the (gym, actor) pair. Listing per-grant therefore showed
-- one admin as N identical rows where revoking any one silently revoked all N,
-- having named only one -- and let a single admin's 50 repeat escalations push
-- every other admin's live grant past the query's row cap, off the list, and
-- out of reach of the only UI that can revoke them.
create function list_active_gym_data_escalations(p_gym_id uuid)
returns table (
  actor_id uuid,
  grant_count integer,
  granted_at timestamptz,
  expires_at timestamptz
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    e.actor_id,
    count(*)::integer as grant_count,
    -- The earliest live grant: when this holder's current run of access
    -- actually began, which is what "Granted {x}" should mean to a reader
    -- deciding whether to revoke.
    min(e.granted_at) as granted_at,
    -- The latest deadline: when their access actually ends. The RLS `exists`
    -- predicate is satisfied while ANY active grant remains, so the last one
    -- to expire is the one that matters.
    max(e.expires_at) as expires_at
  from gym_data_escalations e
  where e.gym_id = p_gym_id
    and e.revoked_at is null
    and e.expires_at > now()
  group by e.actor_id
  order by max(e.expires_at) desc;
$$;

-- The calling admin's own deadline, on the same clock, for the Gym Detail
-- page's "Access granted -- expires {time}" indicator.
create function get_active_escalation_expiry(p_gym_id uuid)
returns timestamptz
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select max(e.expires_at)
  from gym_data_escalations e
  where e.gym_id = p_gym_id
    and e.actor_id = auth.uid()
    and e.revoked_at is null
    and e.expires_at > now();
$$;

revoke execute on function list_active_gym_data_escalations from public;
revoke execute on function get_active_escalation_expiry from public;
grant execute on function list_active_gym_data_escalations to authenticated;
grant execute on function get_active_escalation_expiry to authenticated;

-- ============================================================================
-- 5. Reason length ceiling (review finding)
-- ============================================================================
-- Neither reason had a maximum at any layer, so unbounded text could be stored
-- in reason/revoke_reason and in audit_log metadata, then rendered raw in the
-- trail. Enforced here as well as in the Zod schemas because both RPCs are
-- reachable directly over PostgREST by any authenticated Super Admin session,
-- not only through the app's forms -- the same reasoning 0085:168-171 gives
-- for re-checking the mandatory-reason rule server-side.
--
-- No CHECK constraint on the columns: existing rows predate the rule, and a
-- table constraint would make this migration fail on any database where a
-- longer reason was already written.
create or replace function escalate_gym_data_access(p_gym_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_grant_id uuid;
begin
  if not private.is_super_admin() then
    raise exception 'permission denied';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'a reason is required to escalate gym data access';
  end if;

  if length(btrim(p_reason)) > 500 then
    raise exception 'reason is too long (max 500 characters)';
  end if;

  insert into gym_data_escalations (gym_id, actor_id, reason, expires_at)
  values (p_gym_id, auth.uid(), p_reason, now() + interval '24 hours')
  returning id into v_grant_id;

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

create or replace function revoke_gym_data_access(p_gym_id uuid, p_actor_id uuid, p_reason text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
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

  if length(btrim(p_reason)) > 500 then
    raise exception 'reason is too long (max 500 characters)';
  end if;

  update gym_data_escalations
  set revoked_at = now(),
      revoked_by = auth.uid(),
      revoke_reason = p_reason
  where gym_id = p_gym_id
    and actor_id = p_actor_id
    and revoked_at is null
    and expires_at > now();

  get diagnostics v_revoked_count = row_count;

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

-- `create or replace` preserves 0085's EXECUTE grants, but restate them so a
-- reader of this file alone can see the final privilege state.
revoke execute on function escalate_gym_data_access from public;
revoke execute on function revoke_gym_data_access from public;
grant execute on function escalate_gym_data_access to authenticated;
grant execute on function revoke_gym_data_access to authenticated;

-- ============================================================================
-- 6. Super Admin display names (review decision, 2026-09-06)
-- ============================================================================
-- AC #3 requires the Active data access list to show "each holder's display
-- name". In any real deployment every holder rendered as the literal string
-- 'Unknown User': log_audit_event() derives actor_display_name from
-- public.users.display_name and coalesces null to that constant
-- (0007_audit_log.sql:184), and display_name is never written for a Super
-- Admin -- provision-super-admin.mjs sets only is_super_admin, and the only
-- two code paths that write the column are the mobile profile screens, which
-- a Super Admin never opens. Two holders were therefore indistinguishable in
-- the revoke dialog's confirm button, which is precisely the case UX-DR12's
-- named-target rule exists to prevent.
--
-- The fix is at the source (provision-super-admin.mjs now sets display_name);
-- this backfills the Super Admins that already exist, deriving a name from the
-- auth account's email local part. Rows in audit_log that were already written
-- keep 'Unknown User' forever -- audit_log is append-only by design
-- (0007:108) and is NOT rewritten here. This is accepted: the audit trail
-- correctly records what was known at write time.
update public.users u
set display_name = initcap(replace(split_part(au.email, '@', 1), '.', ' '))
from auth.users au
where au.id = u.id
  and u.is_super_admin = true
  and coalesce(nullif(btrim(u.display_name), ''), '') = ''
  and au.email is not null;
