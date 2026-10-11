-- ============================================================================
-- 0106: Flagged-payment reason (Epic 19, Story 19.2).
--
-- Late-confirmed and wrong-account Tara payments are both stored
-- status = 'flagged' with nothing to tell them apart. Epic 19's session branch
-- applies a late payment and never applies a wrong-account one, so a payment
-- now carries WHY it was flagged.
--
--   payments.flagged_reason            closed-set text, nullable
--   payments_flagged_reason_check      the closed set
--   payments_flagged_requires_reason   one-directional: flagged => reason set.
--                                      A non-flagged row MAY carry a reason:
--                                      Story 19.5 puts late_confirmation on a
--                                      verified session payment.
--
-- Reasons
--   late_confirmation        Tara confirmed success after the attempt was flagged
--   wrong_account            settled to the wrong account (first produced by 19.5;
--                            backfilled here from wrong_account_settlement rows)
--   expired_attempt          a `processing` fee attempt older than ten minutes
--   reconciliation_mismatch  flagged, no other evidence (backfill fallback)
--   provider_declined        the provider reported failure (complete_flagged_payment)
--   staff_flagged            a staff "Flag for Review" (pending -> flagged)
--
-- Design choices worth knowing before editing this file:
--
--  * The reconciliation jobs write payment_discrepancies and never touch
--    payments.status, so they set no reason. `reconciliation_mismatch` exists
--    for the backfill fallback only.
--
--  * Every server path that flags a payment sets the reason in the same
--    statement as the status change. Replacement bodies copy 0100 / 0048 and
--    change only the reason writes: who is flagged, when, notifications and
--    audit codes are unchanged.
--
--  * Staff flag a payment with a direct UPDATE under their own session. The
--    existing pin trigger (0099, INVOKER) is extended: for authenticated/anon
--    a write to flagged_reason is reverted to the old value, and a status move
--    into 'flagged' forces 'staff_flagged'. A service-role write of a code
--    outside the set is rejected by the CHECK, not the trigger.
--
--  * Existing direct inserts of status = 'flagged' without a reason now fail
--    the CHECK. That is deliberate: every writer names its reason.
-- ============================================================================

alter table payments add column flagged_reason text;

alter table payments
  add constraint payments_flagged_reason_check
    check (flagged_reason in (
      'late_confirmation',
      'wrong_account',
      'expired_attempt',
      'reconciliation_mismatch',
      'provider_declined',
      'staff_flagged'
    ));

-- ----------------------------------------------------------------------------
-- Backfill. Evidence order, strongest first: a wrong_account_settlement
-- discrepancy, the late-payment audit row, the expiry audit row, the webhook
-- failure audit row, the manual queue's flag audit row; else
-- reconciliation_mismatch. Runs as the migration owner, so the pin trigger
-- (authenticated/anon only) does not apply.
-- ----------------------------------------------------------------------------
update payments p
set flagged_reason = case
  when exists (
    select 1 from payment_discrepancies d
    where d.payment_id = p.id and d.discrepancy_type = 'wrong_account_settlement'
  ) then 'wrong_account'
  when exists (
    select 1 from audit_log a
    where a.action_type = 'registration_fee_late_payment'
      and a.metadata ->> 'payment_id' = p.id::text
  ) then 'late_confirmation'
  when exists (
    select 1 from audit_log a
    where a.action_type = 'registration_fee_attempt_expired'
      and a.metadata ->> 'payment_id' = p.id::text
  ) then 'expired_attempt'
  when exists (
    select 1 from audit_log a
    where a.action_type = 'payment_verification_failed'
      and a.metadata ->> 'payment_id' = p.id::text
  ) then 'provider_declined'
  when exists (
    select 1 from audit_log a
    where a.action_type = 'payment_flagged'
      and a.target_entity_id = p.id::text
  ) then 'staff_flagged'
  else 'reconciliation_mismatch'
end
where p.status = 'flagged' and p.flagged_reason is null;

alter table payments
  add constraint payments_flagged_requires_reason
    check (status <> 'flagged' or flagged_reason is not null);

-- ----------------------------------------------------------------------------
-- Pin trigger: 0099's body, plus flagged_reason. Authenticated/anon cannot
-- write the reason; a status move into 'flagged' is by definition a staff
-- flag (the only authenticated path the RLS policy allows is pending ->
-- flagged), so the reason is forced here and the CHECK is satisfied.
-- ----------------------------------------------------------------------------
create or replace function private.protect_payment_purpose_and_void()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if TG_OP = 'INSERT' then
      -- A client cannot create a row that already carries a reason.
      new.flagged_reason := null;
    else
      new.voided_at := old.voided_at;
      new.purpose := old.purpose;
      new.flagged_reason := old.flagged_reason;
      if new.status = 'flagged' and old.status is distinct from 'flagged' then
        new.flagged_reason := coalesce(old.flagged_reason, 'staff_flagged');
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function private.protect_payment_purpose_and_void() from public, anon;

drop trigger protect_payment_purpose_and_void on payments;

create trigger protect_payment_purpose_and_void
  before update of voided_at, purpose, flagged_reason, status on payments
  for each row execute function private.protect_payment_purpose_and_void();

create trigger protect_payment_flagged_reason_on_insert
  before insert on payments
  for each row execute function private.protect_payment_purpose_and_void();

