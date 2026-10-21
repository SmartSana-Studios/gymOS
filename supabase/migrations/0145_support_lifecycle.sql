-- Story 23.11: lifecycle of a support account: inactivity, recertification and factor reset (FR-185, FR-190; AD-38, AD-41).
--
--   * support_inactivity_sweep (daily cron, job_runs)   a support account with no activity for support_inactivity_days is DISABLED through
--       private.support_lock_account (locked_reason 'inactivity'; sessions ended, Owner revocation notice, Super Admin alerted, reversible by
--       unlock_support_account with a reason). Only assignments that are active in an ACTIVE gym count: an idle gym (suspended, or its switch
--       off) does not disable its support. Activity = the last gate touch (private.support_last_active), a recertification, an unlock, an
--       activation, or the newest active assignment, whichever is latest.
--   * Recertification: private.support_accounts.recertify_due_at (activation + support_recertification_days, moved by each recertification).
--       private.support_live denies after the due date; recertify_support_account (Super Admin, aal2, reason) moves it; both audited.
--   * Factor reset: start_support_factor_reset (Super Admin aal2, mandatory identity-check note, step-up in the app) ends the person's sessions,
--       sets reset_pending_at, starts a cooling-off (support_factor_reset_cooling_off_minutes), freezes contact changes, e-mails the person
--       (the e-mail on file; support accounts have no phone) a single-use hashed cancel token. cancel_support_factor_reset abandons it inside
--       the window (sessions stay revoked, Super Admin alerted). A cron (support_factor_reset_due) marks resets whose cooling-off ended; the
--       executor route (Super Admin app) claims them, removes the old factor through the Admin API, issues a single-use invite
--       (issue_support_reset_invite) and reports back. reset_pending_at stays set until the NEW factor is verified (activate_support_account):
--       it closes the first-factor window. Nothing here writes auth.mfa_factors.
--   * change_support_contact: the only sanctioned path for a support person's e-mail (phone is not allowed: support accounts keep none).
--       Super Admin, aal2, reason, refused during a reset, audited. A nightly check (support_contact_drift_check, job_runs) locks an account
--       whose auth e-mail differs from the recorded one or that gained a phone: the freeze detects within a day, it does not prevent.
--   * private.support_restore_assignments: restores switch-suspended assignments of a person once nothing blocks them (23-10 deferral);
--       unlock, recertification and a completed reset call it.
--
-- Limits live in private.session_limits_config (all [ASSUMPTION], confirmed or changed in 23.0).
-- Rollback: scripts/rollback-0145-support-lifecycle.sql.
set local lock_timeout = '5s';

-- ===== 1. limits =====
insert into private.session_limits_config (key, value, note) values
  ('support_inactivity_days',                       30, '[ASSUMPTION] days without activity before a support account is disabled by the inactivity sweep'),
  ('support_factor_reset_cooling_off_minutes',      30, '[ASSUMPTION] minutes between a factor reset request and its execution; the person can cancel meanwhile'),
  ('support_recertification_days',                  90, '[ASSUMPTION] days between recertifications of a support person by a Super Admin')
on conflict (key) do nothing;

-- ===== 2. account facts =====
alter table private.support_accounts
  add column recertify_due_at timestamptz,
  add column recertified_at   timestamptz,
  add column recorded_email   text;

-- the last time the person used the gate (kept apart from support_accounts so the hot path is not a support_accounts writer)
create table private.support_last_active (
  user_id        uuid primary key references public.users(id) on delete cascade,
  last_active_at timestamptz not null
);
alter table private.support_last_active enable row level security;
revoke all on private.support_last_active from public, anon, authenticated;

-- A new account records its e-mail on file; an activated account always has a due date (so the live gate can require one).
create or replace function private.support_accounts_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and new.recorded_email is null then
    select lower(au.email) into new.recorded_email from auth.users au where au.id = new.user_id;
  end if;
  if new.activated_at is not null and new.recertify_due_at is null then
    new.recertify_due_at := now() + make_interval(days => private.session_limit('support_recertification_days'));
  end if;
  return new;
end;
$$;
revoke all on function private.support_accounts_defaults() from public, anon, authenticated;

create trigger support_accounts_defaults
  before insert or update on private.support_accounts
  for each row execute function private.support_accounts_defaults();

-- existing rows: a clean slate (nothing is live in production before 23.11)
update private.support_accounts sa set recorded_email = lower(au.email) from auth.users au where au.id = sa.user_id and sa.recorded_email is null;
update private.support_accounts set recertify_due_at = now() + make_interval(days => private.session_limit('support_recertification_days'))
 where activated_at is not null and recertify_due_at is null;

-- ===== 3. factor reset records =====
create table private.support_factor_resets (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users(id) on delete cascade,
  started_by        uuid references public.users(id) on delete set null,
  started_at        timestamptz not null default clock_timestamp(),
  executes_at       timestamptz not null,
  cancel_token_hash text not null,
  outbox_id         uuid references public.email_outbox(id) on delete set null,
  identity_note     text not null,
  state             text not null default 'cooling_off' check (state in ('cooling_off', 'due', 'executing', 'executed', 'cancelled')),
  due_at            timestamptz,
  claimed_at        timestamptz,
  executed_at       timestamptz,
  cancelled_at      timestamptz,
  completed_at      timestamptz,
  attempts          integer not null default 0,
  last_error        text
);
-- one open reset per person (executed stays open until the person re-enrols; it is closed by completed_at)
create unique index support_factor_resets_one_open_idx on private.support_factor_resets (user_id)
  where state in ('cooling_off', 'due', 'executing', 'executed') and completed_at is null;
