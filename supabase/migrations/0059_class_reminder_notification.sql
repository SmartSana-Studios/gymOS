-- Story 6.6: Class Reminder Notification (N-07, FR-116). Activates the last
-- V1.5 Epic-6-extension notification, reusing AD-25's DB-triggered dispatch
-- mechanism and the 0045/0046/0056 two-stage Expo delivery-ledger pattern,
-- extended a fourth time. Unlike Story 6.5's N-06 (a rolling rate limit with
-- no natural dedupe key), N-07 is a true one-shot event -- a given
-- (class_session_id, member_id) booking gets exactly one reminder, ever --
-- so this story's dispatch table follows 0045's natural-key
-- unique(subscription_id, notification_code) + on conflict do nothing
-- precedent instead of 0056's shape. See story Dev Notes "Dispatch Dedupe
-- Strategy" for the full reasoning.

-- ============================================================================
-- Dispatch/delivery tables. class_reminder_dispatches carries a real natural
-- key (AC #8): a booking either already had its one reminder sent or it
-- hasn't. class_reminder_deliveries is the identical column shape shared by
-- every prior delivery-ledger table.
-- ============================================================================
create table private.class_reminder_dispatches (
  id uuid primary key default gen_random_uuid(),
  class_session_id uuid not null references class_sessions(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  gym_id uuid not null references gyms(id),
  sent_at timestamptz not null default now(),
  status text not null default 'pending'
    check (status in ('pending', 'queued', 'no_tokens')),
  updated_at timestamptz not null default now(),
  unique (class_session_id, member_id)
);

create table private.class_reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  dispatch_id uuid not null references private.class_reminder_dispatches(id) on delete cascade,
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

create index idx_class_reminder_deliveries_due
  on private.class_reminder_deliveries (status, updated_at)
  where status in ('push_pending', 'receipt_pending');

create unique index idx_class_reminder_deliveries_push_request
  on private.class_reminder_deliveries (push_request_id);

create unique index idx_class_reminder_deliveries_receipt_request
  on private.class_reminder_deliveries (receipt_request_id)
  where receipt_request_id is not null;

alter table private.class_reminder_dispatches enable row level security;
alter table private.class_reminder_deliveries enable row level security;

-- Same posture as 0045/0046/0056: server-internal transport state, no
-- anon/authenticated grant at all.
grant select, insert, update, delete
  on private.class_reminder_dispatches, private.class_reminder_deliveries
  to service_role;

-- ============================================================================
-- private.send_class_reminder(): mirrors private.send_push_notification's
-- (0045) exact shape, including its on conflict ... do nothing returning id
-- early-exit -- not Story 6.5's unconditional-insert shape, which only works
-- because N-06 has no natural key. Resolves user/language via
-- members -> users, and class name/scheduled_at via
-- class_sessions -> classes.
-- ============================================================================
create function private.send_class_reminder(
  p_member_id uuid,
  p_class_session_id uuid
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
  v_language text;
  v_class_name text;
  v_title text;
  v_body text;
  v_token record;
  v_request_id bigint;
  v_delivery_count integer := 0;
begin
  select m.user_id, cb.gym_id, cl.name,
         case when lower(coalesce(u.preferred_language, 'en')) = 'fr' then 'fr' else 'en' end
  into v_user_id, v_gym_id, v_class_name, v_language
  from members m
  join users u on u.id = m.user_id
  join class_bookings cb on cb.class_session_id = p_class_session_id and cb.member_id = p_member_id
  join class_sessions cs on cs.id = p_class_session_id
  join classes cl on cl.id = cs.class_id
  where m.id = p_member_id;

  if not found then
    raise exception 'member or booking not found: member %, session %', p_member_id, p_class_session_id;
  end if;

  if v_language = 'fr' then
    v_title := 'Rappel de cours';
    v_body := format('Votre cours « %s » commence dans 60 minutes.', v_class_name);
  else
    v_title := 'Class reminder';
    v_body := format('Your class "%s" starts in 60 minutes.', v_class_name);
  end if;

  insert into private.class_reminder_dispatches (class_session_id, member_id, gym_id)
  values (p_class_session_id, p_member_id, v_gym_id)
  on conflict (class_session_id, member_id) do nothing
  returning id into v_dispatch_id;

  -- Another invocation already owns this booking's one reminder. Do not
  -- enqueue even if its outcome was no_tokens or a terminal delivery
  -- failure.
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
            'notificationCode', 'N-07',
            'classSessionId', p_class_session_id::text,
            'gymId', v_gym_id::text
          )
        ),
        headers := jsonb_build_object('Content-Type', 'application/json')
      );

      insert into private.class_reminder_deliveries (
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
      raise warning 'send_class_reminder: delivery enqueue failed for token %: %', v_token.expo_push_token, sqlerrm;
    end;
  end loop;

  update private.class_reminder_dispatches
  set status = case when v_delivery_count = 0 then 'no_tokens' else 'queued' end,
      updated_at = now()
  where id = v_dispatch_id;
end;
$$;

revoke execute on function private.send_class_reminder(uuid, uuid) from public;
grant execute on function private.send_class_reminder(uuid, uuid) to service_role;

-- ============================================================================
-- Extend the shared delivery processor (AC #7): a fourth union all branch
-- for class_reminder_deliveries, following 0056's exact technique for adding
-- the third branch (which itself followed 0046's technique for the second).
-- The notification_delivery_processor cron entry's name/schedule are
-- untouched -- it already polls all delivery tables generically.
-- ============================================================================
create or replace function private.process_notification_deliveries()
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
  if not pg_try_advisory_xact_lock(hashtext('private.process_notification_deliveries')::bigint) then
    return;
  end if;

  for v_delivery in
    select * from (
      select
        'notification_deliveries'::text as source_table,
        d.id,
        d.status as delivery_status,
        d.expo_push_token,
        d.expo_ticket_id,
        d.created_at,
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

      union all

      select
        'payment_notification_deliveries'::text as source_table,
        d.id,
        d.status as delivery_status,
        d.expo_push_token,
        d.expo_ticket_id,
        d.created_at,
        r.status_code,
        r.content,
        r.timed_out,
        r.error_msg
      from private.payment_notification_deliveries d
      join net._http_response r
        on r.id = case
          when d.status = 'push_pending' then d.push_request_id
          when d.status = 'receipt_pending' then d.receipt_request_id
        end
      where d.status in ('push_pending', 'receipt_pending')

      union all

      select
        'quiet_gym_alert_deliveries'::text as source_table,
        d.id,
        d.status as delivery_status,
        d.expo_push_token,
        d.expo_ticket_id,
        d.created_at,
        r.status_code,
        r.content,
        r.timed_out,
        r.error_msg
      from private.quiet_gym_alert_deliveries d
      join net._http_response r
        on r.id = case
          when d.status = 'push_pending' then d.push_request_id
          when d.status = 'receipt_pending' then d.receipt_request_id
        end
      where d.status in ('push_pending', 'receipt_pending')

      union all

      select
        'class_reminder_deliveries'::text as source_table,
        d.id,
        d.status as delivery_status,
        d.expo_push_token,
        d.expo_ticket_id,
        d.created_at,
        r.status_code,
        r.content,
        r.timed_out,
        r.error_msg
      from private.class_reminder_deliveries d
      join net._http_response r
        on r.id = case
          when d.status = 'push_pending' then d.push_request_id
          when d.status = 'receipt_pending' then d.receipt_request_id
        end
      where d.status in ('push_pending', 'receipt_pending')
    ) combined
    order by created_at, id
  loop
    begin
      if coalesce(v_delivery.timed_out, false) or v_delivery.error_msg is not null then
        execute format(
          'update private.%I set status = $1, error_code = $2, error_message = $3, updated_at = now(), completed_at = now() where id = $4',
          v_delivery.source_table
        ) using 'failed', 'TRANSPORT_ERROR', coalesce(v_delivery.error_msg, 'request timed out'), v_delivery.id;
        continue;
      end if;

      if v_delivery.status_code is null
         or v_delivery.status_code < 200
         or v_delivery.status_code >= 300 then
        execute format(
          'update private.%I set status = $1, error_code = $2, error_message = $3, updated_at = now(), completed_at = now() where id = $4',
          v_delivery.source_table
        ) using 'failed', coalesce('HTTP_' || v_delivery.status_code::text, 'HTTP_ERROR'), coalesce(v_delivery.content, 'HTTP request failed'), v_delivery.id;
        continue;
      end if;

      begin
        v_response := v_delivery.content::jsonb;
      exception when others then
        execute format(
          'update private.%I set status = $1, error_code = $2, error_message = $3, updated_at = now(), completed_at = now() where id = $4',
          v_delivery.source_table
        ) using 'failed', 'MALFORMED_RESPONSE', sqlerrm, v_delivery.id;
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

          execute format(
            'update private.%I set status = $1, error_code = $2, error_message = $3, updated_at = now(), completed_at = now() where id = $4',
            v_delivery.source_table
          ) using
            case when v_error_code = 'DeviceNotRegistered' then 'device_not_registered' else 'failed' end,
            coalesce(v_error_code, 'EXPO_TICKET_ERROR'),
            coalesce(v_error_message, 'Expo rejected the push ticket'),
            v_delivery.id;
        elsif v_expo_status = 'ok' and nullif(v_item ->> 'id', '') is not null then
          v_receipt_request_id := net.http_post(
            url := 'https://exp.host/--/api/v2/push/getReceipts',
            body := jsonb_build_object('ids', jsonb_build_array(v_item ->> 'id')),
            headers := jsonb_build_object('Content-Type', 'application/json')
          );

          execute format(
            'update private.%I set expo_ticket_id = $1, receipt_request_id = $2, status = $3, updated_at = now() where id = $4',
            v_delivery.source_table
          ) using v_item ->> 'id', v_receipt_request_id, 'receipt_pending', v_delivery.id;
        else
          execute format(
            'update private.%I set status = $1, error_code = $2, error_message = $3, updated_at = now(), completed_at = now() where id = $4',
            v_delivery.source_table
          ) using 'failed', 'MALFORMED_RESPONSE', 'Expo ticket response has no valid status/id', v_delivery.id;
        end if;
      else
        v_item := v_response -> 'data' -> v_delivery.expo_ticket_id;
        v_expo_status := v_item ->> 'status';
        v_error_code := v_item #>> '{details,error}';
        v_error_message := v_item ->> 'message';

        if v_expo_status = 'ok' then
          execute format(
            'update private.%I set status = $1, error_code = null, error_message = null, updated_at = now(), completed_at = now() where id = $2',
            v_delivery.source_table
          ) using 'delivered', v_delivery.id;
        elsif v_expo_status = 'error' then
          if v_error_code = 'DeviceNotRegistered' then
            perform private.cleanup_invalid_device_push_token(v_delivery.expo_push_token);
          end if;

          execute format(
            'update private.%I set status = $1, error_code = $2, error_message = $3, updated_at = now(), completed_at = now() where id = $4',
            v_delivery.source_table
          ) using
            case when v_error_code = 'DeviceNotRegistered' then 'device_not_registered' else 'failed' end,
            coalesce(v_error_code, 'EXPO_RECEIPT_ERROR'),
            coalesce(v_error_message, 'Expo receipt reported an error'),
            v_delivery.id;
        else
          execute format(
            'update private.%I set status = $1, error_code = $2, error_message = $3, updated_at = now(), completed_at = now() where id = $4',
            v_delivery.source_table
          ) using 'failed', 'MALFORMED_RESPONSE', 'Expo receipt response does not contain the ticket', v_delivery.id;
        end if;
      end if;
    exception when others then
      execute format(
        'update private.%I set status = $1, error_code = $2, error_message = $3, updated_at = now(), completed_at = now() where id = $4',
        v_delivery.source_table
      ) using 'failed', 'PROCESSING_ERROR', sqlerrm, v_delivery.id;
    end;
  end loop;
end;
$$;

-- ============================================================================
-- run_class_reminder_job(): mirrors run_quiet_gym_alert_job()/
-- run_subscription_lifecycle_job()'s outer shape (v_started_at, outer
-- BEGIN...EXCEPTION, job_runs insert on both success and failure,
-- log_audit_event on failure). Iterates eligible bookings directly -- the
-- on conflict do nothing natural-key insert inside send_class_reminder() is
-- the correctness gate against overlapping cron runs, while the where
-- clause's own "not exists (select 1 from private.class_reminder_dispatches
-- ...)" prefilter keeps an already-dispatched booking from being re-joined
-- and re-invoked on every tick for the rest of its ~60-minute window (code
-- review, 2026-08-19) -- purely a cost optimization, not a correctness
-- requirement (no rate-limit or opening-hours logic, unlike Story 6.5).
-- ============================================================================
create function run_class_reminder_job()
returns void
language plpgsql
set search_path = public
as $$
declare
  v_started_at timestamptz := now();
  v_booking record;
begin
  begin
    for v_booking in
      select cb.member_id, cb.class_session_id
      from class_bookings cb
      join class_sessions cs on cs.id = cb.class_session_id
      join classes cl on cl.id = cs.class_id
      join gyms g on g.id = cb.gym_id
      join members m on m.id = cb.member_id
      join member_preferences mp on mp.member_id = m.id
      where g.status = 'active'
        and cs.scheduled_at > now()
        and cs.scheduled_at <= now() + interval '60 minutes'
        and m.deactivated_at is null
        and m.role = 'member'
        and mp.class_reminder_opted_out = false
        and not exists (
          select 1 from private.class_reminder_dispatches d
          where d.class_session_id = cb.class_session_id and d.member_id = cb.member_id
        )
    loop
      -- Implicit savepoint, matching every other dispatch call site in
      -- 0045/0046/0056: one member's send failure must never abort the loop
      -- for the rest of the sessions.
      begin
        perform private.send_class_reminder(v_booking.member_id, v_booking.class_session_id);
      exception when others then
        raise warning 'run_class_reminder_job: dispatch failed for member %, session %: %', v_booking.member_id, v_booking.class_session_id, sqlerrm;
      end;
    end loop;

    insert into job_runs (job_name, started_at, finished_at, status)
    values ('class_reminder', v_started_at, now(), 'success');
  exception when others then
    insert into job_runs (job_name, started_at, finished_at, status, error)
    values ('class_reminder', v_started_at, now(), 'failure', sqlerrm);

    perform log_audit_event(
      p_action_type => 'class_reminder_job_failure',
      p_system_actor_label => 'system:class_reminder_job',
      p_metadata => jsonb_build_object('error', sqlerrm)
    );
  end;
end;
$$;

-- cron/direct-postgres only, matching every other job function.
revoke execute on function run_class_reminder_job() from public;

-- 5-minute cadence (tighter than Story 6.5's */15 since a class reminder has
-- a real deadline the member needs advance notice before, unlike a
-- quiet-gym nudge). cron.schedule() upserts by name -- safe across
-- supabase db reset.
select cron.schedule(
  'class_reminder_dispatcher',
  '*/5 * * * *',
  $$ select run_class_reminder_job(); $$
);
