-- Story 19.8 (migration 0113), negative paths: a refund of another purpose
-- never touches a session, cross-gym isolation of the session line, role and
-- suspension behavior, and the existing refund blocks still hold.
--
-- Fixture ids: 00000000-0000-0000-0000-0000000361xx.

begin;
select plan(12);

insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000036101', 'Refund Neg Tier', 6000, 60000, null);

insert into gyms (id, name, tier_id, status, charge_guests_per_session, registration_fee) values
  ('00000000-0000-0000-0000-000000036111', 'Refund Neg Gym A', '00000000-0000-0000-0000-000000036101', 'active', true, 0),
  ('00000000-0000-0000-0000-000000036112', 'Refund Neg Gym B', '00000000-0000-0000-0000-000000036101', 'active', true, 0),
  ('00000000-0000-0000-0000-000000036113', 'Refund Neg Gym C', '00000000-0000-0000-0000-000000036101', 'suspended', true, 0);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000036121'), -- A owner
  ('00000000-0000-0000-0000-000000036122'), -- A coach
  ('00000000-0000-0000-0000-000000036123'), -- B owner
  ('00000000-0000-0000-0000-000000036124'), -- C owner
  ('00000000-0000-0000-0000-000000036131'), -- A member
  ('00000000-0000-0000-0000-000000036132'), -- B member
  ('00000000-0000-0000-0000-000000036133'); -- C member

insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000036141', '00000000-0000-0000-0000-000000036111', '00000000-0000-0000-0000-000000036121', 'owner', 'Neg A Owner', current_date),
  ('00000000-0000-0000-0000-000000036142', '00000000-0000-0000-0000-000000036111', '00000000-0000-0000-0000-000000036122', 'coach', 'Neg A Coach', current_date),
  ('00000000-0000-0000-0000-000000036143', '00000000-0000-0000-0000-000000036112', '00000000-0000-0000-0000-000000036123', 'owner', 'Neg B Owner', current_date),
  ('00000000-0000-0000-0000-000000036144', '00000000-0000-0000-0000-000000036113', '00000000-0000-0000-0000-000000036124', 'owner', 'Neg C Owner', current_date),
  ('00000000-0000-0000-0000-000000036151', '00000000-0000-0000-0000-000000036111', '00000000-0000-0000-0000-000000036131', 'member', 'Neg A Member', current_date),
  ('00000000-0000-0000-0000-000000036152', '00000000-0000-0000-0000-000000036112', '00000000-0000-0000-0000-000000036132', 'member', 'Neg B Member', current_date),
  ('00000000-0000-0000-0000-000000036153', '00000000-0000-0000-0000-000000036113', '00000000-0000-0000-0000-000000036133', 'member', 'Neg C Member', current_date);

-- A's unused paid session, a subscription payment and a fee payment of the
-- same member; B has its own session payment; C (suspended) holds one.
insert into payments (id, gym_id, member_id, amount, currency, method, status, purpose) values
  ('00000000-0000-0000-0000-000000036161', '00000000-0000-0000-0000-000000036111', '00000000-0000-0000-0000-000000036151', 4000, 'XAF', 'cash', 'verified', 'session'),
  ('00000000-0000-0000-0000-000000036162', '00000000-0000-0000-0000-000000036111', '00000000-0000-0000-0000-000000036151', 9000, 'XAF', 'cash', 'verified', 'subscription'),
  ('00000000-0000-0000-0000-000000036163', '00000000-0000-0000-0000-000000036111', '00000000-0000-0000-0000-000000036151', 1500, 'XAF', 'cash', 'verified', 'registration_fee'),
  ('00000000-0000-0000-0000-000000036164', '00000000-0000-0000-0000-000000036112', '00000000-0000-0000-0000-000000036152', 7000, 'XAF', 'cash', 'verified', 'session'),
  ('00000000-0000-0000-0000-000000036165', '00000000-0000-0000-0000-000000036113', '00000000-0000-0000-0000-000000036153', 3000, 'XAF', 'cash', 'verified', 'session');

