-- Story 25.1: country and city controlled lists, gym city selection (migration 0169). Fixture ids: 00000000-0000-0000-0000-0000002501xx
--   gyms 11-15, users 21-30, members 31-40, plans 41-43.
--
-- The refresh triggers are DEFERRED constraint triggers (they judge a transaction's final state, at commit). This whole file is one
-- transaction, so `pg_temp.settle()` stands for "commit": it fires the pending triggers now.
begin;
select plan(233);

create or replace function pg_temp.claims(uid text, app_role text, gym text default null, sid text default null) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"' || uid || '","role":"authenticated","aal":"aal2"'
    || case when sid is null then '' else ',"session_id":"' || sid || '"' end
    || case when app_role is null then '' else ',"app_role":"' || app_role || '"' end
    || case when gym is null then '' else ',"gym_id":"' || gym || '"' end || '}', true);
end $f$;
create or replace function pg_temp.err(stmt text) returns text language plpgsql as $f$
begin execute stmt; return 'ok'; exception when others then return sqlstate || ':' || sqlerrm; end $f$;
create or replace function pg_temp.val(stmt text) returns text language plpgsql as $f$
declare v text; begin execute stmt into v; return coalesce(v, 'null'); exception when others then return sqlstate || ':' || sqlerrm; end $f$;
create or replace function pg_temp.rows(stmt text) returns text language plpgsql as $f$
declare n bigint;
begin execute stmt; get diagnostics n = row_count; return n::text; exception when others then return sqlstate || ':' || sqlerrm; end $f$;
create or replace function pg_temp.settle() returns void language plpgsql as $f$ begin set constraints all immediate; set constraints all deferred; end $f$;
create or replace function pg_temp.g(c text) returns text language sql immutable as $f$
  select '00000000-0000-0000-0000-0000002501' || case c when 'A' then '11' when 'B' then '12' when 'S' then '13' when 'L' then '14' when 'M' then '15' end $f$;
create or replace function pg_temp.u(c text) returns text language sql immutable as $f$
  select '00000000-0000-0000-0000-0000002501' || case c when 'ownerA' then '21' when 'supA' then '22' when 'mgrA' then '23' when 'coachA' then '24' when 'memberA' then '25'
    when 'ownerB' then '26' when 'ownerS' then '27' when 'admin' then '28' when 'support' then '29' when 'ownerL' then '30' end $f$;
-- the id of a city by country and slug (read as postgres, so a call made under a client role needs no table grant)
create or replace function pg_temp.cid(cc text, slug text) returns uuid language sql stable security definer as $f$
  select id from public.cities c where c.country_code = cc and c.slug = cid.slug $f$;
create or replace function pg_temp.loc(gym text, cc text, slug text) returns text language sql stable as $f$
  select format($q$select set_gym_location(%L, %L, %L)$q$, pg_temp.g(gym), cc, pg_temp.cid(cc, slug)) $f$;
create or replace function pg_temp.gcity(gym text) returns text language sql stable security definer as $f$
  select coalesce(g.country || ':' || c.slug, g.country || ':-') from public.gyms g left join public.cities c on c.id = g.city_id where g.id = pg_temp.g(gym)::uuid $f$;
create or replace function pg_temp.page(gym text, col text) returns text language plpgsql security definer as $f$
declare v text; begin execute format('select %s::text from public.gym_pages where gym_id = %L', col, pg_temp.g(gym)) into v; return coalesce(v, 'null'); end $f$;
create or replace function pg_temp.missing(gym text) returns text language sql security definer as $f$ select array_to_string(private.gym_page_gate_missing(pg_temp.g(gym)::uuid), ',') $f$;
create or replace function pg_temp.dk(n int) returns text language sql immutable as $f$ select 'bbbbbbbb-bbbb-bbbb-bbbb-' || lpad(n::text, 12, '0') || '.webp' $f$;
-- a gym brought to publishable and published in one call (the caller's claims must be a Super Admin's)
create or replace function pg_temp.complete(gym text, nm text, plan_id text, n int, cc text, slug text) returns text language plpgsql as $f$
begin
  perform set_gym_page_content(pg_temp.g(gym)::uuid,
    jsonb_build_object('about_en', repeat('This gym is complete. ', 6), 'contact_phone', '+237600555000',
                       'hours', '{"mon":{"open":"06:00","close":"22:00"},"sun":null}'::jsonb),
    jsonb_build_array(jsonb_build_object('plan_id', plan_id, 'is_public', true)));
  perform set_gym_location(pg_temp.g(gym)::uuid, cc, pg_temp.cid(cc, slug));
  perform claim_page_name(pg_temp.g(gym)::uuid, nm);
  perform register_page_media(pg_temp.g(gym)::uuid, 'logo', pg_temp.g(gym) || '/aaaaaaaa-aaaa-aaaa-aaaa-' || lpad(n::text, 12, '0'), pg_temp.dk(n), true, 'v1');
  perform register_page_media(pg_temp.g(gym)::uuid, 'banner', pg_temp.g(gym) || '/aaaaaaaa-aaaa-aaaa-aaaa-' || lpad((n + 1)::text, 12, '0'), pg_temp.dk(n + 1), true, 'v1');
  return publish_gym_page(pg_temp.g(gym)::uuid, 'classic')::text;
end $f$;

-- ---- fixtures ----------------------------------------------------------------------------------------------------
insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000250101', 'Cities Tier', 5000, 50000, null);
insert into gyms (id, name, tier_id) values
  (pg_temp.g('A')::uuid, 'Cities Gym A', '00000000-0000-0000-0000-000000250101'),
  (pg_temp.g('B')::uuid, 'Cities Gym B', '00000000-0000-0000-0000-000000250101'),
  (pg_temp.g('L')::uuid, 'Cities Gym L', '00000000-0000-0000-0000-000000250101'),
  (pg_temp.g('M')::uuid, 'Cities Gym M', '00000000-0000-0000-0000-000000250101');
insert into gyms (id, name, tier_id, status) values
  (pg_temp.g('S')::uuid, 'Cities Gym Suspended', '00000000-0000-0000-0000-000000250101', 'suspended');
insert into auth.users (id, email, email_confirmed_at) values
  (pg_temp.u('ownerA')::uuid, 'ownerA-2501@x.example', now()),
  (pg_temp.u('supA')::uuid, 'supA-2501@x.example', now()),
  (pg_temp.u('mgrA')::uuid, 'mgrA-2501@x.example', now()),
  (pg_temp.u('coachA')::uuid, 'coachA-2501@x.example', now()),
  (pg_temp.u('memberA')::uuid, 'memberA-2501@x.example', now()),
  (pg_temp.u('ownerB')::uuid, 'ownerB-2501@x.example', now()),
  (pg_temp.u('ownerS')::uuid, 'ownerS-2501@x.example', now()),
  (pg_temp.u('ownerL')::uuid, 'ownerL-2501@x.example', now()),
  (pg_temp.u('admin')::uuid, 'admin-2501@x.example', now()),
  (pg_temp.u('support')::uuid, 'sup-2501@gymosapps.com', now());
update users set is_super_admin = true where id = pg_temp.u('admin')::uuid;
insert into members (id, gym_id, user_id, role, name, phone, join_date) values
  ('00000000-0000-0000-0000-000000250131', pg_temp.g('A')::uuid, pg_temp.u('ownerA')::uuid, 'owner',      'CT Owner A',      '+237600250001', current_date),
  ('00000000-0000-0000-0000-000000250132', pg_temp.g('A')::uuid, pg_temp.u('supA')::uuid,   'supervisor', 'CT Supervisor A', '+237600250002', current_date),
  ('00000000-0000-0000-0000-000000250133', pg_temp.g('A')::uuid, pg_temp.u('mgrA')::uuid,   'manager',    'CT Manager A',    '+237600250003', current_date),
  ('00000000-0000-0000-0000-000000250134', pg_temp.g('A')::uuid, pg_temp.u('coachA')::uuid, 'coach',      'CT Coach A',      '+237600250004', current_date),
  ('00000000-0000-0000-0000-000000250135', pg_temp.g('A')::uuid, pg_temp.u('memberA')::uuid,'member',     'CT Member A',     null, current_date),
  ('00000000-0000-0000-0000-000000250136', pg_temp.g('B')::uuid, pg_temp.u('ownerB')::uuid, 'owner',      'CT Owner B',      '+237600250006', current_date),
  ('00000000-0000-0000-0000-000000250137', pg_temp.g('S')::uuid, pg_temp.u('ownerS')::uuid, 'owner',      'CT Owner S',      '+237600250007', current_date),
  ('00000000-0000-0000-0000-000000250138', pg_temp.g('L')::uuid, pg_temp.u('ownerL')::uuid, 'owner',      'CT Owner L',      '+237600250008', current_date);
