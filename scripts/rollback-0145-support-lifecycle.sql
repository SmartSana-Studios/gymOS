-- Rollback for migration 0145 (support lifecycle: inactivity, recertification, factor reset, contact changes).
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0145-support-lifecycle.sql
-- Data effects: factor reset records (private.support_factor_resets), last-activity rows and the recertification / recorded e-mail
-- columns are DROPPED. An account that is reset-pending when this runs stays reset-pending (reset_pending_at is untouched) and, with the
-- executor gone, has no way back in: finish or cancel each pending reset first (the person's cancel link, or deactivate the account).
-- Accounts locked by the sweep or the drift check stay locked (unlock them first if they should be usable). Audit rows, staff_notices and
-- email_outbox rows written by 0145 stay. The replaced functions go back to their 0138 / 0139 / 0143 / 0144 bodies.
-- Run only with the dashboard and the Super Admin app rolled back first (they call the functions dropped here).

select cron.unschedule('support_inactivity_sweep');
select cron.unschedule('support_contact_drift_check');
select cron.unschedule('support_factor_reset_due');
drop function if exists private.support_inactivity_sweep();
drop function if exists private.support_contact_drift_check();
drop function if exists private.support_factor_reset_mark_due();

drop function if exists public.get_support_lifecycle();
drop function if exists public.change_support_contact(uuid, text, text, text);
drop function if exists public.recertify_support_account(uuid, text);
drop function if exists public.start_support_factor_reset(uuid, text, text, text);
drop function if exists public.cancel_support_factor_reset(text);
drop function if exists public.claim_support_factor_resets(integer);
drop function if exists public.issue_support_reset_invite(uuid, text);
drop function if exists public.support_factor_reset_done(uuid, integer);
drop function if exists public.support_factor_reset_failed(uuid, text);
drop function if exists public.record_support_factor_reset_run(integer, integer, timestamptz);

-- the functions below call private.support_reset_executed / support_restore_assignments / support_touch_activity, so they are put back first
-- ===== private.support_live (0135) =====
create or replace function private.support_live(p_user uuid, p_gym uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_sid uuid;
begin
  if p_user is null or p_gym is null or auth.uid() is null or p_user <> auth.uid() then
    return false;
  end if;
  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    return false;
  end if;
  if not private.jwt_session_alive() then
    return false;
  end if;
  v_sid := nullif(auth.jwt() ->> 'session_id', '')::uuid;

  return exists (
    select 1
      from public.support_assignments a
      join public.gyms g on g.id = a.gym_id
      join private.support_accounts sa on sa.user_id = a.support_user_id
      join private.support_session_state st on st.session_id = v_sid and st.user_id = a.support_user_id
     where a.support_user_id = p_user
       and a.gym_id = p_gym
       and a.state = 'active'
       and g.allow_gymos_support
       and g.status = 'active'
       and sa.activated_at is not null
       and sa.locked_at is null
       and sa.reset_pending_at is null
       and st.started_at > now() - make_interval(mins => private.session_limit('absolute_session_minutes'))
       and st.last_seen_at > now() - make_interval(mins => private.session_limit('idle_minutes'))
  );
exception when others then
  return false;
end;
$$;
revoke all on function private.support_live(uuid, uuid) from public, anon, authenticated;
grant execute on function private.support_live(uuid, uuid) to service_role;

-- ===== private.support_revoke_access (0144) =====
create or replace function private.support_revoke_access(p_gym uuid, p_user uuid, p_cause text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_new   integer := 0;
  v_staff integer := 0;
  v_pay   integer := 0;
  v_sub   integer := 0;
  v_en    text;
  v_fr    text;
  v_other boolean := false;
  v_en1   text;
  v_fr1   text;
begin
  if p_gym is null then
    return;
  end if;

  -- support-created staff go to the Owner review queue (already cleared rows stay cleared)
  insert into public.support_staff_review (member_id, gym_id)
  select m.id, m.gym_id from members m
   where m.gym_id = p_gym and m.created_by_support and m.deactivated_at is null
  on conflict (member_id) do nothing;
  get diagnostics v_new = row_count;

  select count(*)::int into v_staff
    from public.support_staff_review r join members m on m.id = r.member_id
   where r.gym_id = p_gym and r.cleared_at is null and m.deactivated_at is null;

  -- payments support started that are still unfinished. Rows written by support already carry the gym proxy as actor (23-7), so
  -- there is nothing to re-own; they are counted and flagged to the Owner.
  select count(*) filter (where p.purpose is distinct from 'subscription')::int,
         count(*) filter (where p.purpose = 'subscription')::int
    into v_pay, v_sub
    from payments p
   where p.gym_id = p_gym and p.status in ('pending', 'processing')
     and exists (select 1 from support_action_identity i
                  where i.subject_table = 'payments' and i.subject_id = p.id and i.gym_id = p_gym
                    and (p_user is null or i.real_user_id = p_user));

  -- gym-scoped so the Owner sees it; the actor is the system, the metadata names no individual
  insert into audit_log (gym_id, actor_id, actor_display_name, action_type, target_entity_type, target_entity_id, metadata)
  values (p_gym, null, 'system:support_revocation', 'gymos_support_access_ended', 'gym', p_gym::text,
          jsonb_build_object('cause', p_cause, 'pending_payments', v_pay, 'pending_subscription_payments', v_sub,
                             'staff_in_review', v_staff, 'staff_newly_queued', v_new));

  -- another support person may still be assigned, and a lock is reversible: say so instead of claiming access has ended
  v_other := p_user is not null and exists (select 1 from public.support_assignments a
                where a.gym_id = p_gym and a.state = 'active' and a.support_user_id <> p_user);
  if p_cause = 'locked' or v_other then
    v_en1 := 'A GymOS Support person''s access to your gym was paused or ended. GymOS Support may still have access through another person, or resume if the pause is lifted.';
    v_fr1 := 'L''accès d''une personne de GymOS Support à votre salle a été suspendu ou a pris fin. GymOS Support peut encore y avoir accès par une autre personne, ou le retrouver si la suspension est levée.';
  else
    v_en1 := 'GymOS Support access to your gym has ended.';
    v_fr1 := 'L''accès de GymOS Support à votre salle a pris fin.';
  end if;
  if p_cause is distinct from 'gym_suspended' and (v_pay + v_sub > 0 or v_new > 0 or v_staff > 0) then
    v_en := v_en1
         || case when v_pay > 0 then ' ' || v_pay || ' payment(s) started by GymOS Support are still pending.' else '' end
         || case when v_sub > 0 then ' ' || v_sub || ' subscription payment(s) started by GymOS Support are still pending.' else '' end
         || case when v_staff > 0 then ' ' || v_staff || ' staff account(s) created by GymOS Support are waiting for your review in Staff; none was deactivated.' else '' end;
    v_fr := v_fr1
         || case when v_pay > 0 then ' ' || v_pay || ' paiement(s) lancé(s) par GymOS Support sont toujours en attente.' else '' end
         || case when v_sub > 0 then ' ' || v_sub || ' paiement(s) d''abonnement lancé(s) par GymOS Support sont toujours en attente.' else '' end
         || case when v_staff > 0 then ' ' || v_staff || ' compte(s) du personnel créé(s) par GymOS Support attendent votre examen dans Personnel ; aucun n''a été désactivé.' else '' end;
    perform private.notify_gym_owners(p_gym, 'support_access_ended',
      'GymOS Support access ended', 'L''accès de GymOS Support a pris fin', v_en, v_fr);
  end if;
end;
$$;
revoke all on function private.support_revoke_access(uuid, uuid, text) from public, anon, authenticated;
grant execute on function private.support_revoke_access(uuid, uuid, text) to service_role;

-- ===== private.support_lock_account (0144) =====
create or replace function private.support_lock_account(p_user uuid, p_reason text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_n    integer;
  v_gym  record;
  v_what text;
begin
  -- gym locks first, in gym order, then the account row: the same order as deactivate and unlock, so they cannot deadlock
  for v_gym in
    select distinct a.gym_id from public.support_assignments a where a.support_user_id = p_user and a.state <> 'ended' order by a.gym_id
  loop
    perform private.support_gym_lock(v_gym.gym_id);
  end loop;

  update private.support_accounts set locked_at = now(), locked_reason = left(coalesce(p_reason, 'unknown'), 60)
   where user_id = p_user and locked_at is null;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return false;
  end if;

  perform private.end_user_sessions(p_user);

  insert into audit_log (gym_id, actor_id, actor_display_name, action_type, target_entity_type, target_entity_id, metadata)
  values (null, null, 'system:support_lock', 'support_account_locked', 'user', p_user::text,
          jsonb_build_object('reason', p_reason));

  for v_gym in
    select distinct a.gym_id from public.support_assignments a where a.support_user_id = p_user and a.state <> 'ended' order by a.gym_id
  loop
    perform private.support_gym_lock(v_gym.gym_id);   -- re-entrant
    perform private.support_revoke_access(v_gym.gym_id, p_user, 'locked');
  end loop;

  v_what := case p_reason
    when 'velocity_gym' then 'too many actions in one gym within an hour'
    when 'velocity_account' then 'too many actions across gyms within an hour'
    when 'velocity_payment' then 'too many payment-connection changes in one gym within a day'
    when 'stepup_failures' then 'too many wrong step-up codes'
    else 'a safety limit' end;
  perform private.notify_super_admins('support_account_locked',
    'A GymOS Support account was locked',
    'Un compte GymOS Support a été verrouillé',
    'A support account was locked automatically (' || v_what || '). Review it under GymOS support and unlock it with a recorded reason if appropriate.',
    'Un compte de support a été verrouillé automatiquement (' ||
      case p_reason
        when 'velocity_gym' then 'trop d''actions dans une salle en une heure'
        when 'velocity_account' then 'trop d''actions entre salles en une heure'
        when 'velocity_payment' then 'trop de changements de connexion de paiement dans une salle en un jour'
        when 'stepup_failures' then 'trop de codes de confirmation erronés'
        else 'une limite de sécurité' end ||
      '). Examinez-le dans GymOS support et déverrouillez-le avec un motif consigné si nécessaire.');
  return true;
end;
$$;
revoke all on function private.support_lock_account(uuid, text) from public, anon, authenticated;
grant execute on function private.support_lock_account(uuid, text) to service_role;

-- ===== public.unlock_support_account (0144) =====
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

  update private.support_accounts
     set locked_at = null, locked_reason = null, velocity_reset_at = now()
   where user_id = p_user_id;
  update private.super_admin_lockout set failed_count = 0, locked_at = null where user_id = p_user_id;
  perform private.support_admin_audit('support_account_unlocked', p_user_id,
    jsonb_build_object('reason', v_reason, 'previous_lock_reason', v_acct.locked_reason, 'locked_at', v_acct.locked_at));
  return query select true, 'unlocked'::text, null::uuid;
end;
$$;
revoke all on function public.unlock_support_account(uuid, text) from public, anon;
grant execute on function public.unlock_support_account(uuid, text) to authenticated, service_role;

-- ===== private.session_gate_touch (0144) =====
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
  v_breach  text;
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

  -- Story 23.10: velocity. A breach locks the account and is RETURNED (never raised), so the lock and the ended sessions commit.
  if v_support then
    v_breach := private.support_velocity_breach(p_user);
    if v_breach is not null then
      perform private.support_lock_account(p_user, v_breach);
      return query select false, 'locked'::text;
      return;
    end if;
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
revoke all on function private.session_gate_touch(uuid, uuid) from public, anon, authenticated;

-- ===== public.issue_support_invite (0139) =====
create or replace function public.issue_support_invite(p_user_id uuid, p_token text, p_actor uuid)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_expires timestamptz;
  v_name    text;
begin
  if p_user_id is null or p_actor is null
     or not coalesce((select u.is_super_admin from public.users u where u.id = p_actor), false) then
    raise exception 'permission denied';
  end if;
  if p_token is null or p_token !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[0-9a-f]{64}$' then
    raise exception 'support_invite_refused';
  end if;

  -- lock the account row so two invites for one account serialise
  perform 1 from private.support_accounts sa where sa.user_id = p_user_id for update;
  if not found or exists (select 1 from private.support_accounts sa
                           where sa.user_id = p_user_id and (sa.activated_at is not null or sa.deactivated_at is not null)) then
    raise exception 'support_invite_refused';
  end if;

  update private.support_invites set superseded_at = now()
   where user_id = p_user_id and consumed_at is null and superseded_at is null;

  v_expires := now() + make_interval(hours => private.session_limit('support_invite_ttl_hours'));
  insert into private.support_invites (id, user_id, token_hash, created_by, expires_at)
  values (split_part(p_token, '.', 1)::uuid, p_user_id, encode(extensions.digest(p_token, 'sha256'), 'hex'), p_actor, v_expires);

  select coalesce(nullif(u.display_name, ''), 'Super Admin') into v_name from public.users u where u.id = p_actor;
  perform private.support_audit(p_actor, v_name, 'support_invite_issued', p_user_id,
    jsonb_build_object('expires_at', v_expires));
  return v_expires;
end;
$$;
revoke all on function public.issue_support_invite(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.issue_support_invite(uuid, text, uuid) to service_role;

-- ===== public.support_invite_inspect (0138) =====
create or replace function public.support_invite_inspect(p_token text)
returns table (ok boolean, step text, user_id uuid, email text)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v record;
begin
  select * into v from private.support_invite_check(p_token);
  if not found then
    return query select false, null::text, null::uuid, null::text;
    return;
  end if;
  if exists (select 1 from private.support_accounts sa where sa.user_id = v.user_id and sa.activated_at is not null) then
    return query select false, null::text, null::uuid, null::text;
    return;
  end if;
  return query
    select true,
           case when v.password_set then 'totp' else 'password' end,
           v.user_id,
           (select lower(au.email)::text from auth.users au where au.id = v.user_id);
end;
$$;
revoke all on function public.support_invite_inspect(text) from public, anon, authenticated;
grant execute on function public.support_invite_inspect(text) to service_role;

-- ===== public.activate_support_account (0138) =====
create or replace function public.activate_support_account(p_token text)
returns table (ok boolean, reason text)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v record;
  v_email text;
  v_reason text;
begin
  select * into v from private.support_invite_check(p_token);
  if not found then
    return query select false, 'invalid'::text;
    return;
  end if;

  select lower(au.email) into v_email from auth.users au where au.id = v.user_id;

  if exists (select 1 from private.support_accounts sa where sa.user_id = v.user_id and sa.activated_at is not null) then
    v_reason := 'already_active';
  elsif not v.password_set then
    v_reason := 'password_not_set';
  elsif private.support_email_collision(v_email, v.user_id) then
    v_reason := 'collision';
  elsif not exists (select 1 from auth.mfa_factors f
                     where f.user_id = v.user_id and f.factor_type = 'totp' and f.status = 'verified') then
    v_reason := 'no_verified_factor';
  end if;

  if v_reason is not null then
    perform private.support_audit(v.user_id, 'support:invite', 'support_activation_refused', v.user_id,
      jsonb_build_object('reason', v_reason));
    return query select false, v_reason;
    return;
  end if;

  update private.support_accounts set activated_at = now() where user_id = v.user_id and activated_at is null;
  update private.support_invites set consumed_at = now() where id = v.invite_id;
  -- the aal1 session used to enrol the factor must not survive: later sign-ins are email + password, then TOTP
  perform private.end_user_sessions(v.user_id);
  perform private.support_audit(v.user_id, 'support:invite', 'support_account_activated', v.user_id, '{}'::jsonb);
  return query select true, 'ok'::text;
end;
$$;
revoke all on function public.activate_support_account(text) from public, anon, authenticated;
grant execute on function public.activate_support_account(text) to service_role;

-- ===== public.set_allow_gymos_support (0144) =====
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
  v_suspended integer := 0;
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
      v_suspended := v_suspended + 1;
    end loop;
    if v_suspended > 0 then
      perform private.support_revoke_access(p_gym_id, null, 'switch_off');
    end if;
  else
    for v_a in
      select id from support_assignments
       where gym_id = p_gym_id and state = 'suspended' and suspended_by_switch
         -- Story 23.10: a person whose account is not activated, is locked, has a reset pending or was deactivated, or who gained another
         -- membership here while the switch was off, is skipped (stays suspended) instead of being restored or aborting the toggle.
         and exists (select 1 from private.support_accounts sa where sa.user_id = support_assignments.support_user_id
                      and sa.activated_at is not null and sa.locked_at is null and sa.reset_pending_at is null and sa.deactivated_at is null)
         and not exists (select 1 from members m where m.user_id = support_assignments.support_user_id and m.gym_id = p_gym_id
                          and m.role <> 'support' and m.deactivated_at is null)
       order by id for update
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
revoke all on function public.set_allow_gymos_support(uuid, boolean) from public, anon;

-- ===== private.stepup_issue (0143) =====
create or replace function private.stepup_issue(p_user uuid, p_action text, p_subject text)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_expires timestamptz;
begin
  if p_user is null or p_subject is null or p_action is null then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if p_action not in ('remove_super_admin_factor', 'create_super_admin', 'change_recovery_email', 'remove_recovery_email', 'support_refund', 'support_waive_registration_fee', 'support_create_staff', 'support_payment_connection') then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if p_action like 'support\_%' then
    if not exists (select 1 from private.support_accounts sa
                    where sa.user_id = p_user and sa.activated_at is not null and sa.locked_at is null
                      and sa.reset_pending_at is null and sa.deactivated_at is null) then
      raise exception 'permission_denied' using errcode = '42501';
    end if;
  else
    if not coalesce((select u.is_super_admin from users u where u.id = p_user), false) then
      raise exception 'permission_denied' using errcode = '42501';
    end if;
    if not private.super_admin_aal2_required() or private.super_admin_locked(p_user) then
      return null;
    end if;
  end if;

  delete from private.support_stepup
   where user_id = p_user and (consumed_at is not null or expires_at <= now());
  delete from private.support_stepup
   where user_id = p_user and action = p_action and subject_id = p_subject and consumed_at is null;
  v_expires := now() + make_interval(mins => private.session_limit('stepup_ttl_minutes'));
  insert into private.support_stepup (user_id, action, subject_id, expires_at)
  values (p_user, p_action, p_subject, v_expires);

  update private.super_admin_lockout set failed_count = 0 where user_id = p_user and locked_at is null;
  return v_expires;
end;
$$;
revoke all on function private.stepup_issue(uuid, text, text) from public, anon, authenticated;
grant execute on function private.stepup_issue(uuid, text, text) to service_role;

drop function if exists private.support_reset_executed(uuid);
drop function if exists private.support_restore_assignments(uuid);
drop function if exists private.support_touch_activity(uuid);
drop function if exists private.support_contact_drifted(uuid);

drop trigger if exists support_accounts_defaults on private.support_accounts;
drop function if exists private.support_accounts_defaults();
drop table if exists private.support_factor_resets;
drop table if exists private.support_last_active;
alter table private.support_accounts drop column if exists recertify_due_at, drop column if exists recertified_at, drop column if exists recorded_email;

delete from private.session_limits_config
 where key in ('support_inactivity_days', 'support_factor_reset_cooling_off_minutes', 'support_recertification_days');
