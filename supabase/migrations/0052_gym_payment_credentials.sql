-- Story 4.13: Per-Gym Tara Money Account Connection. Storage-and-UI half of
-- FR-126/FR-127/FR-128/NFR-017 -- lets a gym Owner connect their own gym's
-- Tara Money merchant credentials from Settings, Vault-encrypted (AD-15),
-- never returned to any client. Does NOT wire these credentials into actual
-- payment initiation or webhook verification -- TaraMoneyProvider.ts still
-- reads the platform-wide TARAMONEY_* env vars unchanged until Story 4.14's
-- routing-context design (AD-14) actually consumes what this migration
-- stores. Recorded in docs/decisions.md (Task 1's Vault hands-on check).

-- One Vault secret per (gym, provider) connection, not three separate
-- columns -- matches AD-15's "least code to own" rationale and gives
-- connect/disconnect exactly one vault.create_secret/update_secret/delete
-- call each. business_id_masked is a plain column so every connection-status
-- read (hit on every RenewalModal open, 4 call sites) never needs a Vault
-- decrypt round-trip.
create table gym_payment_credentials (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references gyms(id),
  provider_key text not null references payment_providers(provider_key),
  credentials_secret_id uuid not null, -- vault.secrets.id; decrypted JSON shape: {apiKey, businessId, webhookSecret}
  business_id_masked text not null,
  connected_by uuid references public.users(id),
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (gym_id, provider_key)
);

alter table gym_payment_credentials enable row level security;

-- See 0002 for why baseline table-level GRANTs are required alongside RLS.
grant select, insert, update, delete on gym_payment_credentials to authenticated, service_role;

-- Deny-all default, zero policies added for any role -- same "single
-- blessed write path, no direct access for anyone including the role that
-- conceptually owns the data" posture as payment_providers
-- (0029_payment_provider_registry.sql) and messaging_provider_config
-- (0050_messaging_provider_config.sql). The 3 functions below (security
-- definer, owned by the migration-running role) are the only access path,
-- for any role, including the connecting gym's own Owner.

-- ----------------------------------------------------------------------------
-- connect_gym_payment_credentials(): the only sanctioned write path for
-- creating/replacing a gym's Tara Money credentials. Mirrors
-- activate_payment_provider()'s shape (0029) and owner_update_own_gym's auth
-- check (0014: app_role = 'owner', gym resolved via private.gym_id(), never
-- a client-supplied gym id). Upserts: a reconnect replaces the old secret's
-- contents via vault.update_secret() rather than orphaning it in
-- vault.secrets with a fresh vault.create_secret() row every time.
-- ----------------------------------------------------------------------------
create function connect_gym_payment_credentials(
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

  -- A business_id of 4 characters or fewer would otherwise be fully
  -- revealed by right(x, 4) despite the "••••" prefix visually implying
  -- redaction -- NFR-017 says businessId must never be returned to any
  -- client. Real Tara Money business ids are far longer, so this only
  -- guards a defensive/direct-RPC-call edge case.
  v_masked := case
    when length(btrim(p_business_id)) > 4 then '•••• ' || right(btrim(p_business_id), 4)
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
    update gym_payment_credentials
    set business_id_masked = v_masked, connected_by = auth.uid(), updated_at = now()
    where id = v_existing_id;
  else
    v_secret_id := vault.create_secret(v_secret_json, 'gym_payment_credentials:' || v_gym_id || ':' || p_provider_key);
    insert into gym_payment_credentials (gym_id, provider_key, credentials_secret_id, business_id_masked, connected_by)
    values (v_gym_id, p_provider_key, v_secret_id, v_masked, auth.uid());
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

revoke execute on function connect_gym_payment_credentials from public;
grant execute on function connect_gym_payment_credentials to authenticated;

-- ----------------------------------------------------------------------------
-- disconnect_gym_payment_credentials(): the only sanctioned removal path.
-- Same owner-only auth check as connect. Idempotent no-op if no row exists.
-- ----------------------------------------------------------------------------
create function disconnect_gym_payment_credentials(p_provider_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
  v_row_id uuid;
  v_secret_id uuid;
  v_masked text;
begin
  if (auth.jwt() ->> 'app_role') is distinct from 'owner' then
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
$$;

revoke execute on function disconnect_gym_payment_credentials from public;
grant execute on function disconnect_gym_payment_credentials to authenticated;

-- ----------------------------------------------------------------------------
-- get_gym_payment_connection_status(): the one narrow read every gym-scoped
-- session needs (mirrors active_payment_provider()'s "one narrow read"
-- spirit, AD-13). Not owner-gated -- any authenticated gym-scoped session
-- (Owner/Manager/Receptionist) needs this to decide whether to show the
-- mobile_money option (AC #3 covers "a member or receptionist"); only the
-- two mutating functions above are Owner-exclusive. Zero rows = not
-- connected. The caller never sees credentials_secret_id.
-- ----------------------------------------------------------------------------
create function get_gym_payment_connection_status(p_provider_key text)
returns table(business_id_masked text, connected_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select business_id_masked, connected_at
  from gym_payment_credentials
  where gym_id = private.gym_id() and provider_key = p_provider_key;
$$;

revoke execute on function get_gym_payment_connection_status from public;
-- service_role grant is forward-looking for Story 4.14's Edge Function
-- consumption -- this story doesn't call it from there itself.
grant execute on function get_gym_payment_connection_status to authenticated, service_role;