create unique index support_factor_resets_token_idx on private.support_factor_resets (cancel_token_hash);
alter table private.support_factor_resets enable row level security;
revoke all on private.support_factor_resets from public, anon, authenticated;

-- ===== 4. the live gate: recertification =====
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
       -- Story 23.11: a lapsed recertification denies; no due date at all is treated as lapsed (fails closed)
       and sa.recertify_due_at > now()
       and st.started_at > now() - make_interval(mins => private.session_limit('absolute_session_minutes'))
       and st.last_seen_at > now() - make_interval(mins => private.session_limit('idle_minutes'))
  );
exception when others then
  return false;
end;
$$;
revoke all on function private.support_live(uuid, uuid) from public, anon, authenticated;
grant execute on function private.support_live(uuid, uuid) to service_role;

-- ===== 5. helpers =====

-- Restores a person's switch-suspended assignments once nothing blocks them (gym active, switch on, account activated, unlocked, no reset
-- pending, recertified, not deactivated, no other membership in the gym). Caller holds the gym locks (this takes them, in gym order,
-- re-entrantly). Returns how many were restored.
create or replace function private.support_restore_assignments(p_user uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_a record;
  v_n integer := 0;
begin
  for v_a in
    select a.gym_id from public.support_assignments a
     where a.support_user_id = p_user and a.state = 'suspended' and a.suspended_by_switch order by a.gym_id
  loop
    perform private.support_gym_lock(v_a.gym_id);
  end loop;

  for v_a in
    select a.id from public.support_assignments a
      join public.gyms g on g.id = a.gym_id
     where a.support_user_id = p_user and a.state = 'suspended' and a.suspended_by_switch
       and g.status = 'active' and g.allow_gymos_support
       and exists (select 1 from private.support_accounts sa where sa.user_id = a.support_user_id
                    and sa.activated_at is not null and sa.locked_at is null and sa.reset_pending_at is null
                    and sa.deactivated_at is null and sa.recertify_due_at > now())
       and not exists (select 1 from members m where m.user_id = a.support_user_id and m.gym_id = a.gym_id
                        and m.role <> 'support' and m.deactivated_at is null)
     order by a.id for update
  loop
    update support_assignments set state = 'active', suspended_by_switch = false where id = v_a.id;
    perform private.support_set_membership(v_a.id, true);
    v_n := v_n + 1;
  end loop;
  -- access is back: the idle clock starts now, so a gym that was off or suspended for a long time does not get its support locked at once
  if v_n > 0 then
    perform private.support_touch_activity(p_user);
  end if;
  return v_n;
end;
$$;
revoke all on function private.support_restore_assignments(uuid) from public, anon, authenticated;
grant execute on function private.support_restore_assignments(uuid) to service_role;

-- restart the idle clock (recertification, unlock, completed reset, activation)
create or replace function private.support_touch_activity(p_user uuid)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  insert into private.support_last_active (user_id, last_active_at) values (p_user, now())
  on conflict (user_id) do update set last_active_at = now();
$$;
revoke all on function private.support_touch_activity(uuid) from public, anon, authenticated;

-- The drift facts of one account: auth e-mail different from the recorded one, or a phone on the auth user.
create or replace function private.support_contact_drifted(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from private.support_accounts sa join auth.users au on au.id = sa.user_id
     where sa.user_id = p_user and sa.recorded_email is not null
       and (lower(coalesce(au.email, '')) <> sa.recorded_email or coalesce(au.phone, '') <> ''));
$$;
revoke all on function private.support_contact_drifted(uuid) from public, anon, authenticated;
grant execute on function private.support_contact_drifted(uuid) to service_role;

-- ===== 6. stepup allow-list: the factor reset is a step-up action =====
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
  if p_action not in ('remove_super_admin_factor', 'create_super_admin', 'change_recovery_email', 'remove_recovery_email', 'support_refund', 'support_waive_registration_fee', 'support_create_staff', 'support_payment_connection', 'start_support_factor_reset') then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if p_action like 'support\_%' then
    -- Story 23.6: a support grant goes to an activated, unlocked, non-deactivated support account, whatever the Super Admin flag says.
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

-- ===== 7. the revocation routine: a reset reads like a pause =====
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

  -- another support person may still be assigned, and a lock or a reset is reversible: say so instead of claiming access has ended
  v_other := p_user is not null and exists (select 1 from public.support_assignments a
                where a.gym_id = p_gym and a.state = 'active' and a.support_user_id <> p_user);
  if p_cause in ('locked', 'reset') or v_other then
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

-- ===== 8. lock: two new reasons =====
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
    when 'inactivity' then 'no activity for too long'
    when 'contact_drift' then 'its e-mail or phone changed outside the Super Admin change'
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
        when 'inactivity' then 'aucune activité depuis trop longtemps'
        when 'contact_drift' then 'son e-mail ou son téléphone a changé hors de la modification par un Super Admin'
        else 'une limite de sécurité' end ||
      '). Examinez-le dans GymOS support et déverrouillez-le avec un motif consigné si nécessaire.');
  return true;
end;
$$;
revoke all on function private.support_lock_account(uuid, text) from public, anon, authenticated;
grant execute on function private.support_lock_account(uuid, text) to service_role;

