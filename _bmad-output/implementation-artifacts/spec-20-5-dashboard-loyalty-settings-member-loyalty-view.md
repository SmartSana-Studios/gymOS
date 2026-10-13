---
title: '20-5 Dashboard loyalty settings & member loyalty view'
type: 'feature'
created: '2026-10-13'
status: 'done'
baseline_commit: '0fa3fe1800346d4596560d1073a7d997cf09d7ee'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-20-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `set_loyalty_program` and `effective_loyalty` (0117) exist but no screen calls them, so no gym can switch loyalty on and staff cannot see a member's progress (FR-164 UI, FR-169 staff view).

**Approach:** Add an own-save Loyalty program section to Settings (Owner/Supervisor) with a live discount readout, and a Rewards section to the member modal fed only by `effective_loyalty`. No migration.

## Boundaries & Constraints

**Always:**
- Settings section: switch + N (2–50), K (3–24), R (1–30) with range helper text; inputs disabled while off, keeping their last values; saving off sends only the switch; N/K/R required only when switching on. Own [Save loyalty program] / [Enregistrer le programme de fidélité], excluded from [Save Settings] (the page hint already lists it); calls `set_loyalty_program` via a new service + server action; success toast "Loyalty program saved."; submit-only validation (UX-DR11) with field errors "Enter a whole number from 2 to 50" / "…3 to 24" / "…1 to 30"; any server refusal shows the summary "Couldn't save the loyalty program. Try again." (the setter's errors name no field).
- Readout (`aria-live="polite"`, recomputed after a 300 ms pause, "≈" spoken "about"/"environ"): guest `round(100/(N+1))`; subscriber `round(100·R/(K·D+R))`, one line per distinct duration D among the gym's non-pay-per-session plans naming the plan, max 3, hidden with no such plan. An out-of-range or non-integer input hides that rule's readout.
- Info line under Guests while the live Charge guests switch is off; lowered-threshold note above the save button when N or K is below the saved value; inline off-note (no dialog) while the switch is off and unsaved. Copy exactly as in EXPERIENCE.md AD-13 (EN/FR).
- The existing 19.9a `loyaltyEnabled` prop (turn-off dialog clause) is fed from the saved gym value, kept in sync after a save.
- Member modal Rewards section: receptionist/manager/supervisor/owner only (same gate as Sessions); rendered when `enabled` or a free session is held; counters "Guest progress"/"Subscriber progress" as "n / N" shown only when `enabled`; free sessions listed with expiry; unused paid sessions are not repeated (Sessions section owns them); muted line "Balances change only through the program's rules." No edit or adjust control for any role. A JSON `null` (suspended gym) or failed read leaves the section out.
- Every new string in `en.json` and `fr.json` with parity.

**Never:** No migration or `database.ts` change; no write path other than `set_loyalty_program`; no reading `loyalty_progress` directly for display; no change to `effective_loyalty` or the Sessions section; no member app work (20.6); no dialog for switching off.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Enable | on, N 5, K 3, R 30 | RPC called with all four, toast, baseline updated | N/A |
| Disable | off, fields untouched | RPC with enabled false; stored values kept | N/A |
| Enable, N=1 or blank | submit | field error, no RPC | submit-only |
| Out-of-range typing | N 99 | guest readout hidden, no error until submit | N/A |
| Annual + monthly plans | D 30, 365 | one line per D, plan named | N/A |
| 4+ distinct durations | — | first 3 lines | N/A |
| Only pay-per-session plans | — | no subscriber line | N/A |
| Setter refuses | suspended / range | summary message, section unchanged | stays editable |
| Manager/receptionist/coach | Settings | section absent | N/A |
| Member, program off, no reward | modal | no Rewards section | N/A |
| Member, program off, free session held | modal | free sessions only, no counters | N/A |
| Gym suspended | `effective_loyalty` null | no Rewards section | N/A |

</frozen-after-approval>

## Code Map

- `apps/dashboard/services/gym-settings.ts` -- `GymSettingsRow` + `getGymSettings` select gain the four loyalty columns; add `setLoyaltyProgram` RPC wrapper beside `setGuestCharging`
- `apps/dashboard/app/(dashboard)/settings/actions.ts` -- add `saveLoyaltyProgram` action (zod range check, fixed failure message), pattern of `setGuestCharging`
- `apps/dashboard/app/(dashboard)/settings/page.tsx` -- fetch `listPlans()` (services/plans.ts), pass non-session plans; stop relying on the unused `loyaltyEnabled` prop
- `apps/dashboard/app/(dashboard)/settings/SettingsForm.tsx` -- new Loyalty card after the Membership card's charge-guests control (`canManageGuestCharging` gate, live `chargeGuests` state); pure readout helper
- `apps/dashboard/services/loyalty.ts` (new) -- `getMemberLoyalty(memberId)` calling `effective_loyalty`, parsed to a typed shape, null on JSON null
- `apps/dashboard/app/(dashboard)/payments/actions.ts:363` -- `listMemberGuestSessionsAction` is the precedent for a member-modal read action; add `getMemberLoyaltyAction` in `members/actions.ts`
- `apps/dashboard/app/(dashboard)/members/components/MemberModal.tsx:432-485,796` -- `canSeeSessions` gate, effect pattern, Sessions section placement; add `RewardsSection` after it
- `apps/dashboard/locales/{en,fr}.json` -- `settings.loyalty.*`, `members.modal.rewards.*`
- Tests to mirror: `SettingsForm.guestCharging.test.tsx`, `actions.guestCharging.test.ts`, `MemberModal.sessions.test.tsx`
- Do not touch: migrations, `effective_loyalty`, `SessionsSection`

## Tasks & Acceptance

**Execution:**
- [x] `services/gym-settings.ts`, `settings/actions.ts`, `settings/page.tsx` -- loyalty fields, setter service, save action, plans for the readout -- data path for the section
- [x] `settings/SettingsForm.tsx` -- Loyalty section, readout, notes, own save, toast, kept out of `saveGymSettings` -- AD-13
- [x] `services/loyalty.ts`, `members/actions.ts`, `MemberModal.tsx` -- Rewards section from `effective_loyalty` -- AD-04
- [x] `locales/en.json`, `locales/fr.json` -- all strings, EN/FR parity test passes
- [x] tests -- form (roles, ranges, readout lines/cap/hide, notes, save payloads, disabled-off), action (validation, refusal message), modal (visibility matrix, no edit control), service (null, parse)
- [x] local gates: `scripts/ci-local.sh` all stages, sprint-status entry

**Acceptance Criteria:**
- Given an Owner on Settings, when they enable with valid N/K/R and save, then `set_loyalty_program` receives them, the toast shows, and [Save Settings] still never writes loyalty columns.
- Given a member modal for a gym with loyalty on, when opened by a receptionist, then both counters and free sessions show and no input, button or link adjusts a balance.
- Given the matrix, when vitest and `scripts/ci-local.sh` run, then all pass including EN/FR parity.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| # | Finding (layer) | Verdict | Evidence / route |
|---|---|---|---|
| 1 | Rewards stale after a session payment is recorded (BH, EC) | medium, patch | Rewards effect now also depends on `sessionsReloadKey`. Fixed |
| 2 | `getGymSettings` loyalty select/mapping unpinned (VG) | medium, patch | Added select + mapping test incl. null thresholds. Fixed |
| 3 | Page `loyaltyPlans` filter untested (VG) | medium, patch | Added page tests for filter and failed read. Fixed |
| 4 | `getMemberLoyaltyAction` untested (VG) | low, defer | RPC enforces role and gym; in deferred-work.md |
| 5 | Save not dirty-gated, off path invents 2/3/1 (BH) | false | Setter returns early on an unchanged state (no audit) and keeps stored N/K/R when disabling (0117) |
| 6 | Rewards dates in browser timezone (BH) | low, rejected | Same `toLocaleDateString` as the shipped Sessions section |
| 7 | Effect keyed on `editingMember` object, refetch flicker (BH, EC) | low, rejected | Same pattern as the Sessions effect |
| 8 | Reset window not shown, counter above threshold, invalid-date, stale summary error, text not normalised, props not re-seeded, plan-read failure silent (BH, EC) | low, rejected | Outside the spec or cosmetic; fix adds branches |
| 9 | Enabled with both thresholds null (EC) | false | Setter requires N/K/R when enabling; check constraint 0117 |
| 10 | A11y labels/error wiring (BH) | low, rejected | K input has `aria-label`; error `<p>` pattern matches the rest of the form |
| 11 | Loyalty saves separately without signal (BH) | false | Page hint already names it (existing copy) |
| 12 | Plans fetched serially for all roles; no `canManageLoyalty`; range duplication; readout visible while off; lowered note while off (BH, EC) | low, rejected | Cosmetic or spec-conformant |
| 13 | Test stubs, `void user`, locale whitespace churn (BH, VG) | low, rejected | Cosmetic; i18n parity runs in ci-local static stage |

## Design Notes

Readout line for D is deduped by duration; the plan named is the first by `created_at` (listPlans order). Disabling passes the stored N/K/R (or 2/3/1 when never configured) because the setter ignores them when off and the generated type is non-null.

### Review Findings

Code review pass 2 (2026-10-13), 4 layers: Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor. Diff `epic/20...HEAD`.

- [x] [Review][Patch] Rewards re-read after a recorded session payment is unpinned (medium) — `MemberModal.rewards.test.tsx` stubs `RecordSessionPaymentDialog` to null, so `onRecorded` never fires; dropping `sessionsReloadKey` from the deps keeps every test green. Add a test that fires `onRecorded` and asserts a second `getMemberLoyaltyAction` call and the updated render [apps/dashboard/app/(dashboard)/members/components/MemberModal.tsx:531]
- [x] [Review][Patch] Readout live regions mount together with their content (low) — `{readoutN !== null && <p aria-live>}` and the subscriber `<div aria-live>` appear already filled, which many screen readers do not announce; first-time setup (blank N) hits this on the first valid entry. Keep an always-mounted `aria-live` container and swap its children [apps/dashboard/app/(dashboard)/settings/SettingsForm.tsx:1105,1173]
- [x] [Review][Patch] Unrelated locale reformatting in the story diff (low) — `payments.sessions.table` expanded to multiple lines and `paidRefundedAfterUse` re-indented in both locale files; revert those hunks [apps/dashboard/locales/en.json:1177, apps/dashboard/locales/fr.json]
- [x] [Review][Patch] Three small test gaps (low) — no stale-member test for the `loyalty.memberId === editingMember.id` guard, no `{error}` result case for a failed read (only `{data: null}`), and no assertion that N/K/R show stored values after editing then saving off [apps/dashboard/app/(dashboard)/members/components/MemberModal.rewards.test.tsx, apps/dashboard/app/(dashboard)/settings/SettingsForm.loyalty.test.tsx]
- [x] [Review][Defer] 300 ms readout pause is not pinned by a test (low) — deferred: behaviour is correct today; replacing `useDebouncedValue` with a pass-through keeps all tests green. A fake-timer test would close it. [apps/dashboard/app/(dashboard)/settings/SettingsForm.tsx:260]

#### Rejected

| Finding (layer) | Verdict | Why |
|---|---|---|
| Spec ticks ci-local all stages, header says `done`, empty Implementation Notes (BH, AA) | rejected | Fix edits the spec under review. The gate itself is a process step: sprint-status already records clean-tree `ci-local.sh` as pending, and it must pass before the PR merges. |
| Hand-rolled ranges instead of zod / duplicated ranges (BH) | false | `handleSaveLoyalty` imports `LOYALTY_RANGES` from `loyaltyReadout.ts`, one source for form and readout. Server-side range check is the RPC. |
| Save not dirty-gated, off path fires RPC and toast (BH, EC, AA) | false | Spec I/O matrix mandates "Disable, fields untouched: RPC with enabled false"; setter early-returns on unchanged state, no audit row. |
| Field errors not linked to inputs (BH) | low, rejected | Error `<p>` pattern matches the rest of the form; fix adds ids and aria wiring across three fields. |
| Plan filter / ordering suspect (BH, AA) | false | `listPlans` orders `created_at asc` so the first plan names the duration; the spec says "non-pay-per-session plans" and the page test pins `class_only` as included. No archived flag exists in the select. |
| "≈ 0%" readout (BH, EC) | low, rejected | Only at the extreme corner (R=1, K=24, annual plan); "<1%" needs new EN/FR copy and a branch. |
| No unsaved-changes affordance (BH) | false | Page hint already names the separate save; spec makes it an own-save card. |
| Off state shows edited values; lowered note and off-note together (BH, AA) | low, rejected | Spec: inputs disabled while off keeping last values; combined case not specified and harmless. |
| Loyalty card gated by `canManageGuestCharging`, serial plans fetch (BH) | low, rejected | The Code Map prescribes that gate; serial fetch is cosmetic. |
| Dates in browser timezone, window days not shown, invalid date (BH) | low, rejected | Same `toLocaleDateString` as the shipped Sessions section; window days are outside the spec. |
| `loyaltyEnabled=false` bypasses `??` fallback (EC) | false | No production caller passes `loyaltyEnabled` to `SettingsForm` (page no longer does); the prop is only a test hook. |
| Rewards card with enabled and both thresholds null (EC) | false | Setter requires N/K/R when enabling and 0117 has a check constraint; unreachable. |
| Stale summary error persists while editing (EC) | low, rejected | Cleared on the next save; fix adds handlers to every input. |
| Fragile `setTimeout(20)` absence assertions, `void user;` (BH) | low, rejected | Cosmetic test hygiene. |
| `getMemberLoyaltyAction` invalid-id guard untested (VG, AA) | low, already deferred | In `deferred-work.md` from review pass 1. |
