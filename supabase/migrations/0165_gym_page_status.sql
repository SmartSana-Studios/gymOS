-- ============================================================================
-- 0165: Landing-page status read, language completeness in the snapshot, upload cap (Epic 24, Story 24.9; FR-197, FR-199, FR-201, OQ-28).
--
-- The database half of the editor and publish screens. The gate (`private.gym_page_gate_missing`) and the snapshot builder are private, and
-- `gym_pages` is closed to every client role, so the dashboard could not read a page's status, the missing gate codes, the media list or the
-- content that would become public. This migration adds:
--
--   get_gym_page_status(gym)        Read-only, security definer. Owner, Supervisor, live-assigned support, Super Admin (the admission of
--                                   get_gym_page_name; a capability row; no audit row). Returns FACTS, not copy: the state, the template,
--                                   the unpublish reasons as codes, the missing gate codes, which text fields hold a forbidden character,
--                                   the completeness of every content language, the live media rows and the would-be snapshot. The checklist
--                                   and the publish list both render from this one answer; the client maps codes to words.
--   private.gym_page_languages()    The ONE list of content languages (today en, fr). The status function walks it. Adding a language is
--                                   this list, its columns on gyms and (for the public snapshot) its keys in the builder, nowhere else.
--   private.gym_page_lang_complete  The ONE completeness rule: About of 100 characters or more after trim. The status function and the
--                                   snapshot builder both call it.
--   private.gym_page_snapshot()     Changed (owner decision 2026-11-08): `about_xx` and `services_xx` are omitted for a language whose
--                                   About is incomplete. No key is added or removed from the key list; a value is left out. The gate is
--                                   untouched: it already needs one complete language.
--   register_page_media()           Changed (owner decision 2026-11-08): at most 30 uploads per gym per rolling 24 hours, all kinds, deleted
--                                   rows counted, raising `limit_reached`. Bounds the storage a gym can burn through the dashboard route.
--
-- Design choices worth knowing before editing this file:
--
--  * The state is derived, never stored. Order: taken_down, then live (published or offline_suspended), then an unpublished page whose
--    recorded reason still holds (offline_gate while one of its gate codes is still missing; offline_name_released while the gym has no
--    active name), then not_started / in_progress / ready from the gate. A reason that no longer holds falls through: the Owner fixed it,
--    the page is simply ready or in progress again (the notice and e-mail already told them).
--  * "Taken down" is the page row's taken_down_at or any of the gym's page names being taken down. 24.11 owns the writer and may add a
--    reason; this function reports the state only.
--  * Nothing here names a gym id, plan id, uploader, token or login phone in its output. supabase/tests/gym_page_status.test.sql walks
--    every key path of the answer against a pinned list.
-- ============================================================================

set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- The language list and the completeness rule. One definition each.
-- ----------------------------------------------------------------------------
create function private.gym_page_languages()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['en', 'fr']::text[];
$$;

create function private.gym_page_lang_complete(p_about text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select private.gym_page_trimmed_length(p_about) >= 100;
$$;

revoke execute on function private.gym_page_languages() from public, anon, authenticated, service_role;
revoke execute on function private.gym_page_lang_complete(text) from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- The snapshot builder: 0164's, with About and Services left out for a language whose About is incomplete.
-- The key list is unchanged (jsonb_strip_nulls drops the omitted values, as it drops any null).
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

-- ----------------------------------------------------------------------------
-- Which text fields would make the gate answer `bad_text`: the same character class as the gate, one entry per field.
-- {field: gym_name | about | services | address | city | plan_name, lang?, plan_name?}. The plan is named by the text the Owner entered,
-- never by its id. Output only; private.
-- ----------------------------------------------------------------------------
create function private.gym_page_bad_text_fields(p_gym_id uuid)
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

-- ----------------------------------------------------------------------------
-- get_gym_page_status(): see the header. Read-only: no row is written, no audit row.
-- ----------------------------------------------------------------------------
create function public.get_gym_page_status(p_gym_id uuid)
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
             or exists (select 1 from page_names pn where pn.gym_id = p_gym_id and pn.taken_down_at is not null and pn.state <> 'released');
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
    'snapshot', private.gym_page_snapshot(p_gym_id)
  );
