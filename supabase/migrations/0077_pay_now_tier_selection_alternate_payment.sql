-- Story 11.7: Pay Now -- Tier Selection & Alternate Payment Methods.
-- Extends Story 11.3's initiate_saas_billing_payment()/
-- complete_verified_saas_billing_payment() (0072) to let an Owner override
-- the tier/interval they're paying for at Pay-Now time, and closes a real
-- pre-existing RLS gap (deferred-work.md:6, :643) that silently broke
-- PayNowButton's own polling watch for every real Owner session.
--
-- Design call: the tier/interval change takes effect at payment
-- *verification*, not at dialog submit -- saas_billing_payments.tier_id/
-- .billing_interval record what a given payment is *for* (always populated,
-- falling back to the gym's current tier/interval when the Owner doesn't
-- override, so complete_verified_saas_billing_payment()'s read path stays
-- unconditional, no NULL-branching); complete_verified_saas_billing_payment()
-- applies the *payment row's own* tier/interval onto `gyms` atomically with
-- the anchor-date advance it already performs. This avoids a gym showing a
-- tier it hasn't actually paid for if the payment fails/times out, and is
-- consistent with OQ-15/Story 11.2's "no proration, new price at next cycle"
-- resolution -- a Pay-Now-time tier change IS that next cycle's charge
-- event, not a mid-cycle proration.
--
-- Free/Test tier (price_locked = true, Story 11.2) must never be
-- Owner-selectable -- it's a Super-Admin-only accommodation mechanism, not a
-- self-service downgrade path.

-- ----------------------------------------------------------------------------
-- saas_billing_payments gains tier_id/billing_interval -- nullable at the
-- column level (pre-existing rows, and any 'processing' row already in
-- flight at deploy time, have neither); every future insert via
-- initiate_saas_billing_payment() populates both unconditionally.
-- ----------------------------------------------------------------------------
alter table saas_billing_payments
  add column tier_id uuid references tiers(id),
  add column billing_interval billing_interval;

-- ----------------------------------------------------------------------------
-- AC #4 / deferred-work.md:6,643: PayNowButton.tsx's client-side polling
-- (fetchSaasBillingPaymentStatus(), apps/dashboard/lib/realtime/paymentStatus.ts)
-- reads this table as the browser `authenticated` client, but the only
-- SELECT policy so far was super_admin_read_saas_billing_payments (0069) --
-- every poll tick silently returned 0 rows (RLS-denied, not an error) for a
-- real Owner session, so the "verified"/"flagged" branches could never fire
-- without a manual page reload. Per AD-3: private.current_member_role(), not
-- the legacy (pre-AD-3) auth.jwt() ->> 'app_role' shape deferred-work.md's
-- own note suggested.
-- ----------------------------------------------------------------------------
create policy "owner_read_own_gym_saas_billing_payments" on saas_billing_payments
  for select
  using (gym_id = private.gym_id() and private.current_member_role() = 'owner');

-- ----------------------------------------------------------------------------
-- list_selectable_saas_billing_tiers(): the Pay-Now tier selector's read
-- path. `tiers` has exactly one SELECT policy (super_admin_read_tiers,
-- 0010) -- a gym-scoped session gets 0 rows today. A SECURITY DEFINER RPC
-- (not a widened `tiers` RLS policy) mirrors this schema's established
-- "a narrow read needs to cross an RLS boundary that exists for a different
-- audience" precedent (private.current_member_role() itself,
-- list_own_active_gym_memberships(), 0074) rather than opening `tiers` up
-- for every future table consumer. price_locked tiers are excluded at the
-- query level, not only rejected at write time by
-- initiate_saas_billing_payment() below -- the Free/Test tier's existence is
-- a Super-Admin-only concern (Story 11.2/11.5), never Owner-visible. No
-- role/gym check beyond a valid session -- `tiers` (name + price) is
-- platform-wide, non-gym-sensitive catalog data, not a per-tenant secret.
-- ----------------------------------------------------------------------------
create function list_selectable_saas_billing_tiers()
returns table (id uuid, name text, monthly_price integer, annual_price integer)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, t.name, t.monthly_price, t.annual_price
  from tiers t
  where not t.price_locked
  order by t.monthly_price asc;
