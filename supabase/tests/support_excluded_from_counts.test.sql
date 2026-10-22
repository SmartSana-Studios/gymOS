-- Story 23.2: support excluded from staff counts, caps, notifications and metrics (migration 0136).
begin;
select plan(54);

-- ---- fixtures ---------------------------------------------------------------------------------------------------
insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000232301', 'Support Count Tier', 5000, 50000, 2);
insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-000000232001', 'Support Count Gym', '00000000-0000-0000-0000-000000232301', 30);
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000232101', 'sup-232@x.example'),
  ('00000000-0000-0000-0000-000000232102', 'owner-232@x.example'),
  ('00000000-0000-0000-0000-000000232103', 'm1-232@x.example'),
  ('00000000-0000-0000-0000-000000232104', 'm2-232@x.example'),
  ('00000000-0000-0000-0000-000000232105', 'sv-232@x.example'),
  ('00000000-0000-0000-0000-000000232106', 'm3-232@x.example'),
  ('00000000-0000-0000-0000-000000232107', 'admin-232@x.example');
update users set is_super_admin = true where id = '00000000-0000-0000-0000-000000232107';

insert into members (id, gym_id, user_id, role, name, phone) values
  ('00000000-0000-0000-0000-000000232201', '00000000-0000-0000-0000-000000232001', '00000000-0000-0000-0000-000000232102', 'owner', 'Owner 232', '+237600232102'),
  ('00000000-0000-0000-0000-000000232205', '00000000-0000-0000-0000-000000232001', '00000000-0000-0000-0000-000000232105', 'supervisor', 'Supervisor 232', '+237600232105');

-- baseline for the metrics delta (taken before any support row exists)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000232107","role":"authenticated","app_role":"super_admin"}', true);
select set_config('gymos_test.pm0', (select total_members::text from platform_metrics()), true);
select set_config('gymos_test.gc0', gym_member_count('00000000-0000-0000-0000-000000232001')::text, true);
reset role;

insert into private.support_accounts (user_id, activated_at) values ('00000000-0000-0000-0000-000000232101', now());
insert into public.support_assignments (id, support_user_id, gym_id, state, activated_at)
values ('00000000-0000-0000-0000-000000232401', '00000000-0000-0000-0000-000000232101', '00000000-0000-0000-0000-000000232001', 'active', now());
select private.support_set_membership('00000000-0000-0000-0000-000000232401', true);
select set_config('gymos_test.sup', (select id::text from members where user_id = '00000000-0000-0000-0000-000000232101'), true);

-- ---- shared definition ------------------------------------------------------------------------------------------
select is(private.staff_roles()::text[], array['owner', 'supervisor', 'manager', 'receptionist', 'coach'], 'staff_roles(): the five staff roles');
select ok(not ('support' = any (private.staff_roles()::text[])) and not ('member' = any (private.staff_roles()::text[])), 'staff_roles(): neither support nor member');
select is(has_function_privilege('anon', 'private.staff_roles()', 'execute'), false, 'staff_roles(): not callable by anon');

-- ---- member cap (cap = 2): the active support row does not consume it -------------------------------------------
select lives_ok($$insert into members (gym_id, user_id, role, name) values ('00000000-0000-0000-0000-000000232001', '00000000-0000-0000-0000-000000232103', 'member', 'M1')$$,
                'cap 2: first member admitted with an active support row present');
select lives_ok($$insert into members (gym_id, user_id, role, name) values ('00000000-0000-0000-0000-000000232001', '00000000-0000-0000-0000-000000232104', 'member', 'M2')$$,
                'cap 2: second member admitted (support not counted)');
select throws_ok($$insert into members (gym_id, user_id, role, name) values ('00000000-0000-0000-0000-000000232001', '00000000-0000-0000-0000-000000232106', 'member', 'M3')$$,
                 'P0001', null, 'cap 2: a third member is refused (the cap counts members only)');
select ok(position($q$role = 'member'$q$ in pg_get_functiondef('public.enforce_member_cap()'::regprocedure)) > 0, 'enforce_member_cap counts role = member only');

