-- A gym owner must never be a Super Admin (and the reverse). The Super Admin app already refused to hand a new gym
-- to a Super Admin (createGym, owner_is_super_admin) but nothing stopped the other direction: promoting an existing
-- owner, or making a Super Admin the owner of a gym by another path. One identity on both sides of the
-- platform/tenant boundary is what escalation grants (Story 1.7/1.15) exist to avoid.
--
-- Two BEFORE triggers, so every path is covered (the promote RPC, the operator CLI, plain SQL):
--   users   : is_super_admin may not become true while the account holds an ACTIVE owner membership
--   members : an ACTIVE owner membership may not be created for (or moved to) a Super Admin account
-- Existing data: production and local have no such account (checked 2026-10-17). Rollback:
-- scripts/rollback-0130-owner-never-super-admin.sql.

create or replace function private.guard_super_admin_not_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_super_admin
     and (tg_op = 'INSERT' or not coalesce(old.is_super_admin, false))
     and exists (
       select 1 from members m
        where m.user_id = new.id and m.role = 'owner' and m.deactivated_at is null
     ) then
    raise exception 'owner_is_super_admin: a gym owner cannot be a Super Admin' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create or replace function private.guard_owner_not_super_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role = 'owner'
     and new.deactivated_at is null
     and new.user_id is not null
     and coalesce((select u.is_super_admin from users u where u.id = new.user_id), false) then
    raise exception 'owner_is_super_admin: a Super Admin cannot be a gym owner' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_super_admin_not_owner() from public, anon, authenticated;
revoke all on function private.guard_owner_not_super_admin() from public, anon, authenticated;

drop trigger if exists guard_super_admin_not_owner on public.users;
create trigger guard_super_admin_not_owner
  before insert or update of is_super_admin on public.users
  for each row execute function private.guard_super_admin_not_owner();

drop trigger if exists guard_owner_not_super_admin on public.members;
create trigger guard_owner_not_super_admin
  before insert or update of role, user_id, deactivated_at on public.members
  for each row execute function private.guard_owner_not_super_admin();

do $verify$
begin
  if exists (
    select 1 from members m join users u on u.id = m.user_id
     where u.is_super_admin and m.role = 'owner' and m.deactivated_at is null
  ) then
    raise exception '0130: an active gym owner is already a Super Admin; resolve it before applying';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.users'::regclass and tgname = 'guard_super_admin_not_owner')
     or not exists (select 1 from pg_trigger where tgrelid = 'public.members'::regclass and tgname = 'guard_owner_not_super_admin') then
    raise exception '0130: guard triggers missing';
  end if;
end
$verify$;
