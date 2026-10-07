-- READ-ONLY pre-flight for deploying migrations 0098-0103 (Epic 18 registration
-- fee, receptionist create/assign, voided-fee metrics) to production. Writes
-- nothing. Every check prints PASS / WARN / STOP; do not deploy on a STOP.
--
--   export PGPASSWORD=$(cat ~/.supabase-db-password)
--   psql -h aws-0-eu-west-1.pooler.supabase.com -p 5432 \
--        -U postgres.vfxezibagiznrirdwkwh -d postgres -f scripts/preflight-epic18-deploy.sql

\pset pager off
\echo '================= PRE-FLIGHT: migrations 0098-0103 ================='

\echo ''
\echo '--- 1. Migration head (expect 0097) ---'
select case when max(version) = '0097' then 'PASS - head is 0097'
            else 'STOP - head is ' || coalesce(max(version), 'none') || '; the deploy script requires exactly 0097' end as head
from supabase_migrations.schema_migrations;

\echo ''
\echo '--- 2. Blast radius (0098 rewrites every members row once) ---'
select (select count(*) from gyms) as gyms, (select count(*) from members) as members,
       (select count(*) from subscriptions) as subscriptions, (select count(*) from payments) as payments,
       (select count(*) from payments where status in ('pending','processing')) as in_flight_payments;

\echo ''
\echo '--- 3. Nothing from these migrations exists yet (expect all zero) ---'
select
  (select count(*) from information_schema.columns where table_schema='public' and table_name='gyms' and column_name='registration_fee') as gyms_registration_fee,
  (select count(*) from information_schema.columns where table_schema='public' and table_name='members' and column_name='registration_fee_settled_at') as members_settled_at,
  (select count(*) from information_schema.columns where table_schema='public' and table_name='payments' and column_name in ('purpose','voided_at')) as payments_purpose_voided,
  (select count(*) from pg_proc where proname in ('set_registration_fee','record_registration_fee','waive_registration_fee','initiate_registration_fee_payment','void_registration_fee_payment','gym_registration_fee_revenue_mtd')) as fee_functions;

\echo ''
\echo '--- 4. Objects these migrations REPLACE must exist (expect all present) ---'
select s.name, case when s.ok then 'PASS' else 'STOP - missing' end as status
from (values
  ('function complete_verified_payment', exists (select 1 from pg_proc where proname='complete_verified_payment')),
  ('function gym_revenue_mtd',           exists (select 1 from pg_proc where proname='gym_revenue_mtd')),
  ('function platform_metrics',          exists (select 1 from pg_proc where proname='platform_metrics')),
  ('function private.protect_super_admin_only_gym_columns', exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='protect_super_admin_only_gym_columns')),
  ('trigger payments_notify_status_change', exists (select 1 from pg_trigger where tgname='payments_notify_status_change')),
  ('policy gym_staff_insert_own_payments', exists (select 1 from pg_policies where policyname='gym_staff_insert_own_payments')),
  ('policy manager_or_owner_insert_own_refunds', exists (select 1 from pg_policies where policyname='manager_or_owner_insert_own_refunds')),
  ('policy manager_or_owner_insert_own_members', exists (select 1 from pg_policies where policyname='manager_or_owner_insert_own_members')),
  ('policy manager_or_owner_insert_own_subscriptions', exists (select 1 from pg_policies where policyname='manager_or_owner_insert_own_subscriptions'))
) as s(name, ok);

\echo ''
\echo '--- 5. platform_metrics() is still the 0011 body that 0103 replaces (WARN if edited since) ---'
select case when pg_get_functiondef('public.platform_metrics()'::regprocedure) like '%where status = ''verified'')%'
              and pg_get_functiondef('public.platform_metrics()'::regprocedure) not like '%voided_at%'
            then 'PASS - unmodified 0011 body'
            else 'WARN - platform_metrics differs from 0011; read it before 0103 overwrites it' end as platform_metrics;

\echo ''
\echo '--- 6. Suspended / deactivated gyms (the new RPCs refuse these; informational) ---'
select status, count(*) from gyms group by status order by status;

\echo ''
\echo '================= end pre-flight ================='