insert into plans (id, gym_id, name, plan_type, price, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000250141', pg_temp.g('A')::uuid, 'Monthly', 'monthly', 10000, 'monthly', 30),
  ('00000000-0000-0000-0000-000000250142', pg_temp.g('L')::uuid, 'Monthly', 'monthly', 10000, 'monthly', 30),
  ('00000000-0000-0000-0000-000000250143', pg_temp.g('M')::uuid, 'Monthly', 'monthly', 10000, 'monthly', 30);

-- support: live and assigned to gym A
insert into private.support_accounts (user_id, activated_at) values (pg_temp.u('support')::uuid, now());
insert into public.support_assignments (id, support_user_id, gym_id, state, activated_at) values
  ('00000000-0000-0000-0000-000000250151', pg_temp.u('support')::uuid, pg_temp.g('A')::uuid, 'active', now());
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000250a1', pg_temp.u('support')::uuid, now(), now());
insert into private.support_session_state (session_id, user_id, started_at, last_seen_at)
values ('00000000-0000-0000-0000-0000000250a1', pg_temp.u('support')::uuid, now(), now());
select private.support_set_membership('00000000-0000-0000-0000-000000250151', true);

-- ---- the normalizer: ONE fixture, also run by packages/types/src/placeNorm.test.ts against the TypeScript twin ------------
-- FIXTURE:BEGIN
create temp table fxdoc as select $fx${
  "_comment": "Story 25.1. ONE fixture for the place normalizer, run by packages/types/src/placeNorm.test.ts (the TypeScript twin placeNorm / placeSlug) and supabase/tests/countries_cities.test.sql (private.place_norm / private.place_slug, migration 0169). The pgTAP file embeds this file between FIXTURE:BEGIN and FIXTURE:END markers; the vitest fails when the two differ. Each case gives the typed text and the expected normalized form and slug. U+0130 (dotted capital I) is deliberately absent: JavaScript and Postgres lower-case it differently.",
  "cases": [
    { "id": "plain", "input": "Douala", "norm": "douala", "slug": "douala" },
    { "id": "accent", "input": "Yaoundé", "norm": "yaounde", "slug": "yaounde" },
    { "id": "decomposed_accent", "input": "Yaounde\u0301", "norm": "yaounde", "slug": "yaounde" },
    { "id": "accent_missing", "input": "Yaounde", "norm": "yaounde", "slug": "yaounde" },
    { "id": "upper_accent", "input": "ÉBOLOWA", "norm": "ebolowa", "slug": "ebolowa" },
    { "id": "double_accent", "input": "Ngaoundéré", "norm": "ngaoundere", "slug": "ngaoundere" },
    { "id": "outer_space", "input": "  Douala  ", "norm": "douala", "slug": "douala" },
    { "id": "inner_spaces", "input": "Saint   Louis", "norm": "saint louis", "slug": "saint-louis" },
    { "id": "hyphen", "input": "Port-Gentil", "norm": "port gentil", "slug": "port-gentil" },
    { "id": "spaced_hyphen", "input": "Saint - Louis", "norm": "saint louis", "slug": "saint-louis" },
    { "id": "en_dash", "input": "Port–Gentil", "norm": "port gentil", "slug": "port-gentil" },
    { "id": "apostrophe", "input": "N'Djamena", "norm": "n djamena", "slug": "n-djamena" },
    { "id": "curly_apostrophe", "input": "N’Djamena", "norm": "n djamena", "slug": "n-djamena" },
    { "id": "underscore", "input": "Bamenda_North", "norm": "bamenda north", "slug": "bamenda-north" },
    { "id": "no_break_space", "input": "Mbalmayo\u00a0Centre", "norm": "mbalmayo centre", "slug": "mbalmayo-centre" },
    { "id": "tab_and_newline", "input": "Kribi\t\nPort", "norm": "kribi port", "slug": "kribi-port" },
    { "id": "ligature_oe", "input": "Cœur d'Alène", "norm": "coeur d alene", "slug": "coeur-d-alene" },
    { "id": "sharp_s", "input": "Straße", "norm": "strasse", "slug": "strasse" },
    { "id": "stroke_l", "input": "Łódź", "norm": "lodz", "slug": "lodz" },
    { "id": "tilde", "input": "São Tomé", "norm": "sao tome", "slug": "sao-tome" },
    { "id": "umlaut", "input": "Zürich", "norm": "zurich", "slug": "zurich" },
    { "id": "ring", "input": "Åre", "norm": "are", "slug": "are" },
    { "id": "cedilla", "input": "Garçon", "norm": "garcon", "slug": "garcon" },
    { "id": "parentheses", "input": "Mbalmayo (Centre)", "norm": "mbalmayo (centre)", "slug": "mbalmayo-centre" },
    { "id": "digits", "input": "Zone 3", "norm": "zone 3", "slug": "zone-3" },
    { "id": "only_separators", "input": " - ' _ ", "norm": "", "slug": "" },
    { "id": "empty", "input": "", "norm": "", "slug": "" },
    { "id": "non_latin", "input": "東京", "norm": "東京", "slug": "" }
  ]
}$fx$::jsonb as doc;
-- FIXTURE:END
select is((select jsonb_array_length(doc -> 'cases') from fxdoc), 28, 'the fixture has its cases');
select is((select array_agg(c ->> 'id' order by c ->> 'id') from fxdoc, jsonb_array_elements(doc -> 'cases') c
            where private.place_norm(c ->> 'input') is distinct from c ->> 'norm'), null, 'place_norm gives the fixture''s normalized form for every case');
select is((select array_agg(c ->> 'id' order by c ->> 'id') from fxdoc, jsonb_array_elements(doc -> 'cases') c
            where private.place_slug(c ->> 'input') is distinct from c ->> 'slug'), null, 'place_slug gives the fixture''s slug for every case');
select is(private.place_norm(null), '', 'a null is the empty form');
select ok(private.place_norm('Yaounde') = private.place_norm('Yaoundé ') and private.place_norm('douala') = private.place_norm('DOUALA'), 'typed spellings of one city meet at one normalized form');

-- ============================================================================================================
-- A. the lists, their constraints, and who can read or write them
-- ============================================================================================================
select is((select count(*)::int from countries), 249, 'countries holds the 249 ISO 3166-1 alpha-2 codes');
select is((select name_en || '|' || name_fr from countries where code = 'CM'), 'Cameroon|Cameroun', 'a country has an English and a French name');
select is((select array_agg(slug order by slug) from cities where country_code = 'CM'),
          array['bafoussam', 'bamenda', 'bertoua', 'buea', 'douala', 'ebolowa', 'garoua', 'kribi', 'limbe', 'maroua', 'ngaoundere', 'yaounde'],
          'the twelve Cameroon starter cities are seeded');
select is((select count(*)::int from cities where country_code = 'CM' and lat is not null and lng is not null), 12, 'every starter city has coordinates');
select is((select name from cities where country_code = 'CM' and slug = 'yaounde'), 'Yaoundé', 'the display name keeps its accent while the slug is ASCII');
select is((select count(*)::int from cities c where not exists
            (select 1 from city_aliases a where a.city_id = c.id and a.is_name and a.alias_norm = private.place_norm(c.name) and a.country_code = c.country_code)), 0,
          'every city answers to its own name (one is_name alias row)');
select is((select count(*)::int from cities where country_code <> 'CM'), 0, 'nothing else is seeded: no other country has a city');

-- constraints (as postgres: the table CHECKs and uniques hold on their own)
select throws_ok($$insert into cities (country_code, slug, name) values ('CM', 'Bad Slug', 'X')$$, '23514', null, 'CHECK: a slug is lowercase ASCII with single hyphens');
select throws_ok($$insert into cities (country_code, slug, name) values ('CM', 'x--y', 'X')$$, '23514', null, 'CHECK: no double hyphen in a slug');
select throws_ok($$insert into cities (country_code, slug, name) values ('CM', '-x', 'X')$$, '23514', null, 'CHECK: no leading hyphen in a slug');
select throws_ok($$insert into cities (country_code, slug, name) values ('CM', 'douala', 'Douala Two')$$, '23505', null, 'UNIQUE: one slug per country');
select throws_ok($$insert into cities (country_code, slug, name, lat) values ('CM', 'half', 'Half', 4.0)$$, '23514', null, 'CHECK: latitude without longitude');
select throws_ok($$insert into cities (country_code, slug, name, lat, lng) values ('CM', 'far', 'Far', 91, 10)$$, '23514', null, 'CHECK: latitude 91');
select throws_ok($$insert into cities (country_code, slug, name, lat, lng) values ('CM', 'far', 'Far', 10, 181)$$, '23514', null, 'CHECK: longitude 181');
select throws_ok($$insert into cities (country_code, slug, name) values ('CM', 'markup', '<b>Markup</b>')$$, '23514', null, 'CHECK: markup in a city name');
select throws_ok($$insert into cities (country_code, slug, name) values ('CM', 'ctl', 'Dou' || chr(5) || 'ala')$$, '23514', null, 'CHECK: a control character in a city name (so the gate''s bad_text can never be tripped by a city)');
select throws_ok($$insert into cities (country_code, slug, name) values ('CM', 'pad', ' Padded')$$, '23514', null, 'CHECK: a city name is stored trimmed');
select throws_ok($$insert into cities (country_code, slug, name) values ('ZZ', 'nowhere', 'Nowhere')$$, '23503', null, 'FOREIGN KEY: a city belongs to a listed country');
select throws_ok($$insert into countries (code, name_en, name_fr) values ('cm', 'x', 'x')$$, '23514', null, 'CHECK: a country code is two upper-case letters');
select throws_ok(format($q$insert into city_aliases (country_code, alias_norm, alias, city_id) values ('CM', 'douala', 'Douala again', %L)$q$, pg_temp.cid('CM', 'yaounde')), '23505', null,
                 'UNIQUE: one spelling answers to one city per country (AD-49)');
select throws_ok(format($q$insert into city_aliases (country_code, alias_norm, alias, city_id) values ('CM', '', ' ', %L)$q$, pg_temp.cid('CM', 'yaounde')), '23514', null, 'CHECK: an alias is never empty');
select throws_ok(format($q$insert into city_aliases (country_code, alias_norm, alias, city_id, is_name) values ('CM', 'second name', 'Second name', %L, true)$q$, pg_temp.cid('CM', 'douala')), '23505', null,
                 'UNIQUE: a city has one name row');

-- a city is never deleted, and the table is never truncated
select throws_ok($$delete from cities where slug = 'douala'$$, 'P0001', 'cities: a city is never deleted', 'a city cannot be deleted (even as postgres)');
select throws_ok($$truncate cities cascade$$, 'P0001', 'cities: a city is never deleted', 'and the table cannot be truncated');

-- RLS and grants
select is((select array_agg(c.relname::text order by c.relname) from pg_class c
            where c.relnamespace = 'public'::regnamespace and c.relname in ('countries', 'cities', 'city_aliases', 'city_slug_history') and c.relrowsecurity),
          array['cities', 'city_aliases', 'city_slug_history', 'countries'], 'row level security is on for all four tables');
select is((select array_agg(tablename::text || ':' || cmd order by tablename) from pg_policies where schemaname = 'public' and tablename in ('countries', 'cities', 'city_aliases', 'city_slug_history')),
          array['cities:SELECT', 'city_aliases:SELECT', 'countries:SELECT'], 'the only policies are three SELECT policies (no write policy; the history table has none)');
select is((select count(*)::int from (values ('public'), ('anon'), ('service_role'), ('public_site_reader')) r(role),
                 (values ('public.countries'), ('public.cities'), ('public.city_aliases'), ('public.city_slug_history')) t(tbl),
                 (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(priv)
            where has_table_privilege(r.role, t.tbl, p.priv)), 0, 'anon, service_role, PUBLIC and public_site_reader hold no privilege on any of the four tables');
select is((select array_agg(tbl order by tbl) from (values ('public.countries'), ('public.cities'), ('public.city_aliases'), ('public.city_slug_history')) t(tbl)
            where has_table_privilege('authenticated', t.tbl, 'SELECT')), array['public.cities', 'public.city_aliases', 'public.countries'], 'authenticated reads the three lists, never the history');
select is((select count(*)::int from (values ('public.countries'), ('public.cities'), ('public.city_aliases'), ('public.city_slug_history')) t(tbl),
                 (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(priv)
            where has_table_privilege('authenticated', t.tbl, p.priv)), 0, 'authenticated writes none of them');
grant public_site_reader to postgres with set true;
create or replace function pg_temp.as_reader(q text) returns text language plpgsql as $f$
declare v text;
begin
  set local role public_site_reader;
  execute q into v;
  reset role;
  return coalesce(v, 'NULL');
exception when others then
  reset role;
  return 'ERR:' || sqlstate;
end $f$;
set local role anon;
select is(pg_temp.val($$select count(*) from cities$$), '42501:permission denied for table cities', 'anon cannot read cities');
reset role;
select is(pg_temp.as_reader('select count(*) from public.countries'), 'ERR:42501', 'the public site reader cannot read countries');
select is(pg_temp.as_reader('select count(*) from public.city_aliases'), 'ERR:42501', 'nor city_aliases');
select is(pg_temp.as_reader('select count(*) from public.cities'), 'ERR:42501', 'nor cities');
set local role authenticated;
select pg_temp.claims(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.val($$select count(*) from cities$$), '12', 'an Owner reads the cities');
select is(pg_temp.val($$select count(*) from countries$$), '249', 'and the countries');
select is(pg_temp.val($$select name from cities where slug = 'douala' and country_code = 'CM'$$), 'Douala', 'and a city''s name');
select is(pg_temp.val($$select count(*) from city_slug_history$$), '42501:permission denied for table city_slug_history', 'the slug history is not client readable');
select is(pg_temp.err($$insert into cities (country_code, slug, name) values ('CM', 'sneaky', 'Sneaky')$$), '42501:permission denied for table cities', 'an Owner cannot insert a city');
select is(pg_temp.err($$update cities set name = 'Hijack' where slug = 'douala'$$), '42501:permission denied for table cities', 'an Owner cannot rename a city');
select is(pg_temp.err($$delete from city_aliases$$), '42501:permission denied for table city_aliases', 'an Owner cannot delete an alias');
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select is(pg_temp.err($$insert into cities (country_code, slug, name) values ('CM', 'sneaky', 'Sneaky')$$), '42501:permission denied for table cities', 'not even a Super Admin writes the table directly (only add_city / update_city do)');
reset role;
select is((select attnotnull from pg_attribute where attrelid = 'public.gyms'::regclass and attname = 'city_id'), false, 'gyms.city_id is nullable');
select is((select confrelid::regclass::text from pg_constraint where conrelid = 'public.gyms'::regclass and contype = 'f' and conkey = array[(select attnum from pg_attribute where attrelid = 'public.gyms'::regclass and attname = 'city_id')]),
          'cities', 'gyms.city_id references cities');
select is((select count(*)::int from pg_constraint where conrelid = 'public.gyms'::regclass and contype = 'f' and conkey = array[(select attnum from pg_attribute where attrelid = 'public.gyms'::regclass and attname = 'country')]), 0,
          'gyms.country has no foreign key (libphonenumber-era values may not all be ISO)');
select is((select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'gyms' and column_name = 'page_city'), 1, 'gyms.page_city is kept (unused)');

-- ============================================================================================================
-- B. functions: privileges, shape, and every consumer of the city
-- ============================================================================================================
select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname in ('add_city', 'update_city', 'list_gyms_without_city', 'set_gym_location')
            and prosecdef and proconfig = array['search_path=public']), 4, 'the four public functions are security definer with a pinned search_path');
select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname in ('add_city', 'update_city', 'list_gyms_without_city', 'set_gym_location')
            and (has_function_privilege('anon', oid, 'execute') or has_function_privilege('public', oid, 'execute'))), 0, 'none is executable by anon or PUBLIC');
