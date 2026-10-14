-- Story 20.4: refund reversal, lapses and the 90-day reset sweep (migration
-- 0120), positive paths and the I/O matrix. Denial paths live in
-- loyalty_sweep_and_reversal.negative.test.sql.
--
-- Everything runs in one transaction, so now() is constant; fixture events are
-- dated relative to it. Replay is asserted by running the hook / sweep twice.
--
-- Fixture ids: 00000000-0000-0000-0000-0000000420xx.

begin;
select plan(76);

-- An unused paid session for a member (verified session payment + session row).
create function pg_temp.mk_paid(p_gym uuid, p_member uuid, p_usable_until timestamptz default now() + interval '30 days', p_voided_at timestamptz default null)
returns uuid
language plpgsql security definer as $mk$
declare
  v_payment uuid;
  v_session uuid;
begin
  insert into payments (gym_id, member_id, subscription_id, amount, currency, method, status, purpose)
  values (p_gym, p_member, null, 2000, 'XAF', 'cash', 'verified', 'session')
  returning id into v_payment;
  insert into guest_sessions (gym_id, member_id, payment_id, usable_until, voided_at)
  values (p_gym, p_member, v_payment, p_usable_until, p_voided_at)
  returning id into v_session;
  return v_session;
end;
$mk$;

-- A free session backed by a reward_granted ledger row.
create function pg_temp.mk_free(p_gym uuid, p_member uuid, p_usable_until timestamptz) returns uuid
language plpgsql security definer as $mk$
declare
  v_grant uuid;
  v_session uuid;
begin
  insert into loyalty_events (gym_id, member_id, event_type, counter, origin_id)
  values (p_gym, p_member, 'reward_granted', 'guest', gen_random_uuid()) returning id into v_grant;
  insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until)
  values (p_gym, p_member, v_grant, p_usable_until) returning id into v_session;
  return v_session;
end;
$mk$;

-- Mirrors consume_guest_session()'s write followed by the hook call.
create function pg_temp.consume(p_session uuid, p_at timestamptz) returns void
language plpgsql as $c$
declare
  v_s guest_sessions%rowtype;
begin
  perform set_config('request.jwt.claims', '{}', true);
  select * into v_s from guest_sessions where id = p_session;
  update guest_sessions
  set consumed_at = p_at, covered_day = (p_at at time zone 'Africa/Douala')::date
  where id = p_session;
  perform private.on_session_consumed(p_session, v_s.member_id, v_s.gym_id);
end;
$c$;

-- A real refund row: the 0113 trigger runs the reversal hook for consumed sessions.
create function pg_temp.refund(p_session uuid, p_amount integer default null) returns void
language plpgsql security definer as $rf$
declare
  v_s guest_sessions%rowtype;
begin
  perform set_config('request.jwt.claims', '{}', true);
  select * into v_s from guest_sessions where id = p_session;
  insert into refunds (gym_id, payment_id, amount, reason, actor_id)
  select v_s.gym_id, p.id, coalesce(p_amount, p.amount), 'test', '00000000-0000-0000-0000-000000042021'
  from payments p where p.id = v_s.payment_id;
end;
$rf$;

-- Ledger replay: fold one member's events into a counter.
create function pg_temp.replay(p_member uuid, p_counter text default 'guest') returns integer
language plpgsql as $r$
declare
  e record;
  v integer := 0;
begin
  for e in
    select event_type from loyalty_events
    where member_id = p_member and counter = p_counter
    order by occurred_at,
             case event_type when 'reset' then 0 when 'stamp_earned' then 1
                             when 'reward_granted' then 2 else 3 end
  loop
    if e.event_type = 'stamp_earned' then v := v + 1;
    elsif e.event_type in ('reset', 'reward_granted') then v := 0;
    elsif e.event_type = 'stamp_reversed' then v := greatest(v - 1, 0);
    end if;
  end loop;
  return v;
end;
$r$;

insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000042001', 'SW Tier', 6000, 60000, null);

insert into gyms (id, name, tier_id, status, charge_guests_per_session, registration_fee,
                  loyalty_enabled, loyalty_guest_threshold, loyalty_renewal_threshold, loyalty_reward_days) values
  ('00000000-0000-0000-0000-000000042011', 'SW Gym A (on, N 3)',     '00000000-0000-0000-0000-000000042001', 'active',    true, 0, true,  3, 3, 1),
  ('00000000-0000-0000-0000-000000042012', 'SW Gym B (program off)', '00000000-0000-0000-0000-000000042001', 'active',    true, 0, false, 3, 3, 1),
  ('00000000-0000-0000-0000-000000042013', 'SW Gym C (suspended)',   '00000000-0000-0000-0000-000000042001', 'suspended', true, 0, true,  3, 3, 1);

insert into auth.users (id)
select ('00000000-0000-0000-0000-0000000420' || lpad(to_hex(g), 2, '0'))::uuid
from generate_series(x'21'::int, x'36'::int) g;

-- Members 0x31.. (member user ids are 0x21.. + the same offset; 0x21 is the owner).
insert into members (id, gym_id, user_id, role, name, join_date)
select ('00000000-0000-0000-0000-0000000420' || lpad(to_hex(g + 16), 2, '0'))::uuid,
       case when g = x'28'::int then '00000000-0000-0000-0000-000000042012'::uuid
            when g = x'2e'::int then '00000000-0000-0000-0000-000000042013'::uuid
            else '00000000-0000-0000-0000-000000042011'::uuid end,
       ('00000000-0000-0000-0000-0000000420' || lpad(to_hex(g), 2, '0'))::uuid,
       case when g = x'21'::int then 'owner'::member_role else 'member'::member_role end,
       'SW M' || to_hex(g), current_date
