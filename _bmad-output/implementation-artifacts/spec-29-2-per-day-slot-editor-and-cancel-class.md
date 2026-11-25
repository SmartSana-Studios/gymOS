---
title: '29-2 Per-day slot editor and cancel class'
type: 'feature'
created: '2026-11-20'
status: 'done'
baseline_commit: '236efca91f501c4ab869155f5025a9398d57b125'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-29-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/epics.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 29.1 stores a recurring class's times as slot rows, but no function accepts per-day times, no screen edits them, an edit cannot report the booked sessions it left alone, and a class that will not run again cannot be ended. The member app has no way to show a cancelled class.

**Approach:** One migration adds `p_slots` overloads of `create_class` and `update_class` (the latter returns `left_unchanged`), `cancel_class`, the cancelled columns and guards, the `class_sessions_with_match` view and the reshaped `list_my_classes`. The dashboard gets the weekly-times editor, result view, Schedule grouping, Cancelled badge, "Old time" tag and Cancel dialog; the member app shows a Cancelled badge. Acceptance criteria are Story 29.2 in `_bmad-output/planning-artifacts/epics.md` (lines 7209-7281); UX is `EXPERIENCE.md` AD-18, AD-19 and the Group F table (lines 973-1010, 1048-1065).

## Boundaries & Constraints