select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname in ('add_city', 'update_city', 'list_gyms_without_city', 'set_gym_location')
            and has_function_privilege('authenticated', oid, 'execute')), 4, 'all four are executable by authenticated (the body gates them)');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'private'::regnamespace
            and (p.proname like 'place\_%' or p.proname like 'city\_%' or p.proname like 'cities\_%' or p.proname in ('pin_gym_city_id', 'clear_gym_city_on_country_change', 'gym_page_refresh_from_city'))
            and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))), 0,
          'no private 25.1 function is executable by a client role');
select is((select count(*)::int from private.support_capabilities where capability = 'gym_page' and kind = 'rpc' and object_name = 'set_gym_location'), 1, 'set_gym_location has its support capability row');
select is((select count(*)::int from private.support_capabilities where object_name in ('add_city', 'update_city', 'list_gyms_without_city')), 0, 'and the three Super Admin functions have none (support stays denied)');
select is((select count(*)::int from private.support_audit_actions where action_type = 'gym_location_updated'), 1, 'the audit type is on the support allow-list');
select is((select (regexp_match(prosrc, 'support_rpc_role\(''set_gym_location''\) in \(([^)]*)\)'))[1] from pg_proc where proname = 'set_gym_location'),
          '''owner'', ''supervisor''', 'the setter admits exactly owner and supervisor (plus Super Admin and live support at the supervisor ceiling)');