from generate_series(x'21'::int, x'36'::int) g;

-- Member ids: 0x31 owner A; 0x32 m1; 0x33 m2; 0x34 m3; 0x35 m4; 0x36 m5; 0x37 m6;
-- 0x38 m7 (gym B); 0x39 m8; 0x3a m9; 0x3b m10; 0x3c m11; 0x3d m12; 0x3e m13 (gym C);
-- 0x3f m14; 0x40 m15; 0x44-0x46 reversal-guard members (post-reward, post-reset, no stamp).
insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000042061', '00000000-0000-0000-0000-000000042011', 'SW PPS',    'pay_per_session', 2000,  'XAF', 'monthly', null),
  ('00000000-0000-0000-0000-000000042062', '00000000-0000-0000-0000-000000042011', 'SW Monthly', 'monthly',         15000, 'XAF', 'monthly', 30),
  ('00000000-0000-0000-0000-000000042063', '00000000-0000-0000-0000-000000042011', 'SW Annual',  'monthly',         90000, 'XAF', 'monthly', 365);

-- m10 (0x3b) annual subscriber, m11 (0x3c) monthly subscriber.
insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date, created_at) values
  ('00000000-0000-0000-0000-000000042011', '00000000-0000-0000-0000-00000004203b', '00000000-0000-0000-0000-000000042063', 'active', current_date, current_date + 365, now() - interval '200 days'),
  ('00000000-0000-0000-0000-000000042011', '00000000-0000-0000-0000-00000004203c', '00000000-0000-0000-0000-000000042062', 'active', current_date, current_date + 30,  now() - interval '200 days');

-- ============================================================================
-- Interface.
-- ============================================================================
select is(
  (select pg_get_function_identity_arguments('private.on_session_refunded_after_consumption(uuid, uuid, uuid)'::regprocedure)),
  'p_session_id uuid, p_member_id uuid, p_gym_id uuid',
  'refund hook keeps its signature');
select is(
  (select pg_get_function_identity_arguments('private.award_renewal_stamp(uuid)'::regprocedure)),
  'p_payment_id uuid', 'renewal hook keeps its signature');
select is(
  (select count(*)::int from cron.job where jobname = 'loyalty_sweep' and schedule = '30 3 * * *' and username = 'postgres'),
  1, 'the sweep is scheduled daily');

-- ============================================================================
-- Reversal.
-- ============================================================================
-- m1: two stamps, refund the second consumed session: stamps 2 -> 1.
select pg_temp.consume(pg_temp.mk_paid('00000000-0000-0000-0000-000000042011', '00000000-0000-0000-0000-000000042032'), now() - interval '3 days');
select pg_temp.consume(pg_temp.mk_paid('00000000-0000-0000-0000-000000042011', '00000000-0000-0000-0000-000000042032'), now() - interval '2 days');
select is((select guest_stamps from loyalty_progress where member_id = '00000000-0000-0000-0000-000000042032'), 2, 'm1: two stamps before the refund');

select pg_temp.refund((select s.id from guest_sessions s where s.member_id = '00000000-0000-0000-0000-000000042032'
                       and s.consumed_at > now() - interval '60 hours'));

select is(
  (select guest_stamps from loyalty_progress where member_id = '00000000-0000-0000-0000-000000042032'),
  1, 'm1: refund of a counted stamp takes it back');
select is(
  (select count(*)::int from loyalty_events where member_id = '00000000-0000-0000-0000-000000042032' and event_type = 'stamp_reversed'),
  1, 'm1: one stamp_reversed event');
select is(
  (select e.origin_id from loyalty_events e where e.member_id = '00000000-0000-0000-0000-000000042032' and e.event_type = 'stamp_reversed'),
  (select s.id from guest_sessions s where s.member_id = '00000000-0000-0000-0000-000000042032' and s.consumed_at > now() - interval '60 hours'),
  'm1: the reversal origin_id is the session id');
select is(
  (select count(*)::int from audit_log where action_type = 'loyalty_stamp_reversed' and target_entity_id = '00000000-0000-0000-0000-000000042032'),
  1, 'm1: one loyalty_stamp_reversed audit row');
select is(
  (select guest_last_event_at from loyalty_progress where member_id = '00000000-0000-0000-0000-000000042032'),
  now() - interval '2 days', 'm1: guest_last_event_at is untouched');
select is(
  pg_temp.replay('00000000-0000-0000-0000-000000042032'), 1, 'm1: ledger fold equals the counter');

-- m5: replay: a second call for the same session changes nothing.
select pg_temp.consume(pg_temp.mk_paid('00000000-0000-0000-0000-000000042011', '00000000-0000-0000-0000-000000042036'), now() - interval '4 days');
select pg_temp.consume(pg_temp.mk_paid('00000000-0000-0000-0000-000000042011', '00000000-0000-0000-0000-000000042036'), now() - interval '3 days');
select pg_temp.refund((select s.id from guest_sessions s where s.member_id = '00000000-0000-0000-0000-000000042036'
                       and s.consumed_at = now() - interval '3 days'), 1000);
select private.on_session_refunded_after_consumption(
  (select s.id from guest_sessions s where s.member_id = '00000000-0000-0000-0000-000000042036' and s.consumed_at = now() - interval '3 days'),
  '00000000-0000-0000-0000-000000042036', '00000000-0000-0000-0000-000000042011');
