-- Rollback for migration 0143 (support connects the payment account).
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0143-support-payment-connection.sql
-- Data effects: every RETIRED gym_payment_credentials row (and its Vault secret, if still there) is DELETED, because the one-row-per-
-- (gym, provider) unique constraint comes back; the payments.credentials_id column, every staff_notices row and every email_outbox row
-- are DELETED. After this, a payment started under a retired credential can no longer be verified under it.
-- Audit rows written by the connect function stay (audit_log is immutable). Run only with the dashboard and the Super Admin app
-- rolled back first (they call the functions dropped here).

select cron.unschedule('payment_connection_cleanup');
drop function if exists private.payment_connection_cleanup();

drop trigger if exists payments_pin_credentials_id on public.payments;
drop function if exists private.payments_pin_credentials_id();

delete from private.support_capabilities
 where object_name in ('support_connect_gym_payment_credentials', 'get_gym_payment_connection_status', 'get_support_connection_gym');

drop function if exists public.get_support_connection_gym();
drop function if exists public.support_connect_gym_payment_credentials(text, text, text, text);
drop function if exists public.record_email_outbox_run(integer, integer, timestamptz);
drop function if exists public.finish_email_outbox(uuid, boolean, text);
drop function if exists public.claim_email_outbox(integer);
drop function if exists public.mark_staff_notices_read(uuid[]);
drop function if exists public.count_unread_staff_notices();
drop function if exists public.get_staff_notices(integer);

