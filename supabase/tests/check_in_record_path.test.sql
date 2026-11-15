-- Story 27.2: characterisation test of check_in() (the member scan), written BEFORE the body moved into private.record_check_in.
--
-- It records what the shipped check_in() (0124 body, session gate from 0111) returns, which exception it raises, and what it leaves
-- behind, for every state of the Story 27.2 matrix. This file is committed against the UNMODIFIED function and must pass, byte for byte
-- unchanged, after the migration that replaces it: that is the proof that a scan behaves identically, not an assertion that it does.
--
-- Per case: one assertion for the return (null, or the row's check-in time relative to now(), its check-out time and type) or the
-- raised exception, and one for the side effects through pg_temp.fx(member): attendance rows (and how many are open), active
-- front_desk_alerts (kind/status), session_attempts, consumed guest_sessions, loyalty ledger rows other than the fixture grants, and
-- the attendance audit action types. now() is fixed inside the transaction, so every time is compared as an offset from it.
--
-- Fixture ids: 00000000-0000-0000-0000-0000002720xx (tier and gyms), ...2721xx users, ...2722xx members, ...2723xx plans,
-- ...2724xx scan ids, ...2725xx payments. Default gym auto-timeout is 8 hours.

begin;
select plan(70);

create function pg_temp.mk_grant(p_gym uuid, p_member uuid) returns uuid
language sql security definer as $mk$
  insert into loyalty_events (gym_id, member_id, event_type, counter, origin_id)
  values (p_gym, p_member, 'reward_granted', 'guest', gen_random_uuid()) returning id
$mk$;

-- Side effects of one member, as one comparable string. Read as the postgres role.
create function pg_temp.fx(p_member uuid) returns text language sql as $f$
  select 'att=' || (select count(*) from attendance_events where member_id = p_member)
    || ' open=' || (select count(*) from attendance_events where member_id = p_member and checked_out_at is null)
    || ' alerts=' || coalesce((select string_agg(kind || '/' || coalesce(status::text, '-'), ',' order by kind, status)
                               from front_desk_alerts where member_id = p_member and dismissed_at is null), '')
    || ' attempts=' || (select count(*) from session_attempts where member_id = p_member)
    || ' consumed=' || (select count(*) from guest_sessions where member_id = p_member and consumed_at is not null)
    || ' loyalty=' || (select count(*) from loyalty_events where member_id = p_member and event_type <> 'reward_granted')
    || ' audit=' || coalesce((select string_agg(action_type, ',' order by action_type) from audit_log
                              where metadata ->> 'member_id' = p_member::text and action_type like 'attendance%'), '')
$f$;

-- One-line summary of a returned row: 'null', or the row's times as offsets from now().
create function public.zz_cr_sum(ae attendance_events) returns text language sql stable as $f$
  select case when ae.id is null then 'null'
              else 'row in=' || (ae.checked_in_at - now())::text
                   || ' out=' || coalesce((ae.checked_out_at - now())::text, 'open')
                   || ' type=' || coalesce(ae.checkout_type, '-') end
$f$;
grant execute on function public.zz_cr_sum(attendance_events) to authenticated;

insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000272001', 'CR Tier', 6000, 60000, null);

insert into gyms (id, name, tier_id, status, charge_guests_per_session, registration_fee,
                  loyalty_enabled, loyalty_guest_threshold, loyalty_renewal_threshold, loyalty_reward_days) values
  ('00000000-0000-0000-0000-000000272011', 'CR Gym Off',  '00000000-0000-0000-0000-000000272001', 'active',    false, 0,    false, null, null, null),
  ('00000000-0000-0000-0000-000000272012', 'CR Gym On',   '00000000-0000-0000-0000-000000272001', 'active',    true,  0,    true,  4,    3,    10),
  ('00000000-0000-0000-0000-000000272013', 'CR Gym Susp', '00000000-0000-0000-0000-000000272001', 'suspended', false, 0,    false, null, null, null),
  ('00000000-0000-0000-0000-000000272014', 'CR Gym Fee',  '00000000-0000-0000-0000-000000272001', 'active',    false, 5000, false, null, null, null);

insert into auth.users (id)
select ('00000000-0000-0000-0000-0000002721' || lpad(to_hex(g), 2, '0'))::uuid from generate_series(1, 23) g;

-- Members 01-12 Gym Off, 13-14 Gym Susp, 15 Gym Fee, 16-23 Gym On. Deactivated: 06.
insert into members (id, gym_id, user_id, role, name, join_date, deactivated_at)
select ('00000000-0000-0000-0000-0000002722' || lpad(to_hex(g), 2, '0'))::uuid,
       case when g <= 12 then '00000000-0000-0000-0000-000000272011'
            when g <= 14 then '00000000-0000-0000-0000-000000272013'
            when g = 15  then '00000000-0000-0000-0000-000000272014'
            else              '00000000-0000-0000-0000-000000272012' end::uuid,
       ('00000000-0000-0000-0000-0000002721' || lpad(to_hex(g), 2, '0'))::uuid,
       'member', 'CR Member ' || g, current_date,
       case when g = 6 then now() - interval '1 day' end
from generate_series(1, 23) g;

insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000272301', '00000000-0000-0000-0000-000000272011', 'CR Monthly Off', 'monthly',         15000, 'XAF', 'monthly', 30),
  ('00000000-0000-0000-0000-000000272302', '00000000-0000-0000-0000-000000272013', 'CR Monthly Susp', 'monthly',        15000, 'XAF', 'monthly', 30),
  ('00000000-0000-0000-0000-000000272303', '00000000-0000-0000-0000-000000272012', 'CR PPS',          'pay_per_session', 2000, 'XAF', 'monthly', null),
  ('00000000-0000-0000-0000-000000272304', '00000000-0000-0000-0000-000000272012', 'CR PPS 0',        'pay_per_session', 0,    'XAF', 'monthly', null),
  ('00000000-0000-0000-0000-000000272305', '00000000-0000-0000-0000-000000272012', 'CR Monthly On',   'monthly',         15000, 'XAF', 'monthly', 30);

-- Subscriptions. 02 expiring_soon, 03 grace_period, 04 expired, 05 none (no plan), 15 none (awaiting the registration fee).
insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
select m.gym_id, m.id, p.id, s.status::subscription_status, s.start_date, s.expiry_date
from (values
  (1,  'active',        current_date,       current_date + 30, '00000000-0000-0000-0000-000000272301'),
  (2,  'expiring_soon', current_date - 27,  current_date + 3,  '00000000-0000-0000-0000-000000272301'),
  (3,  'grace_period',  current_date - 32,  current_date - 2,  '00000000-0000-0000-0000-000000272301'),
  (4,  'expired',       current_date - 40,  current_date - 10, '00000000-0000-0000-0000-000000272301'),
  (6,  'active',        current_date,       current_date + 30, '00000000-0000-0000-0000-000000272301'),
  (7,  'active',        current_date,       current_date + 30, '00000000-0000-0000-0000-000000272301'),
  (8,  'active',        current_date,       current_date + 30, '00000000-0000-0000-0000-000000272301'),
  (9,  'active',        current_date,       current_date + 30, '00000000-0000-0000-0000-000000272301'),
  (10, 'active',        current_date,       current_date + 30, '00000000-0000-0000-0000-000000272301'),
  (11, 'active',        current_date,       current_date + 30, '00000000-0000-0000-0000-000000272301'),
  (12, 'active',        current_date,       current_date + 30, '00000000-0000-0000-0000-000000272301'),
  (13, 'active',        current_date,       current_date + 30, '00000000-0000-0000-0000-000000272302'),
  (14, 'active',        current_date,       current_date + 30, '00000000-0000-0000-0000-000000272302'),
  (16, 'active',        current_date,       null,              '00000000-0000-0000-0000-000000272303'),
  (17, 'active',        current_date,       null,              '00000000-0000-0000-0000-000000272303'),
  (18, 'active',        current_date,       null,              '00000000-0000-0000-0000-000000272303'),
  (19, 'active',        current_date,       null,              '00000000-0000-0000-0000-000000272304'),
  (20, 'active',        current_date,       null,              '00000000-0000-0000-0000-000000272303'),
  (21, 'active',        current_date,       null,              '00000000-0000-0000-0000-000000272303'),
  (22, 'active',        current_date,       null,              '00000000-0000-0000-0000-000000272303'),
  (23, 'active',        current_date,       current_date + 30, '00000000-0000-0000-0000-000000272305')
) as s(n, status, start_date, expiry_date, plan_id)
join members m on m.id = ('00000000-0000-0000-0000-0000002722' || lpad(to_hex(s.n), 2, '0'))::uuid
join plans p on p.id = s.plan_id::uuid;

-- Open rows before any scan. 07: 10 minutes ago (not stale). 08: older than the timeout (stale). 20: stale as well (Gym On, no session).
-- 14: an open row with a scan id inside the suspended gym (a retry whose first attempt was committed before the suspension).
insert into attendance_events (id, gym_id, member_id, checked_in_at, client_scan_id) values
  ('00000000-0000-0000-0000-0000002726a7', '00000000-0000-0000-0000-000000272011', '00000000-0000-0000-0000-000000272207', now() - interval '10 minutes', null),
  ('00000000-0000-0000-0000-0000002726a8', '00000000-0000-0000-0000-000000272011', '00000000-0000-0000-0000-000000272208', now() - interval '10 hours', null),
  ('00000000-0000-0000-0000-0000002726b4', '00000000-0000-0000-0000-000000272012', '00000000-0000-0000-0000-000000272214', now() - interval '10 hours', null),
  ('00000000-0000-0000-0000-0000002726ae', '00000000-0000-0000-0000-000000272013', '00000000-0000-0000-0000-00000027220e', now() - interval '1 hour', '00000000-0000-0000-0000-0000002724ae');

-- Sessions not bought at the desk: free-source rows (a grant id points at a reward_granted ledger row, 0117).
-- 17 free session. 21 a covering session created 20 hours ago. 22 a covering session created 3 hours ago. 20 none (denied).
insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until, created_at) values
  ('00000000-0000-0000-0000-000000272012', '00000000-0000-0000-0000-000000272211',
   pg_temp.mk_grant('00000000-0000-0000-0000-000000272012', '00000000-0000-0000-0000-000000272211'), now() + interval '5 days', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000272012', '00000000-0000-0000-0000-000000272215',
   pg_temp.mk_grant('00000000-0000-0000-0000-000000272012', '00000000-0000-0000-0000-000000272215'), now() + interval '5 days', now() - interval '20 hours'),
  ('00000000-0000-0000-0000-000000272012', '00000000-0000-0000-0000-000000272216',
   pg_temp.mk_grant('00000000-0000-0000-0000-000000272012', '00000000-0000-0000-0000-000000272216'), now() + interval '5 days', now() - interval '3 hours');

