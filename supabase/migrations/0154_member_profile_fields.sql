-- ============================================================================
-- 0154: Member profile fields (Epic 26, Story 26.1).
--
-- Three optional, staff-entered facts about a member:
--   members.birth_year   smallint, CHECK 1900..2100 (a check cannot use the
--                        current date; the app refuses a year after this one)
--   members.profession   text, at most 120 characters after trimming
--   members.neighborhood text, at most 120 characters after trimming
-- All nullable, existing rows stay null. No policy changes: the existing
-- gym-scoped member policies cover the columns exactly like phone and dob.
--
-- A member editing their own row through the API must not change them, so
-- private.protect_self_managed_member_columns() is replaced. Its body is
-- copied from 0072 (the latest definition: 0020 base, 0063 role/name bypass,
-- 0072 email bypass) with three added pins.
-- ============================================================================

-- Fail fast rather than queue members writes behind the ACCESS EXCLUSIVE lock the alter takes.
set local lock_timeout = '5s';

alter table members
  add column birth_year smallint
    constraint members_birth_year_range check (birth_year between 1900 and 2100),
  add column profession text
    constraint members_profession_length check (char_length(btrim(profession)) <= 120),
  add column neighborhood text
    constraint members_neighborhood_length check (char_length(btrim(neighborhood)) <= 120);

comment on column members.birth_year is
  'Optional year of birth, entered by staff. Shown only as an approximate age, never as a date.';
comment on column members.profession is
  'Optional profession, entered by staff (max 120 characters).';
comment on column members.neighborhood is
  'Optional neighborhood, entered by staff (max 120 characters).';

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
    new.birth_year := old.birth_year;
    new.profession := old.profession;
    new.neighborhood := old.neighborhood;
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

-- The migration proves its own result: the columns exist, the self-edit pin covers all three, and the replaced function is not
-- callable by clients (the anon-EXECUTE default-privilege trap).
do $verify$
declare
  v_def text := pg_get_functiondef('private.protect_self_managed_member_columns()'::regprocedure);
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'members'
         and column_name in ('birth_year', 'profession', 'neighborhood')) <> 3 then
    raise exception '0154: the members profile columns are missing';
  end if;
  if v_def not like '%new.birth_year := old.birth_year%'
     or v_def not like '%new.profession := old.profession%'
     or v_def not like '%new.neighborhood := old.neighborhood%' then
    raise exception '0154: the self-edit pin does not cover the profile fields';
  end if;
  if has_function_privilege('anon', 'private.protect_self_managed_member_columns()', 'execute')
     or has_function_privilege('authenticated', 'private.protect_self_managed_member_columns()', 'execute')
     or has_function_privilege('public', 'private.protect_self_managed_member_columns()', 'execute') then
    raise exception '0154: the self-edit pin function is callable by clients';
  end if;
end
$verify$;
