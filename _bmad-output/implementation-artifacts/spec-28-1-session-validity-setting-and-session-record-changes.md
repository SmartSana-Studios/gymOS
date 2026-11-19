---
title: '28-1 Session validity setting and session record changes'
type: 'feature'
created: '2026-11-19'
status: 'done'
baseline_commit: '296aff897edac0313734a756ad50159adc8082c3'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-28-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/epics.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A gym cannot choose whether a paid guest session covers the whole day or one visit, and the session record cannot remember which rule it was consumed under. Epic 28's later stories (single-use consumption, classes) need both.

**Approach:** Ship the schema, the Owner/Supervisor-only setter with its audit and support registration, the Settings "Session validity" section, and the reader changes. Nothing writes a Single-use row: every gym stays `whole_day` and behaves byte-for-byte as today. Acceptance criteria are Story 28.1 in `_bmad-output/planning-artifacts/epics.md` (lines 6854-6953); this spec adds the Code Map and the corrections the investigation found.

## Boundaries & Constraints

**Always:**
- Migration `0177_session_validity.sql` (0176 is the head; number is "next free at merge time").
- One write path for `gyms.session_validity`: `set_session_validity` plus its own pin trigger `private.pin_session_validity()` and GUC `app.session_validity_update_bypass`. The pin reverts direct updates silently for every caller, including Super Admin and `service_role`.
- Setter role gate is null-safe: Owner and Supervisor only (via `private.support_rpc_role`); Super Admin is refused (A4), so drop the `is_super_admin_live()` branch that `set_gym_category` has.
- `consume_guest_session` is copied from **0175** (not 0111; 0175 changed its return type to `outcome, session_created_at, session_id`), with only `validity_mode = 'whole_day', covered_kind = 'day'` added to its single UPDATE.
- `covered_attendance_id` and its unique index already exist (0175); reuse, never redefine.
- Register for support: `private.support_capabilities` rows `('session_validity','rpc','set_session_validity')` and the read RPC as kind `'rpc'`; add `session_validity_changed` to `private.support_audit_actions` (`on conflict do nothing`).
- Every new public function ends with `revoke ... from public, anon` and `grant execute ... to authenticated`.
- Existing guest-session pgTAP/vitest/Playwright suites run unchanged; the only edited test files are `support_capabilities.test.sql` and the audit label/details tests.
- Run `scripts/ci-local.sh` in full before merge; tenant isolation tested in pgTAP.

**Never:**
- No edit to `record_check_in`, `check_in`, `mark_class_attendance` or `void_staff_check_in` (the normalise trigger makes the void work).
- No single-use consumption, visit limit logic or class cover (Stories 28.2, 28.3).
- No change to gym-creation paths; the column default covers them.
- No confirmation dialog on the Settings save; no `session_validity` in the general Settings save payload.