-- consumers of the legacy text: exactly two functions read gyms.page_city (the pin that guards it, and the list that shows it for hand mapping)
select is((select array_agg(p.proname::text order by p.proname) from pg_proc p
            where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace, 'public_site'::regnamespace) and p.prosrc ~ 'page_city'),
          array['list_gyms_without_city', 'pin_gym_page_content'], 'CONSUMERS of page_city: only the 0161 pin and list_gyms_without_city (the gate, snapshot, status and refresh trigger do not read it)');
-- consumers of the city: the gate, the snapshot, the status, the bad-text listing, the city writers and readers, the triggers
select is((select array_agg(p.proname::text order by p.proname) from pg_proc p
            where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace, 'public_site'::regnamespace) and p.prosrc ~ 'city_id'),
          array['add_city', 'city_alias_clash', 'city_slug_check', 'clear_gym_city_on_country_change', 'get_gym_page_status', 'gym_page_bad_text_fields', 'gym_page_gate_missing',
                'gym_page_refresh_from_city', 'gym_page_snapshot', 'list_gyms_without_city', 'pin_gym_city_id', 'set_gym_location', 'update_city'],
          'CONSUMERS of city_id: every function that reads it is listed here, so a new one is a deliberate change');
select is((select array_agg(p.proname::text order by p.proname) from pg_proc p
            where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace, 'public_site'::regnamespace) and p.prosrc ~* '\mcities\M'),
          array['add_city', 'cities_refuse_delete', 'city_slug_check', 'clear_gym_city_on_country_change', 'gym_page_bad_text_fields', 'gym_page_gate_missing', 'gym_page_snapshot', 'set_gym_location', 'update_city'],
          'CONSUMERS of the cities table: listed');
select is((select array_agg(c.relname::text || '.' || t.tgname order by c.relname, t.tgname) from pg_trigger t join pg_class c on c.oid = t.tgrelid
            where not t.tgisinternal and pg_get_triggerdef(t.oid) ~ 'page_city|city_id'),
          array['gyms.gym_page_refresh', 'gyms.gyms_a_pin_city_id', 'gyms.pin_gym_page_content'], 'CONSUMERS among triggers: the refresh trigger, the city pin, the 0161 pin');
select is((select count(*)::int from pg_trigger where tgname = 'gym_page_refresh' and tgrelid = 'public.gyms'::regclass and pg_get_triggerdef(oid) ~ 'page_city'), 0, 'the gym refresh trigger no longer watches page_city');
select is((select count(*)::int from pg_trigger where tgname = 'gym_page_refresh' and tgrelid = 'public.gyms'::regclass
            and pg_get_triggerdef(oid) ~ 'UPDATE OF [^)]*city_id' and pg_get_triggerdef(oid) ~ 'old\.city_id IS DISTINCT FROM new\.city_id'), 1, 'it watches city_id in the column list and in the WHEN clause');
select is((select count(*)::int from pg_views where schemaname in ('public', 'private', 'public_site') and definition ~* 'page_city|city_id|cities'), 0, 'no view reads the city yet (the directory views are 25.2)');
select is((select count(*)::int from pg_policies where coalesce(qual, '') || coalesce(with_check, '') ~* 'city'), 0, 'no policy reads the city');
select ok((select prosrc ~ 'array_append\(v_missing, ''no_city''\)' from pg_proc where proname = 'gym_page_gate_missing'), 'the gate still has its no_city code');
select ok((select prosrc !~ 'page_city' from pg_proc where proname = 'gym_page_gate_missing'), 'and it no longer reads page_city');


-- ============================================================================================================
-- C. backfill: the same statement as 0169, on legacy text
-- ============================================================================================================
select set_config('app.gym_page_content_bypass', 'true', true);
update gyms set page_city = 'douala' where id = pg_temp.g('L')::uuid;
update gyms set page_city = 'Yaoundé ' where id = pg_temp.g('M')::uuid;
update gyms set page_city = 'Nowhere' where id = pg_temp.g('B')::uuid;
update gyms set page_city = 'douala', country = 'SN' where id = pg_temp.g('S')::uuid;
select set_config('app.gym_page_content_bypass', 'false', true);
select set_config('app.gym_location_bypass', 'true', true);
update public.gyms g
   set city_id = a.city_id
  from public.city_aliases a
 where g.city_id is null
   and g.page_city is not null
   and a.country_code = g.country
   and a.alias_norm = private.place_norm(g.page_city);
select set_config('app.gym_location_bypass', 'false', true);
select is(pg_temp.gcity('L'), 'CM:douala', 'backfill: "douala" in a Cameroon gym maps to Douala');
select is(pg_temp.gcity('M'), 'CM:yaounde', 'backfill: "Yaoundé " (accent and trailing space) maps through the alias norm');
select is(pg_temp.gcity('B'), 'CM:-', 'backfill: text that matches no alias stays unmapped');
select is(pg_temp.gcity('S'), 'SN:-', 'backfill: the alias is looked up in the gym''s OWN country, so a Senegal gym with "douala" stays unmapped');
select is(pg_temp.missing('B') like '%no_city%', true, 'an unmapped gym fails the gate with no_city');
select is(pg_temp.missing('L') like '%no_city%', false, 'a mapped gym passes the city step of the gate');
set local role authenticated;
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select is((select array_agg(l.gym_name || '|' || l.country || '|' || l.page_city order by l.gym_name) from list_gyms_without_city() l where l.gym_id::text like '00000000-0000-0000-0000-0000002501%'),
          array['CITIES GYM B|CM|Nowhere', 'CITIES GYM SUSPENDED|SN|douala'], 'list_gyms_without_city lists the unmapped gyms with their legacy text (and not the mapped ones, nor gyms with no text)');
select pg_temp.claims(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.val($$select count(*) from list_gyms_without_city()$$), 'P0001:permission denied', 'an Owner cannot list the unmapped gyms');
reset role;
set local role anon;
select is(pg_temp.val($$select count(*) from list_gyms_without_city()$$), '42501:permission denied for function list_gyms_without_city', 'anon cannot list them');
reset role;
-- the editor's alias resolution: a typed spelling reaches the same city through the normalized alias
select is((select city_id from city_aliases where country_code = 'CM' and alias_norm = private.place_norm('Yaounde')), pg_temp.cid('CM', 'yaounde'), 'typed "Yaounde" resolves to Yaoundé');
select is((select count(*)::int from city_aliases where country_code = 'CM' and alias_norm = private.place_norm('Nowhere')), 0, 'unknown text resolves to nothing (the editor then says "Ask GymOS to add it")');

