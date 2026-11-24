-- ============================================================================
-- 0191: Streak reminder N-08 (Epic 31, Story 31.2; FR-233, FR-232, FR-076, FR-075, NFR-029; AD-60, AD-25, AD-19, AD-53).
--
-- A member one visit away from keeping the week gets ONE calm push in the evening of that day, and one switch to turn it off. Production is
-- live and platform_engagement_config.release_week_start is NULL (the engagement area is dark), so while it is NULL the new job writes one
-- job_runs row per run and nothing else: no dispatch, history row, push or delivery.
--
--   1. private.engagement_reminder_dispatches (unique (member_id, gym_local_date): the claim) and private.engagement_reminder_deliveries
--      (the column shape and indexes of private.class_reminder_deliveries, 0059). RLS on, service_role only.
--   2. public.notifications.type CHECK: N-01 to N-08 (N-09 is still refused).
--   3. member_preferences.streak_reminder_opted_out (on by default: false). The 0047 self policies and protect trigger need no change.
--   4. platform_engagement_config.reminder_window_start_hour / reminder_window_end_hour (18 and 21): the window is config, not a literal.
--      public.my_streak_reminder_hour() hands the start hour to any signed-in caller (the Profile helper line shows it as the send time).
--   5. private.send_engagement_reminder(member): the sender. It reads the dispatch the job just claimed, re-checks the off-switch, deactivation, role and gym
--      status (the batch was chosen earlier) and at_risk_weekly, writes the
--      history row (N-08, same title and body as the push), queues one net.http_post per device token and sets the dispatch queued/no_tokens.
--      Wording: no server-readable copy store exists (N-07 is inline in send_class_reminder), so the two languages are held inline in this
--      migration, byte for byte from n08.weekly.title / body_one / body_other in apps/mobile/src/locales/{en,fr}.json (with their {{count}}
--      placeholder, replaced here), in private.engagement_reminder_text(language, n), a pure function the sender calls. The one reason it is a
--      function of its own: visits_needed always equals the days left in the week, so on any one day a test can reach one plural form only;
--      the function lets pgTAP pin all four strings. A Vitest test reads this file and both locale files and fails on any difference.
--   6. private.run_engagement_reminder_job(): cron job engagement_reminder, every 15 minutes, one job_runs row per run. It selects gyms that are
--      active, whose gym-local time of day (gyms.timezone, never UTC) is in [start, end) and whose gym-local date is at or after the epoch;
--      members that are active, role member, not opted out and without a dispatch today; then, per member and inside one savepoint
--      (begin ... exception: a failure rolls back that member's claim, history row and deliveries and the batch goes on), it reads
--      private.engagement_state_view, claims with on conflict do nothing returning id, and calls the sender only if a row came back.
--      A run in which members failed is still a `success` row; its `error` column carries 'n of m member(s) failed; first: <error>'.
--      It never recomputes weeks, goals or visit counts, never reads attendance_events, never takes a member lock, never writes a fact.
--      DAILY STREAK HOOK (FR-233 condition (a), deferred with FR-221): only the weekly condition sends in V1.8. A later daily-streak story adds
--      condition (a) by reading ONE more flag of the same state view row (at_risk_daily) beside at_risk_weekly in the per-member step, with no
--      change to the claim, the two tables or the schedule. n08.daily.* stays unused.
--   7. private.process_notification_deliveries(): replaced in whole, from the live definition (0059 is the last file that defines it, and the
--      local database was checked equal to it), with ONE addition: the fifth union all branch for engagement_reminder_deliveries, in the exact
--      shape of the class-reminder branch. Every other line is unchanged.
--
-- check_in(), record_check_in and void_staff_check_in are not touched; the job shares no function or lock with them. N-08 shares no limit with
-- N-06, N-07 or the mandatory N-01..N-05, and a sent N-08 suppresses nothing.
--
-- Rollback: scripts/rollback-0191-streak-reminder-n08.sql
-- ============================================================================
set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 1. Dispatch and delivery tables (the 0059 class-reminder shape)
-- ----------------------------------------------------------------------------
create table private.engagement_reminder_dispatches (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  gym_id uuid not null references public.gyms(id),
  gym_local_date date not null,
  sent_at timestamptz not null default now(),
  status text not null default 'pending'
    check (status in ('pending', 'queued', 'no_tokens')),
  updated_at timestamptz not null default now(),
  unique (member_id, gym_local_date)
);

create table private.engagement_reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  dispatch_id uuid not null references private.engagement_reminder_dispatches(id) on delete cascade,
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

create index idx_engagement_reminder_deliveries_due
  on private.engagement_reminder_deliveries (status, updated_at)
  where status in ('push_pending', 'receipt_pending');

create unique index idx_engagement_reminder_deliveries_push_request
  on private.engagement_reminder_deliveries (push_request_id);

create unique index idx_engagement_reminder_deliveries_receipt_request
  on private.engagement_reminder_deliveries (receipt_request_id)
  where receipt_request_id is not null;

alter table private.engagement_reminder_dispatches enable row level security;
alter table private.engagement_reminder_deliveries enable row level security;

-- Server-internal transport state, no anon/authenticated grant at all (the 0045/0046/0056/0059 posture).
grant select, insert, update, delete
  on private.engagement_reminder_dispatches, private.engagement_reminder_deliveries
  to service_role;

-- ----------------------------------------------------------------------------
-- 2. History type, preference column, window configuration
-- ----------------------------------------------------------------------------
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('N-01', 'N-02', 'N-03', 'N-04', 'N-05', 'N-06', 'N-07', 'N-08'));