select is(
  (select row(guest_stamps, (select count(*) from loyalty_events e where e.member_id = lp.member_id and e.event_type = 'stamp_reversed'))::text
   from loyalty_progress lp where member_id = '00000000-0000-0000-0000-000000042036'),
  '(1,1)', 'm5: partial refund then a replay reverses once');

-- m2: refund after the reward at N: nothing written, the free session stays.
select pg_temp.consume(pg_temp.mk_paid('00000000-0000-0000-0000-000000042011', '00000000-0000-0000-0000-000000042033'), now() - interval '6 days');
select pg_temp.consume(pg_temp.mk_paid('00000000-0000-0000-0000-000000042011', '00000000-0000-0000-0000-000000042033'), now() - interval '5 days');
select pg_temp.consume(pg_temp.mk_paid('00000000-0000-0000-0000-000000042011', '00000000-0000-0000-0000-000000042033'), now() - interval '4 days');
select is(
  (select count(*)::int from guest_sessions where member_id = '00000000-0000-0000-0000-000000042033' and loyalty_grant_id is not null),
  1, 'm2: the third stamp granted one free session');
select pg_temp.refund((select s.id from guest_sessions s where s.member_id = '00000000-0000-0000-0000-000000042033'
                       and s.consumed_at = now() - interval '4 days'));
select is(
  (select count(*)::int from loyalty_events where member_id = '00000000-0000-0000-0000-000000042033' and event_type = 'stamp_reversed'),
  0, 'm2: a stamp that triggered the grant is not reversed');
select is(
  (select count(*)::int from guest_sessions where member_id = '00000000-0000-0000-0000-000000042033'
     and loyalty_grant_id is not null and consumed_at is null and voided_at is null),
  1, 'm2: the granted free session stays');
-- A stamp before the reward is also gone: refund the first one.
select pg_temp.refund((select s.id from guest_sessions s where s.member_id = '00000000-0000-0000-0000-000000042033'
                       and s.consumed_at = now() - interval '6 days'));
select is(
  (select count(*)::int from loyalty_events where member_id = '00000000-0000-0000-0000-000000042033' and event_type = 'stamp_reversed'),
  0, 'm2: a stamp before the reward was zeroed by it and is not reversed');

-- m17 (0x44): the guard must hold while the counter is above 0. Three stamps
-- grant (counter 0), a fourth stamp counts (counter 1); refunding the first
-- stamp, which the reward zeroed, must leave the fourth alone.
select pg_temp.consume(pg_temp.mk_paid('00000000-0000-0000-0000-000000042011', '00000000-0000-0000-0000-000000042044'), now() - interval '9 days');
select pg_temp.consume(pg_temp.mk_paid('00000000-0000-0000-0000-000000042011', '00000000-0000-0000-0000-000000042044'), now() - interval '8 days');
select pg_temp.consume(pg_temp.mk_paid('00000000-0000-0000-0000-000000042011', '00000000-0000-0000-0000-000000042044'), now() - interval '7 days');
select pg_temp.consume(pg_temp.mk_paid('00000000-0000-0000-0000-000000042011', '00000000-0000-0000-0000-000000042044'), now() - interval '6 days');
select pg_temp.refund((select s.id from guest_sessions s where s.member_id = '00000000-0000-0000-0000-000000042044'
                       and s.consumed_at = now() - interval '9 days'));
select is(
  (select row(guest_stamps, (select count(*) from loyalty_events e where e.member_id = lp.member_id and e.event_type = 'stamp_reversed'))::text
   from loyalty_progress lp where member_id = '00000000-0000-0000-0000-000000042044'),
  '(1,0)', 'm17: refund of a stamp zeroed by a reward leaves the later stamp counted');
select is(
  pg_temp.replay('00000000-0000-0000-0000-000000042044'), 1, 'm17: ledger fold equals the counter');

-- m18 (0x45): same after an idle reset. Stamp 100 days ago, a second stamp
-- now (the earn hook resets first, then counts it: counter 1); refunding the
-- first stamp must not take the second.
select pg_temp.consume(pg_temp.mk_paid('00000000-0000-0000-0000-000000042011', '00000000-0000-0000-0000-000000042045'), now() - interval '100 days');
select pg_temp.consume(pg_temp.mk_paid('00000000-0000-0000-0000-000000042011', '00000000-0000-0000-0000-000000042045'), now() - interval '1 day');
select pg_temp.refund((select s.id from guest_sessions s where s.member_id = '00000000-0000-0000-0000-000000042045'
                       and s.consumed_at = now() - interval '100 days'));
select is(
  (select row(guest_stamps, (select count(*) from loyalty_events e where e.member_id = lp.member_id and e.event_type = 'stamp_reversed'))::text
   from loyalty_progress lp where member_id = '00000000-0000-0000-0000-000000042045'),
  '(1,0)', 'm18: refund of a stamp zeroed by an idle reset leaves the later stamp counted');

-- m19 (0x46): a consumed session that never earned a stamp, member at 2 stamps.
insert into loyalty_progress (gym_id, member_id, guest_stamps, guest_last_event_at) values
  ('00000000-0000-0000-0000-000000042011', '00000000-0000-0000-0000-000000042046', 2, now() - interval '1 day');
