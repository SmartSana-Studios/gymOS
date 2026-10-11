-- Story 19.2: payments.flagged_reason (migration 0106), denial paths. Every
-- denial is paired with a positive control. Positive paths:
-- flagged_payment_reason.test.sql.
--
-- Fixture ids: 00000000-0000-0000-0000-0000001903xx.

begin;
select plan(13);

insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000190380', 'FRN Tier', 6000, 60000, null);

insert into gyms (id, name, tier_id, status) values
  ('00000000-0000-0000-0000-000000190391', 'FRN Gym', '00000000-0000-0000-0000-000000190380', 'active');

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000001903a1'), -- receptionist
  ('00000000-0000-0000-0000-0000001903c1');

insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-0000001903b1', '00000000-0000-0000-0000-000000190391', '00000000-0000-0000-0000-0000001903a1', 'receptionist', 'FRN Receptionist', current_date),
  ('00000000-0000-0000-0000-0000001903d1', '00000000-0000-0000-0000-000000190391', '00000000-0000-0000-0000-0000001903c1', 'member', 'FRN Member', current_date);

insert into payments (id, gym_id, member_id, amount, currency, method, status, purpose, flagged_reason) values
  ('00000000-0000-0000-0000-0000001903e1', '00000000-0000-0000-0000-000000190391', '00000000-0000-0000-0000-0000001903d1', 15000, 'XAF', 'cash', 'pending', 'subscription', null),
  ('00000000-0000-0000-0000-0000001903e2', '00000000-0000-0000-0000-000000190391', '00000000-0000-0000-0000-0000001903d1', 15000, 'XAF', 'cash', 'flagged', 'subscription', 'wrong_account'),
  ('00000000-0000-0000-0000-0000001903e3', '00000000-0000-0000-0000-000000190391', '00000000-0000-0000-0000-0000001903d1', 15000, 'XAF', 'cash', 'processing', 'subscription', null);

-- ============================================================================
-- Forge attempt: a staff session cannot write flagged_reason.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001903a1","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000190391","app_role":"receptionist"}', true);

select throws_ok(
  $$ update payments set flagged_reason = 'late_confirmation' where id = '00000000-0000-0000-0000-0000001903e1' $$,
  '42501',
  null,
  'a staff UPDATE that only writes flagged_reason is refused by the verify policy'
);
update payments set flagged_reason = 'late_confirmation' where id = '00000000-0000-0000-0000-0000001903e2';
reset role;

select is(
  (select flagged_reason from payments where id = '00000000-0000-0000-0000-0000001903e1'),
  null,
  'the refused forge attempt left the pending row without a reason'
);

select is(
  (select flagged_reason from payments where id = '00000000-0000-0000-0000-0000001903e2'),
  'wrong_account',
  'a staff UPDATE of flagged_reason on a flagged row leaves wrong_account in place'
);

-- Positive control: the same session flags the pending row, reason forced.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001903a1","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000190391","app_role":"receptionist"}', true);
update payments set status = 'flagged', flagged_reason = 'late_confirmation' where id = '00000000-0000-0000-0000-0000001903e1';
reset role;

select is(
  (select flagged_reason from payments where id = '00000000-0000-0000-0000-0000001903e1'),
  'staff_flagged',
  'positive control: the staff session''s own flag landed with staff_flagged, not the forged value'
);

-- A client INSERT cannot create a row that already carries a reason.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001903a1","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000190391","app_role":"receptionist"}', true);
insert into payments (id, gym_id, member_id, amount, currency, method, status, purpose, flagged_reason)
values ('00000000-0000-0000-0000-0000001903e4', '00000000-0000-0000-0000-000000190391', '00000000-0000-0000-0000-0000001903d1', 15000, 'XAF', 'cash', 'pending', 'subscription', 'late_confirmation');
reset role;

select is(
  (select status::text || '/' || coalesce(flagged_reason, 'none') from payments where id = '00000000-0000-0000-0000-0000001903e4'),
  'pending/none',
  'a staff INSERT that supplies flagged_reason is stored without it'
);

-- ============================================================================
-- Anonymous: no UPDATE reaches the table.
-- ============================================================================
set local role anon;
select throws_ok(
  $$ update payments set flagged_reason = 'late_confirmation' where id = '00000000-0000-0000-0000-0000001903e2' $$,
  '42501',
  null,
  'anon cannot update payments'
);
reset role;

-- ============================================================================
-- Bad value and missing reason: rejected by the CHECKs for every writer.
-- ============================================================================
select throws_ok(
  $$ update payments set flagged_reason = 'because' where id = '00000000-0000-0000-0000-0000001903e2' $$,
  '23514',
  null,
  'a code outside the closed set is rejected'
);

select lives_ok(
  $$ update payments set flagged_reason = 'provider_declined' where id = '00000000-0000-0000-0000-0000001903e2' $$,
  'positive control: a code inside the set is accepted'
);

select throws_ok(
  $$ update payments set status = 'flagged' where id = '00000000-0000-0000-0000-0000001903e3' $$,
  '23514',
  null,
  'flagging without a reason is rejected (server paths must name theirs)'
);

select throws_ok(
  $$ insert into payments (gym_id, member_id, amount, currency, method, status, purpose)
     values ('00000000-0000-0000-0000-000000190391', '00000000-0000-0000-0000-0000001903d1', 1, 'XAF', 'cash', 'flagged', 'subscription') $$,
  '23514',
  null,
  'inserting a flagged row without a reason is rejected'
);

-- ============================================================================
-- Function privileges: the webhook completion functions are service_role only.
-- ============================================================================
select is(
  (select bool_or(has_function_privilege(r, 'public.complete_flagged_payment(uuid)', 'EXECUTE'))
   from unnest(array['anon', 'authenticated']) r),
  false,
  'complete_flagged_payment is not executable by anon or authenticated'
);

select is(
  (select bool_or(has_function_privilege(r, 'public.complete_verified_payment(uuid,integer)', 'EXECUTE'))
   from unnest(array['anon', 'authenticated']) r),
  false,
  'complete_verified_payment is not executable by anon or authenticated'
);

select is(
  (select has_function_privilege('anon', 'private.expire_stale_registration_fee_payment(uuid,uuid)', 'EXECUTE')),
  false,
  'the expiry helper is not executable by anon'
);

select * from finish();
rollback;
