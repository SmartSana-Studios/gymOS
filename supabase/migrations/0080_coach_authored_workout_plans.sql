-- Story 13.2: Coach-Authored Workout Plans (FR-109, FR-110, FR-111 scaffolding,
-- FR-122). Second story in Epic 13 -- workout_plans/workout_plan_exercises
-- are wholly new, additive-only tables.
--
-- Unlike Story 13.1's exercise_library (plain RLS, single-row CRUD),
-- workout_plans + workout_plan_exercises are a one-parent-plus-ordered-
-- children structure requiring atomic writes and a caller-coach-resolution
-- step that RLS cannot itself perform (same class of RLS-bootstrapping
-- problem session_notes/coach_assignments (0040/0041) and classes (0057)
-- already solved). Writes go through two new SECURITY DEFINER RPCs,
-- create_workout_plan()/update_workout_plan(), mirroring those two
-- migrations' structural shape.

-- ============================================================================
-- workout_plans: one row per member (idx_workout_plans_member_unique below
-- is a real DB backstop for AC #3's "exactly one plan per member", not just
-- a UI convention). coach_id is the *authoring* coach -- required now, not
-- deferred to Story 13.4, because update_workout_plan()'s own edit-lock
-- check (below) needs it from day one.
-- ============================================================================
create table workout_plans (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references gyms(id),
  member_id uuid not null references members(id),
  coach_id uuid not null references members(id),
  name text not null,
  created_at timestamptz not null default now(),
  constraint workout_plans_name_not_blank check (char_length(btrim(name)) > 0),
  constraint workout_plans_name_len check (char_length(name) <= 100)
);

create unique index idx_workout_plans_member_unique on workout_plans(member_id);
create index idx_workout_plans_gym_id on workout_plans(gym_id);

-- ============================================================================
-- workout_plan_exercises: gym_id/member_id are denormalized from the parent
-- workout_plans row, not derived via join -- matches session_notes' own
-- denormalization of gym_id/member_id alongside coach_assignment_id (0041),
-- and keeps this table's RLS policies below simple, uniform USING clauses
-- instead of a `plan_id in (select ... from workout_plans)` subquery.
-- ============================================================================
create table workout_plan_exercises (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references gyms(id),
  member_id uuid not null references members(id),
  plan_id uuid not null references workout_plans(id) on delete cascade,
  exercise_id uuid not null references exercise_library(id),
  order_index smallint not null,
  sets smallint not null,
  reps smallint not null,
  note text,
  constraint workout_plan_exercises_sets_positive check (sets > 0),
  constraint workout_plan_exercises_reps_positive check (reps > 0),
  constraint workout_plan_exercises_note_len check (note is null or char_length(note) <= 200),
  unique (plan_id, order_index)
);

create index idx_workout_plan_exercises_plan_id on workout_plan_exercises(plan_id);

alter table workout_plans enable row level security;
alter table workout_plan_exercises enable row level security;

-- No insert/update/delete grant to authenticated on either table -- all
-- writes go through the two SECURITY DEFINER RPCs below, which bypass table
-- grants entirely. Exact same shape as session_notes/coach_assignments.
grant select on workout_plans, workout_plan_exercises to authenticated, service_role;

-- ============================================================================
-- SELECT policies. Same shape on each table (using each table's own
-- member_id/gym_id columns per the denormalization above).
-- ============================================================================
create policy "self_read_own_workout_plan" on workout_plans
  for select
  using (member_id in (select id from members where user_id = auth.uid()));

create policy "self_read_own_workout_plan_exercises" on workout_plan_exercises
  for select
  using (member_id in (select id from members where user_id = auth.uid()));

-- coach_read_assigned_workout_plan[_exercises]: byte-for-byte the same
-- condition as coach_read_assigned_progress_entries (0067). Uses
-- private.current_member_role() (0061), never auth.jwt() ->> 'app_role' --
-- AD-3 requires the live-lookup helper for every new call site. (0057's
-- create_class/update_class and 0068's mark_class_attendance both still use
-- the legacy auth.jwt() pattern despite postdating AD-3 -- not a precedent
-- to follow here.)
create policy "coach_read_assigned_workout_plan" on workout_plans
  for select
  using (
    gym_id = private.gym_id()
    and private.current_member_role() = 'coach'
    and private.is_assigned_coach(member_id)
  );

create policy "coach_read_assigned_workout_plan_exercises" on workout_plan_exercises
  for select
  using (
    gym_id = private.gym_id()
    and private.current_member_role() = 'coach'
    and private.is_assigned_coach(member_id)
  );

