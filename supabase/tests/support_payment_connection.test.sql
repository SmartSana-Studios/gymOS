-- Story 23.9: support connects the payment account (migration 0143).
--   A. step-up gate: missing / reused / wrong-subject grant refuses with no write
--   B. first connect: row, Vault secret, masked id, proxy connected_by, one identity row, audit without a value, Owner + Super Admin notices + queue
--   C. replace retires (kept), rollback to an earlier merchant is a new row, 0083 collision guard, Owner path uses the same logic
--   D. a payment started before the swap is verified under payments.credentials_id; reconciliation joins on it
--   E. cleanup job: 7 days, nothing pending/processing, 14-day cap, job_runs, deleted credential resolves to nothing
--   F. queue worker interface (claim, retry, give up) and the notices reader
--   G. identity reader (Super Admin) and the catalog / scan
begin;
select plan(105);

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
create or replace function pg_temp.live_support() returns void language sql as $f$
  select pg_temp.claims('00000000-0000-0000-0000-000000239101', 'support', 'aal2', '00000000-0000-0000-0000-000000239001', '00000000-0000-0000-0000-0000000239a1') $f$;
create or replace function pg_temp.as_owner() returns void language sql as $f$
  select pg_temp.claims('00000000-0000-0000-0000-000000239102', 'owner', 'aal1', '00000000-0000-0000-0000-000000239001') $f$;
create or replace function pg_temp.as_admin() returns void language sql as $f$
  select pg_temp.claims('00000000-0000-0000-0000-000000239103', 'super_admin', 'aal2', null, '00000000-0000-0000-0000-0000000239a9') $f$;
create or replace function pg_temp.grant_stepup(p_subject text default '00000000-0000-0000-0000-000000239001') returns void language sql as $f$
  select private.stepup_issue('00000000-0000-0000-0000-000000239101', 'support_payment_connection', p_subject) $f$;
create or replace function pg_temp.connect(p_biz text, p_key text default 'apikey-239') returns text language sql as $f$
  select pg_temp.err(format('select support_connect_gym_payment_credentials(%L, %L, %L, %L)', 'taramoney', p_key, p_biz, 'whsecret-239')) $f$;
create or replace function pg_temp.active_id() returns uuid language sql as $f$
  select id from gym_payment_credentials where gym_id = '00000000-0000-0000-0000-000000239001' and provider_key = 'taramoney' and retired_at is null $f$;

-- ---- fixtures ---------------------------------------------------------------------------------------------------
insert into tiers (id, name, monthly_price, annual_price, member_cap) values ('00000000-0000-0000-0000-000000239301', 'Conn Tier', 5000, 50000, 30);
insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-000000239001', 'Conn Gym A', '00000000-0000-0000-0000-000000239301', 30),
  ('00000000-0000-0000-0000-000000239002', 'Conn Gym B', '00000000-0000-0000-0000-000000239301', 30);
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000239101', 'real-support-239@gymosapps.com', now()),
  ('00000000-0000-0000-0000-000000239102', 'owner-239@x.example', now()),
  ('00000000-0000-0000-0000-000000239103', 'admin-239@x.example', now()),
  ('00000000-0000-0000-0000-000000239104', 'member-239@x.example', now()),
  ('00000000-0000-0000-0000-000000239105', 'ownerB-239@x.example', now());
update users set display_name = 'Real Support Person' where id = '00000000-0000-0000-0000-000000239101';
update users set is_super_admin = true where id = '00000000-0000-0000-0000-000000239103';
insert into members (id, gym_id, user_id, role, name, email, phone) values
  ('00000000-0000-0000-0000-000000239201', '00000000-0000-0000-0000-000000239001', '00000000-0000-0000-0000-000000239102', 'owner', 'Owner 239', null, '+237600239001'),
  ('00000000-0000-0000-0000-000000239202', '00000000-0000-0000-0000-000000239001', '00000000-0000-0000-0000-000000239104', 'member', 'Member 239', null, null),
  ('00000000-0000-0000-0000-000000239203', '00000000-0000-0000-0000-000000239002', '00000000-0000-0000-0000-000000239105', 'owner', 'Owner B 239', null, '+237600239002');
insert into private.support_accounts (user_id, activated_at) values ('00000000-0000-0000-0000-000000239101', now());
insert into public.support_assignments (id, support_user_id, gym_id, state, activated_at) values
  ('00000000-0000-0000-0000-000000239401', '00000000-0000-0000-0000-000000239101', '00000000-0000-0000-0000-000000239001', 'active', now());
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000239a1', '00000000-0000-0000-0000-000000239101', now(), now()),
  ('00000000-0000-0000-0000-0000000239a9', '00000000-0000-0000-0000-000000239103', now(), now());
