-- Story 6.2: Subscription Lifecycle Notifications (N-01, N-02, N-03).
-- Lifecycle dispatch remains database-owned: one logical event fans out to
-- one independently tracked delivery per registered Expo token.

create extension if not exists pg_net with schema extensions;

-- A dispatch is the idempotency boundary for one notification in one
-- subscription lifecycle. Renewals create a new subscriptions row, so the
-- subscription id naturally distinguishes future renewal cycles.
create table private.notification_dispatches (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  notification_code text not null
    check (notification_code in ('N-01', 'N-02', 'N-03')),
  status text not null default 'pending'
    check (status in ('pending', 'queued', 'no_tokens')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subscription_id, notification_code)
);

-- Expo delivery is asynchronous and two-stage. Keep the push request,
-- returned ticket, and receipt request/result on the individual token row.
create table private.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  dispatch_id uuid not null references private.notification_dispatches(id) on delete cascade,
  expo_push_token text not null,
  push_request_id bigint not null,
  expo_ticket_id text,
  receipt_request_id bigint,
  status text not null default 'push_pending'
    check (status in (
      'push_pending',
      'receipt_pending',
      'delivered',
      'failed',
      'device_not_registered'
    )),
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (dispatch_id, expo_push_token)
);

create index idx_notification_deliveries_due
  on private.notification_deliveries (status, updated_at)
  where status in ('push_pending', 'receipt_pending');

create unique index idx_notification_deliveries_push_request
  on private.notification_deliveries (push_request_id);

create unique index idx_notification_deliveries_receipt_request
  on private.notification_deliveries (receipt_request_id)
  where receipt_request_id is not null;

alter table private.notification_dispatches enable row level security;
alter table private.notification_deliveries enable row level security;

-- Both tables live in the non-exposed private schema and intentionally have
-- no anon/authenticated policies or privileges. Postgres-owned cron jobs
-- bypass RLS; service_role retains explicit server-side operational access.
grant select, insert, update, delete
  on private.notification_dispatches, private.notification_deliveries
  to service_role;

