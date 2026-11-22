-- ============================================================================
-- 0186: Settle triggers, the at-risk state view and the member pair (Epic 30, Story 30.3; FR-219, FR-220, FR-224, NFR-028, NFR-029; AD-53,
-- AD-19, AD-56, AD-29, AD-34).
--
-- 0185 left the fold and settle inert: nothing marked a week dirty, nothing settled on a schedule, and no member-callable function returned
-- the open week. This migration wires them, and nothing here is member-visible while platform_engagement_config.release_week_start is NULL
-- (`enabled` is false, the job touches no member, no fact is written).
--   1. private.record_check_in and public.void_staff_check_in are re-created from 0178 (their final version; no later migration redefines
--      them) with exactly ONE added statement each: the dirty mark, an upsert on engagement_state(member_id) placed right after the attendance
--      row is written (check-in) or voided (void), in the same transaction, with the member lock already held and no exception handler.
--      Nothing else runs in a check-in or a void: no settle, no fold, no fact, no milestone (FR-225, FR-230). Both bodies are GENERATED from
--      0178 by script; `diff` of each against 0178 is that statement and its comment.
--   2. The `engagement_settle` job (hourly at :05): private.engagement_settle_job() is a PROCEDURE that commits after every member, built on
--      three small functions the pgTAP suite can call inside its transaction (a procedure that COMMITs cannot run inside one):
--      private.engagement_settle_candidates (keyset batches), private.engagement_settle_member (skip locked, settle, caught errors) and
--      private.engagement_settle_record_run (the job_runs row).
--   3. private.engagement_state_view_at(member, now) holds the open-week logic; private.engagement_state_view(member) is the same at now();
--      private.open_engagement_at(member, now) settles at that day and then reads the view. The `_at` forms exist so tests can move the clock.
--   4. public.my_engagement() (STABLE, read only) and public.open_engagement() (VOLATILE, settles) for the calling member only.
--
-- Rollback: scripts/rollback-0186-engagement-settle-triggers-state-view.sql
-- ============================================================================
set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 1. The two Epic 27 check-in paths, each with one added statement (generated from 0178_single_use_check_in.sql)
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

  -- Engagement dirty mark (Epic 30, Story 30.3): the week of the recorded visit's stored visit_day needs a recount. One upsert on the primary
  -- key, in this transaction with the member lock held, deliberately NOT guarded by an exception handler: a lost mark would leave a week
  -- missed for good (NFR-028). Written for every check-in, whatever release_week_start says. A later mark never replaces an earlier one.
  insert into engagement_state (member_id, gym_id, dirty_from)
  values (p_member_id, p_gym_id, private.week_start_of(event.visit_day))
  on conflict (member_id) do update
    set dirty_from = least(coalesce(engagement_state.dirty_from, excluded.dirty_from), excluded.dirty_from);

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

  -- Engagement dirty mark (Epic 30, Story 30.3): the week of the voided visit's stored visit_day needs a recount. One upsert on the primary
  -- key, after the void update and with the member lock already held, deliberately NOT guarded by an exception handler (a lost mark would
  -- leave a week counted for good, NFR-028). No week fact or badge is touched here (FR-230).
  insert into engagement_state (member_id, gym_id, dirty_from)
  values (ae.member_id, v_gym_id, private.week_start_of(ae.visit_day))
  on conflict (member_id) do update
    set dirty_from = least(coalesce(engagement_state.dirty_from, excluded.dirty_from), excluded.dirty_from);

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


-- ----------------------------------------------------------------------------
-- 2. The engagement_settle job
-- ----------------------------------------------------------------------------

