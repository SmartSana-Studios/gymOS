-- ============================================================================
-- 0172: Directory city-slug redirects (Epic 25, Story 25.7; AD-49).
--
-- A renamed city keeps its old slug in public.city_slug_history for 12 months (written only by update_city, 0169). The reader role cannot read
-- that table, so `/{locale}/gyms/{cc}/{old-slug}` was the uniform not-found. One more public_site view answers it:
--
--   directory_city_redirect   country_code, old_slug, city_slug. One row per (country_code, old_slug), only while
--                             * the old slug is inside its 12 months (expires_at > now()), AND
--                             * the CURRENT city still has at least one visible gym (it reads private.gym_page_visible, the ONE visibility
--                               predicate, like every public_site view), so the 301 never points at a city page that answers not-found.
--                             No id of any kind: no history id, no city id.
--
--  * One row per (country_code, old_slug): `distinct on`, newest expiry first. A slug can repeat in the history after its first 12 months ended and
--    another city took it (the expired row is filtered out first, so at most one eligible row survives), or if a city leaves and later re-leaves
--    the same slug; the tie-break is deterministic.
--  * A row whose old slug equals the city's current slug is never produced (update_city deletes such a row; the condition is a loop guard).
--  * One hop: `city_slug` is the city's CURRENT slug, resolved through the city id, so a city renamed twice (a -> b -> c) answers `a` and `b`
--    with `c`, never with a chain.
--  * security_barrier, owned by the migration owner, revoked from public / anon / authenticated / service_role, granted select to
--    public_site_reader only. No change to any 0169 or 0170 object.
--
-- Provisional number: the next free one at merge time. Apply it BEFORE the first production city rename (the old URL is a 404 until it is applied).
-- Rollback: scripts/rollback-0172-directory-city-slug-redirects.sql.
-- ============================================================================

set local lock_timeout = '5s';

create view public_site.directory_city_redirect with (security_barrier = true) as
select distinct on (h.country_code, h.old_slug)
  h.country_code,
  h.old_slug,
  c.slug as city_slug
from public.city_slug_history h
join public.cities c on c.id = h.city_id
where h.expires_at > now()
  and h.old_slug <> c.slug
  and exists (select 1 from private.gym_page_visible v where v.city_id = c.id)
order by h.country_code, h.old_slug, h.expires_at desc, h.created_at desc;

revoke all on public_site.directory_city_redirect from public, anon, authenticated, service_role;
grant select on public_site.directory_city_redirect to public_site_reader;

comment on view public_site.directory_city_redirect is
  'Old city slug (inside its 12 months) -> the city''s CURRENT slug, one row per (country_code, old_slug), only while the current city has a visible gym (25.7). No ids.';

-- ----------------------------------------------------------------------------
-- The migration proves its own result.
-- ----------------------------------------------------------------------------
do $verify$
begin
  if (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'public_site' and table_name = 'directory_city_redirect')
       is distinct from array['country_code', 'old_slug', 'city_slug'] then
    raise exception '0172: public_site.directory_city_redirect columns are wrong';
  end if;
  if pg_get_viewdef('public_site.directory_city_redirect'::regclass) !~ 'gym_page_visible' then
    raise exception '0172: directory_city_redirect does not read the single visibility predicate';
  end if;
  if (select reloptions from pg_class where oid = 'public_site.directory_city_redirect'::regclass) is distinct from array['security_barrier=true'] then
    raise exception '0172: directory_city_redirect is not a security_barrier view';
  end if;
  if not has_table_privilege('public_site_reader', 'public_site.directory_city_redirect', 'select')
     or exists (select 1 from unnest(array['public', 'anon', 'authenticated', 'service_role']) g where has_table_privilege(g, 'public_site.directory_city_redirect', 'select')) then
    raise exception '0172: directory_city_redirect grants are wrong';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public_site' and table_name = 'directory_city_redirect'
               and column_name in ('gym_id', 'city_id', 'page_name_id', 'id')) then
    raise exception '0172: directory_city_redirect exposes an internal id';
  end if;
  if (select count(*) from pg_class c where c.relnamespace = 'public_site'::regnamespace and c.relkind = 'v') <> 7 then
    raise exception '0172: public_site should hold exactly seven views';
  end if;
end
$verify$;
