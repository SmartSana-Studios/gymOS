-- READ-ONLY pre-flight for V1.6 stage 1 (migrations 0106-0110) on production. Writes nothing.
-- Every check prints PASS / WARN / STOP; do not deploy on a STOP.
--
--   export PGPASSWORD=$(cat ~/.supabase-db-password)   # needs host psql with network access
--   psql -h aws-0-eu-west-1.pooler.supabase.com -p 5432 \
--        -U postgres.vfxezibagiznrirdwkwh -d postgres -f scripts/preflight-v16-stage1.sql
-- (In this devcontainer the container psql cannot reach the pooler; it was run through a Node pg client.)
--
-- Stage 2 = 0111-0114 + 0116 (head must be 0110; sections 10-11 below).
-- Stage 1a = 0106-0109 (additive, head must be 0105). Stage 1b = 0110 ALONE (head must be 0109);
-- it rewrites the alert path of every live gym and starts the 7-day soak before 0111.

\pset pager off
\echo '================= PRE-FLIGHT: V1.6 stage 1 (0106-0110) ================='

\echo ''
\echo '--- 1. Migration head (stage 1a expects 0105, stage 1b expects 0109) ---'
select case
         when max(version) = '0105' then 'PASS - head is 0105: stage 1a (0106-0109) may run'
         when max(version) = '0109' then 'PASS - head is 0109: stage 1b (0110 alone) may run'
         when max(version) = '0110' then 'PASS - head is 0110: stage 2 (0111-0114, 0116) may run'
         when max(version) = '0116' then 'PASS - head is 0116: stage 3 (0115 alone, default flip for NEW gyms) may run'
         else 'STOP - head is ' || coalesce(max(version), 'none') || '; neither stage applies' end as head
from supabase_migrations.schema_migrations;

\echo ''
\echo '--- 2. Blast radius ---'
select (select count(*) from gyms) as gyms,
       (select count(*) from gyms where status <> 'active') as non_active_gyms,
       (select count(*) from members) as members,
       (select count(*) from subscriptions) as subscriptions,
       (select count(*) from payments) as payments,
       (select count(*) from payments where status in ('pending','processing')) as in_flight_payments,
       (select count(*) from payments where status = 'flagged') as flagged_payments,
       (select count(*) from front_desk_alerts) as alerts_total,
       (select count(*) from front_desk_alerts where dismissed_at is null) as alerts_active;

\echo ''
\echo '--- 3. In-flight payments (WARN: settle or let expire before 0106; its flagging paths change) ---'
select case when count(*) = 0 then 'PASS - none in flight'
            else 'WARN - ' || count(*) || ' payment(s) pending/processing; apply in a quiet minute' end as in_flight
from payments where status in ('pending','processing');

\echo ''
\echo '--- 4. V1.6 objects that must NOT exist before stage 1a (expect all zero at head 0105) ---'
select
  (select count(*) from information_schema.columns where table_schema='public' and table_name='payments' and column_name='flagged_reason') as payments_flagged_reason,
  (select count(*) from information_schema.columns where table_schema='public' and table_name='gyms' and column_name='charge_guests_per_session') as gyms_charge_guests,
  (select count(*) from information_schema.tables where table_schema='public' and table_name in ('guest_sessions','platform_session_config','session_attempts')) as v16_tables,
  (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('record_session_payment','initiate_session_payment','set_guest_charging','guest_charging_impact','update_plan_pricing')) as v16_functions,
  (select count(*) from information_schema.columns where table_schema='public' and table_name='front_desk_alerts' and column_name='kind') as alerts_kind;

