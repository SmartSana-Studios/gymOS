---
baseline_commit: b478a18
---

# Story 5.1: Coach Member Assignment

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Manager or Owner,
I want to assign members to coaches,
so that each coach only sees the clients they're responsible for.

## Scope Notes — Read Before the Acceptance Criteria

**This is the first story in Epic 5 — no `coach_assignments` table, no Coach Portal route, and no staff-account-creation flow exist yet.** `member_role` already includes `'coach'` (`supabase/migrations/0001_extensions_and_enums.sql`), `Sidebar.tsx`'s `NAV_ITEMS` already has a `/coach` link gated to `roles: ["coach"]` (built ahead of need in Story 1.8), and `0018_member_management.sql`'s `gym_staff_read_own_members`/`gym_staff_read_own_subscriptions` policies already grant `coach` broad gym-wide read access with an explicit code comment: *"a known, temporary over-broadening relative to FR-022... harmless today since coach_assignments doesn't exist yet, Epic 5; revisit when Epic 5 ships Coach logins."* **Do not touch those policies in this story** — narrowing them to assignment-scoped access is Story 5.2's job (the Coach's own restricted list view), not this one. This story is Manager/Owner-side only: create the `coach_assignments` table and wire the assignment UI into the existing Members page. The actual `/coach` route (Coach Portal pages) is Story 5.2/5.3 — do not build it here.

**Coach *accounts* are assumed to already exist — creating them is out of scope for this story and for Epic 5's three stories as written.** Every AC here is about assigning an *existing* `members` row with `role = 'coach'` to a member; none of Epic 5's ACs (5.1, 5.2, or 5.3) create one. There is no "Add Staff"/"Invite Coach" flow anywhere in this codebase today — `createMember`/`insertMember` (`apps/dashboard/services/members.ts`) hard-code `role: "member"` and `listMembers()` hard-codes `.eq("role", "member")`, so coach-role members are invisible to every existing staff-facing screen. AD-05's own mockup (`EXPERIENCE.md` line 1029: *"Coach dropdown: only users with Coach role in this gym"*) assumes such rows exist without specifying how they're created. Treat this the same way `docs/decisions.md` already treats V1's founder-assisted gym onboarding (FR-007) — for the pilot, Coach-role `members`/`users` rows are provisioned directly via Supabase (Studio or SQL), same mechanism as any other out-of-band pilot setup. **Do not build a coach-creation UI in this story** — no AC asks for one, and inventing one is scope creep this codebase's own precedent (`docs/decisions.md`'s repeated "cut, no AC requires it" entries — see Story 4.8's "Last Payment" column) explicitly warns against. Flag this gap in Task 8's `docs/decisions.md` entry so it's visible to whoever picks up Epic 5 next, but do not attempt to close it here.