end;
$$;

revoke execute on function public.get_gym_page_status(uuid) from public, anon;
grant execute on function public.get_gym_page_status(uuid) to authenticated;

insert into private.support_capabilities (capability, kind, object_name) values
  ('gym_page', 'rpc', 'get_gym_page_status');

-- ----------------------------------------------------------------------------
-- register_page_media(): 0162's, plus the upload cap (30 per gym per rolling 24 hours, every kind, deleted rows counted).
-- The count runs under the gym row lock the function already holds, so two concurrent uploads cannot both take the 30th slot.
-- A dry run counts too, so the dashboard learns of the cap before it writes a storage object.
-- ----------------------------------------------------------------------------
create or replace function public.register_page_media(
  p_gym_id uuid,
  p_kind text,
  p_original_key text,
  p_derivative_key text,
  p_attested boolean,
  p_attestation_version text,
  p_dry_run boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_super_admin boolean;
  v_id uuid;
  v_replaced uuid[];
  v_live integer;
begin
  v_is_super_admin := coalesce(private.is_super_admin_live(), false);

  if not v_is_super_admin then
    if p_gym_id is null
       or p_gym_id is distinct from private.support_rpc_gym_id('register_page_media')
       or not coalesce(private.support_rpc_role('register_page_media') in ('owner', 'supervisor'), false) then
      raise exception 'permission denied';
    end if;
  end if;

  if p_gym_id is null then
    raise exception 'register_page_media: gym not found';
  end if;

  perform 1 from gyms g where g.id = p_gym_id for update;
  if not found then
    raise exception 'register_page_media: gym not found';
  end if;

  if not v_is_super_admin and private.current_gym_status() is distinct from 'active' then
    raise exception 'register_page_media: gym % is not active', p_gym_id;
  end if;

  if p_attested is distinct from true then
    raise exception 'register_page_media: attestation_required';
  end if;
  if p_attestation_version is null or length(p_attestation_version) not between 1 and 40 then
    raise exception 'register_page_media: attestation_required';
  end if;
  if p_kind is null or p_kind not in ('logo', 'banner', 'gallery') then
    raise exception 'register_page_media: invalid_kind';
  end if;
  if p_derivative_key is null or p_derivative_key !~ '^[0-9a-f-]{36}\.webp$' or position(p_gym_id::text in p_derivative_key) > 0 then
    raise exception 'register_page_media: invalid_derivative_key';
  end if;
  if p_original_key is null or p_original_key !~ ('^' || p_gym_id::text || '/[0-9a-f-]{36}$') then
    raise exception 'register_page_media: invalid_original_key';
  end if;

  if p_kind = 'gallery' then
    select count(*) into v_live from gym_page_media where gym_id = p_gym_id and kind = 'gallery' and deleted_at is null;
    if v_live >= 12 then
      raise exception 'register_page_media: limit_reached';
    end if;
  end if;

  -- 24.9: the rolling upload cap. Deleted rows count (a delete does not give the slot back).
  select count(*) into v_live from gym_page_media where gym_id = p_gym_id and created_at > now() - interval '24 hours';
  if v_live >= 30 then
    raise exception 'register_page_media: limit_reached';
  end if;

  if p_dry_run then
    return null;
  end if;

  if p_kind in ('logo', 'banner') then
    select coalesce(array_agg(id), '{}') into v_replaced
      from gym_page_media where gym_id = p_gym_id and kind = p_kind and deleted_at is null;
    update gym_page_media set deleted_at = now() where id = any (v_replaced);
  else
    v_replaced := '{}';
  end if;

  insert into gym_page_media (gym_id, kind, original_key, derivative_key, sort_order, uploaded_by, attested_at, attestation_version)
  values (
    p_gym_id, p_kind, p_original_key, p_derivative_key,
    case when p_kind = 'gallery'
         then coalesce((select max(m.sort_order) from gym_page_media m where m.gym_id = p_gym_id and m.kind = 'gallery'), 0) + 1
         else 0 end,
    private.actor_id(), now(), p_attestation_version)
  returning id into v_id;

  -- uploaded_by holds the proxy actor for a live support caller. The real person is recorded by the audit_log identity trigger
  -- on the audit row below (target_entity_id = this media id).
  perform log_audit_event(
    p_action_type => 'gym_page_media_registered',
    p_gym_id => p_gym_id,
    p_target_entity_id => v_id::text,
    p_target_entity_type => 'gym_page_media',
    p_metadata => jsonb_build_object('kind', p_kind, 'attestation_version', p_attestation_version, 'replaced', to_jsonb(v_replaced))
  );

  return v_id;
end;
$$;

-- create or replace keeps the grants of 0162 and 0164; they are restated so this file stands on its own.
revoke execute on function private.gym_page_snapshot(uuid) from public, anon, authenticated, service_role;
revoke execute on function public.register_page_media(uuid, text, text, text, boolean, text, boolean) from public, anon;
grant execute on function public.register_page_media(uuid, text, text, text, boolean, text, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- The migration proves its own result.
-- ----------------------------------------------------------------------------
do $verify$
declare
  v_fn text;
begin
  if private.gym_page_languages() is distinct from array['en', 'fr']::text[] then
    raise exception '0165: the language list is not en, fr';
  end if;
  if private.gym_page_lang_complete(repeat('a', 99)) or not private.gym_page_lang_complete(repeat('a', 100))
     or private.gym_page_lang_complete(' ' || repeat('a', 99) || ' ') then
    raise exception '0165: the completeness rule is not "100 characters after trim"';
  end if;

  if has_function_privilege('anon', 'public.get_gym_page_status(uuid)', 'execute')
     or has_function_privilege('public', 'public.get_gym_page_status(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.get_gym_page_status(uuid)', 'execute') then
    raise exception '0165: get_gym_page_status has the wrong execute grants';
  end if;
  if has_function_privilege('anon', 'public.register_page_media(uuid,text,text,text,boolean,text,boolean)', 'execute')
     or has_function_privilege('public', 'public.register_page_media(uuid,text,text,text,boolean,text,boolean)', 'execute')
     or not has_function_privilege('authenticated', 'public.register_page_media(uuid,text,text,text,boolean,text,boolean)', 'execute') then
    raise exception '0165: register_page_media lost its execute grants';
  end if;
  for v_fn in
    select p.oid::regprocedure::text from pg_proc p
     where p.pronamespace = 'private'::regnamespace
       and p.proname in ('gym_page_languages', 'gym_page_lang_complete', 'gym_page_bad_text_fields', 'gym_page_snapshot')
  loop
    if has_function_privilege('anon', v_fn, 'execute') or has_function_privilege('public', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') or has_function_privilege('service_role', v_fn, 'execute') then
      raise exception '0165: % is callable by a client role', v_fn;
    end if;
  end loop;

  if (select count(*) from pg_proc where proname = 'get_gym_page_status' and pronamespace = 'public'::regnamespace
        and prosecdef and provolatile = 's' and proconfig = array['search_path=public']) <> 1 then
    raise exception '0165: get_gym_page_status is not a stable security definer function with a pinned search_path';
  end if;
  -- read-only: it names no writer of any table
  if exists (select 1 from pg_proc where proname = 'get_gym_page_status' and pronamespace = 'public'::regnamespace
               and (prosrc ~* '(insert\s+into|update\s+\w|delete\s+from|log_audit_event)')) then
    raise exception '0165: get_gym_page_status writes';
  end if;
  if (select count(*) from private.support_capabilities where capability = 'gym_page' and kind = 'rpc' and object_name = 'get_gym_page_status') <> 1 then
    raise exception '0165: the capability row is missing';
  end if;
  if (select prosrc from pg_proc where proname = 'register_page_media' and pronamespace = 'public'::regnamespace) !~ 'interval ''24 hours''' then
    raise exception '0165: register_page_media has no upload cap';
  end if;
  if (select prosrc from pg_proc where proname = 'gym_page_snapshot' and pronamespace = 'private'::regnamespace) !~ 'gym_page_lang_complete' then
    raise exception '0165: the snapshot builder does not use the completeness rule';
  end if;
end
$verify$;
