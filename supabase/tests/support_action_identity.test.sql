-- Story 23.8: audit under the individual, disclosure and member-facing surfaces (migration 0142).
--   A. the identity table: RLS on, no client privilege, no policy
--   B. identity rows written with the action (audit, payments, refunds, dismissed_by); none for anyone else
--   C. fail closed: no identity row, no action
--   D. Super Admin read at live AAL2 only
--   E. per-surface scan as Owner, Supervisor and Manager of a gym where support acted (real id, name, phone, email never returned)
--   F. disclosure request, answer, window read from private.session_limit()
--   G. catalog scans (retro 66): every actor column has identity cover; each scan shown to fail on a seeded bad case
begin;
select plan(91);

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
  select pg_temp.claims('00000000-0000-0000-0000-000000238101', 'support', 'aal2', gym, '00000000-0000-0000-0000-0000000238a1') $f$;
create or replace function pg_temp.as_owner() returns void language sql as $f$
  select pg_temp.claims('00000000-0000-0000-0000-000000238102', 'owner', 'aal1', '00000000-0000-0000-0000-000000238001') $f$;
create or replace function pg_temp.as_manager() returns void language sql as $f$
  select pg_temp.claims('00000000-0000-0000-0000-000000238103', 'manager', 'aal1', '00000000-0000-0000-0000-000000238001') $f$;
create or replace function pg_temp.as_supervisor() returns void language sql as $f$
  select pg_temp.claims('00000000-0000-0000-0000-000000238104', 'supervisor', 'aal1', '00000000-0000-0000-0000-000000238001') $f$;
create or replace function pg_temp.as_admin(aal text default 'aal2') returns void language sql as $f$
  select pg_temp.claims('00000000-0000-0000-0000-000000238106', 'super_admin', aal, null, '00000000-0000-0000-0000-0000000238a9') $f$;
create or replace function pg_temp.proxy_of(gym text) returns uuid language sql as $f$
  select id from public.users where support_proxy_gym_id = gym::uuid $f$;

-- ---- fixtures ---------------------------------------------------------------------------------------------------
insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000238301', 'Identity Tier', 5000, 50000, 30);
insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-000000238001', 'Identity Gym A', '00000000-0000-0000-0000-000000238301', 30),
  ('00000000-0000-0000-0000-000000238002', 'Identity Gym B', '00000000-0000-0000-0000-000000238301', 30);
insert into auth.users (id, email, phone, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000238101', 'zed.realperson@gymosapps.com', '+237677238101', now()),
  ('00000000-0000-0000-0000-000000238102', 'owner-238@x.example', null, now()),
  ('00000000-0000-0000-0000-000000238103', 'manager-238@x.example', null, now()),
  ('00000000-0000-0000-0000-000000238104', 'supervisor-238@x.example', null, now()),
  ('00000000-0000-0000-0000-000000238105', 'memberA-238@x.example', null, now()),
  ('00000000-0000-0000-0000-000000238106', 'admin-238@x.example', null, now()),
  ('00000000-0000-0000-0000-000000238107', 'ownerB-238@x.example', null, now());
update users set display_name = 'Zed Realperson', phone = '+237677238101' where id = '00000000-0000-0000-0000-000000238101';
update users set is_super_admin = true where id = '00000000-0000-0000-0000-000000238106';
insert into members (id, gym_id, user_id, role, name, email, phone) values
  ('00000000-0000-0000-0000-000000238201', '00000000-0000-0000-0000-000000238001', '00000000-0000-0000-0000-000000238102', 'owner', 'Owner 238', null, '+237600238001'),
  ('00000000-0000-0000-0000-000000238203', '00000000-0000-0000-0000-000000238001', '00000000-0000-0000-0000-000000238103', 'manager', 'Manager 238', null, '+237600238003'),
  ('00000000-0000-0000-0000-000000238206', '00000000-0000-0000-0000-000000238001', '00000000-0000-0000-0000-000000238104', 'supervisor', 'Supervisor 238', null, '+237600238004'),
  ('00000000-0000-0000-0000-000000238204', '00000000-0000-0000-0000-000000238001', '00000000-0000-0000-0000-000000238105', 'member', 'Member A 238', null, null),
  ('00000000-0000-0000-0000-000000238202', '00000000-0000-0000-0000-000000238002', '00000000-0000-0000-0000-000000238107', 'owner', 'Owner B 238', null, '+237600238002');
insert into plans (id, gym_id, name, plan_type, price, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000238501', '00000000-0000-0000-0000-000000238001', 'Per Session A', 'pay_per_session', 2000, 'monthly', null);
insert into subscriptions (id, gym_id, member_id, plan_id, status, start_date, expiry_date) values
  ('00000000-0000-0000-0000-000000238601', '00000000-0000-0000-0000-000000238001', '00000000-0000-0000-0000-000000238204', '00000000-0000-0000-0000-000000238501', 'active', current_date, null);
update members set registration_fee_settled_at = now() where id = '00000000-0000-0000-0000-000000238204';
insert into payments (id, gym_id, member_id, amount, currency, method, status, purpose) values
  ('00000000-0000-0000-0000-000000238701', '00000000-0000-0000-0000-000000238001', '00000000-0000-0000-0000-000000238204', 2000, 'XAF', 'cash', 'verified', 'session');
insert into front_desk_alerts (id, gym_id, member_id, status, expiry_date) values
  ('00000000-0000-0000-0000-000000238901', '00000000-0000-0000-0000-000000238001', '00000000-0000-0000-0000-000000238204', 'expiring_soon', current_date + 3);
insert into attendance_events (gym_id, member_id) values ('00000000-0000-0000-0000-000000238001', '00000000-0000-0000-0000-000000238204');
update gyms set charge_guests_per_session = true where id = '00000000-0000-0000-0000-000000238001';

insert into private.support_accounts (user_id, activated_at) values ('00000000-0000-0000-0000-000000238101', now());
-- 23.10: probe action types allowed for a live support caller
insert into private.support_audit_actions values ('identity_probe'), ('identity_blocked_probe');
insert into public.support_assignments (id, support_user_id, gym_id, state, activated_at) values
  ('00000000-0000-0000-0000-000000238401', '00000000-0000-0000-0000-000000238101', '00000000-0000-0000-0000-000000238001', 'active', now());
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000238a1', '00000000-0000-0000-0000-000000238101', now(), now()),
  ('00000000-0000-0000-0000-0000000238a9', '00000000-0000-0000-0000-000000238106', now(), now());
insert into private.support_session_state (session_id, user_id, started_at, last_seen_at)
values ('00000000-0000-0000-0000-0000000238a1', '00000000-0000-0000-0000-000000238101', now(), now());
select private.support_set_membership('00000000-0000-0000-0000-000000238401', true);
update private.platform_flags set enabled = true where flag = 'super_admin_aal2';

-- ============================================================================================================
-- A. the identity table
-- ============================================================================================================
select is((select relrowsecurity from pg_class where oid = 'public.support_action_identity'::regclass), true, 'support_action_identity: RLS is on');
select is((select count(*)::int from pg_policy where polrelid = 'public.support_action_identity'::regclass), 0, 'support_action_identity: no client policy');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r
            where has_table_privilege(r, 'public.support_action_identity', 'select,insert,update,delete')), 0,
          'support_action_identity: no client role holds any privilege');
