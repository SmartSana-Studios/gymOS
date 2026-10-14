-- Story 20.2: loyalty guest rule (migration 0118), positive paths and the
-- I/O matrix. Denial paths live in loyalty_guest_rule.negative.test.sql.
--
-- pgTAP runs one session, so concurrent replays cannot interleave; replay is
-- asserted by running the hook twice for one session (the unique
-- (origin_id, event_type) key is the exactly-once backstop).
--
-- Fixture ids: 00000000-0000-0000-0000-0000000400xx.

begin;
select plan(56);

-- A ledger row backing a free session (loyalty_grant_id FK, 0117).
create function pg_temp.mk_grant(p_gym uuid, p_member uuid) returns uuid
language sql security definer as $mk$
  insert into loyalty_events (gym_id, member_id, event_type, counter, origin_id)
  values (p_gym, p_member, 'reward_granted', 'guest', gen_random_uuid()) returning id
$mk$;

-- An unused paid session for a member (verified session payment + session row).
create function pg_temp.mk_paid(p_gym uuid, p_member uuid, p_usable_until timestamptz default now() + interval '30 days')
returns uuid
language plpgsql security definer as $mk$
declare
  v_payment uuid;
  v_session uuid;
begin
  insert into payments (gym_id, member_id, subscription_id, amount, currency, method, status, purpose)
  values (p_gym, p_member, null, 2000, 'XAF', 'cash', 'verified', 'session')
  returning id into v_payment;
  insert into guest_sessions (gym_id, member_id, payment_id, usable_until)
  values (p_gym, p_member, v_payment, p_usable_until)
  returning id into v_session;
  return v_session;
end;
$mk$;

-- Mirrors consume_guest_session()'s write followed by the hook call.
create function pg_temp.consume(p_session uuid, p_at timestamptz) returns void
language plpgsql as $c$
declare
  v_s guest_sessions%rowtype;
begin
  -- Direct fixture calls run as no caller (system actor), whatever claims earlier steps left.
  perform set_config('request.jwt.claims', '{}', true);
  select * into v_s from guest_sessions where id = p_session;
  update guest_sessions
  set consumed_at = p_at, covered_day = (p_at at time zone 'Africa/Douala')::date
  where id = p_session;
  perform private.on_session_consumed(p_session, v_s.member_id, v_s.gym_id);
end;
$c$;

-- Ledger replay: fold one member's guest events into a counter.
create function pg_temp.replay(p_member uuid) returns integer
language plpgsql as $r$
declare
  e record;
  v integer := 0;
begin
  for e in
    select event_type from loyalty_events
    where member_id = p_member and counter = 'guest'
    order by occurred_at,
             case event_type when 'reset' then 0 when 'stamp_earned' then 1 when 'reward_granted' then 2 else 3 end
  loop
    if e.event_type = 'stamp_earned' then v := v + 1;
    elsif e.event_type in ('reset', 'reward_granted') then v := 0;
    end if;
  end loop;
  return v;
end;
$r$;

insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000040001', 'GR Tier', 6000, 60000, null);

