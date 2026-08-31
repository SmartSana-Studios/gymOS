-- Story 13.4: Plan Handoff on Coach Reassignment (FR-111, FR-055). Fourth
-- story in Epic 13.
--
-- Two of FR-111's three visibility guarantees already hold with zero code
-- changes here (confirmed by reading the shipped 0080 migration, not
-- assumed): coach_read_assigned_workout_plan[_exercises] (0080) already
-- gates on the *current* assignment via private.is_assigned_coach(), not
-- authorship, so a newly-assigned coach already reads a previous coach's
-- plan; and the reassigned-away coach automatically loses that same read
-- access the instant assign_coach() (0039) ends their assignment, since
-- is_assigned_coach() re-evaluates live on every query. The member's own
-- self_read_own_workout_plan* policies are member_id-scoped only, never
-- touch coach_id, so the member's own visibility is likewise already
-- unaffected. This migration closes the three genuinely missing pieces:
-- (1) a confirmed-absent Owner/Manager SELECT policy on all three
-- workout-plan tables, (2) take_ownership_of_workout_plan(), flipping
-- update_workout_plan()'s (0080) existing authoring-coach ownership check,
-- and (3) get_workout_plan_viewer_context(), an RLS-bootstrapping helper
-- resolving the previous coach's name for the handoff banner -- the same
-- problem class private.is_own_coach_id() (0041) already solved once for
-- session_notes.

-- ============================================================================
-- Owner/Manager read grants. Byte-for-byte the same role list and
-- private.current_member_role() shape as manager_or_owner_read_own_session_notes
-- (0041), deliberately not widened to Supervisor (no equivalent explicit
-- mockup signal exists here, unlike Story 12.3's Supervisor grant). All
-- three additive SELECT policies -- workout_plan_completions is included
-- even though AC #1's text only says "plan," since WorkoutPlanTabContent.tsx
-- already renders completion badges (Story 13.3) inline with the exercise
-- list on the same tab; leaving completions RLS-blocked for Owner/Manager
-- would ship a visibly half-working tab.
-- ============================================================================
create policy "manager_or_owner_read_own_workout_plan" on workout_plans
  for select
  using (
    gym_id = private.gym_id()
    and private.current_member_role() = any(array['owner'::member_role, 'manager'::member_role])
  );

create policy "manager_or_owner_read_own_workout_plan_exercises" on workout_plan_exercises
  for select
  using (
    gym_id = private.gym_id()
    and private.current_member_role() = any(array['owner'::member_role, 'manager'::member_role])
  );

create policy "manager_or_owner_read_own_workout_plan_completions" on workout_plan_completions
  for select
  using (
    gym_id = private.gym_id()
    and private.current_member_role() = any(array['owner'::member_role, 'manager'::member_role])
  );

-- ============================================================================
-- take_ownership_of_workout_plan(): flips update_workout_plan()'s (0080)
-- `v_existing_coach_id != v_coach_id` ownership check by reassigning
-- workout_plans.coach_id to the caller. The real gate is the
-- is_assigned_coach() check below -- it is what makes "take ownership"
-- impossible for a coach who isn't the member's *current* coach, not just a
-- formality. No audit log entry -- matches add_session_note()/
-- edit_session_note()'s (0041) own documented reasoning: FR-080's
-- action-type list does not include this action; assign_coach() already
-- logs coach_reassigned at the member-assignment level, the FR-080-covered
-- event.
-- ============================================================================
create function take_ownership_of_workout_plan(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
  v_coach_id uuid;
  v_member_id uuid;
begin
  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  select id into v_coach_id
  from members
  where user_id = auth.uid() and gym_id = v_gym_id and role = 'coach';

  if v_coach_id is null then
    raise exception 'take_ownership_of_workout_plan: caller is not a coach in this gym';
  end if;

  select member_id into v_member_id
  from workout_plans
  where id = p_plan_id and gym_id = v_gym_id
  for update;

  if not found then
    raise exception 'take_ownership_of_workout_plan: plan % not found', p_plan_id;
  end if;

  if not private.is_assigned_coach(v_member_id) then
    raise exception 'take_ownership_of_workout_plan: member is not currently assigned to caller';
  end if;

  update workout_plans set coach_id = v_coach_id where id = p_plan_id;
end;
$$;

revoke execute on function take_ownership_of_workout_plan(uuid) from public;
grant execute on function take_ownership_of_workout_plan(uuid) to authenticated;

-- ============================================================================
-- get_workout_plan_viewer_context(): a coach has no RLS path to read
-- another coach's members row (gym_staff_read_own_members excludes 'coach'
-- entirely, coach_read_assigned_members only covers role='member' --  0040).
-- A plain PostgREST embed on workout_plans' coach_id foreign key would
-- silently return null for exactly the case that matters (a reassigned
-- coach viewing the handoff banner) -- the same RLS-bootstrapping problem
-- private.is_own_coach_id() (0041) already fixed once for session_notes,
-- generalized here to also resolve the *other* coach's name.
--
-- Owner/Manager never call this function (Task 2's own short-circuit) --
-- the caller-is-not-a-coach / caller-is-not-currently-assigned branch below
-- is a defensive backstop, not a real caller path.
-- ============================================================================
create function get_workout_plan_viewer_context(p_plan_id uuid)
returns table(is_authoring_coach boolean, author_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
  v_member_id uuid;
  v_coach_id uuid;
  v_caller_coach_id uuid;
begin
  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  select member_id, coach_id into v_member_id, v_coach_id
  from workout_plans
  where id = p_plan_id and gym_id = v_gym_id;

  if not found then
    raise exception 'get_workout_plan_viewer_context: plan % not found', p_plan_id;
  end if;

  select id into v_caller_coach_id
  from members
  where user_id = auth.uid() and gym_id = v_gym_id and role = 'coach';

  if v_caller_coach_id is null or not private.is_assigned_coach(v_member_id) then
    raise exception 'permission denied';
  end if;

  return query
  select
    (v_caller_coach_id = v_coach_id),
    case when v_caller_coach_id = v_coach_id then null else (select name from members where id = v_coach_id) end;
end;
$$;

revoke execute on function get_workout_plan_viewer_context(uuid) from public;
grant execute on function get_workout_plan_viewer_context(uuid) to authenticated;
