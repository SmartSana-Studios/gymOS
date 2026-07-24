-- Story 3.5: Check-Out -- Manual & Auto-Timeout. Adds the independent
-- check-in auto-timeout pg_cron job plus the two check-out RPCs
-- (member self-service and staff-driven). See the story file's Scope Notes
-- for full design rationale.

-- ============================================================================
-- run_check_in_auto_timeout_job(): closes any open attendance_events row
-- whose gym-configured checkin_timeout_hours has elapsed (AC #2/#3).
--
-- Deliberately its OWN pg_cron job, not folded into
-- run_subscription_lifecycle_job() (0021) -- architecture.md's Background
-- Jobs row is explicit: three independent pg_cron triggers, each in its own
-- function/transaction, each logging to job_runs, so a bug in one job can
-- never block or corrupt another. The story's own AC wording ("the same
-- pg_cron job") is stale/imprecise relative to that decision and is not
-- followed literally here (story Scope Note #1).
--
-- Runs every 15 minutes, not nightly like subscription lifecycle -- Story
-- 3.6's occupancy display needs a stale session to close reasonably
-- promptly, not sit "open" for up to 24 hours until a nightly job catches it.
--
-- Same shape as run_subscription_lifecycle_job(): no SECURITY DEFINER needed
-- (pg_cron invokes as postgres, already has full table access), inner
-- BEGIN...EXCEPTION savepoint so a failure still leaves a job_runs row and a
-- log_audit_event call instead of rolling back the failure record too.
--
-- No per-session audit_log row for each auto-closed session -- unlike
-- check_in()'s own stale-close path (driven by 3.4's own AC wording), this
-- story's AC #2/#3 say nothing about audit logging, and FR-080's canonical
-- audit-trigger list excludes attendance auto-close entirely. Only the
-- job's own failure path calls log_audit_event, matching
-- run_subscription_lifecycle_job()'s precedent of never audit-logging every
-- individual transition.
-- ============================================================================
create function run_check_in_auto_timeout_job()
returns void
language plpgsql
set search_path = public
as $$
declare
  v_started_at timestamptz := now();
begin
  begin
    update attendance_events a
    set checked_out_at = a.checked_in_at + make_interval(hours => g.checkin_timeout_hours),
        checkout_type = 'auto'
    from gyms g
    where a.gym_id = g.id
      and a.checked_out_at is null
      and a.checked_in_at + make_interval(hours => g.checkin_timeout_hours) <= now();

    insert into job_runs (job_name, started_at, finished_at, status)
    values ('check_in_auto_timeout', v_started_at, now(), 'success');
  exception when others then
    insert into job_runs (job_name, started_at, finished_at, status, error)
    values ('check_in_auto_timeout', v_started_at, now(), 'failure', sqlerrm);

    perform log_audit_event(
      p_action_type => 'check_in_auto_timeout_job_failure',
      p_system_actor_label => 'system:check_in_auto_timeout_job',
      p_metadata => jsonb_build_object('error', sqlerrm)
    );
  end;
end;
$$;

-- cron/direct-postgres only, matching run_subscription_lifecycle_job()'s
-- grant discipline -- never called from application code.
revoke execute on function run_check_in_auto_timeout_job() from public;

-- cron.schedule() upserts by job name -- safe to re-run across
-- `supabase db reset`s, matching 0021's own comment.
select cron.schedule(
  'check_in_auto_timeout',
  '*/15 * * * *',
  $$ select run_check_in_auto_timeout_job(); $$
);

-- ============================================================================
-- check_out(): member self-service check-out (AC #1, member path). Mirrors
-- check_in()'s exact shape (0023) -- no parameter, member/gym derived from
-- the caller's own session, closes the caller's own open session. Unused by
-- any client code in this story (no member-facing check-out UI exists
-- anywhere in the UX design) -- exists so AC #1's "member... triggers
-- check-out" is a real, testable backend capability, matching 3.1/3.2's
-- "ship the RPC + service function, defer the UI" precedent.
-- ============================================================================
create function check_out()
returns attendance_events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
  v_member_id uuid;
  v_deactivated_at timestamptz;
  v_row attendance_events;
begin
  if not ((auth.jwt() ->> 'app_role') = 'member') then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  select id, deactivated_at into v_member_id, v_deactivated_at
  from members
  where user_id = auth.uid() and gym_id = v_gym_id
  order by deactivated_at nulls first
  limit 1;

  if v_member_id is null then
    raise exception 'check_out: no member record found for the caller';
  end if;

  -- Defense in depth, mirroring check_in()'s identical guard (0023): this
  -- function is reachable by any holder of a valid session token, not just
  -- through the app's own navigation gate.
  if v_deactivated_at is not null then
    raise exception 'check_out: member is deactivated';
  end if;

  update attendance_events
  set checked_out_at = now(), checkout_type = 'manual'
  where member_id = v_member_id and checked_out_at is null
  returning * into v_row;

  if v_row is null then
    raise exception 'check_out: member % has no open check-in', v_member_id;
  end if;

  return v_row;
end;
$$;

revoke execute on function check_out from public;
grant execute on function check_out to authenticated;

-- ============================================================================
-- check_out_member(p_member_id uuid): staff-driven check-out for the
-- dashboard's future "Check Out" button (AD-11, Story 3.6). Mirrors
-- renew_subscription()'s exact shape (0022): SECURITY DEFINER, self-checked
-- role array, gym-scoped lookup folded into the query (uniform not-found for
-- cross-tenant/nonexistent). Role array is ['owner', 'manager',
-- 'receptionist'] -- the same three roles renew_subscription() grants,
-- matching the Attendance page's Receptionist/Manager/Owner (not Coach)
-- visibility.
-- ============================================================================
create function check_out_member(p_member_id uuid)
returns attendance_events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_gym_id uuid;
  v_member_gym_id uuid;
  v_row attendance_events;
begin
  if not ((auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'receptionist'])) then
    raise exception 'permission denied';
  end if;

  v_caller_gym_id := private.gym_id();
  if v_caller_gym_id is null then
    raise exception 'permission denied';
  end if;

  select gym_id into v_member_gym_id
  from members where id = p_member_id and gym_id = v_caller_gym_id;

  if v_member_gym_id is null then
    raise exception 'check_out_member: member % not found', p_member_id;
  end if;

  update attendance_events
  set checked_out_at = now(), checkout_type = 'manual'
  where member_id = p_member_id and gym_id = v_member_gym_id and checked_out_at is null
  returning * into v_row;

  if v_row is null then
    raise exception 'check_out_member: member % has no open check-in', p_member_id;
  end if;

  perform log_audit_event(
    p_action_type => 'attendance_manual_checkout',
    p_gym_id => v_member_gym_id,
    p_target_entity_id => p_member_id::text,
    p_target_entity_type => 'member',
    p_metadata => jsonb_build_object(
      'attendance_event_id', v_row.id,
      'checked_out_at', v_row.checked_out_at
    )
  );

  return v_row;
end;
$$;

revoke execute on function check_out_member from public;
grant execute on function check_out_member to authenticated;

-- No new RLS policy on attendance_events -- both functions are SECURITY
-- DEFINER, same reasoning as check_in()/renew_subscription(). Deny-all RLS
-- with zero policies (0006) stays untouched.
