-- Rollback for migration 0140 (support capability allow-list).
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0140-support-capability-allow-list.sql
-- Data effects: members.created_by_support is dropped (the tag is lost; the staff rows stay); unconsumed support step-up grants stay in
-- private.support_stepup and expire by themselves. Restores the pre-0140 bodies (0136 and earlier) of the replaced functions.
set local lock_timeout = '5s';

drop policy if exists support_update_own_gym on public.gyms;
drop policy if exists support_select_gym_logo on storage.objects;
drop policy if exists support_insert_gym_logo on storage.objects;
drop policy if exists support_update_gym_logo on storage.objects;
drop policy if exists support_delete_gym_logo on storage.objects;
drop policy if exists support_read_own_plans on public.plans;
drop policy if exists support_insert_own_plans on public.plans;
drop policy if exists support_update_own_plans on public.plans;
drop policy if exists support_delete_own_plans on public.plans;
drop policy if exists support_read_own_members on public.members;
drop policy if exists support_insert_own_members on public.members;
drop policy if exists support_update_own_members on public.members;
drop policy if exists support_read_own_subscriptions on public.subscriptions;
drop policy if exists support_insert_own_subscriptions on public.subscriptions;
drop policy if exists support_update_own_subscriptions on public.subscriptions;
drop policy if exists support_read_own_payments on public.payments;
drop policy if exists support_insert_own_payments on public.payments;
drop policy if exists support_verify_own_payments on public.payments;
drop policy if exists support_read_own_refunds on public.refunds;
drop policy if exists support_insert_own_refunds on public.refunds;

drop trigger if exists aa_guard_support_gym_columns on public.gyms;
drop trigger if exists aa_guard_support_refund_stepup on public.refunds;
drop function if exists private.guard_support_gym_columns();
drop function if exists private.guard_support_refund_stepup();

CREATE OR REPLACE FUNCTION private.protect_payment_columns_on_staff_verify()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if old.status = 'pending' and (select private.current_member_role())::text = any(array['owner', 'manager', 'receptionist']) then
    new.gym_id := old.gym_id;
    new.member_id := old.member_id;
    new.amount := old.amount;
    new.currency := old.currency;
    new.method := old.method;
    new.reason := old.reason;
    new.actor_id := old.actor_id;
    new.subscription_id := old.subscription_id;
    new.provider := old.provider;
    new.provider_transaction_ref := old.provider_transaction_ref;
    new.provider_fee_amount := old.provider_fee_amount;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$function$

;

CREATE OR REPLACE FUNCTION private.stepup_issue(p_user uuid, p_action text, p_subject text)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_expires timestamptz;
begin
  if p_user is null or p_subject is null or p_action is null then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if p_action not in ('remove_super_admin_factor', 'create_super_admin', 'change_recovery_email', 'remove_recovery_email') then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if not coalesce((select u.is_super_admin from users u where u.id = p_user), false) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if not private.super_admin_aal2_required() or private.super_admin_locked(p_user) then
    return null;
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

CREATE OR REPLACE FUNCTION private.current_gym_status()
 RETURNS gym_status
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status gym_status;
begin
  select status into v_status
  from gyms
  where id = private.gym_id();

  return v_status;
end;
$function$

;