-- Candidates, one keyset batch: members (role member, not deactivated) of ACTIVE gyms, with the epoch set, whose watermark is dirty, or who
-- have a counted visit day in a week that has already closed (the Monday of their earliest visit day is on or before the last closed Monday;
-- a member whose only visit days are in the open week has nothing to settle) and were last settled before the Monday of the gym's last closed week (a NULL settled_through counts as before,
-- so members with only pre-release history are picked up) and that Monday is not before the epoch. Ordered by member id; p_after is the last
-- id of the previous batch. "Today" is the gym's local day (private.gym_today), so each gym's week closes within an hour of its Monday 00:00.
create function private.engagement_settle_candidates(p_after uuid, p_limit integer)
returns table (member_id uuid, gym_id uuid, today date)
language sql
stable
set search_path = public, pg_temp
as $$
  select m.id, m.gym_id, t.today
  from public.members m
  join public.gyms g on g.id = m.gym_id and g.status = 'active'
  cross join (select c.release_week_start as epoch from public.platform_engagement_config c limit 1) cfg
  cross join lateral (select private.gym_today(m.gym_id) as today) t
  left join public.engagement_state s on s.member_id = m.id
  where cfg.epoch is not null
    and m.role = 'member'
    and m.deactivated_at is null
    and (p_after is null or m.id > p_after)
    and (
      s.dirty_from is not null
      or (
        (select private.week_start_of(min(d.visit_day)) from public.member_visit_days d where d.member_id = m.id and d.gym_id = m.gym_id)
          <= private.week_start_of(t.today) - 7
        and (s.settled_through is null or s.settled_through < private.week_start_of(t.today) - 7)
        and private.week_start_of(t.today) - 7 >= cfg.epoch
      )
    )
  order by m.id
  limit greatest(coalesce(p_limit, 200), 1);
$$;

-- One member, in the caller's transaction: the member lock with `skip locked` FIRST (a check-in in flight holds it, so the member is skipped
-- and picked up on the next run, and the job never blocks a scan), then settle at the gym's day. The exception block is here, before the
-- COMMIT the procedure issues after this returns, never around it (a COMMIT inside an exception block is refused). Returns 'settled',
-- 'skipped' (locked, or the member is gone) or 'error:<message>'; an error rolls this member's partial writes and lock back.
create function private.engagement_settle_member(p_member_id uuid, p_gym_id uuid, p_today date)
returns text
language plpgsql
set search_path = public, pg_temp
as $$
begin
  begin
    perform 1 from public.members m where m.id = p_member_id and m.gym_id = p_gym_id for no key update skip locked;
    if not found then
      return 'skipped';
    end if;
    perform private.settle_engagement(p_member_id, p_gym_id, p_today);
    return 'settled';
  exception when others then
    return 'error:' || sqlerrm;
  end;
end;
$$;

-- The job_runs row of one run: success, or failure with "<n> of <total> members failed; first: <message>", or (no member was reached) "candidate read failed: <message>".
create function private.engagement_settle_record_run(p_started timestamptz, p_total integer, p_failed integer, p_first_error text)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  insert into public.job_runs (job_name, started_at, finished_at, status, error)
  values (
    'engagement_settle',
    p_started,
    clock_timestamp(),
    (case when p_failed > 0 then 'failure' else 'success' end)::public.job_status,
    case
      when p_failed > 0 and p_total = 0 then 'candidate read failed: ' || coalesce(p_first_error, '')
      when p_failed > 0 then p_failed || ' of ' || p_total || ' members failed; first: ' || coalesce(p_first_error, '')
    end
  );
end;
$$;

-- The job. A PROCEDURE, SECURITY INVOKER and with NO `set` clause (either forbids COMMIT); every name is schema-qualified because the
-- search_path is the caller's. It commits after every member, so a member's settle is its own short transaction. Run by `call`, never inside
-- a transaction block. It shares no function, lock or code path with check_in() (AD-19). With the epoch unset it logs `success` and touches
-- no member. One bad member never fails the run; the run ends `failure` with the count and the first message.
create procedure private.engagement_settle_job()
language plpgsql
as $$
declare
  v_started timestamptz := clock_timestamp();
  v_epoch date;
  v_batch jsonb;
  v_item jsonb;
  v_i integer;
  v_last uuid;
  v_total integer := 0;
  v_failed integer := 0;
  v_first_error text;
  v_result text;
