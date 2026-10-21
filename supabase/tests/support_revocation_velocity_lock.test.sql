-- Story 23.10: revocation, Owner visibility and velocity lock (migration 0144).
--   A. support-created staff: tagged, the tag is pinned, creation is allowed
--   B. audit allow-list for a live support caller; reading a real identity writes an audit row
--   C. unassign: access ends at once, pending items counted, Owner notice, review queue, tag, nothing deactivated
--   D. switch off and restore (deferral fixes), deactivate
--   E. velocity: per gym, per account, payment connection; the lock commits; Super Admin alerted; locked denied
--   F. unlock with a reason; rows from before the unlock stop counting
--   G. suspended gym: denied, not counted, revocation without an Owner notice
--   H. daily digest and its cron / job_runs
--   I. per-user wrong step-up counter for support
--   J. consumer-enumeration scan (every revocation path calls the one routine; a new one that skips it fails) and the catalog
begin;
select plan(130);

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
create or replace function pg_temp.uid(n int) returns text language sql as $f$ select '00000000-0000-0000-0000-' || lpad(to_hex(n), 12, '0') $f$;
-- S1: live support in gym A; S2: velocity subject
create or replace function pg_temp.live_s1() returns void language sql as $f$
  select pg_temp.claims('00000000-0000-0000-0000-000000240101', 'support', 'aal2', '00000000-0000-0000-0000-000000240001', '00000000-0000-0000-0000-0000000240a1') $f$;
create or replace function pg_temp.as_owner_a() returns void language sql as $f$
  select pg_temp.claims('00000000-0000-0000-0000-000000240102', 'owner', 'aal1', '00000000-0000-0000-0000-000000240001') $f$;
create or replace function pg_temp.as_owner_b() returns void language sql as $f$
  select pg_temp.claims('00000000-0000-0000-0000-000000240105', 'owner', 'aal1', '00000000-0000-0000-0000-000000240002') $f$;
create or replace function pg_temp.as_member_a() returns void language sql as $f$
  select pg_temp.claims('00000000-0000-0000-0000-000000240104', 'member', 'aal1', '00000000-0000-0000-0000-000000240001') $f$;
create or replace function pg_temp.as_admin() returns void language sql as $f$
  select pg_temp.claims('00000000-0000-0000-0000-000000240103', 'super_admin', 'aal2', null, '00000000-0000-0000-0000-0000000240a9') $f$;
create or replace function pg_temp.grant_stepup(p_user text, p_action text, p_subject text) returns void language sql as $f$
  select private.stepup_issue(p_user::uuid, p_action, p_subject) $f$;
-- n identity rows for a person in a gym, at distinct times inside the hour (or the day), after an optional start offset
create or replace function pg_temp.act(p_user text, p_gym text, p_n int, p_table text default 'audit_log', p_first int default 1) returns void language sql as $f$
  insert into support_action_identity (subject_table, subject_id, real_user_id, gym_id, recorded_at)
  select p_table, gen_random_uuid(), p_user::uuid, p_gym::uuid, now() - make_interval(mins => g) from generate_series(p_first, p_first + p_n - 1) g $f$;

-- ---- fixtures ---------------------------------------------------------------------------------------------------
insert into tiers (id, name, monthly_price, annual_price, member_cap) values ('00000000-0000-0000-0000-000000240301', 'Rev Tier', 5000, 50000, 30);
insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-000000240001', 'Rev Gym A', '00000000-0000-0000-0000-000000240301', 30),
  ('00000000-0000-0000-0000-000000240002', 'Rev Gym B', '00000000-0000-0000-0000-000000240301', 30),
  ('00000000-0000-0000-0000-000000240003', 'Rev Gym C', '00000000-0000-0000-0000-000000240301', 30),
  ('00000000-0000-0000-0000-000000240004', 'Rev Gym D', '00000000-0000-0000-0000-000000240301', 30),
  ('00000000-0000-0000-0000-000000240005', 'Rev Gym E', '00000000-0000-0000-0000-000000240301', 30),
  ('00000000-0000-0000-0000-000000240006', 'Rev Gym F', '00000000-0000-0000-0000-000000240301', 30);
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000240101', 'real-support-240@gymosapps.com', now()),
  ('00000000-0000-0000-0000-000000240102', 'ownerA-240@x.example', now()),
  ('00000000-0000-0000-0000-000000240103', 'admin-240@x.example', now()),
  ('00000000-0000-0000-0000-000000240104', 'member-240@x.example', now()),
  ('00000000-0000-0000-0000-000000240105', 'ownerB-240@x.example', now()),
  ('00000000-0000-0000-0000-000000240106', 'support5-240@gymosapps.com', now()),
  ('00000000-0000-0000-0000-000000240107', 'support2-240@gymosapps.com', now()),
  ('00000000-0000-0000-0000-000000240108', 'ownerC-240@x.example', now()),
  ('00000000-0000-0000-0000-000000240109', 'support6-240@gymosapps.com', now()),
  ('00000000-0000-0000-0000-00000024010a', 'support7-240@gymosapps.com', now()),
  ('00000000-0000-0000-0000-00000024010b', 'ownerE-240@x.example', now()),
  ('00000000-0000-0000-0000-00000024010c', 'new1-240@x.example', now()),
  ('00000000-0000-0000-0000-00000024010d', 'new2-240@x.example', now()),
  ('00000000-0000-0000-0000-00000024010e', 'admin2-240@x.example', now()),
  ('00000000-0000-0000-0000-00000024010f', 'support4-240@gymosapps.com', now()),
  ('00000000-0000-0000-0000-000000240110', 'pin-240@x.example', now()),
  ('00000000-0000-0000-0000-000000240111', 'member2-240@x.example', now());
update users set is_super_admin = true where id in ('00000000-0000-0000-0000-000000240103', '00000000-0000-0000-0000-00000024010e');
update users set display_name = 'Real Support Person' where id = '00000000-0000-0000-0000-000000240101';
insert into members (id, gym_id, user_id, role, name, email, phone) values
  ('00000000-0000-0000-0000-000000240201', '00000000-0000-0000-0000-000000240001', '00000000-0000-0000-0000-000000240102', 'owner', 'Owner A 240', null, '+237600240001'),
  ('00000000-0000-0000-0000-000000240202', '00000000-0000-0000-0000-000000240001', '00000000-0000-0000-0000-000000240104', 'member', 'Member 240', null, null),
  ('00000000-0000-0000-0000-000000240203', '00000000-0000-0000-0000-000000240002', '00000000-0000-0000-0000-000000240105', 'owner', 'Owner B 240', null, '+237600240002'),
  ('00000000-0000-0000-0000-000000240204', '00000000-0000-0000-0000-000000240003', '00000000-0000-0000-0000-000000240108', 'owner', 'Owner C 240', null, '+237600240003'),
  ('00000000-0000-0000-0000-000000240205', '00000000-0000-0000-0000-000000240005', '00000000-0000-0000-0000-00000024010b', 'owner', 'Owner E 240', null, '+237600240005'),
  ('00000000-0000-0000-0000-000000240207', '00000000-0000-0000-0000-000000240001', '00000000-0000-0000-0000-000000240111', 'member', 'Member Two 240', null, null);
