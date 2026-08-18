-- Story 6.5 negative privilege contract: quiet-gym-alert transport internals
-- and the dispatch job are server-only, even though service_role/Postgres
-- can operate them. Mirrors payment_notifications.negative.test.sql's shape;
-- asserts each privilege individually rather than a comma-joined any-of check.

begin;
select plan(15);

select ok(not has_function_privilege('authenticated', 'private.send_quiet_gym_alert(uuid,uuid)', 'EXECUTE'), 'authenticated cannot execute the quiet-gym-alert push dispatch');
select ok(not has_function_privilege('anon', 'private.send_quiet_gym_alert(uuid,uuid)', 'EXECUTE'), 'anon cannot execute the quiet-gym-alert push dispatch');
select ok(not has_function_privilege('authenticated', 'private.gym_occupancy_band(uuid)', 'EXECUTE'), 'authenticated cannot execute the internal occupancy-band helper');
select ok(not has_function_privilege('anon', 'private.gym_occupancy_band(uuid)', 'EXECUTE'), 'anon cannot execute the internal occupancy-band helper');
select ok(not has_function_privilege('authenticated', 'run_quiet_gym_alert_job()', 'EXECUTE'), 'authenticated cannot execute the dispatch job');
select ok(not has_function_privilege('anon', 'run_quiet_gym_alert_job()', 'EXECUTE'), 'anon cannot execute the dispatch job');

select ok(not has_table_privilege('authenticated', 'private.quiet_gym_alert_dispatches', 'SELECT,INSERT,UPDATE,DELETE'), 'authenticated has no quiet-gym-alert dispatch table access');
select ok(not has_table_privilege('authenticated', 'private.quiet_gym_alert_deliveries', 'SELECT,INSERT,UPDATE,DELETE'), 'authenticated has no quiet-gym-alert delivery table access');
select ok(not has_table_privilege('anon', 'private.quiet_gym_alert_dispatches', 'SELECT,INSERT,UPDATE,DELETE'), 'anon has no quiet-gym-alert dispatch table access');
select ok(not has_table_privilege('anon', 'private.quiet_gym_alert_deliveries', 'SELECT,INSERT,UPDATE,DELETE'), 'anon has no quiet-gym-alert delivery table access');

set local role authenticated;
select throws_like(
  $$select private.send_quiet_gym_alert('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002')$$,
  '%permission denied%',
  'authenticated cannot forge a quiet-gym-alert push call'
);
select throws_like(
  $$select run_quiet_gym_alert_job()$$,
  '%permission denied%',
  'authenticated cannot forge a run of the dispatch job'
);
select throws_like(
  $$select private.gym_occupancy_band('00000000-0000-0000-0000-000000000001')$$,
  '%permission denied%',
  'authenticated cannot call the internal occupancy-band helper directly'
);
reset role;

set local role anon;
select throws_like(
  $$select private.send_quiet_gym_alert('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002')$$,
  '%permission denied%',
  'anon cannot forge a quiet-gym-alert push call'
);
select throws_like(
  $$select run_quiet_gym_alert_job()$$,
  '%permission denied%',
  'anon cannot forge a run of the dispatch job'
);
reset role;

select * from finish();
rollback;
