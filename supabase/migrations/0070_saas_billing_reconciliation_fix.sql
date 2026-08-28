-- Story 11.1 code review (Patch): run_payment_reconciliation_job()'s AC #1
-- query (0032_payment_reconciliation_job.sql, extended by
-- 0054_flow_a_gym_routing.sql) only ever checked `matched_payment_id is
-- null` to detect a webhook event with no matching internal record. Story
-- 11.1 added `payment_webhook_events.matched_saas_billing_payment_id` for
-- legitimately-matched Flow B (platform) events -- those rows always have
-- `matched_payment_id is null` by construction, so without this fix every
-- correctly-processed Flow B payment would be flagged as a false-positive
-- `missing_internal_record` discrepancy on every reconciliation run. Only
-- the AC #1 predicate changes; every other block is copied verbatim from
-- 0054's version.
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

    -- AC #2: processing payments older than 10 minutes with no completing
    -- webhook. Also structurally catches a declined (event.status = 'flagged')
    -- webhook that was received but never transitioned the row -- this query
    -- doesn't need to know which case it is.
    insert into payment_discrepancies (payment_id, gym_id, discrepancy_type, details)
    select p.id, p.gym_id, 'stale_processing',
      jsonb_build_object('createdAt', p.created_at)
    from payments p
    where p.status = 'processing'
      and p.created_at < now() - interval '10 minutes'
    on conflict (payment_id) where discrepancy_type = 'stale_processing' do nothing;

    -- AC #3: a matched webhook event whose amount disagrees with the
    -- payments row it matched. Both amounts captured in `details` (AC #3's
    -- "with both amounts shown").
    insert into payment_discrepancies (payment_id, gym_id, webhook_event_id, discrepancy_type, details)
    select p.id, p.gym_id, e.id, 'amount_mismatch',
      jsonb_build_object('webhookAmount', e.amount, 'internalAmount', p.amount, 'currency', p.currency)
    from payment_webhook_events e
    join payments p on p.id = e.matched_payment_id
    where e.amount <> p.amount
    on conflict (webhook_event_id) where discrepancy_type = 'amount_mismatch' do nothing;

    -- FR-137: a verified, matched webhook whose payload businessId doesn't
    -- match the gym's own connected business_id_plain -- a misrouted-but-
    -- otherwise-clean payment that reference/amount matching alone couldn't
    -- catch. gym_id IS populated here (unlike missing_internal_record) --
    -- this discrepancy IS attributable to a gym (Story 4.14 Task 2).
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
