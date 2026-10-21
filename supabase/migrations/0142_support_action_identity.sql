-- Story 23.8: audit under the individual, disclosure and member-facing surfaces (FR-187, FR-195).
--
-- Since 0141 the real support person is recorded nowhere. This migration:
--
-- * adds public.support_action_identity(subject_table, subject_id, real_user_id, gym_id): RLS on, NO client policy, every privilege revoked.
--   The only reader is get_support_action_identity(), a Super Admin function (live AAL2).
-- * writes one identity row, in the SAME transaction as the action, at every choke point 0141 converted:
--     - audit_log, payments, refunds: an AFTER INSERT sibling trigger (the 0141 BEFORE trigger does not have the final row id; an AFTER
--       trigger on the table also covers every writer, including a future one, and every direct insert);
--     - gym_payment_credentials.connected_by, messaging_provider_config.updated_by, front_desk_alerts.dismissed_by: a call in the three
--       non-trigger writers.
--   A support action whose identity row cannot be written fails the action (the insert raises, the statement rolls back).
-- * adds the Owner disclosure request on one audit row of the Owner's own gym, and the Super Admin answer (stored; delivered outside the
--   product within disclosure_answer_business_days, read from private.session_limit()). Request and answer each write an audit_log row.
--
-- Rollback: scripts/rollback-0142-support-action-identity.sql.
set local lock_timeout = '5s';

-- ===== the one place the answer window lives =====
insert into private.session_limits_config (key, value, note) values
  ('disclosure_answer_business_days', 3, '[ASSUMPTION] business days within which GymOS answers an Owner disclosure request about an audit row')
on conflict (key) do nothing;

-- ===== the real person behind a support action =====
create table public.support_action_identity (
  id            uuid primary key default gen_random_uuid(),
  subject_table text not null check (subject_table in ('audit_log', 'payments', 'refunds', 'gym_payment_credentials', 'messaging_provider_config', 'front_desk_alerts')),
  subject_id    uuid not null,
  real_user_id  uuid not null,
  gym_id        uuid not null references public.gyms(id) on delete cascade,
  recorded_at   timestamptz not null default now()
);
create index support_action_identity_subject_idx on public.support_action_identity (subject_table, subject_id);
create index support_action_identity_gym_idx on public.support_action_identity (gym_id, recorded_at);
alter table public.support_action_identity enable row level security;
revoke all on public.support_action_identity from public, anon, authenticated, service_role;

-- No-op for everyone but a live support caller. For a live support caller it inserts the identity row (fail closed: any failure raises).
create or replace function private.record_support_identity(p_subject_table text, p_subject_id uuid, p_gym_id uuid default null)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_gym uuid;
begin
  v_gym := private.support_gym_id();
  if v_gym is null then
    return;
  end if;
  if auth.uid() is null or p_subject_id is null then
    raise exception 'support_identity_missing' using errcode = 'P0001';
  end if;
  -- the gym is the live support gym; a row that names another gym is a bug, never silently recorded under the wrong one
  if p_gym_id is not null and p_gym_id is distinct from v_gym then
    raise exception 'support_identity_missing' using errcode = 'P0001';
  end if;
  insert into public.support_action_identity (subject_table, subject_id, real_user_id, gym_id)
  values (p_subject_table, p_subject_id, auth.uid(), v_gym);
end;
$$;
revoke all on function private.record_support_identity(text, uuid, uuid) from public, anon, authenticated;
-- front_desk_alerts_protect_columns is not SECURITY DEFINER, so the calling role needs to reach it (it is a no-op unless a live support session)
grant execute on function private.record_support_identity(text, uuid, uuid) to authenticated, service_role;

create or replace function private.record_support_identity_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform private.record_support_identity(tg_table_name, new.id, new.gym_id);
  return new;
end;
$$;
revoke all on function private.record_support_identity_trigger() from public, anon, authenticated;

create trigger zz_record_support_identity after insert on public.audit_log
  for each row execute function private.record_support_identity_trigger();
create trigger zz_record_support_identity after insert on public.payments
  for each row execute function private.record_support_identity_trigger();
create trigger zz_record_support_identity after insert on public.refunds
  for each row execute function private.record_support_identity_trigger();

-- ===== the three writers that are not an insert trigger (bodies = 0141; only the identity calls are added) =====
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
  perform private.record_support_identity('messaging_provider_config', v_row_id);

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
    perform private.record_support_identity('front_desk_alerts', new.id, new.gym_id);
  end if;

  return new;
end;
$function$
;

