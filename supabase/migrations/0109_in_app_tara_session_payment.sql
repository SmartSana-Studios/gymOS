-- ============================================================================
-- 0109: In-app Tara Money session payment (Epic 19, Story 19.5).
--
-- A session guest can pay for a session from the app. Database side only: the
-- screens are 19.11, nothing consumes a session yet (19.6b / 19.7), and there
-- is no new Edge Function -- payment-webhook already dispatches initiate and
-- completion by payment row and both of its filters accept a `processing`
-- `session` row.
--
--   initiate_session_payment()                 the member starts a Tara payment
--   payments_one_inflight_session_per_member   partial unique index
--   private.create_guest_session_for_payment() gains caller assertions
--   complete_verified_payment()                locks payment then member on
--                                              every purpose branch; session
--                                              branch; late session handling
--
-- Design choices worth knowing before editing this file:
--
--  * The new payment is `processing`, not `pending`: the webhook's initiate and
--    completion paths filter on `processing`, as the registration-fee flow
--    does. No `pending` session payment is ever created by this function.
--
--  * Amount and currency come from the plan of the member's latest
--    subscription (created_at desc, id desc), never a parameter.
--
--  * Lock order (canonical, Epic 19): payment row, then member row
--    (FOR NO KEY UPDATE). complete_verified_payment now takes the member lock
--    on every purpose branch, before any other write, so a renewal
--    confirmation and a desk action on one member serialize instead of
--    interleaving. FOR NO KEY UPDATE does not conflict with the FOR KEY SHARE
--    taken by foreign-key checks.
--
--  * Late confirmation: a session payment flagged `expired_attempt` that Tara
--    later confirms becomes `verified` with flagged_reason `late_confirmation`
--    (a non-flagged row may carry a reason, see 0106), one session is created
--    and the late payment is audited. The other flag reasons (wrong_account,
--    reconciliation_mismatch, staff_flagged, provider_declined) never yield a
--    session and the row is left unchanged for staff.
--
--  * The caller of initiate_session_payment is the member; the deactivated
--    case is reached through the member row itself, because
--    current_member_role() only sees active rows.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- One in-flight session payment per member (the check in the RPC gives the
-- clean error; this index closes the concurrent-call race).
-- ----------------------------------------------------------------------------
create unique index payments_one_inflight_session_per_member
  on payments (member_id)
  where purpose = 'session' and voided_at is null and status in ('pending', 'processing');

-- ----------------------------------------------------------------------------
-- The session-creation helper now has two callers, so it asserts what the
-- callers promise: a verified session payment for this member and gym.
-- ----------------------------------------------------------------------------
create or replace function private.create_guest_session_for_payment(p_payment_id uuid, p_member_id uuid, p_gym_id uuid)
returns guest_sessions
language plpgsql
set search_path = public
as $$
declare
  v_days integer;
  v_session guest_sessions;
begin
  if not exists (
    select 1 from payments p
    where p.id = p_payment_id
      and p.purpose = 'session'
      and p.status = 'verified'
      and p.member_id = p_member_id
      and p.gym_id = p_gym_id
  ) then
    raise exception 'invalid_session_payment: payment % is not a verified session payment for member % in gym %',
      p_payment_id, p_member_id, p_gym_id;
  end if;

  select c.paid_session_validity_days into v_days from platform_session_config c limit 1;

  if v_days is null then
    raise exception 'session_config_missing: platform_session_config has no row';
  end if;

  insert into guest_sessions (gym_id, member_id, payment_id, usable_until)
  values (p_gym_id, p_member_id, p_payment_id, now() + make_interval(days => v_days))
  returning * into v_session;

  return v_session;
end;
$$;

revoke execute on function private.create_guest_session_for_payment(uuid, uuid, uuid) from public, anon;

