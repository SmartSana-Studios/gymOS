-- Story 3.7: Member App -- Home Screen & Status Display. Adds the first
-- member-facing read RLS policy on attendance_events -- every access to this
-- table by a member session so far has gone through a SECURITY DEFINER
-- function (check_in()/check_out()), and 0025 only added a staff-only SELECT
-- policy. Home's "recent check-ins" feed (AC #3) needs a plain member-scoped
-- SELECT. See the story file's Scope Note #1 for full design rationale.

-- ============================================================================
-- member_read_own_attendance_events: member read RLS policy (AC #3).
-- Mirrors gym_staff_read_own_subscriptions' self-access shape exactly
-- (0018_member_management.sql, lines 227-238) -- proves row ownership via
-- `members.user_id = auth.uid()`, not a raw `member_id = auth.uid()`
-- comparison, since attendance_events.member_id references members.id, a
-- different UUID from the auth user id.
--
-- Coexists with 0025's gym_staff_read_own_attendance_events policy --
-- same-table SELECT policies are OR'd together, same shape as gyms' two
-- SELECT policies.
-- ============================================================================
create policy "member_read_own_attendance_events" on attendance_events
  for select
  using (
    gym_id = private.gym_id()
    and (auth.jwt() ->> 'app_role') = 'member'
    and exists (
      select 1 from members m
      where m.id = attendance_events.member_id and m.user_id = auth.uid()
    )
  );
