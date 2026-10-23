-- Rollback for migration 0144 (support revocation, Owner visibility and velocity lock).
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0144-support-revocation-velocity-lock.sql
-- Data effects: the Owner review queue (public.support_staff_review) is DROPPED (members.created_by_support stays, so the tag survives
-- but the "reviewed" state is lost); the velocity reset time and lock reason columns are dropped (a locked account stays locked: locked_at
-- is untouched, so unlock it first if it should be usable); the audit-action allow-list table is dropped. Audit rows and staff_notices /
-- email_outbox rows written by 0144 stay. The replaced functions go back to their 0143-era bodies.
-- Run only with the dashboard and the Super Admin app rolled back first (they call the functions dropped here).

-- Guard (Epic 23 retro G8): this script drops public.unlock_support_account and the lock-reason columns but leaves locked_at as it is, so a
-- locked account would stay locked with no way to unlock it. Refuse until none is locked (Super Admin > GymOS support > Locked accounts).
do $$
begin
  if exists (select 1 from private.support_accounts where locked_at is not null) then
    raise exception 'rollback 0144: unlock every locked support account first, then run this script again';
  end if;
end $$;

select cron.unschedule('support_activity_digest');
drop function if exists private.support_activity_digest();

drop trigger if exists zz_support_revoke_on_gym_status on public.gyms;
drop function if exists private.support_revoke_on_gym_status();
drop trigger if exists pin_created_by_support on public.members;
drop function if exists private.pin_created_by_support();

drop function if exists public.unlock_support_account(uuid, text);
drop function if exists public.get_support_locks();
drop function if exists public.clear_support_review(uuid);
drop function if exists public.get_support_review_queue();

