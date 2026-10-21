-- Story 23.1: support role, assignment record and live gate (migrations 0134, 0135).
begin;
select plan(95);

-- ---- fixtures ---------------------------------------------------------------------------------------------------
insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000231301', 'Support Gate Tier', 5000, 50000, 30);
insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-000000231001', 'Support Gym One', '00000000-0000-0000-0000-000000231301', 30),
  ('00000000-0000-0000-0000-000000231002', 'Support Gym Two', '00000000-0000-0000-0000-000000231301', 30),
  ('00000000-0000-0000-0000-000000231003', 'Support Gym Three', '00000000-0000-0000-0000-000000231301', 30);
insert into gyms (id, name, tier_id, capacity, status) values
  ('00000000-0000-0000-0000-000000231004', 'Support Gym Four', '00000000-0000-0000-0000-000000231301', 30, 'suspended');
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000231101', 'sup1-231@x.example'),
  ('00000000-0000-0000-0000-000000231102', 'owner-231@x.example'),
  ('00000000-0000-0000-0000-000000231103', 'member-231@x.example'),
  ('00000000-0000-0000-0000-000000231104', 'sup2-231@x.example'),
  ('00000000-0000-0000-0000-000000231105', 'coach-231@x.example');
insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000231201', '00000000-0000-0000-0000-000000231001', '00000000-0000-0000-0000-000000231102', 'owner', 'Owner 231'),
  ('00000000-0000-0000-0000-000000231202', '00000000-0000-0000-0000-000000231001', '00000000-0000-0000-0000-000000231103', 'member', 'Member 231'),
  ('00000000-0000-0000-0000-000000231203', '00000000-0000-0000-0000-000000231001', '00000000-0000-0000-0000-000000231105', 'coach', 'Coach 231');

insert into private.support_accounts (user_id, activated_at) values
  ('00000000-0000-0000-0000-000000231101', now()),
  ('00000000-0000-0000-0000-000000231104', now());
insert into public.support_assignments (id, support_user_id, gym_id, state, activated_at) values
  ('00000000-0000-0000-0000-000000231401', '00000000-0000-0000-0000-000000231101', '00000000-0000-0000-0000-000000231001', 'active', now()),
  ('00000000-0000-0000-0000-000000231402', '00000000-0000-0000-0000-000000231101', '00000000-0000-0000-0000-000000231002', 'active', now()),
  ('00000000-0000-0000-0000-000000231403', '00000000-0000-0000-0000-000000231101', '00000000-0000-0000-0000-000000231003', 'pending', null),
  ('00000000-0000-0000-0000-000000231404', '00000000-0000-0000-0000-000000231101', '00000000-0000-0000-0000-000000231004', 'active', now());

insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000231a1', '00000000-0000-0000-0000-000000231101', now(), now());
insert into private.support_session_state (session_id, user_id, started_at, last_seen_at)
values ('00000000-0000-0000-0000-0000000231a1', '00000000-0000-0000-0000-000000231101', now(), now());

select private.support_set_membership('00000000-0000-0000-0000-000000231401', true);
select private.support_set_membership('00000000-0000-0000-0000-000000231402', true);

create or replace function pg_temp.claims(uid text, gym text, app_role text, aal text, sid text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"' || uid || '","role":"authenticated","aal":"' || aal || '"'
    || case when gym is null then '' else ',"gym_id":"' || gym || '"' end
    || case when app_role is null then '' else ',"app_role":"' || app_role || '"' end
    || case when sid is null then '' else ',"session_id":"' || sid || '"' end || '}', true);
end $f$;
-- "<support_gym_id>|<gym_id>|<role>" as the live helpers see it ('-' for NULL). A live support user is "<gym>|-|-":
-- only support_gym_id() resolves, gym_id() and current_member_role() stay NULL (owner decision 2026-10-20).
create or replace function pg_temp.seen() returns text language sql as $f$
  select coalesce(private.support_gym_id()::text, '-') || '|' || coalesce(private.gym_id()::text, '-') || '|' || coalesce(private.current_member_role()::text, '-') $f$;

select pg_temp.claims('00000000-0000-0000-0000-000000231101', '00000000-0000-0000-0000-000000231001', 'support', 'aal2', '00000000-0000-0000-0000-0000000231a1');

-- ---- schema shape -----------------------------------------------------------------------------------------------
select ok('support' = any (enum_range(null::member_role)::text[]), 'member_role has support');
select is((select relrowsecurity from pg_class where oid = 'public.support_assignments'::regclass), true, 'support_assignments: RLS on');
select is((select count(*)::int from pg_policies where tablename = 'support_assignments'), 0, 'support_assignments: no client policy');
select is(has_table_privilege('authenticated', 'public.support_assignments', 'select')
          or has_table_privilege('anon', 'public.support_assignments', 'select'), false, 'support_assignments: no client grant');
