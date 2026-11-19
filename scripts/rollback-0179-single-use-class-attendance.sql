-- Rollback for migration 0179: class attendance in a Single-use gym (Epic 28, Story 28.3).
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0179-single-use-class-attendance.sql
--
-- VALID ONLY WHILE NO guest_sessions ROW IS covered_kind = 'class'. The restored 0178 consume function raises class_single_use_unsupported
-- for a class in a Single-use gym and cannot reason about a class row (single_use, booking id, no day, no attendance); a class row would
-- sit unexplained in the Used column and in the audit. The script refuses, naming the count. Rows written by 0179 in a whole_day gym are
-- identical to the older ones, so nothing else is lost. The session_consumed audit rows already written keep their covered_booking_id key
-- (audit_log is append-only).
--
-- Restores: private.consume_guest_session as 0178 left it (four arguments), public.mark_class_attendance as 0178 left it,
-- private.audit_session_consumed as 0177 left it, public.list_guest_sessions_paid as 0114 left it.
set local lock_timeout = '5s';

do $$
begin
  if exists (select 1 from public.guest_sessions where covered_kind = 'class') then
    raise exception '0179 rollback refused: % guest_sessions row(s) are covered_kind = class', (select count(*) from public.guest_sessions where covered_kind = 'class');
  end if;
end;
$$;

-- The 5-argument consume function goes first: the callers are recreated against the 4-argument one.
drop function private.consume_guest_session(uuid, uuid, timestamptz, text, uuid);

create function private.consume_guest_session(p_member_id uuid, p_gym_id uuid, p_receipt_at timestamptz, p_kind text default 'visit')
returns table (outcome text, session_created_at timestamptz, session_id uuid)
language plpgsql
set search_path = public
as $$
declare
  v_charging boolean;
  v_timezone text;
  v_validity text;
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
  select g.charge_guests_per_session, g.timezone, g.session_validity into v_charging, v_timezone, v_validity
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

  -- Story 28.3 removes this guard. Placed after the exempt returns: an exempt member consumes nothing, so a class mark for one is not
  -- the unsupported case.
  if p_kind = 'class' and v_validity = 'single_use' then
    raise exception 'class_single_use_unsupported';
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

  if v_validity = 'single_use' then
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

revoke execute on function private.consume_guest_session(uuid, uuid, timestamptz, text) from public, anon, authenticated;

-- private.audit_session_consumed as 0177 left it.
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
    )
  );
  return new;
end;
$$;

revoke execute on function private.audit_session_consumed() from public, anon, authenticated;

-- public.mark_class_attendance as 0178 left it.
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
    from private.consume_guest_session(v_member_id, v_gym_id, now(), 'class') c;

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

-- public.list_guest_sessions_paid as 0114 left it.
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
  total_count bigint
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
      end as recorder_kind
    from payments p
    join members m on m.id = p.member_id
    left join guest_sessions gs on gs.payment_id = p.id
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
    count(*) over ()
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

do $verify$
declare
  v_src text;
begin
  if to_regprocedure('private.consume_guest_session(uuid, uuid, timestamptz, text, uuid)') is not null then
    raise exception '0179 rollback: the 5-argument consume function still exists';
  end if;
  select prosrc into v_src from pg_proc where oid = 'private.consume_guest_session(uuid, uuid, timestamptz, text)'::regprocedure;
  if position('class_single_use_unsupported' in v_src) = 0 then
    raise exception '0179 rollback: the 0178 class guard was not restored';
  end if;
  select prosrc into v_src from pg_proc where oid = 'public.mark_class_attendance(uuid)'::regprocedure;
  if v_src !~ 'consume_guest_session\(v_member_id, v_gym_id, now\(\), ''class''\)' then
    raise exception '0179 rollback: mark_class_attendance was not restored';
  end if;
  if (select pg_get_function_result('public.list_guest_sessions_paid(text, boolean, boolean, integer, integer)'::regprocedure)) like '%class_name%' then
    raise exception '0179 rollback: list_guest_sessions_paid kept its 0179 columns';
  end if;
  if exists (
    select 1 from pg_proc p
    where p.oid = 'private.consume_guest_session(uuid, uuid, timestamptz, text)'::regprocedure
      and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE')
           or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0))
  ) then
    raise exception '0179 rollback: the consume function must not be executable by public, anon or authenticated';
  end if;
end;
$verify$;