select is((select count(*)::int from pg_policy where polrelid = 'public.audit_disclosure_requests'::regclass), 0, 'audit_disclosure_requests: no client policy');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r
            where has_table_privilege(r, 'public.audit_disclosure_requests', 'select,insert,update,delete')), 0, 'audit_disclosure_requests: no client role holds any privilege');

-- ============================================================================================================
-- B. identity rows are written with the action
-- ============================================================================================================
select private.stepup_issue('00000000-0000-0000-0000-000000238101', 'support_refund', '00000000-0000-0000-0000-000000238701');
set local role authenticated;
select pg_temp.live_support('00000000-0000-0000-0000-000000238001');
select is(pg_temp.err($$select record_session_payment('00000000-0000-0000-0000-000000238204', 'cash', null)$$), 'ok', 'support records a session payment');
select is(pg_temp.err($$insert into refunds (id, gym_id, payment_id, amount, reason) values ('00000000-0000-0000-0000-000000238801', '00000000-0000-0000-0000-000000238001', '00000000-0000-0000-0000-000000238701', 500, 'r')$$),
          'ok', 'support refunds a payment');
select is(pg_temp.err($$select log_audit_event('identity_probe', '00000000-0000-0000-0000-000000238001')$$), 'ok', 'support audits into its gym');
select pg_temp.as_manager();
select is(pg_temp.err($$select record_session_payment('00000000-0000-0000-0000-000000238204', 'cash', null)$$), 'ok', 'a manager records a session payment');
reset role;
-- the front desk dismissal is a BEFORE UPDATE trigger, so it runs for any role; run it as the table owner with the support claims
select pg_temp.live_support('00000000-0000-0000-0000-000000238001');
update front_desk_alerts set dismissed_at = now() where id = '00000000-0000-0000-0000-000000238901';
select set_config('request.jwt.claims', '', true);

select is((select count(*)::int from support_action_identity i join payments p on p.id = i.subject_id
            where i.subject_table = 'payments' and i.real_user_id = '00000000-0000-0000-0000-000000238101' and i.gym_id = p.gym_id
              and p.actor_id = pg_temp.proxy_of('00000000-0000-0000-0000-000000238001')), 1, 'payment: one identity row holds the real id, the payment holds the proxy');
select is((select count(*)::int from support_action_identity i join refunds r on r.id = i.subject_id
            where i.subject_table = 'refunds' and i.real_user_id = '00000000-0000-0000-0000-000000238101' and r.actor_id = pg_temp.proxy_of('00000000-0000-0000-0000-000000238001')), 1,
          'refund: one identity row holds the real id, the refund holds the proxy');
