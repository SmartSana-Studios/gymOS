-- ============================================================================
-- 0179: Class attendance in a Single-use gym and setting-change parity (Epic 28, Story 28.3; FR-238 [assumption A3], FR-239, FR-174 amended,
-- NFR-021 for the class path; AD-55, AD-29, AD-21, AD-28, AD-30, AD-31).
--
-- 28.2 made a class mark for a charged member in a Single-use gym raise class_single_use_unsupported. This migration removes that guard:
--
--   * private.consume_guest_session: dropped (the 4-argument form) and recreated with a FIFTH parameter p_booking_id uuid default null.
--     The immediate CHECK guest_sessions_cover_matches_kind (0177) needs covered_booking_id in the same UPDATE that sets consumed_at, so a
--     class caller cannot set it afterwards (a visit row has a later "link" step, checked by a deferred trigger; a class row does not).
--     Class order in a Single-use gym:
--       1. a consumed, non-voided whole_day row of the receipt day covers the class (judged from the row's own mode, as for a visit);
--       2. (judged from the row, in either gym mode) an open attendance row younger than least(checkin_timeout_hours, platform visit limit) that is the covered_attendance_id of a
--          consumed, non-voided single_use visit session covers the class: outcome 'covered', that session's id, nothing consumed
--          (assumption A3: FR-238 needs the visit's own session);
--       3. else the soonest-lapsing session (paid before free) is consumed as single_use / class / covered_booking_id, covered_day and
--          covered_attendance_id null.
--     A class mark never writes attendance_events and never closes a stale visit. In a whole_day gym a class behaves exactly as before.
--     p_kind = 'class' with a null booking raises where a booking is needed (a Single-use gym, past the exempt returns); a whole_day gym
--     never uses it, so the existing 4-argument callers and tests keep working through the default.
--   * public.mark_class_attendance (the 0178 body): the consume call passes v_booking_id. No other change.
--   * private.audit_session_consumed (the 0177 body): metadata gains covered_booking_id, for a class row only.
--   * public.list_guest_sessions_paid (the 0114 body): returns covered_kind, covered_booking_id, class_name, class_starts_at and the gym's timezone per row, so the
--     Paid tab can read "covered day", "visit [date], [time]" or "class [name], [date]". Columns and ordering are otherwise unchanged.
--
-- Callers of the consume function: private.record_check_in and public.mark_class_attendance, nothing else (a pgTAP source scan asserts it).
--
-- Rollback: scripts/rollback-0179-single-use-class-attendance.sql (refuses while any covered_kind = 'class' row exists).
-- ============================================================================
set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- private.consume_guest_session. The 4-argument form is dropped first: a default argument beside it would make a 4-argument call ambiguous.
-- ----------------------------------------------------------------------------
drop function private.consume_guest_session(uuid, uuid, timestamptz, text);

create function private.consume_guest_session(
  p_member_id uuid, p_gym_id uuid, p_receipt_at timestamptz, p_kind text default 'visit', p_booking_id uuid default null
)
returns table (outcome text, session_created_at timestamptz, session_id uuid)
language plpgsql
set search_path = public
as $$
declare
  v_charging boolean;
  v_timezone text;
  v_validity text;
  v_timeout_hours integer;
  v_limit_minutes integer;
  v_window interval;
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
  select g.charge_guests_per_session, g.timezone, g.session_validity, g.checkin_timeout_hours
  into v_charging, v_timezone, v_validity, v_timeout_hours
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

  -- A class row records its booking in the same UPDATE that consumes it (the immediate cover CHECK). Placed after the exempt returns:
  -- an exempt member consumes nothing, so a caller with no booking is not the error case there.
  if p_kind = 'class' and v_validity = 'single_use' and p_booking_id is null then
    raise exception 'consume_guest_session: a class needs its booking id';
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

  -- A class inside an open visit that its own single_use session covers costs nothing (FR-238, assumption A3). The visit is judged from
  -- that session's own row, never the gym's current setting (so a flip mid-visit changes nothing: the visit finishes under the rule it began
  -- with, class marks included); the window is the one record_check_in uses for a stale test (the gym timeout, or the platform visit limit
  -- when that is the shorter), evaluated at receipt time. Nothing is written: no session, no stamp, no attendance. A gym that never ran
  -- Single use has no such session, so a Whole day class mark is untouched.
  if p_kind = 'class' then
    v_window := make_interval(hours => v_timeout_hours);
    select c.single_use_visit_limit_minutes into v_limit_minutes from platform_session_config c limit 1;
    if v_limit_minutes is not null and make_interval(mins => v_limit_minutes) <= v_window then
      v_window := make_interval(mins => v_limit_minutes);
    end if;

    select gs.created_at, gs.id into v_created_at, v_session_id
    from attendance_events ae
    join guest_sessions gs on gs.covered_attendance_id = ae.id
    where ae.member_id = p_member_id
      and ae.gym_id = p_gym_id
      and ae.checked_out_at is null
      and ae.voided_at is null
      and ae.checked_in_at + v_window > p_receipt_at
      and gs.consumed_at is not null
      and gs.voided_at is null
      and gs.validity_mode = 'single_use'
      and gs.covered_kind = 'visit'
    order by ae.checked_in_at desc
    limit 1;

    if found then
      return query select 'covered'::text, v_created_at, v_session_id;
      return;
    end if;
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

  if v_validity = 'single_use' and p_kind = 'class' then
    -- Its own session, covering nothing else: no covered_day, no covered_attendance_id.
    update guest_sessions
    set consumed_at = p_receipt_at, validity_mode = 'single_use', covered_kind = 'class', covered_booking_id = p_booking_id
    where id = v_session_id;
  elsif v_validity = 'single_use' then
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

revoke execute on function private.consume_guest_session(uuid, uuid, timestamptz, text, uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- private.audit_session_consumed: the 0177 body, plus covered_booking_id for a class row only (one new key, present only when set, so a day or
-- visit row's metadata is byte for byte what 0177 wrote; the rest unchanged).
-- ----------------------------------------------------------------------------
create or replace function private.audit_session_consumed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform log_audit_event(
    p_action_type => 'session_consumed',
    p_gym_id => new.gym_id,
    p_target_entity_id => new.member_id::text,
    p_target_entity_type => 'member',
    p_metadata => jsonb_build_object(
      'guest_session_id', new.id,
      'payment_id', new.payment_id,
      'covered_day', new.covered_day,
      'consumed_at', new.consumed_at,
      'source', case when new.payment_id is not null then 'paid' else 'free' end,
      'validity_mode', new.validity_mode,
      'covered_kind', new.covered_kind
    ) || case when new.covered_booking_id is not null then jsonb_build_object('covered_booking_id', new.covered_booking_id) else '{}'::jsonb end
  );
  return new;
end;
$$;

revoke execute on function private.audit_session_consumed() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- public.mark_class_attendance: the 0178 body. Changed: the consume call passes the booking id. Nothing else.
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
    from private.consume_guest_session(v_member_id, v_gym_id, now(), 'class', v_booking_id) c;

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
revoke execute on function public.mark_class_attendance(uuid) from public, anon;

-- ----------------------------------------------------------------------------
-- public.list_guest_sessions_paid: the 0114 body. Dropped and recreated: it gains five columns (covered_kind, covered_booking_id,
-- class_name, class_starts_at, gym_timezone: the Paid tab formats gym-local date and time from it), so the Paid tab can say what a consumed
-- session covered. SECURITY INVOKER as before: the guest_sessions,
-- class_bookings, class_sessions and classes staff SELECT policies (owner, manager, supervisor, receptionist) scope every join to the
-- caller's gym, and the gym filters below say so too. Everything else (filters, window aggregates, ordering) is unchanged.
-- ----------------------------------------------------------------------------
drop function public.list_guest_sessions_paid(text, boolean, boolean, integer, integer);

create function list_guest_sessions_paid(
  p_period text,
  p_refunded_after_use_only boolean default false,
  p_group_by_recorder boolean default true,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  payment_id uuid,
  member_id uuid,
  member_name text,
  amount integer,
  method text,
  created_at timestamptz,
  consumed_at timestamptz,
  refund_state text,
  recorder_id uuid,
  recorder_name text,
  recorder_kind text,
  group_sessions bigint,
  group_total bigint,
  total_count bigint,
  covered_kind text,
  covered_booking_id uuid,
  class_name text,
  class_starts_at timestamptz,
  gym_timezone text
)
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  select w.window_start, w.window_end into v_start, v_end from private.guest_sessions_period(p_period) w;

  if v_start is null then
    return;
  end if;

  return query
  with base as (
    select
      p.id as payment_id,
      p.member_id,
      m.name as member_name,
      p.amount,
      p.method::text as method,
      p.created_at,
      gs.consumed_at,
      case
        when gs.consumed_at is null and gs.voided_at is not null then 'refunded'
        when gs.consumed_at is not null
             and exists (select 1 from refunds r where r.payment_id = p.id) then 'refunded_after_use'
        else 'none'
      end as refund_state,
      case when staff.id is not null then p.actor_id end as recorder_id,
      staff.name as recorder_name,
      case
        when staff.id is not null then 'staff'
        when p.provider is not null then 'tara'
        else 'unknown'
      end as recorder_kind,
      gs.covered_kind,
      gs.covered_booking_id,
      cl.name as class_name,
      cs.scheduled_at as class_starts_at,
      (select g.timezone from gyms g where g.id = p.gym_id) as gym_timezone
    from payments p
    join members m on m.id = p.member_id
    left join guest_sessions gs on gs.payment_id = p.id and gs.gym_id = p.gym_id
    left join class_bookings cb on cb.id = gs.covered_booking_id and cb.gym_id = p.gym_id
    left join class_sessions cs on cs.id = cb.class_session_id and cs.gym_id = p.gym_id
    left join classes cl on cl.id = cs.class_id and cl.gym_id = p.gym_id
    left join lateral (
      select sm.id, sm.name
      from members sm
      where sm.user_id = p.actor_id
        and sm.gym_id = p.gym_id
        and sm.role in ('owner', 'supervisor', 'manager', 'receptionist', 'coach')
      order by (sm.deactivated_at is null) desc, sm.created_at desc
      limit 1
    ) staff on true
    where p.gym_id = private.gym_id()
      and p.purpose = 'session'
      and p.status = 'verified'
      and p.voided_at is null
      and p.created_at >= v_start
      and p.created_at <  v_end
  ),
  filtered as (
    select b.*
    from base b
    where not coalesce(p_refunded_after_use_only, false) or b.refund_state = 'refunded_after_use'
  ),
  keyed as (
    select
      f.*,
      case when coalesce(p_group_by_recorder, true)
           then coalesce(f.recorder_id::text, '~' || f.recorder_kind) end as group_key
    from filtered f
  )
  select
    k.payment_id, k.member_id, k.member_name, k.amount, k.method, k.created_at, k.consumed_at,
    k.refund_state, k.recorder_id, k.recorder_name, k.recorder_kind,
    case when k.group_key is not null then count(*) over (partition by k.group_key) end,
    case when k.group_key is not null then sum(k.amount) over (partition by k.group_key)::bigint end,
    count(*) over (),
    k.covered_kind, k.covered_booking_id, k.class_name, k.class_starts_at, k.gym_timezone
  from keyed k
  order by
    case when k.group_key is null then null else (k.recorder_kind <> 'staff') end nulls first,
    case when k.group_key is null then null else lower(coalesce(k.recorder_name, '')) end nulls first,
    k.group_key nulls first,
    k.created_at desc,
    k.payment_id
  limit v_limit offset v_offset;
end;
$$;

revoke execute on function list_guest_sessions_paid(text, boolean, boolean, integer, integer) from public, anon;
grant execute on function list_guest_sessions_paid(text, boolean, boolean, integer, integer) to authenticated;

-- ----------------------------------------------------------------------------
-- Verify: the shape of every change, the grants, and the only callers of the consume function.
-- ----------------------------------------------------------------------------
do $verify$
declare
  v_src text;
  v_oid oid;
begin
  if to_regprocedure('private.consume_guest_session(uuid, uuid, timestamptz, text)') is not null then
    raise exception '0179: the 4-argument consume function still exists (a 4-argument call would be ambiguous)';
  end if;
  if pg_get_function_result('private.consume_guest_session(uuid, uuid, timestamptz, text, uuid)'::regprocedure)
     is distinct from 'TABLE(outcome text, session_created_at timestamp with time zone, session_id uuid)' then
    raise exception '0179: the consume function changed its result columns';
  end if;
  select prosrc into v_src from pg_proc where oid = 'private.consume_guest_session(uuid, uuid, timestamptz, text, uuid)'::regprocedure;
  if position('class_single_use_unsupported' in v_src) > 0 or position('covered_booking_id' in v_src) = 0
     or position('''class''' in v_src) = 0 or position('covered_attendance_id' in v_src) = 0 or position('''whole_day''' in v_src) = 0 then
    raise exception '0179: the consume function kept its class guard or lost its class branch';
  end if;
  if exists (
    select 1 from pg_proc p
    where p.oid = 'private.consume_guest_session(uuid, uuid, timestamptz, text, uuid)'::regprocedure
      and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE')
           or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0))
  ) then
    raise exception '0179: the consume function must not be executable by public, anon or authenticated';
  end if;

  select prosrc into v_src from pg_proc where oid = 'public.mark_class_attendance(uuid)'::regprocedure;
  if v_src !~ 'consume_guest_session\(v_member_id, v_gym_id, now\(\), ''class'', v_booking_id\)'
     or v_src !~ 'current_gym_status\(\)\s+is\s+distinct\s+from\s+''active''' or position('attended_at is null' in v_src) = 0 then
    raise exception '0179: mark_class_attendance does not pass the booking id to the consume function or lost a guard';
  end if;
  if exists (
    select 1 from pg_proc p
    where p.oid = 'public.mark_class_attendance(uuid)'::regprocedure
      and (has_function_privilege('anon', p.oid, 'EXECUTE') or not has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  ) then
    raise exception '0179: mark_class_attendance must stay executable by authenticated and not by anon';
  end if;

  select prosrc into v_src from pg_proc where oid = 'private.audit_session_consumed()'::regprocedure;
  if position('covered_booking_id' in v_src) = 0 or position('validity_mode' in v_src) = 0 or position('covered_kind' in v_src) = 0 then
    raise exception '0179: audit_session_consumed lost a metadata key';
  end if;
  if not exists (
    select 1 from pg_trigger t
    where t.tgrelid = 'public.guest_sessions'::regclass and t.tgname = 'audit_session_consumed' and not t.tgisinternal
  ) then
    raise exception '0179: the audit_session_consumed trigger is gone';
  end if;

  v_oid := 'public.list_guest_sessions_paid(text, boolean, boolean, integer, integer)'::regprocedure::oid;
  if exists (
    select 1 from pg_proc p
    where p.oid = v_oid
      and (p.prosecdef
           or p.proacl is null
           or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
  ) then
    raise exception '0179: list_guest_sessions_paid must be SECURITY INVOKER with no PUBLIC EXECUTE';
  end if;
  if has_function_privilege('anon', v_oid, 'execute') or not has_function_privilege('authenticated', v_oid, 'execute') then
    raise exception '0179: list_guest_sessions_paid grants are wrong';
  end if;
  if (select prosrc like '%auth.jwt()%' from pg_proc where oid = v_oid) then
    raise exception '0179: role must come from private.current_member_role(), not the JWT';
  end if;
  if position('covered_kind text, covered_booking_id uuid, class_name text, class_starts_at timestamp with time zone'
              in pg_get_function_result(v_oid)) = 0 then
    raise exception '0179: list_guest_sessions_paid lost its new columns';
  end if;

  -- The only callers of the consume function.
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.prokind = 'f' and n.nspname in ('public', 'private')
      and p.prosrc ~* 'consume_guest_session\('
      and p.proname not in ('consume_guest_session', 'record_check_in', 'mark_class_attendance')
  ) then
    raise exception '0179: a function other than record_check_in and mark_class_attendance calls consume_guest_session';
  end if;
end;
$verify$;