-- ============================================================================================================
-- D. add_city
-- ============================================================================================================
create temp table cities_before as select count(*)::int as n from cities;
grant select on cities_before to authenticated;
set local role authenticated;
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select ok(pg_temp.val($$select add_city('CM', '  Mbouda ', null, array['Mboudah', 'MBOUDA', '  ', 'Mbouda  '], 5.6, 10.25)$$) ~ '^[0-9a-f-]{36}$', 'a Super Admin adds a city (slug derived, aliases given)');
reset role;
select is((select name || '|' || slug || '|' || lat::text || '|' || lng::text from cities where country_code = 'CM' and slug = 'mbouda'), 'Mbouda|mbouda|5.600000|10.250000', 'the city is stored trimmed with a derived slug and its coordinates');
select is((select array_agg(alias_norm || case when is_name then '*' else '' end order by alias_norm collate "C") from city_aliases where city_id = pg_temp.cid('CM', 'mbouda')),
          array['mbouda*', 'mboudah'], 'its name is an alias row, the given alias is another, and blanks and the name again are dropped');
select is((select count(*)::int from audit_log where action_type = 'city_added' and metadata ->> 'slug' = 'mbouda' and actor_id = pg_temp.u('admin')::uuid and target_entity_type = 'city'), 1, 'one audit row names the Super Admin');
select is((select metadata ->> 'name' from audit_log where action_type = 'city_added' and metadata ->> 'slug' = 'mbouda'), 'Mbouda', 'and holds the stored name');
set local role authenticated;
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select ok(pg_temp.val($$select add_city('SN', 'Dakar')$$) ~ '^[0-9a-f-]{36}$', 'a Super Admin adds a Senegal city');
select ok(pg_temp.val($$select add_city('SN', 'Douala', null, array['Yaounde'])$$) ~ '^[0-9a-f-]{36}$', 'the same name, slug and alias in ANOTHER country are fine (uniques are per country)');
select ok(pg_temp.val($$select add_city(' sn ', 'Thiès', 'thies-city')$$) ~ '^[0-9a-f-]{36}$', 'a lower-case padded country code and an explicit slug are accepted');
select pg_temp.claims(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.err($$select add_city('CM', 'Owner City')$$), 'P0001:permission denied', 'an Owner cannot add a city');
select pg_temp.claims(pg_temp.u('support'), 'support', pg_temp.g('A'), '00000000-0000-0000-0000-0000000250a1');
select is(pg_temp.err($$select add_city('CM', 'Support City')$$), 'P0001:permission denied', 'live support cannot add a city');
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select is(pg_temp.err($$select add_city('ZZ', 'Nowhere City')$$), 'P0001:add_city: unknown_country', 'unknown_country');
select is(pg_temp.err($$select add_city(null, 'Nowhere City')$$), 'P0001:add_city: unknown_country', 'unknown_country: null country');
select is(pg_temp.err($$select add_city('CM', '')$$), 'P0001:add_city: name_required', 'name_required: empty');
select is(pg_temp.err($$select add_city('CM', '   ')$$), 'P0001:add_city: name_required', 'name_required: blank');
select is(pg_temp.err($$select add_city('CM', null)$$), 'P0001:add_city: name_required', 'name_required: null');
select is(pg_temp.err($$select add_city('CM', '<b>x</b>')$$), 'P0001:add_city: name_required', 'name_required: markup');
select is(pg_temp.err($$select add_city('CM', repeat('a', 101))$$), 'P0001:add_city: name_required', 'name_required: 101 characters');
select is(pg_temp.err($$select add_city('CM', ' - ')$$), 'P0001:add_city: name_required', 'name_required: nothing left after normalizing');
select is(pg_temp.err($$select add_city('CM', 'Bad Slug One', 'Bad_Slug')$$), 'P0001:add_city: invalid_slug', 'invalid_slug: underscore');
select is(pg_temp.err($$select add_city('CM', 'Bad Slug Two', '-edge')$$), 'P0001:add_city: invalid_slug', 'invalid_slug: leading hyphen');
select is(pg_temp.err($$select add_city('CM', 'Bad Slug Three', 'a--b')$$), 'P0001:add_city: invalid_slug', 'invalid_slug: double hyphen');
select is(pg_temp.err($$select add_city('CM', 'Bad Slug Four', 'café')$$), 'P0001:add_city: invalid_slug', 'invalid_slug: not ASCII');
select is(pg_temp.err($$select add_city('CM', '東京')$$), 'P0001:add_city: invalid_slug', 'invalid_slug: a name with no ASCII letters derives an empty slug');
select is(pg_temp.err($$select add_city('CM', 'Gyms Town', 'gyms')$$), 'P0001:add_city: slug_reserved', 'slug_reserved');
select is(pg_temp.err($$select add_city('CM', 'Sitemap Town', 'sitemap')$$), 'P0001:add_city: slug_reserved', 'slug_reserved: a route word');
select is(pg_temp.err($$select add_city('CM', 'Douala Two', 'douala')$$), 'P0001:add_city: slug_taken', 'slug_taken: another city''s slug in the country');
select is(pg_temp.err($$select add_city('CM', 'Lat Only', null, '{}', 4.0, null)$$), 'P0001:add_city: invalid_coordinates', 'invalid_coordinates: latitude alone');
select is(pg_temp.err($$select add_city('CM', 'Lng Only', null, '{}', null, 4.0)$$), 'P0001:add_city: invalid_coordinates', 'invalid_coordinates: longitude alone');
select is(pg_temp.err($$select add_city('CM', 'Far North', null, '{}', 90.5, 4.0)$$), 'P0001:add_city: invalid_coordinates', 'invalid_coordinates: latitude 90.5');
select is(pg_temp.err($$select add_city('CM', 'Far East', null, '{}', 4.0, -180.1)$$), 'P0001:add_city: invalid_coordinates', 'invalid_coordinates: longitude -180.1');
select is(pg_temp.err($$select add_city('CM', 'Not A Number', null, '{}', 'NaN'::numeric, 4.0)$$), 'P0001:add_city: invalid_coordinates', 'invalid_coordinates: NaN');
select is(pg_temp.err($$select add_city('CM', 'Dual City', null, array['DOUALA'])$$), 'P0001:add_city: alias_taken', 'alias_taken: an alias equal to another city''s name');
select is(pg_temp.err($$select add_city('CM', 'Yde City', null, array['Yaoundé '])$$), 'P0001:add_city: alias_taken', 'alias_taken: an alias that normalizes to another city''s name');
select is(pg_temp.err($$select add_city('CM', 'Mboudah', null, '{}')$$), 'P0001:add_city: alias_taken', 'alias_taken: a NAME that equals another city''s alias');
select is(pg_temp.err($$select add_city('CM', 'Alias Clash', null, array['Mboudah'])$$), 'P0001:add_city: alias_taken', 'alias_taken: an alias equal to another city''s alias');
select is(pg_temp.err($$select add_city('CM', 'Long Alias', null, array[repeat('a', 101)])$$), 'P0001:add_city: invalid_alias', 'invalid_alias: 101 characters');
select is(pg_temp.err($$select add_city('CM', 'Markup Alias', null, array['<b>'])$$), 'P0001:add_city: invalid_alias', 'invalid_alias: markup');
reset role;
select is((select count(*)::int from cities) - (select n from cities_before), 4, 'only the four good calls wrote a city (every refusal wrote nothing)');
select is((select count(*)::int from city_aliases where alias_norm in ('dual city', 'yde city', 'alias clash', 'long alias', 'markup alias')), 0, 'and no alias row from a refused call');
select is((select count(*)::int from audit_log where action_type = 'city_added'), 4, 'four audit rows, one per added city');
set local role anon;
select is(pg_temp.err($$select add_city('CM', 'Anon City')$$), '42501:permission denied for function add_city', 'anon cannot execute add_city');
reset role;
select is((select count(*)::int from gyms where city_id is not null and id::text not like '00000000-0000-0000-0000-0000002501%'), 0, 'adding cities touched no other gym');