-- ===== 9. unlock: restores suspended assignments, restarts the idle clock, refuses while contact drift persists =====
-- Codes: reason_invalid | not_found | deactivated | not_locked | contact_drift | unlocked.
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
  -- Story 23.11: a lock caused by a contact change outside the Super Admin path is not lifted while the drift is still there
  -- (record the right address with change_support_contact first).
  if private.support_contact_drifted(p_user_id) then
    perform private.support_admin_audit('support_unlock_refused', p_user_id, jsonb_build_object('code', 'contact_drift', 'reason', v_reason));
    return query select false, 'contact_drift'::text, null::uuid;
    return;
  end if;

  update private.support_accounts
     set locked_at = null, locked_reason = null, velocity_reset_at = now()
   where user_id = p_user_id;
  update private.super_admin_lockout set failed_count = 0, locked_at = null where user_id = p_user_id;
  perform private.support_touch_activity(p_user_id);
  perform private.support_admin_audit('support_account_unlocked', p_user_id,
    jsonb_build_object('reason', v_reason, 'previous_lock_reason', v_acct.locked_reason, 'locked_at', v_acct.locked_at,
                       'assignments_restored', private.support_restore_assignments(p_user_id)));
  return query select true, 'unlocked'::text, null::uuid;
end;
$$;
revoke all on function public.unlock_support_account(uuid, text) from public, anon;
grant execute on function public.unlock_support_account(uuid, text) to authenticated, service_role;

-- ===== 10. gate touch: records activity =====
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

  -- Story 23.11: activity for the inactivity sweep (at most one write every 5 minutes per person)
  if v_support then
    insert into private.support_last_active (user_id, last_active_at) values (p_user, now())
    on conflict (user_id) do update set last_active_at = now()
     where private.support_last_active.last_active_at < now() - interval '5 minutes';
  end if;
  return query select true, 'ok'::text;
end;
$function$
;
revoke all on function private.session_gate_touch(uuid, uuid) from public, anon, authenticated;

-- ===== 10b. switch on: restored access restarts the idle clock =====
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
      -- Story 23.11: restored access restarts the idle clock
      perform private.support_touch_activity((select a.support_user_id from support_assignments a where a.id = v_a.id));
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

-- ===== 11. inactivity sweep =====
create or replace function private.support_inactivity_sweep()
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_started timestamptz := clock_timestamp();
  v_days    integer := private.session_limit('support_inactivity_days');
  v_acct    record;
  v_locked  integer := 0;
  v_failed  integer := 0;
  v_error   text;
begin
  -- Only an account with an ACTIVE assignment in an ACTIVE gym can be idle: a suspended gym (or one whose switch is off, which
  -- suspends the assignment) does not disable its support. The clock starts at the latest of the last activity and the newest such assignment.
  for v_acct in
    select sa.user_id,
           greatest(coalesce(la.last_active_at, sa.activated_at), max(a.activated_at)) as last_seen
      from private.support_accounts sa
      join public.support_assignments a on a.support_user_id = sa.user_id and a.state = 'active'
      join public.gyms g on g.id = a.gym_id and g.status = 'active'
      left join private.support_last_active la on la.user_id = sa.user_id
     where sa.activated_at is not null and sa.deactivated_at is null and sa.locked_at is null and sa.reset_pending_at is null
     group by sa.user_id, la.last_active_at, sa.activated_at
     order by sa.user_id
  loop
    if v_acct.last_seen < now() - make_interval(days => v_days) then
      begin
        if private.support_lock_account(v_acct.user_id, 'inactivity') then
          v_locked := v_locked + 1;
        end if;
      exception when others then
        v_failed := v_failed + 1;
        v_error := left(sqlerrm, 200);
      end;
    end if;
  end loop;

  -- one notice to Super Admins for each account whose recertification fell due since the last run (it is denied until recertified)
  for v_acct in
    select sa.user_id from private.support_accounts sa
     where sa.activated_at is not null and sa.deactivated_at is null
       and sa.recertify_due_at <= now() and sa.recertify_due_at > now() - interval '1 day'
  loop
    begin
      perform private.notify_super_admins('support_recertification_due',
        'A GymOS Support recertification is due',
        'Une recertification GymOS Support est due',
        'A support person''s recertification date has passed. They have no access until you recertify them under GymOS support.',
        'La date de recertification d''une personne du support est passée. Elle n''a plus accès tant que vous ne l''avez pas recertifiée dans GymOS support.');
    exception when others then
      v_failed := v_failed + 1;
      v_error := left(sqlerrm, 200);
    end;
  end loop;

  insert into job_runs (job_name, started_at, finished_at, status, error)
  values ('support_inactivity_sweep', v_started, now(),
          case when v_failed > 0 then 'failure'::job_status else 'success'::job_status end,
          case when v_failed > 0 then v_failed || ' step(s) failed, ' || v_locked || ' account(s) disabled: ' || v_error end);
end;
$$;
revoke all on function private.support_inactivity_sweep() from public, anon, authenticated;
grant execute on function private.support_inactivity_sweep() to service_role;

-- 03:10 UTC daily; cron.schedule() upserts by name
select cron.schedule('support_inactivity_sweep', '10 3 * * *', $$ select private.support_inactivity_sweep(); $$);

-- ===== 12. contact drift check =====
create or replace function private.support_contact_drift_check()
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_started timestamptz := clock_timestamp();
  v_acct    record;
  v_locked  integer := 0;
  v_failed  integer := 0;
  v_error   text;
