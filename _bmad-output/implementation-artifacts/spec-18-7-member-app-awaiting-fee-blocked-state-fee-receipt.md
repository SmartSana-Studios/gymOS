---
title: 'Story 18.7: Member app awaiting-fee blocked state & fee receipt'
type: 'feature'
created: '2026-10-07'
status: 'done'
baseline_commit: 'a54cf4908ce84d74d05f78248cbc442a299202af'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-18-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A member in a fee gym who has not yet had their registration fee settled signs in, passes the phone check, and lands in onboarding, where `plan.tsx` shows a generic load error. A settled member's fee payment (a `payments` row with no `subscription_id`) shows as "Plan unavailable" in history and on the receipt.

**Approach:** Add a fourth root `Stack.Protected` group and a neutral "registration not complete, contact your gym" screen with Check again and Log out, driven by `members.registration_fee_settled_at IS NULL`. Label fee payments "Registration fee" in history and on the receipt. Mobile only, no migration; server-side blocking is pinned by pgTAP.

## Boundaries & Constraints

**Always:** Suspended takes precedence over awaiting. The three existing groups stay mutually exclusive with the new one. The blocked screen offers no payment option and no billing language (FR-148, FR-155). Check again and foreground-from-background both refresh session state, so a settled member moves on without a relaunch. Every new string has EN and FR entries in `apps/mobile/src/locales/{en,fr}.json`. Blocked-screen copy is `[ASSUMPTION]` pending the UX pass noted in FR-155.

**Never:** No migration, dashboard change, or RLS change. No self-service fee payment path. No new check-in, booking, or payment guard unless a gap is found, and a gap goes to `deferred-work.md` rather than widening this story. Do not touch `suspended.tsx`'s behaviour.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Awaiting sign-in | active gym, member row `registration_fee_settled_at` NULL | blocked screen, never onboarding or a load error | N/A |
| Suspended and awaiting | gym suspended | existing suspended screen | N/A |
| Check again, now settled | staff settled the fee and assigned a plan | session refreshes, member continues into onboarding | N/A |
| Check again, still awaiting | no change | stays on screen with a short "still not complete" note | refresh failure keeps the screen, shows a retry note |
| Settled, no plan yet | settled, no active subscription | `onboarding/plan.tsx` shows the no-plan message; Confirm stays disabled; a retry link reloads | N/A |
| Fee receipt | purpose `registration_fee`, voided_at NULL | history row and receipt read "Registration fee"; amount, currency, method, date, reference, actor unchanged | N/A |
| Voided fee | voided_at set | not listed, and its receipt URL shows the load-error state | N/A |
| Waived member | no payment row | history has no fee row | N/A |

</frozen-after-approval>

## Code Map

- `apps/mobile/src/hooks/use-session.tsx` -- `refreshOnboardedState` (members select ~L106) gains `registration_fee_settled_at`; add `isAwaitingRegistration` state (false on no session and in the suspended branch) and expose a `refresh()` for Check again; foreground (`AppState`) refresh only while awaiting. `refreshOnboardedState` currently lives inside the effect, so hoist it behind a ref or `useCallback`.
- `apps/mobile/src/app/_layout.tsx` -- `RootNavigator`: add `showAwaiting = !!session && isAwaitingRegistration && !isSuspended`; `isFullyOnboarded` also excludes awaiting; new `Stack.Protected guard={showAwaiting}` with `awaiting-registration`; onboarding guard also `&& !showAwaiting`.
- `apps/mobile/src/app/suspended.tsx` -- precedent for the screen and `handleLogOut`; model the new screen on it (duplicate the logout, keep suspended unchanged).
- `apps/mobile/src/app/onboarding/plan.tsx` -- `noPlanAssigned` branch (~L106-181): verified Confirm is disabled without a plan, so a settled member with no plan cannot complete onboarding; add a "Try again" link calling `loadPlan` inside that card.
- `apps/mobile/src/services/payments.ts` -- `loadPaymentsPage` and `getPaymentReceipt` select `purpose`, add `.is('voided_at', null)`; map `isRegistrationFee`.
- `apps/mobile/src/app/(tabs)/history/index.tsx` (~L400) and `history/payment/[id].tsx` (~L140) -- show "Registration fee" instead of `planUnavailable`; on the receipt render it as one row without the "Plan" label.
- `apps/mobile/src/locales/{en,fr}.json` -- new `awaitingRegistration.*`, `history.payments.registrationFee`, `paymentDetail.registrationFee`.
- `supabase/tests/registration_fee_member_app.test.sql` -- new pgTAP file; copy fixture and plan conventions from `registration_fee_tara_collection.negative.test.sql`.
- Enforcement already exists: `check_in()` (0027:80-88) rejects a member with no subscription; `book_class_session` (0058:160) raises "no active subscription"; `initiate_member_payment` raises `no_active_plan` (pinned in 18.3). Mobile has no test runner, so the client changes are covered by typecheck, lint and device QA.

## Tasks & Acceptance

