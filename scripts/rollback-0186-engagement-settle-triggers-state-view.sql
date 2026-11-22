-- Rollback for migration 0186: settle triggers and the at-risk state view (Epic 30, Story 30.3).
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0186-engagement-settle-triggers-state-view.sql
--
-- Restores private.record_check_in and public.void_staff_check_in to their 0178 bodies (the dirty mark is removed; the bodies below are the
-- 0178 text, byte for byte), unschedules the engagement_settle job, and drops the job, its three helpers, the state view family and the public
-- pair. Nothing else changed in 0186. engagement_state rows (the marks already written) and job_runs rows of engagement_settle stay: they are
-- data, harmless without the functions, and 0185's rollback drops the table. Run it BEFORE the 0185 rollback, and only after anything that calls
-- my_engagement / open_engagement (the mobile service of 30.3, the 30.4 and later screens) is rolled back.
set local lock_timeout = '5s';

select cron.unschedule('engagement_settle');

drop function public.open_engagement();
drop function public.my_engagement();
drop function private.open_engagement_at(uuid, timestamptz);
drop function private.engagement_state_view(uuid);
drop function private.engagement_state_view_at(uuid, timestamptz);
drop procedure private.engagement_settle_job();
drop function private.engagement_settle_record_run(timestamptz, integer, integer, text);
drop function private.engagement_settle_member(uuid, uuid, date);
drop function private.engagement_settle_candidates(uuid, integer);

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
  v_session_id uuid;
  v_window interval;
  v_limit_minutes integer;
  v_limit_binding boolean;
  v_visit_session boolean;
  v_covering_out timestamptz;
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
    -- The visit limit (AD-55, assumption A2) applies only to an open row that is the cover of a consumed, non-voided single_use visit
    -- session; judged from that row's own mode, never the gym's current setting. Any other open row (a Whole-day-era visit, charging off,
    -- an exempt plan) keeps the timeout alone. Where both apply the earlier ends the visit. The limit is the binding window when
    -- it is <= the timeout.
    v_window := make_interval(hours => v_timeout_hours);
    v_limit_binding := false;
    if exists (
      select 1 from guest_sessions gs
      where gs.covered_attendance_id = v_open_id
        and gs.consumed_at is not null and gs.voided_at is null
        and gs.validity_mode = 'single_use' and gs.covered_kind = 'visit'
    ) then
      select c.single_use_visit_limit_minutes into v_limit_minutes from platform_session_config c limit 1;
      if v_limit_minutes is not null and make_interval(mins => v_limit_minutes) <= v_window then
        v_window := make_interval(mins => v_limit_minutes);
        v_limit_binding := true;
      end if;
    end if;

    if v_open_checked_in_at + v_window <= now() then
      -- Stale: auto-close it (AD-22) before recording the new entry.
      update attendance_events
      set checked_out_at = v_open_checked_in_at + v_window,
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
          'auto_closed_checked_out_at', v_open_checked_in_at + v_window,
          'timeout_hours', v_timeout_hours
        ) || case when v_limit_binding
               then jsonb_build_object('reason', 'visit_limit', 'visit_limit_minutes', v_limit_minutes)
               else '{}'::jsonb end
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
    -- An offline scan taken inside a visit that the limit (or the timeout) has already closed belongs to that visit: it consumes nothing.
    -- Only a closed, non-voided visit covered by a consumed single_use visit session of this member counts, and only when the scan time
    -- would be honoured below (inside the auto-timeout window of receipt, not before the covering session existed).
    if p_at is not null then
      select ae.checked_out_at, gs.created_at, gs.id into v_covering_out, v_session_created_at, v_session_id
      from attendance_events ae
      join guest_sessions gs on gs.covered_attendance_id = ae.id
      where ae.member_id = p_member_id
        and ae.voided_at is null
        and ae.checkout_type = 'auto'
        and ae.checked_in_at <= p_at
        and p_at < ae.checked_out_at
        and p_at + make_interval(hours => v_timeout_hours) > now()
        and p_at >= gs.created_at
        and gs.consumed_at is not null and gs.voided_at is null
        and gs.validity_mode = 'single_use' and gs.covered_kind = 'visit'
      order by ae.checked_in_at desc
      limit 1;
      if v_covering_out is not null then
        v_gate_outcome := 'covered';
      end if;
    end if;
  end if;

  if v_charging and v_gate_outcome is null then
    select c.outcome, c.session_created_at, c.session_id into v_gate_outcome, v_session_created_at, v_session_id
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

  -- Unconsume link (27.3): the session this entry consumed knows which entry consumed it, in the same transaction. A 'covered' entry
  -- consumed nothing, so it links nothing. Lock order here: the gate above locked the session before this attendance row exists, so the
  -- member, attendance row, session order of AD-29 holds on the void path only; this path is serialised by the member lock.
  if v_gate_outcome = 'consumed' then
    update guest_sessions gs
    set covered_attendance_id = event.id
    where gs.id = v_session_id;
  end if;

  -- Offline-sync immediate-stale case: an entry already older than the auto-timeout is closed on arrival. When the session just consumed is
  -- a single_use visit, the visit limit applies as well (the earlier of the two), so the entry cannot block a later scan.
  v_window := make_interval(hours => v_timeout_hours);
  v_limit_binding := false;
  if v_gate_outcome = 'consumed' then
    select (gs.validity_mode = 'single_use' and gs.covered_kind = 'visit') into v_visit_session
    from guest_sessions gs where gs.id = v_session_id;
    if coalesce(v_visit_session, false) then
      select c.single_use_visit_limit_minutes into v_limit_minutes from platform_session_config c limit 1;
      if v_limit_minutes is not null and make_interval(mins => v_limit_minutes) <= v_window then
        v_window := make_interval(mins => v_limit_minutes);
        v_limit_binding := true;
      end if;
    end if;
  end if;

  if v_covering_out is not null then
    -- Scan inside an already-closed single_use visit: the entry is recorded and closed with that visit, so it cannot block a later scan.
    update attendance_events
    set checked_out_at = v_covering_out,
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
        'source', 'offline_sync',
        'reason', 'inside_closed_visit'
      )
    );
  elsif p_at is not null and v_checked_in_at + v_window <= now() then
    update attendance_events
    set checked_out_at = v_checked_in_at + v_window,
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
      ) || case when v_limit_binding
             then jsonb_build_object('reason', 'visit_limit', 'visit_limit_minutes', v_limit_minutes)
             else '{}'::jsonb end
    );
  end if;

  outcome := 'checked_in';
  return next;
  return;