select pg_temp.mk_paid('00000000-0000-0000-0000-000000042011', '00000000-0000-0000-0000-000000042046');
update guest_sessions set consumed_at = now() - interval '2 days',
                          covered_day = ((now() - interval '2 days') at time zone 'Africa/Douala')::date
where member_id = '00000000-0000-0000-0000-000000042046';
select pg_temp.refund((select s.id from guest_sessions s where s.member_id = '00000000-0000-0000-0000-000000042046'));
select is(
  (select row(guest_stamps, (select count(*) from loyalty_events e where e.member_id = lp.member_id and e.event_type = 'stamp_reversed'))::text
   from loyalty_progress lp where member_id = '00000000-0000-0000-0000-000000042046'),
  '(2,0)', 'm19: refund of a consumed session with no stamp event leaves the counter');

-- m3: stamp predates a persisted idle reset (written by the sweep below).
select pg_temp.consume(pg_temp.mk_paid('00000000-0000-0000-0000-000000042011', '00000000-0000-0000-0000-000000042034'), now() - interval '100 days');

-- m4: counter already 0 although the stamp event exists.
select pg_temp.consume(pg_temp.mk_paid('00000000-0000-0000-0000-000000042011', '00000000-0000-0000-0000-000000042035'), now() - interval '2 days');
update loyalty_progress set guest_stamps = 0 where member_id = '00000000-0000-0000-0000-000000042035';
select pg_temp.refund((select s.id from guest_sessions s where s.member_id = '00000000-0000-0000-0000-000000042035'));
select is(
  (select row(guest_stamps, (select count(*) from loyalty_events e where e.member_id = lp.member_id and e.event_type = 'stamp_reversed'))::text
   from loyalty_progress lp where member_id = '00000000-0000-0000-0000-000000042035'),
  '(0,0)', 'm4: counter 0 stays 0, no event');

-- m6: program switched off after the stamp: reversal still runs.
select pg_temp.consume(pg_temp.mk_paid('00000000-0000-0000-0000-000000042011', '00000000-0000-0000-0000-000000042037'), now() - interval '2 days');
select pg_temp.consume(pg_temp.mk_paid('00000000-0000-0000-0000-000000042011', '00000000-0000-0000-0000-000000042037'), now() - interval '1 day');
select set_config('app.loyalty_program_update_bypass', 'true', true);
update gyms set loyalty_enabled = false where id = '00000000-0000-0000-0000-000000042011';
select set_config('app.loyalty_program_update_bypass', 'false', true);
select pg_temp.refund((select s.id from guest_sessions s where s.member_id = '00000000-0000-0000-0000-000000042037'
                       and s.consumed_at = now() - interval '1 day'));
select is(
  (select guest_stamps from loyalty_progress where member_id = '00000000-0000-0000-0000-000000042037'),
  1, 'm6: reversal works while the program is off');
select set_config('app.loyalty_program_update_bypass', 'true', true);
update gyms set loyalty_enabled = true where id = '00000000-0000-0000-0000-000000042011';
select set_config('app.loyalty_program_update_bypass', 'false', true);

-- Subscriber stamps are never reversed: a subscription payment refund has no session.
select is(
  (select count(*)::int from loyalty_events where counter = 'subscriber' and event_type = 'stamp_reversed'),
  0, 'no subscriber stamp reversal exists');

-- ============================================================================
-- Sweep: lapses.
-- ============================================================================
-- m7 (0x38, gym B, off): free session past 60 days unused.
select pg_temp.mk_free('00000000-0000-0000-0000-000000042012', '00000000-0000-0000-0000-000000042038', now() - interval '1 day');
-- m8 (0x39): paid past 7 days unused; voided past; consumed past; still usable.
select pg_temp.mk_paid('00000000-0000-0000-0000-000000042011', '00000000-0000-0000-0000-000000042039', now() - interval '1 day');
select pg_temp.mk_paid('00000000-0000-0000-0000-000000042011', '00000000-0000-0000-0000-000000042039', now() - interval '3 days', now() - interval '2 days');
select pg_temp.consume(pg_temp.mk_paid('00000000-0000-0000-0000-000000042011', '00000000-0000-0000-0000-000000042039', now() - interval '3 days'), now() - interval '5 days');
select pg_temp.mk_paid('00000000-0000-0000-0000-000000042011', '00000000-0000-0000-0000-000000042039', now() + interval '3 days');

-- m9 (0x3a): guest counter past window.
insert into loyalty_progress (gym_id, member_id, guest_stamps, guest_last_event_at) values
  ('00000000-0000-0000-0000-000000042011', '00000000-0000-0000-0000-00000004203a', 2, now() - interval '91 days');
insert into loyalty_events (gym_id, member_id, event_type, counter, origin_id, occurred_at) values
  ('00000000-0000-0000-0000-000000042011', '00000000-0000-0000-0000-00000004203a', 'stamp_earned', 'guest', gen_random_uuid(), now() - interval '92 days'),
  ('00000000-0000-0000-0000-000000042011', '00000000-0000-0000-0000-00000004203a', 'stamp_earned', 'guest', gen_random_uuid(), now() - interval '91 days');
