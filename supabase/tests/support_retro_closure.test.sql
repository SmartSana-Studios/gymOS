-- Epic 23 retro closure (migration 0148).
--   A. the two live-gate entry points agree on every leg (support_live from the JWT, support_live_for from a session id)
--   B. switch ON does not restore a person whose recertification has lapsed (and still restores the others)
--   C. the unused 60 s cutoff setting is gone
--   D. support proxy rows carry no NULL GoTrue token column (migration 0149)
--   E. support_recertification_overdue (migration 0153)
begin;
select plan(27);

create or replace function pg_temp.claims(uid text, app_role text, aal text, gym text default null, sid text default null) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"' || uid || '","role":"authenticated","aal":"' || aal || '"'
    || case when sid is null then '' else ',"session_id":"' || sid || '"' end
    || case when app_role is null then '' else ',"app_role":"' || app_role || '"' end
    || case when gym is null then '' else ',"gym_id":"' || gym || '"' end || '}', true);
end $f$;
create or replace function pg_temp.u(n int) returns text language sql as $f$ select '00000000-0000-0000-0000-' || lpad(to_hex(n), 12, '0') $f$;
-- both entry points for the person S1 in gym A, as 'jwt:for'
create or replace function pg_temp.both(p_gym text default null) returns text language plpgsql as $f$
declare a boolean; b boolean;
begin
  perform pg_temp.claims(pg_temp.u(2348101), 'support', 'aal2', coalesce(p_gym, pg_temp.u(2348001)), pg_temp.u(2348901));
  a := private.support_live(pg_temp.u(2348101)::uuid, coalesce(p_gym, pg_temp.u(2348001))::uuid);
  b := private.support_live_for(pg_temp.u(2348101)::uuid, coalesce(p_gym, pg_temp.u(2348001))::uuid, pg_temp.u(2348901)::uuid);
  return a || ':' || b;
end $f$;

-- ---- fixtures ---------------------------------------------------------------------------------------------------
insert into tiers (id, name, monthly_price, annual_price, member_cap) values (pg_temp.u(2348301)::uuid, 'RC Tier', 5000, 50000, 30);
insert into gyms (id, name, tier_id, capacity) values
  (pg_temp.u(2348001)::uuid, 'RC Gym A', pg_temp.u(2348301)::uuid, 30),
  (pg_temp.u(2348002)::uuid, 'RC Gym B', pg_temp.u(2348301)::uuid, 30);
-- a suspended gym is seeded suspended at insert: a later UPDATE of gyms.status is reverted by a trigger without an error
insert into gyms (id, name, tier_id, capacity, status) values (pg_temp.u(2348003)::uuid, 'RC Gym C', pg_temp.u(2348301)::uuid, 30, 'suspended');
insert into auth.users (id, email, email_confirmed_at) values
  (pg_temp.u(2348101)::uuid, 'rc-s1@gymosapps.com', now()),
  (pg_temp.u(2348102)::uuid, 'rc-s2@gymosapps.com', now()),
  (pg_temp.u(2348103)::uuid, 'rc-s3@gymosapps.com', now()),
  (pg_temp.u(2348110)::uuid, 'rc-owner@x.example', now());
insert into members (id, gym_id, user_id, role, name, email, phone) values
  (pg_temp.u(2348201)::uuid, pg_temp.u(2348001)::uuid, pg_temp.u(2348110)::uuid, 'owner', 'RC Owner', 'rco@x.example', '+237600234801');
insert into private.support_accounts (user_id, activated_at, recertify_due_at) values
  (pg_temp.u(2348101)::uuid, now(), now() + interval '30 days'),
  (pg_temp.u(2348102)::uuid, now(), now() + interval '30 days'),
  (pg_temp.u(2348103)::uuid, now(), now() + interval '30 days');
select set_config('gymos.allow_support_setter', 'on', true);
update gyms set allow_gymos_support = true where id in (pg_temp.u(2348001)::uuid, pg_temp.u(2348002)::uuid);
select set_config('gymos.allow_support_setter', 'off', true);
insert into public.support_assignments (id, support_user_id, gym_id, state, activated_at) values
  (pg_temp.u(2348401)::uuid, pg_temp.u(2348101)::uuid, pg_temp.u(2348001)::uuid, 'active', now()),
  (pg_temp.u(2348402)::uuid, pg_temp.u(2348102)::uuid, pg_temp.u(2348001)::uuid, 'active', now()),
  (pg_temp.u(2348403)::uuid, pg_temp.u(2348103)::uuid, pg_temp.u(2348001)::uuid, 'active', now());
