-- Story 23-6b: the dashboard support request path (migration 0146).
--   A. hook: a support person has no default gym; only an explicit active_gym_id puts a support gym in the JWT
--   B. support_begin_session / list_own_support_gyms
--   C. support_live_for and the authorize_action matrix (live vs locked, recertification, switch off, expired, no session)
--   D. gym read policies: a stale support membership reads nothing, a live session reads exactly its gym
--   E. catalogs: current_gym_status callers, audit actions of allow-listed RPCs, Realtime tables behind the live gate
begin;
select plan(65);

create or replace function pg_temp.claims(uid text, app_role text, aal text, gym text default null, sid text default null) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"' || uid || '","role":"authenticated","aal":"' || aal || '"'
    || case when sid is null then '' else ',"session_id":"' || sid || '"' end
    || case when app_role is null then '' else ',"app_role":"' || app_role || '"' end
    || case when gym is null then '' else ',"gym_id":"' || gym || '"' end || '}', true);
end $f$;
create or replace function pg_temp.hook(uid text, aal text) returns jsonb language sql as $f$
  select public.custom_access_token_hook(jsonb_build_object('user_id', uid,
           'claims', jsonb_build_object('sub', uid, 'aal', aal, 'role', 'authenticated'))) -> 'claims' $f$;
-- 'true:allowed:support' style answer of the shared decision
create or replace function pg_temp.authz(p_cap text, p_gym text, p_session text default '00000000-0000-0000-0000-0000236ba001') returns text language sql as $f$
  select a.allowed || ':' || a.reason || ':' || coalesce(a.actor_role, '-')
    from public.authorize_action('00000000-0000-0000-0000-00236b000101'::uuid, p_gym::uuid, p_cap, p_session::uuid) a $f$;

-- ---- fixtures ---------------------------------------------------------------------------------------------------
insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-00236b000301', 'RP Tier', 5000, 50000, 30);
insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-00236b000001', 'RP Gym A', '00000000-0000-0000-0000-00236b000301', 30),
  ('00000000-0000-0000-0000-00236b000002', 'RP Gym B', '00000000-0000-0000-0000-00236b000301', 30),
  ('00000000-0000-0000-0000-00236b000003', 'RP Gym C', '00000000-0000-0000-0000-00236b000301', 30),
  ('00000000-0000-0000-0000-00236b000004', 'RP Gym D', '00000000-0000-0000-0000-00236b000301', 30);
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-00236b000101', 'sup-rp@gymosapps.com', now()),
  ('00000000-0000-0000-0000-00236b000102', 'owner-rp@x.example', now()),
  ('00000000-0000-0000-0000-00236b000103', 'recept-rp@x.example', now()),
  ('00000000-0000-0000-0000-00236b000104', 'member-rp@x.example', now()),
  ('00000000-0000-0000-0000-00236b000105', 'sup2-rp@gymosapps.com', now());
insert into members (id, gym_id, user_id, role, name, email, phone) values
  ('00000000-0000-0000-0000-00236b000201', '00000000-0000-0000-0000-00236b000001', '00000000-0000-0000-0000-00236b000102', 'owner', 'Owner RP', 'o@x.example', '+237600236001'),
  ('00000000-0000-0000-0000-00236b000202', '00000000-0000-0000-0000-00236b000001', '00000000-0000-0000-0000-00236b000103', 'receptionist', 'Recept RP', null, '+237600236002'),
  ('00000000-0000-0000-0000-00236b000203', '00000000-0000-0000-0000-00236b000001', '00000000-0000-0000-0000-00236b000104', 'member', 'Member RP', null, null),
  -- a second person who is support in gym D but an ordinary receptionist in gym C: the fallback must pick C, never D
  ('00000000-0000-0000-0000-00236b000204', '00000000-0000-0000-0000-00236b000003', '00000000-0000-0000-0000-00236b000105', 'receptionist', 'Sup2 Recept', null, '+237600236003');
insert into payments (id, gym_id, member_id, amount, currency, method, status, purpose) values
  ('00000000-0000-0000-0000-00236b000701', '00000000-0000-0000-0000-00236b000001', '00000000-0000-0000-0000-00236b000203', 2000, 'XAF', 'cash', 'verified', 'session');
