-- ============================================================================
-- 0164: Publish gate, snapshot and unpublish (Epic 24, Story 24.8; FR-199, FR-200, FR-206, FR-207, AD-46).
--
-- The first writer of `gym_pages`. Until now nothing could make a page public. This migration adds:
--
--   publish_gym_page(gym, template)     Owner, Supervisor, live-assigned support, Super Admin. Takes NO content: the snapshot is built
--                                       inside the function from the gym's own columns. A failed gate returns {published:false, missing:[..]}
--                                       and writes nothing. Refuses a taken-down page (typed `taken_down`).
--   unpublish_gym_page(gym)             Same roles, always allowed (also for a suspended gym). Reason `owner`.
--   private.gym_page_gate_missing()     The one gate (FR-199), shared by publish and refresh. Returns the missing codes.
--   private.gym_page_snapshot()         The one snapshot builder: a fixed jsonb_build_object from tenant columns. No gym id, plan id,
--                                       gym_token, login phone or uploaded_by can enter it, because none is named.
--   private.refresh_gym_page()          Called by deferred constraint triggers. Nothing to do for an unpublished page; for a published one it
--                                       re-snapshots while the gate holds and otherwise unpublishes itself, records why and tells every
--                                       active Owner (staff_notices + email_outbox, bilingual).
--   private.gym_page_visible            The ONE visibility predicate (a private view). public_site.pages and public_site.page_media both
--                                       select from it. public_site.page_media is a projection of the snapshot (logo, banner, gallery
--                                       keys) and exposes page_name_id, never gym_id.
--   private.page_names_sweep()          Changed (owner decision 2026-11-08, option B): see below.
--
-- Design choices worth knowing before editing this file:
--
--  * Why DEFERRED constraint triggers. register_page_media() replaces a logo in two statements (mark the old row deleted, then add the
--    new one). An immediate trigger would judge the page between them, find no logo and unpublish a page whose Owner only replaced the
--    image. A deferred trigger judges the transaction's FINAL state, once, at commit. Tests call `set constraints all immediate` to
--    settle them. A trigger WHEN clause compares old and new because the 24-5 pin triggers revert protected columns in place.
--
--  * Suspension and deactivation keep the snapshot; the visibility predicate hides it (gym status active is one of its terms). The page
--    returns on reactivation while the name is still held. For a gym that is not active, once its active name passes reserved_until
--    (12 months idle) the sweep unpublishes the page (reason name_released, Owner notice) and releases the name and its redirects.
--    On reactivation the Owner must claim a name and publish again.
--
--  * Every function that writes gym_pages is on an allowlist in supabase/tests/gym_page_publish.test.sql; a new writer fails that test.
--    Every gate code needs a failing case in that file too.
--
--  * Codes written to gym_pages.unpublished_reason: `owner`, `name_released`, or the comma-joined gate codes that failed.
-- ============================================================================

set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- gym_pages: reason column, content limits (24-4 deferral), composite foreign key (24-7 deferral)
-- ----------------------------------------------------------------------------
alter table public.gym_pages add column unpublished_reason text;

alter table public.gym_pages
  add constraint gym_pages_unpublished_reason_shape check (
    unpublished_reason is null
    or (char_length(unpublished_reason) <= 300 and unpublished_reason ~ '^[a-z][a-z_]*(,[a-z][a-z_]*)*$')
  );

-- Allowed top-level keys: 0160's list plus `name` (the gym's display name). Nested types and a size cap close the 24-4 deferral.
-- Changing the key list means changing the pinned list in supabase/tests/public_site_reader_privileges.test.sql in the same change.
alter table public.gym_pages drop constraint gym_pages_content_keys;
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

-- A page may reference only its own gym's page name (closes the 24-7 deferral). MATCH SIMPLE: an unpublished page may have no name yet.
create unique index page_names_gym_id_id_key on public.page_names (gym_id, id);
alter table public.gym_pages drop constraint gym_pages_page_name_id_fkey;
alter table public.gym_pages
  add constraint gym_pages_gym_page_name_fkey foreign key (gym_id, page_name_id) references public.page_names (gym_id, id);

comment on column public.gym_pages.unpublished_reason is
  'Why the page is offline (24.8): owner, name_released, or the comma-joined gate codes that failed. Null while published.';

-- ----------------------------------------------------------------------------
-- Pure helpers
-- ----------------------------------------------------------------------------

-- Characters after the same Unicode trim the page content setter uses (0161).
create function private.gym_page_trimmed_length(p_text text)
returns integer
language sql
immutable
set search_path = public
as $$
  select coalesce(char_length(regexp_replace(p_text,
    '^[\t\n\v\f\r    -     　﻿]+|[\t\n\v\f\r    -     　﻿]+$', '', 'g')), 0);