CREATE OR REPLACE FUNCTION private.session_gate_touch(p_user uuid, p_session uuid)
 RETURNS TABLE(ok boolean, reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_created timestamptz;
  v_started timestamptz;
  v_seen    timestamptz;
  v_support boolean;
begin
  v_support := p_user is not null and exists (
    select 1 from public.support_assignments a where a.support_user_id = p_user and a.state <> 'ended');

  -- Support is gated whatever the super_admin_aal2 flag says; everyone else follows the flag as before.
  if not v_support and not private.super_admin_aal2_required() then
    return query select true, 'ok'::text;
    return;
  end if;
  if p_user is null or p_session is null then
    return query select false, 'no_session'::text;
    return;
  end if;
  -- Only Super Admins and support carry these limits; anyone else is decided by authorize_action.
  if not v_support and not coalesce((select u.is_super_admin from users u where u.id = p_user), false) then
    return query select true, 'ok'::text;
    return;
  end if;

  -- A dual-role user (Super Admin and support) is locked by either lock.
  if (coalesce((select u.is_super_admin from users u where u.id = p_user), false) and private.super_admin_locked(p_user))
     or (v_support and exists (select 1 from private.support_accounts sa where sa.user_id = p_user and sa.locked_at is not null)) then
    perform private.end_user_sessions(p_user);
    return query select false, 'locked'::text;
    return;
  end if;

  select s.created_at into v_created from auth.sessions s where s.id = p_session and s.user_id = p_user;
  if not found then
    delete from private.support_session_state where session_id = p_session and user_id = p_user;
    return query select false, 'session_expired'::text;
    return;
  end if;

  insert into private.support_session_state (session_id, user_id, started_at, last_seen_at)
  values (p_session, p_user, coalesce(v_created, now()), now())
  on conflict (session_id) do nothing;

  select st.started_at, st.last_seen_at into v_started, v_seen
  from private.support_session_state st where st.session_id = p_session and st.user_id = p_user;
  if not found then
    return query select false, 'session_expired'::text;
    return;
  end if;

  if v_started < now() - make_interval(mins => private.session_limit('absolute_session_minutes'))
     or v_seen < now() - make_interval(mins => private.session_limit('idle_minutes')) then
    delete from private.support_session_state where session_id = p_session;
    delete from auth.sessions where id = p_session and user_id = p_user;
    insert into audit_log (gym_id, actor_id, actor_display_name, action_type, target_entity_type, target_entity_id, metadata)
    values (null, null, 'system:session_limits',
            case when v_support then 'support_session_expired' else 'super_admin_session_expired' end,
            'user', p_user::text,
            jsonb_build_object('reason', case when v_started < now() - make_interval(mins => private.session_limit('absolute_session_minutes')) then 'absolute' else 'idle' end));
    return query select false, 'session_expired'::text;
    return;
  end if;

  update private.support_session_state set last_seen_at = now() where session_id = p_session;
  return query select true, 'ok'::text;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_allow_gymos_support(p_gym_id uuid, p_on boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_old    boolean;
  v_status gym_status;
  v_a      record;
begin
  if p_gym_id is null
     or p_on is null
     or p_gym_id is distinct from private.gym_id()
     or private.current_member_role() is distinct from 'owner' then
    raise exception 'permission denied';
  end if;

  perform private.support_gym_lock(p_gym_id);

  select g.allow_gymos_support, g.status into v_old, v_status
    from gyms g where g.id = p_gym_id for update;
  if not found then
    raise exception 'set_allow_gymos_support: gym not found';
  end if;
  if v_status is distinct from 'active' then
    raise exception 'set_allow_gymos_support: gym % is not active', p_gym_id;
  end if;
  if v_old is not distinct from p_on then
    return;
  end if;

  perform set_config('gymos.allow_support_setter', 'on', true);
  update gyms set allow_gymos_support = p_on where id = p_gym_id;
  perform set_config('gymos.allow_support_setter', 'off', true);

  if not p_on then
    for v_a in
      select id from support_assignments where gym_id = p_gym_id and state = 'active' order by id for update
    loop
      update support_assignments set state = 'suspended', suspended_by_switch = true where id = v_a.id;
      perform private.support_set_membership(v_a.id, false);
    end loop;
  else
    for v_a in
      select id from support_assignments
       where gym_id = p_gym_id and state = 'suspended' and suspended_by_switch order by id for update
    loop
      update support_assignments set state = 'active', suspended_by_switch = false where id = v_a.id;
      perform private.support_set_membership(v_a.id, true);
    end loop;
  end if;

  perform log_audit_event(
    p_action_type => 'allow_gymos_support_changed',
    p_gym_id => p_gym_id,
    p_target_entity_id => p_gym_id::text,
    p_target_entity_type => 'gym',
    p_metadata => jsonb_build_object('old', v_old, 'new', p_on)
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.unassign_support(p_assignment_id uuid, p_reason text)
 RETURNS TABLE(ok boolean, code text, assignment_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_pre    record;
  v_a      public.support_assignments;
begin
  perform private.support_admin_required();
  if not private.support_reason_ok(v_reason) then
    return query select false, 'reason_invalid'::text, null::uuid;
    return;
  end if;

  select a.gym_id into v_pre from public.support_assignments a where a.id = p_assignment_id;
  if not found then
    return query select false, 'not_found'::text, null::uuid;
    return;
  end if;
  perform private.support_gym_lock(v_pre.gym_id);

  select * into v_a from public.support_assignments a where a.id = p_assignment_id for update;
  if not found then   -- removed between the unlocked read and the lock
    return query select false, 'not_found'::text, null::uuid;
    return;
  end if;
  if v_a.state = 'ended' then
    return query select false, 'already_ended'::text, v_a.id;
    return;
  end if;

  update public.support_assignments
     set state = 'ended', ended_at = now(), suspended_by_switch = false
   where id = v_a.id;
  perform private.support_set_membership(v_a.id, false);
  perform private.support_admin_audit('support_unassigned', v_a.support_user_id,
    jsonb_build_object('gym_id', v_a.gym_id, 'assignment_id', v_a.id, 'previous_state', v_a.state, 'reason', v_reason));
  return query select true, 'ended'::text, v_a.id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.deactivate_support_account(p_user_id uuid, p_reason text)
 RETURNS TABLE(ok boolean, code text, assignment_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_gym    record;
  v_a      record;
  v_acct   record;
  v_ended  jsonb := '[]'::jsonb;
  v_gyms   jsonb := '[]'::jsonb;
begin
  perform private.support_admin_required();
  if not private.support_reason_ok(v_reason) then
    return query select false, 'reason_invalid'::text, null::uuid;
    return;
  end if;
  if p_user_id is null then
    return query select false, 'not_found'::text, null::uuid;
    return;
  end if;

  -- gym locks first, in a fixed order; the account row second
  for v_gym in
    select distinct a.gym_id from public.support_assignments a
     where a.support_user_id = p_user_id and a.state <> 'ended' order by a.gym_id
  loop
    perform private.support_gym_lock(v_gym.gym_id);
  end loop;

  select sa.deactivated_at into v_acct from private.support_accounts sa where sa.user_id = p_user_id for update;
  if not found then
    return query select false, 'not_found'::text, null::uuid;
    return;
  end if;
  if v_acct.deactivated_at is not null then
    return query select false, 'already_deactivated'::text, null::uuid;
    return;
  end if;

  for v_a in
    select a.id, a.gym_id from public.support_assignments a
     where a.support_user_id = p_user_id and a.state <> 'ended' order by a.gym_id, a.id for update
  loop
    perform private.support_gym_lock(v_a.gym_id);   -- re-entrant; covers an assignment added after the first read
    update public.support_assignments set state = 'ended', ended_at = now(), suspended_by_switch = false where id = v_a.id;
    perform private.support_set_membership(v_a.id, false);
    v_ended := v_ended || to_jsonb(v_a.id);
    v_gyms  := v_gyms || to_jsonb(v_a.gym_id);
  end loop;

  update private.support_accounts set deactivated_at = clock_timestamp() where user_id = p_user_id;
  update private.support_invites set superseded_at = now()
   where user_id = p_user_id and consumed_at is null and superseded_at is null;
  perform private.end_user_sessions(p_user_id);

  perform private.support_admin_audit('support_account_deactivated', p_user_id,
    jsonb_build_object('reason', v_reason, 'ended_assignments', v_ended, 'gym_ids', v_gyms));
  return query select true, 'deactivated'::text, null::uuid;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.log_audit_event(p_action_type text, p_gym_id uuid DEFAULT NULL::uuid, p_target_entity_id text DEFAULT NULL::text, p_target_entity_type text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb, p_system_actor_label text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor_id uuid;
  v_actor_display_name text;
  v_caller_gym_id uuid;
  v_caller_is_super_admin boolean;
  v_id uuid;
begin
  v_actor_id := private.actor_id();

  if v_actor_id is not null then
    select u.display_name into v_actor_display_name
    from public.users u
    where u.id = v_actor_id;

    if v_actor_display_name is null or v_actor_display_name = '' then
      select m.name into v_actor_display_name
      from members m
      where m.user_id = v_actor_id
        and m.gym_id = coalesce(private.gym_id(), private.support_gym_id())
        and m.deactivated_at is null
      order by m.created_at desc, m.id desc
      limit 1;
    end if;

    v_actor_display_name := coalesce(nullif(v_actor_display_name, ''), 'Unknown User');

    -- 23.7: a live support caller is always shown as the gym proxy ("GymOS Support"), never an individual.
    if private.support_gym_id() is not null then
      v_actor_display_name := 'GymOS Support';
    end if;

    v_caller_gym_id := coalesce(private.gym_id(), private.support_gym_id());
    v_caller_is_super_admin := private.is_super_admin_live();

    if not v_caller_is_super_admin
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
  v_by_support boolean;
begin
  v_gym_id := private.support_rpc_gym_id('create_staff_member');
  if v_gym_id is null then
    raise exception 'create_staff_member: caller has no gym-scoped session';
  end if;
  v_by_support := private.gym_id() is null;

  v_caller_role := private.support_rpc_role('create_staff_member');

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

  -- Story 23.6: a support caller needs a valid single-use step-up bound to this action and this person (after the ceiling check above,
  -- so a refused role never spends a grant).
  if v_by_support then
    perform private.support_stepup_require('support_create_staff', p_user_id::text);
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
    -- Story 23.2: a support membership is never a replace target from inside a gym (same message as a missing row).
    if v_existing.role = 'support' then
      raise exception 'create_staff_member: target not found or not eligible';
    end if;

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
    set name = p_name, role = p_role, phone = p_phone,
        created_by_support = (created_by_support or v_by_support)
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
  insert into members (gym_id, user_id, role, name, phone, created_by_support)
  values (v_gym_id, p_user_id, p_role, p_name, p_phone, v_by_support)
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

CREATE OR REPLACE FUNCTION private.stepup_record_failure(p_user uuid)
 RETURNS TABLE(locked boolean, attempts integer, threshold integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_threshold integer := private.session_limit('stepup_failure_threshold');
  v_count integer;
  v_locked boolean := false;
begin
  if p_user is null or not private.super_admin_aal2_required()
     or not coalesce((select u.is_super_admin from users u where u.id = p_user), false) then
    return query select false, 0, v_threshold;
    return;
  end if;

  insert into private.super_admin_lockout (user_id, failed_count) values (p_user, 1)
  on conflict (user_id) do update set failed_count = private.super_admin_lockout.failed_count + 1
  returning failed_count, (locked_at is not null) into v_count, v_locked;

  insert into audit_log (gym_id, actor_id, actor_display_name, action_type, target_entity_type, target_entity_id, metadata)
  values (null, null, 'system:step_up', 'super_admin_stepup_failed', 'user', p_user::text,
          jsonb_build_object('attempts', v_count, 'threshold', v_threshold));

  if not v_locked and v_count >= v_threshold then
    update private.super_admin_lockout set locked_at = now() where user_id = p_user;
    perform private.end_user_sessions(p_user);
    insert into audit_log (gym_id, actor_id, actor_display_name, action_type, target_entity_type, target_entity_id, metadata)
    values (null, null, 'system:step_up', 'super_admin_locked', 'user', p_user::text,
            jsonb_build_object('attempts', v_count, 'threshold', v_threshold));
    v_locked := true;
  end if;
  return query select v_locked, v_count, v_threshold;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_support_action_identity(p_subject_table text, p_subject_ids uuid[])
 RETURNS TABLE(subject_table text, subject_id uuid, real_user_id uuid, real_name text, real_email text, gym_id uuid, recorded_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform private.support_admin_required();
  if not private.is_super_admin_live() then
    raise exception 'permission denied';
  end if;
  return query
    select i.subject_table, i.subject_id, i.real_user_id, u.display_name, au.email::text, i.gym_id, i.recorded_at
      from public.support_action_identity i
      left join public.users u on u.id = i.real_user_id
      left join auth.users au on au.id = i.real_user_id
     where i.subject_table = p_subject_table
       and i.subject_id = any (coalesce(p_subject_ids, '{}'::uuid[]))
     order by i.recorded_at, i.id;
end;
$function$
;

drop function if exists private.support_velocity_breach(uuid);
drop function if exists private.support_lock_account(uuid, text);
drop function if exists private.support_revoke_access(uuid, uuid, text);
drop index if exists public.support_action_identity_user_idx;
drop table if exists public.support_staff_review;
drop table if exists private.support_audit_actions;
drop function if exists private.notify_super_admins(text, text, text, text, text);
drop function if exists private.notify_gym_owners(uuid, text, text, text, text, text);
drop function if exists private.queue_staff_notice(uuid, uuid, text, text, text, text, text);

alter table private.support_accounts drop column if exists velocity_reset_at, drop column if exists locked_reason;
delete from private.session_limits_config
 where key in ('velocity_gym_per_hour', 'velocity_account_per_hour', 'velocity_payment_changes_per_day', 'support_revocation_cutoff_seconds');