insert into front_desk_alerts (gym_id, member_id, kind, status)
values ('00000000-0000-0000-0000-00236b000001', '00000000-0000-0000-0000-00236b000203', 'subscription_status', 'expired');

insert into private.support_accounts (user_id, activated_at) values
  ('00000000-0000-0000-0000-00236b000101', now()),
  ('00000000-0000-0000-0000-00236b000105', now());
-- gym A and B: switch on and an active assignment; gym C: switch on, suspended assignment; gym D (sup2): active assignment
select set_config('gymos.allow_support_setter', 'on', true);
update gyms set allow_gymos_support = true where id in ('00000000-0000-0000-0000-00236b000001', '00000000-0000-0000-0000-00236b000002', '00000000-0000-0000-0000-00236b000003', '00000000-0000-0000-0000-00236b000004');
select set_config('gymos.allow_support_setter', 'off', true);
insert into public.support_assignments (id, support_user_id, gym_id, state, activated_at) values
  ('00000000-0000-0000-0000-00236b000401', '00000000-0000-0000-0000-00236b000101', '00000000-0000-0000-0000-00236b000001', 'active', now()),
  ('00000000-0000-0000-0000-00236b000402', '00000000-0000-0000-0000-00236b000101', '00000000-0000-0000-0000-00236b000002', 'active', now()),
  ('00000000-0000-0000-0000-00236b000403', '00000000-0000-0000-0000-00236b000101', '00000000-0000-0000-0000-00236b000003', 'suspended', now()),
  ('00000000-0000-0000-0000-00236b000404', '00000000-0000-0000-0000-00236b000105', '00000000-0000-0000-0000-00236b000004', 'active', now());
select private.support_set_membership('00000000-0000-0000-0000-00236b000401', true);
select private.support_set_membership('00000000-0000-0000-0000-00236b000402', true);
select private.support_set_membership('00000000-0000-0000-0000-00236b000404', true);
insert into auth.sessions (id, user_id, created_at, updated_at, aal) values
  ('00000000-0000-0000-0000-0000236ba001', '00000000-0000-0000-0000-00236b000101', now(), now(), 'aal2'),
  ('00000000-0000-0000-0000-0000236ba002', '00000000-0000-0000-0000-00236b000101', now(), now(), 'aal1'),
  ('00000000-0000-0000-0000-0000236ba003', '00000000-0000-0000-0000-00236b000102', now(), now(), 'aal2');
insert into private.support_session_state (session_id, user_id, started_at, last_seen_at) values
  ('00000000-0000-0000-0000-0000236ba001', '00000000-0000-0000-0000-00236b000101', now(), now()),
  ('00000000-0000-0000-0000-0000236ba002', '00000000-0000-0000-0000-00236b000101', now(), now());

-- ============================================================================================================
-- A. hook: no default gym for support
-- ============================================================================================================
select is(pg_temp.hook('00000000-0000-0000-0000-00236b000101', 'aal2') ->> 'gym_id', null, 'A1 hook: a support person with no explicit gym gets no gym_id, whatever the assignments');
select is(pg_temp.hook('00000000-0000-0000-0000-00236b000101', 'aal2') ->> 'app_role', null, 'A2 hook: ... and no app_role');
select is(pg_temp.hook('00000000-0000-0000-0000-00236b000105', 'aal2') ->> 'gym_id', '00000000-0000-0000-0000-00236b000003',
          'A3 hook: the fallback picks the ordinary membership, never the support one');
select is(pg_temp.hook('00000000-0000-0000-0000-00236b000105', 'aal2') ->> 'app_role', 'receptionist', 'A4 hook: ... with that membership''s role');
update users set active_gym_id = '00000000-0000-0000-0000-00236b000002' where id = '00000000-0000-0000-0000-00236b000101';
select is(pg_temp.hook('00000000-0000-0000-0000-00236b000101', 'aal2') ->> 'gym_id', '00000000-0000-0000-0000-00236b000002', 'A5 hook: an explicit gym with an active assignment at aal2 is emitted');
select is(pg_temp.hook('00000000-0000-0000-0000-00236b000101', 'aal2') ->> 'app_role', 'support', 'A6 hook: ... as role support');
select is(pg_temp.hook('00000000-0000-0000-0000-00236b000101', 'aal1') ->> 'gym_id', null, 'A7 hook: the same explicit gym at aal1 emits nothing');
update users set active_gym_id = '00000000-0000-0000-0000-00236b000003' where id = '00000000-0000-0000-0000-00236b000101';
select is(pg_temp.hook('00000000-0000-0000-0000-00236b000101', 'aal2') ->> 'gym_id', null, 'A8 hook: an explicit gym with a suspended assignment emits nothing and does not fall through to another support gym');
update users set active_gym_id = null where id = '00000000-0000-0000-0000-00236b000101';