insert into private.support_accounts (user_id, activated_at) values
  ('00000000-0000-0000-0000-000000240101', now()), ('00000000-0000-0000-0000-000000240106', now()), ('00000000-0000-0000-0000-000000240107', now()),
  ('00000000-0000-0000-0000-000000240109', now()), ('00000000-0000-0000-0000-00000024010a', now()), ('00000000-0000-0000-0000-00000024010f', now());
insert into public.support_assignments (id, support_user_id, gym_id, state, activated_at) values
  ('00000000-0000-0000-0000-000000240401', '00000000-0000-0000-0000-000000240101', '00000000-0000-0000-0000-000000240001', 'active', now()),
  ('00000000-0000-0000-0000-000000240402', '00000000-0000-0000-0000-000000240109', '00000000-0000-0000-0000-000000240001', 'active', now()),
  ('00000000-0000-0000-0000-000000240403', '00000000-0000-0000-0000-000000240106', '00000000-0000-0000-0000-000000240002', 'active', now()),
  ('00000000-0000-0000-0000-000000240404', '00000000-0000-0000-0000-000000240107', '00000000-0000-0000-0000-000000240003', 'active', now()),
  ('00000000-0000-0000-0000-000000240405', '00000000-0000-0000-0000-000000240107', '00000000-0000-0000-0000-000000240004', 'active', now()),
  ('00000000-0000-0000-0000-000000240406', '00000000-0000-0000-0000-000000240107', '00000000-0000-0000-0000-000000240006', 'active', now()),
  ('00000000-0000-0000-0000-000000240407', '00000000-0000-0000-0000-00000024010a', '00000000-0000-0000-0000-000000240005', 'active', now()),
  ('00000000-0000-0000-0000-000000240408', '00000000-0000-0000-0000-00000024010f', '00000000-0000-0000-0000-000000240001', 'active', now());
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000240a1', '00000000-0000-0000-0000-000000240101', now(), now()),
  ('00000000-0000-0000-0000-0000000240a2', '00000000-0000-0000-0000-000000240107', now(), now()),
  ('00000000-0000-0000-0000-0000000240a4', '00000000-0000-0000-0000-00000024010f', now(), now()),
  ('00000000-0000-0000-0000-0000000240a5', '00000000-0000-0000-0000-000000240106', now(), now()),
  ('00000000-0000-0000-0000-0000000240a7', '00000000-0000-0000-0000-00000024010a', now(), now()),
  ('00000000-0000-0000-0000-0000000240a9', '00000000-0000-0000-0000-000000240103', now(), now());
insert into private.support_session_state (session_id, user_id, started_at, last_seen_at) values
  ('00000000-0000-0000-0000-0000000240a1', '00000000-0000-0000-0000-000000240101', now(), now()),
  ('00000000-0000-0000-0000-0000000240a2', '00000000-0000-0000-0000-000000240107', now(), now()),
  ('00000000-0000-0000-0000-0000000240a4', '00000000-0000-0000-0000-00000024010f', now(), now()),
  ('00000000-0000-0000-0000-0000000240a5', '00000000-0000-0000-0000-000000240106', now(), now()),
  ('00000000-0000-0000-0000-0000000240a7', '00000000-0000-0000-0000-00000024010a', now(), now());
select private.support_set_membership(id, true) from public.support_assignments where state = 'active';
update private.platform_flags set enabled = true where flag = 'super_admin_aal2';

create temp table res (what text, v text);
grant all on res to authenticated;
create temp table ctx (k text primary key, v text);
select count(*)::int as notices0 from staff_notices \gset
select count(*)::int as jobs0 from job_runs where job_name = 'support_activity_digest' \gset

-- ============================================================================================================
-- A. support-created staff: tagged and pinned
-- ============================================================================================================
select pg_temp.grant_stepup(pg_temp.uid(x'240101'::int), 'support_create_staff', pg_temp.uid(x'24010c'::int));
select pg_temp.grant_stepup(pg_temp.uid(x'240101'::int), 'support_create_staff', pg_temp.uid(x'24010d'::int));
set local role authenticated;
select pg_temp.live_s1();
insert into res values ('c1', pg_temp.err($$select create_staff_member('00000000-0000-0000-0000-00000024010c', 'Coach One', '+237600240301', 'coach')$$));
insert into res values ('c2', pg_temp.err($$select create_staff_member('00000000-0000-0000-0000-00000024010d', 'Receptionist Two', '+237600240302', 'receptionist')$$));
reset role;
select pg_temp.no_claims();
select is((select v from res where what = 'c1') || '/' || (select v from res where what = 'c2'), 'ok/ok', 'live support creates two staff accounts');
select is((select count(*)::int from members where gym_id = '00000000-0000-0000-0000-000000240001' and created_by_support and deactivated_at is null), 2, 'the staff support created are tagged created_by_support');
select is(pg_temp.err($$update members set created_by_support = false where user_id = '00000000-0000-0000-0000-00000024010c'$$), 'ok', 'an update clearing the tag runs');
select is((select created_by_support from members where user_id = '00000000-0000-0000-0000-00000024010c'), true, 'but the tag is pinned: it cannot be cleared outside create_staff_member');
update members set created_by_support = true where id = '00000000-0000-0000-0000-000000240202';
select is((select created_by_support from members where id = '00000000-0000-0000-0000-000000240202'), false, 'and it cannot be set on anyone else');
insert into members (id, gym_id, user_id, role, name, phone, created_by_support)
values ('00000000-0000-0000-0000-000000240209', '00000000-0000-0000-0000-000000240001', '00000000-0000-0000-0000-000000240110', 'coach', 'Pin Probe', '+237600240399', true);
select is((select created_by_support from members where id = '00000000-0000-0000-0000-000000240209'), false, 'an insert that supplies true is stored false');
delete from members where id = '00000000-0000-0000-0000-000000240209';
select set_config('gymos.support_staff_tag', 'on', true);
update members set created_by_support = true where id = '00000000-0000-0000-0000-000000240202';
select is((select created_by_support from members where id = '00000000-0000-0000-0000-000000240202'), true, 'only the bypass setting lifts the pin (shown: the pin is what stopped the earlier write)');
update members set created_by_support = false where id = '00000000-0000-0000-0000-000000240202';
select set_config('gymos.support_staff_tag', 'off', true);
select is((select count(*)::int from members where gym_id = '00000000-0000-0000-0000-000000240001' and created_by_support), 2, 'two tagged staff after the pin tests');

