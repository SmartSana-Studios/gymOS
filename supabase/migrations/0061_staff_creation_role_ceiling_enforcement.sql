-- Story 9.1: Staff Creation with Role-Ceiling Enforcement (FR-087/FR-089/
-- FR-120, NFR-013). Renumbered from the story's originally-planned 0060 to
-- 0061 -- see 0060_staff_role_enum.sql's own header comment and
-- docs/decisions.md for why.
--
-- Builds the one canonical write path for creating staff accounts
-- (AD-6): `create_staff_member()`, a SECURITY DEFINER RPC that checks the
-- caller's own live role against a hard, closed target-role allowlist before
-- inserting. No RLS INSERT policy is added for staff roles -- this RPC is the
-- only path, matching book_class_session()/assign_coach()'s established
-- write-via-RPC-not-policy precedent (bypasses RLS entirely as its owning
-- role).

-- ============================================================================
-- private.current_member_role(): live lookup of the caller's own gym-scoped
-- role. Mirrors private.gym_id()'s never-throws/return-null-on-absence
-- discipline (0009), but unlike private.gym_id()/private.is_super_admin()
-- (both plain STABLE -- they only read auth.jwt(), no table access), this
-- one reads `members`, which has RLS. It MUST be SECURITY DEFINER, not plain
-- STABLE: an invoker-rights version's correctness would depend on the
-- calling session's own SELECT access to `members`, which a Coach caller
-- does not have today (gym_staff_read_own_members excludes 'coach' since
-- Story 5.2; coach_read_assigned_members only covers *assigned* members,
-- never the coach's own row) -- exactly the "identical, no-error,
-- wrong-empty-result" bug class docs/decisions.md already documents twice
-- for private.is_own_coach_id()/private.is_assigned_coach() (0040/0041).
-- A plain invoker-rights helper here would silently return NULL for every
-- Coach caller instead of raising, so the bug would be invisible without a
-- dedicated regression test (added in this story's pgTAP suite).
-- ============================================================================
create function private.current_member_role()
returns member_role
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role member_role;
begin
  select role into v_role
  from members
  where user_id = auth.uid()
    and gym_id = private.gym_id()
    and deactivated_at is null
  order by created_at desc, id desc
  limit 1;

  return v_role;
end;
$$;

revoke execute on function private.current_member_role from public;
grant execute on function private.current_member_role to authenticated, service_role;

-- ============================================================================
-- create_staff_member(): the sole write path for provisioning a staff
-- `members` row. Modeled on assign_coach()'s (0039) resolve -> check ->
-- write -> log_audit_event() shape. Ceiling check is a closed allowlist, not
-- a "deny only Owner/Super Admin" blocklist -- every role that isn't
-- explicitly Owner or Supervisor falls through to the same `else` rejection,
-- so Manager (AC #3), Receptionist, Coach, a plain Member, and a caller with
-- no active membership at all are all rejected identically, whether they
-- reach this via a hidden UI path or a direct RPC call.
--
-- `p_role member_role` structurally cannot be pinned to a narrower "staff
-- role" subtype at the SQL type level (no such subtype exists), so 'owner'
-- is a value the type system alone does not reject -- the allowlist below is
-- what actually rejects it (AC #4): no branch of the if/elsif/else ever
-- permits p_role = 'owner', for any caller, including an Owner targeting
-- another Owner. Super Admin is a separate users.is_super_admin flag, never
-- a member_role value, so there is no enum value that could even represent
-- it -- AC #4's "no role may ever create a Super Admin through this path" is
-- true by construction, not by a runtime check.
-- ============================================================================
create function create_staff_member(
  p_user_id uuid,
  p_name text,
  p_phone text,
  p_role member_role
)
returns members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
  v_caller_role member_role;
  v_row members;
begin
  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'create_staff_member: caller has no gym-scoped session';
  end if;

  v_caller_role := private.current_member_role();

  if v_caller_role = 'owner' then
    if p_role not in ('supervisor', 'manager', 'receptionist', 'coach') then
      raise exception 'create_staff_member: caller is not authorized to create staff with role %', p_role;
    end if;
  elsif v_caller_role = 'supervisor' then
    if p_role not in ('manager', 'receptionist', 'coach') then
      raise exception 'create_staff_member: caller is not authorized to create staff with role %', p_role;
    end if;
  else
    raise exception 'create_staff_member: caller is not authorized to create staff';
  end if;

  insert into members (gym_id, user_id, role, name, phone)
  values (v_gym_id, p_user_id, p_role, p_name, p_phone)
  returning * into v_row;

  perform log_audit_event(
    p_action_type => 'staff_created',
    p_gym_id => v_gym_id,
    p_target_entity_id => v_row.id::text,
    p_target_entity_type => 'member',
    p_metadata => jsonb_build_object('target_role', p_role, 'target_name', p_name)
  );

  return v_row;
end;
$$;

-- Never service_role -- this RPC always runs inside a real Owner/Supervisor
-- session (AD-6: "the ceiling check runs in the caller's own normal RLS
-- session," not a service-role bypass). Contrast complete_verified_payment()'s
-- opposite service_role-only grant, for the opposite reason.
revoke execute on function create_staff_member from public;
grant execute on function create_staff_member to authenticated;

-- ============================================================================
-- RLS: widen the existing broad staff-read policy to include 'supervisor' so
-- a Supervisor session can read the gym's own roster at all (owner/manager/
-- receptionist already could). This policy is already unfiltered by target
-- role, so this one-line addition is the only RLS change AC #5's Staff List
-- read path needs. No new INSERT policy is added on `members` --
-- create_staff_member() is SECURITY DEFINER and writes as its owning role,
-- bypassing RLS entirely.
--
-- Deliberately NOT `[..., 'coach']`: this story's own Dev Notes/Task 2 text
-- says this policy currently covers 'owner', 'manager', 'receptionist',
-- 'coach' (0018's original definition) -- that's stale. Story 5.2
-- (0040_coach_portal_member_list_rls.sql) already narrowed this exact policy
-- to `['owner', 'manager', 'receptionist']`, deliberately removing 'coach'
-- (AC #3 there: a coach must see only their own row plus assigned members
-- via the separate coach_read_assigned_members policy, not the full
-- roster). Copying the story's literal instruction verbatim would silently
-- re-open that privacy boundary and regress
-- coach_portal_member_list.test.sql/dashboard_shell_self_read_rls.test.sql --
-- caught by running the full suite after this migration, not by the story
-- text itself.
-- ============================================================================
alter policy "gym_staff_read_own_members" on members
  using (
    gym_id = private.gym_id()
    and (auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'receptionist', 'supervisor'])
  );

-- ============================================================================
-- log_audit_event() actor-name fallback fix (not originally scoped to this
-- story -- added per explicit user instruction that the real name of the
-- person performing a staff-management action must be logged).
--
-- The original 0007_audit_log.sql derives actor_display_name from
-- public.users.display_name alone, falling back to 'Unknown User' if it's
-- null. docs/decisions.md (2026-07-xx, recorded during Story 2.6) documents
-- that users.display_name is NEVER populated for staff accounts -- it is a
-- member-only self-service profile field (mobile app Profile Setup, Story
-- 2.6); every Owner/Supervisor/Manager/Receptionist/Coach account has
-- display_name = null today and for the foreseeable future. Left unfixed,
-- AC #1's "audit-logged with actor" would resolve to the literal string
-- "Unknown User" for every real staff_created record this story produces --
-- the opposite of a trustworthy actor trail.
--
-- Fix: before falling back to 'Unknown User', also try the caller's own
-- gym-scoped members.name (their staff display name, which every staff
-- account genuinely has, set at creation) -- the exact same fallback
-- services/session.ts's getDashboardShellContext() already uses for the
-- Sidebar's own identity display, for the identical reason. Scoped to
-- private.gym_id() (the caller's own gym, from their JWT claim), matching
-- current_member_role()'s own lookup shape above -- a caller with no
-- gym-scoped session (no gym_id claim, e.g. a bare authenticated session
-- with no membership) still correctly falls through to 'Unknown User', not a
-- cross-gym name. actor_id derivation, the system/no-session branch, and the
-- tenant-isolation check on p_gym_id are all unchanged from 0007's original
-- -- this replace touches only the authenticated-session
-- actor_display_name resolution.
-- ============================================================================
create or replace function log_audit_event(
  p_action_type text,
  p_gym_id uuid default null,
  p_target_entity_id text default null,
  p_target_entity_type text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_system_actor_label text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_actor_display_name text;
  v_caller_gym_id uuid;
  v_caller_is_super_admin boolean;
  v_id uuid;
begin
  v_actor_id := auth.uid();

  if v_actor_id is not null then
    select u.display_name into v_actor_display_name
    from public.users u
    where u.id = v_actor_id;

    -- New fallback: users.display_name is real-world-always-null for staff
    -- accounts (see comment above) -- try the caller's own gym-scoped staff
    -- name next, before giving up on a real name entirely.
    if v_actor_display_name is null or v_actor_display_name = '' then
      select m.name into v_actor_display_name
      from members m
      where m.user_id = v_actor_id
        and m.gym_id = private.gym_id()
        and m.deactivated_at is null
      order by m.created_at desc, m.id desc
      limit 1;
    end if;

    v_actor_display_name := coalesce(nullif(v_actor_display_name, ''), 'Unknown User');

    v_caller_gym_id := private.gym_id();
    v_caller_is_super_admin := coalesce((auth.jwt() ->> 'app_role') = 'super_admin', false);

    if not v_caller_is_super_admin
       and v_caller_gym_id is not null
       and p_gym_id is not null
       and p_gym_id is distinct from v_caller_gym_id then
      raise exception 'log_audit_event: p_gym_id does not match the caller''s own gym';
    end if;
  else
    v_actor_display_name := coalesce(p_system_actor_label, 'system:' || p_action_type);
  end if;

  insert into audit_log (
    gym_id, actor_id, actor_display_name, action_type,
    target_entity_id, target_entity_type, metadata
  )
  values (
    p_gym_id, v_actor_id, v_actor_display_name, p_action_type,
    p_target_entity_id, p_target_entity_type, coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;
