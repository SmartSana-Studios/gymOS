---
title: '29-3 Coaches create, edit and cancel their own classes'
type: 'feature'
created: '2026-11-20'
status: 'done'
route: 'dispatch'
baseline_commit: '9555102aba95484161f717580673c773a624e050'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-29-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/epics.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A Coach can only read My Classes. Every new class, time change or cancellation of theirs needs a Manager, because `create_class`, `update_class` and `cancel_class` (29.2) refuse the Coach role and the Coach page has no controls.

**Approach:** One migration widens the three `p_slots` functions to a Coach for their own classes only, through the live role plus the caller's own live member row plus `private.is_own_coach_id`, with no Coach table write policy. The Coach Portal My Classes page gets [+ Create class], [Edit] and [Cancel class], reusing 29.2's modal and dialog in Coach mode. Acceptance criteria are Story 29.3 in `_bmad-output/planning-artifacts/epics.md` (lines 7282-7331); UX is `EXPERIENCE.md` AD-19 Coach mode (3112), AD-21 V1.8 (3645-3662) and Group F (1008-1012, 1050).

## Boundaries & Constraints

**Always:**
- One migration `0182_coach_own_classes.sql` (0181 is the head) with `scripts/rollback-0182-*.sql` and a `do $verify$` block; regenerate `packages/types/src/database.ts`. Bodies of the new public functions carry no comments and keep the `current_gym_status() is distinct from 'active'` guard with "is not active", `revoke ... from public, anon`, and the role read live through `private.current_member_role()`, never the claim.
- `create_class(..., p_slots)`, `update_class(..., p_slots)` and `cancel_class` are redefined with `create or replace`, same signatures. Manager, Supervisor and Owner keep every behaviour on every class of their gym, byte for byte in outcome. The old 9-argument `create_class` and the old 10-argument `update_class` stay Manager and above (the coach grant is the new overloads only).
- A Coach call needs all of: live role `coach`, a live own member row (`user_id = auth.uid()`, `gym_id = private.gym_id()`, `role = 'coach'`, `deactivated_at is null`) and `private.is_own_coach_id` on every coach id involved. One private predicate does this; `is_own_coach_id` alone checks neither gym, role nor deactivation. Create: `p_coach_id` null (stored as the caller) or the caller's own, anything else refused. Update and cancel: the class's current coach and any `p_coach_id` must both be the caller's own. The class row is locked `for update` before the coach check, so a reassignment between two requests is seen.
- One refusal message for another coach's class, another gym's class and a missing class, same text and shape for all (nothing about the class leaks); the dashboard maps it to `classes.coach.ownOnly` and refreshes the list. Already-cancelled keeps its own message (it is the Coach's own class). The 14-slot cap, duplicate and every validation refusal behave exactly as for a Manager.
- `list_my_classes()` is dropped and re-created with the same body plus `description` and `recurrence_start_date` (the Edit modal needs them); `list_my_class_session_roster` returns nothing for a cancelled session. `coach_portal_my_classes.test.sql` passes without edit.
- Audit with the Coach as actor: create writes `class_created_by_coach` (the dashboard action picks it from the signed-in role, Manager and above keep `class_created`), edit writes `class_edited` and, when times changed, the database's `class_times_changed`, cancel writes the database's `class_cancelled`. Add the `class_created_by_coach` label and details wording (EN, FR).
- Coach mode of the modal: Coach is plain text of the signed-in coach (`classes.coach.fixed`, helper `classes.coach.fixedHelp`), the id and name come from the server-resolved shell context, never from the client. The weekly-times editor, notice, result view and Cancel dialog behave as in 29.2; the dialog's booking count is the sum of booked counts of the class's sessions later than now from `list_my_classes`. Roster and attendance stay read-only: no mark control, checkbox or booking add or remove in the DOM.
- All strings EN and FR (Group F keys `classes.coach.create`, `.empty`, `.fixed`, `.fixedHelp`, existing `.ownOnly`, and `audit.actionTypes.classCreatedByCoach`); `check-i18n-key-parity` passes.

**Never:**
- No Coach write policy on `classes`, `class_sessions`, `class_schedule_slots` or `class_bookings`; no new Coach read of `class_bookings`; no attendance marking for a Coach; no Coach access to another coach's class by any path; no picker (29.4); no notification on cancel.
- No change to `private.support_capabilities` (totals and names unchanged), no new `claim-only` entry, no change to the admin Classes page for Manager and above.

**Decisions (recorded with the product owner, 2026-11-20):**
- `/classes` for a Coach: today the page has no role guard (the Sidebar only hides the link, RLS lets a Coach read the gym's classes). 29.3 adds a guard in `classes/page.tsx` that shows the global `errors.permissionDenied` message for the Coach role, with a component test, so the AC sentence becomes true. Manager and above are unchanged.
- Spec kept whole (one goal across database, dashboard and tests, as 29-2).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Coach creates | `p_coach_id` null or own id, two weekly times | class stored with the caller as coach, sessions generated, listed in `list_my_classes`, audit `class_created_by_coach` | N/A |
| Coach creates for another | `p_coach_id` = coach B or a manager's id | refused, nothing created | `classes.coach.ownOnly` |
| Coach edits own | change one time | `left_unchanged` as in 29.2, audit rows | N/A |
| Coach edits or cancels another's class | own gym coach B, other gym, missing id | the same refusal for all three, class and sessions unchanged | `classes.coach.ownOnly` |
| Coach reassigns own class | new `p_coach_id` = B | refused | `classes.coach.ownOnly` |
| Reassigned by a Manager | A to B | A refused, B allowed on the next request; sessions, bookings, attendance untouched | N/A |
| Deactivated, role changed, gym suspended | token still valid | refused on the next call; suspended gym raises "gym is not active" | existing mapping |
| Cancel own, twice | already cancelled | `{bookings_cancelled}` then the "already cancelled" message; badge shown, no [Edit] or [Cancel class] | `classes.cancel.already` |
| Direct table writes | Coach inserts, updates, deletes on `classes`, `class_sessions`, `class_schedule_slots`, `class_bookings` | every one refused | N/A |
| Receptionist, member, anon, Support | the three functions | refused as today | N/A |
| Cancelled session roster | Coach asks a cancelled session | empty result | N/A |
| Empty Coach | no classes | `classes.coach.empty` with [+ Create class] | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0181_class_slot_editor_and_cancel.sql` -- live `create_class` p_slots overload (199), `update_class` p_slots (252) and 10-arg wrapper (403), `cancel_class` (459), `list_my_classes` (1242); role gate at 210, 269, 471 is the line to widen; model the file's header, `do $verify$` and revokes on it.
- `supabase/migrations/0096_coach_portal_my_classes.sql:183` -- roster function body to redefine with the cancelled filter; `0041:38` `private.is_own_coach_id`; `0057:163` `classes_validate_coach_trigger`.
- `supabase/tests/class_cancel*.test.sql`, `class_slot_editor.test.sql`, `coach_portal_my_classes.test.sql`, `support_capabilities.test.sql`, `suspension_rpc_coverage.test.sql` -- patterns; new `coach_own_classes.test.sql` and `.negative.test.sql` (cases listed in the AC). `scripts/class-slot-race.sh` -- add a reassignment-vs-edit case only if cheap.
- `apps/dashboard/app/(dashboard)/coach/classes/page.tsx`, `components/CoachClassesPageClient.tsx`, `actions.ts` -- add shell context (`getDashboardShellContext()`: `role`, `memberId`, `memberName`), the page action, per-class buttons beside (not inside) the row's disclosure button, modal, dialog, empty state; `page.test.tsx` and the client tests extend.
- `apps/dashboard/app/(dashboard)/classes/components/ClassModal.tsx` (props 109-122, coach select 446-460, `formFromClass` 75-96), `CancelClassDialog.tsx` (takes `ClassRow`; make it take `{id, name, upcomingBookingCount}`), `actions.ts` (`createClass` picks the audit action type from the role; `cancelClassAction`), `services/classes.ts` (`CoachClassRow`, `listMyClasses` 418, `logClassChange` 697, the mapping of the new refusal next to `mapAlreadyCancelled`).
- `apps/dashboard/app/(dashboard)/audit/auditLabels.ts` (158-160), `AuditLogPageClient.tsx` (details chain), `locales/en.json` and `fr.json` (`classes.coach` at en.json 1095, `audit.actionTypes`); `auditLabels.epic29.test.ts` and `AuditLogPageClient.classDetails.test.tsx` as models.
- `apps/dashboard/e2e/class-weekly-times.spec.ts` and `fixtures/seed.ts` (`coach`, `secondCoach`) -- model for `coach-own-classes.spec.ts`; `progress-data-privacy.spec.ts` must still pass.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0182_coach_own_classes.sql` and `scripts/rollback-0182-*.sql` -- the private own-coach predicate, the three functions widened, `list_my_classes` with two more columns, roster cancelled filter, verify block; rollback restores the 0181 bodies
- [x] `supabase/tests/coach_own_classes.test.sql` and `.negative.test.sql` -- the AC's cases (create for B, edit and cancel B's, reassign own to B, other gym uniform, manager id passed, receptionist and member, already cancelled, cap and duplicate, live-gate cases, reassignment A to B, direct writes per table, roster of a cancelled session), each mutation-checked where it gates; extend `support_capabilities.test.sql` only if its classification list needs the redefined names
- [x] `packages/types/src/database.ts`, `services/classes.ts`, `classes/actions.ts` -- types, `CoachClassRow` fields, role-chosen audit type, ownOnly mapping
- [x] `ClassModal.tsx`, `CancelClassDialog.tsx`, coach `page.tsx` and `CoachClassesPageClient.tsx` -- Coach mode, buttons, empty state, ownOnly refresh, no attendance control
- [x] `apps/dashboard/app/(dashboard)/classes/page.tsx` -- role guard: the Coach role sees `errors.permissionDenied`, no class data is read; component test; the Sidebar and FR-053 tests keep passing
- [x] `auditLabels.ts`, `AuditLogPageClient.tsx`, `en.json`, `fr.json` -- label and keys
- [x] `apps/dashboard/e2e/coach-own-classes.spec.ts`, `docs/decisions.md`, `deferred-work.md`, `sprint-status.yaml` -- E2E golden path (two-time create, edit one time, cancel, second coach does not see it, first coach cannot open `/classes`), records

**Acceptance Criteria:**
- Given Story 29.3's criteria in `epics.md` (7282-7331), when pgTAP, vitest, the E2E spec and `bash scripts/ci-local.sh` run, then every criterion has a named passing test, existing suites pass without edit except those this spec names, and no new `claim-only` entry or guardrail failure appears.

## Implementation Notes

## Spec Change Log

## Review Triage Log

Pass 1 (blind / edge-case / verification-gap). Verdict, then route. Layers: blind-hunter (BH), edge-case-hunter (EC), verification-gap (VG).

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| `for update` before the Coach ownership check has no test that can fail (VG, BH, EC) | medium | patch | Every new pgTAP case is one session in sequence; moving the lock after the check or dropping it passes them all, and the grant rests on that ordering. Race case 6 in class-slot-race.sh, mutation-checked. |
| `createClass` ignores a failed shell read, so a Coach's create goes out as `class_created` with the client coach id (VG, BH, EC) | medium | patch | `const { data: shell } = ...` drops the error; `isCoach` becomes false. Authorisation stays safe (database refuses), the audit label and the server-resolved id are lost. Fail with the load error. |
| `/coach/classes` swallows a failed shell read and silently drops all controls (VG, BH, EC) | medium | patch | `{ data: shell }` only; `coach` becomes null. Show the load error. |
| `CoachClassDialogs` remounts when the list goes from empty to non-empty, losing the toast (BH, EC) | medium | patch | Rendered in two branches of the client; the first-class create is exactly that switch. Render once. |
| Promoted ex-Coach's chosen coach is overwritten, a demoted Manager's create is labelled by the stale `app_role` claim (EC) | low | rejected | The claim is what the whole shell trusts and refreshes on token renewal; the database reads the live role and is the authority, the effect is one audit label for one request window. Fix would add an RPC per create. |
| Several member rows per user make `create_class` "me", `cancelled_by` and `list_my_classes` disagree (BH, EC) | false | rejected | `idx_members_active_gym_user` (0003:39) is unique on (gym_id, user_id) for active rows, so at most one live row exists. |
| `/classes` guard adds a serial round trip for every role (BH) | false | rejected | `getDashboardShellContext` is wrapped in React `cache()` (session.ts:160) and the layout already awaits it, so the page's call is free. |
| Coach deactivated between the live-role read and the predicate (EC) | low | rejected | One transaction; the window is the commit instant of a concurrent deactivation, the same for every definer function in the repo; a lock would add a table lock on `members` for a millisecond window. |
| Refusal matched by English text, not a code (BH) | low | rejected | The repo convention (29.2 triage rejected the same for `mapAlreadyCancelled`); the text is pinned by the new service test and the pgTAP files. |
| Modal stays open on a stale row after the own-only refusal (EC) | low | rejected | The refusal message is shown inside the modal as the UX asks and the list refreshes; the Coach closes it. |
| Focus lost after create and after a successful cancel, `role="group"` on a `<p>`, dialog layout (BH) | low | rejected | Browser-QA items already named in deferred-work.md; no acceptance criterion broken. |
| Audit log shows the raw action for `class_created` and `class_edited` (BH) | low | rejected | Pre-existing (nothing labelled them before this story); recorded in deferred-work.md by the build. |
| `editClass` as a Coach untested (BH) | low | rejected | `editClass` is unchanged by this story and covered by `actions.editClass.test.ts`. |
| `database.ts` hand-spliced, not regenerated (BH) | low | rejected | Two columns, typecheck and check:migrations pass; the 27.1 precedent. |
| Spec logs empty; "keep me" on a null `p_coach_id` not in the frozen text (BH) | low | rejected | Logs filled by this triage; the choice is recorded in decisions.md and tested. |
| E2E fragility (UTC date near midnight, no cleanup, no bookings flow) (BH, EC) | low | rejected | The e2e gym is rebuilt per run; the start date only matters within the hour before midnight UTC; bookings and already-cancelled are pgTAP rows. |
| gym timezone null when the read fails (EC), Coach name falls back to e-mail (EC), sprint-status flaky note without evidence (BH) | low | rejected | Rare read failures with a sane browser-zone fallback; the e-mail fallback exists only when the member row read fails, which already blocks the page. |
| Removed Coach assertions in `class_cancel.negative.test.sql` (EC) | low | rejected | The refusals moved to `coach_own_classes.negative.test.sql` (named in the build report and decisions.md). |

## Design Notes

The coach grant is one predicate used for all three functions: `role = 'coach'` live, a live own coach member row, and `is_own_coach_id` on each id (old coach, new coach). Pass null on create is "me". The audit action for a create is chosen by the dashboard from the server-resolved role because `create_class` writes no audit row of its own (29.2); the database stays the authority for who may write, the label is only a label.

## Verification

**Commands:**
- `E2E_LANDING_PORT=3240 bash scripts/ci-local.sh` -- expected: every stage PASS; read the per-stage lines
- `pnpm run check:migrations && pnpm run check:claims && pnpm run check:i18n && pnpm run typecheck` -- expected: clean
- `bash scripts/class-slot-race.sh` -- expected: `race: all passed`
