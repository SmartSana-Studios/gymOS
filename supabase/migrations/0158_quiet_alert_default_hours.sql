-- ============================================================================
-- 0158: The quiet-gym alert never goes out at night for a gym without opening hours.
--
-- run_quiet_gym_alert_job() treated a gym with no opening/closing time as unrestricted ("unconfigured = always
-- eligible", 0056 AC #5). At night nobody is checked in, occupancy is 0% (band 'low'), so every opted-in member got
-- "your gym is quiet" at midnight. Owners had no screen to set the hours either.
--
-- Now a missing opening time defaults to 06:00 and a missing closing time to 22:00, in the gym's own timezone. A gym
-- that sets its hours (Owner Settings, Attendance section) is judged on those, exactly as before, including overnight
-- windows. Nothing else changes: same occupancy band, opt-out, 2 per 24 hours and 3-hour gap.
-- Rollback: scripts/rollback-0158-quiet-alert-default-hours.sql
-- ============================================================================
set local lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.run_quiet_gym_alert_job()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_started_at timestamptz := now();
  v_gym record;
  v_band text;
  v_local_time time;
  v_open time;
  v_close time;
  v_member record;
  v_recent_count integer;
  v_last_sent_at timestamptz;
begin
  begin
    for v_gym in select id, timezone, opening_time, closing_time from gyms where status = 'active' loop
      v_band := private.gym_occupancy_band(v_gym.id);
      continue when v_band is distinct from 'low';

      -- AC #5: unconfigured (either or both null) = unrestricted, not
      -- "never eligible". Once both are set, evaluated in the gym's own
      -- local time via its timezone column. Handles overnight windows
      -- (opening_time > closing_time, e.g. 22:00-06:00) where a plain
      -- BETWEEN can never be satisfied -- inside-window there means
      -- local time >= opening OR local time <= closing.
      -- 0158: a gym that has not set its opening hours is no longer "always open". The alert is only sent between
      -- 06:00 and 22:00 gym-local time unless the gym configured its own hours (Owner Settings, Attendance).
      v_open := coalesce(v_gym.opening_time, time '06:00');
      v_close := coalesce(v_gym.closing_time, time '22:00');
      v_local_time := (now() at time zone v_gym.timezone)::time;
      continue when
        case
          when v_open <= v_close
            then v_local_time not between v_open and v_close
          else v_local_time < v_open and v_local_time > v_close
        end;

      for v_member in
        select m.id
        from members m
        join member_preferences mp on mp.member_id = m.id
        where m.gym_id = v_gym.id
          and m.role = 'member'
          and m.deactivated_at is null
          and mp.quiet_gym_alerts_opted_out = false
      loop
        select count(*), max(sent_at)
        into v_recent_count, v_last_sent_at
        from private.quiet_gym_alert_dispatches
        where member_id = v_member.id and sent_at > now() - interval '24 hours';

        continue when v_recent_count >= 2;
        continue when v_last_sent_at is not null and v_last_sent_at > now() - interval '3 hours';

        -- Implicit savepoint, matching every other dispatch call site in
        -- 0045/0046: one member's send failure must never abort the loop
        -- for the rest of the gym's members or later gyms.
        begin
          perform private.send_quiet_gym_alert(v_member.id, v_gym.id);
        exception when others then
          raise warning 'run_quiet_gym_alert_job: dispatch failed for member %: %', v_member.id, sqlerrm;
        end;
      end loop;
    end loop;

    insert into job_runs (job_name, started_at, finished_at, status)
    values ('quiet_gym_alert', v_started_at, now(), 'success');
  exception when others then
    insert into job_runs (job_name, started_at, finished_at, status, error)
    values ('quiet_gym_alert', v_started_at, now(), 'failure', sqlerrm);

    perform log_audit_event(
      p_action_type => 'quiet_gym_alert_job_failure',
      p_system_actor_label => 'system:quiet_gym_alert_job',
      p_metadata => jsonb_build_object('error', sqlerrm)
    );
  end;
end;
$function$;

revoke execute on function public.run_quiet_gym_alert_job() from public, anon, authenticated;