-- ============================================================================
-- create_workout_plan(): resolves the caller's own coach id server-side
-- (never trust a client-supplied coach id), checks the assignment (AC #4),
-- validates p_exercises is a non-empty JSON array, inserts the parent row,
-- then fans out the exercise rows -- validating each exercise_id belongs to
-- the caller's own gym or is a platform default. This is a real
-- tenant-isolation check, not decorative: a SECURITY DEFINER function does
-- not inherit exercise_library's own SELECT RLS just because it happens to
-- be readable to the caller under a different policy branch.
-- ============================================================================
create function create_workout_plan(p_member_id uuid, p_name text, p_exercises jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
  v_coach_id uuid;
  v_plan_id uuid;
begin
  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  select id into v_coach_id
  from members
  where user_id = auth.uid() and gym_id = v_gym_id and role = 'coach';

  if v_coach_id is null then
    raise exception 'create_workout_plan: caller is not a coach in this gym';
  end if;

  if not private.is_assigned_coach(p_member_id) then
    raise exception 'create_workout_plan: member % is not currently assigned to caller', p_member_id;
  end if;

  if jsonb_typeof(p_exercises) is distinct from 'array' or jsonb_array_length(p_exercises) = 0 then
    raise exception 'create_workout_plan: at least one exercise is required';
  end if;

  insert into workout_plans (gym_id, member_id, coach_id, name)
  values (v_gym_id, p_member_id, v_coach_id, btrim(p_name))
  returning id into v_plan_id;

  -- `materialized` forces this CTE's own WHERE to fully run (rejecting any
  -- element whose exercise_id/sets/reps isn't even the right shape) before
  -- the outer query ever casts those same text values to uuid/smallint --
  -- otherwise a malformed p_exercises element (e.g. a non-UUID exercise_id,
  -- reachable only via a direct RPC call bypassing the Zod-validated UI)
  -- raises a raw Postgres cast error instead of this function's own
  -- friendly "one or more exercises are invalid" exception below.
  with candidate_exercises as materialized (
    select elem, idx
    from jsonb_array_elements(p_exercises) with ordinality as t(elem, idx)
    where (elem->>'exercise_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and (elem->>'sets') ~ '^[0-9]+$' and (elem->>'sets')::bigint between 1 and 32767
      and (elem->>'reps') ~ '^[0-9]+$' and (elem->>'reps')::bigint between 1 and 32767
  )
  insert into workout_plan_exercises (gym_id, member_id, plan_id, exercise_id, order_index, sets, reps, note)
  select
    v_gym_id, p_member_id, v_plan_id,
    (elem->>'exercise_id')::uuid,
    idx,
    (elem->>'sets')::smallint,
    (elem->>'reps')::smallint,
    nullif(btrim(elem->>'note'), '')
  from candidate_exercises
  where exists (
    select 1 from exercise_library el
    where el.id = (elem->>'exercise_id')::uuid
      and (el.gym_id is null or el.gym_id = v_gym_id)
  );

  if (select count(*) from workout_plan_exercises where plan_id = v_plan_id) < jsonb_array_length(p_exercises) then
    raise exception 'create_workout_plan: one or more exercises are invalid for this gym';
  end if;

  return v_plan_id;
end;
$$;

revoke execute on function create_workout_plan(uuid, text, jsonb) from public;
grant execute on function create_workout_plan(uuid, text, jsonb) to authenticated;

-- ============================================================================
-- update_workout_plan(): create_workout_plan()'s edit counterpart. Two
-- separate checks, both required -- this is where FR-111/Story 13.4's
-- edit-lock is actually enforced, built now so 13.4 does not have to
-- retrofit this function's logic later:
--   1. caller must be the *authoring* coach (workout_plans.coach_id) --
--      blocks a newly-assigned coach who has not yet run Story 13.4's
--      take-ownership step.
--   2. caller must still be the *currently assigned* coach (AC #4 defense
--      in depth) -- redundant with #1 today (pre-13.4, an author is always
--      the currently-assigned coach), diverges only once 13.4 ships
--      reassignment, at which point both must independently hold.
-- Whole-list replace on every save, including reordering -- matches
-- update_class()'s "recompute and replace" shape rather than a diff/patch
-- approach.
-- ============================================================================
create function update_workout_plan(p_plan_id uuid, p_name text, p_exercises jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
  v_coach_id uuid;
  v_existing_member_id uuid;
  v_existing_coach_id uuid;
begin
  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  select id into v_coach_id
  from members
  where user_id = auth.uid() and gym_id = v_gym_id and role = 'coach';

  if v_coach_id is null then
    raise exception 'update_workout_plan: caller is not a coach in this gym';
  end if;

  if jsonb_typeof(p_exercises) is distinct from 'array' or jsonb_array_length(p_exercises) = 0 then
    raise exception 'update_workout_plan: at least one exercise is required';
  end if;

  select member_id, coach_id into v_existing_member_id, v_existing_coach_id
  from workout_plans
  where id = p_plan_id and gym_id = v_gym_id
  for update;

  if not found then
    raise exception 'update_workout_plan: plan % not found', p_plan_id;
  end if;

  if v_existing_coach_id != v_coach_id then
    raise exception 'update_workout_plan: caller is not the authoring coach for this plan';
  end if;

  if not private.is_assigned_coach(v_existing_member_id) then
    raise exception 'update_workout_plan: member is not currently assigned to caller';
  end if;

  delete from workout_plan_exercises where plan_id = p_plan_id;

  -- Same materialized pre-filter as create_workout_plan() -- see its own
  -- comment for why this must run before the outer query's uuid/smallint
  -- casts.
  with candidate_exercises as materialized (
    select elem, idx
    from jsonb_array_elements(p_exercises) with ordinality as t(elem, idx)
    where (elem->>'exercise_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and (elem->>'sets') ~ '^[0-9]+$' and (elem->>'sets')::bigint between 1 and 32767
      and (elem->>'reps') ~ '^[0-9]+$' and (elem->>'reps')::bigint between 1 and 32767
  )
  insert into workout_plan_exercises (gym_id, member_id, plan_id, exercise_id, order_index, sets, reps, note)
  select
    v_gym_id, v_existing_member_id, p_plan_id,
    (elem->>'exercise_id')::uuid,
    idx,
    (elem->>'sets')::smallint,
    (elem->>'reps')::smallint,
    nullif(btrim(elem->>'note'), '')
  from candidate_exercises
  where exists (
    select 1 from exercise_library el
    where el.id = (elem->>'exercise_id')::uuid
      and (el.gym_id is null or el.gym_id = v_gym_id)
  );

  if (select count(*) from workout_plan_exercises where plan_id = p_plan_id) < jsonb_array_length(p_exercises) then
    raise exception 'update_workout_plan: one or more exercises are invalid for this gym';
  end if;

  update workout_plans set name = btrim(p_name) where id = p_plan_id;
end;
$$;

revoke execute on function update_workout_plan(uuid, text, jsonb) from public;
grant execute on function update_workout_plan(uuid, text, jsonb) to authenticated;

-- ============================================================================
-- Closes deferred-work.md's item from Story 13.1's own code review
-- ("No uniqueness enforcement on exercise names") -- deferred to here,
-- now that this story owns the actual duplicate-handling UX (the
-- "+ Add new exercise" affordance) the deferral was waiting on. The
-- coalesce() is required specifically because Postgres treats every NULL as
-- distinct from every other NULL, so a plain (gym_id, lower(btrim(name)))
-- unique index would never catch two platform-default rows shadowing each
-- other. This index's own reach is still narrower than that: it dedupes
-- within one exact partition (two platform-default rows against each other
-- via the sentinel, or two custom rows within the same real gym_id) -- a
-- btree index can never also catch a gym's own custom entry shadowing an
-- existing *platform-default* name, since a real gym_id and the sentinel
-- are always different key values. The trigger below closes that second,
-- cross-partition case, which deferred-work.md's own item explicitly named
-- ("shadowing an existing platform default").
-- ============================================================================
create unique index idx_exercise_library_gym_name_unique
  on exercise_library (coalesce(gym_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name)));

-- Not security definer -- deliberately runs with the inserting session's own
-- invoker rights, so its EXISTS check is scoped by exactly the same RLS
-- (`authenticated_read_exercise_library`) that already governs "platform
-- defaults or this gym's own rows" for that session, no separate
-- gym-resolution logic needed. Raises with the same errcode/message
-- substring the unique index above uses, so
-- packages/types/src/errors.ts's single mapSupabaseError() branch (keyed on
-- message text) catches both paths with one friendly error, regardless of
-- which layer caught the duplicate.
create function private.exercise_library_check_name_available()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Serializes concurrent inserts of the same (case-insensitive) name --
  -- without this, two concurrent transactions could both pass the EXISTS
  -- check below before either commits, letting a cross-partition duplicate
  -- through despite this trigger's whole purpose. Same
  -- pg_advisory_xact_lock(hashtext(...)) pattern as enforce_member_cap
  -- (0003) / otp_resend_attempts' rate limit (0019). Released automatically
  -- at transaction end.
  perform pg_advisory_xact_lock(hashtext(lower(btrim(new.name))));

  if exists (
    select 1 from exercise_library
    where (gym_id is null or gym_id = new.gym_id)
      and lower(btrim(name)) = lower(btrim(new.name))
  ) then
    raise exception 'idx_exercise_library_gym_name_unique: exercise name already exists' using errcode = '23505';
  end if;
  return new;
end;
$$;

create trigger exercise_library_check_name_available_trigger
  before insert on exercise_library
  for each row
  execute function private.exercise_library_check_name_available();
