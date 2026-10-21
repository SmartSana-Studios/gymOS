-- Story 23.10: revocation, Owner visibility and velocity lock (FR-181, FR-184; AD-41).
--
--   * private.support_revoke_access(gym, user, cause)   THE one revocation routine. Every way support access ends calls it:
--       unassign_support, deactivate_support_account, set_allow_gymos_support (switch off), private.support_lock_account (velocity /
--       step-up lock) and the gym-status trigger (suspension). A scan test lists every consumer and fails when a new one skips it.
--       It queues support-created staff for Owner review, counts the payments support started that are still pending, writes one
--       gym-scoped audit row and sends one Owner notice (+ e-mail) that names no individual. It never deactivates anyone.
--   * public.support_staff_review + get_support_review_queue / clear_support_review   the Owner review queue.
--   * members.created_by_support is pinned by a bypass GUC that only the INSERT branch of create_staff_member opens (23-6 deferral);
--     replace-in-place no longer tags.
--   * private.support_activity_digest (daily cron, job_runs) one Owner notice + e-mail per gym with counts of refunds, fee waivers,
--     staff created and staff edited. Nothing is sent when support did none of those.
--   * Velocity: private.support_velocity_breach counts support_action_identity rows (distinct per transaction) and session_gate_touch
--     locks the account (private.support_accounts.locked_at) and RETURNS 'locked' (never raises), so the lock commits. Super Admin
--     is alerted. public.get_support_locks / unlock_support_account (mandatory reason, audited) reverse it.
--   * Deferral fixes: log_audit_event allow-list for a live support caller (private.support_audit_actions), get_support_action_identity
--     audits each read, per-user wrong step-up counter for support (stepup_record_failure), set_allow_gymos_support restore skips
--     accounts that are not activated / locked / reset-pending / deactivated and people who gained another membership.
--
-- Limits live in private.session_limits_config (all [ASSUMPTION], confirmed or changed in 23.0).
-- Rollback: scripts/rollback-0144-support-revocation-velocity-lock.sql.
set local lock_timeout = '5s';

-- ===== 1. limits =====
insert into private.session_limits_config (key, value, note) values
  ('velocity_gym_per_hour',              10, '[ASSUMPTION] support actions per gym per hour before the acting account is locked'),
  ('velocity_account_per_hour',          20, '[ASSUMPTION] support actions per account (all gyms) per hour before the account is locked'),
  ('velocity_payment_changes_per_day',    3, '[ASSUMPTION] support payment-connection changes per gym per day before the acting account is locked'),
  ('support_revocation_cutoff_seconds',  60, '[ASSUMPTION] seconds within which a revoked support session, subscription or signed link stops (the live gate is evaluated on every request, so this is an upper bound)')
on conflict (key) do nothing;

-- ===== 2. account facts =====
alter table private.support_accounts
  add column locked_reason text,
  add column velocity_reset_at timestamptz;

-- the per-account velocity count filters by real_user_id
create index support_action_identity_user_idx on public.support_action_identity (real_user_id, recorded_at);