select is((select count(*)::int from support_action_identity i join audit_log a on a.id = i.subject_id
            where i.subject_table = 'audit_log' and i.real_user_id = '00000000-0000-0000-0000-000000238101' and a.action_type = 'identity_probe'
              and a.actor_id = pg_temp.proxy_of('00000000-0000-0000-0000-000000238001') and a.actor_display_name = 'GymOS Support'), 1,
          'audit: one identity row holds the real id, the audit row holds the proxy');
select is((select count(*)::int from support_action_identity i join audit_log a on a.id = i.subject_id
            where i.subject_table = 'audit_log' and a.action_type = 'session_payment_recorded'), 1, 'the audit row an RPC writes gets its identity row too');
select is((select count(*)::int from support_action_identity i join front_desk_alerts f on f.id = i.subject_id
            where i.subject_table = 'front_desk_alerts' and i.real_user_id = '00000000-0000-0000-0000-000000238101' and f.dismissed_by = pg_temp.proxy_of('00000000-0000-0000-0000-000000238001')), 1,
          'dismissed_by: one identity row holds the real id');
select is((select count(*)::int from support_action_identity where gym_id <> '00000000-0000-0000-0000-000000238001'), 0, 'every identity row names the gym where support acted');
select is((select count(*)::int from support_action_identity i join payments p on p.id = i.subject_id where i.subject_table = 'payments' and p.actor_id = '00000000-0000-0000-0000-000000238103'), 0,
          'a manager''s payment has no identity row');
select is((select count(*)::int from support_action_identity i join audit_log a on a.id = i.subject_id where a.actor_id = '00000000-0000-0000-0000-000000238103'), 0, 'a manager''s audit row has no identity row');
select is((select count(*)::int from support_action_identity where real_user_id <> '00000000-0000-0000-0000-000000238101'), 0, 'only the support person is ever recorded');
select is(pg_temp.err($$select private.record_support_identity('payments', '00000000-0000-0000-0000-000000238701', '00000000-0000-0000-0000-000000238001')$$), 'ok',
          'record_support_identity is a no-op with no live support session');
select is((select count(*)::int from support_action_identity where subject_id = '00000000-0000-0000-0000-000000238701'), 0, 'the no-op wrote nothing');
-- a client-supplied actor is still ignored (0141), and the identity row is still the real caller, not the supplied value
set local role authenticated;
select pg_temp.live_support('00000000-0000-0000-0000-000000238001');
select is(pg_temp.err($$insert into payments (id, gym_id, member_id, amount, currency, method, status, purpose, actor_id) values ('00000000-0000-0000-0000-000000238711', '00000000-0000-0000-0000-000000238001', '00000000-0000-0000-0000-000000238204', 3000, 'XAF', 'cash', 'pending', 'subscription', '00000000-0000-0000-0000-000000238103')$$),
          'ok', 'support inserts a payment naming a manager as the actor');
reset role;
select is((select actor_id from payments where id = '00000000-0000-0000-0000-000000238711'), pg_temp.proxy_of('00000000-0000-0000-0000-000000238001'), 'the client-supplied actor is ignored');
select is((select real_user_id from support_action_identity where subject_id = '00000000-0000-0000-0000-000000238711'), '00000000-0000-0000-0000-000000238101'::uuid,
          'the identity row is the real caller, never the supplied actor');

-- ============================================================================================================
-- C. fail closed
-- ============================================================================================================
create function public.zz_block_identity() returns trigger language plpgsql as $f$ begin raise exception 'identity blocked'; end $f$;
create trigger zz_block_identity before insert on public.support_action_identity for each row execute function public.zz_block_identity();
set local role authenticated;
select pg_temp.live_support('00000000-0000-0000-0000-000000238001');
select is(pg_temp.err($$insert into payments (id, gym_id, member_id, amount, currency, method, status, purpose) values ('00000000-0000-0000-0000-000000238712', '00000000-0000-0000-0000-000000238001', '00000000-0000-0000-0000-000000238204', 3000, 'XAF', 'cash', 'pending', 'subscription')$$),
          'P0001:identity blocked', 'no identity row: the payment fails');
select is(pg_temp.err($$select log_audit_event('identity_blocked_probe', '00000000-0000-0000-0000-000000238001')$$), 'P0001:identity blocked', 'no identity row: the audit write fails');
select is(pg_temp.err($$select record_session_payment('00000000-0000-0000-0000-000000238204', 'cash', null)$$), 'P0001:identity blocked', 'no identity row: the RPC fails');
select pg_temp.as_manager();
select is(pg_temp.err($$select log_audit_event('identity_manager_probe', '00000000-0000-0000-0000-000000238001')$$), 'ok', 'a non-support writer never reaches the identity table');
reset role;
select is((select count(*)::int from payments where id = '00000000-0000-0000-0000-000000238712') + (select count(*)::int from audit_log where action_type in ('identity_blocked_probe')), 0,
          'nothing was left behind by the refused actions');
