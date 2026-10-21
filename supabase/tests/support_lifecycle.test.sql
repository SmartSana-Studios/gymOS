-- Story 23.11: lifecycle of a support account: inactivity, recertification, factor reset, contact changes (migration 0145).
--   A. inactivity sweep (idle account disabled through the revocation routine; suspended gym excluded; job_runs; failure recorded)
--   B. recertification (due date set and audited at activation; the live gate denies after it; recertify at aal2 with a reason)
--   C. factor reset start (identity note, sessions ended, reset pending, e-mail with a hashed cancel token, frozen contact)
--   D. cancel (single use, inside the window only)
--   E. cooling-off end: cron marks due, executor claim, invite issue, done / failed, re-enrolment closes the reset
--   F. contact changes (Super Admin aal2 only, audited, refused during a reset) and the nightly drift check
--   G. restore of switch-suspended assignments after unlock / recertification (23-10 deferral)
--   H. catalog: limits, crons, privileges, scans
begin;
select plan(164);

create or replace function pg_temp.claims(uid text, app_role text, aal text, gym text default null, sid text default null) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"' || uid || '","role":"authenticated","aal":"' || aal || '"'
    || case when sid is null then '' else ',"session_id":"' || sid || '"' end
    || case when app_role is null then '' else ',"app_role":"' || app_role || '"' end
    || case when gym is null then '' else ',"gym_id":"' || gym || '"' end || '}', true);
end $f$;
create or replace function pg_temp.no_claims() returns void language sql as $f$ select set_config('request.jwt.claims', '{}', true) $f$;
create or replace function pg_temp.err(stmt text) returns text language plpgsql as $f$
begin execute stmt; return 'ok'; exception when others then return sqlstate || ':' || sqlerrm; end $f$;
create or replace function pg_temp.u(n int) returns text language sql as $f$ select '00000000-0000-0000-0000-' || lpad(to_hex(n), 12, '0') $f$;
create or replace function pg_temp.as_admin() returns void language sql as $f$
  select pg_temp.claims('00000000-0000-0000-0000-000000250103', 'super_admin', 'aal2', null, '00000000-0000-0000-0000-0000000250a9') $f$;
create or replace function pg_temp.as_admin_aal1() returns void language sql as $f$
  select pg_temp.claims('00000000-0000-0000-0000-000000250103', 'super_admin', 'aal1', null, '00000000-0000-0000-0000-0000000250a9') $f$;
create or replace function pg_temp.as_owner() returns void language sql as $f$
  select pg_temp.claims('00000000-0000-0000-0000-000000250102', 'owner', 'aal2', '00000000-0000-0000-0000-000000250001') $f$;
-- is the person live in the gym (the live gate, for the caller whose claims are set)
create or replace function pg_temp.live(uid text, gym text, sid text) returns boolean language plpgsql as $f$
begin
  perform pg_temp.claims(uid, 'support', 'aal2', gym, sid);
  return private.support_live(uid::uuid, gym::uuid);
end $f$;
create or replace function pg_temp.tok(n int, c text) returns text language sql as $f$
  select '00000000-0000-0000-0000-00000025' || lpad(n::text, 4, '0') || '.' || repeat(c, 64) $f$;

-- ---- fixtures ---------------------------------------------------------------------------------------------------
insert into tiers (id, name, monthly_price, annual_price, member_cap) values ('00000000-0000-0000-0000-000000250301', 'Life Tier', 5000, 50000, 30);
insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-000000250001', 'Life Gym A', '00000000-0000-0000-0000-000000250301', 30),
  ('00000000-0000-0000-0000-000000250002', 'Life Gym B', '00000000-0000-0000-0000-000000250301', 30),
  ('00000000-0000-0000-0000-000000250003', 'Life Gym C', '00000000-0000-0000-0000-000000250301', 30);
insert into gyms (id, name, tier_id, capacity, status) values
  ('00000000-0000-0000-0000-000000250004', 'Life Gym Suspended', '00000000-0000-0000-0000-000000250301', 30, 'suspended');
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000250101', 'p1-250@gymosapps.com', now()),
  ('00000000-0000-0000-0000-000000250102', 'ownerA-250@x.example', now()),
  ('00000000-0000-0000-0000-000000250103', 'admin-250@x.example', now()),
  ('00000000-0000-0000-0000-000000250105', 'ownerB-250@x.example', now()),
  ('00000000-0000-0000-0000-000000250107', 'p2-250@gymosapps.com', now()),
  ('00000000-0000-0000-0000-000000250108', 'p3-250@gymosapps.com', now()),
  ('00000000-0000-0000-0000-000000250109', 'p4-250@gymosapps.com', now()),
  ('00000000-0000-0000-0000-000000250110', 'p5-250@gymosapps.com', now()),
  ('00000000-0000-0000-0000-000000250111', 'p6-250@gymosapps.com', now()),
  ('00000000-0000-0000-0000-000000250112', 'p7-250@gymosapps.com', now()),
  ('00000000-0000-0000-0000-000000250113', 'p8-250@gymosapps.com', now()),
  ('00000000-0000-0000-0000-000000250114', 'p9-250@gymosapps.com', now()),
  ('00000000-0000-0000-0000-000000250115', 'p10-250@gymosapps.com', now()),
  ('00000000-0000-0000-0000-000000250116', 'p11-250@gymosapps.com', now()),
  ('00000000-0000-0000-0000-000000250117', 'p12-250@gymosapps.com', now()),
  ('00000000-0000-0000-0000-000000250118', 'taken-250@gymosapps.com', now());
update users set is_super_admin = true where id = '00000000-0000-0000-0000-000000250103';
insert into members (gym_id, user_id, role, name, phone) values
  ('00000000-0000-0000-0000-000000250001', '00000000-0000-0000-0000-000000250102', 'owner', 'Owner A 250', '+237600250001'),
  ('00000000-0000-0000-0000-000000250002', '00000000-0000-0000-0000-000000250105', 'owner', 'Owner B 250', '+237600250002');

-- accounts: idle ones were activated 40 days ago
insert into private.support_accounts (user_id, activated_at) values
  ('00000000-0000-0000-0000-000000250101', now()),
  ('00000000-0000-0000-0000-000000250107', now() - interval '40 days'),
  ('00000000-0000-0000-0000-000000250108', now() - interval '40 days'),
  ('00000000-0000-0000-0000-000000250109', now() - interval '40 days'),
  ('00000000-0000-0000-0000-000000250110', now()),
  ('00000000-0000-0000-0000-000000250111', now()),
  ('00000000-0000-0000-0000-000000250112', now()),
  ('00000000-0000-0000-0000-000000250113', now()),
  ('00000000-0000-0000-0000-000000250114', now() - interval '40 days'),
  ('00000000-0000-0000-0000-000000250115', now() - interval '40 days');
