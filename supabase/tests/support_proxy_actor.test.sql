-- Story 23.7: hidden identity, per-gym proxy actor (migration 0141).
--   A. the proxy: created with the gym, backfilled once, fails closed, banned, hidden
--   B. private.actor_id(): proxy for a live support session, auth.uid() for everyone else, two gyms are unrelated
--   C. writes: audit, payments, refunds (direct and RPC), non-support unchanged
--   D. catalog scans (retro 66): writers of auth.uid() and user-FK columns, each shown to fail on a seeded bad case
--   E. gym-side hiding
begin;
select plan(73);

create or replace function pg_temp.claims(uid text, app_role text, aal text, gym text default null, sid text default null) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"' || uid || '","role":"authenticated","aal":"' || aal || '"'
    || case when sid is null then '' else ',"session_id":"' || sid || '"' end
    || case when app_role is null then '' else ',"app_role":"' || app_role || '"' end
    || case when gym is null then '' else ',"gym_id":"' || gym || '"' end || '}', true);
end $f$;
create or replace function pg_temp.err(stmt text) returns text language plpgsql as $f$
begin execute stmt; return 'ok'; exception when others then return sqlstate || ':' || sqlerrm; end $f$;
create or replace function pg_temp.live_support(gym text) returns void language sql as $f$
  select pg_temp.claims('00000000-0000-0000-0000-000000237101', 'support', 'aal2', gym, '00000000-0000-0000-0000-0000000237a1') $f$;
create or replace function pg_temp.proxy_of(gym text) returns uuid language sql as $f$
  select id from public.users where support_proxy_gym_id = gym::uuid $f$;

-- ---- fixtures ---------------------------------------------------------------------------------------------------
insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000237301', 'Proxy Tier', 5000, 50000, 30);
insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-000000237001', 'Proxy Gym A', '00000000-0000-0000-0000-000000237301', 30),
  ('00000000-0000-0000-0000-000000237002', 'Proxy Gym B', '00000000-0000-0000-0000-000000237301', 30);
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000237101', 'sup-237@gymosapps.com', now()),
  ('00000000-0000-0000-0000-000000237102', 'owner-237@x.example', now()),
  ('00000000-0000-0000-0000-000000237103', 'ownerB-237@x.example', now()),
  ('00000000-0000-0000-0000-000000237104', 'manager-237@x.example', now()),
  ('00000000-0000-0000-0000-000000237105', 'memberA-237@x.example', now()),
  ('00000000-0000-0000-0000-000000237106', 'memberB-237@x.example', now());
insert into members (id, gym_id, user_id, role, name, email, phone) values
  ('00000000-0000-0000-0000-000000237201', '00000000-0000-0000-0000-000000237001', '00000000-0000-0000-0000-000000237102', 'owner', 'Owner 237', null, '+237600237001'),
  ('00000000-0000-0000-0000-000000237202', '00000000-0000-0000-0000-000000237002', '00000000-0000-0000-0000-000000237103', 'owner', 'Owner B 237', null, '+237600237002'),
  ('00000000-0000-0000-0000-000000237203', '00000000-0000-0000-0000-000000237001', '00000000-0000-0000-0000-000000237104', 'manager', 'Manager 237', null, '+237600237003'),
  ('00000000-0000-0000-0000-000000237204', '00000000-0000-0000-0000-000000237001', '00000000-0000-0000-0000-000000237105', 'member', 'Member A 237', null, null),
  ('00000000-0000-0000-0000-000000237205', '00000000-0000-0000-0000-000000237002', '00000000-0000-0000-0000-000000237106', 'member', 'Member B 237', null, null);
