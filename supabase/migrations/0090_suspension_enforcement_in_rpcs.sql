-- Story 11.8: Suspension Enforcement Inside SECURITY DEFINER RPCs
--
-- Completes AD-3, which binds "every RLS policy AND every SECURITY DEFINER
-- function that gates on role or gym status". Story 11.4 (0073) shipped the
-- RLS half: `tenant_active_gate`, an AS RESTRICTIVE ... FOR ALL policy now on
-- 18 gym-scoped tables (the 17 from 0073 plus public.notifications, added by
-- 0084_notification_history.sql:54). This migration ships the function half.
--
-- WHY THIS IS NEEDED
-- RLS does not apply to a table's owner unless the table sets FORCE ROW LEVEL
-- SECURITY, and no table in this schema does (verified: zero occurrences; the
-- single grep hit in 0073 is a comment saying exactly this). SECURITY DEFINER
-- functions execute as the owner, so every write-RPC bypassed the gate. On a
-- fully suspended gym a member could still check in, book/cancel classes and
-- start a payment; staff could still renew subscriptions, create/edit classes,
-- assign coaches, write session notes and create/edit/deactivate staff. The
-- dashboard and mobile app hid these behind the suspended screen -- precisely
-- the "hidden by the UI" state NFR-018 rejects. Anything speaking to PostgREST
-- directly got straight through.
--
-- WHY NOT `FORCE ROW LEVEL SECURITY`
-- It would close all bypasses with one line per table, and is the tempting
-- shortcut. Rejected: it applies to EVERY SECURITY DEFINER function touching
-- those tables, including the recovery paths that must keep working while a
-- gym is suspended -- the Owner's "Pay Now" escape valve and notification-email
-- fix, the RPCs that un-suspend a gym, Super Admin escalation, the auth hook,
-- the multi-gym switcher, the service_role webhook completions, and above all
-- log_audit_event(), which writes the gated audit_log and is called by many of
-- those same recovery paths. Gating them turns a suspended gym into a
-- permanently unrecoverable one. It also changes behaviour for the table owner
-- schema-wide, a blast radius needing its own audit. Story 11.4's code review
-- reached the same conclusion. Per-function gating is what AD-3 mandates and is
-- surgical and reviewable.
--
-- THE GUARD, AND THE NULL TRAP
--   if private.current_gym_status() is distinct from 'active' then
--     raise exception '<fn>: gym % is not active', v_gym_id;
--   end if;
--
-- `is distinct from`, NEVER `<>`. private.current_gym_status() returns NULL for
-- a session with no gym_id claim (or a claim pointing at a gym row that no
-- longer exists). In an RLS USING clause a NULL is falsy and so fails CLOSED,
-- which is what 0073 relies on. Inside plpgsql the polarity inverts:
-- `NULL <> 'active'` evaluates to NULL, the `if` does not fire, and the
-- function proceeds to WRITE -- failing OPEN. `is distinct from` returns true
-- for NULL and fails closed. Verified empirically against this project's own
-- Postgres, not reasoned from the docs.
--
-- Allowed status is 'active' only: both 'suspended' and 'deactivated' are
-- blocked, and the `or private.is_super_admin()` escape in 0073's policy is
-- deliberately NOT mirrored here -- these RPCs are all caller-gym-scoped via
-- private.gym_id(), and a Super Admin acting on a gym does so through the
-- escalation RPCs on the exclusion list, not through these.
--
-- ERROR MESSAGE SHAPE
-- This codebase uses no SQLSTATE for authorization or business-rule raises; the
-- convention is `raise exception '<function_name>: <detail>', <arg>` and the app
-- layer keys on the message text. The `is not active` phrase is load-bearing:
-- mapSupabaseError()'s gym_suspended branch (packages/types/src/errors.ts) and
-- the pgTAP throws_like() assertions both match on it. Do not reword it.
--
-- SCOPE
-- The 18 functions below are every SECURITY DEFINER function that writes a
-- gated table AND scopes itself to the caller's own private.gym_id() claim.
-- Each is reproduced from its CURRENT definition (pg_get_functiondef against a
-- database at migration 0089), not from its original migration -- many were
-- redefined by later migrations and copying an older body would silently revert
-- those fixes. The guard is inserted after each function's existing role and
-- gym_id null checks and before any write. Two deliberate refinements from the
-- 2026-09-09 code review, both verified per-function rather than assumed:
--   * check_in() places the guard below its idempotent-replay short-circuit.
--     That block returns an already-committed row -- a pure read -- and its own
--     comment requires it to run before every guard below it. Placing the gate
--     above it broke replay confirmation during a suspension and caused
--     apps/mobile's offline queue to discard legitimate queued scans.
--   * create_staff_member(), deactivate_staff_member() and update_staff_role()
--     place the guard below their role-ceiling checks, not above. Above, an
--     unauthorized caller at a suspended gym learned the gym's status instead
--     of being told they lack authorization -- an error-precedence inversion
--     that let any member probe suspension state through a staff-only RPC.
-- In all 18 the guard still precedes every write; that is asserted mechanically
-- by assertion 2 of supabase/tests/suspension_rpc_coverage.test.sql.
--
-- NOT gated here, deliberately -- see the exclusion list in Story 11.8 Dev Notes
-- §C and the per-entry-commented array in
-- supabase/tests/suspension_rpc_coverage.test.sql, which is the guardrail that
-- keeps this audit from rotting as new RPCs are added. That array and the
-- v_must_not_gate array in this file's post-condition block carry the same 19
-- entries; they were 19 and 13 respectively until the 2026-09-09 code review.

