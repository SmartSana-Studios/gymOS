-- Rollback for migration 0159: new and edited names are no longer forced to capitals.
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0159-uppercase-names.sql
-- Data effects: none. Rows already converted STAY in capitals (the original case was not kept).
set local lock_timeout = '5s';

drop trigger if exists uppercase_member_text on members;
drop trigger if exists uppercase_user_text on users;
drop trigger if exists uppercase_name on gyms;
drop trigger if exists uppercase_name on plans;
drop trigger if exists uppercase_name on classes;
drop trigger if exists uppercase_name on tiers;
drop trigger if exists uppercase_name on workout_plans;
drop function if exists private.uppercase_member_text();
drop function if exists private.uppercase_user_text();
drop function if exists private.uppercase_name();