insert into gyms (id, name, tier_id, status, charge_guests_per_session, registration_fee,
                  loyalty_enabled, loyalty_guest_threshold, loyalty_renewal_threshold, loyalty_reward_days) values
  ('00000000-0000-0000-0000-000000040011', 'GR Gym A (on, N 3)',        '00000000-0000-0000-0000-000000040001', 'active', true,  0, true,  3, 3, 1),
  ('00000000-0000-0000-0000-000000040012', 'GR Gym B (program off)',    '00000000-0000-0000-0000-000000040001', 'active', true,  0, false, 3, 3, 1),
  ('00000000-0000-0000-0000-000000040013', 'GR Gym C (charging off)',   '00000000-0000-0000-0000-000000040001', 'active', false, 0, true,  3, 3, 1),
  ('00000000-0000-0000-0000-000000040014', 'GR Gym D (on, N 2)',        '00000000-0000-0000-0000-000000040001', 'active', true,  0, true,  2, 3, 1);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000040021'), -- receptionist A
  ('00000000-0000-0000-0000-000000040022'), -- P  via check_in
  ('00000000-0000-0000-0000-000000040023'), -- Q  reaches N
  ('00000000-0000-0000-0000-000000040024'), -- R  above lowered N
  ('00000000-0000-0000-0000-000000040025'), -- S  free consumed
  ('00000000-0000-0000-0000-000000040026'), -- T  idle 91 days
  ('00000000-0000-0000-0000-000000040027'), -- U  idle exactly 90 days
  ('00000000-0000-0000-0000-000000040028'), -- V  replay
  ('00000000-0000-0000-0000-000000040029'), -- W  program off
  ('00000000-0000-0000-0000-00000004002a'), -- X  charging off
  ('00000000-0000-0000-0000-00000004002b'), -- Y  class attendance
  ('00000000-0000-0000-0000-00000004002c'), -- coach A
  ('00000000-0000-0000-0000-00000004002d'), -- Z  two gyms (A and D)
  ('00000000-0000-0000-0000-00000004002e'), -- owner A
  ('00000000-0000-0000-0000-00000004002f'), -- PC plan change
  ('00000000-0000-0000-0000-000000040030'), -- OM order
  ('00000000-0000-0000-0000-000000040031'); -- Q2 two rewards in a row

insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000040041', '00000000-0000-0000-0000-000000040011', '00000000-0000-0000-0000-000000040021', 'receptionist', 'GR Receptionist', current_date),
  ('00000000-0000-0000-0000-000000040042', '00000000-0000-0000-0000-000000040011', '00000000-0000-0000-0000-000000040022', 'member', 'GR P', current_date),
  ('00000000-0000-0000-0000-000000040043', '00000000-0000-0000-0000-000000040011', '00000000-0000-0000-0000-000000040023', 'member', 'GR Q', current_date),
  ('00000000-0000-0000-0000-000000040044', '00000000-0000-0000-0000-000000040011', '00000000-0000-0000-0000-000000040024', 'member', 'GR R', current_date),
  ('00000000-0000-0000-0000-000000040045', '00000000-0000-0000-0000-000000040011', '00000000-0000-0000-0000-000000040025', 'member', 'GR S', current_date),
  ('00000000-0000-0000-0000-000000040046', '00000000-0000-0000-0000-000000040011', '00000000-0000-0000-0000-000000040026', 'member', 'GR T', current_date),
  ('00000000-0000-0000-0000-000000040047', '00000000-0000-0000-0000-000000040011', '00000000-0000-0000-0000-000000040027', 'member', 'GR U', current_date),
  ('00000000-0000-0000-0000-000000040048', '00000000-0000-0000-0000-000000040011', '00000000-0000-0000-0000-000000040028', 'member', 'GR V', current_date),
  ('00000000-0000-0000-0000-000000040049', '00000000-0000-0000-0000-000000040012', '00000000-0000-0000-0000-000000040029', 'member', 'GR W', current_date),
  ('00000000-0000-0000-0000-00000004004a', '00000000-0000-0000-0000-000000040013', '00000000-0000-0000-0000-00000004002a', 'member', 'GR X', current_date),
  ('00000000-0000-0000-0000-00000004004b', '00000000-0000-0000-0000-000000040011', '00000000-0000-0000-0000-00000004002b', 'member', 'GR Y', current_date),
  ('00000000-0000-0000-0000-00000004004c', '00000000-0000-0000-0000-000000040011', '00000000-0000-0000-0000-00000004002c', 'coach', 'GR Coach', current_date),
  ('00000000-0000-0000-0000-00000004004d', '00000000-0000-0000-0000-000000040011', '00000000-0000-0000-0000-00000004002d', 'member', 'GR Z in A', current_date),
  ('00000000-0000-0000-0000-00000004004e', '00000000-0000-0000-0000-000000040014', '00000000-0000-0000-0000-00000004002d', 'member', 'GR Z in D', current_date),
  ('00000000-0000-0000-0000-00000004004f', '00000000-0000-0000-0000-000000040011', '00000000-0000-0000-0000-00000004002e', 'owner', 'GR Owner', current_date),
  ('00000000-0000-0000-0000-000000040050', '00000000-0000-0000-0000-000000040011', '00000000-0000-0000-0000-00000004002f', 'member', 'GR PC', current_date),
  ('00000000-0000-0000-0000-000000040051', '00000000-0000-0000-0000-000000040011', '00000000-0000-0000-0000-000000040030', 'member', 'GR OM', current_date),
  ('00000000-0000-0000-0000-000000040052', '00000000-0000-0000-0000-000000040011', '00000000-0000-0000-0000-000000040031', 'member', 'GR Q2', current_date);

insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000040061', '00000000-0000-0000-0000-000000040011', 'GR PPS A',     'pay_per_session', 2000,  'XAF', 'monthly', null),
  ('00000000-0000-0000-0000-000000040062', '00000000-0000-0000-0000-000000040011', 'GR Monthly A', 'monthly',         15000, 'XAF', 'monthly', 30),
  ('00000000-0000-0000-0000-000000040063', '00000000-0000-0000-0000-000000040012', 'GR PPS B',     'pay_per_session', 2000,  'XAF', 'monthly', null),
  ('00000000-0000-0000-0000-000000040064', '00000000-0000-0000-0000-000000040013', 'GR PPS C',     'pay_per_session', 2000,  'XAF', 'monthly', null),
  ('00000000-0000-0000-0000-000000040065', '00000000-0000-0000-0000-000000040014', 'GR PPS D',     'pay_per_session', 2000,  'XAF', 'monthly', null);

insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date, created_at)
select m.gym_id, m.id,
       case m.gym_id
         when '00000000-0000-0000-0000-000000040011' then '00000000-0000-0000-0000-000000040061'::uuid
         when '00000000-0000-0000-0000-000000040012' then '00000000-0000-0000-0000-000000040063'::uuid
         when '00000000-0000-0000-0000-000000040013' then '00000000-0000-0000-0000-000000040064'::uuid
         else '00000000-0000-0000-0000-000000040065'::uuid
       end,
       'active', current_date, null, now() - interval '100 days'
from members m
where m.role = 'member'
  and m.id::text like '00000000-0000-0000-0000-0000000400%';

insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, one_off_session_at) values
  ('00000000-0000-0000-0000-000000040071', '00000000-0000-0000-0000-000000040011', 'GR Class', '00000000-0000-0000-0000-00000004004c', 20, 'one_off', now() + interval '1 day');
insert into class_sessions (id, gym_id, class_id, scheduled_at) values
  ('00000000-0000-0000-0000-000000040081', '00000000-0000-0000-0000-000000040011', '00000000-0000-0000-0000-000000040071', now() + interval '1 day');
insert into class_bookings (id, gym_id, class_session_id, member_id) values
  ('00000000-0000-0000-0000-0000000400a1', '00000000-0000-0000-0000-000000040011', '00000000-0000-0000-0000-000000040081', '00000000-0000-0000-0000-00000004004b');

-- ============================================================================
-- Interface: unchanged signature, still not client-callable.
-- ============================================================================
select is(
  (select pg_get_function_identity_arguments('private.on_session_consumed(uuid, uuid, uuid)'::regprocedure)),
  'p_session_id uuid, p_member_id uuid, p_gym_id uuid',
  'hook keeps its signature'
);
select is(
  (select has_function_privilege('authenticated', 'private.on_session_consumed(uuid, uuid, uuid)', 'execute')
       or has_function_privilege('anon', 'private.on_session_consumed(uuid, uuid, uuid)', 'execute')),
  false,
  'hook is not executable by client roles'
);

-- ============================================================================
-- P: a real check_in() consumes a paid session and earns one stamp.
-- ============================================================================
select pg_temp.mk_paid('00000000-0000-0000-0000-000000040011', '00000000-0000-0000-0000-000000040042');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000040022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000040011","app_role":"member"}', true);
select isnt((select check_in()), null, 'P checks in (paid session consumed)');
reset role;

select is(
  (select count(*)::int from loyalty_events
   where member_id = '00000000-0000-0000-0000-000000040042' and event_type = 'stamp_earned' and counter = 'guest'),
  1, 'check_in consumption wrote one stamp_earned');