CREATE OR REPLACE FUNCTION public.set_registration_fee(p_amount integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid;
  v_old integer;
begin
  -- Fail closed: a missing app_role claim makes the comparison NULL, and
  -- `not NULL` would skip the raise.
  if not coalesce((select private.current_member_role())::text = any(array['supervisor', 'owner']), false) then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  if private.current_gym_status() is distinct from 'active' then
    raise exception 'set_registration_fee: gym % is not active', v_gym_id;
  end if;

  if p_amount is null or p_amount < 0 then
    raise exception 'set_registration_fee: invalid_amount';
  end if;

  select g.registration_fee into v_old from gyms g where g.id = v_gym_id for update;

  if v_old is not distinct from p_amount then
    return;
  end if;

  perform set_config('app.registration_fee_update_bypass', 'true', true);

  update gyms set registration_fee = p_amount where id = v_gym_id;

  perform set_config('app.registration_fee_update_bypass', 'false', true);

  perform log_audit_event(
    p_action_type => 'registration_fee_changed',
    p_gym_id => v_gym_id,
    p_target_entity_id => v_gym_id::text,
    p_target_entity_type => 'gym',
    p_metadata => jsonb_build_object('old_amount', v_old, 'new_amount', p_amount)
  );
end;
$function$

;

CREATE OR REPLACE FUNCTION public.waive_registration_fee(p_member_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid;
  v_role member_role;
  v_deactivated_at timestamptz;
  v_settled_at timestamptz;
  v_reason text;
begin
  if not coalesce((select private.current_member_role())::text = any(array['owner', 'supervisor', 'manager']), false) then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  if private.current_gym_status() is distinct from 'active' then
    raise exception 'waive_registration_fee: gym % is not active', v_gym_id;
  end if;

  v_reason := btrim(p_reason, E' \t\r\n');
  if v_reason is null or v_reason = '' then
    raise exception 'waive_registration_fee: reason is required';
  end if;
  if char_length(v_reason) > 200 then
    raise exception 'waive_registration_fee: reason is too long';
  end if;

  -- Payment row before member row (lock order).
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

  if exists (
    select 1 from payments p
    where p.member_id = p_member_id
      and p.purpose = 'registration_fee'
      and p.voided_at is null
      and p.status = 'processing'
  ) then
    raise exception 'registration_fee_already_pending: member % has a registration fee payment in progress', p_member_id;
  end if;

  if v_settled_at is not null then
    raise exception 'registration_fee_not_due: member % has no registration fee outstanding', p_member_id;
  end if;

  update members set registration_fee_settled_at = now()
  where id = p_member_id and registration_fee_settled_at is null;

  perform log_audit_event(
    p_action_type => 'registration_fee_waived',
    p_gym_id => v_gym_id,
    p_target_entity_id => p_member_id::text,
    p_target_entity_type => 'member',
    p_metadata => jsonb_build_object('reason', v_reason)
  );
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
  if not coalesce((select private.current_member_role())::text = any(array['owner', 'manager', 'supervisor', 'receptionist']), false) then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  if private.current_gym_status() is distinct from 'active' then
    raise exception 'record_registration_fee: gym % is not active', v_gym_id;
  end if;

  v_actor_id := auth.uid();

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

CREATE OR REPLACE FUNCTION public.set_guest_charging(p_enabled boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid;
  v_old boolean;
begin
  if not coalesce(private.current_member_role() in ('owner', 'supervisor'), false) then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  if private.current_gym_status() is distinct from 'active' then
    raise exception 'set_guest_charging: gym % is not active', v_gym_id;
  end if;

  if p_enabled is null then
    raise exception 'set_guest_charging: invalid_value';
  end if;

  select g.charge_guests_per_session into v_old
  from gyms g where g.id = v_gym_id for update;

  if v_old is not distinct from p_enabled then
    return;
  end if;

  perform set_config('app.guest_charging_update_bypass', 'true', true);

  update gyms set charge_guests_per_session = p_enabled where id = v_gym_id;

  perform set_config('app.guest_charging_update_bypass', 'false', true);

  perform log_audit_event(
    p_action_type => 'guest_charging_changed',
    p_gym_id => v_gym_id,
    p_target_entity_id => v_gym_id::text,
    p_target_entity_type => 'gym',
    p_metadata => jsonb_build_object('old_enabled', v_old, 'new_enabled', p_enabled)
  );
end;
$function$

;

CREATE OR REPLACE FUNCTION public.set_loyalty_program(p_enabled boolean, p_n integer, p_k integer, p_r integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid;
  v_old gyms%rowtype;
  v_new_enabled boolean;
  v_new_n integer;
  v_new_k integer;
  v_new_r integer;
begin
  if not coalesce(private.current_member_role() in ('owner', 'supervisor'), false) then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  if private.current_gym_status() is distinct from 'active' then
    raise exception 'set_loyalty_program: gym % is not active', v_gym_id;
  end if;

  if p_enabled is null then
    raise exception 'set_loyalty_program: invalid_value';
  end if;

  if p_enabled and (
       p_n is null or p_n not between 2 and 50
       or p_k is null or p_k not between 3 and 24
       or p_r is null or p_r not between 1 and 30
     ) then
    raise exception 'set_loyalty_program: invalid_value';
  end if;

  select * into v_old from gyms g where g.id = v_gym_id for update;

  if p_enabled then
    v_new_enabled := true;
    v_new_n := p_n;
    v_new_k := p_k;
    v_new_r := p_r;
  else
    -- Disabling keeps the stored thresholds.
    v_new_enabled := false;
    v_new_n := v_old.loyalty_guest_threshold;
    v_new_k := v_old.loyalty_renewal_threshold;
    v_new_r := v_old.loyalty_reward_days;
  end if;

  if v_old.loyalty_enabled is not distinct from v_new_enabled
     and v_old.loyalty_guest_threshold is not distinct from v_new_n
     and v_old.loyalty_renewal_threshold is not distinct from v_new_k
     and v_old.loyalty_reward_days is not distinct from v_new_r then
    return;
  end if;

  perform set_config('app.loyalty_program_update_bypass', 'true', true);

  update gyms
  set loyalty_enabled = v_new_enabled,
      loyalty_guest_threshold = v_new_n,
      loyalty_renewal_threshold = v_new_k,
      loyalty_reward_days = v_new_r
  where id = v_gym_id;

  perform set_config('app.loyalty_program_update_bypass', 'false', true);

  perform log_audit_event(
    p_action_type => 'loyalty_program_changed',
    p_gym_id => v_gym_id,
    p_target_entity_id => v_gym_id::text,
    p_target_entity_type => 'gym',
    p_metadata => jsonb_build_object(
      'old', jsonb_build_object(
        'enabled', v_old.loyalty_enabled,
        'guest_threshold', v_old.loyalty_guest_threshold,
        'renewal_threshold', v_old.loyalty_renewal_threshold,
        'reward_days', v_old.loyalty_reward_days
      ),
      'new', jsonb_build_object(
        'enabled', v_new_enabled,
        'guest_threshold', v_new_n,
        'renewal_threshold', v_new_k,
        'reward_days', v_new_r
      )
    )
  );
end;
$function$

;

CREATE OR REPLACE FUNCTION public.set_gym_category(p_gym_id uuid, p_category text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_is_super_admin boolean;
  v_old text;
  v_status gym_status;
begin
  v_is_super_admin := coalesce(private.is_super_admin_live(), false);

  if not v_is_super_admin then
    if p_gym_id is null
       or p_gym_id is distinct from private.gym_id()
       or not coalesce(private.current_member_role() in ('owner', 'supervisor'), false) then
      raise exception 'permission denied';
    end if;
  end if;

  if p_gym_id is null then
    raise exception 'set_gym_category: gym not found';
  end if;

  if p_category is null
     or p_category not in ('gym', 'pilates_studio', 'yoga_studio', 'fitness_center', 'other') then
    raise exception 'set_gym_category: invalid_category';
  end if;

  select g.category, g.status into v_old, v_status
  from gyms g where g.id = p_gym_id for update;

  if not found then
    raise exception 'set_gym_category: gym not found';
  end if;

  if not v_is_super_admin and v_status is distinct from 'active' then
    raise exception 'set_gym_category: gym % is not active', p_gym_id;
  end if;

  if v_old is not distinct from p_category then
    return;
  end if;

  perform set_config('app.gym_category_update_bypass', 'true', true);

  update gyms set category = p_category where id = p_gym_id;

  perform set_config('app.gym_category_update_bypass', 'false', true);

  perform log_audit_event(
    p_action_type => 'gym_category_changed',
    p_gym_id => p_gym_id,
    p_target_entity_id => p_gym_id::text,
    p_target_entity_type => 'gym',
    p_metadata => jsonb_build_object('old_category', v_old, 'new_category', p_category)
  );
end;
$function$

;

CREATE OR REPLACE FUNCTION public.update_plan_pricing(p_plan_id uuid, p_plan_type plan_type, p_price integer, p_duration_days integer, p_billing_interval billing_interval, p_annual_discount_percent integer, p_name text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid;
  v_old_type plan_type;
  v_old_price integer;
begin
  if not coalesce(private.current_member_role() in ('owner', 'manager', 'supervisor'), false) then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  if private.current_gym_status() is distinct from 'active' then
    raise exception 'update_plan_pricing: gym % is not active', v_gym_id;
  end if;

  if p_plan_type is null or p_price is null or p_billing_interval is null or p_price < 0
     or (p_name is not null and btrim(p_name) = '') then
    raise exception 'update_plan_pricing: invalid_input';
  end if;

  select pl.plan_type, pl.price into v_old_type, v_old_price
  from plans pl
  where pl.id = p_plan_id and pl.gym_id = v_gym_id
  for update;

  if not found then
    raise exception 'update_plan_pricing: plan_not_found';
  end if;

  if v_old_type is distinct from p_plan_type
     and exists (select 1 from subscriptions s where s.plan_id = p_plan_id) then
    raise exception 'plan_type_locked: this plan has subscriptions, so its type cannot change; create a new plan instead'
      using errcode = 'check_violation';
  end if;

  update plans
  set name = coalesce(btrim(p_name), name),
      plan_type = p_plan_type,
      price = p_price,
      duration_days = p_duration_days,
      billing_interval = p_billing_interval,
      annual_discount_percent = p_annual_discount_percent
  where id = p_plan_id;

  if v_old_type is distinct from p_plan_type then
    perform log_audit_event(
      p_action_type => 'plan_type_changed',
      p_gym_id => v_gym_id,
      p_target_entity_id => p_plan_id::text,
      p_target_entity_type => 'plan',
      p_metadata => jsonb_build_object('old_plan_type', v_old_type, 'new_plan_type', p_plan_type)
    );
  end if;

  if v_old_price is distinct from p_price then
    perform log_audit_event(
      p_action_type => 'plan_price_changed',
      p_gym_id => v_gym_id,
      p_target_entity_id => p_plan_id::text,
      p_target_entity_type => 'plan',
      p_metadata => jsonb_build_object('old_price', v_old_price, 'new_price', p_price)
    );
  end if;
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
  v_caller_role := private.current_member_role();

  if not coalesce(v_caller_role in ('owner', 'manager', 'supervisor', 'receptionist'), false) then
    raise exception 'permission denied';
  end if;

  -- Bank transfer is a manager-and-above method.
  if p_method = 'bank_transfer' and v_caller_role = 'receptionist' then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  if private.current_gym_status() is distinct from 'active' then
    raise exception 'record_session_payment: gym % is not active', v_gym_id;
  end if;

  v_actor_id := auth.uid();

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

CREATE OR REPLACE FUNCTION public.renew_subscription(p_member_id uuid, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_gym_id uuid;
  v_member_gym_id uuid;
  v_deactivated_at timestamptz;
  v_plan_id uuid;
  v_duration_days integer;
  v_new_expiry date;
  v_new_id uuid;
begin
  if not coalesce((select private.current_member_role())::text = any(array['owner', 'manager', 'supervisor', 'receptionist']), false) then
    raise exception 'permission denied';
  end if;

  v_caller_gym_id := private.gym_id();
  if v_caller_gym_id is null then
    raise exception 'permission denied';
  end if;

  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'renew_subscription: gym % is not active', v_caller_gym_id;
  end if;

  -- Gym-scoped in the query itself (not a separate post-check) so a member
  -- belonging to another gym produces the exact same "not found" outcome as
  -- a truly nonexistent id -- avoids letting a caller enumerate whether a
  -- given member id exists in some other gym, matching this codebase's own
  -- established "uniform 0-rows failure mode" tenant-isolation philosophy
  -- (see 0002/0007/0008's table-grant comments on the same principle).
  select gym_id, deactivated_at into v_member_gym_id, v_deactivated_at
  from members where id = p_member_id and gym_id = v_caller_gym_id;

  if v_member_gym_id is null then
    raise exception 'renew_subscription: member % not found', p_member_id;
  end if;

  if v_deactivated_at is not null then
    raise exception 'renew_subscription: member % is deactivated and cannot be renewed', p_member_id;
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'renew_subscription: reason is required';
  end if;

  select s.plan_id into v_plan_id
  from subscriptions s
  where s.member_id = p_member_id
  order by s.created_at desc
  limit 1;

  if v_plan_id is null then
    raise exception 'renew_subscription: member % has no existing subscription to renew', p_member_id;
  end if;

  select duration_days into v_duration_days from plans where id = v_plan_id;
  v_new_expiry := case when v_duration_days is null then null else current_date + v_duration_days end;

  insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
  values (v_member_gym_id, p_member_id, v_plan_id, 'active', current_date, v_new_expiry)
  returning id into v_new_id;

  perform log_audit_event(
    p_action_type => 'subscription_manual_renewal',
    p_gym_id => v_member_gym_id,
    p_target_entity_id => p_member_id::text,
    p_target_entity_type => 'member',
    p_metadata => jsonb_build_object(
      'reason', p_reason,
      'subscription_id', v_new_id,
      'plan_id', v_plan_id,
      'new_expiry_date', v_new_expiry
    )
  );

  return v_new_id;
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
  v_caller_gym_id := private.gym_id();
  if v_caller_gym_id is null then
    raise exception 'permission denied';
  end if;

  -- AD-3 / 19.1 lint: the role comes from private.current_member_role(), not the
  -- JWT claim 0093 read. Same allowlist; a caller with no active membership in
  -- the gym is refused as before. Role resolution comes BEFORE the suspension
  -- gate (code review 2026-09-09 rule, see tenant_suspension_enforcement.test.sql):
  -- an unauthorized caller at a suspended gym must not learn the gym status.
  if not coalesce(private.current_member_role() in ('owner', 'manager', 'supervisor', 'receptionist'), false) then
    raise exception 'permission denied';
  end if;

  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'confirm_renewal: gym % is not active', v_caller_gym_id;
  end if;
  v_actor_id := auth.uid();

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

alter table public.members drop column if exists created_by_support;
drop function if exists private.support_stepup_require(text, text);
drop function if exists private.support_rpc_role(text);
drop function if exists private.support_rpc_gym_id(text);
drop table if exists private.support_capabilities;