-- ============================================================================================================
-- B. audit allow-list and the audited identity read
-- ============================================================================================================
set local role authenticated;
select pg_temp.live_s1();
select is(pg_temp.err($$select log_audit_event('plan_price_changed', '00000000-0000-0000-0000-000000240001')$$), 'ok', 'a live support caller may write an allow-listed audit action');
select is(pg_temp.err($$select log_audit_event('arbitrary_action', '00000000-0000-0000-0000-000000240001')$$), 'P0001:support_audit_action_not_allowed', 'disallowed audit action: refused with a typed error');
select pg_temp.as_owner_a();
select is(pg_temp.err($$select log_audit_event('arbitrary_action', '00000000-0000-0000-0000-000000240001')$$), 'ok', 'the restriction applies to support only: an Owner writes any type');
reset role;
select pg_temp.no_claims();
select is((select count(*)::int from audit_log where action_type = 'arbitrary_action'), 1, 'the refused action wrote no audit row (only the Owner row exists)');
select ok(not exists (select 1 from private.support_audit_actions a where a.action_type in ('support_assigned', 'support_account_locked', 'allow_gymos_support_changed', 'gym_payment_credentials_disconnected')),
          'the allow-list holds no Super Admin or Owner-only action');

select count(*)::int as idread0 from audit_log where action_type = 'support_identity_read' \gset
set local role authenticated;
select pg_temp.as_admin();
select is((select count(*)::int from get_support_action_identity('audit_log', array(select id from audit_log where action_type = 'staff_created'))), 2, 'Super Admin reads the real person for the two staff creations');
reset role;
select pg_temp.no_claims();
select is((select count(*)::int from audit_log where action_type = 'support_identity_read') - :idread0, 1, 'reading a real identity writes exactly one audit row');
select is((select count(*)::int from audit_log where action_type = 'support_identity_read' and gym_id is null
             and metadata ? 'subject_table' and metadata ? 'rows_requested' and metadata::text !~* '(real support|real-support|240101)'), 1,
          'that audit row has no gym (an Owner cannot read it) and holds neither the name nor the id of the person read');

-- ============================================================================================================
-- C. unassign: pending items, notice, queue, tag, nothing deactivated
-- ============================================================================================================
insert into payments (id, gym_id, member_id, amount, currency, method, status, purpose) values
  ('00000000-0000-0000-0000-000000240701', '00000000-0000-0000-0000-000000240001', '00000000-0000-0000-0000-000000240202', 3000, 'XAF', 'cash', 'pending', 'session'),
  ('00000000-0000-0000-0000-000000240702', '00000000-0000-0000-0000-000000240001', '00000000-0000-0000-0000-000000240202', 5000, 'XAF', 'cash', 'pending', 'subscription'),
  ('00000000-0000-0000-0000-000000240703', '00000000-0000-0000-0000-000000240001', '00000000-0000-0000-0000-000000240207', 1000, 'XAF', 'cash', 'processing', 'session'),
  ('00000000-0000-0000-0000-000000240704', '00000000-0000-0000-0000-000000240001', '00000000-0000-0000-0000-000000240202', 1500, 'XAF', 'cash', 'verified', 'session');
insert into support_action_identity (subject_table, subject_id, real_user_id, gym_id) values
  ('payments', '00000000-0000-0000-0000-000000240701', '00000000-0000-0000-0000-000000240101', '00000000-0000-0000-0000-000000240001'),
  ('payments', '00000000-0000-0000-0000-000000240702', '00000000-0000-0000-0000-000000240101', '00000000-0000-0000-0000-000000240001'),
  ('payments', '00000000-0000-0000-0000-000000240703', '00000000-0000-0000-0000-000000240109', '00000000-0000-0000-0000-000000240001'),
  ('payments', '00000000-0000-0000-0000-000000240704', '00000000-0000-0000-0000-000000240101', '00000000-0000-0000-0000-000000240001');
select pg_temp.live_s1();
select is(private.support_live('00000000-0000-0000-0000-000000240101', '00000000-0000-0000-0000-000000240001'), true, 'control: the support session is live before the revocation');
select pg_temp.no_claims();
select count(*)::int as notices_c0 from staff_notices where notice_type = 'support_access_ended' \gset
set local role authenticated;
select pg_temp.as_admin();
select is((select ok::text || ':' || code from unassign_support('00000000-0000-0000-0000-000000240401', 'work finished')), 'true:ended', 'unassign: the assignment ends');
reset role;
select pg_temp.live_s1();
select is(private.support_live('00000000-0000-0000-0000-000000240101', '00000000-0000-0000-0000-000000240001'), false, 'unassign: access ends on the very next request (inside the 60 s cutoff)');
select is(private.support_gym_id(), null, 'unassign: the support person no longer resolves a gym');
select pg_temp.no_claims();
select is(private.session_limit('support_revocation_cutoff_seconds'), 60, 'the 60 s cutoff is held in the limits table');
select is((select count(*)::int from audit_log where action_type = 'gymos_support_access_ended' and gym_id = '00000000-0000-0000-0000-000000240001' and metadata->>'cause' = 'unassigned'), 1,
          'unassign: one gym-scoped audit row (the Owner can read it)');
select is((select (metadata->>'pending_payments') || '/' || (metadata->>'pending_subscription_payments') || '/' || (metadata->>'staff_in_review') from audit_log
            where action_type = 'gymos_support_access_ended' and metadata->>'cause' = 'unassigned' and gym_id = '00000000-0000-0000-0000-000000240001'), '1/1/2',
          'unassign: counts this person''s pending payment, pending subscription payment and the 2 staff (another person''s and a verified payment are not counted)');
select is((select count(*)::int from staff_notices where notice_type = 'support_access_ended') - :notices_c0, 1, 'unassign: one Owner notice');
select is((select user_id from staff_notices where notice_type = 'support_access_ended' order by created_at desc limit 1), '00000000-0000-0000-0000-000000240102'::uuid, 'the notice goes to the Owner of that gym');
select ok((select body_en like '%1 payment(s)%' and body_en like '%1 subscription payment(s)%' and body_en like '%2 staff account(s)%' and body_en like '%none was deactivated%'
             from staff_notices where notice_type = 'support_access_ended' order by created_at desc limit 1), 'the notice lists the pending items and the staff waiting for review (EN)');
