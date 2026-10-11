-- Story 19.2: payments.flagged_reason (migration 0106), positive paths. The
-- denial paths live in flagged_payment_reason.negative.test.sql.
--
-- The payment-webhook Edge Function is not exercised: its confirmation path is
-- simulated by calling complete_verified_payment() / complete_flagged_payment()
-- as service_role, which is exactly what the function's service client does.
--
-- Fixture ids: 00000000-0000-0000-0000-0000001902xx.

begin;
select plan(18);

insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000190280', 'FR Tier', 6000, 60000, null);

insert into gyms (id, name, tier_id, status, registration_fee) values
  ('00000000-0000-0000-0000-000000190291', 'FR Gym', '00000000-0000-0000-0000-000000190280', 'active', 5000);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000001902a1'), -- receptionist
  ('00000000-0000-0000-0000-0000001902c1'),
  ('00000000-0000-0000-0000-0000001902c2'),
  ('00000000-0000-0000-0000-0000001902c3'),
  ('00000000-0000-0000-0000-0000001902c4'),
  ('00000000-0000-0000-0000-0000001902c5'),
  ('00000000-0000-0000-0000-0000001902c6');

insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-0000001902b1', '00000000-0000-0000-0000-000000190291', '00000000-0000-0000-0000-0000001902a1', 'receptionist', 'FR Receptionist', current_date),
  ('00000000-0000-0000-0000-0000001902d1', '00000000-0000-0000-0000-000000190291', '00000000-0000-0000-0000-0000001902c1', 'member', 'FR Member 1', current_date),
  ('00000000-0000-0000-0000-0000001902d2', '00000000-0000-0000-0000-000000190291', '00000000-0000-0000-0000-0000001902c2', 'member', 'FR Member 2', current_date),
  ('00000000-0000-0000-0000-0000001902d3', '00000000-0000-0000-0000-000000190291', '00000000-0000-0000-0000-0000001902c3', 'member', 'FR Member 3', current_date),
  ('00000000-0000-0000-0000-0000001902d4', '00000000-0000-0000-0000-000000190291', '00000000-0000-0000-0000-0000001902c4', 'member', 'FR Member 4', current_date),
  ('00000000-0000-0000-0000-0000001902d5', '00000000-0000-0000-0000-000000190291', '00000000-0000-0000-0000-0000001902c5', 'member', 'FR Member 5', current_date),
  ('00000000-0000-0000-0000-0000001902d6', '00000000-0000-0000-0000-000000190291', '00000000-0000-0000-0000-0000001902c6', 'member', 'FR Member 6', current_date);

-- ============================================================================
-- Expiry: a processing fee row older than ten minutes is flagged as expired.
-- ============================================================================
insert into payments (id, gym_id, member_id, amount, currency, method, status, provider, purpose, created_at) values
  ('00000000-0000-0000-0000-0000001902e1', '00000000-0000-0000-0000-000000190291', '00000000-0000-0000-0000-0000001902d1', 5000, 'XAF', 'mobile_money', 'processing', 'taramoney', 'registration_fee', now() - interval '11 minutes'),
  ('00000000-0000-0000-0000-0000001902e2', '00000000-0000-0000-0000-000000190291', '00000000-0000-0000-0000-0000001902d2', 5000, 'XAF', 'mobile_money', 'processing', 'taramoney', 'registration_fee', now() - interval '2 minutes');

select private.expire_stale_registration_fee_payment('00000000-0000-0000-0000-0000001902d1', '00000000-0000-0000-0000-000000190291');
select private.expire_stale_registration_fee_payment('00000000-0000-0000-0000-0000001902d2', '00000000-0000-0000-0000-000000190291');

select is(
  (select status::text || '/' || flagged_reason from payments where id = '00000000-0000-0000-0000-0000001902e1'),
  'flagged/expired_attempt',
  'an expired fee attempt is flagged with expired_attempt in the same statement'
);

