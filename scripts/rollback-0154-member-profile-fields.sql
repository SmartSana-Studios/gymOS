-- Rollback for migration 0154 (member profile fields).
-- DESTRUCTIVE: drops members.birth_year, profession and neighborhood and every
-- value entered. Roll the app code back first: member create/edit/detail and
-- the export select the columns.
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0154-member-profile-fields.sql

-- Fail fast rather than queue members writes behind a long transaction.
set local lock_timeout = '5s';

-- Restore the 0072 body (without the three pins) before dropping the columns.
create or replace function private.protect_self_managed_member_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() = old.user_id then
    new.gym_id := old.gym_id;
    new.user_id := old.user_id;
    new.phone := old.phone;
    new.dob := old.dob;
    new.photo_url := old.photo_url;
    new.join_date := old.join_date;
    new.emergency_contact := old.emergency_contact;
    new.deactivated_at := old.deactivated_at;
    new.created_at := old.created_at;

    if coalesce(current_setting('app.staff_role_update_bypass', true), 'false') <> 'true' then
      new.role := old.role;
      new.name := old.name;
    end if;

    if coalesce(current_setting('app.owner_notification_email_update_bypass', true), 'false') <> 'true' then
      new.email := old.email;
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function private.protect_self_managed_member_columns() from public, anon, authenticated;

alter table public.members
  drop constraint if exists members_birth_year_range,
  drop constraint if exists members_profession_length,
  drop constraint if exists members_neighborhood_length,
  drop column if exists birth_year,
  drop column if exists profession,
  drop column if exists neighborhood;

do $verify$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'members'
      and column_name in ('birth_year', 'profession', 'neighborhood')
  ) then
    raise exception 'rollback-0154: members profile columns still present';
  end if;
  if pg_get_functiondef('private.protect_self_managed_member_columns()'::regprocedure) like '%birth_year%' then
    raise exception 'rollback-0154: trigger function still pins birth_year';
  end if;
end;
$verify$;
