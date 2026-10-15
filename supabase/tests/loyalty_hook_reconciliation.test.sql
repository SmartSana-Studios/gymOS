-- Story 20.8 (0122): the daily reconciliation that repairs swallowed loyalty hook
-- failures from source facts. A missed hook is simulated by doing the source write
-- (consumption, verified renewal, refund) without calling the hook.
--
-- One transaction, so now() is constant; fixtures are dated relative to it.
-- Fixture ids: 00000000-0000-0000-0000-0000000820xx.

begin;
select plan(25);

insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000082001', 'HR Tier', 6000, 60000, null);

insert into gyms (id, name, tier_id, status, charge_guests_per_session, registration_fee,
                  loyalty_enabled, loyalty_guest_threshold, loyalty_renewal_threshold, loyalty_reward_days) values
  ('00000000-0000-0000-0000-000000082011', 'HR Gym A (on since 10 days)', '00000000-0000-0000-0000-000000082001', 'active', true, 0, true,  4, 3, 10),
  ('00000000-0000-0000-0000-000000082012', 'HR Gym B (on since 1 hour)',  '00000000-0000-0000-0000-000000082001', 'active', true, 0, true,  4, 3, 10),
  ('00000000-0000-0000-0000-000000082013', 'HR Gym C (off now)',          '00000000-0000-0000-0000-000000082001', 'active', true, 0, false, 4, 3, 10);

-- The latest loyalty_program_changed row at or before a time is the program state then.
insert into audit_log (gym_id, actor_display_name, action_type, target_entity_id, target_entity_type, metadata, created_at) values
  ('00000000-0000-0000-0000-000000082011', 'Owner', 'loyalty_program_changed', '00000000-0000-0000-0000-000000082011', 'gym',
   '{"old":{"enabled":false},"new":{"enabled":true}}', now() - interval '10 days'),
  ('00000000-0000-0000-0000-000000082012', 'Owner', 'loyalty_program_changed', '00000000-0000-0000-0000-000000082012', 'gym',
   '{"old":{"enabled":false},"new":{"enabled":true}}', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000082013', 'Owner', 'loyalty_program_changed', '00000000-0000-0000-0000-000000082013', 'gym',
   '{"old":{"enabled":false},"new":{"enabled":true}}', now() - interval '10 days');

insert into auth.users (id)
select ('00000000-0000-0000-0000-0000000820' || lpad(to_hex(g), 2, '0'))::uuid
from generate_series(x'21'::int, x'3a'::int) g;

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000082051', '00000000-0000-0000-0000-000000082011', '00000000-0000-0000-0000-000000082021', 'member', 'Missed earn'),
  ('00000000-0000-0000-0000-000000082052', '00000000-0000-0000-0000-000000082011', '00000000-0000-0000-0000-000000082022', 'member', 'Too old'),
  ('00000000-0000-0000-0000-000000082053', '00000000-0000-0000-0000-000000082011', '00000000-0000-0000-0000-000000082023', 'member', 'Free session'),
  ('00000000-0000-0000-0000-000000082054', '00000000-0000-0000-0000-000000082012', '00000000-0000-0000-0000-000000082024', 'member', 'Enabled later'),
  ('00000000-0000-0000-0000-000000082055', '00000000-0000-0000-0000-000000082013', '00000000-0000-0000-0000-000000082025', 'member', 'Program off'),
  ('00000000-0000-0000-0000-000000082056', '00000000-0000-0000-0000-000000082011', '00000000-0000-0000-0000-000000082026', 'member', 'Missed renewal'),
  ('00000000-0000-0000-0000-000000082057', '00000000-0000-0000-0000-000000082011', '00000000-0000-0000-0000-000000082027', 'member', 'Early renewal'),
  ('00000000-0000-0000-0000-000000082058', '00000000-0000-0000-0000-000000082011', '00000000-0000-0000-0000-000000082028', 'member', 'Missed reversal'),
  ('00000000-0000-0000-0000-000000082059', '00000000-0000-0000-0000-000000082011', '00000000-0000-0000-0000-000000082029', 'member', 'Failing item'),
  ('00000000-0000-0000-0000-00000008205a', '00000000-0000-0000-0000-000000082011', '00000000-0000-0000-0000-00000008202a', 'member', 'Good item after failure');

insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000082061', '00000000-0000-0000-0000-000000082011', 'HR Monthly', 'monthly', 15000, 'XAF', 'monthly', 30);

-- A paid session consumed at p_at WITHOUT the hook (the swallowed failure).
create function pg_temp.consumed_without_hook(p_gym uuid, p_member uuid, p_at timestamptz, p_paid boolean default true)
returns uuid language plpgsql security definer as $f$
declare v_payment uuid; v_session uuid;
begin
  if p_paid then
    insert into payments (gym_id, member_id, subscription_id, amount, currency, method, status, purpose)
    values (p_gym, p_member, null, 2000, 'XAF', 'cash', 'verified', 'session') returning id into v_payment;
  end if;
  if p_paid then
    insert into guest_sessions (gym_id, member_id, payment_id, usable_until, consumed_at, covered_day)
    values (p_gym, p_member, v_payment, p_at + interval '30 days', p_at, (p_at at time zone 'Africa/Douala')::date) returning id into v_session;
  else
    insert into loyalty_events (gym_id, member_id, event_type, counter, origin_id)
    values (p_gym, p_member, 'reward_granted', 'guest', gen_random_uuid()) returning id into v_payment;
    insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until, consumed_at, covered_day)
    values (p_gym, p_member, v_payment, p_at + interval '30 days', p_at, (p_at at time zone 'Africa/Douala')::date) returning id into v_session;
  end if;
  return v_session;
end;
$f$;

-- ---------------------------------------------------------------------------
-- Earn
-- ---------------------------------------------------------------------------
select pg_temp.consumed_without_hook('00000000-0000-0000-0000-000000082011', '00000000-0000-0000-0000-000000082051', now() - interval '1 hour');
select pg_temp.consumed_without_hook('00000000-0000-0000-0000-000000082011', '00000000-0000-0000-0000-000000082052', now() - interval '9 days');
select pg_temp.consumed_without_hook('00000000-0000-0000-0000-000000082011', '00000000-0000-0000-0000-000000082053', now() - interval '1 hour', false);
select pg_temp.consumed_without_hook('00000000-0000-0000-0000-000000082012', '00000000-0000-0000-0000-000000082054', now() - interval '2 hours');
select pg_temp.consumed_without_hook('00000000-0000-0000-0000-000000082013', '00000000-0000-0000-0000-000000082055', now() - interval '1 hour');

-- ---------------------------------------------------------------------------
-- Renewal: the previous period ended on the local date of the as-of time, so the
-- renewal was on time THEN; judged at now() (3 days later) it would be late.
-- ---------------------------------------------------------------------------
insert into subscriptions (id, gym_id, member_id, plan_id, status, start_date, expiry_date, created_at) values
  ('00000000-0000-0000-0000-000000082071', '00000000-0000-0000-0000-000000082011', '00000000-0000-0000-0000-000000082056', '00000000-0000-0000-0000-000000082061', 'expired',
   current_date - 40, ((now() - interval '3 days') at time zone (select timezone from gyms where id = '00000000-0000-0000-0000-000000082011'))::date, now() - interval '40 days'),
  ('00000000-0000-0000-0000-000000082072', '00000000-0000-0000-0000-000000082011', '00000000-0000-0000-0000-000000082056', '00000000-0000-0000-0000-000000082061', 'active',
   current_date - 3, current_date + 27, now() - interval '3 days'),
  ('00000000-0000-0000-0000-000000082073', '00000000-0000-0000-0000-000000082011', '00000000-0000-0000-0000-000000082057', '00000000-0000-0000-0000-000000082061', 'expired',
   current_date - 40, current_date + 10, now() - interval '40 days'),
  ('00000000-0000-0000-0000-000000082074', '00000000-0000-0000-0000-000000082011', '00000000-0000-0000-0000-000000082057', '00000000-0000-0000-0000-000000082061', 'active',
   current_date - 2, current_date + 40, now() - interval '2 days');