-- ----------------------------------------------------------------------------
-- initiate_session_payment(): the member starts a Tara payment for a session.
--
-- Check order: role, gym, suspension, member row, charging flag, then the
-- expiry flag (payment rows) and the member lock, then deactivated, fee not
-- settled, plan type, price, in flight, provider and credentials.
-- ----------------------------------------------------------------------------
create function initiate_session_payment()
returns table (payment_id uuid, provider_key text)
language plpgsql
security definer
set search_path = public
as $$
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
    values (v_gym_id, v_member_id, null, v_price, v_currency, 'mobile_money', 'processing', v_provider, auth.uid(), 'session')
    returning id into v_payment_id;
  exception when unique_violation then
    raise exception 'session_payment_already_in_progress: member % has a session payment in progress', v_member_id;
  end;

  payment_id := v_payment_id;
  provider_key := v_provider;
  return next;
  return;
end;
$$;

revoke execute on function initiate_session_payment() from public, anon;
grant execute on function initiate_session_payment() to authenticated;

-- ----------------------------------------------------------------------------
-- complete_verified_payment(): 0106's body with
--   * the payment row locked, then the member row locked (FOR NO KEY UPDATE),
--     before any other write, on every branch;
--   * a `session` branch creating one guest_sessions row;
--   * the late branch extended to session payments flagged expired_attempt.
-- Registration fee and subscription behavior is unchanged.
-- ----------------------------------------------------------------------------
create or replace function complete_verified_payment(p_payment_id uuid, p_fee_amount integer)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
  v_member_id uuid;
  v_purpose text;
  v_amount integer;
  v_currency text;
  v_status payment_status;
  v_flagged_reason text;
  v_deactivated_at timestamptz;
  v_plan_id uuid;
  v_duration_days integer;
  v_new_expiry date;
  v_new_subscription_id uuid;
  v_session guest_sessions;
