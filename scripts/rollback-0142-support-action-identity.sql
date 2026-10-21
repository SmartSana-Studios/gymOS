-- Rollback for migration 0142 (support action identity, disclosure requests).
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0142-support-action-identity.sql
-- Data effects: every support_action_identity row (the real person behind each support action) and every audit_disclosure_requests row
-- (requests and answers) is DELETED. Export them first if they must survive:
--   \copy public.support_action_identity to 'support_action_identity.csv' csv header
--   \copy public.audit_disclosure_requests to 'audit_disclosure_requests.csv' csv header
-- Audit rows written by file_audit_disclosure_request / answer_audit_disclosure_request stay (audit_log is immutable).

drop function if exists public.answer_audit_disclosure_request(uuid, text);
drop function if exists public.get_disclosure_inbox();
drop function if exists public.get_gym_disclosure_requests();
drop function if exists public.file_audit_disclosure_request(uuid, text);
drop table if exists public.audit_disclosure_requests;
drop function if exists private.add_business_days(timestamptz, integer);
drop function if exists public.get_support_action_identity(text, uuid[]);
drop function if exists public.get_gym_support_proxy_id();

drop trigger if exists zz_record_support_identity on public.refunds;
drop trigger if exists zz_record_support_identity on public.payments;
drop trigger if exists zz_record_support_identity on public.audit_log;

-- restore 0141's bodies of the three non-trigger writers (they call private.record_support_identity, so restore them before dropping it)
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
  else
    v_secret_id := vault.create_secret(v_secret_json, 'gym_payment_credentials:' || v_gym_id || ':' || p_provider_key);
    insert into gym_payment_credentials (
      gym_id, provider_key, credentials_secret_id, business_id_masked, business_id_plain, connected_by
    )
    values (v_gym_id, p_provider_key, v_secret_id, v_masked, v_plain, private.actor_id());
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

CREATE OR REPLACE FUNCTION public.update_messaging_instance(p_instance_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_previous text;
  v_row_id uuid;
begin
  if not private.is_super_admin() then
    raise exception 'permission denied';
  end if;

  if p_instance_id is null or btrim(p_instance_id) = '' then
    raise exception 'update_messaging_instance: instance_id must not be empty';
  end if;

  -- Lock the singleton row before reading it, for the identical race-safety
  -- reason documented in activate_payment_provider()'s comment (concurrent
  -- callers must not both log a stale previous_instance_id).
  select id, instance_id into v_row_id, v_previous from messaging_provider_config for update;

  update messaging_provider_config
  set instance_id = p_instance_id, updated_by = private.actor_id(), updated_at = now()
  where id = v_row_id;

  -- Saving the same value twice is still a legitimate, intentional Super
  -- Admin action worth its own audit trail entry (unlike
  -- activate_payment_provider's idempotent reactivate case) -- no no-op
  -- short-circuit here.
  --
  -- The audit write is wrapped in its own exception block (review finding):
  -- without it, an audit_log failure would roll back the instance_id update
  -- above via plpgsql's default whole-transaction rollback, blocking AC #2's
  -- "takes effect with no redeploy" guarantee on an unrelated subsystem
  -- failure. A failed audit write is logged and swallowed rather than
  -- re-raised, so the instance change still lands.
  begin
    perform log_audit_event(
      p_action_type => 'messaging_instance_updated',
      p_target_entity_id => v_row_id::text,
      p_target_entity_type => 'messaging_provider_config',
      p_metadata => jsonb_build_object(
        'previous_instance_id', v_previous,
        'new_instance_id', p_instance_id
      )
    );
  exception when others then
    raise warning 'update_messaging_instance: audit log write failed, instance update still applied: %', sqlerrm;
  end;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.front_desk_alerts_protect_columns()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.gym_id is distinct from old.gym_id
    or new.member_id is distinct from old.member_id
    or new.kind is distinct from old.kind
    or new.status is distinct from old.status
    or new.expiry_date is distinct from old.expiry_date
    or new.created_at is distinct from old.created_at
  then
    raise exception 'front_desk_alerts: only dismissed_at/dismissed_by may be updated';
  end if;

  if new.dismissed_at is not null and old.dismissed_at is null then
    new.dismissed_by := private.actor_id();
  end if;

  return new;
end;
$function$
;

revoke all on function public.connect_gym_payment_credentials(text, text, text, text) from public, anon;
revoke all on function public.update_messaging_instance(text) from public, anon;
revoke all on function public.front_desk_alerts_protect_columns() from public, anon;

drop function if exists private.record_support_identity_trigger();
drop function if exists private.record_support_identity(text, uuid, uuid);
drop table if exists public.support_action_identity;
delete from private.session_limits_config where key = 'disclosure_answer_business_days';