insert into private.support_session_state (session_id, user_id, started_at, last_seen_at)
values ('00000000-0000-0000-0000-0000000239a1', '00000000-0000-0000-0000-000000239101', now(), now());
select private.support_set_membership('00000000-0000-0000-0000-000000239401', true);

create temp table proxy as select id from users where support_proxy_gym_id = '00000000-0000-0000-0000-000000239001';
create temp table res (what text, v text);
grant all on res to authenticated;
select count(*)::int as notices_before from staff_notices \gset
select count(*)::int as audit_before from audit_log where action_type = 'gym_payment_credentials_connected' \gset

-- ============================================================================================================
-- A. step-up gate
-- ============================================================================================================
set local role authenticated;
select pg_temp.live_support();
insert into res values ('no_stepup', pg_temp.connect('biz-239-aaaa1111'));
reset role;
select pg_temp.grant_stepup('00000000-0000-0000-0000-000000239002');
set local role authenticated;
select pg_temp.live_support();
insert into res values ('wrong_subject', pg_temp.connect('biz-239-aaaa1111'));
reset role;
delete from private.support_stepup;
select ok(coalesce(((select v from res where what = 'no_stepup')) like 'P0001:step_up_required%', false), 'no step-up: the connect is refused with step_up_required');
select ok(coalesce(((select v from res where what = 'wrong_subject')) like 'P0001:step_up_required%', false), 'a grant bound to another gym does not open this gym');
select is((select count(*)::int from gym_payment_credentials where gym_id = '00000000-0000-0000-0000-000000239001'), 0, 'refused connects wrote no row');
select is((select count(*)::int from vault.secrets where name like 'gym_payment_credentials:00000000-0000-0000-0000-000000239001:%'), 0, 'refused connects wrote no Vault secret');
select is(pg_temp.err($$select private.stepup_issue('00000000-0000-0000-0000-000000239101', 'payment_connection', '00000000-0000-0000-0000-000000239001')$$), '42501:permission_denied',
          'the epic''s bare action name is not an issuable step-up (the stored action is support_payment_connection)');

-- ============================================================================================================
-- B. first connect
-- ============================================================================================================
select pg_temp.grant_stepup();
set local role authenticated;
select pg_temp.live_support();
insert into res values ('first', pg_temp.connect('biz-239-aaaa1111', 'apikey-239-first'));
insert into res values ('reuse', pg_temp.connect('biz-239-aaaa1111', 'apikey-239-first'));
reset role;
select is((select v from res where what = 'first'), 'ok', 'live support with a valid step-up connects');
select ok(coalesce(((select v from res where what = 'reuse')) like 'P0001:step_up_required%', false), 'the step-up is single-use: the same grant does not open a second connect');
select is((select count(*)::int from gym_payment_credentials where gym_id = '00000000-0000-0000-0000-000000239001' and retired_at is null), 1, 'one active row');
select is((select business_id_masked from gym_payment_credentials where id = pg_temp.active_id()), '•••• 1111', 'the masked id is derived server side');
select is((select connected_by from gym_payment_credentials where id = pg_temp.active_id()), (select id from proxy), 'connected_by is the gym proxy, never the real person');
select is((select count(*)::int from vault.secrets s join gym_payment_credentials c on c.credentials_secret_id = s.id where c.id = pg_temp.active_id()), 1, 'the secret is in Vault');
select is((select count(*)::int from support_action_identity where subject_table = 'gym_payment_credentials' and subject_id = pg_temp.active_id()
             and real_user_id = '00000000-0000-0000-0000-000000239101'), 1, 'exactly one identity row names the real person');
select is((select count(*)::int from audit_log where action_type = 'gym_payment_credentials_connected') - :audit_before, 1, 'one audit row for the connect');
select is((select count(*)::int from audit_log where action_type = 'gym_payment_credentials_connected'
             and (metadata::text ilike '%apikey-239%' or metadata::text ilike '%biz-239-aaaa1111%' or metadata::text ilike '%whsecret-239%')), 0,
          'the audit row holds no credential value');
select is((select actor_id from audit_log where action_type = 'gym_payment_credentials_connected' order by created_at desc limit 1), (select id from proxy),
          'the audit actor is the proxy');