**The UI surface is the existing `MemberModal`, not a new page.** AD-05's mockup (`EXPERIENCE.md` lines 996–1032) already reserves a spot for this: an "── Assignment ──" section containing `Assigned Coach [dropdown of gym coaches]` grouped with `Emergency Contact`. `MemberModal.tsx`'s own doc comment already flags the gap it's about to close: *"Create mode shows the full AD-05 form minus Assigned Coach (Scope Note #5, no backing table yet)."* This story adds that field. Unlike the Membership block (Plan/Join Date/Subscription Status/Expiry — gated to `isCreate || readOnly`, i.e. hidden entirely in Edit mode per Story 2.3's Edit-mode boundary), **Assigned Coach must be visible and editable in Create, Edit, *and* read-only in View mode** — reassignment (AC #2) has to be reachable after a member already exists, which the existing Edit mode is the only path for. Render it in a new section outside the `(isCreate || readOnly)`-gated block.

**Assignment history (AC #3) renders inside the same modal's View mode — there is no separate member-detail/profile page.** `MemberModal.tsx`'s own doc comment: *"AD-04's own tabbed detail page is deferred — this story's 'View' action and row-click both open this same modal instead."* "View it from the member's profile" in the AC literally means: open a member in View mode (the existing `readOnly` path, already reachable by Receptionist and by Manager/Owner clicking a row) and see a reverse-chronological list of past coach assignments there. Manager/Owner also see it in Edit mode (so they have context before reassigning). No new route.

**One new atomic RPC, `assign_coach()`, is both the "assign" and the "reassign" path — there is no separate "unassign" operation.** No AC asks for clearing a member's coach back to none, and the codebase's own repeated precedent (Story 4.8's "don't build UI beyond what's asked") says not to invent one. `assign_coach(p_member_id, p_coach_id)` always requires a real coach id; ending the member's current assignment (if any) and starting a new one happens atomically inside one `SECURITY DEFINER` function — mirrors `renew_subscription()`'s (`0022`) and `confirm_renewal()`'s (`0037`) exact shape: role-checked, gym-scoped lookup with a uniform not-found failure mode, a single write, and an embedded `log_audit_event()` call — not two separate Server Action calls with app-side compensating rollback. This also naturally satisfies AC #4 (every assignment change is audit-logged) since the log write lives inside the same transaction as the state change.

**`coach_assignments` gets the standard full-CRUD grant to `authenticated` (matching every deny-all table in this schema, `job_runs` included) but *zero* RLS write policies — the RPC is the only write path.** `job_runs`/`0008_job_runs.sql` is the precedent: it grants `select, insert, update, delete` to `authenticated` yet has zero RLS policies, so writes are blocked by RLS, not by withholding the grant — this is deliberate and codebase-wide. A direct UPDATE/DELETE attempt is filtered to 0 affected rows with no error, matching every other table's write-path deny-all shape; a direct INSERT still raises a real "row-level security" error regardless of the grant (INSERT's implicit `WITH CHECK false` when no policy applies — it has no existing row to filter against, unlike UPDATE/DELETE, per `rls_tenant_isolation.test.sql`'s own documented distinction), but withholding the grant instead would only swap that for a bare grant-level "permission denied for table" error — not the RLS-flavored one every other table's INSERT-denial test in this codebase expects (`throws_like('%row-level security%')`). Withholding the INSERT/UPDATE grant would make `coach_assignments` fail differently from every other table in the schema for no benefit, since `assign_coach()` is `SECURITY DEFINER` and writes as the owning role regardless of the caller's own grants. Unlike `members`/`subscriptions` (which have both a `manager_or_owner_insert_own_*` RLS policy *and* a `SECURITY DEFINER` RPC for the Receptionist-inclusive case), no other role or future story in Epic 5 needs raw INSERT/UPDATE rights here — every write goes through `assign_coach()`, so no write policy is ever added, only the one `SELECT` policy below (Manager/Owner, for AC #3's history view).

**Do not narrow `gym_staff_read_own_members`/`gym_staff_read_own_subscriptions` in this story.** That's explicitly Story 5.2's job per its own AC ("RLS blocks the query... I can only ever see members assigned to me"). Touching it here would be premature and untested against 5.2's actual requirements.

## Acceptance Criteria

1. **Given** the Members page, **when** I assign a coach to a member who has no current coach, **then** the assignment is saved and the member appears in that coach's portal. [Source: epics.md#Story 5.1 AC#1; FR-055] (Note: "appears in that coach's portal" is a downstream consequence of the assignment row existing — the Coach Portal UI itself is Story 5.2/5.3's scope, not built here.)
2. **Given** a member already has an assigned coach, **when** I assign a new coach, **then** the previous assignment is ended with an `ended_at` timestamp (not deleted), and the previous coach's session notes remain visible to Owner/Manager only — not to the new coach. [Source: epics.md#Story 5.1 AC#2; FR-055] (Note: `session_notes` doesn't exist yet — Story 5.3 creates it. This story's obligation is the `ended_at`-not-deleted half; the notes-visibility half is automatically satisfied once 5.3 scopes note visibility to `coach_assignment_id`, since the assignment row this story preserves is what 5.3 will join against.)
3. **Given** a member's assignment history, **when** I view it from the member's profile, **then** all past coach assignments are queryable. [Source: epics.md#Story 5.1 AC#3; FR-055]
4. **Given** any coach assignment change (new assignment or reassignment), **when** it is saved, **then** it is written to the audit log with actor, target member, and timestamp. [Source: epics.md#Story 5.1 AC#4; FR-080]

## Tasks / Subtasks

- [x] **Task 1: Migration `0039_coach_member_assignment.sql`** (AC: #1, #2, #3, #4)
  - [x] New table, RLS enabled with a deny-all default in the same migration (project-wide convention — no "open table" window):
    ```sql
    create table coach_assignments (
      id uuid primary key default gen_random_uuid(),
      gym_id uuid not null references gyms(id),
      member_id uuid not null references members(id),
      coach_id uuid not null references members(id),
      started_at timestamptz not null default now(),
      ended_at timestamptz,
      created_at timestamptz not null default now()
    );

    create index idx_coach_assignments_gym_id on coach_assignments(gym_id);
    create index idx_coach_assignments_member_id on coach_assignments(member_id);
    create index idx_coach_assignments_coach_id on coach_assignments(coach_id);
    -- FR-055: "at most one active coach per member" -- enforced the same way
    -- idx_members_active_gym_user (0003) enforces "at most one active
    -- membership per gym per user": a partial unique index, not an app-side check.
    create unique index idx_coach_assignments_active_member on coach_assignments(member_id) where ended_at is null;

    alter table coach_assignments enable row level security;

    -- Full CRUD grant, same as every deny-all table in this schema (job_runs,
    -- 0008) -- writes are blocked by RLS having zero write policies, not by
    -- withholding the grant. A direct authenticated UPDATE/DELETE attempt is
    -- silently filtered to 0 affected rows, matching every other table's
    -- write-path deny-all shape; a direct INSERT still raises a real
    -- "row-level security" error regardless (WITH CHECK's implicit `false`
    -- when no policy applies -- INSERT has no existing row to filter
    -- against, unlike UPDATE/DELETE), but it is that RLS-flavored error --
    -- the one every other table's INSERT-denial test in this codebase
    -- expects (throws_like('%row-level security%')) -- not a bare
    -- grant-level "permission denied for table" a SELECT-only grant would
    -- have produced instead. assign_coach() below is the sole write path in
    -- practice (SECURITY DEFINER, runs as the owning role,
    -- unaffected by the caller's own grants) -- no INSERT/UPDATE/DELETE RLS
    -- policy is ever added for `authenticated`, only the SELECT policy below.
    grant select, insert, update, delete on coach_assignments to authenticated, service_role;

    -- AC #3: Manager/Owner can query a member's full assignment history.
    -- Coach's own narrower self-read (their assigned members only) is
    -- explicitly Story 5.2's job -- do not add it here (Scope Notes).
    create policy "manager_or_owner_read_own_coach_assignments" on coach_assignments
      for select
      using (
        gym_id = private.gym_id()
        and (auth.jwt() ->> 'app_role') = any(array['manager', 'owner'])
      );
    ```
  - [x] `assign_coach()`: one `SECURITY DEFINER` RPC, modeled directly on `renew_subscription()`'s (`0022_manual_renewal_reset.sql`) shape — role check first (cheapest), then a gym-scoped lookup with a uniform not-found failure mode (never let a cross-gym id distinguish "wrong gym" from "doesn't exist" — same tenant-isolation-enumeration-avoidance principle `renew_subscription`'s own comment documents), then the write, then an embedded `log_audit_event()` call:
    ```sql
    create function assign_coach(p_member_id uuid, p_coach_id uuid)
    returns uuid
    language plpgsql
    security definer
    set search_path = public
    as $$
    declare
      v_caller_gym_id uuid;
      v_member_gym_id uuid;
      v_coach_gym_id uuid;
      v_previous_coach_id uuid;
      v_new_id uuid;
    begin
      if not ((auth.jwt() ->> 'app_role') = any(array['owner', 'manager'])) then
        raise exception 'permission denied';
      end if;

      v_caller_gym_id := private.gym_id();
      if v_caller_gym_id is null then
        raise exception 'permission denied';
      end if;

      -- Folds "wrong gym" and "not actually a member" into one not-found
      -- outcome, same principle as renew_subscription's member lookup.
      select gym_id into v_member_gym_id
      from members
      where id = p_member_id and gym_id = v_caller_gym_id and role = 'member';

      if v_member_gym_id is null then
        raise exception 'assign_coach: member % not found', p_member_id;
      end if;

      -- Folds "wrong gym" and "not actually a coach" into one not-found
      -- outcome for the same reason.
      select gym_id into v_coach_gym_id
      from members
      where id = p_coach_id and gym_id = v_caller_gym_id and role = 'coach';

      if v_coach_gym_id is null then
        raise exception 'assign_coach: coach % not found', p_coach_id;
      end if;

      -- AC #2: end the prior active assignment (ended_at, not deleted) before
      -- starting the new one -- the partial unique index above would reject
      -- a second concurrently-active row for this member anyway, but this
      -- makes the "end-then-start" ordering explicit and atomic within this
      -- one function call.
      update coach_assignments
      set ended_at = now()
      where member_id = p_member_id and ended_at is null
      returning coach_id into v_previous_coach_id;

      insert into coach_assignments (gym_id, member_id, coach_id, started_at)
      values (v_member_gym_id, p_member_id, p_coach_id, now())
      returning id into v_new_id;

      perform log_audit_event(
        p_action_type => case when v_previous_coach_id is null then 'coach_assigned' else 'coach_reassigned' end,
        p_gym_id => v_member_gym_id,
        p_target_entity_id => p_member_id::text,
        p_target_entity_type => 'member',
        p_metadata => jsonb_build_object(
          'coach_id', p_coach_id,
          'previous_coach_id', v_previous_coach_id,
          'assignment_id', v_new_id
        )
      );

      return v_new_id;
    end;
    $$;

    revoke execute on function assign_coach from public;
    grant execute on function assign_coach to authenticated;
    ```
  - [x] `action_type` is free text on `audit_log` (`0007_audit_log.sql` line 45's own comment: *"free text avoids forcing every future epic's story to modify this migration's enum"*) — `'coach_assigned'`/`'coach_reassigned'` need no enum/constraint change.
  - [x] Regenerate `packages/types/src/database.ts` via `supabase gen types typescript --local` (WSL shell — see Dev Notes). Expect a new `coach_assignments` table entry and the new `assign_coach` function signature; nothing else should change.

- [x] **Task 2: Zod schema — `packages/types/src/schemas/coachAssignment.ts`** (new file) (AC: #1, #2)
  - [x] ```ts
    import { z } from "zod";

    export const assignCoachSchema = z.object({
      memberId: z.uuid("Select a valid member"),
      coachId: z.uuid("Select a coach"),
    });

    export type AssignCoachInput = z.infer<typeof assignCoachSchema>;
    ```
  - [x] Add `export * from "./schemas/coachAssignment";` to `packages/types/src/index.ts`, alongside the existing per-schema-file export list.

- [x] **Task 3: `apps/dashboard/services/coaches.ts`** (new file) (AC: #1, #2, #3)
  - [x] `getCallerGymId()` — copy verbatim from `members.ts`/`plans.ts` (this codebase's established per-file-copy discipline; do not import across service files).
  - [x] `export interface CoachRow { id: string; name: string; }` and `listCoaches()`: gym-scoped read of `members` rows with `role = 'coach'` and `deactivated_at is null`, ordered by name. Reuses the existing `gym_staff_read_own_members` policy (already permits any staff-role reader, including Manager/Owner, to see coach rows — no new members-table RLS needed):
    ```ts
    export async function listCoaches(): Promise<{ data: CoachRow[] | null; error: AppError | null }> {
      const supabase = await createClient();
      const { gymId, error: gymIdError } = await getCallerGymId(supabase);
      if (gymIdError || !gymId) {
        return { data: null, error: gymIdError };
      }
      const { data, error } = await supabase
        .from("members")
        .select("id, name")
        .eq("gym_id", gymId)
        .eq("role", "coach")
        .is("deactivated_at", null)
        .order("name", { ascending: true });
      if (error) {
        return { data: null, error: await mapAndLog(error) };
      }
      return { data: data ?? [], error: null };
    }
    ```
  - [x] `assignCoach(memberId: string, coachId: string)`: thin `supabase.rpc("assign_coach", { p_member_id: memberId, p_coach_id: coachId })` wrapper — same shape as `subscriptions.ts`'s `confirmRenewal()`. No pre-validation duplicated here (the RPC self-checks role/gym/existence) — matches `confirmRenewal`'s own precedent of being a thin pass-through.
  - [x] `export interface CoachAssignmentRow { id: string; coachId: string; coachName: string; startedAt: string; endedAt: string | null; }` and `getCoachAssignments(memberId: string)`: returns `{ current: CoachAssignmentRow | null; history: CoachAssignmentRow[] }` — one gym-scoped query against `coach_assignments`, embedding the coach's name (`members!coach_assignments_coach_id_fkey(name)` or the equivalent PostgREST embed syntax — verify the actual generated FK constraint name in `database.ts` after Task 1's `gen types` run, since `coach_assignments` has two FKs to `members` (`member_id`, `coach_id`) and PostgREST needs the explicit constraint name to disambiguate which one to embed), ordered `started_at desc`. Split the single fetched array into `current` (row where `ended_at is null`, if any) and `history` (all rows, including `current`, for AC #3's "all past coach assignments are queryable" — a Manager/Owner should see the active assignment as part of the same reverse-chronological list, not a separate concept).

- [x] **Task 4: `apps/dashboard/app/(dashboard)/members/actions.ts`** (modified) (AC: #1, #2, #3, #4)
  - [x] Add two thin Server Action wrappers, matching this file's existing `{ data, error }` never-throws contract:
    ```ts
    export async function assignCoach(
      input: unknown,
    ): Promise<{ data: { id: string } | null; error: AppError | null }> {
      const { t } = await getServerTranslation(await getRequestLocale());
      const parsed = assignCoachSchema.safeParse(input);
      if (!parsed.success) {
        return { data: null, error: { code: "validation_error", message: t("common.invalidInput") } };
      }
      const { data, error } = await assignCoachRow(parsed.data.memberId, parsed.data.coachId);
      if (error || !data) {
        return { data: null, error };
      }
      return { data: { id: data }, error: null };
    }

    export async function getCoachAssignments(memberId: string) {
      return getCoachAssignmentsRow(memberId);
    }
    ```
    (Import `assignCoach as assignCoachRow, getCoachAssignments as getCoachAssignmentsRow` from `@/services/coaches`, alongside this file's existing `@/services/members` imports — rename on import, matching this file's existing pattern for `deactivateMember`/`exportMembersCsv`.)
  - [x] No separate audit-log Server Action step here (unlike `createMember`'s explicit `logMemberChange` call) — `assign_coach()`'s own `log_audit_event()` call already covers AC #4 atomically inside the RPC (Scope Notes).

- [x] **Task 5: `apps/dashboard/app/(dashboard)/members/page.tsx`** (modified) (AC: #1, #2)
  - [x] Add `listCoaches()` to the existing `Promise.all([...])` alongside `listMembers`/`getDashboardShellContext`/`listPlans`; pass `coaches={coaches ?? []}` through to `MembersPageClient`, same as the existing `plans` prop. Extend the existing combined-error check to include `coachesError`.

- [x] **Task 6: `MembersPageClient.tsx` → `MemberModal.tsx`** (modified) (AC: #1, #2, #3)
  - [x] `MembersPageClient.tsx`: accept a new `coaches: CoachRow[]` prop, thread it straight into `<MemberModal coaches={coaches} .../>` alongside the existing `plans` prop — no other change to this file.
  - [x] `MemberModal.tsx`: new props `coaches: CoachRow[]`. New local state: `coachId` added to `form` (default `""`), plus `assignmentHistory: CoachAssignmentRow[]` and `loadingAssignments: boolean`.
  - [x] On open for an existing member (`editingMember` truthy, both Edit and View modes) — inside the existing `if (open && (!syncedWith.open || ...))` sync block — call the new `getCoachAssignments(editingMember.id)` Server Action, set `form.coachId` from `data.current?.coachId ?? ""` and `assignmentHistory` from `data.history`. On Create mode, `assignmentHistory` stays `[]` and `form.coachId` stays `""` — no fetch needed (no member exists yet).
  - [x] New "── Assignment ──" section, rendered **unconditionally** (not gated to `isCreate || readOnly`, unlike the Membership block — Scope Notes):
    - Coach dropdown (`<select>`, same `selectClassName` as the Plan dropdown): options built from the `coaches` prop, plus a leading placeholder (`t("members.modal.selectCoachOptional")` — this field is optional, unlike Plan). Disabled when `readOnly`. Shows the coach's name as plain read-only text (or `t("members.modal.noCoachAssigned")` if none) when `readOnly`.
    - Assignment history list below the dropdown, **View mode only** (`readOnly && assignmentHistory.length > 0`) per AC #3 — each row: coach name, started date, `t("members.modal.assignmentActive")` if `endedAt` is null else the ended date, reverse-chronological (already sorted server-side by `getCoachAssignments`). Empty state: no history section rendered at all when `assignmentHistory.length === 0` (nothing to show — do not render an explicit "no history" line; matches this modal's existing convention of omitting sections that have nothing to say, e.g. the Plan dropdown skips straight to a read-only `Input` in View mode rather than an empty-state message).
  - [x] `handleSubmit`, create-mode branch: change `const { error } = await createMember(parsed.data);` to `const { data, error } = await createMember(parsed.data);` — the current code discards `data` entirely, but `createMember` already returns `{ data: { id: string } | null; error }` (see `actions.ts`), and the new member's id is required below for the create-mode `assignCoach` call.
  - [x] After the existing `createMember`/`editMember` call succeeds, if `form.coachId` is non-empty **and differs from the coach the modal opened with** (create mode: any non-empty selection; edit mode: differs from `assignmentHistory`'s `current?.coachId`), call `assignCoach({ memberId: <new member's `data.id` in create mode, or `editingMember.id` in edit mode>, coachId: form.coachId })`. On `assignCoach` failure, do **not** fail the whole save (the member record itself already saved successfully) — call `onSaved(error.message)` the same way the existing `audit_log_failed` branches already do (a warning toast, not a blocking error), matching this file's established "partial success" precedent. On success, call `onSaved()` as normal.
  - [x] Do not add a coach dropdown "clear selection" affordance beyond the initial empty placeholder — no AC asks for an unassign flow (Scope Notes).

- [x] **Task 7: i18n** (AC: #1, #2, #3)
  - [x] New keys under `members.modal` in `apps/dashboard/locales/en.json`/`fr.json`: `assignedCoach` ("Assigned Coach"), `selectCoachOptional` ("No coach assigned"), `noCoachAssigned` ("—" or "No coach assigned", read-only display), `assignmentHistoryTitle` ("Coach Assignment History"), `assignmentActive` ("Current"), `assignmentStarted` ("Started {{date}}"), `assignmentEnded` ("Ended {{date}}"). Reuse `common.invalidInput`/`common.somethingWentWrong` for error fallbacks — do not create a third generic-error key.
  - [x] Verify via `node scripts/check-i18n-key-parity.mjs`.

- [x] **Task 8: `docs/decisions.md` entry** (AC: all)
  - [x] Dated entry recording: (1) `coach_assignments` has the standard full-CRUD grant to `authenticated` (mirroring `job_runs`' actual grant shape) but no RLS write policy at all — `assign_coach()` is the sole practical write path, unlike `members`'/`subscriptions`' (which both have direct RLS write policies *and* an RPC); (2) **the coach-account-creation gap** — no story in Epic 5 (5.1/5.2/5.3, per epics.md) builds a UI to create a `members` row with `role = 'coach'`; V1 pilot coaches are assumed provisioned directly via Supabase, same out-of-band mechanism as founder-assisted gym onboarding (FR-007); flag this explicitly as a known gap for whoever plans Epic 5's follow-up or a V1.5 "staff management" epic; (3) no "unassign coach" operation exists — cut, no AC requires it, matches Story 4.8's own "Last Payment column" precedent for documented, deliberate scope cuts; (4) `gym_staff_read_own_members`/`gym_staff_read_own_subscriptions` are untouched by this story — narrowing them for FR-022 is explicitly Story 5.2's job.

- [x] **Task 9: pgTAP coverage — `supabase/tests/coach_member_assignment.test.sql`** (new file) (AC: all)
  - [x] Mirror `member_management_rls.test.sql`'s fixture-seeding/session-simulation conventions (`set local role authenticated` + `set_config('request.jwt.claims', ...)` per simulated session).
  - [x] Seed: two gyms (A, B), each with an owner, manager, receptionist, two coaches, and two members.
  - [x] `assign_coach()` as Owner/Manager on a member with no current coach: new `coach_assignments` row created, `ended_at is null`, `log_audit_event` produced an `audit_log` row with `action_type = 'coach_assigned'`.
  - [x] `assign_coach()` again on the same member with a different coach: the prior row now has `ended_at is not null` (not deleted — assert the row count for that member is 2, not 1), the new row is active, `audit_log` row has `action_type = 'coach_reassigned'` with `metadata.previous_coach_id` matching the first coach.
  - [x] `assign_coach()` as Receptionist: rejected (`throws_like '%permission denied%'`).
  - [x] `assign_coach()` targeting a member/coach id from Gym B while authenticated as a Gym A owner: rejected with the uniform not-found message, not a distinguishable "wrong gym" error (tenant-isolation-enumeration-avoidance check, same style as `renew_subscription`'s own test coverage).
  - [x] `assign_coach()` with `p_coach_id` pointing at a `members` row whose `role` is `'member'` (not `'coach'`): rejected (`assign_coach: coach % not found`).
  - [x] Partial unique index: attempting a raw `insert into coach_assignments (...) values (..., ended_at => null)` for a member that already has an active assignment (bypassing the function, as `service_role`) raises a unique-violation — confirms `idx_coach_assignments_active_member` is the real backstop, not just `assign_coach()`'s own end-then-insert ordering.
  - [x] `manager_or_owner_read_own_coach_assignments`: Owner/Manager can SELECT a Gym A member's assignment history; Receptionist/Coach sessions get zero rows (no SELECT policy covers them yet — Story 5.2's job); a Gym B session sees zero rows for a Gym A member (tenant isolation).
  - [x] Write-path deny-all shape: a direct `insert into coach_assignments (...)` as `authenticated` (bypassing `assign_coach()`) raises a "row-level security" error (INSERT's implicit `WITH CHECK false`, not a "permission denied for table" grant-level error) — confirms the full-CRUD-grant-plus-zero-write-policy shape (mirroring `job_runs`) produces the RLS-flavored error every other table's INSERT-denial test expects. A direct `update`/`delete` on the same table, by contrast, is silently filtered to 0 affected rows with no error, matching `rls_tenant_isolation.test.sql`'s own write-path deny-all assertions for UPDATE/DELETE.
  - [x] Add the cross-gym `assign_coach()` assertion to `rls_tenant_isolation.test.sql` too if that file is this codebase's established canonical home for such checks (Story 4.8's Task 10 set this precedent of checking first — its own `docs/decisions.md` entry explains why it kept the assertion local instead; follow whichever you decide and document it in Task 8's entry, matching that precedent).

- [x] **Task 10: Validation and manual verification**
  - [x] `pnpm run typecheck` (all packages) — 0 errors. `node scripts/check-i18n-key-parity.mjs` — 0 errors.
  - [x] `supabase test db` (WSL shell) — zero regressions against the pre-story baseline plus this story's new file.
  - [x] Hands-on (WSL-only Supabase convention, per Dev Notes): seed two `members` rows with `role = 'coach'` directly via SQL (since no UI creates them, per Scope Notes), then as Owner: open the Add Member modal, confirm the Assigned Coach dropdown lists both seeded coaches, create a member with a coach assigned, confirm the assignment saved (verify via SQL: `coach_assignments` row exists, `ended_at is null`). Edit that member and reassign to the second coach; confirm via SQL that the first assignment row now has `ended_at` set and a second active row exists. Open the member in View mode (as Receptionist or via the row-click View action) and confirm the Assignment History section shows both rows, correctly ordered, with the ended one showing its end date and the active one marked current. Confirm the Audit Log page shows both `coach_assigned` and `coach_reassigned` entries with the correct actor/member/timestamp.

### Review Findings

- [x] [Review][Patch] AC #3 assignment history is unreachable for any user — Manager/Owner never enters View mode (`MembersPageClient.tsx`'s `setModalState({ member, readOnly: !canManage })` means `readOnly` is always `false` for `canManage` sessions, so they only ever get Edit mode), while the history block is gated to `readOnly` only (`MemberModal.tsx:566`). Receptionist does reach `readOnly === true` but is always handed an empty `assignmentHistory` by RLS (`manager_or_owner_read_own_coach_assignments` restricts SELECT to manager/owner). These two populations are disjoint, so a populated history is never displayed to anyone. Contradicts the story's own Scope Notes ("Manager/Owner also see it in Edit mode"). Fix: change the gate at `MemberModal.tsx:566` from `readOnly && assignmentHistory.length > 0` to `!isCreate && assignmentHistory.length > 0`. [MemberModal.tsx:566] — fixed.
- [x] [Review][Patch] Deactivated coaches break the assigned-coach display: the read-only Input at `MemberModal.tsx:545` looks up the coach's name via `coaches.find((c) => c.id === form.coachId)?.name`, but `coaches` comes from `listCoaches()` which filters `deactivated_at is null`. If a member's assigned coach is later deactivated, this silently falls back to "No coach assigned" even though `assignmentHistory`'s current row already has the correct `coachName`. Fix: source the display name from the fetched `current`/`assignmentHistory` row instead of `coaches.find()`. [MemberModal.tsx:545] — fixed.
- [x] [Review][Patch] `coachNotFoundError` in `services/coaches.ts:11` reuses the `members.errors.memberNotFound` i18n key for coach-domain failures (e.g. no gym_id claim), breaking the sibling-file convention where every other service defines its own domain-specific not-found key (`plans.ts` → `plans.errors.planNotFound`, `gym-settings.ts` → `settings.errors.gymNotFound`). Fix: add a `coaches.errors.coachNotFound`-style key to en.json/fr.json and use it. [apps/dashboard/services/coaches.ts:11] — fixed: added `members.errors.coachNotFound` (kept in the existing `members` i18n namespace, matching Task 7's own choice to put coach-assignment keys under `members.modal.*` rather than a new top-level `coaches` namespace).
- [x] [Review][Patch] `getCoachAssignments` server action (`actions.ts:220`) takes a raw `memberId: string` with no format validation, unlike `assignCoach`'s zod-validated path in the same file — inconsistent input-validation discipline (low risk since the query is gym-scoped and parameterized, but worth aligning with the file's own convention). [apps/dashboard/app/(dashboard)/members/actions.ts:220] — fixed: now validated via `assignCoachSchema.shape.memberId.safeParse`.
- [x] [Review][Patch] `services/coaches.ts:142`'s `getCoachAssignments` uses an `as unknown as CoachAssignmentRowFromDb[]` cast on the Supabase embed result rather than a type-safe mapping, bypassing compile-time verification that the `members!coach_assignments_coach_id_fkey(name)` embed actually returns a singular object rather than an array. [apps/dashboard/services/coaches.ts:142] — fixed: `CoachAssignmentRowFromDb.members` now types both the object and array embed shapes, and `toCoachAssignmentRow` normalizes defensively instead of assuming one shape away.
- [x] [Review][Defer] Concurrent reassignment race: two simultaneous `assign_coach()` calls could both pass the "no active row" check under READ COMMITTED and then collide on `idx_coach_assignments_active_member` during INSERT, surfacing an unmapped Postgres unique-violation error instead of a friendly message. Mirrors `renew_subscription()`'s identical pre-existing shape (no advisory lock) — an inherited codebase-wide design pattern, not something newly introduced by this diff. — deferred, pre-existing

## Dev Notes

- **Read before starting:** `apps/dashboard/app/(dashboard)/members/components/MemberModal.tsx` (in full — this story's main UI surface), `apps/dashboard/services/members.ts` (`getCallerGymId`/`listMembers` patterns to copy), `apps/dashboard/services/plans.ts` (`listPlans`'s exact shape — `listCoaches` mirrors it), `supabase/migrations/0022_manual_renewal_reset.sql` (`renew_subscription()` — the exact structural template `assign_coach()` follows: role check → gym-scoped lookup with uniform not-found → write → embedded audit log), `supabase/migrations/0018_member_management.sql` (existing `members`/`subscriptions` RLS this story's new table sits alongside, and the "harmless today, revisit in Epic 5" comment this story does NOT resolve), `supabase/migrations/0008_job_runs.sql` (the full-CRUD-grant-but-zero-write-policy deny-all table shape `coach_assignments` follows).
- **This project's local Supabase stack runs inside WSL2, not native Windows** — `supabase db reset`/`supabase test db`/`supabase gen types` must run from a WSL shell. [Memory: Supabase runs in WSL — confirmed working as of Story 4.8's session.]
- **Testing standard:** pgTAP is the primary automated coverage (Task 9). No E2E/browser automation exists in V1 — Task 10's hands-on pass is the only way to verify the actual modal UI, and it requires manually seeding coach rows first since no UI creates them (Scope Notes).
- **Do not build:** a Coach Portal route (`/coach` pages — Story 5.2/5.3), a coach-account-creation UI, an "unassign coach" action, or any change to `gym_staff_read_own_members`/`gym_staff_read_own_subscriptions` (Scope Notes).
- **`apps/mobile` and `apps/super-admin` are untouched by this story.**

### Project Structure Notes

- File layout to create/modify:
  ```
  supabase/migrations/0039_coach_member_assignment.sql                        (new)
  supabase/tests/coach_member_assignment.test.sql                             (new)
  packages/types/src/schemas/coachAssignment.ts                               (new)
  packages/types/src/index.ts                                                 (modified — export new schema file)
  packages/types/src/database.ts                                              (regenerated)
  apps/dashboard/services/coaches.ts                                          (new)
  apps/dashboard/app/(dashboard)/members/actions.ts                           (modified — assignCoach, getCoachAssignments)
  apps/dashboard/app/(dashboard)/members/page.tsx                             (modified — listCoaches() added to Promise.all)
  apps/dashboard/app/(dashboard)/members/components/MembersPageClient.tsx     (modified — thread coaches prop)
  apps/dashboard/app/(dashboard)/members/components/MemberModal.tsx           (modified — Assignment section, coach dropdown, history list)
  apps/dashboard/locales/en.json                                              (modified)
  apps/dashboard/locales/fr.json                                              (modified)
  docs/decisions.md                                                           (modified)
  ```
  - `apps/dashboard/components/shared/Sidebar.tsx` is **not** in this list — the `/coach` nav entry already exists (Story 1.8), and this story doesn't touch coach-side routing.
  - No new route/page is created — this story is entirely additive to the existing Members page and its modal.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.1] — literal AC text and user story
- [Source: _bmad-output/planning-artifacts/epics.md#FR-055] — coach assignment/reassignment rules: at most one active coach per member, reassignment ends prior with `ended_at` (not delete), prior coach's notes stay visible to Owner/Manager only, history queryable
- [Source: _bmad-output/planning-artifacts/epics.md#FR-080] — audit-logged actions include coach assignment changes, with actor/target/timestamp
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md lines 996–1032] — AD-05 Member Create/Edit mockup: "── Assignment ──" section, "Assigned Coach [dropdown of gym coaches]", "Coach dropdown: only users with Coach role in this gym"
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md lines 983, 986] — Member profile's Subscription tab shows assigned coach; Coach Notes tab visibility rule (Manager/Owner see all, assigned Coach sees only their own) — the FR-055/AC #2 rule this story's `ended_at`-preserving design must not break for Story 5.3
- [Source: _bmad-output/planning-artifacts/architecture.md line 218] — Postgres RPC naming convention (`snake_case verb_noun`, e.g. `renew_subscription()`) — `assign_coach()` follows this
- [Source: _bmad-output/planning-artifacts/architecture.md line 245] — Server Actions/service functions never throw for expected errors; return `{ data, error }`
- [Source: supabase/migrations/0001_extensions_and_enums.sql line 10] — `member_role` enum already includes `'coach'`
- [Source: supabase/migrations/0003_members_and_users.sql] — `members`/`users` table shapes; `idx_members_active_gym_user`'s partial-unique-index precedent this story's `idx_coach_assignments_active_member` mirrors
- [Source: supabase/migrations/0018_member_management.sql lines 150–256] — `gym_staff_read_own_members`/`gym_staff_read_own_subscriptions` RLS and their own "revisit in Epic 5" comment (lines 163–166); `manager_or_owner_insert_own_members`'s explicit per-action-policy shape
- [Source: supabase/migrations/0007_audit_log.sql lines 111–214] — `log_audit_event()` signature and actor-derivation behavior; `action_type` is free text, no enum change needed
- [Source: supabase/migrations/0022_manual_renewal_reset.sql] — `renew_subscription()`: the structural template for `assign_coach()` (role check, gym-scoped uniform-not-found lookup, write, embedded audit log, `SECURITY DEFINER` + self-checked role instead of a widened RLS policy)
- [Source: supabase/migrations/0008_job_runs.sql] — the full-CRUD-grant-but-zero-write-policy deny-all table shape `coach_assignments` follows (RLS enabled, no INSERT/UPDATE/DELETE policy for `authenticated`, sole writer is a `SECURITY DEFINER` function unaffected by grants)
- [Source: apps/dashboard/services/members.ts] — `getCallerGymId`, `memberNotFoundError`-style per-file error helper conventions `coaches.ts` copies
- [Source: apps/dashboard/services/plans.ts lines 75–93] — `listPlans()`'s exact shape, the closest precedent for `listCoaches()`
- [Source: apps/dashboard/app/(dashboard)/members/components/MemberModal.tsx] — current Create/Edit/View mode structure, the exact "Create mode shows the full AD-05 form minus Assigned Coach (Scope Note #5, no backing table yet)" comment this story resolves, `audit_log_failed`-style partial-success `onSaved(warning)` pattern this story's `assignCoach` failure path reuses
- [Source: apps/dashboard/app/(dashboard)/members/components/MembersPageClient.tsx lines 31, 84, 87, 145] — `CAN_MANAGE = ["manager", "owner"]`, `readOnly = !canManage` — confirms the coach dropdown is naturally non-interactive for Receptionist sessions with no new role prop needed
- [Source: apps/dashboard/app/(dashboard)/members/page.tsx] — `Promise.all([listMembers, getDashboardShellContext, listPlans])` pattern `listCoaches()` joins
- [Source: apps/dashboard/services/session.ts] — `mapAndLog`, `MemberRole` type
- [Source: packages/types/src/schemas/member.ts] — per-file Zod schema/const conventions (`e164Phone`, `REASON_MIN_LENGTH`-style locals) `coachAssignment.ts` follows structurally (though this schema needs none of those specific constants)
- [Source: packages/types/src/errors.ts lines 157–164, 173–213] — `renew_subscription:`/`confirm_renewal:` prefixed raise-message mapping convention; `assign_coach:`-prefixed messages should be mapped the same way if/when a friendlier error copy is warranted (the RPC's bare `'permission denied'` and `not found` messages already fall through to this file's existing generic mappings — check whether those existing catch-alls are sufficient before adding new ones)
- [Source: _bmad-output/implementation-artifacts/4-8-subscriptions-page-manual-renewal.md] — most recent prior story; established this project's current story-file conventions (Scope Notes format, literal-AC-citation Task format, `docs/decisions.md` entry discipline, WSL Supabase note) that this story follows

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5), via `bmad-dev-story`.

### Debug Log References

- `supabase db reset` (WSL) — applied `0039_coach_member_assignment.sql` cleanly against all prior migrations.
- `supabase gen types typescript --local` (WSL) — regenerated `packages/types/src/database.ts`; diff limited to the new `coach_assignments` table and `assign_coach` function, as expected.
- `supabase test db` (WSL) — full suite: `Files=32, Tests=567, Result: PASS` (zero regressions). New file alone: `Tests=26, Result: PASS`.
- First `coach_member_assignment.test.sql` run caught a real bug in test (i): `throws_ok(sql, errcode, description)` isn't a valid 3-arg overload in this codebase's pgTAP usage — the 3rd positional arg is compared as the *exact expected error message*, not a description, so it failed against the real message text. Switched to `throws_like` (pattern match), matching every other test file's own convention.
- Same run caught a design/test error in the "write-grant uniformity" assertion (k): a direct `authenticated` INSERT into a deny-all RLS table always raises a real "row-level security" error (`WITH CHECK`'s implicit `false` — INSERT has no existing row to filter against), regardless of grant shape — it is not silently filtered to 0 rows the way UPDATE/DELETE/SELECT are. Corrected the test (split into an INSERT `throws_like('%row-level security%')` assertion plus a separate UPDATE 0-rows assertion) and corrected the same overstated claim in the migration comment, the story's Scope Notes, and `docs/decisions.md` — the real reason to prefer the full-CRUD grant over SELECT-only is that it produces the RLS-flavored INSERT error every other table's INSERT-denial test in this codebase expects, not a bare grant-level "permission denied for table" error.
- `pnpm run typecheck` (all 4 packages): 0 errors.
- `node scripts/check-i18n-key-parity.mjs`: 0 errors (4 locale dirs, all in parity).
- `npx eslint .` in `apps/dashboard`: `MemberModal.tsx` clean. 4 pre-existing errors remain in 2 files this story does not touch (`RecordRefundModal.tsx`, `RenewalModal.tsx`) — confirmed via `git status` these are untouched baseline issues, not introduced here. (Root `pnpm run lint` fails outright on `apps/mobile` — `eslint` not resolvable from this native Windows shell for that package, a pre-existing environment issue unrelated to this story; `apps/mobile` is untouched per Dev Notes.)
- `pnpm --filter @gymos/dashboard build` (production Next.js build): succeeded, all routes compiled including `/members`.
- Hands-on manual click-through (Task 10's 3rd bullet) was **not** performed — no dev server was launched/driven in a browser this session. Verified instead via: direct DB inspection (`assign_coach` exists as `SECURITY DEFINER`, `coach_assignments` table exists), the full pgTAP suite exercising every RPC/RLS path an actual click-through would exercise, and a clean production build. Flagging this gap explicitly rather than claiming a manual pass that didn't happen.

### Completion Notes List

- Implemented all 4 ACs: coach assignment (AC #1), reassignment with `ended_at`-preserving history (AC #2), queryable assignment history (AC #3), and audit logging via the RPC's embedded `log_audit_event()` call (AC #4).
- During `bmad-create-story:validate` (prior session), 4 issues were found and fixed in the story file before implementation began: a migration-number collision (`0038` was already claimed by Story 4.9; renumbered to `0039`), a mischaracterized grant-shape precedent (`job_runs` actually grants full CRUD, not SELECT-only), a missing `data.id` capture in `MemberModal`'s create-mode `handleSubmit`, and an added pgTAP write-grant assertion. During actual implementation, a second, more precise correction was needed on top of that first one: INSERT under RLS deny-all always raises an error regardless of grant shape (unlike UPDATE/DELETE/SELECT, which are silently filtered) — see Debug Log above.
- `assign_coach()`'s bare `'permission denied'`/`not found` raise messages were deliberately left unmapped in `packages/types/src/errors.ts` (per the story's own Dev Notes) — they fall through to the existing generic `unknown` catch-all, which was verified by reading `mapSupabaseError`'s full fallback path.
- Coach-role `members` rows must be seeded directly via Supabase (Studio/SQL) for manual testing — no UI creates them (by design, this story's own explicit scope cut, recorded in `docs/decisions.md`).

### File List

**New:**
- `supabase/migrations/0039_coach_member_assignment.sql`
- `supabase/tests/coach_member_assignment.test.sql`
- `packages/types/src/schemas/coachAssignment.ts`
- `apps/dashboard/services/coaches.ts`

**Modified:**
- `packages/types/src/index.ts`
- `packages/types/src/database.ts` (regenerated)
- `apps/dashboard/app/(dashboard)/members/actions.ts`
- `apps/dashboard/app/(dashboard)/members/page.tsx`
- `apps/dashboard/app/(dashboard)/members/components/MembersPageClient.tsx`
- `apps/dashboard/app/(dashboard)/members/components/MemberModal.tsx`
- `apps/dashboard/locales/en.json`
- `apps/dashboard/locales/fr.json`
- `docs/decisions.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
