-- ============================================================================
-- 0174: One check-in insert path, private.record_check_in (Epic 27, Story 27.2; AD-56, AD-22, AD-29, AD-31, NFR-021).
--
-- check_in() was the only inserter of attendance_events and held the lock, gate and insert logic inline, taking the member lock only at
-- charging gyms. Story 27.3 needs a staff check-in that follows exactly the rules of a scan; a second hand-copied body would let the two
-- drift. This migration moves the rules into private.record_check_in and reduces check_in() to its role gate, one call and the mapping of
-- the outcome. A scan behaves identically: supabase/tests/check_in_record_path.test.sql was committed against the unmodified body and
-- passes, unedited, against this one.
--
--   * private.record_check_in(member, gym, source, actor, at, scan id) is the ONLY function that inserts into attendance_events. In this
--     order and nothing before it: the member lock (FOR NO KEY UPDATE, now taken at every gym, charging or not), the replay
--     short-circuit, the gym status check, the deactivation check, the FR-031 outcome, the open-check-in lookup and the FR-044 stale
--     auto-close, the AD-29 session gate through private.consume_guest_session (which also stamps loyalty through
--     private.on_session_consumed), time clamping, the one insert with visit_day passed explicitly, the offline-immediate-stale close.
--     It returns a table (outcome, member_status, expiry_date, event). It writes no front_desk_alerts and no session_attempts: a staff
--     entry makes none (FR-249), so check_in() writes them after mapping a blocked outcome.
--   * check_in() keeps its signature, RETURNS attendance_events, role gate, grants and the contract that a refusal returns SQL NULL
--     (every older mobile build maps null to its expired outcome). A refusal returns normally, so the alert, the attempt row and a stale
--     auto-close all commit.
--   * attendance_events gains source ('qr' | 'staff'), entered_by, voided_by and void_reason with their CHECKs. Every existing row is a
--     scan: source 'qr', entered_by null. attendance_counted is replaced (appending source, never entered_by).
--   * idx_attendance_events_one_open_per_member keeps its name (apps/mobile/src/services/checkin.ts matches it in the 23505 text) and
--     gains "and voided_at is null". Dropped and re-created in this one transaction, so no write can slip in between.
--
-- The updaters (check_out, check_out_member, run_check_in_auto_timeout_job) are unchanged and, with the stale branch inside
-- record_check_in, are the only functions that set checked_out_at. The 0111 direct-write revokes are re-asserted.
--
-- No dirty_from or engagement object (Epic 30), no staff function, no void function, no UI (27.3).
--
-- Rollback: scripts/rollback-0174-record-check-in.sql.
-- ============================================================================
set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- Columns and CHECKs.
-- ----------------------------------------------------------------------------
alter table public.attendance_events
  add column source text not null default 'qr',
  add column entered_by uuid references public.users (id),
  add column voided_by uuid references public.users (id),
  add column void_reason text;

alter table public.attendance_events
  add constraint attendance_events_source_check check (source in ('qr', 'staff')),
  add constraint attendance_events_entered_by_iff_staff check ((entered_by is not null) = (source = 'staff')),
  add constraint attendance_events_void_all_or_none check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null and void_reason is not null)
  ),
  add constraint attendance_events_void_reason_length check (void_reason is null or char_length(btrim(void_reason)) between 5 and 300);

-- ----------------------------------------------------------------------------
-- attendance_counted: append source. Explicit column list kept; never entered_by or a void column.
-- ----------------------------------------------------------------------------
create or replace view public.attendance_counted with (security_invoker = true) as
select
  ae.id,
  ae.gym_id,
  ae.member_id,
  ae.checked_in_at,
  ae.checked_out_at,
  ae.checkout_type,
  ae.visit_day,
  ae.created_at,
  ae.client_scan_id,
  ae.source
from public.attendance_events ae
where ae.voided_at is null;

-- ----------------------------------------------------------------------------
-- The one-open index: same name, voided rows no longer count as open. One transaction: no window without an index.
-- ----------------------------------------------------------------------------
drop index public.idx_attendance_events_one_open_per_member;
create unique index idx_attendance_events_one_open_per_member
  on public.attendance_events (member_id)
  where checked_out_at is null and voided_at is null;

