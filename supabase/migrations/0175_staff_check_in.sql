-- ============================================================================
-- 0175: Staff check-in and same-day void (Epic 27, Story 27.3; FR-248, FR-249, FR-250, FR-251; AD-56, AD-29, AD-30, AD-31, AD-35, AD-39).
--
-- A member whose phone is dead or lost cannot get in, and a desk mistake (the wrong member checked in) had no remedy. This migration adds
-- the database half of the fix over the one insert path of 0174:
--
--   * public.staff_check_in(p_member_id)  -- no time parameter, no scan id. Coded outcomes, never an exception for a refusal (an exception
--     would roll the audit row back); only a suspended gym raises. It resolves the gym from private.support_rpc_gym_id('staff_check_in'),
--     never from a parameter, so the gym private.record_check_in checks through private.current_gym_status() is by construction the gym
--     the support caller acts on (closes the 27.2 deferral). It calls private.record_check_in(member, gym, 'staff', private.actor_id(),
--     now()) and nothing else inserts into attendance_events.
--   * public.void_staff_check_in(p_attendance_id, p_reason)  -- Manager and above, the same gym-local day, a mandatory reason. Lock order
--     (AD-29): member, then the attendance row, then guest_sessions, then loyalty (inside the existing stamp-reversal hook). The session
--     the entry consumed goes back to Unused ("unconsume" in code and comments; "void" already means guest_sessions.voided_at, AD-28).
--     The desk payment is not reversed (the refund path owns it).
--   * public.list_attendance_log(p_from, p_to, p_member_id)  -- the Daily Log read. It returns voided rows too (the base-table policies of
--     0173 hide them from staff clients), with the resolved Entry label, the voided-by label and the two booleans the Void modal needs.
--   * guest_sessions.covered_attendance_id (FK to attendance_events, unique where not null, no cascade; spine AD-55, Epic 28 reuses it),
--     set by private.record_check_in in the same transaction when the session gate returns 'consumed'. private.consume_guest_session
--     gains a third result column, session_id, so the caller never has to guess which session it consumed (drop and re-create, same
--     body; its two callers read named columns).
--   * the three updaters of attendance_events (check_out, check_out_member, run_check_in_auto_timeout_job) read the open row with
--     "voided_at is null": a voided open row can sit beside a live one since 0174 (closes the second 27.2 deferral).
--   * attendance_events.checkout_type gains 'void'; session_attempts.source gains 'staff'.
--   * the three RPCs are rows of private.support_capabilities (AD-35); the two writing ones need a single-use step-up bound to the
--     member or the attendance row (private.stepup_issue gains the two actions); the audit action types a support caller can now cause
--     (the three new ones, plus the ones record_check_in and the session triggers write) join private.support_audit_actions.
--
-- No dirty_from or engagement object (Epic 30). No Realtime publication of attendance_events (it would also push entered_by and would not
-- deliver an update for a row the 0173 policy hides): a second desk sees a change on Refresh; a double void returns already_voided.
--
-- Rollback: scripts/rollback-0175-staff-check-in.sql (valid only while no staff entry exists).
-- ============================================================================
set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- Columns, CHECKs, the unconsume link.
-- ----------------------------------------------------------------------------
alter table public.attendance_events drop constraint attendance_events_checkout_type_check;
alter table public.attendance_events
  add constraint attendance_events_checkout_type_check check (checkout_type in ('manual', 'auto', 'void'));

alter table public.session_attempts drop constraint session_attempts_source_check;
alter table public.session_attempts
  add constraint session_attempts_source_check check (source in ('check_in', 'class', 'staff'));

-- No cascade: deleting an attendance row never silently deletes or rewrites the session it covered.
alter table public.guest_sessions
  add column covered_attendance_id uuid references public.attendance_events (id);

create unique index guest_sessions_covered_attendance_id_unique
  on public.guest_sessions (covered_attendance_id)
  where covered_attendance_id is not null;