select private.support_set_membership(pg_temp.u(2348401)::uuid, true);
select private.support_set_membership(pg_temp.u(2348402)::uuid, true);
select private.support_set_membership(pg_temp.u(2348403)::uuid, true);
insert into auth.sessions (id, user_id, created_at, updated_at, aal) values
  (pg_temp.u(2348901)::uuid, pg_temp.u(2348101)::uuid, now(), now(), 'aal2');
insert into private.support_session_state (session_id, user_id, started_at, last_seen_at) values
  (pg_temp.u(2348901)::uuid, pg_temp.u(2348101)::uuid, now(), now());

-- ============================================================================================================
-- A. parity of the two live-gate entry points
-- ============================================================================================================
select is(pg_temp.both(), 'true:true', 'A1 all legs hold: both say live');

update private.support_accounts set locked_at = now() where user_id = pg_temp.u(2348101)::uuid;
select is(pg_temp.both(), 'false:false', 'A2 locked: both deny');
update private.support_accounts set locked_at = null where user_id = pg_temp.u(2348101)::uuid;

update private.support_accounts set reset_pending_at = now() where user_id = pg_temp.u(2348101)::uuid;
select is(pg_temp.both(), 'false:false', 'A3 reset pending: both deny');
update private.support_accounts set reset_pending_at = null where user_id = pg_temp.u(2348101)::uuid;

update private.support_accounts set recertify_due_at = now() - interval '1 minute' where user_id = pg_temp.u(2348101)::uuid;
select is(pg_temp.both(), 'false:false', 'A4 recertification lapsed: both deny');
update private.support_accounts set recertify_due_at = now() + interval '30 days' where user_id = pg_temp.u(2348101)::uuid;

update private.support_accounts set activated_at = null where user_id = pg_temp.u(2348101)::uuid;
select is(pg_temp.both(), 'false:false', 'A6 not activated: both deny');
update private.support_accounts set activated_at = now() where user_id = pg_temp.u(2348101)::uuid;

update private.support_session_state set last_seen_at = now() - interval '1 day' where session_id = pg_temp.u(2348901)::uuid;
select is(pg_temp.both(), 'false:false', 'A7 idle limit passed: both deny');
update private.support_session_state set last_seen_at = now(), started_at = now() - interval '2 days' where session_id = pg_temp.u(2348901)::uuid;
select is(pg_temp.both(), 'false:false', 'A8 absolute limit passed: both deny');
update private.support_session_state set started_at = now() where session_id = pg_temp.u(2348901)::uuid;

update public.support_assignments set state = 'suspended' where id = pg_temp.u(2348401)::uuid;
select is(pg_temp.both(), 'false:false', 'A9 assignment not active: both deny');
update public.support_assignments set state = 'active' where id = pg_temp.u(2348401)::uuid;

select set_config('gymos.allow_support_setter', 'on', true);
update gyms set allow_gymos_support = false where id = pg_temp.u(2348001)::uuid;
select set_config('gymos.allow_support_setter', 'off', true);
select is(pg_temp.both(), 'false:false', 'A10 switch off: both deny');
select set_config('gymos.allow_support_setter', 'on', true);
update gyms set allow_gymos_support = true where id = pg_temp.u(2348001)::uuid;
select set_config('gymos.allow_support_setter', 'off', true);

select set_config('gymos.allow_support_setter', 'on', true);
update gyms set allow_gymos_support = true where id = pg_temp.u(2348003)::uuid;
select set_config('gymos.allow_support_setter', 'off', true);
alter table public.support_assignments disable trigger user;
insert into public.support_assignments (id, support_user_id, gym_id, state, activated_at) values (pg_temp.u(2348404)::uuid, pg_temp.u(2348101)::uuid, pg_temp.u(2348003)::uuid, 'active', now());
alter table public.support_assignments enable trigger user;
select is(pg_temp.both(pg_temp.u(2348003)), 'false:false', 'A11 gym not active: both deny');

