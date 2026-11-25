-- Migration 0195: the controlled city list holds the main towns of the 49 Sub-Saharan target countries (owner decision 2026-11-25).

begin;
select plan(13);

create temp table target (code text primary key) on commit drop;
insert into target (code) values
  ('AO'),('BJ'),('BW'),('BF'),('BI'),('CM'),('CV'),('CF'),('TD'),('KM'),('CG'),('CD'),('CI'),('DJ'),('GQ'),('ER'),('SZ'),('ET'),('GA'),('GM'),('GH'),('GN'),('GW'),('KE'),('LS'),
  ('LR'),('MG'),('MW'),('ML'),('MR'),('MU'),('MZ'),('NA'),('NE'),('NG'),('RW'),('ST'),('SN'),('SC'),('SL'),('SO'),('ZA'),('SS'),('SD'),('TZ'),('TG'),('UG'),('ZM'),('ZW');

select is((select count(*)::int from target), 49, 'the target list has 49 countries');
select is((select count(*)::int from target t where not exists (select 1 from public.cities c where c.country_code = t.code)), 0,
  'every target country has at least one town');
select is((select count(*)::int from public.cities c where c.country_code not in (select code from target)), 0,
  'no town belongs to a country outside the target list');
select cmp_ok((select count(*)::int from public.cities), '>=', 650, 'the list holds the seeded main towns (650 or more)');
select is((select count(*)::int from public.cities c where (select count(*) from public.city_aliases a where a.city_id = c.id and a.is_name) <> 1), 0,
  'every town has exactly one name alias');
select is((select count(*)::int from public.cities c where c.lat is null or c.lng is null or c.lat not between -36 and 25 or c.lng not between -26 and 60), 0,
  'every town has coordinates inside the Sub-Saharan bounding box (islands included)');
select is((select count(*)::int from public.cities where slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(slug) > 60), 0, 'every slug is well formed');

-- Known towns, reached by a typed spelling without accents.
select is((select c.name from public.city_aliases a join public.cities c on c.id = a.city_id where a.country_code = 'CM' and a.alias_norm = private.place_norm('Yaounde')), 'Yaoundé',
  'Cameroon: "Yaounde" reaches Yaoundé');
select is((select count(*)::int from public.cities where country_code = 'CM' and slug in ('douala', 'yaounde', 'edea', 'kumba', 'nkongsamba')), 5,
  'Cameroon keeps its starters and gains Edéa, Kumba and Nkongsamba');
select is((select count(*)::int from public.cities where (country_code, slug) in (('CI', 'abidjan'), ('NG', 'lagos'), ('KE', 'nairobi'), ('SN', 'dakar'), ('CD', 'kinshasa'), ('ZA', 'johannesburg'))), 6,
  'the large towns of six other countries are present');

-- Towns the source files under the wrong country (found 2026-11-25): Ebebiyin is in Equatorial Guinea, Kaedi in Mauritania.
select is((select array_agg(country_code order by country_code) from public.cities where slug = 'ebebiyin'), array['GQ'], 'Ebebiyín is in Equatorial Guinea only, not Gabon');
select is((select array_agg(country_code order by country_code) from public.cities where slug = 'kaedi'), array['MR'], 'Kaédi is in Mauritania only, not Senegal');

-- The twelve Cameroon starters were not duplicated.
select is((select count(*)::int from public.cities where country_code = 'CM' and slug = 'yaounde'), 1, 'a starter town exists once');

select * from finish();
rollback;