-- 16: a paid session (verified session payment). 19 (0 XAF plan) and 23 (monthly plan) are exempt and need none.
insert into payments (id, gym_id, member_id, amount, currency, method, status, purpose) values
  ('00000000-0000-0000-0000-000000272501', '00000000-0000-0000-0000-000000272012', '00000000-0000-0000-0000-000000272210', 2000, 'XAF', 'cash', 'verified', 'session');
insert into guest_sessions (gym_id, member_id, payment_id, usable_until) values
  ('00000000-0000-0000-0000-000000272012', '00000000-0000-0000-0000-000000272210', '00000000-0000-0000-0000-000000272501', now() + interval '5 days');

-- helper: set the member claim, readable before `set local role`
create function pg_temp.claims(p_user uuid, p_gym uuid) returns text language sql as $f$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'gym_id', p_gym, 'app_role', 'member')::text, true)
$f$;

-- ============================================================================
-- Interface: signature, return type, role gate.
-- ============================================================================
select is(pg_get_function_result('public.check_in(timestamptz, uuid)'::regprocedure), 'attendance_events', 'check_in() RETURNS attendance_events');
select is((select proargnames from pg_proc where oid = 'public.check_in(timestamptz, uuid)'::regprocedure),
          array['p_scanned_at', 'p_client_scan_id'], 'check_in() keeps its argument names');
