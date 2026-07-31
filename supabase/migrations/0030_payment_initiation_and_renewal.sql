-- Story 4.2: Real Payment Orchestration -- closes the payments RLS gap that
-- has existed since 0005_payments.sql (deny-all only, no gym-staff policy
-- ever added -- see the story file's Scope Note for the full paper trail),
-- adds fee-passthrough capture (FR-039), and adds the webhook-side
-- idempotent renewal-completion function.

-- ============================================================================
-- payments RLS: owner/manager/receptionist can read and insert rows scoped
-- to their own gym. Deliberately excludes 'coach' (unlike
-- gym_staff_read_own_subscriptions/gym_staff_read_own_members, both of which
-- include coach, 0018_member_management.sql) -- no AC or FR gives Coach any
-- visibility into payment data; easy to widen later, hard to narrow once
-- data/UI assumes it.
-- ============================================================================
create policy "gym_staff_read_own_payments" on payments
  for select
  using (
    gym_id = private.gym_id()
    and (auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'receptionist'])
  );

-- Mirrors manager_or_owner_insert_own_subscriptions's shape but includes
-- receptionist -- matches renew_subscription()'s own role list, since a
-- receptionist is exactly who collects payment at the front desk per the
-- epics user story.
create policy "gym_staff_insert_own_payments" on payments
  for insert
  with check (
    gym_id = private.gym_id()
    and (auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'receptionist'])
  );

-- No UPDATE policy for any gym-staff role: the only writer that transitions
-- processing -> verified is complete_verified_payment() below (service_role,
-- webhook path only). Story 4.3's manual verification queue will need its
-- own staff-facing UPDATE policy later -- not added here, that's scope creep.

-- ============================================================================
-- provider_fee_amount: TaraMoney's real webhook payload carries both `amount`
-- (what the member paid) and `originalAmount` (what the gym is actually
-- credited, net of TaraMoney's fee -- confirmed via Story 4.1's real spike:
-- "amount":"100","originalAmount":"97"). Nullable: cash/manual/unverified-
-- in-flight payments have none. Integer XAF per FR-026/NFR-003 (no floats).
-- ============================================================================
alter table payments add column provider_fee_amount integer;
alter table payments add constraint payments_provider_fee_amount_non_negative
  check (provider_fee_amount is null or provider_fee_amount >= 0);

-- ============================================================================
-- complete_verified_payment(): the only sanctioned writer of a payments row's
-- first processing -> verified transition. Distinct from renew_subscription()
-- (0022_manual_renewal_reset.sql), which requires a real authenticated staff
-- JWT and a mandatory human-entered reason -- this function is service_role-
-- only, system-triggered from the webhook's service-role context (no real
-- staff session exists there), and has no reason parameter. Do not merge
-- them or have one call the other; different callers, different trust
-- boundaries, different audit semantics (p_system_actor_label vs. a real
-- auth.uid()-derived actor).
--
-- Idempotency (AC #4): the `where status = 'processing'` clause on the
-- UPDATE below IS the idempotency guard. A second call for an already-
-- verified row updates 0 rows, so v_gym_id resolves to null and the
-- function returns null without inserting a second subscriptions row,
-- re-running the renewal side effect, or raising an exception (a replayed
-- webhook delivery is expected, not exceptional).
--
-- Deactivated-member handling: the payment stays `verified` (money was
-- still real and received) even when the member is deactivated -- renewal
-- is skipped, but `status` is never silently reverted back to `processing`.
-- This is why the deactivated check (and the "no prior subscription to
-- renew from" case, defensively) `return`s rather than `raise exception`s --
-- raising would unwind the whole function invocation's transaction,
-- including the UPDATE that already committed the `verified` status,
-- which is exactly the outcome this design avoids.
-- ============================================================================
create function complete_verified_payment(p_payment_id uuid, p_fee_amount integer)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
  v_member_id uuid;
  v_deactivated_at timestamptz;
  v_plan_id uuid;
  v_duration_days integer;
  v_new_expiry date;
  v_new_subscription_id uuid;
begin
  update payments
  set status = 'verified', provider_fee_amount = p_fee_amount
  where id = p_payment_id and status = 'processing'
  returning gym_id, member_id into v_gym_id, v_member_id;

  if v_gym_id is null then
    raise notice 'complete_verified_payment: payment % already verified or not found -- no-op', p_payment_id;
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

-- Not granted to authenticated: this function must only ever be reachable
-- from the webhook's service-role client, never directly by a gym-staff
-- session (that would let staff renew without a real verified payment) --
-- same narrow-grant discipline as activate_payment_provider().
revoke execute on function complete_verified_payment from public;
grant execute on function complete_verified_payment to service_role;