begin
  select c.release_week_start into v_epoch from public.platform_engagement_config c limit 1;

  if v_epoch is not null then
    loop
      begin
        select coalesce(jsonb_agg(to_jsonb(c) order by c.member_id), '[]'::jsonb) into v_batch
        from private.engagement_settle_candidates(v_last, 200) c;
      exception when others then
        -- The candidate read itself failed: the run is a failure, with nothing more to settle this time.
        v_failed := v_failed + 1;
        v_first_error := coalesce(v_first_error, sqlerrm);
        exit;
      end;

      exit when jsonb_array_length(v_batch) = 0;

      for v_i in 0 .. jsonb_array_length(v_batch) - 1 loop
        v_item := v_batch -> v_i;
        v_last := (v_item ->> 'member_id')::uuid;
        v_total := v_total + 1;

        v_result := private.engagement_settle_member(v_last, (v_item ->> 'gym_id')::uuid, (v_item ->> 'today')::date);
        if v_result like 'error:%' then
          v_failed := v_failed + 1;
          v_first_error := coalesce(v_first_error, substr(v_result, 7));
        end if;

        commit;
      end loop;
    end loop;
  end if;

  perform private.engagement_settle_record_run(v_started, v_total, v_failed, v_first_error);
  commit;
end;
$$;

revoke execute on function private.engagement_settle_candidates(uuid, integer) from public, anon, authenticated, service_role;
revoke execute on function private.engagement_settle_member(uuid, uuid, date) from public, anon, authenticated, service_role;
revoke execute on function private.engagement_settle_record_run(timestamptz, integer, integer, text) from public, anon, authenticated, service_role;
revoke execute on procedure private.engagement_settle_job() from public, anon, authenticated, service_role;

-- Five past every hour, as postgres; cron.schedule() upserts by name.
select cron.schedule('engagement_settle', '5 * * * *', 'call private.engagement_settle_job();');

