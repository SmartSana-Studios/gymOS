-- Story 23.9: support connects the payment account (FR-180 amended 2026-10-15, AD-37). AD-36 (Owner approval) is dropped.
--
-- * gym_payment_credentials is no longer overwritten in place. A replacement RETIRES the active row (retired_at) and inserts a new
--   active one with its own Vault secret and its own connected_at. The unique constraints become partial over active rows, so rolling
--   back to an earlier merchant is a new row.
-- * payments.credentials_id records the row a payment was initiated under (backfilled; pinned by trigger). Webhook, status check and
--   reconciliation verify under it, never under "the active row by connected_at". A retired row stays resolvable while a payment
--   references it; a deleted secret resolves to nothing (the webhook then answers 401 before any write).
-- * support_connect_gym_payment_credentials: live support assignment + single-use step-up (support_payment_connection, subject gym id).
--   Owner path and support path share private.connect_payment_credentials (retire-and-insert, 0083 collision guard, audit without values).
-- * A support change writes one Owner notice and one notice per Super Admin (staff_notices, bilingual, no individual named) and queues
--   an e-mail for each (email_outbox). The queue is drained by the Super Admin app (apps/super-admin/lib/mail.ts); a failed send never
--   rolls back the change, is retried (5 attempts) and recorded in job_runs.
-- * payment_connection_cleanup (daily cron) deletes the Vault secret of a retired row after 7 days with nothing pending/processing
--   under it (hard cap 14 days), and records the run in job_runs.
-- Rollback: scripts/rollback-0143-support-payment-connection.sql.
set local lock_timeout = '5s';

-- ===== 1. retire instead of overwrite =====
alter table public.gym_payment_credentials
  add column retired_at timestamptz,
  add column secret_deleted_at timestamptz;

alter table public.gym_payment_credentials drop constraint gym_payment_credentials_gym_id_provider_key_key;
create unique index gym_payment_credentials_active_gym_provider
  on public.gym_payment_credentials (gym_id, provider_key) where retired_at is null;

drop index public.idx_gym_payment_credentials_provider_business_id;
create unique index idx_gym_payment_credentials_provider_business_id
  on public.gym_payment_credentials (provider_key, business_id_plain)
  where business_id_plain is not null and retired_at is null;

-- ===== 2. payments.credentials_id =====
alter table public.payments add column credentials_id uuid references public.gym_payment_credentials(id);
create index payments_credentials_id_idx on public.payments (credentials_id) where credentials_id is not null;

-- Backfill: a payment before the current row's anchor was settled under an earlier in-place connection that no longer exists, so it
-- stays null (the old reconciliation skipped it the same way); an unfinished one resolves under the current row as it always did.
alter table public.payments disable trigger user;
update public.payments p
   set credentials_id = c.id
  from public.gym_payment_credentials c
 where c.gym_id = p.gym_id and c.provider_key = p.provider and p.provider is not null and p.credentials_id is null
   and (p.created_at >= c.connected_at or p.status in ('pending', 'processing'));
alter table public.payments enable trigger user;

-- Authoritative: whatever a client supplies, an insert is stamped with the gym's own active row for its provider; an update cannot move it.
create or replace function private.payments_pin_credentials_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.credentials_id := case
      when new.provider is null or new.gym_id is null then null
      else (select c.id from gym_payment_credentials c
             where c.gym_id = new.gym_id and c.provider_key = new.provider and c.retired_at is null)
    end;
  else
    new.credentials_id := old.credentials_id;
  end if;
  return new;
end;
$$;
revoke all on function private.payments_pin_credentials_id() from public, anon, authenticated;
create trigger payments_pin_credentials_id before insert or update on public.payments
  for each row execute function private.payments_pin_credentials_id();

