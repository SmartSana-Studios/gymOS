-- Story 11.6: Cross-Flow Reconciliation & Beta Accommodation. Extends
-- run_payment_reconciliation_job() (0032, extended by 0054/0070) so the
-- shared 4-category discrepancy classification (AD-14) also covers Flow B
-- (gym -> GymOS billing) payments, not just Flow A (member -> gym) --
-- FR-137/FR-138. AC #2 (Free/Test tier runs the full lifecycle) and AC #3
-- (a credit is not mistaken for a missed payment) are both already
-- satisfied by already-shipped code (0071's run_saas_billing_lifecycle_job()
-- has no Free/Test special-case; 0075's apply_saas_billing_credit() already
-- advances the anchor date, which is by-construction sufficient to prevent a
-- false past_due re-trigger) -- see supabase/tests/saas_billing_lifecycle_job.test.sql
-- and docs/decisions.md for the regression tests that lock those two in;
-- nothing here changes either function.

-- ============================================================================
-- payment_discrepancies gains a second, mutually-exclusive target column --
-- same shape as payment_webhook_events.matched_target_exclusive (0069): a
-- discrepancy row is about exactly one of a Flow A payment or a Flow B
-- saas_billing_payment, or (missing_internal_record) neither, never both.
-- ============================================================================
alter table payment_discrepancies add column saas_billing_payment_id uuid references saas_billing_payments(id);

alter table payment_discrepancies
  add constraint payment_discrepancies_target_exclusive
  check (payment_id is null or saas_billing_payment_id is null);

-- New partial unique index for the new Flow-B stale_processing block below,
-- same idempotent-nightly-run discipline as every other category's own
-- index. amount_mismatch needs no new index -- its existing
-- idx_payment_discrepancies_amount_mismatch is keyed on webhook_event_id,
-- already flow-agnostic (the same payment_webhook_events.id space for both
-- flows), so it already de-dupes Flow B rows correctly. missing_internal_record's
-- existing index needs no change either -- it's been flow-agnostic since
-- 0070 (Story 11.1's own patch).
create unique index idx_payment_discrepancies_stale_processing_saas
  on payment_discrepancies (saas_billing_payment_id) where discrepancy_type = 'stale_processing';

-- ============================================================================
-- RLS: Flow-B discrepancy rows always carry a real, non-null gym_id (unlike
-- missing_internal_record) -- saas_billing_payments.gym_id is `not null`
-- (0069). Left unguarded, the existing gym_staff_read_own_payment_discrepancies
-- policy (gym_id = private.gym_id(), no flow discriminator) would let a
-- gym's own Owner/Manager/Receptionist read platform-internal SaaS-billing
-- integrity flags about their own gym -- a policy written for their own
-- member-payment discrepancies, contradicting AD-14's "Super-Admin-scoped
-- RLS, distinct audience from gym-scoped payments, never sharing RLS
-- audience." Narrowed by adding `and saas_billing_payment_id is null` to
-- the existing predicate (alter policy, this project's established pattern
-- for narrowing an existing policy in place -- e.g. 0040, 0061, 0063 -- not
-- drop+recreate).
-- ============================================================================
alter policy "gym_staff_read_own_payment_discrepancies" on payment_discrepancies
  using (
    gym_id = private.gym_id()
    and (auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'receptionist'])
    and saas_billing_payment_id is null
  );

-- New Super-Admin read policy, mirroring saas_billing_payments' own
-- super_admin_read_saas_billing_payments (0069) exactly -- gives Super Admin
-- visibility into both the new Flow-B rows and, as a side effect, the
-- pre-existing missing_internal_record rows nobody could read at all before
-- this migration (no dashboard UI required for either -- see the story's
-- Context section: no FR/mockup backs a reconciliation viewer anywhere in
-- this project, matching the 2026-07-31 missing_internal_record decision).
-- Composes correctly with payment_discrepancies' existing tenant_active_gate
-- RESTRICTIVE policy (0073) with no change there -- that policy's own
-- `or private.is_super_admin()` clause already exempts Super Admin.
create policy "super_admin_read_payment_discrepancies" on payment_discrepancies
  for select
  using (private.is_super_admin());

