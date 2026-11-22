-- Rollback for migration 0185: engagement facts, the fold and settle (Epic 30, Story 30.2).
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0185-engagement-facts-fold-settle.sql
--
-- Drops the epoch guard trigger on platform_engagement_config and its function, the nine private functions, and the two tables (every
-- engagement fact and every settle watermark is LOST; they are recomputable from attendance with a new settle once the migration is
-- re-applied, except revisions and goals frozen at the time, which a recount would choose again from the goal history and the default).
-- Nothing else changed in 0185, so nothing else is restored. Run it only after anything that calls these functions is rolled back
-- (30.3 and later: the settle job, open_engagement, the check-in and void dirty marks, the engagement views).
set local lock_timeout = '5s';

drop trigger engagement_epoch_guard on public.platform_engagement_config;
drop function private.engagement_epoch_guard();

drop function private.rebuild_engagement(uuid, date);
drop function private.engagement_derived_state(uuid);
drop function private.settle_engagement(uuid, uuid, date);
drop function private.engagement_evaluate_weeks(uuid, uuid, date, date);
drop function private.engagement_fold(uuid);
drop function private.engagement_fold_weeks(jsonb);
drop function private.effective_engagement_facts(uuid);

drop table public.engagement_state;
drop table public.engagement_facts;
drop function private.engagement_facts_append_only_guard();

do $verify$
begin
  if to_regclass('public.engagement_facts') is not null or to_regclass('public.engagement_state') is not null then
    raise exception '0185 rollback: a table still exists';
  end if;

  if to_regprocedure('private.engagement_facts_append_only_guard()') is not null
     or to_regprocedure('private.engagement_epoch_guard()') is not null
     or to_regprocedure('private.effective_engagement_facts(uuid)') is not null
     or to_regprocedure('private.engagement_fold_weeks(jsonb)') is not null
     or to_regprocedure('private.engagement_fold(uuid)') is not null
     or to_regprocedure('private.engagement_evaluate_weeks(uuid, uuid, date, date)') is not null
     or to_regprocedure('private.settle_engagement(uuid, uuid, date)') is not null
     or to_regprocedure('private.engagement_derived_state(uuid)') is not null
     or to_regprocedure('private.rebuild_engagement(uuid, date)') is not null then
    raise exception '0185 rollback: a function still exists';
  end if;

  if exists (select 1 from pg_trigger where tgname = 'engagement_epoch_guard' and tgrelid = 'public.platform_engagement_config'::regclass) then
    raise exception '0185 rollback: the epoch guard trigger still exists';
  end if;
end;
$verify$;