select ok((select body_fr like '%1 paiement(s)%' and body_fr like '%2 compte(s) du personnel%' and title_fr <> title_en from staff_notices where notice_type = 'support_access_ended' order by created_at desc limit 1), 'and has French text');
select is((select count(*)::int from staff_notices where notice_type = 'support_access_ended' and (title_en || body_en || title_fr || body_fr) ~* '(real support|real-support|240101|gymosapps)'), 0, 'no notice names the individual');
select is((select count(*)::int from email_outbox where recipient_email = 'ownerA-240@x.example' and subject like 'GymOS Support access ended%'), 1, 'the notice is also queued as an e-mail');
select is((select count(*)::int from members where gym_id = '00000000-0000-0000-0000-000000240001' and created_by_support and deactivated_at is null), 2, 'none of the support-created staff was deactivated');
select is((select count(*)::int from members where user_id = '00000000-0000-0000-0000-000000240101' and role = 'support' and deactivated_at is null), 0, 'the support membership itself is gone');

set local role authenticated;
select pg_temp.as_owner_a();
select is((select count(*)::int from get_support_review_queue()), 2, 'the Owner review queue lists both support-created staff');
select is((select string_agg(name, ',' order by name) from get_support_review_queue()), 'Coach One,Receptionist Two', 'with their names (staff, not the support person)');
select is((select string_agg(distinct role::text, ',') from get_support_review_queue()), 'coach,receptionist', 'and their roles');
select is((select ok::text || ':' || code from clear_support_review((select member_id from get_support_review_queue() where name = 'Coach One'))), 'true:cleared', 'the Owner can mark one as reviewed');
select is((select count(*)::int from get_support_review_queue()), 1, 'the queue shrinks');
select is((select ok::text || ':' || code from clear_support_review((select user_id from members where user_id = '00000000-0000-0000-0000-00000024010c' limit 1))), 'false:not_found', 'clearing something that is not in the queue (or twice) is not_found');
select pg_temp.as_member_a();
select is(pg_temp.err('select * from get_support_review_queue()'), 'P0001:permission denied', 'a non-Owner cannot read the review queue');
select is(pg_temp.err('select * from clear_support_review(gen_random_uuid())'), 'P0001:permission denied', 'a non-Owner cannot clear it');
select pg_temp.as_admin();
select is((select ok::text || ':' || code from unassign_support('00000000-0000-0000-0000-000000240401', 'again')), 'false:already_ended', 'a second unassign changes nothing');
reset role;
select pg_temp.no_claims();
select is((select count(*)::int from staff_notices where notice_type = 'support_access_ended') - :notices_c0, 1, 'and sends no second notice');
select is((select count(*)::int from audit_log where action_type = 'staff_support_review_cleared'), 1, 'clearing is audited');
select is((select count(*)::int from audit_log where action_type like 'support\_%' and gym_id is not null and action_type <> 'support_account_locked'), 0, 'no support-named audit row is gym-scoped (an Owner sees none of them)');

-- ============================================================================================================
-- D. switch off and restore, deactivate
-- ============================================================================================================
select count(*)::int as notices_d0 from staff_notices where notice_type = 'support_access_ended' \gset
set local role authenticated;
select pg_temp.as_owner_b();
select set_allow_gymos_support('00000000-0000-0000-0000-000000240002', false);
reset role;
select pg_temp.no_claims();
select is((select state from support_assignments where id = '00000000-0000-0000-0000-000000240403'), 'suspended', 'switch off: the assignment is suspended');
select is((select count(*)::int from audit_log where action_type = 'gymos_support_access_ended' and gym_id = '00000000-0000-0000-0000-000000240002' and metadata->>'cause' = 'switch_off'), 1, 'switch off: runs the revocation routine');
select is((select count(*)::int from staff_notices where notice_type = 'support_access_ended') - :notices_d0, 0, 'nothing was left behind, so no Owner notice');
-- the account is locked while the switch is off: the restore skips it
update private.support_accounts set locked_at = now() where user_id = '00000000-0000-0000-0000-000000240106';
set local role authenticated;
select pg_temp.as_owner_b();
select set_allow_gymos_support('00000000-0000-0000-0000-000000240002', true);
reset role;
select pg_temp.no_claims();
select is((select state from support_assignments where id = '00000000-0000-0000-0000-000000240403'), 'suspended', 'restore skips an assignment whose account is locked');
update private.support_accounts set locked_at = null where user_id = '00000000-0000-0000-0000-000000240106';
-- gained another membership while the switch was off: skipped, and the toggle does not abort
set local role authenticated;
select pg_temp.as_owner_b();
select set_allow_gymos_support('00000000-0000-0000-0000-000000240002', false);
reset role;
select pg_temp.no_claims();
insert into members (id, gym_id, user_id, role, name, phone) values
  ('00000000-0000-0000-0000-000000240206', '00000000-0000-0000-0000-000000240002', '00000000-0000-0000-0000-000000240106', 'coach', 'Other Role', '+237600240398');
set local role authenticated;
select pg_temp.as_owner_b();
insert into res values ('toggle_on', pg_temp.err($$select set_allow_gymos_support('00000000-0000-0000-0000-000000240002', true)$$));
reset role;
select pg_temp.no_claims();
select is((select v from res where what = 'toggle_on'), 'ok', 'restore: a person who gained another membership does not abort the Owner toggle');
select is((select state from support_assignments where id = '00000000-0000-0000-0000-000000240403'), 'suspended', 'and is not restored');
update members set deactivated_at = now() where id = '00000000-0000-0000-0000-000000240206';
set local role authenticated;
select pg_temp.as_owner_b();
select set_allow_gymos_support('00000000-0000-0000-0000-000000240002', false);
select set_allow_gymos_support('00000000-0000-0000-0000-000000240002', true);
reset role;
select pg_temp.no_claims();
select is((select state from support_assignments where id = '00000000-0000-0000-0000-000000240403'), 'active', 'once every leg holds the restore brings the assignment back');

set local role authenticated;
select pg_temp.as_admin();
select is((select ok::text || ':' || code from deactivate_support_account('00000000-0000-0000-0000-000000240109', 'left the company')), 'true:deactivated', 'deactivate: the account is deactivated');
reset role;
select pg_temp.no_claims();
select is((select count(*)::int from audit_log where action_type = 'gymos_support_access_ended' and gym_id = '00000000-0000-0000-0000-000000240001' and metadata->>'cause' = 'deactivated'), 1, 'deactivate: runs the revocation routine for each gym it was assigned to');
select ok((select body_en like '%1 payment(s)%' from staff_notices where notice_type = 'support_access_ended' order by created_at desc limit 1)
          and (select count(*)::int from staff_notices where notice_type = 'support_access_ended') - :notices_d0 = 1, 'deactivate: the Owner is told about the pending payment that person started');

