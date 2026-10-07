-- Story 18.1: registration fee foundation (migration 0098), positive paths.
-- The denial paths live in registration_fee_foundation.negative.test.sql.
--
-- Fee gyms are seeded with `registration_fee` in the gym INSERT itself:
-- gyms.registration_fee is pinned against every UPDATE except
-- set_registration_fee()'s own, silently (the same trap as gyms.status, see
-- docs/decisions.md), so a bare `update gyms set registration_fee = ...`
-- here would do nothing and report success.
--
-- Fixture ids: 00000000-0000-0000-0000-0000000310xx.

begin;
select plan(26);

insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000031001', 'RegFee Tier Uncapped', 6000, 60000, null),
  ('00000000-0000-0000-0000-000000031002', 'RegFee Tier Cap 2',    6000, 60000, 2);

insert into gyms (id, name, tier_id, status, registration_fee) values
  ('00000000-0000-0000-0000-000000031011', 'RegFee Gym Free',  '00000000-0000-0000-0000-000000031001', 'active', 0),
  ('00000000-0000-0000-0000-000000031012', 'RegFee Gym Fee',   '00000000-0000-0000-0000-000000031001', 'active', 5000),
  ('00000000-0000-0000-0000-000000031013', 'RegFee Gym Capped','00000000-0000-0000-0000-000000031002', 'active', 5000);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000031021'), -- owner, free gym
  ('00000000-0000-0000-0000-000000031022'), -- supervisor, free gym
  ('00000000-0000-0000-0000-000000031023'), -- receptionist, free gym
  ('00000000-0000-0000-0000-000000031024'), -- member settled+active, free gym
  ('00000000-0000-0000-0000-000000031025'), -- member expired, free gym
  ('00000000-0000-0000-0000-000000031026'), -- member grace, free gym
  ('00000000-0000-0000-0000-000000031027'), -- member with processing payment, free gym
  ('00000000-0000-0000-0000-000000031031'), -- coach, fee gym
  ('00000000-0000-0000-0000-000000031032'), -- manager, fee gym
  ('00000000-0000-0000-0000-000000031033'), -- awaiting member, fee gym
  ('00000000-0000-0000-0000-000000031034'), -- awaiting member (pay per session), fee gym
  ('00000000-0000-0000-0000-000000031035'), -- settled member, fee gym
  ('00000000-0000-0000-0000-000000031036'), -- member created after a fee change
  ('00000000-0000-0000-0000-000000031041'), -- capped gym member 1
  ('00000000-0000-0000-0000-000000031042'), -- capped gym member 2
  ('00000000-0000-0000-0000-000000031043'); -- capped gym member 3 (rejected)

-- Free-gym staff and members. All created while the fee is 0, so all settled.
insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000031051', '00000000-0000-0000-0000-000000031011', '00000000-0000-0000-0000-000000031021', 'owner',        'RF Owner',        current_date),
  ('00000000-0000-0000-0000-000000031052', '00000000-0000-0000-0000-000000031011', '00000000-0000-0000-0000-000000031022', 'supervisor',   'RF Supervisor',   current_date),
  ('00000000-0000-0000-0000-000000031053', '00000000-0000-0000-0000-000000031011', '00000000-0000-0000-0000-000000031023', 'receptionist', 'RF Receptionist', current_date),
  ('00000000-0000-0000-0000-000000031054', '00000000-0000-0000-0000-000000031011', '00000000-0000-0000-0000-000000031024', 'member',       'RF Active Member',  current_date),
  ('00000000-0000-0000-0000-000000031055', '00000000-0000-0000-0000-000000031011', '00000000-0000-0000-0000-000000031025', 'member',       'RF Expired Member', current_date),
  ('00000000-0000-0000-0000-000000031056', '00000000-0000-0000-0000-000000031011', '00000000-0000-0000-0000-000000031026', 'member',       'RF Grace Member',   current_date),
  ('00000000-0000-0000-0000-000000031057', '00000000-0000-0000-0000-000000031011', '00000000-0000-0000-0000-000000031027', 'member',       'RF Payment Member', current_date);

insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000031061', '00000000-0000-0000-0000-000000031011', 'RF Free Monthly',   'monthly',         15000, 'XAF', 'monthly', 30),
  ('00000000-0000-0000-0000-000000031062', '00000000-0000-0000-0000-000000031012', 'RF Fee Monthly',    'monthly',         15000, 'XAF', 'monthly', 30),
  ('00000000-0000-0000-0000-000000031063', '00000000-0000-0000-0000-000000031012', 'RF Fee PaySession', 'pay_per_session',  2000, 'XAF', 'monthly', null);

