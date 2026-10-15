-- Story 19.5: in-app Tara Money session payment (migration 0109), denial
-- paths. Positive paths live in in_app_session_payment.test.sql.
--
-- Fixture ids: 00000000-0000-0000-0000-0000000336xx.

begin;
select plan(24);

insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000033601', 'In-app Session Neg Tier', 6000, 60000, null);

-- gym A: charging on, Tara connected. gym B: charging off. gym C: suspended.
-- gym D: charging on, no credentials row.
insert into gyms (id, name, tier_id, status, charge_guests_per_session) values
  ('00000000-0000-0000-0000-000000033611', 'IAN Gym A', '00000000-0000-0000-0000-000000033601', 'active', true),
  ('00000000-0000-0000-0000-000000033612', 'IAN Gym B', '00000000-0000-0000-0000-000000033601', 'active', false),
  ('00000000-0000-0000-0000-000000033613', 'IAN Gym C', '00000000-0000-0000-0000-000000033601', 'suspended', true),
  ('00000000-0000-0000-0000-000000033614', 'IAN Gym D', '00000000-0000-0000-0000-000000033601', 'active', true);

insert into gym_payment_credentials (gym_id, provider_key, credentials_secret_id, business_id_masked) values
  ('00000000-0000-0000-0000-000000033611', 'taramoney', gen_random_uuid(), '****1'),
  ('00000000-0000-0000-0000-000000033612', 'taramoney', gen_random_uuid(), '****2'),
  ('00000000-0000-0000-0000-000000033613', 'taramoney', gen_random_uuid(), '****3');

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000033621'), -- staff (receptionist), gym A
  ('00000000-0000-0000-0000-000000033622'), -- coach, gym A
  ('00000000-0000-0000-0000-000000033623'), -- member: monthly plan
  ('00000000-0000-0000-0000-000000033624'), -- member: no subscription
  ('00000000-0000-0000-0000-000000033625'), -- member: price 0
  ('00000000-0000-0000-0000-000000033626'), -- member: in flight
  ('00000000-0000-0000-0000-000000033627'), -- member: deactivated
  ('00000000-0000-0000-0000-000000033628'), -- member: fee not settled
  ('00000000-0000-0000-0000-000000033629'), -- member: gym B (flag off)
  ('00000000-0000-0000-0000-00000003362a'), -- member: gym C (suspended)
  ('00000000-0000-0000-0000-00000003362b'), -- member: gym D (no credentials)
  ('00000000-0000-0000-0000-00000003362c'), -- member: under 10 minutes boundary
  ('00000000-0000-0000-0000-00000003362d'), -- member: pending row in flight
  ('00000000-0000-0000-0000-00000003362e'); -- member: eligible, gym A (provider off control)

insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000033631', '00000000-0000-0000-0000-000000033611', '00000000-0000-0000-0000-000000033621', 'receptionist', 'IAN Staff', current_date),
  ('00000000-0000-0000-0000-000000033632', '00000000-0000-0000-0000-000000033611', '00000000-0000-0000-0000-000000033622', 'coach',        'IAN Coach', current_date),
  ('00000000-0000-0000-0000-000000033633', '00000000-0000-0000-0000-000000033611', '00000000-0000-0000-0000-000000033623', 'member', 'IAN Monthly', current_date),
  ('00000000-0000-0000-0000-000000033634', '00000000-0000-0000-0000-000000033611', '00000000-0000-0000-0000-000000033624', 'member', 'IAN NoSub', current_date),
  ('00000000-0000-0000-0000-000000033635', '00000000-0000-0000-0000-000000033611', '00000000-0000-0000-0000-000000033625', 'member', 'IAN Free', current_date),
  ('00000000-0000-0000-0000-000000033636', '00000000-0000-0000-0000-000000033611', '00000000-0000-0000-0000-000000033626', 'member', 'IAN InFlight', current_date),
  ('00000000-0000-0000-0000-000000033637', '00000000-0000-0000-0000-000000033611', '00000000-0000-0000-0000-000000033627', 'member', 'IAN Deact', current_date),
  ('00000000-0000-0000-0000-000000033638', '00000000-0000-0000-0000-000000033611', '00000000-0000-0000-0000-000000033628', 'member', 'IAN NoFee', current_date),
  ('00000000-0000-0000-0000-000000033639', '00000000-0000-0000-0000-000000033612', '00000000-0000-0000-0000-000000033629', 'member', 'IAN FlagOff', current_date),
  ('00000000-0000-0000-0000-00000003363a', '00000000-0000-0000-0000-000000033613', '00000000-0000-0000-0000-00000003362a', 'member', 'IAN Susp', current_date),
  ('00000000-0000-0000-0000-00000003363b', '00000000-0000-0000-0000-000000033614', '00000000-0000-0000-0000-00000003362b', 'member', 'IAN NoCred', current_date),
  ('00000000-0000-0000-0000-00000003363c', '00000000-0000-0000-0000-000000033611', '00000000-0000-0000-0000-00000003362c', 'member', 'IAN Young', current_date),
  ('00000000-0000-0000-0000-00000003363d', '00000000-0000-0000-0000-000000033611', '00000000-0000-0000-0000-00000003362d', 'member', 'IAN Pending', current_date),
  ('00000000-0000-0000-0000-00000003363e', '00000000-0000-0000-0000-000000033611', '00000000-0000-0000-0000-00000003362e', 'member', 'IAN Eligible', current_date);