select is((select relrowsecurity from pg_class where oid = 'private.support_accounts'::regclass), true, 'support_accounts: RLS on');
select throws_ok($$insert into public.support_assignments (support_user_id, gym_id) values ('00000000-0000-0000-0000-000000231101', '00000000-0000-0000-0000-000000231001')$$,
                 '23505', null, 'a second non-ended assignment for the same person and gym is refused');
select throws_ok($$insert into public.support_assignments (support_user_id, gym_id, state) values ('00000000-0000-0000-0000-000000231104', '00000000-0000-0000-0000-000000231001', 'bogus')$$,
                 '23514', null, 'state is limited to pending/active/suspended/ended');
select lives_ok($$insert into public.support_assignments (support_user_id, gym_id, state, ended_at) values ('00000000-0000-0000-0000-000000231104', '00000000-0000-0000-0000-000000231001', 'ended', now())$$,
                'an ended assignment does not block a new one');
select is(has_function_privilege('authenticated', 'private.support_live(uuid, uuid)', 'execute')
          or has_function_privilege('anon', 'private.support_live(uuid, uuid)', 'execute')
          or has_function_privilege('anon', 'private.support_set_membership(uuid, boolean)', 'execute')
          or has_function_privilege('authenticated', 'private.support_set_membership(uuid, boolean)', 'execute'),
          false, 'new functions are not client-callable');

-- ---- Owner switch -----------------------------------------------------------------------------------------------
select is((select column_default from information_schema.columns where table_name = 'gyms' and column_name = 'allow_gymos_support'),
          'true', 'allow_gymos_support defaults to true for new gyms');
select throws_ok($$update gyms set allow_gymos_support = false where id = '00000000-0000-0000-0000-000000231001'$$,
                 'P0001', null, 'a direct UPDATE of the switch is refused without the setter GUC');
select lives_ok($$update gyms set name = 'Support Gym One' where id = '00000000-0000-0000-0000-000000231001'$$, 'other gym updates are unaffected');

-- ---- live support ------------------------------------------------------------------------------------------------
select is(pg_temp.seen(), '00000000-0000-0000-0000-000000231001|-|-', 'fully live support: support_gym_id resolves; gym_id and current_member_role are NULL');
select is(private.support_live('00000000-0000-0000-0000-000000231101', '00000000-0000-0000-0000-000000231001'), true, 'support_live true when every leg holds');
select is(private.support_live('00000000-0000-0000-0000-000000231101', '00000000-0000-0000-0000-000000231003'), false, 'pending assignment gym: not live');
select is(private.support_live('00000000-0000-0000-0000-000000231102', '00000000-0000-0000-0000-000000231001'), false, 'support_live is false for a user other than the caller');

-- the claim picks the gym: one user, two live assignments, one gym per request
select pg_temp.claims('00000000-0000-0000-0000-000000231101', '00000000-0000-0000-0000-000000231002', 'support', 'aal2', '00000000-0000-0000-0000-0000000231a1');
select is(pg_temp.seen(), '00000000-0000-0000-0000-000000231002|-|-', 'claim names gym Two: support_gym_id resolves gym Two, not an arbitrary live gym');
select pg_temp.claims('00000000-0000-0000-0000-000000231101', null, 'support', 'aal2', '00000000-0000-0000-0000-0000000231a1');
select is(pg_temp.seen(), '-|-|-', 'no gym_id claim: support_gym_id is NULL');
select pg_temp.claims('00000000-0000-0000-0000-000000231101', 'not-a-uuid', 'support', 'aal2', '00000000-0000-0000-0000-0000000231a1');
select is(pg_temp.seen(), '-|-|-', 'non-UUID gym_id claim: support_gym_id is NULL');
select pg_temp.claims('00000000-0000-0000-0000-000000231101', '00000000-0000-0000-0000-000000231003', 'support', 'aal2', '00000000-0000-0000-0000-0000000231a1');
select is(pg_temp.seen(), '-|-|-', 'claim names a gym with only a pending assignment: support_gym_id is NULL');
select pg_temp.claims('00000000-0000-0000-0000-000000231101', '00000000-0000-0000-0000-000000231001', 'support', 'aal2', '00000000-0000-0000-0000-0000000231a1');

-- These legs flip assignments through arbitrary states to prove each gate leg; the transition rules themselves are proven in
-- support_assignments.test.sql (Story 23.5), so the guard trigger is off for the rest of this file (rolled back with it).
alter table public.support_assignments disable trigger guard_support_assignment_transition;
-- ---- each gate leg, one at a time (mutation: removing a leg from support_live fails the matching test) ---------------
update public.support_assignments set state = 'pending' where id = '00000000-0000-0000-0000-000000231401';
select is(pg_temp.seen(), '-|-|-', 'leg assignment pending: denied');
update public.support_assignments set state = 'suspended' where id = '00000000-0000-0000-0000-000000231401';
select is(pg_temp.seen(), '-|-|-', 'leg assignment suspended: denied');
update public.support_assignments set state = 'ended', ended_at = now() where id = '00000000-0000-0000-0000-000000231401';
select is(pg_temp.seen(), '-|-|-', 'leg assignment ended: denied');
update public.support_assignments set state = 'active', ended_at = null where id = '00000000-0000-0000-0000-000000231401';
select is(pg_temp.seen(), '00000000-0000-0000-0000-000000231001|-|-', 'restored: live again');

