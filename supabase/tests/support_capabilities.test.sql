-- Story 23.6: capability allow-list and denied-set matrix for GymOS support (migration 0140).
--   A. catalog: every object that admits support is listed in private.support_capabilities; every policy/function that names 'supervisor' is classified
--   B. not live: zero rows / refused
--   C. allow-list: a live support session succeeds on each listed object
--   D. denied set: one named negative test per item
--   E. step-up (refund, waiver, staff creation) and the staff ceiling
--   F. revocation leaves support-created staff active and tagged
begin;
select plan(146);

create or replace function pg_temp.claims(uid text, app_role text, aal text, gym text default null, sid text default null) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"' || uid || '","role":"authenticated","aal":"' || aal || '"'
    || case when sid is null then '' else ',"session_id":"' || sid || '"' end
    || case when app_role is null then '' else ',"app_role":"' || app_role || '"' end
    || case when gym is null then '' else ',"gym_id":"' || gym || '"' end || '}', true);
end $f$;
-- 'ok' or 'sqlstate:message'
create or replace function pg_temp.err(stmt text) returns text language plpgsql as $f$
begin execute stmt; return 'ok'; exception when others then return sqlstate || ':' || sqlerrm; end $f$;
-- rows touched by a DML statement, or the error
create or replace function pg_temp.rows(stmt text) returns text language plpgsql as $f$
declare n bigint;
begin execute stmt; get diagnostics n = row_count; return n::text; exception when others then return sqlstate || ':' || sqlerrm; end $f$;
create or replace function pg_temp.live_support() returns void language sql as $f$
  select pg_temp.claims('00000000-0000-0000-0000-000000236101', 'support', 'aal2', '00000000-0000-0000-0000-000000236001', '00000000-0000-0000-0000-0000000236a1') $f$;
-- a single-use grant for the support person (the service-role issuer, as the dashboard calls it after verifying a fresh TOTP)
create or replace function pg_temp.grant_stepup(p_action text, p_subject text) returns void language sql as $f$
  select private.stepup_issue('00000000-0000-0000-0000-000000236101', p_action, p_subject) $f$;

-- ---- fixtures ---------------------------------------------------------------------------------------------------
insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000236301', 'Cap Tier', 5000, 50000, 30),
  ('00000000-0000-0000-0000-000000236302', 'Cap Tier Two', 9000, 90000, 60);
insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-000000236001', 'Cap Gym A', '00000000-0000-0000-0000-000000236301', 30),
  ('00000000-0000-0000-0000-000000236002', 'Cap Gym B', '00000000-0000-0000-0000-000000236301', 30);
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000236101', 'sup-236@gymosapps.com', now()),
  ('00000000-0000-0000-0000-000000236102', 'owner-236@x.example', now()),
  ('00000000-0000-0000-0000-000000236103', 'supervisor-236@x.example', now()),
  ('00000000-0000-0000-0000-000000236104', 'manager-236@x.example', now()),
  ('00000000-0000-0000-0000-000000236105', 'member1-236@x.example', now()),
  ('00000000-0000-0000-0000-000000236106', 'new1-236@x.example', now()),
  ('00000000-0000-0000-0000-000000236107', 'new2-236@x.example', now()),
  ('00000000-0000-0000-0000-000000236108', 'member2-236@x.example', now()),
  ('00000000-0000-0000-0000-000000236109', 'admin-236@x.example', now()),
  ('00000000-0000-0000-0000-00000023610a', 'ownerB-236@x.example', now()),
  ('00000000-0000-0000-0000-00000023610b', 'new3-236@x.example', now()),
  ('00000000-0000-0000-0000-00000023610c', 'member3-236@x.example', now()),
  ('00000000-0000-0000-0000-00000023610d', 'member4-236@x.example', now()),
  ('00000000-0000-0000-0000-00000023610e', 'memberB-236@x.example', now()),
  ('00000000-0000-0000-0000-00000023610f', 'import-236@x.example', now()),
  ('00000000-0000-0000-0000-000000236110', 'coach-236@x.example', now());
update users set is_super_admin = true where id = '00000000-0000-0000-0000-000000236109';
insert into members (id, gym_id, user_id, role, name, email, phone) values
  ('00000000-0000-0000-0000-000000236201', '00000000-0000-0000-0000-000000236001', '00000000-0000-0000-0000-000000236102', 'owner', 'Owner 236', 'owner-contact@x.example', '+237600236001'),
  ('00000000-0000-0000-0000-000000236202', '00000000-0000-0000-0000-000000236001', '00000000-0000-0000-0000-000000236103', 'supervisor', 'Supervisor 236', null, '+237600236002'),
  ('00000000-0000-0000-0000-000000236203', '00000000-0000-0000-0000-000000236001', '00000000-0000-0000-0000-000000236104', 'manager', 'Manager 236', null, '+237600236003'),
  ('00000000-0000-0000-0000-000000236204', '00000000-0000-0000-0000-000000236001', '00000000-0000-0000-0000-000000236105', 'member', 'Member One', null, null),
  ('00000000-0000-0000-0000-000000236205', '00000000-0000-0000-0000-000000236001', '00000000-0000-0000-0000-000000236108', 'member', 'Member Two', null, null),
  ('00000000-0000-0000-0000-000000236206', '00000000-0000-0000-0000-000000236002', '00000000-0000-0000-0000-00000023610a', 'owner', 'Owner B 236', null, null),
  ('00000000-0000-0000-0000-000000236209', '00000000-0000-0000-0000-000000236002', '00000000-0000-0000-0000-00000023610e', 'member', 'Member B', null, null),
  ('00000000-0000-0000-0000-00000023620a', '00000000-0000-0000-0000-000000236001', '00000000-0000-0000-0000-000000236110', 'coach', 'Coach 236', null, null);
