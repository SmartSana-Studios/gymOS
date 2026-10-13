-- Story 20.3: loyalty subscriber rule (migration 0119), positive paths and the
-- I/O matrix, through the real confirm_renewal() and complete_verified_payment().
-- Denial paths live in loyalty_subscriber_rule.negative.test.sql.
--
-- One transaction means now() is fixed, so a chain of renewals shares one
-- created_at. pg_temp.age() moves the newest subscription of a member one minute
-- past the member's previous newest one, which is what real time does between
-- renewals, and pg_temp.prev_expiry() sets the expiry the next renewal is judged
-- against (gym-local dates, Africa/Douala).
--
-- Fixture ids: 00000000-0000-0000-0000-0000000500xx.

begin;
select plan(94);

create function pg_temp.today() returns date language sql as $f$
  select (now() at time zone 'Africa/Douala')::date
$f$;

-- Subscription fixture. status stays 'active' unless asked: the rule judges the
-- expiry date, not the lifecycle status.
create function pg_temp.sub(p_member uuid, p_plan uuid, p_expiry date, p_status text default 'active')
returns uuid language sql security definer as $f$
  insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date, created_at)
  select m.gym_id, m.id, p_plan, p_status::subscription_status, current_date - 60, p_expiry, now() - interval '60 days'
  from members m where m.id = p_member
  returning id
$f$;

-- Newest subscription (created at now() by the renewal) becomes one minute newer
-- than the member's previous newest.
create function pg_temp.age(p_member uuid) returns void language sql security definer as $f$
  update subscriptions s
  set created_at = (select max(o.created_at) from subscriptions o
                    where o.member_id = p_member and o.created_at < now()) + interval '1 minute'
  where s.member_id = p_member and s.created_at = now()
$f$;

-- The expiry the next renewal is judged against: the member's newest subscription.
create function pg_temp.prev_expiry(p_member uuid, p_expiry date) returns void language sql security definer as $f$
  update subscriptions s set expiry_date = p_expiry, start_date = least(s.start_date, p_expiry - 30)
  where s.id = (select o.id from subscriptions o where o.member_id = p_member
                order by o.created_at desc, o.id desc limit 1)
$f$;

create function pg_temp.stamps(p_member uuid) returns integer language sql as $f$
  select coalesce((select subscriber_stamps from loyalty_progress where member_id = p_member), -1)
$f$;

create function pg_temp.events(p_member uuid, p_type text) returns integer language sql as $f$
  select count(*)::int from loyalty_events
  where member_id = p_member and counter = 'subscriber' and event_type = p_type
$f$;

create function pg_temp.newest_expiry(p_member uuid) returns date language sql as $f$
  select expiry_date from subscriptions where member_id = p_member order by created_at desc, id desc limit 1
$f$;

-- Ledger replay: fold one member's subscriber events into a counter.
create function pg_temp.replay(p_member uuid) returns integer
language plpgsql as $r$
declare
  e record;
  v integer := 0;
begin
  for e in
    select event_type from loyalty_events
    where member_id = p_member and counter = 'subscriber'
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
  ('00000000-0000-0000-0000-000000050001', 'SR Tier', 6000, 60000, null);

insert into gyms (id, name, tier_id, status, charge_guests_per_session, registration_fee,
                  loyalty_enabled, loyalty_guest_threshold, loyalty_renewal_threshold, loyalty_reward_days) values
  ('00000000-0000-0000-0000-000000050011', 'SR Gym A (on, K 3, R 7)', '00000000-0000-0000-0000-000000050001', 'active', true, 0, true,  3, 3, 7),
  ('00000000-0000-0000-0000-000000050012', 'SR Gym B (program off)',  '00000000-0000-0000-0000-000000050001', 'active', true, 0, false, 3, 3, 7);

insert into auth.users (id)
select ('00000000-0000-0000-0000-0000000500' || lpad(to_hex(n), 2, '0'))::uuid
from generate_series(32, 51) n; -- 0x20 .. 0x33

-- 0x20 receptionist A; members 0x21 .. : see the map below.
insert into members (id, gym_id, user_id, role, name, join_date)
select ('00000000-0000-0000-0000-0000000500' || lpad(to_hex(n + 16), 2, '0'))::uuid, -- 0x30 + ...
       case when n = 32 + 8 then '00000000-0000-0000-0000-000000050012'::uuid
            else '00000000-0000-0000-0000-000000050011'::uuid end,
       ('00000000-0000-0000-0000-0000000500' || lpad(to_hex(n), 2, '0'))::uuid,
       case when n = 32 then 'receptionist'::member_role else 'member'::member_role end,
       'SR ' || n, current_date
from generate_series(32, 51) n;

-- Map (member id = 0x30 + offset from 0x20):
--   0x30 receptionist A
--   0x31 M1 chain to K via confirm_renewal
--   0x32 M2 late
--   0x33 M3 early + immediate second renewal
--   0x34 M4 on time vs extended expiry
--   0x35 M5 back-dated
--   0x36 M6 renew_subscription override
--   0x37 M7 pay-per-session
--   0x38 M8 program off (gym B)
--   0x39 M9 replay at below-K
--   0x3a M10 idle reset
--   0x3b M11 above lowered K
--   0x3c M12 webhook chain to K
--   0x3d M13 webhook late
--   0x3e M14 queue + other purposes + voided
--   0x3f M15 plan change
--   0x40 M16 refund after reward
--   0x41 M17 idle window not yet passed
--   0x42 M18 previous without expiry_date
--   0x43 M19 renewal verified on the day after expiry (webhook)
--   0x44 M20 first-ever subscription, no previous

insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000050061', '00000000-0000-0000-0000-000000050011', 'SR Monthly A', 'monthly',         15000, 'XAF', 'monthly', 30),
  ('00000000-0000-0000-0000-000000050062', '00000000-0000-0000-0000-000000050011', 'SR PPS A',     'pay_per_session', 2000,  'XAF', 'monthly', null),
  ('00000000-0000-0000-0000-000000050063', '00000000-0000-0000-0000-000000050012', 'SR Monthly B', 'monthly',         15000, 'XAF', 'monthly', 30),
  ('00000000-0000-0000-0000-000000050064', '00000000-0000-0000-0000-000000050011', 'SR Class A',   'class_only',      9000,  'XAF', 'monthly', 30);