select is(
  (select flagged_reason from payments where id = '00000000-0000-0000-0000-0000001902e2'),
  null,
  'a young processing attempt is untouched and has no reason'
);

-- ============================================================================
-- Late success: the row stays flagged, the reason becomes late_confirmation.
-- ============================================================================
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select lives_ok(
  $$ select complete_verified_payment('00000000-0000-0000-0000-0000001902e1', 100) $$,
  'a late success confirmation runs'
);
reset role;

select is(
  (select status::text || '/' || flagged_reason from payments where id = '00000000-0000-0000-0000-0000001902e1'),
  'flagged/late_confirmation',
  'a late success leaves the row flagged and sets late_confirmation'
);

select is(
  (select count(*)::int from audit_log where action_type = 'registration_fee_late_payment' and metadata ->> 'payment_id' = '00000000-0000-0000-0000-0000001902e1'),
  1,
  'the late-payment audit row is written as before'
);

-- Replay: no second change, no second audit row.
update payments set flagged_reason = 'expired_attempt' where id = '00000000-0000-0000-0000-0000001902e1';
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select complete_verified_payment('00000000-0000-0000-0000-0000001902e1', 100);
reset role;

select is(
  (select flagged_reason from payments where id = '00000000-0000-0000-0000-0000001902e1'),
  'expired_attempt',
  'a replayed late confirmation changes nothing'
);

select is(
  (select count(*)::int from audit_log where action_type = 'registration_fee_late_payment' and metadata ->> 'payment_id' = '00000000-0000-0000-0000-0000001902e1'),
  1,
  'a replayed late confirmation writes no second audit row'
);

-- A late success must not relabel a wrong-account row.
insert into payments (id, gym_id, member_id, amount, currency, method, status, provider, purpose, flagged_reason) values
  ('00000000-0000-0000-0000-0000001902e7', '00000000-0000-0000-0000-000000190291', '00000000-0000-0000-0000-0000001902d5', 5000, 'XAF', 'mobile_money', 'flagged', 'taramoney', 'registration_fee', 'wrong_account');

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select complete_verified_payment('00000000-0000-0000-0000-0000001902e7', 100);
reset role;

select is(
  (select flagged_reason from payments where id = '00000000-0000-0000-0000-0000001902e7'),
  'wrong_account',
  'a late success does not relabel a wrong_account row'
);

select is(
  (select count(*)::int from audit_log where action_type = 'registration_fee_late_payment' and metadata ->> 'payment_id' = '00000000-0000-0000-0000-0000001902e7'),
  1,
  'the late-payment audit trace is still written for a wrong_account row'
);

-- ============================================================================
-- Provider decline.
-- ============================================================================
insert into payments (id, gym_id, member_id, amount, currency, method, status, provider, purpose) values
  ('00000000-0000-0000-0000-0000001902e3', '00000000-0000-0000-0000-000000190291', '00000000-0000-0000-0000-0000001902d3', 5000, 'XAF', 'mobile_money', 'processing', 'taramoney', 'registration_fee');

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select complete_flagged_payment('00000000-0000-0000-0000-0000001902e3');
reset role;

select is(
  (select status::text || '/' || flagged_reason from payments where id = '00000000-0000-0000-0000-0000001902e3'),
  'flagged/provider_declined',
  'a provider decline flags the row with provider_declined'
);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select complete_flagged_payment('00000000-0000-0000-0000-0000001902e3');
reset role;

select is(
  (select flagged_reason from payments where id = '00000000-0000-0000-0000-0000001902e3'),
  'provider_declined',
  'a second decline is a no-op'
);

-- ============================================================================
-- Subscription payments: a decline flags with the same reason, no other change.
-- ============================================================================
insert into payments (id, gym_id, member_id, amount, currency, method, status, provider, purpose) values
  ('00000000-0000-0000-0000-0000001902e4', '00000000-0000-0000-0000-000000190291', '00000000-0000-0000-0000-0000001902d4', 15000, 'XAF', 'mobile_money', 'processing', 'taramoney', 'subscription');

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select complete_flagged_payment('00000000-0000-0000-0000-0000001902e4');
reset role;

