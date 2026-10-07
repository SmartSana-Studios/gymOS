-- ============================================================================
-- 0100: Tara Money registration fee collection (Epic 18, Story 18.3).
--
-- Story 18.2 let staff collect an awaiting member's fee by hand. This adds the
-- staff-initiated Tara Money collection, database side only (the screens are
-- Story 18.6):
--
--   initiate_registration_fee_payment(member)  inserts the `processing` fee row
--   complete_verified_payment(...)             gains a registration_fee branch
--   record_registration_fee / waive_registration_fee  now aware of an
--                                               in-flight Tara collection
--   private.expire_stale_registration_fee_payment()  the 10-minute expiry
--
-- The payment-webhook Edge Function is NOT edited: its existing
-- initiate/<provider> route charges `payments.amount` and deletes the row when
-- the provider call fails, and its confirmation path already calls
-- complete_verified_payment / complete_flagged_payment.
--
-- Design choices worth knowing before editing this file:
--
--  * The amount is never a parameter. initiate_registration_fee_payment reads
--    gyms.registration_fee itself. The payer's phone number is NOT a parameter
--    either: it is only ever sent to the provider, by the dashboard service,
--    and the front desk may change it from the member's own number.
--
--  * A Tara collection stays `processing` while it waits, and a mobile prompt
--    always expires. While a fee payment is `processing` and younger than ten
--    minutes (the stale_processing threshold of 0032), a new Tara attempt,
--    record_registration_fee and waive_registration_fee are all refused with
--    registration_fee_already_pending. Once it is older, the next of those
--    calls first marks it `flagged` (audit registration_fee_attempt_expired,
--    no push: 0099's notification trigger skips fee payments) and proceeds.
--    A late success after that is not applied: complete_verified_payment only
--    moves rows out of `processing`. It writes a registration_fee_late_payment
--    audit row instead (once per payment), so staff can find and refund it.
--
--  * Lock order is payment row first, member row second, in every function
--    touching both -- the webhook's complete_verified_payment locks them in
--    that order, so the three staff RPCs flag an expired row (a payment write)
--    BEFORE taking `for update` on the member.
--
--  * complete_verified_payment is redefined with `create or replace`: the
--    signature is unchanged so its service_role-only ACL is kept (and
--    re-stated below). Its subscription branch is the 0030 body verbatim.
--
--  * The expiry helper is SECURITY INVOKER on purpose. It is only ever called
--    from the three definer RPCs (so it runs as their owner), and a definer
--    helper writing the payments table would need an entry on the suspension
--    coverage test's exclusion list it does not deserve: each caller already
--    carries the status guard before it is called.
--
--  * Neither RPC body may mention the write statements the suspension
--    coverage test scans for before its own status guard, even in comments.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Expiry helper. Marks this member's `processing` fee payment `flagged` when it
-- is older than ten minutes. The partial unique index
-- payments_one_registration_fee_per_member allows at most one such row.
-- ----------------------------------------------------------------------------
create function private.expire_stale_registration_fee_payment(p_member_id uuid, p_gym_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_payment_id uuid;
begin
  update payments
  set status = 'flagged'
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

revoke execute on function private.expire_stale_registration_fee_payment(uuid, uuid) from public;

-- ----------------------------------------------------------------------------
-- initiate_registration_fee_payment(): start a Tara Money collection of the
-- registration fee for an awaiting member. Owner, manager, supervisor or
-- receptionist, own gym only (private.gym_id(), never an argument).
-- Suspension-gated with the fail-closed `is distinct from` form before any
-- write. Returns the new payment id and the provider key the dashboard then
-- calls payment-webhook/initiate/<provider_key> with.
--
-- Check order after the member row is locked: not found (other gym, or not
-- role 'member'), deactivated, an existing fee payment (already recorded, or
-- already pending while it is still `processing`), already settled (not due),
-- fee 0 (not configured), no active provider.
-- ----------------------------------------------------------------------------
create function initiate_registration_fee_payment(p_member_id uuid)
returns table (payment_id uuid, provider_key text)
language plpgsql
security definer
set search_path = public
as $$
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
  if not coalesce((auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'supervisor', 'receptionist']), false) then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  if private.current_gym_status() is distinct from 'active' then
    raise exception 'initiate_registration_fee_payment: gym % is not active', v_gym_id;
  end if;

  v_actor_id := auth.uid();

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
$$;

revoke execute on function initiate_registration_fee_payment(uuid) from public;
grant execute on function initiate_registration_fee_payment(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- complete_verified_payment(): 0030's definition, plus the purpose returned
-- from the first UPDATE and a registration_fee branch. A verified fee payment
-- settles the member and never creates a subscription. The `processing` ->
-- `verified` guard on the first UPDATE is still the idempotency guard: a
-- replayed confirmation updates 0 rows and returns before the branch, so there
-- is no second audit row.
--
-- Payment row locked first (that UPDATE), member row second -- the order the
-- staff RPCs above and in 0099 follow.
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

-- Not granted to authenticated: only the webhook's service-role client may
-- call this (see 0030). Re-stated so the ACL is explicit in this migration.
revoke execute on function complete_verified_payment(uuid, integer) from public;
revoke execute on function complete_verified_payment(uuid, integer) from authenticated;
grant execute on function complete_verified_payment(uuid, integer) to service_role;

-- ----------------------------------------------------------------------------
-- record_registration_fee(): 0099's body, plus the expiry flag (before the
-- member lock) and the in-flight Tara check. `create or replace` keeps the ACL.
-- Check order after the member row is locked: not found, deactivated, an
-- existing fee payment (already pending while `processing`, otherwise already
-- recorded), already settled (not due), fee 0 (not configured).
-- ----------------------------------------------------------------------------
create or replace function record_registration_fee(p_member_id uuid, p_method text, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
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
  if not coalesce((auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'supervisor', 'receptionist']), false) then
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
$$;

-- ----------------------------------------------------------------------------
-- waive_registration_fee(): 0099's body, plus the expiry flag (before the
-- member lock) and the in-flight Tara check, so a waive cannot settle a member
-- whose phone is about to be charged.
-- ----------------------------------------------------------------------------
create or replace function waive_registration_fee(p_member_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
  v_role member_role;
  v_deactivated_at timestamptz;
  v_settled_at timestamptz;
  v_reason text;
begin
  if not coalesce((auth.jwt() ->> 'app_role') = any(array['owner', 'supervisor', 'manager']), false) then
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
$$;

-- ----------------------------------------------------------------------------
-- Post-condition assertions -- 0090/0093/0095/0098/0099's discipline.
-- ----------------------------------------------------------------------------
do $verify$
begin
  if not (select bool_and(p.prosecdef) from pg_proc p
          where p.oid in ('public.initiate_registration_fee_payment(uuid)'::regprocedure,
                          'public.record_registration_fee(uuid, text, text)'::regprocedure,
                          'public.waive_registration_fee(uuid, text)'::regprocedure,
                          'public.complete_verified_payment(uuid, integer)'::regprocedure)) then
    raise exception '0100: the registration-fee RPCs and complete_verified_payment must be SECURITY DEFINER';
  end if;

  if (select p.prosecdef from pg_proc p
      where p.oid = 'private.expire_stale_registration_fee_payment(uuid, uuid)'::regprocedure) then
    raise exception '0100: private.expire_stale_registration_fee_payment() must stay SECURITY INVOKER (a definer writer of payments would need a suspension-coverage exclusion)';
  end if;

  -- A NULL proacl is the default ACL, which includes EXECUTE for PUBLIC.
  if exists (
    select 1 from pg_proc p
    where p.oid in ('private.expire_stale_registration_fee_payment(uuid, uuid)'::regprocedure,
                    'public.initiate_registration_fee_payment(uuid)'::regprocedure,
                    'public.record_registration_fee(uuid, text, text)'::regprocedure,
                    'public.waive_registration_fee(uuid, text)'::regprocedure,
                    'public.complete_verified_payment(uuid, integer)'::regprocedure)
      and (
        p.proacl is null
        or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
      )
  ) then
    raise exception '0100: EXECUTE on the registration-fee collection functions must not be granted to PUBLIC';
  end if;

  -- complete_verified_payment stays service_role only.
  if exists (
    select 1 from pg_proc p, aclexplode(p.proacl) a
    where p.oid = 'public.complete_verified_payment(uuid, integer)'::regprocedure
      and a.privilege_type = 'EXECUTE'
      and a.grantee in (select oid from pg_roles where rolname in ('authenticated', 'anon'))
  ) then
    raise exception '0100: complete_verified_payment must not be executable by authenticated or anon';
  end if;

  if not exists (
    select 1 from pg_proc p, aclexplode(p.proacl) a
    where p.oid = 'public.complete_verified_payment(uuid, integer)'::regprocedure
      and a.privilege_type = 'EXECUTE'
      and a.grantee = (select oid from pg_roles where rolname = 'service_role')
  ) then
    raise exception '0100: complete_verified_payment must be executable by service_role';
  end if;

  if not exists (
    select 1 from pg_proc p, aclexplode(p.proacl) a
    where p.oid = 'public.initiate_registration_fee_payment(uuid)'::regprocedure
      and a.privilege_type = 'EXECUTE'
      and a.grantee = (select oid from pg_roles where rolname = 'authenticated')
  ) then
    raise exception '0100: initiate_registration_fee_payment must be executable by authenticated';
  end if;

  if exists (
    select 1 from pg_proc p
    where p.oid in ('public.initiate_registration_fee_payment(uuid)'::regprocedure,
                    'public.record_registration_fee(uuid, text, text)'::regprocedure,
                    'public.waive_registration_fee(uuid, text)'::regprocedure)
      and not (p.prosrc ~* 'current_gym_status\(\)\s+is\s+distinct\s+from\s+''active''')
  ) then
    raise exception '0100: all three registration-fee RPCs must carry the fail-closed suspension guard';
  end if;

  -- Whoever names manager names supervisor too (0093's rule).
  if exists (
    select 1 from pg_proc p
    where p.oid in ('public.initiate_registration_fee_payment(uuid)'::regprocedure,
                    'public.record_registration_fee(uuid, text, text)'::regprocedure,
                    'public.waive_registration_fee(uuid, text)'::regprocedure)
      and p.prosrc like '%''manager''%'
      and p.prosrc not like '%''supervisor''%'
  ) then
    raise exception '0100: a role gate that names manager must name supervisor too';
  end if;

  -- The fee branch exists and settles; the subscription branch is still there.
  if not exists (
    select 1 from pg_proc p
    where p.oid = 'public.complete_verified_payment(uuid, integer)'::regprocedure
      and p.prosrc like '%registration_fee_settled_at%'
      and p.prosrc like '%registration_fee_paid%'
      and p.prosrc like '%subscription_payment_renewal%'
  ) then
    raise exception '0100: complete_verified_payment must carry the registration_fee branch and keep the subscription branch';
  end if;

  -- record/waive/initiate flag expired rows before they lock the member.
  if exists (
    select 1 from pg_proc p
    where p.oid in ('public.initiate_registration_fee_payment(uuid)'::regprocedure,
                    'public.record_registration_fee(uuid, text, text)'::regprocedure,
                    'public.waive_registration_fee(uuid, text)'::regprocedure)
      and (position('expire_stale_registration_fee_payment' in p.prosrc) = 0
           or position('expire_stale_registration_fee_payment' in p.prosrc) > position('for update' in p.prosrc))
  ) then
    raise exception '0100: the expiry flag must run before the member row lock (payment row first, member row second)';
  end if;
end;
$verify$;
