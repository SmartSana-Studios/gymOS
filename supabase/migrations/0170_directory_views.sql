-- ============================================================================
-- 0170: Directory views (Epic 25, Story 25.2; AD-49).
--
-- The directory pages (25.3), structured data (25.4) and sitemaps (25.5) need country, city and gym listings with counts and an `indexable`
-- flag that can never show a gym the public site would not serve. Three views in public_site, each built from private.gym_page_visible (the
-- ONE visibility predicate) joined to cities / countries:
--
--   directory_gym      country_code, city_slug, city_name, category, name, page_name, logo_key. One row per visible gym that has a city.
--                      Nothing else: no banner, hours, plans, contact, address, map or colour. The view promises no order; the reader sorts
--                      (`order by lower(name), page_name`).
--   directory_city     country_code, city_slug, city_name, lat, lng, published_count, indexable. Only cities with at least one visible gym.
--                      lat / lng are the city's own coordinates (null when unset), never a gym position.
--   directory_country  country_code, name_en, name_fr, published_count, indexable. Counts every visible gym by the snapshot's `country`, so a
--                      country with a published gym and no city with a gym is still listed (FR-210). Nothing names or favours Cameroon.
--
--  * `indexable` is published_count >= (select min_published from private.directory_indexable_min); that one-row private view holds
--    the constant 3 and is the only place the number exists (a view, not the function the spec named: see the note below this header).
--    No counter or listing table: the counts are computed on read, so a removal (unpublish, takedown of the page or
--    of the name, suspension) changes them at once, with no code of its own.
--  * private.gym_page_visible gains ONE appended column, city_id (create or replace may only append). The private view is not client
--    readable, and the existing public_site views keep selecting their explicit columns, so none of them gains it.
--  * Every view is security_barrier, owned by the migration owner, revoked from public / anon / authenticated / service_role, and granted
--    select to public_site_reader only. None exposes gym_id, city_id, page_name_id or any other internal id.
--  * A category change already re-snapshots through the 0169 refresh trigger, so the gym moves between `category` filters with no new code.
--
-- Rollback: scripts/rollback-0170-directory-views.sql.
-- ============================================================================

set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- The one number: a one-row private view. The spec asked for an immutable SQL function revoked from the clients and "called by the views as
-- owner". Postgres does not allow that: relation privileges inside a view are checked as the view OWNER, but EXECUTE on a function is checked as
-- the CALLING role, so a view over a revoked function fails for the reader with 42501 (seen on the first test run), and granting the reader
-- EXECUTE breaks the 24.4 rule that the reader holds nothing outside public_site (the enumeration flags an explicit grant even in an unreachable
-- schema). A private view keeps every stated property: the number 3 exists in exactly one place, no client role (reader included) holds any
-- privilege on it, the views read it as their owner, and it is not a counter or a listing table.
-- ----------------------------------------------------------------------------
create view private.directory_indexable_min with (security_barrier = true) as
select 3::integer as min_published;

revoke all on private.directory_indexable_min from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- The visibility predicate, 0164's definition plus city_id appended at the end.
-- ----------------------------------------------------------------------------
create or replace view private.gym_page_visible with (security_barrier = true) as
select
  gp.page_name_id,
  gp.template,
  gp.schema_version,
  gp.content,
  gp.published_at,
  gp.updated_at,
  pn.name,
  g.city_id
from public.gym_pages gp
join public.page_names pn on pn.id = gp.page_name_id and pn.gym_id = gp.gym_id
join public.gyms g on g.id = gp.gym_id
where gp.published_at is not null
  and gp.unpublished_at is null
  and gp.taken_down_at is null
  and pn.state = 'active'
  and pn.taken_down_at is null
  and g.status = 'active';

revoke all on private.gym_page_visible from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- The three views
-- ----------------------------------------------------------------------------
create view public_site.directory_gym with (security_barrier = true) as
select
  c.country_code,
  c.slug as city_slug,
  c.name as city_name,
  v.content ->> 'category' as category,
  v.content ->> 'name' as name,
  v.name as page_name,
  v.content ->> 'logo' as logo_key
from private.gym_page_visible v
join public.cities c on c.id = v.city_id;

create view public_site.directory_city with (security_barrier = true) as
select
  c.country_code,
  c.slug as city_slug,
  c.name as city_name,
  c.lat,
  c.lng,
  count(*)::integer as published_count,
  (count(*)::integer >= (select t.min_published from private.directory_indexable_min t)) as indexable
