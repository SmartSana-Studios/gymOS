-- Rollback for migration 0175: staff check-in and same-day void (Epic 27, Story 27.3).
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0175-staff-check-in.sql
--
-- VALID ONLY WHILE NO STAFF ENTRY EXISTS. The first staff check-in writes an attendance_events row with source 'staff', and a void writes
-- the void columns and checkout_type 'void'; a refused desk attempt writes a session_attempts row with source 'staff'. Dropping the
-- widened CHECKs with such a row present would either fail or silently turn a staff entry into a scan and a voided visit back into a
-- counted one. The guard below aborts in that case. Once a staff entry exists, rollback is done by hand under the owner's decision:
-- void or delete the staff rows (and their session_attempts rows) first, then run this script. 0174's rollback has the same precondition.
--
-- Restores: the three updaters (check_out, check_out_member, run_check_in_auto_timeout_job) without the voided_at predicate,
-- private.consume_guest_session with its two result columns, private.record_check_in as 0174 left it (no covered_attendance_id link),
-- private.stepup_issue as 0167 left it, the two CHECKs. Drops: staff_check_in, void_staff_check_in, list_attendance_log,
-- private.attendance_actor_label, guest_sessions.covered_attendance_id and its unique index, the three registry rows and the six audit
-- action rows 0175 added. The data in covered_attendance_id (set for scans that consumed a session, too) is lost; it is new in 0175.
do $guard$
begin
  if exists (select 1 from public.attendance_events where source = 'staff' or checkout_type = 'void' or voided_at is not null) then
    raise exception 'rollback-0175: attendance_events has a staff entry or a voided row; remove them first (owner decision)';
  end if;
  if exists (select 1 from public.session_attempts where source = 'staff') then
    raise exception 'rollback-0175: session_attempts has a staff attempt; remove it first (owner decision)';
  end if;
end;
$guard$;

set local lock_timeout = '5s';

-- The three RPCs and the label helper.
drop function public.staff_check_in(uuid);
drop function public.void_staff_check_in(uuid, text);
drop function public.list_attendance_log(timestamptz, timestamptz, uuid);
drop function private.attendance_actor_label(uuid, uuid);

delete from private.support_capabilities
 where kind = 'rpc' and object_name in ('staff_check_in', 'void_staff_check_in', 'list_attendance_log');
delete from private.support_audit_actions
 where action_type in ('staff_check_in', 'staff_check_in_rejected', 'staff_check_in_voided', 'attendance_stale_check_in_auto_closed',
                       'session_consumed', 'session_attempt_blocked');

-- Step-up: 0167's list.
create or replace function private.stepup_issue(p_user uuid, p_action text, p_subject text)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_expires timestamptz;
begin
  if p_user is null or p_subject is null or p_action is null then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if p_action not in ('remove_super_admin_factor', 'create_super_admin', 'change_recovery_email', 'remove_recovery_email', 'support_refund', 'support_waive_registration_fee', 'support_create_staff', 'support_payment_connection', 'start_support_factor_reset', 'take_down_gym_page', 'lift_gym_page_takedown') then
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
$$;
revoke all on function private.stepup_issue(uuid, text, text) from public, anon, authenticated;
grant execute on function private.stepup_issue(uuid, text, text) to service_role;

-- private.record_check_in as 0174 left it (it reads the named columns of consume_guest_session, so it works with either shape).
create or replace function private.record_check_in(
  p_member_id uuid,
  p_gym_id uuid,
  p_source text,
  p_actor uuid,
  p_at timestamptz,
  p_client_scan_id uuid default null
)
returns table (outcome text, member_status subscription_status, expiry_date date, event attendance_events)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deactivated_at timestamptz;
  v_timeout_hours integer;
  v_charging boolean;
  v_open_id uuid;
  v_open_checked_in_at timestamptz;
  v_checked_in_at timestamptz;
  v_gate_outcome text;
  v_session_created_at timestamptz;