select is((select prosecdef from pg_proc where oid = 'public.check_in(timestamptz, uuid)'::regprocedure), true, 'check_in() is SECURITY DEFINER');
select is(has_function_privilege('anon', 'public.check_in(timestamptz, uuid)', 'EXECUTE'), false, 'anon cannot execute check_in()');
select is(has_function_privilege('authenticated', 'public.check_in(timestamptz, uuid)', 'EXECUTE'), true, 'authenticated can execute check_in()');

-- a caller with no member row in the claimed gym resolves no member role live
select pg_temp.claims('00000000-0000-0000-0000-000000272199', '00000000-0000-0000-0000-000000272011');
set local role authenticated;
select throws_ok($$ select check_in() $$, 'P0001', 'permission denied', 'a caller who is not a member of the gym is refused');
reset role;
select is(pg_temp.fx('00000000-0000-0000-0000-000000272201'), 'att=0 open=0 alerts= attempts=0 consumed=0 loyalty=0 audit=', 'a refused caller writes nothing');

-- ============================================================================
-- FR-031: the four statuses.
-- ============================================================================
select pg_temp.claims('00000000-0000-0000-0000-000000272101', '00000000-0000-0000-0000-000000272011');
set local role authenticated;
select is((select zz_cr_sum(ae) from check_in() ae), 'row in=00:00:00 out=open type=-', '01 active: checked in, no alert (return)');
reset role;
select is(pg_temp.fx('00000000-0000-0000-0000-000000272201'), 'att=1 open=1 alerts= attempts=0 consumed=0 loyalty=0 audit=', '01 active: side effects');