-- ----------------------------------------------------------------------------
-- 3. The state view family: one source for the open week, the at-risk flags and the day bounds (the ring, the calendar and, in Epic 31, the
-- reminder read only this). Reads only; never settles.
--   week_end            the Sunday (week_start + 6).
--   in_release_week     the epoch is set and the open week starts before it (the epoch Monday itself is a counted week).
--   goal                the member_weekly_goals row with the greatest effective_week at or before the week's Monday, else goal_default.
--   goal_is_default     no member_weekly_goals row of any date.
--   pending_*           the earliest goal row after the week's Monday.
--   visits_this_week    distinct visit days (member_visit_days) from the Monday to the Sunday: stored visit_days, never recomputed.
--   streak_weeks        the SETTLED streak from the fold, never counting the open week; streak_if_met adds one when the open week's goal is
--                       already met and the week is counted (epoch set, not the release week).
--   at_risk_weekly      no visit today, goal not met, visits_needed = days_left_in_week (no rest day remains), epoch set and the week not the
--                       release week, and the latest subscription present and not expired (no plan behaves as expired, as check-in treats it).
--   day_*_at, server_now  the gym-local day around p_now (a 23 h or 25 h DST day is right) and p_now itself.
--   needs_settle        epoch set and (dirty_from set, or the candidate rule of the job for this member: the Monday of the earliest visit day is
--                       on or before the last closed Monday, and settled_through is unset or before it, and that Monday is not before the epoch).
--   daily_run NULL, shields_held 0, comeback_state 'none', at_risk_daily false, pending_milestone NULL: constants until Epic 31 and 30.7
--   re-create this function body without changing its row type.
-- "Today" is the gym's CURRENT timezone applied to p_now; past visit_days never move when the timezone changes.
-- ----------------------------------------------------------------------------
create function private.engagement_state_view_at(p_member_id uuid, p_now timestamptz)
returns
table (
  enabled boolean,
  gym_today date,
  week_start date,
  week_end date,
  in_release_week boolean,
  goal smallint,
  goal_is_default boolean,
  pending_goal smallint,
  pending_effective_week date,
  visits_this_week integer,
  goal_met boolean,
  visited_today boolean,
  streak_weeks integer,
  streak_if_met integer,
  best_streak_weeks integer,
  has_settled_week boolean,
  days_left_in_week integer,
  visits_needed integer,
  at_risk_weekly boolean,
  at_risk_daily boolean,
  daily_run integer,
  shields_held integer,
  comeback_state text,
  day_starts_at timestamptz,
  day_ends_at timestamptz,
  server_now timestamptz,
  needs_settle boolean,
  pending_milestone smallint
)
language sql
stable
set search_path = public, pg_temp
as $$
  with t as (
    select m.id as member_id, m.gym_id,
           coalesce(nullif(btrim(g.timezone), ''), 'UTC') as tz,
           (p_now at time zone coalesce(nullif(btrim(g.timezone), ''), 'UTC'))::date as today
    from public.members m
    join public.gyms g on g.id = m.gym_id
    where m.id = p_member_id
  ),
  w as (
    select t.*, private.week_start_of(t.today) as ws from t
  ),
  cfg as (
    select c.release_week_start as epoch, c.goal_default from public.platform_engagement_config c limit 1
  ),
  a as (
    select
      w.member_id, w.gym_id, w.tz, w.today, w.ws,
      cfg.epoch,
      coalesce(
        (select g.goal from public.member_weekly_goals g where g.member_id = w.member_id and g.effective_week <= w.ws
          order by g.effective_week desc limit 1),
        cfg.goal_default::smallint
      ) as goal,
      not exists (select 1 from public.member_weekly_goals g where g.member_id = w.member_id) as goal_is_default,
      pg.goal as pending_goal,
      pg.effective_week as pending_week,
      (select count(*)::integer from public.member_visit_days d
        where d.member_id = w.member_id and d.gym_id = w.gym_id and d.visit_day between w.ws and w.ws + 6) as visits,
      exists (select 1 from public.member_visit_days d
        where d.member_id = w.member_id and d.gym_id = w.gym_id and d.visit_day = w.today) as visited_today,
      (select private.week_start_of(min(d.visit_day)) from public.member_visit_days d where d.member_id = w.member_id and d.gym_id = w.gym_id) as first_week,
      f.streak_weeks, f.best_streak_weeks, f.last_settled_week,
      (select s.status from public.subscriptions s where s.member_id = w.member_id order by s.created_at desc limit 1) as sub_status,
      st.settled_through, st.dirty_from
    from w
    cross join cfg
    left join lateral (
      select g.goal, g.effective_week from public.member_weekly_goals g
      where g.member_id = w.member_id and g.effective_week > w.ws
      order by g.effective_week limit 1
    ) pg on true
    cross join lateral private.engagement_fold(w.member_id) f
    left join public.engagement_state st on st.member_id = w.member_id
  ),
  b as (
    select
      a.*,
      a.epoch is not null as enabled,
      a.epoch is not null and a.ws < a.epoch as in_release,
      a.ws + 6 as we,
      (a.ws + 6 - a.today + 1) as days_left,
      a.visits >= a.goal as goal_met,
      greatest(a.goal - a.visits, 0) as needed
    from a
  )
  select
    b.enabled,
    b.today,
    b.ws,
    b.we,
    b.in_release,
    b.goal,
    b.goal_is_default,
    b.pending_goal,
    b.pending_week,
    b.visits,
    b.goal_met,
    b.visited_today,
    b.streak_weeks,
    case when b.enabled and not b.in_release and b.goal_met then b.streak_weeks + 1 end,
    b.best_streak_weeks,
    b.last_settled_week is not null,
    b.days_left,
    b.needed,
    b.enabled and not b.in_release and not b.visited_today and not b.goal_met
      and b.needed = b.days_left and b.sub_status is not null and b.sub_status <> 'expired',
    false,
    null::integer,
    0,
    'none'::text,
    bd.day_start,
    bd.next_day_start,
    p_now,
    case
      when not b.enabled then false
      when b.dirty_from is not null then true
      else coalesce(b.first_week <= b.ws - 7, false)
           and (b.settled_through is null or b.settled_through < b.ws - 7)
           and b.ws - 7 >= b.epoch
    end,
    null::smallint
  from b
  cross join lateral private.gym_local_day_bounds(b.tz, p_now) bd;
$$;

create function private.engagement_state_view(p_member_id uuid)
returns
table (
  enabled boolean,
  gym_today date,
  week_start date,
  week_end date,
  in_release_week boolean,
  goal smallint,
  goal_is_default boolean,
  pending_goal smallint,
  pending_effective_week date,
  visits_this_week integer,
  goal_met boolean,
  visited_today boolean,
  streak_weeks integer,
  streak_if_met integer,
  best_streak_weeks integer,
  has_settled_week boolean,
  days_left_in_week integer,
  visits_needed integer,
  at_risk_weekly boolean,
  at_risk_daily boolean,
  daily_run integer,
  shields_held integer,
  comeback_state text,
  day_starts_at timestamptz,
  day_ends_at timestamptz,
  server_now timestamptz,
  needs_settle boolean,
  pending_milestone smallint
)
language sql
stable
set search_path = public, pg_temp
as $$
  select * from private.engagement_state_view_at(p_member_id, now());