begin
  for v_acct in
    select sa.user_id from private.support_accounts sa
     where sa.deactivated_at is null and sa.locked_at is null and private.support_contact_drifted(sa.user_id)
     order by sa.user_id
  loop
    begin
      if private.support_lock_account(v_acct.user_id, 'contact_drift') then
        v_locked := v_locked + 1;
      end if;
    exception when others then
      v_failed := v_failed + 1;
      v_error := left(sqlerrm, 200);
    end;
  end loop;

  insert into job_runs (job_name, started_at, finished_at, status, error)
  values ('support_contact_drift_check', v_started, now(),
          case when v_failed > 0 then 'failure'::job_status else 'success'::job_status end,
          case when v_failed > 0 then v_failed || ' account(s) failed, ' || v_locked || ' locked: ' || v_error end);
end;
$$;
revoke all on function private.support_contact_drift_check() from public, anon, authenticated;
grant execute on function private.support_contact_drift_check() to service_role;

select cron.schedule('support_contact_drift_check', '20 3 * * *', $$ select private.support_contact_drift_check(); $$);

-- ===== 13. recertification =====
-- Codes: reason_invalid | not_found | deactivated | not_activated | recertified.
create or replace function public.recertify_support_account(p_user_id uuid, p_reason text)
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
  v_due    timestamptz;
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

  select sa.activated_at, sa.deactivated_at, sa.recertify_due_at into v_acct
    from private.support_accounts sa where sa.user_id = p_user_id for update;
  if not found then
    return query select false, 'not_found'::text, null::uuid;
    return;
  end if;
  if v_acct.deactivated_at is not null then
    perform private.support_admin_audit('support_recertification_refused', p_user_id, jsonb_build_object('code', 'deactivated', 'reason', v_reason));
    return query select false, 'deactivated'::text, null::uuid;
    return;
  end if;
  if v_acct.activated_at is null then
    perform private.support_admin_audit('support_recertification_refused', p_user_id, jsonb_build_object('code', 'not_activated', 'reason', v_reason));
    return query select false, 'not_activated'::text, null::uuid;
    return;
  end if;

  v_due := now() + make_interval(days => private.session_limit('support_recertification_days'));
  update private.support_accounts set recertify_due_at = v_due, recertified_at = now() where user_id = p_user_id;
  perform private.support_touch_activity(p_user_id);
  perform private.support_admin_audit('support_account_recertified', p_user_id,
    jsonb_build_object('reason', v_reason, 'previous_due_at', v_acct.recertify_due_at, 'new_due_at', v_due,
                       'assignments_restored', private.support_restore_assignments(p_user_id)));
  return query select true, 'recertified'::text, null::uuid;
end;
$$;
revoke all on function public.recertify_support_account(uuid, text) from public, anon;
grant execute on function public.recertify_support_account(uuid, text) to authenticated, service_role;

-- ===== 14. factor reset: start (Super Admin) =====
-- p_cancel_token is a random token (at least 32 characters) made by the app; p_cancel_link is the link that carries it. Only the hash of the
-- token is stored; the link goes to the person in one e-mail (email_outbox, delivered by the Super Admin app) and nowhere else.
-- Codes: reason_invalid | invalid_request | not_found | deactivated | not_activated | already_pending | started.
create or replace function public.start_support_factor_reset(p_user_id uuid, p_identity_note text, p_cancel_token text, p_cancel_link text)
returns table (ok boolean, code text, reset_id uuid, executes_at timestamptz)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_note   text := btrim(coalesce(p_identity_note, ''));
  v_acct   record;
  v_gym    record;
  v_when   timestamptz;
  v_id     uuid;
  v_email  text;
  v_outbox uuid;
  v_mins   integer := private.session_limit('support_factor_reset_cooling_off_minutes');