-- ============================================================================================================
-- B. support_begin_session and the picker list
-- ============================================================================================================
update users set active_gym_id = '00000000-0000-0000-0000-00236b000001' where id in ('00000000-0000-0000-0000-00236b000101', '00000000-0000-0000-0000-00236b000102');
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-00236b000101', null, 'aal1');
select throws_ok($$select public.support_begin_session()$$, 'P0001', null, 'B1 support_begin_session refuses an aal1 session');
select pg_temp.claims('00000000-0000-0000-0000-00236b000101', null, 'aal2', null, '00000000-0000-0000-0000-0000236ba001');
select lives_ok($$select public.support_begin_session()$$, 'B2 support_begin_session runs at aal2');
reset role;
select is((select active_gym_id from users where id = '00000000-0000-0000-0000-00236b000101'), null, 'B3 it clears the support person''s active gym');
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-00236b000102', null, 'aal2', null, '00000000-0000-0000-0000-0000236ba003');
select lives_ok($$select public.support_begin_session()$$, 'B4 a person with no support assignment can call it');
reset role;
select is((select active_gym_id from users where id = '00000000-0000-0000-0000-00236b000102'), '00000000-0000-0000-0000-00236b000001', 'B5 ... and nothing changes for them');

-- B5a-c (23-6c, migration 0147): an accepted code clears the run of wrong sign-in codes, except for a locked account
insert into private.super_admin_lockout (user_id, failed_count) values ('00000000-0000-0000-0000-00236b000101', 3) on conflict (user_id) do update set failed_count = 3;
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-00236b000101', null, 'aal2', null, '00000000-0000-0000-0000-0000236ba001');
select public.support_begin_session();
reset role;
select is((select failed_count from private.super_admin_lockout where user_id = '00000000-0000-0000-0000-00236b000101'), 0, 'B5a support_begin_session clears the wrong-code counter');
update private.super_admin_lockout set failed_count = 3 where user_id = '00000000-0000-0000-0000-00236b000101';
update private.support_accounts set locked_at = now() where user_id = '00000000-0000-0000-0000-00236b000101';
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-00236b000101', null, 'aal2', null, '00000000-0000-0000-0000-0000236ba001');
select public.support_begin_session();
reset role;
select is((select failed_count from private.super_admin_lockout where user_id = '00000000-0000-0000-0000-00236b000101'), 3, 'B5b a locked account keeps its count');
update private.support_accounts set locked_at = null where user_id = '00000000-0000-0000-0000-00236b000101';
delete from private.super_admin_lockout where user_id = '00000000-0000-0000-0000-00236b000101';
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-00236b000102', null, 'aal2', null, '00000000-0000-0000-0000-0000236ba003');
select lives_ok($$select public.support_begin_session()$$, 'B5c a person with no support account is untouched and raises nothing');
reset role;

set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-00236b000101', null, 'aal2', null, '00000000-0000-0000-0000-0000236ba001');
select is((select array_agg(gym_name order by gym_name) from public.list_own_support_gyms()), array['RP Gym A', 'RP Gym B']::text[],
          'B6 the picker lists the active assignments only (not the suspended one)');
