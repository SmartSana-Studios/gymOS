-- Rollback for migration 0166 (public page route, database half, Story 24.10).
-- Removes public_site.page_redirects, takes `default_language` back out of the snapshot builder, the content CHECK and the gym refresh
-- trigger, and strips the key from every stored snapshot (live pages keep everything else; the next refresh or publish re-snapshots with
-- the 0165 builder). Gym content, pages, names and media are untouched. Roll back the 24.10 landing code (it reads page_redirects and
-- requires default_language) first: the status read of the 24.9 dashboard fails its strict parse once the key is gone, and the 24.10 landing
-- reader needs page_redirects. Deploy order the other way: apply 0166 BEFORE deploying dashboard code whose snapshot schema requires default_language.
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0166-public-page-route.sql

set local lock_timeout = '5s';

drop view if exists public_site.page_redirects;

-- Pending deferred events on gyms would block the trigger swap below; there are none in a fresh session.
drop trigger if exists gym_page_refresh on public.gyms;

create constraint trigger gym_page_refresh
  after update of name, category, country, primary_color,
                  page_about_en, page_about_fr, page_services_en, page_services_fr, page_address,
                  page_lat, page_lng, page_hours, page_contact_phone, page_contact_whatsapp, page_city
  on public.gyms
  deferrable initially deferred
  for each row
  when (old.name is distinct from new.name
        or old.category is distinct from new.category
        or old.country is distinct from new.country
        or old.primary_color is distinct from new.primary_color
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

-- The old CHECK refuses a snapshot that carries the key, so the key goes first.
alter table public.gym_pages drop constraint gym_pages_content_keys;
update public.gym_pages set content = content - 'default_language' where content ? 'default_language';
alter table public.gym_pages
  add constraint gym_pages_content_keys check (
    jsonb_typeof(content) = 'object'
    and (content - array[
      'name', 'about_en', 'about_fr', 'services_en', 'services_fr', 'plans', 'address', 'map', 'hours',
      'contact', 'gallery', 'banner', 'logo', 'color', 'category', 'city', 'country'
    ]) = '{}'::jsonb
    and ((content -> 'plans') is null or jsonb_typeof(content -> 'plans') = 'array')
    and ((content -> 'gallery') is null or jsonb_typeof(content -> 'gallery') = 'array')
    and ((content -> 'hours') is null or jsonb_typeof(content -> 'hours') = 'object')
    and octet_length(content::text) <= 65536
  );

create or replace function private.gym_page_snapshot(p_gym_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_strip_nulls(jsonb_build_object(
           'name', g.name,
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