-- Starting subscriptions: all on the monthly plan, expiring today, 60 days old.
select pg_temp.sub(m.id, '00000000-0000-0000-0000-000000050061', pg_temp.today())
from members m
where m.id::text between '00000000-0000-0000-0000-000000050031' and '00000000-0000-0000-0000-000000050044'
  and m.id not in ('00000000-0000-0000-0000-000000050037', '00000000-0000-0000-0000-000000050038',
                   '00000000-0000-0000-0000-00000005003f', '00000000-0000-0000-0000-000000050042',
                   '00000000-0000-0000-0000-000000050044');
select pg_temp.sub('00000000-0000-0000-0000-000000050037', '00000000-0000-0000-0000-000000050062', null);
select pg_temp.sub('00000000-0000-0000-0000-000000050038', '00000000-0000-0000-0000-000000050063', pg_temp.today());
select pg_temp.sub('00000000-0000-0000-0000-00000005003f', '00000000-0000-0000-0000-000000050064', pg_temp.today());
-- M18: previous subscription without an expiry_date (pay_per_session plan).
select pg_temp.sub('00000000-0000-0000-0000-000000050042', '00000000-0000-0000-0000-000000050062', null);

-- ============================================================================
-- Interface.
-- ============================================================================
select is(
  (select pg_get_function_identity_arguments('private.award_renewal_stamp(uuid)'::regprocedure)),
  'p_payment_id uuid', 'hook signature');
select is(
  (select has_function_privilege('authenticated', 'private.award_renewal_stamp(uuid)', 'execute')
       or has_function_privilege('anon', 'private.award_renewal_stamp(uuid)', 'execute')),
  false, 'hook is not executable by client roles');
select is(
  (select pg_get_function_identity_arguments('public.confirm_renewal(uuid, text, text, boolean)'::regprocedure)),
  'p_member_id uuid, p_method text, p_reason text, p_backdate boolean, OUT payment_id uuid, OUT subscription_id uuid, OUT amount integer, OUT currency text, OUT new_expiry_date date',
  'confirm_renewal keeps its signature');

-- ============================================================================
-- M1: three on-time renewals through confirm_renewal (expiry day, day after,
-- expiry day), the Kth grants R free days.
-- ============================================================================
create temp table m1 (step int, payment_id uuid, subscription_id uuid, new_expiry date);
grant all on m1 to public;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000050020","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000050011","app_role":"receptionist"}', true);
insert into m1 select 1, r.payment_id, r.subscription_id, r.new_expiry_date
from confirm_renewal('00000000-0000-0000-0000-000000050031', 'cash', 'renewal 1') r;
reset role;

select is(pg_temp.stamps('00000000-0000-0000-0000-000000050031'), 1, 'M1: renewed on the expiry day earns the first stamp');
select is(
  (select e.origin_id from loyalty_events e
   where e.member_id = '00000000-0000-0000-0000-000000050031' and e.event_type = 'stamp_earned'),
  (select payment_id from m1 where step = 1), 'M1: stamp origin_id is the payment id');
select is(
  (select actor_id from audit_log where action_type = 'loyalty_stamp_earned'
     and target_entity_id = '00000000-0000-0000-0000-000000050031'),
  '00000000-0000-0000-0000-000000050020'::uuid, 'M1: audit actor is the staff caller');
select is(
  (select metadata ->> 'counter' from audit_log where action_type = 'loyalty_stamp_earned'
     and target_entity_id = '00000000-0000-0000-0000-000000050031'),
  'subscriber', 'M1: audit metadata carries counter subscriber');
select is(
  (select new_expiry from m1 where step = 1),
  (select start_date + 30 from subscriptions where id = (select subscription_id from m1 where step = 1)),
  'M1: below K the returned expiry is the plan-produced one');

select pg_temp.age('00000000-0000-0000-0000-000000050031');
select pg_temp.prev_expiry('00000000-0000-0000-0000-000000050031', pg_temp.today() - 1);
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000050020","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000050011","app_role":"receptionist"}', true);
insert into m1 select 2, r.payment_id, r.subscription_id, r.new_expiry_date
from confirm_renewal('00000000-0000-0000-0000-000000050031', 'cash', 'renewal 2') r;
reset role;
select is(pg_temp.stamps('00000000-0000-0000-0000-000000050031'), 2, 'M1: renewed the day after expiry earns the second stamp');
select is(pg_temp.events('00000000-0000-0000-0000-000000050031', 'reward_granted'), 0, 'M1: no grant below K');

select pg_temp.age('00000000-0000-0000-0000-000000050031');
select pg_temp.prev_expiry('00000000-0000-0000-0000-000000050031', pg_temp.today());
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000050020","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000050011","app_role":"receptionist"}', true);
insert into m1 select 3, r.payment_id, r.subscription_id, r.new_expiry_date
from confirm_renewal('00000000-0000-0000-0000-000000050031', 'cash', 'renewal 3') r;
reset role;

select is(pg_temp.stamps('00000000-0000-0000-0000-000000050031'), 0, 'M1: counter returns to 0 at K');
select is(pg_temp.events('00000000-0000-0000-0000-000000050031', 'stamp_earned'), 3, 'M1: three stamps in the ledger');
select is(pg_temp.events('00000000-0000-0000-0000-000000050031', 'reward_granted'), 1, 'M1: one grant');
select is(
  (select expiry_date from subscriptions where id = (select subscription_id from m1 where step = 3)),
  (select start_date + 30 + 7 from subscriptions where id = (select subscription_id from m1 where step = 3)),
  'M1: renewed subscription expiry is R days past what its plan produced');
select is(
  (select new_expiry from m1 where step = 3),
  (select expiry_date from subscriptions where id = (select subscription_id from m1 where step = 3)),
  'M1: confirm_renewal returns the extended date');
select is(
  (select count(*)::int from payments where member_id = '00000000-0000-0000-0000-000000050031'),
  3, 'M1: the grant created no payment row');
select is(
  (select amount from payments where id = (select payment_id from m1 where step = 3)),
  15000, 'M1: the renewal payment amount is the plan price, untouched');
select is(
  (select plan_id from subscriptions where id = (select subscription_id from m1 where step = 3)),
  '00000000-0000-0000-0000-000000050061'::uuid, 'M1: plan unchanged');
