-- Rollback for migration 0184: engagement configuration, week helpers and the weekly goal (Epic 30, Story 30.1).
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0184-engagement-config-weekly-goal.sql
--
-- Drops the two member RPCs, the goal history table (its rows are LOST: every member's chosen weekly goal), the history trigger function, the
-- two week helpers, the engagement config singleton (its values and release_week_start are LOST) and its audit trigger function. Nothing else
-- changed in 0184 (no existing table, function, policy or grant), so nothing else is restored. Audit entries already written for
-- platform_engagement_config_updated stay in audit_log. Run it only after the mobile release that calls set_weekly_goal / my_weekly_goal is
-- rolled back: the Profile "Training" row and the /goal sheet call them, and later Epic 30 stories read the config and the helpers.
set local lock_timeout = '5s';

drop function public.set_weekly_goal(smallint);
drop function public.my_weekly_goal();

drop table public.member_weekly_goals;
drop function private.member_weekly_goals_history_guard();

drop function private.gym_local_week_bounds(text, timestamptz);
drop function private.week_start_of(date);

drop table public.platform_engagement_config;
drop function private.audit_platform_engagement_config_update();

do $verify$
begin
  if to_regclass('public.member_weekly_goals') is not null or to_regclass('public.platform_engagement_config') is not null then
    raise exception '0184 rollback: a table still exists';
  end if;

  if to_regprocedure('public.set_weekly_goal(smallint)') is not null
     or to_regprocedure('public.my_weekly_goal()') is not null
     or to_regprocedure('private.gym_local_week_bounds(text, timestamptz)') is not null
     or to_regprocedure('private.week_start_of(date)') is not null
     or to_regprocedure('private.member_weekly_goals_history_guard()') is not null
     or to_regprocedure('private.audit_platform_engagement_config_update()') is not null then
    raise exception '0184 rollback: a function still exists';
  end if;
end;
$verify$;
