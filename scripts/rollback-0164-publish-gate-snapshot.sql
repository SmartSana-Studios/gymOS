-- Rollback for migration 0164 (publish gate, snapshot and unpublish, Story 24.8).
-- DESTRUCTIVE: deletes every row of gym_pages, so every snapshot is dropped and every published page goes offline (there is no other
-- copy of a snapshot; an Owner must publish again after the migration is re-applied). The page names, media, plans and content fields
-- are untouched. Restores the 0160 and 0162 public_site views (which read gym_pages directly) and the 0163 sweep. Audit rows of type
-- gym_page_published / gym_page_unpublished, staff_notices of type page_unpublished and their queued e-mails stay.
-- Roll back 24.9 / 24.10 / 24.11 app code that calls publish_gym_page, reads public_site.pages.name or page_media.page_name_id first.
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0164-publish-gate-snapshot.sql

-- Fail fast rather than queue gyms, plans and gym_pages writes behind a long transaction.
set local lock_timeout = '5s';

-- Pending deferred triggers on the tables altered below would block ALTER TABLE; there are none in a fresh session.
drop trigger if exists gym_page_refresh on public.gyms;
drop trigger if exists gym_page_refresh_update on public.plans;
drop trigger if exists gym_page_refresh_delete on public.plans;
drop trigger if exists gym_page_refresh_insert on public.gym_page_media;
drop trigger if exists gym_page_refresh_update on public.gym_page_media;
drop trigger if exists gym_page_refresh_delete on public.gym_page_media;
drop trigger if exists gym_page_refresh_insert on public.page_names;
drop trigger if exists gym_page_refresh_update on public.page_names;

delete from private.support_capabilities where kind = 'rpc' and object_name in ('publish_gym_page', 'unpublish_gym_page');
delete from private.support_audit_actions where action_type in ('gym_page_published', 'gym_page_unpublished');

drop function if exists public.publish_gym_page(uuid, text);
drop function if exists public.unpublish_gym_page(uuid);

-- The 0160 and 0162 views, as they were (create or replace cannot drop the columns 0164 appended, so drop and recreate).
drop view if exists public_site.pages;
drop view if exists public_site.page_media;
drop view if exists private.gym_page_visible;

-- Snapshots do not survive the old content CHECK (it has no `name` key and none of the type limits).
delete from public.gym_pages;

alter table public.gym_pages drop constraint if exists gym_pages_gym_page_name_fkey;
alter table public.gym_pages drop constraint if exists gym_pages_unpublished_reason_shape;
alter table public.gym_pages drop constraint if exists gym_pages_content_keys;
alter table public.gym_pages drop column if exists unpublished_reason;
drop index if exists public.page_names_gym_id_id_key;

alter table public.gym_pages
  add constraint gym_pages_content_keys check (
    jsonb_typeof(content) = 'object'
    and (content - array[
      'about_en', 'about_fr', 'services_en', 'services_fr', 'plans', 'address', 'map', 'hours',
      'contact', 'gallery', 'banner', 'logo', 'color', 'category', 'city', 'country'
    ]) = '{}'::jsonb
  );
alter table public.gym_pages
  add constraint gym_pages_page_name_id_fkey foreign key (page_name_id) references public.page_names(id);

create view public_site.pages with (security_barrier = true) as
select
  gp.page_name_id,
  gp.template,
  gp.schema_version,
  gp.content,
  gp.published_at,
  gp.updated_at
from public.gym_pages gp
join public.gyms g on g.id = gp.gym_id
where gp.published_at is not null
  and gp.unpublished_at is null
  and gp.taken_down_at is null
  and g.status = 'active';

revoke all on public_site.pages from public, anon, authenticated, service_role;
grant select on public_site.pages to public_site_reader;

create view public_site.page_media with (security_barrier = true) as
select
  m.derivative_key,
  m.kind,
  m.sort_order
from public.gym_page_media m
join public.gym_pages gp on gp.gym_id = m.gym_id
join public.gyms g on g.id = m.gym_id
where m.deleted_at is null
  and gp.published_at is not null
  and gp.unpublished_at is null
  and gp.taken_down_at is null
  and g.status = 'active';

