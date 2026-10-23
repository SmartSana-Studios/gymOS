-- Rollback for migration 0153. Roll the dashboard back first: its proxy calls this function for every support request.
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0153-support-recertification-overdue.sql
-- Data effects: none.
set local lock_timeout = '5s';

drop function if exists public.support_recertification_overdue();