**Decisions (owner, 2026-11-19):**
- The page save hint (`settings.saveHint.v18`) ends "…and Session validity" with no "Gym challenge" (FR-234 is deferred; the catalog text is deliberately not followed).
- This story stays one spec covering DB, dashboard and mobile readers.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Owner/Supervisor changes value | `set_session_validity(gym, 'single_use')` | Column updated, one `session_validity_changed` audit row `{old_validity,new_validity}` | N/A |
| Same value | current value passed | Returns, no write, no audit | N/A |
| Other role / Super Admin / anon / null role | any call | `permission denied` | Same refusal, nothing written |
| Other gym id, suspended gym, bad code | as stated | refused / `invalid_session_validity` | Raises, nothing written |
| Direct UPDATE of column | any caller | Reverted silently, no audit | No error |
| Whole-day double consume | two consumed `whole_day` rows, one member and day | Refused by rebuilt unique index | Unique violation |
| Single-use visit rows | two consumed `single_use` visit rows, same member and day | Accepted | N/A |
| Visit row without attendance id | consume a visit row, never set id | Fails at commit (deferred constraint trigger) | Raises at commit |
| Void releases a session | `consumed_at` set back to null | Normalise trigger clears all cover columns | N/A |
| Legacy writer | `consumed_at` + `covered_day`, no mode | Stored as `whole_day` / `day` | N/A |
| Settings, charging off | section viewed | Editable, shows `chargingOff` note | N/A |
| Save error | setter refused | Inline `settings.sessionValidity.error`, radio unchanged | Fixed translated message |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0175_staff_check_in.sql:59-146` -- latest `consume_guest_session` to copy; `:48-53` existing `covered_attendance_id` + unique index; `:726-902` `void_staff_check_in` (clears at 873-875, untouched).
- `supabase/migrations/0107_charge_guests_setting_session_record.sql:201-222,266-326` -- `guest_sessions`, the index to rebuild, `platform_session_config`, `audit_platform_session_config_update()` (hard-coded old/new keys; replace).
- `supabase/migrations/0111_check_in_session_gate.sql:106-108` -- CHECK `guest_sessions_consumed_has_covered_day` to rebuild (line 566 self-check references the name).
- `supabase/migrations/0113_session_refunds_revenue_line.sql:121-151` -- `audit_session_consumed()` (add `validity_mode`, `covered_kind`).
- `supabase/migrations/0123_gym_category.sql:45-75` and `0140_...:667-723` -- setter, pin trigger, GUC template; `0140:25-93` registry and `support_rpc_gym_id/role`; `0165:170,278` read-RPC example; `0176:487-493` registry + `support_audit_actions` insert idiom.
- `supabase/tests/support_capabilities.test.sql` -- `plan(146)` line 9, total at line 93 (48 -> 50: 21 policies, 29 RPCs), `cls` table from line 127 needs both functions if their bodies name 'supervisor'.
- `supabase/tests/` -- new pgTAP files for setter (+ `.negative`), pin, cover CHECK/trigger, backfill, audit, isolation.
- `apps/dashboard/app/(dashboard)/settings/`: `SettingsForm.tsx` (insert section between `MembershipSection` ~237 and `LoyaltyProgramSection` ~247; lift validity state so the "Charge guests" helper reacts), `GymCategoryField.tsx` (pattern to copy), `actions.ts` (`saveGymCategory` 453 pattern), `page.tsx` (load via a service modelled on `getGymosSupportStatus`, gym-settings.ts:497-515, for owner/supervisor/support only), `GuestChargingSection.tsx` (~117 helper).
- `apps/dashboard/services/gym-settings.ts:452-459` -- rpc service pattern; `apps/dashboard/services/guestSessions.ts:22-106` -- four new fields in type, DB row, select, mapping.
- `apps/dashboard/app/(dashboard)/audit/auditLabels.ts` (map ends ~150) and `components/AuditLogPageClient.tsx:81-101,302-306` -- new action label and a `sessionValidityDetails` ("Whole day → Single use"), modelled on `planCorrectionDetails`; extend `auditLabels.epic27.test.ts` and add a details test like `AuditLogPageClient.planCorrection.test.tsx`.
- `apps/mobile/src/lib/sessionState.ts:60-157`, `apps/mobile/src/app/(tabs)/index.tsx:297-310`, `apps/mobile/src/services/payments.ts:178` -- carry new fields; `coveredToday` and the `or` filter already behave correctly for null `covered_day`.
- `apps/dashboard/locales/{en,fr}.json` (settings at ~106-109; `audit.actionTypes` ~2010) -- Group D keys: copy from `_bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md:916-933,1045,3367-3376`.
- Mock lists in `S/actions.*.test.ts` and `SettingsForm.*.test.tsx` need the new service/prop; test patterns in `SettingsForm.category.test.tsx`, `SettingsForm.guestCharging.test.tsx:310`.
- `packages/types/src/database.ts:701+` -- regenerate (see Verification).

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0177_session_validity.sql` -- gyms column, platform limit column, audit function replace, `guest_sessions` columns/CHECKs/indexes/backfill/normalise trigger/deferred constraint trigger, `consume_guest_session` and `audit_session_consumed` replace, pin trigger, setter, read function, support registry and audit allow-list, grants -- one transaction
- [x] `supabase/tests/session_validity*.test.sql` (+ negative) and `support_capabilities.test.sql` edit -- cover every AC case in the I/O matrix, isolation, support aal2/assignment/opt-out/aal1 refusals
- [x] Dashboard Settings section, action, service, page load, helper text, hint -- per UX AD-13; component test asserts absent for manager/receptionist/coach/null and general-save payload has no `session_validity`
- [x] Audit label + details renderer, EN/FR keys -- label test enumerates the new action
- [x] Readers (`sessionState.ts`, mobile call sites, `guestSessions.ts`) -- add four fields; unit tests incl. consumed row with null `coveredDay`
- [x] `packages/types/src/database.ts` -- add new columns and functions; run `pnpm run check:i18n`

