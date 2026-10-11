---
title: '19-7 Class attendance consumes a session'
type: 'feature'
created: '2026-10-11'
status: 'done'
baseline_commit: '1b3fe1fd892105fe889f0c7da315e4b9b4a74ae4'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-19-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** At a gym that charges guests per session, `mark_class_attendance()` still marks a Pay-per-session member attended with no paid session, and a guest who already used a session on the floor could be charged again for a class the same day. `class_bookings.attended_at` is also writable outside the function.

**Approach:** Migration 0112 gates `mark_class_attendance()` behind the charging flag and routes it through `private.consume_guest_session()`, so one session covers floor and classes for the gym-local day. A refusal records a class attempt and the session-required alert, and the Classes page shows an inline refusal message.

## Boundaries & Constraints

**Always:** `mark_class_attendance()` keeps its signature and `RETURNS class_bookings`. After the booking lookup, an already-attended booking returns the stored row and consumes nothing (new `attended_at is null` guard, also with the flag off). The flag is read before any V1.6 call or lock; off means today's path. When on, take the `class_sessions` row lock (`FOR NO KEY UPDATE`), then the member lock, then `consume_guest_session(member, gym, now())` (canonical order). *exempt*, *covered* and *consumed* set `attended_at` as today. *denied* inserts `session_attempts` (`source = 'class'`, `scan_id = gen_random_uuid()`, plus a new nullable `class_session_id`), raises one active `session_required` alert, leaves `attended_at` null, and does **not** raise, so the attempt and alert commit. It returns the booking row with `attended_at` null; the dashboard service maps that to an `AppError` code `session_required` (AD-9). The existing expired/no-subscription null-return branch is unchanged and runs first. Direct UPDATE of `attended_at` (and INSERT carrying it) is closed for `authenticated` and `service_role`; `book_class_session()` and cancellation are untouched. Classes page: the checkbox reverts and an inline `role="alert"` row message (`info` left border) reads "No paid session — attendance was not recorded. A front-desk alert has been raised." / "Aucune séance payée — la présence au cours n'a pas été enregistrée. Une alerte a été envoyée à l'accueil."; the checkbox stays enabled beforehand; nothing auto-marks. FR strings "Prochaine séance" → "Prochain cours", "Aucune séance à venir" → "Aucun cours à venir"; "Notes de séance" unchanged.

**Never:** No [Record session payment] button, panel or success message here: the panel does not exist until 19.9, which wires it to this refusal row. No alert panel change (19.9), no mobile change (19.11), no coded booking row. No change to `consume_guest_session`, `check_in`, or the expired alert. No edit to historical migrations.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Flag off | any member | as 0110; no attempt, no consume, no extra lock | N/A |
| Exempt | flag on; monthly, coach-inclusive, class-only, or price 0 | attended, nothing consumed | N/A |
| Usable session | flag on, one usable | *consumed*; `attended_at` set | N/A |
| Floor then class | checked in today, then marked | *covered*; one session total (also reverse order, and two classes) | N/A |
| No session | flag on, none usable | attempt (`class`) + one active alert; `attended_at` null; row returned | UI shows refusal message |
| Re-mark | `attended_at` already set | stored row returned, nothing consumed, timestamp unchanged | N/A |
| Direct write | authenticated/service_role UPDATE or INSERT setting `attended_at` | rejected | permission denied |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0110_front_desk_alert_kind.sql:315-401` -- live `mark_class_attendance()` body to copy via `pg_get_functiondef`; keeps its `app_role` read (grandfather list bump, as 0111)
- `supabase/migrations/0111_check_in_session_gate.sql:105-190` -- `consume_guest_session()` (reuse unchanged); `:36-52` `session_attempts` shape (`source`, `scan_id`); alert insert with `kind = 'session_required'`, status null (`:300-ish`, copy)
- `supabase/migrations/0058_class_booking_with_capacity_enforcement.sql:52` -- the broad `class_bookings` grant (RLS already has no write policy; service_role is the open path); `book_class_session()` locks `class_sessions` (`for update of cs`)
- `supabase/tests/class_attendance_marking.test.sql:214-261` -- case (f) asserts re-mark rewrites `attended_at`; must flip to no-op (AC overrides it)
- `supabase/tests/check_in_session_gate*.test.sql` -- fixture and denial-path patterns; `suspension_rpc_coverage.test.sql` already lists the function
- `apps/dashboard/services/classes.ts:422-445` -- `markAttendance()`; map row with `attended_at` null to `session_required`
- `apps/dashboard/app/(dashboard)/classes/components/ClassesPageClient.tsx` -- checkbox handler, row message, FR strings
- `apps/dashboard/e2e/fixtures/seed.ts:279`, `teardown.ts:59` -- service_role INSERT/DELETE on `class_bookings`; keep working
- `scripts/check-migration-guardrails.mjs`, `scripts/migration-guardrails.grandfather.json`, `docs/decisions.md` (runbook row 0112), `packages/types/src/database.ts` (`session_attempts.class_session_id`)

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0112_class_attendance_session_gate.sql` -- `session_attempts.class_session_id`, `mark_class_attendance()` rewrite, `class_bookings` write pin, `$verify$`, header counting grepped writers
- [x] `supabase/tests/class_session_gate.test.sql` + `.negative.test.sql` -- one case per matrix row; each order of floor/class/class; exempt plan types; flag-off no side effects; direct-write rejection; refusal commits attempt and alert
- [x] `supabase/tests/class_attendance_marking.test.sql` -- flip case (f) to no-op re-mark
- [x] `apps/dashboard/services/classes.ts`, `ClassesPageClient.tsx` (+ unit tests) -- refusal mapping, revert, inline message EN/FR, string renames
- [x] `packages/types/src/database.ts`, grandfather list, `scripts/rollback-0112-class-attendance-session-gate.sql`, `docs/decisions.md`