drop trigger zz_block_identity on public.support_action_identity;
drop function public.zz_block_identity();
select is(pg_temp.err($$select private.record_support_identity('payments', '00000000-0000-0000-0000-000000238701', '00000000-0000-0000-0000-000000238002')$$), 'ok',
          'record_support_identity with no live session is still a no-op for a foreign gym id');
select pg_temp.live_support('00000000-0000-0000-0000-000000238001');
select is(pg_temp.err($$select private.record_support_identity('payments', '00000000-0000-0000-0000-000000238701', '00000000-0000-0000-0000-000000238002')$$), 'P0001:support_identity_missing',
          'a live support caller cannot record an identity under another gym');
select set_config('request.jwt.claims', '', true);

-- ============================================================================================================
-- D. Super Admin read
-- ============================================================================================================
create temp table pay_ids as select id from payments where actor_id = pg_temp.proxy_of('00000000-0000-0000-0000-000000238001');
grant all on pay_ids to authenticated;
set local role authenticated;
select pg_temp.as_admin();
create temp table adm (what text, n bigint, extra text);
grant all on adm to authenticated;
insert into adm select 'admin_rows', count(*), max(real_name || '|' || real_email) from get_support_action_identity('payments', (select array_agg(id) from pay_ids));
select pg_temp.as_admin('aal1');
insert into adm values ('admin_aal1', 0, pg_temp.err($$select * from get_support_action_identity('payments', array['00000000-0000-0000-0000-000000238701']::uuid[])$$));
select pg_temp.as_owner();
insert into adm values ('owner', 0, pg_temp.err($$select * from get_support_action_identity('payments', array['00000000-0000-0000-0000-000000238701']::uuid[])$$));
insert into adm values ('owner_table', 0, pg_temp.err($$select count(*) from support_action_identity$$));
select pg_temp.as_manager();
insert into adm values ('manager', 0, pg_temp.err($$select * from get_support_action_identity('payments', array['00000000-0000-0000-0000-000000238701']::uuid[])$$));
select pg_temp.as_supervisor();
insert into adm values ('supervisor', 0, pg_temp.err($$select * from get_support_action_identity('payments', array['00000000-0000-0000-0000-000000238701']::uuid[])$$));
select pg_temp.live_support('00000000-0000-0000-0000-000000238001');
insert into adm values ('support', 0, pg_temp.err($$select * from get_support_action_identity('payments', array['00000000-0000-0000-0000-000000238701']::uuid[])$$));
insert into adm values ('support_table', 0, pg_temp.err($$select count(*) from support_action_identity$$));
reset role;
select is((select n from adm where what = 'admin_rows'), (select count(*) from pay_ids), 'Super Admin at AAL2 reads the identity rows');
select is((select extra from adm where what = 'admin_rows'), 'ZED REALPERSON|zed.realperson@gymosapps.com', 'Super Admin sees the real name and email');
select is((select extra from adm where what = 'admin_aal1'), 'P0001:permission denied', 'Super Admin below AAL2 is refused');
select is((select extra from adm where what = 'owner'), 'P0001:permission denied', 'Owner is refused');
select is((select extra from adm where what = 'manager'), 'P0001:permission denied', 'Manager is refused');
select is((select extra from adm where what = 'supervisor'), 'P0001:permission denied', 'Supervisor is refused');
select is((select extra from adm where what = 'support'), 'P0001:permission denied', 'support itself is refused');
select is((select extra from adm where what = 'owner_table'), '42501:permission denied for table support_action_identity', 'Owner cannot select the table');
select is((select extra from adm where what = 'support_table'), '42501:permission denied for table support_action_identity', 'support cannot select the table');

-- the opaque proxy id a gym or member screen uses to label the proxy
create temp table pid (who text, id uuid);
grant all on pid to authenticated;
set local role authenticated;
select pg_temp.as_owner();
insert into pid select 'owner', get_gym_support_proxy_id();
select pg_temp.claims('00000000-0000-0000-0000-000000238105', 'member', 'aal1', '00000000-0000-0000-0000-000000238001');
insert into pid select 'member', get_gym_support_proxy_id();
select pg_temp.claims('00000000-0000-0000-0000-000000238107', 'owner', 'aal1', '00000000-0000-0000-0000-000000238002');
insert into pid select 'ownerB', get_gym_support_proxy_id();
select pg_temp.live_support('00000000-0000-0000-0000-000000238001');
insert into pid select 'support', get_gym_support_proxy_id();
reset role;
select is((select id from pid where who = 'owner'), pg_temp.proxy_of('00000000-0000-0000-0000-000000238001'), 'get_gym_support_proxy_id: an Owner gets the gym''s proxy id');
select is((select id from pid where who = 'member'), pg_temp.proxy_of('00000000-0000-0000-0000-000000238001'), 'get_gym_support_proxy_id: a member gets the gym''s proxy id');
select is((select id from pid where who = 'ownerB'), pg_temp.proxy_of('00000000-0000-0000-0000-000000238002'), 'get_gym_support_proxy_id: another gym gets its own, unrelated proxy id');
select is((select id from pid where who = 'support'), null::uuid, 'get_gym_support_proxy_id: support itself gets nothing');