select pg_temp.claims('00000000-0000-0000-0000-00236b000101', null, 'aal1', null, '00000000-0000-0000-0000-0000236ba002');
select is((select count(*)::int from public.list_own_support_gyms()), 0, 'B7 the picker list is empty at aal1');
select pg_temp.claims('00000000-0000-0000-0000-00236b000102', null, 'aal2', null, '00000000-0000-0000-0000-0000236ba003');
select is((select count(*)::int from public.list_own_support_gyms()), 0, 'B8 the picker list is empty for a person with no assignment');
reset role;
select set_config('gymos.allow_support_setter', 'on', true);
update gyms set allow_gymos_support = false where id = '00000000-0000-0000-0000-00236b000002';
select set_config('gymos.allow_support_setter', 'off', true);
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-00236b000101', null, 'aal2', null, '00000000-0000-0000-0000-0000236ba001');
select is((select array_agg(gym_name order by gym_name) from public.list_own_support_gyms()), array['RP Gym A']::text[], 'B9 a gym whose switch is off drops out of the picker');
reset role;
select set_config('gymos.allow_support_setter', 'on', true);
update gyms set allow_gymos_support = true where id = '00000000-0000-0000-0000-00236b000002';
select set_config('gymos.allow_support_setter', 'off', true);
select is(has_function_privilege('anon', 'public.list_own_support_gyms()', 'execute') or has_function_privilege('anon', 'public.support_begin_session()', 'execute'),
          false, 'B10 anon cannot call the request-path functions');

-- ============================================================================================================
-- C. support_live_for and the authorize_action matrix
-- ============================================================================================================
select is(private.support_live_for('00000000-0000-0000-0000-00236b000101', '00000000-0000-0000-0000-00236b000001', '00000000-0000-0000-0000-0000236ba001'), true, 'C1 support_live_for: live');
select is(private.support_live_for('00000000-0000-0000-0000-00236b000101', '00000000-0000-0000-0000-00236b000001', '00000000-0000-0000-0000-0000236ba002'), false, 'C2 an aal1 session is not live');
select is(private.support_live_for('00000000-0000-0000-0000-00236b000101', '00000000-0000-0000-0000-00236b000001', '00000000-0000-0000-0000-0000236ba003'), false, 'C3 a session of another person is not live');
select is(private.support_live_for('00000000-0000-0000-0000-00236b000101', '00000000-0000-0000-0000-00236b000001', null), false, 'C4 no session is not live');
select is(private.support_live_for('00000000-0000-0000-0000-00236b000101', '00000000-0000-0000-0000-00236b000003', '00000000-0000-0000-0000-0000236ba001'), false, 'C5 a gym with a suspended assignment is not live');
select is(private.support_live_for('00000000-0000-0000-0000-00236b000101', '00000000-0000-0000-0000-00236b000004', '00000000-0000-0000-0000-0000236ba001'), false, 'C6 a gym the person is not assigned to is not live');

select is(pg_temp.authz('staff.create', '00000000-0000-0000-0000-00236b000001'), 'true:allowed:support', 'C7 live support: staff.create allowed');
select is(pg_temp.authz('member.provision', '00000000-0000-0000-0000-00236b000001'), 'true:allowed:support', 'C8 live support: member.provision allowed');
select is(pg_temp.authz('member.registration_fee_state', '00000000-0000-0000-0000-00236b000001'), 'true:allowed:support', 'C9 live support: member.registration_fee_state allowed');
select is(pg_temp.authz('payment.initiate_staff', '00000000-0000-0000-0000-00236b000001'), 'true:allowed:support', 'C10 live support: payment.initiate_staff allowed');
select is(pg_temp.authz('billing.saas_pay', '00000000-0000-0000-0000-00236b000001'), 'false:role_not_permitted:support', 'C11 support is not on billing.saas_pay');
select is(pg_temp.authz('payment.initiate_own', '00000000-0000-0000-0000-00236b000001'), 'false:role_not_permitted:support', 'C12 support is not on payment.initiate_own');
select is(pg_temp.authz('platform.gym_create', '00000000-0000-0000-0000-00236b000001'), 'false:not_super_admin:-', 'C13 support is not a platform actor');
select is(pg_temp.authz('staff.create', '00000000-0000-0000-0000-00236b000001', null), 'false:support_not_live:support', 'C14 no session id: denied');
select is(pg_temp.authz('staff.create', '00000000-0000-0000-0000-00236b000001', '00000000-0000-0000-0000-0000236ba002'), 'false:support_not_live:support', 'C15 an aal1 session: denied');
select is(pg_temp.authz('staff.create', '00000000-0000-0000-0000-00236b000003'), 'false:not_member:-', 'C16 a gym with no support membership: denied');
select is(pg_temp.authz('staff.create', '00000000-0000-0000-0000-00236b000002') , 'true:allowed:support', 'C17 the second assigned gym is allowed too');

