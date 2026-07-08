-- AC #1/#2: "no role -- including Super Admin and service_role -- has UPDATE or
-- DELETE grants on it, enforced at the grant level beneath RLS" / "any migration,
-- script, or application code that attempts an UPDATE or DELETE... fails."
--
-- The critical distinction this file tests: service_role bypasses RLS entirely in
-- Supabase (BYPASSRLS), so a test that only proved RLS blocks UPDATE/DELETE would
-- pass for the wrong reason and miss a service_role bypass entirely. Every
-- UPDATE/DELETE assertion below must fail with "permission denied" (the grant-level
-- REVOKE), not a row-count-filtered no-op -- that is what "beneath RLS" means and
-- is the actual thing this migration adds beyond RLS alone.
--
-- Also covers AC #3 (record shape) via log_audit_event(), the canonical write path
-- (0007_audit_log.sql): both the system/no-session case (actor_id null, caller-
-- supplied label) and the authenticated-session case (actor derived from auth.uid(),
-- never caller-supplied).

begin;
select plan(17);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000000004', 'Hustle', 5000, 50000, 30);

insert into gyms (id, name, tier_id, capacity)
values ('00000000-0000-0000-0000-0000000000e1', 'Audit Gym', '00000000-0000-0000-0000-000000000004', 30);

-- Seeded as postgres (default role, before any jwt claims are set) -- auth.uid()
-- is null at this point, which is exactly the pg_cron/system-caller scenario.
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000e2');
update public.users set display_name = 'Real Display Name' where id = '00000000-0000-0000-0000-0000000000e2';

-- ---------------------------------------------------------------------------
-- log_audit_event(): system/no-session caller (no request.jwt.claims set at all)
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select log_audit_event('job_failure', null, null, null, '{}'::jsonb, 'system:subscription_lifecycle_cron') $$,
  'log_audit_event() succeeds for a system caller with no session'
);

select is(
  (select actor_id from audit_log where action_type = 'job_failure'),
  null,
  'system-caller record has a null actor_id (no auth.uid() session to derive one from)'
);

select is(
  (select actor_display_name from audit_log where action_type = 'job_failure'),
  'system:subscription_lifecycle_cron',
  'system-caller record uses the caller-supplied label as actor_display_name'
);

select is(
  (select metadata from audit_log where action_type = 'job_failure'),
  '{}'::jsonb,
  'metadata defaults to {} when omitted'
);

-- action_type is a genuine required field -- log_audit_event deliberately does NOT
-- swallow this the way private.gym_id()/custom_access_token_hook swallow their own
-- expected-failure cases (see 0007's comment on why): a null action_type is a
-- caller bug that must surface immediately, not silently produce no audit record.
select throws_like(
  $$ select log_audit_event(null) $$,
  '%not-null constraint%',
  'log_audit_event() raises (not-null violation) rather than silently swallowing a missing action_type'
);

-- ---------------------------------------------------------------------------
-- log_audit_event(): authenticated session -- actor derived from auth.uid(),
-- never caller-supplied (spoofing prevention)
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}',
  true
);

select isnt(
  log_audit_event('member_deactivated', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e3', 'members', '{"reason":"test"}'::jsonb),
  null,
  'log_audit_event() returns a non-null id for an authenticated caller'
);

-- Switch back to a role that can read past deny-all RLS to inspect the row --
-- authenticated cannot SELECT audit_log at all (zero read policies, by design).
reset role;

select is(
  (select actor_id from audit_log where action_type = 'member_deactivated'),
  '00000000-0000-0000-0000-0000000000e2'::uuid,
  'authenticated-session record''s actor_id is derived from auth.uid(), matching the session'
);

select is(
  (select actor_display_name from audit_log where action_type = 'member_deactivated'),
  'Real Display Name',
  'authenticated-session record''s actor_display_name is looked up from public.users, not caller-supplied'
);

select is(
  (select gym_id from audit_log where action_type = 'member_deactivated'),
  '00000000-0000-0000-0000-0000000000e1'::uuid,
  'gym_id passes through as given'
);

-- ---------------------------------------------------------------------------
-- Regression: a real session whose users.display_name happens to be NULL
-- (nullable column, never set) must still keep actor_id populated -- an
-- earlier draft of log_audit_event() incorrectly nulled actor_id whenever
-- display_name resolved to NULL, misattributing a genuine user's action to
-- "system" purely because their profile was incomplete. Fixed before this
-- story's first commit; kept here so it can't silently regress.
-- ---------------------------------------------------------------------------

insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000e4');
-- Deliberately no `update public.users set display_name = ...` for this user.

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000e4","role":"authenticated"}',
  true
);

select isnt(
  log_audit_event('coach_assignment_changed'),
  null,
  'log_audit_event() succeeds for a session whose users.display_name is NULL'
);

reset role;

select is(
  (select actor_id from audit_log where action_type = 'coach_assignment_changed'),
  '00000000-0000-0000-0000-0000000000e4'::uuid,
  'actor_id stays populated even when the session user has no display_name set (the bug this regression test guards)'
);

select is(
  (select actor_display_name from audit_log where action_type = 'coach_assignment_changed'),
  'Unknown User',
  'actor_display_name falls back to a generic label, not the system:<action_type> label, for a real session with no display_name'
);

-- ---------------------------------------------------------------------------
-- Append-only enforcement at the grant level (the actual point of this story)
-- ---------------------------------------------------------------------------

-- Explicit role switch: `reset role` above returned us to the connecting
-- session's default role (postgres, a superuser that trivially bypasses every
-- grant check) -- this test is meaningless unless it actually runs as
-- service_role, since postgres inserting proves nothing about service_role's
-- own table grant.
set local role service_role;

select lives_ok(
  $$ insert into audit_log (actor_display_name, action_type) values ('Direct Insert', 'test_direct_insert') $$,
  'service_role can INSERT into audit_log directly (table grant + RLS bypass)'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}',
  true
);

select throws_like(
  $$ insert into audit_log (actor_display_name, action_type) values ('Sneaky Insert', 'test_sneaky_insert') $$,
  '%row-level security%',
  'authenticated cannot INSERT into audit_log directly, bypassing log_audit_event() -- blocked by RLS (no INSERT policy)'
);

select throws_like(
  $$ update audit_log set action_type = 'tampered' where true $$,
  '%permission denied%',
  'authenticated UPDATE on audit_log fails at the grant level (permission denied, not RLS-filtered)'
);

set local role service_role;

select throws_like(
  $$ update audit_log set action_type = 'tampered' where true $$,
  '%permission denied%',
  'service_role UPDATE on audit_log fails at the grant level -- service_role bypasses RLS but NOT the grant-level REVOKE, which is the whole point of AC #1'
);

select throws_like(
  $$ delete from audit_log where true $$,
  '%permission denied%',
  'service_role DELETE on audit_log fails at the grant level for the same reason'
);

select * from finish();
rollback;
