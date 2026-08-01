-- Story 4.9: Member App -- Payment History & Receipt Detail. Closes two
-- member-self-read RLS gaps needed by the Payments tab (AC #1) and the MA-14
-- receipt screen (AC #2): `payments` never got a member-self-access policy
-- (unlike subscriptions/plans/attendance_events, all closed ahead of time by
-- 0018/0017/0026 respectively -- payments was never given one because no
-- prior story needed it), and a member session cannot read any other
-- `members` row at all, which blocks resolving a receipt's "Recorded by"
-- staff name (`payments.actor_id` is a `users.id`, not FK-joinable to
-- `members`, same non-embeddable shape `listPendingPayments()` in
-- apps/dashboard/services/payments.ts already works around).

-- ============================================================================
-- member_read_own_payments: mirrors member_read_own_attendance_events's
-- exact shape (0026_member_app_home_screen_status_display.sql), proving row
-- ownership via `members.user_id = auth.uid()` (not a raw `member_id =
-- auth.uid()` comparison, since payments.member_id references members.id, a
-- different UUID from the auth user id). Coexists with
-- gym_staff_read_own_payments (0030) -- same-table SELECT policies are OR'd
-- together.
-- ============================================================================
create policy "member_read_own_payments" on payments
  for select
  using (
    gym_id = private.gym_id()
    and (auth.jwt() ->> 'app_role') = 'member'
    and exists (
      select 1 from members m
      where m.id = payments.member_id and m.user_id = auth.uid()
    )
  );

-- ============================================================================
-- member_read_gym_staff_members: new, narrow policy on `members` -- grants a
-- member-role session read access to `members` rows scoped to
-- role in ('owner','manager','receptionist') only. That role list matches
-- gym_staff_insert_own_payments's (0030) `with check` exactly -- those are
-- the only 3 roles payments.actor_id can ever resolve to. A deliberate,
-- narrow broadening (a member can now see a staff name/phone/email/dob in
-- their own gym, not just their own) -- never another member's row, never a
-- coach's row. Coexists with self_read_own_membership (0013) and
-- gym_staff_read_own_members (0018) -- does not widen either.
-- ============================================================================
create policy "member_read_gym_staff_members" on members
  for select
  using (
    gym_id = private.gym_id()
    and (auth.jwt() ->> 'app_role') = 'member'
    and role = any(array['owner', 'manager', 'receptionist']::member_role[])
  );

-- No baseline table-level GRANT changes needed -- `authenticated` already has
-- `select` on both `payments` (0005) and `members` (0003).
