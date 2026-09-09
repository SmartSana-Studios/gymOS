-- READ-ONLY pre-flight for deploying migrations 0090-0094 to production.
--
-- Run this against the DEPLOYED project BEFORE `supabase db push`. It writes
-- nothing. Every check prints PASS / WARN / STOP; do not deploy while any STOP
-- is outstanding.
--
--   export PGPASSWORD=$(cat ~/.supabase-db-password)
--   psql -h aws-0-eu-west-1.pooler.supabase.com -p 5432 \
--        -U postgres.vfxezibagiznrirdwkwh -d postgres -f scripts/preflight-prod-deploy.sql

\pset pager off
\echo '================= PRE-FLIGHT: migrations 0090-0094 ================='

-- 1. Where production actually is. Expect the latest to be 0089.
\echo ''
\echo '--- 1. Current migration head (expect 0089) ---'
select version
from supabase_migrations.schema_migrations
order by version desc
limit 6;

-- 2. Blast radius. How much real data is behind these changes.
\echo ''
\echo '--- 2. Blast radius ---'
select
  (select count(*) from gyms)          as gyms,
  (select count(*) from members)       as members,
  (select count(*) from auth.users)    as auth_users,
  (select count(*) from subscriptions) as subscriptions,
  (select count(*) from payments)      as payments;

-- 3. STOP CONDITION for 0094. Its pre-flight raises and aborts the whole push
--    if any account holds BOTH a staff row and a member row. Find out here
--    rather than halfway through a deploy.
\echo ''
\echo '--- 3. 0094 blocker: accounts that are BOTH staff and member ---'
select
  case when count(*) = 0
       then 'PASS - no account is both staff and member; 0094 will apply'
       else 'STOP - ' || count(*) || ' account(s) are both; 0094 WILL ABORT the deploy. Resolve first (deactivate the row that should not survive).'
  end as result
from (
  select user_id
  from members
  where deactivated_at is null
  group by user_id
  having count(*) filter (where role = 'member') > 0
     and count(*) filter (where role <> 'member') > 0
) x;

-- The offending numbers, if any.
select u.phone, string_agg(distinct m.role::text, ', ') as roles
from members m
join auth.users u on u.id = m.user_id
where m.deactivated_at is null
  and m.user_id in (
    select user_id from members where deactivated_at is null
    group by user_id
    having count(*) filter (where role = 'member') > 0
       and count(*) filter (where role <> 'member') > 0
  )
group by u.phone;

-- 4. ORDERING DEPENDENCY. 0093 re-emits 7 functions that 0090 also replaces,
--    and its captured bodies already contain 0090's suspension guard. Applied
--    in order that is correct. This confirms 0090 has NOT been applied yet, so
--    the ordering assumption holds.
\echo ''
\echo '--- 4. Ordering: 0090 not yet applied (0093 depends on it running first) ---'
select
  case when count(*) = 0
       then 'PASS - none of the 7 carry the guard yet; apply 0090 -> 0091 -> 0092 -> 0093 -> 0094 IN ORDER'
       else 'WARN - ' || count(*) || ' already carry a suspension guard; production is not in the state 0093 was generated against. Re-verify before pushing.'
  end as result
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('assign_coach','check_out_member','confirm_renewal','create_class','update_class','renew_subscription','materialize_class_sessions')
  and p.prosrc like '%current_gym_status%';

-- 5. 0093 assumes each of its 26 target policies still has the pre-widening
--    shape (grants manager, not supervisor). If production has drifted, the
--    generated ALTER POLICY statements would overwrite a different predicate.
\echo ''
\echo '--- 5. 0093: policies granting manager but not supervisor (expect 26) ---'
select count(*) as policies_to_widen
from pg_policies
where schemaname = 'public'
  and (coalesce(qual,'') || coalesce(with_check,'')) ilike '%manager%'
  and (coalesce(qual,'') || coalesce(with_check,'')) not ilike '%supervisor%';

-- 6. BEHAVIOUR CHANGE ON LIVE TENANTS. 0090/0091 start denying writes for any
--    gym that is not 'active'. If a real gym is suspended right now, its staff
--    lose write access the moment this deploys -- which is the intent, but the
--    owner should know before, not after.
\echo ''
\echo '--- 6. Gyms that will be immediately affected by 0090/0091 ---'
select status, count(*) as gyms
from gyms
group by status
order by status;

-- 7. 0091 pre-condition: the three workout-plan tables exist and are NOT yet
--    gated (0091 creates tenant_active_gate on them, so a pre-existing policy
--    of that name would collide).
\echo ''
\echo '--- 7. 0091: workout-plan tables must exist and not already be gated ---'
select
  (select count(*) from information_schema.tables
    where table_schema='public'
      and table_name in ('workout_plans','workout_plan_exercises','workout_plan_completions')) as tables_present_expect_3,
  (select count(*) from pg_policies
    where schemaname='public' and policyname='tenant_active_gate'
      and tablename in ('workout_plans','workout_plan_exercises','workout_plan_completions')) as already_gated_expect_0;

\echo ''
\echo '================= END PRE-FLIGHT ================='
