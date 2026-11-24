-- Rollback for migration 0191: Streak reminder N-08 (Epic 31, Story 31.2).
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0191-streak-reminder-n08.sql
--
-- Unschedules engagement_reminder, drops the job, the sender, its wording function and public.my_streak_reminder_hour, restores private.process_notification_deliveries
-- to the 0059 definition (four branches), puts the notifications.type CHECK back to N-01..N-07, and drops the preference column, the two window
-- columns and the two dispatch and delivery tables.
-- DATA LOST by design: every public.notifications row of type N-08 is DELETED (the restored CHECK cannot hold it), and every dispatch,
-- delivery and streak_reminder_opted_out value goes with its table or column. job_runs rows named engagement_reminder are left in place.
-- Roll back the Story 31.2 mobile app first: it reads streak_reminder_opted_out and calls my_streak_reminder_hour.
set local lock_timeout = '5s';

select cron.unschedule('engagement_reminder');

drop function private.run_engagement_reminder_job();
drop function private.send_engagement_reminder(uuid);
drop function private.engagement_reminder_text(text, integer);
drop function public.my_streak_reminder_hour();

-- private.process_notification_deliveries as 0059 left it (and as production runs it before 0191).
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

revoke execute on function private.process_notification_deliveries() from public, anon, authenticated;

delete from public.notifications where type = 'N-08';
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('N-01', 'N-02', 'N-03', 'N-04', 'N-05', 'N-06', 'N-07'));

alter table public.member_preferences drop column streak_reminder_opted_out;

alter table public.platform_engagement_config
  drop constraint platform_engagement_config_reminder_window,
  drop column reminder_window_start_hour,
  drop column reminder_window_end_hour;

drop table private.engagement_reminder_deliveries;
drop table private.engagement_reminder_dispatches;
