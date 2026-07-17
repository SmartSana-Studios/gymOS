---
baseline_commit: 4eb4469c22c5f00c4431ae65baf64388ffa96b59
---

# Story 2.7: Member App — Goal, Experience & Plan Confirmation

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a new gym member,
I want to set my fitness goal and experience level and confirm my assigned plan,
so that my coach has context and I understand my membership terms.

## Acceptance Criteria

1. **Given** profile setup is complete, **when** I select a goal (Lose Weight / Build Muscle / Improve Fitness / General Wellness) and an experience level (Beginner / Intermediate / Advanced), **then** both are saved to my profile and visible to my assigned coach (once assigned). [Source: epics.md#Story 2.7]
2. **Given** my gym's pre-assigned plan, **when** I view the Plan Confirmation screen, **then** I see plan name, duration, price in XAF, activation date, and expiry date as read-only. [Source: epics.md#Story 2.7]
3. **Given** I tap "Confirm and start", **when** the request succeeds, **then** my onboarding data is saved, I'm marked as fully onboarded, and I land on a confirmation/landing state (the full Home screen experience — status badge, quick actions, recent activity — is delivered in Epic 3, Story 3.7). [Source: epics.md#Story 2.7]
4. **Given** a network failure on confirm, **when** the save fails, **then** an inline error appears with a retry option and I remain on the confirmation screen. [Source: epics.md#Story 2.7]

## Scope Notes — Read Before the Tasks

**This story closes out the onboarding flow Story 2.6 started, and it inherits a real, load-bearing bug from that story plus two genuinely undocumented schema/RLS gaps. Read all four notes below before writing code.**

### Scope Note #1 — CRITICAL: the root auth gate currently skips this story's screens entirely

`apps/mobile/src/hooks/use-session.ts`'s `isOnboarded` today is `!!users.display_name` — set the instant MA-05 (Profile Setup, Story 2.6) saves a name. `apps/mobile/src/app/_layout.tsx`'s root navigator gates `(tabs)` on `session && isOnboarded`. **This means a brand-new member is routed straight to `(tabs)` the moment MA-05 completes, skipping MA-06/07/08 (this story's entire screen set) completely** — the exact same class of race Story 2.6's own review caught once already for MA-05 itself (`use-session.ts`'s own comment documents that fix), recurring one step later because the signal it fixed to (`display_name`) was never meant to mean "fully onboarded," only "has a name."

**This story must fix the signal, not just add screens behind it.** Change `isOnboarded` to read the member's **current `members` row's** `onboarding_completed_at` (new column, Task 1) instead of `users.display_name`. "Current" membership = same tie-break the JWT claims hook (`0009_auth_hook_gym_claims.sql`) already uses: `select ... from members where user_id = auth.uid() and deactivated_at is null order by created_at desc, id desc limit 1` (readable via the existing `self_read_own_membership` policy, `0013_dashboard_shell_self_read.sql` — no RLS change needed for this read). Rename the hook's return value if you like (`isFullyOnboarded`, etc.) but the underlying column it reads MUST change.

This also explains why `otp.tsx` (Story 2.6) branches new-vs-returning-account on `users.display_name IS NULL` and sends **both** branches to `/onboarding/goal` (never straight to `(tabs)`) — an existing-account member joining a **second** gym has a `display_name` already set but a brand-new `members` row for this gym with `onboarding_completed_at = null`. They must still go through MA-06/07/08 for the new gym's context (new coach, new plan). Once you fix the gate per this note, that existing routing already does the right thing — do not add a second, competing "is this a new gym membership" check anywhere else.

### Scope Note #2 — New `members` columns + the same self-update RLS gotcha as `users`, again

No column for goal, experience level, or an onboarding-completion marker exists anywhere (`supabase/migrations/0003_members_and_users.sql` through `0019`). Add three nullable columns to `members` in this story's migration:
- `goal text` — one of `lose_weight` / `build_muscle` / `improve_fitness` / `general_wellness`
- `experience_level text` — one of `beginner` / `intermediate` / `advanced`
- `onboarding_completed_at timestamptz`

**Why on `members`, not `users`:** FR-054 and this story's own AC #1 tie goal/experience visibility to "my assigned coach" — coach access is scoped through `coach_assignments` → `members` (Epic 5, not yet built, but the data model must already be gym-scoped, not account-scoped). This is the identical reasoning Story 2.6's Scope Note #2 used to put `display_name`/`photo_url` on `users` instead of `members` (account-level vs. gym-roster fields) — here it points the other way: goal/experience are gym-membership-level facts, matching `members.name`/`members.photo_url`'s own admin-controlled-per-gym precedent, not `users`.

**No DB `CHECK` constraint on the two enum-like text columns** — mirrors `gyms.default_language`/`users.preferred_language`'s existing precedent (validated only by a Zod enum at the app layer, no DB-level constraint, keeping future value additions migration-free). Add `memberGoalSchema`/`experienceLevelSchema` to `packages/types/src/schemas/memberOnboarding.ts`.

**The self-update RLS gap is real and must be closed in the same migration** (the exact "same migration, not a follow-up" discipline `docs/decisions.md#2026-07-16 Story 1.11 Decision 4` and Story 2.6's own migration both already learned the hard way): `members` today has **zero** self-update policy — only `self_read_own_membership` (SELECT, 0013) and `manager_or_owner_update_own_members` (UPDATE, gated to Manager/Owner, 0018). A member has no path to write their own `goal`/`experience_level`/`onboarding_completed_at` at all right now. You must add:
1. A new UPDATE policy, e.g. `self_update_own_member_onboarding_fields`, `using (user_id = auth.uid() and gym_id = private.gym_id()) with check (user_id = auth.uid() and gym_id = private.gym_id())`.
2. A `BEFORE UPDATE` trigger (RLS is row-level, not column-level — same lesson as `protect_self_managed_user_columns`, 0015/0019) that, **only when `auth.uid() = old.user_id`**, pins every column back to `OLD` except `goal`, `experience_level`, and `onboarding_completed_at` — i.e. `name`, `phone`, `email`, `dob`, `photo_url`, `join_date`, `emergency_contact`, `deactivated_at`, `role`, `gym_id`, `user_id` all stay pinned. Without this trigger, a member could self-elevate `role` to `'owner'` or un-deactivate themselves via a raw UPDATE — RLS alone cannot express "this column, not that one."

### Scope Note #3 — Plan Confirmation's data is already readable; the pay-per-session edge case is not

MA-08 needs the member's own subscription + plan. **Both are already readable by a member session, no new RLS needed:**
- `subscriptions`: `gym_staff_read_own_subscriptions` (0018) already includes `exists (select 1 from members m where m.id = subscriptions.member_id and m.user_id = auth.uid())` — a member reading their own subscription already works.
- `plans`: `gym_staff_read_own_plans` (0017) is `using (gym_id = private.gym_id())` with **no role check at all** — any authenticated session with a matching `gym_id` claim (member included) can already read plan rows for their own gym.

Query path: get your own `members.id` (via `self_read_own_membership`, filtered `user_id = auth.uid()`, `deactivated_at is null`, `order by created_at desc, id desc limit 1` — same tie-break as Scope Note #1), then `subscriptions` filtered by `member_id` (order by `created_at desc limit 1` — there's only ever one subscription per member at onboarding time, no renewals have happened yet, but ordering defensively costs nothing), then join to `plans` via `plan_id`.

**Edge case no mockup or AC addresses:** a `pay_per_session` plan has `plans.duration_days = null` (enforced by `plans_duration_days_matches_plan_type` CHECK, `0017`) and its subscription has `subscriptions.expiry_date = null` (enforced by `enforce_subscription_expiry_matches_plan_type` trigger, `0018`). EXPERIENCE.md's MA-08 mockup shows Duration and Expires as always-present fields — for a pay-per-session member these must render a "no fixed duration / no expiry" state instead of blank or `null`-as-text. Since a Manager/Owner can assign any plan type at member creation (Story 2.3), this is a real, reachable case, not a hypothetical.

### Scope Note #4 — Language finalization (already unblocked, easy to miss)

`apps/mobile/src/lib/onboarding-context.tsx`'s own comment: *"`language` is provisional until Story 2.7's MA-08 finalizes it into `users.preferred_language`."* This story is that finalization — MA-08's "Confirm and start" must also write the member's MA-01 language selection to `users.preferred_language`. **No RLS/trigger change needed for this part**: `preferred_language` was never added to `protect_self_managed_user_columns`'s pin-back list at any point (0015 through 0019 pin only `phone`/`is_super_admin`/`created_at`, plus `display_name` until 0019 removed it) — it has been self-writable since Story 1.10. Don't skip this write just because it's easy to miss with no RLS work attached to it.

## Tasks / Subtasks

- [x] **Task 1: Migration — `members` columns, self-update RLS, column-pin trigger** (AC #1, #2; Scope Notes #1/#2)
  - [x] `supabase/migrations/0020_member_goal_experience_plan_confirmation.sql` (verify next-available number at implementation time) — add `goal text`, `experience_level text`, `onboarding_completed_at timestamptz` to `members`.
  - [x] Add `self_update_own_member_onboarding_fields` UPDATE policy on `members`, scoped `user_id = auth.uid() and gym_id = private.gym_id()`.
  - [x] Add a `BEFORE UPDATE` trigger pinning every `members` column except `goal`/`experience_level`/`onboarding_completed_at` back to `OLD` on a self-update (`auth.uid() = old.user_id`) — mirrors `protect_self_managed_user_columns`'s exact shape.
  - [x] No CHECK constraint on `goal`/`experience_level` values (Scope Note #2 — app-layer Zod only, matches `preferred_language`'s precedent).
  - [x] Run `supabase gen types typescript` (or the project's equivalent command) to refresh `packages/types/src/database.ts` with the new columns — do not hand-edit the generated file.

- [x] **Task 2: Zod schemas** (AC #1)
  - [x] Extend `packages/types/src/schemas/memberOnboarding.ts` with `memberGoalSchema = z.enum(["lose_weight","build_muscle","improve_fitness","general_wellness"])` and `experienceLevelSchema = z.enum(["beginner","intermediate","advanced"])`, each with an exported `*Input` type — do not inline these in a component (project's single-source-of-validation rule, restated in the 2.6 Dev Notes).

- [x] **Task 3: Local onboarding-progress state for goal/experience** (AC #1, #3, #4)
  - [x] Extend `apps/mobile/src/lib/onboarding-context.tsx`'s `OnboardingProgressProvider` with `goal`/`experienceLevel` state + setters, matching the existing `language`/`phone` pattern exactly. **Nothing is written to the database until MA-08's Confirm tap** — AC #3/#4 tie the actual save (and its single retry point) to the Confirm action, not to each selection screen; MA-06/07 only update local state and navigate forward.

- [x] **Task 4: MA-06 Goal Selection** (AC #1)
  - [x] Replace the placeholder `apps/mobile/src/app/onboarding/goal.tsx` with the real screen per EXPERIENCE.md's MA-06 mockup: heading "What's your goal?", subtitle, four full-width selection cards (Lose Weight / Build Muscle / Improve Fitness / General Wellness), step indicator "Step 2 of 4" (reuse the exact inline progress-bar markup `profile.tsx` already uses — `TOTAL_STEPS = 4`, `CURRENT_STEP = 2` — no shared component exists yet for this pattern across `profile.tsx`; follow that established precedent rather than introducing a new one for a 2nd usage).
  - [x] Tap a card → selected state (accent border + checkmark, EXPERIENCE.md) → sets local `goal` state via `useOnboardingProgress`. "Continue" disabled until a card is selected; no inline error state (EXPERIENCE.md's own MA-06/07 validation table: "Continue button stays disabled; no inline error").
  - [x] Continue → `/onboarding/experience`.

- [x] **Task 5: MA-07 Experience Level** (AC #1)
  - [x] New `apps/mobile/src/app/onboarding/experience.tsx` — identical layout pattern to MA-06 (EXPERIENCE.md: "Identical pattern to MA-06"), three options (Beginner / Intermediate / Advanced), step indicator "Step 3 of 4".
  - [x] Sets local `experienceLevel` state. Continue → `/onboarding/plan`.

- [x] **Task 6: MA-08 Plan Confirmation** (AC #2, #3, #4; Scope Notes #3/#4)
  - [x] New `apps/mobile/src/app/onboarding/plan.tsx`. On mount: resolve own `members.id` (Scope Note #1's tie-break query), then the member's subscription + joined plan (Scope Note #3). Render plan name, price + currency (`plans.currency`, `plans.price`), a duration/billing label derived from `billing_interval`/`duration_days`, `subscriptions.start_date` (Active from), `subscriptions.expiry_date` (Expires) — **handle the pay-per-session case where `duration_days`/`expiry_date` are both null** (Scope Note #3) with a "no fixed duration" / equivalent state, not a blank or literal "null".
  - [x] Step indicator "Step 4 of 4", informational note ("This plan was set by your gym..."), "Confirm and start" button.
  - [x] On Confirm: single handler performs (a) `members` update — `goal`, `experience_level`, `onboarding_completed_at: now()` — scoped by the new self-update policy (Task 1), and (b) `users` update — `preferred_language` from the local onboarding-context `language` (Scope Note #4). Both writes are idempotent (safe to retry both together — no partial-completion special-casing needed). **Only navigate forward if both succeed**; on any failure, show the inline error + retry per AC #4 / EXPERIENCE.md's "MA-08 | Save failure | Inline below button" and remain on this screen with the same locally-held goal/experience/language state intact for retry (no need to re-fetch or re-select).
  - [x] On success: `router.replace('/(tabs)')` — the existing (still placeholder, Story 2.6's `git mv` of the default Expo template) tabs index screen is this story's "confirmation/landing state" per AC #3's explicit carve-out; Story 3.7 replaces its content with the real Home screen later, no route change needed then.

- [x] **Task 7: Fix the root auth gate** (Scope Note #1 — the critical fix; AC #3)
  - [x] `apps/mobile/src/hooks/use-session.ts`: change the `refreshOnboardedState` query from `users.display_name` to the current-membership tie-break query against `members.onboarding_completed_at` (Scope Note #1). Keep the same fail-closed default (`false`) and the same loading-state discipline already in place.
  - [x] Update `_layout.tsx`'s comments referencing "`users.display_name`" accordingly (the guard expression itself, `!!session && isOnboarded`, does not need to change shape — only what `isOnboarded` measures).

- [x] **Task 8: Sequencing guard** (UX-DR6 precedent already in `_layout.tsx`; AC #1)
  - [x] `apps/mobile/src/app/onboarding/_layout.tsx`: register `experience` and `plan` screens. Extend `SequencingGuard` so `/onboarding/experience` redirects to the nearest missing prerequisite if `goal === null`, and `/onboarding/plan` redirects if `experienceLevel === null` — same "redirect to nearest missing prerequisite, not always to the start" discipline the existing guard already applies to `/otp`/`/profile`/`/goal` (2026-07-17 review finding in Story 2.6).

- [x] **Task 9: i18n (EN/FR parity)**
  - [x] Replace the placeholder `onboarding.goal.title`/`subtitle` keys and add the full set for goal/experience/plan screens (headings, four goal option labels, three experience labels, plan detail labels, the pay-per-session fallback string, the save-failure error string, "Confirm and start" button label) to both `apps/mobile/src/locales/en.json` and `fr.json`.
  - [x] `node scripts/check-i18n-key-parity.mjs` must pass across all 4 locale dirs.

- [x] **Task 10: pgTAP tests** (Task 1's migration)
  - [x] Extend `supabase/tests/member_onboarding_rls.test.sql` (or add a new file scoped to this migration if that file is already unwieldy — dev's call) covering: a member can UPDATE their own `goal`/`experience_level`/`onboarding_completed_at`; a self-update attempting to also change `role`/`deactivated_at`/`gym_id`/`name` in the same statement is silently pinned back (not merely rejected — assert the persisted values, matching `users_self_service_rls.test.sql`'s existing assertion style for the analogous `users` trigger); a different member (or staff role without the gym-scope match) cannot update another member's row via this policy; a member can SELECT `plans`/`subscriptions` for their own gym/subscription (if not already covered by existing tests).
  - [x] `supabase test db` — zero regressions across the full suite (213/213 baseline from Story 2.6, expect additions on top).

- [x] **Task 11: Validation and manual verification**
  - [x] `node scripts/check-i18n-key-parity.mjs`, `pnpm run typecheck` (all 4 packages) — 0 errors.
  - [x] Verify the new RLS/trigger behavior hands-on against the real local Supabase instance (direct RPC/REST, not only pgTAP) — same discipline Story 2.6 established and that this project's own decisions log repeatedly credits with catching real bugs pgTAP alone missed.
  - [x] If no physical device/emulator is available in this environment (Story 2.6's own documented gap), state that explicitly in Completion Notes rather than claiming a device walkthrough that didn't happen — do not repeat a false completion claim.

### Review Findings

- [x] [Review][Patch] Non-atomic parallel writes in `handleConfirm` — sequence the writes instead of `Promise.all`: write `users.preferred_language` first, and only write `members.onboarding_completed_at` (the write that flips the root auth gate) once the `users` write has confirmed success. This ensures a `users` failure can never leave the gate flipped while the language finalization (Scope Note #4) is lost — no transaction/RPC needed. (Fixed 2026-07-18: sequenced writes, `members` last.) [apps/mobile/src/app/onboarding/plan.tsx]
- [x] [Review][Patch] Zero-subscription case is indistinguishable from a genuine network failure and is an unrecoverable dead end. Detect the "no rows" case (PGRST116) separately from a real network/connectivity error and show a distinct message instead of the generic retry-on-network-failure copy. (Fixed 2026-07-18: added a dedicated `noPlanAssigned` state + `errorNoPlanAssigned` copy, distinguished via PostgREST's `PGRST116` code.) [apps/mobile/src/app/onboarding/plan.tsx]
- [x] [Review][Patch] `isOnboarded` gate is never refreshed after "Confirm and start" succeeds, so the member is likely bounced back into onboarding instead of landing on `(tabs)`. `plan.tsx`'s `handleConfirm` writes `members.onboarding_completed_at` via a plain REST update (no `onAuthStateChange` event fires) and immediately calls `router.replace('/(tabs)')` in the same tick. `_layout.tsx`'s `isFullyOnboarded` guard is still computed from the stale, pre-update `isOnboarded` state from `use-session.ts` (only recomputed on `getSession()`/`onAuthStateChange`), so `Stack.Protected guard={isFullyOnboarded}` still excludes `(tabs)` at that moment — undermining Task 7's own gate fix. (Fixed 2026-07-18: `handleConfirm` calls `supabase.auth.refreshSession()` before navigating, forcing a `TOKEN_REFRESHED` event that re-runs `use-session.ts`'s existing `refreshOnboardedState` — no new state-management architecture needed, reuses the hook's own existing `onAuthStateChange` pipeline.) [apps/mobile/src/app/onboarding/plan.tsx, apps/mobile/src/hooks/use-session.ts, apps/mobile/src/app/_layout.tsx]
- [x] [Review][Patch] Back button breaks onboarding navigation — `router.replace` between onboarding steps destroys the back-stack. `goal.tsx`, `experience.tsx`, and `plan.tsx` all use `router.replace` on Continue, but each screen also renders a "←" back button wired to `router.back()`. Since `replace` overwrites the stack entry instead of pushing, tapping back from `/plan` or `/experience` skips past the immediately-prior onboarding step to whatever preceded `/goal` (e.g. `/profile`/`/phone`), silently forcing re-entry of earlier steps despite the local context state (`goal`/`experienceLevel`/`otpVerified`) still being valid. (Fixed 2026-07-18: `goal.tsx` and `experience.tsx`'s Continue handlers now use `router.push`, preserving the back-stack for their own back buttons. `plan.tsx`'s terminal `router.replace('/(tabs)')` on confirm is intentionally unchanged — the point there is exactly to prevent navigating back into onboarding once complete. The pre-existing `otp.tsx`/`profile.tsx` `replace` chain from Story 2.6 is outside this diff's scope and not touched.) [apps/mobile/src/app/onboarding/goal.tsx, apps/mobile/src/app/onboarding/experience.tsx]
- [x] [Review][Patch] No row-count verification on the `members`/`users` updates in `handleConfirm` — a zero-row update (e.g. a stale JWT `gym_id` claim, or the member row was deactivated mid-flow) returns `error: null` under PostgREST and is treated as a full success, navigating to `(tabs)` even though nothing was actually written. (Fixed 2026-07-18: both updates now `.select('id')` and check the returned row count.) [apps/mobile/src/app/onboarding/plan.tsx]
- [x] [Review][Patch] Subscription lookup has no `status` filter — orders purely by `created_at desc` with `limit(1)`, so a member with more than one subscription row (renewal, plan change) can be shown and have confirmed an inactive/expired/superseded plan rather than their actual active one. (Fixed 2026-07-18: added `.eq('status', 'active')`.) [apps/mobile/src/app/onboarding/plan.tsx]
- [x] [Review][Patch] `handleConfirm` can silently no-op with no user feedback — the function early-returns if `goal`/`experienceLevel` are null, but the Confirm button's `disabled` prop only checks `!plan || loading || submitting`, never `goal`/`experienceLevel`. A desynced context (e.g. after a remount/race) leaves the button looking enabled while tapping it does nothing. (Fixed 2026-07-18: `disabled` now also checks `!goal || !experienceLevel`.) [apps/mobile/src/app/onboarding/plan.tsx]
- [x] [Review][Patch] Unsafe manual type cast (`subscriptionData as unknown as SubscriptionRowFromDb`) around the embedded Supabase select bypasses type-checking entirely; if the runtime shape ever diverges from the assumed type, it fails silently into the generic load-error state with no diagnostic signal pointing at the real cause. (Fixed 2026-07-18: replaced the cast with an `isSubscriptionRow` runtime type guard.) [apps/mobile/src/app/onboarding/plan.tsx]
- [x] [Review][Patch] i18n pluralization bug — `"durationDays": "{{count}} days"` (and the French `"{{count}} jours"`) renders "1 days" for a 1-day plan; no i18next plural key variants are used. (Fixed 2026-07-18: split into `durationDays_one`/`durationDays_other` in both locale files, using i18next's built-in plural-key resolution.) [apps/mobile/src/locales/en.json, apps/mobile/src/locales/fr.json]
- [x] [Review][Patch] pgTAP coverage gap — the new tests only assert the positive case for `gym_staff_read_own_plans` (a member can read their own gym's plans); there's no negative test proving a member of gym A cannot read gym B's plans, despite the test file's own comment flagging this policy as having "no role check at all," which is exactly the kind of policy most in need of a negative-case test. (Fixed 2026-07-18: added a second plan fixture on Gym B and an assertion that Member A's session cannot see it; `plan(13)` → `plan(14)`.) [supabase/tests/member_onboarding_completion_rls.test.sql]
- [x] [Review][Defer] Unrelated schema churn bundled into `database.ts` regeneration (`otp_resend_attempts`, `check_otp_resend_allowed`, `record_otp_resend`, `caller_has_membership`, `phone_has_membership`, `users.photo_url`, and `gym_effective_member_cap`'s return type narrowing from `number | null` to `number`) [packages/types/src/database.ts] — deferred, pre-existing (the story's own Debug Log explains these reflect drift from migration 0019 that had never been captured by a `gen-types` run until this story; not introduced by Story 2.7's actual schema changes). The `gym_effective_member_cap` null→non-null narrowing specifically is worth a follow-up check that no downstream code relies on it possibly being null.

## Dev Notes

- **The critical fix in this story is Task 7, not the new screens.** Building MA-06/07/08 without fixing `isOnboarded`'s underlying signal (Scope Note #1) ships three screens a real new member will never see, because the root gate already routes them past onboarding after MA-05.
- **This story does not introduce `apps/mobile/src/services/`.** Story 2.6 established (despite architecture.md's mention of `apps/mobile/services/`) that mobile screens call `supabase-js` directly — no dedicated services layer exists yet. Follow that actual precedent (call Supabase directly from `plan.tsx`/`goal.tsx`/`experience.tsx`), not the not-yet-real documented pattern.
- **Read Scope Notes #1–#4 before writing any migration or screen code** — each heads off a specific, real mistake: shipping screens nobody reaches, an RLS gap that silently blocks every write, a blank/null Plan Confirmation screen for pay-per-session members, and a silently-skipped language finalization.
- EN/FR parity (FR-016) is a CI gate on every prior story; apply the same standard here even though `apps/mobile`'s own lint still isn't wired into CI (a pre-existing, already-logged gap from Story 2.6 — not this story's job to fix).
- Zod schemas for this story's new writes belong in `packages/types/src/schemas/memberOnboarding.ts`, alongside `phoneEntrySchema`/`otpCodeSchema`/`profileSetupSchema` — not inlined in a screen component.

### Project Structure Notes

New files:
```
supabase/migrations/0020_member_goal_experience_plan_confirmation.sql   # exact number TBD — verify next-available
apps/mobile/src/app/onboarding/experience.tsx                            # MA-07
apps/mobile/src/app/onboarding/plan.tsx                                 # MA-08
```

Modified files:
```
apps/mobile/src/app/onboarding/goal.tsx           # MA-06 — placeholder replaced with the real screen
apps/mobile/src/app/onboarding/_layout.tsx        # register experience/plan screens, extend SequencingGuard
apps/mobile/src/lib/onboarding-context.tsx        # + goal, experienceLevel local state
apps/mobile/src/hooks/use-session.ts              # isOnboarded now reads members.onboarding_completed_at, not users.display_name
apps/mobile/src/app/_layout.tsx                   # comment updates only (guard expression shape unchanged)
apps/mobile/src/locales/en.json / fr.json         # new keys, placeholder goal.* keys replaced
packages/types/src/schemas/memberOnboarding.ts    # + memberGoalSchema, experienceLevelSchema
packages/types/src/database.ts                    # regenerated via supabase gen types, not hand-edited
supabase/tests/member_onboarding_rls.test.sql      # extended (or a new sibling file) for the new self-update policy/trigger
```

No changes to `apps/dashboard` or `apps/super-admin` — this story is entirely mobile + backend (migration), same footprint shape as Story 2.6.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.7] — literal AC wording
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md#MA-06 through MA-08] — exact layouts, copy, step-indicator numbering, interaction/error states
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md line 272] — "Language stored as provisional preference; finalised when account is created at MA-08" (Scope Note #4)
- [Source: _bmad-output/implementation-artifacts/2-6-member-app-phone-otp-onboarding-through-profile-setup.md] — direct predecessor; establishes the `apps/mobile/src/` scaffold, the direct-Supabase-call convention, `users.display_name IS NULL` new-account signal, and the `isOnboarded` gate this story must fix
- [Source: apps/mobile/src/hooks/use-session.ts, apps/mobile/src/app/_layout.tsx] — the exact gate this story changes (Scope Note #1)
- [Source: apps/mobile/src/lib/onboarding-context.tsx] — "Story 2.7's MA-08 finalizes it into users.preferred_language" (Scope Note #4), existing local-state pattern to extend (Task 3)
- [Source: apps/mobile/src/app/onboarding/profile.tsx] — inline step-indicator/progress-bar markup pattern to reuse for MA-06/07/08 (no shared component exists yet)
- [Source: supabase/migrations/0003_members_and_users.sql, 0013_dashboard_shell_self_read.sql, 0017_membership_plan_configuration.sql, 0018_member_management.sql, 0019_member_onboarding_otp.sql] — current `members`/`plans`/`subscriptions`/`users` schema and RLS baseline this story extends; 0018's `gym_staff_read_own_subscriptions` and 0017's `gym_staff_read_own_plans` already cover MA-08's reads (Scope Note #3); 0015/0019's `protect_self_managed_user_columns` is the exact trigger shape to replicate for `members` (Scope Note #2)
- [Source: supabase/migrations/0009_auth_hook_gym_claims.sql] — "most-recently-created, non-deactivated membership wins" tie-break, reused for resolving "current membership" client-side (Scope Notes #1/#3)
- [Source: docs/decisions.md#2026-07-16 Story 1.11 Decision 4] — "same migration, not a follow-up" precedent this story's RLS/trigger pairing must follow
- [Source: packages/types/src/schemas/memberOnboarding.ts, member.ts, locale.ts] — existing schema conventions (local per-file consts, no cross-file sharing) to match for the two new schemas
- [Source: apps/dashboard/services/members.ts createMember/insertSubscription] — confirms a member's plan/subscription is already created at Story 2.3 member-creation time; this story only reads it, never creates it
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — existing logged gaps (mobile lint not in CI, etc.) this story does not need to re-fix

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- `supabase db reset` applied migrations 0001–0020 cleanly on the first attempt (local WSL Supabase instance, container `supabase_db_gym_os`).
- `supabase gen types typescript --local` regenerated `packages/types/src/database.ts`. This also picked up pre-existing gaps from Story 2.6 that had never been regenerated after `0019_member_onboarding_otp.sql` (`users.photo_url`, `otp_resend_attempts`, `phone_has_membership`, etc.) — not new scope, just the documented "run gen-types" task step producing a complete, accurate file for the first time since 0019.
- `supabase test db`: 14 files, 226 tests, all passing (213 prior baseline + 13 new in `member_onboarding_completion_rls.test.sql`).
- `pnpm run typecheck`: 4/4 packages pass, 0 errors.
- `node scripts/check-i18n-key-parity.mjs`: 4/4 locale dirs in parity (62 keys in `apps/mobile/src/locales`).
- Manual hands-on verification (Task 11, direct SQL against the live container, not pgTAP): seeded a real fixture, ran a self-update as an `authenticated` member session (`set local role` + `request.jwt.claims`) attempting to set `goal`/`experience_level`/`onboarding_completed_at` alongside `role='owner'` and a `name` change in the same statement, then re-queried as `postgres` (bypassing RLS) to inspect what actually persisted. Confirmed: `goal`/`experience_level`/`onboarding_completed_at` updated; `role` stayed `'member'` and `name` stayed unchanged — the trigger's column-pin fired as designed. Fixture rows deleted afterward (real commits, not a rolled-back transaction).

### Completion Notes List

- Task 1's migration follows the exact `protect_self_managed_user_columns` (0015/0019) shape for the new `protect_self_managed_member_columns` trigger, gated on `auth.uid() = old.user_id`, pinning every column except `goal`/`experience_level`/`onboarding_completed_at`.
- No RLS changes were needed for MA-08's subscription/plan reads or the `users.preferred_language` write (Scope Notes #3/#4) — verified the existing policies already cover both, matching the story's own analysis.
- `database.ts` regeneration surfaced (and fixed) a pre-existing drift from Story 2.6 that had gone unnoticed until this story's own gen-types step ran — flagged above in Debug Log References, not treated as this story's bug to introduce a workaround for.
- No physical device/emulator was available in this environment — no on-device walkthrough was performed. Verification for the mobile screens relied on `pnpm run typecheck` (0 errors across all 4 packages) and manual code review against the EXPERIENCE.md MA-06/07/08 mockups and interaction rules; this mirrors the same documented gap Story 2.6 already logged, not a new one.
- New pgTAP coverage was added as a sibling file (`member_onboarding_completion_rls.test.sql`) rather than extending `member_onboarding_rls.test.sql`, since that file's own header comment scopes it to the four pre-authentication OTP RPCs (run as `anon`) — the new self-update policy/trigger tests run as `authenticated` with real `members` row fixtures, a different enough shape to warrant a sibling file per the story's own "dev's call" allowance.

### File List

**New:**
- `supabase/migrations/0020_member_goal_experience_plan_confirmation.sql`
- `apps/mobile/src/app/onboarding/experience.tsx`
- `apps/mobile/src/app/onboarding/plan.tsx`
- `supabase/tests/member_onboarding_completion_rls.test.sql`

**Modified:**
- `apps/mobile/src/app/onboarding/goal.tsx`
- `apps/mobile/src/app/onboarding/_layout.tsx`
- `apps/mobile/src/lib/onboarding-context.tsx`
- `apps/mobile/src/hooks/use-session.ts`
- `apps/mobile/src/app/_layout.tsx`
- `apps/mobile/src/locales/en.json`
- `apps/mobile/src/locales/fr.json`
- `packages/types/src/schemas/memberOnboarding.ts`
- `packages/types/src/database.ts`
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (workflow status tracking)

## Change Log

- 2026-07-18: Story implemented — migration + RLS/trigger for `members.goal`/`experience_level`/`onboarding_completed_at`, MA-06/07/08 screens, root auth gate fix (`isOnboarded` now reads `members.onboarding_completed_at`), sequencing guard extension, EN/FR i18n, pgTAP coverage. All 4 ACs satisfied; 226/226 pgTAP tests pass; typecheck and i18n-parity clean. Status set to `review`.
- 2026-07-18: Code review (Blind Hunter + Edge Case Hunter + Acceptance Auditor) found the `isOnboarded` gate was never refreshed after confirm (so the root gate fix in Task 7 didn't actually reach the member), a back-button/navigation-stack bug across the three new screens, a non-atomic partial-write risk on Confirm, a zero-subscription dead end, plus several smaller gaps (row-count verification, subscription status filtering, an unsafe type cast, an i18n plural bug, and an RLS negative-test gap). All 10 patch findings fixed and 2 decision-needed findings resolved with the user; 1 unrelated pre-existing schema-churn item deferred. 227/227 pgTAP tests pass (14 files); typecheck (4/4 packages) and i18n-parity clean. Status set to `done`.