update members set registration_fee_settled_at = now() where role = 'member';
update members set deactivated_at = now() where id = '00000000-0000-0000-0000-000000033637';

insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000033641', '00000000-0000-0000-0000-000000033611', 'IAN PPS',     'pay_per_session', 2000, 'XAF', 'monthly', null),
  ('00000000-0000-0000-0000-000000033642', '00000000-0000-0000-0000-000000033611', 'IAN PPS Free', 'pay_per_session', 0,    'XAF', 'monthly', null),
  ('00000000-0000-0000-0000-000000033643', '00000000-0000-0000-0000-000000033611', 'IAN Monthly',  'monthly',         15000, 'XAF', 'monthly', 30),
  ('00000000-0000-0000-0000-000000033644', '00000000-0000-0000-0000-000000033612', 'IAN B PPS',    'pay_per_session', 2000, 'XAF', 'monthly', null),
  ('00000000-0000-0000-0000-000000033645', '00000000-0000-0000-0000-000000033613', 'IAN C PPS',    'pay_per_session', 2000, 'XAF', 'monthly', null),
  ('00000000-0000-0000-0000-000000033646', '00000000-0000-0000-0000-000000033614', 'IAN D PPS',    'pay_per_session', 2000, 'XAF', 'monthly', null);

insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date) values
  ('00000000-0000-0000-0000-000000033611', '00000000-0000-0000-0000-000000033633', '00000000-0000-0000-0000-000000033643', 'active', current_date, current_date + 30),
  ('00000000-0000-0000-0000-000000033611', '00000000-0000-0000-0000-000000033635', '00000000-0000-0000-0000-000000033642', 'active', current_date, null),
  ('00000000-0000-0000-0000-000000033611', '00000000-0000-0000-0000-000000033636', '00000000-0000-0000-0000-000000033641', 'active', current_date, null),
  ('00000000-0000-0000-0000-000000033611', '00000000-0000-0000-0000-000000033637', '00000000-0000-0000-0000-000000033641', 'active', current_date, null),
  ('00000000-0000-0000-0000-000000033611', '00000000-0000-0000-0000-000000033638', '00000000-0000-0000-0000-000000033641', 'active', current_date, null),
  ('00000000-0000-0000-0000-000000033612', '00000000-0000-0000-0000-000000033639', '00000000-0000-0000-0000-000000033644', 'active', current_date, null),
  ('00000000-0000-0000-0000-000000033613', '00000000-0000-0000-0000-00000003363a', '00000000-0000-0000-0000-000000033645', 'active', current_date, null),
  ('00000000-0000-0000-0000-000000033614', '00000000-0000-0000-0000-00000003363b', '00000000-0000-0000-0000-000000033646', 'active', current_date, null),
  ('00000000-0000-0000-0000-000000033611', '00000000-0000-0000-0000-00000003363c', '00000000-0000-0000-0000-000000033641', 'active', current_date, null),
  ('00000000-0000-0000-0000-000000033611', '00000000-0000-0000-0000-00000003363d', '00000000-0000-0000-0000-000000033641', 'active', current_date, null),
  ('00000000-0000-0000-0000-000000033611', '00000000-0000-0000-0000-00000003363e', '00000000-0000-0000-0000-000000033641', 'active', current_date, null);

-- Released to awaiting after the subscription exists (the insert refuses an awaiting member).
update members set registration_fee_settled_at = null where id = '00000000-0000-0000-0000-000000033638';

insert into payments (id, gym_id, member_id, amount, currency, method, status, provider, purpose, created_at) values
  ('00000000-0000-0000-0000-000000033651', '00000000-0000-0000-0000-000000033611', '00000000-0000-0000-0000-000000033636', 2000, 'XAF', 'mobile_money', 'processing', 'taramoney', 'session', now() - interval '2 minutes'),
  ('00000000-0000-0000-0000-000000033652', '00000000-0000-0000-0000-000000033611', '00000000-0000-0000-0000-00000003363c', 2000, 'XAF', 'mobile_money', 'processing', 'taramoney', 'session', now() - interval '9 minutes'),
  ('00000000-0000-0000-0000-000000033653', '00000000-0000-0000-0000-000000033611', '00000000-0000-0000-0000-00000003363d', 2000, 'XAF', 'cash',         'pending',    null,        'session', now());


-- ============================================================================
-- Role matrix.
-- ============================================================================
set local role authenticated;

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000033621","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000033611","app_role":"receptionist"}', true);
select throws_like($$ select initiate_session_payment() $$, '%permission denied%', 'staff cannot start a member session payment');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000033622","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000033611","app_role":"coach"}', true);
select throws_like($$ select initiate_session_payment() $$, '%permission denied%', 'a coach cannot start a session payment');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000033623","role":"authenticated","app_role":"member"}', true);
select throws_like($$ select initiate_session_payment() $$, '%permission denied%', 'a claim with no gym_id is refused');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000336ff","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000033611","app_role":"member"}', true);
select throws_like($$ select initiate_session_payment() $$, '%permission denied%', 'a caller with no member row is refused');