begin
  perform private.support_admin_required();
  if not private.support_reason_ok(v_note) then
    return query select false, 'reason_invalid'::text, null::uuid, null::timestamptz;
    return;
  end if;
  if p_user_id is null or p_cancel_token is null or length(p_cancel_token) < 32 or p_cancel_link is null
     or position(p_cancel_token in p_cancel_link) = 0 or p_cancel_link !~ '^https?://' then
    return query select false, 'invalid_request'::text, null::uuid, null::timestamptz;
    return;
  end if;

  for v_gym in
    select distinct a.gym_id from public.support_assignments a where a.support_user_id = p_user_id and a.state <> 'ended' order by a.gym_id
  loop
    perform private.support_gym_lock(v_gym.gym_id);
  end loop;

  select sa.activated_at, sa.deactivated_at, sa.reset_pending_at into v_acct
    from private.support_accounts sa where sa.user_id = p_user_id for update;
  if not found then
    return query select false, 'not_found'::text, null::uuid, null::timestamptz;
    return;
  end if;
  if v_acct.deactivated_at is not null or v_acct.activated_at is null or v_acct.reset_pending_at is not null then
    perform private.support_admin_audit('support_factor_reset_refused', p_user_id,
      jsonb_build_object('code', case when v_acct.deactivated_at is not null then 'deactivated'
                                      when v_acct.activated_at is null then 'not_activated' else 'already_pending' end,
                         'identity_check', v_note));
    return query select false,
      (case when v_acct.deactivated_at is not null then 'deactivated'
            when v_acct.activated_at is null then 'not_activated' else 'already_pending' end)::text,
      null::uuid, null::timestamptz;
    return;
  end if;

  select lower(au.email) into v_email from auth.users au where au.id = p_user_id;
  if v_email is null then
    return query select false, 'not_found'::text, null::uuid, null::timestamptz;
    return;
  end if;

  v_when := now() + make_interval(mins => v_mins);
  insert into private.support_factor_resets (user_id, started_by, executes_at, cancel_token_hash, identity_note)
  values (p_user_id, auth.uid(), v_when, encode(extensions.digest(p_cancel_token, 'sha256'), 'hex'), v_note)
  returning id into v_id;

  -- access ends now: reset pending (denied by the live gate), sessions gone, every gym told through the one routine
  update private.support_accounts set reset_pending_at = now() where user_id = p_user_id;
  perform private.end_user_sessions(p_user_id);
  for v_gym in
    select distinct a.gym_id from public.support_assignments a where a.support_user_id = p_user_id and a.state <> 'ended' order by a.gym_id
  loop
    perform private.support_revoke_access(v_gym.gym_id, p_user_id, 'reset');
  end loop;

  -- the person is told by e-mail (the address on file); the link is the only secret
  insert into email_outbox (notice_id, recipient_email, subject, body)
  values (null, v_email,
    'GymOS support: authenticator reset requested / Réinitialisation de l''authentificateur demandée',
    'A GymOS Super Admin requested a reset of your authenticator. Your sessions have been ended. No earlier than ' || to_char(v_when at time zone 'UTC', 'YYYY-MM-DD HH24:MI') ||
      ' UTC your current authenticator will be removed and you will receive a single-use invitation to set a new one. Phone and e-mail changes are frozen until then.' ||
      E'\n\nIf you did not ask for this, cancel it now: ' || p_cancel_link ||
    E'\n\n---\n\n' ||
    'Un Super Admin GymOS a demandé la réinitialisation de votre authentificateur. Vos sessions ont été fermées. Pas avant ' || to_char(v_when at time zone 'UTC', 'YYYY-MM-DD HH24:MI') ||
      ' UTC, votre authentificateur actuel sera supprimé et vous recevrez une invitation à usage unique pour en configurer un nouveau. Les changements de téléphone et d''e-mail sont gelés d''ici là.' ||
      E'\n\nSi vous n''êtes pas à l''origine de cette demande, annulez-la maintenant : ' || p_cancel_link)
  returning id into v_outbox;
  update private.support_factor_resets set outbox_id = v_outbox where id = v_id;

  perform private.support_admin_audit('support_factor_reset_started', p_user_id,
    jsonb_build_object('reset_id', v_id, 'identity_check', v_note, 'executes_at', v_when));
  return query select true, 'started'::text, v_id, v_when;
end;
$$;
revoke all on function public.start_support_factor_reset(uuid, text, text, text) from public, anon;
grant execute on function public.start_support_factor_reset(uuid, text, text, text) to authenticated, service_role;

-- ===== 15. factor reset: cancel (the person, from the link; service role) =====
-- ok = true only for a known, unused token inside the cooling-off window. Every other case is the same plain false.
create or replace function public.cancel_support_factor_reset(p_token text)
returns table (ok boolean)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_r record;
begin
  if p_token is null or length(p_token) < 32 or length(p_token) > 200 then
    return query select false;
    return;
  end if;

  update private.support_factor_resets r
     set state = 'cancelled', cancelled_at = now()
   where r.cancel_token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
     and r.state = 'cooling_off' and r.executes_at > now()
  returning r.id, r.user_id into v_r;
  if not found then
    return query select false;
    return;
  end if;

  -- the reset is abandoned: the account is no longer pending. The sessions ended at the start stay ended.
  update private.support_accounts set reset_pending_at = null where user_id = v_r.user_id;
  perform private.support_audit(v_r.user_id, 'support:person', 'support_factor_reset_cancelled', v_r.user_id,
    jsonb_build_object('reset_id', v_r.id, 'by', 'email_link'));
  perform private.notify_super_admins('support_factor_reset_cancelled',
    'A support factor reset was cancelled',
    'Une réinitialisation d''authentificateur du support a été annulée',
    'The person cancelled a pending authenticator reset from the link in their e-mail. Their sessions stay ended. Check that the request was expected.',
    'La personne a annulé une réinitialisation d''authentificateur en attente depuis le lien de son e-mail. Ses sessions restent fermées. Vérifiez que la demande était attendue.');
  return query select true;
end;
$$;
revoke all on function public.cancel_support_factor_reset(text) from public, anon, authenticated;
grant execute on function public.cancel_support_factor_reset(text) to service_role;

-- ===== 16. factor reset: cron marks due, executor claims =====
create or replace function private.support_factor_reset_mark_due()
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_started timestamptz := clock_timestamp();
  v_n       integer := 0;
begin
  update private.support_factor_resets set state = 'due', due_at = now()
   where state = 'cooling_off' and executes_at <= now();
  get diagnostics v_n = row_count;
  insert into job_runs (job_name, started_at, finished_at, status)
  values ('support_factor_reset_due', v_started, now(), 'success');
end;
$$;
revoke all on function private.support_factor_reset_mark_due() from public, anon, authenticated;
grant execute on function private.support_factor_reset_mark_due() to service_role;

select cron.schedule('support_factor_reset_due', '*/5 * * * *', $$ select private.support_factor_reset_mark_due(); $$);

