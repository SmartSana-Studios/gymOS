-- Story 4.3: Manual Payment Entry & Verification Queue -- closes the
-- "Story 4.3's manual verification queue will need its own staff-facing
-- UPDATE policy later" gap 0030's own comment deliberately left open. No new
-- columns: payments.reason/actor_id already exist (0005_payments.sql) and
-- are exactly where this story's mandatory note/auto-populated actor go;
-- subscription_id/provider/provider_transaction_ref/provider_fee_amount all
-- stay null for every row this story writes (see the story file's Scope
-- Note -- this is a payment ledger entry, not a renewal).

-- ============================================================================
-- gym_staff_verify_own_payments: owner/manager/receptionist can UPDATE a
-- pending row in their own gym to verified/flagged. The `using` clause's
-- `status = 'pending'` is what scopes this policy to manual payments only --
-- an automated `processing` row (webhook not yet received) is invisible to
-- it, correctly deferring stuck-processing handling to Story 4.4 -- and
-- prevents re-verifying/re-flagging an already-verified/flagged row (the
-- idempotency guard exercised by this story's own pgTAP coverage). The
-- `with check`'s `status = any(array['verified','flagged'])` prevents a
-- staff UPDATE from setting any other status value (e.g. back to pending,
-- or to processing).
-- ============================================================================
create policy "gym_staff_verify_own_payments" on payments
  for update
  using (
    gym_id = private.gym_id()
    and status = 'pending'
    and (auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'receptionist'])
  )
  with check (
    gym_id = private.gym_id()
    and status = any(array['verified', 'flagged']::payment_status[])
    and (auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'receptionist'])
  );

-- ============================================================================
-- Defense-in-depth: 0030's gym_staff_insert_own_payments policy has no
-- `status` constraint in its `with check` at all -- a gym-staff session
-- could currently INSERT a payments row directly with status = 'verified',
-- bypassing the queue entirely. 0030 already shipped and was reviewed, so
-- it isn't edited in place -- dropped and recreated here with an added
-- `status = any(array['pending', 'processing'])` check: this story's own
-- manual-payment `pending` insert and Story 4.2's automated-payment
-- `processing` insert both stay allowed; `verified`/`flagged` become
-- impossible to insert directly, only reachable via
-- complete_verified_payment()'s service_role path or this story's new
-- UPDATE policy above.
-- ============================================================================
drop policy "gym_staff_insert_own_payments" on payments;

create policy "gym_staff_insert_own_payments" on payments
  for insert
  with check (
    gym_id = private.gym_id()
    and status = any(array['pending', 'processing']::payment_status[])
    and (auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'receptionist'])
  );

-- ============================================================================
-- gym_staff_verify_own_payments (above) is row-level, not column-level: it
-- authorizes a staff UPDATE on a pending row, but says nothing about *which*
-- columns. Left alone, a raw REST PATCH could ride that policy to also
-- change amount/member_id/method/reason at the moment of verification.
-- Column-level GRANTs can't fix this (see 0014_gym_settings_owner_access.sql's
-- protect_super_admin_only_gym_columns comment: all app_role variants share
-- the same `authenticated` Postgres role, so a GRANT UPDATE (status)
-- restriction would bind to that shared role, not to app_role) -- a BEFORE
-- UPDATE trigger is the same established mechanism used there, scoped here to
-- exactly the gym_staff_verify_own_payments policy's own conditions
-- (old.status = 'pending' + a staff app_role): for that path only, every
-- column except status is pinned back to its current value rather than
-- rejecting the whole UPDATE. complete_verified_payment() (service_role,
-- old.status = 'processing', no app_role claim in that context) and
-- recordManualPayment's INSERT are both untouched by this trigger.
-- ============================================================================
create function private.protect_payment_columns_on_staff_verify()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = 'pending' and (auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'receptionist']) then
    new.gym_id := old.gym_id;
    new.member_id := old.member_id;
    new.amount := old.amount;
    new.currency := old.currency;
    new.method := old.method;
    new.reason := old.reason;
    new.actor_id := old.actor_id;
    new.subscription_id := old.subscription_id;
    new.provider := old.provider;
    new.provider_transaction_ref := old.provider_transaction_ref;
    new.provider_fee_amount := old.provider_fee_amount;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

create trigger protect_payment_columns_on_staff_verify
  before update on payments
  for each row execute function private.protect_payment_columns_on_staff_verify();