-- ============================================================================================================
-- E. per-surface scan: nothing a gym role can read holds the real id, name, phone or email
-- ============================================================================================================
-- Every public table and view the current role can select from is searched as text (row_to_json), so a column added to any surface later
-- (staff list = members, audit trail, payments, refunds, session notes, check-ins = attendance_events, notifications, front desk alerts,
-- Realtime payloads = the same RLS-filtered rows) is covered without being listed. CSV exports and error logs are app code (unit tests).
create or replace function pg_temp.leaks(needles text[]) returns text language plpgsql as $f$
declare
  t record;
  n bigint;
  hits text := '';
begin
  for t in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'p') order by 1 loop
    begin
      execute format('select count(*) from public.%I x where %s', t.relname,
                     (select string_agg(format('row_to_json(x)::text ilike %L', '%' || nd || '%'), ' or ') from unnest(needles) nd)) into n;
      if n > 0 then hits := hits || t.relname || ':' || n || ' '; end if;
    exception when insufficient_privilege then null;
    end;
  end loop;
  return hits;
end $f$;
create temp table proxy as select pg_temp.proxy_of('00000000-0000-0000-0000-000000238001') as id;
grant all on proxy to authenticated;
create temp table scan (who text, hits text);
grant all on scan to authenticated;
set local role authenticated;
select pg_temp.as_owner();
insert into scan values ('owner', pg_temp.leaks(array['00000000-0000-0000-0000-000000238101', 'Zed Realperson', '677238101', 'zed.realperson']));
select pg_temp.as_manager();
insert into scan values ('manager', pg_temp.leaks(array['00000000-0000-0000-0000-000000238101', 'Zed Realperson', '677238101', 'zed.realperson']));
select pg_temp.as_supervisor();
insert into scan values ('supervisor', pg_temp.leaks(array['00000000-0000-0000-0000-000000238101', 'Zed Realperson', '677238101', 'zed.realperson']));
-- the proxy is what the gym sees: control that the scan can find a value that IS visible
select pg_temp.as_owner();
insert into scan values ('owner_control', pg_temp.leaks(array[(select id::text from proxy), 'GymOS Support']));
reset role;
-- control that the scan can find the real person where the data holds it: the same scan as the table owner (no RLS)
insert into scan values ('admin_control', pg_temp.leaks(array['00000000-0000-0000-0000-000000238101', 'Zed Realperson']));
select is((select hits from scan where who = 'owner'), '', 'Owner: no surface returns the real id, name, phone or email');
select is((select hits from scan where who = 'manager'), '', 'Manager: no surface returns the real id, name, phone or email');
select is((select hits from scan where who = 'supervisor'), '', 'Supervisor: no surface returns the real id, name, phone or email');
select isnt((select hits from scan where who = 'admin_control'), '', 'control: the scan finds the real person where the data does hold it (no RLS)');
select matches((select hits from scan where who = 'owner_control'), 'audit_log:.*payments:', 'control: the scan finds the proxy in the audit trail and payments the Owner can read');
select matches((select hits from scan where who = 'owner_control'), 'refunds:', 'control: the scan finds the proxy in refunds the Owner can read');

-- ============================================================================================================
-- F. disclosure request and answer
-- ============================================================================================================
create temp table ids as select a.id from audit_log a where a.action_type = 'identity_probe';
grant all on ids to authenticated;
insert into audit_log (id, gym_id, actor_id, actor_display_name, action_type) values
  ('00000000-0000-0000-0000-000000238b02', '00000000-0000-0000-0000-000000238002', '00000000-0000-0000-0000-000000238107', 'Owner B 238', 'gym_b_event');
create temp table req_ids (id uuid, question text);
grant all on req_ids to authenticated;
create temp table res (what text, v text);
grant all on res to authenticated;

select is(private.add_business_days('2026-10-23 10:00+00', 3), '2026-10-28 10:00+00'::timestamptz, 'three business days from a Friday is the next Wednesday');
select is(private.add_business_days('2026-10-21 10:00+00', 3), '2026-10-26 10:00+00'::timestamptz, 'three business days from a Wednesday is the next Monday');
select is(private.session_limit('disclosure_answer_business_days'), 3, 'the answer window is read from private.session_limit(): 3 business days');

