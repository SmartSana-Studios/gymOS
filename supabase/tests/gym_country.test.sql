-- 0105: gyms.country exists, defaults to 'CM' (backfilling existing rows), and
-- only accepts two upper-case letters.

begin;
select plan(6);

select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'gyms' and column_name = 'country'
      and is_nullable = 'NO' and data_type = 'text'
  ),
  'gyms.country exists as NOT NULL text'
);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000010500', 'Gym Country Tier', 5000, 50000, 100);

insert into gyms (id, name, tier_id, status, capacity, timezone) values
  ('00000000-0000-0000-0000-000000010501', 'Default Country Gym', '00000000-0000-0000-0000-000000010500', 'active', 10, 'Africa/Douala');

select is(
  (select country from gyms where id = '00000000-0000-0000-0000-000000010501'),
  'CM',
  'a gym inserted without a country defaults to CM'
);

update gyms set country = 'NG' where id = '00000000-0000-0000-0000-000000010501';
select is(
  (select country from gyms where id = '00000000-0000-0000-0000-000000010501'),
  'NG',
  'country can be updated to another ISO alpha-2 code'
);

select throws_ok(
  $$update gyms set country = 'cm' where id = '00000000-0000-0000-0000-000000010501'$$,
  '23514', null,
  'lower-case country is rejected'
);

select throws_ok(
  $$update gyms set country = 'CMR' where id = '00000000-0000-0000-0000-000000010501'$$,
  '23514', null,
  'a three-letter country is rejected'
);

select throws_ok(
  $$update gyms set country = null where id = '00000000-0000-0000-0000-000000010501'$$,
  '23502', null,
  'a null country is rejected'
);

select * from finish();
rollback;