select is(
  (select row(guest_stamps, guest_last_event_at = (select consumed_at from guest_sessions
                                                    where member_id = '00000000-0000-0000-0000-000000040042'))::text
   from loyalty_progress where member_id = '00000000-0000-0000-0000-000000040042'),
  '(1,t)', 'progress is 1 with last event at the session consumed_at');
select is(
  (select e.origin_id from loyalty_events e where e.member_id = '00000000-0000-0000-0000-000000040042' and e.event_type = 'stamp_earned'),
  (select s.id from guest_sessions s where s.member_id = '00000000-0000-0000-0000-000000040042'),
  'the stamp origin_id is the session id');
select is(
  (select count(*)::int from audit_log
   where action_type = 'loyalty_stamp_earned' and target_entity_id = '00000000-0000-0000-0000-000000040042'),
  1, 'one loyalty_stamp_earned audit row');
select is(
  (select actor_id from audit_log where action_type = 'loyalty_stamp_earned'
     and target_entity_id = '00000000-0000-0000-0000-000000040042'),
  '00000000-0000-0000-0000-000000040022'::uuid, 'audit actor is the surrounding caller');

-- Covered re-entry: second scan the same day reaches no hook.
update attendance_events set checked_out_at = now(), checkout_type = 'manual'
where member_id = '00000000-0000-0000-0000-000000040042';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000040022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000040011","app_role":"member"}', true);
select isnt((select check_in()), null, 'P scans again the same day (covered)');
reset role;
select is(
  (select count(*)::int from loyalty_events where member_id = '00000000-0000-0000-0000-000000040042'),
  1, 'covered re-entry wrote nothing');
select is(
  (select guest_stamps from loyalty_progress where member_id = '00000000-0000-0000-0000-000000040042'),
  1, 'covered re-entry left the counter');

-- ============================================================================
-- Q: N = 3. Two stamps below N, third reaches N.
-- ============================================================================
select pg_temp.consume(pg_temp.mk_paid('00000000-0000-0000-0000-000000040011', '00000000-0000-0000-0000-000000040043'),
                       now() - interval '12 days');
select pg_temp.consume(pg_temp.mk_paid('00000000-0000-0000-0000-000000040011', '00000000-0000-0000-0000-000000040043'),
                       now() - interval '11 days');
select is(
  (select guest_stamps from loyalty_progress where member_id = '00000000-0000-0000-0000-000000040043'),
  2, 'below N: two stamps');
select is(
  (select count(*)::int from loyalty_events where member_id = '00000000-0000-0000-0000-000000040043' and event_type = 'reward_granted'),
  0, 'below N: no grant');

select pg_temp.consume(pg_temp.mk_paid('00000000-0000-0000-0000-000000040011', '00000000-0000-0000-0000-000000040043'),
                       now() - interval '10 days');
select is(
  (select row(count(*) filter (where event_type = 'stamp_earned'), count(*) filter (where event_type = 'reward_granted'))::text
   from loyalty_events where member_id = '00000000-0000-0000-0000-000000040043'),
  '(3,1)', 'reaching N: three stamps and one reward_granted');
select is(
  (select guest_stamps from loyalty_progress where member_id = '00000000-0000-0000-0000-000000040043'),
  0, 'reaching N: the counter returns to 0');
select is(
  (select count(*)::int from guest_sessions
   where member_id = '00000000-0000-0000-0000-000000040043' and loyalty_grant_id is not null),
  1, 'reaching N: exactly one free session');
select is(
  (select row(g.payment_id is null, g.consumed_at is null, g.voided_at is null,
              g.loyalty_grant_id = e.id,
              g.usable_until = (select consumed_at from guest_sessions
                                where member_id = g.member_id and payment_id is not null
                                order by consumed_at desc limit 1) + interval '60 days')::text
   from guest_sessions g
   join loyalty_events e on e.id = g.loyalty_grant_id and e.event_type = 'reward_granted'
   where g.member_id = '00000000-0000-0000-0000-000000040043' and g.loyalty_grant_id is not null),
  '(t,t,t,t,t)', 'free session: no payment, unused, backed by the grant, usable 60 days from the Nth consumption');
select is(
  (select count(*)::int from audit_log
   where target_entity_id = '00000000-0000-0000-0000-000000040043' and action_type = 'loyalty_reward_granted'),
  1, 'one loyalty_reward_granted audit row');
