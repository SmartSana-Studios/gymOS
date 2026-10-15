-- Rollback for migration 0123 (gym category).
-- DESTRUCTIVE: drops gyms.category and with it every gym's chosen category.
-- Audit rows of type gym_category_changed stay. Roll the app code back first:
-- the Super Admin create/detail/list screens and Settings read the column.
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0123-gym-category.sql

-- Fail fast rather than queue gyms writes behind a long transaction.
set local lock_timeout = '5s';

drop function if exists public.set_gym_category(uuid, text);

drop trigger if exists pin_gym_category on public.gyms;
drop function if exists private.pin_gym_category();

alter table public.gyms
  drop constraint if exists gyms_category_valid,
  drop column if exists category;

do $verify$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'gyms' and column_name = 'category'
  ) then
    raise exception 'rollback-0123: gyms.category still present';
  end if;
  if exists (
    select 1 from pg_proc
    where pronamespace in ('public'::regnamespace, 'private'::regnamespace)
      and proname in ('set_gym_category', 'pin_gym_category')
  ) then
    raise exception 'rollback-0123: functions still present';
  end if;
end;
$verify$;
