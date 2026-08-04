-- Story 6.2 negative privilege contract: lifecycle transport internals are
-- server-only even though service_role/Postgres can operate them.

begin;
select plan(12);

select ok(not has_function_privilege('authenticated', 'private.send_push_notification(uuid,text)', 'EXECUTE'), 'authenticated cannot execute lifecycle dispatch');
select ok(not has_function_privilege('anon', 'private.send_push_notification(uuid,text)', 'EXECUTE'), 'anon cannot execute lifecycle dispatch');
select ok(not has_function_privilege('authenticated', 'private.process_notification_deliveries()', 'EXECUTE'), 'authenticated cannot execute the delivery processor');
select ok(not has_function_privilege('anon', 'private.process_notification_deliveries()', 'EXECUTE'), 'anon cannot execute the delivery processor');

select ok(not has_table_privilege('authenticated', 'private.notification_dispatches', 'SELECT,INSERT,UPDATE,DELETE'), 'authenticated has no logical-dispatch table access');
select ok(not has_table_privilege('authenticated', 'private.notification_deliveries', 'SELECT,INSERT,UPDATE,DELETE'), 'authenticated has no delivery-ledger table access');
select ok(not has_table_privilege('anon', 'private.notification_dispatches', 'SELECT,INSERT,UPDATE,DELETE'), 'anon has no logical-dispatch table access');
select ok(not has_table_privilege('anon', 'private.notification_deliveries', 'SELECT,INSERT,UPDATE,DELETE'), 'anon has no delivery-ledger table access');

set local role authenticated;
select throws_like(
  $$select private.send_push_notification('00000000-0000-0000-0000-000000000001', 'N-01')$$,
  '%permission denied%',
  'authenticated cannot forge a lifecycle push call'
);
select throws_like($$select private.process_notification_deliveries()$$, '%permission denied%', 'authenticated cannot invoke the server processor');

set local role anon;
select throws_like(
  $$select private.send_push_notification('00000000-0000-0000-0000-000000000001', 'N-01')$$,
  '%permission denied%',
  'anon cannot forge a lifecycle push call'
);
select throws_like($$select private.process_notification_deliveries()$$, '%permission denied%', 'anon cannot invoke the server processor');

reset role;
select * from finish();
rollback;