select is(
  (select status::text || '/' || flagged_reason from payments where id = '00000000-0000-0000-0000-0000001902e4'),
  'flagged/provider_declined',
  'a declined subscription payment is flagged with provider_declined'
);

-- ============================================================================
-- Staff flag: pending -> flagged under a staff session forces staff_flagged,
-- whatever reason the client tries to write.
-- ============================================================================
insert into payments (id, gym_id, member_id, amount, currency, method, status, purpose) values
  ('00000000-0000-0000-0000-0000001902e5', '00000000-0000-0000-0000-000000190291', '00000000-0000-0000-0000-0000001902d5', 15000, 'XAF', 'cash', 'pending', 'subscription'),
  ('00000000-0000-0000-0000-0000001902e6', '00000000-0000-0000-0000-000000190291', '00000000-0000-0000-0000-0000001902d6', 15000, 'XAF', 'cash', 'pending', 'subscription');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001902a1","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000190291","app_role":"receptionist"}', true);
update payments set status = 'flagged' where id = '00000000-0000-0000-0000-0000001902e5';
update payments set status = 'flagged', flagged_reason = 'wrong_account' where id = '00000000-0000-0000-0000-0000001902e6';
reset role;

select is(
  (select status::text || '/' || flagged_reason from payments where id = '00000000-0000-0000-0000-0000001902e5'),
  'flagged/staff_flagged',
  'a staff Flag for Review sets staff_flagged'
);

select is(
  (select status::text || '/' || flagged_reason from payments where id = '00000000-0000-0000-0000-0000001902e6'),
  'flagged/staff_flagged',
  'a reason written by the client in the same UPDATE is overridden by staff_flagged'
);

-- ============================================================================
-- CHECK shape: one-directional.
-- ============================================================================
select lives_ok(
  $$ update payments set flagged_reason = 'late_confirmation' where id = '00000000-0000-0000-0000-0000001902e2' $$,
  'a non-flagged row may carry a reason (Story 19.5 puts late_confirmation on a verified payment)'
);

select is(
  (select count(*)::int from payments where status = 'flagged' and flagged_reason is null),
  0,
  'no flagged payment lacks a reason'
);

-- ============================================================================
-- Backfill: the statement of migration 0106, run against rows that look like
-- pre-0106 data (the requires-reason CHECK dropped for this transaction only).
-- ============================================================================
alter table payments drop constraint payments_flagged_requires_reason;

insert into payments (id, gym_id, member_id, amount, currency, method, status, purpose, flagged_reason) values
  ('00000000-0000-0000-0000-0000001902f1', '00000000-0000-0000-0000-000000190291', '00000000-0000-0000-0000-0000001902d1', 5000, 'XAF', 'mobile_money', 'flagged', 'subscription', null),
  ('00000000-0000-0000-0000-0000001902f2', '00000000-0000-0000-0000-000000190291', '00000000-0000-0000-0000-0000001902d1', 5000, 'XAF', 'mobile_money', 'flagged', 'subscription', null),
  ('00000000-0000-0000-0000-0000001902f3', '00000000-0000-0000-0000-000000190291', '00000000-0000-0000-0000-0000001902d1', 5000, 'XAF', 'mobile_money', 'flagged', 'subscription', null),
  ('00000000-0000-0000-0000-0000001902f4', '00000000-0000-0000-0000-000000190291', '00000000-0000-0000-0000-0000001902d1', 5000, 'XAF', 'mobile_money', 'flagged', 'registration_fee', null),
  ('00000000-0000-0000-0000-0000001902f5', '00000000-0000-0000-0000-000000190291', '00000000-0000-0000-0000-0000001902d1', 5000, 'XAF', 'mobile_money', 'flagged', 'registration_fee', null),
  ('00000000-0000-0000-0000-0000001902f6', '00000000-0000-0000-0000-000000190291', '00000000-0000-0000-0000-0000001902d1', 5000, 'XAF', 'mobile_money', 'flagged', 'subscription', null);

