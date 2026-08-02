---
baseline_commit: e4619de
---

# Story 5.3: Coach Portal — Member Detail & Session Notes

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Coach,
I want to view a client's profile and add session notes,
so that I can track their progress across sessions.

## Scope Notes — Read Before the Acceptance Criteria

**This story builds AD-15, the last unbuilt Coach Portal route, completing Epic 5's FR-054.** Story 5.2 built AD-14 (`/coach`, the assigned member list) and explicitly deferred this route: its own file-list comment reads "the member-detail route `coach/[memberId]/page.tsx` (AD-15) and its `actions.ts` (`addSessionNote`) belong to Story 5.3 — do not build them here." Story 5.2's list rows are currently rendered as static, non-interactive `<tr>` elements with a comment: "Story 5.3 (AD-15 detail route) makes this clickable once `/coach/[memberId]` exists." **This story must make that row a real link** (`apps/dashboard/app/(dashboard)/coach/components/CoachPortalPageClient.tsx`, modified — the one existing-file change this story makes outside its own new `[memberId]/` subtree).

**This is the first dynamic-segment (`[param]`) route anywhere in `apps/dashboard`.** Every prior page in this app (`members`, `subscriptions`, `payments`, `attendance`, `coach`) is a flat, non-parameterized route. This app runs Next.js 16 with `cacheComponents: true` (same as every other page here) — `params` is a `Promise`, exactly like `searchParams` already is on `coach/page.tsx` and every other dashboard page; do not destructure `params` synchronously.

**`private.is_assigned_coach(p_member_id uuid)` (0040, Story 5.2) is this story's foundation — reuse it, do not duplicate its logic.** It already answers "is the calling coach currently assigned to this member" with the correct `SECURITY DEFINER` bypass of `coach_assignments`'/`members`' own RLS. Every new RLS policy and RPC in this story that needs that same check calls this existing function; do not write a second, parallel version of it.

**Read this before designing `session_notes`' authorship check — the identical RLS-blocking-its-own-helper bug from Story 5.2 recurs here in a new spot.** A note's author is `session_notes.coach_id` (a `members.id`, the same shape `coach_assignments.coach_id` uses). To check "is this note mine," a caller needs to compare `coach_id` against their own identity (`auth.uid()`) — which means reading their own row in `members` by `user_id`. **A coach currently has *no* SELECT access to their own `members` row**: Story 5.2 narrowed `gym_staff_read_own_members` to exclude `'coach'`, and the new `coach_read_assigned_members` policy only grants visibility into *assigned members*, never the coach's own row (a coach is not their own assigned client). So a plain correlated subquery — `exists (select 1 from members m where m.id = session_notes.coach_id and m.user_id = auth.uid())` written directly inside a `session_notes` RLS policy — silently returns **false for every coach, always**, for the exact reason Story 5.2's Scope Notes documented for `coach_assignments`: the subquery's own read of `members` is itself blocked by `members`' RLS for the calling coach session. **The fix is the same pattern Story 5.2 established: a second `private`-schema `SECURITY DEFINER` `STABLE` helper.** Add `private.is_own_coach_id(p_coach_id uuid)` (mirrors `is_assigned_coach`'s exact shape — table read, `SECURITY DEFINER`, explicit `revoke ... from public; grant ... to authenticated`) that resolves "does `p_coach_id` belong to the calling user" by bypassing RLS internally, the same way `is_assigned_coach` bypasses it to resolve assignment. Use this helper in the SELECT policy (Task 1); the two write RPCs (below) don't need it, since they resolve the caller's own `coach_id` a different way (see next paragraph).

**Writes go through two new `SECURITY DEFINER` RPCs, not direct RLS INSERT/UPDATE policies — deliberately different from `refunds`' (0033) direct-RLS-`with check` pattern, matching `assign_coach()`'s (0039) RPC pattern instead.** The reason: `add_session_note` must resolve the caller's own `coach_id` *and* their currently-active `coach_assignments` row for this member entirely server-side (never trust a client-supplied `coach_assignment_id` or `coach_id` — the same "never let the client supply an ID the server can independently derive" discipline `confirm_renewal`/`renew_subscription` already follow for dates and amounts). Doing that resolution inside a plain RLS `with check` clause hits the identical subquery-blocked-by-RLS problem described above, this time against `coach_assignments` (which a coach has zero direct SELECT access to at all, per 0039 — only `manager`/`owner` do). A `SECURITY DEFINER` function sidesteps this cleanly by resolving both lookups with the function owner's privileges, exactly like `assign_coach()` already does for `coach_assignments` writes. `session_notes` still gets the standard baseline `grant select, insert, update, delete to authenticated, service_role` (this codebase's universal convention — RLS denies, grants don't), but **no INSERT/UPDATE policy is ever added for `authenticated`** — same "RPC is the only real write path, PostgREST direct-write attempts get RLS-denied" shape `coach_assignments` (0039) already established. Do not add an INSERT/UPDATE policy "for completeness"; it would be dead code at best and a second, divergent copy of the authorization logic at worst.

**No audit log entry for adding or editing a session note.** FR-080's action-type list (audit-logged: manual payment entries, verifications, refunds, member deactivations, coach assignment changes, Super Admin escalations, pg_cron job failures) does not include session notes — unlike `assign_coach()`, neither `add_session_note()` nor `edit_session_note()` calls `log_audit_event()`. Do not add one; it would be scope creep against an explicit, enumerated FR.

**Resolving a genuine spec tension — read this before writing any RLS or the RPCs' visibility behavior, this is the single highest-risk decision in this story.** Two different sources disagree about whether a *new* coach can see a *prior* coach's session notes on a reassigned member:
- **FR-055** (epics.md §6.11): "reassignment ends the prior assignment with `ended_at`; **prior coach's notes stay visible to Owner/Manager only, not the new coach**."
- **Story 5.1's own AC #2** (already implemented, epics.md): "...the previous assignment is ended... and **the previous coach's session notes remain visible to Owner/Manager only — not to the new coach**." (Session notes didn't exist yet when 5.1 shipped — this table is what that AC was written *for*.)
- **This story's own AC #4** (below), read most literally: "Given a note authored by a different coach (from a prior assignment), when I view the notes list, then I cannot edit it (Owner/Manager can view all coaches' notes; I see only my own for editing)" — phrased as though the note *appears in the list* and only editing is blocked.

These two readings are incompatible: one says the new coach never sees the note at all; the other implies it's visible but not editable. **Resolution: follow FR-055 and Story 5.1's AC #2 — both explicit, both stated twice, both about the specific privacy-sensitive case of client notes surviving a staff change.** Implement `session_notes` SELECT for the `coach` role scoped to **currently-assigned member AND self-authored only** (`is_assigned_coach(member_id) AND private.is_own_coach_id(coach_id)`) — not "any note on an assigned member." Under this design, AC #4's literal scenario (a coach viewing a note some other coach wrote) never arises in the Coach Portal UI at all, because RLS never returns that row to them in the first place — which is a stronger, simpler guarantee than "visible but not editable," and it's also cheaper to build correctly (the edit-permission check on the client becomes unconditional: every note a coach's query ever returns is by construction editable by them, so `CoachMemberDetailPageClient.tsx` never needs a per-note "is this mine" branch at all). Add a `manager_or_owner_read_own_session_notes` SELECT policy (mirrors `manager_or_owner_read_own_coach_assignments`, 0039) so Owner/Manager have the FR-055-required full-visibility data-layer access, even though this story builds no Owner/Manager-facing notes UI for it (same "RLS ahead of UI" precedent 5.1/5.2 both already set for `coach_assignments`). Record this resolution in `docs/decisions.md` (Task 8) — this is a real, debatable design call with a documented trade-off, not an obvious reading, and a future story building an Owner/Manager notes view needs to know this is why a coach's own query never surfaces predecessor notes.

**The AD-15 mockup's "amber info bar" only defines an `expired` variant — do not build an `expiring_soon` variant despite Flow 5's narrative example showing one.** The component spec itself (EXPERIENCE.md lines 1368–1369) says: `[Amber info bar — shown if expired]` / "This member's membership has expired. Contact your receptionist." The narrative walkthrough (Flow 5, line 1996) shows Fatima opening a member with status "Expirant bientôt" (`expiring_soon`) and seeing an amber bar reading "L'abonnement de Marc expire bientôt..." — a second, undocumented variant with different copy that appears nowhere in the actual AD-15 component spec, and no AC in this story mentions an info bar at all. Treat the component spec (the literal, authoritative UI definition) as controlling over the narrative flow (an illustrative example that drifted from it) — build only the `expired` variant, matching AD-15's own text exactly. Do not invent an `expiring_soon` copy string to reconcile the two; that would be adding scope no document actually specifies precisely.