update private.support_accounts set locked_at = now() where user_id = '00000000-0000-0000-0000-00236b000101';
select is(pg_temp.authz('member.provision', '00000000-0000-0000-0000-00236b000001'), 'false:support_not_live:support', 'C18 locked: denied');
update private.support_accounts set locked_at = null where user_id = '00000000-0000-0000-0000-00236b000101';
update private.support_accounts set recertify_due_at = now() - interval '1 minute' where user_id = '00000000-0000-0000-0000-00236b000101';
select is(pg_temp.authz('member.provision', '00000000-0000-0000-0000-00236b000001'), 'false:support_not_live:support', 'C19 recertification lapsed: denied');
update private.support_accounts set recertify_due_at = now() + interval '30 days' where user_id = '00000000-0000-0000-0000-00236b000101';
update private.support_accounts set reset_pending_at = now() where user_id = '00000000-0000-0000-0000-00236b000101';
select is(pg_temp.authz('member.provision', '00000000-0000-0000-0000-00236b000001'), 'false:support_not_live:support', 'C20 factor reset pending: denied');
update private.support_accounts set reset_pending_at = null where user_id = '00000000-0000-0000-0000-00236b000101';
update private.support_session_state set last_seen_at = now() - interval '1 day' where session_id = '00000000-0000-0000-0000-0000236ba001';
select is(pg_temp.authz('member.provision', '00000000-0000-0000-0000-00236b000001'), 'false:support_not_live:support', 'C21 idle limit passed: denied');
update private.support_session_state set last_seen_at = now(), started_at = now() - interval '2 days' where session_id = '00000000-0000-0000-0000-0000236ba001';
select is(pg_temp.authz('member.provision', '00000000-0000-0000-0000-00236b000001'), 'false:support_not_live:support', 'C22 absolute limit passed: denied');
update private.support_session_state set started_at = now() where session_id = '00000000-0000-0000-0000-0000236ba001';
select set_config('gymos.allow_support_setter', 'on', true);
update gyms set allow_gymos_support = false where id = '00000000-0000-0000-0000-00236b000001';
select set_config('gymos.allow_support_setter', 'off', true);
select is(pg_temp.authz('member.provision', '00000000-0000-0000-0000-00236b000001'), 'false:support_not_live:support', 'C23 Owner switch off: denied');
select set_config('gymos.allow_support_setter', 'on', true);
update gyms set allow_gymos_support = true where id = '00000000-0000-0000-0000-00236b000001';
select set_config('gymos.allow_support_setter', 'off', true);
update public.support_assignments set state = 'suspended' where id = '00000000-0000-0000-0000-00236b000401';
select is(pg_temp.authz('member.provision', '00000000-0000-0000-0000-00236b000001'), 'false:support_not_live:support', 'C24 assignment no longer active (membership row still there): denied');
update public.support_assignments set state = 'active' where id = '00000000-0000-0000-0000-00236b000401';
select is(pg_temp.authz('member.provision', '00000000-0000-0000-0000-00236b000001'), 'true:allowed:support', 'C25 ... and allowed again once everything holds');

select is((select a.allowed || ':' || a.reason from public.authorize_action('00000000-0000-0000-0000-00236b000102', '00000000-0000-0000-0000-00236b000001', 'staff.create') a),
          'true:allowed', 'C26 the 3-argument call still works and an Owner is unchanged');
select is((select a.allowed || ':' || a.reason from public.authorize_action('00000000-0000-0000-0000-00236b000103', '00000000-0000-0000-0000-00236b000001', 'staff.create') a),
          'false:role_not_permitted', 'C27 a receptionist is still refused staff.create');