**Execution:**
- [x] `apps/mobile/src/hooks/use-session.tsx` -- add `isAwaitingRegistration` and `refresh()`; foreground refresh while awaiting -- state source for the gate
- [x] `apps/mobile/src/app/_layout.tsx` -- fourth protected group with precedence and exclusions -- routing
- [x] `apps/mobile/src/app/awaiting-registration.tsx` -- message, Check again (loading and still-awaiting note), Log out, no payment option -- blocked screen
- [x] `apps/mobile/src/app/onboarding/plan.tsx` -- retry link on the no-plan card -- settled-but-unassigned member
- [x] `apps/mobile/src/services/payments.ts` and both history screens -- purpose, voided filter, "Registration fee" label -- fee receipt (FR-041, FR-152)
- [x] `apps/mobile/src/locales/{en,fr}.json` -- EN and FR strings -- i18n gate
- [x] `supabase/tests/registration_fee_member_app.test.sql` -- as an awaiting member: own row readable with NULL settled-at; `check_in()`, `book_class_session` and `initiate_member_payment` raise; a settled member reads their fee payment (purpose, no subscription_id); a voided row is still readable by RLS, which is why the client filters it -- server-side blocking proof (positive control paired with each denial)

**Acceptance Criteria:**
- Given an awaiting member in an active gym, when they sign in, then they see the blocked screen and no payment option.
- Given the gym is suspended and the member is awaiting, then the suspended screen shows.
- Given staff settle the fee after the screen shows, when the member taps Check again or foregrounds the app, then they reach onboarding without relaunching.
- Given a settled member with a fee payment, when they open history or its receipt, then it reads "Registration fee" with amount, method, date, reference and actor intact.
- Given any new string, then `pnpm check:i18n` passes.

## Implementation Notes

- `check_in()` (0034) does not raise for a member with no subscription: it returns NULL, writes no attendance row and upserts a front-desk 'expired' alert. The pgTAP asserts that instead of a raise. An awaiting member therefore creates a staff alert if they scan; no code change made (outside this story's boundaries).
- `refreshOnboardedState` now returns early without committing state when the members query errors (previously a failure fell through to isOnboarded false).
- Fee-0 gyms are unaffected: their members are settled at insert, so the awaiting flag is never set.

## Spec Change Log

## Review Triage Log
| Finding | Verdict | Evidence |
|---|---|---|
| Overlapping refreshes (auth change / Check again / foreground) can commit out of order; in-flight refresh can commit a prior user's flags | low -> patch | Real but narrow; fixed with a refreshSeq guard so only the latest call commits (use-session.tsx). |
| memberError / gym-status error on first load fails open into onboarding | false | Pre-existing: before this story a members error also left isOnboarded false (same fall-through); the early return is no worse and the gym-status branch was already there. |
| Staff/coach/owner rows treated as awaiting | false | 0098:79 settles every role other than 'member' at insert; gate is role='member' only. |
| voided_at filter hides voided payments of every purpose | false | voided_at is only ever written by the fee void RPC (0101); subscription payments cannot be voided. |
| SQL assertions "pin the client filter" but test SQL only | low -> patch | Messages renamed to say they pin data shape / RLS; client filter is device-QA. |
| No mobile test harness for gate, services, screens | false | apps/mobile has no test runner by repo convention (spec states client is covered by typecheck/lint/device QA); adding a harness is not this story's intent. |
| No server enforcement for an unsettled member who has a subscription | false | State unreachable: 0098 BEFORE INSERT gate blocks subscriptions for awaiting members and 0101 void requires no subscription. |
| Awaiting member scanning QR creates a front-desk "expired" alert (check_in returns NULL, 0034) | medium -> defer | Pre-existing check_in behaviour, not caused by this story; spec text saying check_in raises was wrong, recorded in Implementation Notes. Entry in deferred-work.md. |
| handleLogOut uses profile.errorSaveFailed; caches cleared before signOut; duplicated from suspended.tsx | false | Verbatim precedent of suspended.tsx; spec says keep suspended untouched. |
| Accessibility state/hitSlop, gym contact details, receipt styling/icon | low, rejected | Cosmetic; copy is a flagged [ASSUMPTION] pending the FR-155 UX pass; fix adds surface. |
| plan.tsx Try again can double-fire | false | loadPlan sets loading=true, which hides the no-plan card (rendered only when !loading). |
| setState after unmount in handleCheckAgain | low, rejected | React 18+ emits no warning; harmless. |
| Foreground refresh failure silent; unknown purpose label; test vacuity if defaults change; _layout exclusivity | false/low, rejected | Foreground failure self-heals on next foreground/Check again; unknown purposes do not exist (check constraint); awaiting NULL is asserted via the member's own RLS read; tabs group guard is isFullyOnboarded which now excludes showAwaiting. |

## Design Notes

Hiding voided fee rows client-side is a decision: a void is a correction of a mistaken record, so the member should not see a receipt for money the gym says was never taken. RLS still lets the member read the row, so the filter lives in the two services, not the policy (no RLS change in this story).

## Verification

**Commands:**
- `pnpm --filter mobile typecheck` -- expected: 0 errors
- `pnpm --filter mobile lint` -- expected: 0 errors
- `pnpm check:i18n` -- expected: parity clean
- `pg_prove` on `supabase/tests/registration_fee_member_app.test.sql` plus the full pgTAP suite -- expected: all pass

**Manual checks (product owner on device, needs a mobile build):**
- Blocked screen, Check again after settlement, and a fee receipt in history.
