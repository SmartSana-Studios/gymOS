-- Story 25.7: public_site.directory_city_redirect (migration 0172): old city slug -> current city slug, one hop, only while the old slug is inside
-- its 12 months AND the current city still has a visible gym. Fixture ids: 00000000-0000-0000-0000-0000002507xx
--   gyms 11-16, tier 01, user 31. Cities are created with the cr- prefix in GH, SN, TG and BF.
--
-- Every content assertion is read AS public_site_reader (pg_temp.rd); the history rows are written as the migration owner (the table has no client
-- write path), except the renames, which go through update_city as a Super Admin so the view is also shown to follow the real writer.
-- The 0169 refresh triggers are deferred and this file never settles them (it ends in a rollback), so no snapshot is re-judged here.
begin;
select plan(28);

grant public_site_reader to postgres with set true;

create or replace function pg_temp.claims(uid text, app_role text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated","aal":"aal2","app_role":"' || app_role || '"}', true);
end $f$;
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
create or replace function pg_temp.g(n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0000-0000002507' || lpad(n::text, 2, '0'))::uuid $f$;
create or replace function pg_temp.pn(n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0000-000002507a' || lpad(n::text, 2, '0'))::uuid $f$;
create or replace function pg_temp.cid(cc text, slug text) returns uuid language sql stable security definer as $f$
  select id from public.cities c where c.country_code = cc and c.slug = cid.slug $f$;
-- the redirect rows of one country as "old>current,old>current" (sorted), or 'none'
create or replace function pg_temp.rows(cc text) returns text language sql as $f$
  select pg_temp.rd(format($q$select coalesce(string_agg(old_slug || '>' || city_slug, ',' order by old_slug), 'none') from public_site.directory_city_redirect where country_code = %L$q$, cc)) $f$;
create or replace function pg_temp.vis(n int, nm text, cc text, city_id uuid) returns void language plpgsql as $f$
begin
  insert into public.gyms (id, name, tier_id, country, category, city_id)
  values (pg_temp.g(n), nm, '00000000-0000-0000-0000-000000250701', cc, 'gym', city_id);
  insert into public.page_names (id, gym_id, name, state, origin) values (pg_temp.pn(n), pg_temp.g(n), 'cr-page-' || n, 'active', 'claim');
  insert into public.gym_pages (gym_id, page_name_id, template, published_at, content)
  values (pg_temp.g(n), pg_temp.pn(n), 'classic', now(), jsonb_build_object('name', nm, 'country', cc, 'category', 'gym'));
end $f$;
create or replace function pg_temp.hist(cc text, old text, city_id uuid, expires timestamptz) returns void language sql as $f$
  insert into public.city_slug_history (country_code, old_slug, city_id, expires_at) values (cc, old, city_id, expires) $f$;

-- ---- fixtures ----------------------------------------------------------------------------------------------------
insert into tiers (id, name, monthly_price, annual_price, member_cap) values ('00000000-0000-0000-0000-000000250701', 'Redirect Tier', 5000, 50000, null);
insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-0000-0000-000000250731', 'admin-2507@x.example', now());
update users set is_super_admin = true where id = '00000000-0000-0000-0000-000000250731';

insert into public.cities (country_code, slug, name) values
  ('GH', 'cr-new-a',  'CR New A'),     -- renamed once, has a visible gym
  ('GH', 'cr-empty',  'CR Empty'),     -- renamed, no visible gym
  ('GH', 'cr-gone',   'CR Gone'),      -- renamed, its only gym is unpublished later
  ('GH', 'cr-loop',   'CR Loop'),      -- a history row naming its own current slug
  ('SN', 'cr-chain',  'CR Chain'),     -- renamed through update_city: a -> b -> c
  ('TG', 'cr-dup-y',  'CR Dup Y'),     -- one of two cities that left the same old slug
  ('TG', 'cr-dup-x',  'CR Dup X'),
  ('BF', 'cr-other',  'CR Other');     -- the same old slug as GH, in another country
select pg_temp.vis(11, 'CR One',   'GH', pg_temp.cid('GH', 'cr-new-a'));
select pg_temp.vis(12, 'CR Gone',  'GH', pg_temp.cid('GH', 'cr-gone'));
select pg_temp.vis(13, 'CR Loop',  'GH', pg_temp.cid('GH', 'cr-loop'));
select pg_temp.vis(14, 'CR Chain', 'SN', pg_temp.cid('SN', 'cr-chain'));
select pg_temp.vis(15, 'CR Dup',   'TG', pg_temp.cid('TG', 'cr-dup-y'));
select pg_temp.vis(16, 'CR Other', 'BF', pg_temp.cid('BF', 'cr-other'));

select pg_temp.hist('GH', 'cr-old-a',     pg_temp.cid('GH', 'cr-new-a'), now() + interval '6 months');
select pg_temp.hist('GH', 'cr-expired',   pg_temp.cid('GH', 'cr-new-a'), now() - interval '1 second');
select pg_temp.hist('GH', 'cr-old-empty', pg_temp.cid('GH', 'cr-empty'), now() + interval '6 months');
select pg_temp.hist('GH', 'cr-old-gone',  pg_temp.cid('GH', 'cr-gone'),  now() + interval '6 months');
select pg_temp.hist('GH', 'cr-loop',      pg_temp.cid('GH', 'cr-loop'),  now() + interval '6 months');
select pg_temp.hist('BF', 'cr-old-a',     pg_temp.cid('BF', 'cr-other'), now() + interval '6 months');
-- the same old slug three times in TG: twice for city Y (valid), once for city X (expired)
select pg_temp.hist('TG', 'cr-dup', pg_temp.cid('TG', 'cr-dup-y'), now() + interval '1 month');
select pg_temp.hist('TG', 'cr-dup', pg_temp.cid('TG', 'cr-dup-y'), now() + interval '2 months');
select pg_temp.hist('TG', 'cr-dup', pg_temp.cid('TG', 'cr-dup-x'), now() - interval '1 day');

-- ---- 1. what the view promises -----------------------------------------------------------------------------------
select is(pg_temp.rows('GH'), 'cr-old-a>cr-new-a,cr-old-gone>cr-gone', 'GH: the unexpired old slug of a city with a visible gym redirects to the current slug');
select is(pg_temp.rd($$select old_slug || '>' || city_slug from public_site.directory_city_redirect where country_code = 'GH' and old_slug = 'cr-expired'$$), 'NULL', 'an expired history row yields no row');
select is(pg_temp.rd($$select old_slug from public_site.directory_city_redirect where old_slug = 'cr-old-empty'$$), 'NULL', 'the current city has no visible gym: no row (a 301 would land on a 404)');
select is(pg_temp.rd($$select old_slug from public_site.directory_city_redirect where old_slug = 'cr-loop'$$), 'NULL', 'a history row naming the current slug is never a redirect');
select is(pg_temp.rd($$select old_slug from public_site.directory_city_redirect where old_slug = 'nothing-here'$$), 'NULL', 'an unknown slug yields no row');
select is(pg_temp.rows('BF'), 'cr-old-a>cr-other', 'the same old slug in another country is its own row (one row per country_code and old_slug)');
select is(pg_temp.rows('TG'), 'cr-dup>cr-dup-y', 'a duplicated old slug (three history rows, one eligible city) yields exactly one row');
select is(pg_temp.rd($$select count(*) from public_site.directory_city_redirect where country_code = 'TG' and old_slug = 'cr-dup'$$), '1', 'one row per (country_code, old_slug)');
select is(
  (select count(*)::int from (select country_code, old_slug from public_site.directory_city_redirect group by 1, 2 having count(*) > 1) d), 0,
  'no (country_code, old_slug) repeats anywhere in the view');

-- ---- 2. it follows the real writer: update_city ------------------------------------------------------------------
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-000000250731', 'super_admin');
select is(pg_temp.err(format($q$select update_city(%L, 'CR Chain', 'cr-chain-b', null, null, null)$q$, pg_temp.cid('SN', 'cr-chain'))), 'ok', 'a Super Admin renames the slug once (cr-chain -> cr-chain-b)');
reset role;
select is(pg_temp.rows('SN'), 'cr-chain>cr-chain-b', 'the old slug answers the new one');
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-000000250731', 'super_admin');
select is(pg_temp.err(format($q$select update_city(%L, 'CR Chain', 'cr-chain-c', null, null, null)$q$, pg_temp.cid('SN', 'cr-chain-b'))), 'ok', 'and again (cr-chain-b -> cr-chain-c)');
reset role;
select is(pg_temp.rows('SN'), 'cr-chain>cr-chain-c,cr-chain-b>cr-chain-c', 're-rename: both old slugs answer the CURRENT slug, never a chain');
set local role authenticated;
select pg_temp.claims('00000000-0000-0000-0000-000000250731', 'super_admin');
select is(pg_temp.err(format($q$select update_city(%L, 'CR Chain', 'cr-chain', null, null, null)$q$, pg_temp.cid('SN', 'cr-chain-c'))), 'ok', 'the city goes back to its first slug');
reset role;
select is(pg_temp.rows('SN'), 'cr-chain-b>cr-chain,cr-chain-c>cr-chain', 'coming back: the slug it returned to is live again and is no longer a redirect source');

-- ---- 3. visibility follows the one predicate ---------------------------------------------------------------------
update public.gym_pages set unpublished_at = now() where gym_id = pg_temp.g(12);
select is(pg_temp.rows('GH'), 'cr-old-a>cr-new-a', 'the only gym of the current city is unpublished: its redirect is gone at once');
update public.gym_pages set unpublished_at = null where gym_id = pg_temp.g(12);
select is(pg_temp.rows('GH'), 'cr-old-a>cr-new-a,cr-old-gone>cr-gone', 'published again: the redirect is back');
update public.gym_pages set taken_down_at = now() where gym_id = pg_temp.g(11);
select is(pg_temp.rows('GH'), 'cr-old-gone>cr-gone', 'a taken-down page removes the redirect');
update public.gym_pages set taken_down_at = null where gym_id = pg_temp.g(11);
update public.cities set slug = 'cr-new-a-2' where id = pg_temp.cid('GH', 'cr-new-a');
select is(pg_temp.rows('GH'), 'cr-old-a>cr-new-a-2,cr-old-gone>cr-gone', 'the target is the city''s slug as it is NOW (resolved through the city, not stored)');
update public.city_slug_history set expires_at = now() - interval '1 second' where old_slug = 'cr-old-a' and country_code = 'GH';
select is(pg_temp.rows('GH'), 'cr-old-gone>cr-gone', 'a row expires with its expires_at');

-- ---- 4. shape, grants, mutation-free reads -----------------------------------------------------------------------
select is(pg_temp.rd('select city_id from public_site.directory_city_redirect'), 'ERR:42703', 'no city_id column');
select is(pg_temp.rd('select id from public_site.directory_city_redirect'), 'ERR:42703', 'no id column');
select is(
  (select count(*)::int from information_schema.columns where table_schema = 'public_site' and table_name = 'directory_city_redirect' and column_name in ('id', 'city_id', 'gym_id', 'page_name_id')), 0,
  'the catalog agrees: no internal id column');
select is(pg_temp.rd('select old_slug from public.city_slug_history'), 'ERR:42501', 'the reader still cannot read the history table itself');
select is(pg_temp.rd($$insert into public_site.directory_city_redirect (old_slug) values ('x')$$), 'ERR:55000', 'insert through the view is refused');
select is(
  (select count(*)::int from unnest(array['public', 'anon', 'authenticated', 'service_role']) g, unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
   where has_table_privilege(g, 'public_site.directory_city_redirect', p)), 0,
  'PUBLIC, anon, authenticated and service_role hold nothing on the view');
select ok(has_table_privilege('public_site_reader', 'public_site.directory_city_redirect', 'select')
          and not has_table_privilege('public_site_reader', 'public_site.directory_city_redirect', 'insert'), 'the reader may select the view and nothing more');
select is(
  (select reloptions from pg_class where oid = 'public_site.directory_city_redirect'::regclass), array['security_barrier=true'], 'the view is security_barrier');

select * from finish();
rollback;