**Acceptance Criteria:**
- Given the AC list of Story 28.1, when verified, then each criterion has a named passing test and the unchanged-suites list in the story passes with no fixture edits.
- Given any existing gym, when the migration ships, then it reads `whole_day` and no consumed row lacks a mode.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Evidence / route |
|---|-------|---------|---------|------------------|
| 1 | edge | Deferred `guest_sessions_check_visit_has_attendance` runs as invoker; RLS-hidden row reads back empty and passes | medium | Real latent fail-open once 28.2 writes visit rows (RLS is not forced, so only non-owner callers are affected). patch: made `security definer`, applied to local DB, pgTAP cover and gate files re-run green |
| 2 | blind, gap | French `chargingOff` quotes "Faire payer..." but the shipped label is "Facturer les invites par seance" | low | fr.json:110 vs :145; the UX catalog copy is stale against the shipped label. patch: string corrected |
| 3 | blind, edge | Visit limit shown rounded to one decimal hour (100 min as 1.7 h) | false | The story's own AC mandates "hours, one decimal only when not a whole hour"; default is 180 and Super Admin controls the value |
| 4 | blind, edge | Toggle is live before 28.2/28.3 enforce Single use | false | Epic text: all three stories merge to epic/28 and reach master together, so no production gym can be switched before 28.3 is on master |
| 5 | blind | Pin trigger reverts silently | false | Required by the story AC (silent revert, no error, no audit) and the project pattern |
| 6 | blind | Single-use helper drops "Saves on its own." | low | Copy is the UX catalog text for `helperSingleUse`; fix would deviate from the baseline. Rejected |
| 7 | blind | FR "Paiement a la seance" vs "forfait Paiement par seance" | low | Catalog text; cosmetic. Rejected |
| 8 | blind | Mobile select breaks on a pre-0177 database; receipt select ignores errors | false | Migrations deploy before mobile builds (Epic 18 deploy order); the ignored error is the pre-existing receipt pattern |
| 9 | blind | Rollback script untested and hand-copies old bodies | low | No repo convention of testing rollback scripts (verified by gap layer); rejected |
| 10 | blind | No way to change the platform visit limit except SQL | low | Story scope is the column and its audit; deferred-work entry added |
| 11 | blind | Audit CSV export or filter may miss the new action | false | grep: action types are enumerated only in `auditLabels.ts`; no separate list or CSV mapping exists |
| 12 | blind | `DEFAULT_SESSION_VALIDITY` unused, narrowing logic duplicated, brittle index-based tests | low | Developer-only, no named harm; rejected |
| 13 | blind, edge | New keys split (`saveHint` object, `chargeGuests` beside `guestCharging`) | false | Forced by i18n (cannot hold string and key under one path); keys named by the UX catalog |
| 14 | edge | `get_session_validity_settings` returns no row if `platform_session_config` is empty | false | The singleton is seeded in 0107 and is never deleted; guard would add complexity for an unreachable state |
| 15 | edge | Settings read failure shows the Whole day helper for a single_use gym | low | Needs a failed read; consequence is helper text only; fix adds branches. Rejected |
| 16 | edge | Section does not resync when `initial.sessionValidity` changes | low | Same pattern as the other independent sections (category, charging); rejected |
| 17 | edge | Spec says only two test files are edited; diff edits two more | false | Documentation drift, not a code defect; fix would edit the spec. The two extra edits (catalog classification, page.test mock) are listed in the present step |
| 18 | edge | "Byte-for-byte as today" while index, CHECK and trigger semantics change | false | pgTAP proves whole_day behaviour is unchanged; the 25 named existing suites pass with no fixture edits |

## Verification

**Commands:**
- `bash scripts/ci-local.sh` -- expected: every stage PASS (read per-stage lines, not only the final GREEN)
- `pnpm run check:i18n` -- expected: no missing key
- Types: `npx supabase gen types typescript --local` (often returns zero bytes in the devcontainer; see docs/decisions.md for the pg-meta workaround) -- expected: only the new columns/functions differ

