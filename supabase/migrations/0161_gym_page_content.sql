-- ============================================================================
-- 0161: Gym page content fields and public plans (Epic 24, Story 24.5).
--
-- Storage only. A gym gets somewhere to keep what its public page will say, and
-- a plan can be marked public (opt-in, FR-200). Nothing here publishes, snapshots
-- or reads these values: the publish gate and snapshot are 24.8, media is 24.6,
-- the page name is 24.7, the editor is 24.9.
--
--   gyms.page_about_en / page_about_fr         text, nullable, each optional (OQ-28)
--   gyms.page_services_en / page_services_fr   text, nullable
--   gyms.page_address                          text, nullable
--   gyms.page_lat / page_lng                   numeric(9,6), nullable
--   gyms.page_hours                            jsonb, nullable: keys mon..sun, each
--                                              null or {"open":"HH:MM","close":"HH:MM"}
--   gyms.page_contact_phone / _whatsapp        text, nullable, E.164
--   gyms.page_city                             text, nullable, free text until the
--                                              controlled city list (25.1)
--   plans.is_public                            boolean NOT NULL DEFAULT false
--   plans.public_label_en / public_label_fr    text, nullable, each optional
--
-- gyms.country (0105) is reused, not duplicated. The page contact phone is a
-- separate column from the Owner's login phone; nothing here reads or writes
-- members.phone or users.phone.
--
-- Existing gyms read an empty page (every new column null) and existing plans read
-- is_public = false, in the same ADD COLUMN statements. Nullable columns and a
-- constant default are metadata-only changes.
--
-- Design choices worth knowing before editing this file:
--
--  * Two pin triggers (own functions, AD-32), copied from 0123: one on the gyms
--    page columns, one on the plans columns. Owners and support hold whole-row
--    UPDATE on both tables today, so without the pins a bare UPDATE would write
--    them. The pins have no super-admin or service_role exemption: only the
--    transaction-local GUC set inside set_gym_page_content() opens them. The plans
--    pin also covers INSERT, forcing the private default, because an Owner may
--    insert plans and a "public from the first row" insert would skip the opt-in
--    this story exists to protect. (The gyms pin is UPDATE only, as in 0123.)
--
--  * set_gym_page_content(p_gym_id, p_content jsonb, p_plans jsonb) is the one write
--    path. p_content is a patch: only the keys present are changed, a JSON null
--    clears a field. Keys: about_en, about_fr, services_en, services_fr, address,
--    lat, lng, hours, contact_phone, contact_whatsapp, city. Any other key is
--    rejected. p_plans is null (no plan change) or an array of
--    {plan_id, is_public?, public_label_en?, public_label_fr?}, also a patch, each
--    plan_id belonging to p_gym_id and appearing once.
--
--  * Admission is set_gym_category()'s (0140 form): a super admin, or the Owner or
--    Supervisor of THAT gym, or a live-assigned support caller through
--    private.support_rpc_gym_id / support_rpc_role. Never the JWT app_role claim.
--    A non-super-admin is refused while the gym is not active (the fail-closed
--    `is distinct from` form, which suspension_rpc_coverage.test.sql also reads).
--
--  * Validation here and in the Zod schema (packages/types gymPageContentSchema):
--    text is trimmed and an empty string is stored as null; lengths are bounded;
--    '<' and '>' are rejected anywhere; phones match ^\+[1-9]\d{7,14}$; lat is in
--    -90..90 and lng in -180..180 (rounded to 6 places); hours is a closed shape.
--    Table CHECKs repeat the shape rules so no writer can store a bad value.
--
--  * Unchanged input returns without writing or logging. Otherwise exactly one
--    audit row ('gym_page_content_changed') holds the old and new values of the
--    fields that changed.
-- ============================================================================

set local lock_timeout = '5s';

alter table gyms
  add column page_about_en text,
  add column page_about_fr text,
  add column page_services_en text,
  add column page_services_fr text,
  add column page_address text,
  add column page_lat numeric(9, 6),
  add column page_lng numeric(9, 6),
  add column page_hours jsonb,
  add column page_contact_phone text,
  add column page_contact_whatsapp text,
  add column page_city text;

