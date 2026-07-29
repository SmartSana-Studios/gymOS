-- Story 3.4: Member Check-In & One-Open-Session Enforcement. Tests
-- check_in() (0023_member_check_in_one_open_session_enforcement.sql) -- a
-- SECURITY DEFINER RPC, not a raw RLS-gated INSERT, so most assertions call
-- the function directly under a simulated session rather than asserting on
-- INSERT statements themselves. Session-simulation conventions match
-- manual_renewal_reset.test.sql (`set local role authenticated` +
-- `set_config('request.jwt.claims', ...)`, fixtures seeded up front as the
-- connecting role, `reset role` before asserting on committed table state).

begin;
select plan(34);

-- member_cap 20, not 10: Story 3.9's four new offline-sync fixture members
-- (9055-9058) push Gym A's member count past the original 10.
insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000009001', 'Check-In Test Tier', 5000, 50000, 20);

insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-000000009011', 'Check-In Gym A', '00000000-0000-0000-0000-000000009001', 30),
  ('00000000-0000-0000-0000-000000009012', 'Check-In Gym B', '00000000-0000-0000-0000-000000009001', 30);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000009021'), -- Gym A: fresh member (Task 4, assertions a/b/e)
  ('00000000-0000-0000-0000-000000009022'), -- Gym A: coach (permission-denied)
  ('00000000-0000-0000-0000-000000009023'), -- Gym A: owner (permission-denied)
  ('00000000-0000-0000-0000-000000009024'), -- Gym A: stale-session member (assertion c)
  ('00000000-0000-0000-0000-000000009025'), -- Gym B: fresh member (cross-tenant, assertion f)
  ('00000000-0000-0000-0000-000000009026'), -- Gym A: expired-subscription member (Story 3.8, assertion g)
  ('00000000-0000-0000-0000-000000009027'), -- Gym A: grace_period-subscription member (Story 3.8, assertion h)
  ('00000000-0000-0000-0000-000000009028'), -- Gym A: zero-subscription member (Story 3.8, assertion i)
  ('00000000-0000-0000-0000-000000009029'), -- Gym A: expiring_soon-subscription member (Story 3.8 review, assertion h2)
  ('00000000-0000-0000-0000-000000009030'); -- Gym A: renewed member with an old expired + new active subscription row (Story 3.8 review, assertion j)

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000009041', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009021', 'member', 'Check-In Gym A Fresh Member'),
  ('00000000-0000-0000-0000-000000009042', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009022', 'coach', 'Check-In Gym A Coach'),
  ('00000000-0000-0000-0000-000000009043', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009023', 'owner', 'Check-In Gym A Owner'),
  ('00000000-0000-0000-0000-000000009044', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009024', 'member', 'Check-In Gym A Stale Member'),
  ('00000000-0000-0000-0000-000000009045', '00000000-0000-0000-0000-000000009012', '00000000-0000-0000-0000-000000009025', 'member', 'Check-In Gym B Fresh Member'),
  ('00000000-0000-0000-0000-000000009046', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009026', 'member', 'Check-In Gym A Expired Member'),
  ('00000000-0000-0000-0000-000000009047', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009027', 'member', 'Check-In Gym A Grace Member'),
  ('00000000-0000-0000-0000-000000009048', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009028', 'member', 'Check-In Gym A No-Subscription Member'),
  ('00000000-0000-0000-0000-000000009049', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009029', 'member', 'Check-In Gym A Expiring-Soon Member'),
  ('00000000-0000-0000-0000-000000009050', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009030', 'member', 'Check-In Gym A Renewed Member');

-- Story 3.8: plans + subscriptions fixtures (insert shape follows
-- manual_renewal_reset.test.sql). check_in()'s new guard (0027) means every
-- member expected to check in *successfully* below now needs an
-- active/expiring_soon/grace_period subscription row, not just a bare
-- members row -- the Fresh Member, Stale Member and Gym B Fresh Member
-- fixtures above pre-date this guard and would otherwise be denied as
-- "zero subscription rows" (Scope Note #2's null-status decision).
insert into plans (id, gym_id, name, plan_type, price, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000009061', '00000000-0000-0000-0000-000000009011', 'Check-In Gym A Monthly', 'monthly', 15000, 'monthly', 30),
  ('00000000-0000-0000-0000-000000009062', '00000000-0000-0000-0000-000000009012', 'Check-In Gym B Monthly', 'monthly', 15000, 'monthly', 30);

insert into subscriptions (id, gym_id, member_id, plan_id, status, start_date, expiry_date) values
  ('00000000-0000-0000-0000-000000009071', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009041', '00000000-0000-0000-0000-000000009061', 'active', current_date, current_date + 30),
  ('00000000-0000-0000-0000-000000009072', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009044', '00000000-0000-0000-0000-000000009061', 'active', current_date, current_date + 30),
  ('00000000-0000-0000-0000-000000009073', '00000000-0000-0000-0000-000000009012', '00000000-0000-0000-0000-000000009045', '00000000-0000-0000-0000-000000009062', 'active', current_date, current_date + 30),
  ('00000000-0000-0000-0000-000000009074', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009046', '00000000-0000-0000-0000-000000009061', 'expired', current_date - 40, current_date - 10),
  ('00000000-0000-0000-0000-000000009075', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009047', '00000000-0000-0000-0000-000000009061', 'grace_period', current_date - 40, current_date - 10),
  ('00000000-0000-0000-0000-000000009076', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009049', '00000000-0000-0000-0000-000000009061', 'expiring_soon', current_date - 25, current_date + 5);

-- No-Subscription Member (9048): deliberately zero subscription rows,
-- exercising the null-status branch of the new guard.

-- Renewed Member (9050): two subscription rows -- an old `expired` one and a
-- newer `active` one, with explicit created_at values so ordering is
-- deterministic regardless of statement-local now(). Exercises the "most
-- recent subscription row wins" resolution against the realistic renewal
-- case, not just a single-row fixture.
insert into subscriptions (id, gym_id, member_id, plan_id, status, start_date, expiry_date, created_at) values
  ('00000000-0000-0000-0000-000000009077', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009050', '00000000-0000-0000-0000-000000009061', 'expired', current_date - 90, current_date - 60, now() - interval '90 days'),
  ('00000000-0000-0000-0000-000000009078', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009050', '00000000-0000-0000-0000-000000009061', 'active', current_date - 5, current_date + 25, now() - interval '5 days');

-- Stale Member: an open check-in seeded further in the past than Gym A's
-- checkin_timeout_hours (default 8, unchanged in this fixture -- the
-- "gym's actual configured value" option from Task 4, deterministic since
-- 9 hours always exceeds the 8-hour default).
insert into attendance_events (id, gym_id, member_id, checked_in_at) values
  ('00000000-0000-0000-0000-000000009051', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009044', now() - interval '9 hours');

-- ============================================================================
-- (a) A member-claim session with no open check-in succeeds and inserts
-- exactly one open attendance_events row.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"member"}',
  true
);

select lives_ok(
  $$select check_in()$$,
  'a member-claim session with no open check-in can check in'
);

reset role;

select is(
  (select count(*)::int from attendance_events where member_id = '00000000-0000-0000-0000-000000009041' and checked_out_at is null),
  1,
  'exactly one open attendance_events row exists for the fresh member after check-in'
);

-- ============================================================================
-- (b) The same member checking in again immediately (open, non-stale
-- session) is rejected -- no second row inserted.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"member"}',
  true
);

select throws_like(
  $$select check_in()$$,
  '%already has an open check-in%',
  'a member with an open, non-stale check-in is rejected on a second check-in attempt'
);

reset role;

select is(
  (select count(*)::int from attendance_events where member_id = '00000000-0000-0000-0000-000000009041'),
  1,
  'no second row was inserted for the fresh member after the rejected repeat check-in'
);

-- ============================================================================
-- (c) AC #3: a member with a stale open check-in (older than
-- checkin_timeout_hours) auto-closes the stale row and records a new one,
-- with exactly one audit_log entry for the auto-close.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009024","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"member"}',
  true
);

select lives_ok(
  $$select check_in()$$,
  'a member with a stale open check-in can check in -- the stale session is auto-closed first'
);

reset role;

select is(
  (select checkout_type from attendance_events where id = '00000000-0000-0000-0000-000000009051'),
  'auto',
  'the stale row was auto-closed with checkout_type = auto'
);

select is(
  (select checked_out_at from attendance_events where id = '00000000-0000-0000-0000-000000009051'),
  (select checked_in_at + interval '8 hours' from attendance_events where id = '00000000-0000-0000-0000-000000009051'),
  'the stale row''s checked_out_at is exactly checked_in_at + the gym''s checkin_timeout_hours'
);

select is(
  (select count(*)::int from attendance_events where member_id = '00000000-0000-0000-0000-000000009044' and checked_out_at is null),
  1,
  'a new open attendance_events row now exists for the stale-session member'
);

select is(
  (select count(*)::int from audit_log
   where action_type = 'attendance_stale_check_in_auto_closed'
     and target_entity_id = '00000000-0000-0000-0000-000000009051'),
  1,
  'exactly one audit_log row was written for the auto-closed stale row'
);

-- ============================================================================
-- (d) A coach-claim and an owner-claim session are both denied -- check_in()
-- is member self-service only.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"coach"}',
  true
);

select throws_like(
  $$select check_in()$$,
  '%permission denied%',
  'a coach-claim session cannot call check_in()'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009023","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"owner"}',
  true
);

select throws_like(
  $$select check_in()$$,
  '%permission denied%',
  'an owner-claim session cannot call check_in()'
);

-- ============================================================================
-- (e) The partial unique index itself rejects a second concurrent open row
-- for the same member_id at the raw SQL level, independent of check_in()'s
-- own pre-check -- proves AC #2's literal "enforced via a partial unique
-- index" wording. The fresh member from (a)/(b) still has an open row.
-- ============================================================================
reset role;

select throws_like(
  $$insert into attendance_events (gym_id, member_id) values ('00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009041')$$,
  '%idx_attendance_events_one_open_per_member%',
  'the partial unique index rejects a second open row for the same member_id at the raw SQL level'
);

-- ============================================================================
-- (f) Cross-tenant: a Gym B member-claim session's check_in() call only
-- ever inserts against Gym B's gym_id, never Gym A's, even with fixtures
-- present in both gyms.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009025","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009012","app_role":"member"}',
  true
);

select lives_ok(
  $$select check_in()$$,
  'a Gym B member-claim session can check in'
);

reset role;

select is(
  (select gym_id from attendance_events where member_id = '00000000-0000-0000-0000-000000009045'),
  '00000000-0000-0000-0000-000000009012',
  'the Gym B member''s check-in was recorded against Gym B, not Gym A'
);

-- ============================================================================
-- (g) Story 3.8 AC #3 / FR-031: a member with an expired subscription is
-- rejected by the new guard, and no attendance_events row is inserted.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009026","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"member"}',
  true
);

select throws_like(
  $$select check_in()$$,
  '%subscription is expired%',
  'a member with an expired subscription is rejected on check-in'
);

reset role;

select is(
  (select count(*)::int from attendance_events where member_id = '00000000-0000-0000-0000-000000009046'),
  0,
  'no attendance_events row was inserted for the expired member'
);

-- ============================================================================
-- (h) FR-031 regression guard: a grace_period member must still be accepted
-- -- only null/expired triggers the new guard.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009027","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"member"}',
  true
);

select lives_ok(
  $$select check_in()$$,
  'a member with a grace_period subscription can still check in'
);

reset role;

select is(
  (select count(*)::int from attendance_events where member_id = '00000000-0000-0000-0000-000000009047'),
  1,
  'an attendance_events row was inserted for the grace_period member'
);

-- ============================================================================
-- (h2) FR-031 regression guard: an expiring_soon member must still be
-- accepted -- same guard, other half of "grace/expiring_soon must remain
-- accepted" (Task 5).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009029","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"member"}',
  true
);

select lives_ok(
  $$select check_in()$$,
  'a member with an expiring_soon subscription can still check in'
);

reset role;

select is(
  (select count(*)::int from attendance_events where member_id = '00000000-0000-0000-0000-000000009049'),
  1,
  'an attendance_events row was inserted for the expiring_soon member'
);

-- ============================================================================
-- (i) Story 3.8 Scope Note #2: a member with zero subscription rows at all
-- is treated identically to expired -- denied, no 6th "no plan" UI state.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009028","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"member"}',
  true
);