-- Existing subscriptions on the free gym, created before the fee is switched on.
insert into subscriptions (id, gym_id, member_id, plan_id, status, start_date, expiry_date, created_at) values
  ('00000000-0000-0000-0000-000000031071', '00000000-0000-0000-0000-000000031011', '00000000-0000-0000-0000-000000031054', '00000000-0000-0000-0000-000000031061', 'active',       current_date - 5,  current_date + 25, now() - interval '5 days'),
  ('00000000-0000-0000-0000-000000031072', '00000000-0000-0000-0000-000000031011', '00000000-0000-0000-0000-000000031055', '00000000-0000-0000-0000-000000031061', 'expired',      current_date - 60, current_date - 30, now() - interval '60 days'),
  ('00000000-0000-0000-0000-000000031073', '00000000-0000-0000-0000-000000031011', '00000000-0000-0000-0000-000000031056', '00000000-0000-0000-0000-000000031061', 'grace_period', current_date - 40, current_date - 10, now() - interval '40 days'),
  ('00000000-0000-0000-0000-000000031074', '00000000-0000-0000-0000-000000031011', '00000000-0000-0000-0000-000000031057', '00000000-0000-0000-0000-000000031061', 'expired',      current_date - 60, current_date - 30, now() - interval '60 days');

-- ============================================================================
-- Insert trigger: free gym settles, staff roles settle, fee gym awaits.
-- ============================================================================
select isnt(
  (select registration_fee_settled_at from members where id = '00000000-0000-0000-0000-000000031054'),
  null,
  'fee 0: a member created in a free gym is settled at creation'
);

select is(
  (select registration_fee from gyms where id = '00000000-0000-0000-0000-000000031011'),
  0,
  'a gym created without a fee has registration_fee 0 (default)'
);

insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000031081', '00000000-0000-0000-0000-000000031012', '00000000-0000-0000-0000-000000031031', 'coach',   'RF Coach',   current_date),
  ('00000000-0000-0000-0000-000000031082', '00000000-0000-0000-0000-000000031012', '00000000-0000-0000-0000-000000031032', 'manager', 'RF Manager', current_date);

-- The inserted value is client-controlled in the statement; the trigger must
-- ignore it. 031083/031084 try to pre-settle themselves.
insert into members (id, gym_id, user_id, role, name, join_date, registration_fee_settled_at) values
  ('00000000-0000-0000-0000-000000031083', '00000000-0000-0000-0000-000000031012', '00000000-0000-0000-0000-000000031033', 'member', 'RF Awaiting Member',   current_date, now()),
  ('00000000-0000-0000-0000-000000031084', '00000000-0000-0000-0000-000000031012', '00000000-0000-0000-0000-000000031034', 'member', 'RF Awaiting PPS Member', current_date, now());

select is(
  (select count(*)::int from members
   where id in ('00000000-0000-0000-0000-000000031081', '00000000-0000-0000-0000-000000031082')
     and registration_fee_settled_at is not null),
  2,
  'fee > 0: coach and manager rows are settled at creation (only role=member can await)'
);

select is(
  (select registration_fee_settled_at from members where id = '00000000-0000-0000-0000-000000031083'),
  null,
  'fee > 0: a new member awaits, and a client-supplied settled value is ignored'
);

-- A settled member of the fee gym: settle via the service role, the way 18.2+ will.
set local role service_role;
insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000031085', '00000000-0000-0000-0000-000000031012', '00000000-0000-0000-0000-000000031035', 'member', 'RF Settled Member', current_date);
update members set registration_fee_settled_at = now() where id = '00000000-0000-0000-0000-000000031085';
reset role;

select isnt(
  (select registration_fee_settled_at from members where id = '00000000-0000-0000-0000-000000031085'),
  null,
  'service_role may write registration_fee_settled_at (the pin covers authenticated/anon only)'
);

select is(
  (select registration_fee_settled_at from members where id = '00000000-0000-0000-0000-000000031083'),
  null,
  'positive control: the service-role UPDATE above touched only its own row'
);

-- ============================================================================
-- Subscription gate.
-- ============================================================================
select throws_ok(
  $$ insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
     values ('00000000-0000-0000-0000-000000031012', '00000000-0000-0000-0000-000000031083', '00000000-0000-0000-0000-000000031062', 'active', current_date, current_date + 30) $$,
  '23514',
  null,
  'gate: a monthly subscription for an awaiting member is rejected'
);

select throws_like(
  $$ insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
     values ('00000000-0000-0000-0000-000000031012', '00000000-0000-0000-0000-000000031083', '00000000-0000-0000-0000-000000031062', 'active', current_date, current_date + 30) $$,
  'registration_fee_not_settled%',
  'gate: the error names registration_fee_not_settled'
);

select throws_like(
  $$ insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
     values ('00000000-0000-0000-0000-000000031012', '00000000-0000-0000-0000-000000031084', '00000000-0000-0000-0000-000000031063', 'active', current_date, null) $$,
  'registration_fee_not_settled%',
  'gate: a pay_per_session subscription for an awaiting member is rejected too'
);

select lives_ok(
  $$ insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
     values ('00000000-0000-0000-0000-000000031012', '00000000-0000-0000-0000-000000031085', '00000000-0000-0000-0000-000000031062', 'active', current_date, current_date + 30) $$,
  'positive control: a settled member of the same fee gym can be given a subscription'
);

-- Same gate through an authenticated manager session, as the dashboard inserts.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031032","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031012","app_role":"manager"}', true);