-- Claims due resets for the executor (service role). A claim older than 10 minutes is taken again. A reset whose account was deactivated
-- meanwhile is cancelled instead of executed.
create or replace function public.claim_support_factor_resets(p_limit integer default 10)
returns table (reset_id uuid, user_id uuid, email text)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  r record;
begin
  -- a reset whose account was deactivated (or is no longer pending) is cancelled, whatever its e-mail state
  update private.support_factor_resets f set state = 'cancelled', cancelled_at = now(), last_error = 'account_not_pending'
   where f.state in ('cooling_off', 'due', 'executing')
     and not exists (select 1 from private.support_accounts sa where sa.user_id = f.user_id and sa.deactivated_at is null and sa.reset_pending_at is not null);
  -- a reset whose cancel e-mail was still not delivered 24 hours after the cooling-off ended is abandoned (the person was never told):
  -- the account is no longer pending, the sessions stay ended, Super Admins are alerted to check the address and start again
  for r in
    select f.id, f.user_id from private.support_factor_resets f
     where f.state = 'due' and f.executes_at < now() - interval '24 hours'
       and not exists (select 1 from public.email_outbox o where o.id = f.outbox_id and o.status = 'sent')
     order by f.executes_at
     for update skip locked
  loop
    update private.support_factor_resets set state = 'cancelled', cancelled_at = now(), last_error = 'notice_undelivered' where id = r.id;
    update private.support_accounts sa set reset_pending_at = null where sa.user_id = r.user_id;
    perform private.support_audit(r.user_id, 'system:support_reset', 'support_factor_reset_abandoned', r.user_id,
      jsonb_build_object('reset_id', r.id, 'cause', 'notice_undelivered'));
    perform private.notify_super_admins('support_factor_reset_abandoned',
      'A support factor reset was abandoned',
      'Une réinitialisation d''authentificateur du support a été abandonnée',
      'The cancel e-mail of a pending authenticator reset was not delivered within 24 hours of the cooling-off, so the reset was cancelled and the person''s sessions stay ended. Check their address and start the reset again.',
      'L''e-mail d''annulation d''une réinitialisation d''authentificateur en attente n''a pas été remis dans les 24 heures suivant le délai de réflexion : la réinitialisation est annulée et les sessions de la personne restent fermées. Vérifiez son adresse et recommencez.');
  end loop;
  for r in
    select f.id, f.user_id from private.support_factor_resets f
     where (f.state = 'due' or (f.state = 'executing' and f.claimed_at < now() - interval '10 minutes'))
       -- the person must have been told first: the cancel e-mail has to be delivered before the factor can be removed
       and exists (select 1 from public.email_outbox o where o.id = f.outbox_id and o.status = 'sent')
       -- a locked or drifted account (its auth e-mail is no longer the one on file) is never executed: the invite would go to a stranger
       and not exists (select 1 from private.support_accounts sa where sa.user_id = f.user_id and sa.locked_at is not null)
       and not private.support_contact_drifted(f.user_id)
     order by f.executes_at
     limit greatest(coalesce(p_limit, 10), 1)
     for update skip locked
  loop
    if exists (select 1 from private.support_accounts sa where sa.user_id = r.user_id and sa.deactivated_at is null and sa.reset_pending_at is not null) then
      update private.support_factor_resets set state = 'executing', claimed_at = now(), attempts = attempts + 1 where id = r.id;
      -- the invite goes to the e-mail on file, never to whatever the auth user holds now
      return query select r.id, r.user_id, (select sa.recorded_email::text from private.support_accounts sa where sa.user_id = r.user_id);
    else
      update private.support_factor_resets set state = 'cancelled', cancelled_at = now(), last_error = 'account_not_pending' where id = r.id;
    end if;
  end loop;
end;
$$;
revoke all on function public.claim_support_factor_resets(integer) from public, anon, authenticated;
grant execute on function public.claim_support_factor_resets(integer) to service_role;

-- Issues the single-use invite of a claimed reset (the old factor is already removed). The actor of the invite is the Super Admin who
-- started the reset. Earlier invites are superseded, so a retry never leaves two live links.
create or replace function public.issue_support_reset_invite(p_reset_id uuid, p_token text)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_r       record;
  v_expires timestamptz;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[0-9a-f]{64}$' then
    raise exception 'support_invite_refused';
  end if;
  select f.user_id, f.started_by into v_r from private.support_factor_resets f where f.id = p_reset_id and f.state = 'executing' for update;
  if not found then
    raise exception 'support_invite_refused';
  end if;
  perform 1 from private.support_accounts sa
    where sa.user_id = v_r.user_id and sa.reset_pending_at is not null and sa.deactivated_at is null for update;
  if not found then
    raise exception 'support_invite_refused';
  end if;

  update private.support_invites set superseded_at = now()
   where user_id = v_r.user_id and consumed_at is null and superseded_at is null;
  v_expires := now() + make_interval(hours => private.session_limit('support_invite_ttl_hours'));
  insert into private.support_invites (id, user_id, token_hash, created_by, expires_at)
  values (split_part(p_token, '.', 1)::uuid, v_r.user_id, encode(extensions.digest(p_token, 'sha256'), 'hex'), v_r.started_by, v_expires);
  perform private.support_audit(v_r.started_by, 'system:support_reset', 'support_invite_issued', v_r.user_id,
    jsonb_build_object('expires_at', v_expires, 'reset_id', p_reset_id));
  return v_expires;
end;
$$;
revoke all on function public.issue_support_reset_invite(uuid, text) from public, anon, authenticated;
grant execute on function public.issue_support_reset_invite(uuid, text) to service_role;

-- The factor is gone and the invite is out: the reset is executed (the account stays reset-pending until the new factor is verified).
create or replace function public.support_factor_reset_done(p_reset_id uuid, p_factors_removed integer default 0)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  update private.support_factor_resets set state = 'executed', executed_at = now(), last_error = null
   where id = p_reset_id and state = 'executing'
  returning user_id into v_user;
  if v_user is null then
    return false;
  end if;
  perform private.support_audit(null, 'system:support_reset', 'support_factor_reset_executed', v_user,
    jsonb_build_object('reset_id', p_reset_id, 'factors_removed', coalesce(p_factors_removed, 0)));
  return true;
