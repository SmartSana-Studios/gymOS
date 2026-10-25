-- Rollback for migration 0156. Roll the Super Admin app back first: its "edit owner contact" action calls this function.
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0156-change-owner-contact.sql
-- Data effects: none. Contact changes already made stay (the audit entries gym_owner_contact_changed stay too).
set local lock_timeout = '5s';

drop function if exists public.change_owner_contact(uuid, text, text, text);
