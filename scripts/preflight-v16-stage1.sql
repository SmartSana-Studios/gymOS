-- READ-ONLY pre-flight for V1.6 stage 1 (migrations 0106-0110) on production. Writes nothing.
-- Every check prints PASS / WARN / STOP; do not deploy on a STOP.
--
--   export PGPASSWORD=$(cat ~/.supabase-db-password)   # needs host psql with network access
--   psql -h aws-0-eu-west-1.pooler.supabase.com -p 5432 \
--        -U postgres.vfxezibagiznrirdwkwh -d postgres -f scripts/preflight-v16-stage1.sql
-- (In this devcontainer the container psql cannot reach the pooler; it was run through a Node pg client.)
--
-- Stage 1a = 0106-0109 (additive, head must be 0105). Stage 1b = 0110 ALONE (head must be 0109);
-- it rewrites the alert path of every live gym and starts the 7-day soak before 0111.

\pset pager off
\echo '================= PRE-FLIGHT: V1.6 stage 1 (0106-0110) ================='

\echo ''
\echo '--- 1. Migration head (stage 1a expects 0105, stage 1b expects 0109) ---'
select case
         when max(version) = '0105' then 'PASS - head is 0105: stage 1a (0106-0109) may run'
         when max(version) = '0109' then 'PASS - head is 0109: stage 1b (0110 alone) may run'
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
\echo '--- 9. Backup gate (cannot be read from SQL; confirm by hand) ---'
\echo 'STOP unless the db-backup workflow was triggered and finished green immediately before this deploy.'

\echo ''
\echo '================= end pre-flight ================='
