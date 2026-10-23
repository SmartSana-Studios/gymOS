-- Epic 23 decision follow-up (item 6): the Owner is told when GymOS Support access to the gym ends, but not when it comes back after an
-- unlock. unlock_support_account now writes a gym-scoped audit row and one Owner notice for each gym whose assignment it restored, in the
-- same style as the "ended" notice: the system is the actor and nothing names an individual.
-- Rollback: scripts/rollback-0152-support-unlock-resumed-notice.sql.
set local lock_timeout = '5s';

create or replace function public.unlock_support_account(p_user_id uuid, p_reason text)
returns table (ok boolean, code text, assignment_id uuid)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_acct   record;
  v_gym    record;
  v_gyms   uuid[];
  v_g      uuid;
  v_restored integer;
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

  for v_gym in
    select distinct a.gym_id from public.support_assignments a where a.support_user_id = p_user_id and a.state <> 'ended' order by a.gym_id
  loop
    perform private.support_gym_lock(v_gym.gym_id);
  end loop;

  select sa.locked_at, sa.locked_reason, sa.deactivated_at into v_acct
    from private.support_accounts sa where sa.user_id = p_user_id for update;
  if not found then
    return query select false, 'not_found'::text, null::uuid;
    return;
  end if;
  if v_acct.deactivated_at is not null then
    perform private.support_admin_audit('support_unlock_refused', p_user_id, jsonb_build_object('code', 'deactivated', 'reason', v_reason));
    return query select false, 'deactivated'::text, null::uuid;
    return;
  end if;
  if v_acct.locked_at is null then
    perform private.support_admin_audit('support_unlock_refused', p_user_id, jsonb_build_object('code', 'not_locked', 'reason', v_reason));
    return query select false, 'not_locked'::text, null::uuid;
    return;
  end if;
  -- Story 23.11: a lock caused by a contact change outside the Super Admin path is not lifted while the drift is still there
  -- (record the right address with change_support_contact first).
  if private.support_contact_drifted(p_user_id) then
    perform private.support_admin_audit('support_unlock_refused', p_user_id, jsonb_build_object('code', 'contact_drift', 'reason', v_reason));
    return query select false, 'contact_drift'::text, null::uuid;
    return;
  end if;

  -- the gyms whose assignment the lock suspended, to tell their Owners once the restore has run
  select coalesce(array_agg(distinct a.gym_id order by a.gym_id), '{}'::uuid[]) into v_gyms
    from public.support_assignments a
   where a.support_user_id = p_user_id and a.state = 'suspended' and a.suspended_by_switch;

  update private.support_accounts
     set locked_at = null, locked_reason = null, velocity_reset_at = now()
   where user_id = p_user_id;
  update private.super_admin_lockout set failed_count = 0, locked_at = null where user_id = p_user_id;
  perform private.support_touch_activity(p_user_id);
  v_restored := private.support_restore_assignments(p_user_id);
  perform private.support_admin_audit('support_account_unlocked', p_user_id,
    jsonb_build_object('reason', v_reason, 'previous_lock_reason', v_acct.locked_reason, 'locked_at', v_acct.locked_at,
                       'assignments_restored', v_restored));

  -- Epic 23 retro: tell the Owner of each gym where access is back (nothing names the person)
  foreach v_g in array v_gyms loop
    if exists (select 1 from public.support_assignments a where a.support_user_id = p_user_id and a.gym_id = v_g and a.state = 'active') then
      insert into audit_log (gym_id, actor_id, actor_display_name, action_type, target_entity_type, target_entity_id, metadata)
      values (v_g, null, 'system:support_unlock', 'gymos_support_access_resumed', 'gym', v_g::text, jsonb_build_object('cause', 'unlocked'));
      perform private.notify_gym_owners(v_g, 'support_access_resumed',
        'GymOS Support access resumed', 'L''accès de GymOS Support a repris',
        'A GymOS Support person''s account was unlocked and their access to your gym is back.',
        'Le compte d''une personne de GymOS Support a été déverrouillé et son accès à votre salle est rétabli.');
    end if;
  end loop;
  return query select true, 'unlocked'::text, null::uuid;
end;
$$;
revoke all on function public.unlock_support_account(uuid, text) from public, anon;
grant execute on function public.unlock_support_account(uuid, text) to authenticated, service_role;
