-- Story 13.3: Member Plan View & Completion Tracking (FR-110). Third story
-- in Epic 13 -- workout_plan_completions is wholly new, additive-only.
--
-- Design decision (do not FK to workout_plan_exercises.id): 0080's
-- update_workout_plan() deletes and reinserts every workout_plan_exercises
-- row on any edit, including a bare reorder. A completion FK'd to that
-- table's id with `on delete cascade` would silently wipe a member's
-- completion history on the coach's very next save. exercise_id (a stable
-- exercise_library row) is the only identity in this schema that survives a
-- plan edit, so completion history is keyed by (plan_id, exercise_id), not
-- by row instance. Known, accepted consequence: 13.2's own code review
-- explicitly allowed duplicate exercise_id within one plan (warm-up vs.
-- working sets); when that happens, marking one occurrence complete shows
-- as complete on both, since exercise_id alone can't disambiguate them.
-- Plain RLS, no security definer RPC -- same reasoning progress_entries
-- (0066) documents for itself: no cross-row invariant to protect, only row
-- ownership + idempotent replay, both fully expressible as RLS + a partial
-- unique index.

create table workout_plan_completions (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references gyms(id),
  member_id uuid not null references members(id),
  plan_id uuid not null references workout_plans(id) on delete cascade,
  exercise_id uuid not null references exercise_library(id),
  -- Client-provided timestamp for offline-safe entries, mirroring
  -- progress_entries.logged_at's single-timestamp economy -- no separate
  -- created_at.
  completed_at timestamptz not null default now(),
  client_completion_id uuid
);

create index idx_workout_plan_completions_plan_id on workout_plan_completions(plan_id);
create index idx_workout_plan_completions_member_id on workout_plan_completions(member_id);

-- Backs the INSERT policy's exists() exercise-currently-in-plan guard below
-- (matched on plan_id + exercise_id together) -- 0080 only indexes
-- workout_plan_exercises(plan_id) alone.
create index idx_workout_plan_exercises_plan_id_exercise_id
  on workout_plan_exercises(plan_id, exercise_id);

-- Idempotency-enforcing partial unique index -- mirrors
-- idx_progress_entries_client_entry_id's exact shape (0066). The mobile
-- client-side idempotent-replay contract (logWorkoutCompletion's
-- unique-violation fallback) depends on this.
create unique index idx_workout_plan_completions_client_id
  on workout_plan_completions(client_completion_id) where client_completion_id is not null;

alter table workout_plan_completions enable row level security;

-- No update/delete grant -- a completion is an append-only log entry, no AC
-- asks for undoing one.
grant select, insert on workout_plan_completions to authenticated, service_role;

-- Three explicit per-action policies, never `for all` (AD-1).

-- Matches self_read_own_workout_plan_exercises' exact shape (0080).
create policy "self_read_own_workout_plan_completions" on workout_plan_completions
  for select
  using (member_id in (select id from members where user_id = auth.uid()));

-- Byte-for-byte the same condition as coach_read_assigned_workout_plan_exercises
-- (0080). private.current_member_role() (0061), never
-- auth.jwt() ->> 'app_role' -- AD-3 requires the live-lookup helper for
-- every new call site.
create policy "coach_read_assigned_workout_plan_completions" on workout_plan_completions
  for select
  using (
    gym_id = private.gym_id()
    and private.current_member_role() = 'coach'
    and private.is_assigned_coach(member_id)
  );

-- member_id/gym_id clauses are data-correctness guards on the denormalized
-- columns (self_insert_own_progress_entries' own precedent, 0066) -- SELECT
-- is already member_id-scoped regardless. The plan_id clause keeps the
-- denormalized plan_id/member_id pair internally consistent. The exists()
-- clause is the exercise-currently-in-plan guard -- reachable only via a
-- direct insert bypassing the UI (which only ever offers the current
-- exercise list), but still a real data-integrity boundary, matching
-- create_workout_plan()'s own "not decorative" cross-gym exercise_id check.
create policy "self_insert_own_workout_plan_completions" on workout_plan_completions
  for insert
  with check (
    member_id in (select id from members where user_id = auth.uid())
    and gym_id = (select gym_id from members where id = member_id)
    and plan_id in (select id from workout_plans where member_id = workout_plan_completions.member_id)
    and exists (
      select 1 from workout_plan_exercises wpe
      where wpe.plan_id = workout_plan_completions.plan_id
        and wpe.exercise_id = workout_plan_completions.exercise_id
    )
  );
