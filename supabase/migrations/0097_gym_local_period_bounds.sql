-- Story 17.2: gym-local period bounds for the AD-02 Overview's Manager-plus
-- gym-health row ("New this month" and "Today's classes", FR-143).
--
-- WHAT THIS CLOSES. Both cards are plain PostgREST head counts
-- (`count: "exact", head: true`), so max_rows never truncates them, and both
-- windows are gym-local. The month arithmetic already lives in 0095's
-- private.gym_local_month_bounds(), but PostgREST exposes only the `public`
-- and `graphql_public` schemas (supabase/config.toml:13), so a COUNT query
-- built in the app cannot reach a `private` helper. This migration adds one
-- public wrapper, gym_local_period_bounds(), that hands the app the current
-- gym-local month and day bounds, plus the day helper it needs. The counts
-- themselves stay in the services, as ordinary RLS-scoped reads.
--
-- WHY SECURITY INVOKER ON BOTH, NO DEFINER ANYWHERE. Neither function reads a
-- gated table. The wrapper reads one `gyms` row under "read own gym" (0009,
-- `id = private.gym_id()`, no role predicate), which is exactly the caller's
-- own gym, and returns calendar bounds, which are not tenant data. Invoker
-- rights therefore grant nothing new. No suspension guard either, and no
-- entry in suspension_rpc_coverage.test.sql (it audits DEFINER functions that
-- write gated tables): a suspended gym still gets its bounds, and the counts
-- run against them come back 0 through tenant_active_gate (0073).
--
-- THE MONTH BOUNDS ARE REUSED, NOT RE-DERIVED. 0095's header requires Story
-- 17.2's "New this month" to call private.gym_local_month_bounds(), so it and
-- 17.1's "Revenue this month" describe the same period. Do not inline that
-- arithmetic here, and do not replace it with a separate
-- date_trunc('month', ...)::date.
--
-- THE DAY HELPER FOLLOWS 0095'S RULE. `+ interval '1 day'` is added to the
-- gym-local TIMESTAMP, inside the date_trunc() expression, and only then
-- converted back with `at time zone`. Added to the resulting timestamptz
-- instead, the day arithmetic runs in the session timezone (UTC under
-- PostgREST) and is wrong on every DST-transition day: for Europe/Paris that
-- form ends 2026-03-29 at 23:00+00 instead of 22:00+00. None of the gym
-- timezones the app allows today has DST, which is exactly why the rule must
-- hold anyway -- a wrong form would stay invisible until one does. The verify
-- block below and gym_local_period_bounds.test.sql both pin it.
--
-- DATES FOR THE MONTH, INSTANTS FOR THE DAY. members.join_date is a `date`
-- (0003), so "New this month" compares it against gym-local YYYY-MM-DD values
-- and no offset arithmetic happens in TypeScript. They are derived from the
-- month helper's instants (`at time zone tz`, then ::date), so the period is
-- the helper's, not a second calculation. class_sessions.scheduled_at is a
-- timestamptz (0057), so "Today's classes" gets UTC instants.
--
-- ZERO ROWS MEANS NO VISIBLE GYMS ROW -- no gym_id claim, or a gym the caller
-- cannot read. The service maps that to not_found rather than inventing a
-- window.
--
-- Numbered 0097, not 0096: 0096 is reserved for Story 17.4's roster RPC. This
-- migration calls 0095's helper, so it must apply after 0095.

-- The gym-local calendar day containing `p_at`, as a half-open UTC range
-- [day_start, next_day_start). IMMUTABLE: it reads no table, and every
-- function it calls (timezone(), date_trunc() on a timestamp) is immutable.
create function private.gym_local_day_bounds(p_timezone text, p_at timestamptz)
returns table (day_start timestamptz, next_day_start timestamptz)
language sql
immutable
set search_path = public, pg_temp
as $$
  select
    date_trunc('day', p_at at time zone p_timezone) at time zone p_timezone,
    (date_trunc('day', p_at at time zone p_timezone) + interval '1 day') at time zone p_timezone;
$$;

-- gym_local_period_bounds() runs with the CALLER's rights, so the caller needs
-- EXECUTE on the helper too (schema usage on `private` is already granted,
-- 0009).
revoke execute on function private.gym_local_day_bounds from public;
grant execute on function private.gym_local_day_bounds to authenticated;

create function gym_local_period_bounds()
returns table (month_start_date date, next_month_start_date date, day_start timestamptz, next_day_start timestamptz)
language sql
stable
set search_path = public, pg_temp
as $$
  select
    (m.month_start at time zone g.timezone)::date,
    (m.next_month_start at time zone g.timezone)::date,
    d.day_start,
    d.next_day_start
  from gyms g,
       private.gym_local_month_bounds(g.timezone, now()) m,
       private.gym_local_day_bounds(g.timezone, now()) d
  where g.id = private.gym_id();
$$;

-- Postgres grants EXECUTE to PUBLIC on new functions by default -- revoked
-- explicitly, per 0087's and 0095's discipline.
revoke execute on function gym_local_period_bounds from public;
grant execute on function gym_local_period_bounds to authenticated;

do $verify$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'gym_local_period_bounds' and p.pronargs = 0
  ) then
    raise exception '0097: gym_local_period_bounds() was not created';
  end if;

  -- A NULL proacl means the default ACL, which includes EXECUTE for PUBLIC.
  if exists (
    select 1 from pg_proc p
    where p.oid in ('public.gym_local_period_bounds()'::regprocedure,
                    'private.gym_local_day_bounds(text, timestamptz)'::regprocedure)
      and (
        p.proacl is null
        or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
      )
  ) then
    raise exception '0097: EXECUTE on gym_local_period_bounds() and private.gym_local_day_bounds() must not be granted to PUBLIC';
  end if;

  -- See the header: neither function has any reason to bypass RLS.
  if exists (
    select 1 from pg_proc p
    where p.oid in ('public.gym_local_period_bounds()'::regprocedure,
                    'private.gym_local_day_bounds(text, timestamptz)'::regprocedure)
      and p.prosecdef
  ) then
    raise exception '0097: gym_local_period_bounds() and private.gym_local_day_bounds() must be SECURITY INVOKER';
  end if;

  -- See the header: a 23-hour DST day, where the wrong form ends at 23:00+00.
  if (select row(b.day_start, b.next_day_start)
      from private.gym_local_day_bounds('Europe/Paris', '2026-03-29 12:00+00') b)
     is distinct from row('2026-03-28 23:00+00'::timestamptz, '2026-03-29 22:00+00'::timestamptz) then
    raise exception '0097: private.gym_local_day_bounds() must place 2026-03-29 in Europe/Paris at [2026-03-28 23:00+00, 2026-03-29 22:00+00) -- has + interval ''1 day'' moved outside the at time zone round-trip?';
  end if;
end;
$verify$;