select is(
  (select metadata ->> 'new_expiry_date' from audit_log where action_type = 'loyalty_reward_granted'
     and target_entity_id = '00000000-0000-0000-0000-000000050031'),
  (select expiry_date::text from subscriptions where id = (select subscription_id from m1 where step = 3)),
  'M1: grant audit records the new expiry date');
select is(
  (select (metadata ->> 'old_expiry_date')::date from audit_log where action_type = 'loyalty_reward_granted'
     and target_entity_id = '00000000-0000-0000-0000-000000050031'),
  (select start_date + 30 from subscriptions where id = (select subscription_id from m1 where step = 3)),
  'M1: grant audit records the old expiry date');
select is(pg_temp.replay('00000000-0000-0000-0000-000000050031'), pg_temp.stamps('00000000-0000-0000-0000-000000050031'),
  'M1: ledger replay equals progress');

-- Replay of the rewarding payment: nothing changes.
select private.award_renewal_stamp((select payment_id from m1 where step = 3));
select is(pg_temp.events('00000000-0000-0000-0000-000000050031', 'stamp_earned'), 3, 'M1 replay: still three stamps');
select is(pg_temp.events('00000000-0000-0000-0000-000000050031', 'reward_granted'), 1, 'M1 replay: still one grant');
select is(
  (select expiry_date from subscriptions where id = (select subscription_id from m1 where step = 3)),
  (select start_date + 30 + 7 from subscriptions where id = (select subscription_id from m1 where step = 3)),
  'M1 replay: expiry extended once');
select is(
  (select count(*)::int from audit_log where target_entity_id = '00000000-0000-0000-0000-000000050031'
     and action_type like 'loyalty_%'),
  4, 'M1 replay: three stamp audits plus one grant audit, no more');

-- Early renewal right after the grant: the previous period (extended) still runs.
select pg_temp.age('00000000-0000-0000-0000-000000050031');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000050020","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000050011","app_role":"receptionist"}', true);
select confirm_renewal('00000000-0000-0000-0000-000000050031', 'cash', 'renewal early');
reset role;
select is(pg_temp.stamps('00000000-0000-0000-0000-000000050031'), 0, 'M1: a renewal right after the grant is early and earns nothing');
select is(pg_temp.events('00000000-0000-0000-0000-000000050031', 'stamp_earned'), 3, 'M1: early renewal wrote no event');

-- ============================================================================
-- M2: late (expiry + 2 days). Nothing written, no progress row created.
-- ============================================================================
select pg_temp.prev_expiry('00000000-0000-0000-0000-000000050032', pg_temp.today() - 2);
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000050020","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000050011","app_role":"receptionist"}', true);
select confirm_renewal('00000000-0000-0000-0000-000000050032', 'cash', 'late');
reset role;
select is(pg_temp.stamps('00000000-0000-0000-0000-000000050032'), -1, 'M2: late renewal creates no progress row');
select is((select count(*)::int from loyalty_events where member_id = '00000000-0000-0000-0000-000000050032'), 0, 'M2: late renewal writes no event');

-- M2b: a late renewal keeps existing progress.
insert into loyalty_progress (gym_id, member_id, subscriber_stamps, subscriber_last_event_at) values
  ('00000000-0000-0000-0000-000000050011', '00000000-0000-0000-0000-000000050041', 2, now() - interval '5 days');
select pg_temp.prev_expiry('00000000-0000-0000-0000-000000050041', pg_temp.today() - 5);
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000050020","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000050011","app_role":"receptionist"}', true);
select confirm_renewal('00000000-0000-0000-0000-000000050041', 'cash', 'late with progress');
reset role;
select is(pg_temp.stamps('00000000-0000-0000-0000-000000050041'), 2, 'M2b: late renewal keeps the counter');
select is((select count(*)::int from loyalty_events where member_id = '00000000-0000-0000-0000-000000050041'), 0, 'M2b: late renewal writes no event');

-- ============================================================================
-- M3: early (expiry tomorrow) earns nothing; a second renewal right after an
-- on-time first one is early too.
-- ============================================================================
select pg_temp.prev_expiry('00000000-0000-0000-0000-000000050033', pg_temp.today() + 1);
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000050020","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000050011","app_role":"receptionist"}', true);
select confirm_renewal('00000000-0000-0000-0000-000000050033', 'cash', 'early');
reset role;
select is(pg_temp.stamps('00000000-0000-0000-0000-000000050033'), -1, 'M3: early renewal earns nothing');

select pg_temp.age('00000000-0000-0000-0000-000000050033');
select pg_temp.prev_expiry('00000000-0000-0000-0000-000000050033', pg_temp.today());
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000050020","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000050011","app_role":"receptionist"}', true);
select confirm_renewal('00000000-0000-0000-0000-000000050033', 'cash', 'on time');
select pg_temp.age('00000000-0000-0000-0000-000000050033');
select confirm_renewal('00000000-0000-0000-0000-000000050033', 'cash', 'right after');
reset role;
select is(pg_temp.stamps('00000000-0000-0000-0000-000000050033'), 1, 'M3: second renewal right after an on-time one earns nothing more');

-- ============================================================================
-- M4: on time against the current expiry_date, the only deadline stored (a
-- reward extends that column; M4b drives a real extension).
-- ============================================================================
select pg_temp.prev_expiry('00000000-0000-0000-0000-000000050034', pg_temp.today());
insert into loyalty_progress (gym_id, member_id, subscriber_stamps, subscriber_last_event_at) values
  ('00000000-0000-0000-0000-000000050011', '00000000-0000-0000-0000-000000050034', 1, now() - interval '20 days');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000050020","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000050011","app_role":"receptionist"}', true);
select confirm_renewal('00000000-0000-0000-0000-000000050034', 'cash', 'extended');
reset role;
select is(pg_temp.stamps('00000000-0000-0000-0000-000000050034'), 2, 'M4: judged against the current (extended) expiry, stamp earned');

-- M4b: a real extension. A renewal reaches K and the grant moves the renewed
-- subscription's expiry R days out; the member then renews on that extended
-- date, which is 7 days past the original deadline (late against the original,
-- on time against the extended one).
insert into auth.users (id) values ('00000000-0000-0000-0000-00000005005a');
insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000050059', '00000000-0000-0000-0000-000000050011',
   '00000000-0000-0000-0000-00000005005a', 'member', 'SR extended', current_date);