revoke all on public_site.page_media from public, anon, authenticated, service_role;
grant select on public_site.page_media to public_site_reader;

drop function if exists private.refresh_gym_page(uuid);
drop function if exists private.gym_page_refresh_from_gym();
drop function if exists private.gym_page_refresh_from_plan();
drop function if exists private.gym_page_refresh_from_media();
drop function if exists private.gym_page_refresh_from_name();
drop function if exists private.notify_page_unpublished(uuid, text);
drop function if exists private.gym_page_gate_missing(uuid);
drop function if exists private.gym_page_snapshot(uuid);
drop function if exists private.gym_page_gate_phrase(text, text);
drop function if exists private.gym_page_trimmed_length(text);

-- The 0163 sweep, as it was (a suspended gym with a published page keeps its name).
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
  v_error text;
begin
  for r in
    select pn.id, pn.gym_id, pn.name
      from page_names pn
     where pn.state = 'active' and pn.taken_down_at is null
       and pn.reserved_until is not null and pn.reserved_until < now()
       and not private.page_name_has_published_page(pn.gym_id)
     order by pn.reserved_until, pn.id
  loop
    begin
      perform 1 from gyms g where g.id = r.gym_id for update;
      update page_names set state = 'released'
       where id = r.id and state = 'active' and taken_down_at is null
         and reserved_until is not null and reserved_until < now()
         and not private.page_name_has_published_page(r.gym_id);
      get diagnostics v_rows = row_count;
      if v_rows > 0 then
        update page_names set state = 'released', reserved_until = coalesce(reserved_until, now())
         where gym_id = r.gym_id and state = 'redirect' and taken_down_at is null;
        perform log_audit_event(
          p_action_type => 'page_name_released', p_gym_id => r.gym_id, p_target_entity_id => r.id::text,
          p_target_entity_type => 'page_name', p_system_actor_label => 'system:page_names_sweep',
          p_metadata => jsonb_build_object('name', r.name, 'from_state', 'active'));
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

do $verify$
begin
  if exists (select 1 from pg_proc where pronamespace in ('public'::regnamespace, 'private'::regnamespace)
              and proname in ('publish_gym_page', 'unpublish_gym_page', 'refresh_gym_page', 'gym_page_snapshot', 'gym_page_gate_missing', 'notify_page_unpublished')) then
    raise exception 'rollback-0164: functions still present';
  end if;
  if exists (select 1 from pg_trigger where tgname like 'gym\_page\_refresh%' and not tgisinternal) then
    raise exception 'rollback-0164: a refresh trigger is still present';
  end if;
  if to_regclass('private.gym_page_visible') is not null then
    raise exception 'rollback-0164: the visibility view is still present';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'gym_pages' and column_name = 'unpublished_reason') then
    raise exception 'rollback-0164: gym_pages.unpublished_reason is still present';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'gym_pages_page_name_id_fkey')
     or exists (select 1 from pg_constraint where conname = 'gym_pages_gym_page_name_fkey') then
    raise exception 'rollback-0164: the page name foreign key is not the 0163 one';
  end if;
  if (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'public_site' and table_name = 'pages')
       is distinct from array['page_name_id', 'template', 'schema_version', 'content', 'published_at', 'updated_at']
     or (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'public_site' and table_name = 'page_media')
       is distinct from array['derivative_key', 'kind', 'sort_order'] then
    raise exception 'rollback-0164: the public_site views are not the 0160 / 0162 ones';
  end if;
  if not has_table_privilege('public_site_reader', 'public_site.pages', 'select') or not has_table_privilege('public_site_reader', 'public_site.page_media', 'select') then
    raise exception 'rollback-0164: reader grants are missing';
  end if;
  if exists (select 1 from private.support_capabilities where object_name in ('publish_gym_page', 'unpublish_gym_page'))
     or exists (select 1 from private.support_audit_actions where action_type in ('gym_page_published', 'gym_page_unpublished')) then
    raise exception 'rollback-0164: capability or audit action rows remain';
  end if;
end;
$verify$;
