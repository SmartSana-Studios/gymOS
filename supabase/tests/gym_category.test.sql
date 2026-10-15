-- Story 21.1: gym category (migration 0123), positive paths. Denial paths live
-- in gym_category.negative.test.sql.
--
-- gyms.category is pinned: a bare UPDATE silently reverts, so every pin
-- assertion pairs with a positive control. set_gym_category() is the only
-- write path after creation.
--
-- Fixture ids: 00000000-0000-0000-0000-0000002101xx.

begin;
select plan(26);

insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000210101', 'Category Tier', 6000, 60000, null);

-- Gym A has no category in its INSERT: it reads the column default.
insert into gyms (id, name, tier_id, status) values
  ('00000000-0000-0000-0000-000000210111', 'Category Gym A', '00000000-0000-0000-0000-000000210101', 'active'),
  ('00000000-0000-0000-0000-000000210112', 'Category Gym B', '00000000-0000-0000-0000-000000210101', 'active');
-- Seeded suspended at insert (a bare UPDATE of gyms.status silently reverts).
insert into gyms (id, name, tier_id, status, category) values
  ('00000000-0000-0000-0000-000000210113', 'Category Gym Suspended', '00000000-0000-0000-0000-000000210101', 'suspended', 'other');

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000210121'), -- owner A
  ('00000000-0000-0000-0000-000000210122'), -- supervisor A
  ('00000000-0000-0000-0000-000000210123'); -- super admin

update users set is_super_admin = true where id = '00000000-0000-0000-0000-000000210123';

insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000210131', '00000000-0000-0000-0000-000000210111', '00000000-0000-0000-0000-000000210121', 'owner',      'Cat Owner A',      current_date),
  ('00000000-0000-0000-0000-000000210132', '00000000-0000-0000-0000-000000210111', '00000000-0000-0000-0000-000000210122', 'supervisor', 'Cat Supervisor A', current_date);

-- ============================================================================
-- Column default and CHECK.
-- ============================================================================
select is(
  (select category from gyms where id = '00000000-0000-0000-0000-000000210111'),
  'gym',
  'a gym inserted without a category reads gym (release default)'
);

select is(
  (select is_nullable from information_schema.columns
   where table_schema = 'public' and table_name = 'gyms' and column_name = 'category'),
  'NO',
  'gyms.category is NOT NULL'
);

select throws_ok(
  $$ insert into gyms (name, tier_id, category) values ('Category Bad Gym', '00000000-0000-0000-0000-000000210101', 'spa') $$,
  '23514',
  null,
  'the CHECK rejects an unknown code on insert'
);

select lives_ok(
  $$ insert into gyms (id, name, tier_id, category) values
       ('00000000-0000-0000-0000-000000210114', 'Category Gym Yoga', '00000000-0000-0000-0000-000000210101', 'yoga_studio') $$,
  'a gym can be created with a category directly (createGym path; the pin is UPDATE only)'
);

select is(
  (select category from gyms where id = '00000000-0000-0000-0000-000000210114'),
  'yoga_studio',
  'the inserted category is stored'
);

-- ============================================================================
-- set_gym_category(): owner, supervisor, super admin; audit rows.
-- ============================================================================
create temp table cat_before as
  select to_jsonb(g) - 'category' as rest from gyms g where g.id = '00000000-0000-0000-0000-000000210111';
grant select on cat_before to authenticated;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000210121","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000210111","app_role":"owner"}', true);

select lives_ok(
  $$ select set_gym_category('00000000-0000-0000-0000-000000210111', 'pilates_studio') $$,
  'owner can set the category of their own gym'
);
reset role;

select is(
  (select category from gyms where id = '00000000-0000-0000-0000-000000210111'),
  'pilates_studio',
  'the category is pilates_studio after the owner call'
);

select is(
  (select metadata from audit_log
   where action_type = 'gym_category_changed' and gym_id = '00000000-0000-0000-0000-000000210111'
   order by created_at desc limit 1),
  '{"old_category": "gym", "new_category": "pilates_studio"}'::jsonb,
  'one audit row records old and new code'
);

select is(
  (select actor_id from audit_log
   where action_type = 'gym_category_changed' and gym_id = '00000000-0000-0000-0000-000000210111'
   order by created_at desc limit 1),
  '00000000-0000-0000-0000-000000210121'::uuid,
  'the audit row names the acting owner'
);