\echo ''
\echo '--- 5. Objects these migrations REPLACE or extend must exist (expect all PASS) ---'
select s.name, case when s.ok then 'PASS' else 'STOP - missing' end as status
from (values
  ('function complete_verified_payment',  exists (select 1 from pg_proc where pronamespace='public'::regnamespace and proname='complete_verified_payment')),
  ('function complete_flagged_payment',   exists (select 1 from pg_proc where pronamespace='public'::regnamespace and proname='complete_flagged_payment')),
  ('function check_in',                   exists (select 1 from pg_proc where pronamespace='public'::regnamespace and proname='check_in')),
  ('function mark_class_attendance',      exists (select 1 from pg_proc where pronamespace='public'::regnamespace and proname='mark_class_attendance')),
  ('function front_desk_alerts_protect_columns', exists (select 1 from pg_proc where pronamespace='public'::regnamespace and proname='front_desk_alerts_protect_columns')),
  ('index one_active_per_member_status (0110 swaps it)', exists (select 1 from pg_indexes where indexname='idx_front_desk_alerts_one_active_per_member_status')),
  ('table plans.plan_type pay_per_session value', exists (select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='plan_type' and e.enumlabel='pay_per_session')),
  ('payment provider taramoney', exists (select 1 from payment_providers where provider_key='taramoney'))
) as s(name, ok);

\echo ''
\echo '--- 6. 0110 only: live ON CONFLICT sites it rewrites are still in the bodies it was written against ---'
select case when pg_get_functiondef('public.check_in(timestamptz,uuid)'::regprocedure) like '%on conflict (member_id, status)%'
            then 'PASS - check_in still uses ON CONFLICT (member_id, status)'
            else 'WARN - check_in differs from the 0105 body (already migrated, or edited); read it before 0110 overwrites it' end as check_in_body;

\echo ''
\echo '--- 7. Active alerts by status (0110 backfills kind = subscription_status for all of these) ---'
select status, count(*) from front_desk_alerts where dismissed_at is null group by status order by status;

\echo ''
\echo '--- 8. anon EXECUTE on the functions V1.6 will create must stay revoked (hosted default-privilege trap) ---'
select case when has_function_privilege('anon', 'public.check_in(timestamptz,uuid)', 'EXECUTE')
            then 'WARN - anon can already EXECUTE check_in; fix before and re-run scripts/ hosted-privilege check'
            else 'PASS - anon cannot execute check_in' end as anon_check_in;

\echo ''
\echo ''
\echo '--- 10. Stage 2 only (head 0110): the V1.6 session objects must not exist yet (expect all zero) ---'
select
  (select count(*) from information_schema.tables where table_schema='public' and table_name='session_attempts') as session_attempts,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname in ('consume_guest_session','hold_back_repeat_session_alert','apply_session_refund')) as private_fns,
  (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('guest_sessions_summary','list_guest_sessions_paid','list_session_attempts','gym_session_revenue_mtd')) as overview_rpcs;

\echo ''
\echo '--- 11. Stage 2 only: live bodies/ACLs the stage rewrites are the ones it was written against ---'
select case when pg_get_functiondef('public.check_in(timestamptz,uuid)'::regprocedure) like '%on conflict (member_id, kind, status)%'
            then 'PASS - check_in is the 0110 body (kind-aware ON CONFLICT)'
            else 'WARN - check_in is not the 0110 body; read it before 0111 overwrites it' end as check_in_0110,
       case when has_table_privilege('authenticated','public.attendance_events','INSERT')
            then 'INFO - authenticated can still INSERT attendance_events (0111 revokes it; nothing in the deployed apps writes it directly)'
            else 'INFO - authenticated cannot INSERT attendance_events already' end as attendance_events_acl;
select case when count(*) = 0 then 'PASS - no refunds yet (0113 trigger has no history to act on)' else 'INFO - ' || count(*) || ' refund(s) exist; 0113 only acts on new inserts' end as refunds from refunds;

\echo ''
\echo '--- 12. Stage 3 only (head 0116): current default and existing gyms ---'
select (select column_default from information_schema.columns where table_schema='public' and table_name='gyms' and column_name='charge_guests_per_session') as current_default,
       (select count(*) from gyms) as gyms_total,
       (select count(*) from gyms where charge_guests_per_session) as gyms_charging_on_now;
select case when exists (select 1 from supabase_migrations.schema_migrations where version = '0115')
            then 'STOP - 0115 is already in the ledger'
            else 'PASS - 0115 not applied yet' end as ledger_0115;

\echo '--- 9. Backup gate (cannot be read from SQL; confirm by hand) ---'
\echo 'STOP unless the db-backup workflow was triggered and finished green immediately before this deploy.'

\echo ''
\echo '================= end pre-flight ================='