alter table public.member_preferences
  add column streak_reminder_opted_out boolean not null default false;

alter table public.platform_engagement_config
  add column reminder_window_start_hour smallint not null default 18,
  add column reminder_window_end_hour smallint not null default 21,
  add constraint platform_engagement_config_reminder_window
    check (reminder_window_start_hour >= 0 and reminder_window_start_hour < reminder_window_end_hour and reminder_window_end_hour <= 24);

-- The only read the app has for the Profile helper's {time}: any signed-in caller, no member data.
create function public.my_streak_reminder_hour()
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.reminder_window_start_hour::integer from public.platform_engagement_config c limit 1;
$$;

revoke execute on function public.my_streak_reminder_hour() from public, anon, service_role;
grant execute on function public.my_streak_reminder_hour() to authenticated;

-- ----------------------------------------------------------------------------
-- 3. The wording and the sender
-- ----------------------------------------------------------------------------
-- The N-08 weekly copy, both languages, held inline (see the header). The literals are the catalog values byte for byte, including the
-- {{count}} placeholder; an apostrophe is doubled by SQL quoting only. Plural: one for 1, other for anything else (visits_needed is at least 1).
create function private.engagement_reminder_text(p_language text, p_needed integer)
returns table (title text, body text)
language sql
immutable
set search_path = pg_catalog
as $$
  select
    case when p_language = 'fr' then 'Votre semaine est à portée' else 'Your week is in reach' end,
    replace(
      case
        when p_language = 'fr' and p_needed = 1 then 'Venez aujourd''hui : encore {{count}} visite pour fermer votre cercle.'
        when p_language = 'fr' then 'Venez aujourd''hui : encore {{count}} visites pour fermer votre cercle.'
        when p_needed = 1 then 'Come in today: {{count}} visit left to close your ring.'
        else 'Come in today: {{count}} visits left to close your ring.'
      end,
      '{{count}}', p_needed::text);
$$;

revoke execute on function private.engagement_reminder_text(text, integer) from public, anon, authenticated, service_role;

create function private.send_engagement_reminder(p_member_id uuid)
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
  v_at_risk boolean;
  v_needed integer;
  v_deactivated_at timestamptz;
  v_role member_role;
  v_gym_status text;
  v_opted_out boolean;
  v_title text;
  v_body text;
  v_token record;
  v_request_id bigint;
  v_delivery_count integer := 0;