select pg_temp.claims('00000000-0000-0000-0000-000000272102', '00000000-0000-0000-0000-000000272011');
set local role authenticated;
select is((select zz_cr_sum(ae) from check_in() ae), 'row in=00:00:00 out=open type=-', '02 expiring_soon: checked in (return)');
reset role;
select is(pg_temp.fx('00000000-0000-0000-0000-000000272202'), 'att=1 open=1 alerts=subscription_status/expiring_soon attempts=0 consumed=0 loyalty=0 audit=', '02 expiring_soon: yellow alert');

select pg_temp.claims('00000000-0000-0000-0000-000000272103', '00000000-0000-0000-0000-000000272011');
set local role authenticated;
select is((select zz_cr_sum(ae) from check_in() ae), 'row in=00:00:00 out=open type=-', '03 grace_period: checked in (return)');
reset role;
select is(pg_temp.fx('00000000-0000-0000-0000-000000272203'), 'att=1 open=1 alerts=subscription_status/grace_period attempts=0 consumed=0 loyalty=0 audit=', '03 grace_period: yellow alert');

select pg_temp.claims('00000000-0000-0000-0000-000000272104', '00000000-0000-0000-0000-000000272011');
set local role authenticated;
select is((select zz_cr_sum(ae) from check_in() ae), 'null', '04 expired: refused with null (return)');
select is((select zz_cr_sum(ae) from check_in() ae), 'null', '04 expired: a second scan is refused again (return)');
reset role;
select is(pg_temp.fx('00000000-0000-0000-0000-000000272204'), 'att=0 open=0 alerts=subscription_status/expired attempts=0 consumed=0 loyalty=0 audit=', '04 expired: one standing red alert, no row');