-- ---- counts -----------------------------------------------------------------------------------------------------
select is((select count(*)::int from members where gym_id = '00000000-0000-0000-0000-000000232001'), 5, 'fixture: 5 rows (owner, supervisor, support, 2 members)');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000232107","role":"authenticated","app_role":"super_admin"}', true);
select is(gym_member_count('00000000-0000-0000-0000-000000232001'), 4::bigint, 'gym_member_count: owner + supervisor + 2 members, no support');
select is((select total_members from platform_metrics()) - current_setting('gymos_test.pm0')::bigint, 2::bigint, 'platform_metrics: total_members excludes support (counted-support variant would be 3)');
select is(gym_member_count('00000000-0000-0000-0000-000000232001') - current_setting('gymos_test.gc0')::bigint, 2::bigint, 'gym_member_count: only the two members were added since baseline');
reset role;

-- ---- staff RPCs refuse a support target, whatever the caller ----------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000232102","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000232001","app_role":"owner"}', true);
select throws_ok(format($$select update_staff_role(%L, 'Renamed', 'coach')$$, current_setting('gymos_test.sup')),
                 'P0001', 'update_staff_role: target not found or not eligible', 'owner: update_staff_role refuses a support target');
select throws_ok(format($$select deactivate_staff_member(%L, 'because')$$, current_setting('gymos_test.sup')),
                 'P0001', 'deactivate_staff_member: target not found or not eligible', 'owner: deactivate_staff_member refuses a support target');
select throws_ok(format($$select * from staff_account_for_reset(%L)$$, current_setting('gymos_test.sup')),
                 'P0001', 'staff_account_for_reset: target not found or not eligible', 'owner: staff_account_for_reset refuses a support target');
select throws_ok($$select create_staff_member('00000000-0000-0000-0000-000000232101', 'Takeover', '+237600232999', 'coach')$$,
                 'P0001', 'create_staff_member: target not found or not eligible', 'owner: create_staff_member refuses to replace a support membership');
-- control: the same RPCs still work on a real staff target
select lives_ok($$select update_staff_role('00000000-0000-0000-0000-000000232205', 'Supervisor Renamed', 'manager')$$, 'control: owner can still change a supervisor');

-- the supervisor was just demoted to manager above, so use the Owner again for a supervisor-caller proof below
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000232102","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000232001","app_role":"owner"}', true);
select lives_ok($$select update_staff_role('00000000-0000-0000-0000-000000232205', 'Supervisor Back', 'supervisor')$$, 'control: owner restores the supervisor');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000232105","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000232001","app_role":"supervisor"}', true);
select throws_ok(format($$select update_staff_role(%L, 'Renamed', 'coach')$$, current_setting('gymos_test.sup')),
                 'P0001', 'update_staff_role: target not found or not eligible', 'supervisor: update_staff_role refuses a support target');
select throws_ok(format($$select deactivate_staff_member(%L, 'because')$$, current_setting('gymos_test.sup')),
                 'P0001', 'deactivate_staff_member: target not found or not eligible', 'supervisor: deactivate_staff_member refuses a support target');
select throws_ok(format($$select * from staff_account_for_reset(%L)$$, current_setting('gymos_test.sup')),
                 'P0001', 'staff_account_for_reset: target not found or not eligible', 'supervisor: staff_account_for_reset refuses a support target');
select throws_ok($$select create_staff_member('00000000-0000-0000-0000-000000232101', 'Takeover', '+237600232999', 'coach')$$,
                 'P0001', 'create_staff_member: target not found or not eligible', 'supervisor: create_staff_member refuses to replace a support membership');
reset role;
select is((select role::text || '|' || name || '|' || (deactivated_at is null)::text from members where id = current_setting('gymos_test.sup')::uuid),
          'support|GymOS Support|true', 'the support row is unchanged after every refused call');

-- ---- notifications: no alert read, no dispatch ------------------------------------------------------------------
insert into front_desk_alerts (gym_id, member_id, status) values
  ('00000000-0000-0000-0000-000000232001', (select id from members where user_id = '00000000-0000-0000-0000-000000232103'), 'expired');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000232101","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000232001","app_role":"support","aal":"aal2"}', true);