insert into private.support_accounts (user_id) values ('00000000-0000-0000-0000-000000250116'), ('00000000-0000-0000-0000-000000250117');
insert into public.support_assignments (id, support_user_id, gym_id, state, activated_at) values
  ('00000000-0000-0000-0000-000000250401', '00000000-0000-0000-0000-000000250101', '00000000-0000-0000-0000-000000250001', 'active', now()),
  ('00000000-0000-0000-0000-000000250402', '00000000-0000-0000-0000-000000250107', '00000000-0000-0000-0000-000000250002', 'active', now() - interval '40 days'),
  ('00000000-0000-0000-0000-000000250403', '00000000-0000-0000-0000-000000250108', '00000000-0000-0000-0000-000000250004', 'active', now() - interval '40 days'),
  ('00000000-0000-0000-0000-000000250404', '00000000-0000-0000-0000-000000250109', '00000000-0000-0000-0000-000000250002', 'active', now() - interval '40 days'),
  ('00000000-0000-0000-0000-000000250405', '00000000-0000-0000-0000-000000250110', '00000000-0000-0000-0000-000000250001', 'active', now()),
  ('00000000-0000-0000-0000-000000250406', '00000000-0000-0000-0000-000000250111', '00000000-0000-0000-0000-000000250001', 'active', now()),
  ('00000000-0000-0000-0000-000000250407', '00000000-0000-0000-0000-000000250112', '00000000-0000-0000-0000-000000250001', 'active', now()),
  ('00000000-0000-0000-0000-000000250408', '00000000-0000-0000-0000-000000250113', '00000000-0000-0000-0000-000000250003', 'active', now()),
  ('00000000-0000-0000-0000-000000250409', '00000000-0000-0000-0000-000000250114', '00000000-0000-0000-0000-000000250002', 'active', now() - interval '40 days');
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000250a1', '00000000-0000-0000-0000-000000250101', now(), now()),
  ('00000000-0000-0000-0000-0000000250a2', '00000000-0000-0000-0000-000000250107', now(), now()),
  ('00000000-0000-0000-0000-0000000250a5', '00000000-0000-0000-0000-000000250110', now(), now()),
  ('00000000-0000-0000-0000-0000000250a6', '00000000-0000-0000-0000-000000250111', now(), now()),
  ('00000000-0000-0000-0000-0000000250a7', '00000000-0000-0000-0000-000000250112', now(), now()),
  ('00000000-0000-0000-0000-0000000250a9', '00000000-0000-0000-0000-000000250103', now(), now());
insert into private.support_session_state (session_id, user_id, started_at, last_seen_at) values
  ('00000000-0000-0000-0000-0000000250a1', '00000000-0000-0000-0000-000000250101', now(), now()),
  ('00000000-0000-0000-0000-0000000250a2', '00000000-0000-0000-0000-000000250107', now(), now()),
  ('00000000-0000-0000-0000-0000000250a5', '00000000-0000-0000-0000-000000250110', now(), now()),
  ('00000000-0000-0000-0000-0000000250a6', '00000000-0000-0000-0000-000000250111', now(), now()),
  ('00000000-0000-0000-0000-0000000250a7', '00000000-0000-0000-0000-000000250112', now(), now());
select private.support_set_membership(id, true) from public.support_assignments where state = 'active' and gym_id <> '00000000-0000-0000-0000-000000250004';
-- the suspended gym's assignment is seeded directly (membership writer needs no gym status)
select private.support_set_membership('00000000-0000-0000-0000-000000250403', true);
-- P4 was active recently, P10 has no assignment at all
insert into private.support_last_active (user_id, last_active_at) values ('00000000-0000-0000-0000-000000250109', now() - interval '2 days');
-- verified factors for the accounts that will be reset
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000250f5', '00000000-0000-0000-0000-000000250110', 'old', 'totp', 'verified', now(), now()),
  ('00000000-0000-0000-0000-0000000250f6', '00000000-0000-0000-0000-000000250111', 'old', 'totp', 'verified', now(), now());
update private.platform_flags set enabled = true where flag = 'super_admin_aal2';

select count(*)::int as notices0 from staff_notices \gset
select count(*)::int as outbox0 from email_outbox \gset

-- ============================================================================================================
-- A. inactivity sweep
-- ============================================================================================================
select is((select recertify_due_at is not null from private.support_accounts where user_id = '00000000-0000-0000-0000-000000250101'), true, 'an account inserted with activated_at gets a recertification due date');
select is((select recorded_email from private.support_accounts where user_id = '00000000-0000-0000-0000-000000250101'), 'p1-250@gymosapps.com', 'an account records the e-mail on file when created');
-- failure: a step that raises is counted and recorded, the rest of the run continues (P9 fails on the first run, the rest are locked)
create function pg_temp.boom() returns trigger language plpgsql as $f$ begin raise exception 'boom'; end $f$;
create trigger zz_boom before update on private.support_accounts for each row when (new.user_id = '00000000-0000-0000-0000-000000250114') execute function pg_temp.boom();
select count(*)::int as jobs_f0 from job_runs where job_name = 'support_inactivity_sweep' and status = 'failure' \gset
select count(*)::int as jobs_s0 from job_runs where job_name = 'support_inactivity_sweep' and status = 'success' \gset
select count(*)::int as sa0 from staff_notices where notice_type = 'support_account_locked' \gset
select count(*)::int as ended0 from audit_log where action_type = 'gymos_support_access_ended' and gym_id = '00000000-0000-0000-0000-000000250002' \gset
select private.support_inactivity_sweep();
select is((select locked_reason from private.support_accounts where user_id = '00000000-0000-0000-0000-000000250107'), 'inactivity', 'idle: an account with no activity for 30 days is disabled (locked, reason inactivity)');
select is((select count(*)::int from private.support_session_state where user_id = '00000000-0000-0000-0000-000000250107') + (select count(*)::int from auth.sessions where user_id = '00000000-0000-0000-0000-000000250107'), 0, 'idle: its sessions are ended');
select is((select count(*)::int from audit_log where action_type = 'gymos_support_access_ended' and gym_id = '00000000-0000-0000-0000-000000250002') - :ended0 >= 1, true, 'idle: it went through the revocation routine (gym-scoped access-ended audit row)');
select is((select count(*)::int from staff_notices where notice_type = 'support_account_locked') - :sa0 >= 1, true, 'idle: Super Admin is told');
select is((select count(*)::int from staff_notices where notice_type = 'support_account_locked' and user_id = '00000000-0000-0000-0000-000000250103' and body_en like '%no activity%') >= 1, true, 'idle: the notice says why');
select is((select count(*)::int from audit_log where action_type = 'support_account_locked' and target_entity_id = '00000000-0000-0000-0000-000000250107' and metadata ->> 'reason' = 'inactivity'), 1, 'idle: the disabling is audited with its reason');
select is((select count(*)::int from staff_notices where notice_type = 'support_access_ended' and user_id = '00000000-0000-0000-0000-000000250105'), 0, 'idle: the Owner notice is sent only when something is pending (none here); it names no individual either way');
select is((select count(*)::int from job_runs where job_name = 'support_inactivity_sweep' and status = 'failure') - :jobs_f0, 1, 'sweep: a failing account records a job_runs failure row');
select is((select locked_at is null from private.support_accounts where user_id = '00000000-0000-0000-0000-000000250114'), true, 'and that account was not locked (the step rolled back) while the others were');
drop trigger zz_boom on private.support_accounts;
select private.support_inactivity_sweep();
select is((select locked_reason from private.support_accounts where user_id = '00000000-0000-0000-0000-000000250114'), 'inactivity', 'the next run disables it');
select is((select count(*)::int from job_runs where job_name = 'support_inactivity_sweep' and status = 'success') - :jobs_s0, 1, 'sweep: a clean run writes a job_runs success row');
select is((select locked_at is null from private.support_accounts where user_id = '00000000-0000-0000-0000-000000250108'), true, 'idle gym suspended: its support is not disabled');
select is((select locked_at is null from private.support_accounts where user_id = '00000000-0000-0000-0000-000000250109'), true, 'recent activity (2 days ago): not disabled');
select is((select locked_at is null from private.support_accounts where user_id = '00000000-0000-0000-0000-000000250115'), true, 'idle with no assignment at all: nothing to disable');
select is((select locked_at is null from private.support_accounts where user_id = '00000000-0000-0000-0000-000000250101'), true, 'a freshly activated account is not disabled');
select is((select locked_at is null from private.support_accounts where user_id = '00000000-0000-0000-0000-000000250116'), true, 'a never-activated account is not touched');

