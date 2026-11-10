-- Rollback for migration 0162 (gym page media, Story 24.6).
-- DESTRUCTIVE: drops every gym_page_media row (the record of which image belongs to which gym, and every attestation).
-- It does NOT remove the two Storage buckets or their objects: Storage forbids direct SQL deletes (storage.protect_delete).
-- Empty and delete the buckets gym-page-media-src and gym-page-media through the Storage API (or the dashboard) afterwards.
-- Audit rows of type gym_page_media_registered / gym_page_media_deleted stay. Roll back app code that calls the RPCs first.
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0162-gym-page-media.sql

set local lock_timeout = '5s';

drop view if exists public_site.page_media;

delete from private.support_capabilities where kind = 'rpc' and object_name in ('register_page_media', 'delete_page_media');
delete from private.support_audit_actions where action_type in ('gym_page_media_registered', 'gym_page_media_deleted');

drop function if exists public.register_page_media(uuid, text, text, text, boolean, text, boolean);
drop function if exists public.delete_page_media(uuid);

drop table if exists public.gym_page_media;

do $verify$
begin
  if to_regclass('public.gym_page_media') is not null or to_regclass('public_site.page_media') is not null then
    raise exception 'rollback-0162: media table or view still present';
  end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('register_page_media', 'delete_page_media')) then
    raise exception 'rollback-0162: functions still present';
  end if;
end;
$verify$;
