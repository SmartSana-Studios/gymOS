-- Story 23.4: create a support account and invite it (migration 0138).
begin;
select plan(86);

create or replace function pg_temp.claims(uid text, app_role text, aal text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"' || uid || '","role":"authenticated","session_id":"00000000-0000-0000-0000-0000000234a0","aal":"' || aal || '"'
    || case when app_role is null then '' else ',"app_role":"' || app_role || '"' end || '}', true);
end $f$;
-- the exception message of a statement ('ok' when it ran), so refusals can be compared for identity
create or replace function pg_temp.err(stmt text) returns text language plpgsql as $f$
begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $f$;

-- ---- fixtures ---------------------------------------------------------------------------------------------------
insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000234301', 'Invite Tier', 5000, 50000, 30);
insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-000000234001', 'Invite Gym', '00000000-0000-0000-0000-000000234301', 30);
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000234101', 'admin-234@x.example', now()),
  ('00000000-0000-0000-0000-000000234102', 'owner-234@x.example', now()),
  ('00000000-0000-0000-0000-000000234103', 'other@gymosapps.com', now()),     -- collision source: auth user
  ('00000000-0000-0000-0000-000000234104', 'staffmail-234@x.example', now()), -- carries members.email
  ('00000000-0000-0000-0000-000000234105', 'linked-234@x.example', now()),    -- carries a linked identity
  ('00000000-0000-0000-0000-000000234106', 'sadmin@gymosapps.com', now()),    -- a Super Admin on the domain
  ('00000000-0000-0000-0000-000000234111', 'sup.one@gymosapps.com', now()),
  ('00000000-0000-0000-0000-000000234112', 'sup.two@gymosapps.com', now()),
  ('00000000-0000-0000-0000-000000234113', 'sup.three@gymosapps.com', now()),
  ('00000000-0000-0000-0000-000000234114', 'sup.four@gymosapps.com', now()),
  ('00000000-0000-0000-0000-000000234115', 'sup.five@gymosapps.com', now()),
  ('00000000-0000-0000-0000-000000234121', 'Other@GymOSApps.com', now()),      -- case-variant duplicates of the sources
  ('00000000-0000-0000-0000-000000234122', 'Staff.Dup@gymosapps.com', now()),
  ('00000000-0000-0000-0000-000000234123', 'Linked.Dup@gymosapps.com', now()),
  ('00000000-0000-0000-0000-000000234124', 'SAdmin@gymosapps.com', now()),
  ('00000000-0000-0000-0000-000000234131', 'sup.wrong@x.example', now()),      -- wrong domain
  ('00000000-0000-0000-0000-000000234132', 'sup.unverified@gymosapps.com', null);
update users set is_super_admin = true where id in ('00000000-0000-0000-0000-000000234101', '00000000-0000-0000-0000-000000234106');
insert into members (gym_id, user_id, role, name, email) values
  ('00000000-0000-0000-0000-000000234001', '00000000-0000-0000-0000-000000234102', 'owner', 'Owner 234', null),
  ('00000000-0000-0000-0000-000000234001', '00000000-0000-0000-0000-000000234104', 'coach', 'Coach 234', 'staff.dup@gymosapps.com');
insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at) values
  ('linked-234', '00000000-0000-0000-0000-000000234105', '{"email":"linked.dup@gymosapps.com"}'::jsonb, 'google', now(), now());

insert into auth.sessions (id, user_id, created_at, updated_at)
values ('00000000-0000-0000-0000-0000000234a0', '00000000-0000-0000-0000-000000234101', now(), now());

-- ---- ACLs -------------------------------------------------------------------------------------------------------
select is((select count(*)::int from unnest(array[
    'public.create_support_account(uuid, text, text)', 'public.get_support_accounts()',
    'public.support_invite_inspect(text)', 'public.support_invite_mark_password_set(text)', 'public.support_invite_code_failed(text)',
    'public.activate_support_account(text)', 'private.support_email_collision(text, uuid)', 'private.support_invite_check(text)',
    'private.support_audit(uuid, text, text, uuid, jsonb)', 'public.issue_support_invite(uuid, text, uuid)']) f
   where has_function_privilege('anon', f, 'execute')), 0, 'no new function is callable by anon');