begin
  -- Lock order: payment row, then member row, before any other write.
  select p.gym_id, p.member_id, p.purpose, p.amount, p.currency, p.status, p.flagged_reason
    into v_gym_id, v_member_id, v_purpose, v_amount, v_currency, v_status, v_flagged_reason
  from payments p
  where p.id = p_payment_id
  for update;

  if not found then
    raise notice 'complete_verified_payment: payment % already verified or not found -- no-op', p_payment_id;
    return null;
  end if;

  perform 1 from members m where m.id = v_member_id for no key update;

  if v_status is distinct from 'processing' then
    -- A late success for an attempt that expiry already flagged: the member
    -- was charged but the row was not applied.
    if v_status = 'flagged' and v_purpose = 'registration_fee' then
      -- Leave a trace so staff can find and refund it. Once per payment, so a
      -- redelivered webhook does not repeat it.
      if not exists (
        select 1 from audit_log a
        where a.action_type = 'registration_fee_late_payment'
          and a.metadata ->> 'payment_id' = p_payment_id::text
      ) then
        update payments
        set flagged_reason = 'late_confirmation'
        where id = p_payment_id and status = 'flagged'
          and flagged_reason in ('expired_attempt', 'provider_declined');

        perform log_audit_event(
          p_action_type => 'registration_fee_late_payment',
          p_gym_id => v_gym_id,
          p_target_entity_id => v_member_id::text,
          p_target_entity_type => 'member',
          p_metadata => jsonb_build_object(
            'payment_id', p_payment_id,
            'amount', v_amount,
            'currency', 'XAF',
            'fee_amount', p_fee_amount
          ),
          p_system_actor_label => 'payment-webhook'
        );
      end if;
    elsif v_status = 'flagged' and v_purpose = 'session' and v_flagged_reason = 'expired_attempt' then
      -- The late session case: the money is real, so the payment is verified
      -- and the session is created. Only an expired attempt qualifies;
      -- wrong_account, reconciliation_mismatch, staff_flagged and
      -- provider_declined never yield a session.
      update payments
      set status = 'verified', flagged_reason = 'late_confirmation', provider_fee_amount = p_fee_amount
      where id = p_payment_id and status = 'flagged' and flagged_reason = 'expired_attempt';

      v_session := private.create_guest_session_for_payment(p_payment_id, v_member_id, v_gym_id);

      perform log_audit_event(
        p_action_type => 'session_late_payment',
        p_gym_id => v_gym_id,
        p_target_entity_id => v_member_id::text,
        p_target_entity_type => 'member',
        p_metadata => jsonb_build_object(
          'payment_id', p_payment_id,
          'guest_session_id', v_session.id,
          'amount', v_amount,
          'currency', v_currency,
          'method', 'mobile_money',
          'fee_amount', p_fee_amount
        ),
        p_system_actor_label => 'payment-webhook'
      );
    end if;

    raise notice 'complete_verified_payment: payment % already verified or not found -- no-op', p_payment_id;
    return null;
  end if;

  update payments
  set status = 'verified', provider_fee_amount = p_fee_amount
  where id = p_payment_id and status = 'processing';

  if v_purpose = 'registration_fee' then
    -- The money is real whatever the member's state, so the payment stays
    -- verified. coalesce keeps an earlier settlement time if there is one.
    update members
    set registration_fee_settled_at = coalesce(registration_fee_settled_at, now())
    where id = v_member_id;

    perform log_audit_event(
      p_action_type => 'registration_fee_paid',
      p_gym_id => v_gym_id,
      p_target_entity_id => v_member_id::text,
      p_target_entity_type => 'member',
      p_metadata => jsonb_build_object(
        'payment_id', p_payment_id,
        'amount', v_amount,
        'currency', 'XAF',
        'method', 'mobile_money',
        'fee_amount', p_fee_amount
      ),
      p_system_actor_label => 'payment-webhook'
    );

    return null;
  end if;

  if v_purpose = 'session' then
    -- Verified whatever the member's state; one session per payment (the
    -- unique index on guest_sessions.payment_id backs this).
    v_session := private.create_guest_session_for_payment(p_payment_id, v_member_id, v_gym_id);

    perform log_audit_event(
      p_action_type => 'session_payment_paid',
      p_gym_id => v_gym_id,
      p_target_entity_id => v_member_id::text,
      p_target_entity_type => 'member',
      p_metadata => jsonb_build_object(
        'payment_id', p_payment_id,
        'guest_session_id', v_session.id,
        'amount', v_amount,
        'currency', v_currency,
        'method', 'mobile_money',
        'fee_amount', p_fee_amount
      ),
      p_system_actor_label => 'payment-webhook'
    );

    return null;
  end if;

  select deactivated_at into v_deactivated_at from members where id = v_member_id;

  if v_deactivated_at is not null then
    raise notice 'complete_verified_payment: member % is deactivated -- payment % stays verified, renewal skipped', v_member_id, p_payment_id;
    return null;
  end if;

  select s.plan_id into v_plan_id
  from subscriptions s
  where s.member_id = v_member_id
  order by s.created_at desc
  limit 1;

  if v_plan_id is null then
    -- Defensive only -- payment stays verified, renewal skipped.
    raise notice 'complete_verified_payment: member % has no subscription to renew -- payment % stays verified, renewal skipped', v_member_id, p_payment_id;
    return null;
  end if;

  select duration_days into v_duration_days from plans where id = v_plan_id;
  v_new_expiry := case when v_duration_days is null then null else current_date + v_duration_days end;

  insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
  values (v_gym_id, v_member_id, v_plan_id, 'active', current_date, v_new_expiry)
  returning id into v_new_subscription_id;

  update payments set subscription_id = v_new_subscription_id where id = p_payment_id;

  perform log_audit_event(
    p_action_type => 'subscription_payment_renewal',
    p_gym_id => v_gym_id,
    p_target_entity_id => v_member_id::text,
    p_target_entity_type => 'member',
    p_metadata => jsonb_build_object(
      'payment_id', p_payment_id,
      'subscription_id', v_new_subscription_id,
      'plan_id', v_plan_id,
      'new_expiry_date', v_new_expiry,
      'fee_amount', p_fee_amount
    ),
    p_system_actor_label => 'payment-webhook'
  );

  return v_new_subscription_id;