-- m16 (0x43): two subscriptions; the LATEST plan (80 days) plus the gym grace (30)
-- gives a 110-day window, the older 30-day plan would give 90. Idle 100 days: not reset.
insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000042064', '00000000-0000-0000-0000-000000042011', 'SW Eighty', 'monthly', 40000, 'XAF', 'monthly', 80);
update gyms set grace_period_days = 30 where id = '00000000-0000-0000-0000-000000042011';
insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date, created_at) values
  ('00000000-0000-0000-0000-000000042011', '00000000-0000-0000-0000-000000042043', '00000000-0000-0000-0000-000000042062', 'expired', current_date - 300, current_date - 270, now() - interval '300 days'),
  ('00000000-0000-0000-0000-000000042011', '00000000-0000-0000-0000-000000042043', '00000000-0000-0000-0000-000000042064', 'active', current_date, current_date + 80, now() - interval '200 days');
insert into loyalty_progress (gym_id, member_id, subscriber_stamps, subscriber_last_event_at) values
  ('00000000-0000-0000-0000-000000042011', '00000000-0000-0000-0000-000000042043', 2, now() - interval '100 days');
-- m10: annual subscriber 120 days; m11: monthly subscriber 100 days.
insert into loyalty_progress (gym_id, member_id, subscriber_stamps, subscriber_last_event_at) values
  ('00000000-0000-0000-0000-000000042011', '00000000-0000-0000-0000-00000004203b', 2, now() - interval '120 days'),
  ('00000000-0000-0000-0000-000000042011', '00000000-0000-0000-0000-00000004203c', 2, now() - interval '100 days');
-- m12 (0x3d): exactly inside the window (89 days): no reset.
insert into loyalty_progress (gym_id, member_id, guest_stamps, guest_last_event_at) values
  ('00000000-0000-0000-0000-000000042011', '00000000-0000-0000-0000-00000004203d', 2, now() - interval '89 days');
-- m13 (0x3e, suspended gym C): lapse and reset still happen.
select pg_temp.mk_paid('00000000-0000-0000-0000-000000042013', '00000000-0000-0000-0000-00000004203e', now() - interval '1 day');
insert into loyalty_progress (gym_id, member_id, guest_stamps, guest_last_event_at) values
  ('00000000-0000-0000-0000-000000042013', '00000000-0000-0000-0000-00000004203e', 1, now() - interval '95 days');

-- m15 (0x40) earn racing sweep, order A: sweep first, then consume; m14 (0x3f) order B.
insert into loyalty_progress (gym_id, member_id, guest_stamps, guest_last_event_at) values
  ('00000000-0000-0000-0000-000000042011', '00000000-0000-0000-0000-000000042040', 2, now() - interval '100 days'),
  ('00000000-0000-0000-0000-000000042011', '00000000-0000-0000-0000-00000004203f', 2, now() - interval '100 days');
select pg_temp.mk_paid('00000000-0000-0000-0000-000000042011', '00000000-0000-0000-0000-00000004203f');
-- order B: consume first (the hook resets itself), then the sweep.
select pg_temp.consume(
  (select s.id from guest_sessions s where s.member_id = '00000000-0000-0000-0000-00000004203f'),
  now() - interval '1 hour');

select set_config('request.jwt.claims', '{}', true);
select run_loyalty_sweep_job();

select is(
  (select row(count(*), min(e.details ->> 'kind'))::text from loyalty_events e
   where e.event_type = 'lapse' and e.member_id = '00000000-0000-0000-0000-000000042038'),
  '(1,free)', 'free session past 60 days: one lapse, kind free');
select is(
  (select count(*)::int from audit_log where action_type = 'loyalty_free_session_lapsed'
     and target_entity_id = '00000000-0000-0000-0000-000000042038'),
  1, 'free lapse: one audit row');
select is(
  (select e.occurred_at from loyalty_events e where e.event_type = 'lapse'
     and e.member_id = '00000000-0000-0000-0000-000000042038'),
  now() - interval '1 day', 'lapse is dated at usable_until');
select is(
  (select row(count(*), min(e.details ->> 'kind'))::text from loyalty_events e
   where e.event_type = 'lapse' and e.member_id = '00000000-0000-0000-0000-000000042039'),
  '(1,paid)', 'paid session past 7 days: one lapse, kind paid; voided, consumed and usable ones none');
select is(
  (select count(*)::int from audit_log where action_type = 'loyalty_paid_session_lapsed'
     and target_entity_id = '00000000-0000-0000-0000-000000042039'),
  1, 'paid lapse: one audit row');
select is(
  (select count(*)::int from guest_sessions where member_id = '00000000-0000-0000-0000-000000042039'
     and consumed_at is null and voided_at is null and usable_until > now() - interval '2 days' and usable_until < now()),
  1, 'the lapsed session row itself is not changed');

-- ============================================================================
-- Sweep: resets.
-- ============================================================================
select is(
  (select row(guest_stamps, (select count(*) from loyalty_events e where e.member_id = lp.member_id and e.event_type = 'reset'))::text
   from loyalty_progress lp where member_id = '00000000-0000-0000-0000-00000004203a'),
  '(0,1)', 'guest counter 91 days idle: reset event, stamps 0');
select is(
  (select e.details ->> 'previous_count' from loyalty_events e
   where e.member_id = '00000000-0000-0000-0000-00000004203a' and e.event_type = 'reset'),
  '2', 'reset details carry the previous count');
select is(
  (select count(*)::int from audit_log where action_type = 'loyalty_progress_reset'
     and target_entity_id = '00000000-0000-0000-0000-00000004203a'
     and metadata ->> 'source' = 'sweep'
     and actor_display_name = 'system:loyalty_sweep_job'),
  1, 'reset audit row: system label, previous count and window');
