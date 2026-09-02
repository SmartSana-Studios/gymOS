-- Story 4.16: Platform Business ID Collision Guard. Closes a gap flagged in
-- Story 11.6's code review (2026-08-30, deferred-work.md:661): nothing
-- previously stopped a gym from registering business_id_plain equal to the
-- platform's own TARAMONEY_BUSINESS_ID via connect_gym_payment_credentials().
-- That collision would let a gym's own account shadow platform-account
-- webhook traffic (or vice versa) under TaraMoneyProvider.ts's businessId-
-- based routing (Story 4.14). The existing
-- idx_gym_payment_credentials_provider_business_id index (0054) only
-- prevents gym-vs-gym collisions -- it cannot see the platform's own ID,
-- which lives outside any table row (a Supabase Edge Function secret,
-- TARAMONEY_BUSINESS_ID, never exposed to Postgres or apps/dashboard).
--
-- Design: rather than inventing a GUC-mirrors-env-var side channel (which
-- AD-13 argues against -- payment provider config is DB/RPC-driven, not
-- env-var-driven), the platform's business ID is read from a Supabase Vault
-- secret named 'platform:taramoney:business_id', mirroring AD-15's existing
-- per-gym-credentials Vault pattern and the vault.decrypted_secrets lookup
-- shape already used by get_gym_payment_credentials_by_business_id (0054).
-- business_id_plain is explicitly not a secret (0054's own comment) --
-- Vault here is just this codebase's sanctioned place for a runtime-supplied
-- value, not a confidentiality requirement.
--
-- This migration seeds no secret value itself -- the real business ID is
-- environment-specific and must never be hardcoded in a committed migration.
-- Seeding `select vault.create_secret('<value>', 'platform:taramoney:business_id');`
-- once per real environment is a documented out-of-band step
-- (docs/deploy-runbook.md). If the secret is absent (e.g. a fresh local/CI
-- DB before it's been seeded), the guard no-ops rather than failing every
-- connect attempt -- same tolerance already shown by
-- TARAMONEY_INITIATION_ENABLED defaulting enabled when unset.
--
-- connect_gym_payment_credentials() has exactly one prior definition
-- (0054_flow_a_gym_routing.sql:40-153, confirmed via repo-wide grep -- no
-- later migration redefines it). Per this codebase's append-only-migrations
-- convention, 0054 is not hand-edited; this carries the full function body
-- forward via create or replace, with the new guard inserted immediately
-- after v_plain is computed and before any row/secret is touched -- fail
-- fast, no partial state, no audit-log row for a rejected attempt.
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
  v_platform_business_id text;
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