select set_config('gymos.allow_support_setter', 'on', true);
update gyms set allow_gymos_support = false where id = '00000000-0000-0000-0000-000000231001';
select is(pg_temp.seen(), '-|-|-', 'leg owner switch off: denied');
update gyms set allow_gymos_support = true where id = '00000000-0000-0000-0000-000000231001';
select set_config('gymos.allow_support_setter', 'off', true);
select is(pg_temp.seen(), '00000000-0000-0000-0000-000000231001|-|-', 'switch back on: live again');

select is(private.support_live('00000000-0000-0000-0000-000000231101', '00000000-0000-0000-0000-000000231004'), false, 'leg gym suspended: denied (gym seeded suspended; gyms.status cannot be flipped in a test)');

select pg_temp.claims('00000000-0000-0000-0000-000000231101', '00000000-0000-0000-0000-000000231001', 'support', 'aal1', '00000000-0000-0000-0000-0000000231a1');
select is(pg_temp.seen(), '-|-|-', 'leg aal1: denied');
select pg_temp.claims('00000000-0000-0000-0000-000000231101', '00000000-0000-0000-0000-000000231001', 'support', 'aal2', '00000000-0000-0000-0000-0000000231a1');

update private.support_accounts set activated_at = null where user_id = '00000000-0000-0000-0000-000000231101';
select is(pg_temp.seen(), '-|-|-', 'leg account not activated: denied');
update private.support_accounts set activated_at = now() where user_id = '00000000-0000-0000-0000-000000231101';
update private.support_accounts set locked_at = now() where user_id = '00000000-0000-0000-0000-000000231101';
select is(pg_temp.seen(), '-|-|-', 'leg account locked: denied');
update private.support_accounts set locked_at = null where user_id = '00000000-0000-0000-0000-000000231101';
update private.support_accounts set reset_pending_at = now() where user_id = '00000000-0000-0000-0000-000000231101';
select is(pg_temp.seen(), '-|-|-', 'leg reset pending: denied');
update private.support_accounts set reset_pending_at = null where user_id = '00000000-0000-0000-0000-000000231101';
delete from private.support_accounts where user_id = '00000000-0000-0000-0000-000000231101';
select is(pg_temp.seen(), '-|-|-', 'leg no support_accounts row: denied');
insert into private.support_accounts (user_id, activated_at) values ('00000000-0000-0000-0000-000000231101', now());

select pg_temp.claims('00000000-0000-0000-0000-000000231101', '00000000-0000-0000-0000-000000231001', 'support', 'aal2', null);
select is(pg_temp.seen(), '-|-|-', 'leg no session_id claim: denied');
select pg_temp.claims('00000000-0000-0000-0000-000000231101', '00000000-0000-0000-0000-000000231001', 'support', 'aal2', '00000000-0000-0000-0000-0000000231ff');
-- a fresh gate-state row for the missing session, so only the auth.sessions leg can deny
insert into private.support_session_state (session_id, user_id, started_at, last_seen_at)
values ('00000000-0000-0000-0000-0000000231ff', '00000000-0000-0000-0000-000000231101', now(), now());
select is(pg_temp.seen(), '-|-|-', 'leg session not in auth.sessions: denied');
delete from private.support_session_state where session_id = '00000000-0000-0000-0000-0000000231ff';
select pg_temp.claims('00000000-0000-0000-0000-000000231101', '00000000-0000-0000-0000-000000231001', 'support', 'aal2', '00000000-0000-0000-0000-0000000231a1');

delete from private.support_session_state;
select is(pg_temp.seen(), '-|-|-', 'leg no session state row: denied');
insert into private.support_session_state (session_id, user_id, started_at, last_seen_at)
values ('00000000-0000-0000-0000-0000000231a1', '00000000-0000-0000-0000-000000231101', now(), now() - interval '31 minutes');
select is(pg_temp.seen(), '-|-|-', 'leg idle over the limit: denied');
update private.support_session_state set last_seen_at = now(), started_at = now() - interval '9 hours';
select is(pg_temp.seen(), '-|-|-', 'leg absolute age over the limit: denied');
update private.support_session_state set started_at = now();
update private.session_limits_config set value = 1 where key = 'idle_minutes';
update private.support_session_state set last_seen_at = now() - interval '2 minutes';
select is(pg_temp.seen(), '-|-|-', 'the idle limit is read from session_limits_config');
update private.session_limits_config set value = 30 where key = 'idle_minutes';
update private.support_session_state set last_seen_at = now();
select is(pg_temp.seen(), '00000000-0000-0000-0000-000000231001|-|-', 'all legs restored: live');

