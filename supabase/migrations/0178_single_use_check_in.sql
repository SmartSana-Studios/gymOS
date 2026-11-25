-- ============================================================================
-- 0178: Single-use consumption at check-in (Epic 28, Story 28.2; FR-237, the Single-use half of FR-239 for check-in, NFR-021, NFR-028;
-- AD-55, AD-29, AD-28, AD-31, AD-30).
--
-- 28.1 gave a gym the Session validity setting and the session record's cover columns; nothing consumed in Single use yet. This migration
-- makes a Single-use check-in consume one session per VISIT, makes a second scan during a visit cost nothing, and makes a forgotten check-out
-- never let the member back in free. Whole-day and charging-off behaviour is byte-for-byte what 0177 / 0175 / 0124 did.
--
--   * private.consume_guest_session: dropped (the 3-argument form) and recreated as (p_member_id, p_gym_id, p_receipt_at, p_kind text default
--     'visit'), same three result columns, execute revoked from public, anon, authenticated. A consumed non-voided whole_day row whose
--     covered_day is the receipt day returns 'covered' first, in either gym mode (coverage is judged from the row's OWN mode). Else, in a
--     single_use gym a 'visit' row is consumed (validity_mode single_use, covered_kind visit, covered_day null); in a whole_day gym a 'day'
--     row exactly as before. p_kind = 'class' in a single_use gym raises class_single_use_unsupported (Story 28.3 removes that guard); in a
--     whole_day gym it behaves as before. Any other kind raises.
--   * private.record_check_in (the 0175 body): the stale test for an open row that is the covered_attendance_id of a consumed, non-voided
--     single_use visit session uses least(checkin_timeout_hours, platform_session_config.single_use_visit_limit_minutes); every other open row
--     keeps the timeout alone. The stale close is at checked_in_at + that window, checkout_type 'auto', and its audit row gains
--     reason 'visit_limit' and visit_limit_minutes only when the limit is the binding window. The offline immediate-stale close uses the same
--     least() when the session just consumed is a single_use visit. An offline scan whose honoured time falls inside a closed (auto) single_use
--     visit of the same member consumes nothing: it is recorded covered and closed at that visit's close time (reason 'inside_closed_visit'),
--     so two offline scans of one visit that sync after the limit has lapsed cost one session, as two online scans do.
--   * public.void_staff_check_in (the 0175 body): later_visit_relies applies only when the bound session is a whole_day row. A Single-use visit
--     is voidable with a later same-day visit (no later visit relies on its coverage).
--   * public.mark_class_attendance (the 0124 body): its one consume call passes 'class'. No other change.
--
-- Callers of the consume function: private.record_check_in and public.mark_class_attendance, nothing else (a pgTAP source scan asserts it).
-- No dashboard or mobile change. check_in(), staff_check_in(), the auto-timeout job and the occupancy functions are not edited: the limit closes
-- a visit only at a later scan.
--
-- Rollback: scripts/rollback-0178-single-use-check-in.sql (refuses while any single_use row or any single_use gym exists).
-- ============================================================================
set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- private.consume_guest_session. The 3-argument form is dropped first: a default argument beside it would make a 3-argument call ambiguous.
-- ----------------------------------------------------------------------------
drop function private.consume_guest_session(uuid, uuid, timestamptz);

create function private.consume_guest_session(p_member_id uuid, p_gym_id uuid, p_receipt_at timestamptz, p_kind text default 'visit')
returns table (outcome text, session_created_at timestamptz, session_id uuid)
language plpgsql
set search_path = public
as $$
declare
  v_charging boolean;
  v_timezone text;
  v_validity text;
  v_plan_type plan_type;
  v_price integer;
  v_day_start timestamptz;
  v_day date;
  v_session_id uuid;
  v_created_at timestamptz;
begin
  if p_kind is null or p_kind not in ('visit', 'class') then
    raise exception 'consume_guest_session: invalid kind %', p_kind;
  end if;

  -- Re-check before any lock: flag, current plan type, price. The gym setting is read here, inside the caller's member lock.
  select g.charge_guests_per_session, g.timezone, g.session_validity into v_charging, v_timezone, v_validity
  from gyms g where g.id = p_gym_id;

  if not coalesce(v_charging, false) then
    return query select 'exempt'::text, null::timestamptz, null::uuid;
    return;
  end if;

  select p.plan_type, p.price into v_plan_type, v_price
  from subscriptions s
  join plans p on p.id = s.plan_id
  where s.member_id = p_member_id
  order by s.created_at desc, s.id desc
  limit 1;

  if v_plan_type is distinct from 'pay_per_session' or coalesce(v_price, 0) <= 0 then
    return query select 'exempt'::text, null::timestamptz, null::uuid;
    return;
  end if;

  -- Story 28.3 removes this guard. Placed after the exempt returns: an exempt member consumes nothing, so a class mark for one is not
  -- the unsupported case.
  if p_kind = 'class' and v_validity = 'single_use' then
    raise exception 'class_single_use_unsupported';
  end if;

  -- Canonical order: member (FOR NO KEY UPDATE) before guest_sessions.
  perform 1 from members m where m.id = p_member_id for no key update;

  select b.day_start into v_day_start
  from private.gym_local_day_bounds(v_timezone, p_receipt_at) b;
  v_day := (v_day_start at time zone v_timezone)::date;

  -- Already covered today by a consumed, non-voided whole_day session, whatever the gym's setting is now (the row's own mode governs).
  select s.created_at, s.id into v_created_at, v_session_id
  from guest_sessions s
  where s.member_id = p_member_id
    and s.gym_id = p_gym_id
    and s.consumed_at is not null
    and s.voided_at is null
    and s.validity_mode = 'whole_day'
    and s.covered_day = v_day
  limit 1;

  if found then
    return query select 'covered'::text, v_created_at, v_session_id;
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
    return query select 'denied'::text, null::timestamptz, null::uuid;
    return;
  end if;

  if v_validity = 'single_use' then
    -- One session per visit: no covered_day. The caller sets covered_attendance_id after its attendance insert, in the same transaction
    -- (the deferred constraint trigger of 0177 checks it at commit).
    update guest_sessions
    set consumed_at = p_receipt_at, validity_mode = 'single_use', covered_kind = 'visit'
    where id = v_session_id;
  else
    update guest_sessions
    set consumed_at = p_receipt_at, covered_day = v_day, validity_mode = 'whole_day', covered_kind = 'day'
    where id = v_session_id;
  end if;

  perform private.on_session_consumed(v_session_id, p_member_id, p_gym_id);

  return query select 'consumed'::text, v_created_at, v_session_id;
