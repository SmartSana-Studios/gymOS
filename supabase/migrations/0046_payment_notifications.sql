-- Story 6.3: Payment Notifications (N-04, N-05).
--
-- Unlike Story 6.2 (one lifecycle cron entry point), N-04/N-05 must fire from
-- at least five different existing write paths that all set
-- payments.status = 'verified' (webhook complete_verified_payment(); the
-- Verification Queue's staff-verify; the Inline Renewal Panel; Open Payment
-- Method; Subscriptions-page manual renewal) plus one new automated failure
-- path (Task 4). A genuine AFTER INSERT OR UPDATE trigger on payments (Task
-- 3) is the only mechanism that reaches all of them without threading a
-- dispatch call through every call site individually.
--
-- Dispatch is keyed by payment_id, not subscription_id: payments.subscription_id
-- is NULL for every manual "Record Payment" ledger entry (Story 4.3, by
-- design) and is still NULL at the exact moment complete_verified_payment()'s
-- first UPDATE sets status = 'verified' (subscription_id is only backfilled
-- in a second, later UPDATE in the same function). Story 6.2's
-- private.notification_dispatches/private.notification_deliveries are
-- deliberately left untouched (read-only precedent) -- their unique key is
-- subscription_id-shaped and is not widened here; a parallel payment-keyed
-- pair below avoids nullable-either-column unique-index ambiguity.

create table private.payment_notification_dispatches (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  notification_code text not null
    check (notification_code in ('N-04', 'N-05')),
  status text not null default 'pending'
    check (status in ('pending', 'queued', 'no_tokens')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payment_id, notification_code)
);

create table private.payment_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  dispatch_id uuid not null references private.payment_notification_dispatches(id) on delete cascade,
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

create index idx_payment_notification_deliveries_due
  on private.payment_notification_deliveries (status, updated_at)
  where status in ('push_pending', 'receipt_pending');

create unique index idx_payment_notification_deliveries_push_request
  on private.payment_notification_deliveries (push_request_id);

create unique index idx_payment_notification_deliveries_receipt_request
  on private.payment_notification_deliveries (receipt_request_id)
  where receipt_request_id is not null;

alter table private.payment_notification_dispatches enable row level security;
alter table private.payment_notification_deliveries enable row level security;

-- Same posture as 0045: server-internal transport state, no anon/authenticated
-- policy at all. Postgres-owned cron jobs bypass RLS; service_role retains
-- explicit server-side operational access.
grant select, insert, update, delete
  on private.payment_notification_dispatches, private.payment_notification_deliveries
  to service_role;