-- other roles are unchanged
select pg_temp.claims('00000000-0000-0000-0000-000000231102', '00000000-0000-0000-0000-000000231001', 'owner', 'aal1', null);
select is(pg_temp.seen(), '-|00000000-0000-0000-0000-000000231001|owner', 'owner: unchanged (no aal2, no session needed)');
select pg_temp.claims('00000000-0000-0000-0000-000000231101', '00000000-0000-0000-0000-000000231001', 'support', 'aal2', '00000000-0000-0000-0000-0000000231a1');

-- ---- membership writer and constraint trigger -----------------------------------------------------------------------------
select throws_ok($$insert into members (gym_id, user_id, role, name) values ('00000000-0000-0000-0000-000000231001', '00000000-0000-0000-0000-000000231104', 'support', 'x')$$,
                 'P0001', null, 'direct support membership insert (no writer, no active assignment) is refused');
select set_config('gymos.support_membership_writer', 'on', true);
select throws_ok($$insert into members (gym_id, user_id, role, name) values ('00000000-0000-0000-0000-000000231001', '00000000-0000-0000-0000-000000231104', 'support', 'x')$$,
                 'P0001', null, 'writer GUC without an active assignment is refused');
select set_config('gymos.support_membership_writer', 'off', true);
select throws_ok($$insert into members (gym_id, user_id, role, name) values ('00000000-0000-0000-0000-000000231003', '00000000-0000-0000-0000-000000231101', 'support', 'x')$$,
                 'P0001', null, 'pending assignment: direct insert refused');
select throws_ok($$update members set role = 'support' where id = '00000000-0000-0000-0000-000000231202'$$,
                 'P0001', null, 'turning an existing member into support is refused');
select throws_ok($$update members set role = 'coach' where user_id = '00000000-0000-0000-0000-000000231101' and gym_id = '00000000-0000-0000-0000-000000231001' and role = 'support'$$,
                 'P0001', null, 'changing an active support row''s role away from support outside the writer is refused');
select throws_ok($$update members set gym_id = '00000000-0000-0000-0000-000000231003' where user_id = '00000000-0000-0000-0000-000000231101' and gym_id = '00000000-0000-0000-0000-000000231001' and role = 'support'$$,
                 'P0001', null, 'moving an active support row to another gym outside the writer is refused');
insert into public.support_assignments (id, support_user_id, gym_id, state, activated_at) values
  ('00000000-0000-0000-0000-000000231405', '00000000-0000-0000-0000-000000231103', '00000000-0000-0000-0000-000000231001', 'active', now());
select throws_ok($$select private.support_set_membership('00000000-0000-0000-0000-000000231405', true)$$,
                 'P0001', 'support_set_membership: the user already has a non-support membership in this gym',
                 'the writer gives a clear error when the user already holds a non-support membership in the gym');