select is(
  (select count(*)::int from audit_log
   where target_entity_id = '00000000-0000-0000-0000-000000040043' and action_type = 'loyalty_stamp_earned'),
  3, 'three loyalty_stamp_earned audit rows');
select is(pg_temp.replay('00000000-0000-0000-0000-000000040043'), 0, 'ledger replay equals progress for Q');

-- ============================================================================
-- Q2: a second full cycle gives a second, distinct free session.
-- ============================================================================
select pg_temp.consume(pg_temp.mk_paid('00000000-0000-0000-0000-000000040011', '00000000-0000-0000-0000-000000040052'), now() - interval '9 days');
select pg_temp.consume(pg_temp.mk_paid('00000000-0000-0000-0000-000000040011', '00000000-0000-0000-0000-000000040052'), now() - interval '8 days');
select pg_temp.consume(pg_temp.mk_paid('00000000-0000-0000-0000-000000040011', '00000000-0000-0000-0000-000000040052'), now() - interval '7 days');
select pg_temp.consume(pg_temp.mk_paid('00000000-0000-0000-0000-000000040011', '00000000-0000-0000-0000-000000040052'), now() - interval '6 days');
select pg_temp.consume(pg_temp.mk_paid('00000000-0000-0000-0000-000000040011', '00000000-0000-0000-0000-000000040052'), now() - interval '5 days');
select pg_temp.consume(pg_temp.mk_paid('00000000-0000-0000-0000-000000040011', '00000000-0000-0000-0000-000000040052'), now() - interval '4 days');
select is(
  (select count(*)::int from guest_sessions
   where member_id = '00000000-0000-0000-0000-000000040052' and loyalty_grant_id is not null),
  2, 'two cycles give two free sessions');
select is(
  (select guest_stamps from loyalty_progress where member_id = '00000000-0000-0000-0000-000000040052'),
  0, 'counter is 0 after two cycles');
select is(pg_temp.replay('00000000-0000-0000-0000-000000040052'), 0, 'ledger replay equals progress for Q2');

-- ============================================================================
-- R: above a lowered N (stamps 7, N 3): one stamp, one grant, counter 0.
-- ============================================================================
insert into loyalty_progress (gym_id, member_id, guest_stamps, guest_last_event_at) values
  ('00000000-0000-0000-0000-000000040011', '00000000-0000-0000-0000-000000040044', 7, now() - interval '5 days');
select pg_temp.consume(pg_temp.mk_paid('00000000-0000-0000-0000-000000040011', '00000000-0000-0000-0000-000000040044'), now() - interval '2 days');
select is(
  (select row(count(*) filter (where event_type = 'stamp_earned'), count(*) filter (where event_type = 'reward_granted'))::text
   from loyalty_events where member_id = '00000000-0000-0000-0000-000000040044'),
  '(1,1)', 'above lowered N: one stamp and one grant');
select is(
  (select guest_stamps from loyalty_progress where member_id = '00000000-0000-0000-0000-000000040044'),
  0, 'above lowered N: counter to 0, excess not carried');

-- ============================================================================
-- S: a free session consumed records reward_consumed only.
-- ============================================================================
insert into loyalty_progress (gym_id, member_id, guest_stamps, guest_last_event_at) values
  ('00000000-0000-0000-0000-000000040011', '00000000-0000-0000-0000-000000040045', 2, now() - interval '30 days');
insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until)
values ('00000000-0000-0000-0000-000000040011', '00000000-0000-0000-0000-000000040045',
        pg_temp.mk_grant('00000000-0000-0000-0000-000000040011', '00000000-0000-0000-0000-000000040045'),
        now() + interval '20 days');
select pg_temp.consume((select id from guest_sessions where member_id = '00000000-0000-0000-0000-000000040045'), now() - interval '1 day');
select is(
  (select count(*)::int from loyalty_events
   where member_id = '00000000-0000-0000-0000-000000040045' and event_type = 'reward_consumed' and counter = 'guest'
     and origin_id = (select id from guest_sessions where member_id = '00000000-0000-0000-0000-000000040045')),
  1, 'free consumed: one reward_consumed with the session id as origin');
