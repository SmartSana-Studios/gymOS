-- ============================================================================
-- 0114: Guest sessions Overview card and AD-22 drill-down (Epic 19, Story 19.10).
--
--   guest_sessions_summary(p_period)                      three period figures
--   list_guest_sessions_paid(p_period, ...)               paid sessions, paged,
--                                                         with full-window group totals
--   list_session_attempts(p_period, ...)                  blocked attempts, paged
--   list_free_guest_sessions(p_period, ...)               free sessions given, paged
--
-- All four are read-only, SECURITY INVOKER (RLS and the tenant_active_gate
-- stay in force, so a suspended gym reads zeros) and refuse every role but
-- owner/supervisor/manager with 42501. Counts are aggregate SQL, never a sum
-- over fetched rows. The period is the gym-local day or month, through the
-- same private helpers the revenue lines use (0095, 0097).
--
-- Window column per figure: payments.created_at (paid), session_attempts
-- .created_at (blocked: server receipt, even for an offline scan verified on
-- sync) and guest_sessions.created_at (free).
--
-- Rollback: scripts/rollback-0114-guest-sessions-overview-rpcs.sql
-- ============================================================================

-- Shared guard: role check + period bounds. Returns no row for a gym the
-- caller cannot read (suspended), which callers turn into zeros.
create function private.guest_sessions_period(p_period text)
returns table (window_start timestamptz, window_end timestamptz)
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_tz text;
begin
  if private.current_member_role() is null
     or private.current_member_role() not in ('owner', 'supervisor', 'manager') then
    raise exception 'guest_sessions: permission denied' using errcode = '42501';
  end if;

  if p_period is null or p_period not in ('today', 'month') then
    raise exception 'guest_sessions: invalid period %', coalesce(p_period, '<null>') using errcode = '22023';
  end if;

  select g.timezone into v_tz from gyms g where g.id = private.gym_id();
  if v_tz is null then
    return;
  end if;

  if p_period = 'today' then
    return query
      select b.day_start, b.next_day_start
      from private.gym_local_day_bounds(v_tz, now()) b;
  else
    return query
      select b.month_start, b.next_month_start
      from private.gym_local_month_bounds(v_tz, now()) b;
  end if;
end;
$$;

revoke execute on function private.guest_sessions_period(text) from public, anon;
grant execute on function private.guest_sessions_period(text) to authenticated;

-- 1. Summary ------------------------------------------------------------------

create function guest_sessions_summary(p_period text)
returns table (paid_count bigint, blocked_count bigint, blocked_members bigint, free_count bigint)
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
begin
  select w.window_start, w.window_end into v_start, v_end from private.guest_sessions_period(p_period) w;

  if v_start is null then
    paid_count := 0; blocked_count := 0; blocked_members := 0; free_count := 0;
    return next;
    return;
  end if;

  select count(*) into paid_count
  from payments p
  where p.gym_id = private.gym_id()
    and p.purpose = 'session'
    and p.status = 'verified'
    and p.voided_at is null
    and p.created_at >= v_start
    and p.created_at <  v_end;

  select count(*), count(distinct a.member_id) into blocked_count, blocked_members
  from session_attempts a
  where a.gym_id = private.gym_id()
    and a.created_at >= v_start
    and a.created_at <  v_end;

  select count(*) into free_count
  from guest_sessions s
  where s.gym_id = private.gym_id()
    and s.loyalty_grant_id is not null
    and s.created_at >= v_start
    and s.created_at <  v_end;

  return next;
end;
$$;

revoke execute on function guest_sessions_summary(text) from public, anon;
grant execute on function guest_sessions_summary(text) to authenticated;

-- 2. Paid sessions ---------------------------------------------------------------

-- Rows are ordered by recorder (when grouped) then newest first. group_sessions
-- and group_total are window aggregates over the WHOLE period (and the chip
-- filter), computed before LIMIT, so a header is right on every page.
-- refund_state: 'refunded' (unconsumed and voided), 'refunded_after_use'
-- (consumed and the payment has a refund), 'none' otherwise.
-- recorder_kind: 'staff' (actor resolves to a staff row), 'tara' (no staff
-- actor, paid through a provider), 'unknown'.
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

