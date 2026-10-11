-- ============================================================================
-- 0110: Front-desk alert `kind` refactor, NO behavior change (Epic 19, 19.6a).
--
-- front_desk_alerts could only hold subscription-status alerts: `status` was
-- NOT NULL under a three-value CHECK and the one-active index and every
-- ON CONFLICT clause keyed on (member_id, status). Story 19.6b needs a second
-- kind (`session_required`) that has no status. This migration only reshapes
-- the table and its writers; nothing writes `session_required` and every
-- alert behaves exactly as before.
--
--   * kind text NOT NULL DEFAULT 'subscription_status' (existing rows backfill
--     through the default; check_in()/mark_class_attendance() inserts do not
--     name it and keep working unchanged)
--   * status becomes nullable under a kind-aware CHECK
--   * one-active unique index swapped to (member_id, kind, status) NULLS NOT
--     DISTINCT. The new index is created BEFORE the old one is dropped, so
--     ON CONFLICT inference and the one-active guarantee never lapse.
--   * the two live ON CONFLICT writers are rewritten to the new target.
--     Clause count found by grep at build time: 6 `on conflict (member_id,
--     status)` sites in supabase/migrations (0034 x2, 0068 x1, 0090 x3). Only
--     3 are live (check_in() x2, mark_class_attendance() x1, all from 0090);
--     0034/0068 are superseded bodies and are not edited. No later migration
--     redefines either function (checked against pg_get_functiondef).
--   * front_desk_alerts_protect_columns() pins `kind`.
--
-- The function bodies below are the live pg_get_functiondef output with only
-- the ON CONFLICT target (and the comment naming the index) changed.
-- Signatures, return types and ACLs are untouched (create or replace keeps
-- them, see 0104); the revokes at the end are no-ops for the two RPCs. For
-- the trigger function they drop its default PUBLIC execute, which firing a
-- trigger never needs; the guardrail requires a revoke beside every function.
--
-- Locking: a plain (non-concurrent) index build holds a write lock on a small
-- table for milliseconds; CREATE INDEX CONCURRENTLY cannot run inside a
-- migration transaction. The whole migration is one transaction.
--
-- Index form: the epic spelled it coalesce(status::text, ''); enum-to-text is
-- not IMMUTABLE so that is refused. `nulls not distinct` (PG 15+; local and
-- production are 17) gives the same guarantee with no wrapper function.
--
-- Rollback: scripts/rollback-0110-front-desk-alert-kind.sql (forward fix).
-- ============================================================================

-- 1. Column + constraints -----------------------------------------------------

alter table front_desk_alerts
  add column kind text not null default 'subscription_status';

alter table front_desk_alerts
  alter column status drop not null;

alter table front_desk_alerts
  drop constraint front_desk_alerts_status_check;

alter table front_desk_alerts
  add constraint front_desk_alerts_kind_status_check check (
    (kind = 'subscription_status'
      and status is not null
      and status in ('expiring_soon', 'grace_period', 'expired'))
    or (kind = 'session_required' and status is null)
  );

-- 2. Index swap: create new first, then drop old ------------------------------

create unique index idx_front_desk_alerts_one_active_per_member_kind_status
  on front_desk_alerts (member_id, kind, status) nulls not distinct
  where dismissed_at is null;

drop index idx_front_desk_alerts_one_active_per_member_status;

-- 3. Column-protect trigger function: pin `kind` ------------------------------

create or replace function public.front_desk_alerts_protect_columns()
returns trigger
language plpgsql
as $$
begin
  if new.gym_id is distinct from old.gym_id
    or new.member_id is distinct from old.member_id
    or new.kind is distinct from old.kind
    or new.status is distinct from old.status
    or new.expiry_date is distinct from old.expiry_date
    or new.created_at is distinct from old.created_at
  then
    raise exception 'front_desk_alerts: only dismissed_at/dismissed_by may be updated';
  end if;

  if new.dismissed_at is not null and old.dismissed_at is null then
    new.dismissed_by := auth.uid();
  end if;

  return new;
end;
$$;

-- 4. Live writers: ON CONFLICT target rewritten -------------------------------

create or replace function public.check_in(p_scanned_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_client_scan_id uuid DEFAULT NULL::uuid)
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
    -- on conflict: idx_front_desk_alerts_one_active_per_member_kind_status
    -- (Review finding) -- a member who scans repeatedly while still
    -- expired gets one standing alert, not a fresh row per scan.
    insert into front_desk_alerts (gym_id, member_id, status, expiry_date)
    values (v_gym_id, v_member_id, 'expired', v_expiry_date)
    on conflict (member_id, kind, status) where dismissed_at is null do nothing;
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
    on conflict (member_id, kind, status) where dismissed_at is null do nothing;
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
$function$;

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
    on conflict (member_id, kind, status) where dismissed_at is null do nothing;
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
$function$;

-- No-ops (ACLs are preserved by create or replace); present for the
-- migration guardrail, which requires a revoke next to every function.
revoke execute on function public.check_in(timestamptz, uuid) from public, anon;
revoke execute on function public.mark_class_attendance(uuid) from public, anon;
revoke execute on function public.front_desk_alerts_protect_columns() from public, anon;

-- 5. Self-check ----------------------------------------------------------------

do $verify$
begin
  if exists (
    select 1 from front_desk_alerts
    where dismissed_at is null
    group by member_id, kind, status
    having count(*) > 1
  ) then
    raise exception '0110: duplicate active front_desk_alerts per member/kind/status';
  end if;

  if exists (
    select 1 from front_desk_alerts
    where kind = 'subscription_status' and status is null
  ) then
    raise exception '0110: subscription_status alert with null status';
  end if;

  if to_regclass('public.idx_front_desk_alerts_one_active_per_member_status') is not null then
    raise exception '0110: old one-active index still present';
  end if;

  if to_regclass('public.idx_front_desk_alerts_one_active_per_member_kind_status') is null then
    raise exception '0110: new one-active index missing';
  end if;
end;
$verify$;