insert into plans (id, gym_id, name, plan_type, price, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000237501', '00000000-0000-0000-0000-000000237001', 'Per Session A', 'pay_per_session', 2000, 'monthly', null);
insert into subscriptions (id, gym_id, member_id, plan_id, status, start_date, expiry_date) values
  ('00000000-0000-0000-0000-000000237601', '00000000-0000-0000-0000-000000237001', '00000000-0000-0000-0000-000000237204', '00000000-0000-0000-0000-000000237501', 'active', current_date, null);
insert into payments (id, gym_id, member_id, amount, currency, method, status, purpose) values
  ('00000000-0000-0000-0000-000000237701', '00000000-0000-0000-0000-000000237001', '00000000-0000-0000-0000-000000237204', 2000, 'XAF', 'cash', 'verified', 'session'),
  ('00000000-0000-0000-0000-000000237702', '00000000-0000-0000-0000-000000237002', '00000000-0000-0000-0000-000000237205', 1000, 'XAF', 'cash', 'verified', 'session');

insert into private.support_accounts (user_id, activated_at) values ('00000000-0000-0000-0000-000000237101', now());
-- 23.10: a live support caller may write only allow-listed audit action types; these probe types stand in for them
insert into private.support_audit_actions values ('proxy_probe');
insert into public.support_assignments (id, support_user_id, gym_id, state, activated_at) values
  ('00000000-0000-0000-0000-000000237401', '00000000-0000-0000-0000-000000237101', '00000000-0000-0000-0000-000000237001', 'active', now()),
  ('00000000-0000-0000-0000-000000237402', '00000000-0000-0000-0000-000000237101', '00000000-0000-0000-0000-000000237002', 'active', now());
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000237a1', '00000000-0000-0000-0000-000000237101', now(), now());
insert into private.support_session_state (session_id, user_id, started_at, last_seen_at)
values ('00000000-0000-0000-0000-0000000237a1', '00000000-0000-0000-0000-000000237101', now(), now());
select private.support_set_membership('00000000-0000-0000-0000-000000237401', true);
select private.support_set_membership('00000000-0000-0000-0000-000000237402', true);

-- ============================================================================================================
-- A. the proxy
-- ============================================================================================================
select is((select count(*)::int from users where support_proxy_gym_id in ('00000000-0000-0000-0000-000000237001', '00000000-0000-0000-0000-000000237002')), 2,
          'new gym: one proxy users row per gym');
select is((select count(*)::int from users u where u.is_support_proxy and u.support_proxy_gym_id = '00000000-0000-0000-0000-000000237001'
            and u.display_name = 'GymOS Support' and u.phone is null), 1, 'the proxy is named GymOS Support with no phone');
select is((select count(*)::int from auth.users a join users u on u.id = a.id
            where u.is_support_proxy and a.banned_until > now() + interval '10 years' and a.email is null and a.phone is null and a.encrypted_password is null), (select count(*)::int from gyms),
          'every proxy is backed by a banned auth.users row with no email, phone or password');
select is((select count(*)::int from members m join users u on u.id = m.user_id where u.is_support_proxy), 0, 'a proxy has no members row');
select is((select count(*)::int from gyms g where (select count(*) from users u where u.support_proxy_gym_id = g.id) <> 1), 0, 'every gym has exactly one proxy');
select is(pg_temp.err($$insert into auth.users (id) values ('00000000-0000-0000-0000-000000237f01')$$), 'ok', 'a plain auth user insert still works (not a proxy)');
select throws_ok($$update users set support_proxy_gym_id = '00000000-0000-0000-0000-000000237001', is_support_proxy = true where id = '00000000-0000-0000-0000-000000237f01'$$,
                 '23505', null, 'a second proxy for the same gym is refused (unique per gym)');
select throws_ok($$update users set is_support_proxy = true where id = '00000000-0000-0000-0000-000000237f01'$$, '23514', null, 'the proxy flag and the gym link go together');
select throws_ok($$update users set is_support_proxy = true, support_proxy_gym_id = '00000000-0000-0000-0000-000000237002', is_super_admin = true where id = '00000000-0000-0000-0000-000000237f01'$$,
                 null, null, 'a proxy is never a Super Admin');

-- a self-update cannot set the proxy markers (the pin trigger puts them back)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000237f01","role":"authenticated"}', true);
update users set is_support_proxy = true, support_proxy_gym_id = '00000000-0000-0000-0000-000000237002' where id = '00000000-0000-0000-0000-000000237f01';
select set_config('request.jwt.claims', '', true);
select is((select is_support_proxy::text || ':' || coalesce(support_proxy_gym_id::text, 'null') from users where id = '00000000-0000-0000-0000-000000237f01'), 'false:null',
          'a self-update cannot set is_support_proxy or support_proxy_gym_id');

-- backfill: remove one proxy, run the backfill statement, exactly one comes back; a re-run adds none
delete from auth.users where id = pg_temp.proxy_of('00000000-0000-0000-0000-000000237002');
select is((select count(*)::int from users where support_proxy_gym_id = '00000000-0000-0000-0000-000000237002'), 0, 'backfill setup: gym B has no proxy');
select count(private.ensure_support_proxy(g.id)) from gyms g;
select is((select count(*)::int from users where support_proxy_gym_id = '00000000-0000-0000-0000-000000237002'), 1, 'backfill: the gym without a proxy gets exactly one');
select is((select count(*)::int from (select private.ensure_support_proxy(g.id) from gyms g) x) , (select count(*)::int from gyms) , 'backfill re-run returns the existing ids');
select is((select count(*)::int from users where is_support_proxy), (select count(*)::int from gyms), 'backfill re-run adds none: one proxy per gym');

-- fail closed: the gym insert fails and leaves nothing behind
create function public.zz_block_proxy() returns trigger language plpgsql as $f$ begin raise exception 'proxy blocked'; end $f$;
create trigger zz_block_proxy before insert on auth.users for each row when (new.banned_until is not null) execute function public.zz_block_proxy();
select is(pg_temp.err($$insert into gyms (id, name, tier_id, capacity) values ('00000000-0000-0000-0000-000000237003', 'Doomed Gym', '00000000-0000-0000-0000-000000237301', 5)$$),
          'P0001:proxy blocked', 'the gym insert fails when the proxy cannot be created');
select is((select count(*)::int from gyms where id = '00000000-0000-0000-0000-000000237003') + (select count(*)::int from users where support_proxy_gym_id = '00000000-0000-0000-0000-000000237003'), 0,
          'nothing is left behind');
drop trigger zz_block_proxy on auth.users;
drop function public.zz_block_proxy();

-- the proxy can never sign in: no password, banned, and the claims hook issues nothing for a user with no membership
select is((select banned_until >= '2999-12-31 00:00:00+00' from auth.users where id = pg_temp.proxy_of('00000000-0000-0000-0000-000000237001')), true, 'the proxy is banned until 2999 (a finite date, so GoTrue admin listUsers is safe)');

-- ============================================================================================================
-- B. private.actor_id()
-- ============================================================================================================
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-000000237102', 'owner', 'aal1', '00000000-0000-0000-0000-000000237001');
select is(private.actor_id(), '00000000-0000-0000-0000-000000237102'::uuid, 'owner: actor_id is auth.uid()');
select pg_temp.claims('00000000-0000-0000-0000-000000237104', 'manager', 'aal1', '00000000-0000-0000-0000-000000237001');
select is(private.actor_id(), '00000000-0000-0000-0000-000000237104'::uuid, 'manager: actor_id is auth.uid()');
select pg_temp.claims('00000000-0000-0000-0000-000000237101', 'support', 'aal2', '00000000-0000-0000-0000-000000237001', null);
select is(private.actor_id(), '00000000-0000-0000-0000-000000237101'::uuid, 'support with no live session: actor_id stays auth.uid() (it cannot write anyway)');
select pg_temp.live_support('00000000-0000-0000-0000-000000237001');
create temp table seen (gym text, actor uuid);
grant all on seen to authenticated;
insert into seen values ('A', private.actor_id());
select pg_temp.live_support('00000000-0000-0000-0000-000000237002');
insert into seen values ('B', private.actor_id());
reset role;
select is((select actor from seen where gym = 'A'), pg_temp.proxy_of('00000000-0000-0000-0000-000000237001'), 'live support in gym A: the gym A proxy');
select is((select actor from seen where gym = 'B'), pg_temp.proxy_of('00000000-0000-0000-0000-000000237002'), 'live support in gym B: the gym B proxy');
select isnt((select actor from seen where gym = 'A'), (select actor from seen where gym = 'B'), 'two gyms: two different proxy ids');
select is((select count(*)::int from seen where actor = '00000000-0000-0000-0000-000000237101'), 0, 'two gyms: neither is the real user id');
select is((select count(*)::int from seen s join users u on u.id = s.actor where u.is_support_proxy), 2, 'both are proxies');

-- ============================================================================================================
-- C. writes
-- ============================================================================================================
-- audit
set local role authenticated;
select pg_temp.live_support('00000000-0000-0000-0000-000000237001');
select is(pg_temp.err($$select log_audit_event('proxy_probe', '00000000-0000-0000-0000-000000237001')$$), 'ok', 'support audits into its own gym');
select pg_temp.claims('00000000-0000-0000-0000-000000237104', 'manager', 'aal1', '00000000-0000-0000-0000-000000237001');
select is(pg_temp.err($$select log_audit_event('proxy_probe_manager', '00000000-0000-0000-0000-000000237001')$$), 'ok', 'a manager audits into its own gym');
reset role;
select is((select actor_id || ':' || actor_display_name from audit_log where action_type = 'proxy_probe'),
          pg_temp.proxy_of('00000000-0000-0000-0000-000000237001') || ':GymOS Support', 'support audit row: proxy id and the name GymOS Support');
select is((select actor_id from audit_log where action_type = 'proxy_probe_manager'), '00000000-0000-0000-0000-000000237104'::uuid, 'non-support audit row: the real actor, as before');
select is((select actor_display_name from audit_log where action_type = 'proxy_probe_manager'), 'Manager 237', 'non-support audit row: the member name, as before');

-- direct payment insert: a client-supplied real actor id is ignored
set local role authenticated;
select pg_temp.live_support('00000000-0000-0000-0000-000000237001');
select is(pg_temp.err($$insert into payments (id, gym_id, member_id, amount, currency, method, status, purpose, actor_id) values ('00000000-0000-0000-0000-000000237711', '00000000-0000-0000-0000-000000237001', '00000000-0000-0000-0000-000000237204', 3000, 'XAF', 'cash', 'pending', 'subscription', '00000000-0000-0000-0000-000000237101')$$),
          'ok', 'support inserts a payment naming its real id as the actor');
select pg_temp.live_support('00000000-0000-0000-0000-000000237002');
select is(pg_temp.err($$insert into payments (id, gym_id, member_id, amount, currency, method, status, purpose) values ('00000000-0000-0000-0000-000000237712', '00000000-0000-0000-0000-000000237002', '00000000-0000-0000-0000-000000237205', 3000, 'XAF', 'cash', 'pending', 'subscription')$$),
          'ok', 'support inserts a payment in gym B with no actor');
reset role;
select is((select actor_id from payments where id = '00000000-0000-0000-0000-000000237711'), pg_temp.proxy_of('00000000-0000-0000-0000-000000237001'), 'direct payment: the stored actor is the gym A proxy');
select is((select actor_id from payments where id = '00000000-0000-0000-0000-000000237712'), pg_temp.proxy_of('00000000-0000-0000-0000-000000237002'), 'direct payment, gym B: the gym B proxy');

-- direct refund insert with the real id
select private.stepup_issue('00000000-0000-0000-0000-000000237101', 'support_refund', '00000000-0000-0000-0000-000000237701');
select private.stepup_issue('00000000-0000-0000-0000-000000237101', 'support_refund', '00000000-0000-0000-0000-000000237702');
set local role authenticated;
select pg_temp.live_support('00000000-0000-0000-0000-000000237001');
select is(pg_temp.err($$insert into refunds (id, gym_id, payment_id, amount, reason, actor_id) values ('00000000-0000-0000-0000-000000237801', '00000000-0000-0000-0000-000000237001', '00000000-0000-0000-0000-000000237701', 500, 'r', '00000000-0000-0000-0000-000000237101')$$),
          'ok', 'support inserts a refund naming its real id as the actor');
select pg_temp.live_support('00000000-0000-0000-0000-000000237002');
select is(pg_temp.err($$insert into refunds (id, gym_id, payment_id, amount, reason, actor_id) values ('00000000-0000-0000-0000-000000237802', '00000000-0000-0000-0000-000000237002', '00000000-0000-0000-0000-000000237702', 500, 'r', '00000000-0000-0000-0000-000000237101')$$),
          'ok', 'support refunds in gym B');
reset role;
select is((select actor_id from refunds where id = '00000000-0000-0000-0000-000000237801'), pg_temp.proxy_of('00000000-0000-0000-0000-000000237001'), 'direct refund: the stored actor is the gym A proxy');
select is((select actor_id from refunds where id = '00000000-0000-0000-0000-000000237802'), pg_temp.proxy_of('00000000-0000-0000-0000-000000237002'), 'direct refund, gym B: the gym B proxy');
select isnt((select actor_id from refunds where id = '00000000-0000-0000-0000-000000237801'), (select actor_id from refunds where id = '00000000-0000-0000-0000-000000237802'), 'two gyms: two unrelated refund actors');

-- payment RPC
set local role authenticated;
select pg_temp.live_support('00000000-0000-0000-0000-000000237001');
select is(pg_temp.err($$select record_session_payment('00000000-0000-0000-0000-000000237204', 'cash', null)$$), 'ok', 'support records a session payment through the RPC');
select pg_temp.claims('00000000-0000-0000-0000-000000237104', 'manager', 'aal1', '00000000-0000-0000-0000-000000237001');
select is(pg_temp.err($$select record_session_payment('00000000-0000-0000-0000-000000237204', 'cash', null)$$), 'ok', 'a manager records a session payment through the RPC');
reset role;
select is((select count(*)::int from payments where gym_id = '00000000-0000-0000-0000-000000237001' and purpose = 'session' and actor_id = pg_temp.proxy_of('00000000-0000-0000-0000-000000237001')), 1,
          'RPC payment by support: the proxy');
select is((select count(*)::int from payments where gym_id = '00000000-0000-0000-0000-000000237001' and purpose = 'session' and actor_id = '00000000-0000-0000-0000-000000237104'), 1,
          'RPC payment by a manager: the real actor, as before');

-- non-support direct insert keeps its behavior (the actor is whatever the caller supplied; the trigger does not touch it)
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-000000237104', 'manager', 'aal1', '00000000-0000-0000-0000-000000237001');
select is(pg_temp.err($$insert into payments (id, gym_id, member_id, amount, currency, method, status, purpose, actor_id) values ('00000000-0000-0000-0000-000000237713', '00000000-0000-0000-0000-000000237001', '00000000-0000-0000-0000-000000237204', 3000, 'XAF', 'cash', 'pending', 'subscription', '00000000-0000-0000-0000-000000237104')$$), 'ok', 'a manager inserts a payment');
reset role;
select is((select actor_id from payments where id = '00000000-0000-0000-0000-000000237713'), '00000000-0000-0000-0000-000000237104'::uuid, 'non-support direct insert: untouched');

-- fail closed: a live support caller whose gym has no proxy row is refused, never recorded under the real id
create temp table saved_proxy as select pg_temp.proxy_of('00000000-0000-0000-0000-000000237001') as id;
update users set is_support_proxy = false, support_proxy_gym_id = null where id = (select id from saved_proxy);
set local role authenticated;
select pg_temp.live_support('00000000-0000-0000-0000-000000237001');
select is(pg_temp.err($$select private.actor_id()$$), 'P0001:support_proxy_missing', 'no proxy row: actor_id() raises for a live support caller');
select is(pg_temp.err($$insert into payments (gym_id, member_id, amount, currency, method, status, purpose, actor_id) values ('00000000-0000-0000-0000-000000237001', '00000000-0000-0000-0000-000000237204', 100, 'XAF', 'cash', 'pending', 'subscription', '00000000-0000-0000-0000-000000237101')$$),
          'P0001:support_proxy_missing', 'no proxy row: a direct payment insert by live support is refused');
select pg_temp.claims('00000000-0000-0000-0000-000000237104', 'manager', 'aal1', '00000000-0000-0000-0000-000000237001');
select is(private.actor_id(), '00000000-0000-0000-0000-000000237104'::uuid, 'no proxy row: a non-support caller still gets auth.uid()');
reset role;
update users set is_support_proxy = true, support_proxy_gym_id = '00000000-0000-0000-0000-000000237001' where id = (select id from saved_proxy);

-- the converted functions all reach private.actor_id() and no longer write auth.uid() into a column
select is((select count(*)::int from pg_proc p where p.oid in (
            'log_audit_event(text,uuid,text,text,jsonb,text)'::regprocedure, 'confirm_renewal(uuid,text,text,boolean)'::regprocedure,
            'initiate_registration_fee_payment(uuid)'::regprocedure, 'initiate_session_payment()'::regprocedure,
            'record_registration_fee(uuid,text,text)'::regprocedure, 'record_session_payment(uuid,text,text)'::regprocedure,
            'private.connect_payment_credentials(uuid,text,text,text,text,boolean)'::regprocedure, 'update_messaging_instance(text)'::regprocedure,
            'front_desk_alerts_protect_columns()'::regprocedure) and p.prosrc ~ 'private\.actor_id\(\)'), 9, 'all nine converted writers call private.actor_id()');

-- ============================================================================================================
-- D. catalog scans
-- ============================================================================================================
-- D1: functions (and trigger functions) that write auth.uid() into a column
create temp table writer_exempt (fn text primary key, reason text not null);
insert into writer_exempt (fn, reason) values
  ('assign_support(uuid,uuid,text)',          'support lifecycle: Super Admin records who assigned (gym_id is never exposed to gym roles)'),
  ('escalate_gym_data_access(uuid,text)',     'Super Admin action: the escalating Super Admin is recorded as itself'),
  ('revoke_gym_data_access(uuid,uuid,text)',  'Super Admin action: the revoking Super Admin is recorded as itself'),
  ('answer_audit_disclosure_request(uuid,text)',  'Super Admin action (23.8): the answering Super Admin is recorded as itself, never gym visible'),
  ('file_audit_disclosure_request(uuid,text)',    'Owner-only action (23.8): current_member_role() is NULL for support, so requested_by is always the Owner'),
  ('private.record_support_identity(text,uuid,uuid)', 'the real-identity writer itself (23.8): it records auth.uid() on purpose, Super Admin read only'),
  ('start_support_factor_reset(uuid,text,text,text)', 'Super Admin action (23.11): the Super Admin who starts a reset is recorded as itself, never gym visible');

create or replace function pg_temp.unlisted_writers() returns setof text language sql as $f$
  select p.oid::regprocedure::text
    from pg_proc p, lateral (select regexp_replace(p.prosrc, '\(\s*select\s+auth\.uid\(\)\s*\)', 'auth.uid()', 'gi') as src) s
   where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace) and p.prokind in ('f', 'p')
     and (   s.src ~* ':=\s*auth\.uid\(\)'
          or s.src ~* '\mvalues\s*\((?:(?!;)[\s\S])*auth\.uid\(\)'
          or s.src ~* '\mset\M(?:(?!\mwhere\M|;)[\s\S])*?[a-z_]+\s*=\s*auth\.uid\(\)'
          or s.src ~* '\mselect\s+auth\.uid\(\)\s*(,|into|from)'
          or s.src ~* '\mdefault\s+auth\.uid\(\)'
          or s.src ~* '(^|;|\m(begin|then|else|loop))\s*[a-z_.]+\s*=\s*auth\.uid\(\)\s*;'
          or s.src ~* '\mreturning\M[^;]*auth\.uid\(\)')
     and s.src !~ 'private\.actor_id\(\)'
     and p.oid::regprocedure::text not in (select fn from writer_exempt)
   order by 1 $f$;
