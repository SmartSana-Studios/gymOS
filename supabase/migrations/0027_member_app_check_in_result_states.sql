-- Story 3.8: Member App -- Check-In Result States. `check_in()`
-- (0023_member_check_in_one_open_session_enforcement.sql) has zero
-- awareness of subscription status today -- an expired member can check in
-- successfully. Per FR-031, expired (and no-subscription) members must be
-- rejected. See the story file's Scope Note #2 for full design rationale.

-- ============================================================================
-- check_in(): `create or replace`, redeclaring the full 0023 body (the
-- established precedent for amending a SECURITY DEFINER function -- e.g.
-- 0019's replacement of private.protect_self_managed_user_columns()) with
-- one addition: a subscription-status guard inserted right after the
-- existing deactivated_at check and before the "for update" open-session
-- lock -- reject early, before doing any locking work, for a member who's
-- going to be denied regardless.
--
-- Reuses the same "most recent subscription row for this member" query
-- (tabs)/index.tsx's Home screen already relies on -- there's no
-- "current subscription" flag in the schema, recency is the only signal.
-- A member with zero subscriptions rows at all (shouldn't happen in
-- practice -- onboarding's Plan Confirmation step always creates one, but
-- defensively reachable the same way the existing deactivated_at check is
-- defensive) is treated identically to expired: denied. expiring_soon and
-- grace_period are not denied -- only null/expired triggers this guard
-- (FR-031).
--
-- No audit_log write and no new table/column for a denied attempt: the
-- real-time front-desk alert (FR-049) is Epic 4's job (Story 4.6), which has
-- no design today for how a rejected check-in gets modeled for that future
-- consumer -- not this story's problem to scaffold speculatively.
-- ============================================================================
create or replace function check_in()
returns attendance_events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
  v_member_id uuid;
  v_deactivated_at timestamptz;
  v_status subscription_status;
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

  -- Story 3.8 AC #3 / FR-031: reject expired (and no-subscription) members
  -- before doing any locking work below.
  select status into v_status
  from subscriptions
  where member_id = v_member_id
  order by created_at desc
  limit 1;

  if v_status is null or v_status = 'expired' then
    raise exception 'check_in: member % subscription is expired', v_member_id;
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
