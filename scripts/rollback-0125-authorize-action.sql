-- Rollback for migration 0125 (shared live authorize_action). Additive migration: dropping the
-- functions removes the decision point; service paths that call it fail closed (deny), so roll
-- back the application code first.
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0125-authorize-action.sql
set local lock_timeout = '5s';
drop function if exists public.authorize_action(uuid, uuid, text);
drop function if exists private.authorize_action(uuid, uuid, text);
drop function if exists private.capability_roles(text);
