-- Story 9.4: Multi-Gym Staff Binding Rules (FR-091/FR-092).
--
-- `create_staff_member()` (0061) has always called
-- `admin.auth.admin.createUser()` unconditionally for every creation
-- attempt, with no prior lookup for whether the phone number already
-- resolves to an existing platform user. Since `auth.users.phone` is
-- platform-unique, AC #1's scenario (add an existing member/staff person as
-- staff at a *second* gym) could never even be attempted -- it failed
-- outright with a raw `phone_exists` GoTrue error. This migration is the
-- other half of that fix (the TypeScript half -- `staff.ts`'s
-- `createStaffMember()` now looks up the phone before deciding whether to
-- call `createUser()` at all -- lives in this story's own app-layer
-- commit, not here): `create_staff_member()` itself gains the logic to
-- either insert a new binding (AC #1, a different gym) or replace an
-- existing active binding in place (AC #2, the same gym), keyed purely on
-- `(gym_id, user_id)` regardless of the existing row's current role -- see
-- the story's own Dev Notes "AC #2 Mechanically Closes deferred-work.md's
-- Promote-Existing-Member Gap Too" for why the role-agnostic match is
-- deliberate, not an oversight.

create or replace function create_staff_member(
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
  v_existing members;
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

  -- Story 9.4 (AC #1/#2): does `p_user_id` already have an *active* binding
  -- at this caller's own gym? Deliberately no `role` filter -- this matches
  -- `idx_members_active_gym_user` (0003_members_and_users.sql:39), the
  -- unique index this whole story is built around, which is itself
  -- role-agnostic. Matching a `role = 'member'` row here is intentional:
  -- it's what makes "promote an existing gym member to staff" fall through
  -- to the same replace-in-place branch as a staff-to-staff role change,
  -- closing the exact gap deferred-work.md's story-9-1 entry flagged.
  select *
  into v_existing
  from members
  where gym_id = v_gym_id
    and user_id = p_user_id
    and deactivated_at is null;

  if v_existing.id is not null then
    -- New self-targeting path (Story 9.4): before this story, this RPC
    -- could never legitimately target the caller's own row (there was no
    -- lookup-and-replace branch at all). An Owner/Supervisor typing their
    -- own phone number into the Add Staff form now resolves to their own
    -- `user_id`, finds their own active binding, and would otherwise
    -- silently rewrite their own name/role. Mirrors
    -- `update_staff_role()`'s self-edit block (0063:88-90) in spirit, but
    -- simpler -- no name-only carve-out, since there is no meaningful
    -- reason to "re-add yourself" through this specific form.
    if v_existing.user_id = auth.uid() then
      raise exception 'create_staff_member: cannot replace your own binding';
    end if;

    -- Target-role ceiling (security fix found while writing this story's own
    -- pgTAP suite -- see docs/decisions.md): the ceiling check above only
    -- constrains p_role (the *new* role being assigned), not the *existing*
    -- row's current role. Without this guard, a Supervisor could target an
    -- Owner's or another Supervisor's own active binding at this gym and
    -- replace it with e.g. 'manager', demoting them -- p_role = 'manager' is
    -- within the Supervisor's own allowlist, so the check above alone would
    -- let it through. Mirrors `deactivate_staff_member()`'s existing
    -- target-role ceiling shape (0063:234-240): Owner may replace any
    -- non-owner target; Supervisor may replace Manager/Receptionist/Coach/
    -- Member targets only, never Owner or another Supervisor.
    if v_existing.role = 'owner' then
      raise exception 'create_staff_member: caller is not authorized to replace a staff member with role %', v_existing.role;
    end if;
    if v_caller_role = 'supervisor' and v_existing.role = 'supervisor' then
      raise exception 'create_staff_member: caller is not authorized to replace a staff member with role %', v_existing.role;
    end if;

    -- AC #2: replace the existing binding in place, not a second row.
    -- Includes phone -- p_phone is the identity phone that resolved
    -- p_user_id in the first place, but v_existing.phone (this gym's own
    -- denormalized snapshot from whenever this row was originally created)
    -- can have drifted from it since, so refresh it here too (review finding).
    update members
    set name = p_name, role = p_role, phone = p_phone
    where id = v_existing.id
    returning * into v_row;

    -- Reuses update_staff_role()'s own 'staff_role_updated' action type
    -- (0063) for the identical underlying fact (a members row's role/name
    -- changed) rather than inventing a new audit action type -- see story
    -- Dev Notes "Reusing staff_role_updated, Not a New Audit Action Type".
    perform log_audit_event(
      p_action_type => 'staff_role_updated',
      p_gym_id => v_gym_id,
      p_target_entity_id => v_row.id::text,
      p_target_entity_type => 'member',
      p_metadata => jsonb_build_object(
        'previous_role', v_existing.role,
        'new_role', p_role,
        'previous_name', v_existing.name,
        'new_name', p_name,
        'replaced_via', 'create_staff_member'
      )
    );

    return v_row;
  end if;

  -- No active binding at this gym for this user -- AC #1's cross-gym case
  -- (a brand-new binding for a person already bound at a different gym)
  -- and the genuinely-new-person case both fall through here, unchanged
  -- from 0061's original behavior.
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

-- Grant shape unchanged from 0061 -- authenticated only, never service_role
-- (the ceiling check must run inside the caller's own real session).
revoke execute on function create_staff_member from public;
grant execute on function create_staff_member to authenticated;

-- ============================================================================
-- update_staff_role() (0063, Story 9.3): identical pre-existing security gap
-- found and fixed while writing this story's own pgTAP suite -- see
-- docs/decisions.md. The function's ceiling check only ever constrained
-- p_role (the *new* role being assigned), never v_target.role (the row's
-- *current* role) -- there was no guard anywhere stopping a Supervisor from
-- calling `update_staff_role()` against an Owner's or another Supervisor's
-- own row with p_role = 'manager' and successfully demoting them, since
-- 'manager' is within the Supervisor's own allowlist. This is the exact
-- same class of gap `deactivate_staff_member()` (same migration, 0063)
-- already guards against explicitly -- that RPC has a target-role check,
-- this one never did. Signature and every other line unchanged from 0063;
-- only the new target-role ceiling block is added, scoped to skip the
-- self-edit case (an Owner/Supervisor editing their own row's name only
-- must not be blocked by a check on their own row's role).
-- ============================================================================
create or replace function update_staff_role(
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

  if v_is_self_edit and p_role is distinct from v_target.role then
    raise exception 'update_staff_role: cannot edit your own role';
  end if;

  -- New (Story 9.4): target-role ceiling, scoped to skip the self-edit case
  -- (a legitimate name-only self-edit of an Owner's/Supervisor's own row
  -- must not be blocked by a check on their own row's role -- the self-edit
  -- block immediately above already governs that case).
  if not v_is_self_edit then
    if v_target.role = 'owner' then
      raise exception 'update_staff_role: caller is not authorized to edit a staff member with role %', v_target.role;
    end if;
    if v_caller_role = 'supervisor' and v_target.role = 'supervisor' then
      raise exception 'update_staff_role: caller is not authorized to edit a staff member with role %', v_target.role;
    end if;
  end if;

  if p_role is null then
    raise exception 'update_staff_role: p_role is required';
  end if;

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

-- Grant shape unchanged from 0063.
revoke execute on function update_staff_role from public;
grant execute on function update_staff_role to authenticated;