select is((select count(*)::int from staff_notices where user_id = '00000000-0000-0000-0000-000000239102' and notice_type = 'payment_connection_changed'), 1, 'the Owner got one notice');
select is((select title_en from staff_notices where user_id = '00000000-0000-0000-0000-000000239102' limit 1), 'GymOS Support updated your payment account', 'the Owner notice reads "GymOS Support updated your payment account"');
select is((select title_fr from staff_notices where user_id = '00000000-0000-0000-0000-000000239102' limit 1), 'GymOS Support a mis à jour votre compte de paiement', 'the Owner notice has French text');
select is((select count(*)::int from staff_notices where user_id = '00000000-0000-0000-0000-000000239103' and notice_type = 'payment_connection_changed'), 1, 'the Super Admin got one notice');
select is((select count(*)::int from staff_notices where notice_type = 'payment_connection_changed') - :notices_before, (select count(*)::int from users where is_super_admin and not is_support_proxy) + 1,
          'one notice for the Owner and one per Super Admin, nobody else');
select is((select count(*)::int from staff_notices where title_en || body_en || title_fr || body_fr ~* '(real support|real-support|apikey|biz-239|whsecret)'), 0, 'no notice names the individual or holds a credential value');
select is((select count(*)::int from email_outbox where status = 'pending' and recipient_email in ('owner-239@x.example', 'admin-239@x.example')), 2, 'an e-mail is queued for the Owner and the Super Admin');
select is((select count(*)::int from email_outbox where subject || body ~* '(real support|real-support|apikey|biz-239|whsecret)'), 0, 'no queued e-mail names the individual or holds a credential value');

-- ============================================================================================================
-- D1. a payment started now is stamped with this credential
-- ============================================================================================================
create temp table first_cred as select pg_temp.active_id() as id;
grant all on first_cred to public;
insert into payments (id, gym_id, member_id, amount, currency, method, status, provider, purpose) values
  ('00000000-0000-0000-0000-000000239701', '00000000-0000-0000-0000-000000239001', '00000000-0000-0000-0000-000000239202', 3000, 'XAF', 'mobile_money', 'processing', 'taramoney', 'session'),
  ('00000000-0000-0000-0000-000000239702', '00000000-0000-0000-0000-000000239001', '00000000-0000-0000-0000-000000239202', 3000, 'XAF', 'cash', 'verified', null, 'session');
select is((select credentials_id from payments where id = '00000000-0000-0000-0000-000000239701'), (select id from first_cred), 'a provider payment records the credential row at initiation');
select is((select credentials_id from payments where id = '00000000-0000-0000-0000-000000239702'), null, 'a cash payment records none');
select is(pg_temp.err($$update payments set credentials_id = null where id = '00000000-0000-0000-0000-000000239701'$$), 'ok', 'an update runs');
select is((select credentials_id from payments where id = '00000000-0000-0000-0000-000000239701'), (select id from first_cred), 'but credentials_id cannot be moved after initiation');
select is(pg_temp.err($$insert into payments (gym_id, member_id, amount, currency, method, status, provider, purpose, credentials_id)
                       values ('00000000-0000-0000-0000-000000239001', '00000000-0000-0000-0000-000000239202', 1, 'XAF', 'mobile_money', 'pending', 'taramoney', 'subscription', '00000000-0000-0000-0000-00000000dead')$$),
          'ok', 'a supplied credentials_id is ignored, not trusted');

-- ============================================================================================================
-- C. replace, roll back, collision, Owner path
-- ============================================================================================================
select pg_temp.grant_stepup();
set local role authenticated;
select pg_temp.live_support();
insert into res values ('replace', pg_temp.connect('biz-239-bbbb2222', 'apikey-239-second'));
reset role;
select is((select v from res where what = 'replace'), 'ok', 'replacing succeeds');
select isnt((select retired_at from gym_payment_credentials where id = (select id from first_cred)), null, 'the previous row is retired, not deleted');
select is((select count(*)::int from vault.secrets s join gym_payment_credentials c on c.credentials_secret_id = s.id where c.id = (select id from first_cred)), 1, 'the retired row keeps its secret');
select isnt(pg_temp.active_id(), (select id from first_cred), 'a new active row exists');
select ok((select connected_at from gym_payment_credentials where id = pg_temp.active_id()) >= (select connected_at from gym_payment_credentials where id = (select id from first_cred)), 'the new row carries its own connected_at anchor');
select is((select count(*)::int from staff_notices where user_id = '00000000-0000-0000-0000-000000239102' and notice_type = 'payment_connection_changed'), 2, 'the replacement notified the Owner again');
select is((select count(*)::int from staff_notices where user_id = '00000000-0000-0000-0000-000000239102' and body_en like '%replaced%' and body_fr like '%remplacé%'), 1, 'the replacement notice says replaced (EN and FR)');
create temp table second_cred as select pg_temp.active_id() as id;
grant all on second_cred to public;