-- 3. Blocked attempts ------------------------------------------------------------

-- attempt_time is the scan time for an offline scan, otherwise server receipt;
-- synced_at is always server receipt (the "synced" time of an offline scan).
create function list_session_attempts(
  p_period text,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  attempt_id uuid,
  member_id uuid,
  member_name text,
  source text,
  class_name text,
  attempt_time timestamptz,
  scanned_at timestamptz,
  synced_at timestamptz,
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
  select
    a.id,
    a.member_id,
    m.name,
    a.source,
    c.name,
    coalesce(a.scanned_at, a.created_at),
    a.scanned_at,
    a.created_at,
    count(*) over ()
  from session_attempts a
  join members m on m.id = a.member_id
  left join class_sessions cs on cs.id = a.class_session_id
  left join classes c on c.id = cs.class_id
  where a.gym_id = private.gym_id()
    and a.created_at >= v_start
    and a.created_at <  v_end
  order by coalesce(a.scanned_at, a.created_at) desc, a.id
  limit v_limit offset v_offset;
end;
$$;

revoke execute on function list_session_attempts(text, integer, integer) from public, anon;
grant execute on function list_session_attempts(text, integer, integer) to authenticated;

-- 4. Free sessions given -----------------------------------------------------------

-- status: 'voided' | 'used' | 'lapsed' | 'available'.
create function list_free_guest_sessions(
  p_period text,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  session_id uuid,
  member_id uuid,
  member_name text,
  earned_at timestamptz,
  usable_until timestamptz,
  status text,
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
  select
    s.id,
    s.member_id,
    m.name,
    s.created_at,
    s.usable_until,
    case
      when s.voided_at is not null then 'voided'
      when s.consumed_at is not null then 'used'
      when s.usable_until < now() then 'lapsed'
      else 'available'
    end,
    count(*) over ()
  from guest_sessions s
  join members m on m.id = s.member_id
  where s.gym_id = private.gym_id()
    and s.loyalty_grant_id is not null
    and s.created_at >= v_start
    and s.created_at <  v_end
  order by s.created_at desc, s.id
  limit v_limit offset v_offset;
end;
$$;

revoke execute on function list_free_guest_sessions(text, integer, integer) from public, anon;
grant execute on function list_free_guest_sessions(text, integer, integer) to authenticated;

-- 5. Self-check -------------------------------------------------------------------

do $verify$
declare
  v_oid oid;
begin
  foreach v_oid in array array[
    'public.guest_sessions_summary(text)'::regprocedure::oid,
    'public.list_guest_sessions_paid(text, boolean, boolean, integer, integer)'::regprocedure::oid,
    'public.list_session_attempts(text, integer, integer)'::regprocedure::oid,
    'public.list_free_guest_sessions(text, integer, integer)'::regprocedure::oid
  ] loop
    if exists (
      select 1 from pg_proc p
      where p.oid = v_oid
        and (p.prosecdef
             or p.proacl is null
             or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
    ) then
      raise exception '0114: function % must be SECURITY INVOKER with no PUBLIC EXECUTE', v_oid::regprocedure;
    end if;
    if has_function_privilege('anon', v_oid, 'execute') then
      raise exception '0114: anon can execute %', v_oid::regprocedure;
    end if;
    if not has_function_privilege('authenticated', v_oid, 'execute') then
      raise exception '0114: authenticated lost EXECUTE on %', v_oid::regprocedure;
    end if;
  end loop;

  if exists (
    select 1 from pg_proc p
    where p.proname in ('guest_sessions_summary', 'list_guest_sessions_paid', 'list_session_attempts',
                        'list_free_guest_sessions', 'guest_sessions_period')
      and p.prosrc like '%auth.jwt()%'
  ) then
    raise exception '0114: role must come from private.current_member_role(), not the JWT';
  end if;
end;
$verify$;