select is((select count(*)::int from pg_temp.unlisted_writers()), 0, 'scan: every function that writes auth.uid() into a column calls private.actor_id() or is a named exemption');
select is((select count(*)::int from writer_exempt e where not exists (select 1 from pg_proc p where p.oid::regprocedure::text = e.fn and p.prosrc ~* 'auth\.uid\(\)')), 0,
          'scan: every exemption names a function that still exists and still uses auth.uid()');
select is((select count(*)::int from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
            where pg_get_expr(d.adbin, d.adrelid) ~* 'auth\.uid\(\)'), 0, 'scan: no column default writes auth.uid()');
-- shown to fail on a seeded bad case
create function public.zz_bad_writer() returns void language plpgsql as $f$
begin insert into public.audit_log (actor_id, actor_display_name, action_type) values (auth.uid(), 'x', 'x'); end $f$;
create function public.zz_bad_trigger() returns trigger language plpgsql as $f$
begin new.dismissed_by := auth.uid(); return new; end $f$;
create function public.zz_bad_update() returns void language plpgsql as $f$
begin update public.messaging_provider_config set updated_by = auth.uid(), updated_at = now() where true; end $f$;
create function public.zz_bad_wrapped() returns trigger language plpgsql as $f$
begin new.dismissed_by := (select auth.uid()); return new; end $f$;
create function public.zz_bad_plain() returns trigger language plpgsql as $f$
begin new.dismissed_by = auth.uid(); return new; end $f$;
create function public.zz_bad_default() returns void language plpgsql as $f$
declare v uuid default auth.uid(); begin perform v; end $f$;
create function public.zz_good_compare() returns boolean language plpgsql as $f$
begin return exists (select 1 from public.members where user_id = auth.uid()); end $f$;
select is((select array_agg(w order by w) from pg_temp.unlisted_writers() w), array['zz_bad_default()', 'zz_bad_plain()', 'zz_bad_trigger()', 'zz_bad_update()', 'zz_bad_wrapped()', 'zz_bad_writer()']::text[],
          'scan: seeded unlisted writers (insert, trigger assignment, update, (select auth.uid()), plain =, declare default) are caught; a read-only comparison is not');
