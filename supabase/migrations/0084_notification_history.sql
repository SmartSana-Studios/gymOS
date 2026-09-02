-- Story 6.7: Notification History & Preferences Screen. Adds member-facing
-- notification history -- today's private.notification_dispatches (N-01-N-03),
-- private.payment_notification_dispatches (N-04/N-05), private.quiet_gym_
-- alert_dispatches (N-06), and private.class_reminder_dispatches (N-07) are
-- internal delivery-idempotency bookkeeping only: no anon/authenticated
-- grants, no message-content columns, 4 differently-shaped tables (different
-- natural keys/FK targets). Rather than exposing all 4 via RLS + a UNION
-- read path in the mobile app (and still having no title/body to show),
-- this migration adds one dedicated public.notifications table, written
-- once per send from inside each of the 4 existing send functions
-- (0045/0046/0056/0059, edited below) right after each one's own existing
-- `on conflict (...) do nothing returning id into v_dispatch_id` dispatch-
-- claim succeeds -- the same idempotency boundary each function already
-- uses to decide whether to actually send, reused as-is rather than
-- inventing a second one.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  gym_id uuid not null references gyms(id),
  type text not null check (type in ('N-01', 'N-02', 'N-03', 'N-04', 'N-05', 'N-06', 'N-07')),
  title text not null,
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

-- History-list query shape (member_id, created_at desc) and the Home bell
-- badge's unread-count query (member_id where read_at is null).
create index idx_notifications_member_created on public.notifications (member_id, created_at desc);
create index idx_notifications_member_unread on public.notifications (member_id) where read_at is null;

alter table public.notifications enable row level security;

-- Exact self_read_own_member_preferences/self_update_own_member_preferences
-- shape (0047), confirmed via direct pg_policy inspection before writing
-- this. No self-insert/self-delete policy -- rows are written only by the
-- service_role-executed, security definer send functions in this same
-- migration below.
create policy "self_read_own_notifications" on public.notifications
  for select
  using (member_id in (select id from members where user_id = auth.uid()));

create policy "self_update_own_notifications_read_state" on public.notifications
  for update
  using (member_id in (select id from members where user_id = auth.uid()))
  with check (member_id in (select id from members where user_id = auth.uid()));

-- Same tenant_active_gate RESTRICTIVE policy already applied to
-- member_preferences and 16 other member-facing tables (0073) -- a
-- suspended gym's member is denied both read and update here too. One
-- explicit CREATE POLICY statement, matching 0073's own established
-- per-table style (its own comment explains why this codebase does not
-- generate this DDL via a dynamic EXECUTE format(...) loop).
create policy "tenant_active_gate" on public.notifications
  as restrictive
  for all
  using (private.current_gym_status() = 'active' or private.is_super_admin())
  with check (private.current_gym_status() = 'active' or private.is_super_admin());

-- Deliberate departure from member_preferences's grant shape (which grants
-- plain `update` to authenticated, relying on RLS row-ownership alone --
-- fine there, since both of that table's columns are meant to be fully
-- member-controlled). Here, only `read_at` should ever be member-writable;
-- title/body/type/gym_id/member_id must never be editable by the member
-- whose history they describe (content-integrity of their own past
-- notifications, not just row ownership). Postgres's column-level GRANT is
-- the correct primitive for this and is used here for the first time in
-- this codebase -- RLS's `with check` on the update policy above already
-- restricts *which rows*, this restricts *which columns*; both apply
-- together on every UPDATE. See docs/decisions.md for what this migration's
-- own pgTAP coverage (supabase/tests/notification_history.test.sql)
-- confirmed about how Postgres actually enforces this combination.
grant select, update (read_at) on public.notifications to authenticated;
grant select, insert, update, delete on public.notifications to service_role;

-- ----------------------------------------------------------------------------
-- Extend the 4 existing send functions to also write a history row.
-- ----------------------------------------------------------------------------

