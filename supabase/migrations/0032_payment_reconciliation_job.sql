-- Story 4.4: Payment Reconciliation & Discrepancy Flagging. New
-- infrastructure: nothing before this story persists a raw record of an
-- inbound payment webhook, so AC #1 ("no matching internal payment record")
-- is undetectable by a nightly batch job without a log of every delivery,
-- matched or not. See docs/decisions.md for the two decisions this migration
-- implements (the event-log table, and the gym-unattributable
-- missing_internal_record case getting no UI).

create type payment_discrepancy_type as enum ('missing_internal_record', 'stale_processing', 'amount_mismatch');

-- ============================================================================
-- payment_webhook_events: one row per signature-verified webhook delivery,
-- matched or not. Written by supabase/functions/payment-webhook/index.ts
-- (the existing receiver, not a new Edge Function -- architecture.md
-- reserves Edge Functions for the webhook receiver only).
-- ============================================================================
create table payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider_key text not null references payment_providers(provider_key),
  provider_transaction_ref text not null,
  reference text,
  amount integer not null,
  currency text not null,
  status text not null check (status in ('verified', 'flagged')),
  matched_payment_id uuid references payments(id),
  received_at timestamptz not null default now(),
  raw_payload jsonb not null
);

-- Idempotent against retried webhook deliveries -- Task 2 inserts with
-- `on conflict do nothing` against this index, same discipline as
-- payments.provider_transaction_ref's own unique constraint.
create unique index idx_payment_webhook_events_provider_ref
  on payment_webhook_events (provider_key, provider_transaction_ref);

alter table payment_webhook_events enable row level security;

-- See 0002 for why baseline table-level GRANTs are required alongside RLS.
grant select, insert, update, delete on payment_webhook_events to authenticated, service_role;

-- Deny-all: no SELECT policy. Internal/service-role-and-postgres-cron-only,
-- exactly matching job_runs' own "no business policy yet" precedent
-- (0008_job_runs.sql) -- this table has no per-gym owner (the whole point of
-- AC #1 is that an unmatched event *can't* be attributed to a gym).

-- ============================================================================
-- payment_discrepancies: the nightly job's output. References payments/
-- payment_webhook_events loosely (nullable FKs) -- payment_status (the enum)
-- and every existing payments RLS policy/trigger are untouched by this
-- story; discrepancies live entirely here, not as a payments.status value.
-- ============================================================================
create table payment_discrepancies (
  id uuid primary key default gen_random_uuid(),
  -- Nullable: missing_internal_record has no payments row to read a gym_id
  -- from, and TaraMoney's webhook payload carries a single platform-wide
  -- businessId, not a per-gym identifier. Stays NULL for that discrepancy
  -- type by construction -- see docs/decisions.md.
  gym_id uuid references gyms(id),
  payment_id uuid references payments(id),
  webhook_event_id uuid references payment_webhook_events(id),
  discrepancy_type payment_discrepancy_type not null,
  details jsonb not null default '{}'::jsonb,
  detected_at timestamptz not null default now()
);

-- One partial unique index per discrepancy type, so the job's nightly
-- `insert ... on conflict do nothing` never re-flags an already-known
-- discrepancy on a later run -- same absolute-condition, idempotent-by-
-- construction design as run_subscription_lifecycle_job(), not delta/
-- last-run logic.
create unique index idx_payment_discrepancies_missing_record
  on payment_discrepancies (webhook_event_id) where discrepancy_type = 'missing_internal_record';
create unique index idx_payment_discrepancies_stale_processing
  on payment_discrepancies (payment_id) where discrepancy_type = 'stale_processing';
create unique index idx_payment_discrepancies_amount_mismatch
  on payment_discrepancies (webhook_event_id) where discrepancy_type = 'amount_mismatch';

alter table payment_discrepancies enable row level security;

grant select, insert, update, delete on payment_discrepancies to authenticated, service_role;

-- Mirrors gym_staff_read_own_payments' exact role list (owner/manager/
-- receptionist, excludes coach -- no AC/FR gives Coach payment visibility,
-- same reasoning Story 4.3 already applied). `gym_id = private.gym_id()` is
-- never true for a NULL gym_id row (missing_internal_record), so those rows
-- are structurally invisible here too -- same NULL-exclusion technique
-- Story 3.1's Scope Note #2 already established as this codebase's
-- convention.
create policy "gym_staff_read_own_payment_discrepancies" on payment_discrepancies
  for select
  using (
    gym_id = private.gym_id()
    and (auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'receptionist'])
  );

-- ============================================================================
-- run_payment_reconciliation_job(): the nightly detection job.
--
-- No SECURITY DEFINER: pg_cron invokes scheduled jobs as the role that
-- called cron.schedule() (this migration, running as postgres), which
-- already bypasses RLS -- same reasoning as run_subscription_lifecycle_job()/
-- run_check_in_auto_timeout_job(), and the corrected pg_cron-runs-as-postgres
-- finding in docs/decisions.md (2026-07-18), which explicitly names payment
-- reconciliation as one of the two remaining jobs that must follow this
-- exact grant discipline.
--
-- Every detection query below is a plain, absolute-condition SELECT against
-- current state -- never "since the last successful run" delta logic. The
-- three partial unique indexes above plus ON CONFLICT ... DO NOTHING are
-- what make repeated nightly runs safe without ever needing to track "have I
-- already looked at this row."
--
-- The inner BEGIN...EXCEPTION savepoint block is the same shape as
-- run_subscription_lifecycle_job(): a failure mid-run rolls back only the
-- guarded INSERTs, not the job_runs failure record written in the exception
-- handler.
-- ============================================================================
create function run_payment_reconciliation_job()
returns void
language plpgsql
set search_path = public
as $$
declare
  v_started_at timestamptz := now();
begin
  begin
    -- AC #1: webhook events that never matched a payments row. gym_id is
    -- always NULL here by construction (see docs/decisions.md) -- not an
    -- oversight.
    insert into payment_discrepancies (payment_id, gym_id, webhook_event_id, discrepancy_type, details)
    select null, null, e.id, 'missing_internal_record',
      jsonb_build_object('providerTransactionRef', e.provider_transaction_ref, 'webhookAmount', e.amount, 'reference', e.reference)
    from payment_webhook_events e
    where e.matched_payment_id is null
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

-- Cron/direct-postgres-only, same as the other two jobs -- no grant to
-- authenticated/service_role.
revoke execute on function run_payment_reconciliation_job() from public;

-- 01:15 UTC (02:15 WAT), 15 minutes after subscription_lifecycle's 01:00 UTC
-- slot, so the two nightly jobs don't contend for the same instant. No FR
-- mandates a specific offset; this just avoids two full-table batch jobs
-- starting simultaneously. cron.schedule() upserts by job name -- safe
-- across repeated `supabase db reset`s.
select cron.schedule(
  'payment_reconciliation',
  '15 1 * * *',
  $$ select run_payment_reconciliation_job(); $$
);