-- the bodies that read credentials_id go back to their 0142 / 0141 / 0124 / 0076 versions
CREATE OR REPLACE FUNCTION public.initiate_registration_fee_payment(p_member_id uuid)
 RETURNS TABLE(payment_id uuid, provider_key text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid;
  v_actor_id uuid;
  v_fee integer;
  v_role member_role;
  v_deactivated_at timestamptz;
  v_settled_at timestamptz;
  v_fee_status payment_status;
  v_provider text;
  v_payment_id uuid;
begin
  -- Fail closed: a missing app_role claim makes the comparison NULL, and
  -- `not NULL` would skip the raise.
  if not coalesce((select private.current_member_role())::text = any(array['owner', 'manager', 'supervisor', 'receptionist']), false) then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  if private.current_gym_status() is distinct from 'active' then
    raise exception 'initiate_registration_fee_payment: gym % is not active', v_gym_id;
  end if;

  v_actor_id := private.actor_id();

  -- Payment row before member row (lock order), so an expired attempt is
  -- flagged before the member lock is taken.
  perform private.expire_stale_registration_fee_payment(p_member_id, v_gym_id);

  select m.role, m.deactivated_at, m.registration_fee_settled_at
    into v_role, v_deactivated_at, v_settled_at
  from members m
  where m.id = p_member_id and m.gym_id = v_gym_id
  for update;

  if not found or v_role is distinct from 'member' then
    raise exception 'not_found: member % not found', p_member_id;
  end if;

  if v_deactivated_at is not null then
    raise exception 'member_deactivated: member % is deactivated', p_member_id;
  end if;

  select p.status into v_fee_status
  from payments p
  where p.member_id = p_member_id
    and p.purpose = 'registration_fee'
    and p.voided_at is null
    and p.status <> 'flagged'
  limit 1;

  if found then
    if v_fee_status = 'processing' then
      raise exception 'registration_fee_already_pending: member % has a registration fee payment in progress', p_member_id;
    end if;
    raise exception 'registration_fee_already_recorded: member % already has a registration fee payment', p_member_id;
  end if;

  if v_settled_at is not null then
    raise exception 'registration_fee_not_due: member % has no registration fee outstanding', p_member_id;
  end if;

  select g.registration_fee into v_fee from gyms g where g.id = v_gym_id;

  if coalesce(v_fee, 0) <= 0 then
    raise exception 'registration_fee_not_configured: gym % charges no registration fee', v_gym_id;
  end if;

  select active_payment_provider() into v_provider;
  if v_provider is null then
    raise exception 'initiate_registration_fee_payment: no_active_provider';
  end if;

  begin
    insert into payments (gym_id, member_id, subscription_id, amount, currency, method, status, provider, actor_id, purpose)
    values (v_gym_id, p_member_id, null, v_fee, 'XAF', 'mobile_money', 'processing', v_provider, v_actor_id, 'registration_fee')
    returning id into v_payment_id;
  exception when unique_violation then
    raise exception 'registration_fee_already_pending: member % has a registration fee payment in progress', p_member_id;
  end;

  payment_id := v_payment_id;
  provider_key := v_provider;
  return next;
  return;
end;
$function$

;

CREATE OR REPLACE FUNCTION public.initiate_session_payment()
 RETURNS TABLE(payment_id uuid, provider_key text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid;
  v_caller_role member_role;
  v_member_id uuid;
  v_charging boolean;
  v_role member_role;
  v_deactivated_at timestamptz;
  v_settled_at timestamptz;
  v_plan_type plan_type;
  v_price integer;
  v_currency text;
  v_provider text;
  v_payment_id uuid;
begin
  v_caller_role := private.current_member_role();

  -- Staff and coaches are refused. A null role is allowed through only to
  -- reach the member row below: current_member_role() ignores deactivated
  -- rows, and the matrix names `member_deactivated` for that member.
  if v_caller_role is not null and v_caller_role is distinct from 'member' then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  if private.current_gym_status() is distinct from 'active' then
    raise exception 'initiate_session_payment: gym % is not active', v_gym_id;
  end if;

  select m.id into v_member_id
  from members m
  where m.user_id = auth.uid() and m.gym_id = v_gym_id and m.role = 'member'
  order by m.deactivated_at nulls first
  limit 1;

  if v_member_id is null then
    raise exception 'permission denied';
  end if;

  select g.charge_guests_per_session into v_charging from gyms g where g.id = v_gym_id;
  if not coalesce(v_charging, false) then
    raise exception 'charging_disabled: this gym does not charge guests per session';
  end if;

  -- Payment rows before the member row (lock order): flag an expired attempt
  -- before the member lock is taken.
  perform private.expire_stale_payment(v_member_id, v_gym_id, 'session');

  select m.role, m.deactivated_at, m.registration_fee_settled_at
    into v_role, v_deactivated_at, v_settled_at
  from members m
  where m.id = v_member_id and m.gym_id = v_gym_id
  for no key update;

  if not found or v_role is distinct from 'member' then
    raise exception 'permission denied';
  end if;

  if v_deactivated_at is not null then
    raise exception 'member_deactivated: member % is deactivated', v_member_id;
  end if;

  if v_settled_at is null then
    raise exception 'registration_fee_not_settled: member % has not settled the registration fee', v_member_id;
  end if;

  select pl.plan_type, pl.price, pl.currency
    into v_plan_type, v_price, v_currency
  from subscriptions s
  join plans pl on pl.id = s.plan_id
  where s.member_id = v_member_id
  order by s.created_at desc, s.id desc
  limit 1;

  if not found or v_plan_type is distinct from 'pay_per_session' then
    raise exception 'plan_not_per_session: member % is not on a pay-per-session plan', v_member_id;
  end if;

  if coalesce(v_price, 0) <= 0 then
    raise exception 'session_price_not_set: the pay-per-session plan has no price';
  end if;

  if exists (
    select 1 from payments p
    where p.member_id = v_member_id
      and p.gym_id = v_gym_id
      and p.purpose = 'session'
      and p.voided_at is null
      and p.status in ('pending', 'processing')
  ) then
    raise exception 'session_payment_already_in_progress: member % has a session payment in progress', v_member_id;
  end if;

  select active_payment_provider() into v_provider;
  if v_provider is null
     or not exists (
       select 1 from gym_payment_credentials c
       where c.gym_id = v_gym_id and c.provider_key = v_provider
     ) then
    raise exception 'no_active_provider: this gym has no connected payment provider';
  end if;

  begin
    insert into payments (gym_id, member_id, subscription_id, amount, currency, method, status, provider, actor_id, purpose)
    values (v_gym_id, v_member_id, null, v_price, v_currency, 'mobile_money', 'processing', v_provider, private.actor_id(), 'session')
    returning id into v_payment_id;
  exception when unique_violation then
    raise exception 'session_payment_already_in_progress: member % has a session payment in progress', v_member_id;
  end;

  payment_id := v_payment_id;
  provider_key := v_provider;
  return next;
  return;
end;
$function$

;

CREATE OR REPLACE FUNCTION public.initiate_member_payment()
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid;
  v_member_id uuid;
  v_deactivated_at timestamptz;
  v_subscription_status text;
  v_plan_price integer;
  v_plan_currency text;
  v_provider_key text;
  v_payment_id uuid;
begin
  if (select private.current_member_role())::text is distinct from 'member' then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'initiate_member_payment: gym % is not active', v_gym_id;
  end if;

  -- order by deactivated_at nulls first: same idx_members_active_gym_user
  -- (0003) uniqueness caveat check_in() already documents -- prefer an
  -- active row over a deactivated historical one if both somehow coexist.
  select id, deactivated_at into v_member_id, v_deactivated_at
  from members
  where user_id = auth.uid() and gym_id = v_gym_id
  order by deactivated_at nulls first
  limit 1;

  if v_member_id is null then
    raise exception 'initiate_member_payment: no member record found for the caller';
  end if;

  if v_deactivated_at is not null then
    raise exception 'initiate_member_payment: member is deactivated';
  end if;

  -- Review finding: without this, a double-tap, a retry after a client-side
  -- failure, or two devices on the same account could each create their own
  -- `processing` row and fire a second real USSD prompt -- the one-open-
  -- payment-at-a-time analogue of check_in()'s one-open-session enforcement
  -- this function otherwise mirrors.
  if exists (
    select 1 from payments where member_id = v_member_id and status = 'processing'
  ) then
    raise exception 'initiate_member_payment: payment_already_pending for member %', v_member_id;
  end if;

  -- Mirrors apps/dashboard/services/payments.ts's initiatePayment() join
  -- exactly: subscriptions -> plans is a many-to-one FK, so a plain join
  -- (not an array) is correct here. Most-recent-by-created_at, same
  -- "renewal resolves to the new row" precedent as check_in()'s own
  -- subscription-status guard.
  select s.status, p.price, p.currency into v_subscription_status, v_plan_price, v_plan_currency
  from subscriptions s
  join plans p on p.id = s.plan_id
  where s.gym_id = v_gym_id and s.member_id = v_member_id
  order by s.created_at desc
  limit 1;

  if v_plan_price is null then
    raise exception 'initiate_member_payment: no_active_plan for member %', v_member_id;
  end if;

  -- Review finding: the Home CTA only *offers* Renew for expiring_soon/
  -- grace_period/expired -- without this check, any member session could
  -- call this RPC directly (bypassing the UI) and self-initiate a charge
  -- while their subscription is still fully active.
  if v_subscription_status not in ('expiring_soon', 'grace_period', 'expired') then
    raise exception 'initiate_member_payment: not_eligible_for_renewal for member %', v_member_id;
  end if;

  -- Review finding: planSchema explicitly allows a zero-price (free/comp)
  -- plan -- without this, a free-plan member would still get a real
  -- `processing` row and a real 0-amount mobile-money charge attempt.
  if v_plan_price <= 0 then
    raise exception 'initiate_member_payment: no_active_plan for member %', v_member_id;
  end if;

  select active_payment_provider() into v_provider_key;
  if v_provider_key is null then
    raise exception 'initiate_member_payment: no_active_provider';
  end if;

  insert into payments (gym_id, member_id, amount, currency, method, status, provider)
  values (v_gym_id, v_member_id, v_plan_price, v_plan_currency, 'mobile_money', 'processing', v_provider_key)
  returning id into v_payment_id;

  return v_payment_id;
end;
$function$

;

CREATE OR REPLACE FUNCTION public.run_payment_reconciliation_job()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
$function$

;

CREATE OR REPLACE FUNCTION public.disconnect_gym_payment_credentials(p_provider_key text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid;
  v_row_id uuid;
  v_secret_id uuid;
  v_masked text;
begin
  if (select private.current_member_role())::text is distinct from 'owner' then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  delete from gym_payment_credentials
  where gym_id = v_gym_id and provider_key = p_provider_key
  returning id, credentials_secret_id, business_id_masked into v_row_id, v_secret_id, v_masked;

  if v_row_id is null then
    return;
  end if;

  delete from vault.secrets where id = v_secret_id;

  -- Review fix (Story 4.13): mirror connect's audit metadata shape --
  -- without it, an investigator reading the audit trail after a disconnect
  -- has no record of which masked business id was disconnected (the
  -- gym_payment_credentials row and the Vault secret are both already gone
  -- by this point).
  perform log_audit_event(
    p_action_type => 'gym_payment_credentials_disconnected',
    p_gym_id => v_gym_id,
    p_target_entity_id => p_provider_key,
    p_target_entity_type => 'gym_payment_credentials',
    p_metadata => jsonb_build_object('provider_key', p_provider_key, 'business_id_masked', v_masked)
  );
end;
$function$

;

CREATE OR REPLACE FUNCTION public.connect_gym_payment_credentials(p_provider_key text, p_api_key text, p_business_id text, p_webhook_secret text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid;
  v_existing_id uuid;
  v_existing_secret_id uuid;
  v_secret_id uuid;
  v_masked text;
  v_plain text;
  v_secret_json text;
  v_platform_business_id text;
begin
  if (select private.current_member_role())::text is distinct from 'owner' then
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

  -- Platform-collision guard (Story 4.16), scoped to TaraMoney only -- the
  -- whole justification (TaraMoneyProvider.ts's businessId-based webhook
  -- routing) and the Vault secret name are TaraMoney-specific; a future
  -- second provider must not be rejected for an unrelated ID namespace.
  -- Absent secret => no-op, not a hard failure, so an unseeded environment's
  -- connect flow behaves exactly as it did before this story shipped.
  -- order by + limit 1 is defensive: this is the first name-keyed Vault
  -- lookup in this codebase (existing lookups join by primary-key id
  -- instead), so a re-seed resolves deterministically (most-recent wins)
  -- regardless of whether name-uniqueness is enforced upstream.
  -- btrim on the read side matches v_plain's own btrim, so a stray
  -- whitespace/newline introduced while seeding the secret can't silently
  -- defeat the comparison.
  if p_provider_key = 'taramoney' then
    select btrim(v.decrypted_secret) into v_platform_business_id
    from vault.decrypted_secrets v
    where v.name = 'platform:taramoney:business_id'
    order by v.created_at desc
    limit 1;

    if v_platform_business_id is not null and v_plain = v_platform_business_id then
      raise exception 'connect_gym_payment_credentials: business_id_plain matches the platform''s own account';
    end if;
  end if;

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
      connected_by = private.actor_id(),
      connected_at = now(),
      updated_at = now()
    where id = v_existing_id;
    perform private.record_support_identity('gym_payment_credentials', v_existing_id, v_gym_id);
  else
    v_secret_id := vault.create_secret(v_secret_json, 'gym_payment_credentials:' || v_gym_id || ':' || p_provider_key);
    insert into gym_payment_credentials (
      gym_id, provider_key, credentials_secret_id, business_id_masked, business_id_plain, connected_by
    )
    values (v_gym_id, p_provider_key, v_secret_id, v_masked, v_plain, private.actor_id())
    returning id into v_existing_id;
    perform private.record_support_identity('gym_payment_credentials', v_existing_id, v_gym_id);
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
$function$

;


CREATE OR REPLACE FUNCTION public.get_gym_payment_connection_status(p_provider_key text)
 RETURNS TABLE(business_id_masked text, connected_at timestamp with time zone, needs_attention boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select business_id_masked, connected_at, needs_attention
  from gym_payment_credentials
  where gym_id = private.gym_id() and provider_key = p_provider_key;
$function$

;


drop function if exists public.get_gym_payment_credentials_for_service(uuid, text, uuid);
drop function if exists public.get_gym_payment_credentials_by_business_id(text, text, text, text);
drop function if exists public.mark_gym_payment_credentials_needs_attention(uuid, text, uuid);

CREATE OR REPLACE FUNCTION public.get_gym_payment_credentials_for_service(p_gym_id uuid, p_provider_key text)
 RETURNS TABLE(api_key text, business_id text, webhook_secret text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    v.decrypted_secret::jsonb ->> 'apiKey',
    v.decrypted_secret::jsonb ->> 'businessId',
    v.decrypted_secret::jsonb ->> 'webhookSecret'
  from gym_payment_credentials c
  join vault.decrypted_secrets v on v.id = c.credentials_secret_id
  where c.gym_id = p_gym_id and c.provider_key = p_provider_key;
$function$

;

CREATE OR REPLACE FUNCTION public.get_gym_payment_credentials_by_business_id(p_business_id text, p_provider_key text)
 RETURNS TABLE(gym_id uuid, api_key text, business_id text, webhook_secret text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    c.gym_id,
    v.decrypted_secret::jsonb ->> 'apiKey',
    v.decrypted_secret::jsonb ->> 'businessId',
    v.decrypted_secret::jsonb ->> 'webhookSecret'
  from gym_payment_credentials c
  join vault.decrypted_secrets v on v.id = c.credentials_secret_id
  where c.business_id_plain = p_business_id and c.provider_key = p_provider_key;
$function$

;

CREATE OR REPLACE FUNCTION public.mark_gym_payment_credentials_needs_attention(p_gym_id uuid, p_provider_key text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$

;

CREATE OR REPLACE FUNCTION private.stepup_issue(p_user uuid, p_action text, p_subject text)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_expires timestamptz;
begin
  if p_user is null or p_subject is null or p_action is null then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if p_action not in ('remove_super_admin_factor', 'create_super_admin', 'change_recovery_email', 'remove_recovery_email', 'support_refund', 'support_waive_registration_fee', 'support_create_staff') then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if p_action like 'support\_%' then
    -- Story 23.6: a support grant goes to an activated, unlocked, non-deactivated support account, whatever the Super Admin flag says.
    if not exists (select 1 from private.support_accounts sa
                    where sa.user_id = p_user and sa.activated_at is not null and sa.locked_at is null
                      and sa.reset_pending_at is null and sa.deactivated_at is null) then
      raise exception 'permission_denied' using errcode = '42501';
    end if;
  else
    if not coalesce((select u.is_super_admin from users u where u.id = p_user), false) then
      raise exception 'permission_denied' using errcode = '42501';
    end if;
    if not private.super_admin_aal2_required() or private.super_admin_locked(p_user) then
      return null;
    end if;
  end if;

  delete from private.support_stepup
   where user_id = p_user and (consumed_at is not null or expires_at <= now());
  delete from private.support_stepup
   where user_id = p_user and action = p_action and subject_id = p_subject and consumed_at is null;
  v_expires := now() + make_interval(mins => private.session_limit('stepup_ttl_minutes'));
  insert into private.support_stepup (user_id, action, subject_id, expires_at)
  values (p_user, p_action, p_subject, v_expires);

  update private.super_admin_lockout set failed_count = 0 where user_id = p_user and locked_at is null;
  return v_expires;
end;
$function$

;


revoke all on function public.get_gym_payment_credentials_for_service(uuid, text) from public, anon, authenticated;
revoke all on function public.get_gym_payment_credentials_by_business_id(text, text) from public, anon, authenticated;
revoke all on function public.mark_gym_payment_credentials_needs_attention(uuid, text) from public, anon, authenticated;
grant execute on function public.get_gym_payment_credentials_for_service(uuid, text) to service_role;
grant execute on function public.get_gym_payment_credentials_by_business_id(text, text) to service_role;
grant execute on function public.mark_gym_payment_credentials_needs_attention(uuid, text) to service_role;

drop function if exists private.connect_payment_credentials(uuid, text, text, text, text, boolean);
drop function if exists private.notify_payment_connection_change(uuid, boolean);
drop table if exists public.email_outbox;
drop table if exists public.staff_notices;

alter table public.payments drop column credentials_id;

delete from vault.secrets where id in (select credentials_secret_id from public.gym_payment_credentials where retired_at is not null);
delete from public.gym_payment_credentials where retired_at is not null;
drop index if exists public.gym_payment_credentials_active_gym_provider;
drop index if exists public.idx_gym_payment_credentials_provider_business_id;
alter table public.gym_payment_credentials add constraint gym_payment_credentials_gym_id_provider_key_key unique (gym_id, provider_key);
create unique index idx_gym_payment_credentials_provider_business_id
  on public.gym_payment_credentials (provider_key, business_id_plain) where business_id_plain is not null;
alter table public.gym_payment_credentials drop column secret_deleted_at, drop column retired_at;