-- activity written by the gate resets the clock (no touch within 5 minutes overwrites it)
select private.session_gate_touch('00000000-0000-0000-0000-000000250101', '00000000-0000-0000-0000-0000000250a1');
select is((select last_active_at > now() - interval '1 minute' from private.support_last_active where user_id = '00000000-0000-0000-0000-000000250101'), true, 'the gate records the last activity of a support person');
update private.support_last_active set last_active_at = now() - interval '1 minute' where user_id = '00000000-0000-0000-0000-000000250101';
select private.session_gate_touch('00000000-0000-0000-0000-000000250101', '00000000-0000-0000-0000-0000000250a1');
select is((select last_active_at < now() - interval '30 seconds' from private.support_last_active where user_id = '00000000-0000-0000-0000-000000250101'), true, 'and writes at most once every 5 minutes');

-- ============================================================================================================
-- B. recertification
-- ============================================================================================================
select is(pg_temp.live('00000000-0000-0000-0000-000000250101', '00000000-0000-0000-0000-000000250001', '00000000-0000-0000-0000-0000000250a1'), true, 'recertification: before the due date the person is live');
update private.support_accounts set recertify_due_at = now() - interval '1 minute' where user_id = '00000000-0000-0000-0000-000000250101';
select is(pg_temp.live('00000000-0000-0000-0000-000000250101', '00000000-0000-0000-0000-000000250001', '00000000-0000-0000-0000-0000000250a1'), false, 'recertification: after the due date the live gate denies (shown failing before the fix)');
select pg_temp.no_claims();
-- a missing due date is denied too (fail closed)
alter table private.support_accounts disable trigger support_accounts_defaults;
update private.support_accounts set recertify_due_at = null where user_id = '00000000-0000-0000-0000-000000250101';
alter table private.support_accounts enable trigger support_accounts_defaults;
select is(pg_temp.live('00000000-0000-0000-0000-000000250101', '00000000-0000-0000-0000-000000250001', '00000000-0000-0000-0000-0000000250a1'), false, 'recertification: no due date at all is denied');
select pg_temp.no_claims();

-- the guard rails
set local role authenticated;
select pg_temp.as_owner();
select throws_ok($$select * from recertify_support_account('00000000-0000-0000-0000-000000250101', 'quarterly review')$$, 'P0001', 'permission denied', 'recertify: an Owner is refused');
select pg_temp.as_admin_aal1();
select throws_ok($$select * from recertify_support_account('00000000-0000-0000-0000-000000250101', 'quarterly review')$$, 'P0001', 'permission denied', 'recertify: a Super Admin at aal1 is refused');
select pg_temp.as_admin();
select is((select code from recertify_support_account('00000000-0000-0000-0000-000000250101', '  ')), 'reason_invalid', 'recertify: a reason is mandatory');
select is((select code from recertify_support_account('00000000-0000-0000-0000-000000250116', 'quarterly review')), 'not_activated', 'recertify: a never-activated account has nothing to recertify');
select is((select code from recertify_support_account('00000000-0000-0000-0000-0000000250ff', 'quarterly review')), 'not_found', 'recertify: an unknown account');
select is((select code from recertify_support_account('00000000-0000-0000-0000-000000250101', 'quarterly review done 2026-Q4')), 'recertified', 'recertify: Super Admin at aal2 with a reason recertifies');
reset role;
select pg_temp.no_claims();
select is((select recertify_due_at between now() + interval '89 days' and now() + interval '91 days' from private.support_accounts where user_id = '00000000-0000-0000-0000-000000250101'), true, 'recertify: the new due date is 90 days out');
select is((select count(*)::int from audit_log where action_type = 'support_account_recertified' and target_entity_id = '00000000-0000-0000-0000-000000250101'
            and actor_id = '00000000-0000-0000-0000-000000250103' and metadata ->> 'reason' = 'quarterly review done 2026-Q4' and metadata ? 'previous_due_at' and metadata ? 'new_due_at'), 1, 'recertify: audited under the Super Admin with reason and both dates');
select is(pg_temp.live('00000000-0000-0000-0000-000000250101', '00000000-0000-0000-0000-000000250001', '00000000-0000-0000-0000-0000000250a1'), true, 'recertify: the person is live again');
select pg_temp.no_claims();

-- the due date is set and audited at activation (the real invite path)
select issue_support_invite('00000000-0000-0000-0000-000000250117', pg_temp.tok(5001, 'a'), '00000000-0000-0000-0000-000000250103');
select support_invite_mark_password_set(pg_temp.tok(5001, 'a'));
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
values ('00000000-0000-0000-0000-0000000250f7', '00000000-0000-0000-0000-000000250117', 'new', 'totp', 'verified', now(), now());
select is((select reason from activate_support_account(pg_temp.tok(5001, 'a'))), 'ok', 'activation: a first activation still works');
select is((select recertify_due_at between now() + interval '89 days' and now() + interval '91 days' from private.support_accounts where user_id = '00000000-0000-0000-0000-000000250117'), true, 'activation: the due date starts at activation (90 days)');
select is((select count(*)::int from audit_log where action_type = 'support_recertification_due_set' and target_entity_id = '00000000-0000-0000-0000-000000250117' and metadata ? 'recertify_due_at'), 1, 'activation: the due date is audited');

