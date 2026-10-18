-- Story 22 retro item 55: last verified factor guard and fail-closed access-token hook (migration 0129).
begin;
select plan(13);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000229101', 'sa229@login.example'),
  ('00000000-0000-0000-0000-000000229102', 'plain229@login.example'),
  ('00000000-0000-0000-0000-000000229103', 'gone229@login.example');
update users set is_super_admin = true where id in ('00000000-0000-0000-0000-000000229101', '00000000-0000-0000-0000-000000229103');

insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000229a1', '00000000-0000-0000-0000-000000229101', 'one', 'totp', 'verified', now(), now()),
  ('00000000-0000-0000-0000-0000000229a2', '00000000-0000-0000-0000-000000229101', 'two', 'totp', 'verified', now(), now()),
  ('00000000-0000-0000-0000-0000000229a3', '00000000-0000-0000-0000-000000229101', 'half', 'totp', 'unverified', now(), now()),
  ('00000000-0000-0000-0000-0000000229b1', '00000000-0000-0000-0000-000000229102', 'plain', 'totp', 'verified', now(), now()),
  ('00000000-0000-0000-0000-0000000229c1', '00000000-0000-0000-0000-000000229103', 'doomed', 'totp', 'verified', now(), now());

-- ---- hook: fail closed on error -----------------------------------------------------------------------
select is(
  (public.custom_access_token_hook(jsonb_build_object('user_id', 'not-a-uuid',
     'claims', jsonb_build_object('sub', 'x', 'aal', 'aal1', 'app_role', 'super_admin', 'gym_id', 'g'))) -> 'claims') ? 'app_role',
  false, 'a hook error strips an incoming app_role');
select is(
  (public.custom_access_token_hook(jsonb_build_object('user_id', 'not-a-uuid',
     'claims', jsonb_build_object('sub', 'x', 'app_role', 'super_admin', 'gym_id', 'g'))) -> 'claims') ? 'gym_id',
  false, 'a hook error strips an incoming gym_id');
select is(
  (public.custom_access_token_hook(jsonb_build_object('user_id', 'not-a-uuid',
     'claims', jsonb_build_object('sub', 'keep-me'))) -> 'claims' ->> 'sub'),
  'keep-me', 'other claims survive the error path');

-- ---- guard: flag off lets anything through -------------------------------------------------------------------
select lives_ok($$delete from auth.mfa_factors where id = '00000000-0000-0000-0000-0000000229a3'$$, 'an unverified factor can always be removed');
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
values ('00000000-0000-0000-0000-0000000229a4', '00000000-0000-0000-0000-000000229101', 'temp', 'totp', 'verified', now(), now());
select lives_ok($$delete from auth.mfa_factors where id = '00000000-0000-0000-0000-0000000229a4'$$, 'flag off: a verified factor can be removed');

-- ---- guard: flag on ---------------------------------------------------------------------------------------------
update private.platform_flags set enabled = true where flag = 'super_admin_aal2';
select lives_ok($$delete from auth.mfa_factors where id = '00000000-0000-0000-0000-0000000229a2'$$, 'flag on: removing one of two verified factors is allowed');
select throws_ok($$delete from auth.mfa_factors where id = '00000000-0000-0000-0000-0000000229a1'$$,
                 'P0001', null, 'flag on: removing the last verified factor is refused');
select is((select count(*)::int from auth.mfa_factors where user_id = '00000000-0000-0000-0000-000000229101' and status::text = 'verified'), 1,
          'the last factor is still there');
select lives_ok($$delete from auth.mfa_factors where id = '00000000-0000-0000-0000-0000000229b1'$$, 'flag on: a non-Super-Admin is not guarded');

-- the explicit system bypass (recovery apply, operator reset)
select set_config('gymos.factor_reset', 'on', true);
select lives_ok($$delete from auth.mfa_factors where id = '00000000-0000-0000-0000-0000000229a1'$$, 'the reset bypass removes the last factor');
select set_config('gymos.factor_reset', 'off', true);

-- deleting the account itself is not blocked by its own last factor
select lives_ok($$delete from auth.users where id = '00000000-0000-0000-0000-000000229103'$$, 'deleting the account cascades past the guard');
select is((select count(*)::int from auth.mfa_factors where user_id = '00000000-0000-0000-0000-000000229103'), 0, 'its factor went with it');

-- the guard function is not client-callable
select is(has_function_privilege('authenticated', 'private.guard_last_verified_factor()', 'execute'), false, 'guard function is not client-callable');

select * from finish();
rollback;
