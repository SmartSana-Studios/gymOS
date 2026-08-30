-- Story 11.5: Super Admin Billing View. Adds no new lifecycle state and
-- modifies no existing lifecycle transition -- `saas_billing_status`'s four
-- values, the suspend/reactivate mechanism, and the reminder-schedule
-- machinery are all Stories 11.2-11.4's, already shipped. This migration
-- only adds the two genuinely new pieces of write surface Super Admin's
-- Billing view needs: a way to record a payment that happened outside Tara
-- Money, and a way to grant a credit/free period.
--
-- Both RPCs are the "self-enforcing SECURITY DEFINER" shape AD-5 specifies
-- for Super Admin cross-gym write actions -- never a broadened RLS policy on
-- saas_billing_payments/gyms. SECURITY DEFINER is required here for a
-- different reason on each table it touches: saas_billing_payments (0069)
-- has zero INSERT policy for any role by design ("the only sanctioned
-- mutation paths are the two completion RPCs"), so only a function running
-- as its owning role can insert into it at all; gyms already has a
-- Super-Admin-scoped UPDATE policy (super_admin_update_gyms, 0011) and the
-- column-protection trigger (private.protect_super_admin_only_gym_columns,
-- 0071/0072) already lets a real super_admin-claim session's UPDATE straight
-- through with no bypass GUC needed -- unlike the payment-webhook/pg_cron
-- completion paths, this RPC runs as the calling Super Admin's own
-- authenticated session, so private.is_super_admin() (reading auth.jwt(),
-- unaffected by SECURITY DEFINER) resolves true for both the RLS check and
-- the trigger's own internal check.
--
-- apply_saas_billing_credit() could therefore have been a plain two-step
-- Server Action (read -> UPDATE gyms -> log) instead of an RPC, per the
-- story's own Dev Notes. Built as an RPC anyway, for the same reason as the
-- payment RPC: one atomic DB round-trip that resolves the previous/new
-- anchor date and self-enforces the deactivated-gym guard in one place,
-- rather than splitting that logic across a Server Action and leaving room
-- for a future edit to forget the guard. Consistent security posture with
-- record_out_of_band_saas_billing_payment() above it.
--
-- Anchor-date math mirrors complete_verified_saas_billing_payment()'s (0072)
-- own reasoning verbatim -- always advance from the gym's OWN current
-- anchor value, never `current_date`, so a late/manual payment doesn't get a
-- full fresh cycle stacked on top of days already elapsed as past_due/
-- grace_period. Not factored into a shared `private.` helper with that
-- function -- the story's own Dev Notes flag this as optional and weigh the
-- DRY benefit against the regression risk of editing already-shipped,
-- already-reviewed Story 11.3 code; duplicating the ~6-line reset here was
-- judged the lower-risk choice for this story's scope.
--
-- Both RPCs reject a deactivated gym with an exception (matching
-- initiate_saas_billing_payment()'s own deactivated-gym exception), checked
-- up front before any write, with a symmetric `and status <> 'deactivated'`
-- guard on the UPDATE itself as defense-in-depth against a race between the
-- initial read and the write, mirroring every other billing-clock writer in
-- this codebase (0071/0072).
-- ----------------------------------------------------------------------------

create function record_out_of_band_saas_billing_payment(p_gym_id uuid)
returns table (id uuid, amount integer, previous_anchor_date date, new_anchor_date date)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_status gym_status;
  v_interval billing_interval;
  v_monthly_price integer;
  v_annual_price integer;
  v_amount integer;
  v_previous_anchor date;
  v_new_anchor date;
  v_payment_id uuid;
begin
  if not private.is_super_admin() then
    raise exception 'permission denied: caller is not a super admin';
  end if;

  select g.status, g.saas_billing_interval, g.saas_billing_anchor_date, t.monthly_price, t.annual_price
  into v_gym_status, v_interval, v_previous_anchor, v_monthly_price, v_annual_price
  from gyms g
  join tiers t on t.id = g.tier_id
  where g.id = p_gym_id;

  if not found then
    raise exception 'record_out_of_band_saas_billing_payment: gym % not found', p_gym_id;
  end if;

  if v_gym_status = 'deactivated' then
    raise exception 'record_out_of_band_saas_billing_payment: gym % is deactivated', p_gym_id;
  end if;

  v_amount := case v_interval when 'annual' then v_annual_price else v_monthly_price end;
  v_new_anchor := (v_previous_anchor + (case v_interval when 'annual' then interval '1 year' else interval '1 month' end))::date;

  -- amount is resolved live above, never client-supplied; provider is null
  -- (not a Tara Money-mediated payment) -- the one legitimate use of this
  -- nullable column outside the webhook path.
  insert into saas_billing_payments (gym_id, amount, currency, status, provider)
  values (p_gym_id, v_amount, 'XAF', 'verified', null)
  returning saas_billing_payments.id into v_payment_id;

  update gyms
  set saas_billing_status = 'active',
      status = 'active',
      saas_billing_anchor_date = v_new_anchor
  where gyms.id = p_gym_id
    and gyms.status <> 'deactivated';

  return query select v_payment_id, v_amount, v_previous_anchor, v_new_anchor;
end;
$$;

-- Owner-callable-equivalent grant shape: Super-Admin-session-initiated, never
-- service_role -- matches initiate_saas_billing_payment()'s own grant shape,
-- not the service_role-only completion RPCs.
revoke execute on function record_out_of_band_saas_billing_payment from public;
grant execute on function record_out_of_band_saas_billing_payment to authenticated;

create function apply_saas_billing_credit(p_gym_id uuid, p_days integer)
returns table (previous_anchor_date date, new_anchor_date date)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_status gym_status;
  v_previous_anchor date;
  v_new_anchor date;
begin
  if not private.is_super_admin() then
    raise exception 'permission denied: caller is not a super admin';
  end if;

  if p_days <= 0 then
    raise exception 'apply_saas_billing_credit: p_days must be positive';
  end if;

  -- Review fix (user decision): 90 days (one quarter) is the ceiling a
  -- Super Admin can grant in a single credit -- DB-layer enforcement of
  -- record (matches applyCreditSchema's identical client/server-side cap in
  -- packages/types/src/schemas/gym.ts, APPLY_CREDIT_MAX_DAYS), never just a
  -- UI convention.
  if p_days > 90 then
    raise exception 'apply_saas_billing_credit: p_days must not exceed 90';
  end if;

  select status, saas_billing_anchor_date into v_gym_status, v_previous_anchor
  from gyms
  where id = p_gym_id;

  if not found then
    raise exception 'apply_saas_billing_credit: gym % not found', p_gym_id;
  end if;

  if v_gym_status = 'deactivated' then
    raise exception 'apply_saas_billing_credit: gym % is deactivated', p_gym_id;
  end if;

  v_new_anchor := (v_previous_anchor + (p_days * interval '1 day'))::date;

  update gyms
  set saas_billing_status = 'active',
      status = 'active',
      saas_billing_anchor_date = v_new_anchor
  where id = p_gym_id
    and status <> 'deactivated';

  return query select v_previous_anchor, v_new_anchor;
end;
$$;

revoke execute on function apply_saas_billing_credit from public;
grant execute on function apply_saas_billing_credit to authenticated;