set local role authenticated;
select pg_temp.as_owner();
insert into res select 'file', ok::text || ':' || code from file_audit_disclosure_request((select id from ids), 'Who made this change?');
insert into res select 'dup', ok::text || ':' || code from file_audit_disclosure_request((select id from ids), 'Asking again');
insert into res select 'short', ok::text || ':' || code from file_audit_disclosure_request((select id from ids), 'x');
insert into res select 'other_gym', ok::text || ':' || code from file_audit_disclosure_request('00000000-0000-0000-0000-000000238b02', 'Whose row is this?');
insert into res select 'missing', ok::text || ':' || code from file_audit_disclosure_request(gen_random_uuid(), 'Does it exist?');
insert into res values ('table', pg_temp.err($$select count(*) from audit_disclosure_requests$$));
select pg_temp.as_manager();
insert into res values ('manager', pg_temp.err($$select * from file_audit_disclosure_request((select id from ids), 'Manager asking')$$));
select pg_temp.as_supervisor();
insert into res values ('supervisor', pg_temp.err($$select * from file_audit_disclosure_request((select id from ids), 'Supervisor asking')$$));
select pg_temp.live_support('00000000-0000-0000-0000-000000238001');
insert into res values ('support', pg_temp.err($$select * from file_audit_disclosure_request((select id from ids), 'Support asking')$$));
insert into res values ('support_list', pg_temp.err($$select * from get_gym_disclosure_requests()$$));
select pg_temp.claims('00000000-0000-0000-0000-000000238107', 'owner', 'aal1', '00000000-0000-0000-0000-000000238002');
insert into res select 'ownerB_list', count(*)::text from get_gym_disclosure_requests();
select pg_temp.as_owner();
insert into res select 'owner_list', count(*)::text || ':' || coalesce(max(question), '') from get_gym_disclosure_requests();
reset role;
select is((select v from res where what = 'file'), 'true:ok', 'Owner files a disclosure request against an audit row of their gym');
select is((select v from res where what = 'dup'), 'false:already_open', 'a second open request for the same row is refused');
select is((select v from res where what = 'short'), 'false:question_invalid', 'a too-short question is refused');
select is((select v from res where what = 'other_gym'), 'false:not_found', 'another gym''s audit row is refused');
select is((select v from res where what = 'missing'), 'false:not_found', 'an unknown audit row answers the same as another gym''s');
select is((select v from res where what = 'table'), '42501:permission denied for table audit_disclosure_requests', 'Owner cannot select the request table directly');
select is((select v from res where what = 'manager'), 'P0001:permission denied', 'Manager cannot file');
select is((select v from res where what = 'supervisor'), 'P0001:permission denied', 'Supervisor cannot file');
select is((select v from res where what = 'support'), 'P0001:permission denied', 'support cannot file');
select is((select v from res where what = 'support_list'), 'P0001:permission denied', 'support cannot list the Owner''s requests');
select is((select v from res where what = 'ownerB_list'), '0', 'another gym''s Owner sees none of them');
select is((select v from res where what = 'owner_list'), '1:Who made this change?', 'the Owner lists their own request');
select is((select count(*)::int from audit_log where action_type = 'audit_disclosure_requested' and gym_id = '00000000-0000-0000-0000-000000238001' and actor_id = '00000000-0000-0000-0000-000000238102'
            and (metadata ->> 'audit_log_id')::uuid = (select id from ids)), 1, 'the request wrote one audit row under the Owner');
select cmp_ok((select answer_due_at from audit_disclosure_requests), '>', now() + interval '2 days', 'the due date is at least three days out');
select cmp_ok((select answer_due_at from audit_disclosure_requests), '<=', now() + interval '5 days', 'and at most five calendar days out (three business days)');
select cmp_ok((select extract(isodow from answer_due_at at time zone 'UTC') from audit_disclosure_requests)::int, '<', 6, 'the due day is a weekday');

-- the window is a configured value
update private.session_limits_config set value = 1 where key = 'disclosure_answer_business_days';
set local role authenticated;
select pg_temp.as_owner();
insert into res select 'file2', ok::text || ':' || code from file_audit_disclosure_request((select id from audit_log where action_type = 'session_payment_recorded' limit 1), 'And this one?');
reset role;
update private.session_limits_config set value = 3 where key = 'disclosure_answer_business_days';
insert into req_ids select id, question from audit_disclosure_requests;
select cmp_ok((select answer_due_at from audit_disclosure_requests where question = 'And this one?'), '<', (select answer_due_at from audit_disclosure_requests where question = 'Who made this change?'), 'a configured window of 1 gives an earlier due date than 3 (the key is read, not hard-coded)');