-- ============================================================================================================
-- D. gym read policies
-- ============================================================================================================
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-00236b000101', 'support', 'aal2', '00000000-0000-0000-0000-00236b000001', '00000000-0000-0000-0000-0000236ba001');
select is((select array_agg(name order by name) from gyms where name like 'RP Gym%'), array['RP Gym A']::text[], 'D1 a live support session reads exactly its one gym');
select pg_temp.claims('00000000-0000-0000-0000-00236b000101', 'support', 'aal1', '00000000-0000-0000-0000-00236b000001', '00000000-0000-0000-0000-0000236ba002');
select is((select count(*)::int from gyms where name like 'RP Gym%'), 0, 'D2 the same claims at aal1 (a stale membership row) read no gym');
select pg_temp.claims('00000000-0000-0000-0000-00236b000101', 'support', 'aal2', '00000000-0000-0000-0000-00236b000001', '00000000-0000-0000-0000-0000236baaaa');
select is((select count(*)::int from gyms where name like 'RP Gym%'), 0, 'D3 an unknown session reads no gym');
select pg_temp.claims('00000000-0000-0000-0000-00236b000102', 'owner', 'aal1', '00000000-0000-0000-0000-00236b000001');
select is((select array_agg(name order by name) from gyms where name like 'RP Gym%'), array['RP Gym A']::text[], 'D4 an Owner still reads their gym through the memberships policy');
reset role;
select is((select count(*)::int from private.support_capabilities where kind = 'policy' and object_name = 'gyms.support_read_own_gym'), 1, 'D5 the new policy is on the allow-list');

-- ============================================================================================================
-- E. catalogs
-- ============================================================================================================
-- E1-E3: every caller of current_gym_status() is listed; where a role check exists it comes BEFORE the suspension check
create temp table cgs as
  select p.proname::text as name,
         position('current_gym_status()' in regexp_replace(p.prosrc, '--[^\n]*', '', 'g')) as st,
         nullif(least(nullif(position('current_member_role' in regexp_replace(p.prosrc, '--[^\n]*', '', 'g')), 0),
                      nullif(position('support_rpc_role' in regexp_replace(p.prosrc, '--[^\n]*', '', 'g')), 0)), 0) as role_at
    from pg_proc p
   where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace) and p.proname <> 'current_gym_status'
     and p.prosrc like '%current_gym_status()%';
select is((select array_agg(distinct name order by name) from cgs),
          array['add_session_note', 'assign_coach', 'book_class_session', 'cancel_class_booking', 'check_in', 'check_out', 'check_out_member', 'confirm_renewal',
                'create_class', 'create_staff_member', 'create_workout_plan', 'deactivate_staff_member', 'edit_session_note', 'effective_loyalty',
                'file_audit_disclosure_request', 'initiate_member_payment', 'initiate_registration_fee_payment', 'initiate_session_payment', 'list_my_class_session_roster',
                'list_my_classes', 'mark_class_attendance', 'materialize_class_sessions', 'record_registration_fee', 'record_session_payment', 'renew_subscription',
                'set_guest_charging', 'set_loyalty_program', 'set_registration_fee', 'support_connect_gym_payment_credentials', 'take_ownership_of_workout_plan',
                'update_class', 'update_plan_pricing', 'update_staff_role', 'update_workout_plan', 'void_registration_fee_payment', 'waive_registration_fee']::text[],
          'E1 the callers of current_gym_status() are exactly the listed functions (a new caller must be added here deliberately)');
select is((select count(*)::int from cgs where role_at is not null and role_at > st), 0,
          'E2 every caller with a role check runs it BEFORE the suspension check (a wrong role never learns the gym state)');
select is((select array_agg(distinct name order by name) from cgs where role_at is null),
          array['create_workout_plan', 'list_my_class_session_roster', 'list_my_classes', 'support_connect_gym_payment_credentials', 'take_ownership_of_workout_plan', 'update_workout_plan']::text[],
          'E3 the callers with no role helper are exactly the six named ones (ownership checks or support-only, each denied to a non-live caller by gym_id/support_gym_id being NULL)');