delete from public.support_assignments where id = '00000000-0000-0000-0000-000000231405';
select set_config('gymos.allow_support_setter', 'on', true);
update gyms set allow_gymos_support = false where id = '00000000-0000-0000-0000-000000231002';
select set_config('gymos.allow_support_setter', 'off', true);
-- the writer runs for an operator, not as the support user (protect_self_managed_member_columns pins a caller's own row)
select pg_temp.claims('00000000-0000-0000-0000-000000231102', '00000000-0000-0000-0000-000000231001', 'owner', 'aal1', null);
select lives_ok($$select private.support_set_membership('00000000-0000-0000-0000-000000231402', false)$$, 'writer can deactivate while the switch is off');
select throws_ok($$select private.support_set_membership('00000000-0000-0000-0000-000000231402', true)$$,
                 'P0001', null, 'writer refuses (via the constraint trigger) when the gym switch is off');
select is(private.support_set_membership('00000000-0000-0000-0000-000000231401', true),
          (select id from members where gym_id = '00000000-0000-0000-0000-000000231001' and user_id = '00000000-0000-0000-0000-000000231101' and role = 'support' and deactivated_at is null),
          'writer is idempotent for an existing active support membership');
select ok(private.support_set_membership('00000000-0000-0000-0000-000000231401', false) is not null, 'writer deactivates the support membership');
select ok((select deactivated_at is not null from members where gym_id = '00000000-0000-0000-0000-000000231001' and user_id = '00000000-0000-0000-0000-000000231101' and role = 'support'), 'and the row is deactivated');
select pg_temp.claims('00000000-0000-0000-0000-000000231101', '00000000-0000-0000-0000-000000231001', 'support', 'aal2', '00000000-0000-0000-0000-0000000231a1');
select is(pg_temp.seen(), '-|-|-', 'deactivated support membership: denied');
select private.support_set_membership('00000000-0000-0000-0000-000000231401', true);
select is(pg_temp.seen(), '00000000-0000-0000-0000-000000231001|-|-', 'writer re-activates: live');
select set_config('gymos.allow_support_setter', 'on', true);
update gyms set allow_gymos_support = true where id = '00000000-0000-0000-0000-000000231002';
select set_config('gymos.allow_support_setter', 'off', true);
select private.support_set_membership('00000000-0000-0000-0000-000000231402', true);

-- ---- hook ----------------------------------------------------------------------------------------------------------
create or replace function pg_temp.hook(uid text, aal text) returns jsonb language sql as $f$
  select public.custom_access_token_hook(jsonb_build_object('user_id', uid,
           'claims', jsonb_build_object('sub', uid, 'aal', aal, 'role', 'authenticated'))) -> 'claims' $f$;
select is(pg_temp.hook('00000000-0000-0000-0000-000000231101', 'aal2') ->> 'app_role', 'support', 'hook: active assignment at aal2 gets app_role support');
select ok(pg_temp.hook('00000000-0000-0000-0000-000000231101', 'aal2') ->> 'gym_id' in ('00000000-0000-0000-0000-000000231001', '00000000-0000-0000-0000-000000231002'), 'hook: emits the gym of an active support row');
select is(pg_temp.hook('00000000-0000-0000-0000-000000231101', 'aal1') ->> 'app_role', null, 'hook: aal1 gets no app_role');
select is(pg_temp.hook('00000000-0000-0000-0000-000000231101', 'aal1') ->> 'gym_id', null, 'hook: aal1 gets no gym_id');
-- preferred gym that is not live: the support row still exists but its assignment is suspended -> the hook must not emit it
update public.support_assignments set state = 'suspended' where id = '00000000-0000-0000-0000-000000231402';
update users set active_gym_id = '00000000-0000-0000-0000-000000231002' where id = '00000000-0000-0000-0000-000000231101';
select is(pg_temp.hook('00000000-0000-0000-0000-000000231101', 'aal2') ->> 'gym_id', '00000000-0000-0000-0000-000000231001',
          'hook: active_gym_id pointing at a non-live support gym falls through to the live one');
update public.support_assignments set state = 'suspended' where id = '00000000-0000-0000-0000-000000231401';
select is(pg_temp.hook('00000000-0000-0000-0000-000000231101', 'aal2') ->> 'gym_id', null,
          'hook: active_gym_id pointing at a non-live support gym and no live gym: no gym_id');
update public.support_assignments set state = 'active' where id in ('00000000-0000-0000-0000-000000231401', '00000000-0000-0000-0000-000000231402');
update users set active_gym_id = null where id = '00000000-0000-0000-0000-000000231101';
update public.support_assignments set state = 'suspended' where id in ('00000000-0000-0000-0000-000000231401', '00000000-0000-0000-0000-000000231402');
select is(pg_temp.hook('00000000-0000-0000-0000-000000231101', 'aal2') ->> 'app_role', null, 'hook: suspended assignments get no claims');
update public.support_assignments set state = 'pending' where id in ('00000000-0000-0000-0000-000000231401', '00000000-0000-0000-0000-000000231402');
select is(pg_temp.hook('00000000-0000-0000-0000-000000231101', 'aal2') ->> 'gym_id', null, 'hook: pending assignments get no gym_id');
update public.support_assignments set state = 'ended', ended_at = now() where id in ('00000000-0000-0000-0000-000000231401', '00000000-0000-0000-0000-000000231402');
select is(pg_temp.hook('00000000-0000-0000-0000-000000231101', 'aal2') ->> 'app_role', null, 'hook: ended assignments get no claims');
select is(pg_temp.hook('00000000-0000-0000-0000-000000231102', 'aal1') ->> 'app_role', 'owner', 'hook: owner unchanged at aal1');

-- ---- two active assignments: switch_active_gym and the list ---------------------------------------------------------------
update public.support_assignments set state = 'active', ended_at = null where id in ('00000000-0000-0000-0000-000000231401', '00000000-0000-0000-0000-000000231402');
select set_config('gymos.allow_support_setter', 'on', true);
update gyms set allow_gymos_support = true where id = '00000000-0000-0000-0000-000000231002';
select set_config('gymos.allow_support_setter', 'off', true);
select lives_ok($$select switch_active_gym('00000000-0000-0000-0000-000000231001')$$, 'switch_active_gym works for the first assigned gym');
select lives_ok($$select switch_active_gym('00000000-0000-0000-0000-000000231002')$$, 'switch_active_gym works for the second assigned gym');
select throws_ok($$select switch_active_gym('00000000-0000-0000-0000-000000231003')$$, 'P0001', null, 'switch_active_gym refuses a gym with no active assignment');
select is((select count(*)::int from list_own_active_gym_memberships()), 2, 'list shows exactly the two assigned gyms');
update public.support_assignments set state = 'suspended' where id = '00000000-0000-0000-0000-000000231402';
select throws_ok($$select switch_active_gym('00000000-0000-0000-0000-000000231002')$$, 'P0001', null, 'switch_active_gym refuses a suspended assignment');
select is((select count(*)::int from list_own_active_gym_memberships()), 1, 'list hides a suspended assignment');
update public.support_assignments set state = 'active' where id = '00000000-0000-0000-0000-000000231402';

-- ---- session gate: support is limited like a Super Admin, flag or not -----------------------------------------------------
update private.platform_flags set enabled = false where flag = 'super_admin_aal2';
update private.support_session_state set last_seen_at = now() - interval '31 minutes';
select is((select reason from private.session_gate_touch('00000000-0000-0000-0000-000000231101', '00000000-0000-0000-0000-0000000231a1')),
          'session_expired', 'session_gate_touch: idle support session denied even with the aal2 flag off');
select is((select count(*)::int from auth.sessions where id = '00000000-0000-0000-0000-0000000231a1'), 0, 'expired support session is ended');
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000231a2', '00000000-0000-0000-0000-000000231101', now(), now());
select is((select ok from private.session_gate_touch('00000000-0000-0000-0000-000000231101', '00000000-0000-0000-0000-0000000231a2')),
          true, 'session_gate_touch: a fresh support session passes and records state');
select is((select count(*)::int from private.support_session_state where session_id = '00000000-0000-0000-0000-0000000231a2'), 1, 'touch wrote the state row');
select is((select ok from private.session_gate_touch('00000000-0000-0000-0000-000000231102', gen_random_uuid())), true,
          'session_gate_touch: non-support, non-Super-Admin user unaffected with the flag off');
update private.support_accounts set locked_at = now() where user_id = '00000000-0000-0000-0000-000000231101';
select is((select reason from private.session_gate_touch('00000000-0000-0000-0000-000000231101', '00000000-0000-0000-0000-0000000231a2')),
          'locked', 'session_gate_touch: locked support account denied');
update private.support_accounts set locked_at = null where user_id = '00000000-0000-0000-0000-000000231101';
-- absolute expiry: a session older than absolute_session_minutes is ended even though it was seen a second ago
-- (the lock test above ended every session of this user, so use a new one)
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000231a5', '00000000-0000-0000-0000-000000231101', now(), now());
insert into private.support_session_state (session_id, user_id, started_at, last_seen_at)
values ('00000000-0000-0000-0000-0000000231a5', '00000000-0000-0000-0000-000000231101', now() - interval '9 hours', now());
select is((select reason from private.session_gate_touch('00000000-0000-0000-0000-000000231101', '00000000-0000-0000-0000-0000000231a5')),
          'session_expired', 'session_gate_touch: support session past the absolute limit denied');
select is((select count(*)::int from auth.sessions where id = '00000000-0000-0000-0000-0000000231a5'), 0, 'absolute-expired support session is ended');
select is((select count(*)::int from audit_log where action_type = 'support_session_expired' and target_entity_id = '00000000-0000-0000-0000-000000231101'
                  and metadata ->> 'reason' = 'absolute'),
          1, 'absolute expiry writes a support_session_expired audit row (reason absolute)');
select is((select count(*)::int from audit_log where action_type = 'support_session_expired' and target_entity_id = '00000000-0000-0000-0000-000000231101'
                  and metadata ->> 'reason' = 'idle'),
          1, 'idle expiry wrote a support_session_expired audit row (reason idle)');
-- dual role: a Super Admin who is also assigned support is stopped by either lock
update users set is_super_admin = true where id = '00000000-0000-0000-0000-000000231104';
insert into public.support_assignments (support_user_id, gym_id, state) values ('00000000-0000-0000-0000-000000231104', '00000000-0000-0000-0000-000000231001', 'pending');
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000231b1', '00000000-0000-0000-0000-000000231104', now(), now());
select is((select ok from private.session_gate_touch('00000000-0000-0000-0000-000000231104', '00000000-0000-0000-0000-0000000231b1')), true,
          'dual-role user, no lock: passes');
insert into private.super_admin_lockout (user_id, locked_at) values ('00000000-0000-0000-0000-000000231104', now());
select is((select reason from private.session_gate_touch('00000000-0000-0000-0000-000000231104', '00000000-0000-0000-0000-0000000231b1')),
          'locked', 'dual-role user: the Super Admin lock stops a support-assigned user');
delete from private.super_admin_lockout where user_id = '00000000-0000-0000-0000-000000231104';
update private.support_accounts set locked_at = now() where user_id = '00000000-0000-0000-0000-000000231104';
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000231b2', '00000000-0000-0000-0000-000000231104', now(), now());
select is((select reason from private.session_gate_touch('00000000-0000-0000-0000-000000231104', '00000000-0000-0000-0000-0000000231b2')),
          'locked', 'dual-role user: the support lock stops a Super Admin');
update private.platform_flags set enabled = true where flag = 'super_admin_aal2';

-- ---- zero rows: a fully live support user reads nothing from any tenant table ------------------------------------------------
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000231a3', '00000000-0000-0000-0000-000000231101', now(), now())
  on conflict do nothing;
delete from private.support_session_state where user_id = '00000000-0000-0000-0000-000000231101';
insert into private.support_session_state (session_id, user_id, started_at, last_seen_at)
values ('00000000-0000-0000-0000-0000000231a3', '00000000-0000-0000-0000-000000231101', now(), now());
-- Seed one row in gym One for every gym_id table that can be seeded simply, so the owner walk below proves the walk is not vacuous.
insert into plans (id, gym_id, name, plan_type, price, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000231501', '00000000-0000-0000-0000-000000231001', 'Support Gate Plan', 'monthly', 10000, 'monthly', 30);
insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, one_off_session_at) values
  ('00000000-0000-0000-0000-000000231502', '00000000-0000-0000-0000-000000231001', 'Support Gate Class', '00000000-0000-0000-0000-000000231203', 10, 'one_off', now() + interval '3 days');
insert into class_sessions (gym_id, class_id, scheduled_at) values
  ('00000000-0000-0000-0000-000000231001', '00000000-0000-0000-0000-000000231502', now() + interval '3 days');
insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date) values
  ('00000000-0000-0000-0000-000000231001', '00000000-0000-0000-0000-000000231202', '00000000-0000-0000-0000-000000231501', 'active', current_date, current_date + 30);