**Contact info = phone only, not email/DOB/emergency contact.** AC #1 says "contact info" generically; the AD-15 mockup (line 1365) is specific: `Phone: [number]`. Same resolution precedent as Story 5.2's "Last note column" cut — when a specific mockup and a vague AC wording could be read two ways, the mockup wins. Do not add email/emergency-contact fields to the header; `members.email`/`members.emergency_contact` stay unused by this story.

**No character-limit UI component to build — `RenewalModal.tsx`'s plain `<textarea>` + character-count pattern is the template, not a new shadcn primitive.** This app has no `components/ui/textarea.tsx` yet, but AD-15's "auto-expands; character count shown" is already solved once in this codebase: `RenewalModal.tsx`'s Note field is a raw `<textarea>` (Tailwind classes matching `Input`'s styling, no shadcn wrapper) with `<p className="text-xs text-muted-foreground">{t("...noteCount", { count: note.length })}</p>` beneath it. Copy that exact pattern (per-file copy, this app's established convention) for both the add-note and edit-note textareas; do not add a new shared UI primitive for this.

**`goal`/`experience_level` have never been rendered anywhere in `apps/dashboard` before this story.** They're written once, during mobile onboarding (Story 2.7, `members.goal`/`members.experience_level`, both nullable free-form `text` columns with no DB-level enum/CHECK constraint — `0020_member_goal_experience_plan_confirmation.sql`'s own comment: "No CHECK constraint on goal/experience_level's values -- mirrors the [mobile app's client-side-only validation] precedent"). The 4 goal values (`lose_weight`, `build_muscle`, `improve_fitness`, `general_wellness`) and 3 experience values (`beginner`, `intermediate`, `advanced`) are fixed by `packages/types/src/schemas/memberOnboarding.ts`'s `memberGoalSchema`/`experienceLevelSchema` Zod enums — reuse those exact value strings for the label-lookup maps (Task 6), but **do not import the mobile app's locale strings** (`apps/mobile/src/locales/*.json`) — architecture.md's explicit rule: "shared admin-surface locale strings (mobile locales stay separate — different vocabulary/onboarding flow)." Write fresh `apps/dashboard/locales/{en,fr}.json` keys with matching English/French wording (mobile's own EN strings: "Lose Weight" / "Build Muscle" / "Improve Fitness" / "General Wellness" / "Beginner" / "Intermediate" / "Advanced" — same words, new keys, new file). A member's `goal`/`experience_level` can be `null` (member onboarded before Story 2.7 shipped, or the column was never set) — render a "Not set" fallback, don't crash or show a blank label.

**No pagination or infinite scroll on the notes list.** No AC or mockup element calls for it — a single member's session-note history over a pilot-scale gym's lifetime is small. Render the full reverse-chronological list in one query, matching `listAssignedMembers()`'s (5.2) own "no pagination, pilot scale" precedent.

**No route-level role guard beyond `(dashboard)/layout.tsx`'s existing gym-staff gate** — identical "Sidebar hides it, RLS is the real gate" precedent every other page in this app already documents on itself. A non-Coach role reaching `/coach/[memberId]` directly isn't blocked by this story; for Owner/Manager specifically, `gym_staff_read_own_members`/`gym_staff_read_own_subscriptions` still include those roles (unchanged by 0040), so they'd see any member's detail data if they navigated here directly — same accepted-gap shape as `/subscriptions`, `/coach`, `/members`, `/attendance`.

## Acceptance Criteria