-- ============================================================================================================
-- E. update_city
-- ============================================================================================================
-- gym B points at Mbouda, so a rename can be shown not to move it
set local role authenticated;
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select is(pg_temp.err(pg_temp.loc('B', 'CM', 'mbouda')), 'ok', 'a Super Admin points gym B at Mbouda');
select is(pg_temp.err(format($q$select update_city(%L, 'Mbouda Ville', null, null, 5.6, 10.25)$q$, pg_temp.cid('CM', 'mbouda'))), 'ok', 'a Super Admin renames the city (slug and aliases kept)');
reset role;
select is((select name || '|' || slug from cities where id = pg_temp.cid('CM', 'mbouda')), 'Mbouda Ville|mbouda', 'the name changed and the slug did not');
select is((select array_agg(alias_norm || case when is_name then '*' else '' end order by alias_norm collate "C") from city_aliases where city_id = pg_temp.cid('CM', 'mbouda')),
          array['mbouda', 'mbouda ville*', 'mboudah'], 'the new name is the name row; the old name is kept as an alias');
select is(pg_temp.gcity('B'), 'CM:mbouda', 'the rename did not change the gym''s city_id');
select is((select metadata -> 'old' ->> 'name' || '>' || (metadata -> 'new' ->> 'name') from audit_log where action_type = 'city_updated' and target_entity_id = pg_temp.cid('CM', 'mbouda')::text), 'Mbouda>Mbouda Ville', 'the audit row holds the old and new name');
create temp table upd_audit as select count(*)::int as n from audit_log where action_type = 'city_updated';
grant select on upd_audit to authenticated;
set local role authenticated;
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select is(pg_temp.err(format($q$select update_city(%L, 'Mbouda Ville', 'mbouda', array['Mboudah', 'Mbouda'], 5.6, 10.25)$q$, pg_temp.cid('CM', 'mbouda'))), 'ok', 'unchanged input is accepted');
reset role;
select is((select count(*)::int from audit_log where action_type = 'city_updated') - (select n from upd_audit), 0, 'unchanged input writes no audit row');
set local role authenticated;
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select is(pg_temp.err(format($q$select update_city(%L, 'Mbouda Ville', 'mbouda-ville', null, 5.6, 10.25)$q$, pg_temp.cid('CM', 'mbouda'))), 'ok', 'a slug change');
reset role;
select is((select slug from cities where id = pg_temp.cid('CM', 'mbouda-ville')), 'mbouda-ville', 'the slug changed');
select is((select count(*)::int from city_slug_history where old_slug = 'mbouda' and country_code = 'CM' and city_id = pg_temp.cid('CM', 'mbouda-ville')), 1, 'the old slug is in the history');
select ok((select expires_at between now() + interval '12 months' - interval '1 minute' and now() + interval '12 months' + interval '1 minute' from city_slug_history where old_slug = 'mbouda'), 'for 12 months');
select is(pg_temp.gcity('B'), 'CM:mbouda-ville', 'the gym still points at the same city after its slug changed');
set local role authenticated;
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select is(pg_temp.err($$select add_city('CM', 'Mbouda Town', 'mbouda')$$), 'P0001:add_city: slug_taken', 'slug_taken: another city''s unexpired history slug');
reset role;
update city_slug_history set expires_at = now() - interval '1 day' where old_slug = 'mbouda';
set local role authenticated;
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select ok(pg_temp.val($$select add_city('CM', 'Mbouda Town', 'mbouda')$$) ~ '^[0-9a-f-]{36}$', 'the same slug is free once the history has expired');
select is(pg_temp.err(format($q$select update_city(%L, 'Mbouda Ville', 'douala', null, 5.6, 10.25)$q$, pg_temp.cid('CM', 'mbouda-ville'))), 'P0001:update_city: slug_taken', 'slug_taken on update: another city''s slug');
select is(pg_temp.err(format($q$select update_city(%L, 'Mbouda Ville', 'mbouda', null, 5.6, 10.25)$q$, pg_temp.cid('CM', 'mbouda-ville'))), 'P0001:update_city: slug_taken', 'slug_taken on update: the slug a new city took');
select is(pg_temp.err(format($q$select update_city(%L, 'Mbouda Ville', 'gyms', null, 5.6, 10.25)$q$, pg_temp.cid('CM', 'mbouda-ville'))), 'P0001:update_city: slug_reserved', 'slug_reserved on update');
select is(pg_temp.err(format($q$select update_city(%L, 'Mbouda Ville', 'Bad_Slug', null, 5.6, 10.25)$q$, pg_temp.cid('CM', 'mbouda-ville'))), 'P0001:update_city: invalid_slug', 'invalid_slug on update');
select is(pg_temp.err(format($q$select update_city(%L, 'Mbouda Ville', null, array['Douala'], 5.6, 10.25)$q$, pg_temp.cid('CM', 'mbouda-ville'))), 'P0001:update_city: alias_taken', 'alias_taken on update: another city''s name');
select is(pg_temp.err(format($q$select update_city(%L, 'Yaounde', null, null, 5.6, 10.25)$q$, pg_temp.cid('CM', 'mbouda-ville'))), 'P0001:update_city: alias_taken', 'alias_taken on update: a new NAME that normalizes to another city''s');
select is(pg_temp.err(format($q$select update_city(%L, 'Mbouda Ville', null, null, 5.6, null)$q$, pg_temp.cid('CM', 'mbouda-ville'))), 'P0001:update_city: invalid_coordinates', 'invalid_coordinates on update');
select is(pg_temp.err(format($q$select update_city(%L, '', null, null, 5.6, 10.25)$q$, pg_temp.cid('CM', 'mbouda-ville'))), 'P0001:update_city: name_required', 'name_required on update');
select is(pg_temp.err(format($q$select update_city(%L, 'Mbouda Ville', null, array[repeat('a', 101)], 5.6, 10.25)$q$, pg_temp.cid('CM', 'mbouda-ville'))), 'P0001:update_city: invalid_alias', 'invalid_alias on update');
select is(pg_temp.err($$select update_city('00000000-0000-0000-0000-000000009999', 'Ghost', null, null, null, null)$$), 'P0001:update_city: not_found', 'not_found');
select is(pg_temp.err($$select update_city(null, 'Ghost', null, null, null, null)$$), 'P0001:update_city: not_found', 'not_found: null id');
select pg_temp.claims(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.err(format($q$select update_city(%L, 'Hijack', null, null, null, null)$q$, pg_temp.cid('CM', 'douala'))), 'P0001:permission denied', 'an Owner cannot edit a city');
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select is(pg_temp.err(format($q$select update_city(%L, 'Mbouda Ville', null, array['Mboudah'], null, null)$q$, pg_temp.cid('CM', 'mbouda-ville'))), 'ok', 'the coordinates are cleared with null and null, and the alias list is replaced');
reset role;
select is((select lat is null and lng is null from cities where id = pg_temp.cid('CM', 'mbouda-ville')), true, 'both coordinates read null');
select is((select array_agg(alias_norm order by alias_norm collate "C") from city_aliases where city_id = pg_temp.cid('CM', 'mbouda-ville')), array['mbouda ville', 'mboudah'], 'the alias list was replaced (the kept old name was left out)');
-- returning to a slug of its own removes that history row
set local role authenticated;
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select ok(pg_temp.val($$select add_city('CM', 'Kumba', null, '{}', 4.64, 9.45)$$) ~ '^[0-9a-f-]{36}$', 'a city to move around');
select is(pg_temp.err(format($q$select update_city(%L, 'Kumba', 'kumba-2', null, 4.64, 9.45)$q$, pg_temp.cid('CM', 'kumba'))), 'ok', 'kumba -> kumba-2');
select is(pg_temp.err(format($q$select update_city(%L, 'Kumba', 'kumba', null, 4.64, 9.45)$q$, pg_temp.cid('CM', 'kumba-2'))), 'ok', 'kumba-2 -> kumba (its own old slug)');
reset role;
select is((select array_agg(old_slug order by old_slug) from city_slug_history where city_id = pg_temp.cid('CM', 'kumba')), array['kumba-2'], 'its own old slug left the history; the slug it just left is in');
set local role anon;
select is(pg_temp.err($$select update_city('00000000-0000-0000-0000-000000009999', 'x', null, null, null, null)$$), '42501:permission denied for function update_city', 'anon cannot execute update_city');
reset role;