select pg_temp.sub('00000000-0000-0000-0000-000000050059', '00000000-0000-0000-0000-000000050061', pg_temp.today());
insert into loyalty_progress (gym_id, member_id, subscriber_stamps, subscriber_last_event_at) values
  ('00000000-0000-0000-0000-000000050011', '00000000-0000-0000-0000-000000050059', 2, now() - interval '20 days');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000050020","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000050011","app_role":"receptionist"}', true);
select confirm_renewal('00000000-0000-0000-0000-000000050059', 'cash', 'reaches K');
reset role;
select is(
  (select (a.metadata ->> 'new_expiry_date')::date - (a.metadata ->> 'old_expiry_date')::date
   from audit_log a
   where a.target_entity_id = '00000000-0000-0000-0000-000000050059' and a.action_type = 'loyalty_reward_granted'),
  7, 'M4b: the grant moved the expiry R days past the original deadline');
-- The extension is persisted: the stored expiry is the audited extended date,
-- which is what the next renewal is judged against.
select is(
  (select s.expiry_date from subscriptions s
   where s.member_id = '00000000-0000-0000-0000-000000050059'
   order by s.created_at desc, s.id desc limit 1),
  (select (a.metadata ->> 'new_expiry_date')::date
   from audit_log a
   where a.target_entity_id = '00000000-0000-0000-0000-000000050059' and a.action_type = 'loyalty_reward_granted'),
  'M4b: the stored expiry is the extended date');
-- The clock reaches the extended expiry: shift the stored (extended) expiry to
-- today; the original deadline is then 7 days in the past, so only the
-- extension makes this renewal on time.
select pg_temp.age('00000000-0000-0000-0000-000000050059');
select pg_temp.prev_expiry('00000000-0000-0000-0000-000000050059', pg_temp.today());
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000050020","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000050011","app_role":"receptionist"}', true);
select confirm_renewal('00000000-0000-0000-0000-000000050059', 'cash', 'on the extended expiry');
reset role;
select is(pg_temp.stamps('00000000-0000-0000-0000-000000050059'), 1, 'M4b: renewing on the extended expiry earns a stamp (counter restarted at 1)');
select is(pg_temp.events('00000000-0000-0000-0000-000000050059', 'stamp_earned'), 2, 'M4b: one stamp for the grant renewal, one for the extended-expiry renewal');

-- ============================================================================
-- M5: back-dated staff renewal never earns, though its dates would be on time.
-- ============================================================================
-- Douala date, like the hook: on time at every wall-clock instant.
update subscriptions set status = 'expired', expiry_date = pg_temp.today() - 1
where member_id = '00000000-0000-0000-0000-000000050035';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000050020","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000050011","app_role":"receptionist"}', true);
select lives_ok($$ select confirm_renewal('00000000-0000-0000-0000-000000050035', 'cash', 'backdated', true) $$, 'M5: back-dated renewal succeeds');
reset role;
select is(pg_temp.stamps('00000000-0000-0000-0000-000000050035'), -1, 'M5: back-dated renewal earns nothing');
select is((select count(*)::int from loyalty_events where member_id = '00000000-0000-0000-0000-000000050035'), 0, 'M5: no event');

-- ============================================================================
-- M6: renew_subscription (payment-less override) never earns.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000050020","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000050011","app_role":"receptionist"}', true);
select lives_ok($$ select renew_subscription('00000000-0000-0000-0000-000000050036', 'override') $$, 'M6: override renewal succeeds');
reset role;
select is(pg_temp.stamps('00000000-0000-0000-0000-000000050036'), -1, 'M6: payment-less override earns nothing');

-- ============================================================================
-- M7: pay-per-session never earns.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000050020","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000050011","app_role":"receptionist"}', true);
select confirm_renewal('00000000-0000-0000-0000-000000050037', 'cash', 'pps');
reset role;
select is(pg_temp.stamps('00000000-0000-0000-0000-000000050037'), -1, 'M7: pay-per-session renewal earns nothing');

-- ============================================================================
-- M8: program off in the gym: no event, no progress row.
-- ============================================================================
update gyms set loyalty_enabled = false where id = '00000000-0000-0000-0000-000000050012';
-- Staff for gym B.
insert into auth.users (id) values ('00000000-0000-0000-0000-000000050055'), ('00000000-0000-0000-0000-000000050056');
insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000050045', '00000000-0000-0000-0000-000000050012', '00000000-0000-0000-0000-000000050055', 'receptionist', 'SR Rec B', current_date);
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000050055","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000050012","app_role":"receptionist"}', true);
select confirm_renewal('00000000-0000-0000-0000-000000050038', 'cash', 'program off');
reset role;
select is(pg_temp.stamps('00000000-0000-0000-0000-000000050038'), -1, 'M8: program off creates no progress row');
select is((select count(*)::int from loyalty_events where member_id = '00000000-0000-0000-0000-000000050038'), 0, 'M8: program off writes no event');

-- ============================================================================
-- M9: replay below K through the hook directly: one stamp.
-- ============================================================================
create temp table m9 (payment_id uuid);
grant all on m9 to public;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000050020","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000050011","app_role":"receptionist"}', true);
insert into m9 select r.payment_id from confirm_renewal('00000000-0000-0000-0000-000000050039', 'cash', 'replay') r;
reset role;
select private.award_renewal_stamp((select payment_id from m9));
select private.award_renewal_stamp((select payment_id from m9));
select is(pg_temp.stamps('00000000-0000-0000-0000-000000050039'), 1, 'M9: replayed hook leaves the counter at 1');
select is(pg_temp.events('00000000-0000-0000-0000-000000050039', 'stamp_earned'), 1, 'M9: one stamp event');
select is(
  (select count(*)::int from audit_log where action_type = 'loyalty_stamp_earned'
     and target_entity_id = '00000000-0000-0000-0000-000000050039'),
  1, 'M9: one audit row');

-- ============================================================================
-- M10: idle past the window (200 days, window = greatest(90, 30 + 3) = 90):
-- a reset event, then the stamp.
-- ============================================================================
insert into loyalty_progress (gym_id, member_id, subscriber_stamps, subscriber_last_event_at) values
  ('00000000-0000-0000-0000-000000050011', '00000000-0000-0000-0000-00000005003a', 2, now() - interval '200 days');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000050020","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000050011","app_role":"receptionist"}', true);