select is((select count(*)::int from unnest(array[
    'public.support_invite_inspect(text)', 'public.support_invite_mark_password_set(text)', 'public.support_invite_code_failed(text)',
    'public.activate_support_account(text)', 'private.support_email_collision(text, uuid)', 'private.support_invite_check(text)',
    'private.support_audit(uuid, text, text, uuid, jsonb)', 'public.issue_support_invite(uuid, text, uuid)']) f
   where has_function_privilege('authenticated', f, 'execute')), 0, 'invite-side and private functions are not callable by authenticated');
select is(has_function_privilege('authenticated', 'public.create_support_account(uuid, text, text)', 'execute')
          and has_function_privilege('authenticated', 'public.get_support_accounts()', 'execute'), true, 'Super Admin side is callable by authenticated');
select is(has_table_privilege('authenticated', 'private.support_invites', 'select') or has_table_privilege('anon', 'private.support_invites', 'select'),
          false, 'support_invites: no client grant');
select is((select relrowsecurity from pg_class where oid = 'private.support_invites'::regclass), true, 'support_invites: RLS on');
select is(private.capability_roles('platform.support_manage'), array['super_admin'], 'capability platform.support_manage is Super Admin only');

-- ---- refusals: flag off, aal1, non-admin ------------------------------------------------------------------------
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-000000234101', 'super_admin', 'aal2');
select throws_ok($$select create_support_account('00000000-0000-0000-0000-000000234111', 'Sup One', 'sup.one@gymosapps.com')$$,
                 'P0001', 'permission denied', 'flag off: creation refused even at aal2');
reset role;
update private.platform_flags set enabled = true where flag = 'super_admin_aal2';
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-000000234101', 'super_admin', 'aal1');
select throws_ok($$select create_support_account('00000000-0000-0000-0000-000000234111', 'Sup One', 'sup.one@gymosapps.com')$$,
                 'P0001', 'permission denied', 'aal1: creation refused');
select pg_temp.claims('00000000-0000-0000-0000-000000234102', 'owner', 'aal2');
select throws_ok($$select create_support_account('00000000-0000-0000-0000-000000234111', 'Sup One', 'sup.one@gymosapps.com')$$,
                 'P0001', 'permission denied', 'non-admin: creation refused');
