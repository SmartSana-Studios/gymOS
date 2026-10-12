-- Story 19.5: complete_verified_payment takes the member lock on every purpose
-- branch, after the payment row lock and before any other write (migration
-- 0109, canonical Epic 19 lock order: payment -> member).
--
-- Concurrency limit (as in desk_session_payment.test.sql): pgTAP runs one
-- session, so two interleaving callers cannot be exercised. What is asserted
-- instead is (a) the function source orders payment lock, member lock, then
-- every branch's first write, (b) the lock strength is FOR NO KEY UPDATE, and
-- (c) a subscription confirmation followed by a desk action on the same member
-- both land.
--
-- Fixture ids: 00000000-0000-0000-0000-0000000337xx.

begin;
select plan(13);

create extension if not exists pgrowlocks;

-- ============================================================================
-- Source ordering, one assertion per branch.
-- ============================================================================
create temp table src as
select p.prosrc as s from pg_proc p where p.oid = 'public.complete_verified_payment(uuid, integer)'::regprocedure;

select ok(
  (select position('from payments p' in s) > 0
          and position('for update' in s) > position('from payments p' in s)
          and position('for no key update' in s) > position('for update' in s)
   from src),
  'the payment row is locked (FOR UPDATE), then the member row (FOR NO KEY UPDATE)'
);

select ok(
  (select position('for no key update' in s) < position('update payments' in s) from src),
  'the member lock precedes the first payments write (late and normal paths)'
);

select ok(
  (select position('for no key update' in s) < position('update members' in s) from src),
  'fee branch: the member lock precedes the settlement write'
);

select ok(
  (select position('for no key update' in s) < position('insert into subscriptions' in s) from src),
  'subscription branch: the member lock precedes the renewal insert'
);

select ok(
  (select position('for no key update' in s) < position('create_guest_session_for_payment' in s) from src),
  'session branch: the member lock precedes the session creation'
);

select ok(
  (select position('for no key update' in s) < position('log_audit_event' in s) from src),
  'the member lock precedes every audit write'
);

-- ============================================================================
-- A subscription confirmation and a desk action on one member.
-- ============================================================================
insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000033701', 'Lock Tier', 6000, 60000, null);

insert into gyms (id, name, tier_id, status, charge_guests_per_session) values
  ('00000000-0000-0000-0000-000000033711', 'Lock Gym', '00000000-0000-0000-0000-000000033701', 'active', true);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000033721'), -- receptionist
  ('00000000-0000-0000-0000-000000033722'); -- member

insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000033731', '00000000-0000-0000-0000-000000033711', '00000000-0000-0000-0000-000000033721', 'receptionist', 'Lock Rec', current_date),
  ('00000000-0000-0000-0000-000000033732', '00000000-0000-0000-0000-000000033711', '00000000-0000-0000-0000-000000033722', 'member', 'Lock Member', current_date);

update members set registration_fee_settled_at = now() where id = '00000000-0000-0000-0000-000000033732';

insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000033741', '00000000-0000-0000-0000-000000033711', 'Lock PPS', 'pay_per_session', 2000, 'XAF', 'monthly', null);

insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date, created_at) values
  ('00000000-0000-0000-0000-000000033711', '00000000-0000-0000-0000-000000033732', '00000000-0000-0000-0000-000000033741', 'expired', current_date - 60, null, now() - interval '1 day');

insert into payments (id, gym_id, member_id, amount, currency, method, status, provider, purpose) values
  ('00000000-0000-0000-0000-000000033751', '00000000-0000-0000-0000-000000033711', '00000000-0000-0000-0000-000000033732', 2000, 'XAF', 'mobile_money', 'processing', 'taramoney', 'subscription');

-- One more member, confirming a session payment, for the behavioral lock
-- observation. The fee path is not observed this way: its settlement UPDATE
-- replaces the row version, so the lock is covered by the source-order check.
insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000033723');

insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000033733', '00000000-0000-0000-0000-000000033711', '00000000-0000-0000-0000-000000033723', 'member', 'Lock Session', current_date);

insert into payments (id, gym_id, member_id, amount, currency, method, status, provider, purpose) values
  ('00000000-0000-0000-0000-000000033752', '00000000-0000-0000-0000-000000033711', '00000000-0000-0000-0000-000000033733', 2000, 'XAF', 'mobile_money', 'processing', 'taramoney', 'session');

-- Behavioral lock observation. Before the call each member row carries at most
-- the FOR KEY SHARE lock its payment's foreign key took; the confirmation must
-- upgrade it to FOR NO KEY UPDATE (pgrowlocks reads the tuple's lock mode, so
-- this does not depend on txid arithmetic or on source text).
create function pg_temp.member_nku(p_id uuid) returns boolean
language sql as $$
  select exists (
    select 1 from pgrowlocks('public.members') r
    where r.locked_row = (select m.ctid from members m where m.id = p_id)
      and 'For No Key Update' = any (r.modes)
  );
$$;

select is(pg_temp.member_nku('00000000-0000-0000-0000-000000033732'), false, 'subscription member: no FOR NO KEY UPDATE before the confirmation');
select is(pg_temp.member_nku('00000000-0000-0000-0000-000000033733'), false, 'session member: no FOR NO KEY UPDATE before the confirmation');

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select isnt(
  (select complete_verified_payment('00000000-0000-0000-0000-000000033751', 20)),
  null::uuid,
  'the renewal confirmation returns the new subscription id'
);
select complete_verified_payment('00000000-0000-0000-0000-000000033752', 5);
reset role;

select is(pg_temp.member_nku('00000000-0000-0000-0000-000000033732'), true, 'subscription path: the member row holds FOR NO KEY UPDATE after the confirmation');
select is(pg_temp.member_nku('00000000-0000-0000-0000-000000033733'), true, 'session path: the member row holds FOR NO KEY UPDATE after the confirmation');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000033721","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000033711","app_role":"receptionist"}', true);
select lives_ok(
  $$ select record_session_payment('00000000-0000-0000-0000-000000033732', 'cash') $$,
  'a desk session payment on the same member lands after the renewal'
);
reset role;

select is(
  (select count(*)::int from subscriptions where member_id = '00000000-0000-0000-0000-000000033732' and status = 'active')
  + (select count(*)::int from guest_sessions where member_id = '00000000-0000-0000-0000-000000033732'),
  2,
  'one renewed subscription and one session'
);

select * from finish();
rollback;