-- ============================================================================================================
-- C. factor reset: start
-- ============================================================================================================
set local role authenticated;
select pg_temp.as_owner();
select throws_ok($$select * from start_support_factor_reset('00000000-0000-0000-0000-000000250110', 'seen ID card and called back', repeat('a', 40), 'https://x.example/c?t=' || repeat('a', 40))$$, 'P0001', 'permission denied', 'reset: an Owner is refused');
select pg_temp.as_admin_aal1();
select throws_ok($$select * from start_support_factor_reset('00000000-0000-0000-0000-000000250110', 'seen ID card and called back', repeat('a', 40), 'https://x.example/c?t=' || repeat('a', 40))$$, 'P0001', 'permission denied', 'reset: a Super Admin at aal1 is refused');
select pg_temp.as_admin();
select is((select code from start_support_factor_reset('00000000-0000-0000-0000-000000250110', ' ', repeat('a', 40), 'https://x.example/c?t=' || repeat('a', 40))), 'reason_invalid', 'reset: the identity-check note is mandatory');
select is((select code from start_support_factor_reset('00000000-0000-0000-0000-000000250110', 'seen ID card and called back', 'short', 'https://x.example/c?t=short')), 'invalid_request', 'reset: a weak cancel token is refused');
select is((select code from start_support_factor_reset('00000000-0000-0000-0000-000000250110', 'seen ID card and called back', repeat('a', 40), 'https://x.example/c?t=other')), 'invalid_request', 'reset: the link must carry the token');
select is((select code from start_support_factor_reset('00000000-0000-0000-0000-000000250116', 'seen ID card and called back', repeat('a', 40), 'https://x.example/c?t=' || repeat('a', 40))), 'not_activated', 'reset: a never-activated account has no factor to reset');
select is((select code from start_support_factor_reset('00000000-0000-0000-0000-0000000250ff', 'seen ID card and called back', repeat('a', 40), 'https://x.example/c?t=' || repeat('a', 40))), 'not_found', 'reset: unknown account');
select is((select code from start_support_factor_reset('00000000-0000-0000-0000-000000250110', 'seen ID card and called back', repeat('a', 40), 'https://x.example/c?t=' || repeat('a', 40))), 'started', 'reset: Super Admin at aal2 with an identity note starts it');
select is((select code from start_support_factor_reset('00000000-0000-0000-0000-000000250110', 'second try after the first', repeat('b', 40), 'https://x.example/c?t=' || repeat('b', 40))), 'already_pending', 'reset: a second reset while one is pending is refused');
select is((select code from start_support_factor_reset('00000000-0000-0000-0000-000000250111', 'seen ID card and called back', repeat('c', 40), 'https://x.example/c?t=' || repeat('c', 40))), 'started', 'reset: a second person (cancel flow) is started');
reset role;
select pg_temp.no_claims();
select is((select reset_pending_at is not null from private.support_accounts where user_id = '00000000-0000-0000-0000-000000250110'), true, 'reset: the account is reset-pending at once');
select is((select count(*)::int from auth.sessions where user_id = '00000000-0000-0000-0000-000000250110') + (select count(*)::int from private.support_session_state where user_id = '00000000-0000-0000-0000-000000250110'), 0, 'reset: the person''s sessions are invalidated');
select is((select executes_at between now() + interval '29 minutes' and now() + interval '31 minutes' from private.support_factor_resets where user_id = '00000000-0000-0000-0000-000000250110'), true, 'reset: the cooling-off is 30 minutes');
select is((select cancel_token_hash <> repeat('a', 40) and cancel_token_hash = encode(extensions.digest(repeat('a', 40), 'sha256'), 'hex') from private.support_factor_resets where user_id = '00000000-0000-0000-0000-000000250110'), true, 'reset: only the hash of the cancel token is stored');
select is((select count(*)::int from audit_log where metadata::text like '%' || repeat('a', 40) || '%'), 0, 'reset: the token appears in no audit row');
select is((select count(*)::int from audit_log where action_type = 'support_factor_reset_started' and target_entity_id = '00000000-0000-0000-0000-000000250110' and actor_id = '00000000-0000-0000-0000-000000250103' and gym_id is null
            and metadata ->> 'identity_check' = 'seen ID card and called back'), 1, 'reset: audited under the Super Admin with the identity-check note');
select is((select count(*)::int from audit_log where action_type = 'gymos_support_access_ended' and metadata ->> 'cause' = 'reset' and gym_id = '00000000-0000-0000-0000-000000250001'), 2, 'reset: access ended through the revocation routine in each gym (cause reset)');
select is((select count(*)::int from email_outbox where recipient_email = 'p5-250@gymosapps.com' and body like '%t=' || repeat('a', 40) || '%' and body like '%Phone and e-mail changes are frozen%' and body like '%gelés%') - 0, 1, 'reset: the person is e-mailed at the address on file, EN and FR, with the cancel link');
select is((select count(*)::int from email_outbox where body like '%No earlier than%' and body like '%Pas avant%' and body not like '%At %UTC your current%'), 2, 'reset: the e-mail promises no earlier time, not an exact one (EN and FR)');
select is((select count(*)::int from email_outbox where subject like 'GymOS support: authenticator reset%' and recipient_email like '%@gymosapps.com'), 2, 'reset: one e-mail per person, to the address on file (no phone channel exists)');
select is(pg_temp.live('00000000-0000-0000-0000-000000250110', '00000000-0000-0000-0000-000000250001', '00000000-0000-0000-0000-0000000250a5'), false, 'reset: the live gate denies a reset-pending account (and a fresh session row does not help)');
select pg_temp.no_claims();
select is((select count(*)::int from staff_notices where notice_type = 'support_access_ended' and user_id = '00000000-0000-0000-0000-000000250102' and body_en not like '%' || 'p5-250' || '%'), (select count(*)::int from staff_notices where notice_type = 'support_access_ended' and user_id = '00000000-0000-0000-0000-000000250102'), 'reset: an Owner notice, if any, names no individual');

-- ============================================================================================================
-- D. cancel
-- ============================================================================================================
select is((select ok from cancel_support_factor_reset('nope')), false, 'cancel: a short token is refused');
select is((select ok from cancel_support_factor_reset(repeat('z', 40))), false, 'cancel: an unknown token is refused');
select count(*)::int as cn0 from staff_notices where notice_type = 'support_factor_reset_cancelled' \gset
select is((select ok from cancel_support_factor_reset(repeat('c', 40))), true, 'cancel: the person cancels inside the window with the link token');
select is((select state from private.support_factor_resets where user_id = '00000000-0000-0000-0000-000000250111'), 'cancelled', 'cancel: the reset is abandoned');
select is((select reset_pending_at is null from private.support_accounts where user_id = '00000000-0000-0000-0000-000000250111'), true, 'cancel: the account is no longer reset-pending');
select is((select count(*)::int from auth.sessions where user_id = '00000000-0000-0000-0000-000000250111'), 0, 'cancel: the sessions stay revoked');
select is((select count(*)::int from staff_notices where notice_type = 'support_factor_reset_cancelled') - :cn0 >= 1, true, 'cancel: Super Admin is alerted');
select is((select count(*)::int from audit_log where action_type = 'support_factor_reset_cancelled' and target_entity_id = '00000000-0000-0000-0000-000000250111' and metadata ->> 'by' = 'email_link'), 1, 'cancel: audited');
select is((select ok from cancel_support_factor_reset(repeat('c', 40))), false, 'cancel: the token is single use');
select is((select count(*)::int from private.support_factor_resets where user_id = '00000000-0000-0000-0000-000000250111' and state = 'cancelled'), 1, 'cancel: a refused reuse changed nothing');
select is((select count(*)::int from auth.mfa_factors where user_id = '00000000-0000-0000-0000-000000250111'), 1, 'cancel: the factor is untouched');
-- expired: a window that has ended refuses the link even before the cron marks it due
update private.support_factor_resets set executes_at = now() - interval '1 minute' where user_id = '00000000-0000-0000-0000-000000250110';
select is((select ok from cancel_support_factor_reset(repeat('a', 40))), false, 'cancel: after the cooling-off ended the link is refused (expired)');
select is((select state from private.support_factor_resets where user_id = '00000000-0000-0000-0000-000000250110'), 'cooling_off', 'cancel: an expired link changed nothing');

