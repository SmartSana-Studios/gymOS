-- Story 11.9: Suspension Enforcement for Workout Plan Tables
--
-- Closes the last hole in NFR-018 / AD-3. Story 11.4 (0073) shipped
-- `tenant_active_gate` -- an AS RESTRICTIVE ... FOR ALL policy -- to 17 tables,
-- and 0084_notification_history.sql:54 added public.notifications as the 18th.
-- Story 11.8 (0090) shipped the in-function guard to 18 SECURITY DEFINER
-- write-RPCs, because RLS does not apply inside a SECURITY DEFINER function.
--
-- Epic 13 shipped AFTER 0073 and never picked the policy up. workout_plans
-- (0080:21), workout_plan_exercises (0080:42) and workout_plan_completions
-- (0081:20) each carry `gym_id not null` with an FK to gyms and have RLS
-- enabled, but carry no gate; their three write-RPCs carry no guard. So at a
-- fully suspended gym a coach could still author, edit and hand off plans and a
-- member could still record completions -- through direct table access AND
-- through the RPCs. That is precisely the "hidden by the UI" state NFR-018
-- rejects: the dashboard's suspended screen is render-time only, and a Server
-- Action POST does not re-run the layout.
--
-- 0090's own guardrail could not see this. suspension_rpc_coverage.test.sql
-- derives its gated-table set from `pg_policies where policyname =
-- 'tenant_active_gate'`, so a table that never received the policy is invisible
-- by construction. Story 11.8's code review found it by sweeping
-- information_schema for gym_id-bearing tables instead, and pinned the result
-- (suspension_rpc_coverage.test.sql assertion 5) so it can never hide again.
--
-- BOTH HALVES ARE REQUIRED, AND THIS WAS PROVEN, NOT ASSUMED
-- In a rolled-back probe against the live schema with all three policies
-- applied and a suspended gym: a member's SELECT on workout_plans returned 0
-- rows and the direct completions INSERT was refused -- but
-- take_ownership_of_workout_plan() STILL SUCCEEDED AND WROTE. The policy alone
-- does not close the RPCs. Hence both halves ship together, below.
--
-- THE NULL TRAP -- `is distinct from`, NEVER `<>`
-- private.current_gym_status() returns NULL for a session with no gym_id claim,
-- or one whose claim points at a gym row that no longer exists. In an RLS USING
-- clause NULL is falsy and fails CLOSED, which is exactly what the policy half
-- below relies on. Inside plpgsql the polarity INVERTS: `NULL <> 'active'`
-- evaluates to NULL, the `if` does not fire, and the function proceeds to WRITE
-- -- failing OPEN. `is distinct from` returns true for NULL and fails closed.
-- Verified empirically against this project's own Postgres during Story 11.8,
-- not reasoned from the docs.
--
-- ERROR MESSAGE SHAPE IS A CROSS-LAYER CONTRACT
-- No SQLSTATE; the convention is `raise exception '<function_name>: <detail>',
-- <arg>` (0090:55-60). The phrase `is not active` is load-bearing: it is matched
-- by isGymSuspendedError() in packages/types/src/errors.ts:25-28, by every
-- pgTAP throws_like() assertion, and by assertion 6 of
-- suspension_rpc_coverage.test.sql. Reword it in one place and the other three
-- silently stop matching.
--
-- `or private.is_super_admin()` is deliberately NOT mirrored into the plpgsql
-- guards (0090:49-53): these RPCs are all caller-gym-scoped via private.gym_id(),
-- and a Super Admin acting on a gym does so through the escalation RPCs.
--
-- No dynamic DDL. Per 0073:110-115, no migration in this schema generates DDL
-- via a `DO $$ ... EXECUTE format(...) $$` loop, and this one does not start
-- that precedent: one explicit create policy per table.
--
-- THE EXCLUSION LIST IS EMPTY, AND THAT IS THE AUDITED ANSWER
-- Story 11.8 needed 19 exclusions because gating a recovery path locks a paying
-- customer out permanently. Here there are none. Verified against the live
-- catalog: the three tables have ZERO triggers; exactly four functions in the
-- whole schema mention a workout_plan table (the three writers gated below plus
-- the read-only get_workout_plan_viewer_context); no already-gated function
-- calls into any of them -- so plan handoff inherits no guard and needs its own;
-- none of the 8 cron.job entries resolves to a function touching these tables;
-- and there is no service_role grant on any of the three RPCs. Recovery is
-- billing-only (the saas_billing_* paths already excluded by 0090).
--
-- Accepted behavioural consequence, recorded rather than treated as a bug: if a
-- coach is reassigned or deactivated WHILE the gym is suspended, the incoming
-- coach cannot take ownership until reactivation. Correct -- they cannot read or
-- edit the plan either -- and self-healing. This is the workout-plan analogue of
-- the accepted check_out note at deferred-work.md:840.
--
-- exercise_library STAYS UNGATED, DELIBERATELY (Story 11.9 AC #4)
-- It is shared reference data whose gym_id is NULLABLE, and all 15 seeded
-- platform-default rows (0079:74-89) have gym_id is null. tenant_active_gate's
-- predicate is row-independent, so gating it would also block a suspended gym
-- from reading PLATFORM rows -- subtracting access to data that was never the
-- tenant's. It holds no member or behavioural data (0079:38-41 records the
-- deliberate decision to read it wider than staff), and nothing meaningful is
-- reachable through it: once plans and plan-exercises are gated, a coach cannot
-- save a plan referencing a new exercise anyway.
--   Residual, disclosed and NOT fixed here: a coach at a suspended gym can still
--   INSERT an orphan custom exercise name. Harmless -- an unreferenced row in a
--   gym-scoped reference table.
--   TRAP if a future story ever decides to close that: add a SEPARATE, narrower
--   RESTRICTIVE ... FOR INSERT policy under a DIFFERENT name (e.g.
--   tenant_active_insert_gate). Reusing the name `tenant_active_gate` silently
--   changes assertion 1's count in suspension_rpc_coverage.test.sql, and
--   converting it to FOR ALL breaks the platform-default reads above.
-- This is a different rationale from gym_payment_credentials (decisions.md:298),
-- which is ungated because it has ZERO permissive policies, making a restrictive
-- policy a structural no-op. That reasoning does NOT apply here: the workout
-- tables DO have permissive SELECT policies, so the gate is not a no-op on them.
--
-- ================================================================
-- PART 1 -- The RLS half: gate the three tables
-- ================================================================
-- Policy DDL is byte-identical to 0073:117-121 across all 18 existing tables,
-- changing only the table name. The name repeats verbatim ON PURPOSE so one grep
-- finds every site -- do not vary it. FOR ALL is a deliberate, disclosed
-- exception to AD-1's "never FOR ALL" (decisions.md:296): AD-1 targets
-- differentiated per-action business policies, not a single tenant-liveness
-- gate. `= 'active'` (not `<> 'suspended'`) denies both 'suspended' and
-- 'deactivated' (decisions.md:300). `or private.is_super_admin()` is
-- load-bearing and applied uniformly so a future Super-Admin policy cannot
-- silently regress: a Super Admin has no gym_id claim, so current_gym_status()
-- is NULL, `NULL = 'active'` is falsy under a RESTRICTIVE USING, and the call
-- falls through to the is_super_admin() branch.
--
-- Existing policies on these three tables are SELECT-only except one INSERT
-- policy on completions (0081:82), so the gate's `with check` half only bites on
-- workout_plan_completions; elsewhere the `using` half does the work.