-- Cannot be an overload of private.send_push_notification(uuid, text) --
-- Postgres cannot disambiguate two functions with an identical (uuid, text)
-- signature -- so this is a distinct, payment-scoped entry point. Derives
-- gym_id/member_id directly from the payments row (both NOT NULL on every
-- payment) rather than joining through subscriptions, which is frequently
-- NULL here (see migration header).
create function private.send_payment_push_notification(
  p_payment_id uuid,
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
  v_amount integer;
  v_currency text;
  v_language text;
  v_title text;
  v_body text;
  v_token record;
  v_request_id bigint;
  v_delivery_count integer := 0;
begin
  if p_notification_code not in ('N-04', 'N-05') then
    raise exception 'unsupported notification code: %', p_notification_code;
  end if;

  select m.user_id, p.gym_id, g.name, p.amount, p.currency,
         case when lower(coalesce(u.preferred_language, 'en')) = 'fr' then 'fr' else 'en' end
  into v_user_id, v_gym_id, v_gym_name, v_amount, v_currency, v_language
  from payments p
  join members m on m.id = p.member_id
  join users u on u.id = m.user_id
  join gyms g on g.id = p.gym_id
  where p.id = p_payment_id;

  if not found then
    raise exception 'payment not found: %', p_payment_id;
  end if;

  if p_notification_code = 'N-04' then
    if v_language = 'fr' then
      v_title := 'Paiement confirmé';
      v_body := format('Votre paiement de %s %s à %s a été confirmé.', v_amount, v_currency, v_gym_name);
    else
      v_title := 'Payment confirmed';
      v_body := format('Your payment of %s %s to %s was confirmed.', v_amount, v_currency, v_gym_name);
    end if;
  else
    if v_language = 'fr' then
      v_title := 'Échec du paiement';
      v_body := format('Votre paiement à %s n''a pas pu être effectué. Veuillez réessayer ou contacter la réception.', v_gym_name);
    else
      v_title := 'Payment failed';
      v_body := format('Your payment to %s could not be completed. Please try again or contact the front desk.', v_gym_name);
    end if;
  end if;

  insert into private.payment_notification_dispatches (payment_id, notification_code)
  values (p_payment_id, p_notification_code)
  on conflict (payment_id, notification_code) do nothing
  returning id into v_dispatch_id;

  -- Another invocation already owns this logical event.
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
            'paymentId', p_payment_id::text,
            'gymId', v_gym_id::text
          )
        ),
        headers := jsonb_build_object('Content-Type', 'application/json')
      );

      insert into private.payment_notification_deliveries (
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
      raise warning 'send_payment_push_notification: delivery enqueue failed for token %: %', v_token.expo_push_token, sqlerrm;
    end;
  end loop;

  update private.payment_notification_dispatches
  set status = case when v_delivery_count = 0 then 'no_tokens' else 'queued' end,
      updated_at = now()
  where id = v_dispatch_id;
end;
$$;

revoke execute on function private.send_payment_push_notification(uuid, text) from public;
grant execute on function private.send_payment_push_notification(uuid, text) to service_role;

-- The single hardest correctness requirement in this story: distinguishing
-- an automated webhook failure (N-05) from a manual internal "Flag for
-- Review" (silent, PRD FR-075/AC #3), and not double-firing N-04 when
-- complete_verified_payment()'s second UPDATE (setting subscription_id)
-- re-touches an already-verified row.
--
-- security definer is required here, not optional: the webhook path only
-- works without it because complete_verified_payment() is itself security
-- definer, so its UPDATE (and the trigger it fires) already executes as the
-- function owner. The Verification Queue's staff-verify path (AC #1) runs
-- the UPDATE directly under the caller's own `authenticated` session, which
-- has no EXECUTE grant on send_payment_push_notification -- without security
-- definer here, that path (and any other direct-UPDATE call site) fails
-- with permission denied.
create function private.notify_payment_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  -- N-04: any write path's first transition into 'verified'. The
  -- `OLD.status IS DISTINCT FROM 'verified'` guard on UPDATE is load-bearing
  -- -- without it, complete_verified_payment()'s second UPDATE (status
  -- already 'verified', only subscription_id changing) would re-fire this
  -- trigger for the same payment a second time.
  --
  -- The inner BEGIN...EXCEPTION block creates an implicit savepoint (same
  -- discipline as run_subscription_lifecycle_job(), 0021): a notification
  -- failure (bad join, unsupported code, net.http_post error) must never
  -- roll back the real payments.status transition this trigger rides along
  -- on -- that write already matters (money/membership state) independent
  -- of whether the push notification succeeds.
  if (TG_OP = 'INSERT' and NEW.status = 'verified')
     or (TG_OP = 'UPDATE' and NEW.status = 'verified' and OLD.status is distinct from 'verified') then
    begin
      perform private.send_payment_push_notification(NEW.id, 'N-04');
    exception when others then
      raise warning 'notify_payment_status_change: N-04 dispatch failed for payment %: %', NEW.id, sqlerrm;
    end;
  end if;

  -- N-05: only an automated webhook failure (Task 4's complete_flagged_payment(),
  -- processing -> flagged) fires this. The Verification Queue's
  -- gym_staff_verify_own_payments policy (0031) only ever operates on
  -- OLD.status = 'pending' rows, so a manual pending -> flagged transition
  -- never matches this condition and correctly sends nothing.
  if TG_OP = 'UPDATE' and NEW.status = 'flagged' and OLD.status = 'processing' then
    begin
      perform private.send_payment_push_notification(NEW.id, 'N-05');
    exception when others then
      raise warning 'notify_payment_status_change: N-05 dispatch failed for payment %: %', NEW.id, sqlerrm;
    end;
  end if;

  return NEW;
end;
$$;

-- WHEN skips invoking the function entirely for every payments write that
-- isn't even a candidate for N-04/N-05 (refunds, other column-only edits,
-- any status other than 'verified'/'flagged') -- the function body's own
-- OLD/NEW guards still gate the two real firing conditions precisely.
create trigger payments_notify_status_change
  after insert or update on payments
  for each row
  when (NEW.status in ('verified', 'flagged'))
  execute function private.notify_payment_status_change();

-- complete_flagged_payment(): mirrors complete_verified_payment()'s exact
-- trust boundary (security definer, service_role-only) -- it must never be
-- reachable from an authenticated gym-staff session, which would let staff
-- forge a "failed" transition outside the Verification Queue's own reviewed
-- UI/audit path. The `where status = 'processing'` clause is the idempotency
-- guard for a retried webhook delivery, identical reasoning to
-- complete_verified_payment()'s own comment.
create function complete_flagged_payment(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  update payments
  set status = 'flagged'
  where id = p_payment_id and status = 'processing'
  returning id into v_id;

  if v_id is null then
    raise notice 'complete_flagged_payment: payment % already left processing or not found -- no-op', p_payment_id;
  end if;
end;
$$;

revoke execute on function complete_flagged_payment from public;
grant execute on function complete_flagged_payment to service_role;

-- Extends Story 6.2's shared Expo ticket/receipt state machine
-- (private.process_notification_deliveries, cron entry
-- notification_delivery_processor, both unchanged in name/schedule) to also
-- drain this story's payment-keyed delivery ledger, rather than standing up
-- a second near-identical processor and cron entry. `source_table` (an
-- internal, hardcoded literal, never user input) holds the unqualified
-- table name within the `private` schema; the write-back UPDATE is built
-- with format('update private.%I ...', source_table), using %I (not %s) for
-- the identifier as defense-in-depth even though there is no live injection
-- risk today.
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
  -- Guards against the every-minute cron.schedule overlapping itself if one
  -- run ever takes longer than a minute: a second concurrent invocation
  -- returns immediately instead of both processing the same delivery row.
  -- (Row-level FOR UPDATE isn't usable here -- Postgres rejects FOR UPDATE
  -- on a query combined with UNION -- so this is a single whole-function
  -- lock instead.) Xact-scoped and re-entrant for the same session, so
  -- calling this more than once within one transaction (e.g. pgTAP fixtures)
  -- is unaffected.
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