alter table gyms
  add constraint gyms_page_text_bounds check (
    (page_about_en is null or (char_length(page_about_en) between 1 and 2000 and page_about_en !~ '[<>]'))
    and (page_about_fr is null or (char_length(page_about_fr) between 1 and 2000 and page_about_fr !~ '[<>]'))
    and (page_services_en is null or (char_length(page_services_en) between 1 and 2000 and page_services_en !~ '[<>]'))
    and (page_services_fr is null or (char_length(page_services_fr) between 1 and 2000 and page_services_fr !~ '[<>]'))
    and (page_address is null or (char_length(page_address) between 1 and 300 and page_address !~ '[<>]'))
    and (page_city is null or (char_length(page_city) between 1 and 100 and page_city !~ '[<>]'))
  ),
  add constraint gyms_page_contact_e164 check (
    (page_contact_phone is null or page_contact_phone ~ '^\+[1-9]\d{7,14}$')
    and (page_contact_whatsapp is null or page_contact_whatsapp ~ '^\+[1-9]\d{7,14}$')
  ),
  add constraint gyms_page_position_range check (
    (page_lat is null or page_lat between -90 and 90)
    and (page_lng is null or page_lng between -180 and 180)
  ),
  add constraint gyms_page_hours_shape check (
    page_hours is null or (
      jsonb_typeof(page_hours) = 'object'
      and page_hours - array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] = '{}'::jsonb
    )
  );

alter table plans
  add column is_public boolean not null default false,
  add column public_label_en text,
  add column public_label_fr text;

alter table plans
  add constraint plans_public_label_bounds check (
    (public_label_en is null or (char_length(public_label_en) between 1 and 80 and public_label_en !~ '[<>]'))
    and (public_label_fr is null or (char_length(public_label_fr) between 1 and 80 and public_label_fr !~ '[<>]'))
  );

comment on column gyms.page_about_en is
  'Public page content (24.5). Written only by set_gym_page_content(). Nothing is public until 24.8 publishes a snapshot.';
comment on column gyms.page_hours is
  'Public page opening hours: keys mon..sun, each null or {"open":"HH:MM","close":"HH:MM"}. Distinct from gyms.opening_time/closing_time (quiet-gym alerts).';
comment on column gyms.page_contact_phone is
  'Public contact phone (E.164), distinct from the Owner''s login phone. The login phone is never copied here.';
comment on column plans.is_public is
  'Opt-in per plan (FR-200); private by default. Written only by set_gym_page_content().';

-- ----------------------------------------------------------------------------
-- Hours validator (a CHECK cannot loop over keys, so the setter calls this).
-- ----------------------------------------------------------------------------
create function private.gym_page_hours_valid(p_hours jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_key text;
  v_val jsonb;
begin
  if p_hours is null then
    return true;
  end if;
  if jsonb_typeof(p_hours) <> 'object' then
    return false;
  end if;
  for v_key, v_val in select * from jsonb_each(p_hours) loop
    if v_key not in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun') then
      return false;
    end if;
    if jsonb_typeof(v_val) = 'null' then
      continue;
    end if;
    if jsonb_typeof(v_val) <> 'object'
       or (select count(*) from jsonb_object_keys(v_val)) <> 2
       or not (v_val ? 'open' and v_val ? 'close')
       or jsonb_typeof(v_val -> 'open') <> 'string'
       or jsonb_typeof(v_val -> 'close') <> 'string'
       or (v_val ->> 'open') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or (v_val ->> 'close') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

revoke execute on function private.gym_page_hours_valid(jsonb) from public, anon;
-- Called by the gyms_page_hours_values CHECK, which runs as the writing role (the pin reverts the value, but the CHECK still evaluates).
grant execute on function private.gym_page_hours_valid(jsonb) to authenticated, service_role;

alter table gyms
  add constraint gyms_page_hours_values check (private.gym_page_hours_valid(page_hours));

-- ----------------------------------------------------------------------------
-- Pin triggers. SECURITY INVOKER on purpose; they fire for super admin and
-- service_role too. Only the GUC set inside set_gym_page_content() opens them.
-- ----------------------------------------------------------------------------
create function private.pin_gym_page_content()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('app.gym_page_content_bypass', true), 'false') <> 'true' then
    new.page_about_en := old.page_about_en;
    new.page_about_fr := old.page_about_fr;
    new.page_services_en := old.page_services_en;
    new.page_services_fr := old.page_services_fr;
    new.page_address := old.page_address;
    new.page_lat := old.page_lat;
    new.page_lng := old.page_lng;
    new.page_hours := old.page_hours;
    new.page_contact_phone := old.page_contact_phone;
    new.page_contact_whatsapp := old.page_contact_whatsapp;
    new.page_city := old.page_city;
  end if;
  return new;