insert into writer_exempt values ('zz_bad_writer()', 'seeded');
select is((select count(*)::int from pg_temp.unlisted_writers()), 5, 'scan: a named exemption clears exactly that function');

-- D2: every column with a foreign key to users is classified
create temp table fk_class (col text primary key, class text not null check (class in ('actor_converted', 'actor_exempt', 'non_actor')), note text not null);
insert into fk_class (col, class, note) values
  ('audit_log.actor_id',                        'actor_converted', 'log_audit_event'),
  ('front_desk_alerts.dismissed_by',            'actor_converted', 'front_desk_alerts_protect_columns'),
  ('gym_payment_credentials.connected_by',      'actor_converted', 'connect_payment_credentials (shared by the Owner and support connect functions)'),
  ('staff_notices.user_id',                     'non_actor',       'the recipient of an in-app notice (23.9)'),
  ('messaging_provider_config.updated_by',      'actor_converted', 'update_messaging_instance (Super Admin only)'),
  ('payments.actor_id',                         'actor_converted', 'record_* / initiate_* RPCs and the aa_support_force_actor trigger'),
  ('refunds.actor_id',                          'actor_converted', 'aa_support_force_actor trigger'),
  ('gym_data_escalations.actor_id',             'actor_exempt',    'Super Admin escalation'),
  ('gym_data_escalations.revoked_by',           'actor_exempt',    'Super Admin revoke'),
  ('audit_disclosure_requests.requested_by',    'non_actor',       'the Owner who filed the request (Owner-only function; 23.8)'),
  ('audit_disclosure_requests.answered_by',     'actor_exempt',    'Super Admin answers; never gym visible (23.8)'),
  ('support_assignments.created_by',            'actor_exempt',    'Super Admin assigns; never gym visible'),
  ('private.support_invites.created_by',        'actor_exempt',    'Super Admin invites; never gym visible'),
  ('device_push_tokens.user_id',                'non_actor',       'own device token'),
  ('members.user_id',                           'non_actor',       'membership owner'),
  ('private.support_accounts.user_id',          'non_actor',       'the support account itself'),
  ('support_assignments.support_user_id',       'non_actor',       'the assigned person'),
  ('private.support_invites.user_id',           'non_actor',       'the invited person'),
  ('private.support_factor_resets.started_by',  'actor_exempt',    'Super Admin starts a reset (23.11); never gym visible'),
  ('private.support_factor_resets.user_id',     'non_actor',       'the person whose authenticator is reset'),
  ('private.support_last_active.user_id',       'non_actor',       'the person''s own last activity (23.11)');