-- ----------------------------------------------------------------------------
-- private.consume_guest_session: outcome, session_created_at and now session_id (the session consumed, or the one that covers the day;
-- null for 'exempt' and 'denied'). Same body as 0111 apart from the third column.
-- ----------------------------------------------------------------------------
drop function private.consume_guest_session(uuid, uuid, timestamptz);

create function private.consume_guest_session(p_member_id uuid, p_gym_id uuid, p_receipt_at timestamptz)
returns table (outcome text, session_created_at timestamptz, session_id uuid)
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

  -- Canonical order: member (FOR NO KEY UPDATE) before guest_sessions.
  perform 1 from members m where m.id = p_member_id for no key update;

  select b.day_start into v_day_start
  from private.gym_local_day_bounds(v_timezone, p_receipt_at) b;
  v_day := (v_day_start at time zone v_timezone)::date;

  -- Already covered today by a consumed, non-voided session.
  select s.created_at, s.id into v_created_at, v_session_id
  from guest_sessions s
  where s.member_id = p_member_id
    and s.gym_id = p_gym_id
    and s.consumed_at is not null
    and s.voided_at is null
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

  update guest_sessions
  set consumed_at = p_receipt_at, covered_day = v_day
  where id = v_session_id;

  perform private.on_session_consumed(v_session_id, p_member_id, p_gym_id);

  return query select 'consumed'::text, v_created_at, v_session_id;
end;
$$;

revoke execute on function private.consume_guest_session(uuid, uuid, timestamptz) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- private.record_check_in: the 0174 body, plus the covered_attendance_id link when the gate consumed a session.
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
  v_new_id uuid;
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
  -- consumed nothing, so it links nothing. Lock order: the guest_sessions row was locked by the gate above, after the attendance row.
  if v_gate_outcome = 'consumed' then
    v_new_id := event.id;
    update guest_sessions gs
    set covered_attendance_id = v_new_id
    where gs.id = v_session_id;
  end if;

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

-- ----------------------------------------------------------------------------
-- The three updaters read the open row with voided_at is null (0124 and 0024 bodies, one predicate added each).
-- ----------------------------------------------------------------------------
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
  where member_id = p_member_id and gym_id = v_member_gym_id and checked_out_at is null and voided_at is null
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
  where member_id = v_member_id and checked_out_at is null and voided_at is null
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
      and a.voided_at is null
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