-- ===== 3. notices and the e-mail queue =====
create table public.staff_notices (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  gym_id      uuid references public.gyms(id) on delete cascade,
  notice_type text not null,
  title_en    text not null,
  title_fr    text not null,
  body_en     text not null,
  body_fr     text not null,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index staff_notices_user_idx on public.staff_notices (user_id, created_at desc);
alter table public.staff_notices enable row level security;
revoke all on public.staff_notices from public, anon, authenticated;
grant select, insert, update, delete on public.staff_notices to service_role;

create table public.email_outbox (
  id               uuid primary key default gen_random_uuid(),
  notice_id        uuid references public.staff_notices(id) on delete set null,
  recipient_email  text not null,
  subject          text not null,
  body             text not null,
  status           text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  attempts         integer not null default 0,
  next_attempt_at  timestamptz not null default now(),
  claimed_at       timestamptz,
  last_error       text,
  created_at       timestamptz not null default now(),
  sent_at          timestamptz
);
create index email_outbox_due_idx on public.email_outbox (next_attempt_at) where status in ('pending', 'sending');
alter table public.email_outbox enable row level security;
revoke all on public.email_outbox from public, anon, authenticated;
grant select, insert, update, delete on public.email_outbox to service_role;

-- The caller's own notices for the gym they are in (a Super Admin, with no gym, sees all of theirs).
create or replace function public.get_staff_notices(p_limit integer default 20)
returns table (id uuid, notice_type text, title_en text, title_fr text, body_en text, body_fr text, created_at timestamptz, read_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select n.id, n.notice_type, n.title_en, n.title_fr, n.body_en, n.body_fr, n.created_at, n.read_at
    from public.staff_notices n
   where n.user_id = auth.uid()
     and (n.gym_id is null or private.gym_id() is null or n.gym_id = private.gym_id())
   order by n.created_at desc
   limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

create or replace function public.count_unread_staff_notices()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from public.staff_notices n
   where n.user_id = auth.uid() and n.read_at is null
     and (n.gym_id is null or private.gym_id() is null or n.gym_id = private.gym_id());
$$;

create or replace function public.mark_staff_notices_read(p_ids uuid[] default null)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  update public.staff_notices n set read_at = now()
   where n.user_id = auth.uid() and n.read_at is null and (p_ids is null or n.id = any (p_ids));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.get_staff_notices(integer) from public, anon;
revoke all on function public.count_unread_staff_notices() from public, anon;
revoke all on function public.mark_staff_notices_read(uuid[]) from public, anon;
grant execute on function public.get_staff_notices(integer) to authenticated, service_role;
grant execute on function public.count_unread_staff_notices() to authenticated, service_role;
grant execute on function public.mark_staff_notices_read(uuid[]) to authenticated, service_role;

-- Queue worker interface (service role only; the worker lives in the Super Admin app).
create or replace function public.claim_email_outbox(p_limit integer default 20)
returns table (id uuid, recipient_email text, subject text, body text, attempts integer)
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  -- a row stuck 'sending' after its last allowed attempt is given up on, never claimed again
  update public.email_outbox o
     set status = 'failed', last_error = coalesce(o.last_error, 'abandoned'), claimed_at = null
   where o.status = 'sending' and o.attempts >= 5 and o.claimed_at < now() - interval '10 minutes';

  return query
  with c as (
    select o.id from public.email_outbox o
     where (o.status = 'pending' and o.next_attempt_at <= now())
        or (o.status = 'sending' and o.attempts < 5 and o.claimed_at < now() - interval '10 minutes')
     order by o.created_at
     limit greatest(1, least(coalesce(p_limit, 20), 50))
       for update skip locked)
  update public.email_outbox o
     set status = 'sending', claimed_at = now(), attempts = o.attempts + 1
    from c
   where o.id = c.id
  returning o.id, o.recipient_email, o.subject, o.body, o.attempts;
end;
$$;

-- Result of one send. A failure is retried with a growing delay up to 5 attempts, then marked failed. p_error is a short reason
-- (the mail helper already scrubs addresses and keys); it is capped here as well.
create or replace function public.finish_email_outbox(p_id uuid, p_sent boolean, p_error text default null)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if p_sent then
    update public.email_outbox set status = 'sent', sent_at = now(), last_error = null, claimed_at = null where id = p_id;
  else
    update public.email_outbox
       set status = case when attempts >= 5 then 'failed' else 'pending' end,
           next_attempt_at = now() + make_interval(mins => 5 * attempts),
           last_error = left(coalesce(p_error, 'send_failed'), 200),
           claimed_at = null
     where id = p_id;
  end if;
end;
$$;

create or replace function public.record_email_outbox_run(p_sent integer, p_failed integer, p_started_at timestamptz default now())
returns void
language sql
volatile
security definer
set search_path = public
as $$
  insert into job_runs (job_name, started_at, finished_at, status, error)
  values ('payment_connection_email', coalesce(p_started_at, now()), now(),
          case when coalesce(p_failed, 0) > 0 then 'failure'::job_status else 'success'::job_status end,
          case when coalesce(p_failed, 0) > 0 then p_failed || ' send(s) failed, ' || coalesce(p_sent, 0) || ' sent' end);
$$;

revoke all on function public.claim_email_outbox(integer) from public, anon, authenticated;
revoke all on function public.finish_email_outbox(uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.record_email_outbox_run(integer, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_email_outbox(integer) to service_role;
grant execute on function public.finish_email_outbox(uuid, boolean, text) to service_role;
grant execute on function public.record_email_outbox_run(integer, integer, timestamptz) to service_role;

-- One Owner notice per owner of the gym and one per Super Admin, each with its e-mail. The text names no individual and no credential.
create or replace function private.notify_payment_connection_change(p_gym_id uuid, p_replaced boolean)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_gym_name text;
  v_notice_id uuid;
  v_email text;
  r record;
begin
  select g.name into v_gym_name from gyms g where g.id = p_gym_id;

  for r in
    select distinct m.user_id as uid, 'owner'::text as kind
      from members m
     where m.gym_id = p_gym_id and m.role = 'owner' and m.deactivated_at is null and m.user_id is not null
    union
    select u.id, 'admin'
      from users u
     where u.is_super_admin and not u.is_support_proxy
  loop
    insert into staff_notices (user_id, gym_id, notice_type, title_en, title_fr, body_en, body_fr)
    values (
      r.uid, p_gym_id, 'payment_connection_changed',
      case r.kind when 'owner' then 'GymOS Support updated your payment account'
                  else 'GymOS Support updated a gym payment account' end,
      case r.kind when 'owner' then 'GymOS Support a mis à jour votre compte de paiement'
                  else 'GymOS Support a mis à jour le compte de paiement d''une salle' end,
      case r.kind when 'owner' then 'The payment account connected to your gym was ' || case when p_replaced then 'replaced' else 'connected' end
                                    || ' by GymOS Support. If you did not expect this, contact GymOS.'
                  else 'GymOS Support ' || case when p_replaced then 'replaced' else 'connected' end
                       || ' the payment account of ' || coalesce(v_gym_name, 'a gym') || '.' end,
      case r.kind when 'owner' then 'Le compte de paiement connecté à votre salle a été ' || case when p_replaced then 'remplacé' else 'connecté' end
                                    || ' par GymOS Support. Si vous ne l''attendiez pas, contactez GymOS.'
                  else 'GymOS Support a ' || case when p_replaced then 'remplacé' else 'connecté' end
                       || ' le compte de paiement de ' || coalesce(v_gym_name, 'une salle') || '.' end)
    returning id into v_notice_id;

    select coalesce(
             (select nullif(btrim(au.email), '') from auth.users au where au.id = r.uid),
             (select nullif(btrim(m2.email), '') from members m2 where m2.user_id = r.uid and m2.gym_id = p_gym_id limit 1))
      into v_email;

    if v_email is not null then
      insert into email_outbox (notice_id, recipient_email, subject, body)
      select v_notice_id, v_email, n.title_en || ' / ' || n.title_fr, n.body_en || E'\n\n' || n.body_fr
        from staff_notices n where n.id = v_notice_id;
    end if;
  end loop;
end;
$$;
revoke all on function private.notify_payment_connection_change(uuid, boolean) from public, anon, authenticated;

-- ===== 4. the shared connect logic (retire and insert) =====
create or replace function private.connect_payment_credentials(
  p_gym_id uuid, p_provider_key text, p_api_key text, p_business_id text, p_webhook_secret text, p_by_support boolean)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_old_id uuid;
  v_new_id uuid := gen_random_uuid();
  v_secret_id uuid;
  v_masked text;
  v_plain text;
  v_secret_json text;
  v_platform_business_id text;
begin
  if p_gym_id is null then
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

  if length(p_api_key) > 500 or length(p_business_id) > 200 or length(p_webhook_secret) > 500 then
    raise exception 'connect_gym_payment_credentials: a credential value exceeds the maximum length';
  end if;

  v_plain := btrim(p_business_id);

  -- Platform-collision guard (Story 4.16 / 0083), TaraMoney only.
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

  v_masked := case
    when length(v_plain) > 4 then '•••• ' || right(v_plain, 4)
    else '••••'
  end;
  v_secret_json := jsonb_build_object('apiKey', p_api_key, 'businessId', p_business_id, 'webhookSecret', p_webhook_secret)::text;

  -- Serialize concurrent connects for the same (gym, provider).
  perform pg_advisory_xact_lock(hashtextextended(p_gym_id::text || ':' || p_provider_key, 0));

  select id into v_old_id
  from gym_payment_credentials
  where gym_id = p_gym_id and provider_key = p_provider_key and retired_at is null
  for update;

  -- Retire first: the partial unique indexes only cover active rows. The old secret is NOT touched (a payment started under it is
  -- still verified with it); payment_connection_cleanup deletes it later.
  if v_old_id is not null then
    update gym_payment_credentials set retired_at = now(), updated_at = now() where id = v_old_id;
  end if;

  v_secret_id := vault.create_secret(v_secret_json, 'gym_payment_credentials:' || p_gym_id || ':' || p_provider_key || ':' || v_new_id);
  insert into gym_payment_credentials (
    id, gym_id, provider_key, credentials_secret_id, business_id_masked, business_id_plain, connected_by
  )
  values (v_new_id, p_gym_id, p_provider_key, v_secret_id, v_masked, v_plain, private.actor_id());
  perform private.record_support_identity('gym_payment_credentials', v_new_id, p_gym_id);

  -- Metadata never includes the apiKey, businessId or webhookSecret values.
  perform log_audit_event(
    p_action_type => 'gym_payment_credentials_connected',
    p_gym_id => p_gym_id,
    p_target_entity_id => p_provider_key,
    p_target_entity_type => 'gym_payment_credentials',
    p_metadata => jsonb_build_object('provider_key', p_provider_key, 'business_id_masked', v_masked,
                                     'replaced', v_old_id is not null, 'by_support', p_by_support)
  );

  if p_by_support then
    perform private.notify_payment_connection_change(p_gym_id, v_old_id is not null);
  end if;

  return v_new_id;
end;
$$;
revoke all on function private.connect_payment_credentials(uuid, text, text, text, text, boolean) from public, anon, authenticated;

create or replace function public.connect_gym_payment_credentials(p_provider_key text, p_api_key text, p_business_id text, p_webhook_secret text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
begin
  if (select private.current_member_role())::text is distinct from 'owner' then
    raise exception 'permission denied';
  end if;
  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;
  perform private.connect_payment_credentials(v_gym_id, p_provider_key, p_api_key, p_business_id, p_webhook_secret, false);
end;
$$;

create or replace function public.support_connect_gym_payment_credentials(p_provider_key text, p_api_key text, p_business_id text, p_webhook_secret text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
begin
  v_gym_id := private.support_rpc_gym_id('support_connect_gym_payment_credentials');
  -- a live support caller only: a gym-scoped session (Owner or other staff) has its own gym id and uses the Owner function
  if v_gym_id is null or private.gym_id() is not null then
    raise exception 'permission denied';
  end if;
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'support_connect_gym_payment_credentials: gym % is not active', v_gym_id;
  end if;
  -- single-use step-up bound to this action and this gym; it is consumed inside this transaction, so any later failure restores it
  perform private.support_stepup_require('support_payment_connection', v_gym_id::text);
  perform private.connect_payment_credentials(v_gym_id, p_provider_key, p_api_key, p_business_id, p_webhook_secret, true);
end;
$$;

revoke all on function public.connect_gym_payment_credentials(text, text, text, text) from public, anon;
revoke all on function public.support_connect_gym_payment_credentials(text, text, text, text) from public, anon;
grant execute on function public.connect_gym_payment_credentials(text, text, text, text) to authenticated, service_role;
grant execute on function public.support_connect_gym_payment_credentials(text, text, text, text) to authenticated, service_role;

-- Disconnect: a row any payment references is retired (kept for reconciliation and in-flight verification); one nothing references is
-- deleted. The secret goes at once unless a payment under it is still pending/processing (the cleanup job then removes it).
create or replace function public.disconnect_gym_payment_credentials(p_provider_key text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
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

  select id, credentials_secret_id, business_id_masked into v_row_id, v_secret_id, v_masked
  from gym_payment_credentials
  where gym_id = v_gym_id and provider_key = p_provider_key and retired_at is null
  for update;

  if v_row_id is null then
    return;
  end if;

  if exists (select 1 from payments p where p.credentials_id = v_row_id) then
    update gym_payment_credentials set retired_at = now(), updated_at = now() where id = v_row_id;
    if not exists (select 1 from payments p where p.credentials_id = v_row_id and p.status in ('pending', 'processing')) then
      delete from vault.secrets where id = v_secret_id;
      update gym_payment_credentials set secret_deleted_at = now() where id = v_row_id;
    end if;
  else
    delete from gym_payment_credentials where id = v_row_id;
    delete from vault.secrets where id = v_secret_id;
  end if;

  perform log_audit_event(
    p_action_type => 'gym_payment_credentials_disconnected',
    p_gym_id => v_gym_id,
    p_target_entity_id => p_provider_key,
    p_target_entity_type => 'gym_payment_credentials',
    p_metadata => jsonb_build_object('provider_key', p_provider_key, 'business_id_masked', v_masked)
  );
end;
$$;

-- Connection status: the active row only; readable by a gym session and by a live support session (listed in the allow-list below).
create or replace function public.get_gym_payment_connection_status(p_provider_key text)
returns table (business_id_masked text, connected_at timestamptz, needs_attention boolean)
language sql
stable
security definer
set search_path = public
as $$
  select business_id_masked, connected_at, needs_attention
  from gym_payment_credentials
  where gym_id = private.support_rpc_gym_id('get_gym_payment_connection_status')
    and provider_key = p_provider_key and retired_at is null;
$$;
revoke all on function public.get_gym_payment_connection_status(text) from public, anon;
grant execute on function public.get_gym_payment_connection_status(text) to authenticated, service_role;

-- Which gym a live support session is working in (NULL for everyone else): lets the dashboard action choose the support path from the
-- database's live decision instead of reading the app_role claim.
create or replace function public.get_support_connection_gym()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case when private.gym_id() is null then private.support_rpc_gym_id('get_support_connection_gym') end;
$$;
revoke all on function public.get_support_connection_gym() from public, anon;
grant execute on function public.get_support_connection_gym() to authenticated, service_role;

-- ===== 5. lookups by credential id (service role only) =====
drop function public.get_gym_payment_credentials_for_service(uuid, text);
create function public.get_gym_payment_credentials_for_service(p_gym_id uuid, p_provider_key text, p_credentials_id uuid default null)
returns table (api_key text, business_id text, webhook_secret text, credentials_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select v.decrypted_secret::jsonb ->> 'apiKey',
         v.decrypted_secret::jsonb ->> 'businessId',
         v.decrypted_secret::jsonb ->> 'webhookSecret',
         c.id
    from gym_payment_credentials c
    join vault.decrypted_secrets v on v.id = c.credentials_secret_id
   where c.gym_id = p_gym_id and c.provider_key = p_provider_key
     and ((p_credentials_id is not null and c.id = p_credentials_id) or (p_credentials_id is null and c.retired_at is null));
$$;

drop function public.get_gym_payment_credentials_by_business_id(text, text);
create function public.get_gym_payment_credentials_by_business_id(
  p_business_id text, p_provider_key text, p_provider_ref text default null, p_product_id text default null)
returns table (gym_id uuid, api_key text, business_id text, webhook_secret text, credentials_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select c.gym_id,
         v.decrypted_secret::jsonb ->> 'apiKey',
         v.decrypted_secret::jsonb ->> 'businessId',
         v.decrypted_secret::jsonb ->> 'webhookSecret',
         c.id
    from gym_payment_credentials c
    join vault.decrypted_secrets v on v.id = c.credentials_secret_id
   where c.business_id_plain = p_business_id and c.provider_key = p_provider_key
     and (c.retired_at is null or exists (select 1 from payments p where p.credentials_id = c.id))
   order by
     exists (select 1 from payments p where p.credentials_id = c.id
                and (p.provider_transaction_ref = p_provider_ref or p.id::text = p_product_id)) desc,
     (c.retired_at is null) desc,
     c.connected_at desc
   limit 1;
$$;

drop function public.mark_gym_payment_credentials_needs_attention(uuid, text);
create function public.mark_gym_payment_credentials_needs_attention(p_gym_id uuid, p_provider_key text, p_credentials_id uuid default null)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  update gym_payment_credentials
  set needs_attention = true
  where gym_id = p_gym_id and provider_key = p_provider_key and needs_attention = false
    and retired_at is null
    and (p_credentials_id is null or id = p_credentials_id)
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

revoke all on function public.get_gym_payment_credentials_for_service(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.get_gym_payment_credentials_by_business_id(text, text, text, text) from public, anon, authenticated;
revoke all on function public.mark_gym_payment_credentials_needs_attention(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.get_gym_payment_credentials_for_service(uuid, text, uuid) to service_role;
grant execute on function public.get_gym_payment_credentials_by_business_id(text, text, text, text) to service_role;
grant execute on function public.mark_gym_payment_credentials_needs_attention(uuid, text, uuid) to service_role;

-- ===== 6. allow-list rows and the step-up action =====
insert into private.support_capabilities (capability, kind, object_name) values
  ('payment_connection', 'rpc', 'support_connect_gym_payment_credentials'),
  ('payment_connection', 'rpc', 'get_gym_payment_connection_status'),
  ('payment_connection', 'rpc', 'get_support_connection_gym');

-- ===== 7. cleanup of retired secrets =====
create or replace function private.payment_connection_cleanup()
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_started timestamptz := now();
  v_row record;
  v_failed integer := 0;
  v_deleted integer := 0;
  v_mail_purged integer := 0;
  v_notices_purged integer := 0;
  v_error text;
begin
  -- 7 days after retirement, once nothing is pending/processing under the row; 14 days is the hard cap whatever is still open
  for v_row in
    select c.id, c.gym_id, c.credentials_secret_id
      from gym_payment_credentials c
     where c.retired_at is not null and c.secret_deleted_at is null
       and c.retired_at <= now() - interval '7 days'
       and (c.retired_at <= now() - interval '14 days'
            or not exists (select 1 from payments p where p.credentials_id = c.id and p.status in ('pending', 'processing')))
     order by c.retired_at
  loop
    begin
      delete from vault.secrets where id = v_row.credentials_secret_id;
      update gym_payment_credentials set secret_deleted_at = now() where id = v_row.id;
      perform log_audit_event(
        p_action_type => 'gym_payment_credentials_secret_deleted',
        p_gym_id => v_row.gym_id,
        p_target_entity_id => v_row.id::text,
        p_target_entity_type => 'gym_payment_credentials',
        p_system_actor_label => 'system:payment_connection_cleanup',
        p_metadata => '{}'::jsonb
      );
      v_deleted := v_deleted + 1;
    exception when others then
      v_failed := v_failed + 1;
      v_error := left(sqlerrm, 200);
    end;
  end loop;

  -- housekeeping in the same run: finished queue rows after 90 days, notices after 180 days
  begin
    delete from email_outbox where status in ('sent', 'failed') and created_at < now() - interval '90 days';
    get diagnostics v_mail_purged = row_count;
    delete from staff_notices where created_at < now() - interval '180 days';
    get diagnostics v_notices_purged = row_count;
  exception when others then
    v_failed := v_failed + 1;
    v_error := left(sqlerrm, 200);
  end;

  insert into job_runs (job_name, started_at, finished_at, status, error)
  values ('payment_connection_cleanup', v_started, now(),
          case when v_failed > 0 then 'failure'::job_status else 'success'::job_status end,
          case when v_failed > 0 then v_failed || ' failed, ' || v_deleted || ' deleted, ' || v_mail_purged || ' mails and ' || v_notices_purged || ' notices purged: ' || v_error
               when v_mail_purged + v_notices_purged > 0 then v_deleted || ' secrets deleted, ' || v_mail_purged || ' mails and ' || v_notices_purged || ' notices purged' end);
end;
$$;
revoke all on function private.payment_connection_cleanup() from public, anon, authenticated;
grant execute on function private.payment_connection_cleanup() to service_role;

-- 03:45 UTC daily; cron.schedule() upserts by name
select cron.schedule('payment_connection_cleanup', '45 3 * * *', $$ select private.payment_connection_cleanup(); $$);

-- ===== 8. step-up allow-list, initiators and reconciliation (bodies = the live ones; only credentials_id changes) =====
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
  if p_action not in ('remove_super_admin_factor', 'create_super_admin', 'change_recovery_email', 'remove_recovery_email', 'support_refund', 'support_waive_registration_fee', 'support_create_staff', 'support_payment_connection') then
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

;

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
    insert into payments (gym_id, member_id, subscription_id, amount, currency, method, status, provider, actor_id, purpose, credentials_id)
    values (v_gym_id, p_member_id, null, v_fee, 'XAF', 'mobile_money', 'processing', v_provider, v_actor_id, 'registration_fee', (select c.id from gym_payment_credentials c where c.gym_id = v_gym_id and c.provider_key = v_provider and c.retired_at is null))
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
       where c.gym_id = v_gym_id and c.provider_key = v_provider and c.retired_at is null
     ) then
    raise exception 'no_active_provider: this gym has no connected payment provider';
  end if;

  begin
    insert into payments (gym_id, member_id, subscription_id, amount, currency, method, status, provider, actor_id, purpose, credentials_id)
    values (v_gym_id, v_member_id, null, v_price, v_currency, 'mobile_money', 'processing', v_provider, private.actor_id(), 'session', (select c.id from gym_payment_credentials c where c.gym_id = v_gym_id and c.provider_key = v_provider and c.retired_at is null))
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

  insert into payments (gym_id, member_id, amount, currency, method, status, provider, credentials_id)
  values (v_gym_id, v_member_id, v_plan_price, v_plan_currency, 'mobile_money', 'processing', v_provider_key, (select c.id from gym_payment_credentials c where c.gym_id = v_gym_id and c.provider_key = v_provider_key and c.retired_at is null))
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
    join gym_payment_credentials g on g.id = p.credentials_id
    where e.status = 'verified'
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

-- CREATE OR REPLACE keeps the existing privileges; restated so the guardrail sees them
revoke all on function public.disconnect_gym_payment_credentials(text) from public, anon;
revoke all on function public.initiate_member_payment() from public, anon;
revoke all on function public.initiate_registration_fee_payment(uuid) from public, anon;
revoke all on function public.initiate_session_payment() from public, anon;
revoke all on function public.run_payment_reconciliation_job() from public, anon;
revoke all on function private.stepup_issue(uuid, text, text) from public, anon, authenticated;

do $verify$
begin
  if to_regprocedure('public.support_connect_gym_payment_credentials(text,text,text,text)') is null then
    raise exception '0143: support connect function missing';
  end if;
  if pg_get_functiondef('public.initiate_session_payment()'::regprocedure) not like '%credentials_id%'
     or pg_get_functiondef('public.initiate_registration_fee_payment(uuid)'::regprocedure) not like '%credentials_id%'
     or pg_get_functiondef('public.initiate_member_payment()'::regprocedure) not like '%credentials_id%' then
    raise exception '0143: a payment initiator does not record credentials_id';
  end if;
  if pg_get_functiondef('public.run_payment_reconciliation_job()'::regprocedure) not like '%g.id = p.credentials_id%' then
    raise exception '0143: reconciliation is not joined on credentials_id';
  end if;
  if pg_get_functiondef('private.stepup_issue(uuid,text,text)'::regprocedure) not like '%support_payment_connection%' then
    raise exception '0143: stepup_issue does not accept support_payment_connection';
  end if;
end
$verify$;
