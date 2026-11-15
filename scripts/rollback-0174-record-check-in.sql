-- Rollback for migration 0174: one check-in insert path (private.record_check_in).
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0174-record-check-in.sql
-- Restores: check_in() as of 0124 (the whole body inline, the member lock only at charging gyms), the one-open index predicate without
-- voided_at, attendance_counted without source; drops private.record_check_in and the columns source, entered_by, voided_by and
-- void_reason with their constraints.
-- Valid before Story 27.3 ships: no row can be a staff entry or carry void data until then. Aborts if one does, because dropping the
-- columns would silently turn a staff entry into a scan and a voided visit back into a counted one.
do $guard$
begin
  if exists (select 1 from public.attendance_events
             where source <> 'qr' or entered_by is not null or voided_by is not null or void_reason is not null or voided_at is not null) then
    raise exception 'rollback-0174: attendance_events has a staff entry or a voided row; dropping the columns would change what it means';
  end if;
end;
$guard$;

set local lock_timeout = '5s';

-- check_in() back to the 0124 body. It must stop referencing record_check_in before that function is dropped.
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
  v_charging boolean;
  v_gate_outcome text;
  v_session_created_at timestamptz;
begin
  if (select private.current_member_role())::text is distinct from 'member' then
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

  -- 0111 kill switch: the charging flag is read here, before any V1.6 call
  -- or lock. Off (or null) keeps every line below byte-for-byte the 0110 path.
  select checkin_timeout_hours, charge_guests_per_session
  into v_timeout_hours, v_charging
  from gyms where id = v_gym_id;
  v_charging := coalesce(v_charging, false);

  -- 0111 canonical lock order: the member row (FOR NO KEY UPDATE) is taken
  -- before the open-session attendance_events lock below. Only when charging
  -- is on; consume_guest_session() re-locks it harmlessly.
  if v_charging then
    perform 1 from members where id = v_member_id for no key update;
  end if;

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

  -- 0111 gate (charging gyms only). Placed after the open-session handling
  -- so a stale auto-close above commits with a denied scan, and before the
  -- insert so a consumed session and its attendance row commit together.
  -- A denied scan returns null (never raises) so its attempt row and alert
  -- commit; the old contract reads null as "blocked". Never a coded row.
  if v_charging then
    select c.outcome, c.session_created_at
    into v_gate_outcome, v_session_created_at
    from private.consume_guest_session(v_member_id, v_gym_id, now()) c;

    if v_gate_outcome = 'denied' then
      -- One attempt per scan id (a retry of the same offline scan is
      -- conflict-skipped); a null scan id always records a new attempt.
      insert into session_attempts (gym_id, member_id, scan_id, source, scanned_at)
      values (v_gym_id, v_member_id, p_client_scan_id, 'check_in', least(p_scanned_at, now()))
      on conflict (gym_id, member_id, scan_id) where scan_id is not null do nothing;

      -- One active session_required alert per member (status is null; the
      -- (member_id, kind, status) NULLS NOT DISTINCT index dedupes it).
      insert into front_desk_alerts (gym_id, member_id, kind, status, expiry_date)
      values (v_gym_id, v_member_id, 'session_required', null, null)
      on conflict (member_id, kind, status) where dismissed_at is null do nothing;

      return null;
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

  -- 0111: for a session-covered check-in an offline scan time is trusted
  -- only inside the auto-timeout window of receipt and not before the
  -- covering session existed; otherwise server receipt time governs. An
  -- exempt member (or a flag-off gym) keeps the clamped scan time as before.
  if v_gate_outcome in ('consumed', 'covered')
    and p_scanned_at is not null
    and not (
      v_checked_in_at + make_interval(hours => v_timeout_hours) > now()
      and v_checked_in_at >= v_session_created_at
    )
  then
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
grant execute on function public.check_in(timestamptz, uuid) to authenticated;

drop function private.record_check_in(uuid, uuid, text, uuid, timestamptz, uuid);

-- The one-open index with its 0023 predicate (same name, one transaction).
drop index public.idx_attendance_events_one_open_per_member;
create unique index idx_attendance_events_one_open_per_member
  on public.attendance_events (member_id)
  where checked_out_at is null;

-- The views as 0173 left them (a column cannot be dropped by CREATE OR REPLACE, so the view and its dependent are re-created).
drop view public.member_visit_days;
drop view public.attendance_counted;

create view public.attendance_counted with (security_invoker = true) as
select
  ae.id,
  ae.gym_id,
  ae.member_id,
  ae.checked_in_at,
  ae.checked_out_at,
  ae.checkout_type,
  ae.visit_day,
  ae.created_at,
  ae.client_scan_id
from public.attendance_events ae
where ae.voided_at is null;

create view public.member_visit_days with (security_invoker = true) as
select distinct
  ac.member_id,
  ac.gym_id,
  ac.visit_day
from public.attendance_counted ac;

revoke all on public.attendance_counted from public, anon, authenticated, service_role;
revoke all on public.member_visit_days from public, anon, authenticated, service_role;
grant select on public.attendance_counted to authenticated;
grant select on public.member_visit_days to authenticated;

alter table public.attendance_events
  drop constraint attendance_events_void_reason_length,
  drop constraint attendance_events_void_all_or_none,
  drop constraint attendance_events_entered_by_iff_staff,
  drop constraint attendance_events_source_check;

alter table public.attendance_events
  drop column void_reason,
  drop column voided_by,
  drop column entered_by,
  drop column source;

-- The 0111 write closure, unchanged.
revoke insert, update, delete on public.attendance_events from authenticated, service_role;

do $verify$
begin
  if to_regprocedure('private.record_check_in(uuid, uuid, text, uuid, timestamptz, uuid)') is not null then
    raise exception 'rollback-0174: record_check_in still exists';
  end if;
  if position('record_check_in' in (select prosrc from pg_proc where oid = 'public.check_in(timestamptz, uuid)'::regprocedure)) > 0 then
    raise exception 'rollback-0174: check_in() still calls record_check_in';
  end if;
  if position('consume_guest_session' in (select prosrc from pg_proc where oid = 'public.check_in(timestamptz, uuid)'::regprocedure)) = 0 then
    raise exception 'rollback-0174: check_in() lost the session gate';
  end if;
end
$verify$;
