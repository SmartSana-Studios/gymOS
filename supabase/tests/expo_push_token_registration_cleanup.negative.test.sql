-- Negative permission test for private.cleanup_invalid_device_push_token
-- Ensure non-service roles (authenticated) cannot execute the private helper.
-- This test expects the same pgTAP harness used by the project's other tests.

-- Use a lightweight single assertion so the test integrates cleanly with existing suites.

-- Emulate an authenticated session
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000016021","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

-- The call should error with a permission denied (or similar) message
SELECT throws_like(
  $$ SELECT private.cleanup_invalid_device_push_token('ExponentPushToken[BBB222]') $$,
  '%permission denied%',
  'authenticated cannot execute private.cleanup_invalid_device_push_token()'
);

RESET ROLE;