select pg_temp.grant_stepup();
set local role authenticated;
select pg_temp.live_support();
insert into res values ('rollback', pg_temp.connect('biz-239-aaaa1111', 'apikey-239-third'));
reset role;
select is((select v from res where what = 'rollback'), 'ok', 'rolling back to the earlier merchant is allowed');
select is((select count(*)::int from gym_payment_credentials where gym_id = '00000000-0000-0000-0000-000000239001' and business_id_plain = 'biz-239-aaaa1111'), 2, 'the earlier merchant now has a retired row and a new active row');
select is((select count(*)::int from gym_payment_credentials where gym_id = '00000000-0000-0000-0000-000000239001' and retired_at is null), 1, 'still one active row');

select vault.create_secret('biz-239-platform', 'platform:taramoney:business_id');
select pg_temp.grant_stepup();
set local role authenticated;
select pg_temp.live_support();
insert into res values ('collision', pg_temp.connect('biz-239-platform'));
reset role;
select ok(coalesce(((select v from res where what = 'collision')) like '%platform''s own account%', false), 'the 0083 collision guard still refuses a platform business id');
select is((select count(*)::int from gym_payment_credentials where business_id_plain = 'biz-239-platform'), 0, 'the refused collision wrote no row');
select is((select count(*)::int from private.support_stepup where action = 'support_payment_connection' and consumed_at is null), 1, 'a refused connect leaves the step-up unconsumed (the transaction rolled back)');

set local role authenticated;
select pg_temp.as_owner();
insert into res values ('owner_support_fn', pg_temp.connect('biz-239-cccc3333'));
insert into res values ('owner', pg_temp.err($$select connect_gym_payment_credentials('taramoney', 'apikey-owner', 'biz-239-dddd4444', 'whsecret-owner')$$));
reset role;
select ok(coalesce(((select v from res where what = 'owner_support_fn')) like '%permission denied%', false), 'an Owner cannot call the support function');
select is((select v from res where what = 'owner'), 'ok', 'the Owner path still connects');
select is((select count(*)::int from gym_payment_credentials where gym_id = '00000000-0000-0000-0000-000000239001' and retired_at is null and business_id_plain = 'biz-239-dddd4444'), 1, 'the Owner path retires and inserts too');
select is((select connected_by from gym_payment_credentials where id = pg_temp.active_id()), '00000000-0000-0000-0000-000000239102'::uuid, 'the Owner is recorded as itself');
select is((select count(*)::int from support_action_identity where subject_table = 'gym_payment_credentials' and subject_id = pg_temp.active_id()), 0, 'no identity row for an Owner action');
select is((select count(*)::int from staff_notices where user_id = '00000000-0000-0000-0000-000000239102' and notice_type = 'payment_connection_changed'), 3, 'an Owner''s own change writes no notice');
select is(pg_temp.err($$select support_connect_gym_payment_credentials('taramoney', 'a', 'b', 'c')$$), 'P0001:permission denied', 'a caller with no session is refused');

-- ============================================================================================================
-- D. pre-swap payment verified under its own credential
-- ============================================================================================================
select is((select credentials_id from payments where id = '00000000-0000-0000-0000-000000239701'), (select id from first_cred), 'after three swaps the payment still points at the credential it started with');
set local role service_role;
select is((select api_key from get_gym_payment_credentials_for_service('00000000-0000-0000-0000-000000239001', 'taramoney', (select credentials_id from payments where id = '00000000-0000-0000-0000-000000239701'))),
          'apikey-239-first', 'the status check resolves the retired credential by id');
select is((select api_key from get_gym_payment_credentials_for_service('00000000-0000-0000-0000-000000239001', 'taramoney')), 'apikey-owner', 'with no id the active credential resolves');
select is((select credentials_id from get_gym_payment_credentials_by_business_id('biz-239-aaaa1111', 'taramoney', null, '00000000-0000-0000-0000-000000239701')),
          (select id from first_cred), 'the webhook lookup prefers the credential the payment was initiated under, even though a newer row has the same business id');
select is((select count(*)::int from get_gym_payment_credentials_by_business_id('biz-239-bbbb2222', 'taramoney')), 0, 'a retired credential no payment references does not verify a webhook');
reset role;