-- ============================================================================================================
-- E. velocity
-- ============================================================================================================
select pg_temp.act(pg_temp.uid(x'240107'::int), pg_temp.uid(x'240003'::int), 10);
select is(private.support_velocity_breach('00000000-0000-0000-0000-000000240107'), null, 'per gym: 10 actions in the hour are within the limit');
select is((select ok::text || ':' || reason from private.session_gate_touch('00000000-0000-0000-0000-000000240107', '00000000-0000-0000-0000-0000000240a2')), 'true:ok', 'per gym: the 10th action is not locked');
select pg_temp.act(pg_temp.uid(x'240107'::int), pg_temp.uid(x'240003'::int), 1, 'audit_log', 11);
select count(*)::int as notices_e0 from staff_notices where notice_type = 'support_account_locked' \gset
select count(*)::int as mail_e0 from email_outbox where subject like 'A GymOS Support account was locked%' \gset
select is((select ok::text || ':' || reason from private.session_gate_touch('00000000-0000-0000-0000-000000240107', '00000000-0000-0000-0000-0000000240a2')), 'false:locked', 'per gym: the 11th action locks the account and the breach comes back as a result (nothing raised)');
select is((select locked_reason from private.support_accounts where user_id = '00000000-0000-0000-0000-000000240107'), 'velocity_gym', 'the lock records why');
select ok((select locked_at is not null from private.support_accounts where user_id = '00000000-0000-0000-0000-000000240107'), 'the lock is written by the same call that returned it');
select is((select count(*)::int from auth.sessions where user_id = '00000000-0000-0000-0000-000000240107'), 0, 'the locked account''s sessions are ended');
select is((select count(*)::int from audit_log where action_type = 'support_account_locked' and target_entity_id = '00000000-0000-0000-0000-000000240107'), 1, 'the lock is audited');
select is((select count(*)::int from audit_log where action_type = 'gymos_support_access_ended' and metadata->>'cause' = 'locked'
             and gym_id in ('00000000-0000-0000-0000-000000240003', '00000000-0000-0000-0000-000000240004', '00000000-0000-0000-0000-000000240006')), 3, 'the lock runs the revocation routine in every gym the person was assigned to');
select is((select count(*)::int from staff_notices where notice_type = 'support_account_locked') - :notices_e0, 2, 'every Super Admin is alerted');
select is((select count(distinct user_id)::int from staff_notices where notice_type = 'support_account_locked'
             and user_id in ('00000000-0000-0000-0000-000000240103', '00000000-0000-0000-0000-00000024010e')), 2, 'both Super Admins received it');
select is((select count(*)::int from email_outbox where subject like 'A GymOS Support account was locked%') - :mail_e0, 2, 'and each has an e-mail queued');
select is((select count(*)::int from staff_notices where notice_type = 'support_account_locked' and (title_en || body_en || title_fr || body_fr) ~* '(real support|support2|240107)'), 0, 'the alert names no individual');
select is((select ok::text || ':' || reason from private.session_gate_touch('00000000-0000-0000-0000-000000240107', '00000000-0000-0000-0000-0000000240a2')), 'false:locked', 'locked account: the next request is denied with the reason locked');
select pg_temp.claims('00000000-0000-0000-0000-000000240107', 'support', 'aal2', '00000000-0000-0000-0000-000000240003', '00000000-0000-0000-0000-0000000240a2');
select is(private.support_live('00000000-0000-0000-0000-000000240107', '00000000-0000-0000-0000-000000240003'), false, 'locked account: the live gate denies');
select pg_temp.no_claims();
set local role authenticated;
select pg_temp.as_admin();
select is((select count(*)::int from get_support_locks() where user_id = '00000000-0000-0000-0000-000000240107' and locked_reason = 'velocity_gym' and gym_names like '%Rev Gym C%'), 1, 'Super Admin lists the lock with its reason and gyms');
select pg_temp.as_owner_a();
select is(pg_temp.err('select * from get_support_locks()'), 'P0001:permission denied', 'an Owner cannot list locks');
select is(pg_temp.err($$select * from unlock_support_account('00000000-0000-0000-0000-000000240107', 'let me in please')$$), 'P0001:permission denied', 'an Owner cannot unlock');
reset role;
select pg_temp.no_claims();

-- F. unlock
set local role authenticated;
select pg_temp.as_admin();
select is((select ok::text || ':' || code from unlock_support_account('00000000-0000-0000-0000-000000240107', 'x')), 'false:reason_invalid', 'unlock needs a reason (3 to 500 characters)');
select is((select ok::text || ':' || code from unlock_support_account('00000000-0000-0000-0000-000000240107', '   ')), 'false:reason_invalid', 'a blank reason is refused');
reset role;
select is((select locked_at is not null from private.support_accounts where user_id = '00000000-0000-0000-0000-000000240107'), true, 'a refused unlock leaves the lock');
set local role authenticated;
select pg_temp.as_admin();
select is((select ok::text || ':' || code from unlock_support_account('00000000-0000-0000-0000-000000240107', 'checked with the person, false alarm')), 'true:unlocked', 'unlock with a reason');
select is((select ok::text || ':' || code from unlock_support_account('00000000-0000-0000-0000-000000240107', 'checked with the person, false alarm')), 'false:not_locked', 'unlocking an unlocked account is refused');
reset role;
select pg_temp.no_claims();
select ok((select locked_at is null and locked_reason is null and velocity_reset_at is not null from private.support_accounts where user_id = '00000000-0000-0000-0000-000000240107'), 'support_locked_at is cleared and the velocity window restarts');
select is((select metadata->>'reason' from audit_log where action_type = 'support_account_unlocked' and target_entity_id = '00000000-0000-0000-0000-000000240107'), 'checked with the person, false alarm', 'the unlock and its reason are audited');
select is((select gym_id from audit_log where action_type = 'support_account_unlocked' and target_entity_id = '00000000-0000-0000-0000-000000240107'), null, 'the unlock row is not gym-scoped');
insert into auth.sessions (id, user_id, created_at, updated_at) values ('00000000-0000-0000-0000-0000000240b2', '00000000-0000-0000-0000-000000240107', now(), now());
select is((select ok::text || ':' || reason from private.session_gate_touch('00000000-0000-0000-0000-000000240107', '00000000-0000-0000-0000-0000000240b2')), 'true:ok', 'after the unlock the same 11 old actions do not lock it again');
-- after the unlock a new burst counts again (future-dated so it is after the reset)
insert into support_action_identity (subject_table, subject_id, real_user_id, gym_id, recorded_at)
select 'audit_log', gen_random_uuid(), '00000000-0000-0000-0000-000000240107', '00000000-0000-0000-0000-000000240003', now() + make_interval(secs => g) from generate_series(1, 11) g;
select is(private.support_velocity_breach('00000000-0000-0000-0000-000000240107'), 'velocity_gym', 'a new burst after the unlock locks again');