select is(
  (select to_jsonb(g) - 'category' from gyms g where g.id = '00000000-0000-0000-0000-000000210111'),
  (select rest from cat_before),
  'the setter changed only the category column (FR-172)'
);

select is(
  (select category from gyms where id = '00000000-0000-0000-0000-000000210112'),
  'gym',
  'gym B is untouched'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000210121","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000210111","app_role":"owner"}', true);
select set_gym_category('00000000-0000-0000-0000-000000210111', 'pilates_studio');
reset role;

select is(
  (select count(*)::int from audit_log where action_type = 'gym_category_changed' and gym_id = '00000000-0000-0000-0000-000000210111'),
  1,
  'an unchanged value writes no second audit row'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000210122","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000210111","app_role":"supervisor"}', true);
select lives_ok(
  $$ select set_gym_category('00000000-0000-0000-0000-000000210111', 'fitness_center') $$,
  'supervisor can set the category of their own gym'
);
reset role;

select is(
  (select category from gyms where id = '00000000-0000-0000-0000-000000210111'),
  'fitness_center',
  'the category is fitness_center after the supervisor call'
);

select is(
  (select count(*)::int from audit_log where action_type = 'gym_category_changed' and gym_id = '00000000-0000-0000-0000-000000210111'),
  2,
  'the supervisor change added one audit row'
);

-- Super admin: another gym (no gym claim in the JWT), and a suspended gym.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000210123","role":"authenticated","app_role":"super_admin"}', true);

select lives_ok(
  $$ select set_gym_category('00000000-0000-0000-0000-000000210112', 'yoga_studio') $$,
  'super admin can set the category of any gym'
);
select lives_ok(
  $$ select set_gym_category('00000000-0000-0000-0000-000000210113', 'gym') $$,
  'super admin can set the category of a suspended gym'
);
reset role;

select is(
  (select category from gyms where id = '00000000-0000-0000-0000-000000210112'),
  'yoga_studio',
  'gym B reads yoga_studio after the super admin call'
);

select is(
  (select category from gyms where id = '00000000-0000-0000-0000-000000210113'),
  'gym',
  'the suspended gym reads gym after the super admin call'
);

select is(
  (select gym_id from audit_log
   where action_type = 'gym_category_changed' and target_entity_id = '00000000-0000-0000-0000-000000210112'),
  '00000000-0000-0000-0000-000000210112'::uuid,
  'the super admin audit row is scoped to the target gym'
);

-- ============================================================================
-- The pin: a direct UPDATE reverts, even for super admin; positive controls.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000210121","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000210111","app_role":"owner"}', true);
update gyms set name = 'Category Gym A Renamed', category = 'other'
where id = '00000000-0000-0000-0000-000000210111';
reset role;

select is(
  (select name from gyms where id = '00000000-0000-0000-0000-000000210111'),
  'Category Gym A Renamed',
  'positive control: the owner direct UPDATE landed (name changed)'
);
select is(
  (select category from gyms where id = '00000000-0000-0000-0000-000000210111'),
  'fitness_center',
  'an owner direct UPDATE of the category is pinned'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000210123","role":"authenticated","app_role":"super_admin"}', true);
update gyms set name = 'Category Gym B Renamed', category = 'other'
where id = '00000000-0000-0000-0000-000000210112';
reset role;

select is(
  (select category from gyms where id = '00000000-0000-0000-0000-000000210112'),
  'yoga_studio',
  'a super admin direct UPDATE of the category is pinned'
);

update gyms set category = 'other' where id = '00000000-0000-0000-0000-000000210112';
select is(
  (select category from gyms where id = '00000000-0000-0000-0000-000000210112'),
  'yoga_studio',
  'a service-level (superuser) direct UPDATE of the category is pinned too'
);

-- ============================================================================
-- Privileges (0104 convention).
-- ============================================================================
select ok(
  not has_function_privilege('anon', 'public.set_gym_category(uuid, text)', 'execute')
  and has_function_privilege('authenticated', 'public.set_gym_category(uuid, text)', 'execute'),
  'set_gym_category: no anon EXECUTE, authenticated EXECUTE'
);

select ok(
  not has_function_privilege('anon', 'private.pin_gym_category()', 'execute')
  and not has_function_privilege('authenticated', 'private.pin_gym_category()', 'execute'),
  'the pin trigger function is not executable by any client role'
);

select * from finish();
rollback;