end;
$$;

revoke execute on function private.consume_guest_session(uuid, uuid, timestamptz, text) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- private.record_check_in: the 0175 body. Changed: the stale test and close (visit limit), the offline immediate-stale close. Every guard,
-- the statement order and the outcomes are as before.
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- public.void_staff_check_in: the 0175 body. Changed: the later-visit guard applies only when the bound session is a whole_day row.
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- public.mark_class_attendance: the 0124 body. Changed: the consume call passes 'class'. Nothing else.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_class_attendance(p_booking_id uuid)
 RETURNS class_bookings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid;
  v_booking_id uuid;
  v_member_id uuid;
  v_class_session_id uuid;
  v_attended_at timestamptz;
  v_status subscription_status;
  v_expiry_date date;
  v_row class_bookings;
  v_charging boolean;
  v_gate_outcome text;
begin
  -- Include supervisor here too, for the same reason as the RLS widening
  -- above (this is new code; match the current UX matrix, don't perpetuate
  -- the pre-Supervisor gap into it). Explicitly excludes coach, matching
  -- the Attendance/Classes-attendance role matrix row.
  if not coalesce((select private.current_member_role())::text = any(array['owner', 'manager', 'receptionist', 'supervisor']), false) then
    raise exception 'mark_class_attendance: permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'mark_class_attendance: permission denied';
  end if;

  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'mark_class_attendance: gym % is not active', v_gym_id;
  end if;

  -- Gym-scoped booking lookup. Uniform not-found failure covers a
  -- nonexistent id and a cross-gym id identically, matching
  -- cancel_class_booking()'s collapsed not-found convention.
  select cb.id, cb.member_id, cb.class_session_id, cb.attended_at
  into v_booking_id, v_member_id, v_class_session_id, v_attended_at
  from class_bookings cb
  where cb.id = p_booking_id and cb.gym_id = v_gym_id;

  if v_booking_id is null then
    raise exception 'mark_class_attendance: booking % not found', p_booking_id;
  end if;

  -- 0112: an already-attended booking returns the stored row and consumes
  -- nothing (also with the charging flag off); attended_at is never rewritten.
  if v_attended_at is not null then
    select * into v_row from class_bookings where id = v_booking_id;
    return v_row;
  end if;

  -- Subscription eligibility (AC #3), copied from book_class_session()'s
  -- exact query/branch -- reject only null/expired, not a stricter
  -- active-only filter (expiring_soon/grace_period can still be marked
  -- attended).
  select status, expiry_date into v_status, v_expiry_date
  from subscriptions
  where member_id = v_member_id
  order by created_at desc
  limit 1;

  if v_status is null or v_status = 'expired' then
    -- Copies check_in()'s exact rejection branch verbatim (0034), including
    -- the on-conflict dedup and the null-v_status-maps-to-'expired'-alert
    -- reasoning -- a booked member with zero subscription rows is the same
    -- defensive "no plan" case check_in() already handles. Does not raise --
    -- returning null on rejection matches check_in()'s own contract, which
    -- callers must handle explicitly.
    insert into front_desk_alerts (gym_id, member_id, status, expiry_date)
    values (v_gym_id, v_member_id, 'expired', v_expiry_date)
    on conflict (member_id, kind, status) where dismissed_at is null do nothing;
    return null;
  end if;

  -- 0112 kill switch: the charging flag is read here, before any V1.6 call
  -- or lock. Off (or null) skips the consume/gate/attempt/alert/lock path below
  -- (the already-attended return above and the update guard below still
  -- apply to every gym).
  select g.charge_guests_per_session into v_charging
  from gyms g where g.id = v_gym_id;
  v_charging := coalesce(v_charging, false);

  if v_charging then
    -- Canonical lock order: class_sessions, then member (FOR NO KEY UPDATE).
    perform 1 from class_sessions where id = v_class_session_id for no key update;
    perform 1 from members where id = v_member_id for no key update;

    -- A concurrent mark of the same booking may have committed while this
    -- call waited for the locks: return the stored row, consume nothing.
    select * into v_row from class_bookings where id = v_booking_id;
    if v_row.id is null then
      raise exception 'mark_class_attendance: booking % not found', p_booking_id;
    end if;
    if v_row.attended_at is not null then
      return v_row;
    end if;

    select c.outcome into v_gate_outcome
    from private.consume_guest_session(v_member_id, v_gym_id, now(), 'class') c;

    if v_gate_outcome = 'denied' then
      -- A denied class mark commits (never raises): one attempt row (fresh
      -- scan id, so every refusal counts) and one active session_required
      -- alert per member (null status; NULLS NOT DISTINCT one-active index).
      insert into session_attempts (gym_id, member_id, scan_id, source, scanned_at, class_session_id)
      values (v_gym_id, v_member_id, gen_random_uuid(), 'class', now(), v_class_session_id);

      insert into front_desk_alerts (gym_id, member_id, kind, status, expiry_date)
      values (v_gym_id, v_member_id, 'session_required', null, null)
      on conflict (member_id, kind, status) where dismissed_at is null do nothing;

      -- attended_at stays null: that is the refusal signal to the caller.
      return v_row;
    end if;
  end if;

  -- Review fix: the booking could still be deleted (cancel_class_booking())
  -- between the existence check above and this update -- without the
  -- not-found recheck, a 0-row update leaves v_row an all-null composite,
  -- indistinguishable from the expired-member rejection shape once it
  -- crosses the PostgREST/JSON boundary.
  update class_bookings set attended_at = now()
  where id = v_booking_id and attended_at is null
  returning * into v_row;

  if v_row.id is null then
    -- Either deleted, or a concurrent mark won the race (flag-off path).
    select * into v_row from class_bookings where id = v_booking_id;
    if v_row.id is null then
      raise exception 'mark_class_attendance: booking % not found', p_booking_id;
    end if;
  end if;

  return v_row;
end;
$function$;

-- create or replace keeps the grants; restate the revokes so the file is self-describing (the migration guardrail reads them).
revoke execute on function public.void_staff_check_in(uuid, text) from public, anon;
revoke execute on function public.mark_class_attendance(uuid) from public, anon;

-- ----------------------------------------------------------------------------
-- Verify. create or replace keeps grants on the three replaced functions; assert them, and the shape of every change.
-- ----------------------------------------------------------------------------
do $verify$
declare
  v_src text;
begin
  if to_regprocedure('private.consume_guest_session(uuid, uuid, timestamptz)') is not null then
    raise exception '0178: the 3-argument consume function still exists (a 3-argument call would be ambiguous)';
  end if;
  if pg_get_function_result('private.consume_guest_session(uuid, uuid, timestamptz, text)'::regprocedure)
     is distinct from 'TABLE(outcome text, session_created_at timestamp with time zone, session_id uuid)' then
    raise exception '0178: the consume function changed its result columns';
  end if;
  select prosrc into v_src from pg_proc where oid = 'private.consume_guest_session(uuid, uuid, timestamptz, text)'::regprocedure;
  if position('class_single_use_unsupported' in v_src) = 0 or position('''single_use''' in v_src) = 0 or position('''visit''' in v_src) = 0 then
    raise exception '0178: the consume function lost its single_use branch or its class guard';
  end if;
  if exists (
    select 1 from pg_proc p
    where p.oid = 'private.consume_guest_session(uuid, uuid, timestamptz, text)'::regprocedure
      and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE')
           or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0))
  ) then
    raise exception '0178: the consume function must not be executable by public, anon or authenticated';
  end if;

  select prosrc into v_src from pg_proc where oid = 'private.record_check_in(uuid, uuid, text, uuid, timestamptz, uuid)'::regprocedure;
  if position('visit_limit' in v_src) = 0 or position('single_use_visit_limit_minutes' in v_src) = 0
     or position('covered_attendance_id' in v_src) = 0 or position('consume_guest_session' in v_src) = 0
     or v_src !~ 'current_gym_status\(\)\s+is\s+distinct\s+from\s+''active''' then
    raise exception '0178: record_check_in lost the visit limit, the cover link, the session gate or the status guard';
  end if;
  if exists (
    select 1 from pg_proc p
    where p.oid = 'private.record_check_in(uuid, uuid, text, uuid, timestamptz, uuid)'::regprocedure
      and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE')
           or has_function_privilege('service_role', p.oid, 'EXECUTE')
           or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0))
  ) then
    raise exception '0178: record_check_in must not be executable by public, anon, authenticated or service_role';
  end if;

  select prosrc into v_src from pg_proc where oid = 'public.void_staff_check_in(uuid, text)'::regprocedure;
  if position('support_stepup_require' in v_src) = 0 or v_src !~ 'current_gym_status\(\)\s+is\s+distinct\s+from\s+''active'''
     or position('support_rpc_gym_id(''void_staff_check_in'')' in v_src) = 0
     or position('on_session_refunded_after_consumption' in v_src) = 0
     or position('v_session_mode = ''whole_day''' in v_src) = 0 then
    raise exception '0178: void_staff_check_in lost its step-up, status guard, gym resolution, stamp reversal or whole_day later-visit guard';
  end if;

  select prosrc into v_src from pg_proc where oid = 'public.mark_class_attendance(uuid)'::regprocedure;
  if v_src !~ 'consume_guest_session\(v_member_id, v_gym_id, now\(\), ''class''\)'
     or v_src !~ 'current_gym_status\(\)\s+is\s+distinct\s+from\s+''active''' then
    raise exception '0178: mark_class_attendance does not pass ''class'' to the consume function or lost its status guard';
  end if;

  if exists (
    select 1 from pg_proc p
    where p.oid in ('public.void_staff_check_in(uuid, text)'::regprocedure, 'public.mark_class_attendance(uuid)'::regprocedure)
      and (has_function_privilege('anon', p.oid, 'EXECUTE') or not has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  ) then
    raise exception '0178: void_staff_check_in and mark_class_attendance must stay executable by authenticated and not by anon';
  end if;

  -- The only callers of the consume function.
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.prokind = 'f' and n.nspname in ('public', 'private')
      and p.prosrc ~* 'consume_guest_session\('
      and p.proname not in ('consume_guest_session', 'record_check_in', 'mark_class_attendance')
  ) then
    raise exception '0178: a function other than record_check_in and mark_class_attendance calls consume_guest_session';
  end if;
end;
$verify$;