select is((select count(*)::int from front_desk_alerts), 0, 'a support session reads zero front-desk alerts');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000232102","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000232001","app_role":"owner"}', true);
select is((select count(*)::int from front_desk_alerts), 1, 'control: the owner reads the alert');
reset role;

insert into member_preferences (member_id, gym_id)
select id, gym_id from members where gym_id = '00000000-0000-0000-0000-000000232001' and role in ('support', 'member')
on conflict (member_id) do nothing;
select lives_ok($$select run_quiet_gym_alert_job()$$, 'the quiet-gym job runs');
select is((select count(*)::int from private.quiet_gym_alert_dispatches where member_id = current_setting('gymos_test.sup')::uuid), 0,
          'no quiet-gym dispatch to a support membership (even with a preferences row)');
select is((select count(*)::int from notifications where member_id = current_setting('gymos_test.sup')::uuid), 0, 'no notification history row for support');
select ok(position($q$m.role = 'member'$q$ in pg_get_functiondef('public.run_quiet_gym_alert_job()'::regprocedure)) > 0, 'run_quiet_gym_alert_job targets role = member only');

-- ---- phone guards deliberately keep counting support as staff-side ----------------------------------------------
update members set phone = '+237600232555' where id = current_setting('gymos_test.sup')::uuid;
select is(phone_has_staff_membership('+237600232555'), true, 'phone_has_staff_membership still treats a support phone as staff-side');
update tiers set member_cap = 10 where id = '00000000-0000-0000-0000-000000232301';
select throws_ok($$insert into members (gym_id, user_id, role, name) values ('00000000-0000-0000-0000-000000232001', '00000000-0000-0000-0000-000000232101', 'member', 'Dual')$$,
                 '23514', null, 'a support user cannot also be a member (phone separation includes support)');

-- ---- catalog classification (retro 66) --------------------------------------------------------------------------
-- Every function in public/private whose body names 'supervisor' or negates 'member' must be classified here as
-- "excludes" (explicit role list or staff_roles(): support never matches) or "includes" (deliberately counts support).
-- A new match fails this test until it is added to the right list.
create temp table cat_fn (name text primary key, includes_support boolean not null);
insert into cat_fn (name, includes_support) values
  ('private.capability_roles', false), ('private.staff_roles', false), ('private.guest_sessions_period', false), ('private.support_rpc_role', false),
  ('public.assign_coach', false), ('public.check_out_member', false), ('public.confirm_renewal', false), ('public.create_class', false),
  ('public.create_staff_member', false), ('public.deactivate_staff_member', false), ('public.effective_loyalty', false),
  ('public.guest_charging_impact', false), ('public.initiate_registration_fee_payment', false), ('public.list_guest_sessions_paid', false),
  ('public.mark_class_attendance', false), ('public.materialize_class_sessions', false), ('public.record_registration_fee', false),
  ('public.record_session_payment', false), ('public.renew_subscription', false), ('public.set_guest_charging', false),
  ('public.set_gym_category', false), ('public.set_loyalty_program', false), ('public.set_registration_fee', false),
  ('public.staff_account_for_reset', false), ('public.update_class', false), ('public.update_plan_pricing', false),
  ('public.update_staff_role', false), ('public.void_registration_fee_payment', false), ('public.waive_registration_fee', false),
  -- identity separation, not a staff count: a support phone must not double as a member account
  ('private.enforce_staff_member_phone_separation', true), ('public.phone_has_staff_membership', true);

create temp table cat_found as
  select distinct n.nspname || '.' || p.proname as name
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and p.prokind in ('f', 'p')
    and (p.prosrc ~ '''supervisor''' or p.prosrc ~* '(<>|!=)\s*(all\s*\()?\s*(array\[[^]]*)?''member''|not\s+in\s*\([^)]*''member''|''member''\s*(<>|!=)');
select is((select coalesce(string_agg(name, ', ' order by name), '') from cat_found where name not in (select name from cat_fn)), '',
          'catalog: every function naming supervisor or negating member is classified');

