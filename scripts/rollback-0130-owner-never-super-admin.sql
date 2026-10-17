-- Rollback for migration 0130 (owner never Super Admin): drops the two triggers and their functions.
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0130-owner-never-super-admin.sql
set local lock_timeout = '5s';
drop trigger if exists guard_owner_not_super_admin on public.members;
drop trigger if exists guard_super_admin_not_owner on public.users;
drop function if exists private.guard_owner_not_super_admin();
drop function if exists private.guard_super_admin_not_owner();