-- ============================================================================================================
-- E. cooling-off ends: due, claim, invite, done / failed, re-enrolment
-- ============================================================================================================
select count(*)::int as jd0 from job_runs where job_name = 'support_factor_reset_due' \gset
select private.support_factor_reset_mark_due();
select is((select state from private.support_factor_resets where user_id = '00000000-0000-0000-0000-000000250110'), 'due', 'executor: the cron marks a reset whose cooling-off ended');
select is((select count(*)::int from job_runs where job_name = 'support_factor_reset_due' and status = 'success') - :jd0, 1, 'executor: the marking cron writes job_runs');
select is((select state from private.support_factor_resets where user_id = '00000000-0000-0000-0000-000000250111'), 'cancelled', 'executor: a cancelled reset is not marked');
select is(pg_temp.err($$select issue_support_invite('00000000-0000-0000-0000-000000250110', pg_temp.tok(5002, 'b'), '00000000-0000-0000-0000-000000250103')$$), 'P0001:support_invite_refused', 'invite: an activated account cannot be invited before its reset executed');
select is((select count(*)::int from claim_support_factor_resets(10)), 0, 'executor: a due reset whose cancel e-mail has not been delivered is not claimed');
select is((select o.status from email_outbox o join private.support_factor_resets f on f.outbox_id = o.id where f.user_id = '00000000-0000-0000-0000-000000250110'), 'pending', 'executor: the reset is linked to its outbox row');
update email_outbox set status = 'sent', sent_at = now() where id = (select outbox_id from private.support_factor_resets where user_id = '00000000-0000-0000-0000-000000250110');
select is((select count(*)::int from claim_support_factor_resets(10)), 1, 'executor: a due reset whose cancel e-mail was sent is claimed');
select is((select count(*)::int from claim_support_factor_resets(10)), 0, 'executor: and not claimed twice');
select is((select state || '/' || attempts from private.support_factor_resets where user_id = '00000000-0000-0000-0000-000000250110'), 'executing/1', 'executor: claimed means executing, attempt 1');
select is(pg_temp.err($$select public.support_factor_reset_failed((select id from private.support_factor_resets where user_id = '00000000-0000-0000-0000-000000250110'), 'mail_failed')$$), 'ok', 'executor: a failed run is handed back');
select is((select state from private.support_factor_resets where user_id = '00000000-0000-0000-0000-000000250110'), 'due', 'executor: a failure is retried (back to due)');
select is((select count(*)::int from claim_support_factor_resets(10)), 1, 'executor: the retry claims it again');
select is((select attempts from private.support_factor_resets where user_id = '00000000-0000-0000-0000-000000250110'), 2, 'executor: attempt 2');
select is(pg_temp.err($$select issue_support_reset_invite((select id from private.support_factor_resets where user_id = '00000000-0000-0000-0000-000000250110'), 'bad')$$), 'P0001:support_invite_refused', 'invite: a malformed token cannot be stored');
select is(pg_temp.err($$select issue_support_reset_invite('00000000-0000-0000-0000-0000000250fe', pg_temp.tok(5003, 'c'))$$), 'P0001:support_invite_refused', 'invite: an unknown reset gets none');
select is(pg_temp.err($$select issue_support_reset_invite((select id from private.support_factor_resets where user_id = '00000000-0000-0000-0000-000000250110'), pg_temp.tok(5003, 'c'))$$), 'ok', 'invite: the executor issues a single-use invite for the reset');
select is((select token_hash = encode(extensions.digest(pg_temp.tok(5003, 'c'), 'sha256'), 'hex') and token_hash <> pg_temp.tok(5003, 'c') and expires_at < now() + interval '25 hours'
           from private.support_invites where id = '00000000-0000-0000-0000-000000255003'), true, 'invite: stored hashed with a 24 hour life');
select is((select created_by from private.support_invites where id = '00000000-0000-0000-0000-000000255003'), '00000000-0000-0000-0000-000000250103'::uuid, 'invite: attributed to the Super Admin who started the reset');
select is(pg_temp.err($$select issue_support_reset_invite((select id from private.support_factor_resets where user_id = '00000000-0000-0000-0000-000000250110'), pg_temp.tok(5004, 'd'))$$), 'ok', 'invite: a retry issues a new one');
select is((select count(*)::int from private.support_invites where user_id = '00000000-0000-0000-0000-000000250110' and consumed_at is null and superseded_at is null), 1, 'invite: and supersedes the earlier one, so one link is live');
-- the app removes the factor through the Admin API; here the old factor is gone and the executor reports back
delete from auth.mfa_factors where user_id = '00000000-0000-0000-0000-000000250110';
select is(public.support_factor_reset_done((select id from private.support_factor_resets where user_id = '00000000-0000-0000-0000-000000250110'), 1), true, 'executor: done after the factor is removed and the invite sent');
select is((select state from private.support_factor_resets where user_id = '00000000-0000-0000-0000-000000250110'), 'executed', 'executor: executed');
select is((select count(*)::int from audit_log where action_type = 'support_factor_reset_executed' and target_entity_id = '00000000-0000-0000-0000-000000250110' and (metadata ->> 'factors_removed')::int = 1), 1, 'executor: audited (count only)');
select is((select reset_pending_at is not null from private.support_accounts where user_id = '00000000-0000-0000-0000-000000250110'), true, 'executed: the account stays reset-pending until the new factor is verified');
select is(pg_temp.live('00000000-0000-0000-0000-000000250110', '00000000-0000-0000-0000-000000250001', '00000000-0000-0000-0000-0000000250a5'), false, 'executed: still no access (first-factor window closed by reset_pending)');
select pg_temp.no_claims();
select count(*)::int as jx0 from job_runs where job_name = 'support_factor_reset_executor' and status = 'failure' \gset
select public.record_support_factor_reset_run(1, 1, now());
select is((select count(*)::int from job_runs where job_name = 'support_factor_reset_executor' and status = 'failure') - :jx0, 1, 'executor: a run with a failure writes a job_runs failure row');
select public.record_support_factor_reset_run(1, 0, now());
select is((select count(*)::int from job_runs where job_name = 'support_factor_reset_executor' and status = 'success'), 1, 'executor: a clean run writes a success row');

-- re-enrolment
select is((select ok from support_invite_inspect(pg_temp.tok(5003, 'c'))), false, 'invite: the superseded link is dead');
select is((select step from support_invite_inspect(pg_temp.tok(5004, 'd'))), 'password', 'invite: the live reset link opens at the password step although the account was activated');
select is((select reason from activate_support_account(pg_temp.tok(5004, 'd'))), 'password_not_set', 'activation after reset: refused until the password is set');
select support_invite_mark_password_set(pg_temp.tok(5004, 'd'));
select is((select reason from activate_support_account(pg_temp.tok(5004, 'd'))), 'no_verified_factor', 'activation after reset: refused without a verified NEW factor (reset stays pending)');
select is((select reset_pending_at is not null from private.support_accounts where user_id = '00000000-0000-0000-0000-000000250110'), true, 'activation after reset: a refusal leaves the account reset-pending');
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
values ('00000000-0000-0000-0000-0000000250f8', '00000000-0000-0000-0000-000000250110', 'new', 'totp', 'verified', now(), now());
select is((select reason from activate_support_account(pg_temp.tok(5004, 'd'))), 'ok', 'activation after reset: the verified new factor closes the reset');
select is((select reset_pending_at is null from private.support_accounts where user_id = '00000000-0000-0000-0000-000000250110'), true, 'activation after reset: reset_pending_at cleared');
select is((select completed_at is not null from private.support_factor_resets where user_id = '00000000-0000-0000-0000-000000250110'), true, 'activation after reset: the reset record is closed');
select is((select count(*)::int from audit_log where action_type = 'support_factor_reset_completed' and target_entity_id = '00000000-0000-0000-0000-000000250110'), 1, 'activation after reset: audited');
select is((select reason from activate_support_account(pg_temp.tok(5004, 'd'))), 'invalid', 'activation after reset: the invite is single use');
select is(pg_temp.live('00000000-0000-0000-0000-000000250110', '00000000-0000-0000-0000-000000250001', '00000000-0000-0000-0000-0000000250a5'), false, 'after re-enrolment the old session (ended) does not give access');
select pg_temp.no_claims();
insert into auth.sessions (id, user_id, created_at, updated_at) values ('00000000-0000-0000-0000-0000000250b5', '00000000-0000-0000-0000-000000250110', now(), now());
insert into private.support_session_state (session_id, user_id, started_at, last_seen_at) values ('00000000-0000-0000-0000-0000000250b5', '00000000-0000-0000-0000-000000250110', now(), now());
select is(pg_temp.live('00000000-0000-0000-0000-000000250110', '00000000-0000-0000-0000-000000250001', '00000000-0000-0000-0000-0000000250b5'), true, 'after re-enrolment a new session is live (access only after the new factor)');
select pg_temp.no_claims();
-- a reset whose account was deactivated meanwhile is cancelled, not executed
select pg_temp.as_admin();
set local role authenticated;
select start_support_factor_reset('00000000-0000-0000-0000-000000250111', 'second reset after cancelled first', repeat('d', 40), 'https://x.example/?t=' || repeat('d', 40));
reset role;
select pg_temp.no_claims();
update private.support_factor_resets set executes_at = now() - interval '1 minute' where user_id = '00000000-0000-0000-0000-000000250111' and state = 'cooling_off';
select private.support_factor_reset_mark_due();
update private.support_accounts set deactivated_at = now() where user_id = '00000000-0000-0000-0000-000000250111';
select is((select count(*)::int from claim_support_factor_resets(10)), 0, 'executor: a reset for a deactivated account is not claimed');
select is((select state || '/' || last_error from private.support_factor_resets where user_id = '00000000-0000-0000-0000-000000250111' and state <> 'cancelled' or (user_id = '00000000-0000-0000-0000-000000250111' and last_error is not null)), 'cancelled/account_not_pending', 'executor: it is cancelled instead');
update private.support_accounts set deactivated_at = null where user_id = '00000000-0000-0000-0000-000000250111';