-- A negation of 'member' is only allowed where support is deliberately included.
select is((select coalesce(string_agg(n.nspname || '.' || p.proname, ', ' order by p.proname), '')
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname in ('public', 'private') and p.prokind in ('f', 'p')
             and p.prosrc ~* '(<>|!=)\s*(all\s*\()?\s*(array\[[^]]*)?''member''|not\s+in\s*\([^)]*''member''|''member''\s*(<>|!=)'
             and (n.nspname || '.' || p.proname) not in (select name from cat_fn where includes_support)), '',
          'catalog: only the classified includes-support functions negate member');
select is((select coalesce(string_agg(name, ', '), '') from cat_fn where includes_support and name not in
           (select n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where p.prosrc ~* '(<>|!=)\s*(all\s*\()?\s*(array\[[^]]*)?''member''|not\s+in\s*\([^)]*''member''|''member''\s*(<>|!=)')), '', 'catalog: the includes-support entries really are the ones that negate member');

-- Policies carry explicit role lists (support is never in them); a policy that negates member must be reviewed.
select is((select count(*)::int from pg_policies
           where coalesce(qual, '') || coalesce(with_check, '') ~* '(<>|!=)\s*(all\s*\()?\s*(array\[[^]]*)?''member''|not\s+in\s*\([^)]*''member''|''member''\s*(<>|!=)'), 0, 'catalog: no policy negates member');
select is((select count(*)::int from pg_policies
           where coalesce(qual, '') || coalesce(with_check, '') ~ '''support'''
             and policyname not in ('support_gate_probe', 'hide_support_membership', 'read gyms of own active memberships')), 0, 'catalog: no existing policy lists support (denied by default until 23.6)');
-- Every policy naming 'supervisor' is classified here (each lists explicit roles, so support never matches). A new one fails until added.
create temp table cat_pol (name text primary key);
insert into cat_pol (name) values
  ('public.attendance_events.gym_staff_read_own_attendance_events'),
  ('public.audit_log.manager_or_owner_read_own_audit_log'),
  ('public.class_bookings.gym_staff_read_own_class_bookings'),
  ('public.classes.manager_or_owner_insert_own_classes'),
  ('public.classes.manager_or_owner_update_own_classes'),
  ('public.coach_assignments.manager_or_owner_read_own_coach_assignments'),
  ('public.front_desk_alerts.gym_staff_dismiss_own_front_desk_alerts'),
  ('public.front_desk_alerts.gym_staff_read_own_front_desk_alerts'),
  ('public.guest_sessions.gym_staff_read_own_guest_sessions'),
  ('public.loyalty_events.gym_staff_read_own_loyalty_events'),
  ('public.loyalty_progress.gym_staff_read_own_loyalty_progress'),
  ('public.members.gym_staff_read_own_members'),
  ('public.members.manager_or_owner_insert_own_members'),
  ('public.members.manager_or_owner_update_own_members'),
  ('public.members.member_read_gym_staff_members'),
  ('public.payment_discrepancies.gym_staff_read_own_payment_discrepancies'),
  ('public.payments.gym_staff_insert_own_payments'),
  ('public.payments.gym_staff_read_own_payments'),
  ('public.payments.gym_staff_verify_own_payments'),
  ('public.plans.manager_or_owner_delete_own_plans'),
  ('public.plans.manager_or_owner_insert_own_plans'),
  ('public.plans.manager_or_owner_update_own_plans'),
  ('public.refunds.gym_staff_read_own_refunds'),
  ('public.refunds.manager_or_owner_insert_own_refunds'),
  ('public.session_attempts.gym_staff_read_own_session_attempts'),
  ('public.session_notes.manager_or_owner_read_own_session_notes'),
  ('public.subscriptions.gym_staff_read_own_subscriptions'),
  ('public.subscriptions.manager_or_owner_insert_own_subscriptions'),
  ('public.subscriptions.manager_or_owner_update_own_subscriptions'),
  ('public.workout_plan_completions.manager_or_owner_read_own_workout_plan_completions'),
  ('public.workout_plan_exercises.manager_or_owner_read_own_workout_plan_exercises'),
  ('public.workout_plans.manager_or_owner_read_own_workout_plan')
