---
title: '27-4 Correct plan and annual plan wording: fix a plan assigned by mistake, say plainly what an annual plan costs'
type: 'feature'
created: '2026-11-18'
status: 'done'
route: 'dispatch'
baseline_commit: '88fb5d15e9b886f20b4e848b60a228346437a410'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-27-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A plan assigned by mistake can only be fixed by a developer editing the database, and an annual plan reads "XAF 250,000 / annual", which staff mistake for a monthly instalment.

**Approach:** One migration adds a pure status function, a standing-payment helper, a read-only eligibility function and `correct_subscription_plan`; the dashboard gets a Correct plan modal and one reusable plan summary line. The source of truth for every rule and screen state is `_bmad-output/planning-artifacts/epics.md` "Story 27.4" (its Given/Then blocks are the acceptance criteria and are not restated here) and `EXPERIENCE.md` UX AD-31, AD-04, AD-23, AD-12 (copy keys `members.correctPlan.*`, `plans.annual.*`).

## Boundaries & Constraints

**Always:**
- Lock order member (`FOR NO KEY UPDATE`) then current subscription (`FOR UPDATE`), re-check the standing rule under both; refusal order exactly as in the epic.
- `private.subscription_standing_payments(subscription_id)` is the one definition of "stands", called by both `correct_plan_eligibility` and `correct_subscription_plan`.
- The correction uses `private.gym_today(gym_id)`; the lifecycle job uses UTC `current_date` (0045:389). The equivalence test aligns the clock; the job is not modified.
- A correction never touches `payments`, `refunds`, `notifications`, `loyalty_*`, `guest_sessions`, `attendance_events`, `session_attempts`, `front_desk_alerts`, `start_date` or the registration fee; exactly one `subscription_plan_corrected` audit row.
- Support: `private.support_rpc_gym_id/_role`, `private.support_stepup_require('support_correct_plan', p_member_id::text)`, `private.stepup_issue` re-created with the current action list plus `support_correct_plan`, `subscription_plan_corrected` added to `private.support_audit_actions`, two registry rows (`private.support_capabilities`, kind `rpc`), 0175's verify `DO` block copied. `REVOKE` from `public, anon`, grant `authenticated`.
- Refusals raise `P0001`, code as message, JSON `detail` (the epic's choice; 0175 returned coded rows instead, so the dashboard service parses the message into `{ code, message }`).
- EN and FR for every new string; `scripts/check-i18n-key-parity.mjs` passes. No mock-ups, no change to mobile, the public gym page or Plans data.
- Owner decisions 2026-11-18: (1) [Correct plan] appears in both places: a row-dropdown item between Edit and Deactivate in `MembersPageClient.tsx` and a button beside [Record session payment] in the member View modal, both gated like Edit (Owner, Supervisor, Manager) and absent when there is no current subscription. (2) The early-renewal carry (0121) is accepted as a limitation: the formula is `start_date + duration + reward days`, recorded in `decisions.md`, with `basis_start_date` in the audit row. (3) The unlinked branch of `subscription_standing_payments` counts every `purpose = 'subscription'` payment of the member with `subscription_id` NULL created at or after the current subscription row (verified, pending, processing and flagged), unless voided or fully refunded; this widens the epic's "pending or processing" wording on purpose, fails closed, and covers manual cash entries that are verified but never linked. A pgTAP case pins it. (4) The spec stays whole (about 3,800 tokens) at the owner's approval.

**Never:** modify `run_subscription_lifecycle_job()`; preview the new expiry; build the Single-use Sessions wording (Epic 28); re-add an early renewal's carried days (0121) to the formula; renumber earlier migrations; hard-code `support_capabilities.test.sql` totals (arithmetic on the file as it stands: registry 46 -> 48, rpc 25 -> 27, `plan(146)` plus the new assertions).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error Handling |
|---|---|---|---|
| Annual to Monthly, no payment | row start S, no reward | expiry = S + 30, status by function | N/A |
| Reward earned | R reward days on this row | expiry = S + duration + R | N/A |
| To Pay-per-session | any | expiry NULL, status active | F6 if an unused paid session is held |
| Payment stands | verified / pending / flagged / processing / partly refunded | refused F1-F4 (flagged uses F2 text), "+ N more" F5 | `payment_stands` with detail |
| Voided or fully refunded payment | one refund row = amount | correctable, not mentioned | N/A |
| Stale modal | `p_subscription_id` differs | F10 | `subscription_changed` |
| Same plan / gone plan / no subscription | | F7 / F9 / F8 | coded P0001 |
| Past expiry result | new expiry before today | saved, toast `successExpired` | N/A |
| Receptionist, Coach, member, other gym | | button absent; RPC refused | `permission denied` (F12) |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0175_staff_check_in.sql:545-580, 731-880, 995, 1006-1025, 1085+` -- pattern to copy: role gate, gym status, step-up, audit call, revoke/grant, registry rows, `private.stepup_issue` re-creation (hard-coded action list, append only), verify `DO` block. Next migration is 0176 (local DB head 0175; provisional until merge).
- `supabase/migrations/0045_subscription_lifecycle_notifications.sql:389` -- live job: three forward steps on `expiry_date is not null`, UTC `current_date`, never back to `active`; read-only reference.
- `supabase/migrations/0157` (`private.gym_today`, `renew_subscription`, `confirm_renewal`), `0122:50` (`private.award_renewal_stamp_impl`: `reward_granted`, `counter='subscriber'`, `details` keys `subscription_id`, `reward_days`), `0121` (carry), `0018` trigger `enforce_subscription_expiry_matches_plan_type`, `0037:35` `subscriptions_current` (newest `created_at, id`).
- `payments`: `purpose in ('subscription','registration_fee','session')`, `voided_at`, nullable `subscription_id` (set late by `complete_verified_payment`; never set by `initiate_member_payment`, the dashboard Tara initiation or manual entry), status `pending|processing|verified|flagged`; `refunds.payment_id` unique. `guest_sessions`: `payment_id, consumed_at, voided_at, usable_until`.
- Locks today: `confirm_renewal` member only; `complete_verified_payment` payment then member, reads the subscription unlocked; `renew_subscription`, `initiate_member_payment` none. The correction's member lock serialises against the first two; the subscription lock covers the rest (list in Dev Notes after grepping again).
- `scripts/session-refund-race.sh`, `scripts/check-in-member-lock-race.sh` -- race script shape; wiring at `scripts/ci-local.sh:122-125` (`stage_pgtap`) and `.github/workflows/ci.yml:127-134`.
- `supabase/tests/support_capabilities.test.sql` (plan 146; count pin line 93; classification table ~170-199), plus `support_request_path` (E1, E3, E5), `support_action_identity` (~383, ~424), `support_excluded_from_counts:123`; also review `early_renewal_carry`, `subscription_lifecycle_cron` as neighbours that must pass unedited.
- `apps/dashboard/services/plans.ts:47-90` (`PlanRow`), `app/(dashboard)/plans/PlansPageClient.tsx:96-154` (old "/ annual" label, `plans.priceLabel`, `plans.intervalAnnual`, `plans.discountSuffix`), `PlanModal.tsx:393-410` (interval field, help text goes here), `members/AssignInitialPlanDialog.tsx:121`, `members/MemberModal.tsx:878, 1056-1073` (plan field and select), `components/shared/RenewalModal.tsx:513`, `attendance/CheckInMemberModal.tsx:384` -- plan name renderings to move onto the summary line.
- `services/members.shared.ts:53-74` + `members.detail.ts:182` -- `MemberListRow` lacks subscription id, `start_date`, price, duration, billing interval; extend the embed (needed for "Subscription started" and the modal's current-plan block).
- Modal and action pattern: `payments/WaiveRegistrationFeeDialog.tsx`, `attendance/VoidCheckInModal.tsx` (`isSupport`, `SupportCodeField`), `attendance/actions.ts:42` and `payments/actions.ts:163` (`requireSupportGrant`, copied per actions file), `services/support-stepup.ts` (`SupportGrantAction` gains `support_correct_plan`), `services/attendance.ts:560` (`rpc` then `mapAndLog`); toast and `router.refresh()` as in `PlansPageClient.tsx:35`.
- `audit/auditLabels.ts:138-145`, `audit/components/AuditLogPageClient.tsx:64-75`, `locales/{en,fr}.json` (`audit.actionTypes.*` near 1975, new `audit.planCorrection.*`), `audit/auditLabels.epic27.test.ts` (exists, extend).
- `e2e/desk-fixes.spec.ts` (header already announces a 27.4 group), `e2e/fixtures/seed.ts, teardown.ts, types.ts` (no annual plan, unpaid or verified-payment member yet; add them), `docs/decisions.md` (newest first, 27.3 entry at line 9; re-verify cited line numbers after inserting).
- Mobile (`plan.tsx`, `(tabs)/index.tsx`, `renew.tsx`) reads the tables directly: no change; RLS cross-gym proof goes in the new pgTAP file.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0176_correct_plan.sql` -- `subscription_status_for` (IMMUTABLE), `subscription_standing_payments`, `correct_plan_eligibility`, `correct_subscription_plan`, registry rows, audit action, `stepup_issue`, verify block -- the rules, in one place
- [x] `scripts/rollback-0176-correct-plan.sql` -- drops the three public/private functions, registry rows, audit action, restores `stepup_issue`; header says corrected rows stay corrected
- [x] `supabase/tests/subscription_status_equivalence.test.sql` -- offsets -12..+12 x grace 0,3,7 against the real job, NULL case and boundaries
- [x] `supabase/tests/correct_plan_eligibility.test.sql`, `correct_subscription_plan.test.sql` -- F1-F11 states, stands rule per payment kind, unlinked rows, fee and session payments excluded, expiry arithmetic, no side effects, audit row, roles, support and step-up refusals, cross-gym RLS, lifecycle job afterwards changes nothing
- [x] `scripts/correct-plan-race.sh` + `ci-local.sh` + `ci.yml` -- both orders against `complete_verified_payment`, `confirm_renewal`, Tara initiation; job UPDATE blocked on the row lock re-evaluates; shown failing against a body without the re-check
- [x] `supabase/tests/support_capabilities.test.sql` and the `support_*` pins -- by arithmetic on the files as they stand
- [x] `packages/types/src/database.ts` -- add the three functions by hand (27.1 precedent), keep generated shape
- [x] `apps/dashboard` plan summary helper + Plans page, PlanModal help text, every plan select/name rendering, EN/FR keys, tests that assert the old suffix updated and named in the PR
- [x] `apps/dashboard` service, action (with `requireSupportGrant`), `CorrectPlanModal` (F1-F12, skeleton, focus return), member page button and "Subscription started", extended member read
- [x] `auditLabels.ts`, `AuditLogPageClient.tsx`, `auditLabels.epic27.test.ts`, `locales` -- "Plan corrected" label and Details cell
- [x] `e2e/desk-fixes.spec.ts` + fixtures -- plan group (unpaid Annual to Monthly; F1 with [Open payments]; "Paid once" EN and FR)
- [x] `docs/decisions.md` -- entry: early-renewal carry, extra `p_subscription_id`, P0001 shape, gym_today vs UTC clock, unlinked-payment rule; `sprint-status.yaml` entry

**Acceptance Criteria:**
- Given the epic's Given/Then blocks for Story 27.4, when pgTAP, Vitest, the race script and the e2e group run, then each passes and each new gate is shown failing against a known-bad input once.
- Given the full suite, when `scripts/ci-local.sh` runs on `story/27-4-...` after the owner's `supabase db reset`, then every stage is GREEN with the per-stage lines read, and only `support_capabilities.test.sql` and the plan-suffix tests are edited among existing tests.

## Implementation Notes

- Migration 0176 is as the spec says; refusal order is the epic's (the gym-status check sits after the stale-subscription check). A missing member, another gym's member and a wrong role all answer `permission denied`. A move between two Pay-per-session plans is not "to or from" Pay-per-session and is allowed; the boundary test is `(old is pps) <> (new is pps)`.
- `correct_plan_eligibility` returns zero or one row; a flagged payment is reported as state `pending` (F2 text). It raises for a suspended gym, like `list_attendance_log`.
- The two public RPCs name `supervisor` and read `members` for counts, so `support_excluded_from_counts.test.sql` (`cat_fn`, `cat_count`) and `support_request_path.test.sql` E1 took them, besides `support_capabilities.test.sql`. These are the "support_* pins" of the task list; no other existing pgTAP file changed.
- Payment paths and locks, the early-renewal carry, the unlinked rule and the initiation window are in `docs/decisions.md` (2026-11-18 entry).
- Dashboard: `MemberListRow` gained optional fields (so existing fixtures are untouched); the Check in a member search row (`CheckInMemberModal`) was not moved onto the summary line (it is a person picker, not a plan select or plan name area). No existing Vitest test asserted the old annual suffix, so none was edited; `auditLabels.epic27.test.ts` was extended as the spec says.
- Not done: `supabase db reset` (owner-run); the migration was applied to the local database by hand.

## Spec Change Log

## Review Triage Log

Pass 1 (Blind Hunter, Edge Case Hunter, Verification Gap; none failed). Routes: patch P1 to P5, rest rejected.

| # | Finding | Verdict | Evidence / route |
|---|---|---|---|
| 1 | `renew_subscription` takes no member lock, reads `plan_id` unlocked then inserts; a correction committing in between leaves a renewal row on the old plan; decisions.md claims it is covered (EC1, EC10) | medium | Verified: 0157:377-460 has no lock and no re-read, the correction's `v_latest` check closes only the window before its own UPDATE. **P1** |
| 2 | Move to Pay-per-session on a row with reward days: audit `loyalty_days_added` reports days never applied (EC3, EC claim) | low | Verified: `v_loyalty_days` is summed before the PPS branch. **P2**, direct fix (record 0 for a PPS target) |
| 3 | Unlinked payment created before the current subscription row is not counted, yet comments and decisions.md say "fails closed" (BH6, EC2, EC claim 3, VG other) | low | The owner-approved rule is `created_at >= subscription.created_at` (decision 3). Behaviour stays; the wording overclaims. **P3** wording only |
| 4 | `toMemberListRow` mapping, "Subscription started" and Plan summary untested through the real embed shape | medium | Verified by VG: all tests use hand-built rows. **P4** |
| 5 | `getRenewalPreview` new columns and RenewalPanel annual wording unasserted | medium | **P4** |
| 6 | Open View modal following the refreshed row is untested (VG) | medium | **P4** (rerender test) |
| 7 | Open-time blocked message date path (`on: null`, ISO `createdAt`) untested | medium | **P4** |
| 8 | Support error branches (`invalid_code`, `code_required`, `step_up_unavailable`, `account_locked`) and focus return untested | medium | **P4** (focus return is in the epic AC) |
| 9 | Edit-form plan select renders `planOptionLabel` with no test | low | **P4** one small test |
| 10 | Orphaned keys `plans.discountSuffix`, `plans.annual.paidOnce`, `members.correctPlan.newPlan.error` | low | Verified unreferenced in code. **P5** direct deletion in EN and FR |
| 11 | Open-time date formatted in the browser zone, submit-time in the gym zone (BH1, EC5, VG other) | low | Differs only for a viewer outside the gym's zone near midnight; fix adds a return column to a public function. Rejected, test gap covered by #7 |
| 12 | "1 days" / "1 jours" (BH3) | low | Rejected: one-day plans are not a product; fix adds plural keys across four strings |
| 13 | Race script uses fixed sleeps (BH5) | low | Rejected: same shape as `session-refund-race.sh` (sleep 0.5/0.2) and `check-in-member-lock-race.sh` that gate CI today |
| 14 | Reason length UTF-16 vs `char_length`; wrong message for over 300 (BH7) | low | Rejected: textarea `maxLength` 300 stops typing, zod and DB agree for normal text |
| 15 | Button sits between Edit and "Send invite", not "Deactivate"; `CheckInMemberModal` skipped (BH8) | false | Menu order is Edit, Send invite, Deactivate, so the item is between Edit and Deactivate; `CheckInMemberModal` is not a plan select or plan name area and the epic's list does not name it |
| 16 | Verify block `proname` select, no assertion on the `stepup_issue` list, rollback restores 0175's list (BH9, VG other) | low | Rejected: one function of that name, the 0175 migration did the same, rollback header already says it restores 0175 |
| 17 | Pre-submit warning when the new expiry is past (BH10) | false | The owner decided "no preview of the new expiry" (epic, FR-243 note); the toast `successExpired` is the specified signal |
| 18 | F10 offers only Close with no refresh (BH11) | low | Rejected: UX AD-31 specifies [Close] for F10; reopening reloads |
| 19 | Audit Details omit status and basis (BH12a); `database.ts` key order (BH12b) | false / low | Details cell is pinned by the epic AD-12 text; `database.ts` is hand-spliced per 27.1 precedent |
| 20 | Abandoned processing or pending payment blocks correction indefinitely (EC4) | false | The epic defines F2/F3 as standing, and pending resolves through verify, flag or `complete_flagged_payment`, processing through `expire_stale_payment` |
| 21 | Empty eligibility result shown as F8 when role was lost (EC6) | low | Rejected: the epic requires the uniform empty result (no oracle); a role lost mid-modal is rare |
| 22 | Non-network failures labelled "Check your connection" (EC7) | low | Rejected: F11 is the epic's single inline failure state |
| 23 | View modal keeps stale data when the corrected row leaves the active filter (EC8) | low | Rejected: needs a refetch path; rare filter combination |
| 24 | `reasonIssue` branch reports `invalid_reason` when ids are also malformed (EC9) | low | Rejected: ids come from the app, not the user |

## Design Notes

- The correction is the only writer that can move a row's status backwards (e.g. expired to active); that is intended and is why the function, not the job, computes status.
- Select option text is "{plan name} · {summary line}"; the summary line alone is "[price] XAF · [D] days" (monthly), "· Paid once" appended for annual, "[price] XAF / session" for Pay-per-session; the Plans list row keeps its own "XAF [price]" prefix per AD-23 and shares the helper's parts.

## Verification

**Commands:**
- `docker exec supabase_db_gym_os psql -U postgres -f` the new pgTAP files, then `supabase/tests` full run -- expected: all green
- `bash scripts/correct-plan-race.sh`, `bash scripts/ci-local.selftest.sh` -- expected: pass
- `scripts/ci-local.sh` -- expected: every stage GREEN (owner-run db reset first)

## Code Review (bmad-code-review, 2026-11-18, pass 2: four layers over the whole 27-4 diff, 5,932 lines)

### Review Findings

- [x] [Review][Patch] Refuse a deactivated member (decision resolved 2026-11-18: option a): add a deactivated guard to `correct_subscription_plan` (and make `correct_plan_eligibility` return the empty result for a deactivated member), hide the row-menu item and View-modal [Correct plan] button when `deactivatedAt` is set, and change the pgTAP "a deactivated member is correctable" case to assert the refusal. Cause: `deactivateMember` sets the subscription to `expired` and the correction would move it back to `active` [supabase/migrations/0176_correct_plan.sql, apps/dashboard/app/(dashboard)/members/components/MembersPageClient.tsx `canCorrectPlan`, supabase/tests/correct_subscription_plan.test.sql section 3]. Sources: blind-hunter, verification-gap. Verdict: medium.
- [x] [Review][Patch] Record the Tara initiation window as accepted (decision resolved 2026-11-18: option a): add the owner's acceptance of the "Known window, not covered" (an initiation overlapping the correction reads the old plan price) to its `docs/decisions.md` entry, and name it as a deviation from the epic's "a Tara initiation" race clause. No lock is added to `initiate_member_payment` [docs/decisions.md]. Source: acceptance-auditor. Verdict: medium.
- [x] [Review][Patch] Make "current subscription" one definition: `renew_subscription` picks the plan with `order by s.created_at desc` only, and the member list/detail embeds order by `created_at` only, while the correction and eligibility use `(created_at, id)`; on a `created_at` tie (two rows from one transaction) a renewal and a correction act on different rows and the modal can send an id the DB rejects with `subscription_changed` [supabase/migrations/0176_correct_plan.sql:~395, rollback keeps the 0157 body; apps/dashboard/services/members.shared.ts:127, members.detail.ts]. Sources: blind-hunter, edge-case-hunter. Verdict: low.
- [x] [Review][Patch] The `$verify$` block never asserts that `renew_subscription` kept its new member lock; only `scripts/correct-plan-race.sh` (cases 4b, 4c, 6) shows it. Add `position('for no key update' in prosrc of public.renew_subscription(uuid, text))` to the verify block [supabase/migrations/0176_correct_plan.sql:~520]. Sources: blind-hunter, acceptance-auditor, verification-gap. Verdict: low.
- [x] [Review][Patch] Refusal parsing (`parseCorrectPlanRefusal`: `error.code === "P0001"`, `error.message` as the code, `error.details` as JSON) is only tested against hand-built mock errors; pgTAP and the race script see SQLSTATE/sqlerrm over psql, never the PostgREST shape. If PostgREST moved `detail`, every refusal would read as "Check your connection" and no test would fail. Add one real-client test (e2e `callRpc` of `correct_subscription_plan` with a stale `p_subscription_id`, or a payment inserted after open) asserting code/message/details and the modal's F10 or F1 text [apps/dashboard/services/members.correctPlan.ts, apps/dashboard/e2e/desk-fixes.spec.ts]. Source: verification-gap (filed evidence). Verdict: medium.
- [x] [Review][Patch] The open View modal follows the refreshed list row only while that row is still in the list; when a status or search filter drops the member after the correction (the normal case: correcting an Expired member while filtered on Expired), `fresh` is null and the modal keeps the old plan, expiry and status badge after a success toast. Apply the `CorrectedPlanResult` (plan name, expiry, status) to the open read-only member, or close the modal [apps/dashboard/app/(dashboard)/members/components/MembersPageClient.tsx:161-172]. Source: edge-case-hunter. Verdict: medium.
- [x] [Review][Defer] Full `scripts/ci-local.sh` GREEN after the review patches is unproven, and the owner-run `supabase db reset` has not been done (migration 0176 was applied by hand to the local DB; the implementer's green run predates the review patches that changed the migration, race script, tests and locales) — deferred: not a code defect; run `supabase db reset` then the full ci-local (read the per-stage lines) once, after the patches above, before epic/27 goes to master. Source: acceptance-auditor.
- [x] [Review][Defer] `renew_subscription` reads `deactivated_at` in the unlocked lookup, then takes the member lock, so a deactivation committed between the two is not seen — deferred: pre-existing shape from 0157 (it had no lock at all); 0176 only adds the lock after the lookup. Fix when `renew_subscription` is next touched: fold the lookup and the lock into one `select ... for no key update`. Source: blind-hunter.
- [x] [Review][Defer] `correct-plan-race.sh` times its cases with fixed sleeps (`sleep 0.6`, `sleep 0.8` against `HOLD_S=2`, an `elapsed >= 1000` ms assert) and counts waiters by a `pg_stat_activity` `LIKE` on query text; refusals are matched by grepping `ERROR:  <code>` — deferred: unverified (I did not read the script; the older race scripts share the shape), marked medium unverified. Would settle it: run the script ten times under CPU load (e.g. alongside the e2e stage) and see whether any case flakes; if so poll `pg_stat_activity` for the blocked waiter and match SQLSTATE/detail. Source: blind-hunter.

### Rejected (one line each)

- Spec contradictions (AC says only `support_capabilities` is edited, Tasks list, frontmatter `status: 'done'`, menu placement wording) — fix is to edit the spec under review; the pgTAP edits are admitted and justified in Implementation Notes.
- Same payment shows two dates (opening path formats the ISO timestamp in the browser zone, the refusal path uses the gym-local `on`) — real but low: differs only near midnight and when the viewer's zone is not the gym's; the fix adds a column to the eligibility function, its types and tests.
- Suspended gym raises a plain exception that shows as "Check your connection" — low: the same shape as every other RPC's suspension gate (`renew_subscription` etc.), and a suspended gym's staff do not reach this screen.
- "1 days" / "1 jours" for a one-day plan — low cosmetic: `plans.modal.durationDaysLabel` ("{{days}} days") already shipped the same wording, and plural keys across both locales are more than a direct fix.
- Focus-return fragility (`querySelector` plus `setTimeout(0)`) — low and speculative; the trigger element is the one passed from the click, and `isConnected` is checked.
- F1-F5 copy tells a Manager to refund — false: `PaymentsPageClient.tsx:164` gates refunds to owner, manager, supervisor and support, the same four roles that see [Correct plan]. The "mobile money" wording is cosmetic.
- Audit page action filter / CSV not covered — false: the export takes only from/to/actor (AuditLogPageClient.tsx:188) and writes the raw `action_type` for every action by design (auditLog.ts:304).
- e2e language test leaves `fr` on the shared fixture user — low: restored in `finally`; only a killed worker leaves it.
- Two more existing pgTAP files edited than the spec allows — the fix is a spec edit; the edits are the registry classification tables, admitted in Implementation Notes.
- `successExpired` used only for status `expired` — the wording says "expired", which would be wrong for `grace_period`; the generic success text with the status label is correct.
- `CheckInMemberModal` still prints the bare plan name — spec-internal inconsistency (a person picker, not in the epic's list); the fix is a spec edit.
- Focus returns to the row-menu trigger, not [Correct plan] — the menu item unmounts; the trigger is the correct accessible target.
- Annual plan with null duration reads "/ monthly" in the Plans list — unreachable: PlanModal requires a duration for non-PPS plans (PlanModal.tsx:194) and the 0018 trigger enforces it.
- Correcting a PPS or old row to a duration plan can expire an active member at once with no warning — intended by the epic ("a new expiry already in the past yields expired or grace_period and the success response says so").
- `subscription_status_for` returns NULL when today is NULL — unreachable: `private.gym_today(gym_id)` is called for a gym row already read under the member lock.
