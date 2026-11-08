-- Rollback for migration 0161 (gym page content fields and public plans, Story 24.5).
-- DESTRUCTIVE: drops every gym's page content (about, services, address, position, hours, public contact, city)
-- and every plan's is_public flag and public labels. Plans become private again. Audit rows of type
-- gym_page_content_changed stay. Nothing reads these columns before 24.8, so rolling back before 24.8 loses only
-- what Owners typed through set_gym_page_content(). Roll back any later 24.x migration and app code that reads them first.
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0161-gym-page-content.sql

-- Fail fast rather than queue gyms and plans writes behind a long transaction.
set local lock_timeout = '5s';

delete from private.support_capabilities where kind = 'rpc' and object_name = 'set_gym_page_content';
delete from private.support_audit_actions where action_type = 'gym_page_content_changed';

drop function if exists public.set_gym_page_content(uuid, jsonb, jsonb);

drop trigger if exists pin_gym_page_content on public.gyms;
drop trigger if exists pin_plan_public_update on public.plans;
drop trigger if exists pin_plan_public_insert on public.plans;

alter table public.gyms
  drop constraint if exists gyms_page_text_bounds,
  drop constraint if exists gyms_page_contact_e164,
  drop constraint if exists gyms_page_position_range,
  drop constraint if exists gyms_page_hours_shape,
  drop constraint if exists gyms_page_hours_values,
  drop column if exists page_about_en,
  drop column if exists page_about_fr,
  drop column if exists page_services_en,
  drop column if exists page_services_fr,
  drop column if exists page_address,
  drop column if exists page_lat,
  drop column if exists page_lng,
  drop column if exists page_hours,
  drop column if exists page_contact_phone,
  drop column if exists page_contact_whatsapp,
  drop column if exists page_city;

alter table public.plans
  drop constraint if exists plans_public_label_bounds,
  drop column if exists is_public,
  drop column if exists public_label_en,
  drop column if exists public_label_fr;

drop function if exists private.pin_gym_page_content();
drop function if exists private.pin_plan_public();
drop function if exists private.gym_page_hours_valid(jsonb);
drop function if exists private.gym_page_text(jsonb, text, int);
drop function if exists private.gym_page_phone(jsonb, text);
drop function if exists private.gym_page_coord(jsonb, text, numeric);

do $verify$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and ((table_name = 'gyms' and column_name like 'page\_%') or (table_name = 'plans' and column_name in ('is_public', 'public_label_en', 'public_label_fr')))
  ) then
    raise exception 'rollback-0161: page columns still present';
  end if;
  if exists (
    select 1 from pg_proc
    where pronamespace in ('public'::regnamespace, 'private'::regnamespace)
      and proname in ('set_gym_page_content', 'pin_gym_page_content', 'pin_plan_public', 'gym_page_hours_valid', 'gym_page_text', 'gym_page_phone', 'gym_page_coord')
  ) then
    raise exception 'rollback-0161: functions still present';
  end if;
end;
$verify$;
