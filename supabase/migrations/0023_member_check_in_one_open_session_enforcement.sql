-- Story 3.4: Member Check-In & One-Open-Session Enforcement. Turns Story
-- 3.3's deliberately-inert "valid scan" branch into real attendance
-- recording. See the story file's Scope Notes for full design rationale.

-- ============================================================================
-- The partial unique index enforcing "one open check-in per member"
-- (FR-044) -- 0006_attendance.sql's own comment anticipated this exact
-- migration ("Epic 3's concern once check-in flows actually exist -- not
-- added here"). This is the literal enforcement mechanism AC #2 names, and
-- also the concurrent-request backstop for check_in()'s own pre-check below
-- (two simultaneous check-ins for the same member racing past the pre-check
-- can only ever leave one row with checked_out_at is null committed).
-- ============================================================================
create unique index idx_attendance_events_one_open_per_member
  on attendance_events (member_id)
  where checked_out_at is null;

-- ============================================================================
-- gyms.checkin_timeout_hours: FR-045's "configurable per gym... default 8
-- hours" auto-timeout setting, needed for AC #3's stale-check-in math here
-- and reused as-is by Story 3.5's check-out cron. Not part of 0002's
-- original column set (unlike grace_period_days/capacity/
-- alert_auto_dismiss_minutes) -- added now since this is the first story
-- that needs the value. No Settings-page UI field for this column in this
-- story (Story 3.4 Scope Note #2) -- exposing it as editable is Story 3.5's
-- job, matching this story's own ACs never mentioning Settings.
-- ============================================================================
alter table gyms add column checkin_timeout_hours integer not null default 8
  check (checkin_timeout_hours > 0);

-- ============================================================================
-- check_in(): records a member's attendance event, enforcing "one open
-- check-in per member" and auto-closing a stale one first.
--
-- SECURITY DEFINER, not a raw RLS-gated INSERT: the three-step "check for
-- an open session -> auto-close if stale -> insert" sequence must be
-- atomic -- three separate Supabase calls from the client would leave a
-- race window between the check and the insert. Follows
-- renew_subscription()'s exact established shape (0022, Story 3.2 Scope
-- Note #5) for a multi-step invariant like this.
--
-- Unlike renew_subscription() (staff acting on another member, hence its
-- role-array self-check), check_in() is member self-service acting only on
-- the caller's own row -- no p_member_id parameter. The member and gym are
-- derived entirely from the caller's own session (auth.uid()/
-- private.gym_id()), matching 0019/0020's self-service member functions'
-- pattern of deriving identity from the session rather than trusting a
-- caller-supplied id. No scanned-token parameter either: validateGymToken()
-- (Story 3.3 Scope Note #3) already established that in V1 (one gym per
-- JWT, no multi-gym switcher) a matching token can only ever mean "this
-- member's own gym" -- so once the mobile screen has a match, the gym for
-- the check-in is unambiguously private.gym_id().
--
-- No new RLS policy on attendance_events or gyms: the function is SECURITY
-- DEFINER (runs with the migration-owner's privileges, bypassing RLS,
-- exactly like renew_subscription()/log_audit_event() already do) --
-- authenticated only needs EXECUTE on the function itself. attendance_events
-- keeps its Story-1.3 deny-all RLS with zero policies (0006) -- direct
-- client SELECT/INSERT on the table stays blocked; all access goes through
-- this function.
-- ============================================================================
create function check_in()
returns attendance_events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
  v_member_id uuid;
  v_deactivated_at timestamptz;
  v_timeout_hours integer;
  v_open_id uuid;
  v_open_checked_in_at timestamptz;
  v_row attendance_events;
begin
  if not ((auth.jwt() ->> 'app_role') = 'member') then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  -- order by deactivated_at nulls first: idx_members_active_gym_user (0003)
  -- only guarantees uniqueness among *active* rows, so if a deactivated
  -- historical row for this user/gym ever coexists with an active one,
  -- prefer the active row rather than letting an arbitrary pick reject a
  -- legitimately active member below.
  select id, deactivated_at into v_member_id, v_deactivated_at
  from members
  where user_id = auth.uid() and gym_id = v_gym_id
  order by deactivated_at nulls first
  limit 1;

  if v_member_id is null then
    raise exception 'check_in: no member record found for the caller';
  end if;

  -- Defense in depth, mirroring renew_subscription()'s deactivated_at guard
  -- (0022): the mobile root-layout session gate (use-session.ts) already
  -- excludes deactivated members from ever reaching this screen in the app
  -- UI, but this function is reachable by any holder of a valid session
  -- token, not just through the app's own navigation gate.
  if v_deactivated_at is not null then
    raise exception 'check_in: member is deactivated';
  end if;

  select checkin_timeout_hours into v_timeout_hours from gyms where id = v_gym_id;

  -- for update: without this lock, two concurrent check_in() calls hitting
  -- the stale branch below could both read the same open row before either
  -- writes it, each auto-closing it and each calling log_audit_event() --
  -- duplicate audit rows for one auto-close. Locking here makes the second
  -- transaction block until the first commits, then re-evaluate the where
  -- clause against the now-closed row, correctly falling through to the
  -- unique-index rejection instead of double-processing it.
  select id, checked_in_at into v_open_id, v_open_checked_in_at
  from attendance_events
  where member_id = v_member_id and checked_out_at is null
  order by checked_in_at desc
  limit 1
  for update;

  if v_open_id is not null then
    if v_open_checked_in_at + make_interval(hours => v_timeout_hours) <= now() then
      -- Stale: auto-close it (AC #3) before recording the new check-in.
      update attendance_events
      set checked_out_at = v_open_checked_in_at + make_interval(hours => v_timeout_hours),
          checkout_type = 'auto'
      where id = v_open_id;

      perform log_audit_event(
        p_action_type => 'attendance_stale_check_in_auto_closed',
        p_gym_id => v_gym_id,
        p_target_entity_id => v_open_id::text,
        p_target_entity_type => 'attendance_event',
        p_metadata => jsonb_build_object(
          'member_id', v_member_id,
          'original_checked_in_at', v_open_checked_in_at,
          'auto_closed_checked_out_at', v_open_checked_in_at + make_interval(hours => v_timeout_hours),
          'timeout_hours', v_timeout_hours
        )
      );
    else
      -- Not stale: AC #2's rejection. The partial unique index above is the
      -- concurrent-request backstop for this same outcome, not the primary
      -- path -- this pre-check is what makes the common case a clean,
      -- specific error message rather than a raw constraint-violation string.
      raise exception 'check_in: member % already has an open check-in', v_member_id;
    end if;
  end if;

  insert into attendance_events (gym_id, member_id)
  values (v_gym_id, v_member_id)
  returning * into v_row;

  return v_row;
end;
$$;

-- Self-service only: no service_role/anon grant, matching
-- renew_subscription()'s grant shape minus the staff angle.
revoke execute on function check_in from public;
grant execute on function check_in to authenticated;