-- Single dispatch entry point. Callers supply only the domain identity and
-- reviewed code; user, gym, language, token, and copy are all derived here.
create function private.send_push_notification(
  p_subscription_id uuid,
  p_notification_code text
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_dispatch_id uuid;
  v_user_id uuid;
  v_gym_id uuid;
  v_gym_name text;
  v_language text;
  v_title text;
  v_body text;
  v_token record;
  v_request_id bigint;
  v_delivery_count integer := 0;
begin
  if p_notification_code not in ('N-01', 'N-02', 'N-03') then
    raise exception 'unsupported notification code: %', p_notification_code;
  end if;

  select m.user_id, s.gym_id, g.name,
         case when lower(coalesce(u.preferred_language, 'en')) = 'fr' then 'fr' else 'en' end
  into v_user_id, v_gym_id, v_gym_name, v_language
  from subscriptions s
  join members m on m.id = s.member_id
  join users u on u.id = m.user_id
  join gyms g on g.id = s.gym_id
  where s.id = p_subscription_id;

  if not found then
    raise exception 'subscription not found: %', p_subscription_id;
  end if;

  if p_notification_code = 'N-01' then
    if v_language = 'fr' then
      v_title := 'Abonnement bientôt expiré — 7 jours';
      v_body := format('Votre abonnement à %s expire dans 7 jours.', v_gym_name);
    else
      v_title := 'Membership expiring — 7 days';
      v_body := format('Your %s membership expires in 7 days.', v_gym_name);
    end if;
  elsif p_notification_code = 'N-02' then
    if v_language = 'fr' then
      v_title := 'Abonnement bientôt expiré — 1 jour';
      v_body := format('Votre abonnement à %s expire demain.', v_gym_name);
    else
      v_title := 'Membership expiring — 1 day';
      v_body := format('Your %s membership expires tomorrow.', v_gym_name);
    end if;
  else
    if v_language = 'fr' then
      v_title := 'Abonnement expiré';
      v_body := format('Votre abonnement à %s a expiré. Renouvelez-le pour rétablir votre accès.', v_gym_name);
    else
      v_title := 'Membership expired';
      v_body := format('Your %s membership has expired. Renew to restore access.', v_gym_name);
    end if;
  end if;

  insert into private.notification_dispatches (subscription_id, notification_code)
  values (p_subscription_id, p_notification_code)
  on conflict (subscription_id, notification_code) do nothing
  returning id into v_dispatch_id;

  -- Another invocation already owns this logical event. Do not enqueue even
  -- if its outcome was no_tokens or a terminal delivery failure.
  if v_dispatch_id is null then
    return;
  end if;

  -- Each token's enqueue is wrapped in its own BEGIN...EXCEPTION block so a
  -- net.http_post/insert failure on one device cannot roll back the dispatch
  -- row or another device's already-queued delivery in this same loop.
  for v_token in
    select expo_push_token
    from device_push_tokens
    where user_id = v_user_id
    order by id
  loop
    begin
      v_request_id := net.http_post(
        url := 'https://exp.host/--/api/v2/push/send',
        body := jsonb_build_object(
          'to', v_token.expo_push_token,
          'title', v_title,
          'body', v_body,
          'sound', 'default',
          'data', jsonb_build_object(
            'notificationCode', p_notification_code,
            'subscriptionId', p_subscription_id::text,
            'gymId', v_gym_id::text
          )
        ),
        headers := jsonb_build_object('Content-Type', 'application/json')
      );

      insert into private.notification_deliveries (
        dispatch_id,
        expo_push_token,
        push_request_id
      ) values (
        v_dispatch_id,
        v_token.expo_push_token,
        v_request_id
      );

      v_delivery_count := v_delivery_count + 1;
    exception when others then
      raise warning 'send_push_notification: delivery enqueue failed for token %: %', v_token.expo_push_token, sqlerrm;
    end;
  end loop;

  update private.notification_dispatches
  set status = case when v_delivery_count = 0 then 'no_tokens' else 'queued' end,
      updated_at = now()
  where id = v_dispatch_id;
end;
$$;

revoke execute on function private.send_push_notification(uuid, text) from public;
grant execute on function private.send_push_notification(uuid, text) to service_role;

-- Companion worker for pg_net's asynchronous response ledger. Each row is
-- isolated so a malformed or failed Expo response cannot block later rows.
create function private.process_notification_deliveries()
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_delivery record;
  v_response jsonb;
  v_item jsonb;
  v_expo_status text;
  v_error_code text;
  v_error_message text;
  v_receipt_request_id bigint;
begin
  -- Guards against the every-minute cron.schedule overlapping itself if one
  -- run ever takes longer than a minute: a second concurrent invocation
  -- returns immediately instead of both processing the same delivery row.
  -- Xact-scoped and re-entrant for the same session, so calling this more
  -- than once within one transaction (e.g. pgTAP fixtures) is unaffected.
  -- (Superseded by 0046's create-or-replace, which extends this same guard
  -- to the payment-keyed ledger too.)
  if not pg_try_advisory_xact_lock(hashtext('private.process_notification_deliveries')::bigint) then
    return;
  end if;

  for v_delivery in
    select
      d.id,
      d.status as delivery_status,
      d.expo_push_token,
      d.expo_ticket_id,
      r.status_code,
      r.content,
      r.timed_out,
      r.error_msg
    from private.notification_deliveries d
    join net._http_response r
      on r.id = case
        when d.status = 'push_pending' then d.push_request_id
        when d.status = 'receipt_pending' then d.receipt_request_id
      end
    where d.status in ('push_pending', 'receipt_pending')
    order by d.created_at, d.id
  loop
    begin
      if coalesce(v_delivery.timed_out, false) or v_delivery.error_msg is not null then
        update private.notification_deliveries
        set status = 'failed',
            error_code = 'TRANSPORT_ERROR',
            error_message = coalesce(v_delivery.error_msg, 'request timed out'),
            updated_at = now(),
            completed_at = now()
        where id = v_delivery.id;
        continue;
      end if;

      if v_delivery.status_code is null
         or v_delivery.status_code < 200
         or v_delivery.status_code >= 300 then
        update private.notification_deliveries
        set status = 'failed',
            error_code = coalesce('HTTP_' || v_delivery.status_code::text, 'HTTP_ERROR'),
            error_message = coalesce(v_delivery.content, 'HTTP request failed'),
            updated_at = now(),
            completed_at = now()
        where id = v_delivery.id;
        continue;
      end if;

      begin
        v_response := v_delivery.content::jsonb;
      exception when others then
        update private.notification_deliveries
        set status = 'failed',
            error_code = 'MALFORMED_RESPONSE',
            error_message = sqlerrm,
            updated_at = now(),
            completed_at = now()
        where id = v_delivery.id;
        continue;
      end;

      if v_delivery.delivery_status = 'push_pending' then
        v_item := v_response -> 'data';
        if jsonb_typeof(v_item) = 'array' then
          v_item := v_item -> 0;
        end if;

        v_expo_status := v_item ->> 'status';
        v_error_code := v_item #>> '{details,error}';
        v_error_message := v_item ->> 'message';

        if v_expo_status = 'error' then
          if v_error_code = 'DeviceNotRegistered' then
            perform private.cleanup_invalid_device_push_token(v_delivery.expo_push_token);
          end if;

          update private.notification_deliveries
          set status = case when v_error_code = 'DeviceNotRegistered' then 'device_not_registered' else 'failed' end,
              error_code = coalesce(v_error_code, 'EXPO_TICKET_ERROR'),
              error_message = coalesce(v_error_message, 'Expo rejected the push ticket'),
              updated_at = now(),
              completed_at = now()
          where id = v_delivery.id;
        elsif v_expo_status = 'ok' and nullif(v_item ->> 'id', '') is not null then
          v_receipt_request_id := net.http_post(
            url := 'https://exp.host/--/api/v2/push/getReceipts',
            body := jsonb_build_object('ids', jsonb_build_array(v_item ->> 'id')),
            headers := jsonb_build_object('Content-Type', 'application/json')
          );

          update private.notification_deliveries
          set expo_ticket_id = v_item ->> 'id',
              receipt_request_id = v_receipt_request_id,
              status = 'receipt_pending',
              updated_at = now()
          where id = v_delivery.id;
        else
          update private.notification_deliveries
          set status = 'failed',
              error_code = 'MALFORMED_RESPONSE',
              error_message = 'Expo ticket response has no valid status/id',
              updated_at = now(),
              completed_at = now()
          where id = v_delivery.id;
        end if;
      else
        v_item := v_response -> 'data' -> v_delivery.expo_ticket_id;
        v_expo_status := v_item ->> 'status';
        v_error_code := v_item #>> '{details,error}';
        v_error_message := v_item ->> 'message';

        if v_expo_status = 'ok' then
          update private.notification_deliveries
          set status = 'delivered',
              error_code = null,
              error_message = null,
              updated_at = now(),
              completed_at = now()
          where id = v_delivery.id;
        elsif v_expo_status = 'error' then
          if v_error_code = 'DeviceNotRegistered' then
            perform private.cleanup_invalid_device_push_token(v_delivery.expo_push_token);
          end if;

          update private.notification_deliveries
          set status = case when v_error_code = 'DeviceNotRegistered' then 'device_not_registered' else 'failed' end,
              error_code = coalesce(v_error_code, 'EXPO_RECEIPT_ERROR'),
              error_message = coalesce(v_error_message, 'Expo receipt reported an error'),
              updated_at = now(),
              completed_at = now()
          where id = v_delivery.id;
        else
          update private.notification_deliveries
          set status = 'failed',
              error_code = 'MALFORMED_RESPONSE',
              error_message = 'Expo receipt response does not contain the ticket',
              updated_at = now(),
              completed_at = now()
          where id = v_delivery.id;
        end if;
      end if;
    exception when others then
      update private.notification_deliveries
      set status = 'failed',
          error_code = 'PROCESSING_ERROR',
          error_message = sqlerrm,
          updated_at = now(),
          completed_at = now()
      where id = v_delivery.id;
    end;
  end loop;
end;
$$;

revoke execute on function private.process_notification_deliveries() from public;
grant execute on function private.process_notification_deliveries() to service_role;

-- pg_net response rows expire, so poll frequently. cron.schedule upserts by
-- stable name and therefore cannot create duplicates across resets.
select cron.schedule(
  'notification_delivery_processor',
  '* * * * *',
  $$ select private.process_notification_deliveries(); $$
);

-- Extend Story 3.1's lifecycle job without changing its privilege boundary,
-- savepoint/failure logging, most-progressed-state-first ordering, strict
-- grace boundary, pay-per-session exclusion, or named nightly schedule.
create or replace function run_subscription_lifecycle_job()
returns void
language plpgsql
set search_path = public
as $$
declare
  v_started_at timestamptz := now();
  v_subscription_id uuid;
  v_subscription record;
begin
  begin
    -- Each notification call below is wrapped in its own BEGIN...EXCEPTION
    -- block (implicit savepoint), matching 0046's identical discipline: a
    -- notification failure (bad join, unsupported code, net.http_post error)
    -- must never roll back the real status transitions already committed by
    -- this run, nor abort processing of the other subscriptions in the loop.

    -- 1. Expired first. N-03 belongs only to rows actually changed by this
    -- run, after the configured grace period has strictly elapsed.
    for v_subscription_id in
      update subscriptions s
      set status = 'expired'
      from gyms g
      where s.gym_id = g.id
        and s.status in ('active', 'expiring_soon', 'grace_period')
        and s.expiry_date is not null
        and (s.expiry_date + g.grace_period_days) < current_date
      returning s.id
    loop
      begin
        perform private.send_push_notification(v_subscription_id, 'N-03');
      exception when others then
        raise warning 'run_subscription_lifecycle_job: N-03 dispatch failed for subscription %: %', v_subscription_id, sqlerrm;
      end;
    end loop;

    -- 2. Preserve the strict grace boundary from Story 3.1.
    update subscriptions
    set status = 'grace_period'
    where status in ('active', 'expiring_soon')
      and expiry_date is not null
      and expiry_date < current_date;

    -- 3. Preserve late-run state catch-up, but emit N-01 only for the exact
    -- +7 transition. A +6 (or later) row advances without backfill.
    for v_subscription in
      update subscriptions
      set status = 'expiring_soon'
      where status = 'active'
        and expiry_date is not null
        and expiry_date <= current_date + 7
      returning id, expiry_date
    loop
      if v_subscription.expiry_date = current_date + 7 then
        begin
          perform private.send_push_notification(v_subscription.id, 'N-01');
        exception when others then
          raise warning 'run_subscription_lifecycle_job: N-01 dispatch failed for subscription %: %', v_subscription.id, sqlerrm;
        end;
      end if;
    end loop;

    -- N-02 is a timed exact-date event, not a state transition. Running it
    -- after the transition step also covers a late active row first seen at
    -- +1 without retroactively emitting N-01.
    for v_subscription_id in
      select id
      from subscriptions
      where status = 'expiring_soon'
        and expiry_date = current_date + 1
    loop
      begin
        perform private.send_push_notification(v_subscription_id, 'N-02');
      exception when others then
        raise warning 'run_subscription_lifecycle_job: N-02 dispatch failed for subscription %: %', v_subscription_id, sqlerrm;
      end;
    end loop;

    insert into job_runs (job_name, started_at, finished_at, status)
    values ('subscription_lifecycle', v_started_at, now(), 'success');
  exception when others then
    insert into job_runs (job_name, started_at, finished_at, status, error)
    values ('subscription_lifecycle', v_started_at, now(), 'failure', sqlerrm);

    perform log_audit_event(
      p_action_type => 'subscription_lifecycle_job_failure',
      p_system_actor_label => 'system:subscription_lifecycle_job',
      p_metadata => jsonb_build_object('error', sqlerrm)
    );
  end;
end;
$$;

revoke execute on function run_subscription_lifecycle_job() from public;
