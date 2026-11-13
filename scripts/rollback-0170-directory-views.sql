-- Rollback for migration 0170 (directory views, Story 25.2).
-- Drops the three directory views and private.directory_indexable_min (a one-row view), then restores the 0164 private.gym_page_visible WITHOUT city_id.
-- create or replace cannot remove a column, so the predicate is dropped and recreated, which means the public_site views that read it are
-- dropped first and recreated after it (0164's pages and page_media, 0166's page_redirects, with their grants and comment).
-- Roll back any 25.3 to 25.5 code that reads the directory views first: it would fail on a view that is gone.
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0170-directory-views.sql

set local lock_timeout = '5s';

drop view if exists public_site.directory_gym;
drop view if exists public_site.directory_city;
drop view if exists public_site.directory_country;
drop view if exists private.directory_indexable_min;

drop view if exists public_site.page_redirects;
drop view if exists public_site.page_media;
drop view if exists public_site.pages;
drop view if exists private.gym_page_visible;

-- 0164's private.gym_page_visible
create view private.gym_page_visible with (security_barrier = true) as
select
  gp.page_name_id,
  gp.template,
  gp.schema_version,
  gp.content,
  gp.published_at,
  gp.updated_at,
  pn.name
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

-- 0164's public_site.pages
create view public_site.pages with (security_barrier = true) as
select
  v.page_name_id,
  v.template,
  v.schema_version,
  v.content,
  v.published_at,
  v.updated_at,
  v.name
from private.gym_page_visible v;

revoke all on public_site.pages from public, anon, authenticated, service_role;
grant select on public_site.pages to public_site_reader;

-- 0164's public_site.page_media
create view public_site.page_media with (security_barrier = true) as
select
  m.derivative_key,
  m.kind,
  m.sort_order,
  m.page_name_id
from (
  select v.page_name_id, 'logo'::text as kind, v.content ->> 'logo' as derivative_key, 0 as sort_order
    from private.gym_page_visible v
   where v.content ->> 'logo' is not null
  union all
  select v.page_name_id, 'banner'::text, v.content ->> 'banner', 0
    from private.gym_page_visible v
   where v.content ->> 'banner' is not null
  union all
  select v.page_name_id, 'gallery'::text, g.key, g.ord::integer
    from private.gym_page_visible v
    cross join lateral jsonb_array_elements_text(v.content -> 'gallery') with ordinality as g(key, ord)
) m;

revoke all on public_site.page_media from public, anon, authenticated, service_role;
grant select on public_site.page_media to public_site_reader;

-- 0166's public_site.page_redirects
create view public_site.page_redirects with (security_barrier = true) as
select
  lower(r.name) as old_name,
  v.name as name
from public.page_names r
join public.page_names a on a.gym_id = r.gym_id and a.state = 'active' and a.taken_down_at is null
join private.gym_page_visible v on v.page_name_id = a.id
where r.state = 'redirect'
  and r.taken_down_at is null
  and r.reserved_until is not null
  and r.reserved_until > now();

revoke all on public_site.page_redirects from public, anon, authenticated, service_role;
grant select on public_site.page_redirects to public_site_reader;

comment on view public_site.page_redirects is
  'Old page name (redirect state, inside its 12 months) -> the gym''s current visible page name (24.10, AD-45). No row when the current page is not visible. No gym id.';

do $verify$
begin
  if to_regclass('public_site.directory_gym') is not null or to_regclass('public_site.directory_city') is not null
     or to_regclass('public_site.directory_country') is not null or to_regclass('private.directory_indexable_min') is not null then
    raise exception 'rollback-0170: a directory object is still there';
  end if;
  if (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'private' and table_name = 'gym_page_visible')
       is distinct from array['page_name_id', 'template', 'schema_version', 'content', 'published_at', 'updated_at', 'name'] then
    raise exception 'rollback-0170: private.gym_page_visible is not the 0164 shape';
  end if;
  if not has_table_privilege('public_site_reader', 'public_site.pages', 'select')
     or not has_table_privilege('public_site_reader', 'public_site.page_media', 'select')
     or not has_table_privilege('public_site_reader', 'public_site.page_redirects', 'select') then
    raise exception 'rollback-0170: the reader lost a grant';
  end if;
end
$verify$;
