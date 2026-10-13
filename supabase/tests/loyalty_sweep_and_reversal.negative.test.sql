-- Story 20.4: refund reversal, lapses and sweep (migration 0120), denial paths.
-- No client role can run the sweep or a hook, write the ledger, or read another
-- gym's reversal / lapse / reset rows.
--
-- Fixture ids: 00000000-0000-0000-0000-0000000421xx.

begin;
select plan(16);

insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000042101', 'SWN Tier', 6000, 60000, null);

insert into gyms (id, name, tier_id, status, charge_guests_per_session, registration_fee,
                  loyalty_enabled, loyalty_guest_threshold, loyalty_renewal_threshold, loyalty_reward_days) values
  ('00000000-0000-0000-0000-000000042111', 'SWN Gym A', '00000000-0000-0000-0000-000000042101', 'active', true, 0, true, 3, 3, 1),
  ('00000000-0000-0000-0000-000000042112', 'SWN Gym B', '00000000-0000-0000-0000-000000042101', 'active', true, 0, true, 3, 3, 1);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000042121'), -- owner A
  ('00000000-0000-0000-0000-000000042122'), -- member A
  ('00000000-0000-0000-0000-000000042123'), -- owner B
  ('00000000-0000-0000-0000-000000042124'); -- member B

insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000042131', '00000000-0000-0000-0000-000000042111', '00000000-0000-0000-0000-000000042121', 'owner',  'SWN Owner A',  current_date),
  ('00000000-0000-0000-0000-000000042132', '00000000-0000-0000-0000-000000042111', '00000000-0000-0000-0000-000000042122', 'member', 'SWN Member A', current_date),
  ('00000000-0000-0000-0000-000000042133', '00000000-0000-0000-0000-000000042112', '00000000-0000-0000-0000-000000042123', 'owner',  'SWN Owner B',  current_date),
  ('00000000-0000-0000-0000-000000042134', '00000000-0000-0000-0000-000000042112', '00000000-0000-0000-0000-000000042124', 'member', 'SWN Member B', current_date);

-- Gym B member: an unused paid session past its validity and an idle counter.
insert into payments (id, gym_id, member_id, subscription_id, amount, currency, method, status, purpose) values
  ('00000000-0000-0000-0000-0000000421a1', '00000000-0000-0000-0000-000000042112', '00000000-0000-0000-0000-000000042134',
   null, 2000, 'XAF', 'cash', 'verified', 'session');
insert into guest_sessions (id, gym_id, member_id, payment_id, usable_until) values
  ('00000000-0000-0000-0000-0000000421b1', '00000000-0000-0000-0000-000000042112', '00000000-0000-0000-0000-000000042134',
   '00000000-0000-0000-0000-0000000421a1', now() - interval '1 day');
insert into loyalty_progress (gym_id, member_id, guest_stamps, guest_last_event_at) values
  ('00000000-0000-0000-0000-000000042112', '00000000-0000-0000-0000-000000042134', 2, now() - interval '100 days');

select set_config('request.jwt.claims', '{}', true);
select run_loyalty_sweep_job();

-- ============================================================================
-- Not client-callable.
-- ============================================================================
select is(
  (select bool_or(has_function_privilege(r, 'public.run_loyalty_sweep_job()', 'execute'))
   from unnest(array['anon', 'authenticated', 'service_role']) r),
  false, 'the sweep is not executable by any client role');
select is(
  (select bool_or(has_function_privilege(r, f, 'execute'))
   from unnest(array['anon', 'authenticated']) r,
        unnest(array[
          'private.on_session_consumed(uuid, uuid, uuid)',
          'private.on_session_consumed_impl(uuid, uuid, uuid)',
          'private.award_renewal_stamp(uuid)',
          'private.award_renewal_stamp_impl(uuid)',
          'private.on_session_refunded_after_consumption(uuid, uuid, uuid)',
          'private.on_session_refunded_after_consumption_impl(uuid, uuid, uuid)',
          'private.record_loyalty_hook_failure(text, uuid, uuid, text, uuid, text, text)'
        ]) f),
  false, 'no hook, impl or failure helper is executable by client roles');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000042121","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000042111","app_role":"owner"}', true);

select throws_ok($$ select run_loyalty_sweep_job() $$, '42501', null, 'owner cannot run the sweep');
select throws_ok(
  $$ select private.on_session_refunded_after_consumption('00000000-0000-0000-0000-0000000421b1', '00000000-0000-0000-0000-000000042134', '00000000-0000-0000-0000-000000042112') $$,
  '42501', null, 'owner cannot call the reversal hook');
select throws_ok(
  $$ insert into loyalty_events (gym_id, member_id, event_type, counter, origin_id)
     values ('00000000-0000-0000-0000-000000042111', '00000000-0000-0000-0000-000000042132', 'stamp_reversed', 'guest', gen_random_uuid()) $$,
  '42501', null, 'owner cannot write a reversal event');
select throws_ok(
  $$ update loyalty_progress set guest_stamps = 0 where member_id = '00000000-0000-0000-0000-000000042134' $$,
  '42501', null, 'owner cannot edit a counter');
select throws_ok(
  $$ delete from loyalty_events where member_id = '00000000-0000-0000-0000-000000042134' $$,
  '42501', null, 'owner cannot delete ledger rows');

-- Cross-gym isolation: gym A's owner sees none of gym B's sweep output.
select is(
  (select count(*)::int from loyalty_events where member_id = '00000000-0000-0000-0000-000000042134'),
  0, 'owner A reads no gym B events (RLS)');
select is(
  (select count(*)::int from audit_log where action_type in ('loyalty_paid_session_lapsed', 'loyalty_progress_reset')),
  0, 'owner A reads no gym B sweep audit rows');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000042123","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000042112","app_role":"owner"}', true);
select is(
  (select count(*)::int from loyalty_events where member_id = '00000000-0000-0000-0000-000000042134'),
  2, 'owner B reads its own lapse and reset');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000042122","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000042111","app_role":"member"}', true);
select is(
  (select count(*)::int from loyalty_events), 0, 'member A reads no other member''s or gym''s events');
reset role;

-- ============================================================================
-- The sweep touches only what is due.
-- ============================================================================
select is(
  (select count(*)::int from loyalty_events where gym_id = '00000000-0000-0000-0000-000000042111'),
  0, 'gym A (nothing due) got no events');
select is(
  (select guest_stamps from loyalty_progress where member_id = '00000000-0000-0000-0000-000000042134'),
  0, 'gym B member counter reset');

-- A refund of an unconsumed session reaches no reversal path.
select is(
  (select count(*)::int from loyalty_events where event_type = 'stamp_reversed'),
  0, 'no reversal without a consumed session');

-- A refund row whose session was never stamped writes nothing (consumed, no stamp event).
select set_config('request.jwt.claims', '{}', true);
update guest_sessions set consumed_at = now() - interval '2 days', covered_day = current_date - 2
where id = '00000000-0000-0000-0000-0000000421b1';
insert into refunds (gym_id, payment_id, amount, reason, actor_id)
values ('00000000-0000-0000-0000-000000042112', '00000000-0000-0000-0000-0000000421a1', 2000, 'x',
        '00000000-0000-0000-0000-000000042123');
select is(
  (select count(*)::int from loyalty_events where event_type = 'stamp_reversed'),
  0, 'a consumed session with no stamp event is not reversed');
select is(
  (select guest_stamps from loyalty_progress where member_id = '00000000-0000-0000-0000-000000042134'),
  0, 'and no counter moves');

select * from finish();
rollback;