insert into guest_sessions (id, gym_id, member_id, payment_id, usable_until) values
  ('00000000-0000-0000-0000-000000036171', '00000000-0000-0000-0000-000000036111', '00000000-0000-0000-0000-000000036151', '00000000-0000-0000-0000-000000036161', now() + interval '5 days'),
  ('00000000-0000-0000-0000-000000036172', '00000000-0000-0000-0000-000000036112', '00000000-0000-0000-0000-000000036152', '00000000-0000-0000-0000-000000036164', now() + interval '5 days');

-- A subscription refund leaves A's unused session alone.
insert into refunds (gym_id, payment_id, amount, reason, actor_id) values
  ('00000000-0000-0000-0000-000000036111', '00000000-0000-0000-0000-000000036162', 9000, 'full subscription refund', '00000000-0000-0000-0000-000000036121');

select is(
  (select voided_at is null from guest_sessions where id = '00000000-0000-0000-0000-000000036171'),
  true, 'a full refund of a subscription payment does not void the member''s session');
select is(
  (select count(*)::int from audit_log where action_type = 'session_refund_applied' and gym_id = '00000000-0000-0000-0000-000000036111'),
  0, 'and writes no session_refund_applied row');

-- A registration fee is still not refundable (0101), so the trigger is never reached.
select throws_ok(
  $$ insert into refunds (gym_id, payment_id, amount, reason, actor_id)
     values ('00000000-0000-0000-0000-000000036111', '00000000-0000-0000-0000-000000036163', 1500, 'fee', '00000000-0000-0000-0000-000000036121') $$,
  '23514', null, 'a registration fee refund is still refused');

-- Refunding B's session does not touch A's session.
insert into refunds (gym_id, payment_id, amount, reason, actor_id) values
  ('00000000-0000-0000-0000-000000036112', '00000000-0000-0000-0000-000000036164', 7000, 'B full', '00000000-0000-0000-0000-000000036123');

select is(
  (select voided_at is not null from guest_sessions where id = '00000000-0000-0000-0000-000000036172'),
  true, 'B''s own session is voided');
select is(
  (select voided_at is null from guest_sessions where id = '00000000-0000-0000-0000-000000036171'),
  true, 'A''s session is untouched by B''s refund');

-- Idempotence of the void: a second refund of one payment is refused by the unique key.
select throws_ok(
  $$ insert into refunds (gym_id, payment_id, amount, reason, actor_id)
     values ('00000000-0000-0000-0000-000000036112', '00000000-0000-0000-0000-000000036164', 100, 'again', '00000000-0000-0000-0000-000000036123') $$,
  '23505', null, 'a second refund of the same payment is refused, so a session cannot be voided twice');

-- Session line: gym scoped, role scoped, suspension scoped.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000036121","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000036111","app_role":"owner"}', true);
select is(gym_session_revenue_mtd(), 4000::bigint, 'Gym A owner sees only Gym A session money');
select is(gym_revenue_mtd(), 1500::bigint, 'Gym A headline: 9000 subscription + 1500 fee - 9000 refund, session money excluded');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000036123","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000036112","app_role":"owner"}', true);
select is(gym_session_revenue_mtd(), 0::bigint, 'Gym B: a fully refunded session payment nets to 0');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000036122","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000036111","app_role":"coach"}', true);
select is(gym_session_revenue_mtd(), 0::bigint, 'a coach gets 0, not NULL');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000036124","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000036113","app_role":"owner"}', true);
select is(gym_session_revenue_mtd(), 0::bigint, 'a suspended gym''s owner gets 0');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000036121","role":"authenticated","app_role":"owner"}', true);
select is(gym_session_revenue_mtd(), 0::bigint, 'no gym_id claim gets 0, never NULL');
reset role;

select * from finish();
rollback;
