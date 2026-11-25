-- Rollback for migration 0193: Reactivating a gym whose billing is due requires a credit or a payment.
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0193-gym-reactivation-requires-payment.sql
--
-- Drops the trigger and its function and restores apply_saas_billing_credit to its 0155 body (a deactivated gym is refused again). No data was written by 0193, so nothing else
-- to restore. After this the Super Admin Reinstate action can again put a billing-suspended or deactivated gym back to status 'active' with its billing status still due (the gap
-- 0193 closed).
set local lock_timeout = '5s';

drop trigger if exists zz_guard_gym_reactivation on public.gyms;
drop function if exists private.guard_gym_reactivation();

create or replace function apply_saas_billing_credit(p_gym_id uuid, p_days integer)
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

  -- 90 days (one quarter) is the ceiling in a single credit: DB-layer enforcement
  -- of record (matches applyCreditSchema's APPLY_CREDIT_MAX_DAYS).
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

  v_new_anchor := (greatest(v_previous_anchor, current_date) + (p_days * interval '1 day'))::date;

  update gyms
  set saas_billing_status = 'active',
      status = 'active',
      saas_billing_anchor_date = v_new_anchor
  where id = p_gym_id
    and status <> 'deactivated';

  return query select v_previous_anchor, v_new_anchor;
end;
$$;

-- Restated for the migration guardrail (and so the grants never depend on the earlier files): Super Admin only.
revoke execute on function public.apply_saas_billing_credit(uuid, integer) from public, anon;
grant execute on function public.apply_saas_billing_credit(uuid, integer) to authenticated;
