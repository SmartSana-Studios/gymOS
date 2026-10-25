-- Rollback for migration 0155: a credit adds its days to the stored billing date again, even when that date is past.
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0155-billing-credit-counts-from-today.sql
-- Data effects: none (only the function body changes; credits already applied keep their dates).
set local lock_timeout = '5s';

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
