-- Rollback for migration 0193: Reactivating a billing-suspended gym requires a payment or a credit.
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0193-gym-reactivation-requires-payment.sql
--
-- Drops the trigger and its function. Nothing else changed in 0193 and no data was written, so there is nothing to restore. After this the Super Admin Reinstate action can again
-- put a billing-suspended gym back to status 'active' with its billing status still 'suspended' (the gap 0193 closed).
set local lock_timeout = '5s';

drop trigger if exists zz_guard_gym_reactivation on public.gyms;
drop function if exists private.guard_gym_reactivation();