select confirm_renewal('00000000-0000-0000-0000-00000005003a', 'cash', 'idle');
reset role;
select is(pg_temp.stamps('00000000-0000-0000-0000-00000005003a'), 1, 'M10: idle reset then stamp leaves 1');
select is(pg_temp.events('00000000-0000-0000-0000-00000005003a', 'reset'), 1, 'M10: one reset event');
select is(
  (select (details ->> 'previous_count')::int from loyalty_events
   where member_id = '00000000-0000-0000-0000-00000005003a' and event_type = 'reset'),
  2, 'M10: reset event keeps the previous count');
select is(
  (select count(*)::int from audit_log where action_type = 'loyalty_progress_reset'
     and target_entity_id = '00000000-0000-0000-0000-00000005003a' and metadata ->> 'counter' = 'subscriber'),
  1, 'M10: reset audited with counter subscriber');

-- M17: inside the window (80 days): no reset, stamps 2 -> 3 = K -> grant.
insert into loyalty_progress (gym_id, member_id, subscriber_stamps, subscriber_last_event_at) values
  ('00000000-0000-0000-0000-000000050011', '00000000-0000-0000-0000-000000050041', 2, now() - interval '80 days')
on conflict (gym_id, member_id) do update set subscriber_last_event_at = excluded.subscriber_last_event_at;
select pg_temp.prev_expiry('00000000-0000-0000-0000-000000050041', pg_temp.today());
select pg_temp.age('00000000-0000-0000-0000-000000050041');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000050020","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000050011","app_role":"receptionist"}', true);
select confirm_renewal('00000000-0000-0000-0000-000000050041', 'cash', 'inside window');
reset role;
select is(pg_temp.events('00000000-0000-0000-0000-000000050041', 'reset'), 0, 'M17: 80 idle days is inside the window, no reset');
select is(pg_temp.events('00000000-0000-0000-0000-000000050041', 'reward_granted'), 1, 'M17: stamp 3 reaches K');

-- ============================================================================
-- M11: stamps above a lowered K: one stamp, one grant, counter 0.
-- ============================================================================
insert into loyalty_progress (gym_id, member_id, subscriber_stamps, subscriber_last_event_at) values
  ('00000000-0000-0000-0000-000000050011', '00000000-0000-0000-0000-00000005003b', 5, now() - interval '10 days');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000050020","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000050011","app_role":"receptionist"}', true);
select confirm_renewal('00000000-0000-0000-0000-00000005003b', 'cash', 'lowered K');
reset role;
select is(pg_temp.stamps('00000000-0000-0000-0000-00000005003b'), 0, 'M11: above lowered K the counter ends at 0');
select is(pg_temp.events('00000000-0000-0000-0000-00000005003b', 'reward_granted'), 1, 'M11: exactly one grant');
select is(pg_temp.events('00000000-0000-0000-0000-00000005003b', 'stamp_earned'), 1, 'M11: exactly one stamp');
select is(
  (select (details ->> 'stamps')::int from loyalty_events
   where member_id = '00000000-0000-0000-0000-00000005003b' and event_type = 'reward_granted'),
  6, 'M11: the grant records the stamps held (6)');

-- ============================================================================
-- M12: webhook path. Two stamps preset, the third payment confirmed by
-- complete_verified_payment grants R days and adds no payment.
-- ============================================================================
insert into loyalty_progress (gym_id, member_id, subscriber_stamps, subscriber_last_event_at) values
  ('00000000-0000-0000-0000-000000050011', '00000000-0000-0000-0000-00000005003c', 2, now() - interval '25 days');
insert into payments (id, gym_id, member_id, amount, currency, method, status, provider, purpose) values
  ('00000000-0000-0000-0000-0000000500b1', '00000000-0000-0000-0000-000000050011', '00000000-0000-0000-0000-00000005003c',
   15000, 'XAF', 'mobile_money', 'processing', 'taramoney', 'subscription');
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select complete_verified_payment('00000000-0000-0000-0000-0000000500b1', 20);
reset role;

select is(pg_temp.stamps('00000000-0000-0000-0000-00000005003c'), 0, 'M12: webhook renewal at K resets the counter');
select is(pg_temp.events('00000000-0000-0000-0000-00000005003c', 'reward_granted'), 1, 'M12: one grant via the webhook');
select is(
  (select s.expiry_date from subscriptions s join payments p on p.subscription_id = s.id
   where p.id = '00000000-0000-0000-0000-0000000500b1'),
  (select s.start_date + 30 + 7 from subscriptions s join payments p on p.subscription_id = s.id
   where p.id = '00000000-0000-0000-0000-0000000500b1'),
  'M12: webhook-renewed subscription is R days past its plan expiry');
select is(
  (select count(*)::int from payments where member_id = '00000000-0000-0000-0000-00000005003c'),
  1, 'M12: no payment row added by the grant');
select is(
  (select actor_display_name from audit_log where action_type = 'loyalty_reward_granted'
     and target_entity_id = '00000000-0000-0000-0000-00000005003c'),
  'payment-webhook', 'M12: webhook path keeps its system actor label');

-- Redelivered webhook, then a hook replay: one stamp, one extension.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select complete_verified_payment('00000000-0000-0000-0000-0000000500b1', 20);
reset role;
select private.award_renewal_stamp('00000000-0000-0000-0000-0000000500b1');
select is(pg_temp.events('00000000-0000-0000-0000-00000005003c', 'stamp_earned'), 1, 'M12 replay: one stamp');
select is(pg_temp.events('00000000-0000-0000-0000-00000005003c', 'reward_granted'), 1, 'M12 replay: one grant');
select is(
  (select s.expiry_date from subscriptions s join payments p on p.subscription_id = s.id
   where p.id = '00000000-0000-0000-0000-0000000500b1'),
  (select s.start_date + 30 + 7 from subscriptions s join payments p on p.subscription_id = s.id
   where p.id = '00000000-0000-0000-0000-0000000500b1'),
  'M12 replay: one extension');