-- ----------------------------------------------------------------------------
-- private.record_check_in
-- ----------------------------------------------------------------------------
create function private.record_check_in(
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
    select c.outcome, c.session_created_at into v_gate_outcome, v_session_created_at
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
-- check_in(): role gate, one call, outcome mapping. Signature, RETURNS and grants unchanged.
-- ----------------------------------------------------------------------------
create or replace function public.check_in(p_scanned_at timestamptz default null, p_client_scan_id uuid default null)
returns attendance_events
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_gym_id uuid;
  v_member_id uuid;
  v_outcome text;
  v_status subscription_status;
  v_expiry_date date;
  v_event attendance_events;
  r record;
begin
  if (select private.current_member_role())::text is distinct from 'member' then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  -- order by deactivated_at nulls first: idx_members_active_gym_user (0003) only guarantees uniqueness among *active* rows, so prefer
  -- the active row over a deactivated historical one for the same user and gym.
  select id into v_member_id
  from members
  where user_id = auth.uid() and gym_id = v_gym_id
  order by deactivated_at nulls first
  limit 1;

  if v_member_id is null then
    raise exception 'check_in: no member record found for the caller';
  end if;

  select * into r
  from private.record_check_in(v_member_id, v_gym_id, 'qr', auth.uid(), p_scanned_at, p_client_scan_id);
  v_outcome := r.outcome;
  v_status := r.member_status;
  v_expiry_date := r.expiry_date;
  v_event := r.event;

  if v_outcome in ('checked_in', 'replayed') then
    -- Story 4.6 AC #1: a yellow alert for an accepted at-risk entry (not for a replay, which wrote nothing).
    if v_outcome = 'checked_in' and v_status in ('expiring_soon', 'grace_period') then
      insert into front_desk_alerts (gym_id, member_id, status, expiry_date)
      values (v_gym_id, v_member_id, v_status, v_expiry_date)
      on conflict (member_id, kind, status) where dismissed_at is null do nothing;
    end if;
    return v_event;
  end if;

  if v_outcome = 'already_open' then
    raise exception 'check_in: member % already has an open check-in', v_member_id;
  end if;

  if v_outcome = 'blocked_expired' then
    -- Story 4.6 AC #2 / FR-031: a red alert instead of an exception; a missing plan reads as expired. One standing alert per member.
    insert into front_desk_alerts (gym_id, member_id, status, expiry_date)
    values (v_gym_id, v_member_id, 'expired', v_expiry_date)
    on conflict (member_id, kind, status) where dismissed_at is null do nothing;
    return null;
  end if;

  if v_outcome = 'blocked_session' then
    -- One attempt per scan id (a retry of the same offline scan is conflict-skipped); a null scan id always records a new attempt.
    insert into session_attempts (gym_id, member_id, scan_id, source, scanned_at)
    values (v_gym_id, v_member_id, p_client_scan_id, 'check_in', least(p_scanned_at, now()))
    on conflict (gym_id, member_id, scan_id) where scan_id is not null do nothing;

    -- One active session_required alert per member.
    insert into front_desk_alerts (gym_id, member_id, kind, status, expiry_date)
    values (v_gym_id, v_member_id, 'session_required', null, null)
    on conflict (member_id, kind, status) where dismissed_at is null do nothing;
    return null;
  end if;

  raise exception 'check_in: unexpected outcome %', v_outcome;
end;
$function$;

-- ----------------------------------------------------------------------------
-- Re-assert privileges: check_in() as 0124 left it, the 0111 direct-write closure.
-- ----------------------------------------------------------------------------
revoke execute on function public.check_in(timestamptz, uuid) from public, anon;
grant execute on function public.check_in(timestamptz, uuid) to authenticated;

revoke insert, update, delete on public.attendance_events from authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Verify.
-- ----------------------------------------------------------------------------
do $verify$
begin
  if position('consume_guest_session' in (
       select prosrc from pg_proc where oid = 'private.record_check_in(uuid, uuid, text, uuid, timestamptz, uuid)'::regprocedure)) = 0 then
    raise exception '0174: record_check_in does not call consume_guest_session()';
  end if;
  if position('current_gym_status' in (
       select prosrc from pg_proc where oid = 'private.record_check_in(uuid, uuid, text, uuid, timestamptz, uuid)'::regprocedure)) = 0 then
    raise exception '0174: record_check_in does not check the gym status';
  end if;
  if position('record_check_in' in (
       select prosrc from pg_proc where oid = 'public.check_in(timestamptz, uuid)'::regprocedure)) = 0 then
    raise exception '0174: check_in() does not call record_check_in()';
  end if;
  if exists (
    select 1 from pg_proc p where p.oid = 'private.record_check_in(uuid, uuid, text, uuid, timestamptz, uuid)'::regprocedure
      and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE')
           or has_function_privilege('service_role', p.oid, 'EXECUTE'))
  ) then
    raise exception '0174: record_check_in must not be executable by anon, authenticated or service_role';
  end if;
  if has_table_privilege('authenticated', 'public.attendance_events', 'INSERT')
    or has_table_privilege('authenticated', 'public.attendance_events', 'UPDATE')
    or has_table_privilege('authenticated', 'public.attendance_events', 'DELETE')
    or has_table_privilege('service_role', 'public.attendance_events', 'INSERT')
    or has_table_privilege('service_role', 'public.attendance_events', 'UPDATE')
    or has_table_privilege('service_role', 'public.attendance_events', 'DELETE') then
    raise exception '0174: attendance_events has a client write grant';
  end if;
  if (select indexdef from pg_indexes where schemaname = 'public' and indexname = 'idx_attendance_events_one_open_per_member')
       not like '%WHERE ((checked_out_at IS NULL) AND (voided_at IS NULL))%' then
    raise exception '0174: the one-open index must exclude voided rows';
  end if;
  if exists (select 1 from public.attendance_events where source <> 'qr' or entered_by is not null) then
    raise exception '0174: an existing row is not a scan';
  end if;
  if (select array_agg(attname::text order by attnum) from pg_attribute
      where attrelid = 'public.attendance_counted'::regclass and attnum > 0 and not attisdropped) @> array['entered_by']::text[] then
    raise exception '0174: attendance_counted must not carry entered_by';
  end if;
end
$verify$;