$$;

-- Settle at the gym-local day of p_now (private.settle_engagement takes the member lock first), then read the view at p_now. Writes only
-- through settle: a second call writes nothing.
create function private.open_engagement_at(p_member_id uuid, p_now timestamptz)
returns
table (
  enabled boolean,
  gym_today date,
  week_start date,
  week_end date,
  in_release_week boolean,
  goal smallint,
  goal_is_default boolean,
  pending_goal smallint,
  pending_effective_week date,
  visits_this_week integer,
  goal_met boolean,
  visited_today boolean,
  streak_weeks integer,
  streak_if_met integer,
  best_streak_weeks integer,
  has_settled_week boolean,
  days_left_in_week integer,
  visits_needed integer,
  at_risk_weekly boolean,
  at_risk_daily boolean,
  daily_run integer,
  shields_held integer,
  comeback_state text,
  day_starts_at timestamptz,
  day_ends_at timestamptz,
  server_now timestamptz,
  needs_settle boolean,
  pending_milestone smallint
)
language plpgsql
volatile
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_gym_id uuid;
  v_today date;
begin
  select m.gym_id, (p_now at time zone coalesce(nullif(btrim(g.timezone), ''), 'UTC'))::date
    into v_gym_id, v_today
  from public.members m
  join public.gyms g on g.id = m.gym_id
  where m.id = p_member_id;

  if v_gym_id is null then
    return;
  end if;

  perform private.settle_engagement(p_member_id, v_gym_id, v_today);

  return query select * from private.engagement_state_view_at(p_member_id, p_now);
end;
$$;

