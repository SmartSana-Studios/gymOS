-- Reactivating a gym that billing suspended now requires a payment or a billing credit (owner decision 2026-11-25).
--
-- The hole: run_saas_billing_lifecycle_job() (0071) suspends a gym with `saas_billing_status = 'suspended'` and `status = 'suspended'` together, and only ever looks at
-- gyms whose billing status is active, past_due or grace_period. The Super Admin "Reinstate" action wrote `status = 'active'` alone, so the gym ran again with its billing
-- status still 'suspended' and its due date in the past: the job never touched it again, nothing set a new due date, and it stayed active for free with no end
-- (found 2026-11-25 on SMARTSANA FITNESS: status active, billing suspended, due 2026-11-04, grace over on 2026-11-16).
--
-- The rule: a gym may not go from status 'suspended' to 'active' while its saas_billing_status is 'suspended'. The two ways that already lift a billing suspension write BOTH
-- columns in one UPDATE (apply_saas_billing_credit, 0155, and complete_verified_saas_billing_payment, 0072: status 'active', billing status 'active', a new anchor date),
-- so they pass untouched. A gym a Super Admin suspended by hand (billing status not 'suspended') can still be reinstated with the plain action.
--
-- Scope, on purpose: only the suspended -> active transition. A 'deactivated' gym can be reinstated whatever its billing status: apply_saas_billing_credit refuses a deactivated
-- gym (0071's rule that billing never overwrites a deliberate deactivation), so refusing the reinstatement too would leave no way out. The same goes for an already
-- inconsistent row (status active, billing suspended): the rule fires on the transition only, so nothing existing is rewritten; apply a billing credit to put such a gym back on
-- the clock.
--
-- Trigger name starts with zz_ so it runs after private.protect_super_admin_only_gym_columns() (which pins status back for a non-super-admin session) and sees the final values.
-- Rollback: scripts/rollback-0193-gym-reactivation-requires-payment.sql.

create or replace function private.guard_gym_reactivation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'active' and old.status = 'suspended' and new.saas_billing_status = 'suspended' then
    raise exception 'gym_reactivation_requires_payment'
      using detail = format('gym %s is suspended for non-payment', new.id),
            hint = 'Apply a billing credit or take a payment: both set the billing status and a new due date together.';
  end if;
  return new;
end;
$$;

revoke execute on function private.guard_gym_reactivation() from public, anon, authenticated, service_role;

create trigger zz_guard_gym_reactivation
  before update of status, saas_billing_status on public.gyms
  for each row execute function private.guard_gym_reactivation();