begin
  -- The member lock comes first, at every gym (NFR-021, AD-29 lock order). It serialises two entries for one member, whatever the
  -- gym charges, and it is the same row consume_guest_session() locks again below (harmless, same transaction).
  select m.deactivated_at into v_deactivated_at
  from members m
  where m.id = p_member_id and m.gym_id = p_gym_id
  for no key update;

  if not found then
    raise exception 'check_in: no member record found for the caller';
  end if;

  -- Idempotent-replay short-circuit (Story 3.9). Before the gym status check and before the open-check-in lookup: a sync retry whose own
  -- earlier write committed must read that row back, never meet it as "already open" or as a suspended-gym refusal (Story 11.8 code
  -- review). Returning an already-committed row is a pure read. The member match is a defence-in-depth ownership check.
  if p_client_scan_id is not null then
    select ae.* into event
    from attendance_events ae
    where ae.client_scan_id = p_client_scan_id and ae.member_id = p_member_id;
    if event.id is not null then
      outcome := 'replayed';
      return next;
      return;
    end if;
  end if;

  -- Story 11.8 suspension gate, below the replay short-circuit and above every write below. `is distinct from`, never `<>`: the helper
  -- returns NULL for a session with no resolvable gym, and a NULL must refuse.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'check_in: gym % is not active', p_gym_id;
  end if;

  if v_deactivated_at is not null then
    raise exception 'check_in: member is deactivated';
  end if;

  -- FR-031: an expired member, and one with no plan at all, is refused. The caller writes the alert.
  select s.status, s.expiry_date into member_status, expiry_date
  from subscriptions s
  where s.member_id = p_member_id
  order by s.created_at desc
  limit 1;

  if member_status is null or member_status = 'expired' then
    outcome := 'blocked_expired';
    return next;
    return;
  end if;

  select g.checkin_timeout_hours, g.charge_guests_per_session into v_timeout_hours, v_charging
  from gyms g where g.id = p_gym_id;
  v_charging := coalesce(v_charging, false);

  -- for update: two entries for one member would otherwise both read the same stale open row and both close it, writing two audit
  -- rows. A voided row is no longer open (the index agrees).
  select ae.id, ae.checked_in_at into v_open_id, v_open_checked_in_at
  from attendance_events ae
  where ae.member_id = p_member_id and ae.checked_out_at is null and ae.voided_at is null
  order by ae.checked_in_at desc
  limit 1
  for update;

  if v_open_id is not null then
    if v_open_checked_in_at + make_interval(hours => v_timeout_hours) <= now() then
      -- Stale: auto-close it (AD-22) before recording the new entry.
      update attendance_events
      set checked_out_at = v_open_checked_in_at + make_interval(hours => v_timeout_hours),
          checkout_type = 'auto'
      where id = v_open_id;

      perform log_audit_event(
        p_action_type => 'attendance_stale_check_in_auto_closed',
        p_gym_id => p_gym_id,
        p_target_entity_id => v_open_id::text,
        p_target_entity_type => 'attendance_event',
        p_metadata => jsonb_build_object(
          'member_id', p_member_id,
          'original_checked_in_at', v_open_checked_in_at,
          'auto_closed_checked_out_at', v_open_checked_in_at + make_interval(hours => v_timeout_hours),
          'timeout_hours', v_timeout_hours
        )
      );
    else
      -- Not stale (FR-044): nothing was written. The caller raises (a scan) or maps it to a coded result (staff).
      select ae.* into event from attendance_events ae where ae.id = v_open_id;
      outcome := 'already_open';
      return next;
      return;
    end if;
  end if;

  -- AD-29 session gate (charging gyms only), after the open-row handling so a stale auto-close commits with a refused entry, and before
  -- the write so a consumed session and its attendance row commit together. A refusal is an outcome, never an exception.
  if v_charging then
    select c.outcome, c.session_created_at into v_gate_outcome, v_session_created_at
    from private.consume_guest_session(p_member_id, p_gym_id, now()) c;

    if v_gate_outcome = 'denied' then
      event := null;
      outcome := 'blocked_session';
      return next;
      return;
    end if;
  end if;

  -- A future-dated time (clock skew) is clamped to now(): the offline-stale arithmetic below only works against the real moment.
  v_checked_in_at := coalesce(p_at, now());
  if v_checked_in_at > now() then
    v_checked_in_at := now();
  end if;

  -- For a session-covered entry an offline time is trusted only inside the auto-timeout window of receipt and not before the covering
  -- session existed; otherwise receipt time governs. An exempt member (or a flag-off gym) keeps the clamped time.
  if v_gate_outcome in ('consumed', 'covered')
    and p_at is not null
    and not (
      v_checked_in_at + make_interval(hours => v_timeout_hours) > now()
      and v_checked_in_at >= v_session_created_at
    )
  then
    v_checked_in_at := now();
  end if;

  -- The one writer of attendance_events. entered_by is set for a staff entry only (a scan passes its own uid, which is ignored).
  -- visit_day is passed explicitly; the 0173 trigger remains as a backstop and agrees by construction.
  insert into attendance_events (gym_id, member_id, checked_in_at, client_scan_id, visit_day, source, entered_by)
  values (
    p_gym_id, p_member_id, v_checked_in_at, p_client_scan_id,
    private.gym_local_date(p_gym_id, v_checked_in_at),
    p_source,
    case when p_source = 'staff' then p_actor end
  )
  returning * into event;

  -- Offline-sync immediate-stale case: an entry already older than the auto-timeout is closed on arrival.
  if p_at is not null and v_checked_in_at + make_interval(hours => v_timeout_hours) <= now() then
    update attendance_events
    set checked_out_at = v_checked_in_at + make_interval(hours => v_timeout_hours),
        checkout_type = 'auto'
    where id = event.id
    returning * into event;

    perform log_audit_event(
      p_action_type => 'attendance_stale_check_in_auto_closed',
      p_gym_id => p_gym_id,
      p_target_entity_id => event.id::text,
      p_target_entity_type => 'attendance_event',
      p_metadata => jsonb_build_object(
        'member_id', p_member_id,
        'original_checked_in_at', v_checked_in_at,
        'auto_closed_checked_out_at', event.checked_out_at,
        'timeout_hours', v_timeout_hours,
        'source', 'offline_sync'
      )
    );
  end if;

  outcome := 'checked_in';
  return next;
  return;
