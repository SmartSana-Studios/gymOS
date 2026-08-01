-- Story 4.6: Real-Time Front-Desk Alert. Adds `front_desk_alerts` (a new,
-- dedicated table -- not a repurposing of `attendance_events`, mirroring the
-- 4.4/4.5 "own table, don't overload an existing one" precedent) and amends
-- `check_in()` (0028_member_app_offline_check_in_queueing.sql) to insert an
-- alert row for the expiring_soon/grace_period/expired outcomes.
--
-- This is the first migration in the codebase to add a table to the
-- `supabase_realtime` publication -- see docs/decisions.md for why Realtime
-- + TanStack Query was chosen (architecture.md lines 141, 176).

create table front_desk_alerts (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references gyms(id),
  member_id uuid not null references members(id),
  status subscription_status not null,
  expiry_date date,
  created_at timestamptz not null default now(),
  dismissed_at timestamptz,
  dismissed_by uuid references users(id),
  constraint front_desk_alerts_status_check check (status in ('expiring_soon', 'grace_period', 'expired'))
);

create index idx_front_desk_alerts_gym_id on front_desk_alerts(gym_id);
create index idx_front_desk_alerts_active on front_desk_alerts(gym_id) where dismissed_at is null;

-- Review finding (Story 4.6): without this, a member who scans repeatedly
-- while still expired/at-risk (and, for the expired branch, there is no
-- open-session lock ahead of the insert to bound repeat attempts at all)
-- gets a fresh alert row on every single scan. One active, undismissed
-- alert per member+status is the correct steady state -- `check_in()`'s
-- inserts below rely on `on conflict (...) do nothing` against this index.
create unique index idx_front_desk_alerts_one_active_per_member_status
  on front_desk_alerts(member_id, status) where dismissed_at is null;

alter table front_desk_alerts enable row level security;

grant select, update on front_desk_alerts to authenticated, service_role;
-- No insert grant to `authenticated` -- only check_in() (SECURITY DEFINER,
-- below) inserts, same precedent as attendance_events itself.

create policy "gym_staff_read_own_front_desk_alerts" on front_desk_alerts
  for select
  using (
    gym_id = private.gym_id()
    and (auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'receptionist'])
  );

create policy "gym_staff_dismiss_own_front_desk_alerts" on front_desk_alerts
  for update
  using (
    gym_id = private.gym_id()
    and (auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'receptionist'])
  )
  with check (
    gym_id = private.gym_id()
    and (auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'receptionist'])
  );
-- Review finding (Story 4.6): RLS alone is row-level, not column-level, so
-- the UPDATE policy above doesn't stop a caller from rewriting
-- member_id/status/expiry_date/gym_id, or spoofing dismissed_by to an
-- arbitrary user id, via a direct PostgREST PATCH. This trigger closes
-- both gaps: it rejects any change outside dismissed_at/dismissed_by, and
-- derives dismissed_by server-side from the caller's own JWT rather than
-- trusting whatever the client sent.
create or replace function public.front_desk_alerts_protect_columns()
returns trigger
language plpgsql
as $$
begin
  if new.gym_id is distinct from old.gym_id
    or new.member_id is distinct from old.member_id
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

create trigger front_desk_alerts_protect_columns
  before update on front_desk_alerts
  for each row
  execute function public.front_desk_alerts_protect_columns();

alter publication supabase_realtime add table front_desk_alerts;

-- ============================================================================
-- check_in(): create or replace (same signature as 0028, so this is safe --
-- unlike 0028's own drop+create against a genuinely different signature).
-- Redeclares the full 0028 body with exactly these changes:
--   1. v_expiry_date date; added to the declare block.
--   2. The subscription lookup now also selects expiry_date.
--   3. The expired/no-subscription branch no longer raises -- it inserts a
--      red alert row and returns null (a clean, non-error return -- legal
--      for a non-setof composite-returning function). A `raise exception`
--      with no enclosing exception block unwinds the entire transaction,
--      including this migration's own alert insert if it ran earlier in the
--      same function call -- there is no dblink/autonomous-transaction
--      extension enabled in this project. This is a breaking change to an
--      established client contract -- see apps/mobile/src/services/checkin.ts.
--   4. Immediately after the attendance_events insert succeeds, a
--      yellow-alert row is inserted for expiring_soon/grace_period -- placed
--      here (not earlier) so a member who is both at-risk AND already has a
--      non-stale open check-in (rejected later in this function) never gets
--      an alert whose insert is then silently rolled back by that unrelated
--      exception.
-- Everything else (permission checks, member resolution, client_scan_id
-- idempotent-replay short-circuit, deactivated_at guard, open-session
-- lock/stale-close, offline-sync immediate-close block, final return) is
-- unchanged from 0028, copied verbatim.
-- ============================================================================
create or replace function public.check_in(p_scanned_at timestamptz default null, p_client_scan_id uuid default null)
returns attendance_events
language plpgsql
security definer
set search_path = public
as $$
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
$$;
