-- Story 17.1: month-to-date revenue for the AD-02 Overview's "Revenue this
-- month" card (FR-143).
--
-- WHAT THIS CLOSES. The staff Overview has shipped as a heading and a
-- placeholder paragraph since Story 4.6 deferred AD-02's stat cards. This is
-- the one figure on that screen no existing service can produce: net takings
-- for the current calendar month, in the gym's own local time.
--
-- WHY A DATABASE AGGREGATE, NOT A CLIENT-SIDE SUM. supabase/config.toml sets
-- `max_rows = 1000`. A PostgREST row fetch past that limit is truncated
-- silently, with no error, so a gym taking more than 1,000 payments in a month
-- would be shown an understated figure with nothing to say anything was wrong.
-- `max_rows` limits the RESPONSE; it does not apply to a sum() evaluated inside
-- this function, which returns a single scalar.
--
-- WHY SECURITY INVOKER, NOT DEFINER. RLS stays the authorization boundary
-- (AD-1). `gym_staff_read_own_payments` and `gym_staff_read_own_refunds`
-- already grant exactly AD-02's audience (owner/manager/supervisor/
-- receptionist, per 0093), and both tables carry the `tenant_active_gate`
-- RESTRICTIVE policy (0073). Under invoker rights this function inherits all
-- of that: the right figure for staff, 0 for a coach (in neither policy), 0 for
-- a suspended gym. Under DEFINER rights it would instead be a new privilege
-- that bypasses RLS, needing its own role allowlist, its own suspension guard
-- and an entry in suspension_rpc_coverage.test.sql -- three ways to get it
-- wrong in exchange for nothing. So: no `private.current_gym_status()` guard
-- here, deliberately, and this function does not belong in that meta-test
-- (which audits DEFINER functions that write gated tables).
--
-- A THIRD RLS-GATED READ. The month bounds come from `gyms.timezone`, read
-- under the caller's rights via "read own gym" (0009, `id = private.gym_id()`,
-- no role predicate). `gyms` deliberately carries no tenant_active_gate, so
-- both apps can still detect a suspension. If the gyms row were ever not
-- visible, the bounds would be undefined and nothing would match -- the
-- coalesce(..., 0) around each sum keeps that a clean 0 rather than NULL.
--
-- THE MONTH WINDOW IS GYM-LOCAL AND HALF-OPEN [start, end). At UTC+1 a payment
-- taken at 00:30 local on the 1st is 23:30 UTC on the last day of the prior
-- month, so UTC bucketing would misfile it. This is the first calendar-date
-- query in the schema to use gyms.timezone (0022:60-64 records the accepted
-- UTC gap everywhere else); it is closed here for revenue only, because the
-- epic AC and EXPERIENCE.md's AD-02 V2 amendment both say "in gym-local time".
--
-- THE MONTH ARITHMETIC LIVES IN ONE HELPER, private.gym_local_month_bounds().
-- Inside it, `+ interval '1 month'` IS ADDED TO THE GYM-LOCAL TIMESTAMP, INSIDE
-- the date_trunc() expression, and only then converted back with `at time
-- zone`. Adding it to the resulting timestamptz instead runs the month
-- arithmetic in the session timezone (UTC under PostgREST) and silently drops
-- days: for Africa/Douala that form ends March at 2026-03-28 23:00+00 instead
-- of 2026-03-31 23:00+00 -- three days of revenue lost, with no error -- and
-- one day in May, July, October and December. It is correct in the other
-- seven months, so no test pinned to now() can see it most of the year: the
-- first draft of this migration inlined the expression, and its pgTAP boundary
-- rows would have stayed green in September (Story 17.1 code review). Taking
-- an explicit instant, the helper is proven at fixed dates -- every month, in
-- every timezone the app allows (gym_revenue_mtd.test.sql) -- and checked once
-- more at apply time below. Story 17.2's "New this month" must call this same
-- helper, so the two cards describe the same period. Do not inline it back,
-- and do not "simplify" it.
--
-- BUCKETED BY created_at, WHICH IS INITIATION TIME. `payments` has no
-- verified_at/paid_at column; every row is inserted pending/processing and
-- later UPDATEd to verified (0031). Accepted consequence: a payment initiated
-- on the last day of a month and verified on the first of the next counts into
-- the earlier month. Adding a verified_at column would need a historical
-- backfill with unknowable semantics, and is out of Story 17.1's scope.
--
-- VERIFIED ONLY. payment_status is (pending, processing, verified, flagged):
-- pending/processing is money not yet confirmed, flagged is money in dispute.
--
-- REFUNDS SUBTRACT, AND ARE ATTRIBUTED BY REFUND DATE. refunds.amount is
-- stored POSITIVE (0033, refunds_amount_positive), so it must be subtracted,
-- not summed in. A refund recorded this month against last month's payment
-- reduces THIS month -- which is what FR-143 ("refunds recorded in the same
-- period") and EXPERIENCE.md ("recorded in the same calendar month") specify,
-- and the only thing expressible without a payment-date join. Not a bug; do
-- not "fix" it. The figure can therefore be negative in a month whose refunds
-- exceed its verified takings, and the UI shows it as-is.
--
-- CURRENCY IS NOT FILTERED. payments.currency and refunds.currency both
-- default 'XAF' and there is no per-gym currency column; V1 is
-- single-currency. Summing across currencies would be wrong the day that
-- changes, and this function must change with it.

-- The gym-local calendar month containing `p_at`, as a half-open UTC range
-- [month_start, next_month_start). IMMUTABLE: it reads no table, and every
-- function it calls (timezone(), date_trunc() on a timestamp) is immutable.
create function private.gym_local_month_bounds(p_timezone text, p_at timestamptz)
returns table (month_start timestamptz, next_month_start timestamptz)
language sql
immutable
set search_path = public, pg_temp
as $$
  select
    date_trunc('month', p_at at time zone p_timezone) at time zone p_timezone,
    (date_trunc('month', p_at at time zone p_timezone) + interval '1 month') at time zone p_timezone;
$$;

-- gym_revenue_mtd() runs with the CALLER's rights, so the caller needs EXECUTE
-- on the helper too (schema usage on `private` is already granted, 0009).
revoke execute on function private.gym_local_month_bounds from public;
grant execute on function private.gym_local_month_bounds to authenticated;

create function gym_revenue_mtd()
returns bigint
language sql
stable
set search_path = public, pg_temp
as $$
  select
    coalesce((
      select sum(p.amount)
      from gyms g, private.gym_local_month_bounds(g.timezone, now()) b, payments p
      where g.id = private.gym_id()
        and p.gym_id = g.id
        and p.status = 'verified'
        and p.created_at >= b.month_start
        and p.created_at <  b.next_month_start
    ), 0)
    -
    coalesce((
      select sum(r.amount)
      from gyms g, private.gym_local_month_bounds(g.timezone, now()) b, refunds r
      where g.id = private.gym_id()
        and r.gym_id = g.id
        and r.created_at >= b.month_start
        and r.created_at <  b.next_month_start
    ), 0);
$$;

-- Postgres grants EXECUTE to PUBLIC on new functions by default -- revoked
-- explicitly, per 0087's discipline (0011's aggregate functions omitted this;
-- do not copy that).
revoke execute on function gym_revenue_mtd from public;
grant execute on function gym_revenue_mtd to authenticated;

