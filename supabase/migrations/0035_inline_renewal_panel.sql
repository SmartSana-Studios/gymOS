-- Story 4.7: Inline Renewal Panel. `confirm_renewal()` is a new, atomic
-- SECURITY DEFINER function combining `renew_subscription()`'s (0022) reset
-- with a directly-`verified` payments insert in the same transaction.
--
-- Why one function instead of two RPC calls (renew_subscription() +
-- recordManualPayment()): a receptionist-initiated retry (required by AC #3
-- -- "panel stays open for retry") after a partial two-call failure could
-- create a second pending payment row or leave a paid member unrenewed, with
-- no unique constraint anywhere to catch it (unlike the provider-webhook
-- path, which has provider_transaction_ref). One transaction, one atomic
-- outcome, closes that gap.
--
-- Why the payment is inserted as status = 'verified' directly, bypassing the
-- pending Verification Queue (Story 4.3, gym_staff_insert_own_payments'
-- `status = any(array['pending','processing'])` with-check): every other
-- manual payment needs independent staff verification because it might have
-- been recorded by one person and needs confirmation by another. Here the
-- same receptionist confirming the renewal is the one who just collected the
-- cash -- there is no second person to verify it, and AC #2 requires the
-- subscription to reset to active *immediately*, which would be incoherent
-- if the backing payment could still be flagged/rejected later. Safe: this
-- SECURITY DEFINER function, owned by the migration role, bypasses RLS
-- entirely, exactly like renew_subscription() already bypasses
-- manager_or_owner_insert_own_subscriptions to let a Receptionist call it.
--
-- Guard ordering, tenant-isolation rationale, "insert-only/renewal-as-
-- history" reasoning, and the no-plan-switching/no-double-submit-guard
-- decisions all copy renew_subscription() (0022) verbatim -- see that
-- migration's own header comment for the full rationale; not repeated here.
--
-- out parameters (not a separate composite type): mirrors check_in()'s
-- pattern of returning a row shape callers read via supabase.rpc(...)'s
-- single-object response -- simpler than defining a new composite type for
-- one function.
create function confirm_renewal(
  p_member_id uuid,
  p_method payment_method,
  p_reason text,
  out payment_id uuid,
  out subscription_id uuid,
  out amount integer,
  out currency text,
  out new_expiry_date date
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_gym_id uuid;
  v_actor_id uuid;
  v_member_gym_id uuid;
  v_deactivated_at timestamptz;
  v_plan_id uuid;
  v_duration_days integer;
begin
  if not ((auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'receptionist'])) then
    raise exception 'permission denied';
  end if;

  v_caller_gym_id := private.gym_id();
  if v_caller_gym_id is null then
    raise exception 'permission denied';
  end if;
  v_actor_id := auth.uid();

  select gym_id, deactivated_at into v_member_gym_id, v_deactivated_at
  from members where id = p_member_id and gym_id = v_caller_gym_id;

  if v_member_gym_id is null then
    raise exception 'confirm_renewal: member % not found', p_member_id;
  end if;

  if v_deactivated_at is not null then
    raise exception 'confirm_renewal: member % is deactivated and cannot be renewed', p_member_id;
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'confirm_renewal: reason is required';
  end if;

  select s.plan_id into v_plan_id
  from subscriptions s
  where s.member_id = p_member_id
  order by s.created_at desc
  limit 1;

  if v_plan_id is null then
    raise exception 'confirm_renewal: member % has no existing subscription to renew', p_member_id;
  end if;

  select duration_days, price, plans.currency into v_duration_days, amount, currency
  from plans where id = v_plan_id;

  new_expiry_date := case when v_duration_days is null then null else current_date + v_duration_days end;

  insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
  values (v_member_gym_id, p_member_id, v_plan_id, 'active', current_date, new_expiry_date)
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
      'reason', p_reason,
      'method', p_method,
      'amount', amount,
      'currency', currency,
      'payment_id', payment_id,
      'subscription_id', subscription_id,
      'plan_id', v_plan_id,
      'new_expiry_date', new_expiry_date
    )
  );
end;
$$;

-- Self-checks role internally (see function body) -- matches
-- renew_subscription()'s exact grant shape (0022). No grant to anon or
-- service_role.
revoke execute on function confirm_renewal from public;
grant execute on function confirm_renewal to authenticated;