$$;

revoke execute on function list_selectable_saas_billing_tiers from public;
grant execute on function list_selectable_saas_billing_tiers to authenticated;

-- ----------------------------------------------------------------------------
-- initiate_saas_billing_payment(): extended with two optional, defaulted
-- parameters -- backward-compatible with the existing zero-arg call site
-- (apps/dashboard/services/billing.ts) until Task 4 updates it. Permission
-- check, gym lookup, deactivated-gym rejection, double-submit guard, and
-- active-provider check are all unchanged from 0072.
--
-- `create or replace` alone would NOT replace the existing zero-arg
-- 0072-era function -- Postgres overloads by argument signature, so a
-- differently-shaped `create or replace` creates a second, co-existing
-- overload instead, making every zero-arg call site ambiguous
-- ("is not unique"). The old zero-arg version must be dropped first.
-- ----------------------------------------------------------------------------
drop function if exists initiate_saas_billing_payment();

create function initiate_saas_billing_payment(p_tier_id uuid default null, p_interval billing_interval default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
  v_gym_status gym_status;
  v_gym_tier_id uuid;
  v_gym_interval billing_interval;
  v_tier_id uuid;
  v_interval billing_interval;
  v_price_locked boolean;
  v_monthly_price integer;
  v_annual_price integer;
  v_amount integer;
  v_provider_key text;
  v_payment_id uuid;
begin
  if private.current_member_role() is distinct from 'owner' then
    raise exception 'permission denied: caller is not this gym''s owner';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied: caller is not this gym''s owner';
  end if;

  select g.status, g.tier_id, g.saas_billing_interval
  into v_gym_status, v_gym_tier_id, v_gym_interval
  from gyms g
  where g.id = v_gym_id;

  if v_gym_status = 'deactivated' then
    raise exception 'initiate_saas_billing_payment: gym % is deactivated', v_gym_id;
  end if;

  -- A missing tier (deleted/never existed) and an existing-but-price_locked
  -- tier both surface the same tier_not_selectable_by_owner exception --
  -- deliberate, matching packages/types/src/errors.ts's single mapping for
  -- both cases rather than a second, narrower "tier not found" code.
  --
  -- Runs BEFORE the double-submit guard below (review finding) -- otherwise
  -- a gym with an already-processing payment that also passes an invalid
  -- p_tier_id would see the misleading payment_already_pending message
  -- instead of tier_not_selectable_by_owner, masking the real input error.
  if p_tier_id is not null then
    select price_locked into v_price_locked from tiers where id = p_tier_id;
    if v_price_locked is null or v_price_locked then
      raise exception 'initiate_saas_billing_payment: tier_not_selectable_by_owner for tier %', p_tier_id;
    end if;
  end if;

  if exists (
    select 1 from saas_billing_payments where gym_id = v_gym_id and status = 'processing'
  ) then
    raise exception 'initiate_saas_billing_payment: payment_already_pending for gym %', v_gym_id;
  end if;

  v_tier_id := coalesce(p_tier_id, v_gym_tier_id);
  v_interval := coalesce(p_interval, v_gym_interval);

  -- A live join on the *resolved* tier/interval, not unconditionally the
  -- gym's stored ones -- this is what makes an override actually change the
  -- charged amount (mirrors 0072's own no-proration-by-construction
  -- reasoning, extended to the override case).
  select monthly_price, annual_price into v_monthly_price, v_annual_price
  from tiers where id = v_tier_id;

  v_amount := case v_interval when 'annual' then v_annual_price else v_monthly_price end;

  select active_payment_provider() into v_provider_key;
  if v_provider_key is null then
    raise exception 'initiate_saas_billing_payment: no_active_provider';
  end if;

  insert into saas_billing_payments (gym_id, amount, currency, status, provider, tier_id, billing_interval)
  values (v_gym_id, v_amount, 'XAF', 'processing', v_provider_key, v_tier_id, v_interval)
  returning id into v_payment_id;

  return v_payment_id;
end;
$$;

-- Owner-callable by design, mirrors 0072's own grant shape -- dropping the
-- old overload above also dropped its grants, so these must be reissued.
revoke execute on function initiate_saas_billing_payment from public;
grant execute on function initiate_saas_billing_payment to authenticated;

-- ----------------------------------------------------------------------------
-- complete_verified_saas_billing_payment(): now also reads back the
-- payment row's own tier_id/billing_interval and applies them onto `gyms`
-- atomically with the existing anchor-date advance. `coalesce(v_payment_*,
-- <gym's own current column>)` covers any 'processing' row already in
-- flight at deploy time (tier_id/billing_interval NULL, pre-migration) --
-- falls back to the gym's existing values, identical to pre-story
-- behavior, rather than nulling them out.
-- ----------------------------------------------------------------------------
create or replace function complete_verified_saas_billing_payment(p_payment_id uuid, p_fee_amount integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
  v_payment_tier_id uuid;
  v_payment_interval billing_interval;
begin
  update saas_billing_payments
  set status = 'verified', provider_fee_amount = p_fee_amount
  where id = p_payment_id and status = 'processing'
  returning gym_id, tier_id, billing_interval into v_gym_id, v_payment_tier_id, v_payment_interval;

  if not found then
    raise notice 'complete_verified_saas_billing_payment: payment % already verified or not found -- no-op', p_payment_id;
    return;
  end if;

  -- See private.protect_super_admin_only_gym_columns() below for why this
  -- bypass is required -- this RPC runs from payment-webhook's service-role
  -- client, with no JWT/session context, so private.is_super_admin() reads
  -- false and the trigger would otherwise silently pin this write back.
  perform set_config('app.saas_billing_payment_reset_bypass', 'true', true);

  update gyms
  set saas_billing_status = 'active',
      status = 'active',
      saas_billing_anchor_date = saas_billing_anchor_date
        + (case coalesce(v_payment_interval, saas_billing_interval) when 'annual' then interval '1 year' else interval '1 month' end),
      tier_id = coalesce(v_payment_tier_id, tier_id),
      saas_billing_interval = coalesce(v_payment_interval, saas_billing_interval)
  where id = v_gym_id
    and status <> 'deactivated';

  perform set_config('app.saas_billing_payment_reset_bypass', 'false', true);
end;
$$;

-- ----------------------------------------------------------------------------
-- private.protect_super_admin_only_gym_columns(): tier_id and
-- saas_billing_interval move into the existing
-- app.saas_billing_payment_reset_bypass-checked block, joining
-- saas_billing_anchor_date -- one extra pair of columns exempted for
-- exactly the same writer/call site, not a new GUC. Both stay pinned back
-- for every other non-Super-Admin write path (a raw client UPDATE,
-- update_own_owner_notification_email(), the lifecycle job's own bypass,
-- etc.) exactly as before -- only this one RPC's own bypass window widened.
-- ----------------------------------------------------------------------------
create or replace function private.protect_super_admin_only_gym_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.created_at := old.created_at;
  if not private.is_super_admin() then
    new.member_cap_override := old.member_cap_override;

    if coalesce(current_setting('app.saas_billing_lifecycle_job_bypass', true), 'false') <> 'true'
       and coalesce(current_setting('app.saas_billing_payment_reset_bypass', true), 'false') <> 'true' then
      new.status := old.status;
      new.saas_billing_status := old.saas_billing_status;
    end if;

    if coalesce(current_setting('app.saas_billing_payment_reset_bypass', true), 'false') <> 'true' then
      new.saas_billing_anchor_date := old.saas_billing_anchor_date;
      new.tier_id := old.tier_id;
      new.saas_billing_interval := old.saas_billing_interval;
    end if;

    new.saas_grace_period_days := old.saas_grace_period_days;
  end if;
  return new;
end;
$$;
