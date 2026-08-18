-- Story 4.14: Flow A Explicit Gym-Account Routing & Auditability. Makes
-- Story 4.13's storage (gym_payment_credentials) load-bearing: real per-gym
-- Tara Money credential routing at initiation and webhook verification, plus
-- a reconciliation-job detection category for a payment that settles to the
-- wrong (or the platform's) account. See the story file's Context section
-- for the full design rationale, in particular why webhook verification
-- resolves gym_id from the payload's own businessId rather than the matched
-- payments row (the latter would regress the accepted 2026-08-01
-- webhook-before-ref-persisted race).

-- ============================================================================
-- business_id_plain: cleartext routing/lookup key, alongside the existing
-- business_id_masked. Not a secret -- TaraMoney's own webhook payloads
-- already carry this value in cleartext on every delivery (every real spike
-- in docs/decisions.md confirms this); only apiKey/webhookSecret stay
-- Vault-only. No backfill: this is a beta-stage project and no existing row
-- carries a real Tara Money connection yet (confirmed against the local
-- environment -- gym_payment_credentials is empty).
-- ============================================================================
alter table gym_payment_credentials add column business_id_plain text;

-- Partial (not plain unique) since a connect could theoretically race before
-- this column populates on an old row -- defensive, matches this migration's
-- own no-backfill assumption rather than assuming every row always has one.
create unique index idx_gym_payment_credentials_provider_business_id
  on gym_payment_credentials (provider_key, business_id_plain) where business_id_plain is not null;

-- needs_attention: Task 5 (AC #3) -- set when a previously-connected gym's
-- credentials start failing at initiate time (invalid/revoked, not "never
-- connected" -- Story 4.13 already surfaces that case). Cleared on any
-- successful (re)connect.
alter table gym_payment_credentials add column needs_attention boolean not null default false;

-- ----------------------------------------------------------------------------
-- connect_gym_payment_credentials(): extended to also populate
-- business_id_plain (trimmed, unmasked) and clear needs_attention on every
-- successful (re)connect -- identical auth/validation/locking shape to
-- 0052's original, only the two new column writes are added.
-- ----------------------------------------------------------------------------
create or replace function connect_gym_payment_credentials(
  p_provider_key text,
  p_api_key text,
  p_business_id text,
  p_webhook_secret text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
  v_existing_id uuid;
  v_existing_secret_id uuid;
  v_secret_id uuid;
  v_masked text;
  v_plain text;
  v_secret_json text;
begin
  if (auth.jwt() ->> 'app_role') is distinct from 'owner' then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  if not exists (select 1 from payment_providers where provider_key = p_provider_key) then
    raise exception 'connect_gym_payment_credentials: unknown provider_key %', p_provider_key;
  end if;

  if p_api_key is null or btrim(p_api_key) = ''
    or p_business_id is null or btrim(p_business_id) = ''
    or p_webhook_secret is null or btrim(p_webhook_secret) = '' then
    raise exception 'connect_gym_payment_credentials: credential values must not be blank';
  end if;

  -- Server-side bound matching the client's Zod max() guards -- the RPC is
  -- directly callable by any authenticated owner session, bypassing the
  -- client schema, so it must not rely solely on client-side validation
  -- (this codebase's own "Server Actions never trust client input"
  -- principle, applied here too).
  if length(p_api_key) > 500 or length(p_business_id) > 200 or length(p_webhook_secret) > 500 then
    raise exception 'connect_gym_payment_credentials: a credential value exceeds the maximum length';
  end if;

  v_plain := btrim(p_business_id);

  -- A business_id of 4 characters or fewer would otherwise be fully
  -- revealed by right(x, 4) despite the "••••" prefix visually implying
  -- redaction -- NFR-017 says businessId must never be returned to any
  -- client. Real Tara Money business ids are far longer, so this only
  -- guards a defensive/direct-RPC-call edge case.
  v_masked := case
    when length(v_plain) > 4 then '•••• ' || right(v_plain, 4)
    else '••••'
  end;
  v_secret_json := jsonb_build_object(
    'apiKey', p_api_key,
    'businessId', p_business_id,
    'webhookSecret', p_webhook_secret
  )::text;

  -- Serialize concurrent connects for the same (gym, provider) so a
  -- first-time double-connect (double-click, two tabs) can't race between
  -- the existence check and the insert below -- `for update` alone cannot
  -- lock a row that doesn't exist yet, so without this lock both concurrent
  -- calls could see "no existing row" and both attempt `insert`, the second
  -- raising a raw unique-constraint violation instead of resolving cleanly.
  perform pg_advisory_xact_lock(hashtextextended(v_gym_id::text || ':' || p_provider_key, 0));

  select id, credentials_secret_id into v_existing_id, v_existing_secret_id
  from gym_payment_credentials
  where gym_id = v_gym_id and provider_key = p_provider_key
  for update;

  if v_existing_id is not null then
    perform vault.update_secret(v_existing_secret_id, v_secret_json);
    -- connected_at is also bumped here (not just set at insert time) --
    -- run_payment_reconciliation_job()'s wrong_account_settlement check
    -- anchors its comparison to this timestamp (review finding), so an
    -- in-place credential change (e.g. rotating to a different Tara Money
    -- account without an explicit disconnect first) must move the anchor
    -- too, or payments settled under the prior account would be retroactively
    -- flagged against the new one.
    update gym_payment_credentials
    set business_id_masked = v_masked,
      business_id_plain = v_plain,
      needs_attention = false,
      connected_by = auth.uid(),
      connected_at = now(),
      updated_at = now()
    where id = v_existing_id;
  else
    v_secret_id := vault.create_secret(v_secret_json, 'gym_payment_credentials:' || v_gym_id || ':' || p_provider_key);
    insert into gym_payment_credentials (
      gym_id, provider_key, credentials_secret_id, business_id_masked, business_id_plain, connected_by
    )
    values (v_gym_id, p_provider_key, v_secret_id, v_masked, v_plain, auth.uid());
  end if;

  -- Metadata must never include the raw apiKey/businessId/webhookSecret
  -- values -- NFR-017's "never logged" extends to the audit trail.
  perform log_audit_event(
    p_action_type => 'gym_payment_credentials_connected',
    p_gym_id => v_gym_id,
    p_target_entity_id => p_provider_key,
    p_target_entity_type => 'gym_payment_credentials',
    p_metadata => jsonb_build_object('provider_key', p_provider_key, 'business_id_masked', v_masked)
  );
end;
$$;

-- ============================================================================
-- Two new service-role-only RPCs, the first in this codebase granted with
-- no session-derived gym scoping (p_gym_id/p_business_id passed directly,
-- not resolved from private.gym_id()) -- deliberate, narrow exception to
-- AD-3's "never derive gym scoping from a client-supplied parameter" rule,
-- safe only because `authenticated` is explicitly excluded from the grant.
-- service_role already bypasses RLS by design; only the Edge Function (which
-- holds the service-role key) can call these. Do not grant these to
-- `authenticated` under any circumstance -- that would return decrypted
-- secrets to a client-reachable role.
-- ============================================================================

-- Initiate-time read: payments.gym_id is already known, so a by-gym-id
-- lookup is the natural shape.
create function get_gym_payment_credentials_for_service(p_gym_id uuid, p_provider_key text)
returns table(api_key text, business_id text, webhook_secret text)
language sql
stable
security definer
set search_path = public
as $$
  select
    v.decrypted_secret::jsonb ->> 'apiKey',
    v.decrypted_secret::jsonb ->> 'businessId',
    v.decrypted_secret::jsonb ->> 'webhookSecret'
  from gym_payment_credentials c
  join vault.decrypted_secrets v on v.id = c.credentials_secret_id
  where c.gym_id = p_gym_id and c.provider_key = p_provider_key;
$$;

revoke execute on function get_gym_payment_credentials_for_service from public, authenticated;
grant execute on function get_gym_payment_credentials_for_service to service_role;

-- Webhook-receive-time read: only businessId is known pre-verification (no
-- payments row is required to exist yet -- see the story's Context section).
create function get_gym_payment_credentials_by_business_id(p_business_id text, p_provider_key text)
returns table(gym_id uuid, api_key text, business_id text, webhook_secret text)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.gym_id,
    v.decrypted_secret::jsonb ->> 'apiKey',
    v.decrypted_secret::jsonb ->> 'businessId',
    v.decrypted_secret::jsonb ->> 'webhookSecret'
  from gym_payment_credentials c
  join vault.decrypted_secrets v on v.id = c.credentials_secret_id
  where c.business_id_plain = p_business_id and c.provider_key = p_provider_key;
$$;

revoke execute on function get_gym_payment_credentials_by_business_id from public, authenticated;
grant execute on function get_gym_payment_credentials_by_business_id to service_role;

-- ----------------------------------------------------------------------------
-- mark_gym_payment_credentials_needs_attention(): the single, narrow
-- service-role-callable write Task 5 needs -- not a general-purpose
-- credentials-mutation path. Only transitions false -> true (no-op, no audit
-- row, if already true) so a repeatedly-failing gym doesn't spam the audit
-- log on every retry.
--
-- Review finding: a stale in-flight initiate() failure (its credentials
-- lookup raced a concurrent disconnect) could otherwise flip needs_attention
-- back to true immediately after a successful, unrelated reconnect --
-- connect_gym_payment_credentials() clears needs_attention and sets a fresh
-- connected_at, then this call lands moments later and re-sets it, even
-- though the new credentials are fine. Guarded by requiring the current
-- connection to not be brand new (connected_at older than 30s) -- a
-- just-(re)connected row's failure signal is almost certainly stale, not a
-- real problem with the credentials just entered.
-- ----------------------------------------------------------------------------
create function mark_gym_payment_credentials_needs_attention(p_gym_id uuid, p_provider_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update gym_payment_credentials
  set needs_attention = true
  where gym_id = p_gym_id and provider_key = p_provider_key and needs_attention = false
    and connected_at < now() - interval '30 seconds';

  if found then
    perform log_audit_event(
      p_action_type => 'gym_payment_credentials_needs_attention',
      p_gym_id => p_gym_id,
      p_target_entity_id => p_provider_key,
      p_target_entity_type => 'gym_payment_credentials',
      p_metadata => jsonb_build_object('provider_key', p_provider_key)
    );
  end if;
end;
$$;

revoke execute on function mark_gym_payment_credentials_needs_attention from public, authenticated;
grant execute on function mark_gym_payment_credentials_needs_attention to service_role;

-- ----------------------------------------------------------------------------
-- get_gym_payment_connection_status(): extended to also surface
-- needs_attention (Task 5/AC #3) -- Settings' existing connection-status
-- fetch is the natural place for the "needs attention" banner to read from,
-- rather than a second RPC round-trip. Postgres cannot CREATE OR REPLACE a
-- function's RETURNS TABLE column list, so the function is dropped and
-- recreated -- same auth-free, security-definer shape as 0052's original.
-- ----------------------------------------------------------------------------
drop function get_gym_payment_connection_status(text);

create function get_gym_payment_connection_status(p_provider_key text)
returns table(business_id_masked text, connected_at timestamptz, needs_attention boolean)
language sql
stable
security definer
set search_path = public
as $$
  select business_id_masked, connected_at, needs_attention
  from gym_payment_credentials
  where gym_id = private.gym_id() and provider_key = p_provider_key;
$$;

revoke execute on function get_gym_payment_connection_status from public;
grant execute on function get_gym_payment_connection_status to authenticated, service_role;

-- ============================================================================
-- run_payment_reconciliation_job(): 4th detection block (FR-137), added
-- after the existing 3 (0032_payment_reconciliation_job.sql). Flags a
-- signature-verified, matched webhook event whose payload businessId
-- disagrees with its gym's connected business_id_plain -- "settled to a
-- different gym's account" (or the platform account under a stale name).
--
-- Review finding (post-implementation): the naive version of this check
-- (left join, unconditional `is distinct from`) floods the discrepancy
-- table with false positives -- every payment settled before any gym had
-- connected (all pre-Story-4.13 history) has no gym_payment_credentials row
-- yet, so it was unconditionally flagged; and a gym disconnecting/
-- reconnecting with a different account retroactively re-flagged its own
-- previously-correct payments. Fixed by requiring a connected row to exist
-- (inner join, not left join -- "never connected" is not itself evidence of
-- misrouting once this story ships, since initiate() cannot even attempt a
-- gym payment without one) and anchoring the comparison to the connection
-- that was actually in effect when the payment was created
-- (p.created_at >= g.connected_at), so a later disconnect/reconnect under a
-- different account doesn't retroactively re-flag payments settled under
-- the prior, since-superseded connection.
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

-- New partial unique index for the 4th category, same idempotent-nightly-run
-- discipline as the existing 3.
create unique index idx_payment_discrepancies_wrong_account_settlement
  on payment_discrepancies (webhook_event_id) where discrepancy_type = 'wrong_account_settlement';
