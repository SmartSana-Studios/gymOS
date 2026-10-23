-- Rollback note for migration 0134 (member_role gains 'support').
-- Postgres cannot DROP an enum value. Rolling back 0135 (scripts/rollback-0135-support-assignments-live-gate.sql)
-- removes every use of the value; the unused value then does no harm and may stay. If it must go, rebuild the type:
-- first ensure no members row has role = 'support' (delete them), then, in one transaction, rename member_role,
-- create the old five-value type, and alter each dependent column/function/policy to it -- a large change that is
-- only worth it if the value is really in the way. Nothing to run here.
select 1;
