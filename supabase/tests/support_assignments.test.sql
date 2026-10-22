-- Story 23.5: assign, confirm, unassign, deactivate and remove support people (migration 0139).
begin;
select plan(102);

create or replace function pg_temp.claims(uid text, app_role text, aal text, gym text default null, sid text default '00000000-0000-0000-0000-0000000235a0') returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"' || uid || '","role":"authenticated","session_id":"' || sid || '","aal":"' || aal || '"'
    || case when app_role is null then '' else ',"app_role":"' || app_role || '"' end
    || case when gym is null then '' else ',"gym_id":"' || gym || '"' end || '}', true);
end $f$;
create or replace function pg_temp.err(stmt text) returns text language plpgsql as $f$
begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $f$;

-- ---- fixtures ---------------------------------------------------------------------------------------------------
insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000235301', 'Assign Tier', 5000, 50000, 30);
insert into gyms (id, name, tier_id, capacity, status, allow_gymos_support) values
  ('00000000-0000-0000-0000-000000235001', 'Gym A', '00000000-0000-0000-0000-000000235301', 30, 'active', true),
  ('00000000-0000-0000-0000-000000235002', 'Gym B', '00000000-0000-0000-0000-000000235301', 30, 'active', false),
  ('00000000-0000-0000-0000-000000235003', 'Gym C', '00000000-0000-0000-0000-000000235301', 30, 'suspended', true);
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000235101', 'admin-235@x.example', now()),
  ('00000000-0000-0000-0000-000000235102', 'owner-235@x.example', now()),
  ('00000000-0000-0000-0000-000000235103', 'coach-235@x.example', now()),
  ('00000000-0000-0000-0000-000000235104', 'admin2-235@x.example', now()),   -- a second Super Admin (assignment target)
  ('00000000-0000-0000-0000-000000235105', 'plain-235@x.example', now()),    -- no support account
  ('00000000-0000-0000-0000-000000235111', 'ready@gymosapps.com', now()),    -- s1 activated
  ('00000000-0000-0000-0000-000000235112', 'new@gymosapps.com', now()),      -- s2 not activated
  ('00000000-0000-0000-0000-000000235113', 'gone@gymosapps.com', now()),     -- s3 activated, deactivated
  ('00000000-0000-0000-0000-000000235114', 'coach.sup@gymosapps.com', now()),-- s4 activated, also a coach in Gym A
  ('00000000-0000-0000-0000-000000235115', 'late@gymosapps.com', now()),     -- s5 pending, gains a membership
  ('00000000-0000-0000-0000-000000235116', 'typo@gymosapps.com', now()),     -- s6 never activated, invite, pending assignment
  ('00000000-0000-0000-0000-000000235117', 'noconfirm@gymosapps.com', null), -- s7 email not confirmed
  ('00000000-0000-0000-0000-000000235118', 'second@gymosapps.com', now()),   -- s8 activated, deactivate target
  ('00000000-0000-0000-0000-000000235119', 'typo2@gymosapps.com', now());    -- s9 never activated, for refusals of remove