select is(
  (select e.origin_id from loyalty_events e where e.member_id = '00000000-0000-0000-0000-00000004203a' and e.event_type = 'reset'),
  md5('loyalty_sweep_reset:00000000-0000-0000-0000-00000004203a:guest:'
      || extract(epoch from (now() - interval '91 days'))::text)::uuid,
  'reset origin_id is derived from member, counter and last-event timestamp');
select is(
  pg_temp.replay('00000000-0000-0000-0000-00000004203a'), 0, 'm9: ledger fold equals the counter');
select is(
  (select subscriber_stamps from loyalty_progress where member_id = '00000000-0000-0000-0000-00000004203b'),
  2, 'annual plan subscriber at 120 days: window is 365 + grace, no reset');
select is(
  (select subscriber_stamps from loyalty_progress where member_id = '00000000-0000-0000-0000-00000004203c'),
  0, 'monthly plan subscriber at 100 days: window 90, reset');
select is(
  (select e.details ->> 'idle_reset_days' from loyalty_events e
   where e.member_id = '00000000-0000-0000-0000-00000004203c' and e.event_type = 'reset' and e.counter = 'subscriber'),
  (select loyalty_idle_reset_days::text from platform_session_config limit 1), 'subscriber reset details carry the window');
select is(
  (select guest_stamps from loyalty_progress where member_id = '00000000-0000-0000-0000-00000004203d'),
  2, 'guest counter inside the window: untouched');
select is(
  (select count(*)::int from loyalty_events where member_id = '00000000-0000-0000-0000-00000004203e' and event_type in ('lapse', 'reset')),
  2, 'suspended gym: lapse and reset still recorded');

-- m3: stamp predates the sweep's persisted reset: refund writes nothing.
select is(
  (select count(*)::int from loyalty_events where member_id = '00000000-0000-0000-0000-000000042034' and event_type = 'reset'),
  1, 'm3: the sweep persisted a reset');
select pg_temp.refund((select s.id from guest_sessions s where s.member_id = '00000000-0000-0000-0000-000000042034'));
select is(
  (select count(*)::int from loyalty_events where member_id = '00000000-0000-0000-0000-000000042034' and event_type = 'stamp_reversed'),
  0, 'm3: refund after an idle reset writes nothing');
select is(
  (select guest_stamps from loyalty_progress where member_id = '00000000-0000-0000-0000-000000042034'),
  0, 'm3: counter stays 0, never negative');

-- Earn racing sweep: both orders end on one stamp.
select is(
  (select guest_stamps from loyalty_progress where member_id = '00000000-0000-0000-0000-00000004203f'),
  1, 'consume then sweep: one stamp');
-- m14 consumed after 100 idle days: the earn hook wrote a reset with the
-- stamp's own origin. Refunding that session must still reverse the stamp.
select is(
  (select count(*)::int from loyalty_events e join guest_sessions s on s.id = e.origin_id
   where s.member_id = '00000000-0000-0000-0000-00000004203f' and e.event_type = 'reset'),
  1, 'm14: the earn hook wrote a reset with the session as origin');
select pg_temp.refund((select s.id from guest_sessions s where s.member_id = '00000000-0000-0000-0000-00000004203f'));
select is(
  (select row(guest_stamps, (select count(*) from loyalty_events e where e.member_id = lp.member_id and e.event_type = 'stamp_reversed'))::text
   from loyalty_progress lp where member_id = '00000000-0000-0000-0000-00000004203f'),
  '(0,1)', 'm14: refund of the first stamp after an idle reset is reversed');
select pg_temp.consume(pg_temp.mk_paid('00000000-0000-0000-0000-000000042011', '00000000-0000-0000-0000-000000042040'), now());
select is(
  (select guest_stamps from loyalty_progress where member_id = '00000000-0000-0000-0000-000000042040'),
  1, 'sweep then consume: one stamp, same result');
-- A stamp earned AFTER the sweep's reset is still counted: its refund is reversed.
select pg_temp.refund((select s.id from guest_sessions s where s.member_id = '00000000-0000-0000-0000-000000042040'
                       and s.consumed_at is not null));
select is(
  (select count(*)::int from loyalty_events where member_id = '00000000-0000-0000-0000-000000042040' and event_type = 'stamp_reversed'),
  1, 'refund of a stamp earned after the sweep reset is reversed');
select is(
  (select guest_stamps from loyalty_progress where member_id = '00000000-0000-0000-0000-000000042040'),
  0, 'post-reset stamp reversed: counter back to 0');

-- Window uses the latest plan plus the gym grace period.
select is(
  (select row(subscriber_stamps, (select count(*) from loyalty_events e where e.member_id = lp.member_id and e.event_type = 'reset'))::text
   from loyalty_progress lp where member_id = '00000000-0000-0000-0000-000000042043'),
  '(2,0)', 'm16 (0x43): latest plan duration + grace keeps the subscriber counter');

-- Refund of a renewal payment that earned a subscriber stamp reverses nothing.
insert into payments (id, gym_id, member_id, subscription_id, amount, currency, method, status, purpose)
select '00000000-0000-0000-0000-0000000420a1', s.gym_id, s.member_id, s.id, 90000, 'XAF', 'cash', 'verified', 'subscription'
from subscriptions s where s.member_id = '00000000-0000-0000-0000-00000004203b';
insert into refunds (gym_id, payment_id, amount, reason, actor_id)
values ('00000000-0000-0000-0000-000000042011', '00000000-0000-0000-0000-0000000420a1', 90000, 'test', '00000000-0000-0000-0000-000000042021');
select is(
  (select row(subscriber_stamps, (select count(*) from loyalty_events e where e.member_id = lp.member_id and e.event_type = 'stamp_reversed'))::text
   from loyalty_progress lp where member_id = '00000000-0000-0000-0000-00000004203b'),
  '(2,0)', 'renewal refund: subscriber counter unchanged, no reversal');