create or replace function pg_temp.user_fk_cols() returns setof text language sql as $f$
  select c.conrelid::regclass::text || '.' || a.attname
    from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
   where c.contype = 'f' and c.confrelid = 'public.users'::regclass
     and c.connamespace in ('public'::regnamespace, 'private'::regnamespace) $f$;
create or replace function pg_temp.unclassified_fk() returns setof text language sql as $f$
  select col from pg_temp.user_fk_cols() col where col not in (select col from fk_class) order by 1 $f$;
select is((select count(*)::int from pg_temp.unclassified_fk()), 0, 'scan: every column with a foreign key to users is classified');
select is((select count(*)::int from fk_class k where k.col not in (select col from pg_temp.user_fk_cols())), 0, 'scan: every classified column still exists');
create table public.zz_bad_fk (id uuid primary key default gen_random_uuid(), recorded_by uuid references public.users(id));
select is((select array_agg(c) from pg_temp.unclassified_fk() c), array['zz_bad_fk.recorded_by']::text[], 'scan: a seeded unclassified user-FK column is caught');

-- D3: every function, view or policy that reads users either filters on is_support_proxy or is a named exemption (spec: the proxy is
-- excluded from any users-based list or count). Application code reads users by key (id or phone) today; a new list there needs the
-- same filter. A function that reads users another way fails this scan until it is listed with a reason.
create temp table users_reader_exempt (fn text primary key, reason text not null);
insert into users_reader_exempt (fn, reason) values
  ('assign_support(uuid,uuid,text)',                       'Super Admin action; reads one user by id'),
  ('get_support_action_identity(text,uuid[])',             'Super Admin read of the real person (23.8)'),
  ('create_support_account(uuid,text,text)',               'Super Admin action; reads one user by id'),
  ('custom_access_token_hook(jsonb)',                      'reads the signing-in user by id; a proxy has no members row and is banned'),
  ('get_support_accounts()',                               'lists support_accounts rows (the proxy has none) joined to users'),
  ('get_support_assignments(uuid,uuid)',                   'lists support_assignments rows (the proxy has none) joined to users'),
  ('get_support_locks()',                                     'lists locked support_accounts rows (the proxy has none) joined to users'),
  ('get_support_lifecycle()',                              'lists support_accounts rows (the proxy has none) joined to users (23.11)'),
  ('issue_support_invite(uuid,text,uuid)',                 'Super Admin action; reads one user by id'),
  ('list_super_admins()',                                  'filters is_super_admin, which a proxy can never be (users_support_proxy_not_super_admin)'),
  ('log_audit_event(text,uuid,text,text,jsonb,text)',      'reads the actor display name by id'),
  ('private.actor_id()',                                   'reads the proxy by support_proxy_gym_id'),
  ('private.authorize_action(uuid,uuid,text,uuid)',             'reads one user by id'),
  ('private.guard_last_verified_factor()',                 'reads one user by id'),
  ('private.guard_owner_not_super_admin()',                'reads one user by id'),
  ('private.is_super_admin()',                             'reads one user by id'),
  ('private.is_super_admin_live()',                        'reads one user by id'),
  ('private.recovery_code_consume(uuid,text,text)',        'reads one user by id'),
  ('private.recovery_code_issue(uuid,text,text,text)',     'reads one user by id'),
  ('private.recovery_enrol_allowed(uuid)',                 'reads one user by id'),
  ('private.send_class_reminder(uuid,uuid)',               'recipients come through members; a proxy has no members row'),
  ('private.send_payment_push_notification(uuid,text)',     'reads one user by id'),
  ('private.send_push_notification(uuid,text)',            'reads one user by id'),
  ('private.send_quiet_gym_alert(uuid,uuid)',              'recipients come through members; a proxy has no members row'),
  ('private.session_gate_touch(uuid,uuid)',                'reads one user by id'),
  ('private.stepup_issue(uuid,text,text)',                 'reads one user by id'),
  ('private.stepup_record_failure(uuid)',                  'reads one user by id'),
  ('private.support_email_collision(text,uuid)',           'looks up by email; a proxy has a null email'),
  ('promote_to_super_admin(uuid,text)',                    'Super Admin action; reads one user by id');
