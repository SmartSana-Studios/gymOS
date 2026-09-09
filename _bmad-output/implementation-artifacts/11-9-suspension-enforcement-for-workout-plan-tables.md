---
baseline_commit: a63d1685fab97e56e900a90212d95b3ca7d960d6
---

# Story 11.9: Suspension Enforcement for Workout Plan Tables

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As GymOS,
I want a suspended gym's workout plans to be denied at the database like every other feature's data already is,
so that NFR-018 is finally true across the whole schema instead of everywhere except Epic 13.

### The gap, precisely

Story 11.4 shipped `tenant_active_gate` (`0073`) — an `AS RESTRICTIVE ... FOR ALL` policy — to 17 tables; `0084:54` added `public.notifications` as the 18th. Story 11.8 shipped the in-function guard to 18 `SECURITY DEFINER` write-RPCs, because RLS does not apply inside a `SECURITY DEFINER` function.

**Epic 13 shipped after `0073` and never picked the policy up.** `workout_plans` (`0080:21`), `workout_plan_exercises` (`0080:42`) and `workout_plan_completions` (`0081:20`) each carry `gym_id not null` with a FK to `gyms` and have RLS enabled, but carry no gate. Their three write-RPCs carry no guard. So at a fully suspended gym today a coach can still author, edit and hand off plans, and a member can still record completions — through direct table access *and* through the RPCs.

Story 11.8's anti-rot meta-test could not see this: it derives its gated-table set from `pg_policies where policyname = 'tenant_active_gate'`, so a table that never received the policy is invisible by construction. The 11.8 code review found it by sweeping `information_schema` for `gym_id`-bearing tables instead, and pinned the result so it can never hide again (`suspension_rpc_coverage.test.sql:210-238`).

**Both halves are required, and this was proven empirically, not assumed.** In a rolled-back probe against the live schema with all three policies applied and a suspended gym: a member's `SELECT` on `workout_plans` returned 0 rows and the direct completions `INSERT` was refused — but `take_ownership_of_workout_plan()` **still succeeded and wrote**. The policy alone does not close the RPCs.

### Authority — and one thing that does not exist

The binding authority is cross-cutting, **not** an Epic 13 requirement:
- **AD-3** binds "every RLS policy *and every `SECURITY DEFINER` function* that gates on role or gym status" [ARCHITECTURE-SPINE.md:43].
- **NFR-018** requires denial "at the authorization layer, not only the UI" [prd.md:799, epics.md:241].
- **FR-132** forbids member-facing billing language [prd.md:687].

**No FR or AC in Epic 13 mentions gym status, suspension, or NFR-018** — FR-109/110/111/112/122 and Stories 13.1-13.4's ACs are silent on it. Do not invent an Epic 13 requirement to justify this work; the authority above is sufficient and is what the story cites.

## Acceptance Criteria

1. **Given** a gym whose `status` is `suspended` or `deactivated`, **when** any session reads or writes `workout_plans`, `workout_plan_exercises` or `workout_plan_completions` directly, **then** it is denied — reads return zero rows, the completions INSERT is refused.
2. **Given** the same gym, **when** a coach calls `create_workout_plan`, `update_workout_plan` or `take_ownership_of_workout_plan`, **then** the call raises `<fn>: gym % is not active` and writes nothing — regardless of what the client UI allows.
3. **Given** a gym returned to `active`, **when** the same previously-denied session retries, **then** both the direct reads and the RPCs succeed on the very next statement, with no re-login or token refresh, and the write actually lands (assert a read-back, not merely `lives_ok`).
4. **Given** `exercise_library`, **when** a gym is suspended, **then** it remains readable — it is shared reference data with a **nullable** `gym_id`, and gating it would also block the 15 platform-default rows (`gym_id is null`) that belong to no tenant. Its ungated status must remain deliberate and documented, not incidental.
5. **Given** a **member or coach** who triggers one of these denials on a surface that still renders, **when** the app surfaces the error, **then** the message is the neutral FR-132 copy — never a billing reference and never a misleading "check your connection".
6. **Given** the guardrail in `suspension_rpc_coverage.test.sql`, **when** the policy lands, **then** every assertion it invalidates *by design* is updated to its new expected value, and assertion 7 is repaired so it actually covers the new functions (see Dev Notes §E — it currently cannot).
7. Full regression stays green: entire pgTAP suite on a fresh `db reset`, `pnpm run typecheck`, `pnpm run lint`, dashboard vitest, `pnpm run check:i18n` parity.

## Tasks / Subtasks