select pg_temp.claims('00000000-0000-0000-0000-000000272105', '00000000-0000-0000-0000-000000272011');
set local role authenticated;
select is((select zz_cr_sum(ae) from check_in() ae), 'null', '05 no plan: refused with null (return)');
reset role;
select is(pg_temp.fx('00000000-0000-0000-0000-000000272205'), 'att=0 open=0 alerts=subscription_status/expired attempts=0 consumed=0 loyalty=0 audit=', '05 no plan: red alert with an expired status, no row');
select is((select status::text || '/' || coalesce(expiry_date::text, 'none') from front_desk_alerts where member_id = '00000000-0000-0000-0000-000000272205' and dismissed_at is null),
          'expired/none', '05 no plan: the alert carries no expiry date');

-- ============================================================================
-- Deactivated, awaiting the registration fee, suspended gym.
-- ============================================================================
select pg_temp.claims('00000000-0000-0000-0000-000000272106', '00000000-0000-0000-0000-000000272011');
set local role authenticated;
select throws_ok($$ select check_in() $$, 'P0001', 'permission denied', '06 deactivated: refused at the live role gate, before any member lookup');
reset role;
select is(pg_temp.fx('00000000-0000-0000-0000-000000272206'), 'att=0 open=0 alerts= attempts=0 consumed=0 loyalty=0 audit=', '06 deactivated: nothing written');

select pg_temp.claims('00000000-0000-0000-0000-00000027210f', '00000000-0000-0000-0000-000000272014');
set local role authenticated;
select is((select zz_cr_sum(ae) from check_in() ae), 'null', '15 awaiting the registration fee: refused with null (return)');
reset role;
select is(pg_temp.fx('00000000-0000-0000-0000-00000027220f'), 'att=0 open=0 alerts=subscription_status/expired attempts=0 consumed=0 loyalty=0 audit=', '15 awaiting the registration fee: red alert, no row');

select pg_temp.claims('00000000-0000-0000-0000-00000027210d', '00000000-0000-0000-0000-000000272013');
set local role authenticated;
select throws_ok($$ select check_in() $$, 'P0001', 'check_in: gym 00000000-0000-0000-0000-000000272013 is not active', '13 suspended gym: raises');
select throws_ok($$ select check_in(now() - interval '1 hour', '00000000-0000-0000-0000-0000002724ad') $$, 'P0001',
                 'check_in: gym 00000000-0000-0000-0000-000000272013 is not active', '13 suspended gym: an offline scan raises too');
reset role;
select is(pg_temp.fx('00000000-0000-0000-0000-00000027220d'), 'att=0 open=0 alerts= attempts=0 consumed=0 loyalty=0 audit=', '13 suspended gym: nothing written');

select pg_temp.claims('00000000-0000-0000-0000-00000027210e', '00000000-0000-0000-0000-000000272013');
set local role authenticated;
select is((select ae.id from check_in(now() - interval '1 hour', '00000000-0000-0000-0000-0000002724ae') ae),
          '00000000-0000-0000-0000-0000002726ae'::uuid, '14 suspended gym: a replay of a committed scan returns the stored row');
reset role;
select is(pg_temp.fx('00000000-0000-0000-0000-00000027220e'), 'att=1 open=1 alerts= attempts=0 consumed=0 loyalty=0 audit=', '14 suspended gym: the replay writes nothing');

-- ============================================================================
-- Open check-ins (FR-044) and the stale auto-close (AD-22).
-- ============================================================================
select pg_temp.claims('00000000-0000-0000-0000-000000272107', '00000000-0000-0000-0000-000000272011');
set local role authenticated;
select throws_ok($$ select check_in() $$, 'P0001', 'check_in: member 00000000-0000-0000-0000-000000272207 already has an open check-in',
                 '07 open check-in: raises the FR-044 text');
select throws_ok($$ select check_in(now() - interval '5 minutes', '00000000-0000-0000-0000-0000002724a7') $$, 'P0001',
                 'check_in: member 00000000-0000-0000-0000-000000272207 already has an open check-in', '07 open check-in: an offline scan raises too');
reset role;
select is(pg_temp.fx('00000000-0000-0000-0000-000000272207'), 'att=1 open=1 alerts= attempts=0 consumed=0 loyalty=0 audit=', '07 open check-in: the open row is untouched, nothing else written');