-- stale claims: an executing row claimed more than 10 minutes ago is taken again, a fresh one is not
insert into email_outbox (id, recipient_email, subject, body, status, sent_at) values ('00000000-0000-0000-0000-0000000250e1', 'x@x.example', 's', 'b', 'sent', now());
update private.support_accounts set reset_pending_at = now() where user_id in ('00000000-0000-0000-0000-000000250111', '00000000-0000-0000-0000-000000250101');
insert into private.support_factor_resets (user_id, started_by, executes_at, cancel_token_hash, outbox_id, identity_note, state, claimed_at) values
  ('00000000-0000-0000-0000-000000250111', '00000000-0000-0000-0000-000000250103', now() - interval '1 hour', 'h-stale', '00000000-0000-0000-0000-0000000250e1', 'stale claim', 'executing', now() - interval '11 minutes'),
  ('00000000-0000-0000-0000-000000250101', '00000000-0000-0000-0000-000000250103', now() - interval '1 hour', 'h-fresh', '00000000-0000-0000-0000-0000000250e1', 'fresh claim', 'executing', now() - interval '2 minutes');
select is((select string_agg(user_id::text, ',') from claim_support_factor_resets(10)), '00000000-0000-0000-0000-000000250111', 'executor: a claim older than 10 minutes is taken again; a fresh one is not');
delete from private.support_factor_resets where cancel_token_hash in ('h-stale', 'h-fresh');
update private.support_accounts set reset_pending_at = null where user_id in ('00000000-0000-0000-0000-000000250111', '00000000-0000-0000-0000-000000250101');

-- ============================================================================================================
-- F. contact changes and drift
-- ============================================================================================================
set local role authenticated;
select pg_temp.as_owner();
select throws_ok($$select * from change_support_contact('00000000-0000-0000-0000-000000250112', 'new-p7-250@gymosapps.com', null, 'name change')$$, 'P0001', 'permission denied', 'contact: an Owner cannot change it');
select pg_temp.as_admin_aal1();
select throws_ok($$select * from change_support_contact('00000000-0000-0000-0000-000000250112', 'new-p7-250@gymosapps.com', null, 'name change')$$, 'P0001', 'permission denied', 'contact: a Super Admin at aal1 cannot change it');
select pg_temp.as_admin();
select is((select code from change_support_contact('00000000-0000-0000-0000-000000250112', 'new-p7-250@gymosapps.com', null, '')), 'reason_invalid', 'contact: a reason is mandatory');
select is((select code from change_support_contact('00000000-0000-0000-0000-000000250112', 'new-p7-250@gymosapps.com', '+237600250777', 'adding a phone')), 'phone_not_allowed', 'contact: a support account keeps no phone (typed error)');
select is((select code from change_support_contact('00000000-0000-0000-0000-000000250112', 'someone@x.example', null, 'wrong domain')), 'email_invalid', 'contact: only a GymOS address');
select is((select code from change_support_contact('00000000-0000-0000-0000-000000250112', 'taken-250@gymosapps.com', null, 'taken address')), 'collision', 'contact: an address in use is refused');
select is((select code from change_support_contact('00000000-0000-0000-0000-000000250112', 'p7-250@gymosapps.com', null, 'same address')), 'unchanged', 'contact: no change');
select is((select code || '/' || previous_email from change_support_contact('00000000-0000-0000-0000-000000250112', 'new-p7-250@gymosapps.com', null, 'name change 2026-10')), 'changed/p7-250@gymosapps.com', 'contact: Super Admin at aal2 changes it with a reason');
reset role;
select pg_temp.no_claims();
select is((select recorded_email from private.support_accounts where user_id = '00000000-0000-0000-0000-000000250112'), 'new-p7-250@gymosapps.com', 'contact: the new address is recorded');
select is((select count(*)::int from audit_log where action_type = 'support_contact_changed' and target_entity_id = '00000000-0000-0000-0000-000000250112' and actor_id = '00000000-0000-0000-0000-000000250103' and metadata ->> 'reason' = 'name change 2026-10' and gym_id is null), 1, 'contact: audited under the Super Admin (not visible to an Owner)');
select is((select count(*)::int from audit_log where action_type = 'support_contact_change_refused' and target_entity_id = '00000000-0000-0000-0000-000000250112'), 4, 'contact: each refusal is audited');
-- during the cooling-off the change is refused
select pg_temp.as_admin();
set local role authenticated;
select start_support_factor_reset('00000000-0000-0000-0000-000000250112', 'identity checked by video call', repeat('e', 40), 'https://x.example/?t=' || repeat('e', 40));
select is((select code from change_support_contact('00000000-0000-0000-0000-000000250112', 'again-p7-250@gymosapps.com', null, 'change during reset')), 'reset_in_progress', 'contact: refused during the cooling-off (typed error)');
reset role;
select pg_temp.no_claims();
select is((select recorded_email from private.support_accounts where user_id = '00000000-0000-0000-0000-000000250112'), 'new-p7-250@gymosapps.com', 'contact: the refusal changed nothing');
-- cancel it again, then drift
update private.support_factor_resets set state = 'cancelled', cancelled_at = now() where user_id = '00000000-0000-0000-0000-000000250112';
update private.support_accounts set reset_pending_at = null where user_id = '00000000-0000-0000-0000-000000250112';
select count(*)::int as jc0 from job_runs where job_name = 'support_contact_drift_check' and status = 'success' \gset
-- the recorded address is the new one but auth still holds the old one: drift
select private.support_contact_drift_check();
select is((select locked_reason from private.support_accounts where user_id = '00000000-0000-0000-0000-000000250112'), 'contact_drift', 'drift: an account whose auth e-mail differs from the recorded one is locked');
select is((select count(*)::int from job_runs where job_name = 'support_contact_drift_check' and status = 'success') - :jc0, 1, 'drift: the check writes job_runs');
select is((select count(*)::int from staff_notices where notice_type = 'support_account_locked' and user_id = '00000000-0000-0000-0000-000000250103' and body_en like '%e-mail or phone changed%'), 1, 'drift: Super Admin is told');
select pg_temp.as_admin();
set local role authenticated;
select is((select code from unlock_support_account('00000000-0000-0000-0000-000000250112', 'drift looked into')), 'contact_drift', 'drift: unlock is refused while the drift persists');
reset role;
select pg_temp.no_claims();
-- the Super Admin applies the recorded address to auth (as the app does after an ok), then unlocks
update auth.users set email = 'new-p7-250@gymosapps.com' where id = '00000000-0000-0000-0000-000000250112';
select pg_temp.as_admin();
set local role authenticated;
select is((select code from unlock_support_account('00000000-0000-0000-0000-000000250112', 'address applied and checked')), 'unlocked', 'drift: unlock works once auth matches the record');
reset role;
select pg_temp.no_claims();
-- a phone appearing on the auth user is drift too
update auth.users set phone = '237600250888' where id = '00000000-0000-0000-0000-000000250112';
select private.support_contact_drift_check();
select is((select locked_reason from private.support_accounts where user_id = '00000000-0000-0000-0000-000000250112'), 'contact_drift', 'drift: a phone on a support account locks it');
update auth.users set phone = null where id = '00000000-0000-0000-0000-000000250112';