-- ----------------------------------------------------------------------------
-- The label of the person behind entered_by / voided_by. The per-gym support proxy is always "GymOS Support" (AD-39, FR-186). A name
-- that cannot be resolved is null: the client shows "By staff" and the row stays usable. Never the auth user, never an email.
-- ----------------------------------------------------------------------------
create function private.attendance_actor_label(p_user_id uuid, p_gym_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when u.is_support_proxy then 'GymOS Support'
    else coalesce(
      nullif(btrim(u.display_name), ''),
      (select nullif(btrim(m.name), '')
       from members m
       where m.user_id = u.id and m.gym_id = p_gym_id
       order by m.deactivated_at nulls first, m.created_at desc
       limit 1))
  end
  from users u
  where u.id = p_user_id;
$$;

revoke execute on function private.attendance_actor_label(uuid, uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- public.staff_check_in
--
-- Refusal order: role and gym, the suspension guard (raises), the support step-up, the member lock, the member checks (not found,
-- deactivated, registration fee due, no plan), then private.record_check_in. A scan reads fee-due and no-plan as blocked_expired; staff
-- gets the distinct code, and nothing is consumed. A refusal returns normally so its audit row commits. No front_desk_alerts row for
-- any outcome (FR-249).
-- ----------------------------------------------------------------------------
create function public.staff_check_in(p_member_id uuid)
returns table (
  outcome text,
  attendance_id uuid,
  checked_in_at timestamptz,
  member_status subscription_status,
  expiry_date date,
  days_since_expiry integer,
  grace_ends_on date,
  since timestamptz,
  session_amount integer
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
  v_member_role member_role;
  v_deactivated_at timestamptz;
  v_settled_at timestamptz;
  v_has_plan boolean;
  v_grace_days integer;
  v_price integer;
  r record;
begin
  v_role := private.support_rpc_role('staff_check_in');
  if not coalesce(v_role in ('owner', 'manager', 'supervisor', 'receptionist'), false) then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.support_rpc_gym_id('staff_check_in');
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  -- Story 11.8 suspension gate: the one refusal that raises (R9). `is distinct from`, never `<>`.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'staff_check_in: gym % is not active', v_gym_id;
  end if;

  -- A live support caller needs a single-use grant bound to this member; a no-op for everyone else.
  perform private.support_stepup_require('support_staff_check_in', p_member_id::text);

  v_actor := private.actor_id();

  -- The member lock first (AD-29); record_check_in takes it again, harmlessly.
  select m.role, m.deactivated_at, m.registration_fee_settled_at into v_member_role, v_deactivated_at, v_settled_at
  from members m
  where m.id = p_member_id and m.gym_id = v_gym_id
  for no key update;

  -- Another gym's member and a missing id are the same answer (no existence oracle). A staff row is not a member to check in.
  if not found or v_member_role is distinct from 'member' then
    outcome := 'member_not_found';
    return next;
    return;
  end if;

  if v_deactivated_at is not null then
    perform log_audit_event(
      p_action_type => 'staff_check_in_rejected',
      p_gym_id => v_gym_id,
      p_target_entity_id => p_member_id::text,
      p_target_entity_type => 'member',
      p_metadata => jsonb_build_object('member_id', p_member_id, 'outcome', 'refused_deactivated', 'reason', 'deactivated'));
    outcome := 'refused_deactivated';
    return next;
    return;
  end if;

  select exists (select 1 from subscriptions s where s.member_id = p_member_id) into v_has_plan;

  if not v_has_plan then
    if v_settled_at is null then
      perform log_audit_event(
        p_action_type => 'staff_check_in_rejected',
        p_gym_id => v_gym_id,
        p_target_entity_id => p_member_id::text,
        p_target_entity_type => 'member',
        p_metadata => jsonb_build_object('member_id', p_member_id, 'outcome', 'refused_registration_fee_due', 'reason', 'registration_fee_due'));
      outcome := 'refused_registration_fee_due';
    else
      perform log_audit_event(
        p_action_type => 'staff_check_in_rejected',
        p_gym_id => v_gym_id,
        p_target_entity_id => p_member_id::text,
        p_target_entity_type => 'member',
        p_metadata => jsonb_build_object('member_id', p_member_id, 'outcome', 'refused_no_plan', 'reason', 'no_plan'));
      outcome := 'refused_no_plan';
    end if;
    return next;
    return;
  end if;

  select * into r from private.record_check_in(p_member_id, v_gym_id, 'staff', v_actor, now());

  member_status := r.member_status;
  expiry_date := r.expiry_date;

  if r.outcome = 'already_open' then
    -- R7: nothing written, nothing audited (a no-op is not an event).
    outcome := 'already_checked_in';
    attendance_id := (r.event).id;
    since := (r.event).checked_in_at;
    return next;
    return;
  end if;

  if r.outcome = 'blocked_expired' then
    -- R4. days_since_expiry is 0 on the day itself.
    if r.expiry_date is not null then
      days_since_expiry := greatest(private.gym_today(v_gym_id) - r.expiry_date, 0);
    end if;
    perform log_audit_event(
      p_action_type => 'staff_check_in_rejected',
      p_gym_id => v_gym_id,
      p_target_entity_id => p_member_id::text,
      p_target_entity_type => 'member',
      p_metadata => jsonb_build_object('member_id', p_member_id, 'outcome', 'rejected_expired', 'reason', 'expired',
                                       'expiry_date', r.expiry_date, 'days_since_expiry', days_since_expiry));
    outcome := 'rejected_expired';
    return next;
    return;
  end if;

  if r.outcome = 'blocked_session' then
    -- R5. The attempt is evidence of an unpaid visit (AD-31): one row per refusal (no scan id), source staff. The 0113 trigger audits it
    -- as session_attempt_blocked as for a scan; the staff_check_in_rejected row below is the staff-side record.
    insert into session_attempts (gym_id, member_id, scan_id, source, scanned_at)
    values (v_gym_id, p_member_id, null, 'staff', now());

    select pl.price into v_price
    from subscriptions s
    join plans pl on pl.id = s.plan_id
    where s.member_id = p_member_id
    order by s.created_at desc, s.id desc
    limit 1;

    perform log_audit_event(
      p_action_type => 'staff_check_in_rejected',
      p_gym_id => v_gym_id,
      p_target_entity_id => p_member_id::text,
      p_target_entity_type => 'member',
      p_metadata => jsonb_build_object('member_id', p_member_id, 'outcome', 'session_required', 'reason', 'no_paid_session',
                                       'session_amount', v_price));
    outcome := 'session_required';
    session_amount := v_price;
    return next;
    return;
  end if;

  if r.outcome <> 'checked_in' then
    raise exception 'staff_check_in: unexpected outcome %', r.outcome;
  end if;

  attendance_id := (r.event).id;
  checked_in_at := (r.event).checked_in_at;

  if r.member_status = 'expiring_soon' then
    outcome := 'checked_in_expiring_soon';
  elsif r.member_status = 'grace_period' then
    outcome := 'checked_in_grace_period';
    select coalesce(g.grace_period_days, 0) into v_grace_days from gyms g where g.id = v_gym_id;
    grace_ends_on := r.expiry_date + coalesce(v_grace_days, 0);
  else
    outcome := 'checked_in';
  end if;

  perform log_audit_event(
    p_action_type => 'staff_check_in',
    p_gym_id => v_gym_id,
    p_target_entity_id => p_member_id::text,
    p_target_entity_type => 'member',
    p_metadata => jsonb_build_object(
      'member_id', p_member_id,
      'attendance_event_id', attendance_id,
      'checked_in_at', checked_in_at,
      'member_status', r.member_status,
      'outcome', case when outcome = 'checked_in' then 'checked_in' else 'checked_in_with_warning' end));

  return next;
  return;
end;
$$;

-- ----------------------------------------------------------------------------
-- public.void_staff_check_in
--
-- outcome: voided | attendance_not_found | invalid_reason | already_voided | not_staff_entry | not_same_day | later_visit_relies.
-- Every refusal returns normally and changes nothing. Lock order: member, then the attendance row, then guest_sessions, then loyalty.
-- ----------------------------------------------------------------------------
create function public.void_staff_check_in(p_attendance_id uuid, p_reason text)
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

  -- The session this entry consumed, if any. A voided (refunded) session is not given back: the refund already ended it.
  select gs.id into v_session_id
  from guest_sessions gs
  where gs.covered_attendance_id = ae.id and gs.consumed_at is not null and gs.voided_at is null
  for update;

  if v_session_id is not null then
    -- A later same-day visit of the member that is still counted relies on the covered day this session gave. "Later" is later INSERTED
    -- (created_at), not later checked_in_at: an offline covered scan synced after this entry can carry an earlier checked_in_at and still
    -- relies on the session.
    if exists (
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
-- public.list_attendance_log: the Daily Log read, voided rows included. Role and gym resolved live; any other caller gets an empty result
-- (uniform, no oracle). The consumed_session and earned_stamp booleans are only computed for a row that can still be voided.
-- ----------------------------------------------------------------------------
create function public.list_attendance_log(p_from timestamptz, p_to timestamptz, p_member_id uuid default null)
returns table (
  attendance_id uuid,
  member_id uuid,
  member_name text,
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  checkout_type text,
  visit_day date,
  source text,
  entered_by_label text,
  voided_at timestamptz,
  voided_by_label text,
  void_reason text,
  voidable boolean,
  consumed_session boolean,
  earned_stamp boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_role member_role;
  v_gym_id uuid;
  v_today date;
begin
  v_role := private.support_rpc_role('list_attendance_log');
  if not coalesce(v_role in ('owner', 'manager', 'supervisor', 'receptionist'), false) then
    return;
  end if;

  v_gym_id := private.support_rpc_gym_id('list_attendance_log');
  if v_gym_id is null then
    return;
  end if;

  if private.current_gym_status() is distinct from 'active' then
    raise exception 'list_attendance_log: gym % is not active', v_gym_id;
  end if;

  v_today := private.gym_today(v_gym_id);

  return query
  select
    ae.id,
    ae.member_id,
    m.name,
    ae.checked_in_at,
    ae.checked_out_at,
    ae.checkout_type,
    ae.visit_day,
    ae.source,
    case when ae.source = 'staff' then private.attendance_actor_label(ae.entered_by, ae.gym_id) end,
    ae.voided_at,
    case when ae.voided_at is not null then private.attendance_actor_label(ae.voided_by, ae.gym_id) end,
    ae.void_reason,
    (ae.source = 'staff' and ae.voided_at is null and ae.visit_day = v_today),
    case when ae.source = 'staff' and ae.voided_at is null and ae.visit_day = v_today then
      exists (select 1 from guest_sessions gs
              where gs.covered_attendance_id = ae.id and gs.consumed_at is not null and gs.voided_at is null)
    end,
    case when ae.source = 'staff' and ae.voided_at is null and ae.visit_day = v_today then
      exists (select 1 from guest_sessions gs
              join loyalty_events e on e.origin_id = gs.id and e.event_type = 'stamp_earned'
              where gs.covered_attendance_id = ae.id and gs.consumed_at is not null and gs.voided_at is null
                and not exists (select 1 from loyalty_events r where r.origin_id = gs.id and r.event_type = 'stamp_reversed'))
    end
  from attendance_events ae
  join members m on m.id = ae.member_id
  where ae.gym_id = v_gym_id
    and (p_from is null or ae.checked_in_at >= p_from)
    and (p_to is null or ae.checked_in_at < p_to)
    and (p_member_id is null or ae.member_id = p_member_id)
  order by ae.checked_in_at desc, ae.id;
end;
$$;

-- ----------------------------------------------------------------------------
-- Grants.
-- ----------------------------------------------------------------------------
revoke execute on function public.staff_check_in(uuid) from public, anon;
revoke execute on function public.void_staff_check_in(uuid, text) from public, anon;
revoke execute on function public.list_attendance_log(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.staff_check_in(uuid) to authenticated;
grant execute on function public.void_staff_check_in(uuid, text) to authenticated;
grant execute on function public.list_attendance_log(timestamptz, timestamptz, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- The registry (AD-35): the three RPCs admit a live support caller, by name.
-- ----------------------------------------------------------------------------
insert into private.support_capabilities (capability, kind, object_name) values
  ('attendance', 'rpc', 'staff_check_in'),
  ('attendance', 'rpc', 'void_staff_check_in'),
  ('attendance', 'rpc', 'list_attendance_log');

-- Audit action types a live support caller can now cause: the three new ones, the stale auto-close record_check_in writes, and the two
-- session triggers that fire inside a staff entry (consume) and an R5 refusal (blocked attempt). log_audit_event refuses any other type.
insert into private.support_audit_actions (action_type) values
  ('staff_check_in'),
  ('staff_check_in_rejected'),
  ('staff_check_in_voided'),
  ('attendance_stale_check_in_auto_closed'),
  ('session_consumed'),
  ('session_attempt_blocked')
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- Step-up: the two writing RPCs need a fresh authenticator code for a support caller (0167's list plus the two actions).
-- ----------------------------------------------------------------------------
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
  if p_action not in ('remove_super_admin_factor', 'create_super_admin', 'change_recovery_email', 'remove_recovery_email', 'support_refund', 'support_waive_registration_fee', 'support_create_staff', 'support_payment_connection', 'start_support_factor_reset', 'take_down_gym_page', 'lift_gym_page_takedown', 'support_staff_check_in', 'support_void_staff_check_in') then
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

-- ----------------------------------------------------------------------------
-- Re-assert the 0111 direct-write closure and the privileges of the re-created functions.
-- ----------------------------------------------------------------------------
revoke execute on function public.check_out_member(uuid) from public, anon;
grant execute on function public.check_out_member(uuid) to authenticated;
revoke execute on function public.check_out() from public, anon;
grant execute on function public.check_out() to authenticated;
revoke execute on function public.run_check_in_auto_timeout_job() from public, anon, authenticated;
revoke insert, update, delete on public.attendance_events from authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Verify.
-- ----------------------------------------------------------------------------
do $verify$
declare
  v_src text;
begin
  select prosrc into v_src from pg_proc where oid = 'public.staff_check_in(uuid)'::regprocedure;
  if position('private.record_check_in(' in v_src) = 0 or position('support_stepup_require' in v_src) = 0
     or v_src !~ 'current_gym_status\(\)\s+is\s+distinct\s+from\s+''active''' or position('support_rpc_gym_id(''staff_check_in'')' in v_src) = 0 then
    raise exception '0175: staff_check_in lost its record_check_in call, step-up, status guard or gym resolution';
  end if;
  select prosrc into v_src from pg_proc where oid = 'public.void_staff_check_in(uuid, text)'::regprocedure;
  if position('support_stepup_require' in v_src) = 0 or v_src !~ 'current_gym_status\(\)\s+is\s+distinct\s+from\s+''active'''
     or position('support_rpc_gym_id(''void_staff_check_in'')' in v_src) = 0
     or position('on_session_refunded_after_consumption' in v_src) = 0 then
    raise exception '0175: void_staff_check_in lost its step-up, status guard, gym resolution or stamp reversal';
  end if;
  select prosrc into v_src from pg_proc where oid = 'public.list_attendance_log(timestamptz, timestamptz, uuid)'::regprocedure;
  if v_src !~ 'current_gym_status\(\)\s+is\s+distinct\s+from\s+''active''' or position('support_rpc_gym_id(''list_attendance_log'')' in v_src) = 0 then
    raise exception '0175: list_attendance_log lost its status guard or gym resolution';
  end if;
  if exists (
    select 1 from pg_proc p
    where p.oid in ('public.check_out()'::regprocedure, 'public.check_out_member(uuid)'::regprocedure, 'public.run_check_in_auto_timeout_job()'::regprocedure)
      and position('voided_at is null' in p.prosrc) = 0
  ) then
    raise exception '0175: an updater of attendance_events does not read the open row with voided_at is null';
  end if;
  if position('covered_attendance_id' in (select prosrc from pg_proc where oid = 'private.record_check_in(uuid, uuid, text, uuid, timestamptz, uuid)'::regprocedure)) = 0 then
    raise exception '0175: record_check_in does not set covered_attendance_id';
  end if;
  if exists (
    select 1 from pg_proc p
    where p.oid in ('public.staff_check_in(uuid)'::regprocedure, 'public.void_staff_check_in(uuid, text)'::regprocedure,
                    'public.list_attendance_log(timestamptz, timestamptz, uuid)'::regprocedure)
      and (has_function_privilege('anon', p.oid, 'EXECUTE') or not has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  ) then
    raise exception '0175: the three RPCs must be executable by authenticated and not by anon';
  end if;
  if (select count(*) from private.support_capabilities
      where kind = 'rpc' and object_name in ('staff_check_in', 'void_staff_check_in', 'list_attendance_log')) <> 3 then
    raise exception '0175: the three RPCs are not all in the support registry';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'guest_sessions_covered_attendance_id_unique') then
    raise exception '0175: the covered_attendance_id unique index is missing';
  end if;
  if (select pg_get_constraintdef(oid) from pg_constraint where conname = 'attendance_events_checkout_type_check') not like '%void%'
     or (select pg_get_constraintdef(oid) from pg_constraint where conname = 'session_attempts_source_check') not like '%staff%' then
    raise exception '0175: a CHECK constraint was not widened';
  end if;
  if has_table_privilege('authenticated', 'public.attendance_events', 'INSERT')
     or has_table_privilege('authenticated', 'public.attendance_events', 'UPDATE')
     or has_table_privilege('authenticated', 'public.attendance_events', 'DELETE') then
    raise exception '0175: attendance_events has a client write grant';
  end if;
end
$verify$;
