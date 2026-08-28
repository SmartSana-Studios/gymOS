-- Story 11.1: PaymentProvider Routing Context & SaaS Billing Table. AD-14's
-- structural split of Flow B (gym -> GymOS) payments from Flow A (member ->
-- gym) payments -- a dedicated, Super-Admin-scoped table, distinct RLS
-- audience from the gym-scoped `payments` table, mirroring the
-- job_runs/audit_log platform-level-concern precedent.
--
-- Minimal and scoped to only what this story's ACs need -- Stories 11.2/11.3
-- will ALTER TABLE to add lifecycle/reminder-specific columns; do not
-- anticipate their schema here.
create table saas_billing_payments (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references gyms(id),
  amount integer not null,
  currency text not null default 'XAF',
  status payment_status not null,
  provider text references payment_providers(provider_key),
  provider_transaction_ref text unique,
  provider_fee_amount integer,
  created_at timestamptz not null default now()
);

create index idx_saas_billing_payments_gym_id on saas_billing_payments(gym_id);

alter table saas_billing_payments enable row level security;

-- See 0002 for why baseline table-level GRANTs are required alongside RLS.
grant select, insert, update, delete on saas_billing_payments to authenticated, service_role;

-- Deny-all default (0002's baseline discipline). The only sanctioned
-- mutation paths are the two completion RPCs below (security definer,
-- service_role-only) -- no INSERT/UPDATE/DELETE policy is added for any
-- role, matching payment_providers'/payments' own "single blessed write
-- path" posture.
create policy "super_admin_read_saas_billing_payments" on saas_billing_payments
  for select
  using (private.is_super_admin());

-- payment_webhook_events gains one new nullable column so a Flow B event's
-- matched row (which lives in saas_billing_payments, not payments) can still
-- be recorded in the one shared idempotency log AC #3 requires. Exactly one
-- of matched_payment_id / matched_saas_billing_payment_id is populated per
-- row (or neither, for the pre-existing missing_internal_record case) --
-- never both. Enforced (not just documented) by the CHECK below -- both
-- branches of index.ts's dispatch write to only one of these columns, but a
-- schema-level guard costs nothing and catches a future regression before it
-- can silently corrupt reconciliation.
alter table payment_webhook_events
  add column matched_saas_billing_payment_id uuid references saas_billing_payments(id);

alter table payment_webhook_events
  add constraint matched_target_exclusive
  check (matched_payment_id is null or matched_saas_billing_payment_id is null);

-- ----------------------------------------------------------------------------
-- complete_verified_saas_billing_payment() / complete_flagged_saas_billing_payment():
-- mirror complete_verified_payment()/complete_flagged_payment()
-- (0030_payment_initiation_and_renewal.sql, 0046_payment_notifications.sql)
-- in idempotency shape (the `where status = 'processing'` UPDATE clause is
-- the idempotency guard -- a replayed webhook is a 0-row no-op, not an
-- exception) but with no subscription-renewal side effect -- Flow B has no
-- member/subscription to renew. Story 11.2/11.3 own actually *creating*
-- saas_billing_payments rows and any audit-log write around them (FR-080);
-- this story only needs the completion path to exist so the webhook has
-- somewhere to write.
-- ----------------------------------------------------------------------------
create function complete_verified_saas_billing_payment(p_payment_id uuid, p_fee_amount integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update saas_billing_payments
  set status = 'verified', provider_fee_amount = p_fee_amount
  where id = p_payment_id and status = 'processing';

  if not found then
    raise notice 'complete_verified_saas_billing_payment: payment % already verified or not found -- no-op', p_payment_id;
  end if;
end;
$$;

revoke execute on function complete_verified_saas_billing_payment from public, authenticated;
grant execute on function complete_verified_saas_billing_payment to service_role;

create function complete_flagged_saas_billing_payment(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update saas_billing_payments
  set status = 'flagged'
  where id = p_payment_id and status = 'processing';

  if not found then
    raise notice 'complete_flagged_saas_billing_payment: payment % already left processing or not found -- no-op', p_payment_id;
  end if;
end;
$$;

revoke execute on function complete_flagged_saas_billing_payment from public, authenticated;
grant execute on function complete_flagged_saas_billing_payment to service_role;
