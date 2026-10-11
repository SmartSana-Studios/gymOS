-- Story 19.8: session refunds, audit triggers and the session revenue line
-- (migration 0113), positive paths. Privileges and isolation live in
-- session_refund.negative.test.sql; the real two-session race is
-- scripts/session-refund-race.sh (pgTAP runs one session).
--
-- Fixture ids: 00000000-0000-0000-0000-0000000360xx.
--
-- Sequential stand-ins for the race, both orders: refund-then-consume
-- (member A: voided, then denied) and consume-then-refund (member C: kept,
-- hook called once). The lock order that makes them exclusive in a real race
-- is asserted against the trigger source.

begin;
select plan(39);

insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000036001', 'Refund Tier', 6000, 60000, null);

insert into gyms (id, name, tier_id, status, charge_guests_per_session, registration_fee) values
  ('00000000-0000-0000-0000-000000036011', 'Refund Gym', '00000000-0000-0000-0000-000000036001', 'active', true, 0);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000036021'), -- owner
  ('00000000-0000-0000-0000-000000036022'), -- receptionist
  ('00000000-0000-0000-0000-000000036031'), -- A full refund unused
  ('00000000-0000-0000-0000-000000036032'), -- B partial refund unused
  ('00000000-0000-0000-0000-000000036033'), -- C refund after use
  ('00000000-0000-0000-0000-000000036034'), -- D renewal refund
  ('00000000-0000-0000-0000-000000036035'); -- E partial, revenue

insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000036041', '00000000-0000-0000-0000-000000036011', '00000000-0000-0000-0000-000000036021', 'owner', 'Refund Owner', current_date),
  ('00000000-0000-0000-0000-000000036042', '00000000-0000-0000-0000-000000036011', '00000000-0000-0000-0000-000000036022', 'receptionist', 'Refund Receptionist', current_date),
  ('00000000-0000-0000-0000-000000036051', '00000000-0000-0000-0000-000000036011', '00000000-0000-0000-0000-000000036031', 'member', 'Refund A', current_date),
  ('00000000-0000-0000-0000-000000036052', '00000000-0000-0000-0000-000000036011', '00000000-0000-0000-0000-000000036032', 'member', 'Refund B', current_date),
  ('00000000-0000-0000-0000-000000036053', '00000000-0000-0000-0000-000000036011', '00000000-0000-0000-0000-000000036033', 'member', 'Refund C', current_date),
  ('00000000-0000-0000-0000-000000036054', '00000000-0000-0000-0000-000000036011', '00000000-0000-0000-0000-000000036034', 'member', 'Refund D', current_date),
  ('00000000-0000-0000-0000-000000036055', '00000000-0000-0000-0000-000000036011', '00000000-0000-0000-0000-000000036035', 'member', 'Refund E', current_date);

insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000036061', '00000000-0000-0000-0000-000000036011', 'Refund PPS', 'pay_per_session', 5000, 'XAF', 'monthly', null),
  ('00000000-0000-0000-0000-000000036062', '00000000-0000-0000-0000-000000036011', 'Refund Monthly', 'monthly', 15000, 'XAF', 'monthly', 30);

insert into subscriptions (id, gym_id, member_id, plan_id, status, start_date, expiry_date) values
  ('00000000-0000-0000-0000-000000036071', '00000000-0000-0000-0000-000000036011', '00000000-0000-0000-0000-000000036051', '00000000-0000-0000-0000-000000036061', 'active', current_date, null),
  ('00000000-0000-0000-0000-000000036072', '00000000-0000-0000-0000-000000036011', '00000000-0000-0000-0000-000000036052', '00000000-0000-0000-0000-000000036061', 'active', current_date, null),
  ('00000000-0000-0000-0000-000000036073', '00000000-0000-0000-0000-000000036011', '00000000-0000-0000-0000-000000036053', '00000000-0000-0000-0000-000000036061', 'active', current_date, null),
  ('00000000-0000-0000-0000-000000036074', '00000000-0000-0000-0000-000000036011', '00000000-0000-0000-0000-000000036054', '00000000-0000-0000-0000-000000036062', 'active', current_date, current_date + 30),
  ('00000000-0000-0000-0000-000000036075', '00000000-0000-0000-0000-000000036011', '00000000-0000-0000-0000-000000036055', '00000000-0000-0000-0000-000000036061', 'active', current_date, null);

