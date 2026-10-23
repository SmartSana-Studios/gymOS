-- Rollback for migration 0136 (support excluded from staff counts). Restores the pre-0136 bodies.
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0136-support-excluded-from-staff-counts.sql
-- Also revert with it: supabase/tests/support_role_live_gate.test.sql (function-mention list), support_excluded_from_counts.test.sql, and the app-side
-- changes (apps/dashboard/services/staff.ts .in(), apps/super-admin/services/gyms.ts .neq()). Not drilled (see deferred-work).
set local lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.update_staff_role(p_member_id uuid, p_name text, p_role member_role)
 RETURNS members
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    if not (v_is_self_edit and p_role = v_target.role) and not coalesce(p_role in ('supervisor', 'manager', 'receptionist', 'coach'), false) then
      raise exception 'update_staff_role: caller is not authorized to assign role %', p_role;
    end if;
  elsif v_caller_role = 'supervisor' then
    if not (v_is_self_edit and p_role = v_target.role) and not coalesce(p_role in ('manager', 'receptionist', 'coach'), false) then
      raise exception 'update_staff_role: caller is not authorized to assign role %', p_role;
    end if;
  else
    raise exception 'update_staff_role: caller is not authorized to edit staff';
  end if;

  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'update_staff_role: gym % is not active', v_gym_id;
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
$function$
;

CREATE OR REPLACE FUNCTION public.deactivate_staff_member(p_member_id uuid, p_reason text)
 RETURNS members
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'deactivate_staff_member: gym % is not active', v_gym_id;
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
$function$
;

CREATE OR REPLACE FUNCTION public.staff_account_for_reset(p_member_id uuid)
 RETURNS TABLE(user_id uuid, phone text, name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid;
  v_caller_role member_role;
  v_row members;
begin
  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'staff_account_for_reset: caller has no gym-scoped session';
  end if;

  v_caller_role := private.current_member_role();
  if v_caller_role is distinct from 'owner' and v_caller_role is distinct from 'supervisor' then
    raise exception 'staff_account_for_reset: caller is not authorized to reset staff passwords';
  end if;

  select *
  into v_row
  from members
  where id = p_member_id
    and gym_id = v_gym_id
    and role != 'member'
    and deactivated_at is null;

  if not found then
    raise exception 'staff_account_for_reset: target not found or not eligible';
  end if;

  if v_caller_role = 'supervisor' and v_row.role in ('owner', 'supervisor') then
    raise exception 'staff_account_for_reset: caller is not authorized to reset a password for role %', v_row.role;
  end if;

  perform log_audit_event(
    p_action_type => 'staff_password_reset',
    p_gym_id => v_gym_id,
    p_target_entity_id => v_row.id::text,
    p_target_entity_type => 'member',
    p_metadata => jsonb_build_object('target_name', v_row.name)
  );

  return query select v_row.user_id, v_row.phone, v_row.name;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_staff_member(p_user_id uuid, p_name text, p_phone text, p_role member_role)
 RETURNS members
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    if not coalesce(p_role in ('supervisor', 'manager', 'receptionist', 'coach'), false) then
      raise exception 'create_staff_member: caller is not authorized to create staff with role %', p_role;
    end if;
  elsif v_caller_role = 'supervisor' then
    if not coalesce(p_role in ('manager', 'receptionist', 'coach'), false) then
      raise exception 'create_staff_member: caller is not authorized to create staff with role %', p_role;
    end if;
  else
    raise exception 'create_staff_member: caller is not authorized to create staff';
  end if;

  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'create_staff_member: gym % is not active', v_gym_id;
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
$function$
;

CREATE OR REPLACE FUNCTION public.gym_member_count(p_gym_id uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count bigint;
begin
  if not private.is_super_admin() then
    raise exception 'permission denied';
  end if;

  select count(*) into v_count from members where gym_id = p_gym_id;
  return v_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.platform_metrics()
 RETURNS TABLE(total_gyms bigint, total_members bigint, total_payments_processed bigint, active_gyms bigint, suspended_gyms bigint, deactivated_gyms bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not private.is_super_admin() then
    raise exception 'permission denied';
  end if;

  return query
  select
    (select count(*) from gyms)::bigint,
    (select count(*) from members)::bigint,
    -- 'verified' is the only payment_status meaning confirmed/reconciled
    -- money; voided_at marks a record kept for audit that never counted.
    (select coalesce(sum(amount), 0) from payments where status = 'verified' and voided_at is null)::bigint,
    (select count(*) from gyms where status = 'active')::bigint,
    (select count(*) from gyms where status = 'suspended')::bigint,
    (select count(*) from gyms where status = 'deactivated')::bigint;
end;
$function$
;

drop function if exists private.staff_roles();
