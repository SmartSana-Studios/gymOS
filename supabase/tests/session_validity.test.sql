-- Story 28.1: session validity setting (migration 0177), positive paths. Denial paths: session_validity.negative.test.sql. The session record
-- (cover columns, constraints, backfill, normalising trigger) is session_validity_cover.test.sql.
--
-- gyms.session_validity is pinned: a bare UPDATE silently reverts, so every pin assertion pairs with a positive control.
-- set_session_validity() is the only write path.
--
-- Fixture ids: 00000000-0000-0000-0000-0000002801xx.

begin;
select plan(45);

insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000280101', 'Validity Tier', 6000, 60000, null);

-- Gym A and B do not name the column: they read the default.
insert into gyms (id, name, tier_id, status) values
  ('00000000-0000-0000-0000-000000280111', 'Validity Gym A', '00000000-0000-0000-0000-000000280101', 'active'),
  ('00000000-0000-0000-0000-000000280112', 'Validity Gym B', '00000000-0000-0000-0000-000000280101', 'active');

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000280121'), -- owner A
  ('00000000-0000-0000-0000-000000280122'), -- supervisor A
  ('00000000-0000-0000-0000-000000280123'), -- manager A
  ('00000000-0000-0000-0000-000000280124'), -- super admin
  ('00000000-0000-0000-0000-000000280125'), -- owner B
  ('00000000-0000-0000-0000-000000280126'), -- receptionist A
  ('00000000-0000-0000-0000-000000280127'), -- coach A
  ('00000000-0000-0000-0000-000000280128'); -- member A

update users set is_super_admin = true where id = '00000000-0000-0000-0000-000000280124';

insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000280131', '00000000-0000-0000-0000-000000280111', '00000000-0000-0000-0000-000000280121', 'owner',        'Validity Owner A',        current_date),
  ('00000000-0000-0000-0000-000000280132', '00000000-0000-0000-0000-000000280111', '00000000-0000-0000-0000-000000280122', 'supervisor',   'Validity Supervisor A',   current_date),
  ('00000000-0000-0000-0000-000000280133', '00000000-0000-0000-0000-000000280111', '00000000-0000-0000-0000-000000280123', 'manager',      'Validity Manager A',      current_date),
  ('00000000-0000-0000-0000-000000280135', '00000000-0000-0000-0000-000000280112', '00000000-0000-0000-0000-000000280125', 'owner',        'Validity Owner B',        current_date),
  ('00000000-0000-0000-0000-000000280136', '00000000-0000-0000-0000-000000280111', '00000000-0000-0000-0000-000000280126', 'receptionist', 'Validity Receptionist A', current_date),
  ('00000000-0000-0000-0000-000000280137', '00000000-0000-0000-0000-000000280111', '00000000-0000-0000-0000-000000280127', 'coach',        'Validity Coach A',        current_date),
  ('00000000-0000-0000-0000-000000280138', '00000000-0000-0000-0000-000000280111', '00000000-0000-0000-0000-000000280128', 'member',       'Validity Member A',       current_date);

-- ============================================================================
-- Column default and CHECK.
-- ============================================================================
select is(
  (select session_validity from gyms where id = '00000000-0000-0000-0000-000000280111'),
  'whole_day',
  'a gym inserted without the column reads whole_day (no gym-creation path needs a change)'
);
select is(
  (select is_nullable from information_schema.columns
   where table_schema = 'public' and table_name = 'gyms' and column_name = 'session_validity'),
  'NO',
  'gyms.session_validity is NOT NULL'
);
select throws_ok(
  $$ insert into gyms (name, tier_id, session_validity) values ('Validity Bad Gym', '00000000-0000-0000-0000-000000280101', 'weekly') $$,
  '23514', null,
  'the CHECK rejects an unknown code on insert'
);
select lives_ok(
  $$ insert into gyms (id, name, tier_id, session_validity) values
       ('00000000-0000-0000-0000-000000280113', 'Validity Gym Single', '00000000-0000-0000-0000-000000280101', 'single_use') $$,
  'a gym can be created with single_use directly (the pin is UPDATE only)'
);
select is(
  (select count(*)::int from gyms where session_validity <> 'whole_day' and id not in ('00000000-0000-0000-0000-000000280113')),
  0,
  'every other gym in the database reads whole_day'
);
select is(
  (select pg_get_constraintdef(c.oid) from pg_constraint c where c.conname = 'gyms_session_validity_valid'),
  'CHECK ((session_validity = ANY (ARRAY[''whole_day''::text, ''single_use''::text])))',
  'the CHECK lists exactly the two codes (kept in step with the setter list)'
);