-- The hook is a no-op in production; count its calls for this test.
create temp table hook_calls (session_id uuid, member_id uuid, gym_id uuid);
create or replace function private.on_session_refunded_after_consumption(p_session_id uuid, p_member_id uuid, p_gym_id uuid)
returns void language plpgsql set search_path = public as $$
begin
  insert into pg_temp.hook_calls values (p_session_id, p_member_id, p_gym_id);
end;
$$;

-- Session payments recorded at the desk (19.4 path), one per member except D.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000036022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000036011","app_role":"receptionist"}', true);
select lives_ok($$ select record_session_payment('00000000-0000-0000-0000-000000036051', 'cash') $$, 'session payment for A');
select lives_ok($$ select record_session_payment('00000000-0000-0000-0000-000000036052', 'cash') $$, 'session payment for B');
select lives_ok($$ select record_session_payment('00000000-0000-0000-0000-000000036053', 'cash') $$, 'session payment for C');
select lives_ok($$ select record_session_payment('00000000-0000-0000-0000-000000036055', 'cash') $$, 'session payment for E');
reset role;

-- D: a verified subscription payment (renewal).
insert into payments (id, gym_id, member_id, subscription_id, amount, currency, method, status, purpose) values
  ('00000000-0000-0000-0000-000000036081', '00000000-0000-0000-0000-000000036011', '00000000-0000-0000-0000-000000036054',
   '00000000-0000-0000-0000-000000036074', 15000, 'XAF', 'cash', 'verified', 'subscription');

create temp table pay as
select member_id, id as payment_id, amount from payments
where gym_id = '00000000-0000-0000-0000-000000036011' and purpose = 'session';
grant select on pay to authenticated;

-- Baseline: headline has only D's 15000; session line has 4 x 5000.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000036021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000036011","app_role":"owner"}', true);
select is(gym_revenue_mtd(), 15000::bigint, 'headline excludes session payments');
select is(gym_session_revenue_mtd(), 20000::bigint, 'session line counts the four session payments');

-- ============================================================================
-- A: full refund of an unused session (through the owner RLS path).
-- ============================================================================
insert into refunds (gym_id, payment_id, amount, reason, actor_id)
select '00000000-0000-0000-0000-000000036011', payment_id, amount, 'A full', '00000000-0000-0000-0000-000000036021'
from pay where member_id = '00000000-0000-0000-0000-000000036051';
reset role;

select isnt(
  (select voided_at from guest_sessions where member_id = '00000000-0000-0000-0000-000000036051'),
  null, 'A: full refund voids the unused session');
select is(
  (select metadata ->> 'outcome' from audit_log
   where action_type = 'session_refund_applied' and target_entity_id = '00000000-0000-0000-0000-000000036051'),
  'voided', 'A: audit outcome voided');
select is(
  (select metadata ->> 'refund_amount' from audit_log
   where action_type = 'session_refund_applied' and target_entity_id = '00000000-0000-0000-0000-000000036051'),
  '5000', 'A: audit carries the refund amount');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000036031","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000036011","app_role":"member"}', true);
select is((select check_in() is null), true, 'A: check-in is denied after the refund (refund then consume)');
reset role;
select is((select count(*)::int from attendance_events where member_id = '00000000-0000-0000-0000-000000036051'), 0, 'A: no attendance row');
select is(
  (select count(*)::int from audit_log
   where action_type = 'session_attempt_blocked' and target_entity_id = '00000000-0000-0000-0000-000000036051'),
  1, 'A: one session_attempt_blocked audit row');
