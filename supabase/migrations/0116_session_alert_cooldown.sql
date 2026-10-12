-- Post-V1.6 fix (migration 0116): a member who keeps scanning without a paid session must not
-- re-trigger the front-desk "session required" alert.
--
-- 0111 already keeps ONE active session_required alert per member (the one-active index plus
-- ON CONFLICT DO NOTHING), so repeated scans never stack. The gap is after the alert is dismissed
-- (by hand, or by the panel's auto-dismiss): the very next refused scan raised a brand-new alert,
-- so a guest who tried the door three times produced three alerts for a desk that had already
-- seen them. Blocked attempts are still recorded for every scan (they feed the Guest sessions
-- figures); only the NEW alert row is held back.
--
-- Rule (BEFORE INSERT, session_required only): skip the insert when this member's previous
-- session_required alert was dismissed within the last 15 minutes AND no session has been bought
-- since that alert was raised. A purchase (or a refund-then-rescan) always re-arms the alert.
-- Subscription-status alerts are not touched.
--
-- Rollback: scripts/rollback-0116-session-alert-cooldown.sql.

create function private.hold_back_repeat_session_alert()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  c_cooldown constant interval := interval '15 minutes';
begin
  if new.kind is distinct from 'session_required' then
    return new;
  end if;

  if exists (
    select 1
    from front_desk_alerts f
    where f.member_id = new.member_id
      and f.gym_id = new.gym_id
      and f.kind = 'session_required'
      and f.dismissed_at is not null
      and f.dismissed_at > now() - c_cooldown
      and not exists (
        select 1
        from guest_sessions g
        where g.member_id = new.member_id
          and g.gym_id = new.gym_id
          and g.created_at > f.created_at
      )
  ) then
    return null; -- skipped: the desk already handled this member a moment ago
  end if;

  return new;
end;
$$;

revoke execute on function private.hold_back_repeat_session_alert() from public, anon;

-- CREATE TRIGGER takes a SHARE ROW EXCLUSIVE lock on front_desk_alerts: fail fast rather than
-- queue every alert write behind it. In a DO block so the SET LOCAL holds under autocommit too.
do $apply$
begin
  set local lock_timeout = '5s';
  create trigger front_desk_alerts_hold_back_repeat_session_alert
    before insert on front_desk_alerts
    for each row
    execute function private.hold_back_repeat_session_alert();
end;
$apply$;

do $verify$
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.front_desk_alerts'::regclass
      and tgname = 'front_desk_alerts_hold_back_repeat_session_alert'
      and not tgisinternal
  ) then
    raise exception '0116: trigger missing';
  end if;
end;
$verify$;
