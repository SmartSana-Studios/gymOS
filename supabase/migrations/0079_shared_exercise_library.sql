-- Story 13.1: Shared Exercise Library (FR-112). First story in Epic 13 --
-- no exercise/workout-plan concept exists anywhere in the schema before
-- this migration. `exercise_library` is wholly new, additive-only.
--
-- New RLS pattern: the first table in this schema to mix platform-wide and
-- gym-scoped rows via a single nullable gym_id column (NULL = platform
-- default, visible to every gym; non-null = one gym's own custom entry).
-- Every existing gym-scoped table uses `gym_id uuid not null`; every
-- platform-wide table (tiers, messaging_provider_config) has no gym_id at
-- all. Confirmed correct per EXPERIENCE.md's AD-15 Workout Plan tab mockup,
-- which treats platform defaults and a gym's own custom entries as one
-- combined picker list, not two separate ones -- do not split into two
-- tables.

create table exercise_library (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid references gyms(id),
  name text not null,
  created_at timestamptz not null default now(),
  -- DB-level backstop for exerciseNameSchema's app-layer trim/length check
  -- (packages/types/src/schemas/exercise.ts) -- mirrors session_notes'
  -- own not-blank/max-length constraint pair (0041).
  constraint exercise_library_name_not_blank check (char_length(btrim(name)) > 0),
  constraint exercise_library_name_len check (char_length(name) <= 100)
);

create index idx_exercise_library_gym_id on exercise_library(gym_id);

alter table exercise_library enable row level security;

-- No update/delete grant -- neither AC nor the UX mockup (EXPERIENCE.md
-- AD-15) asks for editing or deleting an exercise, platform default or
-- custom, so none is added speculatively.
grant select, insert on exercise_library to authenticated, service_role;

-- ============================================================================
-- SELECT: any authenticated user, not just staff -- broader than the usual
-- gym_staff_read_own_* shape deliberately. Story 13.3 (member plan view,
-- later) will need a member session to resolve their own assigned plan's
-- exercise names, and exercise names carry no sensitive/PII data, so there
-- is no reason to gate this narrower than "platform-wide or own gym."
-- ============================================================================
create policy "authenticated_read_exercise_library" on exercise_library
  for select
  using (gym_id is null or gym_id = private.gym_id());

-- ============================================================================
-- INSERT: Coach role only -- matches the story's own "As a Coach... with
-- the ability to add my own" framing; only the Coach Portal's Workout Plan
-- tab (Story 13.2) ever calls this, not Owner/Manager/Supervisor.
--
-- AD-3 compliance: private.current_member_role() (0061), never
-- auth.jwt() ->> 'app_role'. `gym_id = private.gym_id()` alone already
-- rejects a NULL-gym_id (platform-default) insert attempt under SQL's
-- three-valued NULL-comparison logic -- no separate `gym_id is not null`
-- guard needed.
-- ============================================================================
create policy "coach_insert_own_gym_exercise_library" on exercise_library
  for insert
  with check (
    gym_id = private.gym_id()
    and private.current_member_role() = 'coach'
  );

-- ============================================================================
-- Platform-default seed rows (gym_id null). Superuser migration context
-- bypasses RLS, same as every other seeded-row migration (tiers,
-- messaging_provider_config). Keep the first five names exactly as written
-- -- EXPERIENCE.md's AD-15 Workout Plan tab mockup and its walkthrough
-- scenario reference "Bicep Curl," "Tricep Extension," "Squat," "Bench
-- Press," and "Deadlift" by these exact strings; a later story's
-- fixture/demo data or manual QA walkthrough may expect them verbatim.
-- ============================================================================
insert into exercise_library (gym_id, name) values
  (null, 'Squat'),
  (null, 'Bench Press'),
  (null, 'Deadlift'),
  (null, 'Overhead Press'),
  (null, 'Barbell Row'),
  (null, 'Pull-up'),
  (null, 'Push-up'),
  (null, 'Lat Pulldown'),
  (null, 'Leg Press'),
  (null, 'Bicep Curl'),
  (null, 'Tricep Extension'),
  (null, 'Plank'),
  (null, 'Lunge'),
  (null, 'Dumbbell Row'),
  (null, 'Shoulder Press');
