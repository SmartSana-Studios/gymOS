-- Story 23.7: hidden identity, per-gym proxy actor (FR-186, AD-39).
--
-- Every actor column written for a live support session used to hold the real person's users.id (auth.uid()), so an Owner reading
-- payments.actor_id, refunds.actor_id or audit_log.actor_id could identify and correlate the person across gyms. Now:
--
-- * Every gym has ONE proxy `users` row (is_support_proxy, display_name 'GymOS Support', null phone and email) backed by a BANNED
--   auth.users row (no password, no email, banned until 2999-12-31, no members row, never signable-in). A trigger on gyms creates it in the same
--   transaction as the gym, so a failure to create it rolls the gym back (fail closed). Existing gyms are backfilled below.
-- * private.actor_id() returns the proxy of the live support gym (resolved ONLY through private.support_gym_id()), else auth.uid().
--   Non-support behavior is unchanged.
-- * Every function that writes auth.uid() into an actor column now calls private.actor_id(). BEFORE INSERT triggers on payments and
--   refunds force the server-derived actor for a live support caller, so a client-supplied actor_id cannot name the real person.
-- * supabase/tests/support_proxy_actor.test.sql scans pg_proc bodies and users foreign keys and fails on an unlisted writer or an
--   unclassified user-FK column.
--
-- Does NOT add support_action_identity or any name rendering (23.8), member-facing changes (23.8) or the payment connection flow (23.9).
-- Rollback: scripts/rollback-0141-support-proxy-actor.sql.
set local lock_timeout = '5s';

-- ===== the proxy marker and the one-per-gym link =====
alter table public.users
  add column is_support_proxy boolean not null default false,
  add column support_proxy_gym_id uuid references public.gyms(id) on delete cascade;
alter table public.users
  add constraint users_support_proxy_gym_consistent check (is_support_proxy = (support_proxy_gym_id is not null)),
  add constraint users_support_proxy_not_super_admin check (not (is_support_proxy and is_super_admin));
create unique index users_support_proxy_gym_id_key on public.users (support_proxy_gym_id) where support_proxy_gym_id is not null;

