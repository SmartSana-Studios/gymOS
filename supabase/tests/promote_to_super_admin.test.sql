-- Story 1.16 code review follow-up: promote_to_super_admin() /
-- revert_super_admin_promotion() (migration 0088). Session-simulation
-- conventions match list_super_admins.test.sql; `reset role` before
-- inspecting committed `users` state matches
-- gym_data_escalation_ttl_revocation.test.sql's own discipline -- there is
-- no Super Admin SELECT policy on `users` (0087's own header comment), so a
-- direct read as the `authenticated` role would see nothing even for a
-- write that actually succeeded via the SECURITY DEFINER RPC.
--
-- Fixture: a Super Admin caller, a non-Super-Admin user with no display_name
-- (the "fallback applies" case), a non-Super-Admin user with an existing
-- display_name (the "fallback must not clobber it" case), and an existing
-- Super Admin (the "idempotent no-op" case).

begin;
select plan(8);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000005001'), -- Super Admin caller
  ('00000000-0000-0000-0000-000000005002'), -- no display_name yet
  ('00000000-0000-0000-0000-000000005003'), -- already has a display_name
  ('00000000-0000-0000-0000-000000005004'); -- already a Super Admin

update users set display_name = 'Caller Admin', is_super_admin = true
  where id = '00000000-0000-0000-0000-000000005001';
update users set display_name = null, is_super_admin = false
  where id = '00000000-0000-0000-0000-000000005002';
update users set display_name = 'Existing Name', is_super_admin = false
  where id = '00000000-0000-0000-0000-000000005003';
update users set display_name = 'Already Admin', is_super_admin = true
  where id = '00000000-0000-0000-0000-000000005004';

-- ============================================================================
-- A non-Super-Admin authenticated session is rejected outright.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000005002","role":"authenticated"}',
  true
);

select throws_ok(
  $$select * from promote_to_super_admin('00000000-0000-0000-0000-000000005002', 'Fallback Name')$$,
  'permission denied',
  'promote_to_super_admin() rejects a non-Super-Admin session'
);

select throws_ok(
  $$select revert_super_admin_promotion('00000000-0000-0000-0000-000000005002', false)$$,
  'permission denied',
  'revert_super_admin_promotion() rejects a non-Super-Admin session'
);

-- ============================================================================
-- Super Admin session from here on.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000005001","role":"authenticated","app_role":"super_admin"}',
  true
);

-- Target with no display_name: fallback applies.
select results_eq(
  $$select already_super_admin, display_name_set from promote_to_super_admin('00000000-0000-0000-0000-000000005002', 'Fallback Name')$$,
  $$values (false, true)$$,
  'promoting a user with no display_name reports display_name_set = true'
);

reset role;

select results_eq(
  $$select is_super_admin, display_name from users where id = '00000000-0000-0000-0000-000000005002'$$,
  $$values (true, 'Fallback Name'::text)$$,
  'is_super_admin is flipped to true and display_name is set from the fallback'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000005001","role":"authenticated","app_role":"super_admin"}',
  true
);

-- Target with an existing display_name: fallback must not clobber it.
select results_eq(
  $$select already_super_admin, display_name_set from promote_to_super_admin('00000000-0000-0000-0000-000000005003', 'Fallback Name')$$,
  $$values (false, false)$$,
  'promoting a user with an existing display_name reports display_name_set = false'
);

reset role;

select is(
  (select display_name from users where id = '00000000-0000-0000-0000-000000005003'),
  'Existing Name',
  'an existing display_name is never overwritten by the fallback'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000005001","role":"authenticated","app_role":"super_admin"}',
  true
);

-- Idempotency: already a Super Admin -- no-op, reported as such.
select results_eq(
  $$select already_super_admin, display_name_set from promote_to_super_admin('00000000-0000-0000-0000-000000005004', 'Fallback Name')$$,
  $$values (true, false)$$,
  'promoting an already-Super-Admin account is a reported no-op'
);

-- Revert: undoes exactly what the display_name_set = true call above did.
select revert_super_admin_promotion('00000000-0000-0000-0000-000000005002', true);

reset role;

select results_eq(
  $$select is_super_admin, display_name from users where id = '00000000-0000-0000-0000-000000005002'$$,
  $$values (false, null::text)$$,
  'reverting with p_revert_display_name = true clears both is_super_admin and display_name'
);

select * from finish();
rollback;