**Manual checks (if no CLI):**
- Owner browser QA is done by the owner once at epic end (not per story).

### Review Findings

Independent code review 2026-11-19 (4 layers: blind-hunter, edge-case-hunter, verification-gap, acceptance-auditor; diff `master...HEAD` = f33c462). 0 decision-needed, 1 patch, 2 defer, 24 rejected.

- [x] [Review][Patch] No pgTAP case for a live GymOS Support caller reading `get_session_validity_settings()` — the Settings page shows the section to `support`, but only owner/supervisor/denied roles and the registry rows are tested [supabase/tests/support_capabilities.test.sql, next to the `set_session_validity` allow-list cases; function at supabase/migrations/0177_session_validity.sql:410-438]. FIXED 2026-11-19: three cases added (assigned gym returns one row, unassigned gym zero rows, aal1 zero rows), plan 154 -> 157; support_capabilities and session_validity pgTAP files pass; a mutated copy fails 2 of 157 so the cases can fail.
- [x] [Review][Defer] `guest_sessions.covered_booking_id` references `class_bookings(id)` with no ON DELETE action, and booking-delete paths exist (0058, 0090, 0124); once 28.3 writes class-cover rows, deleting a covering booking raises FK 23503 [supabase/migrations/0177_session_validity.sql:91] — deferred: nothing in 28.1 writes the column; belongs in Story 28.3 acceptance criteria (cancel / member-delete behaviour for a booking that covers a consumed session) with a pgTAP case. medium, real once 28.3 lands.
- [x] [Review][Defer] The platform visit-limit control deferral names Story 28.2 ("decide before or at Story 28.2"), so by the Epic 22 retro rule it belongs in 28.2's acceptance criteria, not only in deferred-work.md [deferred-work.md:2162-2164] — deferred: fix edits epics.md (another spec); move the decision into 28.2's AC when 28.2 is created.

#### Rejected

- Gym INSERT not covered by the pin trigger (blind, edge x3): low. Spec "Never: no change to gym-creation paths", the 0123 category pin is also UPDATE-only, a pgTAP case asserts it deliberately, and only privileged paths insert gyms. Fix adds a trigger and breaks the seeding the tests use.
- Owner can pick Single use before 28.2/28.3 enforce it (edge, claim findings): false. Epic context: all three stories reach master together; "nothing writes a Single-use row" is true of guest_sessions, and the commit wording is history.
- Consumed row coverage not protected from later edits (blind): low. Only the definer consume function and the normalise trigger write these columns; spec asks for none; fix adds triggers.
- Receipt "used on" mixes ISO timestamp and day (blind): false. `row.covered_day ?? row.consumed_at` already existed at HEAD~1; this commit changed only the comment, and the formatter uses `new Date(value)` on either shape.
- Mobile select of cover columns is dead code (blind): false. Spec Code Map and AC require the readers to carry the four fields.
- `visitLimitHours` shows "0 hours" for a 1-2 minute limit (edge, blind): low. The AC mandates one-decimal hours; only a Super Admin SQL edit to an absurd value reaches it; fix adds a branch.
- Charge guests helper concatenation / Single use drops "Saves on its own." / FR wording (blind, auditor): low. Copy is the UX catalog text; already rejected as triage 6 and 13 in the build review.
- Auditor: whole_day `day` row may carry `covered_attendance_id` (deviation from AC "neither id"): false as a code defect. 0175 `record_check_in` stamps it and must not be edited; disclosed in the migration header and sprint-status. NOTE for 28.2/28.3: no guard may assume a `day` row has no attendance id.
- Auditor / blind: two extra test files edited, spec status `done` vs sprint `review`, empty Implementation Notes: false/low. Fix is to edit the spec under review.
- Auditor: mobile reader fields optional (`?`): low. Both call sites pass them; looser contract only.
- Auditor: MemberModal shows no date for a null `coveredDay`: false for 28.1 (UX copy is 28.2's); never throws.
- Auditor: platform visit limit has no Super Admin UI: duplicate of the existing deferred-work entry (see defer above).
- Blind: FK, rollback not atomic or untested, backfill test copies SQL, narrowing repeated, `database.ts` order, epic27 test constant name, no owner for the limit change: low or false, developer-only with no named harm, or already rejected as triage 9, 12.