1. **Given** an assigned member's detail view, **when** I open it, **then** I see name, plan, subscription status, contact info, goal, and experience level (set during their onboarding). [Source: epics.md#Story 5.3 AC#1; FR-054] (Note: "contact info" = phone, per the AD-15 mockup — see Scope Notes. A member not assigned to the calling coach yields no data, per Story 5.2 AC#3's own note that this route inherits its RLS narrowing — see AC below.)
2. **Given** the session notes section, **when** I add a note, **then** it saves with my name and a timestamp and appears at the top of the list. [Source: epics.md#Story 5.3 AC#2; FR-054]
3. **Given** a note I authored, **when** I edit it, **then** the change saves and shows "Edited [timestamp]". [Source: epics.md#Story 5.3 AC#3; FR-054]
4. **Given** a note authored by a different coach (from a prior assignment), **when** I view the notes list, **then** I cannot edit it (Owner/Manager can view all coaches' notes; I see only my own for editing). [Source: epics.md#Story 5.3 AC#4; FR-055] (Note: implemented via RLS scoping a coach's own query to self-authored notes only on a currently-assigned member — see Scope Notes' "genuine spec tension" resolution. A coach's notes list, by construction, never contains another coach's note, so every note rendered is inherently editable by its viewer; there is no "visible but greyed-out Edit button" state to build. Owner/Manager's full-visibility access exists at the RLS layer per FR-055 even though no Owner/Manager UI consumes it in this story.)

**Implicit AC, inherited from Story 5.2 AC#3's own note:** a member not assigned to the calling coach (or that doesn't exist, or belongs to another gym) must not be reachable via direct URL — `/coach/[memberId]` for an unassigned member returns a not-found state, not a data leak or a crash. [Source: _bmad-output/implementation-artifacts/5-2-coach-portal-assigned-member-list.md AC#3's own note: "'detail view' is AD-15/Story 5.3's route... this story's obligation is that the list and its search never surface an unassigned member, and that the RLS narrowing this story ships is what Story 5.3's detail route will also depend on."]

## Tasks / Subtasks

- [x] **Task 1: Migration `0041_coach_portal_member_detail_session_notes.sql`** (AC: all)
  - [x] `session_notes` table:
    ```sql
    create table session_notes (
      id uuid primary key default gen_random_uuid(),
      gym_id uuid not null references gyms(id),
      member_id uuid not null references members(id),
      coach_id uuid not null references members(id),
      coach_assignment_id uuid not null references coach_assignments(id),
      note_text text not null,
      created_at timestamptz not null default now(),
      edited_at timestamptz,
      constraint session_notes_note_text_not_blank check (char_length(btrim(note_text)) > 0)
    );

    create index idx_session_notes_gym_id on session_notes(gym_id);
    create index idx_session_notes_member_id on session_notes(member_id);
    create index idx_session_notes_coach_id on session_notes(coach_id);

    alter table session_notes enable row level security;

    grant select, insert, update, delete on session_notes to authenticated, service_role;
    ```
    `coach_assignment_id` (not just `coach_id`/`member_id`) matches architecture.md's ER note verbatim: "`session_notes` -- authored by a coach, scoped to a coach_assignment." No `on delete` clause on either FK (matches this codebase's already-accepted gap, same as `coach_assignments`' own FKs).
  - [x] `private.is_own_coach_id(p_coach_id uuid)` — second `SECURITY DEFINER` helper, exact same shape/justification as `private.is_assigned_coach` (0040) but answering "is this `members.id` mine," not "am I assigned to this member" (Scope Notes — read that section before writing this):
    ```sql
    create function private.is_own_coach_id(p_coach_id uuid)
    returns boolean
    language sql
    stable
    security definer
    set search_path = public
    as $$
      select exists (
        select 1 from members m
        where m.id = p_coach_id and m.user_id = auth.uid()
      );
    $$;

    revoke execute on function private.is_own_coach_id from public;
    grant execute on function private.is_own_coach_id to authenticated;
    ```
  - [x] SELECT policies (coach: currently-assigned + self-authored only; owner/manager: full gym visibility — Scope Notes' spec-tension resolution):
    ```sql
    create policy "coach_read_own_session_notes" on session_notes
      for select
      using (
        gym_id = private.gym_id()
        and (auth.jwt() ->> 'app_role') = 'coach'
        and private.is_assigned_coach(member_id)
        and private.is_own_coach_id(coach_id)
      );

    create policy "manager_or_owner_read_own_session_notes" on session_notes
      for select
      using (
        gym_id = private.gym_id()
        and (auth.jwt() ->> 'app_role') = any(array['owner', 'manager'])
      );
    ```
  - [x] `add_session_note(p_member_id uuid, p_note_text text)` — `SECURITY DEFINER` RPC, modeled on `assign_coach()`'s shape (role check, then gym-scoped lookup with uniform not-found failure, then the write — no audit log here, see Scope Notes):
    ```sql
    create function add_session_note(p_member_id uuid, p_note_text text)
    returns uuid
    language plpgsql
    security definer
    set search_path = public
    as $$
    declare
      v_caller_gym_id uuid;
      v_coach_id uuid;
      v_assignment_id uuid;
      v_new_id uuid;
    begin
      if not ((auth.jwt() ->> 'app_role') = 'coach') then
        raise exception 'permission denied';
      end if;

      v_caller_gym_id := private.gym_id();
      if v_caller_gym_id is null then
        raise exception 'permission denied';
      end if;

      if p_note_text is null or btrim(p_note_text) = '' then
        raise exception 'add_session_note: note text is required';
      end if;

      select id into v_coach_id
      from members
      where user_id = auth.uid() and gym_id = v_caller_gym_id and role = 'coach';

      if v_coach_id is null then
        raise exception 'add_session_note: caller is not a coach in this gym';
      end if;

      select id into v_assignment_id
      from coach_assignments
      where member_id = p_member_id and coach_id = v_coach_id and ended_at is null;

      if v_assignment_id is null then
        raise exception 'add_session_note: member % is not currently assigned to caller', p_member_id;
      end if;

      insert into session_notes (gym_id, member_id, coach_id, coach_assignment_id, note_text)
      values (v_caller_gym_id, p_member_id, v_coach_id, v_assignment_id, btrim(p_note_text))
      returning id into v_new_id;

      return v_new_id;
    end;
    $$;

    revoke execute on function add_session_note from public;
    grant execute on function add_session_note to authenticated;
    ```
  - [x] `edit_session_note(p_note_id uuid, p_note_text text)` — same `SECURITY DEFINER` shape; the `update ... where sn.id = p_note_id and sn.gym_id = v_caller_gym_id and sn.coach_id = v_coach_id` clause (with `v_coach_id` resolved the same way as above) is the enforcement for AC #4 ("I cannot edit it") — a coach attempting to edit a note that isn't `coach_id = <their own resolved id>` matches zero rows and raises not-found, regardless of what the client sends:
    ```sql
    create function edit_session_note(p_note_id uuid, p_note_text text)
    returns void
    language plpgsql
    security definer
    set search_path = public
    as $$
    declare
      v_caller_gym_id uuid;
      v_coach_id uuid;
      v_updated_id uuid;
    begin
      if not ((auth.jwt() ->> 'app_role') = 'coach') then
        raise exception 'permission denied';
      end if;

      v_caller_gym_id := private.gym_id();
      if v_caller_gym_id is null then
        raise exception 'permission denied';
      end if;

      if p_note_text is null or btrim(p_note_text) = '' then
        raise exception 'edit_session_note: note text is required';
      end if;

      select id into v_coach_id
      from members
      where user_id = auth.uid() and gym_id = v_caller_gym_id and role = 'coach';

      if v_coach_id is null then
        raise exception 'edit_session_note: caller is not a coach in this gym';
      end if;

      update session_notes
      set note_text = btrim(p_note_text), edited_at = now()
      where id = p_note_id and gym_id = v_caller_gym_id and coach_id = v_coach_id
      returning id into v_updated_id;

      if v_updated_id is null then
        raise exception 'edit_session_note: note % not found or not owned by caller', p_note_id;
      end if;
    end;
    $$;

    revoke execute on function edit_session_note from public;
    grant execute on function edit_session_note to authenticated;
    ```
  - [x] Do not touch `coach_assignments`, `members`, or `subscriptions` RLS — this migration only adds `session_notes` and its two new `private` helpers/RPCs.
  - [x] Regenerate `packages/types/src/database.ts` via `supabase gen types typescript --local` (WSL shell — see Dev Notes). `session_notes` is a real public-schema table, unlike `private.is_assigned_coach`/`private.is_own_coach_id` — expect a real, visible diff (new table type + the two RPC function signatures under `public.Functions` if `add_session_note`/`edit_session_note` are exposed via `rpc()`, which they are).

- [x] **Task 2: `packages/types/src/schemas/sessionNote.ts`** (new) (AC: #2, #3)
  - [x] `addSessionNoteSchema`: `{ memberId: z.uuid(), noteText: z.string().trim().min(1, "Enter a note before saving").max(2000, "Note is too long (max 2000 characters)") }`. `2000` is this story's own new cap — no existing precedent to match (first free-text note field in this app); pick a generous single round number and keep the client-side character counter (Task 5) in sync with it.
  - [x] `editSessionNoteSchema`: `{ noteId: z.uuid(), noteText: <same string rule> }`.
  - [x] Export both from `packages/types/src/index.ts` (`export * from "./schemas/sessionNote";`), same list every other schema file is already in.

- [x] **Task 3: `apps/dashboard/services/coaches.ts`** (modified) (AC: all)
  - [x] `getMemberDetail(memberId: string)`: two RLS-scoped reads combined into one row — `members` (id, name, phone, goal, experience_level) for the header fields not in the existing view, plus `subscriptions_current` (Story 4.8's view, already imported by this file's `listAssignedMembers`) for plan/status/expiry. Both reads are independently RLS-scoped by `coach_read_assigned_members`/`coach_read_assigned_subscriptions` (0040) — an unassigned member yields `null` from both, which this function turns into `coachNotFoundError` (this file's existing not-found helper, reused verbatim):
    ```ts
    export interface CoachPortalMemberDetail {
      memberId: string;
      memberName: string;
      phone: string | null;
      goal: string | null;
      experienceLevel: string | null;
      planName: string;
      planType: string;
      status: CoachPortalMemberRow["status"];
      expiryDate: string | null;
    }

    export async function getMemberDetail(
      memberId: string,
    ): Promise<{ data: CoachPortalMemberDetail | null; error: AppError | null }> {
      const supabase = await createClient();
      const { gymId, error: gymIdError } = await getCallerGymId(supabase);
      if (gymIdError || !gymId) {
        return { data: null, error: gymIdError };
      }

      const { data: memberRow, error: memberError } = await supabase
        .from("members")
        .select("id, name, phone, goal, experience_level")
        .eq("id", memberId)
        .eq("gym_id", gymId)
        .maybeSingle();
      if (memberError) {
        return { data: null, error: await mapAndLog(memberError) };
      }
      if (!memberRow) {
        return { data: null, error: await coachNotFoundError(`member ${memberId} not found or not assigned`) };
      }

      const { data: subRow, error: subError } = await supabase
        .from("subscriptions_current")
        .select("plan_name, plan_type, status, expiry_date")
        .eq("member_id", memberId)
        .eq("gym_id", gymId)
        .maybeSingle();
      if (subError) {
        return { data: null, error: await mapAndLog(subError) };
      }
      if (!subRow) {
        return { data: null, error: await coachNotFoundError(`member ${memberId} has no subscription`) };
      }

      return {
        data: {
          memberId: memberRow.id,
          memberName: memberRow.name,
          phone: memberRow.phone,
          goal: memberRow.goal,
          experienceLevel: memberRow.experience_level,
          planName: subRow.plan_name,
          planType: subRow.plan_type,
          status: subRow.status,
          expiryDate: subRow.expiry_date,
        },
        error: null,
      };
    }
    ```
  - [x] `listSessionNotes(memberId: string)`: reads `session_notes`, embedding the author's `members.name` via the explicit `coach_id` FK constraint name (`session_notes_coach_id_fkey`) — `session_notes` has two FKs to `members` (`member_id`, `coach_id`), same disambiguation `getCoachAssignments`' own `members!coach_assignments_coach_id_fkey(name)` embed already needs, copy that exact technique:
    ```ts
    export interface SessionNoteRow {
      id: string;
      coachId: string;
      coachName: string;
      noteText: string;
      createdAt: string;
      editedAt: string | null;
    }

    interface SessionNoteRowFromDb {
      id: string;
      coach_id: string;
      note_text: string;
      created_at: string;
      edited_at: string | null;
      members: { name: string } | { name: string }[] | null;
    }

    function toSessionNoteRow(row: SessionNoteRowFromDb): SessionNoteRow {
      const coach = Array.isArray(row.members) ? row.members[0] : row.members;
      return {
        id: row.id,
        coachId: row.coach_id,
        coachName: coach?.name ?? "",
        noteText: row.note_text,
        createdAt: row.created_at,
        editedAt: row.edited_at,
      };
    }

    export async function listSessionNotes(
      memberId: string,
    ): Promise<{ data: SessionNoteRow[] | null; error: AppError | null }> {
      const supabase = await createClient();
      const { gymId, error: gymIdError } = await getCallerGymId(supabase);
      if (gymIdError || !gymId) {
        return { data: null, error: gymIdError };
      }
      const { data, error } = await supabase
        .from("session_notes")
        .select("id, coach_id, note_text, created_at, edited_at, members!session_notes_coach_id_fkey(name)")
        .eq("gym_id", gymId)
        .eq("member_id", memberId)
        .order("created_at", { ascending: false });
      if (error) {
        return { data: null, error: await mapAndLog(error) };
      }
      return { data: ((data ?? []) as unknown as SessionNoteRowFromDb[]).map(toSessionNoteRow), error: null };
    }
    ```
    Per RLS (Task 1), this always returns only the caller's own notes for `coach` sessions — no client-side author filtering needed or added.
  - [x] `addSessionNote(memberId: string, noteText: string)` / `editSessionNote(noteId: string, noteText: string)`: thin `rpc()` wrappers, same shape as this file's existing `assignCoach`:
    ```ts
    export async function addSessionNote(
      memberId: string,
      noteText: string,
    ): Promise<{ data: { id: string } | null; error: AppError | null }> {
      const supabase = await createClient();
      const { data, error } = await supabase.rpc("add_session_note", {
        p_member_id: memberId,
        p_note_text: noteText,
      });
      if (error || !data) {
        return { data: null, error: await mapAndLog(error) };
      }
      return { data: { id: data }, error: null };
    }

    export async function editSessionNote(
      noteId: string,
      noteText: string,
    ): Promise<{ data: null; error: AppError | null }> {
      const supabase = await createClient();
      const { error } = await supabase.rpc("edit_session_note", {
        p_note_id: noteId,
        p_note_text: noteText,
      });
      if (error) {
        return { data: null, error: await mapAndLog(error) };
      }
      return { data: null, error: null };
    }
    ```

- [x] **Task 4: `packages/types/src/errors.ts`** (modified) (AC: #2, #4)
  - [x] Add two mappings, following this file's established "map only the races reachable through a real UI path, leave permission-denied unmapped" discipline (see `confirm_renewal`'s precedent comments already in the file):
    ```ts
    // add_session_note()'s reachable race (0041, Story 5.3): the coach's
    // assignment to this member ended in the gap between loading the detail
    // page and submitting a note (e.g. a manager reassigned the member in
    // another session).
    if (message.includes("add_session_note:") && message.includes("is not currently assigned")) {
      return { code: "member_not_assigned", message: copy.memberNotAssigned };
    }

    // edit_session_note()'s not-found/not-owned raise -- reachable if the
    // note was deleted or reassigned away between page load and edit submit.
    // Also the AC #4 enforcement backstop (see 0041's own comment).
    if (message.includes("edit_session_note:") && message.includes("not found or not owned")) {
      return { code: "note_not_editable", message: copy.noteNotEditable };
    }
    ```
  - [x] Add `memberNotAssigned`/`noteNotEditable` keys to `packages/types/src/locales/en.json` and `fr.json`'s `errors` namespace (same file the existing `memberDeactivated`/`backdateNotEligible` keys live in).

- [x] **Task 5: `apps/dashboard/app/(dashboard)/coach/[memberId]/page.tsx`** (new, AD-15) (AC: #1, #2, #3, #4)
  - [x] Server Component, `params: Promise<{ memberId: string }>` (Next 16 async-params convention — Scope Notes), fetches `getMemberDetail` and `listSessionNotes` in parallel via `Promise.all`, wrapped in `<Suspense>` matching `coach/page.tsx`'s exact structure:
    ```tsx
    export default function CoachMemberDetailPage({
      params,
    }: {
      params: Promise<{ memberId: string }>;
    }) {
      return (
        <Suspense fallback={<CoachMemberDetailLoading />}>
          <CoachMemberDetailData params={params} />
        </Suspense>
      );
    }

    async function CoachMemberDetailData({ params }: { params: Promise<{ memberId: string }> }) {
      const { memberId } = await params;
      const [{ data: member, error: memberError }, { data: notes, error: notesError }] = await Promise.all([
        getMemberDetail(memberId),
        listSessionNotes(memberId),
      ]);

      if (memberError || !member) {
        const { t } = await getServerTranslation(await getRequestLocale());
        return <div className="text-sm text-red-600">{t("coachPortal.detail.notFound")}</div>;
      }
      if (notesError) {
        const { t } = await getServerTranslation(await getRequestLocale());
        return <div className="text-sm text-red-600">{t("common.loadError")}</div>;
      }

      return <CoachMemberDetailPageClient member={member} notes={notes ?? []} />;
    }
    ```
  - [x] `memberError` (not-found/RLS-denied) renders inline, not a Next.js `notFound()` 404 — matches this app's established pattern of every other page rendering its own inline error state (`coach/page.tsx`, `subscriptions/page.tsx`) rather than throwing.

- [x] **Task 6: `apps/dashboard/app/(dashboard)/coach/[memberId]/loading.tsx`** (new) (AC: #1, #2)
  - [x] No AD-15-specific skeleton shape is defined in EXPERIENCE.md's Loading States table (unlike AD-14's explicit "4 rows") — build a generic two-block skeleton (header block + 3 note-row placeholders), following `coachPortal/loading.tsx`'s `animate-pulse`/`bg-muted` styling convention.

- [x] **Task 7: `apps/dashboard/app/(dashboard)/coach/[memberId]/actions.ts`** (new) (AC: #2, #3)
  - [x] `"use server"`, two Zod-validated thin wrappers, same shape as `subscriptions/actions.ts`'s `confirmRenewalAction`:
    ```ts
    export async function addSessionNoteAction(
      input: unknown,
    ): Promise<{ data: { id: string } | null; error: AppError | null }> {
      const { t } = await getServerTranslation(await getRequestLocale());
      const parsed = addSessionNoteSchema.safeParse(input);
      if (!parsed.success) {
        return { data: null, error: { code: "validation_error", message: t("common.invalidInput") } };
      }
      return addSessionNote(parsed.data.memberId, parsed.data.noteText);
    }

    export async function editSessionNoteAction(
      input: unknown,
    ): Promise<{ data: null; error: AppError | null }> {
      const { t } = await getServerTranslation(await getRequestLocale());
      const parsed = editSessionNoteSchema.safeParse(input);
      if (!parsed.success) {
        return { data: null, error: { code: "validation_error", message: t("common.invalidInput") } };
      }
      return editSessionNote(parsed.data.noteId, parsed.data.noteText);
    }
    ```

- [x] **Task 8: `apps/dashboard/app/(dashboard)/coach/[memberId]/components/CoachMemberDetailPageClient.tsx`** (new) (AC: #1, #2, #3, #4)
  - [x] `"use client"`. Member header (AD-15 layout): avatar-initial (copy `CoachPortalPageClient.tsx`'s `row.memberName.slice(0,1).toUpperCase()` circle), name, `STATUS_BADGE_CONFIG` badge (import from `subscriptions/subscriptionLabels.ts`, reused verbatim — third file to reuse this config, do not duplicate it), plan name (via `PLAN_TYPE_LABEL_KEY`, same reuse as `CoachPortalPageClient.tsx`), expiry date (`formatLocalDate`, per-file copy, same pattern), goal/experience labels (new local `GOAL_LABEL_KEY`/`EXPERIENCE_LABEL_KEY` maps keyed by the exact `memberOnboarding.ts` enum values — Scope Notes), phone (or `t("coachPortal.detail.phoneNotSet")` if null). All read-only — no Renew button, no edit affordance on any header field (Scope Notes: "no renew button for Coach role").
  - [x] Amber info bar: render only when `member.status === "expired"`, exact copy `t("coachPortal.detail.expiredInfoBar")` (Scope Notes — `expired` only, not `expiring_soon`).
  - [x] Session Notes section:
    - "+ Add note" button toggles an inline `<textarea>` (copy `RenewalModal.tsx`'s exact textarea + character-count markup, Scope Notes) with Save/Cancel. On Save: call `addSessionNoteAction({ memberId: member.memberId, noteText })`; on success, clear the textarea, collapse the add-form, and `router.refresh()` (Server Component re-fetch, same "no client-side cache to reconcile" approach `SubscriptionsPageClient.tsx`/`CoachPortalPageClient.tsx` already use after a mutating action's URL-param-driven refetch — here it's a plain `router.refresh()` since there's no URL param to update). Field/form error handling mirrors `RenewalModal.tsx`'s `fieldErrors`/`formError`/`submitting` local-state pattern.
    - Each note row: text, `"{{coachName}} · {{createdAt}}"` (localized via `i18n.language`, same `toLocaleDateString`/`toLocaleTimeString`-style formatting this app already uses elsewhere), and `"Edited {{editedAt}}"` appended only when `editedAt` is non-null. "Edit" link/button on every rendered row (Scope Notes: RLS guarantees every note in this list is the caller's own, so no per-row ownership branch is needed) opens the same inline-textarea pattern pre-filled with the note's current text, calling `editSessionNoteAction({ noteId, noteText })` on save.
    - Empty state: `t("coachPortal.detail.notes.empty")` = "No session notes yet. Add the first note above." (AC — verbatim, `EXPERIENCE.md` line 1389/1701), rendered with the "+ Add note" affordance still visible above it (per the mockup's own empty-state note: "(Inline add always visible above)").

- [x] **Task 9: `apps/dashboard/app/(dashboard)/coach/components/CoachPortalPageClient.tsx`** (modified) (AC: all — wires the list to the detail route)
  - [x] Replace the static `<tr>` (currently has a comment: "Static, non-interactive row -- Story 5.3... makes this clickable") with one that navigates on click. **No existing page-to-page (as opposed to page-to-modal) row-click precedent exists in this app** — `MembersPageClient.tsx`'s own row `onClick` (`cursor-pointer hover:bg-muted/30` styling, worth reusing for the visual affordance) opens an in-page modal via `openView(member)`, not a route change, so it is not a direct template for the navigation itself. Use `useRouter()` (already imported in this file) and `router.push(`/coach/${row.memberId}`)` on the `<tr>`'s `onClick`, keep the `cursor-pointer hover:bg-muted/30` classes for the same affordance. Remove the now-stale "Story 5.3 makes this clickable" comment.

- [x] **Task 10: i18n** (AC: #1, #2, #3, #4)
  - [x] Extend the existing `coachPortal` namespace (`apps/dashboard/locales/en.json`/`fr.json`) with a new `detail` sub-object: `planLabel`, `expiresLabel`, `goalLabel`, `experienceLabel`, `phoneLabel`, `phoneNotSet` ("Not set"), `expiredInfoBar` (AC-adjacent, AD-15's exact copy), `notFound`, `goalOptions.{loseWeight,buildMuscle,improveFitness,generalWellness}`, `experienceOptions.{beginner,intermediate,advanced}` (English wording matches `apps/mobile/src/locales/en.json`'s `onboarding.goal.option*`/`onboarding.experience.option*` keys verbatim — new keys, not imports, per Scope Notes) — and a `notes` sub-object: `heading` ("Session Notes"), `addButton` ("+ Add note"), `placeholder`, `save`, `cancel`, `edit` ("Edit"), `edited` ("Edited {{timestamp}}"), `empty` (AC's exact copy), `charCount` ("{{count}}/{{max}}"), `errors.{required,tooLong,notAssigned,notEditable}`.
  - [x] Verify via `node scripts/check-i18n-key-parity.mjs`.

- [x] **Task 11: `docs/decisions.md` entry** (AC: all)
  - [x] Dated entry recording: (1) `private.is_own_coach_id()` — second `SECURITY DEFINER` `private`-schema table-reading helper (after `is_assigned_coach`, 0040), same RLS-blocking-its-own-helper mechanism, this time for the "is this note mine" authorship check; (2) `add_session_note`/`edit_session_note` are `SECURITY DEFINER` RPCs (not direct RLS INSERT/UPDATE policies like `refunds`) because both need to resolve the caller's own `coach_id`/active `coach_assignment_id` server-side, which a plain RLS `with check` subquery can't do without hitting the same RLS-blocking bug; (3) **the FR-055-vs-AC#4 resolution** (Scope Notes' "genuine spec tension" section, verbatim or close to it) — a coach's session-notes query is scoped to self-authored notes only, so a reassigned member's notes list never surfaces a predecessor coach's notes to the new coach, matching FR-055/Story 5.1 AC#2 over this story's own AC#4's more literal (and, on this reading, superseded) phrasing; (4) the AD-15 amber info bar builds only the mockup's own `expired` variant, not Flow 5's narrative `expiring_soon` variant; (5) no audit log entry for session note add/edit (not in FR-080's enumerated action-type list).

- [x] **Task 12: pgTAP coverage — `supabase/tests/coach_portal_member_detail_session_notes.test.sql`** (new file) (AC: all)
  - [x] Mirror `coach_portal_member_list.test.sql`'s (Story 5.2) fixture-seeding/session-simulation conventions — reuse a similar two-gym, two-coach, multi-member seed shape (gym A: coach-1 with an assigned member, coach-2 with a different assigned member, one unassigned member; gym B for cross-tenant checks).
  - [x] `private.is_own_coach_id()` called directly: `true` for the calling coach's own `members.id`, `false` for any other coach's id or a non-coach member's id, never raises.
  - [x] `add_session_note()`: as coach-1 for their assigned member, succeeds and returns a uuid; a `session_notes` row exists with `coach_id` = coach-1's own id and `coach_assignment_id` matching the active assignment row. As coach-1 for coach-2's assigned member (not assigned to coach-1), raises (`not currently assigned`). As coach-1 for a nonexistent member id, raises. Empty/whitespace-only note text raises.
  - [x] `edit_session_note()`: as coach-1, editing their own note succeeds, `note_text` updates, `edited_at` becomes non-null and later than `created_at`. As coach-1, attempting to edit coach-2's note (even one on a member neither is currently assigned to, and one on coach-2's own currently-assigned member) raises `not found or not owned` — **this is AC #4's actual enforcement test, do not skip it**.
  - [x] **The reassignment/FR-055 regression test — this is this story's single most important test, matching the weight Story 5.2 gave its own base-table regression test for `is_assigned_coach`:** seed a member assigned to coach-1, have coach-1 add a note, then (as owner/manager, using `assign_coach()` from 0039) reassign the member to coach-2. As coach-2: `select * from session_notes where member_id = <the member>` returns **zero rows** (coach-1's note is invisible to the new coach — the RLS scoping, not just the edit-RPC, is what's actually being tested here). As owner/manager: the same query returns the full history including coach-1's note (`manager_or_owner_read_own_session_notes` policy).
  - [x] As owner/manager: full SELECT visibility across all coaches' notes in their own gym, denied cross-gym (tenant isolation, same style as every other RLS test file).
  - [x] Direct RLS SELECT as coach-1 for a note authored by coach-2 on a member never assigned to coach-1: zero rows (compounded denial — both `is_assigned_coach` and `is_own_coach_id` must fail).
  - [x] `session_notes_note_text_not_blank` CHECK constraint: a direct insert (as `service_role`, bypassing the RPC) with `note_text = ''` or all-whitespace fails.

- [x] **Task 13: Validation and manual verification**
  - [x] `pnpm run typecheck` (all packages) — 0 errors. `node scripts/check-i18n-key-parity.mjs` — 0 errors.
  - [x] `supabase test db` (WSL shell) — zero regressions against the pre-story baseline (585/585 per Story 5.2's own completion note) plus this story's new test file.
  - [x] Hands-on (WSL-only Supabase convention, per Dev Notes): using coach fixtures from Story 5.1/5.2's own manual testing (or fresh ones), log in as a coach with at least one assigned member and confirm: clicking a row on `/coach` navigates to `/coach/[memberId]`; the header shows name/plan/status/expiry/goal/experience/phone correctly, with "Not set" for a member with no goal/experience_level; the amber bar appears only for an `expired` member, not for `expiring_soon`; adding a note appears at the top with the coach's own name and a fresh timestamp; editing that same note shows "Edited [timestamp]"; navigating to `/coach/<some-other-gym-or-unassigned-member-id>` directly shows the not-found state, not a crash or leaked data. All confirmed live. The optional "if feasible" reassign-via-Members-page-UI sub-check was not repeated live (would require provisioning a second coach account) — that exact scenario is the FR-055 regression pgTAP already exhaustively covers as this story's own single most important test (see Task 12).

### Review Findings (2026-08-02)

- [x] [Review][Patch] `edit_session_note()`'s authorization is weaker than the SELECT RLS policy — a coach can keep editing their own notes forever, even after losing assignment to the member — Decision: add the same `private.is_assigned_coach(member_id)` check the SELECT policy already requires, so edit access is revoked on reassignment. Fixed in `0041_coach_portal_member_detail_session_notes.sql`; new pgTAP regression test added to section (e) of `coach_portal_member_detail_session_notes.test.sql`; addendum recorded in `docs/decisions.md`.
- [x] [Review][Patch] Two independent translation sets exist for the same two session-note error states — Decision: delete the orphaned dashboard-namespace keys (`coachPortal.detail.notes.errors.{notAssigned,notEditable}` in `apps/dashboard/locales/{en,fr}.json`), keeping the existing `packages/types/src/locales`' `errors.memberNotAssigned`/`errors.noteNotEditable` → `mapSupabaseError` → `AppError.message` path. Keys removed; `node scripts/check-i18n-key-parity.mjs` re-verified clean.
- [x] [Review][Patch] 2000-char note limit is enforced only client-side (Zod), with no DB-level constraint; the limit is duplicated across 4 unsynchronized places [supabase/migrations/0041_coach_portal_member_detail_session_notes.sql, packages/types/src/schemas/sessionNote.ts, apps/dashboard/app/(dashboard)/coach/[memberId]/components/SessionNoteModal.tsx] — added `session_notes_note_text_len` CHECK constraint; new pgTAP test added to section (h).
- [x] [Review][Patch] Unguarded `STATUS_BADGE_CONFIG[status]` lookups can throw at render if status isn't in the map [apps/dashboard/app/(dashboard)/coach/[memberId]/components/CoachMemberDetailPageClient.tsx, apps/dashboard/app/(dashboard)/coach/components/CoachPortalPageClient.tsx] — added `?? STATUS_BADGE_CONFIG.active` fallback in both.
- [x] [Review][Patch] `getMemberDetail()` omits the `.is("deactivated_at", null)` filter that `listAssignedMembers()` applies — a deactivated member's detail/notes page stays reachable via direct URL [apps/dashboard/services/coaches.ts] — filter added to both the `members` and `subscriptions_current` reads.
- [x] [Review][Patch] `fieldErrorFor()` maps validation errors by exact literal string match against the Zod message; a malformed `memberId`/`noteId` failure (which precedes `noteText` in the schema) would be mislabeled as "note too long" [apps/dashboard/app/(dashboard)/coach/[memberId]/components/SessionNoteModal.tsx] — rewritten to match on the failing issue's `path`/`code` instead of its message text.
- [x] [Review][Defer] `router.push` used for both sort-column clicks and debounced search input, polluting browser history on every interaction [apps/dashboard/app/(dashboard)/coach/components/CoachPortalPageClient.tsx] — reclassified from patch to defer during apply: verified byte-identical `router.push(...)` (not `replace`) exists in the same `updateParams`-style function in `MembersPageClient.tsx`, `SubscriptionsPageClient.tsx`, and `AttendancePageClient.tsx` — a deliberate, app-wide convention across all four filter/sort pages, not a regression introduced by this story. Fixing only the coach page would make it the one inconsistent page; flagging as a cross-cutting follow-up instead.
- [x] [Review][Patch] `goalLabel()`/`experienceLabel()` null-fallbacks incorrectly reuse the `phoneNotSet` translation key instead of a dedicated/generic key [apps/dashboard/app/(dashboard)/coach/[memberId]/components/CoachMemberDetailPageClient.tsx] — added a dedicated `coachPortal.detail.notSet` key (en/fr), switched both fallbacks to it.
- [x] [Review][Patch] Character counter reads raw `text.length`, but `noteTextSchema` validates the `.trim()`'d length — the displayed count can diverge from what actually passes/fails validation [apps/dashboard/app/(dashboard)/coach/[memberId]/components/SessionNoteModal.tsx] — counter now derived from `text.trim().length`.
- [x] [Review][Patch] No `maxLength` on the note `<textarea>` and no visual over-limit cue before Save [apps/dashboard/app/(dashboard)/coach/[memberId]/components/SessionNoteModal.tsx] — added `maxLength={NOTE_MAX}` and a red-text cue when the trimmed count exceeds it.
- [x] [Review][Patch] Note text rendering uses `whitespace-pre-wrap` without `break-words` — a single long unbroken token can overflow the note card [apps/dashboard/app/(dashboard)/coach/[memberId]/components/CoachMemberDetailPageClient.tsx] — `break-words` added.
- [x] [Review][Patch] Redundant click targets on the member row (whole `<tr>` plus a "View" button navigate identically) with no `tabIndex`/`onKeyDown` on the row, so keyboard/screen-reader users only reach one of the two [apps/dashboard/app/(dashboard)/coach/components/CoachPortalPageClient.tsx] — added `tabIndex={0}`, `onKeyDown` (Enter), `role="link"`, and a focus-visible ring to the row.
- [x] [Review][Defer] `select ... into v_coach_id` without `strict` in both `add_session_note`/`edit_session_note` silently picks a row rather than erroring on an unexpected duplicate match [supabase/migrations/0041_coach_portal_member_detail_session_notes.sql] — deferred, pre-existing: mirrors migration 0039's `assign_coach()` convention; fixing in isolation here would diverge from that established pattern.
- [x] [Review][Defer] `noteTimestamp()` calls `toLocaleDateString`/`toLocaleTimeString` with no explicit `timeZone` in a `"use client"` component still SSR'd on first pass — a hydration-mismatch risk if server/browser timezones differ [apps/dashboard/app/(dashboard)/coach/[memberId]/components/CoachMemberDetailPageClient.tsx] — deferred, pre-existing: shares the same pattern as the codebase's existing `formatLocalDate` helper, used unchanged elsewhere; a cross-cutting fix, not scoped to this story.
- [x] [Review][Defer] `apps/dashboard/locales/{en,fr}.json` diff includes unrelated `members.*` key additions with no corresponding component changes in this story's scope [apps/dashboard/locales/en.json, apps/dashboard/locales/fr.json] — deferred, pre-existing: leftover from separate uncommitted work touching the same shared locale files, not authored by this story.

## Dev Notes

- **Read before starting:** `_bmad-output/implementation-artifacts/5-2-coach-portal-assigned-member-list.md` in full (this story's direct predecessor — the `is_assigned_coach()`/RLS-blocking-its-own-helper mechanism this story's `is_own_coach_id()` duplicates for a new purpose is explained there in the most depth), `supabase/migrations/0039_coach_member_assignment.sql` (`coach_assignments` shape, `assign_coach()`'s RPC template), `supabase/migrations/0040_coach_portal_member_list_rls.sql` (`is_assigned_coach()`, the two narrowed staff policies), `supabase/migrations/0037_subscriptions_page_manual_renewal.sql` (`subscriptions_current` view, reused again here), `supabase/migrations/0020_member_goal_experience_plan_confirmation.sql` (`members.goal`/`members.experience_level` columns, no CHECK constraint, nullable), `apps/dashboard/services/coaches.ts` (existing file this story adds four functions to), `apps/dashboard/app/(dashboard)/coach/page.tsx` + `coach/components/CoachPortalPageClient.tsx` (this story's immediate sibling — the static-row comment this story resolves), `apps/dashboard/components/shared/RenewalModal.tsx` (the textarea/char-count/submitting-state template for the note add/edit forms), `packages/types/src/schemas/memberOnboarding.ts` (`memberGoalSchema`/`experienceLevelSchema` — the exact enum values the new label maps must key on), `packages/types/src/errors.ts` (mapping conventions, Task 4).
- **This project's local Supabase stack runs inside WSL2, not native Windows** — `supabase db reset`/`supabase test db`/`supabase gen types` must run from a WSL shell. [Memory: Supabase runs in WSL.]
- **Testing standard:** pgTAP is the primary automated coverage (Task 12), and for this story specifically, Task 12's reassignment/FR-055 regression test is the one test that actually proves the Scope Notes' central design resolution works — a wrong RLS policy here fails silently (returns the wrong-but-plausible-looking row set) exactly like Story 5.2's own central bug did, not with an exception or a typecheck error. Do not skip or under-weight it.
- **Do not build:** an Owner/Manager-facing "all coaches' notes" UI (RLS access exists per FR-055, but no AC in this story asks for the page — a future story's job), an `expiring_soon` amber-bar variant, email/DOB/emergency-contact fields in the header, pagination on the notes list, or a per-note "is this mine" client-side branch (RLS already guarantees it — see Scope Notes).
- **`apps/mobile` and `apps/super-admin` are untouched by this story.**

### Project Structure Notes

- File layout to create/modify:
  ```
  supabase/migrations/0041_coach_portal_member_detail_session_notes.sql          (new)
  supabase/tests/coach_portal_member_detail_session_notes.test.sql               (new)
  packages/types/src/database.ts                                                (regenerated)
  packages/types/src/schemas/sessionNote.ts                                     (new)
  packages/types/src/index.ts                                                   (modified — new export line)
  packages/types/src/errors.ts                                                  (modified — two new mappings)
  packages/types/src/locales/en.json                                           (modified — two new error keys)
  packages/types/src/locales/fr.json                                           (modified — two new error keys)
  apps/dashboard/services/coaches.ts                                            (modified — 4 new functions)
  apps/dashboard/app/(dashboard)/coach/[memberId]/page.tsx                      (new — AD-15)
  apps/dashboard/app/(dashboard)/coach/[memberId]/loading.tsx                   (new)
  apps/dashboard/app/(dashboard)/coach/[memberId]/actions.ts                    (new — addSessionNote, editSessionNote wrappers)
  apps/dashboard/app/(dashboard)/coach/[memberId]/components/CoachMemberDetailPageClient.tsx  (new)
  apps/dashboard/app/(dashboard)/coach/components/CoachPortalPageClient.tsx     (modified — row becomes a link)
  apps/dashboard/locales/en.json                                                (modified)
  apps/dashboard/locales/fr.json                                                (modified)
  docs/decisions.md                                                             (modified)
  ```
  - Matches `architecture.md`'s file tree exactly: `coach/[memberId]/page.tsx` is AD-15, `coach/actions.ts` → this story's actions file lives at `coach/[memberId]/actions.ts` (co-located with the route it serves, matching this app's per-route `actions.ts` convention — e.g. `subscriptions/actions.ts`, `members/actions.ts` — not a shared top-level `coach/actions.ts`; architecture.md's flat listing under `coach/` is satisfied by nesting it one level deeper alongside its own page).
  - No `apps/mobile`/`apps/super-admin` changes.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.3] — literal AC text and user story
- [Source: _bmad-output/planning-artifacts/epics.md#FR-054] — Coach Portal V1 features, incl. member profile view (goal/experience) and session notes (add/view/edit)
- [Source: _bmad-output/planning-artifacts/epics.md#FR-055] — coach reassignment behavior; "previous coach's notes stay visible to Owner/Manager only, not the new coach"
- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.1 AC#2] — the same FR-055 constraint, stated as an AC on the prior story, before `session_notes` existed to enforce it against
- [Source: _bmad-output/planning-artifacts/architecture.md line 337–338] — file tree: `coach/[memberId]/page.tsx` (AD-15), `coach/actions.ts` (`addSessionNote`)
- [Source: _bmad-output/planning-artifacts/architecture.md line 533–534] — Entity Relationships: `coach_assignments`/`session_notes` shape, "session_notes -- authored by a coach, scoped to a coach_assignment"
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md lines 1353–1391] — AD-15 mockup: layout, header fields, amber info bar (expired only), Add/Edit note interactions, empty state
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md line 1701] — session-notes empty-state copy, verbatim
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md lines 1989–1998] — Flow 5 (Fatima), incl. the `expiring_soon` amber-bar narrative inconsistency this story deliberately does not build
- [Source: supabase/migrations/0039_coach_member_assignment.sql] — `coach_assignments` shape, `assign_coach()`'s RPC template (role check → gym-scoped lookup → write, no client-trusted IDs)
- [Source: supabase/migrations/0040_coach_portal_member_list_rls.sql] — `private.is_assigned_coach()` (reused directly), the narrowed `gym_staff_read_own_members`/`gym_staff_read_own_subscriptions` policies (why a coach has no self-read access to their own `members` row)
- [Source: supabase/migrations/0037_subscriptions_page_manual_renewal.sql] — `subscriptions_current` view, reused for plan/status/expiry
- [Source: supabase/migrations/0020_member_goal_experience_plan_confirmation.sql] — `members.goal`/`members.experience_level`, nullable, no CHECK constraint
- [Source: supabase/migrations/0033_refund_recording.sql] — the direct-RLS-write pattern this story's RPC choice deliberately deviates from, and why
- [Source: packages/types/src/schemas/memberOnboarding.ts] — `memberGoalSchema`/`experienceLevelSchema`, the exact enum values the new dashboard label maps key on
- [Source: packages/types/src/errors.ts] — `mapSupabaseError`'s existing mapping conventions (Task 4)
- [Source: apps/dashboard/components/shared/RenewalModal.tsx] — textarea + character-count + submitting/fieldErrors/formError pattern, copied for the note add/edit forms
- [Source: apps/dashboard/app/(dashboard)/subscriptions/actions.ts] — `confirmRenewalAction`'s thin-Zod-wrapper Server Action shape, copied for `addSessionNoteAction`/`editSessionNoteAction`
- [Source: apps/dashboard/app/(dashboard)/coach/page.tsx, coach/components/CoachPortalPageClient.tsx] — this story's immediate sibling; the static-row-becomes-a-link change (Task 9), `STATUS_BADGE_CONFIG`/`PLAN_TYPE_LABEL_KEY`/`formatLocalDate` reuse
- [Source: apps/dashboard/services/coaches.ts] — existing file this story adds to; `getCallerGymId`/`coachNotFoundError` conventions already present
- [Source: apps/mobile/src/locales/en.json lines 58–69, fr.json lines 58–69] — exact EN/FR wording for the 4 goal / 3 experience option labels (new dashboard-side keys, not a shared import — Scope Notes)
- [Source: _bmad-output/implementation-artifacts/5-2-coach-portal-assigned-member-list.md] — most recent prior story; `is_assigned_coach()`'s full RLS-blocking-its-own-helper writeup, `docs/decisions.md` entry discipline, WSL Supabase note

## Dev Agent Record

### Agent Model Used

claude-sonnet-5

### Debug Log References

None.

### Completion Notes List

- Migration `0041_coach_portal_member_detail_session_notes.sql` applied cleanly against a fresh `supabase db reset`; `packages/types/src/database.ts` regenerated and diffed as expected (new `session_notes` table type, `add_session_note`/`edit_session_note` RPC signatures).
- pgTAP: `supabase/tests/coach_portal_member_detail_session_notes.test.sql` (27 assertions) covers `private.is_own_coach_id()` directly, `add_session_note()`/`edit_session_note()` success and every reachable raise path, the AC #4 edit-ownership enforcement (including the "note on a member neither coach is currently assigned to" variant), the FR-055 reassignment regression (the story's single most important test — verified a reassigned member's prior notes are invisible to the new coach's own query while Owner/Manager retain full visibility), Owner/Manager full-visibility + cross-gym denial, the compounded-denial direct-RLS-SELECT case, and the `session_notes_note_text_not_blank` CHECK constraint. One assertion (`edited_at >= created_at`, not `>`) uses `>=` rather than strict `>` — documented inline in the test file: `now()` is `transaction_timestamp()`, constant for every statement inside pgTAP's single `begin`/`rollback` transaction, so the INSERT and the later UPDATE resolve to the identical instant in this test harness (in production, separate transactions, it is strictly later).
- Full suite: `supabase test db` — 614/614 passing (Story 5.2's baseline was 585; +27 new, +2 from an unrelated file already present before this story started).
- `pnpm run typecheck` (all 4 packages) — 0 errors. `node scripts/check-i18n-key-parity.mjs` — 0 errors (dashboard locales: 413 keys, en/fr in parity). `npx eslint` on every new/modified file — 0 errors/warnings.
- **Manual verification — partially completed, environment-blocked for the rest.** Provisioned real fixtures (owner + coach auth users via the GoTrue admin API, a gym, three members — one active/assigned, one expired/assigned, one active/unassigned) in the local Supabase instance and drove the actual app in Chrome. Confirmed working end-to-end: coach login; `/coach` list (Story 5.2, unmodified) rendering real assigned members; clicking a row navigating to the new `/coach/[memberId]` route; the AD-15 detail page rendering with the correct name, `Active` status badge, plan, expiry date, phone, and goal/experience labels (`Lose Weight` / `Beginner`) all matching the seeded data exactly; the "+ Add note" button revealing the inline textarea with a working live character counter and Save/Cancel. **Not conclusively confirmed live in-browser**: a full add-note round trip resolving to a saved row appearing in the list, the edit-note flow, the `expired`-only amber info bar, the not-found state for a direct URL to an unassigned/cross-gym member, and reassignment via the Members page UI. The local Supabase stack (specifically `supabase_db_gym_os`, cascading to `supabase_auth_gym_os` and `supabase_kong_gym_os`) went into a sustained crash-restart loop partway through this session — confirmed via `docker events`/container logs showing repeated `FATAL: the database system is starting up` / GoTrue migration failures / Kong container restarts roughly every 5–30 seconds for an extended period, unrelated to any change in this story (no migration, config, or docker-compose file was touched) and not attributable to memory pressure (`docker stats` showed <1.5GB used of 7.7GB available throughout). Every add-note attempt during this window either failed on a transient network error identical in shape to failures also hit by pre-existing, untouched code (`getDashboardShellContext`, used by every page in this app) in the same window, or reproduced a client-side "Enter a note before saving" validation error on visibly non-empty input. That specific symptom was investigated in depth and traced to the flaky window rather than a real defect: the identical Zod validation (`editSessionNoteSchema.shape.noteText.safeParse(...)`) was verified in isolation with Node against the installed `zod@4.4.3` and passed for every input tried; the actual Turbopack-compiled bundle being served was inspected directly on disk after a full `.next` cache clear and fresh dev-server start and matched the source file exactly; and the on-screen character counter (driven by the same React state read inside the failing validation call) consistently showed the correct, non-zero length immediately before each failed Save. No code change was made in response to this investigation beyond the investigation itself (added and then removed temporary debug logging). Given the exhaustive pgTAP coverage of every one of these exact scenarios at the RLS/RPC layer (see above) and the isolated confirmation of the client-side validation logic, this is recorded as an environment limitation for this session, not a known or suspected defect — flagging for whoever picks up code review to re-run the hands-on checklist once the local Supabase stack is stable.
- **Post-review UI change, per explicit user direction**: converted the add/edit session-note form from the story's originally-specified inline-expanding `<textarea>` to a modal (`SessionNoteModal.tsx`), matching this app's `RenewalModal.tsx` precedent (see `docs/decisions.md`'s new entry). `CoachMemberDetailPageClient.tsx`'s own inline `NoteForm` component and its `isAdding`/`editingNoteId` state were removed; a single `modalState` (`null` | `{ note: null }` add | `{ note: {...} }` edit) now drives one shared `SessionNoteModal` instance. No RPC/RLS/schema change. Typecheck, i18n parity, and lint all re-verified clean after this change.
- **Root-caused the earlier "Enter a note before saving" symptom while re-testing the modal**: it was never an application defect. My manual-test fixture member IDs (hand-written literals like `99000000-0000-0000-0000-000000000203`) are not valid RFC 4122 UUIDs -- the version nibble must be `1`-`8`, and mine was `0` -- so `addSessionNoteSchema`'s `memberId: z.uuid()` correctly rejected them once the modal's validation started checking the whole input object (`{ memberId, noteText }`) rather than only the `noteText` field the old inline `NoteForm` happened to validate in isolation. Confirmed directly: `z.uuid().safeParse('99000000-0000-0000-0000-000000000203')` fails in isolated Node against the installed `zod@4.4.3`; a freshly-inserted member row using a real `gen_random_uuid()`-generated id (`d81a1d7e-907d-4126-aa5b-d0380ea52dd4`) passed validation immediately and reached the Save-in-flight ("Saving...") state on first try. Production code is unaffected -- `session_notes.id`/`members.id` are always `gen_random_uuid()`-generated in real use, never hand-written test literals.
- **Root-caused and fixed the underlying environment instability, then completed the full hands-on checklist live.** The actual cause of the repeated Supabase/Docker crash-restart loop: Docker Engine runs natively inside this machine's WSL2 Ubuntu-24.04 distro (no Docker Desktop), and that distro was auto-terminating ~15 seconds after the last attached `wsl.exe` session ended -- a WSL2 idle-shutdown behavior independent of `vmIdleTimeout` (which only governs the shared utility VM, not per-distro session idling) and independent of systemd being enabled inside the distro. Every termination killed `dockerd` and, via each container's `restart: unless-stopped` policy, every Supabase container along with it; the next `wsl` invocation restarted the distro and Docker fresh, repeating the cycle. Fix: keep one long-lived `wsl -e sleep 3600` session open in the background so the distro is never considered idle. Confirmed via `wsl --list -v` staying `Running` through 20+ seconds of zero WSL activity (previously auto-stopped within 15s every time), and via `docker ps` showing every container `Up About a minute (healthy)` with no restarts.
- With the environment genuinely stable, completed the remainder of Task 13's hands-on checklist live, all passing: add-note round trip -- note appeared at the top of the list immediately after save with the coach's own name and a fresh timestamp (`Story53 Coach · 8/2/2026 08:20 PM`); edit-note flow -- text updated and the row correctly showed `Edited 8/2/2026 08:21 PM`; the `expired`-only amber info bar -- rendered with the exact copy ("This member's membership has expired. Contact your receptionist.") for the expired fixture member, correctly absent for active members; the null-goal/null-experience/null-phone "Not set" fallback -- rendered correctly for that same member; the not-found state -- confirmed for a real member not assigned to the calling coach (`Chantal Unassigned`), showing "This member could not be found." with no data leak or crash; and the `/coach` list -- correctly shows only the coach's 3 assigned members (never the unassigned one), row-click navigation to `/coach/[memberId]` confirmed working end-to-end multiple times.

### File List

- `supabase/migrations/0041_coach_portal_member_detail_session_notes.sql` (new)
- `supabase/tests/coach_portal_member_detail_session_notes.test.sql` (new)
- `packages/types/src/database.ts` (regenerated)
- `packages/types/src/schemas/sessionNote.ts` (new)
- `packages/types/src/index.ts` (modified — new export line)
- `packages/types/src/errors.ts` (modified — two new mappings)
- `packages/types/src/locales/en.json` (modified — two new error keys)
- `packages/types/src/locales/fr.json` (modified — two new error keys)
- `apps/dashboard/services/coaches.ts` (modified — 4 new functions)
- `apps/dashboard/app/(dashboard)/coach/[memberId]/page.tsx` (new — AD-15)
- `apps/dashboard/app/(dashboard)/coach/[memberId]/loading.tsx` (new)
- `apps/dashboard/app/(dashboard)/coach/[memberId]/actions.ts` (new — addSessionNoteAction, editSessionNoteAction)
- `apps/dashboard/app/(dashboard)/coach/[memberId]/components/CoachMemberDetailPageClient.tsx` (new)
- `apps/dashboard/app/(dashboard)/coach/[memberId]/components/SessionNoteModal.tsx` (new)
- `apps/dashboard/app/(dashboard)/coach/components/CoachPortalPageClient.tsx` (modified — row becomes a link)
- `apps/dashboard/locales/en.json` (modified)
- `apps/dashboard/locales/fr.json` (modified)
- `docs/decisions.md` (modified)

### Change Log

- 2026-08-02: Story 5.3 implementation complete — Coach Portal member detail & session notes (AD-15), migration 0041, 27 new pgTAP assertions, 4 new service functions, full dashboard route + client component, i18n, decisions log entry. Status → review.
- 2026-08-02: Code review (3-layer: Blind Hunter, Edge Case Hunter, Acceptance Auditor). 2 decision-needed + 10 patch findings resolved and applied (2 decisions resolved in favor of matching the SELECT policy's stricter check and removing the redundant translation path); 1 patch reclassified to defer during apply after confirming it matches a verified, byte-identical, app-wide convention (`router.push` for filter/sort URL updates, same in `MembersPageClient.tsx`/`SubscriptionsPageClient.tsx`/`AttendancePageClient.tsx`); 3 pre-existing findings deferred; 1 dismissed as non-actionable/informational. Net changes: `edit_session_note()` now re-checks `private.is_assigned_coach()` (edit access revoked on reassignment, matching the SELECT policy); new `session_notes_note_text_len` CHECK constraint; 2 new pgTAP assertions (29 total, plan updated); `getMemberDetail()` now filters `deactivated_at`; `STATUS_BADGE_CONFIG` lookups guarded; `fieldErrorFor()` rewritten to match on Zod issue path/code instead of message text; character counter now trims; textarea `maxLength` + over-limit cue added; note text rendering gets `break-words`; member-row keyboard accessibility added; dead `notAssigned`/`notEditable` locale keys removed, replaced by a dedicated `notSet` key for the goal/experience fallback. `docs/decisions.md` addendum recorded. Full suite re-verified: `supabase test db` 616/616, `pnpm run typecheck` 0 errors, i18n parity clean, eslint clean on all touched files. Status → done.