end;
$$;

revoke execute on function private.record_check_in(uuid, uuid, text, uuid, timestamptz, uuid) from public, anon, authenticated, service_role;

-- consume_guest_session back to two result columns.
drop function private.consume_guest_session(uuid, uuid, timestamptz);

create function private.consume_guest_session(p_member_id uuid, p_gym_id uuid, p_receipt_at timestamptz)
returns table (outcome text, session_created_at timestamptz)
language plpgsql
set search_path = public
as $$
declare
  v_charging boolean;
  v_timezone text;
  v_plan_type plan_type;
  v_price integer;
  v_day_start timestamptz;
  v_day date;
  v_session_id uuid;
  v_created_at timestamptz;
begin
  -- Re-check before any lock: flag, current plan type, price.
  select g.charge_guests_per_session, g.timezone into v_charging, v_timezone
  from gyms g where g.id = p_gym_id;

  if not coalesce(v_charging, false) then
    return query select 'exempt'::text, null::timestamptz;
    return;
  end if;

  select p.plan_type, p.price into v_plan_type, v_price
  from subscriptions s
  join plans p on p.id = s.plan_id
  where s.member_id = p_member_id
  order by s.created_at desc, s.id desc
  limit 1;

  if v_plan_type is distinct from 'pay_per_session' or coalesce(v_price, 0) <= 0 then
    return query select 'exempt'::text, null::timestamptz;
    return;
  end if;

  -- Canonical order: member (FOR NO KEY UPDATE) before guest_sessions.
  perform 1 from members m where m.id = p_member_id for no key update;

  select b.day_start into v_day_start
  from private.gym_local_day_bounds(v_timezone, p_receipt_at) b;
  v_day := (v_day_start at time zone v_timezone)::date;

  -- Already covered today by a consumed, non-voided session.
  select s.created_at into v_created_at
  from guest_sessions s
  where s.member_id = p_member_id
    and s.gym_id = p_gym_id
    and s.consumed_at is not null
    and s.voided_at is null
    and s.covered_day = v_day
  limit 1;

  if found then
    return query select 'covered'::text, v_created_at;
    return;
  end if;

  -- Soonest-lapsing usable session; paid (payment_id) before free on a tie.
  select s.id, s.created_at into v_session_id, v_created_at
  from guest_sessions s
  where s.member_id = p_member_id
    and s.gym_id = p_gym_id
    and s.consumed_at is null
    and s.voided_at is null
    and s.usable_until > p_receipt_at
  order by s.usable_until asc, (s.payment_id is null) asc, s.created_at asc, s.id asc
  limit 1
  for update;

  if v_session_id is null then
    return query select 'denied'::text, null::timestamptz;
    return;
  end if;

  update guest_sessions
  set consumed_at = p_receipt_at, covered_day = v_day
  where id = v_session_id;

  perform private.on_session_consumed(v_session_id, p_member_id, p_gym_id);

  return query select 'consumed'::text, v_created_at;
end;
$$;

revoke execute on function private.consume_guest_session(uuid, uuid, timestamptz) from public, anon, authenticated;

-- The updaters without the voided_at predicate (0124 and 0024 bodies).
CREATE OR REPLACE FUNCTION public.check_out_member(p_member_id uuid)
 RETURNS attendance_events
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_gym_id uuid;
  v_member_gym_id uuid;
  v_row attendance_events;
