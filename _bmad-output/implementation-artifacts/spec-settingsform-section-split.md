---
title: 'Split SettingsForm.tsx by section'
type: 'refactor'
created: '2026-10-15'
status: 'done'
baseline_commit: '537e86d466d67b5fdfbb2753c1101a29e02739ce'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-21-retro-2026-10-15.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `SettingsForm.tsx` is 1474 lines holding ~60 `useState` hooks, six dialogs and ten sections; it grew +79 lines in Epic 21 and was flagged by the Epic 20 and 21 retros (epic-20 item 43, epic-21 action A1).

**Approach:** Pure move. Each section with its own save path (QR, Payments, Billing, Registration fee, Category, Charge guests) becomes a component that owns its state, handlers, effects and dialogs; the sections bound to the main form (Branding, Localization, Membership fields, Attendance, Front desk alerts) become presentational components fed by `SettingsForm`, which keeps the form state, validation, `handleSubmit`, toast and layout.

## Boundaries & Constraints

**Always:**
- No change to behavior, DOM structure, class names, ids, labels, i18n keys, server action calls or the Settings layout (left: QR, Branding, Payments, Billing, Staff; right: Localization, Membership, Loyalty, Attendance, Front desk alerts).
- `SettingsForm`'s props and exports unchanged; the existing `SettingsForm.*.test.tsx` and `page.test.tsx` pass without edits except import-path mocks if a mocked module moves.
- Section components take `onToast`/`role`/`initial` slices as props; none reads another section's state. `loyaltyActive` stays readable by the charge-guests turn-off dialog as today.
- Shared pure helpers (`formatLocalDate`, `TIMEZONE_OPTIONS`, `HEX_COLOR_RE`, field-error types) move to a small module only when two files need them.
- Section files sit next to `SettingsForm.tsx` (like `LoyaltyProgramSection.tsx`), named `<Section>Section.tsx`.

**Never:** No new features, no copy changes, no reordering, no style cleanups, no dependency changes, no edits to server actions or services, no change to `gymSettingsSchema`.

</frozen-after-approval>

## Code Map

- `apps/dashboard/app/(dashboard)/settings/SettingsForm.tsx` -- source, 1474 lines: state 142-232, effects 236-276, handlers 278-646, JSX 647+ (QR 660, Branding 692, Localization ~812, Membership ~870, Loyalty ~981, Attendance ~1143, Front desk ~1173, Payments ~811 left, Billing ~868, Staff ~938, dialogs after the form)
- `apps/dashboard/app/(dashboard)/settings/LoyaltyProgramSection.tsx` -- precedent for a self-contained section and its props (`onSaved`, `onEnabledChange`)
- `apps/dashboard/app/(dashboard)/settings/SectionHeader.tsx` -- shared header, unchanged
- `apps/dashboard/app/(dashboard)/settings/SettingsForm.{billing,guestCharging,loyalty,payments,registrationFee,category}.test.tsx`, `page.test.tsx` -- behavior pins; must stay green and are the proof of "no change"

## Tasks & Acceptance

**Execution:**
- [x] `QrCodeSection.tsx` -- own `gymToken`, `qrDataUrl`, regenerate dialog, download -- self-contained
- [x] `PaymentsSection.tsx` -- own connection state, connect/disconnect forms and dialogs
- [x] `BillingSection.tsx` -- own `billingInfo`, notification email, pay-now confirmation refetch
- [x] `GuestChargingSection.tsx` (+ registration fee and category as small components or inside `MembershipSection.tsx`/`BrandingSection.tsx`) -- own state, impact loading, on/off dialogs
- [x] `BrandingSection.tsx`, `LocalizationSection.tsx`, `MembershipSection.tsx`, `AttendanceSection.tsx`, `FrontDeskAlertsSection.tsx`, `StaffSection.tsx` -- presentational, props from the form
- [x] `SettingsForm.tsx` -- reduced to form state, `handleSubmit`, toast, layout and composition; target under ~450 lines
- [x] Move one section at a time, running its test file after each move

**Acceptance Criteria:**
- Given the refactor, when `vitest run "app/(dashboard)/settings"`, `tsc --noEmit` and `scripts/ci-local.sh` run, then all pass with no test edited beyond import-path mocks.
- Given `SettingsForm.tsx`, when the move is done, then it is under ~450 lines and no section component exceeds ~350.
- Given the diff, when reviewed, then every removed line in `SettingsForm.tsx` appears (re-indented or re-scoped only) in a section file.

## Implementation Notes

- `SettingsForm.tsx` 1474 -> 268 lines. New files: QrCodeSection (hook + card + regenerate dialog), PaymentsSection (hook + card + connect/disconnect dialogs), BillingSection, StaffSection, RegistrationFeeField, GuestChargingSection (hook + toggle + dialogs), GymCategoryField, BrandingSection, useLogoUpload, LocalizationSection, MembershipSection, AttendanceSection, FrontDeskAlertsSection, settingsFormTypes. Largest: PaymentsSection 331 lines.
- Sections that own a card inside the form and a `<dialog>` outside it export a hook plus two components (card, dialogs) so the DOM position is unchanged.
- Moved by script from the original file's line ranges (handlers verbatim); `tsc`, eslint clean.
- **Proof of no change:** a temporary test rendered the pre-split and post-split component for 64 combinations (owner/supervisor/manager/none x billing present/absent x provider connected/not x charging on/off x loyalty flag set/unset) and compared `innerHTML`: identical. The test and the pre-split copy were deleted afterwards.

## Review Triage Log

No reviewer subagents were run. The byte-identical DOM comparison above and the 14 existing settings test files (145 tests, unedited apart from the Epic 21 fixtures) stand in for the review lenses; verification gaps remaining are interaction paths the existing tests do not cover (connect/disconnect and regenerate dialogs were moved verbatim).

## Verification

**Commands:**
- `cd apps/dashboard && npx tsc --noEmit` -- expected: no errors
- `npx vitest run "app/(dashboard)/settings"` -- expected: all pass
- `bash scripts/ci-local.sh` -- expected: GREEN

**Manual checks:**
- Settings page renders identically for owner (all sections, both dialogs openable); a Manager session still has no Category or Charge guests control.
