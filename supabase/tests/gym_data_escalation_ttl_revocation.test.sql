-- Story 1.15: Escalation Grant Expiry & Revocation. Covers the lifecycle
-- 0085_escalation_grant_expiry_and_revocation.sql gives the Story 1.7 grant:
-- a 24-hour TTL, manual revocation by any Super Admin, and re-escalation
-- after revocation. The plain "an escalated Super Admin can read this gym's
-- members/payments" case still lives in gym_data_escalation_rls.test.sql --
-- this file only asserts what changes once a grant can lapse or be revoked.
--
-- Session-simulation conventions copied from gym_data_escalation_rls.test.sql
-- (all fixtures seeded as the connecting role before any `set local role
-- authenticated`; `reset role` before inspecting committed state, matching
-- staff_creation_role_ceiling_enforcement.test.sql).
--
-- Each grant STATE gets its own actor rather than mutating one actor's rows
-- mid-transaction: private.has_active_gym_data_escalation() is an EXISTS over
-- all of an actor's rows for a gym, so an actor holding both an expired and
-- an active grant is a genuinely different case (that one is X4, the
-- re-escalation case, and it is asserted deliberately -- not by accident).
--
-- Expired/revoked fixtures are seeded by direct INSERT with explicit
-- expires_at/revoked_at values rather than round-tripping the RPCs (same
-- fixture-seeding precedent gym_data_escalation_rls.test.sql sets): the RPCs
-- can only ever write `now() + 24h` and `revoked_at = now()`, so a lapsed
-- grant is not reachable through them at all without waiting a day.

begin;
select plan(40);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000085001', 'Escalation TTL Test Tier', 5000, 50000, 30);

insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-000000085011', 'Escalation TTL Gym A', '00000000-0000-0000-0000-000000085001', 30),
  ('00000000-0000-0000-0000-000000085012', 'Escalation TTL Gym B', '00000000-0000-0000-0000-000000085001', 30);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000085021'), -- X1: active grant on Gym A
  ('00000000-0000-0000-0000-000000085022'), -- X2: EXPIRED grant on Gym A
  ('00000000-0000-0000-0000-000000085023'), -- X3: REVOKED grant on Gym A (still inside its window)
  ('00000000-0000-0000-0000-000000085024'), -- X4: revoked grant + a fresh one (re-escalation, AC #5)
  ('00000000-0000-0000-0000-000000085025'), -- X5: active grant on Gym B only
  ('00000000-0000-0000-0000-000000085026'), -- B:  the revoking Super Admin (holds no grant of its own)
  ('00000000-0000-0000-0000-000000085027'), -- Gym A owner (non-super-admin, for the RPC permission check)
  ('00000000-0000-0000-0000-000000085028'), -- Gym A coach (the row escalated access reveals)
  ('00000000-0000-0000-0000-000000085029'), -- Gym B coach
  ('00000000-0000-0000-0000-000000085061'), -- X6: a LEGACY bare audit_log row ONLY, no grant row (AC #7)
  ('00000000-0000-0000-0000-000000085062'); -- X7: escalates through the RPC itself (its success path)

-- handle_new_user() (0003) already created the public.users rows above; give
-- the revoking admin a real display_name so the audit row's denormalized
-- actor_display_name is asserted against something meaningful rather than
-- log_audit_event()'s 'Unknown User' fallback.
update users set display_name = 'Super Admin B'
where id = '00000000-0000-0000-0000-000000085026';

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000085031', '00000000-0000-0000-0000-000000085011', '00000000-0000-0000-0000-000000085027', 'owner', 'TTL Gym A Owner'),
  ('00000000-0000-0000-0000-000000085032', '00000000-0000-0000-0000-000000085011', '00000000-0000-0000-0000-000000085028', 'coach', 'TTL Gym A Coach'),
  ('00000000-0000-0000-0000-000000085033', '00000000-0000-0000-0000-000000085012', '00000000-0000-0000-0000-000000085029', 'coach', 'TTL Gym B Coach');

insert into payments (id, gym_id, member_id, amount, method, status) values
  ('00000000-0000-0000-0000-000000085041', '00000000-0000-0000-0000-000000085011', '00000000-0000-0000-0000-000000085032', 5000, 'cash', 'verified'),
  ('00000000-0000-0000-0000-000000085042', '00000000-0000-0000-0000-000000085012', '00000000-0000-0000-0000-000000085033', 5000, 'cash', 'verified');

-- X6: a LEGACY grant, in the pre-0085 shape -- a bare 'gym_data_escalation'
-- audit_log row and NOTHING ELSE. No gym_data_escalations row exists for this
-- actor, which is exactly the state every database had before 0085 applied.
--
-- This fixture is AC #7's regression guard and it is load-bearing. Before it
-- existed, re-adding the pre-0085 audit_log fallback to the members/payments
-- policies left this entire suite green -- verified during the Story 1.15
-- code review by mutating both policies inside a rolled-back transaction and
-- re-running: 9/9 and 23/23, zero failures. Nothing anywhere held a bare
-- legacy audit row and asserted it granted nothing, because the two files
-- that seed such a row (this one's siblings) seed a live grant row next to it.
--
-- Deliberately written with target_entity_id = the GYM's id, not a grant id:
-- that is what logGymDataEscalation wrote in the 0012 era, so this row is a
-- faithful reproduction of the legacy shape rather than a modern row with a
-- piece removed.
insert into audit_log (gym_id, actor_id, actor_display_name, action_type, target_entity_id, target_entity_type, metadata)
values (
  '00000000-0000-0000-0000-000000085011',
  '00000000-0000-0000-0000-000000085061',
  'Super Admin X6 (legacy)',
  'gym_data_escalation',
  '00000000-0000-0000-0000-000000085011',
  'gyms',
  '{"reason": "a legacy escalation from before 0085"}'::jsonb
);

insert into gym_data_escalations (id, gym_id, actor_id, reason, granted_at, expires_at, revoked_at, revoked_by, revoke_reason) values
  -- X1: the ordinary live grant.
  ('00000000-0000-0000-0000-000000085051', '00000000-0000-0000-0000-000000085011', '00000000-0000-0000-0000-000000085021',
   'active grant', now(), now() + interval '24 hours', null, null, null),
  -- X2: granted 25 hours ago, so already past its own deadline. Nothing was
  -- revoked and nobody acted -- this is the "lapsed by the clock alone" case (AC #1).
  ('00000000-0000-0000-0000-000000085052', '00000000-0000-0000-0000-000000085011', '00000000-0000-0000-0000-000000085022',
   'expired grant', now() - interval '25 hours', now() - interval '1 hour', null, null, null),
  -- X3: revoked while STILL INSIDE its 24h window -- isolates revocation
  -- from expiry (if this row's expires_at were also past, a passing test
  -- would prove nothing about revocation).
  ('00000000-0000-0000-0000-000000085053', '00000000-0000-0000-0000-000000085011', '00000000-0000-0000-0000-000000085023',
   'revoked grant', now(), now() + interval '24 hours', now(), '00000000-0000-0000-0000-000000085026', 'revoked for test'),
  -- X4: a revoked grant AND a later live one -- revocation is not a ban (AC #5).
  ('00000000-0000-0000-0000-000000085054', '00000000-0000-0000-0000-000000085011', '00000000-0000-0000-0000-000000085024',
   'first grant, revoked', now() - interval '2 hours', now() + interval '22 hours', now() - interval '1 hour', '00000000-0000-0000-0000-000000085026', 'revoked for test'),
  ('00000000-0000-0000-0000-000000085055', '00000000-0000-0000-0000-000000085011', '00000000-0000-0000-0000-000000085024',
   're-escalated', now(), now() + interval '24 hours', null, null, null),
  -- X5: live grant, but on Gym B.
  ('00000000-0000-0000-0000-000000085056', '00000000-0000-0000-0000-000000085012', '00000000-0000-0000-0000-000000085025',
   'active grant on B', now(), now() + interval '24 hours', null, null, null);

-- ============================================================================
-- X1 -- an unexpired, unrevoked grant still grants (AC #2: this story does
-- not change the granted state itself, only its lifetime).
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000085021","role":"authenticated","app_role":"super_admin"}', true);

select is(
  (select count(*) from members where gym_id = '00000000-0000-0000-0000-000000085011' and role = 'coach')::int, 1,
  'X1 (grant granted now, expires in 24h) sees Gym A''s non-owner members row'
);

select is(
  (select count(*) from payments where gym_id = '00000000-0000-0000-0000-000000085011')::int, 1,
  'X1 (unexpired grant) sees Gym A''s payments row'
);

-- Cross-gym isolation is unchanged by this story, re-asserted here because
-- the predicate that enforces it was rewritten wholesale.
select is(
  (select count(*) from members where gym_id = '00000000-0000-0000-0000-000000085012' and role = 'coach')::int, 0,
  'X1''s Gym A grant grants no visibility into Gym B''s non-owner members rows'
);

-- ============================================================================
-- X2 -- expired purely by the passage of time (AC #1). Note this ALSO proves
-- per-actor isolation: X1 holds a live grant on this very gym at this very
-- moment, and it does nothing for X2.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000085022","role":"authenticated","app_role":"super_admin"}', true);

select is(
  (select count(*) from members where gym_id = '00000000-0000-0000-0000-000000085011' and role = 'coach')::int, 0,
  'X2 (grant expired 1 hour ago) sees 0 non-owner members rows -- lapsed with no action by anyone'
);

select is(
  (select count(*) from payments where gym_id = '00000000-0000-0000-0000-000000085011')::int, 0,
  'X2 (expired grant) sees 0 payments rows for Gym A'
);

-- ============================================================================
-- X3 -- revoked while still inside its own 24-hour window (AC #4).
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000085023","role":"authenticated","app_role":"super_admin"}', true);

select is(
  (select count(*) from members where gym_id = '00000000-0000-0000-0000-000000085011' and role = 'coach')::int, 0,
  'X3 (grant revoked, expires_at still in the future) sees 0 non-owner members rows'
);

select is(
  (select count(*) from payments where gym_id = '00000000-0000-0000-0000-000000085011')::int, 0,
  'X3 (revoked grant, unexpired) sees 0 payments rows -- revocation is independent of expiry'
);

-- ============================================================================
-- X4 -- revoked, then escalated again (AC #5): revocation is not a ban.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000085024","role":"authenticated","app_role":"super_admin"}', true);

select is(
  (select count(*) from members where gym_id = '00000000-0000-0000-0000-000000085011' and role = 'coach')::int, 1,
  'X4 (earlier grant revoked, then re-escalated) sees Gym A''s non-owner members row again'
);

select is(
  (select count(*) from payments where gym_id = '00000000-0000-0000-0000-000000085011')::int, 1,
  'X4 (re-escalated after revocation) sees Gym A''s payments row again'
);

-- ============================================================================
-- X5 -- a live grant on Gym B reaches Gym B and only Gym B.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000085025","role":"authenticated","app_role":"super_admin"}', true);

select is(
  (select count(*) from members where gym_id = '00000000-0000-0000-0000-000000085012' and role = 'coach')::int, 1,
  'X5 (live grant on Gym B) sees Gym B''s non-owner members row'
);

select is(
  (select count(*) from members where gym_id = '00000000-0000-0000-0000-000000085011' and role = 'coach')::int, 0,
  'X5''s Gym B grant grants no visibility into Gym A, where three other admins hold grants'
);

-- ============================================================================
-- revoke_gym_data_access() end to end, as a third Super Admin (B) who holds
-- no grant of their own (AC #4: any Super Admin may revoke any grant).
-- apps/super-admin has no test runner at all, so this is the only automated
-- coverage these two RPCs get.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000085026","role":"authenticated","app_role":"super_admin"}', true);

select is(
  (select revoke_gym_data_access(
    '00000000-0000-0000-0000-000000085011',
    '00000000-0000-0000-0000-000000085021',
    'B revokes X1 mid-window')),
  1,
  'revoke_gym_data_access() reports 1 grant revoked for X1 on Gym A'
);

-- Revoking again is a no-op, not an error: the grant may have lapsed or been
-- revoked by someone else a moment earlier, and both are the caller's
-- intended outcome.
select is(
  (select revoke_gym_data_access(
    '00000000-0000-0000-0000-000000085011',
    '00000000-0000-0000-0000-000000085021',
    'B revokes X1 a second time')),
  0,
  'revoking an already-revoked grant returns 0 rather than raising'
);

select throws_ok(
  $$select revoke_gym_data_access('00000000-0000-0000-0000-000000085011', '00000000-0000-0000-0000-000000085024', '   ')$$,
  'a reason is required to revoke gym data access',
  'revoke_gym_data_access() rejects a blank reason'
);

select throws_ok(
  $$select escalate_gym_data_access('00000000-0000-0000-0000-000000085011', '')$$,
  'a reason is required to escalate gym data access',
  'escalate_gym_data_access() rejects an empty reason'
);

-- ============================================================================
-- X1 again -- B's revocation is visible from X1's own session. This is the
-- assertion the superseding-audit-row design could never have satisfied:
-- the revocation was authored by B, but it is X1's access that must end.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000085021","role":"authenticated","app_role":"super_admin"}', true);

select is(
  (select count(*) from members where gym_id = '00000000-0000-0000-0000-000000085011' and role = 'coach')::int, 0,
  'X1 sees 0 non-owner members rows after another Super Admin revoked X1''s grant'
);

select is(
  (select count(*) from payments where gym_id = '00000000-0000-0000-0000-000000085011')::int, 0,
  'X1 sees 0 payments rows after a third-party revocation'
);

-- ============================================================================
-- A non-Super-Admin cannot call either RPC. `security definer` bypasses RLS
-- entirely, so each function's own internal is_super_admin() check is the
-- only gate there is.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000085027","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000085011","app_role":"owner"}', true);

select throws_ok(
  $$select escalate_gym_data_access('00000000-0000-0000-0000-000000085011', 'an owner should not be able to do this')$$,
  'permission denied',
  'escalate_gym_data_access() rejects a gym owner session'
);

select throws_ok(
  $$select revoke_gym_data_access('00000000-0000-0000-0000-000000085011', '00000000-0000-0000-0000-000000085024', 'an owner should not be able to do this')$$,
  'permission denied',
  'revoke_gym_data_access() rejects a gym owner session'
);

-- ============================================================================
-- Committed state written by the RPCs above, inspected without RLS in the
-- way (staff_creation_role_ceiling_enforcement.test.sql's convention).
-- ============================================================================
reset role;

select is(
  (select revoked_by from gym_data_escalations where id = '00000000-0000-0000-0000-000000085051'),
  '00000000-0000-0000-0000-000000085026'::uuid,
  'the revoked grant records B -- the revoking admin -- as revoked_by, not its own holder'
);

select is(
  (select revoke_reason from gym_data_escalations where id = '00000000-0000-0000-0000-000000085051'),
  'B revokes X1 mid-window',
  'the revoked grant stores the mandatory revoke_reason'
);

select is(
  (select count(*) from audit_log
   where gym_id = '00000000-0000-0000-0000-000000085011'
     and action_type = 'gym_data_escalation_revoked'
     and actor_id = '00000000-0000-0000-0000-000000085026'
     and actor_display_name = 'Super Admin B'
     and target_entity_id = '00000000-0000-0000-0000-000000085021'
     and target_entity_type = 'users'
     and metadata ->> 'reason' = 'B revokes X1 mid-window'
     and (metadata ->> 'revoked_count')::int = 1)::int,
  1,
  'AC #4: the revocation is audit-logged with B''s identity, the reason, X1 as the target, and a timestamp'
);

select is(
  (select count(*) from audit_log
   where gym_id = '00000000-0000-0000-0000-000000085011'
     and action_type = 'gym_data_escalation_revoked'
     and (metadata ->> 'revoked_count')::int = 0)::int,
  1,
  'the no-op second revocation is still audit-logged, recording revoked_count 0 rather than staying silent'
);

-- ============================================================================
-- AC #7: a LEGACY bare audit_log row grants nothing.
--
-- Added by the Story 1.15 code review. This is the assertion whose absence
-- let a re-added audit_log fallback in the members/payments policies pass the
-- whole suite. X6 holds the pre-0085 grant shape and no grant row at all.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000085061","role":"authenticated","app_role":"super_admin"}', true);

select is(
  (select count(*) from members where gym_id = '00000000-0000-0000-0000-000000085011' and role = 'coach')::int, 0,
  'AC #7: a legacy gym_data_escalation audit row alone grants no members visibility'
);

select is(
  (select count(*) from payments where gym_id = '00000000-0000-0000-0000-000000085011')::int, 0,
  'AC #7: a legacy gym_data_escalation audit row alone grants no payments visibility'
);

-- ============================================================================
-- escalate_gym_data_access()'s SUCCESS path.
--
-- Added by the Story 1.15 code review. The only calls to this RPC in the
-- suite were two throws_ok cases; every "live grant" elsewhere in this file is
-- a hand-written insert. So nothing asserted that the RPC inserts a grant at
-- all, that the window is 24 hours (the story's binding user decision), or
-- that the audit row points at the grant -- changing `interval '24 hours'` to
-- '24 minutes', or reverting target_entity_id to the gym id as the 0012-era
-- code wrote it, kept the whole suite green.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000085062","role":"authenticated","app_role":"super_admin"}', true);

select lives_ok(
  $$select escalate_gym_data_access('00000000-0000-0000-0000-000000085011', 'X7 escalates through the RPC')$$,
  'escalate_gym_data_access() succeeds for a Super Admin with a real reason'
);

select is(
  (select count(*) from gym_data_escalations
   where gym_id = '00000000-0000-0000-0000-000000085011'
     and actor_id = '00000000-0000-0000-0000-000000085062')::int,
  1,
  'escalate_gym_data_access() inserts exactly one grant row'
);

-- granted_at defaults to now() and expires_at is now() + interval '24 hours',
-- both evaluated in the same statement, so the difference is exact rather
-- than approximate. Asserting the interval itself rather than a tolerance
-- band pins the binding 24-hour decision precisely.
select is(
  (select expires_at - granted_at from gym_data_escalations
   where actor_id = '00000000-0000-0000-0000-000000085062'),
  interval '24 hours',
  'AC #1/#5: the RPC mints exactly a 24-hour window'
);

select is(
  (select count(*) from audit_log al
   join gym_data_escalations e on e.id::text = al.target_entity_id
   where al.action_type = 'gym_data_escalation'
     and al.actor_id = '00000000-0000-0000-0000-000000085062'
     and al.target_entity_type = 'gym_data_escalations'
     and e.actor_id = '00000000-0000-0000-0000-000000085062'
     and al.metadata ->> 'reason' = 'X7 escalates through the RPC')::int,
  1,
  'AC #6: the escalation audit row targets the GRANT it created, not the gym'
);

select is(
  (select count(*) from members where gym_id = '00000000-0000-0000-0000-000000085011' and role = 'coach')::int, 1,
  'AC #2: the grant the RPC just wrote actually grants members visibility'
);

-- Reason ceiling (added by the code review): both RPCs are reachable directly
-- over PostgREST, so the Zod max is not the only gate that matters.
select throws_ok(
  $$select escalate_gym_data_access('00000000-0000-0000-0000-000000085011', repeat('x', 501))$$,
  'reason is too long (max 500 characters)',
  'escalate_gym_data_access() rejects a reason over 500 characters'
);

select throws_ok(
  $$select revoke_gym_data_access('00000000-0000-0000-0000-000000085011', '00000000-0000-0000-0000-000000085024', repeat('x', 501))$$,
  'reason is too long (max 500 characters)',
  'revoke_gym_data_access() rejects a reason over 500 characters'
);

-- ============================================================================
-- The "single blessed write path" posture (0085:82-86, 0086).
--
-- Added by the Story 1.15 code review. The migration's strongest security
-- claim -- "a Super Admin cannot hand-extend their own expires_at" -- rested
-- entirely on the ABSENCE of a write policy and was asserted nowhere, so a
-- future migration adding a broad `for all` policy would restore
-- self-extension with the suite still green. 0086 additionally revokes the
-- table-level write grants, so these now fail at the privilege check.
-- Asserted by SQLSTATE (42501, insufficient_privilege) rather than message
-- text, so the test holds whichever of the two gates fires first.
-- payment_providers_rls.test.sql:53 is the in-repo precedent.
-- ============================================================================
select throws_ok(
  $$insert into gym_data_escalations (gym_id, actor_id, reason, expires_at)
    values ('00000000-0000-0000-0000-000000085011', '00000000-0000-0000-0000-000000085062', 'self-granted', now() + interval '99 days')$$,
  '42501',
  NULL,
  'a Super Admin cannot INSERT a grant row directly -- the RPC is the only write path'
);

select throws_ok(
  $$update gym_data_escalations set expires_at = now() + interval '99 days'
    where actor_id = '00000000-0000-0000-0000-000000085062'$$,
  '42501',
  NULL,
  'a Super Admin cannot hand-extend their own expires_at'
);

select throws_ok(
  $$delete from gym_data_escalations where actor_id = '00000000-0000-0000-0000-000000085062'$$,
  '42501',
  NULL,
  'a Super Admin cannot DELETE a grant row, so revocation cannot be erased'
);

-- ============================================================================
-- 0086's read helpers: one row per HOLDER, on the database's clock.
--
-- Added by the Story 1.15 code review. The service layer previously filtered
-- expires_at against the Next.js server's clock while RLS used Postgres
-- now(), and listed grants per-row -- so one admin's repeat escalations
-- rendered as N identical rows (revoking any one silently revoked all N) and
-- could push other admins' live grants off the capped list entirely.
-- ============================================================================
select lives_ok(
  $$select escalate_gym_data_access('00000000-0000-0000-0000-000000085011', 'X7 escalates a second time')$$,
  'a repeat escalation is accepted and inserts a second grant row (0085:176-182)'
);

select is(
  (select count(*) from list_active_gym_data_escalations('00000000-0000-0000-0000-000000085011')
   where actor_id = '00000000-0000-0000-0000-000000085062')::int,
  1,
  'a holder with two live grants appears as exactly ONE row, not two'
);

select is(
  (select grant_count from list_active_gym_data_escalations('00000000-0000-0000-0000-000000085011')
   where actor_id = '00000000-0000-0000-0000-000000085062'),
  2,
  'that single row reports both of the holder''s live grants'
);

select is(
  (select get_active_escalation_expiry('00000000-0000-0000-0000-000000085011')),
  (select max(expires_at) from gym_data_escalations
   where gym_id = '00000000-0000-0000-0000-000000085011'
     and actor_id = '00000000-0000-0000-0000-000000085062'),
  'get_active_escalation_expiry() returns the LATEST deadline of the caller''s live grants'
);

-- ============================================================================
-- Non-Super-Admins cannot read the grant table at all.
--
-- Added by the Story 1.15 code review: the one RLS policy 0085 adds was the
-- one thing its test file never exercised, on a table holding tenant
-- identifiers alongside free-text reasons.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000085027","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000085011","app_role":"owner"}', true);

select is(
  (select count(*) from gym_data_escalations)::int, 0,
  'a gym owner sees zero rows of the grant table, including grants on their own gym'
);

select * from finish();
rollback;
