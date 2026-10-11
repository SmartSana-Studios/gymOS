-- ============================================================================
-- 0111: Check-in gate, blocked attempts & session-required alert
-- (Epic 19, Story 19.6b).
--
-- At a gym that charges guests per session a Pay-per-session member can only
-- check in with a paid (or free) session. Flag-off gyms never enter any new
-- code: check_in() reads gyms.charge_guests_per_session before any new call
-- or lock and the off path has the same behavior as 0110.
--
--   session_attempts                 one row per refused scan (unique on gym,
--                                    member, scan id when the id is present);
--                                    the only source of blocked counts
--   guest_sessions CHECK             a consumed row must carry covered_day
--   private.on_session_consumed()    no-op hook, filled by Epic 20
--   private.consume_guest_session()  the only consumption path:
--                                    exempt / covered / consumed / denied
--   check_in()                       gated behind the flag; same signature,
--                                    RETURNS attendance_events, null = blocked
--   private.create_guest_session_for_payment()
--                                    also dismisses the member's active
--                                    session_required alert (same transaction)
--   attendance_events                INSERT/UPDATE/DELETE revoked from
--                                    authenticated and service_role
--
-- Gate order in check_in() when the flag is on: replay short-circuit,
-- suspension, deactivated, expired/no-subscription alert (unchanged), flag
-- read, member lock (FOR NO KEY UPDATE), open-session lock and stale
-- handling, consume_guest_session(), insert. consume_guest_session()
-- re-checks flag, current plan type and price > 0 and returns 'exempt'
-- without locking; only then does it lock the member and read sessions. The
-- gym-local day comes from private.gym_local_day_bounds() of RECEIPT time
-- (now()), never the offline scan time. Consumption order: soonest
-- usable_until, paid (payment_id) before free on a tie.
--
-- A denied scan commits (it returns null, it does not raise): the attempt
-- row and the single active session_required alert persist, as does a stale
-- auto-close earlier in the same call.
--
-- attendance_events direct-write closure. Writers found by grep at build time
-- (supabase/migrations, supabase/tests, supabase/functions, apps, packages):
--   * public.check_in()                    SECURITY DEFINER, owner postgres
--   * public.check_out()                   SECURITY DEFINER, owner postgres
--   * public.check_out_member()            SECURITY DEFINER, owner postgres
--   * public.run_check_in_auto_timeout_job() pg_cron, runs as postgres
--   * supabase/functions/*                 none (no attendance_events access)
--   * apps/dashboard, apps/mobile          read-only queries (select only)
--   * supabase/tests                       run as postgres (superuser) except
--     the DELETE-as-authenticated assertion in rls_tenant_isolation.test.sql,
--     which is updated to expect permission denied. (The raw INSERT in
--     check_in_one_open_session_enforcement.test.sql runs after reset role as
--     superuser and is unchanged.)
-- SELECT stays granted; the RLS staff/member read policies are unchanged.
-- Revoked grants restore with the 0006 line (rollback script).
--
-- The copied check_in() body keeps its auth.jwt() ->> 'app_role' read (as in
-- 0110), so this file is added to the app_role_reads grandfather list.
--
-- Release gate (not a build gate): apply only after 0110 has run a week clean
-- in production (docs/decisions.md runbook).
--
-- Rollback: scripts/rollback-0111-check-in-session-gate.sql (forward fix).
-- ============================================================================

-- 1. session_attempts -----------------------------------------------------------

create table session_attempts (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references gyms(id),
  member_id uuid not null references members(id),
  scan_id uuid,
  source text not null default 'check_in' check (source in ('check_in', 'class')),
  scanned_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_session_attempts_gym_id_created_at on session_attempts (gym_id, created_at);
create index idx_session_attempts_member_id on session_attempts (member_id);

-- A scan id counts once. Null scan ids (online scans) always record.
create unique index session_attempts_scan_id_unique
  on session_attempts (gym_id, member_id, scan_id)
  where scan_id is not null;

alter table session_attempts enable row level security;

-- Read-only for clients; every writer is SECURITY DEFINER. Default privileges
-- also hand out TRUNCATE (which bypasses RLS), so strip all first.
revoke all on session_attempts from anon, authenticated, service_role;
grant select on session_attempts to authenticated, service_role;

create policy "gym_staff_read_own_session_attempts" on session_attempts
  for select
  using (
    gym_id = private.gym_id()
    and private.current_member_role() in ('owner', 'manager', 'supervisor', 'receptionist')
  );

create policy "tenant_active_gate" on session_attempts
  as restrictive
  for all
  using (private.current_gym_status() = 'active' or private.is_super_admin())
  with check (private.current_gym_status() = 'active' or private.is_super_admin());

-- 2. A consumed session always names the day it covers (deferred-work 980) ------

alter table guest_sessions
  add constraint guest_sessions_consumed_has_covered_day
  check (consumed_at is null or covered_day is not null);

-- 3. Hooks and consumption -------------------------------------------------------

-- No-op today; Epic 20 stamps loyalty progress here.
create function private.on_session_consumed(p_session_id uuid, p_member_id uuid, p_gym_id uuid)
returns void
language plpgsql
set search_path = public
as $$
begin
  null;
end;
$$;

revoke execute on function private.on_session_consumed(uuid, uuid, uuid) from public, anon, authenticated;

-- outcome: 'exempt' | 'covered' | 'consumed' | 'denied'.
-- session_created_at: created_at of the covering session (covered/consumed),
-- null otherwise; check_in() uses it to bound an offline scan time.
create function private.consume_guest_session(p_member_id uuid, p_gym_id uuid, p_receipt_at timestamptz)
returns table (outcome text, session_created_at timestamptz)
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
    return query select 'exempt'::text, null::timestamptz;
    return;
  end if;

  select p.plan_type, p.price into v_plan_type, v_price
  from subscriptions s
  join plans p on p.id = s.plan_id
  where s.member_id = p_member_id
  order by s.created_at desc, s.id desc
  limit 1;

  if v_plan_type is distinct from 'pay_per_session' or coalesce(v_price, 0) <= 0 then
    return query select 'exempt'::text, null::timestamptz;
    return;
  end if;

  -- Canonical order: member (FOR NO KEY UPDATE) before guest_sessions.
  perform 1 from members m where m.id = p_member_id for no key update;

  select b.day_start into v_day_start
  from private.gym_local_day_bounds(v_timezone, p_receipt_at) b;
  v_day := (v_day_start at time zone v_timezone)::date;

  -- Already covered today by a consumed, non-voided session.
  select s.created_at into v_created_at
  from guest_sessions s
  where s.member_id = p_member_id
    and s.gym_id = p_gym_id
    and s.consumed_at is not null
    and s.voided_at is null
    and s.covered_day = v_day
  limit 1;

  if found then
    return query select 'covered'::text, v_created_at;
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
    return query select 'denied'::text, null::timestamptz;
    return;
  end if;

  update guest_sessions
  set consumed_at = p_receipt_at, covered_day = v_day
  where id = v_session_id;

  perform private.on_session_consumed(v_session_id, p_member_id, p_gym_id);

  return query select 'consumed'::text, v_created_at;
end;
$$;

revoke execute on function private.consume_guest_session(uuid, uuid, timestamptz) from public, anon, authenticated;

-- 4. check_in() ------------------------------------------------------------------
-- Live 0110 pg_get_functiondef with only the gated sections added.

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
  v_charging boolean;
  v_gate_outcome text;
  v_session_created_at timestamptz;
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

-- 5. Payment dismisses the member's session_required alert -----------------------
-- Live 0109 body; the dismissal is the only addition. Same transaction as the
-- session creation. A staff desk payment (0108) and a Tara confirmation (0109)
-- both come through here.

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

  -- 0111: the member can now check in, so their standing session_required
  -- alert is resolved. The column-protect trigger stamps dismissed_by.
  update front_desk_alerts
  set dismissed_at = now()
  where member_id = p_member_id
    and gym_id = p_gym_id
    and kind = 'session_required'
    and dismissed_at is null;

  return v_session;
end;
$$;

revoke execute on function private.create_guest_session_for_payment(uuid, uuid, uuid) from public, anon;

-- 6. Close direct writes on attendance_events -----------------------------------

revoke insert, update, delete on attendance_events from authenticated, service_role;

-- 7. Self-check -----------------------------------------------------------------

do $verify$
begin
  if to_regclass('public.session_attempts') is null then
    raise exception '0111: session_attempts missing';
  end if;

  if has_table_privilege('authenticated', 'public.session_attempts', 'INSERT')
    or has_table_privilege('authenticated', 'public.session_attempts', 'UPDATE')
    or has_table_privilege('authenticated', 'public.session_attempts', 'DELETE')
    or has_table_privilege('service_role', 'public.session_attempts', 'INSERT')
  then
    raise exception '0111: session_attempts has a client write grant';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'guest_sessions_consumed_has_covered_day'
      and conrelid = 'public.guest_sessions'::regclass
  ) then
    raise exception '0111: guest_sessions covered_day check missing';
  end if;

  if exists (select 1 from guest_sessions where consumed_at is not null and covered_day is null) then
    raise exception '0111: consumed guest_sessions row without covered_day';
  end if;

  if to_regprocedure('private.consume_guest_session(uuid, uuid, timestamptz)') is null
    or to_regprocedure('private.on_session_consumed(uuid, uuid, uuid)') is null
  then
    raise exception '0111: consume_guest_session / on_session_consumed missing';
  end if;

  if position('consume_guest_session' in (
    select prosrc from pg_proc where oid = 'public.check_in(timestamptz, uuid)'::regprocedure
  )) = 0 then
    raise exception '0111: check_in() does not call consume_guest_session()';
  end if;

  if position('session_required' in (
    select prosrc from pg_proc
    where oid = 'private.create_guest_session_for_payment(uuid, uuid, uuid)'::regprocedure
  )) = 0 then
    raise exception '0111: create_guest_session_for_payment() does not dismiss session_required';
  end if;

  if has_table_privilege('authenticated', 'public.attendance_events', 'INSERT')
    or has_table_privilege('authenticated', 'public.attendance_events', 'UPDATE')
    or has_table_privilege('authenticated', 'public.attendance_events', 'DELETE')
    or has_table_privilege('service_role', 'public.attendance_events', 'INSERT')
    or has_table_privilege('service_role', 'public.attendance_events', 'UPDATE')
    or has_table_privilege('service_role', 'public.attendance_events', 'DELETE')
  then
    raise exception '0111: attendance_events still has a client write grant';
  end if;

  if not has_table_privilege('authenticated', 'public.attendance_events', 'SELECT') then
    raise exception '0111: attendance_events lost its SELECT grant';
  end if;
end;
$verify$;