from private.gym_page_visible v
join public.cities c on c.id = v.city_id
group by c.id, c.country_code, c.slug, c.name, c.lat, c.lng;

create view public_site.directory_country with (security_barrier = true) as
select
  co.code as country_code,
  co.name_en,
  co.name_fr,
  count(*)::integer as published_count,
  (count(*)::integer >= (select t.min_published from private.directory_indexable_min t)) as indexable
from private.gym_page_visible v
join public.countries co on co.code = v.content ->> 'country'
group by co.code, co.name_en, co.name_fr;

revoke all on public_site.directory_gym from public, anon, authenticated, service_role;
revoke all on public_site.directory_city from public, anon, authenticated, service_role;
revoke all on public_site.directory_country from public, anon, authenticated, service_role;
grant select on public_site.directory_gym to public_site_reader;
grant select on public_site.directory_city to public_site_reader;
grant select on public_site.directory_country to public_site_reader;

comment on view public_site.directory_gym is
  'Visible gyms that have a city: country, city, category, gym name, page name (subdomain label), logo key (25.2). No ids, no gym position. No order: the reader sorts.';
comment on view public_site.directory_city is
  'Cities with at least one visible gym: country, slug, name, the city''s own lat/lng, published_count, indexable (25.2). No ids, never a gym position.';
comment on view public_site.directory_country is
  'Countries with at least one visible gym (counted by the snapshot''s country): names, published_count, indexable (25.2). Nothing assumes Cameroon.';

-- ----------------------------------------------------------------------------
-- The migration proves its own result.
-- ----------------------------------------------------------------------------
do $verify$
declare
  v_view text;
begin
  if (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'private' and table_name = 'gym_page_visible')
       is distinct from array['page_name_id', 'template', 'schema_version', 'content', 'published_at', 'updated_at', 'name', 'city_id'] then
    raise exception '0170: private.gym_page_visible columns are wrong';
  end if;
  if (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'public_site' and table_name = 'pages')
       is distinct from array['page_name_id', 'template', 'schema_version', 'content', 'published_at', 'updated_at', 'name'] then
    raise exception '0170: public_site.pages gained a column';
  end if;
  if (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'public_site' and table_name = 'directory_gym')
       is distinct from array['country_code', 'city_slug', 'city_name', 'category', 'name', 'page_name', 'logo_key'] then
    raise exception '0170: public_site.directory_gym columns are wrong';
  end if;
  if (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'public_site' and table_name = 'directory_city')
       is distinct from array['country_code', 'city_slug', 'city_name', 'lat', 'lng', 'published_count', 'indexable'] then
    raise exception '0170: public_site.directory_city columns are wrong';
  end if;
  if (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'public_site' and table_name = 'directory_country')
       is distinct from array['country_code', 'name_en', 'name_fr', 'published_count', 'indexable'] then
    raise exception '0170: public_site.directory_country columns are wrong';
  end if;

  foreach v_view in array array['directory_gym', 'directory_city', 'directory_country'] loop
    if pg_get_viewdef(('public_site.' || v_view)::regclass) !~ 'gym_page_visible' then
      raise exception '0170: % does not read the single visibility predicate', v_view;
    end if;
    if (select reloptions from pg_class where oid = ('public_site.' || v_view)::regclass) is distinct from array['security_barrier=true'] then
      raise exception '0170: % is not a security_barrier view', v_view;
    end if;
    if not has_table_privilege('public_site_reader', 'public_site.' || v_view, 'select')
       or exists (select 1 from unnest(array['public', 'anon', 'authenticated', 'service_role']) g where has_table_privilege(g, 'public_site.' || v_view, 'select')) then
      raise exception '0170: % grants are wrong', v_view;
    end if;
    if exists (select 1 from information_schema.columns where table_schema = 'public_site' and table_name = v_view
                 and column_name in ('gym_id', 'city_id', 'page_name_id', 'id')) then
      raise exception '0170: % exposes an internal id', v_view;
    end if;
  end loop;

  if (select min_published from private.directory_indexable_min) is distinct from 3 then
    raise exception '0170: the indexable threshold is not 3';
  end if;
  if exists (select 1 from unnest(array['public', 'anon', 'authenticated', 'service_role', 'public_site_reader']) g
              where has_table_privilege(g, 'private.directory_indexable_min', 'select')) then
    raise exception '0170: a client role can read private.directory_indexable_min';
  end if;
end
$verify$;