CREATE OR REPLACE FUNCTION public.add_session_note(p_member_id uuid, p_note_text text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_gym_id uuid;
  v_coach_id uuid;
  v_assignment_id uuid;
  v_new_id uuid;
begin
  if not ((auth.jwt() ->> 'app_role') = 'coach') then
    raise exception 'permission denied';
  end if;

  v_caller_gym_id := private.gym_id();
  if v_caller_gym_id is null then
    raise exception 'permission denied';
  end if;

  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'add_session_note: gym % is not active', v_caller_gym_id;
  end if;

  if p_note_text is null or btrim(p_note_text) = '' then
    raise exception 'add_session_note: note text is required';
  end if;

  select id into v_coach_id
  from members
  where user_id = auth.uid() and gym_id = v_caller_gym_id and role = 'coach';

  if v_coach_id is null then
    raise exception 'add_session_note: caller is not a coach in this gym';
  end if;

  select id into v_assignment_id
  from coach_assignments
  where member_id = p_member_id and coach_id = v_coach_id and ended_at is null;

  if v_assignment_id is null then
    raise exception 'add_session_note: member % is not currently assigned to caller', p_member_id;
  end if;

  insert into session_notes (gym_id, member_id, coach_id, coach_assignment_id, note_text)
  values (v_caller_gym_id, p_member_id, v_coach_id, v_assignment_id, btrim(p_note_text))
  returning id into v_new_id;

  return v_new_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.assign_coach(p_member_id uuid, p_coach_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_gym_id uuid;
  v_member_gym_id uuid;
  v_coach_gym_id uuid;
  v_previous_coach_id uuid;
  v_new_id uuid;
begin
  if not ((auth.jwt() ->> 'app_role') = any(array['owner', 'manager'])) then
    raise exception 'permission denied';
  end if;

  v_caller_gym_id := private.gym_id();
  if v_caller_gym_id is null then
    raise exception 'permission denied';
  end if;

  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'assign_coach: gym % is not active', v_caller_gym_id;
  end if;

  -- Folds "wrong gym" and "not actually a member" into one not-found
  -- outcome, same principle as renew_subscription's member lookup.
  select gym_id into v_member_gym_id
  from members
  where id = p_member_id and gym_id = v_caller_gym_id and role = 'member';

  if v_member_gym_id is null then
    raise exception 'assign_coach: member % not found', p_member_id;
  end if;

  -- Folds "wrong gym" and "not actually a coach" into one not-found
  -- outcome for the same reason.
  select gym_id into v_coach_gym_id
  from members
  where id = p_coach_id and gym_id = v_caller_gym_id and role = 'coach';

  if v_coach_gym_id is null then
    raise exception 'assign_coach: coach % not found', p_coach_id;
  end if;

  -- AC #2: end the prior active assignment (ended_at, not deleted) before
  -- starting the new one -- the partial unique index above would reject
  -- a second concurrently-active row for this member anyway, but this
  -- makes the "end-then-start" ordering explicit and atomic within this
  -- one function call.
  update coach_assignments
  set ended_at = now()
  where member_id = p_member_id and ended_at is null
  returning coach_id into v_previous_coach_id;

  insert into coach_assignments (gym_id, member_id, coach_id, started_at)
  values (v_member_gym_id, p_member_id, p_coach_id, now())
  returning id into v_new_id;

  perform log_audit_event(
    p_action_type => case when v_previous_coach_id is null then 'coach_assigned' else 'coach_reassigned' end,
    p_gym_id => v_member_gym_id,
    p_target_entity_id => p_member_id::text,
    p_target_entity_type => 'member',
    p_metadata => jsonb_build_object(
      'coach_id', p_coach_id,
      'previous_coach_id', v_previous_coach_id,
      'assignment_id', v_new_id
    )
  );

  return v_new_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.book_class_session(p_class_session_id uuid)
 RETURNS class_bookings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid;
  v_member_id uuid;
  v_deactivated_at timestamptz;
  v_sub_status subscription_status;
  v_scheduled_at timestamptz;
  v_capacity integer;
  v_count integer;
  v_row class_bookings;
begin
  if not ((auth.jwt() ->> 'app_role') = 'member') then
    raise exception 'book_class_session: caller is not a member';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'book_class_session: caller is not a member';
  end if;

  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'book_class_session: gym % is not active', v_gym_id;
  end if;

  -- order by deactivated_at nulls first: idx_members_active_gym_user (0003)
  -- only guarantees uniqueness among *active* rows, so if a deactivated
  -- historical row for this user/gym ever coexists with an active one,
  -- prefer the active row rather than letting an arbitrary pick reject a
  -- legitimately active member below.
  select id, deactivated_at into v_member_id, v_deactivated_at
  from members
  where user_id = auth.uid() and gym_id = v_gym_id
  order by deactivated_at nulls first
  limit 1;

  if v_member_id is null then
    raise exception 'book_class_session: no member record found for the caller';
  end if;

  -- Defense in depth, mirroring check_in()'s own deactivated_at guard: this
  -- RPC is reachable by any holder of a valid session token, not just
  -- through the app's own navigation gate.
  if v_deactivated_at is not null then
    raise exception 'book_class_session: member is deactivated';
  end if;

  -- Subscription eligibility (AC #1) -- mirrors check_in()'s broader
  -- null/expired-only rejection, not a strict status = 'active' filter. See
  -- the story's Dev Notes "Subscription Eligibility" for the reasoning --
  -- this is a judgment call, flagged in docs/decisions.md.
  select status into v_sub_status
  from subscriptions
  where member_id = v_member_id
  order by created_at desc
  limit 1;

  if v_sub_status is null or v_sub_status = 'expired' then
    raise exception 'book_class_session: member has no active subscription';
  end if;

  -- Row-locked capacity check (AC #2, AD-21): locks the contested row (the
  -- session), matching check_in()'s lock-the-contested-row shape exactly.
  -- Uniform not-found failure covers nonexistent id and cross-gym id
  -- identically, matching this schema's uniform-deny-all-failure
  -- convention.
  select cs.scheduled_at, c.capacity into v_scheduled_at, v_capacity
  from class_sessions cs
  join classes c on c.id = cs.class_id
  where cs.id = p_class_session_id and cs.gym_id = v_gym_id
  for update of cs;

  if v_scheduled_at is null then
    raise exception 'book_class_session: session % not found', p_class_session_id;
  end if;

  if v_scheduled_at <= now() then
    raise exception 'book_class_session: cannot book a session that has already started or passed';
  end if;

  -- Duplicate-booking pre-check (friendly error, unique index is the
  -- concurrency backstop -- same dual-layer pattern check_in()'s
  -- open-session check plays against its own unique index). Checked before
  -- the capacity count below: the member's own existing booking already
  -- counts toward v_count, so checking capacity first would surface "class
  -- is full" instead of "already booked" for a member re-attempting to book
  -- a session they hold the last spot in.
  if exists (select 1 from class_bookings where class_session_id = p_class_session_id and member_id = v_member_id) then
    raise exception 'book_class_session: member already booked this session';
  end if;

  select count(*) into v_count from class_bookings where class_session_id = p_class_session_id;

  if v_count >= v_capacity then
    raise exception 'book_class_session: class is full';
  end if;

  insert into class_bookings (gym_id, class_session_id, member_id)
  values (v_gym_id, p_class_session_id, v_member_id)
  returning * into v_row;

  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.cancel_class_booking(p_booking_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid;
  v_member_id uuid;
  v_deactivated_at timestamptz;
  v_found_id uuid;
  v_scheduled_at timestamptz;
  v_cutoff_minutes integer;
begin
  if not ((auth.jwt() ->> 'app_role') = 'member') then
    raise exception 'cancel_class_booking: caller is not a member';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'cancel_class_booking: caller is not a member';
  end if;

  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'cancel_class_booking: gym % is not active', v_gym_id;
  end if;

  -- order by deactivated_at nulls first: idx_members_active_gym_user (0003)
  -- only guarantees uniqueness among *active* rows, so if a deactivated
  -- historical row for this user/gym ever coexists with an active one,
  -- prefer the active row rather than letting an arbitrary pick reject a
  -- legitimately active member below.
  select id, deactivated_at into v_member_id, v_deactivated_at
  from members
  where user_id = auth.uid() and gym_id = v_gym_id
  order by deactivated_at nulls first
  limit 1;

  if v_member_id is null then
    raise exception 'cancel_class_booking: no member record found for the caller';
  end if;

  if v_deactivated_at is not null then
    raise exception 'cancel_class_booking: member is deactivated';
  end if;

  -- Gym- and member-scoped lookup, joined to its session's scheduled_at.
  -- This one query collapses "doesn't exist," "someone else's booking," and
  -- "wrong gym" into the same generic message -- deliberately matching
  -- updateClass's (Story 12.1) already-accepted not-found convention, not a
  -- new gap.
  select cb.id, cs.scheduled_at into v_found_id, v_scheduled_at
  from class_bookings cb
  join class_sessions cs on cs.id = cb.class_session_id
  where cb.id = p_booking_id and cb.gym_id = v_gym_id and cb.member_id = v_member_id;

  if v_found_id is null then
    raise exception 'cancel_class_booking: booking % not found', p_booking_id;
  end if;

  select class_booking_cancellation_cutoff_minutes into v_cutoff_minutes
  from gyms
  where id = v_gym_id;

  if now() >= v_scheduled_at - make_interval(mins => v_cutoff_minutes) then
    raise exception 'cancel_class_booking: cancellation cutoff has passed';
  end if;

  -- No row lock needed here (unlike booking): freeing a spot has no
  -- capacity race to guard against; a duplicate cancel attempt on an
  -- already-deleted row simply re-hits the not-found branch above.
  delete from class_bookings where id = v_found_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.check_in(p_scanned_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_client_scan_id uuid DEFAULT NULL::uuid)
 RETURNS attendance_events
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid;
  v_member_id uuid;
  v_deactivated_at timestamptz;
  v_status subscription_status;
  v_expiry_date date;
  v_timeout_hours integer;
  v_open_id uuid;
  v_open_checked_in_at timestamptz;
  v_checked_in_at timestamptz;
  v_row attendance_events;
begin
  if not ((auth.jwt() ->> 'app_role') = 'member') then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  -- order by deactivated_at nulls first: idx_members_active_gym_user (0003)
  -- only guarantees uniqueness among *active* rows, so if a deactivated
  -- historical row for this user/gym ever coexists with an active one,
  -- prefer the active row rather than letting an arbitrary pick reject a
  -- legitimately active member below.
  select id, deactivated_at into v_member_id, v_deactivated_at
  from members
  where user_id = auth.uid() and gym_id = v_gym_id
  order by deactivated_at nulls first
  limit 1;

  if v_member_id is null then
    raise exception 'check_in: no member record found for the caller';
  end if;

  -- Idempotent-replay short-circuit (Story 3.9 Scope Note #3). Must run
  -- immediately after v_member_id is resolved and before every guard/lock
  -- below -- if a sync retry (app killed after the server insert but before
  -- the local queue delete) reached the open-session lock block first, it
  -- would see ITS OWN prior successful insert as a blocking "already open"
  -- session and reject the replay with 'already has an open check-in'
  -- permanently, since retrying can never resolve a block caused by the
  -- retry's own earlier success. Short-circuiting here, before that block
  -- ever runs, avoids the trap entirely. The member_id match is a
  -- defense-in-depth ownership check (client_scan_id is a client-generated
  -- random UUID scoped to one member's one scan; this just guarantees a
  -- SECURITY DEFINER function can never hand back a different member's row
  -- even in a contrived collision).
  if p_client_scan_id is not null then
    select * into v_row from attendance_events
    where client_scan_id = p_client_scan_id and member_id = v_member_id;
    if v_row.id is not null then
      return v_row;
    end if;
  end if;

  -- Story 11.8: suspension gate, placed deliberately BELOW the replay
  -- short-circuit above and above every write below. Code review 2026-09-09:
  -- the guard originally sat before the member lookup, which put it ahead of
  -- the short-circuit and re-opened the exact trap that block exists to
  -- prevent -- a sync retry whose own earlier insert succeeded could never be
  -- confirmed, and apps/mobile's offline queue deleted the record as
  -- unrecoverable. Returning an already-committed row is a pure read, so
  -- AC #1's "raises and writes nothing" is not weakened by this placement.
  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'check_in: gym % is not active', v_gym_id;
  end if;

  -- Defense in depth, mirroring renew_subscription()'s deactivated_at guard
  -- (0022): the mobile root-layout session gate (use-session.ts) already
  -- excludes deactivated members from ever reaching this screen in the app
  -- UI, but this function is reachable by any holder of a valid session
  -- token, not just through the app's own navigation gate.
  if v_deactivated_at is not null then
    raise exception 'check_in: member is deactivated';
  end if;

  -- Story 3.8 AC #3 / FR-031: reject expired (and no-subscription) members
  -- before doing any locking work below.
  select status, expiry_date into v_status, v_expiry_date
  from subscriptions
  where member_id = v_member_id
  order by created_at desc
  limit 1;

  if v_status is null or v_status = 'expired' then
    -- Story 4.6 AC #2 / FR-031: fire a red front-desk alert for the denied
    -- check-in instead of raising -- a null v_status (zero subscription
    -- rows, the "no plan" defensive case from 0027's own comment) maps to
    -- alert status 'expired', matching the existing "treated identically to
    -- expired" precedent.
    -- on conflict: idx_front_desk_alerts_one_active_per_member_status
    -- (Review finding) -- a member who scans repeatedly while still
    -- expired gets one standing alert, not a fresh row per scan.
    insert into front_desk_alerts (gym_id, member_id, status, expiry_date)
    values (v_gym_id, v_member_id, 'expired', v_expiry_date)
    on conflict (member_id, status) where dismissed_at is null do nothing;
    return null;
  end if;

  select checkin_timeout_hours into v_timeout_hours from gyms where id = v_gym_id;

  -- for update: without this lock, two concurrent check_in() calls hitting
  -- the stale branch below could both read the same open row before either
  -- writes it, each auto-closing it and each calling log_audit_event() --
  -- duplicate audit rows for one auto-close. Locking here makes the second
  -- transaction block until the first commits, then re-evaluate the where
  -- clause against the now-closed row, correctly falling through to the
  -- unique-index rejection instead of double-processing it.
  select id, checked_in_at into v_open_id, v_open_checked_in_at
  from attendance_events
  where member_id = v_member_id and checked_out_at is null
  order by checked_in_at desc
  limit 1
  for update;

  if v_open_id is not null then
    if v_open_checked_in_at + make_interval(hours => v_timeout_hours) <= now() then
      -- Stale: auto-close it (AC #3) before recording the new check-in.
      update attendance_events
      set checked_out_at = v_open_checked_in_at + make_interval(hours => v_timeout_hours),
          checkout_type = 'auto'
      where id = v_open_id;

      perform log_audit_event(
        p_action_type => 'attendance_stale_check_in_auto_closed',
        p_gym_id => v_gym_id,
        p_target_entity_id => v_open_id::text,
        p_target_entity_type => 'attendance_event',
        p_metadata => jsonb_build_object(
          'member_id', v_member_id,
          'original_checked_in_at', v_open_checked_in_at,
          'auto_closed_checked_out_at', v_open_checked_in_at + make_interval(hours => v_timeout_hours),
          'timeout_hours', v_timeout_hours
        )
      );
    else
      -- Not stale: AC #2's rejection. The partial unique index above is the
      -- concurrent-request backstop for this same outcome, not the primary
      -- path -- this pre-check is what makes the common case a clean,
      -- specific error message rather than a raw constraint-violation string.
      raise exception 'check_in: member % already has an open check-in', v_member_id;
    end if;
  end if;

  -- Clamp a future-dated client scan (clock skew) to now(); Story 3.9 Scope
  -- Note #2 -- checked_in_at must be the true scan time (arithmetic in the
  -- offline-immediate-stale-close block below only works against the real
  -- scan moment), a corrupted future-dated row from a wrong device clock is
  -- worse than silently treating it as "now".
  v_checked_in_at := coalesce(p_scanned_at, now());
  if v_checked_in_at > now() then
    v_checked_in_at := now();
  end if;

  insert into attendance_events (gym_id, member_id, checked_in_at, client_scan_id)
  values (v_gym_id, v_member_id, v_checked_in_at, p_client_scan_id)
  returning * into v_row;
  -- No ON CONFLICT needed -- the short-circuit above already handles the
  -- ordinary replay case. The partial unique index on client_scan_id still
  -- stands as a backstop against a true concurrency race (two simultaneous
  -- sync attempts for the same queued record); a 23505 in that narrow window
  -- surfaces as an ordinary RPC error, which the client's sync loop already
  -- treats as "leave queued, retry later" -- the next retry resolves cleanly
  -- via the short-circuit.

  -- Story 4.6 AC #1: fire a yellow front-desk alert for an accepted
  -- at-risk check-in, immediately after the attendance_events insert above
  -- succeeds -- not earlier. This ordering matters: an at-risk member who
  -- already has a non-stale open check-in is rejected by the `raise
  -- exception` in the open-session lock block further up, well before this
  -- line -- so this insert is simply never reached for that case, rather
  -- than being inserted and then silently rolled back by that later,
  -- unrelated exception.
  if v_status in ('expiring_soon', 'grace_period') then
    -- on conflict: same dedup guard as the expired branch above.
    insert into front_desk_alerts (gym_id, member_id, status, expiry_date)
    values (v_gym_id, v_member_id, v_status, v_expiry_date)
    on conflict (member_id, status) where dismissed_at is null do nothing;
  end if;

  -- Offline-sync immediate-stale case (AC #2): only reachable for a freshly
  -- inserted row -- the replay path above already returned earlier.
  if p_scanned_at is not null and v_checked_in_at + make_interval(hours => v_timeout_hours) <= now() then
    update attendance_events
    set checked_out_at = v_checked_in_at + make_interval(hours => v_timeout_hours),
        checkout_type = 'auto'
    where id = v_row.id
    returning * into v_row;

    perform log_audit_event(
      p_action_type => 'attendance_stale_check_in_auto_closed',
      p_gym_id => v_gym_id,
      p_target_entity_id => v_row.id::text,
      p_target_entity_type => 'attendance_event',
      p_metadata => jsonb_build_object(
        'member_id', v_member_id,
        'original_checked_in_at', v_checked_in_at,
        'auto_closed_checked_out_at', v_row.checked_out_at,
        'timeout_hours', v_timeout_hours,
        'source', 'offline_sync'
      )
    );
  end if;

  return v_row;
end;
$function$
;

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
  if not ((auth.jwt() ->> 'app_role') = 'member') then
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
$function$
;

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
  if not ((auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'receptionist'])) then
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
$function$
;

CREATE OR REPLACE FUNCTION public.confirm_renewal(p_member_id uuid, p_method text, p_reason text, p_backdate boolean DEFAULT false, OUT payment_id uuid, OUT subscription_id uuid, OUT amount integer, OUT currency text, OUT new_expiry_date date)
 RETURNS record
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_gym_id uuid;
  v_actor_id uuid;
  v_member_gym_id uuid;
  v_deactivated_at timestamptz;
  v_plan_id uuid;
  v_duration_days integer;
  v_current_status subscription_status;
  v_current_expiry_date date;
  v_start_date date;
begin
  if not ((auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'receptionist'])) then
    raise exception 'permission denied';
  end if;

  v_caller_gym_id := private.gym_id();
  if v_caller_gym_id is null then
    raise exception 'permission denied';
  end if;

  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'confirm_renewal: gym % is not active', v_caller_gym_id;
  end if;
  v_actor_id := auth.uid();

  select gym_id, deactivated_at into v_member_gym_id, v_deactivated_at
  from members where id = p_member_id and gym_id = v_caller_gym_id;

  if v_member_gym_id is null then
    raise exception 'confirm_renewal: member % not found', p_member_id;
  end if;

  if v_deactivated_at is not null then
    raise exception 'confirm_renewal: member % is deactivated and cannot be renewed', p_member_id;
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'confirm_renewal: reason is required';
  end if;

  select s.plan_id, s.status, s.expiry_date
    into v_plan_id, v_current_status, v_current_expiry_date
  from subscriptions s
  where s.member_id = p_member_id
  order by s.created_at desc, s.id desc
  limit 1;

  if v_plan_id is null then
    raise exception 'confirm_renewal: member % has no existing subscription to renew', p_member_id;
  end if;

  if p_backdate then
    if v_current_status not in ('grace_period', 'expired') then
      raise exception 'confirm_renewal: back-dating is only available for grace_period or expired subscriptions';
    end if;
    if v_current_expiry_date is null then
      raise exception 'confirm_renewal: cannot back-date a subscription with no expiry date';
    end if;
    v_start_date := v_current_expiry_date;
  else
    v_start_date := current_date;
  end if;

  select duration_days, price, plans.currency into v_duration_days, amount, currency
  from plans where id = v_plan_id;

  -- Review finding: back-dating a member expired longer than one plan cycle
  -- (e.g. expired 100 days ago on a 30-day plan) would otherwise insert a
  -- new subscription already marked 'active' with an expiry_date already in
  -- the past. Reject rather than silently produce an already-expired
  -- "active" row -- consistent with this block's other eligibility guards.
  if p_backdate and v_duration_days is not null and (v_start_date + v_duration_days) < current_date then
    raise exception 'confirm_renewal: back-dated renewal would still be expired';
  end if;

  new_expiry_date := case when v_duration_days is null then null else v_start_date + v_duration_days end;

  insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
  values (v_member_gym_id, p_member_id, v_plan_id, 'active', v_start_date, new_expiry_date)
  returning id into subscription_id;

  insert into payments (gym_id, member_id, subscription_id, amount, currency, method, status, actor_id, reason)
  values (v_member_gym_id, p_member_id, subscription_id, amount, currency, p_method, 'verified', v_actor_id, p_reason)
  returning id into payment_id;

  perform log_audit_event(
    p_action_type => 'renewal_confirmed',
    p_gym_id => v_member_gym_id,
    p_target_entity_id => p_member_id::text,
    p_target_entity_type => 'member',
    p_metadata => jsonb_build_object(
      'reason', p_reason, 'method', p_method, 'amount', amount, 'currency', currency,
      'payment_id', payment_id, 'subscription_id', subscription_id, 'plan_id', v_plan_id,
      'new_expiry_date', new_expiry_date, 'start_date', v_start_date, 'backdated', p_backdate
    )
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_class(p_name text, p_description text, p_coach_id uuid, p_capacity integer, p_schedule_type text, p_one_off_session_at timestamp with time zone, p_recurrence_days smallint[], p_recurrence_time time without time zone, p_recurrence_start_date date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid;
  v_class_id uuid;
begin
  if not ((auth.jwt() ->> 'app_role') = any(array['manager', 'owner'])) then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'create_class: gym % is not active', v_gym_id;
  end if;

  insert into classes (
    gym_id, name, description, coach_id, capacity, schedule_type,
    one_off_session_at, recurrence_days, recurrence_time, recurrence_start_date
  ) values (
    v_gym_id, p_name, p_description, p_coach_id, p_capacity, p_schedule_type,
    p_one_off_session_at, p_recurrence_days, p_recurrence_time, p_recurrence_start_date
  )
  returning id into v_class_id;

  perform private.materialize_sessions_for_class(v_class_id);

  return v_class_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_staff_member(p_user_id uuid, p_name text, p_phone text, p_role member_role)
 RETURNS members
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid;
  v_caller_role member_role;
  v_existing members;
  v_row members;
begin
  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'create_staff_member: caller has no gym-scoped session';
  end if;

  v_caller_role := private.current_member_role();

  if v_caller_role = 'owner' then
    if p_role not in ('supervisor', 'manager', 'receptionist', 'coach') then
      raise exception 'create_staff_member: caller is not authorized to create staff with role %', p_role;
    end if;
  elsif v_caller_role = 'supervisor' then
    if p_role not in ('manager', 'receptionist', 'coach') then
      raise exception 'create_staff_member: caller is not authorized to create staff with role %', p_role;
    end if;
  else
    raise exception 'create_staff_member: caller is not authorized to create staff';
  end if;

  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'create_staff_member: gym % is not active', v_gym_id;
  end if;

  -- Story 9.4 (AC #1/#2): does `p_user_id` already have an *active* binding
  -- at this caller's own gym? Deliberately no `role` filter -- this matches
  -- `idx_members_active_gym_user` (0003_members_and_users.sql:39), the
  -- unique index this whole story is built around, which is itself
  -- role-agnostic. Matching a `role = 'member'` row here is intentional:
  -- it's what makes "promote an existing gym member to staff" fall through
  -- to the same replace-in-place branch as a staff-to-staff role change,
  -- closing the exact gap deferred-work.md's story-9-1 entry flagged.
  select *
  into v_existing
  from members
  where gym_id = v_gym_id
    and user_id = p_user_id
    and deactivated_at is null;

  if v_existing.id is not null then
    -- New self-targeting path (Story 9.4): before this story, this RPC
    -- could never legitimately target the caller's own row (there was no
    -- lookup-and-replace branch at all). An Owner/Supervisor typing their
    -- own phone number into the Add Staff form now resolves to their own
    -- `user_id`, finds their own active binding, and would otherwise
    -- silently rewrite their own name/role. Mirrors
    -- `update_staff_role()`'s self-edit block (0063:88-90) in spirit, but
    -- simpler -- no name-only carve-out, since there is no meaningful
    -- reason to "re-add yourself" through this specific form.
    if v_existing.user_id = auth.uid() then
      raise exception 'create_staff_member: cannot replace your own binding';
    end if;

    -- Target-role ceiling (security fix found while writing this story's own
    -- pgTAP suite -- see docs/decisions.md): the ceiling check above only
    -- constrains p_role (the *new* role being assigned), not the *existing*
    -- row's current role. Without this guard, a Supervisor could target an
    -- Owner's or another Supervisor's own active binding at this gym and
    -- replace it with e.g. 'manager', demoting them -- p_role = 'manager' is
    -- within the Supervisor's own allowlist, so the check above alone would
    -- let it through. Mirrors `deactivate_staff_member()`'s existing
    -- target-role ceiling shape (0063:234-240): Owner may replace any
    -- non-owner target; Supervisor may replace Manager/Receptionist/Coach/
    -- Member targets only, never Owner or another Supervisor.
    if v_existing.role = 'owner' then
      raise exception 'create_staff_member: caller is not authorized to replace a staff member with role %', v_existing.role;
    end if;
    if v_caller_role = 'supervisor' and v_existing.role = 'supervisor' then
      raise exception 'create_staff_member: caller is not authorized to replace a staff member with role %', v_existing.role;
    end if;

    -- AC #2: replace the existing binding in place, not a second row.
    -- Includes phone -- p_phone is the identity phone that resolved
    -- p_user_id in the first place, but v_existing.phone (this gym's own
    -- denormalized snapshot from whenever this row was originally created)
    -- can have drifted from it since, so refresh it here too (review finding).
    update members
    set name = p_name, role = p_role, phone = p_phone
    where id = v_existing.id
    returning * into v_row;

    -- Reuses update_staff_role()'s own 'staff_role_updated' action type
    -- (0063) for the identical underlying fact (a members row's role/name
    -- changed) rather than inventing a new audit action type -- see story
    -- Dev Notes "Reusing staff_role_updated, Not a New Audit Action Type".
    perform log_audit_event(
      p_action_type => 'staff_role_updated',
      p_gym_id => v_gym_id,
      p_target_entity_id => v_row.id::text,
      p_target_entity_type => 'member',
      p_metadata => jsonb_build_object(
        'previous_role', v_existing.role,
        'new_role', p_role,
        'previous_name', v_existing.name,
        'new_name', p_name,
        'replaced_via', 'create_staff_member'
      )
    );

    return v_row;
  end if;

  -- No active binding at this gym for this user -- AC #1's cross-gym case
  -- (a brand-new binding for a person already bound at a different gym)
  -- and the genuinely-new-person case both fall through here, unchanged
  -- from 0061's original behavior.
  insert into members (gym_id, user_id, role, name, phone)
  values (v_gym_id, p_user_id, p_role, p_name, p_phone)
  returning * into v_row;

  perform log_audit_event(
    p_action_type => 'staff_created',
    p_gym_id => v_gym_id,
    p_target_entity_id => v_row.id::text,
    p_target_entity_type => 'member',
    p_metadata => jsonb_build_object('target_role', p_role, 'target_name', p_name)
  );

  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.deactivate_staff_member(p_member_id uuid, p_reason text)
 RETURNS members
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid;
  v_caller_role member_role;
  v_target members;
  v_row members;
begin
  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'deactivate_staff_member: caller has no gym-scoped session';
  end if;

  if p_reason is null or trim(p_reason) = '' then
    raise exception 'deactivate_staff_member: reason is required';
  end if;

  v_caller_role := private.current_member_role();
  if v_caller_role is distinct from 'owner' and v_caller_role is distinct from 'supervisor' then
    raise exception 'deactivate_staff_member: caller is not authorized to deactivate staff';
  end if;

  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'deactivate_staff_member: gym % is not active', v_gym_id;
  end if;

  select *
  into v_target
  from members
  where id = p_member_id
    and gym_id = v_gym_id
    and role != 'member'
    and deactivated_at is null;

  if not found then
    raise exception 'deactivate_staff_member: target not found or not eligible';
  end if;

  if v_target.user_id = auth.uid() then
    raise exception 'deactivate_staff_member: cannot deactivate your own account';
  end if;

  -- Code review fix: the Dev Notes/docs/decisions.md ceiling contract reads
  -- "Owner may deactivate any non-owner staff role... never Owner", but only
  -- the Supervisor branch below actually enforced a target restriction --
  -- an Owner caller had no explicit guard blocking an Owner target. Currently
  -- unreachable (no RPC can ever assign 'owner' to a second member), but
  -- closed explicitly for defense-in-depth and to match the documented
  -- contract, mirroring the analogous gap already flagged in
  -- staff_account_for_reset() (0062:71-73).
  if v_target.role = 'owner' then
    raise exception 'deactivate_staff_member: caller is not authorized to deactivate role %', v_target.role;
  end if;

  if v_caller_role = 'supervisor' and v_target.role = 'supervisor' then
    raise exception 'deactivate_staff_member: caller is not authorized to deactivate role %', v_target.role;
  end if;

  update members
  set deactivated_at = now()
  where id = p_member_id
  returning * into v_row;

  perform log_audit_event(
    p_action_type => 'staff_deactivated',
    p_gym_id => v_gym_id,
    p_target_entity_id => v_row.id::text,
    p_target_entity_type => 'member',
    p_metadata => jsonb_build_object(
      'target_name', v_target.name,
      'target_role', v_target.role,
      'reason', p_reason
    )
  );

  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.edit_session_note(p_note_id uuid, p_note_text text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_gym_id uuid;
  v_coach_id uuid;
  v_member_id uuid;
  v_updated_id uuid;
begin
  if not ((auth.jwt() ->> 'app_role') = 'coach') then
    raise exception 'permission denied';
  end if;

  v_caller_gym_id := private.gym_id();
  if v_caller_gym_id is null then
    raise exception 'permission denied';
  end if;

  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'edit_session_note: gym % is not active', v_caller_gym_id;
  end if;

  if p_note_text is null or btrim(p_note_text) = '' then
    raise exception 'edit_session_note: note text is required';
  end if;

  select id into v_coach_id
  from members
  where user_id = auth.uid() and gym_id = v_caller_gym_id and role = 'coach';

  if v_coach_id is null then
    raise exception 'edit_session_note: caller is not a coach in this gym';
  end if;

  select member_id into v_member_id
  from session_notes
  where id = p_note_id and gym_id = v_caller_gym_id and coach_id = v_coach_id;

  if v_member_id is null or not private.is_assigned_coach(v_member_id) then
    raise exception 'edit_session_note: note % not found or not owned by caller', p_note_id;
  end if;

  update session_notes
  set note_text = btrim(p_note_text), edited_at = now()
  where id = p_note_id and gym_id = v_caller_gym_id and coach_id = v_coach_id
  returning id into v_updated_id;

  if v_updated_id is null then
    raise exception 'edit_session_note: note % not found or not owned by caller', p_note_id;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.initiate_member_payment()
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid;
  v_member_id uuid;
  v_deactivated_at timestamptz;
  v_subscription_status text;
  v_plan_price integer;
  v_plan_currency text;
  v_provider_key text;
  v_payment_id uuid;
begin
  if not ((auth.jwt() ->> 'app_role') = 'member') then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'initiate_member_payment: gym % is not active', v_gym_id;
  end if;

  -- order by deactivated_at nulls first: same idx_members_active_gym_user
  -- (0003) uniqueness caveat check_in() already documents -- prefer an
  -- active row over a deactivated historical one if both somehow coexist.
  select id, deactivated_at into v_member_id, v_deactivated_at
  from members
  where user_id = auth.uid() and gym_id = v_gym_id
  order by deactivated_at nulls first
  limit 1;

  if v_member_id is null then
    raise exception 'initiate_member_payment: no member record found for the caller';
  end if;

  if v_deactivated_at is not null then
    raise exception 'initiate_member_payment: member is deactivated';
  end if;

  -- Review finding: without this, a double-tap, a retry after a client-side
  -- failure, or two devices on the same account could each create their own
  -- `processing` row and fire a second real USSD prompt -- the one-open-
  -- payment-at-a-time analogue of check_in()'s one-open-session enforcement
  -- this function otherwise mirrors.
  if exists (
    select 1 from payments where member_id = v_member_id and status = 'processing'
  ) then
    raise exception 'initiate_member_payment: payment_already_pending for member %', v_member_id;
  end if;

  -- Mirrors apps/dashboard/services/payments.ts's initiatePayment() join
  -- exactly: subscriptions -> plans is a many-to-one FK, so a plain join
  -- (not an array) is correct here. Most-recent-by-created_at, same
  -- "renewal resolves to the new row" precedent as check_in()'s own
  -- subscription-status guard.
  select s.status, p.price, p.currency into v_subscription_status, v_plan_price, v_plan_currency
  from subscriptions s
  join plans p on p.id = s.plan_id
  where s.gym_id = v_gym_id and s.member_id = v_member_id
  order by s.created_at desc
  limit 1;

  if v_plan_price is null then
    raise exception 'initiate_member_payment: no_active_plan for member %', v_member_id;
  end if;

  -- Review finding: the Home CTA only *offers* Renew for expiring_soon/
  -- grace_period/expired -- without this check, any member session could
  -- call this RPC directly (bypassing the UI) and self-initiate a charge
  -- while their subscription is still fully active.
  if v_subscription_status not in ('expiring_soon', 'grace_period', 'expired') then
    raise exception 'initiate_member_payment: not_eligible_for_renewal for member %', v_member_id;
  end if;

  -- Review finding: planSchema explicitly allows a zero-price (free/comp)
  -- plan -- without this, a free-plan member would still get a real
  -- `processing` row and a real 0-amount mobile-money charge attempt.
  if v_plan_price <= 0 then
    raise exception 'initiate_member_payment: no_active_plan for member %', v_member_id;
  end if;

  select active_payment_provider() into v_provider_key;
  if v_provider_key is null then
    raise exception 'initiate_member_payment: no_active_provider';
  end if;

  insert into payments (gym_id, member_id, amount, currency, method, status, provider)
  values (v_gym_id, v_member_id, v_plan_price, v_plan_currency, 'mobile_money', 'processing', v_provider_key)
  returning id into v_payment_id;

  return v_payment_id;
end;
$function$
;

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
  v_status subscription_status;
  v_expiry_date date;
  v_row class_bookings;
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
  select cb.id, cb.member_id into v_booking_id, v_member_id
  from class_bookings cb
  where cb.id = p_booking_id and cb.gym_id = v_gym_id;

  if v_booking_id is null then
    raise exception 'mark_class_attendance: booking % not found', p_booking_id;
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
    on conflict (member_id, status) where dismissed_at is null do nothing;
    return null;
  end if;

  -- No row lock needed (unlike book_class_session()'s capacity race) --
  -- this is a single-row, non-contended write. Review fix: the booking
  -- could still be deleted (cancel_class_booking()) between the existence
  -- check above and this update -- without the not-found recheck, a 0-row
  -- update leaves v_row an all-null composite, indistinguishable from the
  -- expired-member rejection shape once it crosses the PostgREST/JSON
  -- boundary, misleading the caller into showing a "member expired" toast
  -- for what was actually a just-cancelled booking.
  update class_bookings set attended_at = now() where id = v_booking_id
  returning * into v_row;

  if v_row is null then
    raise exception 'mark_class_attendance: booking % not found', p_booking_id;
  end if;

  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.materialize_class_sessions(p_class_id uuid, p_reschedule boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_gym_id uuid;
  v_class_gym_id uuid;
begin
  if not ((auth.jwt() ->> 'app_role') = any(array['manager', 'owner'])) then
    raise exception 'permission denied';
  end if;

  v_caller_gym_id := private.gym_id();
  if v_caller_gym_id is null then
    raise exception 'permission denied';
  end if;

  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'materialize_class_sessions: gym % is not active', v_caller_gym_id;
  end if;

  select gym_id into v_class_gym_id
  from classes
  where id = p_class_id and gym_id = v_caller_gym_id;

  if v_class_gym_id is null then
    raise exception 'materialize_class_sessions: class % not found', p_class_id;
  end if;

  if p_reschedule then
    if exists (
      select 1
      from class_sessions cs
      join class_bookings cb on cb.class_session_id = cs.id
      where cs.class_id = p_class_id and cs.scheduled_at > now()
    ) then
      raise exception 'materialize_class_sessions: cannot reschedule class % -- existing bookings on its future sessions', p_class_id;
    end if;

    delete from class_sessions where class_id = p_class_id and scheduled_at > now();
  end if;

  perform private.materialize_sessions_for_class(p_class_id);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.renew_subscription(p_member_id uuid, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_gym_id uuid;
  v_member_gym_id uuid;
  v_deactivated_at timestamptz;
  v_plan_id uuid;
  v_duration_days integer;
  v_new_expiry date;
  v_new_id uuid;
begin
  if not ((auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'receptionist'])) then
    raise exception 'permission denied';
  end if;

  v_caller_gym_id := private.gym_id();
  if v_caller_gym_id is null then
    raise exception 'permission denied';
  end if;

  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'renew_subscription: gym % is not active', v_caller_gym_id;
  end if;

  -- Gym-scoped in the query itself (not a separate post-check) so a member
  -- belonging to another gym produces the exact same "not found" outcome as
  -- a truly nonexistent id -- avoids letting a caller enumerate whether a
  -- given member id exists in some other gym, matching this codebase's own
  -- established "uniform 0-rows failure mode" tenant-isolation philosophy
  -- (see 0002/0007/0008's table-grant comments on the same principle).
  select gym_id, deactivated_at into v_member_gym_id, v_deactivated_at
  from members where id = p_member_id and gym_id = v_caller_gym_id;

  if v_member_gym_id is null then
    raise exception 'renew_subscription: member % not found', p_member_id;
  end if;

  if v_deactivated_at is not null then
    raise exception 'renew_subscription: member % is deactivated and cannot be renewed', p_member_id;
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'renew_subscription: reason is required';
  end if;

  select s.plan_id into v_plan_id
  from subscriptions s
  where s.member_id = p_member_id
  order by s.created_at desc
  limit 1;

  if v_plan_id is null then
    raise exception 'renew_subscription: member % has no existing subscription to renew', p_member_id;
  end if;

  select duration_days into v_duration_days from plans where id = v_plan_id;
  v_new_expiry := case when v_duration_days is null then null else current_date + v_duration_days end;

  insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
  values (v_member_gym_id, p_member_id, v_plan_id, 'active', current_date, v_new_expiry)
  returning id into v_new_id;

  perform log_audit_event(
    p_action_type => 'subscription_manual_renewal',
    p_gym_id => v_member_gym_id,
    p_target_entity_id => p_member_id::text,
    p_target_entity_type => 'member',
    p_metadata => jsonb_build_object(
      'reason', p_reason,
      'subscription_id', v_new_id,
      'plan_id', v_plan_id,
      'new_expiry_date', v_new_expiry
    )
  );

  return v_new_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.update_class(p_class_id uuid, p_name text, p_description text, p_coach_id uuid, p_capacity integer, p_schedule_type text, p_one_off_session_at timestamp with time zone, p_recurrence_days smallint[], p_recurrence_time time without time zone, p_recurrence_start_date date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid;
  v_old record;
  v_schedule_changed boolean;
begin
  if not ((auth.jwt() ->> 'app_role') = any(array['manager', 'owner'])) then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'update_class: gym % is not active', v_gym_id;
  end if;

  select schedule_type, one_off_session_at, recurrence_days, recurrence_time, recurrence_start_date
  into v_old
  from classes
  where id = p_class_id and gym_id = v_gym_id
  for update;

  if not found then
    raise exception 'update_class: class % not found', p_class_id;
  end if;

  v_schedule_changed :=
    v_old.schedule_type is distinct from p_schedule_type
    or v_old.one_off_session_at is distinct from p_one_off_session_at
    or v_old.recurrence_days is distinct from p_recurrence_days
    or v_old.recurrence_time is distinct from p_recurrence_time
    or v_old.recurrence_start_date is distinct from p_recurrence_start_date;

  if v_schedule_changed then
    if exists (
      select 1
      from class_sessions cs
      join class_bookings cb on cb.class_session_id = cs.id
      where cs.class_id = p_class_id and cs.scheduled_at > now()
    ) then
      raise exception 'update_class: cannot reschedule class % -- existing bookings on its future sessions', p_class_id;
    end if;
  end if;

  update classes set
    name = p_name,
    description = p_description,
    coach_id = p_coach_id,
    capacity = p_capacity,
    schedule_type = p_schedule_type,
    one_off_session_at = p_one_off_session_at,
    recurrence_days = p_recurrence_days,
    recurrence_time = p_recurrence_time,
    recurrence_start_date = p_recurrence_start_date
  where id = p_class_id and gym_id = v_gym_id;

  if v_schedule_changed then
    delete from class_sessions where class_id = p_class_id and scheduled_at > now();
    perform private.materialize_sessions_for_class(p_class_id);
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.update_staff_role(p_member_id uuid, p_name text, p_role member_role)
 RETURNS members
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid;
  v_caller_role member_role;
  v_target members;
  v_row members;
  v_is_self_edit boolean;
begin
  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'update_staff_role: caller has no gym-scoped session';
  end if;

  v_caller_role := private.current_member_role();

  select *
  into v_target
  from members
  where id = p_member_id
    and gym_id = v_gym_id
    and role != 'member'
    and deactivated_at is null;

  if not found then
    raise exception 'update_staff_role: target not found or not eligible';
  end if;

  v_is_self_edit := (v_target.user_id = auth.uid());

  if v_is_self_edit and p_role is distinct from v_target.role then
    raise exception 'update_staff_role: cannot edit your own role';
  end if;

  -- New (Story 9.4): target-role ceiling, scoped to skip the self-edit case
  -- (a legitimate name-only self-edit of an Owner's/Supervisor's own row
  -- must not be blocked by a check on their own row's role -- the self-edit
  -- block immediately above already governs that case).
  if not v_is_self_edit then
    if v_target.role = 'owner' then
      raise exception 'update_staff_role: caller is not authorized to edit a staff member with role %', v_target.role;
    end if;
    if v_caller_role = 'supervisor' and v_target.role = 'supervisor' then
      raise exception 'update_staff_role: caller is not authorized to edit a staff member with role %', v_target.role;
    end if;
  end if;

  if p_role is null then
    raise exception 'update_staff_role: p_role is required';
  end if;

  if v_caller_role = 'owner' then
    if not (v_is_self_edit and p_role = v_target.role) and p_role not in ('supervisor', 'manager', 'receptionist', 'coach') then
      raise exception 'update_staff_role: caller is not authorized to assign role %', p_role;
    end if;
  elsif v_caller_role = 'supervisor' then
    if not (v_is_self_edit and p_role = v_target.role) and p_role not in ('manager', 'receptionist', 'coach') then
      raise exception 'update_staff_role: caller is not authorized to assign role %', p_role;
    end if;
  else
    raise exception 'update_staff_role: caller is not authorized to edit staff';
  end if;

  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'update_staff_role: gym % is not active', v_gym_id;
  end if;

  perform set_config('app.staff_role_update_bypass', 'true', true);
  update members
  set name = p_name, role = p_role
  where id = p_member_id
  returning * into v_row;
  perform set_config('app.staff_role_update_bypass', 'false', true);

  perform log_audit_event(
    p_action_type => 'staff_role_updated',
    p_gym_id => v_gym_id,
    p_target_entity_id => v_row.id::text,
    p_target_entity_type => 'member',
    p_metadata => jsonb_build_object(
      'previous_role', v_target.role,
      'new_role', p_role,
      'previous_name', v_target.name,
      'new_name', p_name
    )
  );

  return v_row;
end;
$function$
;


-- Post-condition assertions. 0089's lesson: a migration that assumes an
-- object's shape should assert it rather than trust the name. If a body above
-- was ever edited in a way that dropped the guard, or if one of the exclusion
-- paths acquired one by copy-paste, this migration fails loudly at apply time
-- instead of shipping a half-enforced gate.
do $verify$
declare
  v_gated text[] := array[
    'add_session_note','assign_coach','book_class_session','cancel_class_booking',
    'check_in','check_out','check_out_member','confirm_renewal','create_class',
    'create_staff_member','deactivate_staff_member','edit_session_note',
    'initiate_member_payment','mark_class_attendance','materialize_class_sessions',
    'renew_subscription','update_class','update_staff_role'
  ];
  -- Gating any of these locks a suspended gym out of its own recovery.
  v_must_not_gate text[] := array[
    'update_own_owner_notification_email',  -- Owner fixes the billing-notice address while suspended
    'initiate_saas_billing_payment',        -- the "Pay Now" escape valve
    'complete_verified_saas_billing_payment', -- un-suspends
    'record_out_of_band_saas_billing_payment', -- un-suspends
    'apply_saas_billing_credit',            -- un-suspends
    'escalate_gym_data_access',             -- Super Admin support access needed BECAUSE suspended
    'revoke_gym_data_access',
    'list_own_active_gym_memberships',      -- 0074 exists because the gate broke the switcher
    'switch_active_gym',
    'custom_access_token_hook',             -- must mint claims or the Owner cannot log in to pay
    'log_audit_event',                      -- called BY the recovery paths; gating cascades
    'complete_verified_payment',            -- service_role webhook; resolves gym from the payment row
    'complete_flagged_payment',             -- service_role webhook
    -- Code review 2026-09-09: the six private-schema exclusions below were
    -- documented in §C and mirrored in suspension_rpc_coverage.test.sql, but
    -- were missing here -- so this block asserted 13 of 19. They are the
    -- copy-paste-prone half: triggers and cron-owned helpers that run under
    -- service_role with NO gym_id claim, which means current_gym_status()
    -- returns NULL and the guard would fire UNCONDITIONALLY. Gating any one
    -- of the four senders silently kills every push notification for every
    -- gym on the platform, and this migration would still apply cleanly.
    'create_default_member_preferences',    -- after-insert trigger on members; reachable only behind create_staff_member
    'materialize_sessions_for_class',       -- service_role helper; also called by run_class_session_materializer_job()
    'send_push_notification',               -- cron-owned sender; no gym_id claim
    'send_payment_push_notification',       -- cron-owned sender; no gym_id claim
    'send_quiet_gym_alert',                 -- cron-owned sender; no gym_id claim
    'send_class_reminder'                   -- cron-owned sender; no gym_id claim
  ];
  v_unknown text[];
  v_missing text[];
  v_unexpected text[];
begin
  select array_agg(fn order by fn) into v_missing
  from unnest(v_gated) as fn
  where not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = fn
      and p.prosrc like '%current_gym_status()%'
  );

  if v_missing is not null then
    raise exception '0090: suspension guard missing from %', array_to_string(v_missing, ', ');
  end if;

  -- Code review 2026-09-09: the negative check below is `where exists`, so a
  -- typo in v_must_not_gate makes that entry vacuous and the check passes --
  -- the opposite failure mode from v_gated's `not exists`, which fails loudly.
  -- Assert every exclusion name resolves to a real function first, so the
  -- list cannot rot into a no-op one silent typo at a time.
  select array_agg(fn order by fn) into v_unknown
  from unnest(v_must_not_gate) as fn
  where not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.proname = fn
  );

  if v_unknown is not null then
    raise exception '0090: exclusion list names unknown function(s): % -- typo, rename, or dropped function', array_to_string(v_unknown, ', ');
  end if;

  select array_agg(fn order by fn) into v_unexpected
  from unnest(v_must_not_gate) as fn
  where exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.proname = fn
      and p.prosrc like '%current_gym_status()%'
  );

  if v_unexpected is not null then
    raise exception '0090: recovery path(s) must NOT be status-gated: %', array_to_string(v_unexpected, ', ');
  end if;
end;
$verify$;