select throws_like(
  $$select check_in()$$,
  '%subscription is expired%',
  'a member with zero subscription rows is rejected on check-in, same as expired'
);

reset role;

select is(
  (select count(*)::int from attendance_events where member_id = '00000000-0000-0000-0000-000000009048'),
  0,
  'no attendance_events row was inserted for the zero-subscription member'
);

-- ============================================================================
-- (j) Renewal scenario: a member with an old expired subscription row and a
-- newer active row is accepted -- "most recent by created_at" must resolve
-- to the new row, not the old one.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009030","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"member"}',
  true
);

select lives_ok(
  $$select check_in()$$,
  'a renewed member (old expired + new active subscription row) can check in'
);

reset role;

select is(
  (select count(*)::int from attendance_events where member_id = '00000000-0000-0000-0000-000000009050'),
  1,
  'an attendance_events row was inserted for the renewed member'
);

-- ============================================================================
-- Story 3.9: offline-sync fixtures. Fresh members (not reusing (a)-(j)'s
-- fixtures, which already carry open/closed check-in state from earlier
-- assertions) exercising check_in(p_scanned_at, p_client_scan_id).
-- ============================================================================
insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000009031'), -- Gym A: offline-sync, not-stale scan (assertion k)
  ('00000000-0000-0000-0000-000000009032'), -- Gym A: offline-sync, past-timeout scan (assertion l)
  ('00000000-0000-0000-0000-000000009033'), -- Gym A: offline-sync idempotent replay (assertion m)
  ('00000000-0000-0000-0000-000000009034'); -- Gym A: offline-sync, expired subscription (assertion n)

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000009055', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009031', 'member', 'Check-In Gym A Offline Not-Stale Member'),
  ('00000000-0000-0000-0000-000000009056', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009032', 'member', 'Check-In Gym A Offline Stale-Sync Member'),
  ('00000000-0000-0000-0000-000000009057', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009033', 'member', 'Check-In Gym A Offline Idempotent-Replay Member'),
  ('00000000-0000-0000-0000-000000009058', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009034', 'member', 'Check-In Gym A Offline Expired Member');

insert into subscriptions (id, gym_id, member_id, plan_id, status, start_date, expiry_date) values
  ('00000000-0000-0000-0000-000000009079', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009055', '00000000-0000-0000-0000-000000009061', 'active', current_date, current_date + 30),
  ('00000000-0000-0000-0000-000000009080', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009056', '00000000-0000-0000-0000-000000009061', 'active', current_date, current_date + 30),
  ('00000000-0000-0000-0000-000000009081', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009057', '00000000-0000-0000-0000-000000009061', 'active', current_date, current_date + 30),
  ('00000000-0000-0000-0000-000000009082', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009058', '00000000-0000-0000-0000-000000009061', 'expired', current_date - 40, current_date - 10);

-- ============================================================================
-- (k) An offline-sync call within the timeout window: row inserted,
-- checked_in_at equals the passed p_scanned_at (not sync time), checked_out_at
-- still null.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009031","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"member"}',
  true
);

select lives_ok(
  $$select check_in(now() - interval '2 hours', '10000000-0000-0000-0000-000000000001')$$,
  'an offline-sync check-in within the timeout window succeeds'
);

reset role;

select is(
  (select checked_in_at from attendance_events where client_scan_id = '10000000-0000-0000-0000-000000000001'),
  now() - interval '2 hours',
  'checked_in_at equals the passed p_scanned_at, not sync time'
);

select is(
  (select checked_out_at from attendance_events where client_scan_id = '10000000-0000-0000-0000-000000000001'),
  null,
  'checked_out_at is still null -- the timeout has not elapsed since p_scanned_at'
);

-- ============================================================================
-- (l) An offline-sync call past the timeout window: row inserted, but
-- immediately auto-closed at p_scanned_at + checkin_timeout_hours.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009032","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"member"}',
  true
);

select lives_ok(
  $$select check_in(now() - interval '10 hours', '10000000-0000-0000-0000-000000000002')$$,
  'an offline-sync check-in past the timeout window succeeds and is immediately auto-closed'
);

reset role;

select is(
  (select checked_out_at from attendance_events where client_scan_id = '10000000-0000-0000-0000-000000000002'),
  (now() - interval '10 hours') + interval '8 hours',
  'checked_out_at equals p_scanned_at + the gym''s checkin_timeout_hours'
);

select is(
  (select checkout_type from attendance_events where client_scan_id = '10000000-0000-0000-0000-000000000002'),
  'auto',
  'checkout_type is auto for the immediately-stale offline sync'
);

-- ============================================================================
-- (m) Idempotent replay: calling check_in() twice with the same
-- p_client_scan_id, without closing the session in between, must succeed
-- both times and return the same row -- the important case, since the
-- second call's own open session (from the first call) would otherwise be
-- wrongly rejected by the open-session lock block if the short-circuit ran
-- after it instead of before.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009033","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"member"}',
  true
);

create temp table offline_replay_first as
select (check_in(now() - interval '1 hour', '10000000-0000-0000-0000-000000000003')).id as id;

select is(
  (select (check_in(now() - interval '1 hour', '10000000-0000-0000-0000-000000000003')).id),
  (select id from offline_replay_first),
  'replaying check_in() with the same client_scan_id returns the same row (id matches) as the first call, even though the member now has an open check-in from that first call'
);

reset role;

select is(
  (select count(*)::int from attendance_events where client_scan_id = '10000000-0000-0000-0000-000000000003'),
  1,
  'attendance_events has exactly one row for the replayed client_scan_id -- the replay did not insert a second row'
);

drop table offline_replay_first;

-- ============================================================================
-- (n) An expired-subscription member's offline-sync call is rejected the
-- same way the existing online-path assertion (g) expects -- confirms the
-- subscription-status guard's placement (before the insert) applies
-- identically to both call shapes.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009034","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"member"}',
  true
);

select throws_like(
  $$select check_in(now() - interval '1 hour', '10000000-0000-0000-0000-000000000004')$$,
  '%subscription is expired%',
  'an expired-subscription member is rejected on an offline-sync check-in call the same way as the online path'
);

reset role;

select is(
  (select count(*)::int from attendance_events where member_id = '00000000-0000-0000-0000-000000009058'),
  0,
  'no attendance_events row was inserted for the expired member''s offline-sync attempt'
);

select * from finish();
rollback;