insert into payments (id, gym_id, member_id, amount, currency, method, status, purpose) values
  ('00000000-0000-0000-0000-000000231503', '00000000-0000-0000-0000-000000231001', '00000000-0000-0000-0000-000000231202', 2000, 'XAF', 'cash', 'verified', 'session');
insert into refunds (gym_id, payment_id, amount, reason, actor_id) values
  ('00000000-0000-0000-0000-000000231001', '00000000-0000-0000-0000-000000231503', 500, 'support gate proof', '00000000-0000-0000-0000-000000231102');
insert into notifications (member_id, gym_id, type, title, body) values
  ('00000000-0000-0000-0000-000000231202', '00000000-0000-0000-0000-000000231001', 'N-01', 'Support Gate', 'Support Gate');
insert into audit_log (gym_id, actor_display_name, action_type) values
  ('00000000-0000-0000-0000-000000231001', 'Support Gate Owner', 'support_gate_proof');
insert into attendance_events (gym_id, member_id) values
  ('00000000-0000-0000-0000-000000231001', '00000000-0000-0000-0000-000000231202');
insert into workout_plans (gym_id, member_id, coach_id, name) values
  ('00000000-0000-0000-0000-000000231001', '00000000-0000-0000-0000-000000231202', '00000000-0000-0000-0000-000000231203', 'Support Gate Workout');

