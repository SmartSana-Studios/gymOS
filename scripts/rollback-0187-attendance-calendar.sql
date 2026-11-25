-- Rollback for migration 0187: the attendance calendar's two reads (Epic 30, Story 30.5).
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0187-attendance-calendar.sql
--
-- Drops public.my_visit_days(date) and public.my_first_visit_day(). Nothing else changed in 0187, and it wrote no data. Run it only after the
-- mobile calendar (apps/mobile services/visitDays.ts and the /calendar route) is rolled back or the app tolerates the two calls failing.
set local lock_timeout = '5s';

drop function public.my_first_visit_day();
drop function public.my_visit_days(date);