-- ============================================================================
-- run_payment_reconciliation_job(): two new, symmetric Flow-B blocks added
-- alongside the existing four. The existing missing_internal_record,
-- stale_processing, amount_mismatch, and wrong_account_settlement blocks
-- are copied verbatim from 0070 -- none of their logic changes.
--
-- wrong_account_settlement (FR-137's 4th category) deliberately gets no new
-- Flow-B query -- not an oversight. FR-137 defines it as "a payment whose
-- settled account does not match its declared routing context... i.e. a
-- Flow A collect that landed in or credited against the platform account,
-- or a Flow B collect that landed in a gym account." Traced
-- TaraMoneyProvider.verifyWebhookSignature() (supabase/functions/payment-webhook/_shared/payment-providers/TaraMoneyProvider.ts):
-- routing is resolved by matching the webhook payload's businessId against
-- TARAMONEY_BUSINESS_ID (platform) FIRST, before any gym lookup -- the
-- function's own doc comment explains this ordering was itself a
-- code-review fix (a gym's own connected business_id_plain must never be
-- able to shadow a genuine platform webhook). payment-webhook/index.ts then
-- branches on event.resolvedRoutingContext.type and writes to *only*
-- payments (gym result) or *only* saas_billing_payments (platform result) --
-- the two tables are never cross-queried. A Flow A webhook can therefore
-- never complete a saas_billing_payments row and a Flow B webhook can never
-- complete a payments row -- the exact scenario FR-137 describes is
-- prevented at the routing layer, not left to a nightly job to catch after
-- the fact. Flow A's existing wrong_account_settlement check remains a
-- narrower, still-valid thing: it catches a webhook whose businessId, while
-- still resolving to *some* gym's payments row via a provider_transaction_ref
-- match, disagrees with *that specific gym's* own connected business_id_plain --
-- relevant because Story 4.13 lets gyms self-connect Tara Money accounts, so
-- a webhook can still legitimately disagree with the one value a given gym
-- has on file (a stale/rotated businessId is not itself impossible even
-- though 0054's own unique index already blocks two gyms from sharing the
-- same business_id_plain for a provider). There is no Flow-B analog, since
-- Flow B has exactly one platform account, not many self-connected ones. If
-- real production evidence ever shows a businessId-resolution bug, that is
-- a bug fix to verifyWebhookSignature(), not a job to add here. See
-- docs/decisions.md for the full resolution.
--
-- Architecture-doc drift, noted here so a future reader doesn't chase a
-- phantom requirement: ARCHITECTURE-SPINE.md's AD-14 describes discrepancy
-- detection as "implemented as one shared function/module called by both
-- cron jobs" (plural). In the actual shipped implementation there is only
-- ONE cron job (run_payment_reconciliation_job(), unified since 0070) --
-- Flow A and Flow B categories both already live in the same function. This
-- migration keeps that single-job design (lower risk, already shipped and
-- tested, satisfies AD-19's "each cron trigger is its own function/
-- transaction" trivially since it already is one) rather than splitting
-- into two jobs to literally match the doc's plural wording -- the "shared
-- classification, not duplicated per flow" intent is what AD-14 actually
-- protects against, and one function with symmetric per-flow blocks
-- achieves that. See docs/decisions.md; AD-14's wording itself is
-- unchanged here, out of this story's scope.
-- ============================================================================
create or replace function run_payment_reconciliation_job()
returns void
language plpgsql
set search_path = public
as $$
declare
  v_started_at timestamptz := now();
begin
  begin
    -- AC #1: webhook events that never matched a payments row *or* a
    -- saas_billing_payments row. gym_id is always NULL here by construction
    -- (see docs/decisions.md) -- not an oversight.
    insert into payment_discrepancies (payment_id, gym_id, webhook_event_id, discrepancy_type, details)
    select null, null, e.id, 'missing_internal_record',
      jsonb_build_object('providerTransactionRef', e.provider_transaction_ref, 'webhookAmount', e.amount, 'reference', e.reference)
    from payment_webhook_events e
    where e.matched_payment_id is null
      and e.matched_saas_billing_payment_id is null
    on conflict (webhook_event_id) where discrepancy_type = 'missing_internal_record' do nothing;

    -- Flow A: processing payments older than 10 minutes with no completing
    -- webhook. Also structurally catches a declined (event.status =
    -- 'flagged') webhook that was received but never transitioned the row.
    insert into payment_discrepancies (payment_id, gym_id, discrepancy_type, details)
    select p.id, p.gym_id, 'stale_processing',
      jsonb_build_object('createdAt', p.created_at)
    from payments p
    where p.status = 'processing'
      and p.created_at < now() - interval '10 minutes'
    on conflict (payment_id) where discrepancy_type = 'stale_processing' do nothing;

    -- Flow B (new, this story): the symmetric check against
    -- saas_billing_payments -- a platform-billing collect stuck in
    -- 'processing' for over 10 minutes with no completing webhook.
    insert into payment_discrepancies (saas_billing_payment_id, gym_id, discrepancy_type, details)
    select sp.id, sp.gym_id, 'stale_processing',
      jsonb_build_object('createdAt', sp.created_at)
    from saas_billing_payments sp
    where sp.status = 'processing'
      and sp.created_at < now() - interval '10 minutes'
    on conflict (saas_billing_payment_id) where discrepancy_type = 'stale_processing' do nothing;

    -- Flow A: a matched webhook event whose amount disagrees with the
    -- payments row it matched. Both amounts captured in details.
    insert into payment_discrepancies (payment_id, gym_id, webhook_event_id, discrepancy_type, details)
    select p.id, p.gym_id, e.id, 'amount_mismatch',
      jsonb_build_object('webhookAmount', e.amount, 'internalAmount', p.amount, 'currency', p.currency)
    from payment_webhook_events e
    join payments p on p.id = e.matched_payment_id
    where e.amount <> p.amount
    on conflict (webhook_event_id) where discrepancy_type = 'amount_mismatch' do nothing;

    -- Flow B (new, this story): the symmetric check against
    -- saas_billing_payments, joined via matched_saas_billing_payment_id
    -- (never matched_payment_id, which stays NULL for every Flow B row by
    -- construction -- 0069). Reuses the existing amount_mismatch index
    -- (keyed on webhook_event_id, already flow-agnostic) -- no new index
    -- needed.
    insert into payment_discrepancies (saas_billing_payment_id, gym_id, webhook_event_id, discrepancy_type, details)
    select sp.id, sp.gym_id, e.id, 'amount_mismatch',
      jsonb_build_object('webhookAmount', e.amount, 'internalAmount', sp.amount, 'currency', sp.currency)
    from payment_webhook_events e
    join saas_billing_payments sp on sp.id = e.matched_saas_billing_payment_id
    where e.amount <> sp.amount
    on conflict (webhook_event_id) where discrepancy_type = 'amount_mismatch' do nothing;

    -- FR-137: a verified, matched Flow A webhook whose payload businessId
    -- doesn't match the gym's own connected business_id_plain -- a
    -- misrouted-but-otherwise-clean payment that reference/amount matching
    -- alone couldn't catch. No Flow-B analog -- see this function's own
    -- header comment above.
    insert into payment_discrepancies (payment_id, gym_id, webhook_event_id, discrepancy_type, details)
    select p.id, p.gym_id, e.id, 'wrong_account_settlement',
      jsonb_build_object('webhookBusinessId', e.raw_payload ->> 'businessId', 'expectedBusinessId', g.business_id_plain)
    from payment_webhook_events e
    join payments p on p.id = e.matched_payment_id
    join gym_payment_credentials g on g.gym_id = p.gym_id and g.provider_key = e.provider_key
    where e.status = 'verified'
      and p.created_at >= g.connected_at
      and e.raw_payload ->> 'businessId' is distinct from g.business_id_plain
    on conflict (webhook_event_id) where discrepancy_type = 'wrong_account_settlement' do nothing;

    insert into job_runs (job_name, started_at, finished_at, status)
    values ('payment_reconciliation', v_started_at, now(), 'success');
  exception when others then
    insert into job_runs (job_name, started_at, finished_at, status, error)
    values ('payment_reconciliation', v_started_at, now(), 'failure', sqlerrm);

    perform log_audit_event(
      p_action_type => 'payment_reconciliation_job_failure',
      p_system_actor_label => 'system:payment_reconciliation_job',
      p_metadata => jsonb_build_object('error', sqlerrm)
    );
  end;
end;
$$;