begin
  select m.user_id, m.gym_id,
         case when lower(coalesce(u.preferred_language, 'en')) = 'fr' then 'fr' else 'en' end,
         m.deactivated_at, m.role, g.status::text,
         exists (select 1 from member_preferences mp where mp.member_id = m.id and mp.streak_reminder_opted_out)
  into v_user_id, v_gym_id, v_language, v_deactivated_at, v_role, v_gym_status, v_opted_out
  from members m
  join users u on u.id = m.user_id
  join gyms g on g.id = m.gym_id
  where m.id = p_member_id;

  if not found then
    raise exception 'member not found: %', p_member_id;
  end if;

  -- The claim belongs to the job: no pending dispatch of today, no send.
  select d.id into v_dispatch_id
  from private.engagement_reminder_dispatches d
  where d.member_id = p_member_id and d.gym_local_date = private.gym_today(v_gym_id) and d.status = 'pending'
  for update;

  if v_dispatch_id is null then
    raise exception 'no pending engagement reminder dispatch today for member %', p_member_id;
  end if;

  -- The job chose its batch some time ago: the off-switch, the member's standing and the gym's status are checked again here, so a member who
  -- switched the reminder off (or was deactivated, or whose gym was suspended) before their turn in the loop is not sent anything. Raising rolls
  -- the claim back (the job's savepoint).
  if v_opted_out or v_deactivated_at is not null or v_role is distinct from 'member' or v_gym_status is distinct from 'active' then
    raise exception 'member % is not eligible for the streak reminder', p_member_id;
  end if;

  -- The state is read again here: a member who checked in since the job read it is not reminded. Raising rolls the claim back (the job's
  -- savepoint), so the next tick looks at the member again.
  select s.at_risk_weekly, s.visits_needed into v_at_risk, v_needed
  from private.engagement_state_view(p_member_id) s;

  if v_at_risk is not true or coalesce(v_needed, 0) < 1 then
    raise exception 'member % is no longer at risk of missing the weekly goal', p_member_id;
  end if;

  select t.title, t.body into v_title, v_body from private.engagement_reminder_text(v_language, v_needed) t;

  -- History row (Home bell and the notification history screen): the same title and body as the push.
  insert into public.notifications (member_id, gym_id, type, title, body)
  values (p_member_id, v_gym_id, 'N-08', v_title, v_body);

  -- Each token's enqueue has its own BEGIN...EXCEPTION block, as in 0059: one device failing cannot undo another's queued delivery.
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
            'notificationCode', 'N-08',
            'gymId', v_gym_id::text
          )
        ),
        headers := jsonb_build_object('Content-Type', 'application/json')
      );

      insert into private.engagement_reminder_deliveries (
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
      raise warning 'send_engagement_reminder: delivery enqueue failed for token %: %', v_token.expo_push_token, sqlerrm;
    end;
  end loop;

  -- A dispatch with no deliveries is never re-sent that day (at most once beats at least once for a reminder).
  update private.engagement_reminder_dispatches
  set status = case when v_delivery_count = 0 then 'no_tokens' else 'queued' end,
      updated_at = now()
  where id = v_dispatch_id;
end;
$$;

revoke execute on function private.send_engagement_reminder(uuid) from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. The job
-- ----------------------------------------------------------------------------
create function private.run_engagement_reminder_job()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_started_at timestamptz := now();
  v_member record;
  v_at_risk boolean;
  v_dispatch_id uuid;
  v_total integer := 0;
  v_failed integer := 0;
  v_first_error text;
begin
  begin
    -- Non-engagement facts only: gym active and in its window and past the epoch (NULL epoch selects nothing), member active, a member,
    -- not opted out, no dispatch today. Whether the weekly goal is at risk is decided by the state view alone, per member, below.
    for v_member in
      select m.id as member_id, m.gym_id
      from public.platform_engagement_config c
      join public.gyms g on g.status = 'active'
      cross join lateral (select now() at time zone coalesce(nullif(btrim(g.timezone), ''), 'UTC') as local_ts) lt
      join public.members m on m.gym_id = g.id
      where c.release_week_start is not null
        and private.gym_today(g.id) >= c.release_week_start
        and extract(hour from lt.local_ts) >= c.reminder_window_start_hour
        and extract(hour from lt.local_ts) < c.reminder_window_end_hour
        and m.deactivated_at is null
        and m.role = 'member'
        and not exists (
          select 1 from public.member_preferences mp
          where mp.member_id = m.id and mp.streak_reminder_opted_out
        )
        and not exists (
          select 1 from private.engagement_reminder_dispatches d
          where d.member_id = m.id and d.gym_local_date = private.gym_today(g.id)
        )
      order by m.gym_id, m.id
    loop
      v_total := v_total + 1;
      v_dispatch_id := null;

      -- One savepoint per member: a failure rolls back that member's claim, history row and deliveries, and nobody else's.
      begin
        select s.at_risk_weekly into v_at_risk from private.engagement_state_view(v_member.member_id) s;

        if v_at_risk is true then
          insert into private.engagement_reminder_dispatches (member_id, gym_id, gym_local_date)
          values (v_member.member_id, v_member.gym_id, private.gym_today(v_member.gym_id))
          on conflict (member_id, gym_local_date) do nothing
          returning id into v_dispatch_id;

          if v_dispatch_id is not null then
            perform private.send_engagement_reminder(v_member.member_id);
          end if;
        end if;
      exception when others then
        v_failed := v_failed + 1;
        v_first_error := coalesce(v_first_error, sqlerrm);
        raise warning 'run_engagement_reminder_job: reminder failed for member %: %', v_member.member_id, sqlerrm;
      end;
    end loop;

    if v_failed > 0 then
      raise warning 'run_engagement_reminder_job: % of % member(s) failed; first: %', v_failed, v_total, v_first_error;
    end if;

    -- Still a success row (the alert watches status; a run where members failed is not a broken run), with the count and the first error in it.
    insert into job_runs (job_name, started_at, finished_at, status, error)
    values ('engagement_reminder', v_started_at, now(), 'success',
            case when v_failed > 0 then v_failed || ' of ' || v_total || ' member(s) failed; first: ' || coalesce(v_first_error, '') end);
  exception when others then
    insert into job_runs (job_name, started_at, finished_at, status, error)
    values ('engagement_reminder', v_started_at, now(), 'failure', sqlerrm);

    perform log_audit_event(
      p_action_type => 'engagement_reminder_job_failure',
      p_system_actor_label => 'system:engagement_reminder_job',
      p_metadata => jsonb_build_object('error', sqlerrm)
    );
  end;
end;
$$;

-- cron/direct-postgres only.
revoke execute on function private.run_engagement_reminder_job() from public, anon, authenticated, service_role;

-- cron.schedule() upserts by name: safe across supabase db reset.
select cron.schedule(
  'engagement_reminder',
  '*/15 * * * *',
  $$ select private.run_engagement_reminder_job(); $$
);

-- ----------------------------------------------------------------------------
-- 5. The shared delivery processor: the 0059 definition (the live one) plus the engagement_reminder_deliveries branch
-- ----------------------------------------------------------------------------
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

      union all

      select
        'engagement_reminder_deliveries'::text as source_table,
        d.id,
        d.status as delivery_status,
        d.expo_push_token,
        d.expo_ticket_id,
        d.created_at,
        r.status_code,
        r.content,
        r.timed_out,
        r.error_msg
      from private.engagement_reminder_deliveries d
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

-- create or replace keeps the existing grants (service_role only, 0045); nothing is added for any client role.
revoke execute on function private.process_notification_deliveries() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 6. Verify
-- ----------------------------------------------------------------------------
do $verify$
declare
  v_fn text;
begin
  if (select count(*) from cron.job where jobname = 'engagement_reminder' and schedule = '*/15 * * * *') <> 1 then
    raise exception '0191: engagement_reminder is not scheduled every 15 minutes';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.notifications'::regclass and contype = 'c' and conname = 'notifications_type_check'
      and pg_get_constraintdef(oid) like '%N-07%N-08%'
  ) then
    raise exception '0191: notifications.type does not allow N-08';
  end if;

  if exists (select 1 from public.member_preferences where streak_reminder_opted_out) then
    raise exception '0191: an existing member is opted out of the streak reminder';
  end if;

  if (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'private' and c.relname in ('engagement_reminder_dispatches', 'engagement_reminder_deliveries') and c.relrowsecurity) <> 2 then
    raise exception '0191: the two reminder tables must have row level security';
  end if;

  if has_table_privilege('anon', 'private.engagement_reminder_dispatches', 'select')
     or has_table_privilege('authenticated', 'private.engagement_reminder_dispatches', 'select')
     or has_table_privilege('anon', 'private.engagement_reminder_deliveries', 'select')
     or has_table_privilege('authenticated', 'private.engagement_reminder_deliveries', 'select') then
    raise exception '0191: a client role can read the reminder tables';
  end if;

  foreach v_fn in array array['private.send_engagement_reminder(uuid)', 'private.run_engagement_reminder_job()', 'private.engagement_reminder_text(text, integer)'] loop
    if has_function_privilege('anon', v_fn, 'execute') or has_function_privilege('authenticated', v_fn, 'execute')
       or has_function_privilege('service_role', v_fn, 'execute') or has_function_privilege('public', v_fn, 'execute') then
      raise exception '0191: % is executable by a client role', v_fn;
    end if;
  end loop;

  if has_function_privilege('anon', 'public.my_streak_reminder_hour()', 'execute')
     or not has_function_privilege('authenticated', 'public.my_streak_reminder_hour()', 'execute') then
    raise exception '0191: my_streak_reminder_hour must be executable by authenticated only';
  end if;

  if has_function_privilege('anon', 'private.process_notification_deliveries()', 'execute')
     or has_function_privilege('authenticated', 'private.process_notification_deliveries()', 'execute') then
    raise exception '0191: process_notification_deliveries is executable by a client role';
  end if;
end;
$verify$;
