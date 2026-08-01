-- Story 4.5: Refund Recording. Refunds live in a brand-new `refunds` table,
-- entirely separate from `payments` -- `payment_status` (the enum) has no
-- 'refunded' value and this migration does not add one, same "own table,
-- don't mutate payments.status" precedent 0032's `payment_discrepancies`
-- already established. Unlike `payment_discrepancies.gym_id` (nullable),
-- `refunds.gym_id` is not null: a refund always targets a real, already-
-- `verified` payment, so a gym is always resolvable at insert time. See
-- docs/decisions.md for the "one refund per payment, no partial/multiple-
-- refund ledger" V1 simplification (`refunds.payment_id` unique).

create table refunds (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references gyms(id),
  payment_id uuid not null references payments(id) unique,
  amount integer not null,
  currency text not null default 'XAF',
  reason text not null,
  actor_id uuid not null references users(id),
  created_at timestamptz not null default now(),
  constraint refunds_amount_positive check (amount > 0)
);

create index idx_refunds_gym_id on refunds(gym_id);

alter table refunds enable row level security;

-- See 0002 for why baseline table-level GRANTs are required alongside RLS.
grant select, insert, update, delete on refunds to authenticated, service_role;

-- Same owner/manager/receptionist read list as gym_staff_read_own_payments
-- (0030) -- a receptionist can already see the underlying payment, so
-- seeing it was later refunded is no new exposure, even though no V1 UI
-- actually renders a refunds list. It exists because
-- listRefundEligiblePayments needs SELECT to exclude already-refunded
-- payments from the Record Refund modal's payment picker.
create policy "gym_staff_read_own_refunds" on refunds
  for select
  using (
    gym_id = private.gym_id()
    and (auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'receptionist'])
  );

-- Deliberately narrower than gym_staff_insert_own_payments -- owner/manager
-- only, excluding receptionist (this story's own user story: "As a Manager
-- or Owner"). The `exists` clause is the real, uncircumventable gate for
-- the "only a verified payment, amount capped to the original" business
-- rule -- services/payments.ts#recordRefund's own pre-check is a fast,
-- friendly error message only, not the authorization boundary.
--
-- `refunds.gym_id`/`refunds.amount` are explicitly qualified inside the
-- `exists` subquery -- `payments` has its own `gym_id`/`amount` columns, so
-- a bare reference resolves to the *innermost* scope (`payments p`, per
-- standard SQL name resolution), not the new `refunds` row being checked.
-- An earlier, unqualified version of this policy silently reduced both
-- conditions to a vacuous `p.col = p.col` self-comparison (caught by this
-- story's own pgTAP coverage, refund_recording.test.sql) -- the cross-gym
-- case happened to still deny correctly only as a side effect of `payments`'
-- own SELECT RLS already scoping the subquery to the caller's own gym, but
-- the amount cap had no such backup and was silently bypassable. `payment_id`
-- has no equivalent bare-reference risk (`payments` has no `payment_id`
-- column), but is qualified here too for consistency/defense against future
-- schema drift.
create policy "manager_or_owner_insert_own_refunds" on refunds
  for insert
  with check (
    gym_id = private.gym_id()
    and (auth.jwt() ->> 'app_role') = any(array['owner', 'manager'])
    and exists (
      select 1 from payments p
      where p.id = refunds.payment_id
        and p.gym_id = refunds.gym_id
        and p.status = 'verified'
        and refunds.amount <= p.amount
    )
  );

-- No UPDATE/DELETE policy for any role -- a recorded refund is permanent in
-- V1 (FR-040's "recording only"; no AC specifies a correction/reversal
-- path). No `on delete` clause on the new FKs -- matches the already-
-- accepted, documented gap from Story 4.4's own deferred-work entry.
