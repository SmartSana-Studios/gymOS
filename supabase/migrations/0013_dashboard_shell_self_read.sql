-- Story 1.8: Gym Owner Login & Role-Filtered Dashboard Shell. `members` has
-- had RLS enabled with zero business policies since 0003_members_and_users.sql
-- -- Stories 1.5-1.7 only ever added Super-Admin-scoped policies. No policy
-- until now lets a regular gym-scoped session (owner/manager/receptionist/
-- coach) read even its own row, which the dashboard Sidebar's identity
-- display (user's own name + role) needs.
--
-- Scoped to exactly one row (user_id = auth.uid()) -- not a roster-browsing
-- policy. Reading *other* members is Epic 2's job (FR-019-023), not this
-- story's. Deliberately no gym_id check in the USING clause: the row already
-- belongs to the caller regardless of which gym it's scoped to (a user can
-- hold historical/other-gym membership rows per FR-001) -- callers that only
-- want the row for the currently-active gym filter by gym_id themselves
-- (services/session.ts does exactly this), the same way private.gym_id()'s
-- own callers narrow by gym_id at the query level, not inside the helper.
--
-- No policy needed on `gyms` -- "read own gym" (id = private.gym_id())
-- already exists from 0009_auth_hook_gym_claims.sql and covers the gym-name
-- display. No policy added on `users` -- see story Dev Notes ->
-- "users.display_name is dead data" for why this story deliberately does not
-- read from `users` at all.

create policy "self_read_own_membership" on members
  for select
  using (user_id = auth.uid());