-- ============================================================================
-- platform_session_config.single_use_visit_limit_minutes
-- ============================================================================
select is(
  (select single_use_visit_limit_minutes from platform_session_config),
  180,
  'the existing singleton row reads a visit limit of 180'
);
select is(
  (select c.paid_session_validity_days from platform_session_config c limit 1),
  7,
  'the read idiom for the existing columns keeps working'
);
select throws_ok(
  $$ update platform_session_config set single_use_visit_limit_minutes = 0 $$,
  '23514', null, 'a visit limit of 0 is refused'
);
select throws_ok(
  $$ update platform_session_config set single_use_visit_limit_minutes = 1441 $$,
  '23514', null, 'a visit limit above 1440 is refused'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000280124","role":"authenticated","app_role":"super_admin"}', true);
update platform_session_config set single_use_visit_limit_minutes = 240;
reset role;

select is(
  (select count(*)::int from audit_log where action_type = 'platform_session_config_updated'),
  1,
  'a change to ONLY the new column writes one platform_session_config_updated row'
);
select is(
  (select (metadata #>> '{old,single_use_visit_limit_minutes}') || '>' || (metadata #>> '{new,single_use_visit_limit_minutes}')
   from audit_log where action_type = 'platform_session_config_updated'),
  '180>240',
  'its old is 180 and its new is the new value'
);
select is(
  (select metadata #>> '{new,paid_session_validity_days}' from audit_log where action_type = 'platform_session_config_updated'),
  '7',
  'the three older keys are still carried'
);

-- ============================================================================
-- get_session_validity_settings(): own gym, Owner and Supervisor only.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000280121","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000280111","app_role":"owner"}', true);
select is(
  (select row(session_validity, single_use_visit_limit_minutes)::text from get_session_validity_settings()),
  '(whole_day,240)',
  'the owner reads their gym''s setting and the current platform limit'
);
select is((select count(*)::int from get_session_validity_settings()), 1, 'the owner gets exactly one row');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000280122","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000280111","app_role":"supervisor"}', true);
select is((select count(*)::int from get_session_validity_settings()), 1, 'the supervisor gets one row');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000280123","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000280111","app_role":"manager"}', true);
select is((select count(*)::int from get_session_validity_settings()), 0, 'a manager gets nothing');
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000280126","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000280111","app_role":"receptionist"}', true);
select is((select count(*)::int from get_session_validity_settings()), 0, 'a receptionist gets nothing');
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000280127","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000280111","app_role":"coach"}', true);
select is((select count(*)::int from get_session_validity_settings()), 0, 'a coach gets nothing');
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000280128","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000280111","app_role":"member"}', true);
select is((select count(*)::int from get_session_validity_settings()), 0, 'a member gets nothing');
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000280124","role":"authenticated","app_role":"super_admin"}', true);
select is((select count(*)::int from get_session_validity_settings()), 0, 'a super admin (no gym) gets nothing');
reset role;

-- ============================================================================
-- set_session_validity(): owner and supervisor; audit rows.
-- ============================================================================
create temp table val_before as
  select to_jsonb(g) - 'session_validity' as rest from gyms g where g.id = '00000000-0000-0000-0000-000000280111';
grant select on val_before to authenticated;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000280121","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000280111","app_role":"owner"}', true);
select lives_ok(
  $$ select set_session_validity('00000000-0000-0000-0000-000000280111', 'single_use') $$,
  'the owner can set the session validity of their own gym'
);
reset role;

select is(
  (select session_validity from gyms where id = '00000000-0000-0000-0000-000000280111'),
  'single_use',
  'the gym reads single_use after the owner call'
);
select is(
  (select metadata from audit_log
   where action_type = 'session_validity_changed' and gym_id = '00000000-0000-0000-0000-000000280111'
   order by created_at desc limit 1),
  '{"old_validity": "whole_day", "new_validity": "single_use"}'::jsonb,
  'one audit row records old and new'
);
select is(
  (select actor_id from audit_log
   where action_type = 'session_validity_changed' and gym_id = '00000000-0000-0000-0000-000000280111'
   order by created_at desc limit 1),
  '00000000-0000-0000-0000-000000280121'::uuid,
  'the audit row names the acting owner '
) ;
select is(
  (select to_jsonb(g) - 'session_validity' from gyms g where g.id = '00000000-0000-0000-0000-000000280111'),
  (select rest from val_before),
  'the setter changed only the session_validity column'
);
select is(
  (select session_validity from gyms where id = '00000000-0000-0000-0000-000000280112'),
  'whole_day',
  'gym B is untouched'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000280121","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000280111","app_role":"owner"}', true);
select set_session_validity('00000000-0000-0000-0000-000000280111', 'single_use');
reset role;
select is(
  (select count(*)::int from audit_log where action_type = 'session_validity_changed' and gym_id = '00000000-0000-0000-0000-000000280111'),
  1,
  'setting the current value writes no second audit row'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000280122","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000280111","app_role":"supervisor"}', true);
select lives_ok(
  $$ select set_session_validity('00000000-0000-0000-0000-000000280111', 'whole_day') $$,
  'the supervisor can set the session validity of their own gym'
);
reset role;
select is(
  (select session_validity from gyms where id = '00000000-0000-0000-0000-000000280111'),
  'whole_day',
  'the gym reads whole_day after the supervisor call'
);
select is(
  (select count(*)::int from audit_log where action_type = 'session_validity_changed' and gym_id = '00000000-0000-0000-0000-000000280111'),
  2,
  'the supervisor change added one audit row'
);

-- Owner B reads their own gym's value, never gym A's.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000280125","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000280112","app_role":"owner"}', true);
select set_session_validity('00000000-0000-0000-0000-000000280112', 'single_use');
select is(
  (select session_validity from get_session_validity_settings()),
  'single_use',
  'tenant isolation: owner B reads gym B''s value through the read function'
);
select is((select count(*)::int from get_session_validity_settings()), 1, 'and only one row');
reset role;
select is(
  (select session_validity from gyms where id = '00000000-0000-0000-0000-000000280111'),
  'whole_day',
  'gym A is untouched by owner B'
);

-- ============================================================================
-- The pin: a direct UPDATE reverts, for every caller; positive controls.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000280121","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000280111","app_role":"owner"}', true);
update gyms set name = 'VALIDITY GYM A RENAMED', session_validity = 'single_use'
where id = '00000000-0000-0000-0000-000000280111';
reset role;

select is(
  (select name from gyms where id = '00000000-0000-0000-0000-000000280111'),
  'VALIDITY GYM A RENAMED',
  'positive control: the owner direct UPDATE landed (name changed)'
);
select is(
  (select session_validity from gyms where id = '00000000-0000-0000-0000-000000280111'),
  'whole_day',
  'an owner direct UPDATE of the column is pinned'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000280122","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000280111","app_role":"supervisor"}', true);
update gyms set session_validity = 'single_use' where id = '00000000-0000-0000-0000-000000280111';
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000280123","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000280111","app_role":"manager"}', true);
update gyms set session_validity = 'single_use' where id = '00000000-0000-0000-0000-000000280111';
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000280124","role":"authenticated","app_role":"super_admin"}', true);
update gyms set name = 'Validity Gym B Renamed', session_validity = 'whole_day' where id = '00000000-0000-0000-0000-000000280112';
reset role;

select is(
  (select session_validity from gyms where id = '00000000-0000-0000-0000-000000280111'),
  'whole_day',
  'direct UPDATEs by a supervisor and a manager changed nothing'
);
select is(
  (select name || ':' || session_validity from gyms where id = '00000000-0000-0000-0000-000000280112'),
  'VALIDITY GYM B RENAMED:single_use',
  'a super admin direct UPDATE landed for the name (control) and was pinned for the column'
);

set local role service_role;
update gyms set session_validity = 'whole_day' where id = '00000000-0000-0000-0000-000000280112';
reset role;
select is(
  (select session_validity from gyms where id = '00000000-0000-0000-0000-000000280112'),
  'single_use',
  'a service_role direct UPDATE of the column is pinned too'
);

update gyms set session_validity = 'whole_day' where id = '00000000-0000-0000-0000-000000280112';
select is(
  (select session_validity from gyms where id = '00000000-0000-0000-0000-000000280112'),
  'single_use',
  'a superuser direct UPDATE of the column is pinned too'
);

select is(
  (select count(*)::int from audit_log where action_type = 'session_validity_changed'),
  3,
  'pinned direct writes wrote no audit rows (owner A, supervisor A and owner B are the only three)'
);

-- ============================================================================
-- Privileges (0104 convention) and the registry.
-- ============================================================================
select ok(
  not has_function_privilege('anon', 'public.set_session_validity(uuid, text)', 'execute')
  and has_function_privilege('authenticated', 'public.set_session_validity(uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.get_session_validity_settings()', 'execute')
  and has_function_privilege('authenticated', 'public.get_session_validity_settings()', 'execute'),
  'both functions: no anon EXECUTE, authenticated EXECUTE'
);
select ok(
  not has_function_privilege('anon', 'private.pin_session_validity()', 'execute')
  and not has_function_privilege('authenticated', 'private.pin_session_validity()', 'execute'),
  'the pin trigger function is not executable by any client role'
);
select is(
  (select array_agg(object_name order by object_name) from private.support_capabilities where capability = 'session_validity' and kind = 'rpc'),
  array['get_session_validity_settings', 'set_session_validity'],
  'both functions are registered for support as rpc objects'
);
select ok(
  exists (select 1 from private.support_audit_actions where action_type = 'session_validity_changed'),
  'session_validity_changed is an audit action a support caller may cause'
);

select * from finish();
rollback;
