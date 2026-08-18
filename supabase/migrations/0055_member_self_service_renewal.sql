-- Story 4.15: Member Self-Service Renewal. Adds the one real gap Story 4.14
-- didn't close: only staff can create the `processing` payments row that
-- authorizes a Tara Money charge (`gym_staff_insert_own_payments`, 0031, is
-- staff-only). `initiate_member_payment()` is the new caller for a member's
-- own mobile-app session -- mirrors `check_in()`'s exact self-scoping
-- SECURITY DEFINER shape (0023_member_check_in_one_open_session_enforcement.sql)
-- rather than a new member-scoped RLS INSERT policy (rejected -- would need
-- a correlated-subquery amount check inside the policy itself, duplicating
-- pricing logic that already lives in apps/dashboard/services/payments.ts's
-- initiatePayment()). Because this is SECURITY DEFINER, no new RLS policy on
-- payments is added -- the function bypasses RLS internally, same as
-- check_in() does for attendance_events. Once this returns a payment_id, the
-- mobile app calls the existing, already-shared
-- payment-webhook/initiate/<providerKey> route (Story 4.2) -- no Edge
-- Function change needed for that route; Task 3's kill-switch enforcement is
-- a separate change in the same migration set.

-- ----------------------------------------------------------------------------
-- initiate_member_payment(): role-checks 'member' first; resolves the
-- caller's own gym_id/member_id from private.gym_id()/auth.uid() (never a
-- client-supplied id, same discipline as check_in()); looks up the member's
-- own most-recent subscription -> plan (price/currency), the same join
-- initiatePayment() already uses; calls active_payment_provider() (already
-- authenticated-granted, 0029); inserts the processing payments row itself,
-- with amount/currency server-derived from the plan row, never client
-- input. method := 'mobile_money' -- a free-text label since
-- 0036_open_payment_method.sql widened payments.method off the old closed
-- enum, already used by the dashboard's own initiatePayment()/RenewalModal.
-- ----------------------------------------------------------------------------
create function initiate_member_payment()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
  v_member_id uuid;
  v_deactivated_at timestamptz;
  v_subscription_status text;
  v_plan_price integer;
  v_plan_currency text;
  v_provider_key text;
  v_payment_id uuid;
begin
  if not ((auth.jwt() ->> 'app_role') = 'member') then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  -- order by deactivated_at nulls first: same idx_members_active_gym_user
  -- (0003) uniqueness caveat check_in() already documents -- prefer an
  -- active row over a deactivated historical one if both somehow coexist.
  select id, deactivated_at into v_member_id, v_deactivated_at
  from members
  where user_id = auth.uid() and gym_id = v_gym_id
  order by deactivated_at nulls first
  limit 1;

  if v_member_id is null then
    raise exception 'initiate_member_payment: no member record found for the caller';
  end if;

  if v_deactivated_at is not null then
    raise exception 'initiate_member_payment: member is deactivated';
  end if;

  -- Review finding: without this, a double-tap, a retry after a client-side
  -- failure, or two devices on the same account could each create their own
  -- `processing` row and fire a second real USSD prompt -- the one-open-
  -- payment-at-a-time analogue of check_in()'s one-open-session enforcement
  -- this function otherwise mirrors.
  if exists (
    select 1 from payments where member_id = v_member_id and status = 'processing'
  ) then
    raise exception 'initiate_member_payment: payment_already_pending for member %', v_member_id;
  end if;

  -- Mirrors apps/dashboard/services/payments.ts's initiatePayment() join
  -- exactly: subscriptions -> plans is a many-to-one FK, so a plain join
  -- (not an array) is correct here. Most-recent-by-created_at, same
  -- "renewal resolves to the new row" precedent as check_in()'s own
  -- subscription-status guard.
  select s.status, p.price, p.currency into v_subscription_status, v_plan_price, v_plan_currency
  from subscriptions s
  join plans p on p.id = s.plan_id
  where s.gym_id = v_gym_id and s.member_id = v_member_id
  order by s.created_at desc
  limit 1;

  if v_plan_price is null then
    raise exception 'initiate_member_payment: no_active_plan for member %', v_member_id;
  end if;

  -- Review finding: the Home CTA only *offers* Renew for expiring_soon/
  -- grace_period/expired -- without this check, any member session could
  -- call this RPC directly (bypassing the UI) and self-initiate a charge
  -- while their subscription is still fully active.
  if v_subscription_status not in ('expiring_soon', 'grace_period', 'expired') then
    raise exception 'initiate_member_payment: not_eligible_for_renewal for member %', v_member_id;
  end if;

  -- Review finding: planSchema explicitly allows a zero-price (free/comp)
  -- plan -- without this, a free-plan member would still get a real
  -- `processing` row and a real 0-amount mobile-money charge attempt.
  if v_plan_price <= 0 then
    raise exception 'initiate_member_payment: no_active_plan for member %', v_member_id;
  end if;

  select active_payment_provider() into v_provider_key;
  if v_provider_key is null then
    raise exception 'initiate_member_payment: no_active_provider';
  end if;

  insert into payments (gym_id, member_id, amount, currency, method, status, provider)
  values (v_gym_id, v_member_id, v_plan_price, v_plan_currency, 'mobile_money', 'processing', v_provider_key)
  returning id into v_payment_id;

  return v_payment_id;
end;
$$;

-- Self-service only: no service_role/anon grant, same shape as check_in()'s
-- own grant -- this RPC is meant to be called by a member's own session,
-- never revoked from authenticated (unlike Story 4.14's two
-- service-role-only credential-decrypt RPCs).
revoke execute on function initiate_member_payment from public;
grant execute on function initiate_member_payment to authenticated;
