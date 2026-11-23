-- Rollback for migration 0188: the gym leaderboard and the Anonymous choice (Epic 30, Story 30.6).
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0188-gym-leaderboard.sql
--
-- Drops the four functions, restores the 0047 body of private.protect_self_managed_member_preferences_columns (three pins, no leaderboard
-- refusal) and drops the two member_preferences columns. DESTRUCTIVE for the columns: every member's hide choice and every "notice seen"
-- stamp is lost, and after a re-apply every member is Anonymous again until they choose again (never the other way round: nobody is named by
-- a rollback). Run it only after the mobile leaderboard (apps/mobile services/leaderboard.ts, the /leaderboard route, the Profile row and
-- the Home card) is rolled back or the app tolerates the four calls failing.
set local lock_timeout = '5s';

drop function public.gym_leaderboard(date);
drop function public.my_leaderboard_settings();
drop function public.mark_leaderboard_notice_seen();
drop function public.set_leaderboard_visibility(boolean);

create or replace function private.protect_self_managed_member_preferences_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (select 1 from members where id = old.member_id and user_id = auth.uid()) then
    new.member_id := old.member_id;
    new.gym_id := old.gym_id;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

alter table public.member_preferences
  drop column leaderboard_notice_seen_at,
  drop column leaderboard_hidden;