create policy "tenant_active_gate" on workout_plans
  as restrictive
  for all
  using (private.current_gym_status() = 'active' or private.is_super_admin())
  with check (private.current_gym_status() = 'active' or private.is_super_admin());

create policy "tenant_active_gate" on workout_plan_exercises
  as restrictive
  for all
  using (private.current_gym_status() = 'active' or private.is_super_admin())
  with check (private.current_gym_status() = 'active' or private.is_super_admin());

create policy "tenant_active_gate" on workout_plan_completions
  as restrictive
  for all
  using (private.current_gym_status() = 'active' or private.is_super_admin())
  with check (private.current_gym_status() = 'active' or private.is_super_admin());

-- ================================================================
-- PART 2 -- The function half: guard the three write-RPCs
-- ================================================================
-- Each body below was generated from pg_get_functiondef() against a database at
-- migration 0090 -- NOT transcribed from 0080/0082 -- so the before/after diff is
-- purely additive with zero deletions. In particular the non-STRICT coach lookup
-- (`select id into v_coach_id ...`) is preserved exactly as-is: it is a KNOWN
-- deferred defect (deferred-work.md:697) and a create-or-replace here must not
-- silently "fix" or regress it.
--
-- PLACEMENT IS NOT UNIFORM, AND THE REASONING DIFFERS PER FUNCTION.
-- update_workout_plan and take_ownership_of_workout_plan both take a
-- SELECT ... FOR UPDATE row lock on workout_plans before their authorization
-- checks complete. The guard goes ABOVE the lock in both: below it would still
-- satisfy the placement assertion but would leak plan existence and authorship
-- through THESE TWO FUNCTIONS and take a pointless lock. This mirrors 0090's own
-- error-precedence refinement for the three staff RPCs (0090:76-80).
--   Scope of that claim, stated precisely because a code review found it
--   overstated: it closes the leak in create/update/take_ownership only. It does
--   NOT make plan existence and authorship unlearnable at a suspended gym --
--   get_workout_plan_viewer_context() below still discloses both. See its note.
-- In all three the guard sits after the existing gym_id-null and coach-role
-- checks and before every write.
--
-- NOT gated: get_workout_plan_viewer_context(uuid) (0082:125-163) is read-only
-- (`return query select ...`), so it cannot write to a suspended gym and is out
-- of scope for the write-RPC guard this migration applies. It is deliberately
-- NOT added to any exclusion array either -- secdef_gated_writers never contains
-- a non-writer, so the entry would be permanently inert and would mislead the
-- next reader into thinking it had been considered and excused.
--   DISCLOSED RESIDUAL, accepted rather than fixed here (code review, 2026-09-09):
--   being SECURITY DEFINER, it bypasses the tenant_active_gate USING half this
--   migration just applied to workout_plans AND the one 0073 applied to members.
--   So at a fully suspended gym an assigned coach calling it directly still
--   learns whether the plan exists (`plan % not found` versus a returned row --
--   an existence oracle) and, when they are not the author, the authoring
--   coach's members.name. Impact is narrow: it reads nothing a coach could not
--   already see before the suspension, discloses no member or behavioural data,
--   and both apps route suspended users to a full-screen neutral state, so it is
--   reachable only by a client that is already open or calling PostgREST
--   directly. It is logged in deferred-work.md rather than closed, because
--   guarding a read-only function is a scope decision for a follow-up story --
--   AD-3 arguably binds it, since it does gate on role.