-- ----------------------------------------------------------------------------
-- Expiry helper: 0100's body, plus the reason on the flagging UPDATE.
-- ----------------------------------------------------------------------------
create or replace function private.expire_stale_registration_fee_payment(p_member_id uuid, p_gym_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_payment_id uuid;
begin
  update payments
  set status = 'flagged', flagged_reason = 'expired_attempt'
  where member_id = p_member_id
    and gym_id = p_gym_id
    and purpose = 'registration_fee'
    and voided_at is null
    and status = 'processing'
    and created_at < now() - interval '10 minutes'
  returning id into v_payment_id;

  if v_payment_id is not null then
    perform log_audit_event(
      p_action_type => 'registration_fee_attempt_expired',
      p_gym_id => p_gym_id,
      p_target_entity_id => p_member_id::text,
      p_target_entity_type => 'member',
      p_metadata => jsonb_build_object('payment_id', v_payment_id)
    );
  end if;
end;
$$;

revoke execute on function private.expire_stale_registration_fee_payment(uuid, uuid) from public, anon;

-- ----------------------------------------------------------------------------
-- complete_flagged_payment(): 0048's body, plus the reason.
-- ----------------------------------------------------------------------------
create or replace function complete_flagged_payment(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_gym_id uuid;
  v_member_id uuid;
  v_amount integer;
  v_method text;
begin
  update payments
  set status = 'flagged', flagged_reason = 'provider_declined'
  where id = p_payment_id and status = 'processing'
  returning id, gym_id, member_id, amount, method
    into v_id, v_gym_id, v_member_id, v_amount, v_method;

  if v_id is null then
    raise notice 'complete_flagged_payment: payment % already left processing or not found -- no-op', p_payment_id;
    return;
  end if;

  perform log_audit_event(
    p_action_type => 'payment_verification_failed',
    p_gym_id => v_gym_id,
    p_target_entity_id => v_member_id::text,
    p_target_entity_type => 'member',
    p_metadata => jsonb_build_object(
      'payment_id', p_payment_id,
      'amount', v_amount,
      'method', v_method
    ),
    p_system_actor_label => 'payment-webhook'
  );
end;
$$;

revoke execute on function complete_flagged_payment(uuid) from public, anon, authenticated;
grant execute on function complete_flagged_payment(uuid) to service_role;

-- ----------------------------------------------------------------------------
-- complete_verified_payment(): 0100's body. The only change is in the late
-- branch: the row stays flagged and an expired_attempt or provider_declined
-- reason becomes late_confirmation, once (the not-exists audit guard is the
-- replay guard, so a redelivery changes nothing). staff_flagged,
-- reconciliation_mismatch and wrong_account keep their reason; the audit row
-- is written for every late success.
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
  v_deactivated_at timestamptz;
  v_plan_id uuid;
  v_duration_days integer;
  v_new_expiry date;
  v_new_subscription_id uuid;
begin
  update payments
  set status = 'verified', provider_fee_amount = p_fee_amount
  where id = p_payment_id and status = 'processing'
  returning gym_id, member_id, purpose, amount into v_gym_id, v_member_id, v_purpose, v_amount;

  if v_gym_id is null then
    -- A late success for a fee attempt that expiry already flagged: the
    -- member was charged but the row is not applied. Leave a trace so staff
    -- can find and refund it. Once per payment, so a redelivered webhook does
    -- not repeat it; a replay for an already verified row is not late.
    select p.gym_id, p.member_id, p.amount into v_gym_id, v_member_id, v_amount
    from payments p
    where p.id = p_payment_id
      and p.purpose = 'registration_fee'
      and p.status = 'flagged'
      and not exists (
        select 1 from audit_log a
        where a.action_type = 'registration_fee_late_payment'
          and a.metadata ->> 'payment_id' = p_payment_id::text
      );

    if v_gym_id is not null then
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

    raise notice 'complete_verified_payment: payment % already verified or not found -- no-op', p_payment_id;
    return null;
  end if;

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
    -- Should not occur in normal operation: initiatePayment (Task 3) always
    -- looks up the member's most recent subscription before ever creating a
    -- payment row. Defensive only -- payment stays verified, renewal skipped,
    -- same reasoning as the deactivated-member branch above.
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
-- Self-check.
-- ----------------------------------------------------------------------------
do $verify$
begin
  if exists (select 1 from payments where status = 'flagged' and flagged_reason is null) then
    raise exception '0106: a flagged payment has no flagged_reason after backfill';
  end if;

  if exists (
    select 1 from payments
    where flagged_reason is not null
      and flagged_reason not in ('late_confirmation', 'wrong_account', 'expired_attempt',
                                 'reconciliation_mismatch', 'provider_declined', 'staff_flagged')
  ) then
    raise exception '0106: a payment carries a flagged_reason outside the closed set';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.payments'::regclass
      and conname = 'payments_flagged_requires_reason' and convalidated
  ) then
    raise exception '0106: payments_flagged_requires_reason is missing or not validated';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.payments'::regclass
      and tgname = 'protect_payment_purpose_and_void' and not tgisinternal
  ) then
    raise exception '0106: protect_payment_purpose_and_void trigger is missing';
  end if;

  if has_function_privilege('anon', 'public.complete_flagged_payment(uuid)'::regprocedure, 'EXECUTE')
     or has_function_privilege('authenticated', 'public.complete_verified_payment(uuid,integer)'::regprocedure, 'EXECUTE') then
    raise exception '0106: a webhook completion function is executable by a client role';
  end if;

  if not has_function_privilege('service_role', 'public.complete_verified_payment(uuid,integer)'::regprocedure, 'EXECUTE')
     or not has_function_privilege('service_role', 'public.complete_flagged_payment(uuid)'::regprocedure, 'EXECUTE') then
    raise exception '0106: service_role lost EXECUTE on a webhook completion function';
  end if;
end;
$verify$;
