-- Rollback for migration 0151 (support refunds write an audit row).
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0151-support-refund-audit.sql
-- Data effects: none. The refund_recorded audit rows already written stay (audit rows are append-only).
set local lock_timeout = '5s';

drop trigger if exists yy_support_refund_audit on public.refunds;
drop function if exists private.support_refund_audit_trigger();
delete from private.support_audit_actions where action_type = 'refund_recorded';