-- ============================================================================
-- Idempotency: a second run and a third (missed days) change nothing.
-- ============================================================================
create temp table before_counts as
select (select count(*) from loyalty_events) as events, (select count(*) from audit_log where action_type like 'loyalty_%') as audits;
select run_loyalty_sweep_job();
select run_loyalty_sweep_job();
select is(
  (select row(events, audits)::text from before_counts),
  (select row((select count(*) from loyalty_events), (select count(*) from audit_log where action_type like 'loyalty_%'))::text),
  'running the sweep again writes no new event or audit row');
select is(
  (select count(*)::int from job_runs where job_name = 'loyalty_sweep' and status = 'success' and started_at = now()),
  3, 'each run wrote its own success job_runs row');

-- Fold equals progress and free sessions balance, for the members we touched.
select is(
  (select count(*)::int from loyalty_progress lp
   where lp.member_id in (select id from members where id::text like '00000000-0000-0000-0000-0000000420%')
     and lp.guest_stamps <> pg_temp.replay(lp.member_id) and lp.member_id <> '00000000-0000-0000-0000-000000042035'
     and lp.member_id not in ('00000000-0000-0000-0000-00000004203d', '00000000-0000-0000-0000-00000004203e', '00000000-0000-0000-0000-000000042046')),
  0, 'guest fold equals loyalty_progress for every member with a full ledger');
select is(
  (select (count(*) filter (where e.event_type = 'reward_granted')
         - count(*) filter (where e.event_type = 'reward_consumed')
         - count(*) filter (where e.event_type = 'lapse' and e.details ->> 'kind' = 'free'))::int
   from loyalty_events e where e.member_id = '00000000-0000-0000-0000-000000042033'),
  (select count(*)::int from guest_sessions where member_id = '00000000-0000-0000-0000-000000042033'
     and loyalty_grant_id is not null and consumed_at is null and voided_at is null and usable_until > now()),
  'unused free sessions equal granted minus consumed minus lapsed');

-- ============================================================================
-- Failure isolation: one member's write raises; the others are processed and
-- the run is logged as a failure.
-- ============================================================================
create function pg_temp.fail_for_member() returns trigger language plpgsql as $t$
begin
  if new.member_id = '00000000-0000-0000-0000-000000042041' then
    raise exception 'boom for member';
  end if;
  return new;
end;
$t$;
create trigger fail_for_member before insert on loyalty_events
  for each row execute function pg_temp.fail_for_member();

insert into loyalty_progress (gym_id, member_id, guest_stamps, guest_last_event_at) values
  ('00000000-0000-0000-0000-000000042011', '00000000-0000-0000-0000-000000042041', 1, now() - interval '95 days'),
  ('00000000-0000-0000-0000-000000042011', '00000000-0000-0000-0000-000000042042', 1, now() - interval '95 days');

select run_loyalty_sweep_job();

select is(
  (select guest_stamps from loyalty_progress where member_id = '00000000-0000-0000-0000-000000042042'),
  0, 'failure isolation: the other member was still processed');
select is(
  (select guest_stamps from loyalty_progress where member_id = '00000000-0000-0000-0000-000000042041'),
  1, 'failure isolation: the failing member rolled back to its savepoint');
select is(
  (select count(*)::int from job_runs
   where job_name = 'loyalty_sweep' and status = 'failure' and started_at = now()
     and error like '1 member(s) failed%'),
  1, 'job_runs holds one failure row with the failed member count');
select is(
  (select count(*)::int from audit_log where action_type = 'loyalty_sweep_job_failure'
     and actor_display_name = 'system:loyalty_sweep_job'),
  1, 'a loyalty_sweep_job_failure audit row exists');

-- The summary audit write raises too: the swept member stays swept and the
-- job_runs failure row (which feeds the hourly alert) survives.
create function pg_temp.fail_summary_audit() returns trigger language plpgsql as $t$
begin
  if new.action_type = 'loyalty_sweep_job_failure' then
    raise exception 'audit boom';
  end if;
  return new;
end;
$t$;
create trigger fail_summary_audit before insert on audit_log
  for each row execute function pg_temp.fail_summary_audit();
update loyalty_progress set guest_stamps = 1, guest_last_event_at = now() - interval '96 days'
where member_id = '00000000-0000-0000-0000-000000042042';

select lives_ok($$ select run_loyalty_sweep_job() $$, 'a raising summary audit write does not abort the run');
select is(
  (select guest_stamps from loyalty_progress where member_id = '00000000-0000-0000-0000-000000042042'),
  0, 'summary audit failure: the swept member stays swept');
select is(
  (select count(*)::int from job_runs
   where job_name = 'loyalty_sweep' and status = 'failure' and started_at = now()
     and error like '1 member(s) failed%'),
  2, 'summary audit failure: the job_runs failure row still exists');
drop trigger fail_summary_audit on audit_log;
drop trigger fail_for_member on loyalty_events;

-- The outer handler: no platform_session_config row (the config read is the
-- first thing the sweep does) lands in the job_runs failure row and the audit row.
create temp table cfg_backup as select * from platform_session_config;
delete from platform_session_config;