-- per account: 21 actions over three gyms (7 each), no gym over its own limit
delete from support_action_identity where real_user_id = '00000000-0000-0000-0000-000000240107';
update private.support_accounts set locked_at = null, locked_reason = null, velocity_reset_at = null where user_id = '00000000-0000-0000-0000-000000240107';
select pg_temp.act(pg_temp.uid(x'240107'::int), pg_temp.uid(x'240003'::int), 7, 'audit_log', 1);
select pg_temp.act(pg_temp.uid(x'240107'::int), pg_temp.uid(x'240004'::int), 7, 'audit_log', 8);
select pg_temp.act(pg_temp.uid(x'240107'::int), pg_temp.uid(x'240006'::int), 6, 'audit_log', 15);
select is(private.support_velocity_breach('00000000-0000-0000-0000-000000240107'), null, 'per account: 20 actions across gyms are within the limit');
select pg_temp.act(pg_temp.uid(x'240107'::int), pg_temp.uid(x'240006'::int), 1, 'audit_log', 21);
select is(private.support_velocity_breach('00000000-0000-0000-0000-000000240107'), 'velocity_account', 'per account: the 21st action in the hour breaches');
select is((select ok::text || ':' || reason from private.session_gate_touch('00000000-0000-0000-0000-000000240107', '00000000-0000-0000-0000-0000000240b2')), 'false:locked', 'per account: the gate locks and returns locked');
select is((select locked_reason from private.support_accounts where user_id = '00000000-0000-0000-0000-000000240107'), 'velocity_account', 'per account: the reason is recorded');

-- payment-connection changes: 3 a day per gym
delete from support_action_identity where real_user_id = '00000000-0000-0000-0000-000000240107';
update private.support_accounts set locked_at = null, locked_reason = null where user_id = '00000000-0000-0000-0000-000000240107';
select pg_temp.act(pg_temp.uid(x'240107'::int), pg_temp.uid(x'240003'::int), 3, 'gym_payment_credentials', 60);
select is(private.support_velocity_breach('00000000-0000-0000-0000-000000240107'), null, 'payment connection: 3 changes in a day are within the limit');
select pg_temp.act(pg_temp.uid(x'240107'::int), pg_temp.uid(x'240003'::int), 1, 'gym_payment_credentials', 600);
select is(private.support_velocity_breach('00000000-0000-0000-0000-000000240107'), 'velocity_payment', 'payment connection: the 4th change in a day breaches');
select is((select ok::text || ':' || reason from private.session_gate_touch('00000000-0000-0000-0000-000000240107', '00000000-0000-0000-0000-0000000240b2')), 'false:locked', 'payment connection: the gate locks and returns locked');
select is((select locked_reason from private.support_accounts where user_id = '00000000-0000-0000-0000-000000240107'), 'velocity_payment', 'payment connection: the reason is recorded');
-- one action is one transaction: many rows written together count once
delete from support_action_identity where real_user_id = '00000000-0000-0000-0000-000000240107';
update private.support_accounts set locked_at = null, locked_reason = null where user_id = '00000000-0000-0000-0000-000000240107';
insert into support_action_identity (subject_table, subject_id, real_user_id, gym_id, recorded_at)
select 'audit_log', gen_random_uuid(), '00000000-0000-0000-0000-000000240107', '00000000-0000-0000-0000-000000240003', now() - interval '5 minutes' from generate_series(1, 30);
select is(private.support_velocity_breach('00000000-0000-0000-0000-000000240107'), null, 'the rows one action writes together (audit, payment, refund) count as one action');

-- a quiet second support person in the same gym is not locked for another person's burst
insert into public.support_assignments (id, support_user_id, gym_id, state, activated_at)
values ('00000000-0000-0000-0000-000000240409', '00000000-0000-0000-0000-000000240106', '00000000-0000-0000-0000-000000240003', 'active', now());
delete from support_action_identity where real_user_id = '00000000-0000-0000-0000-000000240107';
select pg_temp.act(pg_temp.uid(x'240107'::int), pg_temp.uid(x'240003'::int), 11);
select is(private.support_velocity_breach('00000000-0000-0000-0000-000000240107'), 'velocity_gym', 'two people in a gym: the one who burst is over the limit');
select is(private.support_velocity_breach('00000000-0000-0000-0000-000000240106'), null, 'two people in a gym: the quiet one is not locked for it');
delete from support_action_identity where real_user_id = '00000000-0000-0000-0000-000000240107';
select pg_temp.act(pg_temp.uid(x'240107'::int), pg_temp.uid(x'240003'::int), 4, 'gym_payment_credentials', 60);
select is(private.support_velocity_breach('00000000-0000-0000-0000-000000240107'), 'velocity_payment', 'two people in a gym: the one who changed the payment connection 4 times is over the limit');
select is(private.support_velocity_breach('00000000-0000-0000-0000-000000240106'), null, 'two people in a gym: the quiet one is not locked for the payment changes');

-- ============================================================================================================
-- G. suspended gym
-- ============================================================================================================
select pg_temp.act(pg_temp.uid(x'24010a'::int), pg_temp.uid(x'240005'::int), 12);
select is(private.support_velocity_breach('00000000-0000-0000-0000-00000024010a'), 'velocity_gym', 'control: an active gym counts those 12 actions');
select count(*)::int as notices_g0 from staff_notices where notice_type = 'support_access_ended' \gset
select set_config('app.saas_billing_lifecycle_job_bypass', 'true', true);
update gyms set status = 'suspended' where id = '00000000-0000-0000-0000-000000240005';
select set_config('app.saas_billing_lifecycle_job_bypass', 'false', true);
select is((select status::text from gyms where id = '00000000-0000-0000-0000-000000240005'), 'suspended', 'the gym is suspended');
select is((select count(*)::int from audit_log where action_type = 'gymos_support_access_ended' and gym_id = '00000000-0000-0000-0000-000000240005' and metadata->>'cause' = 'gym_suspended'), 1, 'suspension runs the revocation routine');
select is((select count(*)::int from staff_notices where notice_type = 'support_access_ended') - :notices_g0, 0, 'but sends the suspended gym no notice');
select is(private.support_velocity_breach('00000000-0000-0000-0000-00000024010a'), null, 'a suspended gym''s actions are not counted');
select pg_temp.claims('00000000-0000-0000-0000-00000024010a', 'support', 'aal2', '00000000-0000-0000-0000-000000240005', '00000000-0000-0000-0000-0000000240a7');
select is(private.support_live('00000000-0000-0000-0000-00000024010a', '00000000-0000-0000-0000-000000240005'), false, 'a support request in a suspended gym is denied like every staff account');
select pg_temp.no_claims();