select set_config('request.jwt.claims', '{"role":"anon"}', true);
reset role;
set local role anon;
select throws_ok($$ select initiate_session_payment() $$, '42501', null, 'anon has no EXECUTE');
reset role;

-- ============================================================================
-- Member-state and plan checks.
-- ============================================================================
set local role authenticated;

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000033629","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000033612","app_role":"member"}', true);
select throws_like($$ select initiate_session_payment() $$, 'charging_disabled:%', 'a gym with charging off is refused');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000033623","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000033611","app_role":"member"}', true);
select throws_like($$ select initiate_session_payment() $$, 'plan_not_per_session:%', 'a monthly plan is refused');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000033624","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000033611","app_role":"member"}', true);
select throws_like($$ select initiate_session_payment() $$, 'plan_not_per_session:%', 'a member with no subscription is refused');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000033625","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000033611","app_role":"member"}', true);
select throws_like($$ select initiate_session_payment() $$, 'session_price_not_set:%', 'a price 0 plan is refused');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000033626","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000033611","app_role":"member"}', true);
select throws_like($$ select initiate_session_payment() $$, 'session_payment_already_in_progress:%', 'a young processing attempt blocks a second');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000003362c","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000033611","app_role":"member"}', true);
select throws_like($$ select initiate_session_payment() $$, 'session_payment_already_in_progress:%', 'a 9 minute old attempt still blocks');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000003362d","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000033611","app_role":"member"}', true);
select throws_like($$ select initiate_session_payment() $$, 'session_payment_already_in_progress:%', 'a pending (desk) session payment blocks');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000033627","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000033611","app_role":"member"}', true);
select throws_like($$ select initiate_session_payment() $$, 'permission denied%', 'a deactivated member is refused');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000033628","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000033611","app_role":"member"}', true);
select throws_like($$ select initiate_session_payment() $$, 'registration_fee_not_settled:%', 'a member awaiting the fee is refused');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000003362a","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000033613","app_role":"member"}', true);
select throws_like($$ select initiate_session_payment() $$, '%is not active%', 'a member of a suspended gym is refused');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000003362b","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000033614","app_role":"member"}', true);
select throws_like($$ select initiate_session_payment() $$, 'no_active_provider:%', 'a gym with no credentials row is refused');
reset role;

-- No active provider at all.
update payment_providers set is_active = false;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000003362b","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000033614","app_role":"member"}', true);
select throws_like($$ select initiate_session_payment() $$, 'no_active_provider:%', 'no active provider is refused');
reset role;
update payment_providers set is_active = true where provider_key = 'taramoney';

-- Provider deactivated, credentials row present (gym A): no_active_provider.
-- The gym D case above cannot tell this from a missing credentials row.
update payment_providers set is_active = false;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000003362e","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000033611","app_role":"member"}', true);
select throws_like($$ select initiate_session_payment() $$, 'no_active_provider:%', 'an inactive provider is refused for a gym that has a credentials row');
reset role;
update payment_providers set is_active = true where provider_key = 'taramoney';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000003362e","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000033611","app_role":"member"}', true);
select lives_ok($$ select initiate_session_payment() $$, 'positive control: with the provider active again the same member can start a payment');
reset role;
delete from guest_sessions where member_id = '00000000-0000-0000-0000-00000003363e';
delete from payments where member_id = '00000000-0000-0000-0000-00000003363e';

select is(
  (select count(*)::int from payments where id not in (
     '00000000-0000-0000-0000-000000033651', '00000000-0000-0000-0000-000000033652', '00000000-0000-0000-0000-000000033653')
     and gym_id in ('00000000-0000-0000-0000-000000033611', '00000000-0000-0000-0000-000000033612',
                    '00000000-0000-0000-0000-000000033613', '00000000-0000-0000-0000-000000033614')),
  0,
  'no refusal wrote a payment row'
);

select is(
  (select count(*)::int from payments where member_id = '00000000-0000-0000-0000-000000033633'),
  0,
  'the monthly-plan refusal wrote nothing'
);

select is(
  (select row(status::text, flagged_reason)::text from payments where id = '00000000-0000-0000-0000-000000033652'),
  row('processing', null::text)::text,
  'a 9 minute old attempt was not flagged by the refused call'
);

select is(
  (select count(*)::int from guest_sessions where gym_id in ('00000000-0000-0000-0000-000000033611', '00000000-0000-0000-0000-000000033612',
                                                            '00000000-0000-0000-0000-000000033613', '00000000-0000-0000-0000-000000033614')),
  0,
  'no refusal created a session'
);

-- Replay on an unknown payment is a no-op, not an error.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select is(
  (select complete_verified_payment('00000000-0000-0000-0000-0000000336ff', 0)),
  null::uuid,
  'confirming an unknown payment is a no-op'
);
reset role;

select * from finish();
rollback;