select lives_ok($$ select run_loyalty_sweep_job() $$, 'a missing config row does not raise out of the sweep');
select is(
  (select count(*)::int from job_runs
   where job_name = 'loyalty_sweep' and status = 'failure' and started_at = now()
     and error like 'loyalty_sweep: platform_session_config has no loyalty_idle_reset_days%'),
  1, 'outer failure: job_runs failure row records the config error');
select is(
  (select count(*)::int from audit_log
   where action_type = 'loyalty_sweep_job_failure' and actor_display_name = 'system:loyalty_sweep_job'
     and metadata ->> 'error' like 'loyalty_sweep: platform_session_config has no loyalty_idle_reset_days%'),
  1, 'outer failure: the loyalty_sweep_job_failure audit row carries the error');

insert into platform_session_config select * from cfg_backup;
drop table cfg_backup;

-- ============================================================================
-- Hook failure posture: the wrappers swallow the error and record it.
-- ============================================================================
create or replace function private.on_session_consumed_impl(p_session_id uuid, p_member_id uuid, p_gym_id uuid)
returns void language plpgsql set search_path = public as $$
begin
  insert into loyalty_events (gym_id, member_id, event_type, counter, origin_id)
  values (p_gym_id, p_member_id, 'stamp_earned', 'guest', p_session_id);
  raise exception 'earn hook boom';
end;
$$;

select lives_ok(
  $$ select pg_temp.consume(pg_temp.mk_paid('00000000-0000-0000-0000-000000042011', '00000000-0000-0000-0000-000000042032'), now() - interval '10 days') $$,
  'a raising earn hook does not fail the caller');
select is(
  (select count(*)::int from guest_sessions where member_id = '00000000-0000-0000-0000-000000042032'
     and consumed_at = now() - interval '10 days'),
  1, 'the consumption itself stands');
select is(
  (select count(*)::int from loyalty_events e join guest_sessions s on s.id = e.origin_id
   where s.member_id = '00000000-0000-0000-0000-000000042032' and s.consumed_at = now() - interval '10 days'),
  0, 'the failed hook left no ledger write');
select is(
  (select metadata ->> 'hook' from audit_log where action_type = 'loyalty_hook_failed'
     and metadata ->> 'hook' = 'on_session_consumed'
     and actor_display_name = 'system:loyalty_hook'),
  'on_session_consumed', 'a loyalty_hook_failed audit row names the hook');
select is(
  (select count(*)::int from job_runs where job_name = 'loyalty_hook' and status = 'failure'
     and error like 'on_session_consumed P0001: earn hook boom%'),
  1, 'a loyalty_hook failure row carries the SQLSTATE and message');

create or replace function private.award_renewal_stamp_impl(p_payment_id uuid)
returns void language plpgsql set search_path = public as $$
begin
  raise exception 'renewal hook boom';
end;
$$;
select lives_ok(
  $$ select private.award_renewal_stamp('00000000-0000-0000-0000-0000000420f1') $$,
  'a raising renewal hook does not fail the caller');
select is(
  (select count(*)::int from job_runs where job_name = 'loyalty_hook' and error like 'award_renewal_stamp%'),
  1, 'renewal hook failure recorded');

-- Through the real payment path, with a caller: confirm_renewal() as the owner
-- while the renewal hook raises. The renewal commits, and the failure row is
-- attributed to the caller (log_audit_event uses auth.uid() when it is set).
create temp table ac3_before as
select (select count(*) from subscriptions where member_id = '00000000-0000-0000-0000-00000004203c') as subs;
grant all on ac3_before to public;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000042021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000042011","app_role":"owner"}', true);
select 1 from confirm_renewal('00000000-0000-0000-0000-00000004203c', 'cash', 'ac3 renewal');
reset role;
select set_config('request.jwt.claims', '{}', true);

select is(
  (select count(*) from subscriptions where member_id = '00000000-0000-0000-0000-00000004203c') - (select subs from ac3_before),
  1::bigint, 'AC3: the renewal subscription committed although the hook raised');
select is(
  (select count(*)::int from payments where member_id = '00000000-0000-0000-0000-00000004203c'
     and reason = 'ac3 renewal' and status = 'verified'),
  1, 'AC3: the verified renewal payment committed');
select is(
  (select actor_id from audit_log where action_type = 'loyalty_hook_failed'
     and metadata ->> 'hook' = 'award_renewal_stamp'
     and metadata ->> 'member_id' = '00000000-0000-0000-0000-00000004203c'),
  '00000000-0000-0000-0000-000000042021'::uuid,
  'with a caller present the failure row is attributed to that caller');
select is(
  (select count(*)::int from job_runs where job_name = 'loyalty_hook' and error like 'award_renewal_stamp%'),
  2, 'the caller path also wrote its loyalty_hook failure row');

create or replace function private.on_session_refunded_after_consumption_impl(p_session_id uuid, p_member_id uuid, p_gym_id uuid)
returns void language plpgsql set search_path = public as $$
begin
  raise exception 'refund hook boom';
end;
$$;
select lives_ok(
  $$ select pg_temp.refund((select s.id from guest_sessions s where s.member_id = '00000000-0000-0000-0000-000000042032'
                            and s.consumed_at = now() - interval '10 days')) $$,
  'a raising reversal hook does not fail the refund');
select is(
  (select count(*)::int from audit_log where action_type = 'loyalty_hook_failed'
     and metadata ->> 'hook' = 'on_session_refunded_after_consumption'),
  1, 'reversal hook failure recorded');

select * from finish();
rollback;
