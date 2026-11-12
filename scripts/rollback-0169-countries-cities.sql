-- Rollback for migration 0169 (country and city controlled lists, gym city selection, Story 25.1).
-- Writes each mapped gym's city NAME back into the legacy gyms.page_city text (wherever it differs, so a city chosen after 0169 wins over stale text), restores the 0161, 0164, 0165, 0166
-- and 0167 definitions of the setter, gate, bad-text listing, snapshot builder, status reader and gym refresh trigger, then drops the four
-- tables, gyms.city_id, the triggers, the functions and the support rows. Audit rows already written ('city_added', 'city_updated',
-- 'gym_location_updated') stay (audit_log is append-only). Live pages keep their stored snapshot (it already holds the city name as text).
-- Roll back the 25.1 dashboard and Super Admin code first: the editor calls set_gym_location() and the Cities screen calls add_city() /
-- update_city(), and the status read of the dashboard would fail on a gate it no longer understands only if the code is older than 0169.
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0169-countries-cities.sql

set local lock_timeout = '5s';

-- 1. The legacy text gets the city name back for every gym with a city (the 0161 pin is opened for this statement only). Done first: page_city is not watched by the
-- 0169 refresh trigger, so no deferred event is queued, and the DDL below is not blocked.
select set_config('app.gym_page_content_bypass', 'true', true);
update public.gyms g
   set page_city = c.name
  from public.cities c
 where c.id = g.city_id
   and g.page_city is distinct from c.name;
select set_config('app.gym_page_content_bypass', 'false', true);

-- 2. Triggers added by 0169.
drop trigger if exists gym_page_refresh_city on public.cities;
drop trigger if exists gyms_z_clear_city_on_country_change on public.gyms;
drop trigger if exists gyms_a_pin_city_id on public.gyms;
drop trigger if exists cities_no_delete on public.cities;
drop trigger if exists cities_no_truncate on public.cities;

-- 3. The gym refresh trigger: 0166's (page_city, no city_id).
drop trigger if exists gym_page_refresh on public.gyms;

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

-- 4. The previous definitions.
-- 0166's snapshot builder
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

revoke execute on function private.gym_page_snapshot(uuid) from public, anon, authenticated, service_role;

-- 0164's gate
create or replace function private.gym_page_gate_missing(p_gym_id uuid)
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

revoke execute on function private.gym_page_gate_missing(uuid) from public, anon, authenticated, service_role;