select is(
  (select count(*)::int from audit_log
   where action_type = 'session_consumed' and target_entity_id = '00000000-0000-0000-0000-000000036051'),
  0, 'A: nothing consumed');

-- ============================================================================
-- B: partial refund leaves the session usable.
-- ============================================================================
insert into refunds (gym_id, payment_id, amount, reason, actor_id)
select '00000000-0000-0000-0000-000000036011', payment_id, 1000, 'B partial', '00000000-0000-0000-0000-000000036021'
from pay where member_id = '00000000-0000-0000-0000-000000036052';

select is(
  (select voided_at is null and consumed_at is null from guest_sessions where member_id = '00000000-0000-0000-0000-000000036052'),
  true, 'B: partial refund touches nothing');
select is(
  (select metadata ->> 'outcome' from audit_log
   where action_type = 'session_refund_applied' and target_entity_id = '00000000-0000-0000-0000-000000036052'),
  'kept_partial', 'B: audit outcome kept_partial');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000036032","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000036011","app_role":"member"}', true);
select isnt((select check_in()), null, 'B: check-in still works after a partial refund');
reset role;

-- ============================================================================
-- C: consume, then full refund (consume then refund).
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000036033","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000036011","app_role":"member"}', true);
select isnt((select check_in()), null, 'C: check-in consumes the session');
reset role;

select is(
  (select count(*)::int from audit_log
   where action_type = 'session_consumed' and target_entity_id = '00000000-0000-0000-0000-000000036053'),
  1, 'C: one session_consumed audit row');
select is(
  (select metadata ->> 'source' from audit_log
   where action_type = 'session_consumed' and target_entity_id = '00000000-0000-0000-0000-000000036053'),
  'paid', 'C: consumed audit names the paid source');

insert into refunds (gym_id, payment_id, amount, reason, actor_id)
select '00000000-0000-0000-0000-000000036011', payment_id, amount, 'C full after use', '00000000-0000-0000-0000-000000036021'
from pay where member_id = '00000000-0000-0000-0000-000000036053';

select is(
  (select consumed_at is not null and voided_at is null from guest_sessions where member_id = '00000000-0000-0000-0000-000000036053'),
  true, 'C: a consumed session stays consumed and unvoided');
select is((select count(*)::int from hook_calls where member_id = '00000000-0000-0000-0000-000000036053'), 1,
  'C: the reversal hook is called once');
select is(
  (select metadata ->> 'outcome' from audit_log
   where action_type = 'session_refund_applied' and target_entity_id = '00000000-0000-0000-0000-000000036053'),
  'kept_consumed', 'C: audit outcome kept_consumed');
select is((select count(*)::int from attendance_events where member_id = '00000000-0000-0000-0000-000000036053'), 1,
  'C: the visit stays counted');

-- ============================================================================
-- D: a subscription refund has no session effect.
-- ============================================================================
insert into refunds (gym_id, payment_id, amount, reason, actor_id) values
  ('00000000-0000-0000-0000-000000036011', '00000000-0000-0000-0000-000000036081', 3000, 'D renewal refund', '00000000-0000-0000-0000-000000036021');

select is(
  (select count(*)::int from audit_log
   where action_type = 'session_refund_applied' and target_entity_id = '00000000-0000-0000-0000-000000036054'),
  0, 'D: no session audit row for a subscription refund');
select is((select count(*)::int from hook_calls where member_id = '00000000-0000-0000-0000-000000036054'), 0, 'D: hook not called');

-- ============================================================================
-- E: session 5000, refund 2000 -> session line 3000; headline unaffected.
-- ============================================================================
insert into refunds (gym_id, payment_id, amount, reason, actor_id)
select '00000000-0000-0000-0000-000000036011', payment_id, 2000, 'E partial', '00000000-0000-0000-0000-000000036021'
from pay where member_id = '00000000-0000-0000-0000-000000036055';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000036021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000036011","app_role":"owner"}', true);
-- Headline: 15000 - 3000 (D). Session: 20000 - 5000 (A) - 1000 (B) - 5000 (C) - 2000 (E).
select is(gym_revenue_mtd(), 12000::bigint, 'headline is net of the subscription refund only; session refunds do not move it');
select is(gym_session_revenue_mtd(), 7000::bigint, 'session line is session payments net of their refunds');
reset role;