-- N-01/N-02/N-03 (0045_subscription_lifecycle_notifications.sql). Full prior
-- body carried forward via create or replace (this codebase's append-only-
-- migrations convention, same technique 0083 already used for
-- connect_gym_payment_credentials) -- only 2 changes from the 0045 original:
-- (1) `m.id` added to the existing member/gym/language select, into a new
-- v_member_id local; (2) one insert into public.notifications immediately
-- after the existing dispatch-claim null-check. No other line changed.
create or replace function private.send_push_notification(
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
  v_member_id uuid;
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

  select m.id, m.user_id, s.gym_id, g.name,
         case when lower(coalesce(u.preferred_language, 'en')) = 'fr' then 'fr' else 'en' end
  into v_member_id, v_user_id, v_gym_id, v_gym_name, v_language
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

  -- Story 6.7: history row, written unconditionally on this branch --
  -- regardless of whether any push token exists below, a member with no
  -- registered device still sees this in their in-app history.
  insert into public.notifications (member_id, gym_id, type, title, body)
  values (v_member_id, v_gym_id, p_notification_code, v_title, v_body);

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

-- N-04/N-05 (0046_payment_notifications.sql). Same two changes as above:
-- v_member_id added to the existing member/gym/amount select, and one
-- history insert immediately after the existing dispatch-claim null-check.
create or replace function private.send_payment_push_notification(
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
  v_member_id uuid;
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

  select m.id, m.user_id, p.gym_id, g.name, p.amount, p.currency,
         case when lower(coalesce(u.preferred_language, 'en')) = 'fr' then 'fr' else 'en' end
  into v_member_id, v_user_id, v_gym_id, v_gym_name, v_amount, v_currency, v_language
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

  -- Story 6.7: history row, written unconditionally on this branch.
  insert into public.notifications (member_id, gym_id, type, title, body)
  values (v_member_id, v_gym_id, p_notification_code, v_title, v_body);

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

-- N-06 (0056_quiet_gym_alert_opt_in_delivery.sql). Unlike the other 3, this
-- function already takes p_member_id as an input parameter -- no new local
-- variable needed, use it directly. Its dispatch insert also has no
-- `on conflict` clause at all (Story 6.5's deliberate no-natural-key,
-- rolling-rate-limit design -- the caller pre-checks eligibility before
-- calling this function), so there is no null-check branch to piggyback on
-- either: the history insert goes unconditionally right after the dispatch
-- insert, the equivalent position to the other 3 functions' post-null-check
-- placement.
create or replace function private.send_quiet_gym_alert(
  p_member_id uuid,
  p_gym_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_dispatch_id uuid;
  v_user_id uuid;
  v_gym_name text;
  v_language text;
  v_title text;
  v_body text;
  v_token record;
  v_request_id bigint;
  v_delivery_count integer := 0;
begin
  select m.user_id, g.name,
         case when lower(coalesce(u.preferred_language, 'en')) = 'fr' then 'fr' else 'en' end
  into v_user_id, v_gym_name, v_language
  from members m
  join users u on u.id = m.user_id
  join gyms g on g.id = p_gym_id
  where m.id = p_member_id;

  if not found then
    raise exception 'member not found: %', p_member_id;
  end if;

  if v_language = 'fr' then
    v_title := 'Votre salle est calme en ce moment';
    v_body := format('C''est le moment idéal pour vous entraîner à %s — l''affluence est faible.', v_gym_name);
  else
    v_title := 'Your gym is quiet right now';
    v_body := format('It''s a great time to train at %s — occupancy is low.', v_gym_name);
  end if;

  insert into private.quiet_gym_alert_dispatches (member_id, gym_id)
  values (p_member_id, p_gym_id)
  returning id into v_dispatch_id;

  -- Story 6.7: history row, written unconditionally right after the
  -- dispatch row (see this function's own header comment above for why
  -- there is no null-check branch here, unlike the other 3 send functions).
  insert into public.notifications (member_id, gym_id, type, title, body)
  values (p_member_id, p_gym_id, 'N-06', v_title, v_body);

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
            'notificationCode', 'N-06',
            'memberId', p_member_id::text,
            'gymId', p_gym_id::text
          )
        ),
        headers := jsonb_build_object('Content-Type', 'application/json')
      );

      insert into private.quiet_gym_alert_deliveries (
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
      raise warning 'send_quiet_gym_alert: delivery enqueue failed for token %: %', v_token.expo_push_token, sqlerrm;
    end;
  end loop;

  update private.quiet_gym_alert_dispatches
  set status = case when v_delivery_count = 0 then 'no_tokens' else 'queued' end,
      updated_at = now()
  where id = v_dispatch_id;
end;
$$;

revoke execute on function private.send_quiet_gym_alert(uuid, uuid) from public;
grant execute on function private.send_quiet_gym_alert(uuid, uuid) to service_role;

-- N-07 (0059_class_reminder_notification.sql). Already takes p_member_id as
-- an input parameter, used directly -- no new local variable needed.
create or replace function private.send_class_reminder(
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

  -- Story 6.7: history row, written unconditionally on this branch.
  insert into public.notifications (member_id, gym_id, type, title, body)
  values (p_member_id, v_gym_id, 'N-07', v_title, v_body);

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