-- ============================================================================================================
-- F. set_gym_location: who may call it, what it accepts, what it refuses
-- ============================================================================================================
set local role authenticated;
select pg_temp.claims(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.err(pg_temp.loc('A', 'CM', 'douala')), 'ok', 'an Owner picks a country and a city');
reset role;
select is(pg_temp.gcity('A'), 'CM:douala', 'both are stored');
select is((select count(*)::int from audit_log where action_type = 'gym_location_updated' and gym_id = pg_temp.g('A')::uuid), 1, 'one audit row');
select is((select metadata -> 'new' ->> 'city' || '|' || (metadata -> 'new' ->> 'country') || '|' || coalesce(metadata -> 'old' ->> 'city', 'none') from audit_log where action_type = 'gym_location_updated' and gym_id = pg_temp.g('A')::uuid),
          'Douala|CM|none', 'it holds the new city and country and the old city');
select is((select actor_id from audit_log where action_type = 'gym_location_updated' and gym_id = pg_temp.g('A')::uuid), pg_temp.u('ownerA')::uuid, 'and names the Owner');
set local role authenticated;
select pg_temp.claims(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.err(pg_temp.loc('A', 'CM', 'douala')), 'ok', 'the same input again is accepted');
reset role;
select is((select count(*)::int from audit_log where action_type = 'gym_location_updated' and gym_id = pg_temp.g('A')::uuid), 1, 'and writes no second audit row');
-- the Supervisor changes the country AND the city (owner decision 2026-11-12)
set local role authenticated;
select pg_temp.claims(pg_temp.u('supA'), 'supervisor', pg_temp.g('A'));
select is(pg_temp.err(pg_temp.loc('A', 'SN', 'dakar')), 'ok', 'a Supervisor changes the country and picks a city of that country');
reset role;
select is(pg_temp.gcity('A'), 'SN:dakar', 'both are saved');
select is((select count(*)::int from audit_log where action_type = 'gym_location_updated' and gym_id = pg_temp.g('A')::uuid and actor_id = pg_temp.u('supA')::uuid
            and metadata -> 'old' ->> 'country' = 'CM' and metadata -> 'new' ->> 'country' = 'SN'), 1, 'and audited under the Supervisor with the old and new country');
set local role authenticated;
select pg_temp.claims(pg_temp.u('supA'), 'supervisor', pg_temp.g('A'));
select is(pg_temp.err(format($q$select set_gym_location(%L, 'CM', %L)$q$, pg_temp.g('A'), pg_temp.cid('SN', 'dakar'))), 'P0001:set_gym_location: invalid_city', 'invalid_city: a city of another country');
select is(pg_temp.err(format($q$select set_gym_location(%L, 'SN', '00000000-0000-0000-0000-000000009999')$q$, pg_temp.g('A'))), 'P0001:set_gym_location: invalid_city', 'invalid_city: an id that is no city');
select is(pg_temp.err(format($q$select set_gym_location(%L, 'ZZ', null)$q$, pg_temp.g('A'))), 'P0001:set_gym_location: unknown_country', 'unknown_country');
select is(pg_temp.err(format($q$select set_gym_location(%L, null, null)$q$, pg_temp.g('A'))), 'P0001:set_gym_location: unknown_country', 'unknown_country: null');
select is(pg_temp.err(format($q$select set_gym_location(%L, 'CM', %L)$q$, pg_temp.g('A'), pg_temp.cid('SN', 'thies-city'))), 'P0001:set_gym_location: invalid_city', 'invalid_city: a Senegal city under CM');
reset role;
select is(pg_temp.gcity('A'), 'SN:dakar', 'refused calls changed nothing');
set local role authenticated;
select pg_temp.claims(pg_temp.u('supA'), 'supervisor', pg_temp.g('A'));
select is(pg_temp.err(format($q$select set_gym_location(%L, 'sn', %L)$q$, pg_temp.g('A'), pg_temp.cid('SN', 'thies-city'))), 'ok', 'a lower-case country code is accepted');
select is(pg_temp.err(format($q$select set_gym_location(%L, 'SN', null)$q$, pg_temp.g('A'))), 'ok', 'a null city clears the city and keeps the country');
reset role;
select is(pg_temp.gcity('A'), 'SN:-', 'cleared');
set local role authenticated;
select pg_temp.claims(pg_temp.u('mgrA'), 'manager', pg_temp.g('A'));
select is(pg_temp.err(pg_temp.loc('A', 'CM', 'douala')), 'P0001:permission denied', 'a Manager is refused');
select pg_temp.claims(pg_temp.u('coachA'), 'coach', pg_temp.g('A'));
select is(pg_temp.err(pg_temp.loc('A', 'CM', 'douala')), 'P0001:permission denied', 'a Coach is refused');
select pg_temp.claims(pg_temp.u('memberA'), 'member', pg_temp.g('A'));
select is(pg_temp.err(pg_temp.loc('A', 'CM', 'douala')), 'P0001:permission denied', 'a Member is refused');
select pg_temp.claims(pg_temp.u('ownerB'), 'owner', pg_temp.g('B'));
select is(pg_temp.err(pg_temp.loc('A', 'CM', 'douala')), 'P0001:permission denied', 'another gym''s Owner is refused');
select is(pg_temp.err(format($q$select set_gym_location(null, 'CM', %L)$q$, pg_temp.cid('CM', 'douala'))), 'P0001:permission denied', 'a null gym is refused');
reset role;
set local role anon;
select is(pg_temp.err(pg_temp.loc('A', 'CM', 'douala')), '42501:permission denied for function set_gym_location', 'anon is refused');
reset role;
select is(pg_temp.gcity('A'), 'SN:-', 'refused callers changed nothing');
-- live support, assigned to gym A
set local role authenticated;
select pg_temp.claims(pg_temp.u('support'), 'support', pg_temp.g('A'), '00000000-0000-0000-0000-0000000250a1');
select is(pg_temp.err(pg_temp.loc('A', 'CM', 'limbe')), 'ok', 'assigned live support is admitted');
select pg_temp.claims(pg_temp.u('support'), 'support', pg_temp.g('B'), '00000000-0000-0000-0000-0000000250a1');
select is(pg_temp.err(pg_temp.loc('B', 'CM', 'limbe')), 'P0001:permission denied', 'support with no assignment to that gym is refused');
reset role;
select is(pg_temp.gcity('A'), 'CM:limbe', 'the support change is stored');
select is((select count(*)::int from audit_log where action_type = 'gym_location_updated' and gym_id = pg_temp.g('A')::uuid
            and actor_id = (select id from users where support_proxy_gym_id = pg_temp.g('A')::uuid)), 1, 'and audited under the support identity');
-- Super Admin: any gym, suspended or not; a suspended gym's Owner is refused
set local role authenticated;
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select is(pg_temp.err(pg_temp.loc('S', 'SN', 'dakar')), 'ok', 'a Super Admin can write any gym, even a suspended one');
select pg_temp.claims(pg_temp.u('ownerS'), 'owner', pg_temp.g('S'));
select alike(pg_temp.err(pg_temp.loc('S', 'CM', 'douala')), 'P0001:set_gym_location: gym % is not active', 'a suspended gym''s Owner is refused');
reset role;
select is(pg_temp.gcity('S'), 'SN:dakar', 'the suspended gym keeps the Super Admin''s value');