-- ============================================================================================================
-- H. digest
-- ============================================================================================================
insert into audit_log (id, gym_id, actor_id, actor_display_name, action_type, target_entity_type, target_entity_id) values
  ('00000000-0000-0000-0000-000000240901', '00000000-0000-0000-0000-000000240001', null, 'GymOS Support', 'registration_fee_waived', 'member', 'x'),
  ('00000000-0000-0000-0000-000000240902', '00000000-0000-0000-0000-000000240001', null, 'GymOS Support', 'registration_fee_waived', 'member', 'x'),
  ('00000000-0000-0000-0000-000000240903', '00000000-0000-0000-0000-000000240001', null, 'GymOS Support', 'staff_created', 'member', 'x'),
  ('00000000-0000-0000-0000-000000240904', '00000000-0000-0000-0000-000000240001', null, 'GymOS Support', 'staff_role_updated', 'member', 'x'),
  ('00000000-0000-0000-0000-000000240905', '00000000-0000-0000-0000-000000240001', null, 'GymOS Support', 'registration_fee_waived', 'member', 'x'),
  ('00000000-0000-0000-0000-000000240906', '00000000-0000-0000-0000-000000240002', null, 'GymOS Support', 'plan_price_changed', 'plan', 'x');
insert into support_action_identity (subject_table, subject_id, real_user_id, gym_id, recorded_at) values
  ('audit_log', '00000000-0000-0000-0000-000000240901', '00000000-0000-0000-0000-000000240101', '00000000-0000-0000-0000-000000240001', now() - interval '2 hours'),
  ('audit_log', '00000000-0000-0000-0000-000000240902', '00000000-0000-0000-0000-000000240101', '00000000-0000-0000-0000-000000240001', now() - interval '3 hours'),
  ('audit_log', '00000000-0000-0000-0000-000000240903', '00000000-0000-0000-0000-000000240101', '00000000-0000-0000-0000-000000240001', now() - interval '4 hours'),
  ('audit_log', '00000000-0000-0000-0000-000000240904', '00000000-0000-0000-0000-000000240101', '00000000-0000-0000-0000-000000240001', now() - interval '5 hours'),
  ('audit_log', '00000000-0000-0000-0000-000000240905', '00000000-0000-0000-0000-000000240101', '00000000-0000-0000-0000-000000240001', now() - interval '3 days'),
  ('audit_log', '00000000-0000-0000-0000-000000240906', '00000000-0000-0000-0000-000000240106', '00000000-0000-0000-0000-000000240002', now() - interval '1 hour'),
  ('refunds', gen_random_uuid(), '00000000-0000-0000-0000-000000240101', '00000000-0000-0000-0000-000000240001', now() - interval '2 hours'),
  ('refunds', gen_random_uuid(), '00000000-0000-0000-0000-000000240101', '00000000-0000-0000-0000-000000240001', now() - interval '6 hours');
select count(*)::int as notices_h0 from staff_notices where notice_type = 'support_activity_digest' \gset
select private.support_activity_digest();
select is((select count(*)::int from staff_notices where notice_type = 'support_activity_digest') - :notices_h0, 1, 'digest: one Owner notice for the one gym where support did something reportable');
select is((select user_id from staff_notices where notice_type = 'support_activity_digest' order by created_at desc limit 1), '00000000-0000-0000-0000-000000240102'::uuid, 'it goes to that gym''s Owner');
select ok((select body_en like '%2 refund(s)%' and body_en like '%2 registration fee waiver(s)%' and body_en like '%3 staff account(s) created%' and body_en like '%1 staff account(s) edited%'
             from staff_notices where notice_type = 'support_activity_digest' order by created_at desc limit 1), 'digest: counts of refunds, fee waivers, staff created and edited (the 3-day-old waiver is not counted; the two staff creations from section A count too)');
select ok((select body_fr like '%2 remboursement(s)%' and body_fr like '%2 exonération(s)%' and title_fr <> title_en from staff_notices where notice_type = 'support_activity_digest' order by created_at desc limit 1), 'digest: French text');
select is((select count(*)::int from staff_notices where notice_type = 'support_activity_digest' and (title_en || body_en || title_fr || body_fr) ~* '(real support|real-support|240101|gymosapps)'), 0, 'the digest names no individual');
select is((select count(*)::int from email_outbox where recipient_email = 'ownerA-240@x.example' and subject like 'GymOS Support activity summary%'), 1, 'the digest is also queued as an e-mail');
select is((select count(*)::int from staff_notices where notice_type = 'support_activity_digest' and user_id = '00000000-0000-0000-0000-000000240105'), 0, 'a gym where support only changed a price gets nothing');
select is((select count(*)::int from job_runs where job_name = 'support_activity_digest' and status = 'success') - :jobs0, 1, 'digest: a job_runs row is written');
delete from support_action_identity;
select private.support_activity_digest();
select is((select count(*)::int from staff_notices where notice_type = 'support_activity_digest') - :notices_h0, 1, 'no support action in the day: nothing is sent');
select is((select count(*)::int from job_runs where job_name = 'support_activity_digest' and status = 'success') - :jobs0, 2, 'and the run is still recorded');
select is((select schedule from cron.job where jobname = 'support_activity_digest'), '10 6 * * *', 'digest: its own cron');

