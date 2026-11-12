-- Story 25.2: directory views and listing correctness (migration 0170). Fixture ids: 00000000-0000-0000-0000-0000002502xx
--   gyms 11-29 (11-13 Accra, 14 Kumasi, 15-17 Dakar, 18 Thies, 19 Pair-1, 20 Pair-2, 21 Lone, 22 Full-flow F), user 31, plan 41, tier 01.
--
-- Everything is read AS public_site_reader (pg_temp.rd), so a missing grant or a wrong column fails here too. The refresh triggers are
-- deferred constraint triggers: pg_temp.settle() stands for "commit" (the whole file is one transaction).
begin;
select plan(74);

grant public_site_reader to postgres with set true;

create or replace function pg_temp.claims(uid text, app_role text, gym text default null) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"' || uid || '","role":"authenticated","aal":"aal2"'
    || case when app_role is null then '' else ',"app_role":"' || app_role || '"' end
    || case when gym is null then '' else ',"gym_id":"' || gym || '"' end || '}', true);
end $f$;
create or replace function pg_temp.settle() returns void language plpgsql as $f$ begin set constraints all immediate; set constraints all deferred; end $f$;
-- one value as the reader, or 'ERR:<sqlstate>'
create or replace function pg_temp.rd(q text) returns text language plpgsql as $f$
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
create or replace function pg_temp.err(stmt text) returns text language plpgsql as $f$
begin execute stmt; return 'ok'; exception when others then return sqlstate || ':' || sqlerrm; end $f$;
create or replace function pg_temp.g(n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0000-0000002502' || lpad(n::text, 2, '0'))::uuid $f$;
create or replace function pg_temp.pn(n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0000-000002502a' || lpad(n::text, 2, '0'))::uuid $f$;
-- the id of a city by country and slug (read as postgres)
create or replace function pg_temp.cid(cc text, slug text) returns uuid language sql stable security definer as $f$
  select id from public.cities c where c.country_code = cc and c.slug = cid.slug $f$;
-- "<gyms in the city>/<city published_count>/<country published_count>" as the reader ('-' when the row is absent)
create or replace function pg_temp.snap(cc text, slug text) returns text language sql as $f$
  select pg_temp.rd(format($q$select (select count(*) from public_site.directory_gym where country_code = %1$L and city_slug = %2$L)
      || '/' || coalesce((select published_count::text from public_site.directory_city where country_code = %1$L and city_slug = %2$L), '-')
      || '/' || coalesce((select published_count::text from public_site.directory_country where country_code = %1$L), '-')$q$, cc, slug)) $f$;
-- a visible gym in one statement: gym, page name, live page with a snapshot
create or replace function pg_temp.vis(n int, nm text, pname text, cc text, city_id uuid, cat text, logo text default null) returns void language plpgsql as $f$
begin
  insert into public.gyms (id, name, tier_id, country, category, city_id)
  values (pg_temp.g(n), nm, '00000000-0000-0000-0000-000000250201', cc, cat, city_id);
  insert into public.page_names (id, gym_id, name, state, origin) values (pg_temp.pn(n), pg_temp.g(n), pname, 'active', 'claim');
  insert into public.gym_pages (gym_id, page_name_id, template, published_at, content)
  values (pg_temp.g(n), pg_temp.pn(n), 'classic', now(),
          jsonb_strip_nulls(jsonb_build_object('name', nm, 'country', cc, 'category', cat, 'logo', logo,
            'city', (select c.name from public.cities c where c.id = city_id),
            'map', jsonb_build_object('lat', 4.0511, 'lng', 9.7679))));
end $f$;
create or replace function pg_temp.dk(n int) returns text language sql immutable as $f$ select 'bbbbbbbb-bbbb-bbbb-bbbb-' || lpad(n::text, 12, '0') || '.webp' $f$;

-- ---- fixtures ----------------------------------------------------------------------------------------------------
insert into tiers (id, name, monthly_price, annual_price, member_cap) values ('00000000-0000-0000-0000-000000250201', 'Directory Tier', 5000, 50000, null);
insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-0000-0000-000000250231', 'admin-2502@x.example', now());
update users set is_super_admin = true where id = '00000000-0000-0000-0000-000000250231';

insert into public.cities (country_code, slug, name, lat, lng) values
  ('GH', 'dv-accra',   'Accra DV',   5.603700,  -0.187000),
  ('GH', 'dv-kumasi',  'Kumasi DV',  null,      null),
  ('SN', 'dv-dakar',   'Dakar DV',   14.716700, -17.467700),
  ('SN', 'dv-thies',   'Thies DV',   null,      null),
  ('BF', 'dv-pair',    'Pair DV',    null,      null),
  ('TG', 'dv-lone',    'Lone DV',    null,      null),
  ('KE', 'dv-nairobi', 'Nairobi DV', -1.286400, 36.817200);

-- Ghana: Accra has two visible gyms (thin), Kumasi one, so the COUNTRY has three while no city reaches three
select pg_temp.vis(11, 'DV Accra Alpha', 'dv-accra-alpha', 'GH', pg_temp.cid('GH', 'dv-accra'),  'gym', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000011.webp');
select pg_temp.vis(12, 'dv Accra beta',  'dv-accra-beta',  'GH', pg_temp.cid('GH', 'dv-accra'),  'yoga_studio');
select pg_temp.vis(14, 'DV Kumasi One',  'dv-kumasi-one',  'GH', pg_temp.cid('GH', 'dv-kumasi'), 'pilates_studio');
-- Senegal: Dakar has two (thin), Thies one; a third joins Dakar later
select pg_temp.vis(15, 'DV Dakar One',   'dv-dakar-one',   'SN', pg_temp.cid('SN', 'dv-dakar'),  'gym');
select pg_temp.vis(16, 'DV Dakar Two',   'dv-dakar-two',   'SN', pg_temp.cid('SN', 'dv-dakar'),  'fitness_center');
select pg_temp.vis(18, 'DV Thies One',   'dv-thies-one',   'SN', pg_temp.cid('SN', 'dv-thies'),  'other');
-- Burkina Faso: a pair; the second one is the subject of the removal cases (the first keeps the row alive)
select pg_temp.vis(19, 'DV Pair One',    'dv-pair-one',    'BF', pg_temp.cid('BF', 'dv-pair'),   'gym');
select pg_temp.vis(20, 'DV Pair Two',    'dv-pair-two',    'BF', pg_temp.cid('BF', 'dv-pair'),   'gym');
-- Togo: a lone gym; when it goes, the city row and the country row go too
select pg_temp.vis(21, 'DV Lone',        'dv-lone-one',    'TG', pg_temp.cid('TG', 'dv-lone'),   'gym');
-- A control row that must never appear: a gym suspended at insert (the unpublish, takedown and suspension cases are in section 5)
insert into public.gyms (id, name, tier_id, country, category, city_id, status)
values (pg_temp.g(25), 'DV Suspended At Insert', '00000000-0000-0000-0000-000000250201', 'GH', 'gym', pg_temp.cid('GH', 'dv-accra'), 'suspended');
insert into public.page_names (id, gym_id, name, state, origin) values (pg_temp.pn(25), pg_temp.g(25), 'dv-susp-insert', 'active', 'claim');
insert into public.gym_pages (gym_id, page_name_id, template, published_at, content)
values (pg_temp.g(25), pg_temp.pn(25), 'classic', now(), '{"name":"DV Suspended At Insert","country":"GH","category":"gym"}');

-- ---- 1. what each view promises ------------------------------------------------------------------------------------
select is(
  (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'private' and table_name = 'gym_page_visible'),
  array['page_name_id', 'template', 'schema_version', 'content', 'published_at', 'updated_at', 'name', 'city_id'],
  'private.gym_page_visible gains exactly one appended column, city_id');
select is(
  (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'public_site' and table_name = 'pages'),
  array['page_name_id', 'template', 'schema_version', 'content', 'published_at', 'updated_at', 'name'],
  'public_site.pages did not gain city_id');
select is(pg_temp.rd($$select count(*) from public_site.directory_gym where country_code in ('GH','SN','BF','TG')$$), '9', 'directory_gym lists the nine visible gyms with a city (the unpublished-by-suspension control is absent)');
select is(pg_temp.rd($$select string_agg(city_slug || '=' || published_count || '/' || indexable, ',' order by city_slug) from public_site.directory_city where country_code in ('GH','SN','BF','TG')$$),
  'dv-accra=2/false,dv-dakar=2/false,dv-kumasi=1/false,dv-lone=1/false,dv-pair=2/false,dv-thies=1/false',
  'directory_city: one row per city with a visible gym, counts computed on read, every one thin');
select is(pg_temp.rd($$select string_agg(country_code || '=' || published_count || '/' || indexable, ',' order by country_code) from public_site.directory_country where country_code in ('GH','SN','BF','TG')$$),
  'BF=2/false,GH=3/true,SN=3/true,TG=1/false',
  'directory_country: counted by the snapshot country; Ghana is indexable on its own count (3) while its cities (2 and 1) are not');
select is(pg_temp.rd($$select name || '|' || page_name || '|' || category || '|' || city_name || '|' || city_slug || '|' || country_code || '|' || coalesce(logo_key, 'none') from public_site.directory_gym where page_name = 'dv-accra-alpha'$$),
  'DV Accra Alpha|dv-accra-alpha|gym|Accra DV|dv-accra|GH|aaaaaaaa-aaaa-aaaa-aaaa-000000000011.webp',
  'a directory_gym row carries the gym name, page name (subdomain label), category, city, country and logo key');
select is(pg_temp.rd($$select coalesce(logo_key, 'none') from public_site.directory_gym where page_name = 'dv-accra-beta'$$), 'none', 'a gym with no logo has a null logo_key');
select is(pg_temp.rd($$select name_en || '|' || name_fr from public_site.directory_country where country_code = 'SN'$$), 'Senegal|Sénégal', 'a non-Cameroon country is listed with its own EN and FR names');
select is(pg_temp.rd($$select name_en from public_site.directory_country where country_code = 'CM'$$), 'NULL', 'nothing is added for Cameroon: with no Cameroon gym there is no Cameroon row');
select is(pg_temp.rd($$select lat || '/' || lng from public_site.directory_city where city_slug = 'dv-dakar'$$), '14.716700/-17.467700', 'directory_city returns the city''s own coordinates');
select is(pg_temp.rd($$select coalesce(lat::text, 'null') || '/' || coalesce(lng::text, 'null') from public_site.directory_city where city_slug = 'dv-thies'$$), 'null/null', 'a city with no coordinates returns null / null (never a gym position: the gym snapshots carry a map point)');
select is(pg_temp.rd($$select count(*) from public_site.directory_city where lat = 4.0511 or lng = 9.7679$$), '0', 'no gym map point leaks into directory_city');
select is(pg_temp.rd($$select count(*) from (select lower(name), page_name from public_site.directory_gym where country_code = 'GH' order by lower(name), page_name) x$$), '3', 'the reader can order by lower(name), page_name (this counts the rows only; the view promises no order)');

-- ---- 2. no internal id, no write ---------------------------------------------------------------------------------
select is(pg_temp.rd('select gym_id from public_site.directory_gym'), 'ERR:42703', 'directory_gym: gym_id is not a column');
select is(pg_temp.rd('select city_id from public_site.directory_gym'), 'ERR:42703', 'directory_gym: city_id is not a column');
select is(pg_temp.rd('select page_name_id from public_site.directory_gym'), 'ERR:42703', 'directory_gym: page_name_id is not a column');
select is(pg_temp.rd('select gym_id from public_site.directory_city'), 'ERR:42703', 'directory_city: gym_id is not a column');
select is(pg_temp.rd('select city_id from public_site.directory_city'), 'ERR:42703', 'directory_city: city_id is not a column');
select is(pg_temp.rd('select id from public_site.directory_city'), 'ERR:42703', 'directory_city: no id column');
select is(pg_temp.rd('select gym_id from public_site.directory_country'), 'ERR:42703', 'directory_country: gym_id is not a column');
select is(pg_temp.rd('select city_id from public_site.directory_country'), 'ERR:42703', 'directory_country: city_id is not a column');
select is(pg_temp.rd('select content from public_site.directory_gym'), 'ERR:42703', 'directory_gym: the snapshot content (banner, hours, plans, contact, address, map, colour) is not exposed');
select is(pg_temp.rd('select city_id from private.gym_page_visible'), 'ERR:42501', 'the reader cannot read the private predicate view');
select is(pg_temp.rd($$insert into public_site.directory_gym (name) values ('x')$$), 'ERR:55000', 'insert into directory_gym is refused');
select is(pg_temp.rd($$update public_site.directory_city set city_name = 'x'$$), 'ERR:55000', 'update through directory_city is refused');
select is(pg_temp.rd($$delete from public_site.directory_country$$), 'ERR:55000', 'delete through directory_country is refused');
select is(
  (select count(*)::int from unnest(array['public_site.directory_gym', 'public_site.directory_city', 'public_site.directory_country']) t, unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
   where has_table_privilege('public_site_reader', t, p)), 0, 'the reader holds no write privilege on the three views');
select is(
  (select count(*)::int from unnest(array['public', 'anon', 'authenticated', 'service_role']) g, unnest(array['public_site.directory_gym', 'public_site.directory_city', 'public_site.directory_country']) t, unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
   where has_table_privilege(g, t, p)), 0, 'PUBLIC, anon, authenticated, service_role hold nothing on the three views');
select is(
  (select count(*)::int from information_schema.columns where table_schema = 'public_site' and table_name like 'directory\_%' and column_name in ('gym_id', 'city_id', 'page_name_id', 'id')),
  0, 'none of the three views has an internal id column');
select is(
  (select count(*)::int from pg_class where relnamespace = 'public_site'::regnamespace and relname like 'directory\_%' and relkind = 'v' and reloptions = array['security_barrier=true']), 3,
  'all three views are security_barrier');
select is(
  (select array_agg(relowner::regrole::text) from (select distinct c.relowner from pg_class c where c.relnamespace = 'public_site'::regnamespace and c.relname like 'directory\_%') x),
  array['postgres'], 'the views are owned by the migration owner');

-- ---- 3. the one constant ----------------------------------------------------------------------------------------
select is((select min_published from private.directory_indexable_min), 3, 'the indexable threshold is the constant 3 (one-row private view)');
select is(pg_temp.rd('select min_published from private.directory_indexable_min'), 'ERR:42501', 'the reader cannot read the threshold view (no USAGE on schema private): the reader holds no privilege outside public_site');
select is(
  (select count(*)::int from unnest(array['public', 'anon', 'authenticated', 'service_role', 'public_site_reader']) g, unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
   where has_table_privilege(g, 'private.directory_indexable_min', p)),
  0, 'no client role holds a privilege on the threshold view');
select is(
  (select count(*)::int from pg_class c where c.relnamespace = 'public_site'::regnamespace and c.relname like 'directory\_%' and pg_get_viewdef(c.oid) ~ '>=\s*3\M'),
  0, 'no view embeds the number 3: the views read the one threshold view');
select is(
  (select count(*)::int from pg_class c where c.relnamespace = 'public_site'::regnamespace and c.relname like 'directory\_%' and pg_get_viewdef(c.oid) ~ 'directory_indexable_min' and c.relkind = 'v' and c.relname <> 'directory_gym'),
  2, 'directory_city and directory_country take their indexable flag from that view; directory_gym has none');

-- ---- 4. thin city, threshold, other country -------------------------------------------------------------------
select is(pg_temp.snap('SN', 'dv-dakar'), '2/2/3', 'Dakar: two visible gyms, city count 2, country count 3 (Dakar and Thies)');
select is(pg_temp.rd($$select indexable from public_site.directory_city where city_slug = 'dv-dakar'$$), 'false', 'thin city: two gyms are not indexable');
select pg_temp.vis(17, 'DV Dakar Three', 'dv-dakar-three', 'SN', pg_temp.cid('SN', 'dv-dakar'), 'gym');
select is(pg_temp.snap('SN', 'dv-dakar'), '3/3/4', 'a third visible gym in Dakar: city count 3, country count 4');
select is(pg_temp.rd($$select indexable from public_site.directory_city where city_slug = 'dv-dakar'$$), 'true', 'threshold: three gyms make the city indexable');
select is(pg_temp.rd($$select indexable from public_site.directory_city where city_slug = 'dv-thies'$$), 'false', 'a neighbouring thin city stays not indexable');
select is(pg_temp.rd($$select indexable from public_site.directory_country where country_code = 'SN'$$), 'true', 'the country row follows its own count');
select is(pg_temp.rd($$select indexable from public_site.directory_country where country_code = 'GH'$$), 'true', 'Ghana is indexable (3) although no Ghana city is');

-- ---- 5. removal: unpublish, takedown (page), takedown (name), suspension -- on all three views ------------------------
-- Pair: the subject (gym 20) leaves, its sibling (gym 19) stays, so the counts drop 2 -> 1. Lone: the only gym leaves, so the rows go.
select is(pg_temp.snap('BF', 'dv-pair'), '2/2/2', 'control: the pair shows two gyms on all three views');
select is(pg_temp.snap('TG', 'dv-lone'), '1/1/1', 'control: the lone gym shows on all three views');

update public.gym_pages set unpublished_at = now() where gym_id in (pg_temp.g(20), pg_temp.g(21));
select is(pg_temp.snap('BF', 'dv-pair'), '1/1/1', 'unpublish: the gym is gone from directory_gym and both counts dropped at once');
select is(pg_temp.snap('TG', 'dv-lone'), '0/-/-', 'unpublish: the empty city row and the empty country row disappear');
update public.gym_pages set unpublished_at = null where gym_id in (pg_temp.g(20), pg_temp.g(21));
select is(pg_temp.snap('BF', 'dv-pair') || ' ' || pg_temp.snap('TG', 'dv-lone'), '2/2/2 1/1/1', 'control: published again, everything is back');

update public.gym_pages set taken_down_at = now() where gym_id in (pg_temp.g(20), pg_temp.g(21));
select is(pg_temp.snap('BF', 'dv-pair'), '1/1/1', 'page takedown: the gym is gone from all three views, counts dropped');
select is(pg_temp.snap('TG', 'dv-lone'), '0/-/-', 'page takedown: the empty rows disappear');
update public.gym_pages set taken_down_at = null where gym_id in (pg_temp.g(20), pg_temp.g(21));

update public.page_names set taken_down_at = now() where id in (pg_temp.pn(20), pg_temp.pn(21));
select is(pg_temp.snap('BF', 'dv-pair'), '1/1/1', 'name takedown: the gym is gone from all three views, counts dropped');
select is(pg_temp.snap('TG', 'dv-lone'), '0/-/-', 'name takedown: the empty rows disappear');
update public.page_names set taken_down_at = null where id in (pg_temp.pn(20), pg_temp.pn(21));

update public.page_names set state = 'released' where id in (pg_temp.pn(20), pg_temp.pn(21));
select is(pg_temp.snap('BF', 'dv-pair') || ' ' || pg_temp.snap('TG', 'dv-lone'), '1/1/1 0/-/-', 'a name that is no longer active removes the gym too');
update public.page_names set state = 'active' where id in (pg_temp.pn(20), pg_temp.pn(21));

-- the gyms trigger pins status back for anyone but a Super Admin (0014), so the suspension is written under Super Admin claims
select pg_temp.claims('00000000-0000-0000-0000-000000250231', 'super_admin');
update public.gyms set status = 'suspended' where id in (pg_temp.g(20), pg_temp.g(21));
select is((select status::text from public.gyms where id = pg_temp.g(20)), 'suspended', 'precondition: the suspension stuck inside this transaction');
select is(pg_temp.snap('BF', 'dv-pair'), '1/1/1', 'suspension: the gym is gone from all three views, counts dropped');
select is(pg_temp.snap('TG', 'dv-lone'), '0/-/-', 'suspension: the empty rows disappear');
update public.gyms set status = 'active' where id in (pg_temp.g(20), pg_temp.g(21));
select is(pg_temp.snap('BF', 'dv-pair') || ' ' || pg_temp.snap('TG', 'dv-lone'), '2/2/2 1/1/1', 'control: reactivated, everything is back');

-- crossing the threshold downwards: Dakar loses its third gym
update public.gym_pages set unpublished_at = now() where gym_id = pg_temp.g(17);
select is(pg_temp.rd($$select published_count || '/' || indexable from public_site.directory_city where city_slug = 'dv-dakar'$$), '2/false', 'a removal that takes a city under three makes it thin again at once');
update public.gym_pages set unpublished_at = null where gym_id = pg_temp.g(17);

-- ---- 6. category filter and the move through set_gym_category (a fully published gym, the real refresh trigger) ----------
insert into public.gyms (id, name, tier_id) values (pg_temp.g(22), 'DV Full Flow', '00000000-0000-0000-0000-000000250201');
insert into plans (id, gym_id, name, plan_type, price, billing_interval, duration_days)
values ('00000000-0000-0000-0000-000000250241', pg_temp.g(22), 'Monthly', 'monthly', 10000, 'monthly', 30);

set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-000000250231', 'super_admin');
select set_gym_page_content(pg_temp.g(22),
  jsonb_build_object('about_en', repeat('This gym is complete. ', 6), 'contact_phone', '+254700555000',
                     'hours', '{"mon":{"open":"06:00","close":"22:00"},"sun":null}'::jsonb),
  jsonb_build_array(jsonb_build_object('plan_id', '00000000-0000-0000-0000-000000250241', 'is_public', true)));
select set_gym_location(pg_temp.g(22), 'KE', pg_temp.cid('KE', 'dv-nairobi'));
select claim_page_name(pg_temp.g(22), 'dv-full-flow');
select register_page_media(pg_temp.g(22), 'logo', pg_temp.g(22) || '/aaaaaaaa-aaaa-aaaa-aaaa-000000000001', pg_temp.dk(1), true, 'v1');
select register_page_media(pg_temp.g(22), 'banner', pg_temp.g(22) || '/aaaaaaaa-aaaa-aaaa-aaaa-000000000002', pg_temp.dk(2), true, 'v1');
select is(publish_gym_page(pg_temp.g(22), 'classic')::text, '{"missing": [], "published": true}', 'the full-flow gym is published in Nairobi (Kenya)');
reset role;

select is(pg_temp.snap('KE', 'dv-nairobi'), '1/1/1', 'a published gym in a non-Cameroon country appears on all three views');
select is(pg_temp.rd($$select category || '|' || logo_key from public_site.directory_gym where page_name = 'dv-full-flow'$$), 'gym|' || pg_temp.dk(1), 'the snapshot logo and the default category come through');
select is(pg_temp.rd($$select count(*) from public_site.directory_gym where country_code = 'KE' and category = 'yoga_studio'$$), '0', 'category filter: nothing in yoga_studio yet');

set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-000000250231', 'super_admin');
select set_gym_category(pg_temp.g(22), 'yoga_studio');
reset role;
select pg_temp.settle();
select is(pg_temp.rd($$select count(*) from public_site.directory_gym where country_code = 'KE' and category = 'yoga_studio'$$), '1', 'category filter: after set_gym_category the gym is in yoga_studio, with no extra code');
select is(pg_temp.rd($$select count(*) from public_site.directory_gym where country_code = 'KE' and category = 'gym'$$), '0', 'category filter: and it left the gym results');
select is(pg_temp.rd($$select count(*) from public_site.directory_gym where country_code = 'KE'$$), '1', 'the move kept the gym listed (the page was re-snapshotted, not unpublished)');

-- the Owner path: the gym's own Owner changes the category through the same function (a direct column update is pinned back by 0123)
insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-0000-0000-000000250232', 'owner-2502@x.example', now());
insert into members (id, gym_id, user_id, role, name, phone, join_date)
values ('00000000-0000-0000-0000-000000250233', pg_temp.g(22), '00000000-0000-0000-0000-000000250232', 'owner', 'DV Owner', '+254700250002', current_date);
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-000000250232', 'owner', pg_temp.g(22)::text);
select set_gym_category(pg_temp.g(22), 'pilates_studio');
reset role;
select pg_temp.settle();
select is(pg_temp.rd($$select string_agg(category, ',') from public_site.directory_gym where country_code = 'KE'$$), 'pilates_studio', 'category filter: the gym Owner moves it again through set_gym_category');

-- ---- 7. a country with a published gym and no city with a gym -------------------------------------------------------
-- Gym 22 loses its city while its page is still live: the state the gate and the 0169 triggers close within the AD-46 bound. The deferred
-- refresh is not settled, so the page is still served from its stored snapshot.
select set_config('app.gym_location_bypass', 'true', true);
update public.gyms set city_id = null where id = pg_temp.g(22);
select set_config('app.gym_location_bypass', 'false', true);
select is((select city_id is null from public.gyms where id = pg_temp.g(22)), true, 'precondition: the visible gym has no city');
select is(pg_temp.snap('KE', 'dv-nairobi'), '0/-/1', 'country without city: counted in directory_country, absent from directory_city and directory_gym');
select is(pg_temp.rd($$select country_code || '|' || name_en || '|' || published_count || '|' || indexable from public_site.directory_country where country_code = 'KE'$$), 'KE|Kenya|1|false', 'the country row is listed with its own names');
select is(pg_temp.rd($$select count(*) from public_site.directory_city where country_code = 'KE'$$), '0', 'directory_city has no Kenya row');

-- ---- 8. consumers: every public_site view reads the visibility predicate ---------------------------------------------
create or replace function pg_temp.views_not_reading_predicate() returns text language sql as $f$
  select coalesce(string_agg(c.relname::text, ',' order by c.relname), 'none')
    from pg_class c
   where c.relnamespace = 'public_site'::regnamespace and c.relkind in ('v', 'm')
     and pg_get_viewdef(c.oid) !~ 'gym_page_visible'
$f$;
select is(
  (select string_agg(c.relname::text, ',' order by c.relname) from pg_class c where c.relnamespace = 'public_site'::regnamespace and c.relkind = 'v'),
  'directory_city,directory_country,directory_gym,page_media,page_redirects,pages',
  'the scan covers pages, page_media, page_redirects and the three directory views');
select is(pg_temp.views_not_reading_predicate(), 'none', 'every public_site view reads private.gym_page_visible (no exceptions)');
-- shown able to fail: a view that reads gym_pages directly is reported (then dropped)
create view public_site.zz_bad_direct as select gp.template from public.gym_pages gp;
select is(pg_temp.views_not_reading_predicate(), 'zz_bad_direct', 'known-bad fixture: a view that reads gym_pages directly fails the scan');
drop view public_site.zz_bad_direct;
select is(pg_temp.views_not_reading_predicate(), 'none', 'after dropping the fixture the scan is clean again');

select * from finish();
rollback;