**Acceptance Criteria:**
- Given 0112 applied, when the attendance, class, suspension and tenant-isolation suites run, then all pass.
- Given `scripts/ci-local.sh`, then every stage passes.
- Given the rollback script in a rolled-back transaction, then `mark_class_attendance()` matches 0110 and the `class_bookings` grants match 0058.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Route | Evidence |
|---|-------|---------|---------|-------|----------|
| 1 | gap, blind | No test for an expired/no-subscription member at a flag-on gym, nor re-mark of an attended booking after expiry | medium | patch | Expired branch runs before the flag read; every flag-on test uses active members, so moving the gate above it stays green. |
| 2 | gap, blind | Test comment says "run out of sessions" but member I still holds a consumed session | low | patch | Comment overstates what the assertion covers. |
| 3 | blind | Header/decisions say flag-off gyms never enter new code, but the re-mark guard and grant closure apply to every gym | low | patch | Spec states both apply with the flag off; wording only. |
| 4 | edge, blind | Null/unknown gate outcome falls through and marks attended | low | reject | consume_guest_session returns exactly one row on every path; same pattern as check_in() 0111; fix adds a branch. |
| 5 | edge | Eligibility subscription query lacks `id desc` tiebreak | low | defer | Pre-existing copy from 0068 (deferred-work already lists it), not introduced here. |
| 6 | edge | Repeated clicks insert one attempt per refusal | false | reject | Spec: fresh scan id so every refusal counts. |
| 7 | edge | Class session on another day consumes today's session | false | reject | Epic AC: server receipt time governs. |
| 8 | edge, blind | Hardcoded column grant list; UPDATE grant still lets gym_id/member_id change | low | reject | RLS has no write policy; former table-level grant was broader; a verify-time column check adds machinery. |
| 9 | blind | anon/PUBLIC not revoked on class_bookings | false | reject | Queried local DB: anon has no INSERT/UPDATE (table or attended_at column). |
| 10 | blind | Refusal is a success-shaped row | false | reject | Spec decision; only consumer is the dashboard action (mobile and coach roster are read-only). |
| 11 | blind | Class-session lock contention / purpose unexplained | false | reject | Spec mandates canonical order class_sessions before member. |
| 12 | edge, blind | Rollback guard misses rows whose class_session_id was nulled | false | reject | Nulled rows lose nothing when the column is dropped; the guard protects the link. |
| 13 | blind | database.ts class_bookings Insert/Update still list attended_at | false | reject | Generated types do not model column privileges. |
| 14 | blind | English message string in service duplicates locale | low | reject | Matches the file's existing error-message pattern; UI uses the i18n key. |
| 15 | blind | FR em dash vs `--`, "front-desk alert" copy, noBookings still "séance" | false | reject | Copy is verbatim from the epic AC (UX-DR29/30). |
| 16 | edge, blind | Single refusedBookingId; stale after collapse/refresh | low | reject | Message reflects an unmarked booking; fix adds per-row state. |
| 17 | blind | Day-boundary, null flag, suspended-gym, alert re-raise tests missing | low | reject | Day boundary and null flag are covered by 0111 suites on the shared function; suspension by suspension_rpc_coverage meta test. |
| 18 | gap | Rollback script not automated in CI | low | reject | Same as 19-6a/19-6b rollbacks (deferred-work). |
| 19 | edge | Spec says checkbox, UI is a button | false | reject | Existing UI is a button; behavior (unmarked, enabled) matches the intent. |
| 20 | edge | Malformed RPC payload maps to session_required | false | reject | Typed RPC row; an id-null payload is handled by the rejected branch first. |

## Design Notes

- A raise would roll back the attempt and the alert, so refusal is a returned row with `attended_at` null (every success sets it). An old dashboard reads `attended: false`, so the checkbox reverts there too.
- `class_session_id` on `session_attempts` lets 19.9 render "From class: [name]" without a migration of its own.
- 0112 follows 0111 to production; the kill switch is the flag read.

## Verification

**Commands:**
- `bash scripts/pgtap-run.sh` -- expected: all files pass
- `node scripts/check-migration-guardrails.mjs` -- expected: no new violations
- `bash scripts/ci-local.sh` -- expected: all stages PASS
