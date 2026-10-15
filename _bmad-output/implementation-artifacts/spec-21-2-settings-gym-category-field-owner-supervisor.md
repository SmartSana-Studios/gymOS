---
title: '21-2 Settings gym category field, Owner/Supervisor'
type: 'feature'
created: '2026-10-15'
status: 'done'
baseline_commit: '448d003af02a3eafe0946740b7e9795f1727af06'
route: 'oneshot'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-21-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Owners and Supervisors cannot see or change their gym's category (FR-171); only Super Admin can, via 21.1's `set_gym_category`.

**Approach:** Add a Category select with its own [Save category] to the Branding block on Settings, under Primary Colour, calling `set_gym_category` through a new service + Server Action. No migration; `gymSettingsSchema` and [Save Settings] stay untouched.

## Implementation Notes

Per epics.md Story 21.2 ACs. Select shows the five `GYM_CATEGORIES` with `gymCategoryLabel` in the UI language; helper "Describes your business. It doesn't change how GymOS works."; [Save category] enabled only when changed; toast "Category saved."; refusal inline "Couldn't save the category. Try again."; control rendered only for owner/supervisor (absent from DOM otherwise); category state independent of the main form. EN/FR parity. Tests: action, form.

</frozen-after-approval>

## Review Triage Log

| # | Finding (Blind Hunter) | Verdict | Evidence / route |
|---|---|---|---|
| 1 | Saved value taken from live state, select editable mid-save | medium, patched | submitted value captured, select disabled while saving |
| 2 | Thrown-action path untested | low, patched | test added |
| 3 | selectError / FR labels untested in form | low, rejected | selectError covered in action test; labels covered by 21-1 `gymCategoryLabel` tests |
| 4 | Stale local state if `initial.category` changes | low, rejected | same pattern as sibling controls |
| 5 | Unchanged value still toasts under concurrent change | low, rejected | no data impact |
| 6 | `GymSettingsRow.category` typed string | low, rejected | cosmetic |
| 7 | Two save affordances in one card | false | prescribed by the story ACs |
| 8 | Field hidden from Super Admin in Settings | false | Super Admin has the 21-1 detail editor; ACs gate to Owner/Supervisor |

## Change Log

- Settings right column rebalanced at the user's request: Payments, Billing and Staff moved to the left column (identity and account), right column keeps Localization, Membership, Loyalty, Attendance, Front desk alerts. No content changes.