select is(
  (select row(guest_stamps, guest_last_event_at = now() - interval '30 days')::text
   from loyalty_progress where member_id = '00000000-0000-0000-0000-000000040045'),
  '(2,t)' , 'free consumed: counter and idle window untouched')
  ;

-- ============================================================================
-- Idle reset: 91 days resets then stamps; exactly 90 days does not reset.
-- ============================================================================
insert into loyalty_progress (gym_id, member_id, guest_stamps, guest_last_event_at) values
  ('00000000-0000-0000-0000-000000040011', '00000000-0000-0000-0000-000000040046', 2, now() - interval '91 days'),
  ('00000000-0000-0000-0000-000000040011', '00000000-0000-0000-0000-000000040047', 2, '2026-01-01 00:00:00+00');
select pg_temp.consume(pg_temp.mk_paid('00000000-0000-0000-0000-000000040011', '00000000-0000-0000-0000-000000040046'), now());
select is(
  (select row(count(*) filter (where event_type = 'reset'), count(*) filter (where event_type = 'stamp_earned'))::text
   from loyalty_events where member_id = '00000000-0000-0000-0000-000000040046'),
  '(1,1)', 'idle past the window: one reset then one stamp');
select is(
  (select guest_stamps from loyalty_progress where member_id = '00000000-0000-0000-0000-000000040046'),
  1, 'idle past the window: counter is 1');
select is(
  (select (details ->> 'previous_count')::int from loyalty_events
   where member_id = '00000000-0000-0000-0000-000000040046' and event_type = 'reset'),
  2, 'reset details carry the previous count');
select is(
  (select count(*)::int from audit_log
   where action_type = 'loyalty_progress_reset' and target_entity_id = '00000000-0000-0000-0000-000000040046'),
  1, 'one loyalty_progress_reset audit row');

-- U: consumed exactly 90 days after the last stamp: not older than the window.
do $u$
declare
  v_s uuid := pg_temp.mk_paid('00000000-0000-0000-0000-000000040011', '00000000-0000-0000-0000-000000040047');
begin
  perform pg_temp.consume(v_s, '2026-01-01 00:00:00+00'::timestamptz + interval '90 days');
end;
$u$;
select is(
  (select row(count(*) filter (where event_type = 'reset'), guest_stamps)::text
   from loyalty_events e join loyalty_progress p on p.member_id = e.member_id
   where e.member_id = '00000000-0000-0000-0000-000000040047' group by p.guest_stamps),
  '(0,0)', 'exactly at the window: no reset; stamp 3 reaches N and returns to 0');

-- ============================================================================
-- V: replay. The hook run twice for one session changes nothing the second time.
-- ============================================================================
create temp table v_sessions (id uuid);
insert into v_sessions
select pg_temp.mk_paid('00000000-0000-0000-0000-000000040011', '00000000-0000-0000-0000-000000040048');
insert into v_sessions
select pg_temp.mk_paid('00000000-0000-0000-0000-000000040011', '00000000-0000-0000-0000-000000040048');
insert into v_sessions
select pg_temp.mk_paid('00000000-0000-0000-0000-000000040011', '00000000-0000-0000-0000-000000040048');
-- Consume the three in order, then replay the Nth.
select pg_temp.consume(id, now() - interval '3 days') from (select id from v_sessions order by id limit 1) s;
select pg_temp.consume(id, now() - interval '2 days') from (select id from v_sessions order by id offset 1 limit 1) s;
select pg_temp.consume(id, now() - interval '1 day')  from (select id from v_sessions order by id offset 2 limit 1) s;
select lives_ok(
  $$ select private.on_session_consumed(s.id, '00000000-0000-0000-0000-000000040048', '00000000-0000-0000-0000-000000040011')
     from (select id from v_sessions order by id offset 2 limit 1) s $$,
  'replaying the hook for the Nth session raises nothing');
select is(
  (select row(count(*) filter (where event_type = 'stamp_earned'), count(*) filter (where event_type = 'reward_granted'))::text
   from loyalty_events where member_id = '00000000-0000-0000-0000-000000040048'),
  '(3,1)', 'replay: one stamp per session and one grant');