create or replace function pg_temp.unfiltered_users_readers() returns setof text language sql as $f$
  select p.oid::regprocedure::text from pg_proc p
   where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace) and p.prokind in ('f', 'p')
     and p.prosrc ~* '\m(from|join)\s+(public\.)?users\M' and p.prosrc !~* 'is_support_proxy'
     and p.oid::regprocedure::text not in (select fn from users_reader_exempt)
  union all
  select c.oid::regclass::text from pg_class c
   where c.relkind in ('v', 'm') and c.relnamespace in ('public'::regnamespace, 'private'::regnamespace)
     and pg_get_viewdef(c.oid) ~* '\m(from|join)\s+(public\.)?users\M' and pg_get_viewdef(c.oid) !~* 'is_support_proxy'
  union all
  select pol.polrelid::regclass::text || '.' || pol.polname from pg_policy pol
   where coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') ~* '\m(from|join)\s+(public\.)?users\M'
     and coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') !~* 'is_support_proxy'
  order by 1 $f$;
select is((select count(*)::int from pg_temp.unfiltered_users_readers()), 0, 'scan: every reader of users filters on is_support_proxy or is a named exemption');
select is((select count(*)::int from users_reader_exempt e where not exists (select 1 from pg_proc p where p.oid::regprocedure::text = e.fn and p.prosrc ~* '\m(from|join)\s+(public\.)?users\M')), 0,
          'scan: every users-reader exemption names a function that still reads users');