$$;

-- One sentence fragment per gate code, EN and FR, for the Owner notice. A code with no phrase here fails the test that walks the gate.
create function private.gym_page_gate_phrase(p_code text, p_lang text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_lang
    when 'en' then case p_code
      when 'no_name' then 'a page name'
      when 'no_category' then 'a category'
      when 'no_logo' then 'a logo'
      when 'no_banner' then 'a banner image'
      when 'about_short' then 'an About text of at least 100 characters'
      when 'no_country' then 'a country'
      when 'no_city' then 'a city'
      when 'no_contact' then 'a public phone or WhatsApp number'
      when 'no_hours' then 'opening hours for at least one day'
      when 'no_public_plan' then 'at least one public plan'
      when 'map_incomplete' then 'both a latitude and a longitude, or neither'
      when 'bad_text' then 'text without control characters or the characters < and >'
      when 'too_large' then 'page content within the size limit'
    end
    when 'fr' then case p_code
      when 'no_name' then 'un nom de page'
      when 'no_category' then 'une catégorie'
      when 'no_logo' then 'un logo'
      when 'no_banner' then 'une image de bannière'
      when 'about_short' then 'un texte de présentation d''au moins 100 caractères'
      when 'no_country' then 'un pays'
      when 'no_city' then 'une ville'
      when 'no_contact' then 'un numéro public de téléphone ou de WhatsApp'
      when 'no_hours' then 'des horaires pour au moins un jour'
      when 'no_public_plan' then 'au moins un abonnement public'
      when 'map_incomplete' then 'une latitude et une longitude, ou aucune des deux'
      when 'bad_text' then 'un texte sans caractères de contrôle ni les caractères < et >'
      when 'too_large' then 'un contenu de page dans la limite de taille'
    end
  end;
$$;

-- ----------------------------------------------------------------------------
-- The snapshot builder. A fixed list of keys from tenant columns; null fields are omitted (hours is added after the strip so its
-- closed days, JSON null, survive). Nothing here names a gym id, plan id, gym_token, login phone or uploaded_by.
-- ----------------------------------------------------------------------------
create function private.gym_page_snapshot(p_gym_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_strip_nulls(jsonb_build_object(
           'name', g.name,
           'about_en', g.page_about_en,
           'about_fr', g.page_about_fr,
           'services_en', g.page_services_en,
           'services_fr', g.page_services_fr,
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

-- ----------------------------------------------------------------------------
-- The gate (FR-199). Returns the codes that are missing, in a fixed order; empty means the page may be public.
-- Every code is appended with `array_append(v_missing, '<code>')`: the test walks the function text for them.
-- ----------------------------------------------------------------------------
create function private.gym_page_gate_missing(p_gym_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_gym gyms%rowtype;
  v_missing text[] := '{}';
  v_text text;
begin
  select * into v_gym from gyms g where g.id = p_gym_id;
  if not found then
    raise exception 'gym_page_gate_missing: gym not found';
  end if;

  if not exists (select 1 from page_names pn where pn.gym_id = p_gym_id and pn.state = 'active' and pn.taken_down_at is null) then
    v_missing := array_append(v_missing, 'no_name');
  end if;
  if nullif(btrim(v_gym.category), '') is null then
    v_missing := array_append(v_missing, 'no_category');
  end if;
  if not exists (select 1 from gym_page_media m where m.gym_id = p_gym_id and m.kind = 'logo' and m.deleted_at is null) then
    v_missing := array_append(v_missing, 'no_logo');
  end if;
  if not exists (select 1 from gym_page_media m where m.gym_id = p_gym_id and m.kind = 'banner' and m.deleted_at is null) then
    v_missing := array_append(v_missing, 'no_banner');
  end if;
  if greatest(private.gym_page_trimmed_length(v_gym.page_about_en), private.gym_page_trimmed_length(v_gym.page_about_fr)) < 100 then
    v_missing := array_append(v_missing, 'about_short');
  end if;
  if nullif(btrim(v_gym.country), '') is null then
    v_missing := array_append(v_missing, 'no_country');
  end if;
  if nullif(btrim(v_gym.page_city), '') is null then
    v_missing := array_append(v_missing, 'no_city');
  end if;
  if v_gym.page_contact_phone is null and v_gym.page_contact_whatsapp is null then
    v_missing := array_append(v_missing, 'no_contact');
  end if;
  if v_gym.page_hours is null
     or jsonb_typeof(v_gym.page_hours) <> 'object'
     or not exists (select 1 from jsonb_each(v_gym.page_hours) h where jsonb_typeof(h.value) = 'object') then
    v_missing := array_append(v_missing, 'no_hours');
  end if;
  if not exists (select 1 from plans p where p.gym_id = p_gym_id and p.is_public) then
    v_missing := array_append(v_missing, 'no_public_plan');
  end if;
  if (v_gym.page_lat is null) is distinct from (v_gym.page_lng is null) then
    v_missing := array_append(v_missing, 'map_incomplete');
  end if;

  -- every text that reaches the snapshot: no control character other than newline and tab, and no angle bracket
  v_text := concat_ws(' ', v_gym.name, v_gym.page_about_en, v_gym.page_about_fr, v_gym.page_services_en, v_gym.page_services_fr,
                      v_gym.page_address, v_gym.page_city);
  if v_text ~ '[<>\u0001-\u0008\u000b-\u001f\u007f-\u009f]'
     or exists (select 1 from plans p
                 where p.gym_id = p_gym_id and p.is_public
                   and concat_ws(' ', p.name, p.public_label_en, p.public_label_fr) ~ '[<>\u0001-\u0008\u000b-\u001f\u007f-\u009f]') then
    v_missing := array_append(v_missing, 'bad_text');
  end if;

  -- the content CHECK caps the snapshot at 64 KiB; a page that would not fit is not publishable (and never raises from a trigger)
  if octet_length(private.gym_page_snapshot(p_gym_id)::text) > 65000 then
    v_missing := array_append(v_missing, 'too_large');
  end if;

  return v_missing;
end;
$$;

-- ----------------------------------------------------------------------------
-- The visibility predicate: published, not unpublished, not taken down, its name active and not taken down, its gym active.
-- No gym id column. public_site.pages and public_site.page_media select from this view and nothing else.
-- ----------------------------------------------------------------------------
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

-- 0160's columns first (create or replace may only append): `name` is the page name (the subdomain label).
create or replace view public_site.pages with (security_barrier = true) as
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

-- A projection of the snapshot: logo and banner keys, gallery keys in snapshot order. Deleted media is out of the snapshot the moment
-- the refresh trigger runs. `page_name_id` is the join key to public_site.pages; `gym_id` is deliberately not a column.
create or replace view public_site.page_media with (security_barrier = true) as
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

-- ----------------------------------------------------------------------------
-- Owner notice (copy of the 0163 notify_page_name_decision loop shape). Texts name no individual.
-- p_reason is `name_released` or the comma-joined gate codes.
-- ----------------------------------------------------------------------------
create function private.notify_page_unpublished(p_gym_id uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_title_en text;
  v_title_fr text;
  v_body_en text;
  v_body_fr text;
  v_en text;
  v_fr text;
  v_notice_id uuid;
  v_email text;
  r record;
begin
  if p_reason = 'name_released' then
    v_title_en := 'Your page name was released';
    v_title_fr := 'Le nom de votre page a été libéré';
    v_body_en := 'Your gym page was taken offline and its name was released, because the gym was not active for 12 months. Choose a page name and publish again to bring it back.';
    v_body_fr := 'La page de votre salle a été mise hors ligne et son nom a été libéré, car la salle n''a pas été active pendant 12 mois. Choisissez un nom de page et publiez à nouveau pour la remettre en ligne.';
  else
    select string_agg(private.gym_page_gate_phrase(t.code, 'en'), '; ' order by t.ord),
           string_agg(private.gym_page_gate_phrase(t.code, 'fr'), '; ' order by t.ord)
      into v_en, v_fr
      from unnest(string_to_array(p_reason, ',')) with ordinality as t(code, ord);
    v_title_en := 'Your gym page was taken offline';
    v_title_fr := 'La page de votre salle a été mise hors ligne';
    v_body_en := 'Your gym page is no longer public because it no longer meets the publishing requirements. Missing: ' || coalesce(v_en, p_reason)
      || '. Fix this in your page settings, then publish again.';
    v_body_fr := 'La page de votre salle n''est plus publique car elle ne remplit plus les conditions de publication. Manquant : ' || coalesce(v_fr, p_reason)
      || '. Corrigez cela dans les paramètres de votre page, puis publiez à nouveau.';
  end if;

  for r in
    select distinct m.user_id as uid
      from members m
     where m.gym_id = p_gym_id and m.role = 'owner' and m.deactivated_at is null and m.user_id is not null
  loop
    insert into staff_notices (user_id, gym_id, notice_type, title_en, title_fr, body_en, body_fr)
    values (r.uid, p_gym_id, 'page_unpublished', v_title_en, v_title_fr, v_body_en, v_body_fr)
    returning id into v_notice_id;

    select coalesce(
             (select nullif(btrim(au.email), '') from auth.users au where au.id = r.uid),
             (select nullif(btrim(m2.email), '') from members m2 where m2.user_id = r.uid and m2.gym_id = p_gym_id limit 1))
      into v_email;

    if v_email is not null then
      insert into email_outbox (notice_id, recipient_email, subject, body)
      select v_notice_id, v_email, n.title_en || ' / ' || n.title_fr, n.body_en || E'\n\n' || n.body_fr
        from staff_notices n where n.id = v_notice_id;
    end if;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- refresh_gym_page(): the gate, re-evaluated. Private; only the triggers below call it. It takes the gym row lock FIRST, so a
-- concurrent publish or edit cannot interleave, and re-reads the page under that lock.
-- ----------------------------------------------------------------------------
create function private.refresh_gym_page(p_gym_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_page gym_pages%rowtype;
  v_missing text[];
  v_reason text;
  v_snapshot jsonb;
  v_name_id uuid;
begin
  -- Lock first, with no unlocked early exit: an edit whose trigger runs while a publish is still in flight must wait for that
  -- publish, then see the page it made live and re-judge it (READ COMMITTED re-reads after the wait). Review pass 2 restored this
  -- after pass 1 added an unlocked "no live page" exit, which let a page go live on a gate read just before such an edit committed.
  perform 1 from gyms g where g.id = p_gym_id for no key update;
  if not found then
    return;
  end if;

  select * into v_page from gym_pages gp where gp.gym_id = p_gym_id for update;
  if not found or v_page.published_at is null or v_page.unpublished_at is not null then
    return;
  end if;

  v_missing := private.gym_page_gate_missing(p_gym_id);

  if cardinality(v_missing) = 0 then
    v_snapshot := private.gym_page_snapshot(p_gym_id);
    select pn.id into v_name_id from page_names pn where pn.gym_id = p_gym_id and pn.state = 'active' and pn.taken_down_at is null;
    update gym_pages
       set content = v_snapshot, page_name_id = v_name_id, updated_at = now()
     where gym_id = p_gym_id
       and (content is distinct from v_snapshot or page_name_id is distinct from v_name_id);
    return;
  end if;

  v_reason := array_to_string(v_missing, ',');
  update gym_pages
     set unpublished_at = now(), unpublished_reason = v_reason, updated_at = now()
   where gym_id = p_gym_id;

  perform private.set_page_name_idle(p_gym_id, private.page_name_gym_idle(p_gym_id));
  perform private.notify_page_unpublished(p_gym_id, v_reason);

  perform log_audit_event(
    p_action_type => 'gym_page_unpublished',
    p_gym_id => p_gym_id,
    p_target_entity_id => p_gym_id::text,
    p_target_entity_type => 'gym_page',
    p_system_actor_label => 'system:gym_page_refresh',
    p_metadata => jsonb_build_object('reason', 'gate', 'missing', to_jsonb(v_missing))
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- Triggers: deferred constraint triggers (see the header). Each trigger function is security definer and returns null.
-- ----------------------------------------------------------------------------
create function private.gym_page_refresh_from_gym()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform private.refresh_gym_page(new.id);
  return null;
end;
$$;

create function private.gym_page_refresh_from_plan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform private.refresh_gym_page(old.gym_id);
  else
    perform private.refresh_gym_page(new.gym_id);
    if old.gym_id is distinct from new.gym_id then
      perform private.refresh_gym_page(old.gym_id);
    end if;
  end if;
  return null;
end;
$$;

create function private.gym_page_refresh_from_media()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform private.refresh_gym_page(old.gym_id);
  else
    perform private.refresh_gym_page(new.gym_id);
  end if;
  return null;
end;
$$;

create function private.gym_page_refresh_from_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform private.refresh_gym_page(new.gym_id);
  return null;
end;
$$;

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

-- Only public plans are in the snapshot, so a change matters when the plan is public before or after it.
create constraint trigger gym_page_refresh_update
  after update of is_public, public_label_en, public_label_fr, name, price, currency, billing_interval, plan_type, duration_days, gym_id
  on public.plans
  deferrable initially deferred
  for each row
  when ((old.is_public or new.is_public)
        and (old.is_public is distinct from new.is_public
             or old.public_label_en is distinct from new.public_label_en
             or old.public_label_fr is distinct from new.public_label_fr
             or old.name is distinct from new.name
             or old.price is distinct from new.price
             or old.currency is distinct from new.currency
             or old.billing_interval is distinct from new.billing_interval
             or old.plan_type is distinct from new.plan_type
             or old.duration_days is distinct from new.duration_days
             or old.gym_id is distinct from new.gym_id))
  execute function private.gym_page_refresh_from_plan();

create constraint trigger gym_page_refresh_delete
  after delete on public.plans
  deferrable initially deferred
  for each row
  when (old.is_public)
  execute function private.gym_page_refresh_from_plan();

create constraint trigger gym_page_refresh_insert
  after insert on public.gym_page_media
  deferrable initially deferred
  for each row
  execute function private.gym_page_refresh_from_media();

create constraint trigger gym_page_refresh_update
  after update of deleted_at, sort_order, kind, derivative_key on public.gym_page_media
  deferrable initially deferred
  for each row
  when (old.deleted_at is distinct from new.deleted_at
        or old.sort_order is distinct from new.sort_order
        or old.kind is distinct from new.kind
        or old.derivative_key is distinct from new.derivative_key)
  execute function private.gym_page_refresh_from_media();

-- A hard delete of a live media row (no client can do it; an operator or a purge can) leaves a snapshot key whose object is gone.
create constraint trigger gym_page_refresh_delete
  after delete on public.gym_page_media
  deferrable initially deferred
  for each row
  when (old.deleted_at is null)
  execute function private.gym_page_refresh_from_media();

-- A name becoming active moves gym_pages.page_name_id (a rename); an active name leaving active, or being taken down, is judged too.
create constraint trigger gym_page_refresh_insert
  after insert on public.page_names
  deferrable initially deferred
  for each row
  when (new.state = 'active')
  execute function private.gym_page_refresh_from_name();

create constraint trigger gym_page_refresh_update
  after update of state, taken_down_at on public.page_names
  deferrable initially deferred
  for each row
  when ((old.state = 'active' or new.state = 'active')
        and (old.state is distinct from new.state or old.taken_down_at is distinct from new.taken_down_at))
  execute function private.gym_page_refresh_from_name();

-- ----------------------------------------------------------------------------
-- publish_gym_page(): the writer. Takes no content.
-- Returns {published, missing[]}. Typed errors (message suffix): taken_down, template_required, invalid_template.
-- ----------------------------------------------------------------------------
create function public.publish_gym_page(p_gym_id uuid, p_template text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_is_super_admin boolean;
  v_page gym_pages%rowtype;
  v_has_page boolean;
  v_template text;
  v_missing text[];
  v_snapshot jsonb;
  v_name_id uuid;
  v_name text;
  v_was_live boolean;
begin
  v_is_super_admin := coalesce(private.is_super_admin_live(), false);

  if not v_is_super_admin then
    if p_gym_id is null
       or p_gym_id is distinct from private.support_rpc_gym_id('publish_gym_page')
       or not coalesce(private.support_rpc_role('publish_gym_page') in ('owner', 'supervisor'), false) then
      raise exception 'permission denied';
    end if;
  end if;

  if p_gym_id is null then
    raise exception 'publish_gym_page: gym not found';
  end if;

  if p_template is not null and p_template !~ '^[a-z][a-z0-9-]{1,30}$' then
    raise exception 'publish_gym_page: invalid_template';
  end if;

  perform 1 from gyms g where g.id = p_gym_id for no key update;
  if not found then
    raise exception 'publish_gym_page: gym not found';
  end if;

  if not v_is_super_admin and private.current_gym_status() is distinct from 'active' then
    raise exception 'publish_gym_page: gym % is not active', p_gym_id;
  end if;

  select * into v_page from gym_pages gp where gp.gym_id = p_gym_id for update;
  v_has_page := found;

  if v_has_page and v_page.taken_down_at is not null then
    raise exception 'publish_gym_page: taken_down';
  end if;

  v_template := coalesce(p_template, v_page.template);
  if v_template is null then
    raise exception 'publish_gym_page: template_required';
  end if;

  v_missing := private.gym_page_gate_missing(p_gym_id);
  if cardinality(v_missing) > 0 then
    return jsonb_build_object('published', false, 'missing', to_jsonb(v_missing));
  end if;

  v_snapshot := private.gym_page_snapshot(p_gym_id);
  select pn.id, pn.name into v_name_id, v_name
    from page_names pn where pn.gym_id = p_gym_id and pn.state = 'active' and pn.taken_down_at is null;
  v_was_live := v_has_page and v_page.published_at is not null and v_page.unpublished_at is null;

  insert into gym_pages (gym_id, page_name_id, template, content, published_at, unpublished_at, unpublished_reason, updated_at)
  values (p_gym_id, v_name_id, v_template, v_snapshot, now(), null, null, now())
  on conflict (gym_id) do update set
    page_name_id = excluded.page_name_id,
    template = excluded.template,
    content = excluded.content,
    published_at = case when gym_pages.published_at is not null and gym_pages.unpublished_at is null
                        then gym_pages.published_at else now() end,
    unpublished_at = null,
    unpublished_reason = null,
    updated_at = now();

  perform private.set_page_name_idle(p_gym_id, private.page_name_gym_idle(p_gym_id));

  perform log_audit_event(
    p_action_type => 'gym_page_published',
    p_gym_id => p_gym_id,
    p_target_entity_id => p_gym_id::text,
    p_target_entity_type => 'gym_page',
    p_metadata => jsonb_build_object('template', v_template, 'name', v_name, 'republish', v_was_live)
  );

  return jsonb_build_object('published', true, 'missing', '[]'::jsonb);
end;
$$;

-- ----------------------------------------------------------------------------
-- unpublish_gym_page(): always allowed for an admitted role, also for a suspended gym. Returns whether a live page went offline.
-- ----------------------------------------------------------------------------
create function public.unpublish_gym_page(p_gym_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_is_super_admin boolean;
  v_n integer;
begin
  v_is_super_admin := coalesce(private.is_super_admin_live(), false);

  if not v_is_super_admin then
    if p_gym_id is null
       or p_gym_id is distinct from private.support_rpc_gym_id('unpublish_gym_page')
       or not coalesce(private.support_rpc_role('unpublish_gym_page') in ('owner', 'supervisor'), false) then
      raise exception 'permission denied';
    end if;
  end if;

  if p_gym_id is null then
    raise exception 'unpublish_gym_page: gym not found';
  end if;

  perform 1 from gyms g where g.id = p_gym_id for no key update;
  if not found then
    raise exception 'unpublish_gym_page: gym not found';
  end if;

  update gym_pages
     set unpublished_at = now(), unpublished_reason = 'owner', updated_at = now()
   where gym_id = p_gym_id and published_at is not null and unpublished_at is null;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return false;
  end if;

  perform private.set_page_name_idle(p_gym_id, private.page_name_gym_idle(p_gym_id));

  perform log_audit_event(
    p_action_type => 'gym_page_unpublished',
    p_gym_id => p_gym_id,
    p_target_entity_id => p_gym_id::text,
    p_target_entity_type => 'gym_page',
    p_metadata => jsonb_build_object('reason', 'owner')
  );

  return true;
end;
$$;

-- ----------------------------------------------------------------------------
-- Grants. Public functions: authenticated only. Private functions and trigger functions: no client role at all.
-- ----------------------------------------------------------------------------
revoke execute on function public.publish_gym_page(uuid, text) from public, anon;
revoke execute on function public.unpublish_gym_page(uuid) from public, anon;
grant execute on function public.publish_gym_page(uuid, text) to authenticated;
grant execute on function public.unpublish_gym_page(uuid) to authenticated;

revoke execute on function private.gym_page_trimmed_length(text) from public, anon, authenticated, service_role;
revoke execute on function private.gym_page_gate_phrase(text, text) from public, anon, authenticated, service_role;
revoke execute on function private.gym_page_snapshot(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.gym_page_gate_missing(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.notify_page_unpublished(uuid, text) from public, anon, authenticated, service_role;
revoke execute on function private.refresh_gym_page(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.gym_page_refresh_from_gym() from public, anon, authenticated, service_role;
revoke execute on function private.gym_page_refresh_from_plan() from public, anon, authenticated, service_role;
revoke execute on function private.gym_page_refresh_from_media() from public, anon, authenticated, service_role;
revoke execute on function private.gym_page_refresh_from_name() from public, anon, authenticated, service_role;

insert into private.support_capabilities (capability, kind, object_name) values
  ('gym_page', 'rpc', 'publish_gym_page'),
  ('gym_page', 'rpc', 'unpublish_gym_page');

-- A live support caller may write only the audit action types its allow-listed capabilities produce (23.10).
insert into private.support_audit_actions (action_type) values
  ('gym_page_published'), ('gym_page_unpublished')
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- The sweep (owner decision 2026-11-08, option B). Unchanged except the first loop: a gym that is not active no longer keeps its name
-- forever because its page is still flagged published. Past reserved_until, the sweep takes the page offline (reason name_released),
-- tells the Owners, and releases the name and the gym's redirects, under the gym row lock with the same re-checks and row-count guard.
-- ----------------------------------------------------------------------------
create or replace function private.page_names_sweep()
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_started timestamptz := now();
  r record;
  v_released integer := 0;
  v_expired integer := 0;
  v_reminded integer := 0;
  v_failed integer := 0;
  v_rows integer;
  v_pages integer;
  v_error text;
begin
  for r in
    select pn.id, pn.gym_id, pn.name
      from page_names pn
      join gyms g on g.id = pn.gym_id
     where pn.state = 'active' and pn.taken_down_at is null
       and pn.reserved_until is not null and pn.reserved_until < now()
       and (g.status <> 'active' or not private.page_name_has_published_page(pn.gym_id))
     order by pn.reserved_until, pn.id
  loop
    begin
      -- same lock order as claim_page_name() (gym row first), then re-check inside the lock: a claim, a rename or a publish
      -- that committed after the select above must not lose its name to this loop
      perform 1 from gyms g where g.id = r.gym_id for update;

      -- a live page of a gym that is not active goes offline with its name
      update gym_pages gp
         set unpublished_at = now(), unpublished_reason = 'name_released', updated_at = now()
       where gp.gym_id = r.gym_id and gp.published_at is not null and gp.unpublished_at is null
         and exists (select 1 from gyms g where g.id = r.gym_id and g.status <> 'active')
         and exists (select 1 from page_names a
                      where a.id = r.id and a.state = 'active' and a.taken_down_at is null
                        and a.reserved_until is not null and a.reserved_until < now());
      get diagnostics v_pages = row_count;

      update page_names set state = 'released'
       where id = r.id and state = 'active' and taken_down_at is null
         and reserved_until is not null and reserved_until < now()
         and not private.page_name_has_published_page(r.gym_id);
      get diagnostics v_rows = row_count;
      if v_rows > 0 then
        -- the gym's redirects would point at nothing: release them with the name they pointed at
        update page_names set state = 'released', reserved_until = coalesce(reserved_until, now())
         where gym_id = r.gym_id and state = 'redirect' and taken_down_at is null;
        perform log_audit_event(
          p_action_type => 'page_name_released', p_gym_id => r.gym_id, p_target_entity_id => r.id::text,
          p_target_entity_type => 'page_name', p_system_actor_label => 'system:page_names_sweep',
          p_metadata => jsonb_build_object('name', r.name, 'from_state', 'active'));
        if v_pages > 0 then
          perform private.notify_page_unpublished(r.gym_id, 'name_released');
          perform log_audit_event(
            p_action_type => 'gym_page_unpublished', p_gym_id => r.gym_id, p_target_entity_id => r.gym_id::text,
            p_target_entity_type => 'gym_page', p_system_actor_label => 'system:page_names_sweep',
            p_metadata => jsonb_build_object('reason', 'name_released', 'name', r.name));
        end if;
        v_released := v_released + 1;
      end if;
    exception when others then
      v_failed := v_failed + 1;
      v_error := left(sqlerrm, 200);
    end;
  end loop;

  for r in
    select pn.id, pn.gym_id, pn.name
      from page_names pn
     where pn.state = 'redirect' and pn.taken_down_at is null
       and pn.reserved_until is not null and pn.reserved_until < now()
     order by pn.reserved_until, pn.id
  loop
    begin
      update page_names set state = 'released' where id = r.id and state = 'redirect';
      perform log_audit_event(
        p_action_type => 'page_name_released', p_gym_id => r.gym_id, p_target_entity_id => r.id::text,
        p_target_entity_type => 'page_name', p_system_actor_label => 'system:page_names_sweep',
        p_metadata => jsonb_build_object('name', r.name, 'from_state', 'redirect'));
      v_expired := v_expired + 1;
    exception when others then
      v_failed := v_failed + 1;
      v_error := left(sqlerrm, 200);
    end;
  end loop;

  for r in
    select pn.id, pn.gym_id, pn.name
      from page_names pn
     where pn.state = 'held' and pn.reminded_at is null and private.add_business_days(pn.held_at, 2) < now()
     order by pn.held_at, pn.id
  loop
    begin
      perform private.notify_page_name_overdue(r.gym_id, r.name);
      update page_names set reminded_at = now() where id = r.id;
      v_reminded := v_reminded + 1;
    exception when others then
      v_failed := v_failed + 1;
      v_error := left(sqlerrm, 200);
    end;
  end loop;

  insert into job_runs (job_name, started_at, finished_at, status, error)
  values ('page_names_sweep', v_started, now(),
          case when v_failed > 0 then 'failure'::job_status else 'success'::job_status end,
          case when v_failed > 0 then v_failed || ' failed, ' || v_released || ' released, ' || v_expired || ' redirects expired, ' || v_reminded || ' reminded: ' || v_error
               when v_released + v_expired + v_reminded > 0 then v_released || ' released, ' || v_expired || ' redirects expired, ' || v_reminded || ' reminded' end);
end;
$$;

revoke execute on function private.page_names_sweep() from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- The migration proves its own result.
-- ----------------------------------------------------------------------------
do $verify$
declare
  v_fn text;
begin
  if not exists (select 1 from pg_attribute where attrelid = 'public.gym_pages'::regclass and attname = 'unpublished_reason' and not attisdropped) then
    raise exception '0164: gym_pages.unpublished_reason is missing';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'gym_pages_gym_page_name_fkey' and conrelid = 'public.gym_pages'::regclass)
     or exists (select 1 from pg_constraint where conname = 'gym_pages_page_name_id_fkey') then
    raise exception '0164: the composite page name foreign key is not in place';
  end if;
  if (select pg_get_constraintdef(oid) from pg_constraint where conname = 'gym_pages_content_keys') !~ '''name'''
     or (select pg_get_constraintdef(oid) from pg_constraint where conname = 'gym_pages_content_keys') !~ '65536' then
    raise exception '0164: the content CHECK is not the expected one';
  end if;

  -- the views read the one predicate and expose no gym id
  if (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'public_site' and table_name = 'pages')
       is distinct from array['page_name_id', 'template', 'schema_version', 'content', 'published_at', 'updated_at', 'name'] then
    raise exception '0164: public_site.pages columns are wrong';
  end if;
  if (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'public_site' and table_name = 'page_media')
       is distinct from array['derivative_key', 'kind', 'sort_order', 'page_name_id'] then
    raise exception '0164: public_site.page_media columns are wrong';
  end if;
  if pg_get_viewdef('public_site.pages'::regclass) !~ 'gym_page_visible' or pg_get_viewdef('public_site.page_media'::regclass) !~ 'gym_page_visible'
     or pg_get_viewdef('public_site.page_media'::regclass) ~ 'gym_page_media' then
    raise exception '0164: a public_site view does not read the single visibility predicate';
  end if;
  if exists (select 1 from unnest(array['public', 'anon', 'authenticated', 'service_role']) g
              where has_table_privilege(g, 'private.gym_page_visible', 'select')) then
    raise exception '0164: the visibility view is readable by a client role';
  end if;
  if not has_table_privilege('public_site_reader', 'public_site.pages', 'select')
     or not has_table_privilege('public_site_reader', 'public_site.page_media', 'select')
     or has_table_privilege('public_site_reader', 'private.gym_page_visible', 'select') then
    raise exception '0164: reader grants are wrong';
  end if;

  if (select count(*) from pg_trigger where tgname like 'gym\_page\_refresh%' and not tgisinternal and tgconstraint <> 0) <> 8 then
    raise exception '0164: a refresh trigger is missing (expected eight deferred constraint triggers)';
  end if;
  if exists (select 1 from pg_trigger where tgname like 'gym\_page\_refresh%' and not tgisinternal and (not tgdeferrable or not tginitdeferred)) then
    raise exception '0164: a refresh trigger is not deferred';
  end if;

  for v_fn in
    select p.oid::regprocedure::text from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname in ('publish_gym_page', 'unpublish_gym_page')
  loop
    if has_function_privilege('anon', v_fn, 'execute') or has_function_privilege('public', v_fn, 'execute')
       or not has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0164: % has the wrong execute grants', v_fn;
    end if;
  end loop;
  for v_fn in
    select p.oid::regprocedure::text from pg_proc p
     where p.pronamespace = 'private'::regnamespace
       and p.proname in ('gym_page_trimmed_length', 'gym_page_gate_phrase', 'gym_page_snapshot', 'gym_page_gate_missing', 'notify_page_unpublished',
                         'refresh_gym_page', 'gym_page_refresh_from_gym', 'gym_page_refresh_from_plan', 'gym_page_refresh_from_media',
                         'gym_page_refresh_from_name', 'page_names_sweep')
  loop
    if has_function_privilege('anon', v_fn, 'execute') or has_function_privilege('public', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') or has_function_privilege('service_role', v_fn, 'execute') then
      raise exception '0164: % is callable by a client role', v_fn;
    end if;
  end loop;

  if (select count(*) from private.support_capabilities where capability = 'gym_page' and kind = 'rpc'
        and object_name in ('publish_gym_page', 'unpublish_gym_page')) <> 2 then
    raise exception '0164: capability rows are missing';
  end if;
  if (select count(*) from private.support_audit_actions where action_type in ('gym_page_published', 'gym_page_unpublished')) <> 2 then
    raise exception '0164: audit action rows are missing';
  end if;
  if not exists (select 1 from cron.job where jobname = 'page_names_sweep') then
    raise exception '0164: the sweep is no longer scheduled';
  end if;
end
$verify$;
