-- Rollback for migration 0183: coach picker reads (Epic 29, Story 29.4).
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0183-coach-picker-reads.sql
--
-- Drops the seven picker functions and the two indexes 0183 added. Nothing else changed in 0183 (no table, no policy, no grant on an existing
-- object), so nothing else is restored. Run it only after the dashboard release that calls these functions is rolled back: the Coach Portal of
-- that release reads them for Owner, Supervisor and Manager. The Coach role's own portal does not use them.
set local lock_timeout = '5s';

drop function public.list_picker_coaches();
drop function public.list_coach_classes(uuid);
drop function public.list_coach_class_session_roster(uuid, uuid);
drop function public.list_coach_assigned_members(uuid);
drop function public.get_coach_assigned_member(uuid, uuid);
drop function public.list_coach_member_session_notes(uuid, uuid);
drop function public.get_coach_member_workout_plan(uuid, uuid);

drop index public.idx_classes_gym_coach;
drop index public.idx_coach_assignments_active_coach;

do $verify$
begin
  if exists (
    select 1 from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('list_picker_coaches', 'list_coach_classes', 'list_coach_class_session_roster', 'list_coach_assigned_members',
                        'get_coach_assigned_member', 'list_coach_member_session_notes', 'get_coach_member_workout_plan')
  ) then
    raise exception '0183 rollback: a picker function still exists';
  end if;

  if to_regclass('public.idx_classes_gym_coach') is not null or to_regclass('public.idx_coach_assignments_active_coach') is not null then
    raise exception '0183 rollback: an index still exists';
  end if;
end;
$verify$;