-- reconciliation joins on credentials_id, not on the active row
insert into payment_webhook_events (id, provider_key, provider_transaction_ref, status, amount, currency, matched_payment_id, raw_payload) values
  ('00000000-0000-0000-0000-000000239801', 'taramoney', 'tx-239-1', 'verified', 3000, 'XAF', '00000000-0000-0000-0000-000000239701', '{"businessId":"biz-239-aaaa1111"}');
select run_payment_reconciliation_job();
select is((select count(*)::int from payment_discrepancies where webhook_event_id = '00000000-0000-0000-0000-000000239801' and discrepancy_type = 'wrong_account_settlement'), 0,
          'reconciliation: the pre-swap payment is checked against its own merchant, not the active one');
update payment_webhook_events set raw_payload = '{"businessId":"someone-else"}' where id = '00000000-0000-0000-0000-000000239801';
select run_payment_reconciliation_job();
select is((select count(*)::int from payment_discrepancies where webhook_event_id = '00000000-0000-0000-0000-000000239801' and discrepancy_type = 'wrong_account_settlement'), 1,
          'reconciliation: a settlement to a different merchant is still flagged');

-- ============================================================================================================
-- E. cleanup
-- ============================================================================================================
-- rows: first_cred (payment 239701 processing), second_cred (nothing under it), the third aaaa1111 row (retired by the Owner swap)
update gym_payment_credentials set retired_at = now() - interval '6 days' where id = (select id from second_cred);
select private.payment_connection_cleanup();
select is((select secret_deleted_at from gym_payment_credentials where id = (select id from second_cred)), null, 'cleanup: a row retired 6 days ago is kept');
update gym_payment_credentials set retired_at = now() - interval '8 days' where id in (select id from second_cred union select id from first_cred);
select count(*)::int as runs_before from job_runs where job_name = 'payment_connection_cleanup' \gset
select private.payment_connection_cleanup();
select isnt((select secret_deleted_at from gym_payment_credentials where id = (select id from second_cred)), null, 'cleanup: 8 days and nothing pending, the secret is deleted');
select is((select count(*)::int from vault.secrets s join gym_payment_credentials c on c.credentials_secret_id = s.id where c.id = (select id from second_cred)), 0, 'cleanup: the Vault secret is gone');
select is((select secret_deleted_at from gym_payment_credentials where id = (select id from first_cred)), null, 'cleanup: a row with a payment still processing under it is kept at 8 days');
select is((select count(*)::int from job_runs where job_name = 'payment_connection_cleanup' and status = 'success') - :runs_before, 1, 'cleanup: the run is recorded in job_runs');
select is((select count(*)::int from audit_log where action_type = 'gym_payment_credentials_secret_deleted' and metadata::text !~ '^\{\}$'), 0, 'cleanup: the audit row holds no value');
update gym_payment_credentials set retired_at = now() - interval '15 days' where id = (select id from first_cred);
select private.payment_connection_cleanup();
select isnt((select secret_deleted_at from gym_payment_credentials where id = (select id from first_cred)), null, 'cleanup: the 14-day cap deletes even with a payment still open');
set local role service_role;
select is((select count(*)::int from get_gym_payment_credentials_by_business_id('biz-239-aaaa1111', 'taramoney', null, '00000000-0000-0000-0000-000000239701')), 0,
          'a deleted credential never resolves for its payment, and a later retired row nothing references does not stand in for it');
select is((select count(*)::int from get_gym_payment_credentials_for_service('00000000-0000-0000-0000-000000239001', 'taramoney', (select id from first_cred))), 0,
          'a deleted credential resolves to nothing, so the webhook answers 401');
reset role;
-- a failing delete is recorded and retried
update gym_payment_credentials set retired_at = now() - interval '9 days' where gym_id = '00000000-0000-0000-0000-000000239001' and retired_at is not null and secret_deleted_at is null;
create or replace function public.zz_fail_secret_delete() returns trigger language plpgsql as $f$ begin raise exception 'vault down'; end $f$;
create trigger zz_fail_secret_delete before update on public.gym_payment_credentials for each row when (new.secret_deleted_at is not null) execute function public.zz_fail_secret_delete();
select count(*)::int as fail_before from job_runs where job_name = 'payment_connection_cleanup' and status = 'failure' \gset
select private.payment_connection_cleanup();
select is((select count(*)::int from job_runs where job_name = 'payment_connection_cleanup' and status = 'failure') - :fail_before, 1, 'cleanup: a failure is recorded in job_runs');
drop trigger zz_fail_secret_delete on public.gym_payment_credentials;
drop function public.zz_fail_secret_delete();
select private.payment_connection_cleanup();
select is((select count(*)::int from gym_payment_credentials where gym_id = '00000000-0000-0000-0000-000000239001' and retired_at is not null and secret_deleted_at is null), 0, 'cleanup: the next run retries and succeeds');

