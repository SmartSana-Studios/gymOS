-- Story 6.1 negative privilege contract: private.cleanup_invalid_device_push_token
-- is service_role-only, mirroring subscription_lifecycle_notifications.negative.test.sql's
-- shape for the same kind of server-only-helper guarantee.

begin;
select plan(4);

select ok(not has_function_privilege('authenticated', 'private.cleanup_invalid_device_push_token(text)', 'EXECUTE'), 'authenticated has no EXECUTE grant on private.cleanup_invalid_device_push_token');
select ok(not has_function_privilege('anon', 'private.cleanup_invalid_device_push_token(text)', 'EXECUTE'), 'anon has no EXECUTE grant on private.cleanup_invalid_device_push_token');

set local role authenticated;
select throws_like(
  $$select private.cleanup_invalid_device_push_token('ExponentPushToken[BBB222]')$$,
  '%permission denied%',
  'authenticated cannot execute private.cleanup_invalid_device_push_token()'
);

set local role anon;
select throws_like(
  $$select private.cleanup_invalid_device_push_token('ExponentPushToken[BBB222]')$$,
  '%permission denied%',
  'anon cannot execute private.cleanup_invalid_device_push_token()'
);

reset role;
select * from finish();
rollback;