select is(pg_temp.both(), 'true:true', 'A12 everything restored: both say live again');
select is(private.support_live_for(pg_temp.u(2348101)::uuid, pg_temp.u(2348001)::uuid, null), false, 'A13 no session id: support_live_for denies');
select is(has_function_privilege('authenticated', 'private.support_live_core(uuid, uuid, uuid)', 'execute'), false, 'A14 the shared core is not callable by clients');
select is(has_function_privilege('anon', 'private.support_live_core(uuid, uuid, uuid)', 'execute'), false, 'A15 ... nor by anon');

-- ============================================================================================================
-- B. switch ON skips a lapsed recertification
-- ============================================================================================================
select pg_temp.claims(pg_temp.u(2348110), 'owner', 'aal2', pg_temp.u(2348001));
select public.set_allow_gymos_support(pg_temp.u(2348001)::uuid, false);
select is((select count(*)::int from public.support_assignments where gym_id = pg_temp.u(2348001)::uuid and state = 'suspended' and suspended_by_switch), 3,
          'B1 switch off suspends all three assignments');
update private.support_accounts set recertify_due_at = now() - interval '1 day' where user_id = pg_temp.u(2348102)::uuid;
select public.set_allow_gymos_support(pg_temp.u(2348001)::uuid, true);
select is((select state from public.support_assignments where id = pg_temp.u(2348401)::uuid), 'active', 'B2 switch on restores a current person');
select is((select state from public.support_assignments where id = pg_temp.u(2348403)::uuid), 'active', 'B3 ... and another current person');
select is((select state || ':' || suspended_by_switch from public.support_assignments where id = pg_temp.u(2348402)::uuid), 'suspended:true',
          'B4 a lapsed recertification stays suspended (not restored as active)');
select is((select count(*)::int from members where user_id = pg_temp.u(2348102)::uuid and gym_id = pg_temp.u(2348001)::uuid and role = 'support' and deactivated_at is null), 0,
          'B5 ... and gets no support membership');

-- ============================================================================================================
-- C. the unused setting
-- ============================================================================================================
select is((select count(*)::int from private.session_limits_config where key = 'support_revocation_cutoff_seconds'), 0, 'C1 the 60 s cutoff setting is removed');
select is((select count(*)::int from private.session_limits_config where key like 'velocity\_%'), 3, 'C2 the three velocity limits are untouched');

-- ============================================================================================================
-- D. support proxy rows are readable by GoTrue (migration 0149)
-- ============================================================================================================
select cmp_ok((select count(*)::int from auth.users where raw_app_meta_data ->> 'provider' = 'support_proxy'), '>=', 3, 'D1 the fixture gyms have proxy rows (so D2 is not vacuous)');
select is((select count(*)::int from auth.users where raw_app_meta_data ->> 'provider' = 'support_proxy'
             and (confirmation_token is null or recovery_token is null or email_change_token_new is null or email_change is null)), 0,
          'D2 no proxy row has a NULL GoTrue token column (a NULL there makes GoTrue admin listUsers answer 500)');

-- ============================================================================================================
-- E. support_recertification_overdue (migration 0153): the caller's own state, as a boolean
-- ============================================================================================================
select pg_temp.claims(pg_temp.u(2348101), 'support', 'aal2', pg_temp.u(2348001), pg_temp.u(2348901));
select is(public.support_recertification_overdue(), false, 'E1 a current recertification is not overdue');
update private.support_accounts set recertify_due_at = now() - interval '1 minute' where user_id = pg_temp.u(2348101)::uuid;
select is(public.support_recertification_overdue(), true, 'E2 a lapsed recertification is overdue');
update private.support_accounts set recertify_due_at = now() + interval '30 days' where user_id = pg_temp.u(2348101)::uuid;
select pg_temp.claims(pg_temp.u(2348110), 'owner', 'aal2', pg_temp.u(2348001));
select is(public.support_recertification_overdue(), false, 'E3 someone who is not a support person is never overdue');
select is(has_function_privilege('anon', 'public.support_recertification_overdue()', 'execute'), false, 'E4 anon cannot call it');

select * from finish();
rollback;
