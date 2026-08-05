-- Story 6.3 negative privilege contract: payment notification transport
-- internals and the new automated failure completion path are server-only,
-- even though service_role/Postgres can operate them.

begin;
select plan(16);

select ok(not has_function_privilege('authenticated', 'private.send_payment_push_notification(uuid,text)', 'EXECUTE'), 'authenticated cannot execute payment push dispatch');
select ok(not has_function_privilege('anon', 'private.send_payment_push_notification(uuid,text)', 'EXECUTE'), 'anon cannot execute payment push dispatch');
select ok(not has_function_privilege('authenticated', 'complete_flagged_payment(uuid)', 'EXECUTE'), 'authenticated cannot execute complete_flagged_payment');
select ok(not has_function_privilege('anon', 'complete_flagged_payment(uuid)', 'EXECUTE'), 'anon cannot execute complete_flagged_payment');

select ok(not has_table_privilege('authenticated', 'private.payment_notification_dispatches', 'SELECT,INSERT,UPDATE,DELETE'), 'authenticated has no payment logical-dispatch table access');
select ok(not has_table_privilege('authenticated', 'private.payment_notification_deliveries', 'SELECT,INSERT,UPDATE,DELETE'), 'authenticated has no payment delivery-ledger table access');
select ok(not has_table_privilege('anon', 'private.payment_notification_dispatches', 'SELECT,INSERT,UPDATE,DELETE'), 'anon has no payment logical-dispatch table access');
select ok(not has_table_privilege('anon', 'private.payment_notification_deliveries', 'SELECT,INSERT,UPDATE,DELETE'), 'anon has no payment delivery-ledger table access');

set local role authenticated;
select throws_like(
  $$select private.send_payment_push_notification('00000000-0000-0000-0000-000000000001', 'N-04')$$,
  '%permission denied%',
  'authenticated cannot forge a payment push call'
);
select throws_like(
  $$select complete_flagged_payment('00000000-0000-0000-0000-000000000001'::uuid)$$,
  '%permission denied%',
  'authenticated cannot forge a payment failure transition'
);
select throws_like($$select private.process_notification_deliveries()$$, '%permission denied%', 'authenticated still cannot invoke the shared server processor');

set local role anon;
select throws_like(
  $$select private.send_payment_push_notification('00000000-0000-0000-0000-000000000001', 'N-04')$$,
  '%permission denied%',
  'anon cannot forge a payment push call'
);
select throws_like(
  $$select complete_flagged_payment('00000000-0000-0000-0000-000000000001'::uuid)$$,
  '%permission denied%',
  'anon cannot forge a payment failure transition'
);
select throws_like($$select private.process_notification_deliveries()$$, '%permission denied%', 'anon still cannot invoke the shared server processor');

reset role;

-- complete_flagged_payment must carry complete_verified_payment's exact
-- trust boundary: unreachable via a real gym-staff (owner) claim too, not
-- just the bare `authenticated` role -- staff must go through the
-- Verification Queue's reviewed UI/audit path, never straight to a "failed"
-- transition.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000000003","app_role":"owner"}',
  true
);
select throws_like(
  $$select complete_flagged_payment('00000000-0000-0000-0000-000000000001'::uuid)$$,
  '%permission denied%',
  'a real gym-staff (owner) claim still cannot execute complete_flagged_payment'
);
reset role;

select is(
  (select count(*)::int from cron.job where jobname = 'notification_delivery_processor'),
  1,
  'sanity: the shared delivery processor cron entry is unaffected by this file'
);

select * from finish();
rollback;
