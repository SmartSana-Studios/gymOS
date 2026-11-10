-- Rollback for migration 0163 (page names: claim, hold, rename, redirect, Story 24.7).
-- DESTRUCTIVE: drops every gym's page name (active, held, redirect, reserved, released rows) and the Super Admin word lists, so every
-- claimed name is lost and can be claimed by anyone again; a redirect stops redirecting. gym_pages.page_name_id is set to NULL (the
-- foreign key is dropped, and a dangling id would point at nothing). Audit rows of type page_name_* and page_name_word_*, the
-- staff_notices rows of type page_name_decision / page_name_overdue, queued e-mails and job_runs rows named page_names_sweep stay.
-- Before 24.8 no page is published, so rolling back now loses only what Owners and Super Admin claimed through claim_page_name().
-- Roll back any later 24.x migration and app code that reads page_names first (24.8 snapshot, 24.10 route, 24.11 takedown).
-- The gyms.status trigger is dropped here, so a suspended gym's name clock stops being kept.
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0163-page-names.sql

-- Fail fast rather than queue gyms and gym_pages writes behind a long transaction.
set local lock_timeout = '5s';

select cron.unschedule('page_names_sweep') where exists (select 1 from cron.job where jobname = 'page_names_sweep');

delete from private.support_capabilities where kind = 'rpc' and object_name = 'get_gym_page_name';

drop trigger if exists zz_page_names_gym_status on public.gyms;

drop index if exists public.gym_pages_page_name_id_key;
alter table public.gym_pages drop constraint if exists gym_pages_page_name_id_fkey;
update public.gym_pages set page_name_id = null where page_name_id is not null;

drop function if exists public.claim_page_name(uuid, text);
drop function if exists public.list_held_page_names();
drop function if exists public.decide_held_page_name(uuid, boolean, text);
drop function if exists public.get_gym_page_name(uuid);
drop function if exists public.add_page_name_word(text, text, boolean);
drop function if exists public.remove_page_name_word(text, text, boolean);
drop function if exists public.list_page_name_words();

drop table if exists public.page_names;
drop table if exists public.page_name_words;

drop function if exists private.page_names_sweep();
drop function if exists private.page_names_gym_status_changed();
drop function if exists private.page_names_refuse_reserved();
drop function if exists private.set_page_name_idle(uuid, boolean);
drop function if exists private.page_name_promote(uuid, text, text, uuid, boolean);
drop function if exists private.notify_page_name_decision(uuid, text, boolean, text);
drop function if exists private.notify_page_name_overdue(uuid, text);
drop function if exists private.page_name_hold_reason(text, uuid);
drop function if exists private.page_name_completed_renames(uuid);
drop function if exists private.page_name_gym_idle(uuid);
drop function if exists private.page_name_has_published_page(uuid);
drop function if exists private.page_name_has_brand_word(text);
drop function if exists private.page_name_is_reserved(text);
drop function if exists private.page_name_within_one_edit(text, text);
drop function if exists private.page_name_fold(text);
drop function if exists private.page_name_valid(text);

do $verify$
begin
  if to_regclass('public.page_names') is not null or to_regclass('public.page_name_words') is not null then
    raise exception 'rollback-0163: a page name table is still present';
  end if;
  if exists (
    select 1 from pg_proc
    where pronamespace in ('public'::regnamespace, 'private'::regnamespace)
      and (proname like 'page\_name%' or proname like 'notify\_page\_name%' or proname = 'set_page_name_idle'
           or proname in ('claim_page_name', 'list_held_page_names', 'decide_held_page_name', 'get_gym_page_name',
                          'add_page_name_word', 'remove_page_name_word', 'list_page_name_words'))
  ) then
    raise exception 'rollback-0163: functions still present';
  end if;
  if exists (select 1 from cron.job where jobname = 'page_names_sweep') then
    raise exception 'rollback-0163: the sweep is still scheduled';
  end if;
  if exists (select 1 from pg_trigger where tgname = 'zz_page_names_gym_status' and not tgisinternal) then
    raise exception 'rollback-0163: the gyms.status trigger is still present';
  end if;
end;
$verify$;