create function public.zz_bad_users_count() returns bigint language sql as $f$ select count(*) from public.users $f$;
create view public.zz_bad_users_view as select id from public.users;
select is((select array_agg(r order by r) from pg_temp.unfiltered_users_readers() r), array['zz_bad_users_count()', 'zz_bad_users_view']::text[],
          'scan: a seeded unfiltered users count and view are caught');
insert into users_reader_exempt values ('zz_bad_users_count()', 'seeded');
select is((select count(*)::int from pg_temp.unfiltered_users_readers()), 1, 'scan: a named exemption clears exactly that function');

-- ============================================================================================================
-- E. gym-side hiding
-- ============================================================================================================
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-000000237102', 'owner', 'aal1', '00000000-0000-0000-0000-000000237001');
create temp table gymside (what text, n bigint);
grant all on gymside to authenticated;
insert into gymside values ('users_other', (select count(*) from users where id <> auth.uid()));
insert into gymside values ('members_support', (select count(*) from members where role = 'support' or user_id = '00000000-0000-0000-0000-000000237101'));
insert into gymside values ('members_proxy', (select count(*) from members where user_id in (select id from users where is_support_proxy)));
insert into gymside values ('users_proxy', (select count(*) from users where is_support_proxy));
select pg_temp.claims('00000000-0000-0000-0000-000000237104', 'manager', 'aal1', '00000000-0000-0000-0000-000000237001');
insert into gymside values ('mgr_users_other', (select count(*) from users where id <> auth.uid()));
insert into gymside values ('mgr_members_support', (select count(*) from members where role = 'support' or user_id = '00000000-0000-0000-0000-000000237101'));
reset role;
select is((select n from gymside where what = 'users_other'), 0::bigint, 'owner: users returns no row but its own');
select is((select n from gymside where what = 'members_support'), 0::bigint, 'owner: members returns no support row');
select is((select n from gymside where what = 'members_proxy'), 0::bigint, 'owner: members returns no proxy row');
select is((select n from gymside where what = 'users_proxy'), 0::bigint, 'owner: users returns no proxy row');
select is((select n from gymside where what = 'mgr_users_other'), 0::bigint, 'manager: users returns no row but its own');
select is((select n from gymside where what = 'mgr_members_support'), 0::bigint, 'manager: members returns no support row');
select is((select count(*)::int from members where gym_id = '00000000-0000-0000-0000-000000237001' and role = 'support'), 1, 'control: the support membership exists (the reads above are hidden, not empty)');