select throws_like(
  $$ insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
     values ('00000000-0000-0000-0000-000000031012', '00000000-0000-0000-0000-000000031083', '00000000-0000-0000-0000-000000031062', 'active', current_date, current_date + 30) $$,
  'registration_fee_not_settled%',
  'gate: holds for a manager session inserting directly (the dashboard path)'
);
reset role;

-- ============================================================================
-- Cap: awaiting members count toward it, enforcement unchanged.
-- ============================================================================
insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000031091', '00000000-0000-0000-0000-000000031013', '00000000-0000-0000-0000-000000031041', 'member', 'RF Cap 1', current_date),
  ('00000000-0000-0000-0000-000000031092', '00000000-0000-0000-0000-000000031013', '00000000-0000-0000-0000-000000031042', 'member', 'RF Cap 2', current_date);

select is(
  (select count(*)::int from members where gym_id = '00000000-0000-0000-0000-000000031013' and registration_fee_settled_at is null),
  2,
  'cap gym: both members are awaiting'
);

select throws_like(
  $$ insert into members (id, gym_id, user_id, role, name, join_date)
     values ('00000000-0000-0000-0000-000000031093', '00000000-0000-0000-0000-000000031013', '00000000-0000-0000-0000-000000031043', 'member', 'RF Cap 3', current_date) $$,
  'member cap reached%',
  'cap: awaiting members count, so a third member is rejected as today'
);

-- ============================================================================
-- set_registration_fee(): owner and supervisor, audited, members untouched.
-- ============================================================================
create temp table settled_before as
select id, registration_fee_settled_at from members where gym_id = '00000000-0000-0000-0000-000000031011';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031011","app_role":"owner"}', true);

select lives_ok($$ select set_registration_fee(5000) $$, 'owner can set the registration fee');
reset role;

select is(
  (select registration_fee from gyms where id = '00000000-0000-0000-0000-000000031011'),
  5000,
  'set_registration_fee updated the gym column'
);

select is(
  (select metadata from audit_log
   where gym_id = '00000000-0000-0000-0000-000000031011' and action_type = 'registration_fee_changed'
   order by created_at desc limit 1),
  '{"old_amount": 0, "new_amount": 5000}'::jsonb,
  'a registration_fee_changed audit row carries old and new amounts'
);

select is(
  (select count(*)::int from members m join settled_before b using (id)
   where m.registration_fee_settled_at is distinct from b.registration_fee_settled_at),
  0,
  'a fee change touches no existing member'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031011","app_role":"supervisor"}', true);

select lives_ok($$ select set_registration_fee(0) $$, 'supervisor can set the registration fee (back to 0)');
select lives_ok($$ select set_registration_fee(0) $$, 'setting the same amount again is accepted');
reset role;

select is(
  (select count(*)::int from audit_log
   where gym_id = '00000000-0000-0000-0000-000000031011' and action_type = 'registration_fee_changed'),
  2,
  'an unchanged amount writes no audit row (two real changes logged: 0 to 5000, 5000 to 0)'
);

-- Fee on again for the renewal and new-member checks below.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031011","app_role":"owner"}', true);
select set_registration_fee(5000);
reset role;

-- ============================================================================
-- Renewals after the fee change: settled, expired and grace members all renew.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031023","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031011","app_role":"receptionist"}', true);

select lives_ok(
  $$ select renew_subscription('00000000-0000-0000-0000-000000031055', 'Renewal after the fee was switched on') $$,
  'renew_subscription still works for an expired member after fee 0 -> 5000'
);

select lives_ok(
  $$ select confirm_renewal('00000000-0000-0000-0000-000000031056', 'cash', 'Grace member renewal after fee switched on') $$,
  'confirm_renewal still works for a grace_period member after fee 0 -> 5000'
);

select lives_ok(
  $$ select renew_subscription('00000000-0000-0000-0000-000000031054', 'Early renewal of an active member') $$,
  'renew_subscription still works for an active settled member after fee 0 -> 5000'
);
reset role;

insert into payments (id, gym_id, member_id, amount, currency, method, status, provider, provider_transaction_ref)
values ('00000000-0000-0000-0000-000000031101', '00000000-0000-0000-0000-000000031011', '00000000-0000-0000-0000-000000031057', 15000, 'XAF', 'orange_money', 'processing', 'taramoney', 'regfee-test-ref-001');

set local role service_role;
select lives_ok(
  $$ select complete_verified_payment('00000000-0000-0000-0000-000000031101'::uuid, 450) $$,
  'complete_verified_payment still renews a settled member after fee 0 -> 5000'
);
reset role;

select is(
  (select count(*)::int from subscriptions where member_id = '00000000-0000-0000-0000-000000031057'),
  2,
  'positive control: the webhook renewal really inserted a second subscription'
);

-- A member created after the change is awaiting.
insert into members (id, gym_id, user_id, role, name, join_date)
values ('00000000-0000-0000-0000-000000031086', '00000000-0000-0000-0000-000000031011', '00000000-0000-0000-0000-000000031036', 'member', 'RF Post-Change Member', current_date);

select is(
  (select registration_fee_settled_at from members where id = '00000000-0000-0000-0000-000000031086'),
  null,
  'a member created after fee 0 -> 5000 is awaiting; members created before stay settled'
);

select * from finish();
rollback;