begin
  if not coalesce((select private.current_member_role())::text = any(array['owner', 'manager', 'supervisor', 'receptionist']), false) then
    raise exception 'permission denied';
  end if;

  v_caller_gym_id := private.gym_id();
  if v_caller_gym_id is null then
    raise exception 'permission denied';
  end if;

  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'check_out_member: gym % is not active', v_caller_gym_id;
  end if;

  select gym_id into v_member_gym_id
  from members where id = p_member_id and gym_id = v_caller_gym_id;

  if v_member_gym_id is null then
    raise exception 'check_out_member: member % not found', p_member_id;
  end if;

  update attendance_events
  set checked_out_at = now(), checkout_type = 'manual'
  where member_id = p_member_id and gym_id = v_member_gym_id and checked_out_at is null
  returning * into v_row;

  if v_row is null then
    raise exception 'check_out_member: member % has no open check-in', p_member_id;
  end if;

  perform log_audit_event(
    p_action_type => 'attendance_manual_checkout',
    p_gym_id => v_member_gym_id,
    p_target_entity_id => p_member_id::text,
    p_target_entity_type => 'member',
    p_metadata => jsonb_build_object(
      'attendance_event_id', v_row.id,
      'checked_out_at', v_row.checked_out_at
    )
  );

  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.check_out()
 RETURNS attendance_events
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid;
  v_member_id uuid;
  v_deactivated_at timestamptz;
  v_row attendance_events;
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
    raise exception 'check_out: gym % is not active', v_gym_id;
  end if;

  select id, deactivated_at into v_member_id, v_deactivated_at
  from members
  where user_id = auth.uid() and gym_id = v_gym_id
  order by deactivated_at nulls first
  limit 1;

  if v_member_id is null then
    raise exception 'check_out: no member record found for the caller';
  end if;

  -- Defense in depth, mirroring check_in()'s identical guard (0023): this
  -- function is reachable by any holder of a valid session token, not just
  -- through the app's own navigation gate.
  if v_deactivated_at is not null then
    raise exception 'check_out: member is deactivated';
  end if;

  update attendance_events
  set checked_out_at = now(), checkout_type = 'manual'
  where member_id = v_member_id and checked_out_at is null
  returning * into v_row;

  if v_row is null then
    raise exception 'check_out: member % has no open check-in', v_member_id;
  end if;

  return v_row;
end;
$function$;

create or replace function public.run_check_in_auto_timeout_job()
returns void
language plpgsql
set search_path = public
as $$
declare
  v_started_at timestamptz := now();
begin
  begin
    update attendance_events a
    set checked_out_at = a.checked_in_at + make_interval(hours => g.checkin_timeout_hours),
        checkout_type = 'auto'
    from gyms g
    where a.gym_id = g.id
      and a.checked_out_at is null
      and a.checked_in_at + make_interval(hours => g.checkin_timeout_hours) <= now();

    insert into job_runs (job_name, started_at, finished_at, status)
    values ('check_in_auto_timeout', v_started_at, now(), 'success');
  exception when others then
    insert into job_runs (job_name, started_at, finished_at, status, error)
    values ('check_in_auto_timeout', v_started_at, now(), 'failure', sqlerrm);

    perform log_audit_event(
      p_action_type => 'check_in_auto_timeout_job_failure',
      p_system_actor_label => 'system:check_in_auto_timeout_job',
      p_metadata => jsonb_build_object('error', sqlerrm)
    );
  end;
end;
$$;

revoke execute on function public.check_out_member(uuid) from public, anon;
grant execute on function public.check_out_member(uuid) to authenticated;
revoke execute on function public.check_out() from public, anon;
grant execute on function public.check_out() to authenticated;
revoke execute on function public.run_check_in_auto_timeout_job() from public, anon, authenticated;

-- The unconsume link, then the widened CHECKs.
drop index public.guest_sessions_covered_attendance_id_unique;
alter table public.guest_sessions drop column covered_attendance_id;

alter table public.session_attempts drop constraint session_attempts_source_check;
alter table public.session_attempts add constraint session_attempts_source_check check (source in ('check_in', 'class'));

alter table public.attendance_events drop constraint attendance_events_checkout_type_check;
alter table public.attendance_events add constraint attendance_events_checkout_type_check check (checkout_type in ('manual', 'auto'));

do $verify$
begin
  if exists (select 1 from pg_proc where proname in ('staff_check_in', 'void_staff_check_in', 'list_attendance_log')) then
    raise exception 'rollback-0175: an RPC survived';
  end if;
  if position('voided_at is null' in (select prosrc from pg_proc where oid = 'public.check_out()'::regprocedure)) > 0 then
    raise exception 'rollback-0175: check_out still carries the 0175 predicate';
  end if;
  if exists (select 1 from information_schema.columns where table_name = 'guest_sessions' and column_name = 'covered_attendance_id') then
    raise exception 'rollback-0175: covered_attendance_id survived';
  end if;
end
$verify$;