select pg_temp.claims('00000000-0000-0000-0000-000000272108', '00000000-0000-0000-0000-000000272011');
set local role authenticated;
select is((select zz_cr_sum(ae) from check_in() ae), 'row in=00:00:00 out=open type=-', '08 stale open: a new row is returned');
reset role;
select is(pg_temp.fx('00000000-0000-0000-0000-000000272208'), 'att=2 open=1 alerts= attempts=0 consumed=0 loyalty=0 audit=attendance_stale_check_in_auto_closed', '08 stale open: the old row auto-closed with its audit row, a new open row');
select is((select checked_out_at - checked_in_at || '/' || checkout_type from attendance_events where id = '00000000-0000-0000-0000-0000002726a8'),
          '08:00:00/auto', '08 stale open: the old row is closed at its check-in time plus the timeout');
select is((select metadata ->> 'timeout_hours' || '/' || coalesce(metadata ->> 'source', 'none') from audit_log
           where action_type = 'attendance_stale_check_in_auto_closed' and target_entity_id = '00000000-0000-0000-0000-0000002726a8'),
          '8/none', '08 stale open: the audit row carries the timeout and no source');

-- ============================================================================
-- Offline scans: replay, inside the window, the future, older than the window.
-- ============================================================================
select pg_temp.claims('00000000-0000-0000-0000-000000272109', '00000000-0000-0000-0000-000000272011');
set local role authenticated;
select is((select zz_cr_sum(ae) from check_in(now() - interval '30 minutes', '00000000-0000-0000-0000-0000002724a9') ae), 'row in=-00:30:00 out=open type=-', '09 offline scan: the scan time is kept (return)');
select is((select ae.id from check_in(now() - interval '30 minutes', '00000000-0000-0000-0000-0000002724a9') ae),
          (select id from attendance_events where member_id = '00000000-0000-0000-0000-000000272209'), '09 replay: the same scan id returns the stored row');
select is((select ae.id from check_in(null, '00000000-0000-0000-0000-0000002724a9') ae),
          (select id from attendance_events where member_id = '00000000-0000-0000-0000-000000272209'), '09 replay: a different scan time returns the stored row');
reset role;
select is(pg_temp.fx('00000000-0000-0000-0000-000000272209'), 'att=1 open=1 alerts= attempts=0 consumed=0 loyalty=0 audit=', '09 replay: exactly one row, one open, nothing else');

select pg_temp.claims('00000000-0000-0000-0000-00000027210a', '00000000-0000-0000-0000-000000272011');
set local role authenticated;
select is((select zz_cr_sum(ae) from check_in(now() - interval '1 hour', '00000000-0000-0000-0000-0000002724aa') ae), 'row in=-01:00:00 out=open type=-', '10 offline scan inside the window: the scan time is honoured (return)');
reset role;
select is(pg_temp.fx('00000000-0000-0000-0000-00000027220a'), 'att=1 open=1 alerts= attempts=0 consumed=0 loyalty=0 audit=', '10 offline scan inside the window: one open row');

select pg_temp.claims('00000000-0000-0000-0000-00000027210b', '00000000-0000-0000-0000-000000272011');
set local role authenticated;
select is((select zz_cr_sum(ae) from check_in(now() + interval '2 hours', '00000000-0000-0000-0000-0000002724ab') ae), 'row in=00:00:00 out=open type=-', '11 future scan time: clamped to now (return)');
reset role;
select is(pg_temp.fx('00000000-0000-0000-0000-00000027220b'), 'att=1 open=1 alerts= attempts=0 consumed=0 loyalty=0 audit=', '11 future scan time: one open row');

select pg_temp.claims('00000000-0000-0000-0000-00000027210c', '00000000-0000-0000-0000-000000272011');
set local role authenticated;
select is((select zz_cr_sum(ae) from check_in(now() - interval '10 hours', '00000000-0000-0000-0000-0000002724ac') ae), 'row in=-10:00:00 out=-02:00:00 type=auto',
          '12 offline scan older than the window: inserted and closed at scan time plus the timeout (return)');