select throws_ok($$select issue_support_invite('00000000-0000-0000-0000-000000234111', '00000000-0000-0000-0000-0000000234a1.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '00000000-0000-0000-0000-000000234101')$$,
                 '42501', null, 'non-admin session: no EXECUTE on invite issuance');
select throws_ok($$select get_support_accounts()$$, 'P0001', 'permission denied', 'non-admin: state read refused');
reset role;
select is((select count(*)::int from private.support_accounts where user_id = '00000000-0000-0000-0000-000000234111'), 0, 'refused attempts wrote nothing');

-- ---- create ----------------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-000000234101', 'super_admin', 'aal2');
select is(pg_temp.err($$select create_support_account('00000000-0000-0000-0000-000000234131', 'Wrong', 'sup.wrong@x.example')$$),
          'support_account_refused', 'a non-gymosapps.com email is refused');
select is(pg_temp.err($$select create_support_account('00000000-0000-0000-0000-000000234132', 'Unverified', 'sup.unverified@gymosapps.com')$$),
          'support_account_refused', 'an unconfirmed email is refused');
select is(pg_temp.err($$select create_support_account('00000000-0000-0000-0000-000000234111', '  ', 'sup.one@gymosapps.com')$$),
          'support_account_refused', 'a blank name is refused');
select is(pg_temp.err($$select create_support_account('00000000-0000-0000-0000-000000234111', 'Sup One', 'sup.one@gymosapps.com')$$),
          'ok', 'Super Admin at aal2 with the flag on creates an account');
reset role;
select is((select (activated_at is null)::text from private.support_accounts where user_id = '00000000-0000-0000-0000-000000234111'),
          'true', 'the account starts inactive');
select is((select count(*)::int from support_assignments where support_user_id = '00000000-0000-0000-0000-000000234111')
          + (select count(*)::int from members where user_id = '00000000-0000-0000-0000-000000234111'), 0, 'no assignment and no membership');
select is((select display_name from users where id = '00000000-0000-0000-0000-000000234111'), 'Sup One', 'display name stored');
select is((select count(*)::int from audit_log where action_type = 'support_account_created'
            and target_entity_id = '00000000-0000-0000-0000-000000234111' and actor_id = '00000000-0000-0000-0000-000000234101'), 1,
          'one audit row, actor is the real Super Admin');
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-000000234101', 'super_admin', 'aal2');
select is(pg_temp.err($$select create_support_account('00000000-0000-0000-0000-000000234111', 'Sup One', 'sup.one@gymosapps.com')$$),
          'support_account_refused', 'creating the same account twice is refused');
select is((select assignable::text || '|' || activated::text || '|' || invite_state from get_support_accounts() where user_id = '00000000-0000-0000-0000-000000234111'),
          'true|false|none', 'state read: assignable, not activated, no invite');

select throws_ok($$select issue_support_invite('00000000-0000-0000-0000-000000234111', '00000000-0000-0000-0000-000000234090.' || repeat('e', 64), '00000000-0000-0000-0000-000000234101')$$, '42501', null, 'a Super Admin session at aal2 cannot call issuance directly (no EXECUTE), so it never learns a link');

-- ---- collision: every source, one identical message -------------------------------------------------------------
select is(pg_temp.err($$select create_support_account('00000000-0000-0000-0000-000000234121', 'Dup', 'Other@GymOSApps.com')$$), 'support_account_refused', 'collision: auth user (case-insensitive)');
select is(pg_temp.err($$select create_support_account('00000000-0000-0000-0000-000000234122', 'Dup', 'Staff.Dup@gymosapps.com')$$), 'support_account_refused', 'collision: gym member email');
select is(pg_temp.err($$select create_support_account('00000000-0000-0000-0000-000000234123', 'Dup', 'Linked.Dup@gymosapps.com')$$), 'support_account_refused', 'collision: linked identity');
select is(pg_temp.err($$select create_support_account('00000000-0000-0000-0000-000000234124', 'Dup', 'SAdmin@gymosapps.com')$$), 'support_account_refused', 'collision: Super Admin');
reset role;
select is((select count(*)::int from private.support_accounts where user_id in (
  '00000000-0000-0000-0000-000000234121', '00000000-0000-0000-0000-000000234122', '00000000-0000-0000-0000-000000234123', '00000000-0000-0000-0000-000000234124')),
  0, 'collisions wrote nothing');

-- ---- invite ----------------------------------------------------------------------------------------------------
create or replace function pg_temp.tok(n int, c text) returns text language sql as $f$
  select '00000000-0000-0000-0000-00000023' || lpad(n::text, 4, '0') || '.' || repeat(c, 64) $f$;

select is(pg_temp.err($$select issue_support_invite('00000000-0000-0000-0000-000000234111', 'not-a-token', '00000000-0000-0000-0000-000000234101')$$), 'support_invite_refused', 'a malformed token cannot be stored');
select is(pg_temp.err($$select issue_support_invite('00000000-0000-0000-0000-000000234112', pg_temp.tok(4001, 'a'), '00000000-0000-0000-0000-000000234101')$$), 'support_invite_refused', 'no invite for an id without an account');
select is(pg_temp.err($$select issue_support_invite('00000000-0000-0000-0000-000000234111', pg_temp.tok(4001, 'a'), '00000000-0000-0000-0000-000000234101')$$), 'ok', 'invite issued');
reset role;
select is((select count(*)::int from private.support_invites where user_id = '00000000-0000-0000-0000-000000234111'
            and token_hash = encode(extensions.digest(pg_temp.tok(4001, 'a'), 'sha256'), 'hex')), 1, 'the SHA-256 of the token is stored');
select is((select count(*)::int from private.support_invites i where i::text like '%' || repeat('a', 64) || '%'), 0, 'the token itself is not stored anywhere in the row');
select is((select count(*)::int from audit_log where action_type = 'support_invite_issued' and target_entity_id = '00000000-0000-0000-0000-000000234111'
            and actor_id = '00000000-0000-0000-0000-000000234101'), 1, 'one audit row for the invite');
select is((select count(*)::int from audit_log a where a.metadata::text like '%' || repeat('a', 64) || '%' or a.metadata::text ilike '%gymosapps.com%'), 0,
          'no audit row holds a token or an address');
select is((select (expires_at > now() + interval '23 hours 59 minutes' and expires_at <= now() + interval '24 hours')::text
             from private.support_invites where id = '00000000-0000-0000-0000-000000234001'), 'true', '24 hour expiry');
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-000000234101', 'super_admin', 'aal2');
select is((select assignable::text || '|' || activated::text || '|' || invite_state from get_support_accounts() where user_id = '00000000-0000-0000-0000-000000234111'),
          'true|false|pending', 'state read: invite pending');
reset role;

-- generic failure for every bad token
select is((select count(*)::int from support_invite_inspect(pg_temp.tok(4001, 'a')) where ok and step = 'password'), 1, 'valid token: password step');
select is((select email from support_invite_inspect(pg_temp.tok(4001, 'a'))), 'sup.one@gymosapps.com', 'valid token returns the bound address');
select is((select count(*)::int from support_invite_inspect('garbage') where ok), 0, 'malformed token: not ok');
select is((select count(*)::int from support_invite_inspect(pg_temp.tok(9999, 'a')) where ok), 0, 'unknown invite id: not ok');
select is((select count(*)::int from support_invite_inspect(pg_temp.tok(4001, 'b')) where ok), 0, 'wrong secret: not ok');
select is((select attempts from private.support_invites where id = '00000000-0000-0000-0000-000000234001'), 1, 'a wrong secret counts as an attempt');
select is((select (ok::text || coalesce(step, '-') || coalesce(user_id::text, '-') || coalesce(email, '-')) from support_invite_inspect('garbage')),
          (select (ok::text || coalesce(step, '-') || coalesce(user_id::text, '-') || coalesce(email, '-')) from support_invite_inspect(pg_temp.tok(4001, 'b'))),
          'every failure answers identically');
-- the attempts limit kills the invite, even for the right token
select support_invite_inspect(pg_temp.tok(4001, 'c')) from generate_series(1, 4);
select is((select count(*)::int from support_invite_inspect(pg_temp.tok(4001, 'a')) where ok), 0, 'after 5 wrong secrets the invite is dead');

-- re-issue supersedes
select is(pg_temp.err($$select issue_support_invite('00000000-0000-0000-0000-000000234111', pg_temp.tok(4002, 'd'), '00000000-0000-0000-0000-000000234101')$$), 'ok', 're-issue works');
select is((select count(*)::int from support_invite_inspect(pg_temp.tok(4001, 'a')) where ok), 0, 'the earlier invite is superseded');
select is((select count(*)::int from support_invite_inspect(pg_temp.tok(4002, 'd')) where ok and step = 'password'), 1, 'the new invite works');

-- ---- activation ------------------------------------------------------------------------------------------------
select is((select reason from activate_support_account(pg_temp.tok(4002, 'd'))), 'password_not_set', 'activation before the password step is refused');
select is(support_invite_mark_password_set(pg_temp.tok(4002, 'd')), true, 'password step recorded');
select is(support_invite_mark_password_set(pg_temp.tok(4002, 'e')), false, 'password step with a wrong token is refused');
select is((select step from support_invite_inspect(pg_temp.tok(4002, 'd'))), 'totp', 'the same link resumes at the TOTP step');
select is((select reason from activate_support_account(pg_temp.tok(4002, 'd'))), 'no_verified_factor', 'activation without a TOTP factor is refused');
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000234f1', '00000000-0000-0000-0000-000000234111', 'unverified', 'totp', 'unverified', now(), now());
select is((select reason from activate_support_account(pg_temp.tok(4002, 'd'))), 'no_verified_factor', 'an unverified factor does not count');
select is((select count(*)::int from audit_log where action_type = 'support_activation_refused' and target_entity_id = '00000000-0000-0000-0000-000000234111'), 3,
          'each refusal at activation is one audit row');
select is((select count(*)::int from audit_log where metadata::text like '%' || repeat('d', 64) || '%'), 0, 'refusal rows hold no token');
select is((select activated_at is null from private.support_accounts where user_id = '00000000-0000-0000-0000-000000234111'), true, 'still inactive after the refusals');

-- a wrong TOTP code counts against the invite
select is(support_invite_code_failed(pg_temp.tok(4002, 'd')), true, 'wrong code 1: invite still usable');
select is((select code_attempts from private.support_invites where id = '00000000-0000-0000-0000-000000234002'), 1, 'code attempts counted');

-- the live gate denies until activation, with every other leg in place
insert into support_assignments (id, support_user_id, gym_id, state, activated_at) values
  ('00000000-0000-0000-0000-000000234401', '00000000-0000-0000-0000-000000234111', '00000000-0000-0000-0000-000000234001', 'active', now());
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000234a1', '00000000-0000-0000-0000-000000234111', now(), now());
insert into private.support_session_state (session_id, user_id, started_at, last_seen_at)
values ('00000000-0000-0000-0000-0000000234a1', '00000000-0000-0000-0000-000000234111', now(), now());
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000234111","role":"authenticated","aal":"aal2","session_id":"00000000-0000-0000-0000-0000000234a1"}', true);
select is(private.support_live('00000000-0000-0000-0000-000000234111', '00000000-0000-0000-0000-000000234001'), false,
          'assignable is not live: the gate denies before activation');

-- a collision found at activation refuses it (the account became a Super Admin in between)
select set_config('request.jwt.claims', null, true);
update users set is_super_admin = true where id = '00000000-0000-0000-0000-000000234111';
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000234f2', '00000000-0000-0000-0000-000000234111', 'verified', 'totp', 'verified', now(), now());
select is((select reason from activate_support_account(pg_temp.tok(4002, 'd'))), 'collision', 'activation re-runs the collision check and refuses');
update users set is_super_admin = false where id = '00000000-0000-0000-0000-000000234111';

-- expiry
update private.support_invites set expires_at = now() - interval '1 second' where id = '00000000-0000-0000-0000-000000234002';
select is((select count(*)::int from support_invite_inspect(pg_temp.tok(4002, 'd')) where ok), 0, 'expired invite: not ok');
select is((select ok from activate_support_account(pg_temp.tok(4002, 'd'))), false, 'expired invite cannot activate');
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-000000234101', 'super_admin', 'aal2');
select is((select invite_state from get_support_accounts() where user_id = '00000000-0000-0000-0000-000000234111'), 'expired', 'state read: expired');
reset role;
select issue_support_invite('00000000-0000-0000-0000-000000234111', pg_temp.tok(4003, 'f'), '00000000-0000-0000-0000-000000234101');

select is((select ok::text || reason from activate_support_account(pg_temp.tok(4003, 'f'))), 'falsepassword_not_set', 'a fresh invite starts at the password step');
select support_invite_mark_password_set(pg_temp.tok(4003, 'f'));
select set_config('request.jwt.claims', null, true);
select is((select ok::text || reason from activate_support_account(pg_temp.tok(4003, 'f'))), 'trueok', 'valid link, password set, TOTP verified: activated');
select is((select (activated_at is not null)::text from private.support_accounts where user_id = '00000000-0000-0000-0000-000000234111'), 'true', 'activated_at is set');
select is((select count(*)::int from audit_log where action_type = 'support_account_activated' and target_entity_id = '00000000-0000-0000-0000-000000234111'), 1, 'one activation audit row');
select is((select count(*)::int from auth.sessions where user_id = '00000000-0000-0000-0000-000000234111'), 0, 'the enrolment session is ended');
select is((select reason from activate_support_account(pg_temp.tok(4003, 'f'))), 'invalid', 'second use of the link: generic refusal');
select is((select count(*)::int from support_invite_inspect(pg_temp.tok(4003, 'f')) where ok), 0, 'second use of the link: inspect not ok');
select is((select consumed_at is not null from private.support_invites where id = '00000000-0000-0000-0000-000000234003'), true, 'invite consumed');

-- after activation the gate opens (new session, all legs in place)
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000234a2', '00000000-0000-0000-0000-000000234111', now(), now());
insert into private.support_session_state (session_id, user_id, started_at, last_seen_at)
values ('00000000-0000-0000-0000-0000000234a2', '00000000-0000-0000-0000-000000234111', now(), now());
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000234111","role":"authenticated","aal":"aal2","session_id":"00000000-0000-0000-0000-0000000234a2"}', true);
select is(private.support_live('00000000-0000-0000-0000-000000234111', '00000000-0000-0000-0000-000000234001'), true, 'activated: the gate no longer denies on that leg');

-- TOTP code attempts kill the invite
reset role;
select set_config('request.jwt.claims', null, true);
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-000000234101', 'super_admin', 'aal2');
select create_support_account('00000000-0000-0000-0000-000000234112', 'Sup Two', 'sup.two@gymosapps.com');
reset role;
select issue_support_invite('00000000-0000-0000-0000-000000234112', pg_temp.tok(4004, '1'), '00000000-0000-0000-0000-000000234101');
select support_invite_code_failed(pg_temp.tok(4004, '1')) from generate_series(1, 4);
select is(support_invite_code_failed(pg_temp.tok(4004, '1')), false, 'the fifth wrong code kills the invite');
select is((select count(*)::int from support_invite_inspect(pg_temp.tok(4004, '1')) where ok), 0, 'a dead invite no longer opens');

-- ---- issuance is server-only with a live-checked actor; activation-time collision legs ----------------------------------------
select is(pg_temp.err($$select issue_support_invite('00000000-0000-0000-0000-000000234112', pg_temp.tok(4091, '2'), '00000000-0000-0000-0000-000000234102')$$),
          'permission denied', 'service call with a non-admin p_actor is refused');
select is(pg_temp.err($$select issue_support_invite('00000000-0000-0000-0000-000000234112', pg_temp.tok(4091, '2'), null)$$),
          'permission denied', 'service call with no p_actor is refused');
select is(pg_temp.err($$select issue_support_invite('00000000-0000-0000-0000-000000234111', pg_temp.tok(4092, '3'), '00000000-0000-0000-0000-000000234101')$$),
          'support_invite_refused', 'issuing an invite for an activated account is refused');
select is(pg_temp.err($$select issue_support_invite('00000000-0000-0000-0000-000000234199', pg_temp.tok(4093, '4'), '00000000-0000-0000-0000-000000234101')$$),
          'support_invite_refused', 'issuing an invite for an unknown account is refused');
select is((select count(*)::int from audit_log where action_type = 'support_invite_issued' and actor_id <> '00000000-0000-0000-0000-000000234101'), 0, 'every invite audit row names the p_actor Super Admin');
select is((select created_by from private.support_invites where id = '00000000-0000-0000-0000-000000234004'), '00000000-0000-0000-0000-000000234101'::uuid, 'created_by is p_actor');

insert into private.support_accounts (user_id) values ('00000000-0000-0000-0000-000000234113'), ('00000000-0000-0000-0000-000000234114');
select issue_support_invite('00000000-0000-0000-0000-000000234113', pg_temp.tok(4005, '5'), '00000000-0000-0000-0000-000000234101');
select issue_support_invite('00000000-0000-0000-0000-000000234114', pg_temp.tok(4006, '6'), '00000000-0000-0000-0000-000000234101');
select support_invite_mark_password_set(pg_temp.tok(4005, '5'));
select support_invite_mark_password_set(pg_temp.tok(4006, '6'));
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000234f3', '00000000-0000-0000-0000-000000234113', 'verified', 'totp', 'verified', now(), now()),
  ('00000000-0000-0000-0000-0000000234f4', '00000000-0000-0000-0000-000000234114', 'verified', 'totp', 'verified', now(), now());
insert into members (gym_id, user_id, role, name) values ('00000000-0000-0000-0000-000000234001', '00000000-0000-0000-0000-000000234113', 'coach', 'Coach Three');
select is((select reason from activate_support_account(pg_temp.tok(4005, '5'))), 'collision', 'activation refused after the pending account gained a coach membership');
update auth.users set phone = '237600000999' where id = '00000000-0000-0000-0000-000000234114';
select is((select reason from activate_support_account(pg_temp.tok(4006, '6'))), 'collision', 'activation refused after the pending account gained a phone');
select is((select count(*)::int from private.support_accounts where activated_at is not null and user_id in
           ('00000000-0000-0000-0000-000000234113', '00000000-0000-0000-0000-000000234114')), 0, 'neither collided account was activated');

-- ---- writer scan (retro 66) ------------------------------------------------------------------------------------
select is((select coalesce(array_agg(p.proname::text order by p.proname), '{}') from pg_proc p
            where p.prokind = 'f' and p.prosrc ~* '(insert\s+into|update|delete\s+from)\s+(only\s+)?private\.support_accounts\M'),
          array['activate_support_account', 'create_support_account', 'deactivate_support_account', 'remove_support_account', 'support_lock_account', 'unlock_support_account'], 'only the 23.4 and 23.5 functions write private.support_accounts');
select is((select coalesce(array_agg(p.proname::text order by p.proname), '{}') from pg_proc p
            where p.prokind = 'f' and p.prosrc ~* 'update\s+private\.support_accounts\s+set\s+activated_at\s*='),
          array['activate_support_account'], 'only the activation function sets support_accounts.activated_at');

select * from finish();
rollback;