-- ============================================================================================================
-- F. queue worker interface and notices reader
-- ============================================================================================================
select count(*)::int as pending_total from email_outbox where status = 'pending' \gset
set local role service_role;
create temp table claimed as select * from claim_email_outbox(2);
reset role;
select is((select count(*)::int from claimed), 2, 'claim returns the requested batch');
select is((select count(*)::int from email_outbox where status = 'sending' and attempts = 1), 2, 'claimed rows are marked sending with an attempt');
select is((select count(*)::int from claim_email_outbox(50) c join claimed on claimed.id = c.id), 0, 'a claimed row is not handed out twice');
select finish_email_outbox((select id from claimed order by id limit 1), true);
select finish_email_outbox((select id from claimed order by id desc limit 1), false, 'EMESSAGE 550 boom');
select is((select status from email_outbox where id = (select id from claimed order by id limit 1)), 'sent', 'a sent row is marked sent');
select is((select status || ':' || last_error from email_outbox where id = (select id from claimed order by id desc limit 1)), 'pending:EMESSAGE 550 boom', 'a failed send is kept for retry with its reason');
update email_outbox set attempts = 5, status = 'sending' where id = (select id from claimed order by id desc limit 1);
select finish_email_outbox((select id from claimed order by id desc limit 1), false, 'again');
select is((select status from email_outbox where id = (select id from claimed order by id desc limit 1)), 'failed', 'after 5 attempts a row is marked failed');
select record_email_outbox_run(1, 1);
select is((select count(*)::int from job_runs where job_name = 'payment_connection_email' and status = 'failure'), 1, 'a worker run with a failure is recorded in job_runs');
select is(has_function_privilege('authenticated', 'public.claim_email_outbox(integer)', 'execute'), false, 'clients cannot claim queue rows');
select is(has_table_privilege('authenticated', 'public.email_outbox', 'select'), false, 'clients cannot read the queue');

set local role authenticated;
select pg_temp.as_owner();
insert into res values ('unread', (select count_unread_staff_notices()::text));
insert into res select 'list', count(*)::text from get_staff_notices(10);
select mark_staff_notices_read();
insert into res values ('unread_after', (select count_unread_staff_notices()::text));
select pg_temp.live_support();
insert into res values ('support_unread', (select count_unread_staff_notices()::text));
reset role;
select is((select v from res where what = 'unread'), '3', 'the Owner sees three unread notices, one per support change (the Owner''s own change wrote none)');
select is((select v from res where what = 'unread_after'), '0', 'marking read clears the count');
select is((select v from res where what = 'support_unread'), '0', 'the support person sees none of the Owner''s notices');

-- ============================================================================================================
-- G. identity reader and catalog
-- ============================================================================================================
update private.platform_flags set enabled = true where flag = 'super_admin_aal2';
create temp table cred_ids as select id from gym_payment_credentials where gym_id = '00000000-0000-0000-0000-000000239001';
grant all on cred_ids to public;
set local role authenticated;
select pg_temp.as_admin();
insert into res select 'admin_reader', count(*)::text || '|' || coalesce(max(real_name), '') from get_support_action_identity('gym_payment_credentials', (select array_agg(id) from cred_ids));
reset role;
select is((select v from res where what = 'admin_reader'), '3|REAL SUPPORT PERSON', 'the Super Admin reader returns the real person behind each support-connected credential row');
select is((select count(*)::int from private.support_capabilities where capability = 'payment_connection'), 3, 'payment_connection is in the allow-list (connect, status and the session probe)');
set local role authenticated;
select pg_temp.live_support();
insert into res values ('probe_support', coalesce((select get_support_connection_gym()::text), 'null'));
select pg_temp.as_owner();
insert into res values ('probe_owner', coalesce((select get_support_connection_gym()::text), 'null'));
reset role;
select is((select v from res where what = 'probe_support'), '00000000-0000-0000-0000-000000239001', 'the session probe returns the gym of a live support session');
select is((select v from res where what = 'probe_owner'), 'null', 'the session probe is NULL for an Owner');
select is((select count(*)::int from pg_proc p where p.proname = 'connect_payment_credentials' and p.prosrc ~ 'record_support_identity' and p.prosrc ~ 'actor_id\(\)'), 1, 'the shared connect function records the identity and the proxy actor');