-- Super Admin inbox and answer
set local role authenticated;
select pg_temp.as_admin();
insert into res select 'inbox', count(*)::text || ':' || coalesce(bool_or(gym_name = 'IDENTITY GYM A')::text, '') from get_disclosure_inbox();
insert into res select 'answer_bad', ok::text || ':' || code from answer_audit_disclosure_request((select id from req_ids limit 1), 'x');
insert into res select 'answer', ok::text || ':' || code from answer_audit_disclosure_request((select id from req_ids where question = 'Who made this change?'), 'A GymOS support person, recorded and reviewed.');
insert into res select 'answer_again', ok::text || ':' || code from answer_audit_disclosure_request((select id from req_ids where question = 'Who made this change?'), 'Second answer');
insert into res select 'answer_missing', ok::text || ':' || code from answer_audit_disclosure_request(gen_random_uuid(), 'Nothing to answer here');
select pg_temp.as_admin('aal1');
insert into res values ('inbox_aal1', pg_temp.err($$select * from get_disclosure_inbox()$$));
insert into res values ('answer_aal1', pg_temp.err($$select * from answer_audit_disclosure_request((select id from req_ids limit 1), 'Below AAL2')$$));
select pg_temp.as_owner();
insert into res values ('owner_answer', pg_temp.err($$select * from answer_audit_disclosure_request((select id from req_ids limit 1), 'Owner answering')$$));
insert into res values ('owner_inbox', pg_temp.err($$select * from get_disclosure_inbox()$$));
insert into res select 'owner_sees_answer', coalesce(max(answer), '') from get_gym_disclosure_requests() where question = 'Who made this change?';
reset role;
select is((select v from res where what = 'inbox'), '2:true', 'Super Admin inbox lists the requests with the gym name');
select is((select v from res where what = 'answer_bad'), 'false:answer_invalid', 'a too-short answer is refused');
select is((select v from res where what = 'answer'), 'true:ok', 'Super Admin answers');
select is((select v from res where what = 'answer_again'), 'false:already_answered', 'a request is answered once');
select is((select v from res where what = 'answer_missing'), 'false:not_found', 'an unknown request is not found');
select is((select v from res where what = 'inbox_aal1'), 'P0001:permission denied', 'the inbox needs AAL2');
select is((select v from res where what = 'answer_aal1'), 'P0001:permission denied', 'the answer needs AAL2');
select is((select v from res where what = 'owner_answer'), 'P0001:permission denied', 'an Owner cannot answer');
select is((select v from res where what = 'owner_inbox'), 'P0001:permission denied', 'an Owner cannot read the Super Admin inbox');
select is((select v from res where what = 'owner_sees_answer'), 'A GymOS support person, recorded and reviewed.', 'the Owner sees the answer');
select is((select count(*)::int from audit_log where action_type = 'audit_disclosure_answered' and gym_id is null and actor_id = '00000000-0000-0000-0000-000000238106'), 1, 'the answer wrote one audit row under the Super Admin, with no gym');
select is((select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'audit_disclosure_requests' and column_name = 'answered_by'), 1, 'control: answered_by is stored');
select is((select count(*)::int from pg_proc p where p.proname = 'get_gym_disclosure_requests' and pg_get_function_result(p.oid) ~* 'answered_by'), 0, 'the Owner function never returns answered_by');

-- ============================================================================================================
-- G. catalog scans
-- ============================================================================================================
-- G1: every column with a foreign key to users has identity cover or a named reason it needs none
create temp table identity_cover (col text primary key, how text not null check (how ~ '^(trigger:[a-z_]+|function:.+)$'));
insert into identity_cover (col, how) values
  ('audit_log.actor_id',                     'trigger:audit_log'),
  ('payments.actor_id',                      'trigger:payments'),
  ('refunds.actor_id',                       'trigger:refunds'),
  ('gym_payment_credentials.connected_by',   'function:private.connect_payment_credentials(uuid,text,text,text,text,boolean)'),
  ('messaging_provider_config.updated_by',   'function:update_messaging_instance(text)'),
  ('front_desk_alerts.dismissed_by',         'function:front_desk_alerts_protect_columns()');
create temp table identity_none (col text primary key, reason text not null);
insert into identity_none (col, reason) values
  ('gym_data_escalations.actor_id',              'Super Admin escalation: the Super Admin is recorded as itself'),
  ('gym_data_escalations.revoked_by',            'Super Admin revoke'),
  ('support_assignments.created_by',             'Super Admin assigns; never gym visible'),
  ('private.support_invites.created_by',         'Super Admin invites; never gym visible'),
  ('audit_disclosure_requests.requested_by',     'Owner-only function; current_member_role() is NULL for support'),
  ('audit_disclosure_requests.answered_by',      'Super Admin answers; never gym visible'),
  ('device_push_tokens.user_id',                 'own device token'),
  ('staff_notices.user_id',                      'the recipient of an in-app notice (23.9); not an actor'),
  ('members.user_id',                            'membership owner'),
  ('private.support_accounts.user_id',           'the support account itself'),
  ('support_assignments.support_user_id',        'the assigned person'),
  ('private.support_invites.user_id',            'the invited person'),
  ('private.support_factor_resets.started_by',   'Super Admin starts a reset (23.11); never gym visible'),
  ('private.support_factor_resets.user_id',      'the person whose authenticator is reset'),
  ('private.support_last_active.user_id',        'the person''s own last activity (23.11)');
create or replace function pg_temp.user_fk_cols() returns setof text language sql as $f$
  select c.conrelid::regclass::text || '.' || a.attname
    from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
   where c.contype = 'f' and c.confrelid = 'public.users'::regclass
     and c.connamespace in ('public'::regnamespace, 'private'::regnamespace) $f$;