- [x] **Task 1 — Migration `0091`: gate the three tables (AC #1, #4)**
  - [x] Create `supabase/migrations/0091_suspension_enforcement_for_workout_plans.sql`
  - [x] Apply the §A policy DDL **verbatim** to `workout_plans`, `workout_plan_exercises`, `workout_plan_completions` — one explicit `create policy` per table, no `DO`/`EXECUTE format()` loop (`0073:110-115` forbids that precedent)
  - [x] Do **NOT** gate `exercise_library` — §B explains why, and §B's naming trap if a future story ever gates its INSERT only
  - [x] Re-derive the table list against the **live schema** before writing (11.4 did this and found two corrections; 11.8 did and its list held)
- [x] **Task 2 — Same migration: guard the three RPCs (AC #2)**
  - [x] Generate each body from `pg_get_functiondef` against the live DB, **not** transcribed from `0080`/`0082` — the before/after diff must be purely additive with zero deletions
  - [x] Insert the §C guard at the placement §C specifies per function — placement is not uniform and the reasoning differs per function
  - [x] Use `is distinct from 'active'`, never `<> 'active'` (§D — the fail-open trap)
  - [x] Do **NOT** add a guard to `get_workout_plan_viewer_context()` (read-only) and do **NOT** add it to any exclusion array — §C explains why that entry would be inert and misleading
  - [x] Preserve the non-`STRICT` coach lookup exactly as-is — it is a **known deferred defect** (`deferred-work.md:697`); a `create or replace` must not silently "fix" or regress it
  - [x] End the migration with a self-asserting `DO` block in `0090`'s style, covering the three new functions
- [x] **Task 3 — Repair and update the guardrail (AC #6)**
  - [x] `suspension_rpc_coverage.test.sql:48` — `18` → `21`; update the comment at `:36-40` and the header prose that says "the 19th"
  - [x] `:236` — remove the three `workout_plan*` entries from the pinned string, **and** delete the `-- NOT deliberate -- the Epic 13 gap` comment at `:234-235` together with them; new value in §E
  - [x] **`:288-296` — add `update workout_plans` to the `least()` list.** Without this, `take_ownership_of_workout_plan`'s only write (`update workout_plans`) is invisible, `write_at` resolves to 0, the `where write_at > 0` filter drops it, and its guard placement goes **silently unverified**. This is a real defect in the assertion, not a cosmetic edit
  - [x] Confirm assertions 2 and 6 pass only because the guard is written literally — the regex at `:70` is exact
- [x] **Task 4 — pgTAP: prove the denial (AC #1, #2, #3)**
  - [x] New `supabase/tests/workout_plan_suspension_enforcement.test.sql`, fresh UUID block (existing blocks: `…99xx`, `…171xx`, `…181xx` — pick an unused one)
  - [x] Insert fixture gyms **already suspended** — you cannot suspend one mid-file (§F, the BEFORE UPDATE trigger trap)
  - [x] Use the §G assertion matrix — **direct-table denial and RPC denial are asserted differently, and confusing them is the most likely way to ship this broken**
  - [x] Include a positive control (a table that stays readable) so a denial assertion cannot pass on a dead session
  - [x] Reversal section: `lives_ok` **plus** a read-back proving the write landed
  - [x] Capture RED before applying `0091` — the failure modes are the vulnerability, and that evidence belongs in the Dev Agent Record
  - [x] Prove the guardrail fails when it should, in a rolled-back transaction; do not assume it
- [x] **Task 5 — App layer (AC #5)**
  - [x] `apps/mobile/src/services/workoutPlan.ts` — import `isGymSuspendedError` from `@gymos/types` (it does not today; its three siblings all do) and return a `'gym_suspended'` discriminated status, mirroring `services/classes.ts:39-44`
  - [x] Surface `common.gymSuspended` on the workout-plan screen instead of `errorLoadFailed` ("Couldn't load your plan. **Check your connection** and try again.") and `errorMarkFailed`
  - [x] Resolve Open Question 1 (the `42501` gap) before writing this code — the answer changes what the mobile service can even detect
  - [x] Dashboard needs **no** change for the RPC paths — verify this rather than assume it, then say so
  - [x] `pnpm run check:i18n` — parity is enforced **per bundle**; reusing `common.gymSuspended` adds no keys
- [x] **Task 6 — Regression, evidence and records (AC #7)**
  - [x] Full pgTAP on a fresh `db reset` (§F: the reset drops the `pgtap` extension — `create extension pgtap` first or the suite reports 0 passes); `pnpm run typecheck`; `pnpm run lint`; dashboard vitest; `pnpm run check:i18n`
  - [x] `packages/types/src/database.ts` — regenerate only if signatures changed (they should not; bodies and policies only). State the result either way
  - [x] Live PostgREST evidence, not a browser check: suspended → RPC refused, reinstated → succeeds on the same unrefreshed JWT
  - [x] `docs/decisions.md` — new entry; **cite `docs/decisions.md:272`** for the `gym_payment_credentials` rationale, not `:252-256` (11.8 and the meta-test both cite the wrong lines; do not propagate)
  - [x] `deferred-work.md` — strike the HIGH item at `:841`; also strike `:20`, which is now stale (it says the `information_schema` sweep is "still the missing half"; the 11.8 review added it as assertion 5)
  - [x] Update Story 11.8's "NFR-018 status after code review" note — this story is what makes it whole

## Dev Notes

### §A — The policy DDL, verbatim

From `0073:117-121`, byte-identical across all 18 existing tables. Reproduce exactly, changing only the table name:

```sql
create policy "tenant_active_gate" on workout_plans
  as restrictive
  for all
  using (private.current_gym_status() = 'active' or private.is_super_admin())
  with check (private.current_gym_status() = 'active' or private.is_super_admin());
```

Load-bearing properties, all from `0073`'s own header — echo them, don't re-derive them:
- **The policy name repeats verbatim on purpose** so one grep finds every site. Do not vary it.
- **`FOR ALL` is a deliberate, disclosed exception** to AD-1's "never `FOR ALL`" [decisions.md:270]. AD-1 targets differentiated per-action business policies, not a single tenant-liveness gate.
- **`or private.is_super_admin()` is load-bearing** and applied uniformly so a future Super-Admin policy cannot silently regress. A Super Admin has no `gym_id` claim → `current_gym_status()` is NULL → `NULL = 'active'` is falsy under a RESTRICTIVE `USING` → falls through to the `is_super_admin()` branch. **In RLS, NULL fails closed. This is the opposite of plpgsql — see §D.**
- **`= 'active'`, not `<> 'suspended'`** — denies both `suspended` and `deactivated`. User-confirmed in 11.4 [decisions.md:274].
- **No dynamic DDL.** `0073:110-115`: no migration in this schema generates DDL via `DO $$ … EXECUTE format(…) $$`, "and this one doesn't start that precedent."

Existing policies on the three tables are **SELECT-only**, except one INSERT policy on completions (`0081:82`). So the gate's `with check` half only bites on `workout_plan_completions`; everywhere else the `using` half does the work.

### §B — `exercise_library` stays ungated (AC #4), verified not assumed

Three independent reasons:
1. **It is the only `gym_id`-bearing table in the schema where `gym_id` is nullable.** The 15 seeded platform-default rows (`0079:74-89`) have `gym_id is null`. `tenant_active_gate`'s predicate is row-independent, so gating would block a suspended gym from reading *platform* rows — subtracting access to data that was never the tenant's.
2. **No member or behavioural data.** `0079:38-41` records the deliberate decision to read it wider than staff. A suspended gym reading exercise names harms nothing.
3. **Nothing meaningful is reachable through it.** Its only write is the coach INSERT; once plans and plan-exercises are gated, a coach cannot save a plan referencing a new exercise anyway.

**Residual, disclose but do not fix:** a coach at a suspended gym can still INSERT an orphan custom exercise name (`apps/dashboard/services/exercises.ts:88`). Harmless — an unreferenced row in a gym-scoped reference table.

**Trap if a future story decides to close it:** add a *separate, narrower* `RESTRICTIVE ... FOR INSERT` policy under a **different name** (e.g. `tenant_active_insert_gate`). Reusing the name `tenant_active_gate` silently changes assertion 1's count, and converting to `FOR ALL` breaks the platform-default reads in reason 1.

Precedent for "RLS-enabled but deliberately ungated": `gym_payment_credentials` [decisions.md:272] — ungated because it has **zero** permissive policies, making a restrictive policy a structural no-op. **That reasoning does not apply here**: the workout tables *do* have permissive SELECT policies, so the gate is not a no-op on them. `exercise_library` is excluded for the different reason above.

### §C — In scope: exactly three functions, with per-function placement

Exactly three `SECURITY DEFINER` functions in the whole schema write a workout-plan table. None carries any status check today. Live schema and migration text agree exactly — no later migration redefines any of them.

| # | Function | Current definition | Writes | Guard goes |
|---|---|---|---|---|
| 1 | `create_workout_plan(uuid, text, jsonb)` | `0080:113-184` | `workout_plans`, `workout_plan_exercises` | after `0080:135`, before `:137` |
| 2 | `update_workout_plan(uuid, text, jsonb)` | `0080:205-284` | delete+insert `workout_plan_exercises`, update `workout_plans` | after `0080:228`, before `:230` |
| 3 | `take_ownership_of_workout_plan(uuid)` | `0082:67-106` | `update workout_plans set coach_id` | after `0082:89`, before `:91` |

All three: `revoke execute from public`, `grant execute to authenticated`. **No `service_role` grant on any of them.**

**Why placement is not uniform.** #2 and #3 both take a `SELECT ... FOR UPDATE` **row lock** on `workout_plans` (`0080:234`, `0082:91`) before their authorization checks complete. Putting the guard *above* the lock means a suspended-gym caller never acquires it and never learns whether the plan exists or who authored it. Putting it below still satisfies the placement assertion but leaks existence and authorship, and takes a pointless lock. This mirrors 0090's own error-precedence refinement for the three staff RPCs (`0090:76-80`). **Place above the lock.**

**Not in scope:** `get_workout_plan_viewer_context(uuid)` [`0082:125-163`] is read-only (`return query select ...`). It needs no guard. **Do not add it to any exclusion array either** — `secdef_gated_writers` never contains a non-writer, so the entry would be permanently inert and would mislead the next reader into thinking it was considered and excused.

### §C2 — The exclusion list is EMPTY, and that is the audited answer

Story 11.8 needed 19 exclusions because gating a recovery path locks a paying customer out permanently. **Here there are none.** Every claim below was checked against the live catalog:

- **No triggers.** The three tables have zero triggers. The only trigger anywhere nearby is `exercise_library_check_name_available_trigger` (BEFORE INSERT on `exercise_library`), which is `SECURITY INVOKER` **by design** (`0080:309-317`) so its `EXISTS` check inherits the caller's RLS — it needs no guard and would be covered automatically if that table were ever gated.
- **No already-gated function calls into a workout-plan function.** Verified directly: `prosrc ~* 'workout|exercise_library'` is false for `assign_coach`, `create_staff_member`, `update_staff_role`, `deactivate_staff_member`, `escalate_gym_data_access`, `revoke_gym_data_access` and `complete_verified_saas_billing_payment`. **Plan handoff is therefore not automatic and inherits no guard — it needs its own.** This was the single most important open question when the story was deferred.
- **No cron path.** All 8 `cron.job` entries resolve to functions whose bodies never mention these tables.
- **No Super Admin or `service_role` path.** No `service_role` grant on the three RPCs; no super-admin RPC writes these tables. Adding a RESTRICTIVE policy subtracts nothing from Super Admins, who have no permissive policy on these tables today anyway.
- **Recovery is billing-only** — `initiate_saas_billing_payment` / `complete_verified_saas_billing_payment` / `record_out_of_band_saas_billing_payment` / `apply_saas_billing_credit` and the `saas_billing_*` tables, all already excluded. No workout function is on any recovery path.

**Accepted behavioural consequence, state it in the story record rather than treating it as a bug:** if a coach is reassigned or deactivated *while* the gym is suspended, the incoming coach cannot take ownership until reactivation. Correct — they cannot read or edit the plan either — and self-healing. This is the workout-plan analogue of the accepted `check_out` note at `deferred-work.md:840`.

### §D — The guard, and the NULL trap that fails OPEN if missed

```sql
  -- Story 11.9: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception '<fn_name>: gym % is not active', v_gym_id;
  end if;
```

**`is distinct from`, NEVER `<>`.** `current_gym_status()` returns NULL for a session with no `gym_id` claim, or one whose claim points at a gym row that no longer exists. **In an RLS `USING` clause NULL is falsy and fails CLOSED — which is exactly what §A relies on. Inside plpgsql the polarity inverts:** `NULL <> 'active'` evaluates to NULL, the `if` does not fire, and the function **proceeds to write** — failing OPEN. `is distinct from` returns true for NULL and fails closed. Verified empirically against this project's own Postgres during Story 11.8, not reasoned from docs [11-8…md:176-180].

**Do NOT mirror `or private.is_super_admin()` into the plpgsql guard.** `0090:49-53`: these RPCs are all caller-gym-scoped via `private.gym_id()`, and a Super Admin acting on a gym does so through the escalation RPCs, not these.

**The error message is a cross-layer contract.** `0090:55-60`: no SQLSTATE; the convention is `raise exception '<function_name>: <detail>', <arg>`. The phrase `is not active` is matched by `isGymSuspendedError()` in `packages/types/src/errors.ts:25-28`, by every pgTAP `throws_like`, and by assertion 6 of the meta-test. **Reword it in one place and the other three silently stop matching.**

### §E — What the guardrail does when the policy lands (AC #6)

Four of `suspension_rpc_coverage.test.sql`'s seven assertions are affected. All values below were produced by applying the candidate policies in a rolled-back transaction and re-running the assertions' own SQL.

| Assertion | Lines | Change |
|---|---|---|
| 1 | `:46-50` | `18` → **`21`**. Also the comment at `:36-40` and header prose saying "the 19th" |
| 2 | `:142-154` | Scope widens — the three RPCs newly enter `secdef_gated_writers`. Passes **only** once all three carry the guard written literally (regex at `:70` is exact). No exclusion entries needed |
| 3 | `:160-170` | Unaffected |
| 4 | `:179-194` | Unaffected |
| 5 | `:210-238` | New expected value (verified verbatim): `'exercise_library, gym_data_escalations, gym_payment_credentials, saas_billing_notices, saas_billing_payments'`. Delete the `-- NOT deliberate -- the Epic 13 gap` comment at `:234-236` **with** the entries |
| 6 | `:249-261` | Passes only if all three raises carry `is not active` verbatim |
| 7 | `:277-312` | **Requires a code change or it silently under-covers** — see below |

**Assertion 7 is currently blind to this story's most important function.** Its `least()` list (`:287-296`) enumerates `insert into`, `delete from`, and `update` for eight named tables — but not `update workout_plans`. `take_ownership_of_workout_plan`'s *only* write is exactly that, so its `write_at` computes to `0`, the `where x.write_at > 0` filter at `:308` drops the row, and guard placement is never checked. **Add:**

```sql
              coalesce(nullif(position('update workout_plans' in lower(p.prosrc)), 0), 2147483647),
```

Safe: no currently-guarded function contains that string, and for `update_workout_plan` the `least()` still resolves to its earlier `delete from`.

**Existing Epic 13 pgTAP files do not break.** All eight (`coach_authored_workout_plans[.negative]`, `member_plan_view_completion_tracking[.negative]`, `plan_handoff_on_coach_reassignment[.negative]`, `shared_exercise_library[.negative]`) seed fixture gyms without a `status`, and `gyms.status` defaults to `'active'` (`0002:17`), so the new gate never fires in them. Every cross-gym negative case references a gym that *is* created, so `current_gym_status()` is never NULL there. Verified file by file — but re-run them, don't trust this paragraph.

`tenant_suspension_enforcement.test.sql` hardcodes no table list, but its prose at `:2-3, :24-25, :96, :362-364, :445, :474` says "17"/"18"/"19" and goes stale. Update the prose; `plan(88)` only changes if you add assertions there.

### §F — Testing standards and environment traps

- **Location/shape:** `supabase/tests/<snake_case_feature>.test.sql`; `begin; select plan(N); ... select * from finish(); rollback;`. `plan(N)` is hand-counted and manually bumped; a mismatch does **not** error — pgTAP reports "planned N but ran M", so verify with a real run.
- **Fixtures before `set local role`.** The file starts as `postgres` (bypasses RLS); `authenticated` has no grants on `auth.users`. Worked example: fixtures `tenant_suspension_enforcement.test.sql:34-145`, then `:152 set local role authenticated;`.
- **⚠️ You cannot suspend a gym mid-file.** `update gyms set status='suspended'` **silently no-ops** — `protect_super_admin_only_gym_columns` (BEFORE UPDATE, `0014:33,51-53`) reverts the column for a non-Super-Admin caller while still reporting `UPDATE 1`. **Insert the fixture gyms already suspended** (`tenant_suspension_enforcement.test.sql:42-44`). This cost Story 11.8 a wasted live-check cycle.
- **Claims idiom:** always 3-arg `set_config(..., true)` after `set local role`. Member `:152-157`, owner `:178-182`, coach `:342-346` (`"app_role":"coach"`), super admin `:236-240` (**no `gym_id` claim at all**), service_role `:558-559`.
- **`reset role;` between sections.** A read-back of a write made under a suspended-gym session must happen **after** `reset role` — the caller cannot SELECT the gated table it just wrote (`:509-516`).
- **`supabase db reset` drops the `pgtap` extension.** The whole suite then errors `function plan(integer) does not exist` and reports 0 passes until `create extension pgtap` is re-run. Environment artifact, not a failure. There is no pgtap install migration.
- **`supabase test db` swallows pg_prove output on failure in this devcontainer** — watch `docker events` / `docker logs -f` the pg_prove container [decisions.md:335].
- **Green checks are not evidence.** In 11.4 typecheck, lint and the RLS suite all passed while the Owner's real recovery path was broken. Exercise a real suspended gym.
- **Correction to 11.8's §F, do not inherit it:** it claims "`throws_ok` is not used anywhere in this suite". **That is false** — 7 files use it, including 5 uses in `tenant_suspension_enforcement.test.sql` itself. The workout-plan tests use `throws_ok` with SQLSTATE, and this story should match their local style.

### §G — The assertion matrix (this is how the story ships broken if you get it wrong)

RLS denial and RPC denial fail **differently**, and on these three tables there is a *third* mode — grant-level denial — because `authenticated` has no UPDATE/DELETE grant at all (`0080:62-66`, `0081:50-53`). A direct UPDATE/DELETE therefore raises at the **grant** layer before RLS is ever consulted, so the familiar "0 rows affected, silently" CTE idiom is **wrong here**.

| Surface | Correct assertion |
|---|---|
| Direct SELECT on any of the three, suspended | `is((select count(*)::int from …), 0, …)` — silent RLS-empty, no error |
| Direct INSERT on `workout_plan_completions` (grant exists → WITH CHECK fires) | `throws_ok(…, '42501', 'new row violates row-level security policy for table "workout_plan_completions"', …)` |
| Direct INSERT on `workout_plans` / `workout_plan_exercises` (no grant) | `throws_ok(…, '42501', 'permission denied for table workout_plans', …)` — grant-level, **not** an RLS message |
| Direct UPDATE/DELETE on any of the three | `throws_ok(…, '42501', 'permission denied …', …)` — **not** the 0-rows CTE idiom |
| RPC denial (all three) | `throws_like($$…$$, '%is not active%', …)` |
| Reversal after un-suspension | `lives_ok(…)` **plus** a read-back proving the write landed |

Always pair a zero-rows denial with a **positive control** (e.g. `gyms` stays readable, `tenant_suspension_enforcement.test.sql:172`) so the assertion cannot pass merely because the session is dead.

### §H — App layer: what a coach and a member actually see today

**Dashboard — the RPC paths already work.** All four write paths route through `mapAndLog` → `mapSupabaseError`, and the `isGymSuspendedError` branch sits deliberately ahead of the per-RPC message matches (`errors.ts:217-222`), so `createWorkoutPlan` / `updateWorkoutPlan` / `takeOwnershipOfWorkoutPlan` / `addCustomExercise` would each show `errors.gymSuspended` verbatim. **Verify this rather than assume it, then state it — no dashboard change is expected.**

**The real hole the story closes.** `apps/dashboard/app/(dashboard)/layout.tsx:58-105` replaces the whole chrome with a suspended screen — a coach gets `NeutralSuspendedScreen` and cannot navigate to `/coach/[memberId]`. **But the guard is render-time only.** Server Actions are POST endpoints that do not re-run the layout, so a coach who already had the page open when the gym flipped can still submit the modal and take ownership, and that write lands today. That is precisely the "hidden by the UI" state NFR-018 rejects.

**Mobile — every workout-plan path currently fails misleadingly.** `apps/mobile/src/services/workoutPlan.ts` imports nothing from `@gymos/types` except a schema; its three siblings (`classes.ts`, `checkin.ts`, `payments.ts`) all import `isGymSuspendedError`. Today:
- Load plan → `workoutPlan.screen.errorLoadFailed` = **"Couldn't load your plan. Check your connection and try again."** — the same misleading-connection-error class that `checkin.ts:85-88` calls out by name.
- Mark complete → `errorMarkFailed` = "Couldn't mark that complete. Try again." — suggests a retry that cannot succeed.
- Home entry point → the "My Workout Plan" card silently vanishes.

**⚠️ The read gate makes a plan look DELETED, not unavailable.** An RLS-denied SELECT returns zero rows with **no error**, so `.maybeSingle()` → `null`, which both apps already interpret as "no plan yet": the dashboard renders its empty state *with a live `+ New plan` button*, and the member sees "No workout plan yet." This is inherent to how 11.4's gate behaves on every table it covers, and both apps route suspended users to a full-screen neutral state — so it only manifests in the window where a client is already open. **Do not try to "fix" the empty state generally.** Decide it explicitly (Open Question 2) and record the decision.

**Copy.** Reuse `common.gymSuspended` in mobile (as `renew.tsx:226`, `checkin.tsx:428`, `classes/index.tsx:195,253` already do) — zero new keys. `check:i18n` enforces en/fr parity **per bundle** independently; mobile does not participate in the `packages/types` merge.

**Test runners:** `apps/dashboard` vitest + Playwright; `apps/super-admin` vitest (no plan surfaces); **`apps/mobile` has none** and `packages/types` has none — `apps/dashboard/lib/errors.gymSuspended.test.ts` is the established way to test shared error mapping, and its `GATED_RPCS` array is the canonical list to extend. Mobile verification is manual by precedent, which matches how the user handles device QA anyway.

### §I — Previous story intelligence

- **Generate bodies from `pg_get_functiondef`, never transcribe.** Many functions here were redefined by later migrations; copying an older body silently reverts fixes. 11.8 proved correctness with a zero-deletions before/after diff — do the same.
- **Make the migration self-asserting.** `0090` ends with a `DO` block that fails at apply time if a gated function lacks the guard. `0090`'s own block is historical and is not re-executed — write a new one.
- **Capture RED first.** 11.8 ran its new assertions against the unguarded schema and 10 of 18 reported "no exception thrown", i.e. they wrote to a fully suspended gym. That evidence is the vulnerability, and it is worth having.
- **Prove the guardrail fails**, in a rolled-back transaction, three ways if you can. Do not assume it.
- **Re-derive lists against the live schema, not against this story.** 11.4 did and found two corrections.
- **`tenant_suspension_enforcement.test.sql` has cross-story coupling** — Story 1.15 broke two of its assertions when an unrelated predicate changed [decisions.md:102].
- **Live evidence via PostgREST, not the browser.** Manual browser/device QA stays with the user.

### §J — Git intelligence

`HEAD` is `a63d168`. The two commits immediately before this story are Story 11.8's: `d55474b` (migration `0090`, both pgTAP files, `packages/types`, dashboard test, docs) and `a63d168` (the mobile AC-#4 and offline-queue fixes). **Read `0090` before writing `0091`** — it is the direct template for both the guard and the self-asserting block. The last migration is `0090`, so this story takes **`0091`**.

Open `action_items` in `sprint-status.yaml:378-394` that bind execution: commit immediately when the story goes `done`, before starting the next; and when splitting a mixed diff, cross-check each file against this story's own File List.

### Project Structure Notes

- **New:** `supabase/migrations/0091_suspension_enforcement_for_workout_plans.sql`; `supabase/tests/workout_plan_suspension_enforcement.test.sql`.
- **Modified:** `supabase/tests/suspension_rpc_coverage.test.sql` (assertions 1, 5, 7 + prose); `supabase/tests/tenant_suspension_enforcement.test.sql` (stale count prose only); `apps/mobile/src/services/workoutPlan.ts`; `apps/mobile/src/app/workout-plan.tsx`; `apps/dashboard/lib/errors.gymSuspended.test.ts` (`GATED_RPCS`); `docs/decisions.md`; `deferred-work.md` (strike `:841` and `:20`); `11-8-…md` (NFR-018 note); `sprint-status.yaml`.
- **Must NOT be modified:** `0073`, `0084`, `0090` (all shipped and correct); `exercise_library`'s policies; `get_workout_plan_viewer_context()`; the non-`STRICT` coach lookup inside the three RPCs; any §C exclusion function from Story 11.8.
- **Expected unchanged:** `packages/types/src/database.ts` — policies and bodies only, no signature change.

### References

- [Source: ARCHITECTURE-SPINE.md:41-45 — AD-3, binds SECURITY DEFINER functions, not just RLS policies]
- [Source: prd.md:799, epics.md:241 — NFR-018] · [Source: prd.md:687, epics.md:179 — FR-132]
- [Source: prd.md:725-731 — FR-109/110/111/112, which are silent on suspension]
- [Source: EXPERIENCE.md:255 — member-facing copy; :2222-2227 — the V1.5 suspension state spec, incl. :2226 extending neutral treatment to Coach]
- [Source: epics.md:2167-2179 — Story 11.4 ACs] · [Source: epics.md:2588-2594 — Story 13.4 ACs, incl. AC 1's "remains visible", in tension with a blanket read gate]
- [Source: 0073_tenant_suspension_enforcement.sql:12-67,110-121 — the policy, its rationale, and the no-dynamic-DDL rule]
- [Source: 0090_suspension_enforcement_in_rpcs.sql:35-60,76-80 — the guard idiom, the NULL trap, error-shape contract, placement refinements]
- [Source: docs/decisions.md:270-274 — AS RESTRICTIVE introduction, table-list corrections, `= 'active'` semantics] · [decisions.md:272 — the `gym_payment_credentials` ungated rationale; 11.8 and the meta-test both mis-cite this as :252-256]
- [Source: docs/decisions.md:8-18 — Story 11.8's mechanism decision and why FORCE RLS was rejected]
- [Source: deferred-work.md:841 — the HIGH item this story closes; :20 — the now-stale guardrail item; :697 — the non-STRICT coach lookup, do not fix here]
- [Source: 11-8-suspension-enforcement-in-security-definer-rpcs.md:79 — the deferral decision; :242 — the NFR-018 claim this story lifts]

## Open Questions

1. **The `42501` gap — decide before Task 5.** `workout_plan_completions` is gated by RLS, not by an RPC, so a blocked member INSERT raises Postgres `42501 / new row violates row-level security policy`. `isGymSuspendedError()` matches `": gym "` + `"is not active"` — the *raise* text — so it does **not** match, and `packages/types/src/errors.ts` has no `42501` branch. The member therefore loses the neutral FR-132 copy on this one path. Options: **(a)** accept — mobile routes suspended users to the full-screen neutral state anyway, and this only shows in the already-open window; **(b)** have the mobile service treat `42501` on a completions insert as a trigger to re-check session suspension, which fixes the cause rather than the copy; **(c)** map `42501` → `gym_suspended` globally in `mapSupabaseError` — **not recommended**, it would mis-label every unrelated RLS denial in the product as "your gym is suspended". Recommendation: **(b)**, falling back to (a) if it grows.
2. **The "looks deleted" empty state.** See §H. Recommendation: accept and document — it is how 11.4's gate already behaves on all 18 tables, and changing it means teaching every read surface to distinguish "denied" from "absent", which is its own story.
3. **Mobile's offline completion queue during a suspension.** `syncOneWorkoutCompletion` (`workoutPlan.ts:97-116`) treats anything other than `23505` as "leave queued". A `42501` is never `23505`, so queued completions retry on every sync for the whole suspension and the pending badge never drains. **No data loss and it self-heals on reactivation** — which is the *correct* outcome, and the deliberate opposite of the check-in bug 11.8's review fixed (there the record was being **deleted**). Confirm this reading and record it rather than changing the behaviour.

## Dev Agent Record

### Agent Model Used

Claude Opus 5 (1M context) — `claude-opus-5[1m]`

### Debug Log References

**RED, captured before `0091` was applied** (`workout_plan_suspension_enforcement.test.sql` run against the unguarded schema): **17 of 48 assertions failed.** The failures *are* the vulnerability:

- **All six RPC calls reported `no exception thrown`** — `create_workout_plan`, `update_workout_plan` and `take_ownership_of_workout_plan` each ran to completion at both a suspended *and* a deactivated gym.
- **Four read-back assertions proved the writes actually landed**, not merely that the calls returned: `have: 3` (a plan was **created** at a fully suspended gym), `have: Renamed during suspension` (a plan was **renamed**), `have: …020235` (plan ownership was **reassigned**), `have: 2` (a plan created at a **deactivated** gym).
- **Six read assertions failed for the coach and Owner sessions** (tests 7–12) while the member's own three passed — see the finding below; this changed the test's design.

**A fixture correction the RED run forced.** The first RED pass showed `create_workout_plan` failing with `duplicate key value violates unique constraint "idx_workout_plans_member_unique"` rather than `no exception thrown` — it had reached its INSERT and been stopped by a *pre-existing unique index*, not by any authorization check, which masked the hole. Plan-less fixture members (C and D) were added so that assertion tests the guard rather than the index.

**GREEN:** 48/48 after applying `0091`. `plan(N)` was initially miscounted as 49 and reported "planned 49 but ran 48" — §F warns this does not error, so it was verified from a real run.

**Guardrail failure probes, all in rolled-back transactions — proven, not assumed:**
1. Guard moved *below* the write in `take_ownership_of_workout_plan` → repaired assertion 7 **fails**. Re-run against the **pre-11.9** assertion 7: it reported **`ok`**. That is the direct proof the `least()` omission was a real defect and not a cosmetic edit.
2. `tenant_active_gate` dropped from `workout_plans` → assertions 1 and 5 fail.
3. A guard regressed to `<>` → assertion 2 fails.

**Applied-definition verification:** `pg_get_functiondef` re-read after apply and diffed against both the intended bodies (identical) and the original pre-migration bodies (**zero deletions** in all three), confirming the change is purely additive and the non-`STRICT` coach lookup was preserved.

**Live PostgREST evidence** (real HS256-signed coach JWT, not a browser). Suspended: `create_workout_plan` → `{"code":"P0001","message":"create_workout_plan: gym 00000000-0000-0000-0000-0000000cafe2 is not active"}`, direct `SELECT` → `[]`, rows written → `0`. Reinstated, **same unrefreshed JWT**: RPC returned the new plan id, `SELECT` returned the row, write confirmed in the table. Fixture removed afterwards.

**Full regression on a fresh `supabase db reset`:** 91 pgTAP files, **1928/1928 assertions**, zero failures, zero plan mismatches, zero errors (`pgtap` re-created after the reset per §F). `pnpm run typecheck`, `pnpm run lint` (0 errors; 15 pre-existing warnings, none in this diff), dashboard vitest **268/268 across 36 files**, `pnpm run check:i18n` parity OK — mobile unchanged at 323 keys, so **zero new keys**.

### Completion Notes List

**All 7 ACs met.** `tenant_active_gate` now covers **21** tables and the `is distinct from 'active'` guard **21** write-RPCs. Both halves shipped together because the story's own probe proved the policy alone leaves `take_ownership_of_workout_plan()` writing freely at a suspended gym.

**Five findings that changed the work as specified — each verified against the live schema or catalog, not reasoned from the story text:**

1. **The read hole was in the staff paths, and the member's apparent safety was accidental.** `self_read_own_workout_plan*` reads `member_id in (select id from members where user_id = auth.uid())`, and `members` has been gated since `0073` — so a suspended member's own read was *already transitively denied* before this story. The coach and Owner/Manager policies gate on `private.is_assigned_coach()` and `private.current_member_role()`, both `SECURITY DEFINER`, which bypass RLS entirely: those were genuinely wide open. The three member assertions therefore pass pre-migration and do **not** prove `0091`; they are kept with an in-file warning saying so, and Owner-session assertions were **added** to cover the second open path. Every zero-rows denial is paired with a positive control.
2. **Story Task 5's mobile instruction could not work as written.** It calls for importing `isGymSuspendedError()` into `apps/mobile/src/services/workoutPlan.ts` "like its three siblings". That predicate matches the RPC *raise text*, and **mobile calls none of the three workout-plan RPCs** — they are coach-facing and dashboard-only (verified: mobile's only RPCs are check-in, classes, payments and OTP). The import would have added a branch that can never fire. Implemented the correct equivalent instead — see 3.
3. **Open Question 1's `42501` is real but unreachable from mobile.** `getCurrentMember()` queries the gated `members` table, so it returns `null` and every writer bails out *before* its INSERT is attempted; the same is true of the screen's own `getCurrentMember()` call on the load path, which is the branch that actually produced the misleading "Check your connection" copy. The failure therefore arrives with **no distinguishing code or message at all**, so the cause must be *confirmed* rather than inferred: a new `isCurrentGymSuspended()` helper reads the deliberately-ungated `gyms` table via the JWT `gym_id` claim, mirroring `use-session.tsx`'s own sequence, and fails closed to `false`. This resolves Open Question 1 as a corrected variant of **option (b)**; option (c) stays rejected. The `42501` branch is still handled for the narrow status-flip-mid-call window, and still confirmed rather than trusted.
4. **Story 11.8's guardrail had a real blind spot, now proven.** Assertion 7's `least()` list omitted `update workout_plans` — `take_ownership_of_workout_plan()`'s only write — so its `write_at` resolved to 0 and the `where write_at > 0` filter silently dropped it. Demonstrated by moving that guard below its write and watching the pre-11.9 assertion still report `ok`.
5. **A factual correction to the story's §B.** `exercise_library` is **not** "the only `gym_id`-bearing table in the schema where `gym_id` is nullable" — `audit_log` and `payment_discrepancies` are nullable too, and both *are* gated (the gate reads the *caller's* status, never the row's `gym_id`). The substantive reason for excluding `exercise_library` is unaffected and was confirmed: all 15 seeded rows are platform defaults with `gym_id is null`, so gating it would block a suspended gym from reading data that was never the tenant's.

**Exclusion list is empty, audited against the live catalog:** zero triggers on the three tables; exactly four functions in the schema mention them (the three writers plus the read-only `get_workout_plan_viewer_context()`, deliberately not added to any exclusion array because the entry would be permanently inert); no already-gated function calls into them, so plan handoff inherits nothing and needed its own guard; none of the 8 `cron.job` entries touches them; no `service_role` grant on any of the three RPCs.

**Guard placement is above the row lock** in `update_workout_plan` and `take_ownership_of_workout_plan`, not merely before the write, so a suspended-gym caller never acquires the lock and never learns whether the plan exists or who authored it through those two functions. (Code review: that is scoped to these RPCs -- `get_workout_plan_viewer_context()` is SECURITY DEFINER, unguarded per §C, and still discloses plan existence and the authoring coach's name at a suspended gym. Logged in `deferred-work.md`.)

**Dashboard needs no change — verified, not assumed.** All three RPC wrappers route through `mapAndLog` → `mapSupabaseError`, and `isGymSuspendedError` at `errors.ts:217` precedes every match that could apply. The `23505` workout-plan branch at `errors.ts:168` cannot shadow it, because the suspension raise carries no SQLSTATE. The three RPCs were added to `GATED_RPCS` in `errors.gymSuspended.test.ts` (31/31 pass).

**Open Question 2 accepted and scoped** (an RLS-denied read looks like "no plan yet" — inherent to the gate on all 21 tables; fixed on this one screen only, because AC #5 requires it there, and the artefact result is deliberately not cached). **Open Question 3 confirmed and deliberately unchanged**: a queued offline completion stays queued for the whole suspension and the badge does not drain — no data loss, self-healing on reactivation, and the deliberate opposite of the check-in bug 11.8's review fixed, where the record was being *deleted*.

**`packages/types/src/database.ts` was NOT regenerated, and did not need to be** — the three RPC signatures in it were compared against `pg_get_function_arguments`/`pg_get_function_result` on the live DB and match exactly. Bodies and policies only, as expected.

**Records updated:** `docs/decisions.md` (new entry, citing `docs/decisions.md:272` for the `gym_payment_credentials` rationale rather than the `:252-256` mis-citation that 11.8 and the meta-test both carry — the mis-citation was also corrected in the meta-test itself); `deferred-work.md` (the HIGH-severity Epic 13 item struck as resolved, and the stale "the `information_schema` sweep is still the missing half" item closed — that sweep is assertion 5 today); Story 11.8's NFR-018 note updated, since this story is what makes it whole.

**Not done, deliberately:** manual browser/device QA stays with smartsana, per this project's standing practice.

### File List

**New**
- `supabase/migrations/0091_suspension_enforcement_for_workout_plans.sql`
- `supabase/tests/workout_plan_suspension_enforcement.test.sql`

**Modified**
- `supabase/tests/suspension_rpc_coverage.test.sql`
- `supabase/tests/tenant_suspension_enforcement.test.sql`
- `apps/mobile/src/services/workoutPlan.ts`
- `apps/mobile/src/app/workout-plan.tsx`
- `apps/dashboard/lib/errors.gymSuspended.test.ts`
- `docs/decisions.md`
- `_bmad-output/implementation-artifacts/deferred-work.md`
- `_bmad-output/implementation-artifacts/11-8-suspension-enforcement-in-security-definer-rpcs.md`
- `_bmad-output/implementation-artifacts/11-9-suspension-enforcement-for-workout-plan-tables.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

**Unchanged, as predicted:** `packages/types/src/database.ts` (no signature change).

### Change Log

| Date | Change |
|---|---|
| 2026-09-09 | `0091` gates `workout_plans`, `workout_plan_exercises`, `workout_plan_completions` with `tenant_active_gate` and adds the `is distinct from 'active'` guard to `create_workout_plan`, `update_workout_plan`, `take_ownership_of_workout_plan`; migration is self-asserting at apply time. |
| 2026-09-09 | New `workout_plan_suspension_enforcement.test.sql` (48 assertions): direct-read, grant-layer and RPC denial shapes asserted separately, deactivated-gym coverage, NULL-status fail-closed, and a reversal section proving every write lands via read-back. |
| 2026-09-09 | Repaired `suspension_rpc_coverage.test.sql` assertion 7 (`update workout_plans` was missing from its `least()` list, leaving `take_ownership_of_workout_plan` silently unverified); updated assertions 1 and 5 to their new values and corrected the `docs/decisions.md:252-256` mis-citation to `:272`. |
| 2026-09-09 | Mobile workout-plan load and mark-complete paths now surface the neutral `common.gymSuspended` copy instead of "Check your connection" / "Try again", via a new confirmed `isCurrentGymSuspended()` check (no new i18n keys). |
| 2026-09-09 | Records: new `docs/decisions.md` entry; `deferred-work.md` HIGH item struck and the stale guardrail item closed; Story 11.8's NFR-018 note updated — NFR-018 is now whole across the schema. |

### Review Findings

Adversarial code review, 2026-09-09. Three parallel layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor), all findings re-verified against the repo before triage. The migration itself is sound: policy DDL byte-identical to `0073:117-121`, all three guards use `is distinct from 'active'`, both `for update` locks are below their guard, bodies purely additive with zero deletions, non-`STRICT` coach lookup preserved, `exercise_library` ungated and asserted, `plan(48)` correct. The findings concentrate in what the tests *prove*, one surviving read path, the mobile render, and citation drift.

- [x] [Review][Decision] **Section F's NULL-trap assertion can never reach the guard it claims to test** — `workout_plan_suspension_enforcement.test.sql:372-388` sets `gym_id` to the non-existent `…020299` while `sub` is coach 1, whose `members` row is at `…020211` (`:70`). `create_workout_plan`'s coach lookup runs *above* the guard and raises `caller is not a coach in this gym`; the matcher is the bare wildcard `'%'`, so it passes on that unrelated raise. A regression to `<>` would still pass here, contradicting the section header at `:369-370`. Worse, this is not fixable by tightening the pattern: `members.gym_id` FKs to `gyms`, so a NULL `current_gym_status()` can never coexist with a passing coach check in any of the three functions — the fail-closed branch is structurally unreachable from these RPCs. The `<>` regression *is* still caught mechanically by `0091`'s own `DO` block (`:364-371`) and `suspension_rpc_coverage.test.sql:74`, so this is false confidence, not an open hole. Options: (a) delete the assertion, drop `plan(48)`→`plan(47)`, and replace the header with a note that the branch is unreachable and statically covered; (b) keep it but assert `throws_ok(…, null, …)` per the `tenant_suspension_enforcement.test.sql:430-439` convention and rewrite the label to say it only pins *that some* authorization check fires first; (c) leave as-is. — **Resolved: option (a).** The `throws_like` assertion was deleted, the section header rewritten to state that the fail-closed branch is unreachable from these RPCs and why, and the `is(current_gym_status(), null)` precondition assertion kept.
- [x] [Review][Decision] **`get_workout_plan_viewer_context()` still reads gated data at a suspended gym** — `0082:125-163` is `SECURITY DEFINER`, granted to `authenticated`, and deliberately unguarded per §C. It bypasses the `tenant_active_gate` `USING` half this migration just applied to `workout_plans` and that `0073` applied to `members`, so an assigned coach at a fully suspended gym still learns whether the plan exists (`plan % not found` vs a row — an existence oracle) and the other coach's `members.name`. §C's "read-only, needs no guard" is spec-sanctioned, but `0091:139-143`'s claim that a suspended caller "never learns whether the plan exists or who authored it" is contradicted by it, as is the decisions.md entry. AD-3 binds every `SECURITY DEFINER` function that gates on role or gym status, and this one gates on role. Options: (a) guard it too (deviates from §C's explicit instruction); (b) keep it unguarded, soften the two overstated claims, and log it in `deferred-work.md`; (c) keep it unguarded and leave the claims as they are. — **Resolved: option (a-as-listed / keep unguarded, fix the claims).** §C's exclusion stands; the overstated claims in `0091`, `deferred-work.md` and the Completion Notes were scoped to the three write-RPCs, and the residual read leak is now logged in `deferred-work.md`.
- [x] [Review][Patch] Section C's "the one direct-write assertion that actually proves 0091's policy" is false — `self_insert_own_workout_plan_completions`' `WITH CHECK` (`0081:82-87`) opens with `member_id in (select id from members …)` and `members` has been gated since `0073:117`, so the identical `42501` was raised before `0091`; net effect is that no assertion in the 48 proves the new policy's `with check` half [supabase/tests/workout_plan_suspension_enforcement.test.sql:191-205]
- [x] [Review][Patch] Five `docs/decisions.md` citations are off by 26 lines — the new entry prepends 26 lines (`@@ -2,6 +2,32 @@`), moving the `gym_payment_credentials` rationale `:272`→`:298`, AS-RESTRICTIVE/AD-1 `:270`→`:296`, and `= 'active'` `:274`→`:300`; Task 6 existed to correct exactly this class of mis-citation and reintroduced one [supabase/migrations/0091_suspension_enforcement_for_workout_plans.sql:93,104,107; supabase/tests/suspension_rpc_coverage.test.sql:237; supabase/tests/workout_plan_suspension_enforcement.test.sql:236; docs/decisions.md:17]
- [x] [Review][Patch] The exercise list is the one render block that never got the `!gymSuspended` guard — `:295`, `:303`, `:309` all received it; on AC #5's exact scenario the neutral FR-132 card renders above a live exercise list whose "Mark complete" buttons are all guaranteed to fail, while the "Mark all" header correctly disappears [apps/mobile/src/app/workout-plan.tsx:324-327]
- [x] [Review][Patch] The `!member` suspension branch leaves stale plan data on screen — unlike the sibling branch at `:121-125` it never calls `setScreenData(null)` / `setUsingCachedData(false)`, so a re-entry after suspension shows the neutral copy plus the previous plan plus a stale cached-data banner [apps/mobile/src/app/workout-plan.tsx:96-103]
- [x] [Review][Patch] Section B's six load-bearing denials have no positive control — these are the only assertions the file itself says actually prove `0091` (`:118-124`), yet neither the coach nor the Owner session ever reads a table that should stay visible, while Sections A (`:139`) and D (`:247`) both do; the header's "Every zero-rows denial is paired with a positive control" is false as written [supabase/tests/workout_plan_suspension_enforcement.test.sql:33-34,162-178]
- [x] [Review][Patch] Assertion 7's `least()` list still omits `update workout_plan_exercises` and `update workout_plan_completions` — the same blind spot the story just spent a task proving was real, left open for two of the three tables this migration gated [supabase/tests/suspension_rpc_coverage.test.sql:287-299]
- [x] [Review][Patch] The load-bearing predicate's own contract comment still says "all 18 gated write-RPCs" — the diff updated the mirror comment in the dashboard test and both SQL files but not the source of truth that `0091:73-78` cites as one of the four sites pinning this cross-layer contract [packages/types/src/errors.ts:11,196]
- [x] [Review][Patch] The two guardrail files now contradict each other — the rewritten header claims `tenant_suspension_enforcement.test.sql` "proves the 21 RPCs gated so far", but that file contains no workout-plan assertion and the block this same diff added to it (`:38-39`) says so explicitly [supabase/tests/suspension_rpc_coverage.test.sql:4-6]
- [x] [Review][Patch] `deferred-work.md`'s stale guardrail item was annotated, not struck — it keeps the item un-struck and appends "**Closed 2026-09-09.**", while the two other closed items in the same file (`:18`, `:841`) use the `~~…~~` convention, including the one this same diff struck; a reader scanning for open items still sees it as open [_bmad-output/implementation-artifacts/deferred-work.md:24]
- [x] [Review][Patch] Mojibake in the new test file — `:17` carries `c3 82 c2 a7` (double-encoded `§`, renders `Â§G`) and `:41` carries a double-encoded `⚠️`; no other file in the diff is affected [supabase/tests/workout_plan_suspension_enforcement.test.sql:17,41]
- [x] [Review][Patch] Stray double blank line [apps/mobile/src/services/workoutPlan.ts:295-296]
- [x] [Review][Patch] `isCurrentGymSuspended()`'s "Fails closed to `false`" comment inverts the fail-open/fail-closed vocabulary the rest of the diff uses precisely — returning `false` on error surfaces the misleading "Check your connection" copy this story exists to remove, and the cited precedent `use-session.tsx:85-95` deliberately does the opposite on that same error. The behaviour is defensible (never tell a member their gym is suspended on a guess); only the label is wrong [apps/mobile/src/services/workoutPlan.ts:60-66]
- [x] [Review][Defer] Migration self-assertions are overload-blind [supabase/migrations/0091_suspension_enforcement_for_workout_plans.sql:348-371] — deferred, pre-existing pattern
- [x] [Review][Defer] The reversal `create_workout_plan` call is bare rather than an assertion [supabase/tests/workout_plan_suspension_enforcement.test.sql:455-463] — deferred, fix is not unambiguous
- [x] [Review][Defer] `getCurrentMember()` resolves a membership independent of the JWT `gym_id` claim [apps/mobile/src/services/progress.ts:48-61] — deferred, pre-existing

**Post-review verification (2026-09-09).** All 14 patch findings applied, including both resolved decisions. Re-run clean afterwards: full pgTAP suite over all 91 files via host `psql`, **1930/1930 assertions**, zero failures, zero plan mismatches, zero errors — the story's 1928 plus this review's net +2 (one vacuous `throws_like` removed, three positive controls added); `workout_plan_suspension_enforcement.test.sql` now `plan(50)` and 50/50; `suspension_rpc_coverage.test.sql` 7/7 with the widened `least()` list; `pnpm run typecheck` clean; `pnpm run lint` 0 errors, 15 pre-existing warnings (unchanged count, none in this diff); dashboard `errors.gymSuspended.test.ts` 31/31; `pnpm run check:i18n` parity OK with mobile still at 323 keys, so still zero new keys. Manual browser/device QA remains with smartsana.