select is(pg_temp.replay('00000000-0000-0000-0000-00000005003c'), pg_temp.stamps('00000000-0000-0000-0000-00000005003c'),
  'M12: ledger replay equals progress');

-- ============================================================================
-- M13: webhook, late (expiry + 3 days): payment verified, nothing earned.
-- ============================================================================
select pg_temp.prev_expiry('00000000-0000-0000-0000-00000005003d', pg_temp.today() - 3);
insert into payments (id, gym_id, member_id, amount, currency, method, status, provider, purpose) values
  ('00000000-0000-0000-0000-0000000500b2', '00000000-0000-0000-0000-000000050011', '00000000-0000-0000-0000-00000005003d',
   15000, 'XAF', 'mobile_money', 'processing', 'taramoney', 'subscription');
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select complete_verified_payment('00000000-0000-0000-0000-0000000500b2', 20);
reset role;
select is((select status::text from payments where id = '00000000-0000-0000-0000-0000000500b2'), 'verified', 'M13: late webhook payment is verified');
select is(pg_temp.stamps('00000000-0000-0000-0000-00000005003d'), -1, 'M13: late webhook renewal earns nothing');

-- M19: webhook the day after expiry earns.
select pg_temp.prev_expiry('00000000-0000-0000-0000-000000050043', pg_temp.today() - 1);
insert into payments (id, gym_id, member_id, amount, currency, method, status, provider, purpose) values
  ('00000000-0000-0000-0000-0000000500b3', '00000000-0000-0000-0000-000000050011', '00000000-0000-0000-0000-000000050043',
   15000, 'XAF', 'mobile_money', 'processing', 'taramoney', 'subscription');
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select complete_verified_payment('00000000-0000-0000-0000-0000000500b3', 20);
reset role;
select is(pg_temp.stamps('00000000-0000-0000-0000-000000050043'), 1, 'M19: webhook renewal the day after expiry earns');

-- ============================================================================
-- M14: other purposes, unverified and voided payments, and the 0031 queue
-- (pending -> verified UPDATE) never earn.
-- ============================================================================
-- Renewal-shaped fixture: a newer same-plan subscription of a member whose
-- previous period expires today, linked to every payment below. Were a guard
-- missing, the hook would find a renewal that is on time and stamp.
insert into subscriptions (id, gym_id, member_id, plan_id, status, start_date, expiry_date, created_at) values
  ('00000000-0000-0000-0000-0000000500d7', '00000000-0000-0000-0000-000000050011', '00000000-0000-0000-0000-00000005003e',
   '00000000-0000-0000-0000-000000050061', 'active', current_date, current_date + 30, now());
insert into payments (id, gym_id, member_id, subscription_id, amount, currency, method, status, purpose) values
  ('00000000-0000-0000-0000-0000000500c1', '00000000-0000-0000-0000-000000050011', '00000000-0000-0000-0000-00000005003e',
   '00000000-0000-0000-0000-0000000500d7', 2000, 'XAF', 'cash', 'verified', 'session'),
  ('00000000-0000-0000-0000-0000000500c2', '00000000-0000-0000-0000-000000050011', '00000000-0000-0000-0000-00000005003e',
   '00000000-0000-0000-0000-0000000500d7', 2000, 'XAF', 'cash', 'verified', 'registration_fee');
insert into payments (id, gym_id, member_id, subscription_id, amount, currency, method, status, purpose) values
  ('00000000-0000-0000-0000-0000000500c3', '00000000-0000-0000-0000-000000050011', '00000000-0000-0000-0000-00000005003e',
   '00000000-0000-0000-0000-0000000500d7', 15000, 'XAF', 'cash', 'pending', 'subscription');
select private.award_renewal_stamp('00000000-0000-0000-0000-0000000500c1');
select private.award_renewal_stamp('00000000-0000-0000-0000-0000000500c2');
select private.award_renewal_stamp('00000000-0000-0000-0000-0000000500c3');
select private.award_renewal_stamp(gen_random_uuid());
select is(pg_temp.stamps('00000000-0000-0000-0000-00000005003e'), -1, 'M14: session, fee, unverified and unknown payments earn nothing');
-- The staff queue verifies the payment of an existing subscription: no renewal happens.
update payments set status = 'verified' where id = '00000000-0000-0000-0000-0000000500c3';
select is(pg_temp.stamps('00000000-0000-0000-0000-00000005003e'), -1, 'M14: the queue UPDATE pending -> verified writes no stamp');
-- Voided verified subscription payment.
update payments set voided_at = now() where id = '00000000-0000-0000-0000-0000000500c3';
select private.award_renewal_stamp('00000000-0000-0000-0000-0000000500c3');
select is(pg_temp.stamps('00000000-0000-0000-0000-00000005003e'), -1, 'M14: a voided payment earns nothing');
-- Control: the same fixture with a verified, unvoided subscription payment does earn.
insert into payments (id, gym_id, member_id, subscription_id, amount, currency, method, status, purpose) values
  ('00000000-0000-0000-0000-0000000500c4', '00000000-0000-0000-0000-000000050011', '00000000-0000-0000-0000-00000005003e',
   '00000000-0000-0000-0000-0000000500d7', 15000, 'XAF', 'cash', 'verified', 'subscription');
select private.award_renewal_stamp('00000000-0000-0000-0000-0000000500c4');
select is(pg_temp.stamps('00000000-0000-0000-0000-00000005003e'), 1, 'M14 control: the fixture is renewal-shaped, a verified subscription payment earns');

-- ============================================================================
-- M15: renewed plan differs from the previous plan: nothing.
-- ============================================================================
insert into subscriptions (id, gym_id, member_id, plan_id, status, start_date, expiry_date, created_at) values
  ('00000000-0000-0000-0000-0000000500d1', '00000000-0000-0000-0000-000000050011', '00000000-0000-0000-0000-00000005003f',
   '00000000-0000-0000-0000-000000050061', 'active', current_date, current_date + 30, now());
insert into payments (id, gym_id, member_id, subscription_id, amount, currency, method, status, purpose) values
  ('00000000-0000-0000-0000-0000000500d2', '00000000-0000-0000-0000-000000050011', '00000000-0000-0000-0000-00000005003f',
   '00000000-0000-0000-0000-0000000500d1', 15000, 'XAF', 'cash', 'verified', 'subscription');