-- E4-E5: every audit action an allow-listed support RPC (or a trigger it fires) can write is on the support allow-list
create temp table reach_actions as
  with recursive fn as (
    select p.oid, p.proname::text as proname, regexp_replace(p.prosrc, '--[^\n]*', '', 'g') as prosrc
      from pg_proc p where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace) and p.prokind = 'f'
  ), roots as (
    select fn.oid from fn join private.support_capabilities c on c.kind = 'rpc' and c.object_name = fn.proname
    union
    select t.tgfoid from pg_trigger t where not t.tgisinternal and t.tgrelid::regclass::text !~ '^(auth|storage)\.'
  ), reach(oid, proname, prosrc) as (
    select fn.oid, fn.proname, fn.prosrc from fn join roots r on r.oid = fn.oid
    union
    select f2.oid, f2.proname, f2.prosrc from reach r join fn f2 on f2.oid <> r.oid
       and f2.proname not in ('log_audit_event', 'gym_id', 'current_member_role', 'current_gym_status', 'support_gym_id', 'is_super_admin', 'actor_id')
       and r.prosrc ~ ('\m' || f2.proname || '\s*\(')
  )
  select distinct m[1] as action_type, proname from reach, regexp_matches(prosrc, '(?:p_action_type\s*=>|log_audit_event\(\s*)\s*''([a-z_]+)''', 'g') m;
select ok((select count(distinct action_type) from reach_actions) >= 18, 'E4 the scan is not vacuous: it finds the audit actions of the allow-listed RPCs and their triggers');
select is((select array_agg(distinct action_type order by action_type) from reach_actions where action_type not in (select action_type from private.support_audit_actions)),
          array['platform_session_config_updated', 'session_attempt_blocked', 'session_consumed']::text[],
          'E5 every audit action reachable from an allow-listed RPC is in support_audit_actions, except three that no support capability triggers (platform config trigger, check-in session triggers)');
select is((select count(*)::int from reach_actions r join private.support_capabilities c on c.kind = 'rpc' and c.object_name = r.proname
            where r.action_type not in (select action_type from private.support_audit_actions)), 0,
          'E6 no allow-listed RPC itself writes an action type missing from the allow-list');

-- E7-E10: Realtime. Every published table is invisible to a support session that is not live, and a live one reads only what the allow-list gives it.
select is((select array_agg(tablename::text order by tablename) from pg_publication_tables where pubname = 'supabase_realtime'),
          array['front_desk_alerts', 'payments']::text[],
          'E7 the Realtime publication holds exactly front_desk_alerts and payments (a new table must be classified here deliberately)');
create or replace function pg_temp.rt_rows() returns text language plpgsql as $f$
declare t record; n bigint; seen text := '';
begin
  for t in select tablename::text as tn from pg_publication_tables where pubname = 'supabase_realtime' order by 1 loop
    execute format('select count(*) from public.%I', t.tn) into n;
    seen := seen || t.tn || '=' || n || ' ';
  end loop;
  return seen;
end $f$;
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-00236b000101', 'support', 'aal1', '00000000-0000-0000-0000-00236b000001', '00000000-0000-0000-0000-0000236ba002');
select is(pg_temp.rt_rows(), 'front_desk_alerts=0 payments=0 ', 'E8 a support session at aal1 receives no Realtime row');
select pg_temp.claims('00000000-0000-0000-0000-00236b000101', 'support', 'aal2', '00000000-0000-0000-0000-00236b000001', '00000000-0000-0000-0000-0000236baaaa');
select is(pg_temp.rt_rows(), 'front_desk_alerts=0 payments=0 ', 'E9 a support session the gate has never seen receives no Realtime row');
select pg_temp.claims('00000000-0000-0000-0000-00236b000101', 'support', 'aal2', '00000000-0000-0000-0000-00236b000002', '00000000-0000-0000-0000-0000236ba001');
select is(pg_temp.rt_rows(), 'front_desk_alerts=0 payments=0 ', 'E10 a live support session in another gym receives no row of this gym');
select pg_temp.claims('00000000-0000-0000-0000-00236b000101', 'support', 'aal2', '00000000-0000-0000-0000-00236b000001', '00000000-0000-0000-0000-0000236ba001');
select is(pg_temp.rt_rows(), 'front_desk_alerts=0 payments=1 ', 'E11 a live support session receives only the allow-listed payments (proof is not vacuous)');
reset role;
update private.support_session_state set last_seen_at = now() - interval '1 day' where session_id = '00000000-0000-0000-0000-0000236ba001';
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-00236b000101', 'support', 'aal2', '00000000-0000-0000-0000-00236b000001', '00000000-0000-0000-0000-0000236ba001');
select is(pg_temp.rt_rows(), 'front_desk_alerts=0 payments=0 ', 'E12 the same session after it goes idle receives nothing (the next event is refused inside the cutoff)');
reset role;

select * from finish();
rollback;
