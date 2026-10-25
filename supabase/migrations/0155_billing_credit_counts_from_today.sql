-- ============================================================================
-- 0155: A billing credit counts from today when the billing date has passed.
--
-- apply_saas_billing_credit(p_gym_id, p_days) used to add p_days to the gym's
-- saas_billing_anchor_date. For a gym already overdue that left the date in the
-- past (anchor 2026-10-08 + 10 days = 2026-10-18 on 2026-10-25), so the gym
-- stayed overdue and the nightly lifecycle job moved it back to grace_period
-- and then suspended it again.
--
-- Now the new date is greatest(current anchor, current_date) + p_days: an
-- overdue gym gets p_days from today, a gym whose date is still in the future
-- keeps the old behaviour (the days are added to that date).
--
-- Same signature, return type, security definer and 90-day ceiling; CREATE OR
-- REPLACE keeps the grants set by 0075 and 0104. No data is changed.
-- ============================================================================
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