select private.award_renewal_stamp('00000000-0000-0000-0000-0000000500d2');
select is(pg_temp.stamps('00000000-0000-0000-0000-00000005003f'), -1, 'M15: a plan change is not a renewal');

-- M18: previous subscription is pay_per_session (no expiry_date) and the
-- renewed one is another plan: nothing either. Covers the plan-mismatch return;
-- the null-expiry guard is unreachable for a same-plan renewal (0018).
insert into subscriptions (id, gym_id, member_id, plan_id, status, start_date, expiry_date, created_at) values
  ('00000000-0000-0000-0000-0000000500d3', '00000000-0000-0000-0000-000000050011', '00000000-0000-0000-0000-000000050042',
   '00000000-0000-0000-0000-000000050061', 'active', current_date, current_date + 30, now());
insert into payments (id, gym_id, member_id, subscription_id, amount, currency, method, status, purpose) values
  ('00000000-0000-0000-0000-0000000500d4', '00000000-0000-0000-0000-000000050011', '00000000-0000-0000-0000-000000050042',
   '00000000-0000-0000-0000-0000000500d3', 15000, 'XAF', 'cash', 'verified', 'subscription');
select private.award_renewal_stamp('00000000-0000-0000-0000-0000000500d4');
select is(pg_temp.stamps('00000000-0000-0000-0000-000000050042'), -1, 'M18: a pay-per-session previous subscription (other plan) earns nothing');

-- M20: first-ever subscription (no previous period).
insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000050046', '00000000-0000-0000-0000-000000050011', '00000000-0000-0000-0000-000000050056', 'member', 'SR first', current_date);
insert into subscriptions (id, gym_id, member_id, plan_id, status, start_date, expiry_date) values
  ('00000000-0000-0000-0000-0000000500d5', '00000000-0000-0000-0000-000000050011', '00000000-0000-0000-0000-000000050046',
   '00000000-0000-0000-0000-000000050061', 'active', current_date, current_date + 30);
insert into payments (id, gym_id, member_id, subscription_id, amount, currency, method, status, purpose) values
  ('00000000-0000-0000-0000-0000000500d6', '00000000-0000-0000-0000-000000050011', '00000000-0000-0000-0000-000000050046',
   '00000000-0000-0000-0000-0000000500d5', 15000, 'XAF', 'cash', 'verified', 'subscription');
select private.award_renewal_stamp('00000000-0000-0000-0000-0000000500d6');
select is(pg_temp.stamps('00000000-0000-0000-0000-000000050046'), -1, 'M20: a first subscription is not a renewal');

-- ============================================================================
-- M16: refunding the rewarding renewal reverses nothing.
-- ============================================================================
insert into refunds (gym_id, payment_id, amount, reason, actor_id)
select '00000000-0000-0000-0000-000000050011', payment_id, 15000, 'test', '00000000-0000-0000-0000-000000050020'
from m1 where step = 3;
select is(pg_temp.events('00000000-0000-0000-0000-000000050031', 'reward_granted'), 1, 'M16: refund leaves the grant');
select is(
  (select expiry_date from subscriptions where id = (select subscription_id from m1 where step = 3)),
  (select start_date + 30 + 7 from subscriptions where id = (select subscription_id from m1 where step = 3)),
  'M16: refund leaves the free days');
select is(pg_temp.events('00000000-0000-0000-0000-000000050031', 'stamp_earned'), 3, 'M16: refund leaves the stamps');

-- ============================================================================
-- Ledger consistency: every subscriber event belongs to the member's own gym.
-- ============================================================================
select is(
  (select count(*)::int from loyalty_events e join members m on m.id = e.member_id
   where e.counter = 'subscriber' and e.gym_id <> m.gym_id),
  0, 'every subscriber event carries the member''s gym');
select is(
  (select count(*)::int from loyalty_progress lp
   where lp.gym_id = '00000000-0000-0000-0000-000000050012'),
  0, 'the program-off gym has no progress rows');
select is(
  (select count(*)::int from loyalty_events e
   where e.counter = 'subscriber' and e.event_type = 'reward_granted' and e.origin_id is null),
  0, 'every grant has an origin');

-- ============================================================================
-- Idle window with a long plan: window = greatest(90, duration + grace), so a
-- 365-day plan keeps stamps for 368 days. 120 idle days: no reset; 400: reset.
-- ============================================================================
insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000050065', '00000000-0000-0000-0000-000000050011', 'SR Annual A', 'monthly', 150000, 'XAF', 'monthly', 365);
insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000050057'), ('00000000-0000-0000-0000-000000050058');
insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000050047', '00000000-0000-0000-0000-000000050011', '00000000-0000-0000-0000-000000050057', 'member', 'SR long 120', current_date),
  ('00000000-0000-0000-0000-000000050048', '00000000-0000-0000-0000-000000050011', '00000000-0000-0000-0000-000000050058', 'member', 'SR long 400', current_date);
select pg_temp.sub('00000000-0000-0000-0000-000000050047', '00000000-0000-0000-0000-000000050065', pg_temp.today());
select pg_temp.sub('00000000-0000-0000-0000-000000050048', '00000000-0000-0000-0000-000000050065', pg_temp.today());
insert into loyalty_progress (gym_id, member_id, subscriber_stamps, subscriber_last_event_at) values
  ('00000000-0000-0000-0000-000000050011', '00000000-0000-0000-0000-000000050047', 1, now() - interval '120 days'),
  ('00000000-0000-0000-0000-000000050011', '00000000-0000-0000-0000-000000050048', 1, now() - interval '400 days');

create function pg_temp.renew_direct(p_member uuid, p_plan uuid) returns uuid language plpgsql security definer as $f$
declare
  v_sub uuid;
  v_pay uuid;
begin
  insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date, created_at)
  select m.gym_id, m.id, p_plan, 'active', current_date, current_date + 30,
         (select max(o.created_at) from subscriptions o where o.member_id = p_member) + interval '1 minute'
  from members m where m.id = p_member returning id into v_sub;
  insert into payments (gym_id, member_id, subscription_id, amount, currency, method, status, purpose)
  select m.gym_id, m.id, v_sub, 1000, 'XAF', 'cash', 'verified', 'subscription'
  from members m where m.id = p_member returning id into v_pay;
  perform private.award_renewal_stamp(v_pay);
  return v_pay;
