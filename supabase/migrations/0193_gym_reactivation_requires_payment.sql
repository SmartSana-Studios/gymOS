-- Reactivating a gym whose billing is due now requires a billing credit or a payment first (owner decision 2026-11-25).
--
-- The hole: run_saas_billing_lifecycle_job() (0071) suspends a gym past its grace period with `status = 'suspended'` and `saas_billing_status = 'suspended'` together, and only
-- ever looks at gyms whose billing status is active, past_due or grace_period. The Super Admin "Reinstate" action wrote `status = 'active'` alone, so the gym ran again with its
-- billing status still 'suspended' and its due date in the past: the job never touched it again and nothing set a new due date, so it stayed active for free with no end
-- (found 2026-11-25 on SMARTSANA FITNESS: status active, billing suspended, due 2026-11-04, grace over on 2026-11-16). A deactivated gym had the same hole: its billing status keeps
-- moving to past_due and grace_period (the job's steps 2 and 3 have no status filter) and Reinstate never looked at it.
--
-- 1. The rule. A gym may not go from status 'suspended' or 'deactivated' to 'active' while its saas_billing_status is not 'active' (the billing status is 'active' exactly while
--    the due date has not passed, because the nightly job moves it the day after). A billing credit and a payment write BOTH columns and a new due date in one UPDATE, so they pass;
--    a gym a Super Admin suspended or deactivated by hand while its billing is up to date is still reinstated by the plain action: "if it is not due, it simply continues".
--    The raise is `gym_reactivation_requires_payment: <due date>` so the Super Admin app can say which date is overdue.
--    Trigger name starts with zz_ so it runs after private.protect_super_admin_only_gym_columns() (which pins status back for a non-super-admin session) and sees the final values.
--
-- 2. A billing credit on a deactivated gym. apply_saas_billing_credit refused a deactivated gym (0071's rule that billing never silently overwrites a deliberate deactivation),
--    which with rule 1 would leave no way back for a deactivated gym that is due. It now accepts one: the billing status goes back to 'active' and the due date counts from today
--    (as in 0155), but the gym's STATUS STAYS 'deactivated'; the Super Admin then reinstates it, and rule 1 lets that through because it is no longer due. A suspended gym is
--    unchanged (a credit still reactivates it in the same statement). record_out_of_band_saas_billing_payment still refuses a deactivated gym; use a credit.
--
-- Rollback: scripts/rollback-0193-gym-reactivation-requires-payment.sql (drops the trigger and function and restores the 0155 body of apply_saas_billing_credit).
set local lock_timeout = '5s';

create or replace function private.guard_gym_reactivation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'active' and old.status in ('suspended', 'deactivated') and new.saas_billing_status <> 'active' then
    raise exception 'gym_reactivation_requires_payment: %', new.saas_billing_anchor_date
      using detail = format('gym %s has billing status %s (due %s)', new.id, new.saas_billing_status, new.saas_billing_anchor_date),
            hint = 'Apply a billing credit or take a payment: both set the billing status and a new due date.';
  end if;
  return new;
end;
$$;

revoke execute on function private.guard_gym_reactivation() from public, anon, authenticated, service_role;

create trigger zz_guard_gym_reactivation
  before update of status, saas_billing_status on public.gyms
  for each row execute function private.guard_gym_reactivation();

create or replace function apply_saas_billing_credit(p_gym_id uuid, p_days integer)
returns table (previous_anchor_date date, new_anchor_date date)
language plpgsql
security definer
set search_path = public
as $$
declare
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

  select saas_billing_anchor_date into v_previous_anchor
  from gyms
  where id = p_gym_id;

  if not found then
    raise exception 'apply_saas_billing_credit: gym % not found', p_gym_id;
  end if;

  v_new_anchor := (greatest(v_previous_anchor, current_date) + (p_days * interval '1 day'))::date;

  -- A deactivated gym keeps its status (a deliberate, distinct admin action): only its billing is brought up to date, and the Super Admin reinstates it afterwards.
  update gyms
  set saas_billing_status = 'active',
      status = case when gyms.status = 'deactivated' then gyms.status else 'active'::gym_status end,
      saas_billing_anchor_date = v_new_anchor
  where id = p_gym_id;

  return query select v_previous_anchor, v_new_anchor;
end;
$$;

-- Restated for the migration guardrail (and so the grants never depend on the earlier files): Super Admin only.
revoke execute on function public.apply_saas_billing_credit(uuid, integer) from public, anon;
grant execute on function public.apply_saas_billing_credit(uuid, integer) to authenticated;