insert into payment_discrepancies (payment_id, gym_id, discrepancy_type, details)
values ('00000000-0000-0000-0000-0000001902f1', '00000000-0000-0000-0000-000000190291', 'wrong_account_settlement', '{}'::jsonb);

select log_audit_event(
  p_action_type => 'payment_flagged',
  p_gym_id => '00000000-0000-0000-0000-000000190291',
  p_target_entity_id => '00000000-0000-0000-0000-0000001902f2',
  p_target_entity_type => 'payment',
  p_metadata => '{}'::jsonb,
  p_system_actor_label => 'test'
);

select log_audit_event(p_action_type => 'registration_fee_late_payment', p_gym_id => '00000000-0000-0000-0000-000000190291', p_target_entity_id => '00000000-0000-0000-0000-0000001902d1', p_target_entity_type => 'member', p_metadata => jsonb_build_object('payment_id', '00000000-0000-0000-0000-0000001902f4'), p_system_actor_label => 'test');
select log_audit_event(p_action_type => 'registration_fee_attempt_expired', p_gym_id => '00000000-0000-0000-0000-000000190291', p_target_entity_id => '00000000-0000-0000-0000-0000001902d1', p_target_entity_type => 'member', p_metadata => jsonb_build_object('payment_id', '00000000-0000-0000-0000-0000001902f5'), p_system_actor_label => 'test');
select log_audit_event(p_action_type => 'payment_verification_failed', p_gym_id => '00000000-0000-0000-0000-000000190291', p_target_entity_id => '00000000-0000-0000-0000-0000001902d1', p_target_entity_type => 'member', p_metadata => jsonb_build_object('payment_id', '00000000-0000-0000-0000-0000001902f6'), p_system_actor_label => 'test');

update payments p
set flagged_reason = case
  when exists (select 1 from payment_discrepancies d where d.payment_id = p.id and d.discrepancy_type = 'wrong_account_settlement') then 'wrong_account'
  when exists (select 1 from audit_log a where a.action_type = 'registration_fee_late_payment' and a.metadata ->> 'payment_id' = p.id::text) then 'late_confirmation'
  when exists (select 1 from audit_log a where a.action_type = 'registration_fee_attempt_expired' and a.metadata ->> 'payment_id' = p.id::text) then 'expired_attempt'
  when exists (select 1 from audit_log a where a.action_type = 'payment_verification_failed' and a.metadata ->> 'payment_id' = p.id::text) then 'provider_declined'
  when exists (select 1 from audit_log a where a.action_type = 'payment_flagged' and a.target_entity_id = p.id::text) then 'staff_flagged'
  else 'reconciliation_mismatch'
end
where p.status = 'flagged' and p.flagged_reason is null;

select is(
  (select array_agg(flagged_reason order by id) from payments where id in (
     '00000000-0000-0000-0000-0000001902f1', '00000000-0000-0000-0000-0000001902f2', '00000000-0000-0000-0000-0000001902f3', '00000000-0000-0000-0000-0000001902f4', '00000000-0000-0000-0000-0000001902f5', '00000000-0000-0000-0000-0000001902f6')),
  array['wrong_account', 'staff_flagged', 'reconciliation_mismatch', 'late_confirmation', 'expired_attempt', 'provider_declined'],
  'backfill: every evidence branch yields its reason, no evidence -> reconciliation_mismatch'
);

select is(
  (select count(*)::int from payments where status = 'flagged' and flagged_reason is null),
  0,
  'backfill leaves no flagged row without a reason'
);

select * from finish();
rollback;
