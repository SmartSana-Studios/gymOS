-- Story 6.6 negative privilege contract: class-reminder transport internals
-- and the dispatch job are server-only, even though service_role/Postgres
-- can operate them. Mirrors quiet_gym_alerts.negative.test.sql's shape;
-- asserts each privilege individually rather than a comma-joined any-of check.

begin;
select plan(12);

select ok(not has_function_privilege('authenticated', 'private.send_class_reminder(uuid,uuid)', 'EXECUTE'), 'authenticated cannot execute the class-reminder push dispatch');
select ok(not has_function_privilege('anon', 'private.send_class_reminder(uuid,uuid)', 'EXECUTE'), 'anon cannot execute the class-reminder push dispatch');
select ok(not has_function_privilege('authenticated', 'run_class_reminder_job()', 'EXECUTE'), 'authenticated cannot execute the dispatch job');
select ok(not has_function_privilege('anon', 'run_class_reminder_job()', 'EXECUTE'), 'anon cannot execute the dispatch job');

select ok(not has_table_privilege('authenticated', 'private.class_reminder_dispatches', 'SELECT,INSERT,UPDATE,DELETE'), 'authenticated has no class-reminder dispatch table access');
select ok(not has_table_privilege('authenticated', 'private.class_reminder_deliveries', 'SELECT,INSERT,UPDATE,DELETE'), 'authenticated has no class-reminder delivery table access');
select ok(not has_table_privilege('anon', 'private.class_reminder_dispatches', 'SELECT,INSERT,UPDATE,DELETE'), 'anon has no class-reminder dispatch table access');
select ok(not has_table_privilege('anon', 'private.class_reminder_deliveries', 'SELECT,INSERT,UPDATE,DELETE'), 'anon has no class-reminder delivery table access');

set local role authenticated;
select throws_like(
  $$select private.send_class_reminder('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002')$$,
  '%permission denied%',
  'authenticated cannot forge a class-reminder push call'
);
select throws_like(
  $$select run_class_reminder_job()$$,
  '%permission denied%',
  'authenticated cannot forge a run of the dispatch job'
);
reset role;

set local role anon;
select throws_like(
  $$select private.send_class_reminder('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002')$$,
  '%permission denied%',
  'anon cannot forge a class-reminder push call'
);
select throws_like(
  $$select run_class_reminder_job()$$,
  '%permission denied%',
  'anon cannot forge a run of the dispatch job'
);
reset role;

select * from finish();
rollback;
