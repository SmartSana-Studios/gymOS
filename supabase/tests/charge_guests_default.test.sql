-- Story 19.12: migration 0115 -- charge_guests_per_session defaults to true for
-- gyms created after the migration. Existing gyms are covered by the
-- migration's own do $apply$ block (it compares an md5 of every (id, flag)
-- pair before and after the ALTER, under an access exclusive lock).
--
-- Fixture ids: 00000000-0000-0000-0000-0000000330xx.

begin;
select plan(5);

insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000033001', 'Default Charging Tier', 6000, 60000, null);

insert into gyms (id, name, tier_id, status) values
  ('00000000-0000-0000-0000-000000033011', 'Default Gym New', '00000000-0000-0000-0000-000000033001', 'active');

insert into gyms (id, name, tier_id, status, charge_guests_per_session) values
  ('00000000-0000-0000-0000-000000033012', 'Default Gym Explicit Off', '00000000-0000-0000-0000-000000033001', 'active', false);

select is(
  (select charge_guests_per_session from gyms where id = '00000000-0000-0000-0000-000000033011'),
  true,
  'a gym created without the column starts with charging on'
);

select is(
  (select charge_guests_per_session from gyms where id = '00000000-0000-0000-0000-000000033012'),
  false,
  'an explicit false is kept'
);

select is(
  (select column_default from information_schema.columns
   where table_schema = 'public' and table_name = 'gyms' and column_name = 'charge_guests_per_session'),
  'true',
  'column default is true'
);

select is(
  (select is_nullable from information_schema.columns
   where table_schema = 'public' and table_name = 'gyms' and column_name = 'charge_guests_per_session'),
  'NO',
  'column is still NOT NULL'
);

select throws_ok(
  $$ insert into gyms (id, name, tier_id, status, charge_guests_per_session)
     values ('00000000-0000-0000-0000-000000033013', 'Null Flag Gym', '00000000-0000-0000-0000-000000033001', 'active', null) $$,
  '23502',
  null,
  'a null flag is still refused'
);

select * from finish();
rollback;