-- ============================================================================================================
-- H. Owner disconnect (retire or delete), needs_attention targeting, suspended gym
-- ============================================================================================================
create or replace function pg_temp.seed_cred(p_biz text) returns uuid language plpgsql as $f$
declare sid uuid; cid uuid;
begin
  sid := vault.create_secret('{}', 'seed-239-' || gen_random_uuid());
  insert into gym_payment_credentials (gym_id, provider_key, credentials_secret_id, business_id_masked, business_id_plain)
  values ('00000000-0000-0000-0000-000000239002', 'taramoney', sid, '••••', p_biz) returning id into cid;
  return cid;
end $f$;
create or replace function pg_temp.as_owner_b() returns void language sql as $f$
  select pg_temp.claims('00000000-0000-0000-0000-000000239105', 'owner', 'aal1', '00000000-0000-0000-0000-000000239002') $f$;
create temp table dc (what text, cid uuid, sid uuid);
grant all on dc to public;

-- (a) nothing references the row: it is deleted with its secret
insert into dc select 'none', pg_temp.seed_cred('biz-b-none'), null;
update dc set sid = (select credentials_secret_id from gym_payment_credentials where id = dc.cid) where what = 'none';
set local role authenticated;
select pg_temp.as_owner_b();
select disconnect_gym_payment_credentials('taramoney');
reset role;
select is((select count(*)::int from gym_payment_credentials where id = (select cid from dc where what = 'none')), 0, 'disconnect: a row no payment references is deleted');
select is((select count(*)::int from vault.secrets where id = (select sid from dc where what = 'none')), 0, 'disconnect: and its secret goes with it');

-- (b) a settled payment references the row: retired, secret removed at once
insert into dc select 'settled', pg_temp.seed_cred('biz-b-settled'), null;
update dc set sid = (select credentials_secret_id from gym_payment_credentials where id = dc.cid) where what = 'settled';
insert into payments (gym_id, member_id, amount, currency, method, status, provider, purpose) values
  ('00000000-0000-0000-0000-000000239002', '00000000-0000-0000-0000-000000239203', 1000, 'XAF', 'mobile_money', 'verified', 'taramoney', 'subscription');
set local role authenticated;
select pg_temp.as_owner_b();
select disconnect_gym_payment_credentials('taramoney');
reset role;
select isnt((select retired_at from gym_payment_credentials where id = (select cid from dc where what = 'settled')), null, 'disconnect: a row with a settled payment under it is retired, kept');
select isnt((select secret_deleted_at from gym_payment_credentials where id = (select cid from dc where what = 'settled')), null, 'disconnect: and its secret is removed at once (nothing pending)');
select is((select count(*)::int from vault.secrets where id = (select sid from dc where what = 'settled')), 0, 'disconnect: the Vault secret is gone');

-- (c) a payment still processing: retired, secret kept for the cleanup job
insert into dc select 'open', pg_temp.seed_cred('biz-b-open'), null;
update dc set sid = (select credentials_secret_id from gym_payment_credentials where id = dc.cid) where what = 'open';
insert into payments (gym_id, member_id, amount, currency, method, status, provider, purpose) values
  ('00000000-0000-0000-0000-000000239002', '00000000-0000-0000-0000-000000239203', 1000, 'XAF', 'mobile_money', 'processing', 'taramoney', 'subscription');
set local role authenticated;
select pg_temp.as_owner_b();
select disconnect_gym_payment_credentials('taramoney');
reset role;
select isnt((select retired_at from gym_payment_credentials where id = (select cid from dc where what = 'open')), null, 'disconnect: a row with a payment still processing is retired');
select is((select secret_deleted_at from gym_payment_credentials where id = (select cid from dc where what = 'open')), null, 'disconnect: its secret is kept while the payment is open');
select is((select count(*)::int from vault.secrets where id = (select sid from dc where what = 'open')), 1, 'disconnect: the Vault secret is still there');

select set_config('request.jwt.claims', '', true);
-- needs_attention flags only the credential it is told about, and only an active one
update gym_payment_credentials set connected_at = now() - interval '1 minute' where gym_id = '00000000-0000-0000-0000-000000239001';
select mark_gym_payment_credentials_needs_attention('00000000-0000-0000-0000-000000239001', 'taramoney', (select id from first_cred));
select is((select needs_attention from gym_payment_credentials where id = pg_temp.active_id()), false, 'needs_attention: a retired credential id does not flag the active row');
select is((select needs_attention from gym_payment_credentials where id = (select id from first_cred)), false, 'needs_attention: and does not flag the retired row either');
select mark_gym_payment_credentials_needs_attention('00000000-0000-0000-0000-000000239001', 'taramoney', pg_temp.active_id());
select is((select needs_attention from gym_payment_credentials where id = pg_temp.active_id()), true, 'needs_attention: the matching active id flags the active row');