insert into plans (id, gym_id, name, plan_type, price, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000236501', '00000000-0000-0000-0000-000000236001', 'Cap Monthly', 'monthly', 10000, 'monthly', 30),
  ('00000000-0000-0000-0000-000000236502', '00000000-0000-0000-0000-000000236001', 'Cap Per Session', 'pay_per_session', 2000, 'monthly', null),
  ('00000000-0000-0000-0000-000000236503', '00000000-0000-0000-0000-000000236002', 'Cap Gym B Plan', 'monthly', 7000, 'monthly', 30);
insert into subscriptions (id, gym_id, member_id, plan_id, status, start_date, expiry_date) values
  ('00000000-0000-0000-0000-000000236601', '00000000-0000-0000-0000-000000236001', '00000000-0000-0000-0000-000000236204', '00000000-0000-0000-0000-000000236501', 'active', current_date, current_date + 30),
  ('00000000-0000-0000-0000-000000236602', '00000000-0000-0000-0000-000000236001', '00000000-0000-0000-0000-000000236205', '00000000-0000-0000-0000-000000236502', 'active', current_date, null);
insert into payments (id, gym_id, member_id, amount, currency, method, status, purpose) values
  ('00000000-0000-0000-0000-000000236701', '00000000-0000-0000-0000-000000236001', '00000000-0000-0000-0000-000000236204', 2000, 'XAF', 'cash', 'verified', 'session'),
  ('00000000-0000-0000-0000-000000236702', '00000000-0000-0000-0000-000000236001', '00000000-0000-0000-0000-000000236204', 3000, 'XAF', 'cash', 'pending', 'subscription'),
  ('00000000-0000-0000-0000-000000236703', '00000000-0000-0000-0000-000000236002', '00000000-0000-0000-0000-000000236209', 1000, 'XAF', 'cash', 'verified', 'session');

insert into private.support_accounts (user_id, activated_at) values ('00000000-0000-0000-0000-000000236101', now());
-- 23.10: probe action types allowed for a live support caller
insert into private.support_audit_actions values ('support_probe');
insert into public.support_assignments (id, support_user_id, gym_id, state, activated_at) values
  ('00000000-0000-0000-0000-000000236401', '00000000-0000-0000-0000-000000236101', '00000000-0000-0000-0000-000000236001', 'active', now());
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000236a1', '00000000-0000-0000-0000-000000236101', now(), now()),
  ('00000000-0000-0000-0000-0000000236a9', '00000000-0000-0000-0000-000000236109', now(), now());
insert into private.support_session_state (session_id, user_id, started_at, last_seen_at)
values ('00000000-0000-0000-0000-0000000236a1', '00000000-0000-0000-0000-000000236101', now(), now());
select private.support_set_membership('00000000-0000-0000-0000-000000236401', true);

-- ============================================================================================================
-- A. catalog
-- ============================================================================================================
select is((select count(*)::int from private.support_capabilities), 34, 'the allow-list holds 34 objects (20 policies, 14 RPCs): a change is deliberate');
select is(has_table_privilege('authenticated', 'private.support_capabilities', 'select') or has_table_privilege('anon', 'private.support_capabilities', 'select'),
          false, 'support_capabilities is not readable by clients');
select is((select count(*)::int from private.support_capabilities c
            where c.kind = 'rpc' and not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = c.object_name)), 0,
          'every listed RPC exists');
select is((select count(*)::int from private.support_capabilities c
            where c.kind = 'policy' and not exists (select 1 from pg_policies p where p.tablename || '.' || p.policyname = c.object_name)), 0,
          'every listed policy exists');

-- retro 66: every policy that admits support through the gate is listed, and every listed one admits through it
select is((select coalesce(array_agg(p.tablename || '.' || p.policyname order by p.tablename || '.' || p.policyname), '{}') from pg_policies p
            where coalesce(p.qual, '') || coalesce(p.with_check, '') like '%support_gym_id%'),
          (select coalesce(array_agg(object_name order by object_name), '{}') from private.support_capabilities where kind = 'policy'),
          'catalog: the policies that call support_gym_id are exactly the listed policies');
-- every function that resolves through the RPC helpers is listed, and passes its own name
select is((select coalesce(array_agg(p.proname::text order by p.proname), '{}') from pg_proc p
            where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
              and p.proname not in ('support_rpc_gym_id', 'support_rpc_role')
              and p.prosrc ~ 'support_rpc_(gym_id|role)'),
          (select coalesce(array_agg(object_name order by object_name), '{}') from private.support_capabilities where kind = 'rpc'),
          'catalog: the functions that call the support_rpc helpers are exactly the listed RPCs');
