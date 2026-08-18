-- Story 6.5: Quiet-Gym Alert Opt-In & Delivery. Activates N-06 -- the first
-- V1.5 notification driven by a periodic occupancy re-check rather than a
-- single state-transition event, since the rate limit ("up to 2/day with a
-- 3-hour gap") implies re-evaluating a sustained quiet period more than once.
-- Reuses Story 3.6's occupancy arithmetic (via a new shared helper, FR-115)
-- and Story 6.2/6.3's dispatch/delivery/process_notification_deliveries()
-- shape (FR-077) rather than inventing either mechanism a second time.

-- ============================================================================
-- Opening hours (AC #5). No gym today has these configured -- both nullable,
-- no default, no backfill. Unconfigured (either or both null) is treated as
-- unrestricted, not "never eligible". See story Dev Notes "Opening Hours Gap".
-- ============================================================================
alter table gyms add column opening_time time, add column closing_time time;

-- ============================================================================
-- private.gym_occupancy_band(): the FR-115 shared helper. Extracted verbatim
-- from member_occupancy_band()'s (0025) arithmetic -- same capacity lookup,
-- same checked-in-count query, same three-way < 30 / <= 70 / else thresholds,
-- same null-on-unconfigured-capacity behavior. Internal helper only, no
-- client-facing role check of its own -- the caller (member_occupancy_band()
-- below, or this story's run_quiet_gym_alert_job()) is responsible for its
-- own authorization.
--
-- Schema `private` is USAGE-granted to `authenticated` (0009) and Postgres
-- grants EXECUTE to PUBLIC by default on function creation -- omitting the
-- revoke below would let any authenticated member call this with an
-- arbitrary p_gym_id and read another gym's occupancy band directly.
-- ============================================================================
create function private.gym_occupancy_band(p_gym_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_capacity integer;
  v_checked_in_count integer;
  v_pct numeric;
begin
  select capacity into v_capacity from gyms where id = p_gym_id;
  if v_capacity is null or v_capacity <= 0 then
    return null;
  end if;

  select count(*) into v_checked_in_count
  from attendance_events
  where gym_id = p_gym_id and checked_out_at is null;

  v_pct := (v_checked_in_count::numeric / v_capacity) * 100;

  if v_pct < 30 then
    return 'low';
  elsif v_pct <= 70 then
    return 'medium';
  else
    return 'busy';
  end if;
end;
$$;

revoke execute on function private.gym_occupancy_band(uuid) from public;
grant execute on function private.gym_occupancy_band(uuid) to service_role;

-- Additive create-or-replace, the same technique 0046 used to extend 0045's
-- process_notification_deliveries() -- does not edit 0025's file. Signature,
-- role check, and private.gym_id()-derived scoping are all unchanged; only
-- the arithmetic is delegated to the new shared helper.
create or replace function member_occupancy_band()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
begin
  if not ((auth.jwt() ->> 'app_role') = 'member') then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  return private.gym_occupancy_band(v_gym_id);
end;
$$;

-- ============================================================================
-- Dispatch/delivery tables. Same shape as 0045/0046's precedent tables, with
-- one deliberate divergence: no unique(member_id, ...) constraint on the
-- dispatch table. N-06 has no natural dedupe key -- a rolling rate-limit
-- window means the same member can legitimately get a new dispatch row every
-- few hours. Rate-limiting is enforced by the caller (run_quiet_gym_alert_job,
-- reading this table) before ever calling the send function, not by an
-- on conflict do nothing at insert time.
-- ============================================================================
create table private.quiet_gym_alert_dispatches (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  gym_id uuid not null references gyms(id),
  sent_at timestamptz not null default now(),
  status text not null default 'pending'
    check (status in ('pending', 'queued', 'no_tokens')),
  updated_at timestamptz not null default now()
);

-- The rate-limit read path (AC #4), not a precedent copy -- sized for
-- "count/max(sent_at) for this member within the last 24 hours".
create index idx_quiet_gym_alert_dispatches_member_sent_at
  on private.quiet_gym_alert_dispatches (member_id, sent_at desc);

create table private.quiet_gym_alert_deliveries (
  id uuid primary key default gen_random_uuid(),
  dispatch_id uuid not null references private.quiet_gym_alert_dispatches(id) on delete cascade,
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

create index idx_quiet_gym_alert_deliveries_due
  on private.quiet_gym_alert_deliveries (status, updated_at)
  where status in ('push_pending', 'receipt_pending');

create unique index idx_quiet_gym_alert_deliveries_push_request
  on private.quiet_gym_alert_deliveries (push_request_id);

create unique index idx_quiet_gym_alert_deliveries_receipt_request
  on private.quiet_gym_alert_deliveries (receipt_request_id)
  where receipt_request_id is not null;

alter table private.quiet_gym_alert_dispatches enable row level security;
alter table private.quiet_gym_alert_deliveries enable row level security;

-- Same posture as 0045/0046: server-internal transport state, no
-- anon/authenticated grant at all -- unlike member_preferences, no client
-- ever reads these two tables directly.
grant select, insert, update, delete
  on private.quiet_gym_alert_dispatches, private.quiet_gym_alert_deliveries
  to service_role;

-- ============================================================================
-- private.send_quiet_gym_alert(): mirrors private.send_payment_push_notification's
-- exact shape (0046) -- resolve user_id/preferred_language by joining
-- members -> users, per-token BEGIN...EXCEPTION isolation, net.http_post to
-- Expo, dispatch status set to 'no_tokens'/'queued' based on the token loop's
-- outcome. Unlike its siblings, the insert is unconditional (no
-- on conflict do nothing) -- there is no natural uniqueness key here, and the
-- caller has already decided this member is rate-limit-eligible before
-- calling.
-- ============================================================================
create function private.send_quiet_gym_alert(
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

-- ============================================================================
-- Extend the shared delivery processor (AC #7): a third union all branch for
-- quiet_gym_alert_deliveries, following 0046's exact
-- execute format('update private.%I ...', source_table) write-back pattern
-- the function already generalized for exactly this kind of extension. The
-- notification_delivery_processor cron entry's name/schedule are untouched --
-- it already polls all delivery tables generically.
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
-- run_quiet_gym_alert_job(): mirrors run_subscription_lifecycle_job()/
-- run_check_in_auto_timeout_job()'s outer shape (v_started_at, outer
-- BEGIN...EXCEPTION, job_runs insert on both success and failure,
-- log_audit_event on failure). AD-25 explicitly names N-06 as landing under
-- the same DB-triggered dispatch mechanism -- a periodic-cron trigger (like
-- run_subscription_lifecycle_job) rather than an AFTER INSERT/UPDATE trigger
-- (like the payments notifier), because the rate limit implies re-evaluating
-- a sustained quiet period more than once, which a pure event-triggered
-- design would not naturally support.
--
-- "Max 2 per day with a minimum 3-hour gap" (FR-114) is implemented as a
-- rolling 24-hour window read from quiet_gym_alert_dispatches.sent_at, not a
-- calendar-day counter that resets at midnight -- the safer reading absent
-- PRD specificity (see story Dev Notes "Rate-Limit Semantics").
-- ============================================================================
create function run_quiet_gym_alert_job()
returns void
language plpgsql
set search_path = public
as $$
declare
  v_started_at timestamptz := now();
  v_gym record;
  v_band text;
  v_local_time time;
  v_member record;
  v_recent_count integer;
  v_last_sent_at timestamptz;
begin
  begin
    for v_gym in select id, timezone, opening_time, closing_time from gyms where status = 'active' loop
      v_band := private.gym_occupancy_band(v_gym.id);
      continue when v_band is distinct from 'low';

      -- AC #5: unconfigured (either or both null) = unrestricted, not
      -- "never eligible". Once both are set, evaluated in the gym's own
      -- local time via its timezone column. Handles overnight windows
      -- (opening_time > closing_time, e.g. 22:00-06:00) where a plain
      -- BETWEEN can never be satisfied -- inside-window there means
      -- local time >= opening OR local time <= closing.
      if v_gym.opening_time is not null and v_gym.closing_time is not null then
        v_local_time := (now() at time zone v_gym.timezone)::time;
        continue when
          case
            when v_gym.opening_time <= v_gym.closing_time
              then v_local_time not between v_gym.opening_time and v_gym.closing_time
            else v_local_time < v_gym.opening_time and v_local_time > v_gym.closing_time
          end;
      end if;

      for v_member in
        select m.id
        from members m
        join member_preferences mp on mp.member_id = m.id
        where m.gym_id = v_gym.id
          and m.role = 'member'
          and m.deactivated_at is null
          and mp.quiet_gym_alerts_opted_out = false
      loop
        select count(*), max(sent_at)
        into v_recent_count, v_last_sent_at
        from private.quiet_gym_alert_dispatches
        where member_id = v_member.id and sent_at > now() - interval '24 hours';

        continue when v_recent_count >= 2;
        continue when v_last_sent_at is not null and v_last_sent_at > now() - interval '3 hours';

        -- Implicit savepoint, matching every other dispatch call site in
        -- 0045/0046: one member's send failure must never abort the loop
        -- for the rest of the gym's members or later gyms.
        begin
          perform private.send_quiet_gym_alert(v_member.id, v_gym.id);
        exception when others then
          raise warning 'run_quiet_gym_alert_job: dispatch failed for member %: %', v_member.id, sqlerrm;
        end;
      end loop;
    end loop;

    insert into job_runs (job_name, started_at, finished_at, status)
    values ('quiet_gym_alert', v_started_at, now(), 'success');
  exception when others then
    insert into job_runs (job_name, started_at, finished_at, status, error)
    values ('quiet_gym_alert', v_started_at, now(), 'failure', sqlerrm);

    perform log_audit_event(
      p_action_type => 'quiet_gym_alert_job_failure',
      p_system_actor_label => 'system:quiet_gym_alert_job',
      p_metadata => jsonb_build_object('error', sqlerrm)
    );
  end;
end;
$$;

-- cron/direct-postgres only, matching every other job function.
revoke execute on function run_quiet_gym_alert_job() from public;

-- 15-minute cadence matches the existing check_in_auto_timeout job's
-- precedent (0024) for a frequent, non-nightly, occupancy-adjacent job --
-- well under the 3-hour rate-limit gap, so no double-fire risk from cadence
-- alone. cron.schedule() upserts by name -- safe across supabase db reset.
select cron.schedule(
  'quiet_gym_alert_dispatcher',
  '*/15 * * * *',
  $$ select run_quiet_gym_alert_job(); $$
);