select is((select ae.id from check_in(now() - interval '10 hours', '00000000-0000-0000-0000-0000002724ac') ae),
          (select id from attendance_events where member_id = '00000000-0000-0000-0000-00000027220c'), '12 replay of an already-closed offline scan returns the stored row');
reset role;
select is(pg_temp.fx('00000000-0000-0000-0000-00000027220c'), 'att=1 open=0 alerts= attempts=0 consumed=0 loyalty=0 audit=attendance_stale_check_in_auto_closed', '12 offline scan older than the window: closed row, offline-sync audit row, nothing open');
select is((select metadata ->> 'source' || '/' || (metadata ->> 'timeout_hours') from audit_log
           where action_type = 'attendance_stale_check_in_auto_closed' and metadata ->> 'member_id' = '00000000-0000-0000-0000-00000027220c'),
          'offline_sync/8', '12 offline scan older than the window: the audit row names the offline-sync source');

-- ============================================================================
-- Charging gym (0111 gate): paid, free, covered, denied, exempt.
-- ============================================================================
select pg_temp.claims('00000000-0000-0000-0000-000000272110', '00000000-0000-0000-0000-000000272012');
set local role authenticated;
select is((select zz_cr_sum(ae) from check_in() ae), 'row in=00:00:00 out=open type=-', '16 paid session: consumed, checked in (return)');
reset role;
select is(pg_temp.fx('00000000-0000-0000-0000-000000272210'), 'att=1 open=1 alerts= attempts=0 consumed=1 loyalty=1 audit=', '16 paid session: one session consumed, one open row, the loyalty stamp');
update attendance_events set checked_out_at = now(), checkout_type = 'manual' where member_id = '00000000-0000-0000-0000-000000272210';
select pg_temp.claims('00000000-0000-0000-0000-000000272110', '00000000-0000-0000-0000-000000272012');
set local role authenticated;
select is((select zz_cr_sum(ae) from check_in() ae), 'row in=00:00:00 out=open type=-', '16 same day again: covered, checked in (return)');
reset role;
select is(pg_temp.fx('00000000-0000-0000-0000-000000272210'), 'att=2 open=1 alerts= attempts=0 consumed=1 loyalty=1 audit=', '16 same day again: a second row, nothing more consumed, no second stamp');

select pg_temp.claims('00000000-0000-0000-0000-000000272111', '00000000-0000-0000-0000-000000272012');
set local role authenticated;
select is((select zz_cr_sum(ae) from check_in() ae), 'row in=00:00:00 out=open type=-', '17 free session: consumed, checked in (return)');
reset role;
select is(pg_temp.fx('00000000-0000-0000-0000-000000272211'), 'att=1 open=1 alerts= attempts=0 consumed=1 loyalty=1 audit=', '17 free session: one session consumed, one open row');

select pg_temp.claims('00000000-0000-0000-0000-000000272112', '00000000-0000-0000-0000-000000272012');
set local role authenticated;
select is((select zz_cr_sum(ae) from check_in(null, '00000000-0000-0000-0000-0000002724b2') ae), 'null', '18 no session: denied with null (return)');
select is((select zz_cr_sum(ae) from check_in(null, '00000000-0000-0000-0000-0000002724b2') ae), 'null', '18 no session: the same scan id is denied again (return)');
select is((select zz_cr_sum(ae) from check_in() ae), 'null', '18 no session: a scan without an id is denied again (return)');
reset role;
select is(pg_temp.fx('00000000-0000-0000-0000-000000272212'), 'att=0 open=0 alerts=session_required/- attempts=2 consumed=0 loyalty=0 audit=', '18 no session: no row, one standing session_required alert, an attempt per scan id plus one per anonymous scan');
select is((select source || '/' || (scan_id is not null)::text from session_attempts
           where member_id = '00000000-0000-0000-0000-000000272212' and scan_id is not null),
          'check_in/true', '18 no session: the attempt is recorded with the check_in source and its scan id');