-- Walk every public table that has a gym_id column and the caller can read (as role authenticated): the tables where the caller
-- sees rows, as 'table=n' pairs. An insufficient_privilege error is reported as 'priv:table' (a failure), never skipped.
create or replace function pg_temp.rows_visible() returns text language plpgsql as $f$
declare t record; n bigint; seen text := '';
begin
  for t in select c.relname::text as table_name from pg_class c join pg_attribute at on at.attrelid = c.oid and at.attname = 'gym_id' and not at.attisdropped
            where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and has_table_privilege('authenticated', c.oid, 'select') order by 1 loop
    begin
      if t.table_name = 'members' then
        -- the caller's own membership row stays readable (self_read_own_membership); everything else must be hidden
        execute 'select count(*) from public.members where user_id <> auth.uid()' into n;
      elsif t.table_name = 'member_preferences' then
        -- likewise the caller's own preference rows (self_read_own_member_preferences)
        execute 'select count(*) from public.member_preferences where member_id not in (select id from public.members where user_id = auth.uid())' into n;
      elsif t.table_name = 'exercise_library' then
        -- the shared platform library (gym_id is null) is readable by every authenticated user by design
        execute 'select count(*) from public.exercise_library where gym_id is not null' into n;
      else
        execute format('select count(*) from public.%I', t.table_name) into n;
      end if;
      if n > 0 then seen := seen || t.table_name || '=' || n || ' '; end if;
    exception when insufficient_privilege then
      seen := seen || 'priv:' || t.table_name || ' ';
    end;
  end loop;
  return seen;
