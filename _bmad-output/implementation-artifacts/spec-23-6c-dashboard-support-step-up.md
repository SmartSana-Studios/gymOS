---
title: '23-6c Dashboard step-up for support'
type: 'feature'
created: '2026-10-21'
status: 'done'
baseline_commit: '726476a7c5e5123a94e9e46d3669d3dbd7d9ea84'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-23-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Refunds, registration-fee waivers and staff creation require a single-use step-up grant for a support session (migration 0140), but the dashboard cannot obtain one, so these three writes always fail for support. Wrong authenticator codes at dashboard sign-in are also limited only by Supabase's own rate limit.

**Approach:** Reuse the 23-9 pattern: a fresh authenticator code typed in each of the three dialogs, verified on the server, turned into a grant bound to (action, subject), consumed by the write. Count wrong codes at sign-in in the same per-user counter, so the account locks.

## Boundaries & Constraints

**Always:** The code is verified server side on the caller's own session client and never stored or logged. A grant is issued only after a successful verify, only when the session is a live support session, bound to the action and the subject the database expects (`support_refund` = payment id, `support_waive_registration_fee` = member id, `support_create_staff` = the staff user id). A wrong code goes through `stepup_record_failure`; at the threshold the account locks, the session ends and the person lands on the login page with the expired notice. Staff creation verifies the code BEFORE any auth user is provisioned and issues the grant once the user id is known. The three dialogs show the code field only for `support`; staff roles see no change. Bilingual EN/FR. Generic messages, never the person's name.

**Never:** No change to how Owners or staff perform these actions. No change to the database grant rules (0127/0140). No grant for the payment connection beyond 23-9. Grants are not bound to amount, reason or phone: the subject binding is the decision already recorded, and the 5-minute single-use window is the limit.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Refund, valid code | Support, 6 digits | Grant issued for the payment, refund recorded, grant consumed | N/A |
| Waive / create staff, valid code | Support, 6 digits | Same for member id / new user id | N/A |
| Wrong code | Support | Nothing written, counter incremented | Inline "code not accepted" |
| Threshold reached | Too many wrong codes (dialogs or sign-in) | Account locked, sessions ended | Login page with the expired notice |
| Missing / non-numeric code | Support | Refused before any write | Inline required message |
| Staff role | Owner, Supervisor, Manager | No code field, behaviour unchanged | N/A |
| Replay | Same grant used twice | Second write refused by the database | Generic step-up message |

</frozen-after-approval>

## Code Map

- `apps/dashboard/services/support-stepup.ts` (+ test) -- today only `support_payment_connection`; split into `verifySupportCode` and `issueSupportGrant`, widen the action union to the three new actions.
- `apps/dashboard/app/(dashboard)/payments/actions.ts`, `components/RecordRefundModal.tsx` -- `recordRefundAction` and dialog.
- `apps/dashboard/app/(dashboard)/payments/actions.ts`, `members/components/WaiveRegistrationFeeDialog.tsx` -- `waiveRegistrationFeeAction` and dialog.
- `apps/dashboard/services/staff.ts` (`createStaffMember`), `settings/staff/actions.ts`, `AddStaffModal.tsx` -- user id known only after lookup or provisioning.
- `apps/dashboard/app/(dashboard)/settings/actions.ts` lines ~179-210 -- the 23-9 reference flow to mirror; `SettingsForm` support code field for the markup.
- `apps/dashboard/components/mfa-form.tsx` (from 23-6b) -- add a server action that records a wrong code.
- `supabase/migrations/0140_support_capability_allow_list.sql`, `0127_*` -- `stepup_issue`, `support_stepup_require`, `stepup_record_failure` (read-only).
- `supabase/tests/support_stepup_*.test.sql` and Vitest files beside each action.

## Tasks & Acceptance

**Execution:**
- [ ] `apps/dashboard/services/support-stepup.ts` -- verify/issue split, three new actions -- one place for the rule.
- [ ] Refund, waiver and staff-creation server actions and services -- verify, issue, write; staff creation verifies first -- so the write consumes the grant.
- [ ] `RecordRefundModal`, `WaiveRegistrationFeeDialog`, `AddStaffModal` -- code field for `support`, EN/FR strings, error mapping, lock redirect.
- [ ] `apps/dashboard/components/mfa-form.tsx` and a server action -- record wrong sign-in codes in the same counter.
- [ ] Vitest for each action (valid, wrong, locked, missing, staff role unchanged, replay) and each dialog; pgTAP only if a database object changes.
- [ ] `scripts/epic23-qa/smoke.mjs` and README -- the three flows with real JWTs and a real TOTP.
- [ ] `deferred-work.md` -- close every entry naming 23-6c.

**Acceptance Criteria:**
- Given a live support session, when it records a refund, waives a fee or creates a staff member with a valid code, then the write succeeds and the grant cannot be reused.
- Given repeated wrong codes, when the threshold is reached, then the account locks and the person is sent to the login page.
- Given any non-support role, when the same dialogs are used, then nothing changes.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | Sign-in wrong-code count is client-reported; any session can call the action | low | rejected | Self-lock only (a person can already lock themselves with wrong codes); Supabase rate limit still applies; the spec chose a server action. |
| 2 | Failure counter never resets on a successful sign-in | medium | patch | Confirmed in stepup_record_failure: only stepup_issue resets failed_count, so typos spread over weeks reach the lock. Fix: reset in support_begin_session (migration 0147). |
| 3 | isLiveSupportSession returns false on RPC error | low | rejected | Fails closed at the database (step_up_required); nothing is written. |
| 4 | Dialogs keep the spent code after an error and on reopen | medium | patch | A stale code resubmitted is rejected and counts toward the lock. |
| 5 | Pasted "123 456 " truncated by maxLength 7 | low | patch | Direct fix: normalise to 6 digits on change, drop maxLength. |
| 6 | issueSupportGrant or verify throwing leaves an orphan auth user | medium | patch | Cleanup runs only on a returned non-issued result; wrap the call. |
| 7 | isSupport wiring in PaymentsPageClient and MembersPageClient untested | medium | patch | Dropping or inverting the prop breaks the feature with no test failing. |
| 8 | recordMfaFailureAction wrapper untested | low | patch | Thin wrapper; two cases. |
| 9 | Non-support wrong sign-in code is counted | low | false | stepup_record_failure returns (false, 0) for anyone without an activated support account. |
| 10 | Grant not bound to amount or reason | low | false | Recorded decision in the spec (Never). |
| 11 | Grant lingers or code spent after a failed write | low | rejected | Grant is bound to the subject, so a retry reuses it by design. |
| 12 | Duplicated 6-digit regex; inline authCode cast; aria and autofocus; README hardcodes 5; test location leaks; smoke re-implements and leaves data | low | rejected | Cosmetic or QA-only; fixes add code for no named failure. |
| 13 | Locked account then correct code; multi-factor last-error; staff replay and sign-in e2e in smoke; staff action test lacks replay | low | rejected | Locked sessions are ended before this point; remaining items are narrow gaps behind existing coverage. |

## Design Notes

Staff creation order: verify code, resolve or create the auth user, issue the grant for that user id, call `create_staff_member`; a failure after creation keeps the existing cleanup of a user this call created.

## Verification

**Commands:**
- `bash scripts/ci-local.sh` -- expected: GREEN on a pristine database.
- `node scripts/epic23-qa/seed.mjs && node scripts/epic23-qa/smoke.mjs` -- expected: all passed.

**Manual checks (if no CLI):**
- Browser: as `qa23-active`, pick Gym A, record a refund, waive a fee and add a staff member, each with the current code from `totp.mjs`.
