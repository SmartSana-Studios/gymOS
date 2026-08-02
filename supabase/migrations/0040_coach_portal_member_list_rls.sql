-- Story 5.2: Coach Portal -- Assigned Member List (FR-022, FR-053, FR-054).
--
-- Closes the "over-broadening... revisit when Epic 5 ships Coach logins" gap
-- 0018_member_management.sql's own comments on `gym_staff_read_own_members`/
-- `gym_staff_read_own_subscriptions` explicitly flagged and deferred to this
-- story: `coach` currently reads the entire gym roster through those two
-- policies, same as Receptionist. AC #3 requires a coach see only their
-- assigned members.
--
-- `private.is_assigned_coach()`: SECURITY DEFINER, unlike `private.gym_id()`/
-- `private.is_super_admin()` (0009/0010), which are plain STABLE because they
-- only read the JWT via `auth.jwt()`, never a table. This is the first
-- `private`-schema helper to read a table -- and it must bypass RLS while
-- doing so. A naive correlated subquery written directly inside the new
-- coach RLS policies below (without SECURITY DEFINER) would silently return
-- zero rows for every coach, always: `coach_assignments` has exactly one
-- SELECT policy (`manager_or_owner_read_own_coach_assignments`, 0039),
-- scoped to manager/owner only, so a coach session's own read of that table
-- (even nested inside another policy's USING clause) returns nothing
-- regardless of whether a real assignment exists -- the same class of
-- RLS-reads-blocking-its-own-RLS-helper bootstrapping problem
-- `custom_access_token_hook()` (0009) hit and fixed the same way (see that
-- migration's own comment on why it is SECURITY DEFINER). This is a
-- correctness bug, not a performance one: no error, no exception -- just a
-- wrong, always-empty result set. See docs/decisions.md for the full record.
--
-- Explicit revoke/grant (not just relying on `usage on schema private`,
-- 0009's lighter-touch precedent for `private.gym_id()`/
-- `private.is_super_admin()`): because this function is SECURITY DEFINER and
-- bypasses RLS internally, an accidental broader grant is a bigger blast
-- radius than a plain JWT-reading STABLE function -- same discipline
-- `assign_coach()` (0039) already applies for the same reason.
create function private.is_assigned_coach(p_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from coach_assignments ca
    join members coach_m on coach_m.id = ca.coach_id
    where ca.member_id = p_member_id
      and ca.ended_at is null
      and coach_m.user_id = auth.uid()
      and coach_m.gym_id = private.gym_id()
  );
$$;

revoke execute on function private.is_assigned_coach from public;
grant execute on function private.is_assigned_coach to authenticated;

-- Narrow the two existing broad staff policies in place -- only the USING
-- expression changes, so ALTER POLICY (not drop+recreate) is the correct
-- tool. Removes 'coach' from both role arrays; the two new additive
-- policies below give coach sessions their own, narrower access instead.
alter policy "gym_staff_read_own_members" on members
  using (
    gym_id = private.gym_id()
    and (auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'receptionist'])
  );

alter policy "gym_staff_read_own_subscriptions" on subscriptions
  using (
    gym_id = private.gym_id()
    and (
      (auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'receptionist'])
      or exists (
        select 1 from members m
        where m.id = subscriptions.member_id and m.user_id = auth.uid()
      )
    )
  );

-- Additive: same-table SELECT policies are OR'd (this codebase's own
-- established behavior -- see `gym_staff_read_own_members`'s own comment and
-- `gyms`' two SELECT policies, 0009/0010). A coach session's app_role never
-- satisfies the narrowed broad policy's role check above, so this is the
-- only policy that ever contributes rows for a coach caller.
create policy "coach_read_assigned_members" on members
  for select
  using (
    gym_id = private.gym_id()
    and (auth.jwt() ->> 'app_role') = 'coach'
    and private.is_assigned_coach(id)
  );

create policy "coach_read_assigned_subscriptions" on subscriptions
  for select
  using (
    gym_id = private.gym_id()
    and (auth.jwt() ->> 'app_role') = 'coach'
    and private.is_assigned_coach(member_id)
  );

-- Not touched by this migration: `coach_assignments`' own RLS (a coach still
-- has no direct SELECT access to that table -- `private.is_assigned_coach()`
-- reads it internally via SECURITY DEFINER, bypassing RLS by design, and no
-- AC in this story asks for a coach-facing assignment-history view), `plans`
-- RLS (already ungated-by-role, 0017), and payments-table RLS (0030
-- deliberately excludes 'coach' already, out of scope here).
