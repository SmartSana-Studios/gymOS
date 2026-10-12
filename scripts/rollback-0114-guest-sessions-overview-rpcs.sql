-- Rollback for migration 0114 (Guest sessions Overview RPCs). Read-only
-- functions only; nothing else depends on them, so nothing is lost.
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0114-guest-sessions-overview-rpcs.sql

drop function if exists public.guest_sessions_summary(text);
drop function if exists public.list_guest_sessions_paid(text, boolean, boolean, integer, integer);
drop function if exists public.list_session_attempts(text, integer, integer);
drop function if exists public.list_free_guest_sessions(text, integer, integer);
drop function if exists private.guest_sessions_period(text);