-- a signed-in user can update their own users row (0015); pin the proxy markers back so a self-update cannot set or clear them
-- (body = 0019's version plus the two new pins)
create or replace function private.protect_self_managed_user_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() = new.id then
    new.phone := old.phone;
    new.is_super_admin := old.is_super_admin;
    new.created_at := old.created_at;
    new.is_support_proxy := old.is_support_proxy;
    new.support_proxy_gym_id := old.support_proxy_gym_id;
  end if;
  return new;
end;
$$;
revoke all on function private.protect_self_managed_user_columns() from public, anon;

-- ===== create (idempotently) the proxy of one gym =====
create or replace function private.ensure_support_proxy(p_gym_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select u.id into v_id from public.users u where u.support_proxy_gym_id = p_gym_id;
  if v_id is not null then
    return v_id;
  end if;

  v_id := gen_random_uuid();
  -- banned until 2999-12-31, no password, no email, no phone: it can never sign in or receive a message. handle_new_user adds the public.users row.
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, banned_until, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', null, null, '2999-12-31 00:00:00+00'::timestamptz,
          '{"provider":"support_proxy"}'::jsonb, '{}'::jsonb, now(), now());

  update public.users
     set is_support_proxy = true,
         support_proxy_gym_id = p_gym_id,
         display_name = 'GymOS Support',
         phone = null,
         must_change_password = false
   where id = v_id;
  if not found then
    raise exception 'ensure_support_proxy: the proxy users row was not created';
  end if;
  return v_id;
end;
$$;
revoke all on function private.ensure_support_proxy(uuid) from public, anon, authenticated;
grant execute on function private.ensure_support_proxy(uuid) to service_role;

create or replace function private.gym_support_proxy_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform private.ensure_support_proxy(new.id);
  return new;
end;
$$;
revoke all on function private.gym_support_proxy_trigger() from public, anon, authenticated;
create trigger gym_support_proxy after insert on public.gyms
  for each row execute function private.gym_support_proxy_trigger();

-- backfill: exactly one proxy per existing gym; a re-run adds none
select private.ensure_support_proxy(g.id) from public.gyms g;

-- ===== the actor of a write =====
create or replace function private.actor_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_gym uuid;
  v_proxy uuid;
begin
  v_gym := private.support_gym_id();
  if v_gym is null then
    return auth.uid();
  end if;
  -- a live support caller never falls back to the real id: no proxy means refuse (fail closed)
  select u.id into v_proxy from public.users u where u.support_proxy_gym_id = v_gym;
  if v_proxy is null then
    raise exception 'support_proxy_missing' using errcode = 'P0001';
  end if;
  return v_proxy;
end;
$$;
revoke all on function private.actor_id() from public, anon;
grant execute on function private.actor_id() to authenticated, service_role;

-- ===== direct inserts: the stored actor is server-derived for a live support caller =====
create or replace function private.support_force_actor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if private.support_gym_id() is not null then
    new.actor_id := private.actor_id();
  end if;
  return new;
end;
$$;
revoke all on function private.support_force_actor() from public, anon, authenticated;
create trigger aa_support_force_actor before insert on public.payments
  for each row execute function private.support_force_actor();
create trigger aa_support_force_actor before insert on public.refunds
  for each row execute function private.support_force_actor();

-- ===== the actor-writing functions (bodies copied from the live catalog after 0140; only the actor expression changes) =====

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

CREATE OR REPLACE FUNCTION public.confirm_renewal(p_member_id uuid, p_method text, p_reason text, p_backdate boolean DEFAULT false, OUT payment_id uuid, OUT subscription_id uuid, OUT amount integer, OUT currency text, OUT new_expiry_date date)
 RETURNS record
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_gym_id uuid;
  v_actor_id uuid;
  v_member_gym_id uuid;
  v_deactivated_at timestamptz;
  v_plan_id uuid;
  v_duration_days integer;
  v_current_status subscription_status;
  v_current_expiry_date date;
  v_start_date date;
  v_carried_from date;
begin
  v_caller_gym_id := private.support_rpc_gym_id('confirm_renewal');
  if v_caller_gym_id is null then
    raise exception 'permission denied';
  end if;

  -- AD-3 / 19.1 lint: the role comes from private.support_rpc_role('confirm_renewal'), not the
  -- JWT claim 0093 read. Same allowlist; a caller with no active membership in
  -- the gym is refused as before. Role resolution comes BEFORE the suspension
  -- gate (code review 2026-09-09 rule, see tenant_suspension_enforcement.test.sql):
  -- an unauthorized caller at a suspended gym must not learn the gym status.
  if not coalesce(private.support_rpc_role('confirm_renewal') in ('owner', 'manager', 'supervisor', 'receptionist'), false) then
    raise exception 'permission denied';
  end if;

  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'confirm_renewal: gym % is not active', v_caller_gym_id;
  end if;
  v_actor_id := private.actor_id();

  -- AD-27: the member row lock comes before the first write.
  select gym_id, deactivated_at into v_member_gym_id, v_deactivated_at
  from members where id = p_member_id and gym_id = v_caller_gym_id
  for no key update;

  if v_member_gym_id is null then
    raise exception 'confirm_renewal: member % not found', p_member_id;
  end if;

  if v_deactivated_at is not null then
    raise exception 'confirm_renewal: member % is deactivated and cannot be renewed', p_member_id;
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'confirm_renewal: reason is required';
  end if;

  select s.plan_id, s.status, s.expiry_date
    into v_plan_id, v_current_status, v_current_expiry_date
  from subscriptions s
  where s.member_id = p_member_id
  order by s.created_at desc, s.id desc
  limit 1;

  if v_plan_id is null then
    raise exception 'confirm_renewal: member % has no existing subscription to renew', p_member_id;
  end if;

  if p_backdate then
    if v_current_status not in ('grace_period', 'expired') then
      raise exception 'confirm_renewal: back-dating is only available for grace_period or expired subscriptions';
    end if;
    if v_current_expiry_date is null then
      raise exception 'confirm_renewal: cannot back-date a subscription with no expiry date';
    end if;
    v_start_date := v_current_expiry_date;
  else
    v_start_date := current_date;
  end if;

  select duration_days, price, plans.currency into v_duration_days, amount, currency
  from plans where id = v_plan_id;

  -- Review finding: back-dating a member expired longer than one plan cycle
  -- (e.g. expired 100 days ago on a 30-day plan) would otherwise insert a
  -- new subscription already marked 'active' with an expiry_date already in
  -- the past. Reject rather than silently produce an already-expired
  -- "active" row -- consistent with this block's other eligibility guards.
  if p_backdate and v_duration_days is not null and (v_start_date + v_duration_days) < current_date then
    raise exception 'confirm_renewal: back-dated renewal would still be expired';
  end if;

  -- Epic 20 retro S-3 (decisions.md 2026-10-15): a renewal verified before the current
  -- expiry carries the remaining days, rewarded free days included. The new period
  -- runs from the later of today and the latest subscription's expiry; start_date
  -- stays today so the plan screen keeps reading "active from" the renewal date.
  -- A lapsed subscription (expiry in the past) and a back-dated renewal (start =
  -- the old expiry) come out as before.
  v_carried_from := greatest(v_start_date, coalesce(v_current_expiry_date, v_start_date));
  new_expiry_date := case when v_duration_days is null then null else v_carried_from + v_duration_days end;

  insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
  values (v_member_gym_id, p_member_id, v_plan_id, 'active', v_start_date, new_expiry_date)
  returning id into subscription_id;

  insert into payments (gym_id, member_id, subscription_id, amount, currency, method, status, actor_id, reason)
  values (v_member_gym_id, p_member_id, subscription_id, amount, currency, p_method, 'verified', v_actor_id, p_reason)
  returning id into payment_id;

  perform log_audit_event(
    p_action_type => 'renewal_confirmed',
    p_gym_id => v_member_gym_id,
    p_target_entity_id => p_member_id::text,
    p_target_entity_type => 'member',
    p_metadata => jsonb_build_object(
      'reason', p_reason, 'method', p_method, 'amount', amount, 'currency', currency,
      'payment_id', payment_id, 'subscription_id', subscription_id, 'plan_id', v_plan_id,
      'new_expiry_date', new_expiry_date, 'start_date', v_start_date, 'backdated', p_backdate,
      'carried_days', (v_carried_from - v_start_date)
    )
  );

  -- Story 20.3: an on-time renewal earns a subscriber stamp; a back-dated staff
  -- renewal never does. The hook may move expiry_date out by R days, so the
  -- returned date is re-read.
  if not p_backdate then
    perform private.award_renewal_stamp(payment_id);

    select s.expiry_date into new_expiry_date
    from subscriptions s
    where s.id = subscription_id;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.initiate_registration_fee_payment(p_member_id uuid)
 RETURNS TABLE(payment_id uuid, provider_key text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid;
  v_actor_id uuid;
  v_fee integer;
  v_role member_role;
  v_deactivated_at timestamptz;
  v_settled_at timestamptz;
  v_fee_status payment_status;
  v_provider text;
  v_payment_id uuid;
begin
  -- Fail closed: a missing app_role claim makes the comparison NULL, and
  -- `not NULL` would skip the raise.
  if not coalesce((select private.current_member_role())::text = any(array['owner', 'manager', 'supervisor', 'receptionist']), false) then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  if private.current_gym_status() is distinct from 'active' then
    raise exception 'initiate_registration_fee_payment: gym % is not active', v_gym_id;
  end if;

  v_actor_id := private.actor_id();

  -- Payment row before member row (lock order), so an expired attempt is
  -- flagged before the member lock is taken.
  perform private.expire_stale_registration_fee_payment(p_member_id, v_gym_id);

  select m.role, m.deactivated_at, m.registration_fee_settled_at
    into v_role, v_deactivated_at, v_settled_at
  from members m
  where m.id = p_member_id and m.gym_id = v_gym_id
  for update;

  if not found or v_role is distinct from 'member' then
    raise exception 'not_found: member % not found', p_member_id;
  end if;

  if v_deactivated_at is not null then
    raise exception 'member_deactivated: member % is deactivated', p_member_id;
  end if;

  select p.status into v_fee_status
  from payments p
  where p.member_id = p_member_id
    and p.purpose = 'registration_fee'
    and p.voided_at is null
    and p.status <> 'flagged'
  limit 1;

  if found then
    if v_fee_status = 'processing' then
      raise exception 'registration_fee_already_pending: member % has a registration fee payment in progress', p_member_id;
    end if;
    raise exception 'registration_fee_already_recorded: member % already has a registration fee payment', p_member_id;
  end if;

  if v_settled_at is not null then
    raise exception 'registration_fee_not_due: member % has no registration fee outstanding', p_member_id;
  end if;

  select g.registration_fee into v_fee from gyms g where g.id = v_gym_id;

  if coalesce(v_fee, 0) <= 0 then
    raise exception 'registration_fee_not_configured: gym % charges no registration fee', v_gym_id;
  end if;

  select active_payment_provider() into v_provider;
  if v_provider is null then
    raise exception 'initiate_registration_fee_payment: no_active_provider';
  end if;

  begin
    insert into payments (gym_id, member_id, subscription_id, amount, currency, method, status, provider, actor_id, purpose)
    values (v_gym_id, p_member_id, null, v_fee, 'XAF', 'mobile_money', 'processing', v_provider, v_actor_id, 'registration_fee')
    returning id into v_payment_id;
  exception when unique_violation then
    raise exception 'registration_fee_already_pending: member % has a registration fee payment in progress', p_member_id;
  end;

  payment_id := v_payment_id;
  provider_key := v_provider;
  return next;
  return;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.initiate_session_payment()
 RETURNS TABLE(payment_id uuid, provider_key text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid;
  v_caller_role member_role;
  v_member_id uuid;
  v_charging boolean;
  v_role member_role;
  v_deactivated_at timestamptz;
  v_settled_at timestamptz;
  v_plan_type plan_type;
  v_price integer;
  v_currency text;
  v_provider text;
  v_payment_id uuid;
begin
  v_caller_role := private.current_member_role();

  -- Staff and coaches are refused. A null role is allowed through only to
  -- reach the member row below: current_member_role() ignores deactivated
  -- rows, and the matrix names `member_deactivated` for that member.
  if v_caller_role is not null and v_caller_role is distinct from 'member' then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  if private.current_gym_status() is distinct from 'active' then
    raise exception 'initiate_session_payment: gym % is not active', v_gym_id;
  end if;

  select m.id into v_member_id
  from members m
  where m.user_id = auth.uid() and m.gym_id = v_gym_id and m.role = 'member'
  order by m.deactivated_at nulls first
  limit 1;

  if v_member_id is null then
    raise exception 'permission denied';
  end if;

  select g.charge_guests_per_session into v_charging from gyms g where g.id = v_gym_id;
  if not coalesce(v_charging, false) then
    raise exception 'charging_disabled: this gym does not charge guests per session';
  end if;

  -- Payment rows before the member row (lock order): flag an expired attempt
  -- before the member lock is taken.
  perform private.expire_stale_payment(v_member_id, v_gym_id, 'session');

  select m.role, m.deactivated_at, m.registration_fee_settled_at
    into v_role, v_deactivated_at, v_settled_at
  from members m
  where m.id = v_member_id and m.gym_id = v_gym_id
  for no key update;

  if not found or v_role is distinct from 'member' then
    raise exception 'permission denied';
  end if;

  if v_deactivated_at is not null then
    raise exception 'member_deactivated: member % is deactivated', v_member_id;
  end if;

  if v_settled_at is null then
    raise exception 'registration_fee_not_settled: member % has not settled the registration fee', v_member_id;
  end if;

  select pl.plan_type, pl.price, pl.currency
    into v_plan_type, v_price, v_currency
  from subscriptions s
  join plans pl on pl.id = s.plan_id
  where s.member_id = v_member_id
  order by s.created_at desc, s.id desc
  limit 1;

  if not found or v_plan_type is distinct from 'pay_per_session' then
    raise exception 'plan_not_per_session: member % is not on a pay-per-session plan', v_member_id;
  end if;

  if coalesce(v_price, 0) <= 0 then
    raise exception 'session_price_not_set: the pay-per-session plan has no price';
  end if;

  if exists (
    select 1 from payments p
    where p.member_id = v_member_id
      and p.gym_id = v_gym_id
      and p.purpose = 'session'
      and p.voided_at is null
      and p.status in ('pending', 'processing')
  ) then
    raise exception 'session_payment_already_in_progress: member % has a session payment in progress', v_member_id;
  end if;

  select active_payment_provider() into v_provider;
  if v_provider is null
     or not exists (
       select 1 from gym_payment_credentials c
       where c.gym_id = v_gym_id and c.provider_key = v_provider
     ) then
    raise exception 'no_active_provider: this gym has no connected payment provider';
  end if;

  begin
    insert into payments (gym_id, member_id, subscription_id, amount, currency, method, status, provider, actor_id, purpose)
    values (v_gym_id, v_member_id, null, v_price, v_currency, 'mobile_money', 'processing', v_provider, private.actor_id(), 'session')
    returning id into v_payment_id;
  exception when unique_violation then
    raise exception 'session_payment_already_in_progress: member % has a session payment in progress', v_member_id;
  end;

  payment_id := v_payment_id;
  provider_key := v_provider;
  return next;
  return;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.record_registration_fee(p_member_id uuid, p_method text, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid;
  v_actor_id uuid;
  v_fee integer;
  v_role member_role;
  v_deactivated_at timestamptz;
  v_settled_at timestamptz;
  v_reason text;
  v_fee_status payment_status;
  v_payment_id uuid;
begin
  -- Fail closed: a missing app_role claim makes the comparison NULL, and
  -- `not NULL` would skip the raise.
  if not coalesce((select private.support_rpc_role('record_registration_fee'))::text = any(array['owner', 'manager', 'supervisor', 'receptionist']), false) then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.support_rpc_gym_id('record_registration_fee');
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  if private.current_gym_status() is distinct from 'active' then
    raise exception 'record_registration_fee: gym % is not active', v_gym_id;
  end if;

  v_actor_id := private.actor_id();

  if p_method is null or p_method not in ('cash', 'bank_transfer', 'manual_momo') then
    raise exception 'record_registration_fee: invalid_method';
  end if;

  v_reason := btrim(p_reason, E' \t\r\n');
  if v_reason is null or v_reason = '' then
    raise exception 'record_registration_fee: reason is required';
  end if;
  if char_length(v_reason) > 200 then
    raise exception 'record_registration_fee: reason is too long';
  end if;

  -- Payment row before member row (lock order): flag an expired Tara attempt
  -- before the member lock is taken.
  perform private.expire_stale_registration_fee_payment(p_member_id, v_gym_id);

  -- The row lock serializes two concurrent calls for the same member.
  select m.role, m.deactivated_at, m.registration_fee_settled_at
    into v_role, v_deactivated_at, v_settled_at
  from members m
  where m.id = p_member_id and m.gym_id = v_gym_id
  for update;

  if not found or v_role is distinct from 'member' then
    raise exception 'not_found: member % not found', p_member_id;
  end if;

  if v_deactivated_at is not null then
    raise exception 'member_deactivated: member % is deactivated', p_member_id;
  end if;

  select p.status into v_fee_status
  from payments p
  where p.member_id = p_member_id
    and p.purpose = 'registration_fee'
    and p.voided_at is null
    and p.status <> 'flagged'
  limit 1;

  if found then
    if v_fee_status = 'processing' then
      raise exception 'registration_fee_already_pending: member % has a registration fee payment in progress', p_member_id;
    end if;
    raise exception 'registration_fee_already_recorded: member % already has a registration fee payment', p_member_id;
  end if;

  if v_settled_at is not null then
    raise exception 'registration_fee_not_due: member % has no registration fee outstanding', p_member_id;
  end if;

  select g.registration_fee into v_fee from gyms g where g.id = v_gym_id;

  if coalesce(v_fee, 0) <= 0 then
    raise exception 'registration_fee_not_configured: gym % charges no registration fee', v_gym_id;
  end if;

  begin
    insert into payments (gym_id, member_id, subscription_id, amount, currency, method, status, actor_id, reason, purpose)
    values (v_gym_id, p_member_id, null, v_fee, 'XAF', p_method, 'verified', v_actor_id, v_reason, 'registration_fee')
    returning id into v_payment_id;
  exception when unique_violation then
    raise exception 'registration_fee_already_pending: member % has a registration fee payment in progress', p_member_id;
  end;

  update members set registration_fee_settled_at = now()
  where id = p_member_id and registration_fee_settled_at is null;

  perform log_audit_event(
    p_action_type => 'registration_fee_recorded',
    p_gym_id => v_gym_id,
    p_target_entity_id => p_member_id::text,
    p_target_entity_type => 'member',
    p_metadata => jsonb_build_object(
      'amount', v_fee, 'currency', 'XAF', 'method', p_method,
      'reason', v_reason, 'payment_id', v_payment_id
    )
  );

  return v_payment_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.record_session_payment(p_member_id uuid, p_method text, p_reason text DEFAULT NULL::text)
 RETURNS guest_sessions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid;
  v_actor_id uuid;
  v_caller_role member_role;
  v_charging boolean;
  v_reason text;
  v_role member_role;
  v_deactivated_at timestamptz;
  v_settled_at timestamptz;
  v_plan_type plan_type;
  v_price integer;
  v_currency text;
  v_payment_id uuid;
  v_session guest_sessions;
begin
  v_caller_role := private.support_rpc_role('record_session_payment');

  if not coalesce(v_caller_role in ('owner', 'manager', 'supervisor', 'receptionist'), false) then
    raise exception 'permission denied';
  end if;

  -- Bank transfer is a manager-and-above method.
  if p_method = 'bank_transfer' and v_caller_role = 'receptionist' then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.support_rpc_gym_id('record_session_payment');
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  if private.current_gym_status() is distinct from 'active' then
    raise exception 'record_session_payment: gym % is not active', v_gym_id;
  end if;

  v_actor_id := private.actor_id();

  if p_method is null or p_method not in ('cash', 'bank_transfer', 'manual_momo') then
    raise exception 'record_session_payment: invalid_method';
  end if;

  v_reason := nullif(btrim(p_reason, E' \t\r\n'), '');
  if char_length(v_reason) > 200 then
    raise exception 'record_session_payment: reason is too long';
  end if;

  select g.charge_guests_per_session into v_charging from gyms g where g.id = v_gym_id;
  if not coalesce(v_charging, false) then
    raise exception 'charging_disabled: this gym does not charge guests per session';
  end if;

  -- Payment rows before the member row (lock order): flag an expired Tara
  -- attempt before the member lock is taken.
  perform private.expire_stale_payment(p_member_id, v_gym_id, 'session');

  select m.role, m.deactivated_at, m.registration_fee_settled_at
    into v_role, v_deactivated_at, v_settled_at
  from members m
  where m.id = p_member_id and m.gym_id = v_gym_id
  for no key update;

  if not found or v_role is distinct from 'member' then
    raise exception 'not_found: member % not found', p_member_id;
  end if;

  if v_deactivated_at is not null then
    raise exception 'member_deactivated: member % is deactivated', p_member_id;
  end if;

  if v_settled_at is null then
    raise exception 'registration_fee_not_settled: member % has not settled the registration fee', p_member_id;
  end if;

  select pl.plan_type, pl.price, pl.currency
    into v_plan_type, v_price, v_currency
  from subscriptions s
  join plans pl on pl.id = s.plan_id
  where s.member_id = p_member_id
  order by s.created_at desc, s.id desc
  limit 1;

  if not found or v_plan_type is distinct from 'pay_per_session' then
    raise exception 'plan_not_per_session: member % is not on a pay-per-session plan', p_member_id;
  end if;

  if coalesce(v_price, 0) <= 0 then
    raise exception 'session_price_not_set: the pay-per-session plan has no price';
  end if;

  if exists (
    select 1 from payments p
    where p.member_id = p_member_id
      and p.gym_id = v_gym_id
      and p.purpose = 'session'
      and p.voided_at is null
      and p.status in ('pending', 'processing')
  ) then
    raise exception 'session_payment_already_in_progress: member % has a session payment in progress', p_member_id;
  end if;

  insert into payments (gym_id, member_id, subscription_id, amount, currency, method, status, actor_id, reason, purpose)
  values (v_gym_id, p_member_id, null, v_price, v_currency, p_method, 'verified', v_actor_id, v_reason, 'session')
  returning id into v_payment_id;

  v_session := private.create_guest_session_for_payment(v_payment_id, p_member_id, v_gym_id);

  perform log_audit_event(
    p_action_type => 'session_payment_recorded',
    p_gym_id => v_gym_id,
    p_target_entity_id => p_member_id::text,
    p_target_entity_type => 'member',
    p_metadata => jsonb_build_object(
      'amount', v_price, 'currency', v_currency, 'method', p_method,
      'reason', v_reason, 'payment_id', v_payment_id, 'guest_session_id', v_session.id
    )
  );

  return v_session;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.connect_gym_payment_credentials(p_provider_key text, p_api_key text, p_business_id text, p_webhook_secret text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid;
  v_existing_id uuid;
  v_existing_secret_id uuid;
  v_secret_id uuid;
  v_masked text;
  v_plain text;
  v_secret_json text;
  v_platform_business_id text;
begin
  if (select private.current_member_role())::text is distinct from 'owner' then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  if not exists (select 1 from payment_providers where provider_key = p_provider_key) then
    raise exception 'connect_gym_payment_credentials: unknown provider_key %', p_provider_key;
  end if;

  if p_api_key is null or btrim(p_api_key) = ''
    or p_business_id is null or btrim(p_business_id) = ''
    or p_webhook_secret is null or btrim(p_webhook_secret) = '' then
    raise exception 'connect_gym_payment_credentials: credential values must not be blank';
  end if;

  -- Server-side bound matching the client's Zod max() guards -- the RPC is
  -- directly callable by any authenticated owner session, bypassing the
  -- client schema, so it must not rely solely on client-side validation
  -- (this codebase's own "Server Actions never trust client input"
  -- principle, applied here too).
  if length(p_api_key) > 500 or length(p_business_id) > 200 or length(p_webhook_secret) > 500 then
    raise exception 'connect_gym_payment_credentials: a credential value exceeds the maximum length';
  end if;

  v_plain := btrim(p_business_id);

  -- Platform-collision guard (Story 4.16), scoped to TaraMoney only -- the
  -- whole justification (TaraMoneyProvider.ts's businessId-based webhook
  -- routing) and the Vault secret name are TaraMoney-specific; a future
  -- second provider must not be rejected for an unrelated ID namespace.
  -- Absent secret => no-op, not a hard failure, so an unseeded environment's
  -- connect flow behaves exactly as it did before this story shipped.
  -- order by + limit 1 is defensive: this is the first name-keyed Vault
  -- lookup in this codebase (existing lookups join by primary-key id
  -- instead), so a re-seed resolves deterministically (most-recent wins)
  -- regardless of whether name-uniqueness is enforced upstream.
  -- btrim on the read side matches v_plain's own btrim, so a stray
  -- whitespace/newline introduced while seeding the secret can't silently
  -- defeat the comparison.
  if p_provider_key = 'taramoney' then
    select btrim(v.decrypted_secret) into v_platform_business_id
    from vault.decrypted_secrets v
    where v.name = 'platform:taramoney:business_id'
    order by v.created_at desc
    limit 1;

    if v_platform_business_id is not null and v_plain = v_platform_business_id then
      raise exception 'connect_gym_payment_credentials: business_id_plain matches the platform''s own account';
    end if;
  end if;

  -- A business_id of 4 characters or fewer would otherwise be fully
  -- revealed by right(x, 4) despite the "••••" prefix visually implying
  -- redaction -- NFR-017 says businessId must never be returned to any
  -- client. Real Tara Money business ids are far longer, so this only
  -- guards a defensive/direct-RPC-call edge case.
  v_masked := case
    when length(v_plain) > 4 then '•••• ' || right(v_plain, 4)
    else '••••'
  end;
  v_secret_json := jsonb_build_object(
    'apiKey', p_api_key,
    'businessId', p_business_id,
    'webhookSecret', p_webhook_secret
  )::text;

  -- Serialize concurrent connects for the same (gym, provider) so a
  -- first-time double-connect (double-click, two tabs) can't race between
  -- the existence check and the insert below -- `for update` alone cannot
  -- lock a row that doesn't exist yet, so without this lock both concurrent
  -- calls could see "no existing row" and both attempt `insert`, the second
  -- raising a raw unique-constraint violation instead of resolving cleanly.
  perform pg_advisory_xact_lock(hashtextextended(v_gym_id::text || ':' || p_provider_key, 0));

  select id, credentials_secret_id into v_existing_id, v_existing_secret_id
  from gym_payment_credentials
  where gym_id = v_gym_id and provider_key = p_provider_key
  for update;

  if v_existing_id is not null then
    perform vault.update_secret(v_existing_secret_id, v_secret_json);
    -- connected_at is also bumped here (not just set at insert time) --
    -- run_payment_reconciliation_job()'s wrong_account_settlement check
    -- anchors its comparison to this timestamp (review finding), so an
    -- in-place credential change (e.g. rotating to a different Tara Money
    -- account without an explicit disconnect first) must move the anchor
    -- too, or payments settled under the prior account would be retroactively
    -- flagged against the new one.
    update gym_payment_credentials
    set business_id_masked = v_masked,
      business_id_plain = v_plain,
      needs_attention = false,
      connected_by = private.actor_id(),
      connected_at = now(),
      updated_at = now()
    where id = v_existing_id;
  else
    v_secret_id := vault.create_secret(v_secret_json, 'gym_payment_credentials:' || v_gym_id || ':' || p_provider_key);
    insert into gym_payment_credentials (
      gym_id, provider_key, credentials_secret_id, business_id_masked, business_id_plain, connected_by
    )
    values (v_gym_id, p_provider_key, v_secret_id, v_masked, v_plain, private.actor_id());
  end if;

  -- Metadata must never include the raw apiKey/businessId/webhookSecret
  -- values -- NFR-017's "never logged" extends to the audit trail.
  perform log_audit_event(
    p_action_type => 'gym_payment_credentials_connected',
    p_gym_id => v_gym_id,
    p_target_entity_id => p_provider_key,
    p_target_entity_type => 'gym_payment_credentials',
    p_metadata => jsonb_build_object('provider_key', p_provider_key, 'business_id_masked', v_masked)
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.update_messaging_instance(p_instance_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_previous text;
  v_row_id uuid;
begin
  if not private.is_super_admin() then
    raise exception 'permission denied';
  end if;

  if p_instance_id is null or btrim(p_instance_id) = '' then
    raise exception 'update_messaging_instance: instance_id must not be empty';
  end if;

  -- Lock the singleton row before reading it, for the identical race-safety
  -- reason documented in activate_payment_provider()'s comment (concurrent
  -- callers must not both log a stale previous_instance_id).
  select id, instance_id into v_row_id, v_previous from messaging_provider_config for update;

  update messaging_provider_config
  set instance_id = p_instance_id, updated_by = private.actor_id(), updated_at = now()
  where id = v_row_id;

  -- Saving the same value twice is still a legitimate, intentional Super
  -- Admin action worth its own audit trail entry (unlike
  -- activate_payment_provider's idempotent reactivate case) -- no no-op
  -- short-circuit here.
  --
  -- The audit write is wrapped in its own exception block (review finding):
  -- without it, an audit_log failure would roll back the instance_id update
  -- above via plpgsql's default whole-transaction rollback, blocking AC #2's
  -- "takes effect with no redeploy" guarantee on an unrelated subsystem
  -- failure. A failed audit write is logged and swallowed rather than
  -- re-raised, so the instance change still lands.
  begin
    perform log_audit_event(
      p_action_type => 'messaging_instance_updated',
      p_target_entity_id => v_row_id::text,
      p_target_entity_type => 'messaging_provider_config',
      p_metadata => jsonb_build_object(
        'previous_instance_id', v_previous,
        'new_instance_id', p_instance_id
      )
    );
  exception when others then
    raise warning 'update_messaging_instance: audit log write failed, instance update still applied: %', sqlerrm;
  end;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.front_desk_alerts_protect_columns()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.gym_id is distinct from old.gym_id
    or new.member_id is distinct from old.member_id
    or new.kind is distinct from old.kind
    or new.status is distinct from old.status
    or new.expiry_date is distinct from old.expiry_date
    or new.created_at is distinct from old.created_at
  then
    raise exception 'front_desk_alerts: only dismissed_at/dismissed_by may be updated';
  end if;

  if new.dismissed_at is not null and old.dismissed_at is null then
    new.dismissed_by := private.actor_id();
  end if;

  return new;
end;
$function$
;

-- ===== gym-side reads never return a support membership =====
-- gym_staff_read_own_members admits every row of the gym for an Owner, Manager, Receptionist or Supervisor, the support membership
-- included (accepted as known in 23.6). A RESTRICTIVE select policy now hides it from every reader but the person themselves and a
-- Super Admin (who reads through the Super Admin policies). It is ANDed with every permissive read policy and also applies to the
-- WHERE of an UPDATE or DELETE, so a gym role can neither read nor probe the row. users is self-read only, so a proxy or a support
-- person's users row is already unreadable by any other user.
create policy hide_support_membership on public.members
  as restrictive for select
  using (role <> 'support'::member_role or user_id = (select auth.uid()) or (select private.is_super_admin()));

-- ===== privileges of the replaced functions are unchanged (restated for the guardrail) =====
revoke all on function public.log_audit_event(text, uuid, text, text, jsonb, text) from public, anon;
revoke all on function public.confirm_renewal(uuid, text, text, boolean) from public, anon;
revoke all on function public.initiate_registration_fee_payment(uuid) from public, anon;
revoke all on function public.initiate_session_payment() from public, anon;
revoke all on function public.record_registration_fee(uuid, text, text) from public, anon;
revoke all on function public.record_session_payment(uuid, text, text) from public, anon;
revoke all on function public.connect_gym_payment_credentials(text, text, text, text) from public, anon;
revoke all on function public.update_messaging_instance(text) from public, anon;
revoke all on function public.front_desk_alerts_protect_columns() from public, anon;