end;
$$;

revoke execute on function private.record_check_in(uuid, uuid, text, uuid, timestamptz, uuid) from public, anon, authenticated, service_role;

create or replace function public.void_staff_check_in(p_attendance_id uuid, p_reason text)
returns table (
  outcome text,
  attendance_id uuid,
  voided_at timestamptz,
  session_released boolean,
  stamp_removed boolean,
  later_is_staff_entry boolean
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_role member_role;
  v_gym_id uuid;
  v_actor uuid;
  v_reason text;
  v_member_id uuid;
  ae attendance_events;
  v_session_id uuid;
  v_session_mode text;
  v_had_reversal boolean;
  v_now timestamptz := now();
begin
  v_role := private.support_rpc_role('void_staff_check_in');
  if not coalesce(v_role in ('owner', 'manager', 'supervisor'), false) then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.support_rpc_gym_id('void_staff_check_in');
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  if private.current_gym_status() is distinct from 'active' then
    raise exception 'void_staff_check_in: gym % is not active', v_gym_id;
  end if;

  perform private.support_stepup_require('support_void_staff_check_in', p_attendance_id::text);

  v_actor := private.actor_id();

  v_reason := btrim(p_reason, E' \t\r\n');
  if v_reason is null or char_length(v_reason) < 5 or char_length(v_reason) > 300 then
    outcome := 'invalid_reason';
    return next;
    return;
  end if;

  -- The member lock first: the member is read from the attendance row, then the row is re-read FOR UPDATE.
  select x.member_id into v_member_id
  from attendance_events x
  where x.id = p_attendance_id and x.gym_id = v_gym_id;

  if not found then
    outcome := 'attendance_not_found';
    return next;
    return;
  end if;

  perform 1 from members m where m.id = v_member_id and m.gym_id = v_gym_id for no key update;

  select x.* into ae
  from attendance_events x
  where x.id = p_attendance_id and x.gym_id = v_gym_id
  for update;

  if not found then
    outcome := 'attendance_not_found';
    return next;
    return;
  end if;

  attendance_id := ae.id;

  if ae.voided_at is not null then
    outcome := 'already_voided';
    return next;
    return;
  end if;

  if ae.source is distinct from 'staff' then
    outcome := 'not_staff_entry';
    return next;
    return;
  end if;

  if ae.visit_day is distinct from private.gym_today(v_gym_id) then
    outcome := 'not_same_day';
    return next;
    return;
  end if;

  -- The session this entry consumed, if any. A refunded session is not given back: the refund already ended it. A refund of a CONSUMED
  -- session keeps it consumed (0113 kept_consumed, voided_at stays null), so the refund row is the test, not voided_at alone.
  select gs.id, gs.validity_mode into v_session_id, v_session_mode
  from guest_sessions gs
  where gs.covered_attendance_id = ae.id and gs.consumed_at is not null and gs.voided_at is null
    and not exists (select 1 from refunds rf where rf.payment_id = gs.payment_id)
  for update;

  if v_session_id is not null then
    -- A later same-day visit of the member that is still counted relies on the covered day a whole_day session gave. A single_use session
    -- covered its own visit only (Story 28.2): no later visit relies on it, so it is voidable with a later same-day visit. "Later" is later INSERTED
    -- (created_at), not later checked_in_at: an offline covered scan synced after this entry can carry an earlier checked_in_at and still
    -- relies on the session.
    if v_session_mode = 'whole_day' and exists (
      select 1 from attendance_events l
      where l.member_id = ae.member_id and l.visit_day = ae.visit_day and l.voided_at is null and l.id <> ae.id
        and (l.created_at, l.id) > (ae.created_at, ae.id)
    ) then
      select bool_and(l.source = 'staff') into later_is_staff_entry
      from attendance_events l
      where l.member_id = ae.member_id and l.visit_day = ae.visit_day and l.voided_at is null and l.id <> ae.id
        and (l.created_at, l.id) > (ae.created_at, ae.id);
      outcome := 'later_visit_relies';
      return next;
      return;
    end if;
  end if;

  -- Close the visit if it is open (releases the one-open slot) and record the void.
  update attendance_events
  set voided_at = v_now,
      voided_by = v_actor,
      void_reason = v_reason,
      checked_out_at = case when checked_out_at is null then v_now else checked_out_at end,
      checkout_type = case when checked_out_at is null then 'void' else checkout_type end
  where id = ae.id;

  voided_at := v_now;
  session_released := false;
  stamp_removed := false;

  if v_session_id is not null then
    -- Unconsume: the stamp reversal returns early unless consumed_at is still set, so it runs BEFORE the columns are cleared. The
    -- counter floors at 0 and a granted free session is never revoked (AD-30). The desk payment is not reversed.
    -- stamp_removed says THIS void reversed the stamp: a stamp_reversed that already existed (an earlier void cycle of the same session)
    -- is not this void's, and the hook then does nothing.
    select exists (select 1 from loyalty_events e where e.origin_id = v_session_id and e.event_type = 'stamp_reversed')
      into v_had_reversal;

    perform private.on_session_refunded_after_consumption(v_session_id, ae.member_id, v_gym_id);

    select exists (select 1 from loyalty_events e where e.origin_id = v_session_id and e.event_type = 'stamp_reversed') and not v_had_reversal
      into stamp_removed;

    update guest_sessions gs
    set consumed_at = null, covered_day = null, covered_attendance_id = null
    where gs.id = v_session_id;

    session_released := true;
  end if;

  perform log_audit_event(
    p_action_type => 'staff_check_in_voided',
    p_gym_id => v_gym_id,
    p_target_entity_id => ae.member_id::text,
    p_target_entity_type => 'member',
    p_metadata => jsonb_build_object(
      'member_id', ae.member_id,
      'attendance_event_id', ae.id,
      'original_checked_in_at', ae.checked_in_at,
      'reason', v_reason,
      'session_released', session_released,
      'stamp_removed', stamp_removed));

  outcome := 'voided';
  later_is_staff_entry := null;
  return next;
  return;
end;
$$;

-- create or replace keeps the grants; restate the revoke so the file is self-describing (the migration guardrail reads it).
revoke execute on function public.void_staff_check_in(uuid, text) from public, anon;

do $verify$
declare
  v_src text;
begin
  if to_regprocedure('private.engagement_settle_job()') is not null
     or to_regprocedure('private.engagement_settle_candidates(uuid, integer)') is not null
     or to_regprocedure('private.engagement_settle_member(uuid, uuid, date)') is not null
     or to_regprocedure('private.engagement_settle_record_run(timestamptz, integer, integer, text)') is not null
     or to_regprocedure('private.engagement_state_view_at(uuid, timestamptz)') is not null
     or to_regprocedure('private.engagement_state_view(uuid)') is not null
     or to_regprocedure('private.open_engagement_at(uuid, timestamptz)') is not null
     or to_regprocedure('public.my_engagement()') is not null
     or to_regprocedure('public.open_engagement()') is not null then
    raise exception '0186 rollback: a function still exists';
  end if;

  if exists (select 1 from cron.job where jobname = 'engagement_settle') then
    raise exception '0186 rollback: the engagement_settle cron job still exists';
  end if;

  select p.prosrc into v_src from pg_proc p where p.oid = 'private.record_check_in(uuid, uuid, text, uuid, timestamptz, uuid)'::regprocedure;
  if position('engagement_state' in v_src) > 0 or position('consume_guest_session' in v_src) = 0 then
    raise exception '0186 rollback: record_check_in is not the 0178 body';
  end if;
  select p.prosrc into v_src from pg_proc p where p.oid = 'public.void_staff_check_in(uuid, text)'::regprocedure;
  if position('engagement_state' in v_src) > 0 or position('later_visit_relies' in v_src) = 0 then
    raise exception '0186 rollback: void_staff_check_in is not the 0178 body';
  end if;
end;
$verify$;
