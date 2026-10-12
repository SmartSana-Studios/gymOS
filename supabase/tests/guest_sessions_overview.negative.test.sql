-- Story 19.10 (migration 0114), refusals: role ceiling, invalid period, anon
-- EXECUTE, cross-gym isolation and the suspended-gym read.
--
-- Fixture ids: 00000000-0000-0000-0000-0000000371xx.

begin;
select plan(11);

insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000037101', 'Ov Neg Tier', 6000, 60000, null);

insert into gyms (id, name, tier_id, status, charge_guests_per_session, registration_fee) values
  ('00000000-0000-0000-0000-000000037111', 'Ov Neg Gym A', '00000000-0000-0000-0000-000000037101', 'active', true, 0),
  ('00000000-0000-0000-0000-000000037112', 'Ov Neg Gym B', '00000000-0000-0000-0000-000000037101', 'active', true, 0),
  ('00000000-0000-0000-0000-000000037113', 'Ov Neg Gym C', '00000000-0000-0000-0000-000000037101', 'suspended', true, 0);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000037121'), -- A owner
  ('00000000-0000-0000-0000-000000037122'), -- A receptionist
  ('00000000-0000-0000-0000-000000037123'), -- A coach
  ('00000000-0000-0000-0000-000000037124'), -- B owner
  ('00000000-0000-0000-0000-000000037125'), -- C owner
  ('00000000-0000-0000-0000-000000037131'), -- A member
  ('00000000-0000-0000-0000-000000037132'), -- B member
  ('00000000-0000-0000-0000-000000037133'); -- C member

insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000037141', '00000000-0000-0000-0000-000000037111', '00000000-0000-0000-0000-000000037121', 'owner', 'Neg A Owner', current_date),
  ('00000000-0000-0000-0000-000000037142', '00000000-0000-0000-0000-000000037111', '00000000-0000-0000-0000-000000037122', 'receptionist', 'Neg A Reception', current_date),
  ('00000000-0000-0000-0000-000000037143', '00000000-0000-0000-0000-000000037111', '00000000-0000-0000-0000-000000037123', 'coach', 'Neg A Coach', current_date),
  ('00000000-0000-0000-0000-000000037144', '00000000-0000-0000-0000-000000037112', '00000000-0000-0000-0000-000000037124', 'owner', 'Neg B Owner', current_date),
  ('00000000-0000-0000-0000-000000037145', '00000000-0000-0000-0000-000000037113', '00000000-0000-0000-0000-000000037125', 'owner', 'Neg C Owner', current_date),
  ('00000000-0000-0000-0000-000000037151', '00000000-0000-0000-0000-000000037111', '00000000-0000-0000-0000-000000037131', 'member', 'Neg A Member', current_date),
  ('00000000-0000-0000-0000-000000037152', '00000000-0000-0000-0000-000000037112', '00000000-0000-0000-0000-000000037132', 'member', 'Neg B Member', current_date),
  ('00000000-0000-0000-0000-000000037153', '00000000-0000-0000-0000-000000037113', '00000000-0000-0000-0000-000000037133', 'member', 'Neg C Member', current_date);

insert into payments (id, gym_id, member_id, amount, currency, method, status, purpose, actor_id) values
  ('00000000-0000-0000-0000-000000037161', '00000000-0000-0000-0000-000000037111', '00000000-0000-0000-0000-000000037151', 4000, 'XAF', 'cash', 'verified', 'session', '00000000-0000-0000-0000-000000037121'),
  ('00000000-0000-0000-0000-000000037162', '00000000-0000-0000-0000-000000037112', '00000000-0000-0000-0000-000000037152', 7000, 'XAF', 'cash', 'verified', 'session', '00000000-0000-0000-0000-000000037124'),
  ('00000000-0000-0000-0000-000000037163', '00000000-0000-0000-0000-000000037113', '00000000-0000-0000-0000-000000037153', 3000, 'XAF', 'cash', 'verified', 'session', '00000000-0000-0000-0000-000000037125');

insert into guest_sessions (gym_id, member_id, payment_id, usable_until) values
  ('00000000-0000-0000-0000-000000037111', '00000000-0000-0000-0000-000000037151', '00000000-0000-0000-0000-000000037161', now() + interval '5 days'),
  ('00000000-0000-0000-0000-000000037112', '00000000-0000-0000-0000-000000037152', '00000000-0000-0000-0000-000000037162', now() + interval '5 days'),
  ('00000000-0000-0000-0000-000000037113', '00000000-0000-0000-0000-000000037153', '00000000-0000-0000-0000-000000037163', now() + interval '5 days');

insert into session_attempts (gym_id, member_id, source) values
  ('00000000-0000-0000-0000-000000037112', '00000000-0000-0000-0000-000000037152', 'check_in'),
  ('00000000-0000-0000-0000-000000037113', '00000000-0000-0000-0000-000000037153', 'check_in');

-- Receptionist and coach are refused on every RPC.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000037122","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000037111","app_role":"receptionist"}', true);
select throws_ok($$ select * from guest_sessions_summary('today') $$, '42501', null, 'receptionist: summary refused');
select throws_ok($$ select * from list_guest_sessions_paid('today') $$, '42501', null, 'receptionist: paid list refused');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000037123","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000037111","app_role":"coach"}', true);
select throws_ok($$ select * from list_session_attempts('today') $$, '42501', null, 'coach: attempts list refused');
select throws_ok($$ select * from list_free_guest_sessions('today') $$, '42501', null, 'coach: free list refused');

-- Member role refused too.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000037131","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000037111","app_role":"member"}', true);
select throws_ok($$ select * from guest_sessions_summary('month') $$, '42501', null, 'member: summary refused');

-- Owner: invalid period raises, and only the own gym is visible.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000037121","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000037111","app_role":"owner"}', true);
select throws_ok($$ select * from guest_sessions_summary('week') $$, '22023', null, 'unknown period raises');
select is((select paid_count from guest_sessions_summary('month')), 1::bigint, 'owner A sees only gym A paid sessions');
select is((select blocked_count from guest_sessions_summary('month')), 0::bigint, 'owner A sees no gym B attempts');
select is((select count(*)::int from list_guest_sessions_paid('month')), 1, 'owner A paid list holds only gym A');

-- Suspended gym reads zeros through the tenant gate.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000037125","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000037113","app_role":"owner"}', true);
select is((select paid_count + blocked_count + free_count from guest_sessions_summary('month')), 0::bigint,
  'suspended gym: summary reads zeros');

-- anon has no EXECUTE.
reset role;
select is(has_function_privilege('anon', 'public.guest_sessions_summary(text)', 'execute'), false, 'anon cannot execute the summary');

select * from finish();
rollback;