end;
$$;

revoke execute on function private.pin_gym_page_content() from public, anon, authenticated;

create trigger pin_gym_page_content
  before update of page_about_en, page_about_fr, page_services_en, page_services_fr, page_address,
                   page_lat, page_lng, page_hours, page_contact_phone, page_contact_whatsapp, page_city
  on gyms
  for each row execute function private.pin_gym_page_content();

create function private.pin_plan_public()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('app.gym_page_content_bypass', true), 'false') <> 'true' then
    if tg_op = 'INSERT' then
      new.is_public := false;
      new.public_label_en := null;
      new.public_label_fr := null;
    else
      new.is_public := old.is_public;
      new.public_label_en := old.public_label_en;
      new.public_label_fr := old.public_label_fr;
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function private.pin_plan_public() from public, anon, authenticated;

create trigger pin_plan_public_update
  before update of is_public, public_label_en, public_label_fr on plans
  for each row execute function private.pin_plan_public();

create trigger pin_plan_public_insert
  before insert on plans
  for each row execute function private.pin_plan_public();

-- ----------------------------------------------------------------------------
-- Field readers: one place for the trim / empty-to-null / bounds / markup rules.
-- Raise 'set_gym_page_content: invalid_<field>'.
-- ----------------------------------------------------------------------------
create function private.gym_page_text(p_obj jsonb, p_key text, p_max int)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v text;
begin
  if jsonb_typeof(p_obj -> p_key) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_obj -> p_key) <> 'string' then
    raise exception 'set_gym_page_content: invalid_%', p_key;
  end if;
  v := regexp_replace(p_obj ->> p_key, '^\s+|\s+$', '', 'g');
  if v = '' then
    return null;
  end if;
  if char_length(v) > p_max or v ~ '[<>]' then
    raise exception 'set_gym_page_content: invalid_%', p_key;
  end if;
  return v;
end;
$$;

revoke execute on function private.gym_page_text(jsonb, text, int) from public, anon, authenticated;

create function private.gym_page_phone(p_obj jsonb, p_key text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v text;
begin
  if jsonb_typeof(p_obj -> p_key) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_obj -> p_key) <> 'string' then
    raise exception 'set_gym_page_content: invalid_%', p_key;
  end if;
  v := regexp_replace(p_obj ->> p_key, '^\s+|\s+$', '', 'g');
  if v = '' then
    return null;
  end if;
  if v !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'set_gym_page_content: invalid_%', p_key;
  end if;
  return v;
end;
$$;

revoke execute on function private.gym_page_phone(jsonb, text) from public, anon, authenticated;

create function private.gym_page_coord(p_obj jsonb, p_key text, p_limit numeric)
returns numeric
language plpgsql
immutable
set search_path = public
as $$
declare
  v numeric;
begin
  if jsonb_typeof(p_obj -> p_key) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_obj -> p_key) <> 'number' then
    raise exception 'set_gym_page_content: invalid_%', p_key;
  end if;
  v := round((p_obj ->> p_key)::numeric, 6);
  if v < -p_limit or v > p_limit then
    raise exception 'set_gym_page_content: invalid_%', p_key;
  end if;
  return v;
end;
$$;

revoke execute on function private.gym_page_coord(jsonb, text, numeric) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- set_gym_page_content(): the only write path for the page fields and plan flags.
-- ----------------------------------------------------------------------------
create function set_gym_page_content(p_gym_id uuid, p_content jsonb, p_plans jsonb default null)
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

insert into private.support_capabilities (capability, kind, object_name) values
  ('gym_page', 'rpc', 'set_gym_page_content');

-- A live support caller may write only the audit action types its allow-listed capabilities produce (23.10).
insert into private.support_audit_actions (action_type) values ('gym_page_content_changed') on conflict do nothing;