CREATE OR REPLACE FUNCTION public.create_workout_plan(p_member_id uuid, p_name text, p_exercises jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Story 11.9: suspension gate. `is distinct from`, never `<>` -- see header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'create_workout_plan: gym % is not active', v_gym_id;
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
$function$
;

CREATE OR REPLACE FUNCTION public.update_workout_plan(p_plan_id uuid, p_name text, p_exercises jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Story 11.9: suspension gate. `is distinct from`, never `<>` -- see header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'update_workout_plan: gym % is not active', v_gym_id;
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
$function$
;

CREATE OR REPLACE FUNCTION public.take_ownership_of_workout_plan(p_plan_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Story 11.9: suspension gate. `is distinct from`, never `<>` -- see header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'take_ownership_of_workout_plan: gym % is not active', v_gym_id;
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
$function$
;

-- ================================================================
-- Post-condition assertions
-- ================================================================
-- 0089's lesson, restated by 0090: a migration that assumes an object's shape
-- should assert it rather than trust the name. 0090's own block is historical
-- and is not re-executed, so this is a new one. If a body above were ever edited
-- in a way that dropped a guard, or if a policy were dropped or renamed, this
-- fails loudly at apply time instead of shipping a half-enforced gate.
--
-- There is no v_must_not_gate function array here: per Story 11.9 §C2 the
-- exclusion list is genuinely EMPTY, and inventing an entry for the read-only
-- get_workout_plan_viewer_context would be permanently inert. The negative
-- assertion that matters here is a TABLE one -- exercise_library must stay
-- ungated -- so that is what is asserted.
do $verify$
declare
  v_gated_fns text[] := array[
    'create_workout_plan','update_workout_plan','take_ownership_of_workout_plan'
  ];
  v_gated_tables text[] := array[
    'workout_plans','workout_plan_exercises','workout_plan_completions'
  ];
  v_missing text[];
  v_unexpected text[];
  v_bad_shape text[];
begin
  -- 1. Every function above must carry the guard.
  select array_agg(fn order by fn) into v_missing
  from unnest(v_gated_fns) as fn
  where not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = fn
      and p.prosrc like '%current_gym_status()%'
  );

  if v_missing is not null then
    raise exception '0091: suspension guard missing from %', array_to_string(v_missing, ', ');
  end if;

  -- 2. The guard must use `is distinct from`, never `<>`. This is the fail-OPEN
  --    trap described in the header: `NULL <> ''active''` is NULL, the if never
  --    fires, and the function writes. A guard present but written with `<>`
  --    would pass assertion 1 while enforcing nothing.
  select array_agg(fn order by fn) into v_bad_shape
  from unnest(v_gated_fns) as fn
  where not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = fn
      and p.prosrc like '%current_gym_status() is distinct from ''active''%'
      and p.prosrc like '%is not active%'
  );

  if v_bad_shape is not null then
    raise exception '0091: guard in % is not the required `is distinct from ''active''` + `is not active` shape', array_to_string(v_bad_shape, ', ');
  end if;

  -- 3. Every table above must carry tenant_active_gate, RESTRICTIVE and FOR ALL.
  select array_agg(t order by t) into v_missing
  from unnest(v_gated_tables) as t
  where not exists (
    select 1 from pg_policies p
    where p.schemaname = 'public' and p.tablename = t
      and p.policyname = 'tenant_active_gate'
      and p.permissive = 'RESTRICTIVE' and p.cmd = 'ALL'
  );

  if v_missing is not null then
    raise exception '0091: tenant_active_gate missing or not RESTRICTIVE/FOR ALL on %', array_to_string(v_missing, ', ');
  end if;

  -- 4. exercise_library must NOT acquire this policy -- see the header. Gating it
  --    would block a suspended gym from reading the 15 platform-default rows
  --    (gym_id is null) that belong to no tenant.
  select array_agg(p.policyname order by p.policyname) into v_unexpected
  from pg_policies p
  where p.schemaname = 'public' and p.tablename = 'exercise_library'
    and p.policyname = 'tenant_active_gate';

  if v_unexpected is not null then
    raise exception '0091: exercise_library must stay ungated -- it holds platform-default rows with gym_id is null; use a separate, differently-named FOR INSERT policy if a future story needs to narrow it';
  end if;
end;
$verify$;
