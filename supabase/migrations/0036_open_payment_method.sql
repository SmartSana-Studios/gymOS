-- Removes the closed `payment_method` enum's implicit Cameroon-only lock on
-- TaraMoney-routed payments (`mtn_momo`/`orange_money` were the only two
-- automated values it allowed). User direction (2026-08-01): this project
-- intends to expand beyond Cameroon, and TaraMoney itself supports other
-- markets (e.g. Wave, used in Senegal/Burkina Faso/Ivory Coast) -- a closed
-- 5-value enum would hard-block recording any operator this app hasn't
-- explicitly enumerated in advance.
--
-- Note this app never actually tells TaraMoney which operator to use --
-- `TaraMoneyProvider.initiate()` sends `network: ""` and TaraMoney
-- auto-detects the operator from the payer's phone number server-side
-- (confirmed via the real spike evidence in docs/decisions.md). The
-- `method` value this app stores is purely its own record-keeping label,
-- never a routing instruction -- so widening it has zero effect on how
-- TaraMoney actually processes a charge, only on what this app is allowed
-- to record afterward.
--
-- `payments.method` and `confirm_renewal()`'s `p_method` parameter were the
-- only two objects referencing the `payment_method` type (confirmed via a
-- full-repo grep) -- both are widened to `text` here, and the now-unused
-- enum type is dropped. Manual payment methods (cash/bank_transfer/
-- manual_momo, validated by recordManualPaymentSchema/confirmRenewalSchema
-- in packages/types) are untouched -- those represent genuinely distinct
-- payment instruments a receptionist chooses, not a TaraMoney country/
-- operator restriction, and stay client-side-validated closed enums.
alter table payments alter column method type text using method::text;

-- Review finding: opening `method` to unconstrained text removed all DB-level
-- validation (the enum was the only backstop) -- any string became insertable
-- via a direct RPC/API call, relying entirely on client-side Zod. These two
-- checks close the "literally anything, unbounded" gap without reintroducing
-- a closed/country-specific value set: non-empty (mirrors the enum's own
-- implicit "always some real label" guarantee) and a generous length cap
-- (real values are short slugs like "orange_money"/"mtn_momo"; 40 chars
-- comfortably covers any TaraMoney-reported operator token from
-- mapTaraMoneyVendor() too).
alter table payments add constraint payments_method_not_blank_check check (btrim(method) <> '');
alter table payments add constraint payments_method_length_check check (char_length(method) <= 40);

-- Review finding: confirmRenewalSchema's Zod layer caps `reason` at 200
-- chars, but confirm_renewal() itself had no matching DB-side bound -- a
-- caller bypassing Zod (a real risk now that `method` is also open text)
-- could push an unbounded string into payments.reason/audit_log.metadata.
alter table payments add constraint payments_reason_length_check check (reason is null or char_length(reason) <= 200);

-- confirm_renewal() (0035) can't have its parameter type ALTERed in place --
-- Postgres requires drop+recreate for a signature change. Body is otherwise
-- byte-for-byte identical to 0035's version.
drop function confirm_renewal(uuid, payment_method, text);

create function confirm_renewal(
  p_member_id uuid,
  p_method text,
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

revoke execute on function confirm_renewal from public;
grant execute on function confirm_renewal to authenticated;

drop type payment_method;