-- the allowed branches and the UPDATE / DELETE claim of hide_support_membership
insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-0000-0000-000000237107', 'admin-237@x.example', now());
update users set is_super_admin = true where id = '00000000-0000-0000-0000-000000237107';
insert into auth.sessions (id, user_id, created_at, updated_at) values ('00000000-0000-0000-0000-0000000237a9', '00000000-0000-0000-0000-000000237107', now(), now());
insert into gym_data_escalations (gym_id, actor_id, reason, expires_at) values ('00000000-0000-0000-0000-000000237001', '00000000-0000-0000-0000-000000237107', 'proxy test', now() + interval '1 hour');
create temp table gymside2 (what text, n bigint);
grant all on gymside2 to authenticated;
create or replace function pg_temp.rows(stmt text) returns text language plpgsql as $f$
declare n bigint;
begin execute stmt; get diagnostics n = row_count; return n::text; exception when others then return sqlstate || ':' || sqlerrm; end $f$;
set local role authenticated;
select pg_temp.live_support('00000000-0000-0000-0000-000000237001');
insert into gymside2 values ('support_own', (select count(*) from members where role = 'support' and user_id = auth.uid() and gym_id = '00000000-0000-0000-0000-000000237001'));
select pg_temp.claims('00000000-0000-0000-0000-000000237107', 'super_admin', 'aal2', null, '00000000-0000-0000-0000-0000000237a9');
insert into gymside2 values ('super_admin', (select count(*) from members where role = 'support'));
select pg_temp.claims('00000000-0000-0000-0000-000000237102', 'owner', 'aal1', '00000000-0000-0000-0000-000000237001');
insert into gymside2 values ('owner_update', pg_temp.rows($$update members set name = 'Hacked' where role = 'support'$$)::bigint);
insert into gymside2 values ('owner_delete', pg_temp.rows($$delete from members where role = 'support'$$)::bigint);
reset role;
select is((select n from gymside2 where what = 'support_own'), 1::bigint, 'the support person reads their own support membership row');
select cmp_ok((select n from gymside2 where what = 'super_admin'), '>=', 1::bigint, 'a Super Admin reads support membership rows');
select is((select n from gymside2 where what = 'owner_update'), 0::bigint, 'owner: UPDATE of a support membership affects 0 rows');
select is((select n from gymside2 where what = 'owner_delete'), 0::bigint, 'owner: DELETE of a support membership affects 0 rows');
select is((select count(*)::int from members where gym_id = '00000000-0000-0000-0000-000000237001' and role = 'support' and name <> 'Hacked'), 1, 'control: the support membership still exists, unchanged');
select * from finish();
rollback;