insert into payments (id, gym_id, member_id, subscription_id, amount, currency, method, status, purpose) values
  ('00000000-0000-0000-0000-000000082081', '00000000-0000-0000-0000-000000082011', '00000000-0000-0000-0000-000000082056', '00000000-0000-0000-0000-000000082072', 15000, 'XAF', 'cash', 'verified', 'subscription'),
  ('00000000-0000-0000-0000-000000082082', '00000000-0000-0000-0000-000000082011', '00000000-0000-0000-0000-000000082057', '00000000-0000-0000-0000-000000082074', 15000, 'XAF', 'cash', 'verified', 'subscription');

-- ---------------------------------------------------------------------------
-- Reversal: a stamp earned, the session refunded after use, the reversal missed.
-- ---------------------------------------------------------------------------
select pg_temp.consumed_without_hook('00000000-0000-0000-0000-000000082011', '00000000-0000-0000-0000-000000082058', now() - interval '2 days') as rev_session \gset
select private.on_session_consumed(:'rev_session'::uuid, '00000000-0000-0000-0000-000000082058', '00000000-0000-0000-0000-000000082011');
insert into refunds (gym_id, payment_id, amount, reason, actor_id)
select gs.gym_id, gs.payment_id, 2000, 'test', '00000000-0000-0000-0000-000000082021' from guest_sessions gs where gs.id = :'rev_session'::uuid;
-- The refund trigger reversed it; undo that to represent a swallowed failure.
delete from loyalty_events where origin_id = :'rev_session'::uuid and event_type = 'stamp_reversed';
update loyalty_progress set guest_stamps = 1 where member_id = '00000000-0000-0000-0000-000000082058';

select is((select guest_stamps from loyalty_progress where member_id = '00000000-0000-0000-0000-000000082058'), 1,
  'setup: the missed reversal leaves the stamp in place');

-- ---------------------------------------------------------------------------
-- Run 1
-- ---------------------------------------------------------------------------
select run_loyalty_hook_repair_job();

select is((select count(*)::int from loyalty_events where member_id = '00000000-0000-0000-0000-000000082051' and event_type = 'stamp_earned'), 1,
  'earn: the missed guest stamp is written');
select is((select guest_stamps from loyalty_progress where member_id = '00000000-0000-0000-0000-000000082051'), 1,
  'earn: the counter is 1');
select is((select count(*)::int from audit_log where action_type = 'loyalty_hook_repaired' and target_entity_id = '00000000-0000-0000-0000-000000082051'), 1,
  'earn: one loyalty_hook_repaired audit row');
select is((select metadata ->> 'kind' from audit_log where action_type = 'loyalty_hook_repaired' and target_entity_id = '00000000-0000-0000-0000-000000082051'), 'earn',
  'earn: the audit row names the kind');
select is((select count(*)::int from loyalty_events where member_id = '00000000-0000-0000-0000-000000082052'), 0,
  'earn: a session consumed 9 days ago is outside the 7-day window');
select is((select count(*)::int from loyalty_events where member_id = '00000000-0000-0000-0000-000000082053' and event_type = 'stamp_earned'), 0,
  'earn: a free session never earns');
select is((select count(*)::int from loyalty_events where member_id = '00000000-0000-0000-0000-000000082054' and event_type = 'stamp_earned'), 0,
  'earn: the program was switched on after the session, so it is not applied retroactively');
select is((select count(*)::int from loyalty_events where member_id = '00000000-0000-0000-0000-000000082055' and event_type = 'stamp_earned'), 0,
  'earn: a gym whose program is off now is not repaired');

select is((select count(*)::int from loyalty_events where member_id = '00000000-0000-0000-0000-000000082056' and event_type = 'stamp_earned' and counter = 'subscriber'), 1,
  'renewal: the missed stamp is written, judged at the renewal''s own time');