-- ============================================================================================================
-- G. restore of switch-suspended assignments (23-10 deferral)
-- ============================================================================================================
-- P8: locked while the Owner turns the switch off and on: the assignment stays suspended; unlock restores it
update private.support_accounts set locked_at = now(), locked_reason = 'velocity_gym' where user_id = '00000000-0000-0000-0000-000000250113';
update public.support_assignments set state = 'suspended', suspended_by_switch = true where id = '00000000-0000-0000-0000-000000250408';
select private.support_set_membership('00000000-0000-0000-0000-000000250408', false);
select is((select state from public.support_assignments where id = '00000000-0000-0000-0000-000000250408'), 'suspended', 'restore: a switch-suspended assignment of a locked account is not restored by the Owner turning the switch on');
select pg_temp.as_admin();
set local role authenticated;
select is((select code from unlock_support_account('00000000-0000-0000-0000-000000250113', 'checked with the person')), 'unlocked', 'restore: unlock');
reset role;
select pg_temp.no_claims();
select is((select state from public.support_assignments where id = '00000000-0000-0000-0000-000000250408'), 'active', 'restore: unlock restores the switch-suspended assignment');
select is((select count(*)::int from members where user_id = '00000000-0000-0000-0000-000000250113' and gym_id = '00000000-0000-0000-0000-000000250003' and role = 'support' and deactivated_at is null), 1, 'restore: and its support membership');
select is((select (metadata ->> 'assignments_restored')::int from audit_log where action_type = 'support_account_unlocked' and target_entity_id = '00000000-0000-0000-0000-000000250113'), 1, 'restore: the unlock audit row counts it');
select is((select last_active_at > now() - interval '1 minute' from private.support_last_active where user_id = '00000000-0000-0000-0000-000000250113'), true, 'unlock restarts the idle clock');
-- recertify restores a suspended assignment of a lapsed account
update private.support_accounts set recertify_due_at = now() - interval '1 day' where user_id = '00000000-0000-0000-0000-000000250113';
update public.support_assignments set state = 'suspended', suspended_by_switch = true where id = '00000000-0000-0000-0000-000000250408';
select private.support_set_membership('00000000-0000-0000-0000-000000250408', false);
select is(private.support_restore_assignments('00000000-0000-0000-0000-000000250113'), 0, 'restore: a lapsed account is not restored');
select pg_temp.as_admin();
set local role authenticated;
select is((select code from recertify_support_account('00000000-0000-0000-0000-000000250113', 'quarterly review done')), 'recertified', 'restore: recertify');
reset role;
select pg_temp.no_claims();
select is((select state from public.support_assignments where id = '00000000-0000-0000-0000-000000250408'), 'active', 'restore: recertification restores the switch-suspended assignment');
-- a person with another membership in the gym is not restored
update public.support_assignments set state = 'suspended', suspended_by_switch = true where id = '00000000-0000-0000-0000-000000250408';
select private.support_set_membership('00000000-0000-0000-0000-000000250408', false);
insert into members (gym_id, user_id, role, name, phone) values ('00000000-0000-0000-0000-000000250003', '00000000-0000-0000-0000-000000250113', 'coach', 'Coach P8', '+237600250913');
select is(private.support_restore_assignments('00000000-0000-0000-0000-000000250113'), 0, 'restore: a person who gained another membership there stays suspended');
delete from members where user_id = '00000000-0000-0000-0000-000000250113' and role = 'coach';
select is(private.support_restore_assignments('00000000-0000-0000-0000-000000250113'), 1, 'restore: once that is gone it is restored');

-- restored access restarts the idle clock (helper and the switch-on path)
update private.support_last_active set last_active_at = now() - interval '40 days' where user_id = '00000000-0000-0000-0000-000000250113';
update public.support_assignments set state = 'suspended', suspended_by_switch = true where id = '00000000-0000-0000-0000-000000250408';
select private.support_set_membership('00000000-0000-0000-0000-000000250408', false);
select private.support_restore_assignments('00000000-0000-0000-0000-000000250113');
select is((select last_active_at > now() - interval '1 minute' from private.support_last_active where user_id = '00000000-0000-0000-0000-000000250113'), true, 'restore: restoring access restarts the idle clock (no immediate inactivity lock)');
update private.support_last_active set last_active_at = now() - interval '40 days' where user_id = '00000000-0000-0000-0000-000000250101';
select pg_temp.as_owner();
select set_allow_gymos_support('00000000-0000-0000-0000-000000250001', false);
select set_allow_gymos_support('00000000-0000-0000-0000-000000250001', true);
select pg_temp.no_claims();
select is((select state from public.support_assignments where id = '00000000-0000-0000-0000-000000250401'), 'active', 'restore: the Owner turning the switch back on restores the assignment');
select is((select last_active_at > now() - interval '1 minute' from private.support_last_active where user_id = '00000000-0000-0000-0000-000000250101'), true, 'restore: and restarts that person''s idle clock');

-- ============================================================================================================
-- I. sweep recertification notice and the step-up action
-- ============================================================================================================
select count(*)::int as rn0 from staff_notices where notice_type = 'support_recertification_due' and user_id = '00000000-0000-0000-0000-000000250103' \gset
update private.support_accounts set recertify_due_at = now() - interval '1 hour' where user_id = '00000000-0000-0000-0000-000000250117';
select private.support_inactivity_sweep();
select is((select count(*)::int from staff_notices where notice_type = 'support_recertification_due' and user_id = '00000000-0000-0000-0000-000000250103') - :rn0, 1, 'sweep: an account that fell due in the last day gives the Super Admin one notice');
update private.support_accounts set recertify_due_at = now() - interval '2 days' where user_id = '00000000-0000-0000-0000-000000250117';
update private.support_accounts set recertify_due_at = now() - interval '1 hour', deactivated_at = now() where user_id = '00000000-0000-0000-0000-000000250115';
select private.support_inactivity_sweep();
select is((select count(*)::int from staff_notices where notice_type = 'support_recertification_due' and user_id = '00000000-0000-0000-0000-000000250103') - :rn0, 1, 'sweep: no notice for an account due 2 days ago, none for a deactivated one');
select isnt(private.stepup_issue('00000000-0000-0000-0000-000000250103', 'start_support_factor_reset', '00000000-0000-0000-0000-000000250110'), null, 'step-up: start_support_factor_reset is issued to a Super Admin');
select throws_ok($$select private.stepup_issue('00000000-0000-0000-0000-000000250102', 'start_support_factor_reset', '00000000-0000-0000-0000-000000250110')$$, '42501', 'permission_denied', 'step-up: and refused to anyone who is not a Super Admin');