-- ===== 3. notice helpers (staff_notices + email_outbox, as 23.9) =====
create or replace function private.queue_staff_notice(
  p_user uuid, p_gym uuid, p_type text, p_title_en text, p_title_fr text, p_body_en text, p_body_fr text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_notice_id uuid;
  v_email text;
begin
  insert into staff_notices (user_id, gym_id, notice_type, title_en, title_fr, body_en, body_fr)
  values (p_user, p_gym, p_type, p_title_en, p_title_fr, p_body_en, p_body_fr)
  returning id into v_notice_id;

  select coalesce(
           (select nullif(btrim(au.email), '') from auth.users au where au.id = p_user),
           (select nullif(btrim(m2.email), '') from members m2 where m2.user_id = p_user and m2.gym_id = p_gym limit 1))
    into v_email;

  if v_email is not null then
    insert into email_outbox (notice_id, recipient_email, subject, body)
    values (v_notice_id, v_email, p_title_en || ' / ' || p_title_fr, p_body_en || E'\n\n' || p_body_fr);
  end if;
end;
$$;
revoke all on function private.queue_staff_notice(uuid, uuid, text, text, text, text, text) from public, anon, authenticated;

create or replace function private.notify_gym_owners(p_gym uuid, p_type text, p_title_en text, p_title_fr text, p_body_en text, p_body_fr text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in
    select distinct m.user_id as uid from members m
     where m.gym_id = p_gym and m.role = 'owner' and m.deactivated_at is null and m.user_id is not null
  loop
    perform private.queue_staff_notice(r.uid, p_gym, p_type, p_title_en, p_title_fr, p_body_en, p_body_fr);
  end loop;
end;
$$;
revoke all on function private.notify_gym_owners(uuid, text, text, text, text, text) from public, anon, authenticated;

-- Every Super Admin (the proxies are not people).
create or replace function private.notify_super_admins(p_type text, p_title_en text, p_title_fr text, p_body_en text, p_body_fr text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in select u.id as uid from users u where u.is_super_admin and not u.is_support_proxy loop
    perform private.queue_staff_notice(r.uid, null, p_type, p_title_en, p_title_fr, p_body_en, p_body_fr);
  end loop;
end;
$$;
revoke all on function private.notify_super_admins(text, text, text, text, text) from public, anon, authenticated;

-- ===== 4. the Owner review queue =====
create table public.support_staff_review (
  member_id   uuid primary key references public.members(id) on delete cascade,
  gym_id      uuid not null references public.gyms(id) on delete cascade,
  flagged_at  timestamptz not null default now(),
  cleared_at  timestamptz
);
create index support_staff_review_gym_idx on public.support_staff_review (gym_id) where cleared_at is null;
alter table public.support_staff_review enable row level security;
revoke all on public.support_staff_review from public, anon, authenticated, service_role;

-- ===== 5. the pin on members.created_by_support (23-6 deferral) =====
create or replace function private.pin_created_by_support()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('gymos.support_staff_tag', true), '') <> 'on' then
    if tg_op = 'INSERT' then
      new.created_by_support := false;
    else
      new.created_by_support := old.created_by_support;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.pin_created_by_support() from public, anon, authenticated;

create trigger pin_created_by_support
  before insert or update of created_by_support on public.members
  for each row execute function private.pin_created_by_support();

-- ===== 6. the one revocation routine =====
-- p_user NULL = every support person in the gym (switch off, suspension). p_cause is one of unassigned | deactivated | switch_off |
-- locked | gym_suspended (free text, never shown). Idempotent. Never deactivates staff, never ends a session (the callers do).
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

-- A gym that leaves 'active' (suspension, deactivation) revokes like any other path. Support is already denied by the live gate.
create or replace function private.support_revoke_on_gym_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status and new.status is distinct from 'active'
     and exists (select 1 from public.support_assignments a where a.gym_id = new.id and a.state <> 'ended') then
    perform private.support_revoke_access(new.id, null, 'gym_suspended');
  end if;
  return null;
end;
$$;
revoke all on function private.support_revoke_on_gym_status() from public, anon, authenticated;

create trigger zz_support_revoke_on_gym_status
  after update of status on public.gyms
  for each row execute function private.support_revoke_on_gym_status();

-- ===== 7. lock =====
-- Locks the account (idempotent), ends its sessions, audits it, revokes in each gym it is assigned to and alerts every Super Admin.
-- Returns true only for the call that made the lock.
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

-- ===== 8. velocity =====
-- NULL, or the first breached limit. One action = one transaction (rows written together share recorded_at), so the audit row, the
-- payment row and the identity rows of a single call count once. Suspended gyms are not counted. Rows from before an unlock are ignored.
create or replace function private.support_velocity_breach(p_user uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_gym_limit  integer := private.session_limit('velocity_gym_per_hour');
  v_acct_limit integer := private.session_limit('velocity_account_per_hour');
  v_pay_limit  integer := private.session_limit('velocity_payment_changes_per_day');
begin
  if p_user is null then
    return null;
  end if;

  if exists (
    select 1 from (
      select i.gym_id, count(distinct i.recorded_at) as n
        from public.support_action_identity i
        join public.gyms g on g.id = i.gym_id and g.status = 'active'
        left join private.support_accounts sa on sa.user_id = i.real_user_id
       where i.real_user_id = p_user
         and i.recorded_at > now() - interval '1 hour'
         and i.recorded_at > coalesce(sa.velocity_reset_at, '-infinity'::timestamptz)
         and i.gym_id in (select a.gym_id from public.support_assignments a where a.support_user_id = p_user and a.state <> 'ended')
       group by i.gym_id) x
     where x.n > v_gym_limit) then
    return 'velocity_gym';
  end if;

  if (select count(distinct i.recorded_at)
        from public.support_action_identity i
        join public.gyms g on g.id = i.gym_id and g.status = 'active'
        left join private.support_accounts sa on sa.user_id = i.real_user_id
       where i.real_user_id = p_user
         and i.recorded_at > now() - interval '1 hour'
         and i.recorded_at > coalesce(sa.velocity_reset_at, '-infinity'::timestamptz)) > v_acct_limit then
    return 'velocity_account';
  end if;

  if exists (
    select 1 from (
      select i.gym_id, count(distinct i.recorded_at) as n
        from public.support_action_identity i
        join public.gyms g on g.id = i.gym_id and g.status = 'active'
        left join private.support_accounts sa on sa.user_id = i.real_user_id
       where i.real_user_id = p_user
         and i.subject_table = 'gym_payment_credentials'
         and i.recorded_at > now() - interval '1 day'
         and i.recorded_at > coalesce(sa.velocity_reset_at, '-infinity'::timestamptz)
         and i.gym_id in (select a.gym_id from public.support_assignments a where a.support_user_id = p_user and a.state <> 'ended')
       group by i.gym_id) x
     where x.n > v_pay_limit) then
    return 'velocity_payment';
  end if;
  return null;
end;
$$;
revoke all on function private.support_velocity_breach(uuid) from public, anon, authenticated;
grant execute on function private.support_velocity_breach(uuid) to service_role;

-- ===== 9. Super Admin: locks and unlock =====
create or replace function public.get_support_locks()
returns table (user_id uuid, display_name text, email text, locked_at timestamptz, locked_reason text, gym_names text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform private.support_admin_required();
  return query
    select sa.user_id, u.display_name, au.email::text, sa.locked_at, sa.locked_reason,
           (select string_agg(distinct g.name, ', ' order by g.name)
              from public.support_assignments a join public.gyms g on g.id = a.gym_id
             where a.support_user_id = sa.user_id and a.state <> 'ended')
      from private.support_accounts sa
      join public.users u on u.id = sa.user_id
      left join auth.users au on au.id = sa.user_id
     where sa.locked_at is not null
     order by sa.locked_at desc;
end;
$$;
revoke all on function public.get_support_locks() from public, anon;
grant execute on function public.get_support_locks() to authenticated, service_role;

-- Codes: reason_invalid | not_found | deactivated | not_locked | unlocked. Rows from before the unlock stop counting.
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

-- ===== 10. Owner review queue readers =====
create or replace function public.get_support_review_queue()
returns table (member_id uuid, name text, role member_role, member_since timestamptz, flagged_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_gym uuid;
begin
  if (select private.current_member_role())::text is distinct from 'owner' then
    raise exception 'permission denied';
  end if;
  v_gym := private.gym_id();
  if v_gym is null then
    raise exception 'permission denied';
  end if;
  return query
    select m.id, m.name, m.role, m.created_at, r.flagged_at
      from public.support_staff_review r
      join public.members m on m.id = r.member_id
     where r.gym_id = v_gym and r.cleared_at is null and m.deactivated_at is null and m.created_by_support
     order by r.flagged_at, m.created_at, m.id;
end;
$$;
revoke all on function public.get_support_review_queue() from public, anon;
grant execute on function public.get_support_review_queue() to authenticated, service_role;

-- The Owner has looked at this person and keeps them. Codes: cleared | not_found
create or replace function public.clear_support_review(p_member_id uuid)
returns table (ok boolean, code text)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_gym uuid;
  v_n   integer;
begin
  if (select private.current_member_role())::text is distinct from 'owner' then
    raise exception 'permission denied';
  end if;
  v_gym := private.gym_id();
  if v_gym is null then
    raise exception 'permission denied';
  end if;
  update public.support_staff_review set cleared_at = now()
   where member_id = p_member_id and gym_id = v_gym and cleared_at is null;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return query select false, 'not_found'::text;
    return;
  end if;
  perform log_audit_event(
    p_action_type => 'staff_support_review_cleared',
    p_gym_id => v_gym,
    p_target_entity_id => p_member_id::text,
    p_target_entity_type => 'member',
    p_metadata => '{}'::jsonb
  );
  return query select true, 'cleared'::text;
end;
$$;
revoke all on function public.clear_support_review(uuid) from public, anon;
grant execute on function public.clear_support_review(uuid) to authenticated, service_role;

-- ===== 11. the daily digest =====
create or replace function private.support_activity_digest()
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_started timestamptz := clock_timestamp();
  v_since   timestamptz := now() - interval '1 day';
  v_gym     record;
  v_refunds integer;
  v_waivers integer;
  v_created integer;
  v_edited  integer;
  v_en      text;
  v_fr      text;
  v_sent    integer := 0;
  v_failed  integer := 0;
  v_error   text;
begin
  -- gyms that are not active are excluded (a suspended gym gets no digest and does not count as an active one)
  for v_gym in
    select distinct i.gym_id from support_action_identity i join gyms g on g.id = i.gym_id and g.status = 'active'
     where i.recorded_at >= v_since order by i.gym_id
  loop
    begin
      select count(distinct i.subject_id) into v_refunds
        from support_action_identity i
       where i.gym_id = v_gym.gym_id and i.recorded_at >= v_since and i.subject_table = 'refunds';
      select count(*) filter (where a.action_type = 'registration_fee_waived'),
             count(*) filter (where a.action_type = 'staff_created'),
             count(*) filter (where a.action_type = 'staff_role_updated')
        into v_waivers, v_created, v_edited
        from support_action_identity i join audit_log a on a.id = i.subject_id
       where i.gym_id = v_gym.gym_id and i.recorded_at >= v_since and i.subject_table = 'audit_log';

      if v_refunds + v_waivers + v_created + v_edited > 0 then
        v_en := 'In the last 24 hours GymOS Support recorded:'
             || case when v_refunds > 0 then ' ' || v_refunds || ' refund(s);' else '' end
             || case when v_waivers > 0 then ' ' || v_waivers || ' registration fee waiver(s);' else '' end
             || case when v_created > 0 then ' ' || v_created || ' staff account(s) created;' else '' end
             || case when v_edited > 0 then ' ' || v_edited || ' staff account(s) edited;' else '' end;
        v_fr := 'Au cours des dernières 24 heures, GymOS Support a enregistré :'
             || case when v_refunds > 0 then ' ' || v_refunds || ' remboursement(s) ;' else '' end
             || case when v_waivers > 0 then ' ' || v_waivers || ' exonération(s) de frais d''inscription ;' else '' end
             || case when v_created > 0 then ' ' || v_created || ' compte(s) du personnel créé(s) ;' else '' end
             || case when v_edited > 0 then ' ' || v_edited || ' compte(s) du personnel modifié(s) ;' else '' end;
        perform private.notify_gym_owners(v_gym.gym_id, 'support_activity_digest',
          'GymOS Support activity summary', 'Résumé de l''activité de GymOS Support', v_en, v_fr);
        v_sent := v_sent + 1;
      end if;
    exception when others then
      v_failed := v_failed + 1;
      v_error := left(sqlerrm, 200);
    end;
  end loop;

  insert into job_runs (job_name, started_at, finished_at, status, error)
  values ('support_activity_digest', v_started, now(),
          case when v_failed > 0 then 'failure'::job_status else 'success'::job_status end,
          case when v_failed > 0 then v_failed || ' gym(s) failed, ' || v_sent || ' digest(s) sent: ' || v_error end);
end;
$$;
revoke all on function private.support_activity_digest() from public, anon, authenticated;
grant execute on function private.support_activity_digest() to service_role;

-- 06:10 UTC daily; cron.schedule() upserts by name
select cron.schedule('support_activity_digest', '10 6 * * *', $$ select private.support_activity_digest(); $$);

-- ===== 12. the audit actions a live support caller may write (23-8 deferral) =====
create table private.support_audit_actions (
  action_type text primary key
);
alter table private.support_audit_actions enable row level security;
revoke all on private.support_audit_actions from public, anon, authenticated;
grant select on private.support_audit_actions to service_role;

insert into private.support_audit_actions (action_type) values
  ('staff_created'), ('staff_role_updated'),
  ('registration_fee_recorded'), ('registration_fee_waived'), ('registration_fee_changed'),
  ('session_payment_recorded'), ('subscription_manual_renewal'), ('renewal_confirmed'), ('session_refund_applied'),
  ('plan_type_changed'), ('plan_price_changed'), ('guest_charging_changed'), ('gym_category_changed'), ('loyalty_program_changed'),
  ('gym_payment_credentials_connected'),
  ('loyalty_stamp_earned'), ('loyalty_progress_reset'), ('loyalty_reward_granted'), ('loyalty_stamp_reversed'), ('loyalty_hook_failed');

-- ===== the replaced functions (live bodies; only the marked Story 23.10 lines are new) =====

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
  if v_a.state in ('active', 'suspended') then
    perform private.support_revoke_access(v_a.gym_id, v_a.support_user_id, 'unassigned');
  end if;
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
    perform private.support_revoke_access(v_a.gym_id, p_user_id, 'deactivated');
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

  -- Story 23.10: a live support caller may write only the action types its allow-listed capabilities produce (private.support_audit_actions).
  if private.support_gym_id() is not null
     and not exists (select 1 from private.support_audit_actions a where a.action_type = p_action_type) then
    raise exception 'support_audit_action_not_allowed' using errcode = 'P0001';
  end if;

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
  -- Story 23.10: the only place the tag may be written; the pin trigger on members refuses it everywhere else.
  if v_by_support then
    perform set_config('gymos.support_staff_tag', 'on', true);
  end if;
  insert into members (gym_id, user_id, role, name, phone, created_by_support)
  values (v_gym_id, p_user_id, p_role, p_name, p_phone, v_by_support)
  returning * into v_row;
  perform set_config('gymos.support_staff_tag', 'off', true);

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
  -- Story 23.10: a support account has its own per-user counter, whatever the Super Admin flag says. Counts only, never a code.
  if p_user is not null
     and not coalesce((select u.is_super_admin from users u where u.id = p_user), false)
     and exists (select 1 from private.support_accounts sa where sa.user_id = p_user and sa.activated_at is not null and sa.deactivated_at is null) then
    if exists (select 1 from private.support_accounts sa where sa.user_id = p_user and sa.locked_at is not null) then
      -- already locked: nothing more to count or audit, and the caller must not say "retry"
      return query select true, coalesce((select l.failed_count from private.super_admin_lockout l where l.user_id = p_user), 0), v_threshold;
      return;
    end if;
    insert into private.super_admin_lockout (user_id, failed_count) values (p_user, 1)
    on conflict (user_id) do update set failed_count = private.super_admin_lockout.failed_count + 1
    returning failed_count into v_count;
    insert into audit_log (gym_id, actor_id, actor_display_name, action_type, target_entity_type, target_entity_id, metadata)
    values (null, null, 'system:step_up', 'support_stepup_failed', 'user', p_user::text,
            jsonb_build_object('attempts', v_count, 'threshold', v_threshold));
    if v_count >= v_threshold then
      perform private.support_lock_account(p_user, 'stepup_failures');
      v_locked := true;
    end if;
    return query select v_locked, v_count, v_threshold;
    return;
  end if;

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
 VOLATILE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform private.support_admin_required();
  if not private.is_super_admin_live() then
    raise exception 'permission denied';
  end if;
  -- Story 23.10: reading a real identity is itself audited (subject table and number of rows asked for; no id, no name).
  perform private.support_admin_audit('support_identity_read', auth.uid(),
    jsonb_build_object('subject_table', p_subject_table, 'rows_requested', cardinality(coalesce(p_subject_ids, '{}'::uuid[]))));
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

-- privileges of the replaced functions are unchanged (restated for the guardrail)
revoke all on function public.create_staff_member(uuid, text, text, member_role) from public, anon;
revoke all on function public.deactivate_support_account(uuid, text) from public, anon;
revoke all on function public.get_support_action_identity(text, uuid[]) from public, anon;
revoke all on function public.log_audit_event(text, uuid, text, text, jsonb, text) from public, anon;
revoke all on function public.set_allow_gymos_support(uuid, boolean) from public, anon;
revoke all on function public.unassign_support(uuid, text) from public, anon;
revoke all on function private.session_gate_touch(uuid, uuid) from public, anon, authenticated;
revoke all on function private.stepup_record_failure(uuid) from public, anon, authenticated;

do $verify$
begin
  if exists (select 1 from unnest(array[
       'public.get_support_locks()', 'public.unlock_support_account(uuid, text)',
       'public.get_support_review_queue()', 'public.clear_support_review(uuid)']) f
     where has_function_privilege('anon', f, 'execute') or has_function_privilege('public', f, 'execute')) then
    raise exception '0144: a support function is callable by anon or public';
  end if;
  if has_function_privilege('authenticated', 'private.support_revoke_access(uuid, uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'private.support_lock_account(uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'private.support_velocity_breach(uuid)', 'execute')
     or has_function_privilege('authenticated', 'private.support_activity_digest()', 'execute')
     or has_table_privilege('authenticated', 'public.support_staff_review', 'select')
     or has_table_privilege('authenticated', 'private.support_audit_actions', 'select') then
    raise exception '0144: a private support object is client-reachable';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.members'::regclass and tgname = 'pin_created_by_support')
     or not exists (select 1 from pg_trigger where tgrelid = 'public.gyms'::regclass and tgname = 'zz_support_revoke_on_gym_status') then
    raise exception '0144: triggers missing';
  end if;
end
$verify$;