select is((select count(*)::int from private.support_capabilities c join pg_proc p on p.pronamespace = 'public'::regnamespace and p.proname = c.object_name
            where c.kind = 'rpc' and p.prosrc not like '%support_rpc_gym_id(''' || c.object_name || ''')%'), 0,
          'catalog: each listed RPC passes its own name to the helpers');
-- the remaining direct consumers of support_gym_id are infrastructure, named here
select is((select coalesce(array_agg(p.proname::text order by p.proname), '{}') from pg_proc p
            where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace) and p.proname <> 'support_gym_id'
              and p.prosrc like '%support_gym_id%'),
          array['actor_id', 'current_gym_status', 'guard_support_gym_columns', 'log_audit_event', 'protect_payment_columns_on_staff_verify', 'record_support_identity', 'support_force_actor', 'support_rpc_gym_id', 'support_stepup_require']::text[],
          'catalog: the direct consumers of support_gym_id are exactly the helpers, the three triggers, status, audit and the actor (23.7)');

-- classification of every policy / function that names 'supervisor'. A new one fails until it is added here, deliberately.
create temp table cls (kind text, name text, support text, primary key (kind, name));
insert into cls (kind, name, support) values
  ('policy', 'attendance_events.gym_staff_read_own_attendance_events', 'excludes'),
  ('policy', 'audit_log.manager_or_owner_read_own_audit_log', 'excludes'),
  ('policy', 'class_bookings.gym_staff_read_own_class_bookings', 'excludes'),
  ('policy', 'classes.manager_or_owner_insert_own_classes', 'excludes'),
  ('policy', 'classes.manager_or_owner_update_own_classes', 'excludes'),
  ('policy', 'coach_assignments.manager_or_owner_read_own_coach_assignments', 'excludes'),
  ('policy', 'front_desk_alerts.gym_staff_dismiss_own_front_desk_alerts', 'excludes'),
  ('policy', 'front_desk_alerts.gym_staff_read_own_front_desk_alerts', 'excludes'),
  ('policy', 'guest_sessions.gym_staff_read_own_guest_sessions', 'excludes'),
  ('policy', 'loyalty_events.gym_staff_read_own_loyalty_events', 'excludes'),
  ('policy', 'loyalty_progress.gym_staff_read_own_loyalty_progress', 'excludes'),
  ('policy', 'members.gym_staff_read_own_members', 'excludes'),
  ('policy', 'members.manager_or_owner_insert_own_members', 'excludes'),
  ('policy', 'members.manager_or_owner_update_own_members', 'excludes'),
  ('policy', 'members.member_read_gym_staff_members', 'excludes'),
  ('policy', 'payment_discrepancies.gym_staff_read_own_payment_discrepancies', 'excludes'),
  ('policy', 'payments.gym_staff_insert_own_payments', 'excludes'),
  ('policy', 'payments.gym_staff_read_own_payments', 'excludes'),
  ('policy', 'payments.gym_staff_verify_own_payments', 'excludes'),
  ('policy', 'plans.manager_or_owner_delete_own_plans', 'excludes'),
  ('policy', 'plans.manager_or_owner_insert_own_plans', 'excludes'),
  ('policy', 'plans.manager_or_owner_update_own_plans', 'excludes'),
  ('policy', 'refunds.gym_staff_read_own_refunds', 'excludes'),
  ('policy', 'refunds.manager_or_owner_insert_own_refunds', 'excludes'),
  ('policy', 'session_attempts.gym_staff_read_own_session_attempts', 'excludes'),
  ('policy', 'session_notes.manager_or_owner_read_own_session_notes', 'excludes'),
  ('policy', 'subscriptions.gym_staff_read_own_subscriptions', 'excludes'),
  ('policy', 'subscriptions.manager_or_owner_insert_own_subscriptions', 'excludes'),
  ('policy', 'subscriptions.manager_or_owner_update_own_subscriptions', 'excludes'),
  ('policy', 'workout_plan_completions.manager_or_owner_read_own_workout_plan_completions', 'excludes'),
  ('policy', 'workout_plan_exercises.manager_or_owner_read_own_workout_plan_exercises', 'excludes'),
  ('policy', 'workout_plans.manager_or_owner_read_own_workout_plan', 'excludes'),
  ('function', 'assign_coach', 'excludes'),
  ('function', 'capability_roles', 'excludes'),
  ('function', 'check_out_member', 'excludes'),
  ('function', 'create_class', 'excludes'),
  ('function', 'deactivate_staff_member', 'excludes'),
  ('function', 'effective_loyalty', 'excludes'),
  ('function', 'guest_charging_impact', 'excludes'),
  ('function', 'guest_sessions_period', 'excludes'),
  ('function', 'initiate_registration_fee_payment', 'excludes'),
  ('function', 'list_guest_sessions_paid', 'excludes'),
  ('function', 'mark_class_attendance', 'excludes'),
  ('function', 'materialize_class_sessions', 'excludes'),
  ('function', 'staff_account_for_reset', 'excludes'),
  ('function', 'staff_roles', 'excludes'),
  ('function', 'support_rpc_role', 'excludes'),
  ('function', 'update_class', 'excludes'),
  ('function', 'update_staff_role', 'excludes'),
  ('function', 'void_registration_fee_payment', 'excludes'),
  ('function', 'confirm_renewal', 'includes'),
  ('function', 'create_staff_member', 'includes'),
  ('function', 'record_registration_fee', 'includes'),
  ('function', 'record_session_payment', 'includes'),
  ('function', 'renew_subscription', 'includes'),
  ('function', 'set_guest_charging', 'includes'),
  ('function', 'set_gym_category', 'includes'),
  ('function', 'set_loyalty_program', 'includes'),
  ('function', 'set_registration_fee', 'includes'),
  ('function', 'update_plan_pricing', 'includes'),
  ('function', 'waive_registration_fee', 'includes');
create temp table found_sup as
  select 'policy'::text as kind, p.tablename || '.' || p.policyname as name from pg_policies p
   where coalesce(p.qual, '') || coalesce(p.with_check, '') like '%''supervisor''%'
  union
  select 'function', p.proname::text from pg_proc p
   where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace) and p.prokind = 'f' and p.prosrc like '%''supervisor''%';
select is((select coalesce(array_agg(kind || ':' || name order by kind, name), '{}') from found_sup where (kind, name) not in (select kind, name from cls)),
          '{}'::text[], 'catalog: no policy or function naming ''supervisor'' is unclassified');
select is((select coalesce(array_agg(kind || ':' || name order by kind, name), '{}') from cls where (kind, name) not in (select kind, name from found_sup)),
          '{}'::text[], 'catalog: no classification is stale');
-- the two payment-connection RPCs (23.9) check no role list, so they never name 'supervisor'; they are classified by their capability
select is((select coalesce(array_agg(name order by name), '{}') from (
              select name from cls where kind = 'function' and support = 'includes'
              union select object_name from private.support_capabilities where capability = 'payment_connection') x),
          (select coalesce(array_agg(object_name order by object_name), '{}') from private.support_capabilities where kind = 'rpc'),
          'catalog: the functions classified includes-support are exactly the listed RPCs');
select is((select count(*)::int from cls c join pg_proc p on p.pronamespace in ('public'::regnamespace, 'private'::regnamespace) and p.proname = c.name
            where c.kind = 'function' and c.support = 'excludes' and c.name <> 'support_rpc_role' and p.prosrc like '%support_rpc_%'), 0,
          'catalog: a function classified excludes-support does not call the helpers');
select is((select count(*)::int from cls c join pg_policies p on c.kind = 'policy' and p.tablename || '.' || p.policyname = c.name
            where coalesce(p.qual, '') || coalesce(p.with_check, '') like '%support%'), 0,
          'catalog: a policy classified excludes-support does not name support (it lists explicit roles; the opt-ins are separate support_* policies)');
select is((select count(*)::int from pg_policies where policyname like 'support\_%' and tablename || '.' || policyname not in (select object_name from private.support_capabilities where kind = 'policy')
            and policyname not in ('support_gate_probe')), 0, 'catalog: every support_* policy is listed');

-- ============================================================================================================
-- B. not live
-- ============================================================================================================
create or replace function pg_temp.visible() returns text language plpgsql as $f$
begin
  return (select count(*) from plans) || '/' || (select count(*) from payments) || '/' || (select count(*) from refunds) || '/'
      || (select count(*) from subscriptions) || '/' || (select count(*) from members where user_id <> auth.uid());
end $f$;
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-000000236101', 'support', 'aal1', '00000000-0000-0000-0000-000000236001', '00000000-0000-0000-0000-0000000236a1');
select is(pg_temp.visible(), '0/0/0/0/0', 'aal1: zero rows');
select is(pg_temp.err($$select set_registration_fee(100)$$), 'P0001:permission denied', 'aal1: RPC refused');
select pg_temp.claims('00000000-0000-0000-0000-000000236101', 'support', 'aal2', null, '00000000-0000-0000-0000-0000000236a1');
select is(pg_temp.visible(), '0/0/0/0/0', 'no gym in the claim: zero rows');
select pg_temp.claims('00000000-0000-0000-0000-000000236101', 'support', 'aal2', '00000000-0000-0000-0000-000000236002', '00000000-0000-0000-0000-0000000236a1');
select is(pg_temp.visible(), '0/0/0/0/0', 'a gym with no assignment: zero rows');
select is(pg_temp.err($$select update_plan_pricing('00000000-0000-0000-0000-000000236503', 'monthly', 1, 30, 'monthly', null, null)$$), 'P0001:permission denied', 'a gym with no assignment: RPC refused');
select pg_temp.claims('00000000-0000-0000-0000-000000236101', 'support', 'aal2', '00000000-0000-0000-0000-000000236001', null);
select is(pg_temp.visible(), '0/0/0/0/0', 'no session: zero rows');
reset role;
-- switch off, assignment suspended, session expired
select set_config('gymos.allow_support_setter', 'on', true);
update gyms set allow_gymos_support = false where id = '00000000-0000-0000-0000-000000236001';
select set_config('gymos.allow_support_setter', 'off', true);
set local role authenticated;
select pg_temp.live_support();
select is(pg_temp.visible(), '0/0/0/0/0', 'Owner switch off: zero rows');
select is(pg_temp.err($$select set_gym_category('00000000-0000-0000-0000-000000236001', 'other')$$), 'P0001:permission denied', 'Owner switch off: RPC refused');
reset role;
select set_config('gymos.allow_support_setter', 'on', true);
update gyms set allow_gymos_support = true where id = '00000000-0000-0000-0000-000000236001';
select set_config('gymos.allow_support_setter', 'off', true);
update private.support_session_state set last_seen_at = now() - interval '2 hours';
set local role authenticated;
select pg_temp.live_support();
select is(pg_temp.visible(), '0/0/0/0/0', 'idle session: zero rows');
reset role;
update private.support_session_state set last_seen_at = now();
-- assignment not active, every other gate valid
update public.support_assignments set state = 'suspended' where id = '00000000-0000-0000-0000-000000236401';
set local role authenticated;
select pg_temp.live_support();
select is(pg_temp.visible(), '0/0/0/0/0', 'assignment suspended: zero rows');
select is(pg_temp.err($$select set_gym_category('00000000-0000-0000-0000-000000236001', 'other')$$), 'P0001:permission denied', 'assignment suspended: RPC refused');
reset role;
update public.support_assignments set state = 'active' where id = '00000000-0000-0000-0000-000000236401';

-- ============================================================================================================
-- C. allow-list: a live support session succeeds
-- ============================================================================================================
set local role authenticated;
select pg_temp.live_support();
select is(pg_temp.visible(), '2/2/0/2/2', 'live: reads this gym''s plans, payments, subscriptions and member rows only (and nothing of gym B)');
select is((select count(*)::int from plans where gym_id = '00000000-0000-0000-0000-000000236002'), 0, 'live: gym B plans are invisible');
select is((select count(*)::int from members where role <> 'member' and user_id <> auth.uid()), 0, 'live: staff rows (Owner, Supervisor, Manager) are invisible');
-- gym profile and settings
select is(pg_temp.rows($$update gyms set name = 'Cap Gym A Renamed', primary_color = '#112233', timezone = 'Africa/Douala' where id = '00000000-0000-0000-0000-000000236001'$$), '1', 'allow-list: gym profile and settings');
select is(pg_temp.rows($$update gyms set logo_url = 'https://x.example/logo.png' where id = '00000000-0000-0000-0000-000000236001'$$), '1', 'allow-list: gym logo url');
select is(pg_temp.err($$insert into storage.objects (bucket_id, name, owner_id) values ('gym-logos', '00000000-0000-0000-0000-000000236001/logo.png', '00000000-0000-0000-0000-000000236101')$$), 'ok', 'allow-list: upload this gym''s logo');
select alike(pg_temp.err($$insert into storage.objects (bucket_id, name, owner_id) values ('gym-logos', '00000000-0000-0000-0000-000000236002/logo.png', '00000000-0000-0000-0000-000000236101')$$), '42501:%', 'another gym''s logo path is refused');
select is((select count(*)::int from storage.objects where bucket_id = 'gym-logos' and name = '00000000-0000-0000-0000-000000236001/logo.png'), 1, 'allow-list: read this gym''s logo');
-- plans and prices
select is(pg_temp.err($$insert into plans (gym_id, name, plan_type, price, billing_interval, duration_days) values ('00000000-0000-0000-0000-000000236001', 'Support Plan', 'monthly', 5000, 'monthly', 30)$$), 'ok', 'allow-list: create a plan');
select alike(pg_temp.err($$insert into plans (gym_id, name, plan_type, price, billing_interval, duration_days) values ('00000000-0000-0000-0000-000000236002', 'Other Gym Plan', 'monthly', 5000, 'monthly', 30)$$), '42501:%', 'a plan in another gym is refused');
select is(pg_temp.rows($$update plans set name = 'Cap Monthly 2' where id = '00000000-0000-0000-0000-000000236501'$$), '1', 'allow-list: edit a plan');
select is(pg_temp.err($$select update_plan_pricing('00000000-0000-0000-0000-000000236501', 'monthly', 12000, 30, 'monthly', null, null)$$), 'ok', 'allow-list: change a plan price (RPC)');
select is((select price from plans where id = '00000000-0000-0000-0000-000000236501'), 12000, 'the price changed');
select is(pg_temp.rows($$delete from plans where name = 'Support Plan'$$), '1', 'allow-list: delete a plan');
-- registration fee, guest charging, loyalty, category
select is(pg_temp.err($$select set_registration_fee(5000)$$), 'ok', 'allow-list: registration fee');
select is((select registration_fee from gyms where id = '00000000-0000-0000-0000-000000236001'), 5000, 'the registration fee changed');
select is(pg_temp.err($$select set_guest_charging(false)$$), 'ok', 'allow-list: guest charging off');
select is(pg_temp.err($$select set_guest_charging(true)$$), 'ok', 'allow-list: guest charging on');
select is(pg_temp.err($$select set_loyalty_program(true, 5, 6, 3)$$), 'ok', 'allow-list: loyalty');
select is(pg_temp.err($$select set_gym_category('00000000-0000-0000-0000-000000236001', 'yoga_studio')$$), 'ok', 'allow-list: category');
select is(pg_temp.err($$select set_gym_category('00000000-0000-0000-0000-000000236002', 'yoga_studio')$$), 'P0001:permission denied', 'category of another gym is refused');
select is((select category || ':' || loyalty_enabled || ':' || charge_guests_per_session from gyms where id = '00000000-0000-0000-0000-000000236001'), 'yoga_studio:true:true', 'the settings changed');
reset role;
select is((select array_agg(action_type order by action_type) from audit_log where gym_id = '00000000-0000-0000-0000-000000236001' and actor_id = (select id from users where support_proxy_gym_id = '00000000-0000-0000-0000-000000236001')),
          array['guest_charging_changed', 'guest_charging_changed', 'gym_category_changed', 'loyalty_program_changed', 'plan_price_changed', 'registration_fee_changed'],
          'each allow-listed RPC audited its change');
-- members created after the fee is on are unsettled
insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000236207', '00000000-0000-0000-0000-000000236001', '00000000-0000-0000-0000-00000023610c', 'member', 'Member Three'),
  ('00000000-0000-0000-0000-000000236208', '00000000-0000-0000-0000-000000236001', '00000000-0000-0000-0000-00000023610d', 'member', 'Member Four');
update members set registration_fee_settled_at = now() where id = '00000000-0000-0000-0000-000000236205';
set local role authenticated;
select pg_temp.live_support();
select is(pg_temp.err($$select record_registration_fee('00000000-0000-0000-0000-000000236207', 'cash', 'paid at desk')$$), 'ok', 'allow-list: record a registration fee');
-- member records and imports
select is(pg_temp.err($$insert into members (gym_id, user_id, role, name, phone) values ('00000000-0000-0000-0000-000000236001', '00000000-0000-0000-0000-00000023610f', 'member', 'Imported Member', '+237600236099')$$), 'ok', 'allow-list: create a member record (import)');
select is(pg_temp.rows($$update members set name = 'Member One Edited' where id = '00000000-0000-0000-0000-000000236204'$$), '1', 'allow-list: edit a member record');
select alike(pg_temp.err($$insert into members (gym_id, role, name) values ('00000000-0000-0000-0000-000000236001', 'coach', 'Sneaky Coach')$$), '42501:%', 'support cannot insert a staff row through the table');
select is(pg_temp.err($$insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date) values ('00000000-0000-0000-0000-000000236001', '00000000-0000-0000-0000-000000236208', '00000000-0000-0000-0000-000000236501', 'active', current_date, current_date + 30)$$),
          '23514:registration_fee_not_settled: member 00000000-0000-0000-0000-000000236208 has not settled the registration fee, so no subscription can be created'::text, 'subscription insert reaches the table (the fee rule fires)');
select is(pg_temp.err($$insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date) values ('00000000-0000-0000-0000-000000236001', '00000000-0000-0000-0000-000000236207', '00000000-0000-0000-0000-000000236501', 'active', current_date, current_date + 30)$$), 'ok', 'allow-list: assign a plan to a member');
select is(pg_temp.rows($$update subscriptions set expiry_date = current_date + 60 where id = '00000000-0000-0000-0000-000000236601'$$), '1', 'allow-list: edit a subscription');
-- payments
select is(pg_temp.err($$insert into payments (gym_id, member_id, amount, currency, method, status, purpose) values ('00000000-0000-0000-0000-000000236001', '00000000-0000-0000-0000-000000236204', 4000, 'XAF', 'cash', 'pending', 'subscription')$$), 'ok', 'allow-list: record a payment');
select is(pg_temp.rows($$update payments set status = 'verified', amount = 1 where id = '00000000-0000-0000-0000-000000236702'$$), '1', 'allow-list: verify a pending payment');
select is((select amount from payments where id = '00000000-0000-0000-0000-000000236702'), 3000, 'verifying does not let support change the amount');
select is(pg_temp.err($$select record_session_payment('00000000-0000-0000-0000-000000236205', 'cash', null)$$), 'ok', 'allow-list: record a session payment');
select is(pg_temp.err($$select renew_subscription('00000000-0000-0000-0000-000000236204', 'renewed by support')$$), 'ok', 'allow-list: renew a subscription');
select is(pg_temp.err($$select confirm_renewal('00000000-0000-0000-0000-000000236204', 'cash', 'confirmed by support')$$), 'ok', 'allow-list: confirm a renewal');
reset role;
select is((select count(*)::int from audit_log where actor_id = (select id from users where support_proxy_gym_id = '00000000-0000-0000-0000-000000236001')
            and action_type in ('registration_fee_recorded', 'session_payment_recorded', 'subscription_manual_renewal', 'renewal_confirmed')), 4, 'the payment RPCs audited');

-- ============================================================================================================
-- D. denied set, one named negative each
-- ============================================================================================================
set local role authenticated;
select pg_temp.live_support();
select is(pg_temp.err($$update gyms set tier_id = '00000000-0000-0000-0000-000000236302' where id = '00000000-0000-0000-0000-000000236001'$$),
          '42501:support_denied: tier, interval, billing, subscription status, status, cap, token and the support switch are not changeable by support', 'denied: tier');
select alike(pg_temp.err($$update gyms set saas_billing_interval = 'annual' where id = '00000000-0000-0000-0000-000000236001'$$), '42501:support_denied%', 'denied: billing interval');
select alike(pg_temp.err($$update gyms set saas_billing_anchor_date = current_date + 5 where id = '00000000-0000-0000-0000-000000236001'$$), '42501:support_denied%', 'denied: billing anchor');
select alike(pg_temp.err($$update gyms set saas_billing_status = 'past_due' where id = '00000000-0000-0000-0000-000000236001'$$), '42501:support_denied%', 'denied: subscription status');
select alike(pg_temp.err($$update gyms set status = 'suspended' where id = '00000000-0000-0000-0000-000000236001'$$), '42501:support_denied%', 'denied: suspension');
select alike(pg_temp.err($$update gyms set status = 'deactivated' where id = '00000000-0000-0000-0000-000000236001'$$), '42501:support_denied%', 'denied: deactivate the gym');
select is(pg_temp.rows($$delete from gyms where id = '00000000-0000-0000-0000-000000236001'$$), '0', 'denied: delete the gym (no delete policy, zero rows)');
select is(pg_temp.err($$select log_audit_event('support_probe', '00000000-0000-0000-0000-000000236002')$$), 'P0001:log_audit_event: p_gym_id does not match the caller''s own gym', 'a live support session cannot audit into another gym');
select is(pg_temp.err($$select log_audit_event('support_probe', '00000000-0000-0000-0000-000000236001')$$), 'ok', 'a live support session can audit into its own gym');
select alike(pg_temp.err($$update gyms set allow_gymos_support = false where id = '00000000-0000-0000-0000-000000236001'$$), '42501:support_denied%', 'denied: allow_gymos_support (direct update)');
select is(pg_temp.err($$select set_allow_gymos_support('00000000-0000-0000-0000-000000236001', false)$$), 'P0001:permission denied', 'denied: allow_gymos_support (the Owner setter)');
select alike(pg_temp.err($$update gyms set member_cap_override = 999 where id = '00000000-0000-0000-0000-000000236001'$$), '42501:support_denied%', 'denied: member cap override');
select alike(pg_temp.err($$update gyms set gym_token = 'stolen' where id = '00000000-0000-0000-0000-000000236001'$$), '42501:support_denied%', 'denied: gym token');
reset role;
select is((select tier_id || ':' || status || ':' || saas_billing_status || ':' || allow_gymos_support from gyms where id = '00000000-0000-0000-0000-000000236001'),
          '00000000-0000-0000-0000-000000236301:active:active:true', 'the denied updates changed nothing');
select is((select count(*)::int from gyms where id = '00000000-0000-0000-0000-000000236001'), 1, 'the gym still exists after the denied delete');
set local role authenticated;
select pg_temp.live_support();
select is(pg_temp.rows($$update members set email = 'hijack@x.example' where id = '00000000-0000-0000-0000-000000236201'$$), '0', 'denied: Owner contact (email)');
select is(pg_temp.rows($$update members set phone = '+237699999999' where id = '00000000-0000-0000-0000-000000236201'$$), '0', 'denied: Owner contact (phone)');
select is(pg_temp.rows($$update members set name = 'Renamed Owner', role = 'member' where id = '00000000-0000-0000-0000-000000236201'$$), '0', 'denied: Owner edit (direct)');
select is(pg_temp.rows($$update members set name = 'Renamed Supervisor' where id = '00000000-0000-0000-0000-000000236202'$$), '0', 'denied: Supervisor edit (direct)');
select is(pg_temp.err($$select update_staff_role('00000000-0000-0000-0000-000000236201', 'Owner 236', 'manager')$$), 'P0001:update_staff_role: caller has no gym-scoped session', 'denied: Owner edit (RPC)');
select is(pg_temp.err($$select update_staff_role('00000000-0000-0000-0000-000000236202', 'Supervisor 236', 'manager')$$), 'P0001:update_staff_role: caller has no gym-scoped session', 'denied: Supervisor edit (RPC)');
select is(pg_temp.err($$select deactivate_staff_member('00000000-0000-0000-0000-000000236203', 'because')$$), 'P0001:deactivate_staff_member: caller has no gym-scoped session', 'denied: deactivating staff');
select is(pg_temp.rows($$update members set phone = '+237699999998' where id = '00000000-0000-0000-0000-000000236203'$$), '0', 'denied: staff phone change');
select is(pg_temp.err($$select staff_account_for_reset('00000000-0000-0000-0000-000000236203')$$), 'P0001:staff_account_for_reset: caller has no gym-scoped session', 'denied: credential reset');
select is(pg_temp.rows($$update members set role = 'owner' where user_id = auth.uid()$$), '0', 'denied: change its own role (direct)');
select is(pg_temp.err($$select update_staff_role((select id from members where user_id = auth.uid() and role = 'support'), 'GymOS Support', 'manager')$$),
          'P0001:update_staff_role: caller has no gym-scoped session', 'denied: change its own role (RPC)');
select is(pg_temp.rows($$delete from members where role <> 'member'$$), '0', 'denied: deleting staff rows');
-- a member row cannot be promoted: the WITH CHECK (role = 'member') is what stops it, not the USING filter
select alike(pg_temp.err($$update members set role = 'owner' where id = '00000000-0000-0000-0000-000000236204'$$), '42501:%', 'denied: promote a member to owner');
select alike(pg_temp.err($$update members set role = 'supervisor' where id = '00000000-0000-0000-0000-000000236204'$$), '42501:%', 'denied: promote a member to supervisor');
select alike(pg_temp.err($$update members set role = 'manager' where id = '00000000-0000-0000-0000-000000236204'$$), '42501:%', 'denied: promote a member to manager');
select is((select role::text from members where id = '00000000-0000-0000-0000-000000236204'), 'member', 'the member row kept its role');
-- payment policy predicates
select alike(pg_temp.err($$insert into payments (gym_id, member_id, amount, currency, method, status, purpose) values ('00000000-0000-0000-0000-000000236001', '00000000-0000-0000-0000-000000236204', 100, 'XAF', 'cash', 'verified', 'subscription')$$), '42501:%', 'denied: insert an already verified payment');
select alike(pg_temp.err($$insert into payments (gym_id, member_id, amount, currency, method, status, purpose) values ('00000000-0000-0000-0000-000000236001', '00000000-0000-0000-0000-000000236204', 100, 'XAF', 'cash', 'pending', 'registration_fee')$$), '42501:%', 'denied: insert a registration_fee payment directly');
select is(pg_temp.rows($$update payments set status = 'flagged' where id = '00000000-0000-0000-0000-000000236701'$$), '0', 'denied: change the status of a payment that is not pending');
select is(pg_temp.err($$select count(*) from classes$$), 'ok', 'classes read statement runs');
select is((select count(*)::int from classes), 0, 'an unlisted table (classes) shows nothing');
select is((select count(*)::int from audit_log), 0, 'an unlisted table (audit_log) shows nothing');
select is((select count(*)::int from guest_sessions), 0, 'an unlisted table (guest_sessions) shows nothing');
select alike(pg_temp.err($$insert into classes (gym_id, name, coach_id, capacity, schedule_type, one_off_session_at) values ('00000000-0000-0000-0000-000000236001', 'Nope', '00000000-0000-0000-0000-00000023620a', 5, 'one_off', now() + interval '1 day')$$), '42501:%', 'an unlisted table (classes) refuses a write');
select alike(pg_temp.err($$select create_class('Nope', null, null, 5, 'one_off', now() + interval '1 day', null, null, null)$$), 'P0001:%', 'an unlisted RPC (create_class) refuses support');
select alike(pg_temp.err($$select assign_coach('00000000-0000-0000-0000-000000236204', '00000000-0000-0000-0000-000000236203')$$), 'P0001:%', 'an unlisted RPC (assign_coach) refuses support');
reset role;

-- ============================================================================================================
-- E. step-up and the staff ceiling
-- ============================================================================================================
set local role authenticated;
select pg_temp.live_support();
select is(pg_temp.err($$select create_staff_member('00000000-0000-0000-0000-000000236106', 'New Coach', '+237600236106', 'coach')$$),
          'P0001:step_up_required: support_create_staff needs a valid single-use step-up for this subject', 'step-up missing: staff creation refused');
select is(pg_temp.err($$select waive_registration_fee('00000000-0000-0000-0000-000000236208', 'goodwill')$$),
          'P0001:step_up_required: support_waive_registration_fee needs a valid single-use step-up for this subject', 'step-up missing: waiver refused');
select is(pg_temp.err($$insert into refunds (gym_id, payment_id, amount, reason, actor_id) values ('00000000-0000-0000-0000-000000236001', '00000000-0000-0000-0000-000000236701', 500, 'r', '00000000-0000-0000-0000-000000236101')$$),
          'P0001:step_up_required: support_refund needs a valid single-use step-up for this subject', 'step-up missing: refund refused');
reset role;
select is((select count(*)::int from refunds), 0, 'no refund was written');
select is((select count(*)::int from members where id = '00000000-0000-0000-0000-000000236208' and registration_fee_settled_at is null), 1, 'no waiver was written');
-- the grant is bound to the action and to the subject, and is single use
select pg_temp.grant_stepup('support_refund', '00000000-0000-0000-0000-000000236701');
set local role authenticated;
select pg_temp.live_support();
select alike(pg_temp.err($$select waive_registration_fee('00000000-0000-0000-0000-000000236208', 'goodwill')$$), 'P0001:step_up_required%', 'a refund grant does not open a waiver (bound to the action)');
select alike(pg_temp.err($$insert into refunds (gym_id, payment_id, amount, reason, actor_id) values ('00000000-0000-0000-0000-000000236001', '00000000-0000-0000-0000-000000236703', 500, 'r', '00000000-0000-0000-0000-000000236101')$$), 'P0001:step_up_required%', 'a grant for one payment does not cover another (bound to the subject)');
select is(pg_temp.err($$insert into refunds (gym_id, payment_id, amount, reason, actor_id) values ('00000000-0000-0000-0000-000000236001', '00000000-0000-0000-0000-000000236701', 500, 'r', '00000000-0000-0000-0000-000000236101')$$), 'ok', 'allow-list: a refund with its step-up');
select is(pg_temp.err($$insert into refunds (gym_id, payment_id, amount, reason, actor_id) values ('00000000-0000-0000-0000-000000236001', '00000000-0000-0000-0000-000000236701', 500, 'again', '00000000-0000-0000-0000-000000236101')$$),
          'P0001:step_up_required: support_refund needs a valid single-use step-up for this subject', 'the grant is single use');
select is((select count(*)::int from refunds), 1, 'allow-list: read refunds');
reset role;
-- refund policy predicates, each with a valid grant (a failed statement rolls its grant use back)
insert into payments (id, gym_id, member_id, amount, currency, method, status, purpose) values
  ('00000000-0000-0000-0000-000000236704', '00000000-0000-0000-0000-000000236001', '00000000-0000-0000-0000-000000236204', 1000, 'XAF', 'cash', 'verified', 'registration_fee');
select pg_temp.grant_stepup('support_refund', '00000000-0000-0000-0000-000000236701');
select pg_temp.grant_stepup('support_refund', '00000000-0000-0000-0000-000000236704');
select pg_temp.grant_stepup('support_refund', '00000000-0000-0000-0000-000000236703');
set local role authenticated;
select pg_temp.live_support();
select alike(pg_temp.err($$insert into refunds (gym_id, payment_id, amount, reason, actor_id) values ('00000000-0000-0000-0000-000000236001', '00000000-0000-0000-0000-000000236701', 2001, 'r', '00000000-0000-0000-0000-000000236101')$$), '42501:%', 'denied: a refund larger than the payment');
select alike(pg_temp.err($$insert into refunds (gym_id, payment_id, amount, reason, actor_id) values ('00000000-0000-0000-0000-000000236001', '00000000-0000-0000-0000-000000236704', 100, 'r', '00000000-0000-0000-0000-000000236101')$$), '23514:registration_fee_not_refundable%', 'denied: a refund of a registration_fee payment');
select alike(pg_temp.err($$insert into refunds (gym_id, payment_id, amount, reason, actor_id) values ('00000000-0000-0000-0000-000000236001', '00000000-0000-0000-0000-000000236703', 100, 'r', '00000000-0000-0000-0000-000000236101')$$), '42501:%', 'denied: a refund of another gym''s payment, grant in hand');
select is((select count(*)::int from refunds), 1, 'the refused refunds wrote nothing');
reset role;
select pg_temp.grant_stepup('support_waive_registration_fee', '00000000-0000-0000-0000-000000236208');
update private.support_stepup set expires_at = now() - interval '1 minute' where action = 'support_waive_registration_fee';
set local role authenticated;
select pg_temp.live_support();
select alike(pg_temp.err($$select waive_registration_fee('00000000-0000-0000-0000-000000236208', 'goodwill')$$), 'P0001:step_up_required%', 'an expired grant is refused');
reset role;
select pg_temp.grant_stepup('support_waive_registration_fee', '00000000-0000-0000-0000-000000236207');
set local role authenticated;
select pg_temp.live_support();
select alike(pg_temp.err($$select waive_registration_fee('00000000-0000-0000-0000-000000236208', 'goodwill')$$), 'P0001:step_up_required%', 'a grant for another member is not covered');
reset role;
select pg_temp.grant_stepup('support_waive_registration_fee', '00000000-0000-0000-0000-000000236208');
set local role authenticated;
select pg_temp.live_support();
select is(pg_temp.err($$select waive_registration_fee('00000000-0000-0000-0000-000000236208', 'goodwill')$$), 'ok', 'allow-list: a waiver with its step-up');
reset role;
select is((select count(*)::int from members where id = '00000000-0000-0000-0000-000000236208' and registration_fee_settled_at is not null), 1, 'the waiver was written');
-- the ceiling is checked before a grant is spent
select pg_temp.grant_stepup('support_create_staff', '00000000-0000-0000-0000-000000236106');
set local role authenticated;
select pg_temp.live_support();
select alike(pg_temp.err($$select create_staff_member('00000000-0000-0000-0000-000000236106', 'X', '+237600236106', 'owner')$$), 'P0001:create_staff_member: caller is not authorized to create staff with role owner', 'ceiling: support cannot create an Owner');
select alike(pg_temp.err($$select create_staff_member('00000000-0000-0000-0000-000000236106', 'X', '+237600236106', 'supervisor')$$), 'P0001:create_staff_member: caller is not authorized to create staff with role supervisor', 'ceiling: support cannot create a Supervisor');
select alike(pg_temp.err($$select create_staff_member('00000000-0000-0000-0000-000000236106', 'X', '+237600236106', 'support')$$), 'P0001:create_staff_member: caller is not authorized to create staff with role support', 'ceiling: support cannot create another support');
reset role;
select is((select count(*)::int from private.support_stepup where action = 'support_create_staff' and consumed_at is null), 1, 'a refused role does not spend the grant');
set local role authenticated;
select pg_temp.live_support();
select is(pg_temp.err($$select create_staff_member('00000000-0000-0000-0000-000000236106', 'New Coach', '+237600236106', 'coach')$$), 'ok', 'allow-list: create a coach with its step-up');
select alike(pg_temp.err($$select create_staff_member('00000000-0000-0000-0000-000000236106', 'New Coach', '+237600236106', 'coach')$$), 'P0001:step_up_required%', 'a second creation needs a second grant');
reset role;
select pg_temp.grant_stepup('support_create_staff', '00000000-0000-0000-0000-000000236107');
select pg_temp.grant_stepup('support_create_staff', '00000000-0000-0000-0000-000000236103');
select pg_temp.grant_stepup('support_create_staff', '00000000-0000-0000-0000-000000236102');
set local role authenticated;
select pg_temp.live_support();
select is(pg_temp.err($$select create_staff_member('00000000-0000-0000-0000-000000236107', 'New Receptionist', '+237600236107', 'receptionist')$$), 'ok', 'allow-list: create a receptionist');
select alike(pg_temp.err($$select create_staff_member('00000000-0000-0000-0000-000000236103', 'Demoted', '+237600236002', 'manager')$$), 'P0001:create_staff_member: caller is not authorized to replace a staff member with role supervisor', 'ceiling: support cannot replace a Supervisor');
select alike(pg_temp.err($$select create_staff_member('00000000-0000-0000-0000-000000236102', 'Demoted', '+237600236001', 'manager')$$), 'P0001:create_staff_member: caller is not authorized to replace a staff member with role owner', 'ceiling: support cannot replace an Owner');
reset role;
-- an unactivated or foreign account gets no grant
select throws_ok($$select private.stepup_issue('00000000-0000-0000-0000-000000236105', 'support_refund', 'x')$$, '42501', 'permission_denied', 'a non-support user gets no support grant');
select throws_ok($$select private.stepup_issue('00000000-0000-0000-0000-000000236101', 'support_unknown', 'x')$$, '42501', 'permission_denied', 'an unknown support action is refused');
update private.support_accounts set activated_at = null where user_id = '00000000-0000-0000-0000-000000236101';
select throws_ok($$select private.stepup_issue('00000000-0000-0000-0000-000000236101', 'support_refund', 'fence')$$, '42501', 'permission_denied', 'step-up fence: not activated account gets no grant');
update private.support_accounts set activated_at = now() where user_id = '00000000-0000-0000-0000-000000236101';
update private.support_accounts set locked_at = now() where user_id = '00000000-0000-0000-0000-000000236101';
select throws_ok($$select private.stepup_issue('00000000-0000-0000-0000-000000236101', 'support_refund', 'fence')$$, '42501', 'permission_denied', 'step-up fence: locked account gets no grant');
update private.support_accounts set locked_at = null where user_id = '00000000-0000-0000-0000-000000236101';
update private.support_accounts set reset_pending_at = now() where user_id = '00000000-0000-0000-0000-000000236101';
select throws_ok($$select private.stepup_issue('00000000-0000-0000-0000-000000236101', 'support_refund', 'fence')$$, '42501', 'permission_denied', 'step-up fence: reset pending account gets no grant');
update private.support_accounts set reset_pending_at = null where user_id = '00000000-0000-0000-0000-000000236101';
update private.support_accounts set deactivated_at = now() where user_id = '00000000-0000-0000-0000-000000236101';
select throws_ok($$select private.stepup_issue('00000000-0000-0000-0000-000000236101', 'support_refund', 'fence')$$, '42501', 'permission_denied', 'step-up fence: deactivated account gets no grant');
update private.support_accounts set deactivated_at = null where user_id = '00000000-0000-0000-0000-000000236101';
select is((select count(*)::int from private.support_stepup where subject_id = 'fence'), 0, 'step-up fence: no grant row was written');
update private.platform_flags set enabled = true where flag = 'super_admin_aal2';
select is((select private.stepup_issue('00000000-0000-0000-0000-000000236109', 'create_super_admin', 'a@b.example') is not null), true, 'the Super Admin step-up path is unchanged');

-- ============================================================================================================
-- F. tag and revocation
-- ============================================================================================================
select is((select count(*)::int from members where gym_id = '00000000-0000-0000-0000-000000236001' and created_by_support and role in ('coach', 'receptionist') and deactivated_at is null), 2,
          'support-created staff are tagged created_by_support');
select is((select count(*)::int from members where created_by_support and role not in ('coach', 'receptionist')), 0, 'only the two support-created staff carry the tag');
select is((select created_by_support from members where id = '00000000-0000-0000-0000-000000236203'), false, 'staff created by others are not tagged');
update private.platform_flags set enabled = true where flag = 'super_admin_aal2';
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-000000236109', 'super_admin', 'aal2', null, '00000000-0000-0000-0000-0000000236a9');
select is((select ok::text || ':' || code from unassign_support('00000000-0000-0000-0000-000000236401', 'finished the work')), 'true:ended', 'revoke the support person');
reset role;
select is((select count(*)::int from members where gym_id = '00000000-0000-0000-0000-000000236001' and created_by_support and deactivated_at is null), 2, 'revocation leaves support-created staff active and tagged');
select is((select count(*)::int from members where user_id = '00000000-0000-0000-0000-000000236101' and role = 'support' and deactivated_at is null), 0, 'revocation deactivates the support membership');
set local role authenticated;
select pg_temp.live_support();
select is(pg_temp.visible(), '0/0/0/0/0', 'a revoked support person reads nothing');
select is(pg_temp.err($$select set_registration_fee(100)$$), 'P0001:permission denied', 'a revoked support person is refused');
reset role;

select * from finish();
rollback;