-- ============================================================================================================
-- H. catalog and scans
-- ============================================================================================================
select is((select array_agg(key order by key) from private.session_limits_config where key in ('support_inactivity_days', 'support_factor_reset_cooling_off_minutes', 'support_recertification_days')),
          array['support_factor_reset_cooling_off_minutes', 'support_inactivity_days', 'support_recertification_days']::text[], 'limits: the three values live in the limits table');
select is(private.session_limit('support_inactivity_days') || '/' || private.session_limit('support_factor_reset_cooling_off_minutes') || '/' || private.session_limit('support_recertification_days'), '30/30/90', 'limits: 30 days, 30 minutes, 90 days');
select ok((select bool_and(note like '[ASSUMPTION]%') from private.session_limits_config where key in ('support_inactivity_days', 'support_factor_reset_cooling_off_minutes', 'support_recertification_days')), 'limits: each is tagged [ASSUMPTION]');
select is((select string_agg(jobname || '=' || schedule, ',' order by jobname) from cron.job where jobname in ('support_inactivity_sweep', 'support_contact_drift_check', 'support_factor_reset_due')),
          'support_contact_drift_check=20 3 * * *,support_factor_reset_due=*/5 * * * *,support_inactivity_sweep=10 3 * * *', 'crons: the sweep, the drift check and the due marker each have their own cron');
select is((select count(*)::int from unnest(array['public.recertify_support_account(uuid, text)', 'public.start_support_factor_reset(uuid, text, text, text)', 'public.change_support_contact(uuid, text, text, text)',
            'public.get_support_lifecycle()', 'public.cancel_support_factor_reset(text)', 'public.claim_support_factor_resets(integer)', 'public.issue_support_reset_invite(uuid, text)',
            'public.support_factor_reset_done(uuid, integer)', 'public.support_factor_reset_failed(uuid, text)', 'public.record_support_factor_reset_run(integer, integer, timestamptz)',
            'private.support_inactivity_sweep()', 'private.support_contact_drift_check()', 'private.support_factor_reset_mark_due()', 'private.support_restore_assignments(uuid)']) f
            where has_function_privilege('anon', f, 'execute') or has_function_privilege('public', f, 'execute')), 0, 'privileges: no new function is callable by anon or public');
select is((select count(*)::int from unnest(array['public.cancel_support_factor_reset(text)', 'public.claim_support_factor_resets(integer)', 'public.issue_support_reset_invite(uuid, text)',
            'public.support_factor_reset_done(uuid, integer)', 'public.support_factor_reset_failed(uuid, text)', 'public.record_support_factor_reset_run(integer, integer, timestamptz)',
            'private.support_inactivity_sweep()', 'private.support_contact_drift_check()', 'private.support_factor_reset_mark_due()', 'private.support_restore_assignments(uuid)']) f
            where has_function_privilege('authenticated', f, 'execute')), 0, 'privileges: the person-side and executor functions are service role only');
select ok(not has_table_privilege('authenticated', 'private.support_factor_resets', 'select') and not has_table_privilege('anon', 'private.support_factor_resets', 'select'), 'privileges: the reset table has no client grant');
select is((select relrowsecurity from pg_class where oid = 'private.support_factor_resets'::regclass), true, 'the reset table has RLS on');
-- nothing here writes the factor table, and there is no trigger on it from this story
select is((select coalesce(array_agg(p.proname::text order by p.proname), '{}') from pg_proc p
            where p.prokind = 'f' and p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
              and p.proname in ('support_inactivity_sweep', 'support_contact_drift_check', 'support_factor_reset_mark_due', 'start_support_factor_reset', 'cancel_support_factor_reset',
                                'claim_support_factor_resets', 'issue_support_reset_invite', 'support_factor_reset_done', 'support_factor_reset_failed', 'change_support_contact', 'recertify_support_account')
              and p.prosrc ~* '(delete\s+from|update|insert\s+into)\s+auth\.mfa_factors'), '{}'::text[], 'scan: no function of this story writes auth.mfa_factors (the executor uses the Admin API)');
select is((select count(*)::int from pg_trigger t where t.tgrelid = 'auth.mfa_factors'::regclass and not t.tgisinternal and t.tgname not in ('guard_last_verified_factor')), 0, 'scan: this story adds no trigger on auth.mfa_factors');
-- every writer of private.support_accounts is on the list (retro 66); a new one must be added here by name
select is((select coalesce(array_agg(p.proname::text order by p.proname), '{}') from pg_proc p
            where p.prokind = 'f' and p.prosrc ~* '(insert\s+into|update|delete\s+from)\s+(only\s+)?private\.support_accounts\M'),
          array['activate_support_account', 'cancel_support_factor_reset', 'change_support_contact', 'create_support_account', 'deactivate_support_account', 'recertify_support_account',
                'remove_support_account', 'start_support_factor_reset', 'support_lock_account', 'unlock_support_account']::text[], 'scan: the writers of private.support_accounts');
-- every path that sets reset_pending_at or locks ends access through the one routine
select is((select coalesce(array_agg(p.proname::text order by p.proname), '{}') from pg_proc p
            where p.prokind = 'f' and p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
              and p.prosrc ~* 'update\s+private\.support_accounts\s+set\s+[^;]*?\mreset_pending_at\s*=\s*(?!\s*null)'), array['start_support_factor_reset']::text[], 'scan: the only path that sets reset_pending_at');
select is((select coalesce(array_agg(p.proname::text order by p.proname), '{}') from pg_proc p
            where p.prokind = 'f' and p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
              and p.prosrc ~* 'update\s+private\.support_accounts\s+set\s+[^;]*?\mreset_pending_at\s*=\s*(?!\s*null)'
              and p.prosrc !~ 'support_revoke_access'), '{}'::text[], 'scan: and it ends access through support_revoke_access');
create function public.zz_bad_resetter() returns void language plpgsql as $f$
begin update private.support_accounts set reset_pending_at = now() where false; end $f$;
select is((select coalesce(array_agg(p.proname::text order by p.proname), '{}') from pg_proc p
            where p.prokind = 'f' and p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
              and p.prosrc ~* 'update\s+private\.support_accounts\s+set\s+[^;]*?\mreset_pending_at\s*=\s*(?!\s*null)'
              and p.prosrc !~ 'support_revoke_access'), array['zz_bad_resetter']::text[], 'scan: shown failing: a new path that sets reset_pending_at without the routine is caught');
select is((select count(*)::int from information_schema.columns where table_schema = 'private' and table_name = 'support_accounts' and column_name in ('recertify_due_at', 'recertified_at', 'recorded_email')), 3, 'columns: recertification and recorded e-mail exist');

select * from finish();
rollback;