end $f$;
select pg_temp.claims('00000000-0000-0000-0000-000000231102', '00000000-0000-0000-0000-000000231001', 'owner', 'aal1', null);
set local role authenticated;
create temp table owner_walk on commit drop as select pg_temp.rows_visible() as seen;
grant select on owner_walk to authenticated;
reset role;
select ok((select seen from owner_walk) like '%plans=%' and (select seen from owner_walk) like '%payments=%' and (select seen from owner_walk) like '%classes=%'
          and (select seen from owner_walk) like '%subscriptions=%',
          'proof is not vacuous: the same walk shows seeded plans, payments, classes and subscriptions to an owner of the gym');
select ok((select (length(seen) - length(replace(seen, '=', ''))) from owner_walk) >= 10,
          'proof is not vacuous: the owner sees rows in at least 10 gym-scoped tables (' || (select seen from owner_walk) || ')');
select is((select array_agg(c.relname::text order by c.relname) from pg_class c join pg_attribute at on at.attrelid = c.oid and at.attname = 'gym_id' and not at.attisdropped
            where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not has_table_privilege('authenticated', c.oid, 'select')),
          array['gym_data_escalations', 'support_assignments']::text[],
          'the only gym_id tables the walk cannot read are the two with no client grant (a new one must be added here deliberately)');
select pg_temp.claims('00000000-0000-0000-0000-000000231101', '00000000-0000-0000-0000-000000231001', 'support', 'aal2', '00000000-0000-0000-0000-0000000231a3');
select is(pg_temp.seen(), '00000000-0000-0000-0000-000000231001|-|-', 'zero-row proof runs with a fully live support session');
set local role authenticated;
-- 23.6 opted the allow-list tables in (support_capabilities.test.sql proves each one and the denied set); every other table stays at zero.
select is(pg_temp.rows_visible(), 'members=1 payments=1 plans=1 refunds=1 subscriptions=1 ', 'a fully live support user reads rows only from the allow-listed tables (members, payments, plans, refunds, subscriptions) and 0 from every other table with a gym_id column');
reset role;

-- ---- catalog: nothing existing lists support; the consumers of the gate are exactly the expected ones -------------------------------
select is((select count(*)::int from pg_policies where coalesce(qual, '') || coalesce(with_check, '') like '%''support''%' and policyname <> 'hide_support_membership'), 0,
          'no RLS policy mentions the support role');
select is((select count(*)::int from pg_constraint where pg_get_constraintdef(oid) like '%''support''%'), 0,
          'no CHECK / constraint mentions the support role');
select is((select array_agg(p.pronamespace::regnamespace || '.' || p.proname order by p.proname)
             from pg_proc p where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace) and p.prosrc like '%''support''%'),
          array['public.assign_support', 'public.confirm_support_assignment', 'public.create_staff_member', 'private.current_member_role', 'public.custom_access_token_hook', 'private.guard_support_membership', 'private.gym_id',
                'public.gym_member_count', 'public.list_own_active_gym_memberships', 'public.platform_metrics', 'private.support_email_collision', 'private.support_gym_id', 'private.support_set_membership', 'public.switch_active_gym']::text[],
          'only the expected functions mention the support role');
select is((select array_agg(p.pronamespace::regnamespace || '.' || p.proname order by p.proname)
             from pg_proc p where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
              and p.proname <> 'support_live' and p.prosrc like '%support_live%'),
          array['private.support_gym_id']::text[],
          'consumers of support_live are exactly support_gym_id (a new consumer must be added here deliberately)');

select is((select count(*)::int from pg_policies where coalesce(qual, '') || coalesce(with_check, '') ~ 'support_assignments|support_accounts|support_live'), 0,
          'no RLS policy reads the assignment tables or the live gate directly');
select is((select count(*)::int from pg_policies where coalesce(qual, '') || coalesce(with_check, '') ~ 'support_gym_id'), (select count(*)::int from private.support_capabilities where kind = 'policy'),
          'the policies that call the support gate are exactly the 23.6 allow-list (support_capabilities.test.sql)');
select is((select array_agg(p.pronamespace::regnamespace || '.' || p.proname order by p.proname)
             from pg_proc p where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
              and p.prosrc ~ 'support_assignments|support_accounts'),
          array['public.activate_support_account', 'public.assign_support', 'public.confirm_support_assignment', 'public.create_support_account', 'public.custom_access_token_hook',
                'public.deactivate_support_account', 'public.get_gymos_support_status', 'public.get_support_accounts', 'public.get_support_assignments',
                'private.guard_support_assignment_transition', 'private.guard_support_membership', 'public.issue_support_invite', 'public.list_own_active_gym_memberships',
                'public.remove_support_account', 'private.session_gate_touch', 'public.set_allow_gymos_support', 'private.stepup_issue', 'private.support_invite_check', 'public.support_invite_inspect',
                'private.support_live', 'private.support_set_membership', 'public.switch_active_gym', 'public.unassign_support']::text[],
          'readers of the assignment tables are exactly the expected functions (a new reader must be added here deliberately)');

select * from finish();
rollback;