end;
$$;
revoke all on function public.support_factor_reset_done(uuid, integer) from public, anon, authenticated;
grant execute on function public.support_factor_reset_done(uuid, integer) to service_role;

-- A failed run goes back to 'due' and is claimed again by the next run. Code only: the error text may carry an address.
create or replace function public.support_factor_reset_failed(p_reset_id uuid, p_error text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  update private.support_factor_resets set state = 'due', claimed_at = null, last_error = left(coalesce(p_error, 'failed'), 100)
   where id = p_reset_id and state = 'executing';
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;
revoke all on function public.support_factor_reset_failed(uuid, text) from public, anon, authenticated;
grant execute on function public.support_factor_reset_failed(uuid, text) to service_role;

create or replace function public.record_support_factor_reset_run(p_done integer, p_failed integer, p_started_at timestamptz default now())
returns void
language sql
volatile
security definer
set search_path = public
as $$
  insert into job_runs (job_name, started_at, finished_at, status, error)
  values ('support_factor_reset_executor', coalesce(p_started_at, now()), now(),
          case when coalesce(p_failed, 0) > 0 then 'failure'::job_status else 'success'::job_status end,
          case when coalesce(p_failed, 0) > 0 then p_failed || ' reset(s) failed, ' || coalesce(p_done, 0) || ' executed' end);
$$;
revoke all on function public.record_support_factor_reset_run(integer, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.record_support_factor_reset_run(integer, integer, timestamptz) to service_role;

-- ===== 17. invites: reset-aware =====
-- An activated account may be invited (or inspected, or activated) only while a reset has been executed and is not yet completed.
create or replace function private.support_reset_executed(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from private.support_factor_resets f
                  where f.user_id = p_user and f.state = 'executed' and f.completed_at is null)
     and exists (select 1 from private.support_accounts sa where sa.user_id = p_user and sa.reset_pending_at is not null);
$$;
revoke all on function private.support_reset_executed(uuid) from public, anon, authenticated;
grant execute on function private.support_reset_executed(uuid) to service_role;

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
  if not found
     or exists (select 1 from private.support_accounts sa where sa.user_id = p_user_id and sa.deactivated_at is not null)
     -- Story 23.11: an activated account is re-invited only after its factor reset has been executed
     or (exists (select 1 from private.support_accounts sa where sa.user_id = p_user_id and sa.activated_at is not null)
         and not private.support_reset_executed(p_user_id)) then
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
  if exists (select 1 from private.support_accounts sa where sa.user_id = v.user_id and sa.activated_at is not null)
     and not private.support_reset_executed(v.user_id) then
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

-- The only writer of activated_at, and now the closer of a factor reset: with a reset executed, a verified NEW factor clears reset_pending_at.
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
  v_acct record;
  v_reset boolean;
  v_gym record;
begin
  select * into v from private.support_invite_check(p_token);
  if not found then
    return query select false, 'invalid'::text;
    return;
  end if;

  select lower(au.email) into v_email from auth.users au where au.id = v.user_id;
  v_reset := private.support_reset_executed(v.user_id);

  if exists (select 1 from private.support_accounts sa where sa.user_id = v.user_id and sa.activated_at is not null) and not v_reset then
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

  if v_reset then
    -- gym locks first (in gym order), then the account row, as every other writer
    for v_gym in
      select distinct a.gym_id from public.support_assignments a where a.support_user_id = v.user_id and a.state <> 'ended' order by a.gym_id
    loop
      perform private.support_gym_lock(v_gym.gym_id);
    end loop;
    update private.support_accounts set reset_pending_at = null where user_id = v.user_id;
    update private.support_factor_resets set completed_at = now()
     where user_id = v.user_id and state = 'executed' and completed_at is null;
    perform private.support_touch_activity(v.user_id);
    perform private.support_restore_assignments(v.user_id);
  else
    update private.support_accounts set activated_at = now() where user_id = v.user_id and activated_at is null;
    perform private.support_touch_activity(v.user_id);
  end if;
  update private.support_invites set consumed_at = now() where id = v.invite_id;
  -- the aal1 session used to enrol the factor must not survive: later sign-ins are email + password, then TOTP
  perform private.end_user_sessions(v.user_id);
  if v_reset then
    perform private.support_audit(v.user_id, 'support:invite', 'support_factor_reset_completed', v.user_id, '{}'::jsonb);
  else
    select sa.recertify_due_at into v_acct from private.support_accounts sa where sa.user_id = v.user_id;
    perform private.support_audit(v.user_id, 'support:invite', 'support_account_activated', v.user_id, '{}'::jsonb);
    perform private.support_audit(v.user_id, 'support:invite', 'support_recertification_due_set', v.user_id,
      jsonb_build_object('recertify_due_at', v_acct.recertify_due_at));
  end if;
  return query select true, 'ok'::text;
end;
$$;
revoke all on function public.activate_support_account(text) from public, anon, authenticated;
grant execute on function public.activate_support_account(text) to service_role;

-- ===== 18. contact changes =====
-- Super Admin at aal2, mandatory reason; refused during a reset; support accounts keep no phone. The app applies the new address to the
-- auth user after an ok (and calls this again with the previous address if that fails). Codes: reason_invalid | not_found | deactivated |
-- reset_in_progress | phone_not_allowed | email_invalid | collision | unchanged | changed.
create or replace function public.change_support_contact(p_user_id uuid, p_email text, p_phone text, p_reason text)
returns table (ok boolean, code text, previous_email text)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_email  text := lower(btrim(coalesce(p_email, '')));
  v_acct   record;
  v_code   text;
begin
  perform private.support_admin_required();
  if not private.support_reason_ok(v_reason) then
    return query select false, 'reason_invalid'::text, null::text;
    return;
  end if;
  if p_user_id is null then
    return query select false, 'not_found'::text, null::text;
    return;
  end if;

  select sa.deactivated_at, sa.reset_pending_at, sa.recorded_email into v_acct
    from private.support_accounts sa where sa.user_id = p_user_id for update;
  if not found then
    return query select false, 'not_found'::text, null::text;
    return;
  end if;

  v_code := case
    when v_acct.deactivated_at is not null then 'deactivated'
    when v_acct.reset_pending_at is not null
         or exists (select 1 from private.support_factor_resets f
                     where f.user_id = p_user_id and f.state in ('cooling_off', 'due', 'executing', 'executed') and f.completed_at is null) then 'reset_in_progress'
    when nullif(btrim(coalesce(p_phone, '')), '') is not null then 'phone_not_allowed'
    when v_email !~ '^[^@[:space:]]+@gymosapps\.com$' then 'email_invalid'
    when v_email = coalesce(v_acct.recorded_email, '') and not private.support_contact_drifted(p_user_id) then 'unchanged'
    when private.support_email_collision(v_email, p_user_id) then 'collision'
    else null
  end;
  if v_code is not null then
    perform private.support_admin_audit('support_contact_change_refused', p_user_id,
      jsonb_build_object('code', v_code, 'reason', v_reason));
    return query select false, v_code, v_acct.recorded_email;
    return;
  end if;

  update private.support_accounts set recorded_email = v_email where user_id = p_user_id;
  perform private.support_admin_audit('support_contact_changed', p_user_id,
    jsonb_build_object('field', 'email', 'previous', v_acct.recorded_email, 'new', v_email, 'reason', v_reason));
  return query select true, 'changed'::text, v_acct.recorded_email;
end;
$$;
revoke all on function public.change_support_contact(uuid, text, text, text) from public, anon;
grant execute on function public.change_support_contact(uuid, text, text, text) to authenticated, service_role;

-- ===== 19. Super Admin read: lifecycle state per account =====
create or replace function public.get_support_lifecycle()
returns table (
  user_id uuid, display_name text, email text, activated boolean, deactivated boolean,
  locked_at timestamptz, locked_reason text,
  recertify_due_at timestamptz, recertification_lapsed boolean,
  reset_pending_at timestamptz, reset_state text, reset_executes_at timestamptz,
  last_active_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform private.support_admin_required();
  return query
    select sa.user_id, u.display_name, au.email::text, (sa.activated_at is not null), (sa.deactivated_at is not null),
           sa.locked_at, sa.locked_reason,
           sa.recertify_due_at, (sa.activated_at is not null and coalesce(sa.recertify_due_at <= now(), true)),
           sa.reset_pending_at, rs.state, rs.executes_at,
           greatest(la.last_active_at, sa.activated_at)
      from private.support_accounts sa
      join public.users u on u.id = sa.user_id
      left join auth.users au on au.id = sa.user_id
      left join private.support_last_active la on la.user_id = sa.user_id
      left join lateral (
        select f.state, f.executes_at from private.support_factor_resets f
         where f.user_id = sa.user_id and f.completed_at is null and f.state <> 'cancelled'
         order by f.started_at desc limit 1
      ) rs on true
     order by u.display_name nulls last, au.email;
end;
$$;
revoke all on function public.get_support_lifecycle() from public, anon;
grant execute on function public.get_support_lifecycle() to authenticated, service_role;

do $verify$
begin
  if exists (select 1 from unnest(array[
       'public.recertify_support_account(uuid, text)', 'public.start_support_factor_reset(uuid, text, text, text)',
       'public.change_support_contact(uuid, text, text, text)', 'public.get_support_lifecycle()',
       'public.unlock_support_account(uuid, text)', 'public.cancel_support_factor_reset(text)',
       'public.claim_support_factor_resets(integer)', 'public.issue_support_reset_invite(uuid, text)',
       'public.support_factor_reset_done(uuid, integer)', 'public.support_factor_reset_failed(uuid, text)',
       'public.record_support_factor_reset_run(integer, integer, timestamptz)']) f
     where has_function_privilege('anon', f, 'execute') or has_function_privilege('public', f, 'execute')) then
    raise exception '0145: a support function is callable by anon or public';
  end if;
  if exists (select 1 from unnest(array[
       'public.cancel_support_factor_reset(text)', 'public.claim_support_factor_resets(integer)', 'public.issue_support_reset_invite(uuid, text)',
       'public.support_factor_reset_done(uuid, integer)', 'public.support_factor_reset_failed(uuid, text)',
       'public.record_support_factor_reset_run(integer, integer, timestamptz)',
       'private.support_inactivity_sweep()', 'private.support_contact_drift_check()', 'private.support_factor_reset_mark_due()',
       'private.support_restore_assignments(uuid)']) f
     where has_function_privilege('authenticated', f, 'execute')) then
    raise exception '0145: a service-only support function is callable by signed-in users';
  end if;
  if has_table_privilege('authenticated', 'private.support_factor_resets', 'select')
     or has_table_privilege('authenticated', 'private.support_last_active', 'select') then
    raise exception '0145: a private support table is client-reachable';
  end if;
end
$verify$;
