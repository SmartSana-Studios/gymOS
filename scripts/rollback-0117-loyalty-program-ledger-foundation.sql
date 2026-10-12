-- Rollback for migration 0117 (loyalty program setting & ledger foundation).
-- DESTRUCTIVE: drops loyalty_events and loyalty_progress with their data and the
-- four gyms.loyalty_* columns. Run only before 20.2+ has awarded anything, or
-- accept losing the ledger. Audit rows of type loyalty_program_changed stay.
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0117-loyalty-program-ledger-foundation.sql

-- Fail fast rather than queue gyms / guest_sessions writes behind a long transaction.
set local lock_timeout = '5s';

-- Refuse to destroy a ledger that already holds events, progress, or grants.
do $guard$
begin
  if exists (select 1 from public.loyalty_events)
     or exists (select 1 from public.loyalty_progress)
     or exists (select 1 from public.guest_sessions where loyalty_grant_id is not null) then
    raise exception 'rollback-0117: loyalty data exists; refusing to drop the ledger';
  end if;
end;
$guard$;

drop function if exists public.effective_loyalty(uuid);
drop function if exists public.set_loyalty_program(boolean, integer, integer, integer);

alter table public.guest_sessions drop constraint if exists guest_sessions_loyalty_grant_fkey;
alter table public.guest_sessions drop column if exists loyalty_grant_event_type;

drop table if exists public.loyalty_progress;
drop table if exists public.loyalty_events;

drop trigger if exists protect_loyalty_program_columns on public.gyms;
drop function if exists private.protect_loyalty_program_columns();

alter table public.gyms
  drop constraint if exists gyms_loyalty_enabled_requires_values,
  drop constraint if exists gyms_loyalty_guest_threshold_range,
  drop constraint if exists gyms_loyalty_renewal_threshold_range,
  drop constraint if exists gyms_loyalty_reward_days_range,
  drop column if exists loyalty_enabled,
  drop column if exists loyalty_guest_threshold,
  drop column if exists loyalty_renewal_threshold,
  drop column if exists loyalty_reward_days;

do $verify$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'gyms' and column_name like 'loyalty\_%'
  ) then
    raise exception 'rollback-0117: gyms loyalty columns still present';
  end if;
  if to_regclass('public.loyalty_events') is not null or to_regclass('public.loyalty_progress') is not null then
    raise exception 'rollback-0117: loyalty tables still present';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'guest_sessions' and column_name = 'loyalty_grant_event_type'
  ) then
    raise exception 'rollback-0117: guest_sessions grant column still present';
  end if;
  if exists (
    select 1 from pg_proc
    where pronamespace in ('public'::regnamespace, 'private'::regnamespace)
      and proname in ('effective_loyalty', 'set_loyalty_program', 'protect_loyalty_program_columns')
  ) then
    raise exception 'rollback-0117: functions still present';
  end if;
end;
$verify$;