-- ============================================================================================================
-- I. per-user wrong step-up counter for support
-- ============================================================================================================
select count(*)::int as sf0 from audit_log where action_type = 'support_stepup_failed' \gset
select is((select attempts || '/' || locked from private.stepup_record_failure('00000000-0000-0000-0000-00000024010f')), '1/false', 'step-up: the first wrong code is counted for a support account');
select is((select attempts || '/' || locked from private.stepup_record_failure('00000000-0000-0000-0000-00000024010f')), '2/false', 'and the second');
select private.stepup_record_failure('00000000-0000-0000-0000-00000024010f');
select private.stepup_record_failure('00000000-0000-0000-0000-00000024010f');
select is((select count(*)::int from audit_log where action_type = 'support_stepup_failed' and target_entity_id = '00000000-0000-0000-0000-00000024010f') - :sf0, 4, 'step-up: each wrong code writes an audit row (counts only)');
select is((select count(*)::int from audit_log where action_type = 'support_stepup_failed' and metadata::text ~* '[0-9]{6}'), 0, 'no code is recorded');
select is((select attempts || '/' || locked from private.stepup_record_failure('00000000-0000-0000-0000-00000024010f')), '5/true', 'step-up: the 5th wrong code locks the account');
select is((select locked_reason from private.support_accounts where user_id = '00000000-0000-0000-0000-00000024010f'), 'stepup_failures', 'with its reason');
select throws_ok($$select private.stepup_issue('00000000-0000-0000-0000-00000024010f', 'support_refund', 'x')$$, '42501', 'permission_denied', 'a locked account is issued no step-up');
select is((select attempts || '/' || locked from private.stepup_record_failure('00000000-0000-0000-0000-000000240101')), '1/false', 'another account has its own counter');
select is((select attempts || '/' || locked from private.stepup_record_failure('00000000-0000-0000-0000-000000240103')), '1/false', 'the Super Admin counter is unchanged');

-- ============================================================================================================
-- J. scan and catalog
-- ============================================================================================================
select is((select array_agg(key order by key) from private.session_limits_config where key in
             ('velocity_gym_per_hour', 'velocity_account_per_hour', 'velocity_payment_changes_per_day', 'support_revocation_cutoff_seconds')),
          array['support_revocation_cutoff_seconds', 'velocity_account_per_hour', 'velocity_gym_per_hour', 'velocity_payment_changes_per_day']::text[], 'the four limits live in the limits table');
select is((select private.session_limit('velocity_gym_per_hour') || '/' || private.session_limit('velocity_account_per_hour') || '/' || private.session_limit('velocity_payment_changes_per_day')), '10/20/3', 'at 10 per hour per gym, 20 per hour per account, 3 payment changes a day');
select ok((select bool_and(note like '[ASSUMPTION]%') from private.session_limits_config where key like 'velocity\_%' or key = 'support_revocation_cutoff_seconds'), 'each is tagged [ASSUMPTION]');

-- every function that ends access (an assignment ended or suspended, an account locked or deactivated) calls the one routine
create or replace function pg_temp.revocation_consumers() returns text[] language sql as $f$
  select coalesce(array_agg(p.proname::text order by p.proname), '{}') from pg_proc p
   where p.prokind = 'f' and p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
     and (p.prosrc ~* 'update\s+(public\.)?support_assignments\s+set\s+[^;]*?\mstate\s*=\s*(?!\s*''(active|pending)'')'
          or p.prosrc ~* 'delete\s+from\s+(public\.)?support_assignments'
          or p.prosrc ~* 'update\s+private\.support_accounts\s+set\s+[^;]*?\m(locked_at|deactivated_at)\s*=\s*(?!\s*null)') $f$;
create or replace function pg_temp.consumers_missing_routine() returns text[] language sql as $f$
  select coalesce(array_agg(p.proname::text order by p.proname), '{}') from pg_proc p
   where p.prokind = 'f' and p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
     and (p.prosrc ~* 'update\s+(public\.)?support_assignments\s+set\s+[^;]*?\mstate\s*=\s*(?!\s*''(active|pending)'')'
          or p.prosrc ~* 'delete\s+from\s+(public\.)?support_assignments'
          or p.prosrc ~* 'update\s+private\.support_accounts\s+set\s+[^;]*?\m(locked_at|deactivated_at)\s*=\s*(?!\s*null)')
     -- remove_support_account deletes only never-activated accounts' assignments (all pending or ended): nothing was ever live, so there is
     -- no access to revoke. The one documented exemption.
     and p.proname <> 'remove_support_account'
     and p.prosrc !~ 'support_revoke_access' $f$;
select is(pg_temp.revocation_consumers(), array['deactivate_support_account', 'remove_support_account', 'set_allow_gymos_support', 'support_lock_account', 'unassign_support']::text[],
          'scan: the revocation paths are exactly unassign, deactivate, switch off and lock (plus remove, a documented exemption) (a new one must be added here deliberately)');
select is(pg_temp.consumers_missing_routine(), '{}'::text[], 'scan: every revocation path calls private.support_revoke_access');
select is((select array_agg(p.proname::text order by p.proname) from pg_proc p
            where p.prokind = 'f' and p.pronamespace in ('public'::regnamespace, 'private'::regnamespace) and p.prosrc ~ 'support_revoke_access\('),
          array['deactivate_support_account', 'set_allow_gymos_support', 'support_lock_account', 'support_revoke_on_gym_status', 'unassign_support']::text[],
          'scan: the callers of the routine are those four and the gym-status trigger function');
select is((select count(*)::int from pg_trigger where tgrelid = 'public.gyms'::regclass and tgname = 'zz_support_revoke_on_gym_status' and not tgisinternal), 1, 'a suspended gym is a revocation path: the trigger is installed');
-- shown failing: a new path that skips the routine is caught
create function public.zz_bad_revoker() returns void language plpgsql as $f$
begin update public.support_assignments set state = 'ended', ended_at = now() where false; end $f$;
create function public.zz_bad_reordered() returns void language plpgsql as $f$
begin update public.support_assignments set ended_at = now(), state = 'ended' where false; end $f$;
create function public.zz_bad_deleter() returns void language plpgsql as $f$
begin delete from public.support_assignments where false; end $f$;
create function public.zz_bad_locker() returns void language plpgsql as $f$
begin update private.support_accounts set locked_at = now() where false; end $f$;
select is(pg_temp.consumers_missing_routine(), array['zz_bad_deleter', 'zz_bad_locker', 'zz_bad_reordered', 'zz_bad_revoker']::text[], 'scan: seeded paths that end access without the routine (including a reordered clause and a delete) are caught');

-- privileges
select is((select count(*)::int from unnest(array['public.get_support_locks()', 'public.unlock_support_account(uuid, text)', 'public.get_support_review_queue()', 'public.clear_support_review(uuid)']) f
            where has_function_privilege('anon', f, 'execute') or has_function_privilege('public', f, 'execute')), 0, 'the new RPCs are not callable by anon or public');
select is((select count(*)::int from unnest(array['private.support_revoke_access(uuid, uuid, text)', 'private.support_lock_account(uuid, text)', 'private.support_velocity_breach(uuid)', 'private.support_activity_digest()']) f
            where has_function_privilege('authenticated', f, 'execute')), 0, 'the routines are not callable by signed-in users');
select ok(not has_table_privilege('authenticated', 'public.support_staff_review', 'select') and not has_table_privilege('anon', 'public.support_staff_review', 'select'), 'the review table has no client grant');

select * from finish();
rollback;