create or replace function pg_temp.uncovered_cols() returns setof text language sql as $f$
  select col from pg_temp.user_fk_cols() col where col not in (select col from identity_cover) and col not in (select col from identity_none)
  union all
  select col from identity_cover c where not exists (select 1 from pg_temp.user_fk_cols() x where x = c.col)
  union all
  select col from identity_none c where not exists (select 1 from pg_temp.user_fk_cols() x where x = c.col)
  union all
  -- the cover itself: a trigger on the table whose function records the identity, or a function whose body does
  select c.col from identity_cover c
   where c.how like 'trigger:%'
     and not exists (select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
                      where t.tgrelid = ('public.' || substr(c.how, 9))::regclass and not t.tgisinternal and t.tgenabled = 'O'
                        and t.tgtype & 1 = 1 and t.tgtype & 2 = 0 and t.tgtype & 4 = 4
                        and p.prosrc ~ 'record_support_identity')
  union all
  select c.col from identity_cover c
   where c.how like 'function:%'
     and not exists (select 1 from pg_proc p where p.oid::regprocedure::text = substr(c.how, 10) and p.prosrc ~ 'private\.record_support_identity\(')
  order by 1 $f$;
select is((select count(*)::int from pg_temp.uncovered_cols()), 0, 'scan: every user-FK column has identity cover (trigger or function) or a named reason');

-- G2: every function that calls private.actor_id() either records the identity itself or is a named table-writer covered by that table's trigger
create temp table actor_callers_covered (fn text primary key, covered_by text not null);
insert into actor_callers_covered (fn, covered_by) values
  ('log_audit_event(text,uuid,text,text,jsonb,text)',  'audit_log trigger'),
  ('confirm_renewal(uuid,text,text,boolean)',          'payments trigger'),
  ('initiate_registration_fee_payment(uuid)',          'payments trigger'),
  ('initiate_session_payment()',                       'payments trigger'),
  ('record_registration_fee(uuid,text,text)',          'payments trigger'),
  ('record_session_payment(uuid,text,text)',           'payments trigger'),
  ('private.support_force_actor()',                    'payments and refunds triggers');
create or replace function pg_temp.unrecorded_actor_callers() returns setof text language sql as $f$
  select p.oid::regprocedure::text from pg_proc p
   where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace) and p.prokind in ('f', 'p')
     and p.prosrc ~ 'private\.actor_id\(\)' and p.proname <> 'actor_id'
     and p.prosrc !~ 'private\.record_support_identity\('
     and p.oid::regprocedure::text not in (select fn from actor_callers_covered)
   order by 1 $f$;
select is((select count(*)::int from pg_temp.unrecorded_actor_callers()), 0, 'scan: every private.actor_id() caller records the identity or is a named, trigger-covered writer');
select is((select count(*)::int from actor_callers_covered c where not exists (select 1 from pg_proc p where p.oid::regprocedure::text = c.fn and p.prosrc ~ 'private\.actor_id\(\)')), 0,
          'scan: every covered-writer entry still calls private.actor_id()');

-- seeded bad cases: a new writer that skips identity recording, a new unclassified actor column, and a cover that does not exist
create function public.zz_new_writer() returns uuid language plpgsql as $f$ begin return private.actor_id(); end $f$;
select is((select array_agg(w) from pg_temp.unrecorded_actor_callers() w), array['zz_new_writer()']::text[], 'scan: a new actor_id() caller that skips identity recording is caught');
create table public.zz_bad_actor (id uuid primary key default gen_random_uuid(), done_by uuid references public.users(id));
select is((select array_agg(c) from pg_temp.uncovered_cols() c), array['zz_bad_actor.done_by']::text[], 'scan: a new user-FK column with no cover is caught');
insert into identity_cover values ('zz_bad_actor.done_by', 'trigger:zz_bad_actor');
select is((select array_agg(c) from pg_temp.uncovered_cols() c), array['zz_bad_actor.done_by']::text[], 'scan: a listed trigger cover that does not exist is caught');
create trigger zz_noop after insert on public.zz_bad_actor for each row execute function private.record_support_identity_trigger();
select is((select count(*)::int from pg_temp.uncovered_cols()), 0, 'scan: a real AFTER INSERT trigger that records the identity clears it');
drop trigger zz_noop on public.zz_bad_actor;
update identity_cover set how = 'function:zz_new_writer()' where col = 'zz_bad_actor.done_by';
select is((select array_agg(c) from pg_temp.uncovered_cols() c), array['zz_bad_actor.done_by']::text[], 'scan: a function cover that does not call record_support_identity is caught');
-- the real converted writers pass the same test
select is((select count(*)::int from pg_proc p where p.oid in (
            'private.connect_payment_credentials(uuid,text,text,text,text,boolean)'::regprocedure, 'update_messaging_instance(text)'::regprocedure, 'front_desk_alerts_protect_columns()'::regprocedure)
              and p.prosrc ~ 'private\.record_support_identity\('), 3, 'the three non-trigger writers call private.record_support_identity()');

select * from finish();
rollback;