**Always:**
- One migration `0181_class_slot_editor_and_cancel.sql` (0180 is the head) with `scripts/rollback-0181-*.sql` (0180's conventions; it refuses while any class has null legacy columns or any class or session is cancelled) and a `do $verify$` block. Regenerate `packages/types/src/database.ts`.
- Old `create_class` / `update_class` signatures keep working unchanged (existing suites pass without edit). They may delegate to the new overloads. Both overloads and `cancel_class` carry the `current_gym_status() is distinct from 'active'` guard with the phrase "is not active" and no comments in the body, end with `revoke ... from public, anon`, and read the role live (`private.current_member_role()`), never the claim.
- `p_slots` is `[{weekday 0..6, start_time "HH:MM"}]`; null (or JSON null) means "not supplied". Stable refusals, each its own message prefixed with the function name: none for recurring, over 14, bad weekday, bad time, seconds, duplicate, slots on a one-off. A per-day class stores `recurrence_days` and `recurrence_time` as null; `update_class` and `create_class` call `private.apply_class_slots` (the only regeneration path; lock order class, then sessions in `scheduled_at` order).
- `update_class(..., p_slots)` returns `{left_unchanged: [{class_session_id, scheduled_at, booked_count, capacity}]}` (empty array when none; never an error for bookings). Recurring-to-recurring, one-off-to-recurring and recurring-to-one-off follow the slot rule (booked non-matching future sessions are kept and listed, unbooked ones deleted, past untouched); only one-off-to-one-off keeps the 0058 refusal.
- `cancel_class` flags, never deletes: `classes.cancelled_at/cancelled_by`, future `class_sessions.cancelled_at`; bookings, past sessions and attendance stay. Audit via `log_audit_event`: `class_times_changed` (class name, old and new times, left-unchanged count, written only when the times changed) and `class_cancelled` (class name, bookings cancelled). No notification of any kind on cancel (owner decision 2026-11-15; add it to `docs/decisions.md`). `create_class` writes no new audit row: the dashboard's existing `class_created` covers it.
- The Schedule column, editor, dialog and badges follow the UX text and Group F keys; all strings EN and FR (dashboard locales, mobile catalog); `check-i18n-key-parity` passes.

**Never:**
- No Coach access to any of this (29.3), no picker (29.4), no single-session cancel, no notification, no change to the rolling window or to booking and capacity rules.
- No new table, no write grant on `class_schedule_slots`, no RLS policy change on `classes`/`class_sessions`; `cancel_class` is not in `private.support_capabilities` (totals and name lists unchanged; only the 'supervisor' classification list gains `cancel_class` and any redefined function that now names it).
- Never delete a session that has a booking; never show "migrated" anywhere.

**Decisions (recorded with the product owner, 2026-11-20):**
- "Old time" tag: only the expanded row's session (the next session) is tagged, when it is a booked future session that no longer matches. Other kept sessions are visible only in the result view.
- Mobile test: no new test infrastructure. The Cancelled badge is covered by a service test of the `class_cancelled` mapping and pure helpers (row state, Home filter) in `.test.ts` files; this is the accepted reading of the AC's "mobile component test".
- Spec kept whole (one goal across database, dashboard and mobile).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Move a time | Mon 07:00 booked, edit to 07:30 | new 07:30 session created; 07:00 kept, listed in `left_unchanged` with booked_count and capacity | never raises |
| Repeat edit | same payload twice | same `left_unchanged`, no row changes | idempotent |
| Day removed, unbooked | future session no longer matches | deleted | N/A |
| 14 then 15 | 14 slots, 15th sent | refused (stable message) | N/A |
| Re-apply at 14 | same 14 slots | accepted, no change | N/A |
| Type switch with bookings | recurring to one-off, or one-off to recurring | follows slot rule, booked sessions listed | one-off to one-off still refused |
| Old signature | dashboard of the previous release | works as today | N/A |
| Cancel class, 8 bookings | Manager and above | `{bookings_cancelled: 8}`; flags set; audit row; no notification row | N/A |
| Cancel again | already cancelled | stable "already cancelled" message | `classes.cancel.already` |
| Cancel, other gym, missing, Receptionist, Coach, member, Support | any | uniform not-found or permission refusal, no gym information | N/A |
| Cancelled class | daily job, `update_class`, `materialize_class_sessions`, `book_class_session`, `mark_class_attendance`, `cancel_class_booking`, reminder job | nothing created or changed; each refusal has its own stable message; no reminder dispatch row | member keeps the booking on record |
| Member lists | `list_bookable_class_sessions`, `list_my_class_bookings` | cancelled omitted from bookable; bookings carry `class_cancelled`, `can_cancel` false | N/A |
| Old-time tag | future booked session not matching the slots | `matches_slots` false; one-off always true | gym B reader sees no gym A rows |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0180_class_schedule_slots.sql` -- live `create_class` (462), `update_class` (514, type switch 547-582), `materialize_class_sessions` (611), `private.apply_class_slots` (371, returns only booked non-matching rows; add capacity in the caller), `private.materialize_sessions_for_class` (311, add cancelled early return), CHECK `classes_schedule_matches_type` (198-209, already allows null days and time).
- `supabase/migrations/0124_*.sql` -- latest `book_class_session` (579), `cancel_class_booking` (689), `list_bookable_class_sessions` (1761), `list_my_class_bookings` (1801); `0179` -- `mark_class_attendance` (222); `0096:113` -- `list_my_classes` (drop and re-create; reads `recurrence_days/time` at 165); `0059:423` -- `run_class_reminder_job` (filter), `0084:462` -- `send_class_reminder`. Redefine with minimal diffs from these bodies.
- `supabase/migrations/0173_attendance_counting.sql:118` -- `security_invoker` view pattern with `reloptions` self-check; `gyms.timezone` (0002) for the slot match. Check `gyms` read RLS for every role that reads the view.
- `supabase/tests/support_capabilities.test.sql` -- `'excludes'` classification list near 163-175 gains `cancel_class` (and the new overloads share the existing names); `suspension_rpc_coverage.test.sql` -- guard scan, pinned counts unchanged (no new table). Model new suites on `class_schedule_slots*.test.sql`; extend `scripts/class-slot-race.sh` with cancel-vs-book if cheap.
- `apps/dashboard/app/(dashboard)/classes/` -- `components/ClassesPageClient.tsx` (`scheduleSummary` 147-163, `canManage` 68, actions column 229-242, expanded row 244-336, `showToast` 59-63), `components/ClassModal.tsx` (days checkboxes 395-408, `formFromClass` 75-96, submit 183-215, native `<dialog>`), `actions.ts` (`createClass` 19, `editClass` 77, `logClassChange`), existing tests `ClassesPageClient.schedule.test.tsx` (must keep passing: migrated class reads "Tue, Thu 18:00").
- `apps/dashboard/services/classes.ts` -- `ClassRow` 75-99, `listClasses` 155 (select list 165; embed slots and `cancelled_at`), `listMyClasses` 337, `insertClass` 482, `updateClass` 516 (pass `p_slots`, return `left_unchanged`), `ClassWriteInput` 462; `packages/types/src/schemas/class.ts:40-73` (recurring now needs 1..14 slots, not days and time).
- `apps/dashboard/app/(dashboard)/coach/classes/page.tsx:98-107` and `services/classes.listMyClasses.test.ts` -- read slots, show the Cancelled badge for a cancelled class.
- `apps/dashboard/app/(dashboard)/audit/auditLabels.ts` (map to ~147), `components/AuditLogPageClient.tsx` (details chain 316-321), locales `audit.actionTypes` (en.json ~1986); copy `auditLabels.epic27.test.ts`.
- Confirm dialog: copy `settings/staff/components/DeactivateStaffDialog.tsx` (native dialog, Escape fully disabled). Badge: `components/ui/badge.tsx` (`secondary` or `outline`).
- `apps/mobile/src/services/classes.ts` (`MyClassBookingRow` 163-168, mapping 186-192), `app/(tabs)/classes/index.tsx` (renderItem 445-473, action cell 458-472), `app/(tabs)/index.tsx` (filter before `.slice` at 385-386, render 705-727), `components/ui/Badge.tsx` with neutral `STATUS_COLORS.no_plan`, locales `classes.bookings.*` (en.json 222-253).
- `apps/dashboard/e2e/class-booking-capacity.spec.ts` and `fixtures/seed.ts:314-354` -- model for `class-weekly-times.spec.ts` (plain `tr` locator, `signInForApi` and `callRpc` for the member booking; class names are stored upper-case).

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0181_*.sql` and `scripts/rollback-0181-*.sql` -- columns, overloads, `cancel_class`, guards in the listed functions, view, `list_my_classes`, audit rows, verify block -- the whole data half
- [x] `supabase/tests/class_slot_editor.test.sql`, `class_cancel.test.sql` and `.negative.test.sql` -- the I/O matrix, per-role refusals incl. gym B Manager, no notification row, reminder, old signatures, view isolation; update 29.1's type-change refusal test for the new rule; extend `support_capabilities.test.sql`
- [x] `packages/types` (schema, `database.ts`), `apps/dashboard/services/classes.ts`, `classes/actions.ts` -- slots through the stack, `cancelClassAction`, error mapping
- [x] `ClassesPageClient.tsx`, `ClassModal.tsx` (+ result view, cancel dialog components), coach page, audit labels and details -- the UI, with component tests (fixtures: one, three, four groups, one-off, migrated; Receptionist DOM; modal rows, counter, limit, duplicate, sort announce, result view, dialog Escape)
- [x] `apps/mobile` services, MA-16, Home, locales -- Cancelled badge, Home drops cancelled before its `.slice`, a `classes.test.ts` service test (rpc mock as in `checkin.test.ts`) and pure-helper tests
- [x] `apps/dashboard/e2e/class-weekly-times.spec.ts`, EN and FR locales, `docs/decisions.md`, `deferred-work.md`, `sprint-status.yaml` -- E2E golden path, strings, records

**Acceptance Criteria:**
- Given Story 29.2's criteria in `epics.md` (7209-7281), when pgTAP, vitest, the E2E spec and `scripts/ci-local.sh` (via `bash`) run, then every criterion has a named passing test, existing suites pass without edit except the tests this spec names, and no new `claim-only` entry or guardrail failure appears.
- Given the rollout window, when the old dashboard calls the old signatures after the migration, then behaviour is unchanged.

### Review Findings

Code review pass 2 of the merged story (2026-11-20, `git diff 46d90ae 0bd84f8`), chunk 1 of 2: `supabase/` and `scripts/` only. The dashboard, mobile and types chunk is not yet reviewed. Four layers (Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor); 34 raw findings, 2 decision-needed (both resolved, now patches), 4 patch, 0 defer, rest rejected.

- [x] [Review][Patch] (decided 2026-11-20: refuse) `cancel_class` accepts a class with nothing left to cancel (BH, EC) — a finished one-off, or any class with no future session, is flagged cancelled, returns `bookings_cancelled: 0` and writes a `class_cancelled` audit row. Fix: raise `cancel_class: class % has nothing left to cancel` when no session has `scheduled_at > now()`, with a pgTAP case (finished one-off refused, nothing flagged, no audit row) and a dashboard check that the refusal maps to a readable error. [supabase/migrations/0181_class_slot_editor_and_cancel.sql:502-511]
- [x] [Review][Patch] (decided 2026-11-20: leave as is, say so) A one-off to one-off reschedule writes no `class_times_changed` row (BH, EC, AA) — `class_edited` already records it and the label reads "weekly times". Fix: state in the 0181 header and `docs/decisions.md` that `class_times_changed` is written only when a recurring side is involved; no behavior change. [supabase/migrations/0181_class_slot_editor_and_cancel.sql:1-45]
- [x] [Review][Patch] `cancelled_at` is read without the session lock in `mark_class_attendance`, `cancel_class_booking` and `private.send_class_reminder`, so a `cancel_class` committing in between is missed (BH, EC, VG) — worst case: attendance marked and a guest session consumed on a cancelled session, a booking deleted after it was counted, a reminder sent. Fix: take the session lock (`for no key update` / `for update of cs`, same order as `book_class_session`) before the check, or recheck after it; add the cases to `scripts/class-slot-race.sh` and show them able to fail. [supabase/migrations/0181_class_slot_editor_and_cancel.sql:771, 847, 891, and `send_class_reminder`]
- [x] [Review][Patch] The old 10-argument `update_class` wrapper's "whole minute, without seconds" refusal has no test (VG) — deleting the guard leaves 28 class, support and suspension files green, and `classes.recurrence_time` then reads 07:00:30 while the slot and sessions are 07:00. Add a `throws_like` with `'07:00:30'` on a recurring class and assert slots and `recurrence_time` unchanged; bump `plan(126)`. [supabase/migrations/0181_class_slot_editor_and_cancel.sql:430, supabase/tests/class_slot_editor.test.sql:467]
- [x] [Review][Patch] The per-role negative matrix is narrower than the AC (AA) — missing for Receptionist, Coach and member: direct write to `class_schedule_slots` (member only today), direct `insert into classes` (Coach only), `create_class` old signature as a member. Add the missing assertions and bump the plan. [supabase/tests/class_cancel.negative.test.sql:90-111, 161-175]
- [x] [Review][Patch] The rollback guard reads the cancelled and per-day state with no table lock, so a `cancel_class` or per-day edit committing before the column drops is lost silently (BH, EC) — take `lock table public.classes, public.class_sessions in share row exclusive mode` before the guard. [scripts/rollback-0181-class-slot-editor-and-cancel.sql:139-166]

#### Rejected

- `mark_class_attendance` refuses a cancelled session before the already-attended early return (EC) — false: the spec refuses attendance on a cancelled class, a retry on one is meant to error.
- `list_my_classes` shows a session earlier today under a cancelled class (EC) — false: `cancel_class` flags only future sessions, so a session that already ran is a real session and stays listed.
- One-off legacy columns nulled by the old wrapper (EC) — false: `classes_schedule_matches_type` requires `recurrence_days` and `recurrence_time` null on a one-off.
- Null `p_recurrence_start_date` creates a recurring class with no sessions and no error (BH) — false: the same constraint requires `recurrence_start_date` on a recurring class, so the insert fails.
- `date_trunc('minute', time) <> time` relies on a fragile cast (BH) — false: it works and runs in the passing suites.
- `race.sh` case 4 breaks above 115 iterations (EC) — low: only with an env override, default is 50.
- Coach roster `list_my_class_session_roster` has no cancelled marker (EC) — low: it is not touched by 0181 and the coach list never offers a cancelled session.
- `matches_slots` is true for leftover recurring sessions after a switch to one-off (BH) — low: the spec's table says "one-off always true"; the result view lists those sessions at edit time.
- The seconds refusal and the extra audit row on the old wrapper are not in the header (AA) — low: header wording only, behavior follows the slot rule.
- Existing suites edited beyond those the spec names (AA) — low: recorded in `docs/decisions.md`.
- `create_class` writes no audit row though the AC says it does (AA) — low: the spec's own constraint says `class_created` covers it; the spec wins.
- `bookings_cancelled` naming, no un-cancel, rollback refusing after the first cancel (BH) — low: named by the spec, rollback refuses by design so data is not lost.
- Capacity cut below bookings not reported, old-client `list_my_classes` columns, validation gaps (unknown slot keys, coach role), no index on `classes.cancelled_by`, weak `$verify$` position checks, hard-coded plan counts, race cleanup deleting audit rows, `ci-local.sh` comment (BH) — low: pre-existing semantics, already disclosed in the header or deferred-work, or a developer-only cosmetic with a fix that adds more than it saves.
- Roster, comment and claim-only items from the Edge Case Hunter that repeat the race finding above — merged into it.

#### Review pass 2, chunk 2 of 2 (apps/ and packages/, 2026-11-20)

Same four layers; about 42 raw findings, 0 decision-needed, 6 patch, 1 defer, the rest rejected. The diff was `git diff 46d90ae -- apps packages`, which includes the uncommitted nothing-left mapping from chunk 1.

- [x] [Review][Patch] After a `class_nothing_to_cancel` refusal the Cancel dialog still offers [Cancel class], which can only fail again (AA, EC) — a result of the chunk 1 patch. Hide the confirm button for that code too (like `class_already_cancelled`) and cover it with a component test. [apps/dashboard/app/(dashboard)/classes/components/CancelClassDialog.tsx:51]
- [x] [Review][Patch] `listClasses()` derived fields have no test that reads their values (VG, BH) — the `cancelled_at` filter on the sessions fetch, `upcomingBookingCount` (only sessions with `scheduled_at > now`, what `cancel_class` counts), `nextSessionMatchesSlots` (null for a session that has started), the `slots` mapping. Removing the `> now` guard or the filter fails nothing. Add `services/classes.listClasses.test.ts` on the recording-stub pattern of `classes.countClassSessionsBetween.test.ts`. [apps/dashboard/services/classes.ts:174-285]
- [x] [Review][Patch] The `audit_log_failed` edit path (class saved, audit write failed) is untested (VG) — the result view with its warning, [Done] calling `onSaved(warning)`, and `editClass` returning `leftUnchanged` when `logClassChange` fails. Add the case to `ClassesPageClient.weeklyTimes.test.tsx` and a small `editClass` action test. [apps/dashboard/app/(dashboard)/classes/components/ClassModal.tsx:322-345]
- [x] [Review][Patch] The "already cancelled" refresh is unverified (VG) — after the message, [Keep class] must call `router.refresh()`, and the ordinary [Keep class] must not. Extend the existing test. [apps/dashboard/app/(dashboard)/classes/components/ClassesPageClient.weeklyTimes.test.tsx]
- [x] [Review][Patch] The Coach My Classes page can show "Old time" on a session that already ran today (EC) — `listMyClasses` maps `matchesSlots: row.matches_slots !== false` and the page lists sessions from 00:00 today, while `listClasses` suppresses the tag once a session has started. Treat a started session as matching, with a test in `classes.listMyClasses.test.ts`. [apps/dashboard/services/classes.ts:449]
- [x] [Review][Patch] `locales/en.json` and `locales/fr.json` lost their trailing newline in this story (BH, VG, AA) — the base commit has one. Restore it. [apps/dashboard/locales/en.json, fr.json]
- [x] [Review][Defer] `listClasses()` is unbounded against `max_rows = 1000` and the dialog count now depends on it (EC, BH) — deferred: the query is pre-existing, its consequence is new; recorded in deferred-work.md with what would settle it.

##### Rejected (chunk 2)

- Edit of a class cancelled in another tab keeps an unsavable Save and does not refresh (EC) — low: the message shows, the stale-tab case is rare and the fix adds a refresh path.
- Re-sort on row blur can swallow the click that caused the blur (BH, EC) — low here: sorting on blur is required by AD-19 and the worst case is a repeated click (no handler runs); a note for the owner's browser QA, not a code change.
- `setAnnouncement` inside the `setForm` updater (EC) — low: same component, same string, no demonstrated harm; the story's first triage already rejected it.
- Focus after Remove, after a successful cancel, after create, and not moved to the first invalid row on a failed submit (BH, EC) — low: the first triage rejected "focus after Remove"; the rest are the same class and a browser-QA item.
- Second Escape closes the Cancel dialog in Chromium (EC) — maybe-false and low: browser behavior, a note for browser QA.
- `formatLeftRow` can throw on an invalid zone (EC), `getClassesGymTimezone` error dropped and an extra query (BH, AA), `slotsFromMetadata` weekday range (EC, BH), `parseLeftUnchanged` NaN (BH) — low: the zone and the metadata come from validated database columns and server functions; the gymTimezone wiring test is already deferred.
- `mapAlreadyCancelled` too broad, or text-based instead of a code (EC, BH) — false for the first (only class functions raise "already cancelled"); the second follows the repo's convention.
- Dialog count is a page-load snapshot and the toast omits the server count (EC, BH) — low: the UX toast text is "{{name}} cancelled."; the real count is in the audit row. The consequence beyond 1000 sessions is the deferred item.
- Unused `classes.coach.ownOnly` key (BH) — low: Group F baseline for Story 29.3, which uses it.
- 14 hard-coded in copy, French "cours" for session, separate `left.title` / `title1` keys (BH) — low: the copy is the UX Group F text (AA checked every string against it).
- Mobile Cancelled badge reuses `STATUS_COLORS.no_plan` (BH) — low: a recorded decision in `docs/decisions.md`.
- Coach overview or caseload may show cancelled sessions (BH) — false: `list_my_classes` excludes cancelled sessions in SQL and `coach/classes/page.test.tsx` covers the badge.
- Left-unchanged sessions visible only in the one-time result view (BH) — low: the spec's Design Notes decide it.
- Weak or narrow tests: four slots sliced to three, no `rowsFromSlots` or `compareSlots` cases, audit cells read by index, English e2e strings, no receptionist e2e, UTC start date in the e2e (BH) — low: the component and unit suites cover the role DOM absence and the rules; none is a defect.
- Invented strings outside Group F (`times.error.summary`, `times.done`, day names), no [✕] on the Cancel dialog, result view after every edit, sort-on-save announcement lost on success, existing component tests edited for the new shape, the time-zone line vanishing on a failed read (AA) — low: reasonable copy or defensible readings with no acceptance criterion broken; the Escape-less dialog follows `DeactivateStaffDialog`.

## Implementation Notes

## Spec Change Log

## Review Triage Log

Pass 1 (blind / edge-case / verification-gap). Verdict, then route. Layers: blind-hunter (BH), edge-case-hunter (EC), verification-gap (VG).

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| Overview "Today's classes" still counts cancelled sessions (BH, EC) | medium | patch | `countClassSessionsBetween` has no `cancelled_at` filter; the flag this story adds makes the count wrong the moment a class is cancelled. Fix is one filter plus the test that pins "no cancellation filter". |
| `updateClass` does not map "already cancelled": a stale-tab edit of a just-cancelled class shows a generic error (EC) | medium | patch | `services/classes.ts` maps the phrase only in `cancelClass` (line 667); `update_class` raises `class % is already cancelled`. |
| Time input: `inputMode="numeric"` has no colon key on a phone, and `normalizeTime` rejects digits without a colon (BH) | medium | patch | `weeklyRows.ts:31` requires `:`; WeeklyTimesEditor.tsx:126 sets numeric. Accepting 3-4 digits fixes it. |
| `class_cancelled` / `class_times_changed` Details cell has no rendering test (VG, BH) | medium | patch | Only label keys are tested (`auditLabels.epic29.test.ts`); renaming a metadata key breaks the cell with no failure. |
| `cancelClass` "already cancelled" regex has no test against the DB wording (VG) | low | patch | Folded into the `updateClass` mapping fix: one service test covers both. |
| Start-date-only edit and the view's start-date clause never exercised (VG) | medium | patch | Every `update_class` call in `class_slot_editor.test.sql` passes `current_date`; dropping the clause fails nothing. |
| `class-slot-race.sh` leaves ~50 `class_cancelled` audit rows with a nulled gym (EC) | low | patch | `single-use-race.sh:48` deletes audit_log by gym; this script does not. Direct correction. |
| `toHourMinute` has no callers; `editClass` docblock still describes `scheduleChanged` (BH) | low | patch | grep: only the definition. Direct deletion and rewording. |
| 0181 header says old signatures keep "same behaviour"; the old `update_class` now follows the slot rule on type switches, and `list_my_classes` drops the legacy columns so the old Coach page shows a blank schedule until the dashboard deploys (BH, EC) | low | patch | Behaviour is by the spec's own rule and the AC; the header, `decisions.md` and `deferred-work.md` must say so, and the rollout note must name the Coach page too. Text only. |
| `decisions.md` "only ones" list omits three edited suites or fixtures (EC) | low | patch | `support_excluded_from_counts`, `support_request_path` and `teardown.ts` are in the diff and not in the list. Text only. |
| `gymTimezone` wiring from page to modal untested (VG) | low | defer | Cosmetic line; one e2e assertion would close it. Recorded in deferred-work.md. |
| Manager can PATCH `classes.cancelled_at` directly (EC) | low | rejected | A Manager already holds the RLS update policy on every `classes` column (schedule type, times); the UI never does it. The guard needs a trigger. |
| `mark_class_attendance` cancelled guard before the already-attended return (EC) | low | rejected | Only future sessions are flagged; an attended booking is on a started session. Unreachable in practice. |
| `send_class_reminder` race with a concurrent cancel (EC) | low | rejected | A window of milliseconds on a reminder; fix adds a lock. |
| one-off to one-off edit races a booking, no session lock (EC) | false | rejected | Pre-existing since 0058 and already deferred in 29-1's triage (the FK refuses, no data loss). |
| Mobile stale list: book or cancel on a just-cancelled session shows the generic error (EC) | low | rejected | Cancelled sessions leave the bookable list at once; needs a stale list and new statuses and strings. |
| `listClasses` sessions fetch can pass the 1000-row cap (BH, EC) | low | rejected | The sessions fetch is unchanged from before this story; reaching the cap needs about 18 classes at 14 times each. Fix is paging. |
| recurring to one-off bypasses `apply_class_slots` (EC) | false | rejected | `apply_class_slots` refuses a non-recurring class by design; the Design Notes name this branch. |
| Rollback refuses once any class has null legacy columns (BH) | false | rejected | Required by the spec; refusing is the safe choice, and 0180's rollback already says so. |
| Kept old-time sessions stay bookable and are listed only once (BH) | false | rejected | The AC keeps booked sessions; the Old-time tag scope was decided with the product owner. |
| Cancel dialog copy: "bookings cancelled", no notify line, a class with no future sessions can be cancelled (BH) | false | rejected | Copy is the UX-prescribed text; the no-notification rule is the owner decision; cancel on a class with nothing ahead is allowed by the AC. |
| Two audit rows for one edit (`class_edited` and `class_times_changed`) (BH) | false | rejected | Both are specified. |
| Cancel dialog count is read at page load, not by the server at the moment of cancel (not raised; noted in triage) | low | rejected | The toast and audit carry the server count; the spec asks the dialog to show a server number. |
| Row buttons share names, focus after Remove, announcement in an updater, 14 in locale strings, `scheduleSummary` twice, Badge colour reuse, trailing newline, rollback duplicates old bodies, older mobile builds, cancel-vs-update race untested, French copy untested (BH) | low | rejected | Cosmetic or unlikely, and each fix adds behaviour or a test harness the story does not need. |

## Design Notes

`class_sessions_with_match.matches_slots` must use exactly `apply_class_slots`' rule (local date on or after the start date, same weekday and time of day in the gym zone), so the tag and the regeneration cannot disagree. Leaving recurring: delete slots, set one-off, delete unbooked future sessions, return the booked ones, then materialize the one-off session.

## Verification

**Commands:**
- `bash scripts/ci-local.sh` (`E2E_LANDING_PORT=3240`) -- expected: every stage PASS; read the per-stage lines
- `pnpm run check:migrations && pnpm run check:claims && pnpm run check:i18n && pnpm run typecheck` -- expected: clean
- `bash scripts/class-slot-race.sh` -- expected: `race: all passed`