select is(
  (select count(*)::int from guest_sessions where member_id = '00000000-0000-0000-0000-000000040048' and loyalty_grant_id is not null),
  1, 'replay: one free session');
select is(
  (select guest_stamps from loyalty_progress where member_id = '00000000-0000-0000-0000-000000040048'),
  0, 'replay: counter still 0');
select is(pg_temp.replay('00000000-0000-0000-0000-000000040048'), 0, 'ledger replay equals progress for V');

-- ============================================================================
-- Switches: program off, charging off. Nothing written, nothing retroactive.
-- ============================================================================
select pg_temp.consume(pg_temp.mk_paid('00000000-0000-0000-0000-000000040012', '00000000-0000-0000-0000-000000040049'), now());
select pg_temp.consume(pg_temp.mk_paid('00000000-0000-0000-0000-000000040013', '00000000-0000-0000-0000-00000004004a'), now());
select is(
  (select count(*)::int from loyalty_events where member_id in
     ('00000000-0000-0000-0000-000000040049', '00000000-0000-0000-0000-00000004004a')),
  0, 'program off / charging off: no event');
select is(
  (select count(*)::int from loyalty_progress where member_id in
     ('00000000-0000-0000-0000-000000040049', '00000000-0000-0000-0000-00000004004a')),
  0, 'program off / charging off: no progress row');

-- A free session consumed while the program is off is still recorded.
insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until)
values ('00000000-0000-0000-0000-000000040012', '00000000-0000-0000-0000-000000040049',
        pg_temp.mk_grant('00000000-0000-0000-0000-000000040012', '00000000-0000-0000-0000-000000040049'),
        now() + interval '5 days');
select pg_temp.consume((select id from guest_sessions where member_id = '00000000-0000-0000-0000-000000040049' and loyalty_grant_id is not null),
                       now() + interval '1 day');
select is(
  (select count(*)::int from loyalty_events
   where member_id = '00000000-0000-0000-0000-000000040049' and event_type = 'reward_consumed'),
  1, 'free consumed with the program off: reward_consumed recorded');
select is(
  (select count(*)::int from loyalty_progress where member_id = '00000000-0000-0000-0000-000000040049'),
  0, 'free consumed with the program off: still no progress row');

-- ============================================================================
-- Y: class attendance earns through the same hook.
-- ============================================================================
select pg_temp.mk_paid('00000000-0000-0000-0000-000000040011', '00000000-0000-0000-0000-00000004004b');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000040021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000040011","app_role":"receptionist"}', true);
select isnt(
  (select attended_at from mark_class_attendance('00000000-0000-0000-0000-0000000400a1')),
  null, 'Y is marked at a class (paid session consumed)');
reset role;
select is(
  (select guest_stamps from loyalty_progress where member_id = '00000000-0000-0000-0000-00000004004b'),
  1, 'class attendance earned one stamp');

-- ============================================================================
-- Z: two gyms keep separate counters.
-- ============================================================================
select pg_temp.consume(pg_temp.mk_paid('00000000-0000-0000-0000-000000040014', '00000000-0000-0000-0000-00000004004e'), now());
select is(
  (select row(count(*), min(guest_stamps))::text from loyalty_progress
   where member_id in ('00000000-0000-0000-0000-00000004004d', '00000000-0000-0000-0000-00000004004e')),
  '(1,1)', 'a stamp in gym D creates no progress for the same user in gym A');
select is(
  (select count(*)::int from loyalty_events
   where member_id = '00000000-0000-0000-0000-00000004004e'
     and gym_id <> '00000000-0000-0000-0000-000000040014'),
  0, 'every event carries its own gym id');

-- ============================================================================
-- PC: plan change. A held free session is dormant off Pay-per-session and
-- usable again on return.
-- ============================================================================
insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until)
values ('00000000-0000-0000-0000-000000040011', '00000000-0000-0000-0000-000000040050',
        pg_temp.mk_grant('00000000-0000-0000-0000-000000040011', '00000000-0000-0000-0000-000000040050'),
        now() + interval '30 days');
insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date, created_at) values
  ('00000000-0000-0000-0000-000000040011', '00000000-0000-0000-0000-000000040050', '00000000-0000-0000-0000-000000040062',
   'active', current_date, current_date + 30, now() - interval '50 days');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000004002f","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000040011","app_role":"member"}', true);