-- a suspended gym refuses the support connect and leaves the step-up unconsumed
insert into gyms (id, name, tier_id, capacity, status) values
  ('00000000-0000-0000-0000-000000239003', 'Conn Gym C', '00000000-0000-0000-0000-000000239301', 30, 'suspended');
insert into public.support_assignments (id, support_user_id, gym_id, state, activated_at) values
  ('00000000-0000-0000-0000-000000239402', '00000000-0000-0000-0000-000000239101', '00000000-0000-0000-0000-000000239003', 'active', now());
select pg_temp.grant_stepup('00000000-0000-0000-0000-000000239003');
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-000000239101', 'support', 'aal2', '00000000-0000-0000-0000-000000239003', '00000000-0000-0000-0000-0000000239a1');
insert into res values ('suspended', pg_temp.connect('biz-239-susp'));
reset role;
select isnt((select v from res where what = 'suspended'), 'ok', 'a suspended gym refuses the support connect');
select is((select count(*)::int from gym_payment_credentials where gym_id = '00000000-0000-0000-0000-000000239003'), 0, 'and nothing is written for it');
select is((select count(*)::int from private.support_stepup where action = 'support_payment_connection' and subject_id = '00000000-0000-0000-0000-000000239003' and consumed_at is null), 1, 'and the step-up is left unconsumed');

-- housekeeping in the cleanup job
insert into email_outbox (recipient_email, subject, body, status, created_at) values
  ('old-sent@x.example', 's', 'b', 'sent', now() - interval '91 days'),
  ('old-failed@x.example', 's', 'b', 'failed', now() - interval '91 days'),
  ('old-pending@x.example', 's', 'b', 'pending', now() - interval '91 days'),
  ('new-sent@x.example', 's', 'b', 'sent', now() - interval '10 days');
insert into staff_notices (user_id, gym_id, notice_type, title_en, title_fr, body_en, body_fr, created_at) values
  ('00000000-0000-0000-0000-000000239102', '00000000-0000-0000-0000-000000239001', 'zz_old', 't', 't', 'b', 'b', now() - interval '181 days'),
  ('00000000-0000-0000-0000-000000239102', '00000000-0000-0000-0000-000000239001', 'zz_new', 't', 't', 'b', 'b', now() - interval '100 days');
select private.payment_connection_cleanup();
select is((select count(*)::int from email_outbox where recipient_email in ('old-sent@x.example', 'old-failed@x.example')), 0, 'cleanup: sent and failed queue rows older than 90 days are purged');
select is((select count(*)::int from email_outbox where recipient_email in ('old-pending@x.example', 'new-sent@x.example')), 2, 'cleanup: a pending row and a recent row stay');
select is((select count(*)::int from staff_notices where notice_type = 'zz_old'), 0, 'cleanup: notices older than 180 days are purged');
select is((select count(*)::int from staff_notices where notice_type = 'zz_new'), 1, 'cleanup: a recent notice stays');
select is((select count(*)::int from job_runs where job_name = 'payment_connection_cleanup' and error like '%2 mails and 1 notices purged%'), 1, 'cleanup: the purge is recorded in the same job_runs row');

-- a worker row stuck sending after its last attempt is given up on, never claimed again
insert into email_outbox (id, recipient_email, subject, body, status, attempts, claimed_at) values
  ('00000000-0000-0000-0000-000000239f01', 'stuck@x.example', 's', 'b', 'sending', 5, now() - interval '11 minutes'),
  ('00000000-0000-0000-0000-000000239f02', 'stuck2@x.example', 's', 'b', 'sending', 2, now() - interval '11 minutes');
set local role service_role;
create temp table reclaimed as select * from claim_email_outbox(50);
reset role;
select is((select status from email_outbox where id = '00000000-0000-0000-0000-000000239f01'), 'failed', 'claim: a row stuck sending at 5 attempts is marked failed');
select is((select count(*)::int from reclaimed where id = '00000000-0000-0000-0000-000000239f01'), 0, 'claim: and is not handed out');
select is((select count(*)::int from reclaimed where id = '00000000-0000-0000-0000-000000239f02'), 1, 'claim: a stuck row with attempts left is claimed again');

select * from finish();
rollback;