-- ===== Super Admin read of the real person (live AAL2) =====
create or replace function public.get_support_action_identity(p_subject_table text, p_subject_ids uuid[])
returns table (subject_table text, subject_id uuid, real_user_id uuid, real_name text, real_email text, gym_id uuid, recorded_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform private.support_admin_required();
  if not private.is_super_admin_live() then
    raise exception 'permission denied';
  end if;
  return query
    select i.subject_table, i.subject_id, i.real_user_id, u.display_name, au.email::text, i.gym_id, i.recorded_at
      from public.support_action_identity i
      left join public.users u on u.id = i.real_user_id
      left join auth.users au on au.id = i.real_user_id
     where i.subject_table = p_subject_table
       and i.subject_id = any (coalesce(p_subject_ids, '{}'::uuid[]))
     order by i.recorded_at, i.id;
end;
$$;
revoke all on function public.get_support_action_identity(text, uuid[]) from public, anon;
grant execute on function public.get_support_action_identity(text, uuid[]) to authenticated, service_role;

-- ===== Owner disclosure request =====
create or replace function private.add_business_days(p_from timestamptz, p_days integer)
returns timestamptz
language plpgsql
immutable
set search_path = public
as $$
declare
  v_ts timestamptz := p_from;
  v_left integer := greatest(coalesce(p_days, 0), 0);
begin
  while v_left > 0 loop
    v_ts := v_ts + interval '1 day';
    if extract(isodow from v_ts at time zone 'UTC') < 6 then
      v_left := v_left - 1;
    end if;
  end loop;
  return v_ts;
end;
$$;
revoke all on function private.add_business_days(timestamptz, integer) from public, anon, authenticated;

create table public.audit_disclosure_requests (
  id              uuid primary key default gen_random_uuid(),
  gym_id          uuid not null references public.gyms(id) on delete cascade,
  audit_log_id    uuid not null references public.audit_log(id),
  requested_by    uuid not null references public.users(id),
  question        text not null check (char_length(question) between 3 and 500),
  requested_at    timestamptz not null default now(),
  answer_due_at   timestamptz not null,
  answered_at     timestamptz,
  answered_by     uuid references public.users(id),
  answer          text check (answer is null or char_length(answer) between 3 and 2000),
  constraint audit_disclosure_answer_consistent check ((answered_at is null) = (answer is null) and (answered_at is null) = (answered_by is null))
);
create unique index audit_disclosure_one_open_per_row on public.audit_disclosure_requests (audit_log_id) where answered_at is null;
create index audit_disclosure_gym_idx on public.audit_disclosure_requests (gym_id, requested_at desc);
alter table public.audit_disclosure_requests enable row level security;
revoke all on public.audit_disclosure_requests from public, anon, authenticated, service_role;

-- Owner only (current_member_role() is NULL for support). Result codes: ok | question_invalid | not_found | already_open
create or replace function public.file_audit_disclosure_request(p_audit_log_id uuid, p_question text)
returns table (ok boolean, code text, request_id uuid, answer_due_at timestamptz)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_gym      uuid;
  v_question text := btrim(coalesce(p_question, ''));
  v_id       uuid;
  v_due      timestamptz;
begin
  if (select private.current_member_role())::text is distinct from 'owner' then
    raise exception 'permission denied';
  end if;
  v_gym := private.gym_id();
  if v_gym is null then
    raise exception 'permission denied';
  end if;
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'file_audit_disclosure_request: gym % is not active', v_gym;
  end if;
  if char_length(v_question) not between 3 and 500 then
    return query select false, 'question_invalid'::text, null::uuid, null::timestamptz;
    return;
  end if;
  -- a row of another gym, a row with no gym, and a row that does not exist all answer the same
  if not exists (select 1 from public.audit_log a where a.id = p_audit_log_id and a.gym_id = v_gym) then
    return query select false, 'not_found'::text, null::uuid, null::timestamptz;
    return;
  end if;
  if exists (select 1 from public.audit_disclosure_requests r where r.audit_log_id = p_audit_log_id and r.answered_at is null) then
    return query select false, 'already_open'::text, null::uuid, null::timestamptz;
    return;
  end if;

  v_due := private.add_business_days(now(), private.session_limit('disclosure_answer_business_days'));
  insert into public.audit_disclosure_requests (gym_id, audit_log_id, requested_by, question, answer_due_at)
  values (v_gym, p_audit_log_id, auth.uid(), v_question, v_due)
  returning id into v_id;

  perform log_audit_event(
    p_action_type => 'audit_disclosure_requested',
    p_gym_id => v_gym,
    p_target_entity_id => v_id::text,
    p_target_entity_type => 'audit_disclosure_request',
    p_metadata => jsonb_build_object('audit_log_id', p_audit_log_id, 'answer_due_at', v_due)
  );
  return query select true, 'ok'::text, v_id, v_due;
end;
$$;
revoke all on function public.file_audit_disclosure_request(uuid, text) from public, anon;
grant execute on function public.file_audit_disclosure_request(uuid, text) to authenticated, service_role;

-- The Owner's own gym only. answered_by (a Super Admin) is never returned.
create or replace function public.get_gym_disclosure_requests()
returns table (id uuid, audit_log_id uuid, question text, requested_at timestamptz, answer_due_at timestamptz, answered_at timestamptz, answer text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_gym uuid;
begin
  if (select private.current_member_role())::text is distinct from 'owner' then
    raise exception 'permission denied';
  end if;
  v_gym := private.gym_id();
  if v_gym is null then
    raise exception 'permission denied';
  end if;
  return query
    select r.id, r.audit_log_id, r.question, r.requested_at, r.answer_due_at, r.answered_at, r.answer
      from public.audit_disclosure_requests r
     where r.gym_id = v_gym
     order by r.requested_at desc, r.id;
end;
$$;
revoke all on function public.get_gym_disclosure_requests() from public, anon;
grant execute on function public.get_gym_disclosure_requests() to authenticated, service_role;

-- ===== Super Admin inbox and answer =====
create or replace function public.get_disclosure_inbox()
returns table (
  id uuid, gym_id uuid, gym_name text, audit_log_id uuid, audit_action_type text, audit_created_at timestamptz,
  question text, requested_at timestamptz, answer_due_at timestamptz, overdue boolean, answered_at timestamptz, answer text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform private.support_admin_required();
  return query
    select r.id, r.gym_id, g.name, r.audit_log_id, a.action_type, a.created_at,
           r.question, r.requested_at, r.answer_due_at, (r.answered_at is null and r.answer_due_at < now()),
           r.answered_at, r.answer
      from public.audit_disclosure_requests r
      join public.gyms g on g.id = r.gym_id
      join public.audit_log a on a.id = r.audit_log_id
     order by (r.answered_at is null) desc, r.requested_at desc, r.id;
end;
$$;
revoke all on function public.get_disclosure_inbox() from public, anon;
grant execute on function public.get_disclosure_inbox() to authenticated, service_role;

-- Result codes: ok | answer_invalid | not_found | already_answered
create or replace function public.answer_audit_disclosure_request(p_request_id uuid, p_answer text)
returns table (ok boolean, code text)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_answer text := btrim(coalesce(p_answer, ''));
  v_req    record;
begin
  perform private.support_admin_required();
  if char_length(v_answer) not between 3 and 2000 then
    return query select false, 'answer_invalid'::text;
    return;
  end if;
  select r.id, r.gym_id, r.audit_log_id, r.answered_at into v_req
    from public.audit_disclosure_requests r where r.id = p_request_id for update;
  if not found then
    return query select false, 'not_found'::text;
    return;
  end if;
  if v_req.answered_at is not null then
    return query select false, 'already_answered'::text;
    return;
  end if;
  update public.audit_disclosure_requests
     set answered_at = now(), answered_by = auth.uid(), answer = v_answer
   where id = p_request_id;
  -- gym_id stays NULL: a gym-scoped row is readable by that gym's Owner, and the answering Super Admin is named on it
  perform log_audit_event(
    p_action_type => 'audit_disclosure_answered',
    p_gym_id => null,
    p_target_entity_id => p_request_id::text,
    p_target_entity_type => 'audit_disclosure_request',
    p_metadata => jsonb_build_object('gym_id', v_req.gym_id, 'audit_log_id', v_req.audit_log_id)
  );
  return query select true, 'ok'::text;
end;
$$;
revoke all on function public.answer_audit_disclosure_request(uuid, text) from public, anon;
grant execute on function public.answer_audit_disclosure_request(uuid, text) to authenticated, service_role;

-- ===== the opaque proxy id of the caller's own gym =====
-- A gym screen that resolves "recorded by" through members finds no row for the proxy (it has no membership), and users is self-read only.
-- This returns just the gym's proxy id (an opaque id the gym already holds in payments.actor_id), so a screen can label it "GymOS Support" on
-- the gym side or show the gym on the member side. NULL for support itself and for anyone with no live membership.
create or replace function public.get_gym_support_proxy_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_gym uuid;
begin
  v_gym := private.gym_id();
  if v_gym is null or (select private.current_member_role()) is null then
    return null;
  end if;
  return (select u.id from public.users u where u.is_support_proxy and u.support_proxy_gym_id = v_gym);
end;
$$;
revoke all on function public.get_gym_support_proxy_id() from public, anon;
grant execute on function public.get_gym_support_proxy_id() to authenticated, service_role;

-- privileges of the replaced functions are unchanged (restated for the guardrail)
revoke all on function public.connect_gym_payment_credentials(text, text, text, text) from public, anon;
revoke all on function public.update_messaging_instance(text) from public, anon;
revoke all on function public.front_desk_alerts_protect_columns() from public, anon;
