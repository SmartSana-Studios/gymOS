-- Forward-fix rollback for migration 0111 (check-in session gate).
-- Restores: check_in() as of 0110, create_guest_session_for_payment() as of
-- 0109 (no alert dismissal), attendance_events write grants as of 0006, and
-- drops the 0111 objects (consume_guest_session, on_session_consumed, the
-- covered_day CHECK, session_attempts).
--
-- Aborts if session_attempts holds rows: those are the blocked-attempt record
-- and must be archived deliberately before the table is dropped. Active
-- session_required alerts are left in place (0110's shape allows them and
-- the dashboard readers filter on kind); dismiss them first if 0110 is also
-- being rolled back, because that script refuses non-subscription_status rows.
--
-- Run with host psql, one transaction:
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0111-check-in-session-gate.sql

do $guard$
begin
  if exists (select 1 from session_attempts) then
    raise exception 'rollback-0111: session_attempts has rows; archive them before dropping the table';
  end if;
end;
$guard$;

-- check_in() back to the 0110 body (no flag read, no gate).
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

revoke execute on function public.check_in(timestamptz, uuid) from public, anon;

-- create_guest_session_for_payment() back to the 0109 body.
create or replace function private.create_guest_session_for_payment(p_payment_id uuid, p_member_id uuid, p_gym_id uuid)
returns guest_sessions
language plpgsql
set search_path = public
as $$
declare
  v_days integer;
  v_session guest_sessions;
begin
  if not exists (
    select 1 from payments p
    where p.id = p_payment_id
      and p.purpose = 'session'
      and p.status = 'verified'
      and p.member_id = p_member_id
      and p.gym_id = p_gym_id
  ) then
    raise exception 'invalid_session_payment: payment % is not a verified session payment for member % in gym %',
      p_payment_id, p_member_id, p_gym_id;
  end if;

  select c.paid_session_validity_days into v_days from platform_session_config c limit 1;

  if v_days is null then
    raise exception 'session_config_missing: platform_session_config has no row';
  end if;

  insert into guest_sessions (gym_id, member_id, payment_id, usable_until)
  values (p_gym_id, p_member_id, p_payment_id, now() + make_interval(days => v_days))
  returning * into v_session;

  return v_session;
end;
$$;

revoke execute on function private.create_guest_session_for_payment(uuid, uuid, uuid) from public, anon;

drop function private.consume_guest_session(uuid, uuid, timestamptz);
drop function private.on_session_consumed(uuid, uuid, uuid);

alter table guest_sessions drop constraint guest_sessions_consumed_has_covered_day;

drop table session_attempts;

-- 0006's grant line.
grant select, insert, update, delete on attendance_events to authenticated, service_role;