select isnt((select check_in()), null, 'PC on Monthly checks in (exempt)');
reset role;
select is(
  (select consumed_at is null from guest_sessions
   where member_id = '00000000-0000-0000-0000-000000040050' and loyalty_grant_id is not null),
  true, 'off Pay-per-session the free session is not consumed');

update attendance_events set checked_out_at = now(), checkout_type = 'manual'
where member_id = '00000000-0000-0000-0000-000000040050';
insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date, created_at) values
  ('00000000-0000-0000-0000-000000040011', '00000000-0000-0000-0000-000000040050', '00000000-0000-0000-0000-000000040061',
   'active', current_date, null, now() - interval '10 days');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000004002f","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000040011","app_role":"member"}', true);
select isnt((select check_in()), null, 'PC back on Pay-per-session checks in');
reset role;
select is(
  (select count(*)::int from loyalty_events
   where member_id = '00000000-0000-0000-0000-000000040050' and event_type = 'reward_consumed'),
  1, 'back on Pay-per-session the free session is consumed once');

-- ============================================================================
-- OM: FR-159 order. Free lapses sooner than paid, so free goes first and
-- earns no stamp; on a tie paid goes first.
-- ============================================================================
insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until)
values ('00000000-0000-0000-0000-000000040011', '00000000-0000-0000-0000-000000040051',
        pg_temp.mk_grant('00000000-0000-0000-0000-000000040011', '00000000-0000-0000-0000-000000040051'),
        now() + interval '5 days');
select pg_temp.mk_paid('00000000-0000-0000-0000-000000040011', '00000000-0000-0000-0000-000000040051', now() + interval '20 days');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000040030","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000040011","app_role":"member"}', true);
select isnt((select check_in()), null, 'OM checks in (soonest-lapsing free session)');
reset role;
select is(
  (select row(count(*) filter (where event_type = 'reward_consumed'), count(*) filter (where event_type = 'stamp_earned'))::text
   from loyalty_events where member_id = '00000000-0000-0000-0000-000000040051'),
  '(1,0)', 'free consumed first: reward_consumed, no stamp');

-- ============================================================================
-- Hook never reads the idle window at read time; effective_loyalty() agrees
-- with progress for a fresh member (read path unchanged).
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000004002e","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000040011","app_role":"owner"}', true);
select is(
  (effective_loyalty('00000000-0000-0000-0000-000000040044') ->> 'guest_stamps')::int,
  0, 'effective_loyalty reads R as 0 after the grant');
select is(
  jsonb_array_length(effective_loyalty('00000000-0000-0000-0000-000000040043') -> 'free_sessions'),
  1, 'effective_loyalty lists Q''s unused free session');

-- 19.10 overview counts the granted sessions as given.
select is(
  (select free_count from guest_sessions_summary('month')),
  (select count(*) from guest_sessions
   where gym_id = '00000000-0000-0000-0000-000000040011' and loyalty_grant_id is not null
     and created_at >= date_trunc('month', now() at time zone 'Africa/Douala') at time zone 'Africa/Douala'),
  '19.10 overview free_count counts every loyalty grant of the month');
reset role;

-- ============================================================================
-- Ledger replay equals progress across every fully-ledgered member of gym A.
-- ============================================================================
select is(
  (select count(*)::int from loyalty_progress p
   where p.gym_id = '00000000-0000-0000-0000-000000040011'
     and p.member_id in ('00000000-0000-0000-0000-000000040042', '00000000-0000-0000-0000-000000040043',
                         '00000000-0000-0000-0000-000000040052', '00000000-0000-0000-0000-000000040048',
                         '00000000-0000-0000-0000-00000004004b')
     and pg_temp.replay(p.member_id) <> p.guest_stamps),
  0, 'ledger replay equals loyalty_progress for the fully-ledgered members');

select is(
  (select count(*)::int from (
     select origin_id, event_type from loyalty_events group by 1, 2 having count(*) > 1) d),
  0, 'no duplicate (origin_id, event_type) in the ledger');

select * from finish();
rollback;