;
select is((select coalesce(string_agg(schemaname || '.' || tablename || '.' || policyname, ', ' order by policyname), '') from pg_policies
           where coalesce(qual, '') || coalesce(with_check, '') ~ '''supervisor'''
             and schemaname || '.' || tablename || '.' || policyname not in (select name from cat_pol)), '',
          'catalog: every policy naming supervisor is classified');
select cmp_ok((select count(*)::int from pg_policies where coalesce(qual, '') || coalesce(with_check, '') ~ '''supervisor'''), '>=', (select count(*)::int from cat_pol), 'catalog: supervisor policies are found (the scan is live)');
select is((select count(*)::int from cat_pol p join pg_policies pp on p.name = pp.schemaname || '.' || pp.tablename || '.' || pp.policyname
           where coalesce(pp.qual, '') || coalesce(pp.with_check, '') !~ '(ARRAY\[|= ''owner''|= ANY)'), 0,
          'catalog: every supervisor policy uses an explicit role list (excludes support)');

-- Consumer scan: every function that counts members rows is classified as member-scoped or support-excluding.
create temp table cat_count (name text primary key, note text not null);
insert into cat_count values
  ('public.book_class_session', 'class capacity, not staff'), ('public.create_workout_plan', 'coach/member plans'),
  ('public.enforce_member_cap', 'role = member only'), ('public.guest_charging_impact', 'guest sessions'),
  ('public.guest_sessions_summary', 'guest sessions'), ('public.gym_member_count', 'excludes support'),
  ('public.list_bookable_class_sessions', 'class capacity'), ('public.list_free_guest_sessions', 'guest sessions'),
  ('public.list_guest_sessions_paid', 'guest sessions'), ('public.list_my_classes', 'class capacity'),
  ('public.list_session_attempts', 'attempts'), ('public.platform_metrics', 'excludes support'),
  ('public.run_quiet_gym_alert_job', 'role = member only'), ('private.support_revoke_access', 'Owner review queue of support-created staff, not a head count'), ('public.update_workout_plan', 'coach/member plans');
select is((select coalesce(string_agg(n.nspname || '.' || p.proname, ', ' order by p.proname), '')
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname in ('public', 'private') and p.prokind = 'f' and p.prosrc ~* 'count\(' and p.prosrc ~* 'members'
             and (n.nspname || '.' || p.proname) not in (select name from cat_count)), '',
          'consumer scan: every function that counts members is classified');
select ok(position($q$role <> 'support'$q$ in pg_get_functiondef('public.gym_member_count(uuid)'::regprocedure)) > 0, 'consumer scan: gym_member_count excludes support');
select ok(position($q$role <> 'support'$q$ in pg_get_functiondef('public.platform_metrics()'::regprocedure)) > 0, 'consumer scan: platform_metrics excludes support');

-- Review fixes: the staff list cannot drift from the enum, and the re-granted functions keep their ACL.
select is((select array_agg(e.enumlabel::text order by e.enumlabel) from pg_enum e where e.enumtypid = 'member_role'::regtype and e.enumlabel not in ('member', 'support')),
          (select array_agg(r::text order by r::text) from unnest(private.staff_roles()) r),
          'private.staff_roles() = member_role minus member and support (a new role must be classified)');
select is(has_function_privilege('anon', f, 'execute'), false, f || ': anon cannot execute')
  from unnest(array['public.update_staff_role(uuid,text,member_role)', 'public.deactivate_staff_member(uuid,text)', 'public.staff_account_for_reset(uuid)',
                    'public.create_staff_member(uuid,text,text,member_role)', 'public.gym_member_count(uuid)', 'public.platform_metrics()']) f;
select is(has_function_privilege('service_role', f, 'execute'), true, f || ': service_role keeps execute')
  from unnest(array['public.update_staff_role(uuid,text,member_role)', 'public.deactivate_staff_member(uuid,text)', 'public.staff_account_for_reset(uuid)',
                    'public.create_staff_member(uuid,text,text,member_role)', 'public.gym_member_count(uuid)', 'public.platform_metrics()']) f;
select * from finish();
rollback;