-- 0165's bad-text listing
create or replace function private.gym_page_bad_text_fields(p_gym_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_gym gyms%rowtype;
  v_out jsonb := '[]'::jsonb;
  v_lang text;
  v_json jsonb;
  r record;
begin
  select * into v_gym from gyms g where g.id = p_gym_id;
  if not found then
    return v_out;
  end if;
  v_json := to_jsonb(v_gym);

  if v_gym.name ~ '[<>\u0001-\u0008\u000b-\u001f\u007f-\u009f]' then
    v_out := v_out || jsonb_build_object('field', 'gym_name');
  end if;
  foreach v_lang in array private.gym_page_languages() loop
    if (v_json ->> ('page_about_' || v_lang)) ~ '[<>\u0001-\u0008\u000b-\u001f\u007f-\u009f]' then
      v_out := v_out || jsonb_build_object('field', 'about', 'lang', v_lang);
    end if;
    if (v_json ->> ('page_services_' || v_lang)) ~ '[<>\u0001-\u0008\u000b-\u001f\u007f-\u009f]' then
      v_out := v_out || jsonb_build_object('field', 'services', 'lang', v_lang);
    end if;
  end loop;
  if v_gym.page_address ~ '[<>\u0001-\u0008\u000b-\u001f\u007f-\u009f]' then
    v_out := v_out || jsonb_build_object('field', 'address');
  end if;
  if v_gym.page_city ~ '[<>\u0001-\u0008\u000b-\u001f\u007f-\u009f]' then
    v_out := v_out || jsonb_build_object('field', 'city');
  end if;
  for r in
    select p.name from plans p
     where p.gym_id = p_gym_id and p.is_public
       and concat_ws(' ', p.name, p.public_label_en, p.public_label_fr) ~ '[<>\u0001-\u0008\u000b-\u001f\u007f-\u009f]'
     order by p.price, p.name, p.id
  loop
    v_out := v_out || jsonb_build_object('field', 'plan_name', 'plan_name', r.name);
  end loop;
  return v_out;
end;
$$;

revoke execute on function private.gym_page_bad_text_fields(uuid) from public, anon, authenticated, service_role;

-- 0167's status reader
create or replace function public.get_gym_page_status(p_gym_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_gym gyms%rowtype;
  v_gp gym_pages%rowtype;
  v_has_page boolean;
  v_missing text[];
  v_reasons text[] := '{}';
  v_live boolean;
  v_taken boolean;
  v_has_name boolean;
  v_started boolean;
  v_state text;
  v_json jsonb;
  v_lang text;
  v_langs jsonb := '[]'::jsonb;
  v_chars integer;
  v_media jsonb;
  v_td private.page_takedowns%rowtype;
  v_ap private.page_appeals%rowtype;
  v_reason_code text;
  v_appeal jsonb := null;
begin
  if not coalesce(private.is_super_admin_live(), false) then
    if p_gym_id is null
       or p_gym_id is distinct from private.support_rpc_gym_id('get_gym_page_status')
       or not coalesce(private.support_rpc_role('get_gym_page_status') in ('owner', 'supervisor'), false) then
      raise exception 'permission denied';
    end if;
  end if;

  select * into v_gym from gyms g where g.id = p_gym_id;
  if not found then
    raise exception 'get_gym_page_status: gym not found';
  end if;

  select * into v_gp from gym_pages gp where gp.gym_id = p_gym_id;
  v_has_page := found;

  v_missing := private.gym_page_gate_missing(p_gym_id);
  v_json := to_jsonb(v_gym);

  if v_has_page and v_gp.unpublished_reason is not null then
    v_reasons := string_to_array(v_gp.unpublished_reason, ',');
  end if;

  v_live := v_has_page and v_gp.published_at is not null and v_gp.unpublished_at is null;
  v_taken := (v_has_page and v_gp.taken_down_at is not null)
             or exists (select 1 from page_names pn where pn.gym_id = p_gym_id and pn.taken_down_at is not null and pn.state in ('active', 'held', 'reserved'));
  v_has_name := exists (select 1 from page_names pn where pn.gym_id = p_gym_id and pn.state = 'active' and pn.taken_down_at is null);

  v_started := v_gym.page_about_en is not null or v_gym.page_about_fr is not null
               or v_gym.page_services_en is not null or v_gym.page_services_fr is not null
               or v_gym.page_address is not null or v_gym.page_city is not null
               or v_gym.page_lat is not null or v_gym.page_lng is not null or v_gym.page_hours is not null
               or v_gym.page_contact_phone is not null or v_gym.page_contact_whatsapp is not null
               or v_has_page
               or exists (select 1 from plans p where p.gym_id = p_gym_id and p.is_public)
               or exists (select 1 from gym_page_media m where m.gym_id = p_gym_id and m.deleted_at is null)
               or exists (select 1 from page_names pn where pn.gym_id = p_gym_id and pn.state in ('held', 'active', 'reserved'));

  v_state := case
    when v_taken then 'taken_down'
    when v_live and v_gym.status = 'active' then 'published'
    when v_live then 'offline_suspended'
    when v_has_page and v_gp.published_at is not null and v_gp.unpublished_at is not null
         and v_reasons = array['name_released'] and not v_has_name then 'offline_name_released'
    when v_has_page and v_gp.published_at is not null and v_gp.unpublished_at is not null
         and v_reasons <> array['owner'] and v_reasons <> array['name_released'] and v_reasons && v_missing then 'offline_gate'
    when not v_started then 'not_started'
    when cardinality(v_missing) = 0 then 'ready'
    else 'in_progress'
  end;

  if v_taken then
    v_reason_code := v_gp.taken_down_reason;
    select * into v_td from private.page_takedowns t where t.gym_id = p_gym_id and t.lifted_at is null;
    if found then
      v_reason_code := coalesce(v_reason_code, v_td.reason);
      select * into v_ap from private.page_appeals a where a.takedown_id = v_td.id;
      v_appeal := jsonb_build_object(
        'state', case when v_ap.id is null then 'none' when v_ap.decision is null then 'open' else v_ap.decision end,
        'submitted_at', v_ap.created_at,
        'decided_at', v_ap.decided_at,
        'decision_reason', v_ap.decision_reason);
    else
      v_appeal := jsonb_build_object('state', 'none', 'submitted_at', null, 'decided_at', null, 'decision_reason', null);
    end if;
  end if;

  foreach v_lang in array private.gym_page_languages() loop
    v_chars := private.gym_page_trimmed_length(v_json ->> ('page_about_' || v_lang));
    v_langs := v_langs || jsonb_build_object(
      'code', v_lang,
      'complete', private.gym_page_lang_complete(v_json ->> ('page_about_' || v_lang)),
      'characters', v_chars,
      'needed', greatest(0, 100 - v_chars));
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'derivative_key', m.derivative_key, 'sort_order', m.sort_order)
                            order by m.kind, m.sort_order, m.created_at, m.id), '[]'::jsonb)
    into v_media
    from gym_page_media m
   where m.gym_id = p_gym_id and m.deleted_at is null;

  return jsonb_build_object(
    'state', v_state,
    'template', case when v_has_page then v_gp.template end,
    'published_at', case when v_live then v_gp.published_at end,
    'unpublished_reasons', to_jsonb(v_reasons),
    'missing', to_jsonb(v_missing),
    'bad_text_fields', private.gym_page_bad_text_fields(p_gym_id),
    'about_min_chars', 100,
    'languages', v_langs,
    'media', v_media,
    'snapshot', private.gym_page_snapshot(p_gym_id),
    'taken_down_reason', case when v_taken then v_reason_code end,
    'appeal', v_appeal
  );
