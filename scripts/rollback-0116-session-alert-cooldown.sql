-- Rollback for migration 0116 (session-required alert cooldown). Pure DDL, no data touched.
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0116-session-alert-cooldown.sql

-- Fail fast rather than queue every front_desk_alerts write behind a long transaction.
set local lock_timeout = '5s';

drop trigger if exists front_desk_alerts_hold_back_repeat_session_alert on public.front_desk_alerts;
drop function if exists private.hold_back_repeat_session_alert();

do $verify$
begin
  if exists (
    select 1 from pg_trigger
    where tgrelid = 'public.front_desk_alerts'::regclass
      and tgname = 'front_desk_alerts_hold_back_repeat_session_alert'
  ) then
    raise exception 'rollback-0116: trigger still present';
  end if;
end;
$verify$;