select pg_temp.claims('00000000-0000-0000-0000-000000272113', '00000000-0000-0000-0000-000000272012');
set local role authenticated;
select is((select zz_cr_sum(ae) from check_in() ae), 'row in=00:00:00 out=open type=-', '19 0 XAF plan: exempt, checked in (return)');
reset role;
select is(pg_temp.fx('00000000-0000-0000-0000-000000272213'), 'att=1 open=1 alerts= attempts=0 consumed=0 loyalty=0 audit=', '19 0 XAF plan: nothing consumed, no attempt');

select pg_temp.claims('00000000-0000-0000-0000-000000272117', '00000000-0000-0000-0000-000000272012');
set local role authenticated;
select is((select zz_cr_sum(ae) from check_in() ae), 'row in=00:00:00 out=open type=-', '23 monthly plan at a charging gym: exempt, checked in (return)');
reset role;
select is(pg_temp.fx('00000000-0000-0000-0000-000000272217'), 'att=1 open=1 alerts= attempts=0 consumed=0 loyalty=0 audit=', '23 monthly plan at a charging gym: nothing consumed, no attempt');

select pg_temp.claims('00000000-0000-0000-0000-000000272114', '00000000-0000-0000-0000-000000272012');
set local role authenticated;
select is((select zz_cr_sum(ae) from check_in() ae), 'null', '20 stale open and no session: denied with null (return)');
reset role;
select is(pg_temp.fx('00000000-0000-0000-0000-000000272214'), 'att=1 open=0 alerts=session_required/- attempts=1 consumed=0 loyalty=0 audit=attendance_stale_check_in_auto_closed', '20 stale open and no session: the auto-close commits with the refusal, no new row');
select is((select checkout_type from attendance_events where id = '00000000-0000-0000-0000-0000002726b4'), 'auto', '20 stale open and no session: the old row is closed as auto');

select pg_temp.claims('00000000-0000-0000-0000-000000272115', '00000000-0000-0000-0000-000000272012');
set local role authenticated;
select is((select zz_cr_sum(ae) from check_in(now() - interval '10 hours', '00000000-0000-0000-0000-0000002724b5') ae), 'row in=00:00:00 out=open type=-',
          '21 session, offline scan older than the window: receipt time governs, so the row stays open (return)');
reset role;
select is(pg_temp.fx('00000000-0000-0000-0000-000000272215'), 'att=1 open=1 alerts= attempts=0 consumed=1 loyalty=1 audit=', '21 session, offline scan older than the window: one session consumed, one open row');

select pg_temp.claims('00000000-0000-0000-0000-000000272116', '00000000-0000-0000-0000-000000272012');
set local role authenticated;
select is((select zz_cr_sum(ae) from check_in(now() - interval '1 hour', '00000000-0000-0000-0000-0000002724b6') ae), 'row in=-01:00:00 out=open type=-',
          '22 session, offline scan inside the window and after the session existed: the scan time is kept (return)');
reset role;
select is(pg_temp.fx('00000000-0000-0000-0000-000000272216'), 'att=1 open=1 alerts= attempts=0 consumed=1 loyalty=1 audit=', '22 session, offline scan inside the window: one session consumed, one open row');

-- ============================================================================
-- Direct writes stay closed (0111).
-- ============================================================================
select is(
  has_table_privilege('authenticated', 'public.attendance_events', 'INSERT')
  or has_table_privilege('authenticated', 'public.attendance_events', 'UPDATE')
  or has_table_privilege('authenticated', 'public.attendance_events', 'DELETE')
  or has_table_privilege('service_role', 'public.attendance_events', 'INSERT')
  or has_table_privilege('service_role', 'public.attendance_events', 'UPDATE')
  or has_table_privilege('service_role', 'public.attendance_events', 'DELETE'),
  false,
  'authenticated and service_role have no direct write on attendance_events'
);

select * from finish();
rollback;