-- A voided session payment leaves the session line.
update payments set voided_at = now()
where id = (select payment_id from pay where member_id = '00000000-0000-0000-0000-000000036055');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000036021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000036011","app_role":"owner"}', true);
select is(gym_session_revenue_mtd(), 2000::bigint, 'a voided session payment drops out of the line (its refund still subtracts)');
reset role;

-- ============================================================================
-- Free-source session consumed: audit source is 'free'. Uses member D (monthly
-- plan is exempt), so call the consumption path directly on member B's gym via
-- a fresh pay-per-session member F.
-- ============================================================================
insert into auth.users (id) values ('00000000-0000-0000-0000-000000036036');
insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000036056', '00000000-0000-0000-0000-000000036011', '00000000-0000-0000-0000-000000036036', 'member', 'Refund F', current_date);
insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date) values
  ('00000000-0000-0000-0000-000000036011', '00000000-0000-0000-0000-000000036056', '00000000-0000-0000-0000-000000036061', 'active', current_date, null);
insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until) values
  ('00000000-0000-0000-0000-000000036011', '00000000-0000-0000-0000-000000036056', gen_random_uuid(), now() + interval '5 days');

select is(
  (select outcome from private.consume_guest_session('00000000-0000-0000-0000-000000036056', '00000000-0000-0000-0000-000000036011', now())),
  'consumed', 'F: the free session is consumed');
select is(
  (select count(*)::int from audit_log
   where action_type = 'session_consumed' and target_entity_id = '00000000-0000-0000-0000-000000036056'
     and metadata ->> 'source' = 'free'),
  1, 'F: one session_consumed audit row with source free');

-- ============================================================================
-- Shape.
-- ============================================================================
select ok(
  (select p.prosecdef from pg_proc p where p.oid = 'private.apply_session_refund()'::regprocedure),
  'the refund trigger function is SECURITY DEFINER');
select ok(
  (select position('for no key update' in lower(p.prosrc)) > 0
          and position('for no key update' in lower(p.prosrc)) < position('from guest_sessions' in lower(p.prosrc))
   from pg_proc p where p.oid = 'private.apply_session_refund()'::regprocedure),
  'the refund trigger takes the member lock before it reads the session');
select ok(
  (select position('for update' in replace(lower(p.prosrc), 'for no key update', '')) > 0
   from pg_proc p where p.oid = 'private.apply_session_refund()'::regprocedure),
  'the refund trigger locks the session row FOR UPDATE');
select has_function('public', 'gym_session_revenue_mtd', '{}'::name[], 'gym_session_revenue_mtd() exists');
select isnt_definer('public', 'gym_session_revenue_mtd', '{}'::name[], 'gym_session_revenue_mtd() is SECURITY INVOKER');
select ok(
  pg_get_functiondef('public.gym_session_revenue_mtd()'::regprocedure) like '%private.gym_local_month_bounds(%',
  'gym_session_revenue_mtd() takes its window from the month helper');
select ok(
  has_function_privilege('authenticated', 'public.gym_session_revenue_mtd()', 'execute'),
  'authenticated can execute gym_session_revenue_mtd()');
select ok(
  not has_function_privilege('anon', 'public.gym_session_revenue_mtd()', 'execute'),
  'anon cannot execute gym_session_revenue_mtd()');
select ok(
  not has_function_privilege('authenticated', 'private.on_session_refunded_after_consumption(uuid, uuid, uuid)', 'execute'),
  'authenticated cannot execute the reversal hook');

select * from finish();
rollback;