revoke execute on function private.engagement_state_view_at(uuid, timestamptz) from public, anon, authenticated, service_role;
revoke execute on function private.engagement_state_view(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.open_engagement_at(uuid, timestamptz) from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. The member pair. The caller is resolved live (role member, own non-deactivated member row, active gym), exactly as set_weekly_goal and
-- my_weekly_goal do; there is no member id, date or clock parameter, so there is nothing to forge. These are the only call sites of the
-- `_at` forms with now().
-- ----------------------------------------------------------------------------

-- The caller's open-week state. No row for a caller who is not a live member of an active gym. Writes nothing.
create function public.my_engagement()
returns
table (
  enabled boolean,
  gym_today date,
  week_start date,
  week_end date,
  in_release_week boolean,
  goal smallint,
  goal_is_default boolean,
  pending_goal smallint,
  pending_effective_week date,
  visits_this_week integer,
  goal_met boolean,
  visited_today boolean,
  streak_weeks integer,
  streak_if_met integer,
  best_streak_weeks integer,
  has_settled_week boolean,
  days_left_in_week integer,
  visits_needed integer,
  at_risk_weekly boolean,
  at_risk_daily boolean,
  daily_run integer,
  shields_held integer,
  comeback_state text,
  day_starts_at timestamptz,
  day_ends_at timestamptz,
  server_now timestamptz,
  needs_settle boolean,
  pending_milestone smallint
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  v_gym_id uuid;
  v_member_id uuid;
begin
  if (select private.current_member_role())::text is distinct from 'member' then
    return;
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    return;
  end if;

  select m.id into v_member_id
  from members m
  where m.user_id = auth.uid() and m.gym_id = v_gym_id and m.deactivated_at is null
  order by m.created_at desc, m.id desc
  limit 1;

  if v_member_id is null then
    return;
  end if;

  -- Written without the `is distinct from` guard text on purpose: that text marks a status-guarded WRITE function, which must raise the
  -- `is not active` phrase (suspension_rpc_coverage.test.sql). This is a read that returns no row.
  if coalesce(private.current_gym_status()::text, '') <> 'active' then
    return;
  end if;

  return query select * from private.engagement_state_view_at(v_member_id, now());
end;
$function$;

-- The same row after settling the weeks that have closed (the first open after a Monday). The only member-callable function that settles.
-- Refuses a caller who is not a live member of an active gym.
create function public.open_engagement()
returns
table (
  enabled boolean,
  gym_today date,
  week_start date,
  week_end date,
  in_release_week boolean,
  goal smallint,
  goal_is_default boolean,
  pending_goal smallint,
  pending_effective_week date,
  visits_this_week integer,
  goal_met boolean,
  visited_today boolean,
  streak_weeks integer,
  streak_if_met integer,
  best_streak_weeks integer,
  has_settled_week boolean,
  days_left_in_week integer,
  visits_needed integer,
  at_risk_weekly boolean,
  at_risk_daily boolean,
  daily_run integer,
  shields_held integer,
  comeback_state text,
  day_starts_at timestamptz,
  day_ends_at timestamptz,
  server_now timestamptz,
  needs_settle boolean,
  pending_milestone smallint
)
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  v_gym_id uuid;
  v_member_id uuid;
begin
  if (select private.current_member_role())::text is distinct from 'member' then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  select m.id into v_member_id
  from members m
  where m.user_id = auth.uid() and m.gym_id = v_gym_id and m.deactivated_at is null
  order by m.created_at desc, m.id desc
  limit 1;

  if v_member_id is null then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  -- `is distinct from`, never `<>`: the helper returns NULL for a session with no resolvable gym, and a NULL must refuse.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'permission denied: gym % is not active', v_gym_id using errcode = '42501';
  end if;

  return query select * from private.open_engagement_at(v_member_id, now());
end;
$function$;

revoke execute on function public.my_engagement() from public, anon, authenticated, service_role;
revoke execute on function public.open_engagement() from public, anon, authenticated, service_role;
grant execute on function public.my_engagement() to authenticated;
grant execute on function public.open_engagement() to authenticated;

-- ----------------------------------------------------------------------------
-- Verify: any failure raises and rolls the whole migration back
-- ----------------------------------------------------------------------------
do $verify$
declare
  v_fn text;
  v_src text;
  v_result text;
begin
  -- The two amended check-in paths: the dirty mark is there, nothing else of the engagement area is, and they stay unreachable / unchanged in grants.
  select p.prosrc into v_src from pg_proc p where p.oid = 'private.record_check_in(uuid, uuid, text, uuid, timestamptz, uuid)'::regprocedure;
  if v_src !~ 'insert into engagement_state \(member_id, gym_id, dirty_from\)\s+values \(p_member_id, p_gym_id, private\.week_start_of\(event\.visit_day\)\)'
     or v_src ~* 'settle_engagement|engagement_facts|engagement_fold|milestone'
     or v_src !~ 'current_gym_status\(\)\s+is\s+distinct\s+from\s+''active''' then
    raise exception '0186: record_check_in lost its mark, gained more than the mark, or lost its status guard';
  end if;
  select p.prosrc into v_src from pg_proc p where p.oid = 'public.void_staff_check_in(uuid, text)'::regprocedure;
  if v_src !~ 'insert into engagement_state \(member_id, gym_id, dirty_from\)\s+values \(ae\.member_id, v_gym_id, private\.week_start_of\(ae\.visit_day\)\)'
     or v_src ~* 'settle_engagement|engagement_facts|engagement_fold|milestone'
     or v_src !~ 'current_gym_status\(\)\s+is\s+distinct\s+from\s+''active''' then
    raise exception '0186: void_staff_check_in lost its mark, gained more than the mark, or lost its status guard';
  end if;
  if has_function_privilege('anon', 'private.record_check_in(uuid, uuid, text, uuid, timestamptz, uuid)'::regprocedure, 'execute')
     or has_function_privilege('authenticated', 'private.record_check_in(uuid, uuid, text, uuid, timestamptz, uuid)'::regprocedure, 'execute')
     or has_function_privilege('service_role', 'private.record_check_in(uuid, uuid, text, uuid, timestamptz, uuid)'::regprocedure, 'execute')
     or has_function_privilege('anon', 'public.void_staff_check_in(uuid, text)'::regprocedure, 'execute')
     or not has_function_privilege('authenticated', 'public.void_staff_check_in(uuid, text)'::regprocedure, 'execute') then
    raise exception '0186: a check-in function changed its grants';
  end if;

  -- Every new function: unreachable by a client, except the public pair (authenticated only).
  foreach v_fn in array array[
    'private.engagement_settle_candidates(uuid, integer)',
    'private.engagement_settle_member(uuid, uuid, date)',
    'private.engagement_settle_record_run(timestamptz, integer, integer, text)',
    'private.engagement_settle_job()',
    'private.engagement_state_view_at(uuid, timestamptz)',
    'private.engagement_state_view(uuid)',
    'private.open_engagement_at(uuid, timestamptz)'
  ] loop
    if to_regprocedure(v_fn) is null then
      raise exception '0186: % is missing', v_fn;
    end if;
    if has_function_privilege('anon', to_regprocedure(v_fn), 'execute')
       or has_function_privilege('authenticated', to_regprocedure(v_fn), 'execute')
       or has_function_privilege('service_role', to_regprocedure(v_fn), 'execute')
       or has_function_privilege('public', to_regprocedure(v_fn), 'execute') then
      raise exception '0186: % is executable by a client role', v_fn;
    end if;
  end loop;

  foreach v_fn in array array['public.my_engagement()', 'public.open_engagement()'] loop
    if to_regprocedure(v_fn) is null then
      raise exception '0186: % is missing', v_fn;
    end if;
    if has_function_privilege('anon', to_regprocedure(v_fn), 'execute')
       or has_function_privilege('service_role', to_regprocedure(v_fn), 'execute')
       or has_function_privilege('public', to_regprocedure(v_fn), 'execute')
       or not has_function_privilege('authenticated', to_regprocedure(v_fn), 'execute') then
      raise exception '0186: % has the wrong grants (authenticated only)', v_fn;
    end if;
  end loop;

  -- The job is a procedure that can COMMIT: invoker, no SET clause.
  if not exists (
    select 1 from pg_proc p
    where p.oid = 'private.engagement_settle_job()'::regprocedure and p.prokind = 'p' and not p.prosecdef and p.proconfig is null
  ) then
    raise exception '0186: engagement_settle_job must be a SECURITY INVOKER procedure with no SET clause (either forbids COMMIT)';
  end if;
  if (select count(*) from cron.job where jobname = 'engagement_settle' and schedule = '5 * * * *'
        and command = 'call private.engagement_settle_job();') <> 1 then
    raise exception '0186: the engagement_settle cron job is missing or mis-scheduled';
  end if;

  -- The view family: one row type, STABLE reads, a VOLATILE settle; the public pair has the right volatility and security.
  select pg_get_function_result('private.engagement_state_view_at(uuid, timestamptz)'::regprocedure) into v_result;
  if pg_get_function_result('private.engagement_state_view(uuid)'::regprocedure) is distinct from v_result
     or pg_get_function_result('private.open_engagement_at(uuid, timestamptz)'::regprocedure) is distinct from v_result
     or pg_get_function_result('public.my_engagement()'::regprocedure) is distinct from v_result
     or pg_get_function_result('public.open_engagement()'::regprocedure) is distinct from v_result then
    raise exception '0186: the state view family does not share one row type';
  end if;
  if (select provolatile from pg_proc where oid = 'public.my_engagement()'::regprocedure) <> 's'
     or (select provolatile from pg_proc where oid = 'public.open_engagement()'::regprocedure) <> 'v'
     or (select provolatile from pg_proc where oid = 'private.engagement_state_view_at(uuid, timestamptz)'::regprocedure) <> 's'
     or (select provolatile from pg_proc where oid = 'private.engagement_state_view(uuid)'::regprocedure) <> 's'
     or (select provolatile from pg_proc where oid = 'private.open_engagement_at(uuid, timestamptz)'::regprocedure) <> 'v'
     or not (select prosecdef from pg_proc where oid = 'public.my_engagement()'::regprocedure)
     or not (select prosecdef from pg_proc where oid = 'public.open_engagement()'::regprocedure) then
    raise exception '0186: a view or public function has the wrong volatility or security';
  end if;
  if (select count(*) from pg_proc where oid = 'public.my_engagement()'::regprocedure and pronargs = 0) <> 1
     or (select count(*) from pg_proc where oid = 'public.open_engagement()'::regprocedure and pronargs = 0) <> 1 then
    raise exception '0186: the public pair takes no argument';
  end if;
  if exists (select 1 from private.support_capabilities where object_name ~ 'engagement') then
    raise exception '0186: an engagement function is registered as a support capability';
  end if;
end;
$verify$;
