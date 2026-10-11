-- Forward-fix rollback for migration 0113 (session refunds & revenue line).
-- Restores gym_revenue_mtd() as of 0101 (session payments counted in the
-- headline again) and drops the refund trigger, the two audit triggers, the
-- reversal hook and gym_session_revenue_mtd().
--
-- Not undone: sessions already voided by a refund stay voided (the refund
-- happened), and audit_log rows written by the triggers stay (append-only).
--
-- Run with host psql, one transaction:
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0113-session-refunds-revenue-line.sql

drop trigger if exists apply_session_refund on public.refunds;
drop trigger if exists audit_session_consumed on public.guest_sessions;
drop trigger if exists audit_session_attempt_blocked on public.session_attempts;

drop function if exists private.apply_session_refund();
drop function if exists private.audit_session_consumed();
drop function if exists private.audit_session_attempt_blocked();
drop function if exists private.on_session_refunded_after_consumption(uuid, uuid, uuid);

drop function if exists public.gym_session_revenue_mtd();

create or replace function public.gym_revenue_mtd()
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
        and p.voided_at is null
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

revoke execute on function public.gym_revenue_mtd() from public, anon;
grant execute on function public.gym_revenue_mtd() to authenticated;