-- ============================================================================================================
-- G. the pin: only set_gym_location writes gyms.city_id
-- ============================================================================================================
set local role authenticated;
select pg_temp.claims(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.rows(format($q$update gyms set city_id = %L where id = %L$q$, pg_temp.cid('CM', 'douala'), pg_temp.g('A'))), '1', 'a direct Owner UPDATE of city_id runs');
reset role;
select is(pg_temp.gcity('A'), 'CM:limbe', 'and the pin reverted it');
set local role authenticated;
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select is(pg_temp.rows(format($q$update gyms set city_id = %L where id = %L$q$, pg_temp.cid('CM', 'douala'), pg_temp.g('A'))), '1', 'a direct Super Admin UPDATE runs');
reset role;
select is(pg_temp.gcity('A'), 'CM:limbe', 'and is reverted: no Super Admin exemption');
set local role service_role;
select is(pg_temp.rows(format($q$update gyms set city_id = null where id = %L$q$, pg_temp.g('A'))), '1', 'a direct service_role UPDATE runs');
reset role;
select is(pg_temp.gcity('A'), 'CM:limbe', 'and is reverted: no service_role exemption');
-- the pin is what blocks it: with the trigger off the same write lands (settle first: ALTER TABLE refuses while deferred events are pending)
select pg_temp.settle();
alter table gyms disable trigger gyms_a_pin_city_id;
set local role authenticated;
select pg_temp.claims(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.rows(format($q$update gyms set city_id = %L where id = %L$q$, pg_temp.cid('CM', 'douala'), pg_temp.g('A'))), '1', 'pin off: the direct write runs');
select is(pg_temp.err(format($q$update gyms set city_id = '00000000-0000-0000-0000-000000009999' where id = %L$q$, pg_temp.g('A'))), '23503:insert or update on table "gyms" violates foreign key constraint "gyms_city_id_fkey"', 'pin off: the foreign key still refuses an id that is no city');
reset role;
select is(pg_temp.gcity('A'), 'CM:douala', 'with the pin removed the direct write lands (the pin is what blocked it)');
select pg_temp.settle();
alter table gyms enable trigger gyms_a_pin_city_id;
-- the page pin of 0161 also guards the legacy text, as before
set local role authenticated;
select pg_temp.claims(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.rows(format($q$update gyms set page_city = 'Direct' where id = %L$q$, pg_temp.g('A'))), '1', 'a direct write of the legacy page_city runs');
reset role;
select is((select page_city from gyms where id = pg_temp.g('A')::uuid), null, 'and is still reverted by the 0161 pin');

-- ============================================================================================================
-- H. a country change clears a city of another country
-- ============================================================================================================
set local role authenticated;
select pg_temp.claims(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.rows(format($q$update gyms set default_language = 'fr' where id = %L$q$, pg_temp.g('A'))), '1', 'control: an Owner''s Settings save of another column');
reset role;
select is(pg_temp.gcity('A'), 'CM:douala', 'leaves the city alone');
set local role authenticated;
select pg_temp.claims(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.rows(format($q$update gyms set country = 'CM' where id = %L$q$, pg_temp.g('A'))), '1', 'control: a Settings save that keeps the country');
reset role;
select is(pg_temp.gcity('A'), 'CM:douala', 'leaves the city alone');
set local role authenticated;
select pg_temp.claims(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.rows(format($q$update gyms set country = 'SN' where id = %L$q$, pg_temp.g('A'))), '1', 'an Owner''s Settings save changes the country');
reset role;
select is(pg_temp.gcity('A'), 'SN:-', 'and the Cameroon city is cleared');
select is(pg_temp.missing('A') like '%no_city%', true, 'so the gate answers no_city');
set local role authenticated;
select pg_temp.claims(pg_temp.u('ownerA'), 'owner', pg_temp.g('A'));
select is(pg_temp.err(pg_temp.loc('A', 'CM', 'douala')), 'ok', 'control: the Owner picks a Cameroon city again');
select is(pg_temp.rows(format($q$update gyms set country = 'SN', city_id = %L where id = %L$q$, pg_temp.cid('SN', 'dakar'), pg_temp.g('A'))), '1', 'one bare statement changes the country AND names a city of the new country');
reset role;
select is(pg_temp.gcity('A'), 'SN:-', 'the city write is pinned and the old city is cleared, so no city is left (a city is only ever chosen with set_gym_location)');
-- belt: a city outside the gym's country (reachable only by the setter's GUC) does not pass the gate
select set_config('app.gym_location_bypass', 'true', true);
update gyms set city_id = pg_temp.cid('CM', 'douala') where id = pg_temp.g('A')::uuid;
select set_config('app.gym_location_bypass', 'false', true);
select is(pg_temp.missing('A') like '%no_city%', true, 'belt: a city of another country does not satisfy the gate');
select pg_temp.settle();

-- ============================================================================================================
-- I. published pages: rename, slug change, city change, country change
-- ============================================================================================================
set local role authenticated;
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select ok(pg_temp.val($$select add_city('CM', 'Lolodorf', null, '{}', 3.23, 10.73)$$) ~ '^[0-9a-f-]{36}$', 'a city for the page tests');
select is(pg_temp.val($$select pg_temp.complete('L', 'cities-lima', '00000000-0000-0000-0000-000000250142', 1, 'CM', 'lolodorf')$$), '{"missing": [], "published": true}', 'gym L is published in Lolodorf');
select is(pg_temp.val($$select pg_temp.complete('M', 'cities-mike', '00000000-0000-0000-0000-000000250143', 3, 'CM', 'douala')$$), '{"missing": [], "published": true}', 'gym M is published in Douala');
reset role;
select is(pg_temp.page('L', 'content ->> ''city'''), 'Lolodorf', 'the snapshot carries the list''s city name');
select is(pg_temp.page('M', 'content ->> ''city'''), 'Douala', 'gym M''s snapshot says Douala');
-- rename
set local role authenticated;
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select is(pg_temp.err(format($q$select update_city(%L, 'Lolodorf Ville', null, null, 3.23, 10.73)$q$, pg_temp.cid('CM', 'lolodorf'))), 'ok', 'a Super Admin renames the city a live page uses');
reset role;
select pg_temp.settle();
select is(pg_temp.page('L', 'content ->> ''city'''), 'Lolodorf Ville', 'the dependent page is re-snapshotted');
select is(pg_temp.page('M', 'content ->> ''city'''), 'Douala', 'a page in another city is untouched');
select is(pg_temp.gcity('L'), 'CM:lolodorf', 'the gym''s city_id did not change');
select is((select count(*)::int from private.gym_page_visible v join page_names pn on pn.id = v.page_name_id where pn.gym_id = pg_temp.g('L')::uuid), 1, 'and the page is still live');
-- slug change
set local role authenticated;
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select is(pg_temp.err(format($q$select update_city(%L, 'Lolodorf Ville', 'lolodorf-ville', null, 3.23, 10.73)$q$, pg_temp.cid('CM', 'lolodorf'))), 'ok', 'a slug change on the same city');
reset role;
select pg_temp.settle();
select is((select count(*)::int from city_slug_history where old_slug = 'lolodorf' and city_id = pg_temp.cid('CM', 'lolodorf-ville')), 1, 'the old slug is in the history');
select is(pg_temp.page('L', 'content ->> ''city'''), 'Lolodorf Ville', 'the page is judged again and keeps its snapshot');
-- city change through the setter (country and city together): the gate still holds, so the page is re-snapshotted
set local role authenticated;
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select is(pg_temp.err(pg_temp.loc('L', 'SN', 'dakar')), 'ok', 'a Super Admin moves the live gym to Senegal with a Senegal city');
reset role;
select pg_temp.settle();
select is(pg_temp.page('L', 'content ->> ''country''') || '|' || pg_temp.page('L', 'content ->> ''city'''), 'SN|Dakar', 'the snapshot has the new country and city');
select is(pg_temp.page('L', 'unpublished_at'), 'null', 'and the page stays published');
-- a country change by the Settings path clears the city, the gate fails, and the page unpublishes
update gyms set country = 'GA' where id = pg_temp.g('M')::uuid;
select pg_temp.settle();
select is(pg_temp.gcity('M'), 'GA:-', 'a live gym''s country changed: its city is cleared');
select is(pg_temp.page('M', 'unpublished_reason'), 'no_city', 'the page is unpublished with the reason no_city');
select is((select count(*)::int from private.gym_page_visible v join page_names pn on pn.id = v.page_name_id where pn.gym_id = pg_temp.g('M')::uuid), 0, 'and it is no longer visible');
select is((select count(*)::int from audit_log where action_type = 'gym_page_unpublished' and gym_id = pg_temp.g('M')::uuid and metadata -> 'missing' = '["no_city"]'::jsonb), 1, 'and one audit row records the automatic unpublish');
-- a live page whose city is cleared through the setter unpublishes too
set local role authenticated;
select pg_temp.claims(pg_temp.u('admin'), 'super_admin');
select is(pg_temp.err(format($q$select set_gym_location(%L, 'SN', null)$q$, pg_temp.g('L'))), 'ok', 'a live gym''s city is cleared');
reset role;
select pg_temp.settle();
select is(pg_temp.page('L', 'unpublished_reason'), 'no_city', 'and its page unpublishes with no_city');

select * from finish();
rollback;
