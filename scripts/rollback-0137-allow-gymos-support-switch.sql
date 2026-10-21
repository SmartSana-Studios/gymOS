-- Rollback for migration 0137 (Allow GymOS Support switch).
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0137-allow-gymos-support-switch.sql
-- Assignments left suspended_by_switch stay suspended after the rollback (nothing could restore them); review before applying.
set local lock_timeout = '5s';
drop function if exists public.get_gymos_support_status(uuid);
drop function if exists public.set_allow_gymos_support(uuid, boolean);
drop function if exists private.support_gym_lock(uuid);
drop trigger if exists touch_support_assignment_updated_at on public.support_assignments;
drop function if exists private.touch_support_assignment_updated_at();
alter table public.support_assignments drop column if exists suspended_by_switch;
