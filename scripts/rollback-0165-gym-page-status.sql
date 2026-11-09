-- Rollback for migration 0165 (landing-page status read, language completeness in the snapshot, upload cap, Story 24.9).
-- Restores 0164's snapshot builder (About and Services of an incomplete language are published again on the next refresh or publish; a page
-- that is live keeps the snapshot it has until then) and 0162's register_page_media (no 30-per-24-hours cap), and removes the status read.
-- Gym content, pages, names and media are untouched. Roll back the 24.9 dashboard code (it calls get_gym_page_status) first.
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0165-gym-page-status.sql

set local lock_timeout = '5s';

delete from private.support_capabilities where kind = 'rpc' and object_name = 'get_gym_page_status';

drop function if exists public.get_gym_page_status(uuid);
drop function if exists private.gym_page_bad_text_fields(uuid);

create or replace function private.gym_page_snapshot(p_gym_id uuid)
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

drop function if exists private.gym_page_lang_complete(text);
drop function if exists private.gym_page_languages();

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

do $verify$
begin
  if to_regprocedure('public.get_gym_page_status(uuid)') is not null or to_regprocedure('private.gym_page_languages()') is not null then
    raise exception 'rollback-0165: a 0165 function is still present';
  end if;
  if (select prosrc from pg_proc where proname = 'register_page_media' and pronamespace = 'public'::regnamespace) ~ 'interval ''24 hours''' then
    raise exception 'rollback-0165: register_page_media still has the upload cap';
  end if;
  if (select prosrc from pg_proc where proname = 'gym_page_snapshot' and pronamespace = 'private'::regnamespace) ~ 'gym_page_lang_complete' then
    raise exception 'rollback-0165: the snapshot builder still uses the completeness rule';
  end if;
end
$verify$;
