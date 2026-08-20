-- Story 9.3: Staff Edit, Deactivation & Immediate Access Revocation
-- (FR-089/FR-090/FR-091). Deferred by both Story 9.1 and 9.2's own Dev
-- Notes -- this migration is that deferred scope: the second AD-3 helper
-- (private.current_gym_status()), the update_staff_role()/
-- deactivate_staff_member() RPC pair AD-6 names, a retrofit of the one RLS
-- policy most directly load-bearing for staff-management access
-- (gym_staff_read_own_members), and a log_audit_event() fix.

-- ============================================================================
-- private.current_gym_status(): second AD-3 helper, mirrors
-- private.current_member_role()'s exact shape (0061:31-51) -- STABLE,
-- SECURITY DEFINER (defensive: keeps this helper immune to a future
-- narrowing of "read own gym", 0009:154-156, which every role can read
-- today via plain STABLE, matching current_member_role()'s own rationale).
-- Returns NULL if private.gym_id() itself is NULL (no gym-scoped session)
-- -- never raises, same never-throws discipline as every other
-- private.* helper.
-- ============================================================================
create function private.current_gym_status()
returns gym_status
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_status gym_status;
begin
  select status into v_status
  from gyms
  where id = private.gym_id();

  return v_status;
end;
$$;

revoke execute on function private.current_gym_status from public;
grant execute on function private.current_gym_status to authenticated, service_role;

-- ============================================================================
-- update_staff_role(): AC #1/#2. Mirrors create_staff_member()'s resolve ->
-- check -> write -> log_audit_event() shape (0061:76-125). No p_phone
-- parameter by design (Task 13's decision: Name/Role only editable, Phone
-- is the account's login identity and out of this story's scope).
-- ============================================================================
create function update_staff_role(
  p_member_id uuid,
  p_name text,
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
  v_target members;
  v_row members;
  v_is_self_edit boolean;
begin
  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'update_staff_role: caller has no gym-scoped session';
  end if;

  v_caller_role := private.current_member_role();

  select *
  into v_target
  from members
  where id = p_member_id
    and gym_id = v_gym_id
    and role != 'member'
    and deactivated_at is null;

  if not found then
    raise exception 'update_staff_role: target not found or not eligible';
  end if;

  v_is_self_edit := (v_target.user_id = auth.uid());

  -- AC #2: self-role-edit is structurally impossible, scoped to an actual
  -- role *change* attempt -- a name-only self-edit (p_role echoing the
  -- caller's own current role back unchanged) is allowed, see Dev Notes
  -- "Self-Edit Scope".
  if v_is_self_edit and p_role is distinct from v_target.role then
    raise exception 'update_staff_role: cannot edit your own role';
  end if;

  -- Closing the exact gap deferred-work.md flags for create_staff_member()'s
  -- own p_role param: a client explicitly passing JSON null coerces to SQL
  -- NULL, which would make every `not in (...)` branch below silently
  -- false (NULL is neither IN nor NOT IN any list) and fall through
  -- undetected to the UPDATE, which then fails on members.role's NOT NULL
  -- constraint instead of this RPC's own clean "not authorized" message.
  if p_role is null then
    raise exception 'update_staff_role: p_role is required';
  end if;

  -- AC #1: same closed-allowlist shape as create_staff_member() (0061:99-109),
  -- applied to the *new* role being assigned -- EXCEPT a self-edit that
  -- resubmits the caller's own current, unchanged role (a name-only edit,
  -- already confirmed above): 'owner'/'supervisor' are never themselves
  -- assignable via either allowlist below (by design -- no caller can ever
  -- assign 'owner', and a Supervisor can never assign 'supervisor'), so
  -- without this carve-out a name-only self-edit would be rejected by the
  -- very ceiling meant to block *escalation*, not a no-op resubmission of
  -- the caller's own already-held role. Deliberately scoped narrowly to the
  -- self-edit case (not every same-role peer edit), matching Dev Notes
  -- "Self-Edit Scope"'s own stated boundary.
  if v_caller_role = 'owner' then
    if not (v_is_self_edit and p_role = v_target.role) and p_role not in ('supervisor', 'manager', 'receptionist', 'coach') then
      raise exception 'update_staff_role: caller is not authorized to assign role %', p_role;
    end if;
  elsif v_caller_role = 'supervisor' then
    if not (v_is_self_edit and p_role = v_target.role) and p_role not in ('manager', 'receptionist', 'coach') then
      raise exception 'update_staff_role: caller is not authorized to assign role %', p_role;
    end if;
  else
    raise exception 'update_staff_role: caller is not authorized to edit staff';
  end if;

  -- Self-edit + protect_self_managed_member_columns (0020) interaction:
  -- that pre-existing trigger unconditionally pins name/role (among other
  -- columns) back to OLD whenever auth.uid() = old.user_id, regardless of
  -- which write path performed the UPDATE -- it was written to stop a
  -- *member* from sneaking a role change through the onboarding
  -- self-update RLS policy, but a BEFORE UPDATE trigger fires for every
  -- UPDATE unconditionally, including this SECURITY DEFINER RPC's own
  -- already-authorized self-edit. Left as-is, an Owner/Supervisor's
  -- name-only self-edit (AC #2) would silently no-op the name change --
  -- this story is the first write path in the codebase where a
  -- SECURITY DEFINER RPC legitimately needs to update the caller's own
  -- `members` row. A transaction-local GUC, checked by the trigger
  -- (updated below), signals "this specific write already passed its own
  -- authorization, do not pin it back."
  perform set_config('app.staff_role_update_bypass', 'true', true);
  update members
  set name = p_name, role = p_role
  where id = p_member_id
  returning * into v_row;
  perform set_config('app.staff_role_update_bypass', 'false', true);

  perform log_audit_event(
    p_action_type => 'staff_role_updated',
    p_gym_id => v_gym_id,
    p_target_entity_id => v_row.id::text,
    p_target_entity_type => 'member',
    p_metadata => jsonb_build_object(
      'previous_role', v_target.role,
      'new_role', p_role,
      'previous_name', v_target.name,
      'new_name', p_name
    )
  );

  return v_row;
end;
$$;

-- Never service_role -- the ceiling check must run inside the caller's own
-- real session, same AD-6 reasoning as create_staff_member()/
-- staff_account_for_reset() (0061/0062).
revoke execute on function update_staff_role from public;
grant execute on function update_staff_role to authenticated;

-- ============================================================================
-- deactivate_staff_member(): AC #3. A distinct RPC from update_staff_role()
-- (mandatory-reason parameter, confirm-dialog UX, not a p_role => NULL
-- overload), structurally identical machinery extending AD-6's "one
-- canonical RPC per write shape" pattern. Deactivation ceiling mirrors
-- staff_account_for_reset()'s code-review-added ceiling exactly (0062:71-73)
-- -- see story Dev Notes "Deactivation Needs a Ceiling Too, By Direct
-- Precedent". Self-deactivation is blocked outright -- see Dev Notes
-- "Self-Deactivation: EXPERIENCE.md's Silent Gap". No reactivation path in
-- this story's scope (deactivation is one-directional, matching
-- deactivateMember()'s own member-side precedent).
-- ============================================================================
create function deactivate_staff_member(
  p_member_id uuid,
  p_reason text
)
returns members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
  v_caller_role member_role;
  v_target members;
  v_row members;
begin
  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'deactivate_staff_member: caller has no gym-scoped session';
  end if;

  if p_reason is null or trim(p_reason) = '' then
    raise exception 'deactivate_staff_member: reason is required';
  end if;

  v_caller_role := private.current_member_role();
  if v_caller_role is distinct from 'owner' and v_caller_role is distinct from 'supervisor' then
    raise exception 'deactivate_staff_member: caller is not authorized to deactivate staff';
  end if;

  select *
  into v_target
  from members
  where id = p_member_id
    and gym_id = v_gym_id
    and role != 'member'
    and deactivated_at is null;

  if not found then
    raise exception 'deactivate_staff_member: target not found or not eligible';
  end if;

  if v_target.user_id = auth.uid() then
    raise exception 'deactivate_staff_member: cannot deactivate your own account';
  end if;

  -- Code review fix: the Dev Notes/docs/decisions.md ceiling contract reads
  -- "Owner may deactivate any non-owner staff role... never Owner", but only
  -- the Supervisor branch below actually enforced a target restriction --
  -- an Owner caller had no explicit guard blocking an Owner target. Currently
  -- unreachable (no RPC can ever assign 'owner' to a second member), but
  -- closed explicitly for defense-in-depth and to match the documented
  -- contract, mirroring the analogous gap already flagged in
  -- staff_account_for_reset() (0062:71-73).
  if v_target.role = 'owner' then
    raise exception 'deactivate_staff_member: caller is not authorized to deactivate role %', v_target.role;
  end if;

  if v_caller_role = 'supervisor' and v_target.role = 'supervisor' then
    raise exception 'deactivate_staff_member: caller is not authorized to deactivate role %', v_target.role;
  end if;

  update members
  set deactivated_at = now()
  where id = p_member_id
  returning * into v_row;

  perform log_audit_event(
    p_action_type => 'staff_deactivated',
    p_gym_id => v_gym_id,
    p_target_entity_id => v_row.id::text,
    p_target_entity_type => 'member',
    p_metadata => jsonb_build_object(
      'target_name', v_target.name,
      'target_role', v_target.role,
      'reason', p_reason
    )
  );

  return v_row;
end;
$$;

revoke execute on function deactivate_staff_member from public;
grant execute on function deactivate_staff_member to authenticated;

-- ============================================================================
-- private.protect_self_managed_member_columns() (0020): add the
-- update_staff_role() bypass GUC (set immediately around that RPC's own
-- self-edit UPDATE above) to this trigger's existing self-row pin-back
-- check.
--
-- Code review fix: the bypass is scoped to *only* the two columns
-- update_staff_role() actually writes (name/role) -- every other
-- self-managed column (gym_id, user_id, phone, email, dob, photo_url,
-- join_date, emergency_contact, deactivated_at, created_at) is still
-- unconditionally pinned back regardless of the GUC. The original,
-- all-or-nothing bypass shape had no live exploit path (the only statement
-- ever run under it sets exactly name/role), but a future reuse of this
-- same GUC name against a broader UPDATE would have silently disabled
-- protection for every other column too. This narrower shape keeps the
-- trigger fully protecting against a member sneaking *any* self-managed
-- column change through the unrelated onboarding self-update RLS policy
-- (0020's own original purpose) except the one already-authorized,
-- already-ceiling-checked name/role write path.
-- ============================================================================
create or replace function private.protect_self_managed_member_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() = old.user_id then
    new.gym_id := old.gym_id;
    new.user_id := old.user_id;
    new.phone := old.phone;
    new.email := old.email;
    new.dob := old.dob;
    new.photo_url := old.photo_url;
    new.join_date := old.join_date;
    new.emergency_contact := old.emergency_contact;
    new.deactivated_at := old.deactivated_at;
    new.created_at := old.created_at;

    if coalesce(current_setting('app.staff_role_update_bypass', true), 'false') <> 'true' then
      new.role := old.role;
      new.name := old.name;
    end if;
  end if;
  return new;
end;
$$;

-- ============================================================================
-- AC #4 (narrowed scope, see story Dev Notes "AC #4's Real Scope"): retrofit
-- the one RLS policy most directly load-bearing for "can a deactivated/
-- demoted staff member still act as staff at all" to the two live-state
-- AD-3 helpers, replacing the raw `(auth.jwt() ->> 'app_role')` read
-- (0061:156-160). Also wires in current_gym_status() = 'active' -- a small,
-- deliberate scope addition: a staff member of a since-suspended/
-- deactivated gym shouldn't retain roster-read access either, and it costs
-- nothing extra on the one policy already being touched (does not
-- substitute for Epic 11's own future broader suspension-enforcement
-- retrofit).
--
-- Deliberately NOT retrofitting the other ~32 auth.jwt() ->> 'app_role'
-- call sites across ~20 other migration files -- AD-3's own text already
-- accepts incremental adoption ("27 existing migrations... grandfathered").
-- Logged as a deferred-work.md item below this migration.
-- ============================================================================
alter policy "gym_staff_read_own_members" on members
  using (
    gym_id = private.gym_id()
    and private.current_gym_status() = 'active'
    and private.current_member_role() = any(array['owner'::member_role, 'manager'::member_role, 'receptionist'::member_role, 'supervisor'::member_role])
  );

-- ============================================================================
-- AC #5 (corrected mechanism, see story Dev Notes "AC #5 Is Imprecisely
-- Worded"): the only auth.jwt() ->> 'app_role' call site remaining in
-- log_audit_event() (0061:235) decides Super Admin exemption from the
-- p_gym_id cross-tenant check -- has nothing to do with a member_role value,
-- so private.current_member_role() cannot literally replace it (it has no
-- 'super_admin' value and would return NULL for every real Super Admin,
-- a functional regression). private.is_super_admin_live() is a new live-
-- lookup sibling to the existing JWT-claim-only private.is_super_admin()
-- (0010:18-24, left untouched -- used elsewhere, not audited here), reading
-- users.is_super_admin directly instead of the JWT claim.
-- ============================================================================
create function private.is_super_admin_live()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_super_admin from users where id = auth.uid()), false);
$$;

revoke execute on function private.is_super_admin_live from public;
grant execute on function private.is_super_admin_live to authenticated, service_role;

-- Same signature as 0061:192-259 -- only line 235's stale-JWT-claim read is
-- replaced. actor_display_name's members.name fallback (Story 9.1) and the
-- p_gym_id tenant-isolation check both stay exactly as-is.
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
    v_caller_is_super_admin := private.is_super_admin_live();

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
