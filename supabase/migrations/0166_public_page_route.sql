-- ============================================================================
-- 0166: Public page route, database half (Epic 24, Story 24.10; FR-196, FR-203, FR-208, FR-207, AD-43, AD-46, AD-50).
--
-- The public site (apps/landing) now serves {name}.gymosapps.com. It reads ONE row as public_site_reader and renders a template over it.
-- Two things it needs from the database were missing:
--
--   public_site.page_redirects   An old name (state `redirect`, still inside its 12 months) and the CURRENT name of the same gym, for the
--                                one-hop 301. It selects from private.gym_page_visible (the ONE visibility predicate), so a redirect whose
--                                current page is not visible (unpublished, taken down, suspended, released) yields no row: the public site
--                                answers the uniform not-found, never a redirect to a page that is not there. No gym id column.
--   default_language             The gym's own default content language is part of the snapshot (EXPERIENCE.md "Language rule": the
--                                fallback order after the visitor's Accept-Language is the gym's default_language, then the first complete
--                                language). It is added to the snapshot builder, to the `gym_pages_content_keys` CHECK and to the column
--                                list and WHEN clause of the gym refresh trigger, so an Owner changing the default language re-snapshots a
--                                live page. A value outside private.gym_page_languages() is written as the first language, so the key is
--                                always one the templates can show (PageContentV1 accepts exactly that list).
--
-- Design choices worth knowing before editing this file:
--
--  * `schema_version` stays 1. Nothing is in production yet (0160 to 0165 are not applied there), so adding a key to the snapshot before the
--    first release is not a content change that has stored snapshots to migrate. The reader accepts exactly version 1 and fails closed
--    otherwise; the first change AFTER release ships as version 2 plus a migration of stored snapshots (docs/decisions.md, 24.10).
--
--  * The gym refresh trigger is dropped and created again (a trigger's column list and WHEN cannot be altered). Both happen before any
--    statement of this migration changes `gyms`, so there are no pending deferred events (ALTER/DROP after a watched change would fail).
--
--  * The one-off refresh at the end re-snapshots the pages that are LIVE now (private.refresh_gym_page: it re-judges the gate, writes only
--    on a real change, and unpublishes with a notice if the gate no longer holds, as any edit would). An offline page keeps its stored
--    snapshot; a publish takes a fresh one.
--
--  * `old_name` is lower(name): the lookup uses the unique index page_names_name_live (lower(name)) where state <> 'released'.
--
--  * No change to the 24.5 setter, the gate codes, publish_gym_page or unpublish_gym_page.
-- ============================================================================

set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- Allowed top-level keys: 0164's list plus `default_language`. Changing the list means changing the pinned list in
-- supabase/tests/public_site_reader_privileges.test.sql (and the snapshot key paths in gym_page_publish.test.sql) in the same change.
-- ----------------------------------------------------------------------------
alter table public.gym_pages drop constraint gym_pages_content_keys;
alter table public.gym_pages
  add constraint gym_pages_content_keys check (
    jsonb_typeof(content) = 'object'
    and (content - array[
      'name', 'default_language', 'about_en', 'about_fr', 'services_en', 'services_fr', 'plans', 'address', 'map', 'hours',
      'contact', 'gallery', 'banner', 'logo', 'color', 'category', 'city', 'country'
    ]) = '{}'::jsonb
    and ((content -> 'plans') is null or jsonb_typeof(content -> 'plans') = 'array')
    and ((content -> 'gallery') is null or jsonb_typeof(content -> 'gallery') = 'array')
    and ((content -> 'hours') is null or jsonb_typeof(content -> 'hours') = 'object')
    and octet_length(content::text) <= 65536
  );

-- ----------------------------------------------------------------------------
-- The snapshot builder: 0165's, plus `default_language`.
-- ----------------------------------------------------------------------------
create or replace function private.gym_page_snapshot(p_gym_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_strip_nulls(jsonb_build_object(
           'name', g.name,
           'default_language', case when g.default_language = any (private.gym_page_languages())
                                    then g.default_language else (private.gym_page_languages())[1] end,
           'about_en', case when private.gym_page_lang_complete(g.page_about_en) then g.page_about_en end,
           'about_fr', case when private.gym_page_lang_complete(g.page_about_fr) then g.page_about_fr end,
           'services_en', case when private.gym_page_lang_complete(g.page_about_en) then g.page_services_en end,
           'services_fr', case when private.gym_page_lang_complete(g.page_about_fr) then g.page_services_fr end,
           'address', g.page_address,
           'city', g.page_city,
           'country', g.country,
           'category', g.category,
           'map', case when g.page_lat is not null and g.page_lng is not null
                       then jsonb_build_object('lat', g.page_lat, 'lng', g.page_lng) end,
           'contact', case when g.page_contact_phone is not null or g.page_contact_whatsapp is not null
                           then jsonb_build_object('phone', g.page_contact_phone, 'whatsapp', g.page_contact_whatsapp) end,
           'color', case when g.primary_color ~ '^#[0-9a-fA-F]{6}$' then g.primary_color end,
           'logo', (select m.derivative_key from gym_page_media m
                     where m.gym_id = g.id and m.kind = 'logo' and m.deleted_at is null
                     order by m.created_at desc, m.id limit 1),
           'banner', (select m.derivative_key from gym_page_media m
                       where m.gym_id = g.id and m.kind = 'banner' and m.deleted_at is null
                       order by m.created_at desc, m.id limit 1),
           'gallery', (select jsonb_agg(m.derivative_key order by m.sort_order, m.created_at, m.id) from gym_page_media m
                        where m.gym_id = g.id and m.kind = 'gallery' and m.deleted_at is null),
           'plans', (select jsonb_agg(jsonb_build_object(
                              'name', p.name,
                              'label_en', coalesce(p.public_label_en, p.name),
                              'label_fr', coalesce(p.public_label_fr, p.name),
                              'type', p.plan_type::text,
                              'price', p.price,
                              'currency', p.currency,
                              'interval', p.billing_interval::text,
                              'duration_days', p.duration_days) order by p.price, p.name, p.id)
                       from plans p where p.gym_id = g.id and p.is_public)
         ))
         || case when g.page_hours is not null then jsonb_build_object('hours', g.page_hours) else '{}'::jsonb end
    from gyms g
   where g.id = p_gym_id;
$$;

-- create or replace keeps the privileges 0164 set; the revoke is repeated because the migration guardrail asks every file that defines a function to state it.
revoke execute on function private.gym_page_snapshot(uuid) from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- The gym refresh trigger: 0164's, with `default_language` in the column list and the WHEN clause.
-- ----------------------------------------------------------------------------
drop trigger gym_page_refresh on public.gyms;

create constraint trigger gym_page_refresh
  after update of name, category, country, primary_color, default_language,
                  page_about_en, page_about_fr, page_services_en, page_services_fr, page_address,
                  page_lat, page_lng, page_hours, page_contact_phone, page_contact_whatsapp, page_city
  on public.gyms
  deferrable initially deferred
  for each row
  when (old.name is distinct from new.name
        or old.category is distinct from new.category
        or old.country is distinct from new.country
        or old.primary_color is distinct from new.primary_color
        or old.default_language is distinct from new.default_language
        or old.page_about_en is distinct from new.page_about_en
        or old.page_about_fr is distinct from new.page_about_fr
        or old.page_services_en is distinct from new.page_services_en
        or old.page_services_fr is distinct from new.page_services_fr
        or old.page_address is distinct from new.page_address
        or old.page_lat is distinct from new.page_lat
        or old.page_lng is distinct from new.page_lng
        or old.page_hours is distinct from new.page_hours
        or old.page_contact_phone is distinct from new.page_contact_phone
        or old.page_contact_whatsapp is distinct from new.page_contact_whatsapp
        or old.page_city is distinct from new.page_city)
  execute function private.gym_page_refresh_from_gym();

-- ----------------------------------------------------------------------------
-- public_site.page_redirects: old name -> current name, one hop, only while the current page is visible.
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- One-off refresh of the pages that are live now: they gain `default_language`.
-- ----------------------------------------------------------------------------
do $refresh$
declare
  r record;
begin
  for r in select gp.gym_id from public.gym_pages gp where gp.published_at is not null and gp.unpublished_at is null order by gp.gym_id loop
    perform private.refresh_gym_page(r.gym_id);
  end loop;
end
$refresh$;

-- ----------------------------------------------------------------------------
-- The migration proves its own result.
-- ----------------------------------------------------------------------------
do $verify$
begin
  if (select pg_get_constraintdef(oid) from pg_constraint where conname = 'gym_pages_content_keys' and conrelid = 'public.gym_pages'::regclass) !~ '''default_language'''
     or (select pg_get_constraintdef(oid) from pg_constraint where conname = 'gym_pages_content_keys' and conrelid = 'public.gym_pages'::regclass) !~ '65536' then
    raise exception '0166: the content CHECK is not the expected one';
  end if;
  if pg_get_functiondef('private.gym_page_snapshot(uuid)'::regprocedure) !~ 'default_language' then
    raise exception '0166: the snapshot builder does not carry default_language';
  end if;
  if (select count(*) from pg_trigger where tgname = 'gym_page_refresh' and tgrelid = 'public.gyms'::regclass and not tgisinternal and tgdeferrable and tginitdeferred) <> 1
     or pg_get_triggerdef((select oid from pg_trigger where tgname = 'gym_page_refresh' and tgrelid = 'public.gyms'::regclass)) !~ 'default_language' then
    raise exception '0166: the gym refresh trigger does not watch default_language';
  end if;
  if (select count(*) from pg_trigger where tgname like 'gym\_page\_refresh%' and not tgisinternal and tgconstraint <> 0) <> 8 then
    raise exception '0166: expected eight deferred refresh triggers';
  end if;
  if (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'public_site' and table_name = 'page_redirects')
       is distinct from array['old_name', 'name'] then
    raise exception '0166: public_site.page_redirects columns are wrong';
  end if;
  if pg_get_viewdef('public_site.page_redirects'::regclass) !~ 'gym_page_visible' then
    raise exception '0166: page_redirects does not read the single visibility predicate';
  end if;
  if not has_table_privilege('public_site_reader', 'public_site.page_redirects', 'select')
     or exists (select 1 from unnest(array['public', 'anon', 'authenticated', 'service_role']) g where has_table_privilege(g, 'public_site.page_redirects', 'select')) then
    raise exception '0166: page_redirects grants are wrong';
  end if;
  if exists (select 1 from public.gym_pages gp where gp.published_at is not null and gp.unpublished_at is null and not (gp.content ? 'default_language')) then
    raise exception '0166: a live page has no default_language after the refresh';
  end if;
end
$verify$;