select is((select subscriber_stamps from loyalty_progress where member_id = '00000000-0000-0000-0000-000000082056'), 1,
  'renewal: the subscriber counter is 1');
select is((select occurred_at from loyalty_events where member_id = '00000000-0000-0000-0000-000000082056' and event_type = 'stamp_earned'),
  (select created_at from subscriptions where id = '00000000-0000-0000-0000-000000082072'),
  'renewal: the event is dated at the verification time, not at the repair run');
select is((select count(*)::int from loyalty_events where member_id = '00000000-0000-0000-0000-000000082057'), 0,
  'renewal: an early renewal is a candidate but the rule writes nothing');

select is((select count(*)::int from loyalty_events where member_id = '00000000-0000-0000-0000-000000082058' and event_type = 'stamp_reversed'), 1,
  'reversal: the missed reversal is written');
select is((select guest_stamps from loyalty_progress where member_id = '00000000-0000-0000-0000-000000082058'), 0,
  'reversal: the counter is back to 0');

select is((select count(*)::int from job_runs where job_name = 'loyalty_hook_repair' and status = 'success'), 1,
  'run 1 recorded a success in job_runs');

-- ---------------------------------------------------------------------------
-- Replay: a second run writes nothing (exactly-once).
-- ---------------------------------------------------------------------------
create temp table pg_temp_before as
  select (select count(*) from loyalty_events) as ev, (select count(*) from audit_log where action_type = 'loyalty_hook_repaired') as aud,
         (select sum(guest_stamps + subscriber_stamps) from loyalty_progress) as stamps;
select run_loyalty_hook_repair_job();
select is((select count(*) from loyalty_events), (select ev from pg_temp_before), 'replay: no new events');
select is((select count(*) from audit_log where action_type = 'loyalty_hook_repaired'), (select aud from pg_temp_before), 'replay: no new repair audit rows');
select is((select sum(guest_stamps + subscriber_stamps) from loyalty_progress), (select stamps from pg_temp_before), 'replay: counters unchanged');

-- ---------------------------------------------------------------------------
-- Failure isolation: one item raises, the next member is still repaired.
-- ---------------------------------------------------------------------------
select pg_temp.consumed_without_hook('00000000-0000-0000-0000-000000082011', '00000000-0000-0000-0000-000000082059', now() - interval '3 hours');
select pg_temp.consumed_without_hook('00000000-0000-0000-0000-000000082011', '00000000-0000-0000-0000-00000008205a', now() - interval '3 hours');

create function pg_temp.boom() returns trigger language plpgsql as $b$
begin
  raise exception 'forced hook failure';
end;
$b$;
create trigger boom before insert on loyalty_events
  for each row when (new.member_id = '00000000-0000-0000-0000-000000082059') execute function pg_temp.boom();

select run_loyalty_hook_repair_job();

select is((select count(*)::int from loyalty_events where member_id = '00000000-0000-0000-0000-00000008205a' and event_type = 'stamp_earned'), 1,
  'isolation: the next member is repaired although an earlier item failed');
select is((select count(*)::int from loyalty_events where member_id = '00000000-0000-0000-0000-000000082059'), 0,
  'isolation: the failing item wrote no ledger row');
select is((select count(*)::int from job_runs where job_name = 'loyalty_hook_repair' and status = 'failure'), 1,
  'isolation: the run is recorded as a failure');
select is((select count(*)::int from job_runs where job_name = 'loyalty_hook' and status = 'failure' and error like 'repair:earn%'), 1,
  'isolation: the failure feeds the loyalty_hook alert row');
select is((select count(*)::int from audit_log where action_type = 'loyalty_hook_failed' and target_entity_id = '00000000-0000-0000-0000-000000082059'), 1,
  'isolation: loyalty_hook_failed is audited for the failing item');

drop trigger boom on loyalty_events;
select run_loyalty_hook_repair_job();
select is((select count(*)::int from loyalty_events where member_id = '00000000-0000-0000-0000-000000082059' and event_type = 'stamp_earned'), 1,
  'retry: once the cause is gone the next run repairs the item');

select * from finish();
rollback;
