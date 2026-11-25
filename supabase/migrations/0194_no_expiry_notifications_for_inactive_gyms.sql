-- Members of a suspended or deactivated gym no longer receive the subscription expiry notices N-01, N-02 and N-03 (owner report 2026-11-25: SMARTSANA FITNESS was
-- deactivated and its members kept getting notifications).
--
-- The cause: run_subscription_lifecycle_job() moves subscriptions to expiring_soon, grace_period and expired and calls private.send_push_notification() for each exact-day
-- event, and neither the job nor the sender looked at the gym's status. The class reminder job, the quiet-gym alert job and the streak reminder (N-08) already skip a gym
-- that is not active. The guard sits in the sender, the one place all three notices pass through, so a future caller is covered too.
--
-- Only the sender changes; the job keeps moving the subscription states (they are data, not messages). No dispatch row and no history row are written for a skipped notice,
-- so nothing is replayed when the gym is reactivated. Payment receipts (private.send_payment_push_notification) are unchanged: they confirm a payment the member just made.
-- Rollback: scripts/rollback-0194-no-expiry-notifications-for-inactive-gyms.sql (restores the 0084 body).
set local lock_timeout = '5s';

CREATE OR REPLACE FUNCTION private.send_push_notification(p_subscription_id uuid, p_notification_code text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
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

  -- Migration 0194: a gym that is not active (suspended for non-payment, or deactivated) sends its members nothing. Neither the dispatch row nor the history row is
  -- written, so the event is not replayed when the gym is reactivated: expiry notices are exact-day events, and a stale "expires tomorrow" must not arrive later.
  if (select g.status from gyms g where g.id = v_gym_id) <> 'active' then
    return;
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
$function$;

revoke execute on function private.send_push_notification(uuid, text) from public, anon;
grant execute on function private.send_push_notification(uuid, text) to service_role;
