-- 0154: members.birth_year / profession / neighborhood exist, are nullable and
-- checked, a member cannot change them on their own row, staff can, and
-- another gym's staff cannot see them. Synthetic rows only.

begin;
select plan(12);

-- Runs as the caller (security invoker): how many rows did the member's own update reach?
create function pg_temp.self_update_rows() returns int language plpgsql as $f$
declare n int;
begin
  update members set birth_year = 1990, profession = 'Pilot', neighborhood = 'Bastos'
   where id = '00000000-0000-0000-0000-000000015423';
  get diagnostics n = row_count;
  return n;
end $f$;

select ok(
  (select count(*) = 3 from information_schema.columns
   where table_schema = 'public' and table_name = 'members'
     and column_name in ('birth_year', 'profession', 'neighborhood')
     and is_nullable = 'YES'),
  'the three profile columns exist and are nullable'
);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000015400', 'Profile Fields Tier', 5000, 50000, 50);

insert into gyms (id, name, tier_id, status, capacity) values
  ('00000000-0000-0000-0000-000000015401', 'Profile Gym A', '00000000-0000-0000-0000-000000015400', 'active', 25),
  ('00000000-0000-0000-0000-000000015402', 'Profile Gym B', '00000000-0000-0000-0000-000000015400', 'active', 25);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000015411'), -- Gym A owner
  ('00000000-0000-0000-0000-000000015412'), -- Gym B owner
  ('00000000-0000-0000-0000-000000015413'); -- Gym A member

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000015421', '00000000-0000-0000-0000-000000015401', '00000000-0000-0000-0000-000000015411', 'owner', 'Profile A Owner'),
  ('00000000-0000-0000-0000-000000015422', '00000000-0000-0000-0000-000000015402', '00000000-0000-0000-0000-000000015412', 'owner', 'Profile B Owner'),
  ('00000000-0000-0000-0000-000000015423', '00000000-0000-0000-0000-000000015401', '00000000-0000-0000-0000-000000015413', 'member', 'Profile Member');

select is(
  (select birth_year from members where id = '00000000-0000-0000-0000-000000015423'),
  null::smallint,
  'an existing or new row without the fields reads null'
);

select throws_ok(
  $$update members set birth_year = 1899 where id = '00000000-0000-0000-0000-000000015423'$$,
  '23514', null, 'birth year below 1900 is refused'
);
select throws_ok(
  $$update members set birth_year = 2101 where id = '00000000-0000-0000-0000-000000015423'$$,
  '23514', null, 'birth year above 2100 is refused'
);
select throws_ok(
  format($$update members set profession = %L where id = '00000000-0000-0000-0000-000000015423'$$, repeat('x', 121)),
  '23514', null, 'a 121-character profession is refused'
);
select throws_ok(
  format($$update members set neighborhood = %L where id = '00000000-0000-0000-0000-000000015423'$$, repeat('x', 121)),
  '23514', null, 'a 121-character neighborhood is refused'
);

-- Staff (Gym A owner) can set the fields.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000015411","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000015401","app_role":"owner"}', true);

select lives_ok(
  $$update members set birth_year = 1984, profession = 'Welder', neighborhood = 'Ngui'
    where id = '00000000-0000-0000-0000-000000015423'$$,
  'staff can set the three fields'
);
select is(
  (select birth_year::text || '/' || profession || '/' || neighborhood from members where id = '00000000-0000-0000-0000-000000015423'),
  '1984/WELDER/NGUI',
  'the staff write is stored'
);

-- The member cannot change them on their own row.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000015413","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000015401","app_role":"member"}', true);

-- The update must MATCH the member's own row: otherwise "unchanged" below would also hold if row security merely hid the row,
-- and the pin would be untested.
select is(
  pg_temp.self_update_rows(),
  1,
  'a member self-update reaches their own row (so the pin, not row security, protects the three fields)'
);

-- Read back as staff (the member policy may hide nothing, but be explicit).
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000015411","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000015401","app_role":"owner"}', true);
select is(
  (select birth_year::text || '/' || profession || '/' || neighborhood from members where id = '00000000-0000-0000-0000-000000015423'),
  '1984/WELDER/NGUI',
  'the member self-update left the three fields unchanged'
);

-- Another gym's staff sees nothing.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000015412","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000015402","app_role":"owner"}', true);
select is(
  (select count(*)::int from members where id = '00000000-0000-0000-0000-000000015423'),
  0,
  'another gym''s staff cannot read the member or its profile fields'
);

select is(
  has_function_privilege('anon', 'private.protect_self_managed_member_columns()', 'execute')
    or has_function_privilege('authenticated', 'private.protect_self_managed_member_columns()', 'execute'),
  false,
  'the replaced self-edit pin function is not callable by anon or authenticated'
);

select * from finish();
rollback;