do $verify$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'gym_revenue_mtd' and p.pronargs = 0
  ) then
    raise exception '0095: gym_revenue_mtd() was not created';
  end if;

  -- A NULL proacl means the default ACL, which includes EXECUTE for PUBLIC.
  if exists (
    select 1 from pg_proc p
    where p.oid in ('public.gym_revenue_mtd()'::regprocedure,
                    'private.gym_local_month_bounds(text, timestamptz)'::regprocedure)
      and (
        p.proacl is null
        or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
      )
  ) then
    raise exception '0095: EXECUTE on gym_revenue_mtd() and private.gym_local_month_bounds() must not be granted to PUBLIC';
  end if;

  -- See the header: DEFINER rights would bypass the RLS policies this
  -- function exists to inherit.
  if (select p.prosecdef from pg_proc p where p.oid = 'public.gym_revenue_mtd()'::regprocedure) then
    raise exception '0095: gym_revenue_mtd() must be SECURITY INVOKER -- DEFINER rights would bypass the payments/refunds RLS it relies on';
  end if;

  -- See the header: the one month in which the wrong form loses the most.
  if (select row(b.month_start, b.next_month_start)
      from private.gym_local_month_bounds('Africa/Douala', '2026-03-15 12:00+00') b)
     is distinct from row('2026-02-28 23:00+00'::timestamptz, '2026-03-31 23:00+00'::timestamptz) then
    raise exception '0095: private.gym_local_month_bounds() must place March 2026 in Africa/Douala at [2026-02-28 23:00+00, 2026-03-31 23:00+00) -- has + interval ''1 month'' moved outside the at time zone round-trip?';
  end if;
end;
$verify$;
