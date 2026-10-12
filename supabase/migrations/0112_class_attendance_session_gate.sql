-- ============================================================================
-- 0112: Class attendance consumes a session (Epic 19, Story 19.7).
--
-- At a gym that charges guests per session, mark_class_attendance() routes a
-- Pay-per-session member through private.consume_guest_session() (0111), so one
-- paid session covers the floor and every class for the gym-local day. The
-- consume / gate / attempt / alert / lock path is flag-gated: the flag is read
-- before any V1.6 call or lock and off skips all of it. Three changes apply to
-- EVERY gym regardless of the flag: the already-attended return, the
-- `attended_at is null` update guard, and the class_bookings grant closure.
--
--   session_attempts.class_session_id  nullable FK, lets the dashboard (19.9)
--                                      render "From class: [name]"
--   mark_class_attendance()            same signature, RETURNS class_bookings.
--                                      Already-attended booking: the stored row
--                                      comes back and nothing is consumed or
--                                      rewritten (also with the flag off).
--   class_bookings                     attended_at is no longer directly
--                                      writable by authenticated/service_role
--
-- Order when the flag is on: booking lookup, already-attended return,
-- expired/no-subscription alert (unchanged, null return), flag read, the
-- class_sessions row lock (FOR NO KEY UPDATE), the member lock (FOR NO KEY
-- UPDATE), consume_guest_session(member, gym, now()), then the update. Exempt,
-- covered and consumed set attended_at. Denied inserts a session_attempts row
-- (source 'class', fresh scan_id) and one active session_required alert, leaves
-- attended_at null, and does NOT raise, so the attempt and the alert commit.
-- It returns the booking row with attended_at null; every success sets it, so
-- null attended_at is the refusal signal (an old dashboard reads attended:
-- false and reverts its checkbox).
--
-- class_bookings direct-write closure. Writers found by grep at build time
-- (supabase/migrations, supabase/tests, supabase/functions, apps, packages):
--   * public.mark_class_attendance()       SECURITY DEFINER, owner postgres
--   * public.book_class_session()          SECURITY DEFINER, INSERT (no attended_at)
--   * public.cancel_class_booking()        SECURITY DEFINER, DELETE
--   * apps/dashboard/e2e/fixtures          service_role INSERT/DELETE, no
--                                          attended_at (still granted)
--   * apps/dashboard, apps/mobile          read-only (select only)
--   * supabase/functions/*                 none
--   * supabase/tests                       run as postgres (superuser); the
--     direct-UPDATE-as-authenticated assertions in
--     class_attendance_marking.negative.test.sql now expect permission denied.
-- INSERT and UPDATE move to column-level grants that omit attended_at; DELETE
-- and SELECT stay table-level. RLS (no write policy) is unchanged.
-- Rollback restores the 0058 table-level grant.
--
-- The copied mark_class_attendance() body keeps its auth.jwt() ->> 'app_role'
-- read (as in 0110), so this file is added to the app_role_reads grandfather
-- list.
--
-- Release gate: apply only after 0111 (docs/decisions.md runbook).
-- Rollback: scripts/rollback-0112-class-attendance-session-gate.sql.
-- ============================================================================

-- 1. session_attempts.class_session_id ------------------------------------------

alter table session_attempts
  add column class_session_id uuid references class_sessions(id) on delete set null;

create index idx_session_attempts_class_session_id
  on session_attempts (class_session_id)
  where class_session_id is not null;

-- 2. mark_class_attendance() ----------------------------------------------------
-- Live 0110 pg_get_functiondef with only the gated sections added.

create or replace function public.mark_class_attendance(p_booking_id uuid)
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
  if not ((auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'receptionist', 'supervisor'])) then
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
    from private.consume_guest_session(v_member_id, v_gym_id, now()) c;

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

revoke execute on function public.mark_class_attendance(uuid) from public, anon;

-- 3. Close direct writes of class_bookings.attended_at ---------------------------

revoke insert, update on class_bookings from authenticated, service_role;

grant insert (id, gym_id, class_session_id, member_id, created_at)
  on class_bookings to authenticated, service_role;
grant update (gym_id, class_session_id, member_id, created_at)
  on class_bookings to authenticated, service_role;

-- 4. Self-check -------------------------------------------------------------------

do $verify$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'session_attempts' and column_name = 'class_session_id'
  ) then
    raise exception '0112: session_attempts.class_session_id missing';
  end if;

  if position('consume_guest_session' in (
    select prosrc from pg_proc where oid = 'public.mark_class_attendance(uuid)'::regprocedure
  )) = 0 then
    raise exception '0112: mark_class_attendance() does not call consume_guest_session()';
  end if;

  if pg_get_function_result('public.mark_class_attendance(uuid)'::regprocedure) <> 'class_bookings' then
    raise exception '0112: mark_class_attendance() return type changed';
  end if;

  if has_column_privilege('authenticated', 'public.class_bookings', 'attended_at', 'UPDATE')
    or has_column_privilege('service_role', 'public.class_bookings', 'attended_at', 'UPDATE')
    or has_column_privilege('authenticated', 'public.class_bookings', 'attended_at', 'INSERT')
    or has_column_privilege('service_role', 'public.class_bookings', 'attended_at', 'INSERT')
  then
    raise exception '0112: class_bookings.attended_at still has a client write grant';
  end if;

  if not has_column_privilege('service_role', 'public.class_bookings', 'member_id', 'INSERT')
    or not has_table_privilege('service_role', 'public.class_bookings', 'DELETE')
    or not has_table_privilege('authenticated', 'public.class_bookings', 'SELECT')
  then
    raise exception '0112: class_bookings lost a grant it should keep';
  end if;
end;
$verify$;