end;
$$;

revoke execute on function complete_verified_payment(uuid, integer) from public, anon, authenticated;
grant execute on function complete_verified_payment(uuid, integer) to service_role;

-- ----------------------------------------------------------------------------
-- Post-condition assertions.
-- ----------------------------------------------------------------------------
do $verify$
begin
  if not (select p.prosecdef from pg_proc p
          where p.oid = 'public.initiate_session_payment()'::regprocedure) then
    raise exception '0109: initiate_session_payment must be SECURITY DEFINER';
  end if;

  if (select p.prosecdef from pg_proc p
      where p.oid = 'private.create_guest_session_for_payment(uuid, uuid, uuid)'::regprocedure) then
    raise exception '0109: the session creation helper must stay SECURITY INVOKER';
  end if;

  -- A NULL proacl is the default ACL, which includes EXECUTE for PUBLIC.
  if exists (
    select 1 from pg_proc p
    where p.oid in ('public.initiate_session_payment()'::regprocedure,
                    'public.complete_verified_payment(uuid, integer)'::regprocedure,
                    'private.create_guest_session_for_payment(uuid, uuid, uuid)'::regprocedure)
      and (
        p.proacl is null
        or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
        or exists (
          select 1 from aclexplode(p.proacl) a
          where a.privilege_type = 'EXECUTE'
            and a.grantee in (select oid from pg_roles where rolname = 'anon')
        )
      )
  ) then
    raise exception '0109: EXECUTE must not be granted to PUBLIC or anon';
  end if;

  if exists (
    select 1 from pg_proc p, aclexplode(p.proacl) a
    where p.oid = 'public.complete_verified_payment(uuid, integer)'::regprocedure
      and a.privilege_type = 'EXECUTE'
      and a.grantee in (select oid from pg_roles where rolname = 'authenticated')
  ) then
    raise exception '0109: complete_verified_payment must not be executable by authenticated';
  end if;

  if not exists (
    select 1 from pg_proc p, aclexplode(p.proacl) a
    where p.oid = 'public.initiate_session_payment()'::regprocedure
      and a.privilege_type = 'EXECUTE'
      and a.grantee = (select oid from pg_roles where rolname = 'authenticated')
  ) then
    raise exception '0109: initiate_session_payment must be executable by authenticated';
  end if;

  if exists (
    select 1 from pg_proc p
    where p.oid = 'public.initiate_session_payment()'::regprocedure
      and not (p.prosrc ~* 'current_gym_status\(\)\s+is\s+distinct\s+from\s+''active''')
  ) then
    raise exception '0109: initiate_session_payment must carry the fail-closed suspension guard';
  end if;

  -- Expiry flag before the member lock.
  if exists (
    select 1 from pg_proc p
    where p.oid = 'public.initiate_session_payment()'::regprocedure
      and (position('expire_stale_payment' in p.prosrc) = 0
           or position('expire_stale_payment' in p.prosrc) > position('for no key update' in p.prosrc))
  ) then
    raise exception '0109: the expiry flag must run before the member row lock';
  end if;

  -- complete_verified_payment: payment lock, then member lock, then any write.
  if exists (
    select 1 from pg_proc p
    where p.oid = 'public.complete_verified_payment(uuid, integer)'::regprocedure
      and (position('for update' in p.prosrc) = 0
           or position('for no key update' in p.prosrc) = 0
           or position('for update' in p.prosrc) > position('for no key update' in p.prosrc)
           or position('for no key update' in p.prosrc) > position('update payments' in p.prosrc))
  ) then
    raise exception '0109: complete_verified_payment must lock the payment row, then the member row, before any write';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'payments_one_inflight_session_per_member'
      and indexdef ilike '%unique%' and indexdef ilike '%where%'
  ) then
    raise exception '0109: payments_one_inflight_session_per_member must be a partial unique index';
  end if;
end;
$verify$;