update users set is_super_admin = true where id in ('00000000-0000-0000-0000-000000235101', '00000000-0000-0000-0000-000000235104');
insert into members (gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000235001', '00000000-0000-0000-0000-000000235102', 'owner', 'Owner 235'),
  ('00000000-0000-0000-0000-000000235001', '00000000-0000-0000-0000-000000235103', 'coach', 'Coach 235'),
  ('00000000-0000-0000-0000-000000235001', '00000000-0000-0000-0000-000000235114', 'coach', 'Coach Sup');
insert into private.support_accounts (user_id, activated_at, deactivated_at) values
  ('00000000-0000-0000-0000-000000235111', now(), null),
  ('00000000-0000-0000-0000-000000235112', null, null),
  ('00000000-0000-0000-0000-000000235113', now(), now()),
  ('00000000-0000-0000-0000-000000235114', now(), null),
  ('00000000-0000-0000-0000-000000235115', null, null),
  ('00000000-0000-0000-0000-000000235116', null, null),
  ('00000000-0000-0000-0000-000000235117', now(), null),
  ('00000000-0000-0000-0000-000000235118', now(), null),
  ('00000000-0000-0000-0000-000000235119', null, null);
insert into private.support_invites (id, user_id, token_hash, expires_at) values
  ('00000000-0000-0000-0000-000000235601', '00000000-0000-0000-0000-000000235116', 'h1', now() + interval '1 hour'),
  ('00000000-0000-0000-0000-000000235602', '00000000-0000-0000-0000-000000235119', 'h2', now() + interval '1 hour');
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000235a0', '00000000-0000-0000-0000-000000235101', now(), now()),
  ('00000000-0000-0000-0000-0000000235a1', '00000000-0000-0000-0000-000000235111', now(), now()),
  ('00000000-0000-0000-0000-0000000235a2', '00000000-0000-0000-0000-000000235118', now(), now());
insert into private.support_session_state (session_id, user_id, started_at, last_seen_at) values
  ('00000000-0000-0000-0000-0000000235a1', '00000000-0000-0000-0000-000000235111', now(), now());
update private.platform_flags set enabled = true where flag = 'super_admin_aal2';

-- ---- ACLs -------------------------------------------------------------------------------------------------------
select is((select count(*)::int from unnest(array[
    'public.assign_support(uuid, uuid, text)', 'public.confirm_support_assignment(uuid, text)', 'public.unassign_support(uuid, text)',
    'public.deactivate_support_account(uuid, text)', 'public.remove_support_account(uuid, text)', 'public.get_support_assignments(uuid, uuid)',
    'private.support_admin_required()', 'private.support_admin_audit(text, uuid, jsonb)', 'private.support_reason_ok(text)']) f
   where has_function_privilege('anon', f, 'execute') or has_function_privilege('public', f, 'execute')), 0, 'no new function is callable by anon or public');
select is((select count(*)::int from unnest(array[
    'private.support_admin_required()', 'private.support_admin_audit(text, uuid, jsonb)', 'private.support_reason_ok(text)',
    'private.guard_support_assignment_transition()']) f where has_function_privilege('authenticated', f, 'execute')), 0, 'private helpers are not callable by authenticated');
select is(pg_get_function_result('public.get_gymos_support_status(uuid)'::regprocedure), 'TABLE(allowed boolean, state text, last_acted_at timestamp with time zone)',
          'the Owner status readout is unchanged');

-- ---- wrong callers ----------------------------------------------------------------------------------------------
create or replace function pg_temp.all_denied() returns text language plpgsql as $f$
declare r text := '';
begin
  r := r || pg_temp.err($q$select assign_support('00000000-0000-0000-0000-000000235111', '00000000-0000-0000-0000-000000235002', 'valid reason')$q$) || '|';
  r := r || pg_temp.err($q$select confirm_support_assignment('00000000-0000-0000-0000-000000235999', 'valid reason')$q$) || '|';
  r := r || pg_temp.err($q$select unassign_support('00000000-0000-0000-0000-000000235999', 'valid reason')$q$) || '|';
  r := r || pg_temp.err($q$select deactivate_support_account('00000000-0000-0000-0000-000000235111', 'valid reason')$q$) || '|';
  r := r || pg_temp.err($q$select remove_support_account('00000000-0000-0000-0000-000000235119', 'valid reason')$q$) || '|';
  r := r || pg_temp.err($q$select get_support_assignments()$q$);
  return r;
end $f$;
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-000000235102', 'owner', 'aal2', '00000000-0000-0000-0000-000000235001');
select is(pg_temp.all_denied(), 'permission denied|permission denied|permission denied|permission denied|permission denied|permission denied', 'Owner: every function refused');
select pg_temp.claims('00000000-0000-0000-0000-000000235111', 'support', 'aal2', '00000000-0000-0000-0000-000000235001', '00000000-0000-0000-0000-0000000235a1');
select is(pg_temp.all_denied(), 'permission denied|permission denied|permission denied|permission denied|permission denied|permission denied', 'support: every function refused');
select pg_temp.claims('00000000-0000-0000-0000-000000235101', 'super_admin', 'aal1');
select is(pg_temp.all_denied(), 'permission denied|permission denied|permission denied|permission denied|permission denied|permission denied', 'Super Admin at aal1: every function refused');
reset role;
update private.platform_flags set enabled = false where flag = 'super_admin_aal2';
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-000000235101', 'super_admin', 'aal2');
select is(pg_temp.all_denied(), 'permission denied|permission denied|permission denied|permission denied|permission denied|permission denied', 'flag off: every function refused');
reset role;
update private.platform_flags set enabled = true where flag = 'super_admin_aal2';
set local role anon;
select throws_ok($$select assign_support('00000000-0000-0000-0000-000000235111', '00000000-0000-0000-0000-000000235002', 'valid reason')$$, '42501', null, 'anon: no EXECUTE');
reset role;
select is((select count(*)::int from support_assignments), 0, 'refused callers wrote nothing');

-- ---- assign ----------------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-000000235101', 'super_admin', 'aal2');
create or replace function pg_temp.assign(u text, g text, r text default 'onboarding the gym') returns text language sql as $f$
  select ok::text || ':' || code from assign_support(u::uuid, g::uuid, r) $f$;

select is(pg_temp.assign('00000000-0000-0000-0000-000000235111', '00000000-0000-0000-0000-000000235001', 'ab'), 'false:reason_invalid', 'reason shorter than 3 refused');
select is(pg_temp.assign('00000000-0000-0000-0000-000000235111', '00000000-0000-0000-0000-000000235001', repeat('x', 501)), 'false:reason_invalid', 'reason longer than 500 refused');
select is(pg_temp.assign('00000000-0000-0000-0000-000000235111', '00000000-0000-0000-0000-000000235001', null), 'false:reason_invalid', 'missing reason refused');
reset role;
select is((select count(*)::int from support_assignments) + (select count(*)::int from audit_log where action_type like 'support\_assign%'), 0, 'a bad reason writes nothing');
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-000000235101', 'super_admin', 'aal2');

select is(pg_temp.assign('00000000-0000-0000-0000-000000235111', '00000000-0000-0000-0000-000000235001'), 'true:active', 'ready: activated account, switch on -> active');
select is(pg_temp.assign('00000000-0000-0000-0000-000000235111', '00000000-0000-0000-0000-000000235002'), 'true:pending', 'switch off -> pending');
select is(pg_temp.assign('00000000-0000-0000-0000-000000235112', '00000000-0000-0000-0000-000000235001'), 'true:pending', 'account not activated -> pending');
reset role;
select is((select count(*)::int from members where user_id = '00000000-0000-0000-0000-000000235111' and role = 'support' and deactivated_at is null
            and gym_id = '00000000-0000-0000-0000-000000235001'), 1, 'active assignment: support membership row');
select is((select count(*)::int from members where role = 'support' and user_id in ('00000000-0000-0000-0000-000000235112')), 0, 'pending (not activated): no membership');
select is((select count(*)::int from members where role = 'support' and gym_id = '00000000-0000-0000-0000-000000235002'), 0, 'pending (switch off): no membership');
select is((select count(*)::int from audit_log where action_type = 'support_assigned' and gym_id is null
            and actor_id = '00000000-0000-0000-0000-000000235101' and target_entity_id = '00000000-0000-0000-0000-000000235111'
            and metadata ->> 'gym_id' = '00000000-0000-0000-0000-000000235001' and metadata ->> 'reason' = 'onboarding the gym' and metadata ->> 'state' = 'active'),
          1, 'one audit row: real actor, target, gym and reason in metadata, gym_id null');
select is((select count(*)::int from audit_log where action_type = 'support_assigned'), 3, 'one audit row per assignment');

-- refusals: typed, nothing written, one refusal row each
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-000000235101', 'super_admin', 'aal2');
select is(pg_temp.assign('00000000-0000-0000-0000-000000235104', '00000000-0000-0000-0000-000000235001'), 'false:target_super_admin', 'a Super Admin person cannot be assigned');
select is(pg_temp.assign('00000000-0000-0000-0000-000000235101', '00000000-0000-0000-0000-000000235001'), 'false:target_super_admin', 'the Super Admin themself cannot be assigned');
select is(pg_temp.assign('00000000-0000-0000-0000-000000235105', '00000000-0000-0000-0000-000000235001'), 'false:not_assignable', 'no support account');
select is(pg_temp.assign('00000000-0000-0000-0000-000000235117', '00000000-0000-0000-0000-000000235001'), 'false:not_assignable', 'email not confirmed');
select is(pg_temp.assign('00000000-0000-0000-0000-000000235113', '00000000-0000-0000-0000-000000235001'), 'false:deactivated', 'deactivated account');
select is(pg_temp.assign('00000000-0000-0000-0000-000000235111', '00000000-0000-0000-0000-000000235001'), 'false:already_assigned', 'a non-ended assignment exists');
select is(pg_temp.assign('00000000-0000-0000-0000-000000235112', '00000000-0000-0000-0000-000000235001'), 'false:already_assigned', 'a pending assignment also blocks');
select is(pg_temp.assign('00000000-0000-0000-0000-000000235114', '00000000-0000-0000-0000-000000235001'), 'false:other_membership', 'the person has a staff row in that gym');
select is(pg_temp.assign('00000000-0000-0000-0000-000000235118', '00000000-0000-0000-0000-000000235003'), 'false:gym_not_active', 'suspended gym');
select is(pg_temp.assign('00000000-0000-0000-0000-000000235118', '00000000-0000-0000-0000-000000235999'), 'false:gym_not_active', 'unknown gym');
reset role;
select is((select count(*)::int from support_assignments), 3, 'refusals created no assignment');
select is((select count(*)::int from audit_log where action_type = 'support_assignment_refused' and gym_id is null and actor_id = '00000000-0000-0000-0000-000000235101'), 10,
          'one refusal row per refusal');
select is((select count(*)::int from audit_log where action_type like 'support\_%' and gym_id is not null), 0, 'no support audit row is gym-scoped');

-- ---- the live gate sees the active assignment, and denies after unassign ----------------------------------------------
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-000000235111', 'support', 'aal2', '00000000-0000-0000-0000-000000235001', '00000000-0000-0000-0000-0000000235a1');
select is(private.support_gym_id(), '00000000-0000-0000-0000-000000235001'::uuid, 'before unassign: the live gate resolves the gym');
reset role;

-- ---- confirm ---------------------------------------------------------------------------------------------------
create or replace function pg_temp.aid(u text, g text) returns uuid language sql security definer as $f$
  select id from support_assignments where support_user_id = u::uuid and gym_id = g::uuid and state <> 'ended' $f$;
create or replace function pg_temp.anyid(u text) returns uuid language sql security definer as $f$ select id from support_assignments where support_user_id = u::uuid limit 1 $f$;
create or replace function pg_temp.confirm(a uuid, r text default 'confirming after the check') returns text language sql as $f$
  select ok::text || ':' || code from confirm_support_assignment(a, r) $f$;

set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-000000235101', 'super_admin', 'aal2');
select is(pg_temp.confirm(pg_temp.aid('00000000-0000-0000-0000-000000235112', '00000000-0000-0000-0000-000000235001')), 'false:not_activated', 'confirm: account not activated -> refused');
select is(pg_temp.confirm(pg_temp.aid('00000000-0000-0000-0000-000000235111', '00000000-0000-0000-0000-000000235002')), 'false:switch_off', 'confirm: switch off -> refused');
select is(pg_temp.confirm(pg_temp.aid('00000000-0000-0000-0000-000000235111', '00000000-0000-0000-0000-000000235001')), 'false:not_pending', 'confirm: an active assignment is not pending');
select is(pg_temp.confirm(pg_temp.aid('00000000-0000-0000-0000-000000235112', '00000000-0000-0000-0000-000000235001'), 'x'), 'false:reason_invalid', 'confirm: reason required');
select is(pg_temp.confirm('00000000-0000-0000-0000-000000235999'), 'false:not_found', 'confirm: unknown assignment');
reset role;
select is((select state from support_assignments where support_user_id = '00000000-0000-0000-0000-000000235112'), 'pending', 'refused confirms leave it pending');

-- enrollment completes (account activated) with the switch on: still pending until a Super Admin confirms
update private.support_accounts set activated_at = now() where user_id = '00000000-0000-0000-0000-000000235112';
select is((select state from support_assignments where support_user_id = '00000000-0000-0000-0000-000000235112'), 'pending', 'enrollment completing does not activate');
select set_config('gymos.allow_support_setter', 'on', true);
update gyms set allow_gymos_support = true where id = '00000000-0000-0000-0000-000000235002';
select set_config('gymos.allow_support_setter', 'off', true);
select is((select state from support_assignments where support_user_id = '00000000-0000-0000-0000-000000235111' and gym_id = '00000000-0000-0000-0000-000000235002'), 'pending',
          'the Owner turning the switch on does not activate a pending assignment');
select is((select count(*)::int from members where role = 'support' and gym_id = '00000000-0000-0000-0000-000000235002'), 0, 'still no membership');

set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-000000235101', 'super_admin', 'aal2');
select is(pg_temp.confirm(pg_temp.aid('00000000-0000-0000-0000-000000235112', '00000000-0000-0000-0000-000000235001')), 'true:active', 'confirm: every leg holds -> active');
select is(pg_temp.confirm(pg_temp.aid('00000000-0000-0000-0000-000000235111', '00000000-0000-0000-0000-000000235002')), 'true:active', 'confirm: switch on now -> active');
reset role;
select is((select count(*)::int from members where role = 'support' and deactivated_at is null and gym_id in ('00000000-0000-0000-0000-000000235001', '00000000-0000-0000-0000-000000235002')), 3,
          'confirmed assignments have memberships');
select is((select count(*)::int from audit_log where action_type = 'support_assignment_confirmed' and gym_id is null and actor_id = '00000000-0000-0000-0000-000000235101'), 2, 'one audit row per confirm');

-- confirm re-checks: other membership, inactive gym, deactivated account
insert into support_assignments (id, support_user_id, gym_id, state) values
  ('00000000-0000-0000-0000-000000235701', '00000000-0000-0000-0000-000000235115', '00000000-0000-0000-0000-000000235001', 'pending'),
  ('00000000-0000-0000-0000-000000235702', '00000000-0000-0000-0000-000000235118', '00000000-0000-0000-0000-000000235003', 'pending'),
  ('00000000-0000-0000-0000-000000235703', '00000000-0000-0000-0000-000000235113', '00000000-0000-0000-0000-000000235001', 'pending');
insert into members (gym_id, user_id, role, name) values ('00000000-0000-0000-0000-000000235001', '00000000-0000-0000-0000-000000235115', 'coach', 'Late Coach');
update private.support_accounts set activated_at = now() where user_id = '00000000-0000-0000-0000-000000235115';
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-000000235101', 'super_admin', 'aal2');
select is(pg_temp.confirm('00000000-0000-0000-0000-000000235701'), 'false:other_membership', 'confirm: the person gained a staff row');
select is(pg_temp.confirm('00000000-0000-0000-0000-000000235702'), 'false:gym_not_active', 'confirm: gym not active');
select is(pg_temp.confirm('00000000-0000-0000-0000-000000235703'), 'false:deactivated', 'confirm: deactivated account');
reset role;

-- ---- state rules in the database -------------------------------------------------------------------------------
select throws_ok($$update support_assignments set state = 'pending' where id = (select id from support_assignments where state = 'active' limit 1)$$,
                 'P0001', null, 'active -> pending refused');
select throws_ok($$update support_assignments set gym_id = '00000000-0000-0000-0000-000000235002' where id = '00000000-0000-0000-0000-000000235701'$$,
                 'P0001', null, 'the gym of an assignment cannot change');
select throws_ok($$update support_assignments set state = 'active' where id = '00000000-0000-0000-0000-000000235701'$$,
                 '23514', null, 'active without activated_at refused (CHECK)');
select throws_ok($$update support_assignments set ended_at = now() where id = '00000000-0000-0000-0000-000000235701'$$,
                 '23514', null, 'ended_at without ended refused (CHECK)');
select throws_ok($$update support_assignments set state = 'ended' where id = '00000000-0000-0000-0000-000000235701'$$,
                 '23514', null, 'ended without ended_at refused (CHECK)');

-- ---- unassign --------------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-000000235101', 'super_admin', 'aal2');
create or replace function pg_temp.unassign(a uuid, r text default 'finished the work') returns text language sql as $f$
  select ok::text || ':' || code from unassign_support(a, r) $f$;
select is(pg_temp.unassign(pg_temp.aid('00000000-0000-0000-0000-000000235111', '00000000-0000-0000-0000-000000235001'), ''), 'false:reason_invalid', 'unassign: missing reason refused');
select is(pg_temp.unassign('00000000-0000-0000-0000-000000235999'), 'false:not_found', 'unassign: unknown assignment');
select is(pg_temp.unassign(pg_temp.aid('00000000-0000-0000-0000-000000235111', '00000000-0000-0000-0000-000000235001')), 'true:ended', 'unassign an active assignment');
select is(pg_temp.unassign(pg_temp.aid('00000000-0000-0000-0000-000000235111', '00000000-0000-0000-0000-000000235002')), 'true:ended', 'unassign works from any open state');
reset role;
select is((select count(*)::int from support_assignments where support_user_id = '00000000-0000-0000-0000-000000235111' and state = 'ended' and ended_at is not null), 2, 'ended with ended_at');
select is((select count(*)::int from members where user_id = '00000000-0000-0000-0000-000000235111' and role = 'support' and deactivated_at is null), 0, 'support membership deactivated');
select is((select count(*)::int from audit_log where action_type = 'support_unassigned' and gym_id is null and actor_id = '00000000-0000-0000-0000-000000235101'
            and metadata ->> 'reason' = 'finished the work' and metadata ->> 'gym_id' is not null), 2, 'one audit row per unassign, reason recorded');
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-000000235111', 'support', 'aal2', '00000000-0000-0000-0000-000000235001', '00000000-0000-0000-0000-0000000235a1');
select is(private.support_gym_id(), null, 'after unassign: the next request is denied by the live gate');
select pg_temp.claims('00000000-0000-0000-0000-000000235101', 'super_admin', 'aal2');
select is(pg_temp.unassign(pg_temp.anyid('00000000-0000-0000-0000-000000235111')), 'false:already_ended', 'unassign: ended is terminal');
reset role;
select throws_ok($$update support_assignments set state = 'active', ended_at = null where support_user_id = '00000000-0000-0000-0000-000000235111'$$,
                 'P0001', null, 'an ended assignment cannot be revived');
select lives_ok($$select 1 from private.support_gym_lock('00000000-0000-0000-0000-000000235001')$$, 'lock helper callable');

-- re-assign after end works (the partial unique index only covers non-ended rows)
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-000000235101', 'super_admin', 'aal2');
select is(pg_temp.assign('00000000-0000-0000-0000-000000235111', '00000000-0000-0000-0000-000000235001'), 'true:active', 'a new assignment after an ended one');
reset role;

-- ---- deactivate ------------------------------------------------------------------------------------------------
-- s8: active in A, pending in B (inserted); s6 never activated with an invite and a pending assignment
insert into support_assignments (id, support_user_id, gym_id, state, activated_at) values
  ('00000000-0000-0000-0000-000000235711', '00000000-0000-0000-0000-000000235118', '00000000-0000-0000-0000-000000235001', 'active', now());
select private.support_set_membership('00000000-0000-0000-0000-000000235711', true);
insert into support_assignments (id, support_user_id, gym_id, state) values
  ('00000000-0000-0000-0000-000000235712', '00000000-0000-0000-0000-000000235118', '00000000-0000-0000-0000-000000235002', 'pending');
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-000000235101', 'super_admin', 'aal2');
select is((select ok::text || ':' || code from deactivate_support_account('00000000-0000-0000-0000-000000235118', 'x')), 'false:reason_invalid', 'deactivate: short reason refused');
select is((select ok::text || ':' || code from deactivate_support_account('00000000-0000-0000-0000-000000235999', 'valid reason')), 'false:not_found', 'deactivate: unknown account');
select is((select ok::text || ':' || code from deactivate_support_account('00000000-0000-0000-0000-000000235118', 'left the company')), 'true:deactivated', 'deactivate an activated account');
select is((select ok::text || ':' || code from deactivate_support_account('00000000-0000-0000-0000-000000235118', 'left the company')), 'false:already_deactivated', 'deactivate twice: refused');
reset role;
select is((select count(*)::int from support_assignments where support_user_id = '00000000-0000-0000-0000-000000235118' and state = 'ended' and ended_at is not null), 3, 'every open assignment ended (active in A, pending in B and in C)');
select is((select count(*)::int from members where user_id = '00000000-0000-0000-0000-000000235118' and role = 'support' and deactivated_at is null), 0, 'memberships deactivated');
select is((select (deactivated_at is not null)::text from private.support_accounts where user_id = '00000000-0000-0000-0000-000000235118'), 'true', 'deactivated_at set');
select is((select count(*)::int from auth.sessions where user_id = '00000000-0000-0000-0000-000000235118'), 0, 'sessions revoked');
select is((select count(*)::int from audit_log where action_type = 'support_account_deactivated' and gym_id is null and actor_id = '00000000-0000-0000-0000-000000235101'
            and target_entity_id = '00000000-0000-0000-0000-000000235118' and metadata ->> 'reason' = 'left the company'), 1, 'one audit row for the deactivation');
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-000000235101', 'super_admin', 'aal2');
select is(pg_temp.assign('00000000-0000-0000-0000-000000235118', '00000000-0000-0000-0000-000000235001'), 'false:deactivated', 'assign refused after deactivation');
reset role;
select is(pg_temp.err($$select issue_support_invite('00000000-0000-0000-0000-000000235118', '00000000-0000-0000-0000-000000235091.' || repeat('a', 64), '00000000-0000-0000-0000-000000235101')$$),
          'support_invite_refused', 'invite refused after deactivation');
-- a never-activated account can be deactivated too; its invite dies
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-000000235101', 'super_admin', 'aal2');
select is((select ok::text || ':' || code from deactivate_support_account('00000000-0000-0000-0000-000000235116', 'mistaken hire')), 'true:deactivated', 'deactivate a never-activated account');
select is((select invite_state from get_support_accounts() where user_id = '00000000-0000-0000-0000-000000235116'), 'deactivated', 'the list reports it as deactivated');
reset role;
select is((select count(*)::int from private.support_invites where user_id = '00000000-0000-0000-0000-000000235116' and superseded_at is not null), 1, 'its invite is superseded');
select is((select count(*)::int from private.support_invite_check('00000000-0000-0000-0000-000000235601.' || repeat('a', 64))), 0, 'and cannot be used');

-- ---- remove ----------------------------------------------------------------------------------------------------
insert into support_assignments (id, support_user_id, gym_id, state) values
  ('00000000-0000-0000-0000-000000235721', '00000000-0000-0000-0000-000000235119', '00000000-0000-0000-0000-000000235001', 'pending');
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-000000235101', 'super_admin', 'aal2');
select is((select ok::text || ':' || code from remove_support_account('00000000-0000-0000-0000-000000235119', 'no')), 'false:reason_invalid', 'remove: short reason refused');
select is((select ok::text || ':' || code from remove_support_account('00000000-0000-0000-0000-000000235112', 'wrong person')), 'false:activated', 'remove: an activated account is refused');
select is((select ok::text || ':' || code from remove_support_account('00000000-0000-0000-0000-000000235999', 'wrong person')), 'false:not_found', 'remove: unknown account');
select is((select ok::text || ':' || code from remove_support_account('00000000-0000-0000-0000-000000235119', 'mistyped address')), 'true:removed', 'remove a never-activated account');
reset role;
select is((select count(*)::int from private.support_accounts where user_id = '00000000-0000-0000-0000-000000235119')
          + (select count(*)::int from private.support_invites where user_id = '00000000-0000-0000-0000-000000235119')
          + (select count(*)::int from support_assignments where support_user_id = '00000000-0000-0000-0000-000000235119')
          + (select count(*)::int from auth.users where id = '00000000-0000-0000-0000-000000235119')
          + (select count(*)::int from public.users where id = '00000000-0000-0000-0000-000000235119'), 0, 'account, invites, assignments, auth user and user are gone');
select is((select count(*)::int from audit_log where action_type = 'support_account_removed' and gym_id is null and actor_id = '00000000-0000-0000-0000-000000235101'
            and target_entity_id = '00000000-0000-0000-0000-000000235119' and metadata ->> 'reason' = 'mistyped address'), 1, 'one audit row survives the removal');
select is((select count(*)::int from private.support_accounts where user_id = '00000000-0000-0000-0000-000000235112'), 1, 'the refused removal left the activated account');
select is((select count(*)::int from audit_log where action_type = 'support_account_remove_refused'), 1, 'one refusal row');

-- ---- read (Super Admin only) -----------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-000000235101', 'super_admin', 'aal2');
select is((select display_name from get_support_assignments('00000000-0000-0000-0000-000000235001') where support_user_id = '00000000-0000-0000-0000-000000235112' and state = 'active'),
          (select display_name from users where id = '00000000-0000-0000-0000-000000235112'), 'Super Admin sees the individual''s name per gym');
select is((select count(distinct gym_id)::int from get_support_assignments('00000000-0000-0000-0000-000000235002')), 1, 'gym filter works');
select cmp_ok((select count(*)::int from get_support_assignments(null, '00000000-0000-0000-0000-000000235111')), '>=', 3, 'person filter works');

-- ---- the Owner sees nothing ------------------------------------------------------------------------------------
select pg_temp.claims('00000000-0000-0000-0000-000000235102', 'owner', 'aal2', '00000000-0000-0000-0000-000000235001');
select is((select count(*)::int from audit_log where action_type like 'support\_%' or action_type = 'support_assigned'), 0, 'an Owner reads none of the support audit rows');
select is((select count(*)::int from audit_log where target_entity_id like '00000000-0000-0000-0000-0000002351%'), 0, 'no audit row about a support person is visible to the Owner');
reset role;

-- ---- invariant, locks, writer scans ----------------------------------------------------------------------------
select is((select count(*)::int from members m where m.role = 'support' and m.deactivated_at is null
            and not exists (select 1 from support_assignments a join gyms g on g.id = a.gym_id
                             where a.support_user_id = m.user_id and a.gym_id = m.gym_id and a.state = 'active' and g.allow_gymos_support)), 0,
          'invariant: every active support membership has an active assignment and the switch on');
select is((select coalesce(array_agg(p.proname::text order by p.proname), '{}') from pg_proc p
            where p.prosrc ~ 'support_gym_lock' and p.proname in ('assign_support', 'confirm_support_assignment', 'unassign_support', 'deactivate_support_account', 'remove_support_account', 'set_allow_gymos_support')),
          array['assign_support', 'confirm_support_assignment', 'deactivate_support_account', 'remove_support_account', 'set_allow_gymos_support', 'unassign_support'],
          'every assignment writer takes the per-gym lock');
select is((select coalesce(array_agg(p.proname::text order by p.proname), '{}') from pg_proc p
            where p.prokind = 'f' and p.prosrc ~* '(insert\s+into|update|delete\s+from)\s+(only\s+)?(public\.)?support_assignments\M'),
          array['assign_support', 'confirm_support_assignment', 'deactivate_support_account', 'remove_support_account', 'set_allow_gymos_support', 'support_restore_assignments', 'unassign_support'],
          'only the listed functions write support_assignments (an unlisted writer fails here)');
select is((select coalesce(array_agg(p.proname::text order by p.proname), '{}') from pg_proc p
            where p.prokind = 'f' and p.prosrc ~* '(insert\s+into|update|delete\s+from)\s+(only\s+)?private\.support_accounts\M'),
          array['activate_support_account', 'cancel_support_factor_reset', 'change_support_contact', 'claim_support_factor_resets', 'create_support_account', 'deactivate_support_account', 'recertify_support_account', 'remove_support_account', 'start_support_factor_reset', 'support_lock_account', 'unlock_support_account'],
          'only the listed functions write private.support_accounts');
select is((select coalesce(array_agg(p.proname::text order by p.proname), '{}') from pg_proc p
            where p.prokind = 'f' and p.prosrc ~* 'support_set_membership\('),
          array['assign_support', 'confirm_support_assignment', 'deactivate_support_account', 'set_allow_gymos_support', 'support_restore_assignments', 'unassign_support'],
          'only the listed functions call the support membership writer');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace
            and p.proname in ('assign_support', 'confirm_support_assignment', 'unassign_support', 'deactivate_support_account', 'remove_support_account', 'get_support_assignments')
            and p.prosecdef), 6, 'all six are SECURITY DEFINER');

select * from finish();
rollback;