end;
$$;

revoke execute on function public.get_gym_page_status(uuid) from public, anon;
grant execute on function public.get_gym_page_status(uuid) to authenticated;

-- 0161's setter, with the city key
create or replace function set_gym_page_content(p_gym_id uuid, p_content jsonb, p_plans jsonb default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_super_admin boolean;
  v_gym gyms%rowtype;
  v_key text;
  v_item jsonb;
  v_plan plans%rowtype;
  v_seen uuid[] := '{}';
  v_plan_id uuid;
  v_new_pub boolean;
  v_new_en text;
  v_new_fr text;
  v_plan_changes jsonb := '[]'::jsonb;
  v_old jsonb := '{}'::jsonb;
  v_new jsonb := '{}'::jsonb;
  -- new values, starting from the stored ones
  n_about_en text; n_about_fr text; n_services_en text; n_services_fr text;
  n_address text; n_lat numeric; n_lng numeric; n_hours jsonb;
  n_phone text; n_whatsapp text; n_city text;
  v_plan_updates jsonb[] := '{}';
  v_u jsonb;
begin
  v_is_super_admin := coalesce(private.is_super_admin_live(), false);

  if not v_is_super_admin then
    if p_gym_id is null
       or p_gym_id is distinct from private.support_rpc_gym_id('set_gym_page_content')
       or not coalesce(private.support_rpc_role('set_gym_page_content') in ('owner', 'supervisor'), false) then
      raise exception 'permission denied';
    end if;
  end if;

  if p_gym_id is null then
    raise exception 'set_gym_page_content: gym not found';
  end if;

  if p_content is null or jsonb_typeof(p_content) <> 'object' then
    raise exception 'set_gym_page_content: invalid_content';
  end if;
  if p_plans is not null and jsonb_typeof(p_plans) <> 'array' then
    raise exception 'set_gym_page_content: invalid_plans';
  end if;

  for v_key in select jsonb_object_keys(p_content) loop
    if v_key not in ('about_en', 'about_fr', 'services_en', 'services_fr', 'address', 'lat', 'lng',
                     'hours', 'contact_phone', 'contact_whatsapp', 'city') then
      raise exception 'set_gym_page_content: unknown_key %', v_key;
    end if;
  end loop;

  select * into v_gym from gyms g where g.id = p_gym_id for update;

  if not found then
    raise exception 'set_gym_page_content: gym not found';
  end if;

  if not v_is_super_admin and private.current_gym_status() is distinct from 'active' then
    raise exception 'set_gym_page_content: gym % is not active', p_gym_id;
  end if;

  n_about_en := v_gym.page_about_en;       n_about_fr := v_gym.page_about_fr;
  n_services_en := v_gym.page_services_en; n_services_fr := v_gym.page_services_fr;
  n_address := v_gym.page_address;         n_lat := v_gym.page_lat;       n_lng := v_gym.page_lng;
  n_hours := v_gym.page_hours;             n_phone := v_gym.page_contact_phone;
  n_whatsapp := v_gym.page_contact_whatsapp; n_city := v_gym.page_city;

  if p_content ? 'about_en' then n_about_en := private.gym_page_text(p_content, 'about_en', 2000); end if;
  if p_content ? 'about_fr' then n_about_fr := private.gym_page_text(p_content, 'about_fr', 2000); end if;
  if p_content ? 'services_en' then n_services_en := private.gym_page_text(p_content, 'services_en', 2000); end if;
  if p_content ? 'services_fr' then n_services_fr := private.gym_page_text(p_content, 'services_fr', 2000); end if;
  if p_content ? 'address' then n_address := private.gym_page_text(p_content, 'address', 300); end if;
  if p_content ? 'city' then n_city := private.gym_page_text(p_content, 'city', 100); end if;
  if p_content ? 'lat' then n_lat := private.gym_page_coord(p_content, 'lat', 90); end if;
  if p_content ? 'lng' then n_lng := private.gym_page_coord(p_content, 'lng', 180); end if;
  if p_content ? 'contact_phone' then n_phone := private.gym_page_phone(p_content, 'contact_phone'); end if;
  if p_content ? 'contact_whatsapp' then n_whatsapp := private.gym_page_phone(p_content, 'contact_whatsapp'); end if;
  if p_content ? 'hours' then
    if jsonb_typeof(p_content -> 'hours') = 'null' then
      n_hours := null;
    elsif private.gym_page_hours_valid(p_content -> 'hours') then
      n_hours := p_content -> 'hours';
    else
      raise exception 'set_gym_page_content: invalid_hours';
    end if;
  end if;

  -- plans: validate everything before writing anything
  if p_plans is not null then
    for v_item in select * from jsonb_array_elements(p_plans) loop
      if jsonb_typeof(v_item) <> 'object' then
        raise exception 'set_gym_page_content: invalid_plans';
      end if;
      for v_key in select jsonb_object_keys(v_item) loop
        if v_key not in ('plan_id', 'is_public', 'public_label_en', 'public_label_fr') then
          raise exception 'set_gym_page_content: unknown_plan_key %', v_key;
        end if;
      end loop;
      if jsonb_typeof(v_item -> 'plan_id') is distinct from 'string'
         or (v_item ->> 'plan_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'set_gym_page_content: invalid_plan_id';
      end if;
      v_plan_id := (v_item ->> 'plan_id')::uuid;
      if v_plan_id = any (v_seen) then
        raise exception 'set_gym_page_content: duplicate_plan_id';
      end if;
      v_seen := v_seen || v_plan_id;

      select * into v_plan from plans p where p.id = v_plan_id and p.gym_id = p_gym_id for update;
      if not found then
        raise exception 'set_gym_page_content: plan_not_in_gym';
      end if;

      v_new_pub := v_plan.is_public;
      v_new_en := v_plan.public_label_en;
      v_new_fr := v_plan.public_label_fr;
      if v_item ? 'is_public' then
        if jsonb_typeof(v_item -> 'is_public') <> 'boolean' then
          raise exception 'set_gym_page_content: invalid_is_public';
        end if;
        v_new_pub := (v_item ->> 'is_public')::boolean;
      end if;
      if v_item ? 'public_label_en' then v_new_en := private.gym_page_text(v_item, 'public_label_en', 80); end if;
      if v_item ? 'public_label_fr' then v_new_fr := private.gym_page_text(v_item, 'public_label_fr', 80); end if;

      if v_new_pub is distinct from v_plan.is_public
         or v_new_en is distinct from v_plan.public_label_en
         or v_new_fr is distinct from v_plan.public_label_fr then
        v_plan_updates := v_plan_updates || jsonb_build_object(
          'plan_id', v_plan_id, 'is_public', v_new_pub, 'label_en', v_new_en, 'label_fr', v_new_fr);
        v_plan_changes := v_plan_changes || jsonb_build_object(
          'plan_id', v_plan_id,
          'old', jsonb_build_object('is_public', v_plan.is_public, 'public_label_en', v_plan.public_label_en, 'public_label_fr', v_plan.public_label_fr),
          'new', jsonb_build_object('is_public', v_new_pub, 'public_label_en', v_new_en, 'public_label_fr', v_new_fr));
      end if;
    end loop;
  end if;

  -- changed gym fields, old and new
  if n_about_en is distinct from v_gym.page_about_en then
    v_old := v_old || jsonb_build_object('about_en', v_gym.page_about_en); v_new := v_new || jsonb_build_object('about_en', n_about_en); end if;
  if n_about_fr is distinct from v_gym.page_about_fr then
    v_old := v_old || jsonb_build_object('about_fr', v_gym.page_about_fr); v_new := v_new || jsonb_build_object('about_fr', n_about_fr); end if;
  if n_services_en is distinct from v_gym.page_services_en then
    v_old := v_old || jsonb_build_object('services_en', v_gym.page_services_en); v_new := v_new || jsonb_build_object('services_en', n_services_en); end if;
  if n_services_fr is distinct from v_gym.page_services_fr then
    v_old := v_old || jsonb_build_object('services_fr', v_gym.page_services_fr); v_new := v_new || jsonb_build_object('services_fr', n_services_fr); end if;
  if n_address is distinct from v_gym.page_address then
    v_old := v_old || jsonb_build_object('address', v_gym.page_address); v_new := v_new || jsonb_build_object('address', n_address); end if;
  if n_lat is distinct from v_gym.page_lat then
    v_old := v_old || jsonb_build_object('lat', v_gym.page_lat); v_new := v_new || jsonb_build_object('lat', n_lat); end if;
  if n_lng is distinct from v_gym.page_lng then
    v_old := v_old || jsonb_build_object('lng', v_gym.page_lng); v_new := v_new || jsonb_build_object('lng', n_lng); end if;
  if n_hours is distinct from v_gym.page_hours then
    v_old := v_old || jsonb_build_object('hours', v_gym.page_hours); v_new := v_new || jsonb_build_object('hours', n_hours); end if;
  if n_phone is distinct from v_gym.page_contact_phone then
    v_old := v_old || jsonb_build_object('contact_phone', v_gym.page_contact_phone); v_new := v_new || jsonb_build_object('contact_phone', n_phone); end if;
  if n_whatsapp is distinct from v_gym.page_contact_whatsapp then
    v_old := v_old || jsonb_build_object('contact_whatsapp', v_gym.page_contact_whatsapp); v_new := v_new || jsonb_build_object('contact_whatsapp', n_whatsapp); end if;
  if n_city is distinct from v_gym.page_city then
    v_old := v_old || jsonb_build_object('city', v_gym.page_city); v_new := v_new || jsonb_build_object('city', n_city); end if;

  if v_new = '{}'::jsonb and jsonb_array_length(v_plan_changes) = 0 then
    return;
  end if;

  perform set_config('app.gym_page_content_bypass', 'true', true);

  if v_new <> '{}'::jsonb then
    update gyms set
      page_about_en = n_about_en, page_about_fr = n_about_fr,
      page_services_en = n_services_en, page_services_fr = n_services_fr,
      page_address = n_address, page_lat = n_lat, page_lng = n_lng, page_hours = n_hours,
      page_contact_phone = n_phone, page_contact_whatsapp = n_whatsapp, page_city = n_city
    where id = p_gym_id;
  end if;

  foreach v_u in array v_plan_updates loop
    update plans set
      is_public = (v_u ->> 'is_public')::boolean,
      public_label_en = v_u ->> 'label_en',
      public_label_fr = v_u ->> 'label_fr'
    where id = (v_u ->> 'plan_id')::uuid and gym_id = p_gym_id;
  end loop;

  perform set_config('app.gym_page_content_bypass', 'false', true);

  perform log_audit_event(
    p_action_type => 'gym_page_content_changed',
    p_gym_id => p_gym_id,
    p_target_entity_id => p_gym_id::text,
    p_target_entity_type => 'gym',
    p_metadata => jsonb_build_object('old', v_old, 'new', v_new, 'plans', v_plan_changes)
  );
end;
$$;

revoke execute on function set_gym_page_content(uuid, jsonb, jsonb) from public, anon;
grant execute on function set_gym_page_content(uuid, jsonb, jsonb) to authenticated;

-- 5. What 0169 added.
drop function if exists public.set_gym_location(uuid, text, uuid);
drop function if exists public.list_gyms_without_city();
drop function if exists public.update_city(uuid, text, text, text[], numeric, numeric);
drop function if exists public.add_city(text, text, text, text[], numeric, numeric);

delete from private.support_capabilities where kind = 'rpc' and object_name = 'set_gym_location';
delete from private.support_audit_actions where action_type = 'gym_location_updated';

alter table public.gyms drop column if exists city_id;

drop table if exists public.city_slug_history;
drop table if exists public.city_aliases;
drop table if exists public.cities;
drop table if exists public.countries;

drop function if exists private.gym_page_refresh_from_city();
drop function if exists private.clear_gym_city_on_country_change();
drop function if exists private.pin_gym_city_id();
drop function if exists private.cities_refuse_delete();
drop function if exists private.city_alias_clash(text, text, uuid, text[]);
drop function if exists private.city_alias_rows(text, text[]);
drop function if exists private.city_coords_check(text, numeric, numeric);
drop function if exists private.city_slug_check(text, text, uuid, text);
drop function if exists private.city_name_clean(text, text);
drop function if exists private.city_slug_reserved(text);
drop function if exists private.place_slug(text);
drop function if exists private.place_norm(text);

-- 6. The pages that are live now are judged again against the restored gate.
do $refresh$
declare
  r record;
begin
  for r in select gp.gym_id from public.gym_pages gp where gp.published_at is not null and gp.unpublished_at is null order by gp.gym_id loop
    perform private.refresh_gym_page(r.gym_id);
  end loop;
end
$refresh$;