end;
$f$;

select pg_temp.renew_direct('00000000-0000-0000-0000-000000050047', '00000000-0000-0000-0000-000000050065');
select pg_temp.renew_direct('00000000-0000-0000-0000-000000050048', '00000000-0000-0000-0000-000000050065');
select is(pg_temp.events('00000000-0000-0000-0000-000000050047', 'reset'), 0, 'long plan: 120 idle days is inside duration + grace, no reset');
select is(pg_temp.stamps('00000000-0000-0000-0000-000000050047'), 2, 'long plan: the stamp is added to the kept counter');
select is(pg_temp.events('00000000-0000-0000-0000-000000050048', 'reset'), 1, 'long plan: 400 idle days is past the window, reset');
select is(pg_temp.stamps('00000000-0000-0000-0000-000000050048'), 1, 'long plan: reset then stamp leaves 1');

-- ============================================================================
-- Gym timezone: the on-time window is judged on the gym-local date. Kiritimati
-- (UTC+14) and Pago Pago (UTC-11) cannot both share the Douala date, so a
-- judge using the wrong zone fails at least one case at any instant of the day.
-- ============================================================================
insert into gyms (id, name, tier_id, status, charge_guests_per_session, registration_fee, timezone,
                  loyalty_enabled, loyalty_guest_threshold, loyalty_renewal_threshold, loyalty_reward_days) values
  ('00000000-0000-0000-0000-000000050013', 'SR Gym Kiritimati', '00000000-0000-0000-0000-000000050001', 'active', true, 0, 'Pacific/Kiritimati', true, 3, 3, 7),
  ('00000000-0000-0000-0000-000000050014', 'SR Gym Pago',       '00000000-0000-0000-0000-000000050001', 'active', true, 0, 'Pacific/Pago_Pago',   true, 3, 3, 7);
insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000050066', '00000000-0000-0000-0000-000000050013', 'SR Monthly K', 'monthly', 15000, 'XAF', 'monthly', 30),
  ('00000000-0000-0000-0000-000000050067', '00000000-0000-0000-0000-000000050014', 'SR Monthly P', 'monthly', 15000, 'XAF', 'monthly', 30);
insert into auth.users (id)
select ('00000000-0000-0000-0000-0000000500' || lpad(to_hex(n), 2, '0'))::uuid from generate_series(112, 117) n; -- 0x70 .. 0x75
insert into members (id, gym_id, user_id, role, name, join_date)
select ('00000000-0000-0000-0000-0000000500' || lpad(to_hex(n - 32), 2, '0'))::uuid, -- 0x50 .. 0x55
       case when n < 115 then '00000000-0000-0000-0000-000000050013'::uuid else '00000000-0000-0000-0000-000000050014'::uuid end,
       ('00000000-0000-0000-0000-0000000500' || lpad(to_hex(n), 2, '0'))::uuid,
       'member', 'SR tz ' || n, current_date
from generate_series(112, 117) n;

-- Kiritimati: local today earns (0x50), local today - 2 is late (0x51), local + 1 is early (0x52).
-- Pago:       local today - 1 earns (0x53), local today - 2 is late (0x54), local + 1 is early (0x55).
create function pg_temp.tzsub(p_member uuid, p_plan uuid, p_tz text, p_offset int) returns void language sql security definer as $f$
  insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date, created_at)
  select m.gym_id, m.id, p_plan, 'active',
         (now() at time zone p_tz)::date + p_offset - 30, (now() at time zone p_tz)::date + p_offset, now() - interval '60 days'
  from members m where m.id = p_member
$f$;
select pg_temp.tzsub('00000000-0000-0000-0000-000000050050', '00000000-0000-0000-0000-000000050066', 'Pacific/Kiritimati', 0);
select pg_temp.tzsub('00000000-0000-0000-0000-000000050051', '00000000-0000-0000-0000-000000050066', 'Pacific/Kiritimati', -2);
select pg_temp.tzsub('00000000-0000-0000-0000-000000050052', '00000000-0000-0000-0000-000000050066', 'Pacific/Kiritimati', 1);
select pg_temp.tzsub('00000000-0000-0000-0000-000000050053', '00000000-0000-0000-0000-000000050067', 'Pacific/Pago_Pago', -1);
select pg_temp.tzsub('00000000-0000-0000-0000-000000050054', '00000000-0000-0000-0000-000000050067', 'Pacific/Pago_Pago', -2);
select pg_temp.tzsub('00000000-0000-0000-0000-000000050055', '00000000-0000-0000-0000-000000050067', 'Pacific/Pago_Pago', 1);

select pg_temp.renew_direct('00000000-0000-0000-0000-000000050050', '00000000-0000-0000-0000-000000050066');
select pg_temp.renew_direct('00000000-0000-0000-0000-000000050051', '00000000-0000-0000-0000-000000050066');
select pg_temp.renew_direct('00000000-0000-0000-0000-000000050052', '00000000-0000-0000-0000-000000050066');
select pg_temp.renew_direct('00000000-0000-0000-0000-000000050053', '00000000-0000-0000-0000-000000050067');
select pg_temp.renew_direct('00000000-0000-0000-0000-000000050054', '00000000-0000-0000-0000-000000050067');
select pg_temp.renew_direct('00000000-0000-0000-0000-000000050055', '00000000-0000-0000-0000-000000050067');
select is(pg_temp.stamps('00000000-0000-0000-0000-000000050050'), 1, 'tz Kiritimati: expiry on the gym-local day earns');
select is(pg_temp.stamps('00000000-0000-0000-0000-000000050051'), -1, 'tz Kiritimati: gym-local expiry + 2 is late');
select is(pg_temp.stamps('00000000-0000-0000-0000-000000050052'), -1, 'tz Kiritimati: gym-local early renewal earns nothing');
select is(pg_temp.stamps('00000000-0000-0000-0000-000000050053'), 1, 'tz Pago Pago: gym-local day after expiry earns');
select is(pg_temp.stamps('00000000-0000-0000-0000-000000050054'), -1, 'tz Pago Pago: gym-local expiry + 2 is late');
select is(pg_temp.stamps('00000000-0000-0000-0000-000000050055'), -1, 'tz Pago Pago: gym-local early renewal earns nothing');

select * from finish();
rollback;
