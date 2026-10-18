-- READ-ONLY pre-flight for deploying migrations 0124-0130 (Epic 22: live authorization, authorize_action,
-- Super Admin aal2 flag, session limits / step-up, recovery email, factor guard, owner never Super Admin)
-- to production. Writes nothing. Every check prints PASS / WARN / STOP; do not deploy on a STOP.
-- Run it through scripts/deploy-0124-0130.sh --preflight (management API) or psql -f.

\echo '================= PRE-FLIGHT: migrations 0124-0130 ================='

\echo '--- 1. Migration head (expect 0123) ---'
select case when max(version) = '0123' then 'PASS - head is 0123'
            else 'STOP - head is ' || coalesce(max(version), 'none') || ' - the deploy script requires exactly 0123' end as head
from supabase_migrations.schema_migrations;

\echo '--- 2. Nothing from these migrations exists yet (expect all zero) ---'
select
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'private' and c.relname in ('platform_flags','session_limits_config','support_session_state','support_stepup','super_admin_recovery_email','super_admin_recovery_code','super_admin_recovery_pending')) as private_tables,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname, p.proname) in (('public','authorize_action'),('private','authorize_action'),('private','guard_last_verified_factor'),('private','guard_super_admin_not_owner'),('private','guard_owner_not_super_admin'))) as new_functions;

\echo '--- 3. Objects these migrations REPLACE must exist (expect all PASS) ---'
select s.name, case when s.ok then 'PASS' else 'STOP - missing' end as status
from (values
  ('function private.gym_id',             exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='gym_id')),
  ('function private.is_super_admin',     exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='is_super_admin')),
  ('function private.current_member_role',exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='current_member_role')),
  ('function public.custom_access_token_hook', exists (select 1 from pg_proc where proname='custom_access_token_hook' and pronamespace='public'::regnamespace)),
  ('function public.log_audit_event',     exists (select 1 from pg_proc where proname='log_audit_event' and pronamespace='public'::regnamespace)),
  ('column users.is_super_admin',         exists (select 1 from information_schema.columns where table_schema='public' and table_name='users' and column_name='is_super_admin')),
  ('column members.deactivated_at',        exists (select 1 from information_schema.columns where table_schema='public' and table_name='members' and column_name='deactivated_at'))
) as s(name, ok);

\echo '--- 4. Super Admin accounts (0124 makes is_super_admin() require the live users.is_super_admin flag) ---'
\echo '    expect: flagged >= 1; owner_super_admins = 0 (0130 refuses to install otherwise)'
select (select count(*) from public.users where is_super_admin) as flagged_super_admins,
       (select count(*) from public.users u join public.members m on m.user_id = u.id
         where u.is_super_admin and m.role = 'owner' and m.deactivated_at is null) as owner_super_admins,
       (select count(*) from auth.mfa_factors where status = 'verified') as verified_factors;
select case when (select count(*) from public.users where is_super_admin) >= 1
              and (select count(*) from public.users u join public.members m on m.user_id = u.id
                    where u.is_super_admin and m.role = 'owner' and m.deactivated_at is null) = 0
            then 'PASS' else 'STOP - no Super Admin to keep, or an owner is a Super Admin' end as super_admin_check;

\echo '--- 5. Blast radius (informational) ---'
select (select count(*) from gyms) as gyms, (select count(*) from gyms where status = 'active') as active_gyms,
       (select count(*) from members where deactivated_at is null) as active_members;

\echo '--- 6. Operator-only guard: 0129 trigger bypass is for postgres / supabase_admin sessions only (informational) ---'
select current_user, session_user;

\echo '================= end pre-flight ================='
