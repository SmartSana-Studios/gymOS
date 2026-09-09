---
baseline_commit: 1f93fcae1b9d4c7a2e5f8b3c6d9a0e4f7b2c5d81
---

# Story 1.20: Pay Now Dialog Nests a `<form>` Inside Settings' Own Form — Hydration Error

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a gym owner opening Settings on a gym with an outstanding subscription payment,
I want the page to hydrate cleanly,
so that the Billing section behaves reliably instead of depending on React recovering from invalid markup.

**Context — not derived from `epics.md`.** Reported by smartsana on 2026-09-09 from the browser console while manually verifying Story 1.19's gym-switch fix:

```
In HTML, <form> cannot be a descendant of <form>.
This will cause a hydration error.
  at form (<anonymous>)
  at PayNowButton (components/shared/PayNowButton.tsx:216:9)
  at SettingsForm (app/(dashboard)/settings/SettingsForm.tsx:880:21)
  at SettingsPage (app/(dashboard)/settings/page.tsx:56:7)
Next.js version: 16.3.4 (Turbopack)
```

Unrelated to Story 1.19 — pre-existing, and surfaced only because that fix made gym switching work well enough to reach this state.

### Root cause

`SettingsForm` wraps its whole body in one `<form>` (`SettingsForm.tsx:518`–`932`) and renders `<PayNowButton>` inside it at line 880, in the Billing section. `PayNowButton` in turn renders a `<dialog>` containing its own `<form onSubmit={handlePayNowSubmit}>` (`PayNowButton.tsx:216`). HTML forbids a form descending from another form, and the parser resolves it by **dropping the inner `<form>` tag entirely** — so the server-rendered DOM and React's client tree disagree, which is the hydration error.

Two things kept this hidden:

1. **It is gym-dependent.** `<PayNowButton>` renders only when `billingInfo.billingStatus !== "active"` (`SettingsForm.tsx:879`). Gyms with healthy billing never render it, so the console stays clean. Locally only `Martin Fitness` (`saas_billing_status = past_due`) reproduces it.
2. **React recovers.** Hydration mismatches are repaired by client-rendering the affected subtree, so the dialog still worked — the defect showed up as a console error rather than a visibly broken feature.

The rest of the codebase already avoids this: `SettingsForm`'s own Tara-connect dialog lives at line 969, **after** the main form closes at 932. `PayNowButton` was the exception because it is a component dropped inline into the Billing section, so its dialog inherited whatever nesting the call site had.

## Acceptance Criteria

1. **Given** `/settings` for a gym whose billing status is not `active`, **when** the page loads, **then** the console shows no "form cannot be a descendant of form" hydration error.
2. **Given** the Pay Now dialog, **when** it is opened, **then** it is not a descendant of any `<form>`, while retaining its own `<form>` and submit behaviour.
3. **Given** the phone field inside that dialog, **when** the country picker is used, **then** it opens and selecting a country updates the field — Story 16.1's in-place (deliberately un-portaled) popover must keep working under `showModal()`'s inertness rules.
4. **Given** `PayNowButton`'s other caller (`SuspendedGymScreen`, where it is *not* inside a form), **when** it is used, **then** behaviour is unchanged.
5. **Given** server-side rendering, **when** the page is rendered, **then** no portal is attempted against a `document.body` that does not exist.
6. A regression test fails without the fix and passes with it.

## Tasks / Subtasks

- [x] Confirm the nesting and its trigger (AC #1)
  - [x] Locate the outer form boundaries (`SettingsForm.tsx:518`–`932`) and the inline call site (line 880)
  - [x] Establish the `billingStatus !== "active"` gate as the reason it is gym-dependent
  - [x] Identify `Martin Fitness` (`past_due`) as the local reproduction case
  - [x] Check both `PayNowButton` call sites — only the `SettingsForm` one is inside a form
- [x] Fix (AC #2, #4, #5)
  - [x] Portal the dialog to `document.body` via `createPortal`
  - [x] Gate on `payNowOpen` so nothing is portaled during SSR, and the dialog is absent when closed
  - [x] Verify no field state is lost by unmounting the closed dialog (all of it is component state)
- [x] Verify (AC #1, #2, #3, #6)
  - [x] Reload `/settings` on the `past_due` gym — nested-form error gone
  - [x] Confirm the opened dialog reports `parent: BODY`, `inForm: false`, `forms: 1`
  - [x] Exercise the country picker inside the portaled dialog (15 Tara countries; selection updates the trigger)
  - [x] Screenshot the dialog to confirm it renders and is positioned correctly
  - [x] Add a regression test; confirm red without the fix and green with it
  - [x] Typecheck, lint, full suite

### Review Findings

Adversarial code review, 2026-09-09 (Blind Hunter + Edge Case Hunter + Acceptance Auditor, diff `0acecb2^..b04f11f`).

- [x] [Review][Patch] **The portal removed the invalid markup but not the coupling it caused** — submitting the Pay Now dialog still runs `SettingsForm`'s full validate-and-save path, because React propagates events along the React tree, not the DOM tree. `handlePayNowSubmit` calls `preventDefault()` but never `stopPropagation()` [apps/dashboard/components/shared/PayNowButton.tsx:129]
- [x] [Review][Patch] `SettingsForm.billing.test.tsx`'s "a successful submit must actually close the native `<dialog>`" assertion now runs against a detached node and would pass even if `close()` were never called [apps/dashboard/app/(dashboard)/settings/SettingsForm.billing.test.tsx:181]
- [x] [Review][Patch] The `selectableTiers.length > 0` branch — ~20 lines rewritten wholesale by the re-indent — is rendered by no assertion in either test file, both of which pass `selectableTiers={[]}` [apps/dashboard/components/shared/PayNowButton.nestedForm.test.tsx:266]
- [x] [Review][Patch] Four whitespace-only lines left by the mechanical re-indent, contradicting the "everything else is re-indentation" claim; no lint rule catches them [apps/dashboard/components/shared/PayNowButton.tsx:244,280,291,293]
- [x] [Review][Defer] Both `settings.billing.payNow` and `settings.billing.payNowDialogTitle` map to the literal "Pay Now" in the fixture, so any post-open `getByRole("button", { name: "Pay Now" })` will throw "found multiple elements" [apps/dashboard/components/shared/PayNowButton.nestedForm.test.tsx:244-245] — deferred, pre-existing

## Dev Notes

### The fix

```tsx
{payNowOpen &&
  createPortal(
    <dialog ref={payNowDialogRef} …>…</dialog>,
    document.body,
  )}
```

Gated on `payNowOpen` rather than the usual `mounted` flag. `payNowOpen` is already `false` during SSR, so the portal is never attempted where `document.body` does not exist (AC #5), and it needs no extra state. Unmounting the dialog while closed is safe because every value it edits (`payNowPhone`, `tierId`, `billingInterval`, `payNowError`) lives in the component, not the dialog subtree — and `openPayNowDialog()` resets them on each open regardless.

`showModal()` still fires correctly: effects run after commit, so when `payNowOpen` flips true the portal mounts and `payNowDialogRef` is populated before the `useEffect([payNowOpen])` body runs.

### Why a portal here does not contradict Story 16.1

Story 16.1 deliberately did **not** portal `PopoverContent`, because a modal `<dialog>` makes everything outside its own DOM subtree inert — portaling the popover to `<body>` put it outside the dialog, so the country picker opened but clicking an option did nothing.

This change portals the **dialog itself**, which is the opposite direction: the popover stays exactly where it was, inside the dialog's subtree, so it remains within the non-inert region. Verified rather than assumed — see the country-picker check below. This is the first `createPortal` in `apps/dashboard`, so the distinction is recorded in-code at the call site.

### Verified in the browser (Martin Fitness, `past_due`)

```
console errors on /settings: (only the pre-existing "uncached data during
                              prerendering" dev warning — no nested-form error)

dialog after clicking Pay Now:
  { open: true, parent: "BODY", inForm: false, forms: 1 }

country picker inside the portaled dialog:
  15 options (Tara-restricted list), trigger 🇨🇲+237 -> 🇧🇫+226 on select
```

Before the fix, the same dialog was a descendant of `SettingsForm`'s form; the four other dialogs on the page were already outside it and were not affected.

### Scope note

Only `PayNowButton` had this problem. Every other native `<dialog>` in the app is rendered by a page-level client component outside any form. No other call site was changed.

### Testing standards

`components/shared/PayNowButton.nestedForm.test.tsx` renders the component **inside a `<form>` on purpose** — the exact condition that triggered the bug — and asserts `dialog.closest("form")` is null, that the dialog's parent is `document.body`, and that the dialog still contains exactly one form (so the fix cannot be satisfied by deleting it). `vitest.setup.ts`'s existing `showModal`/`close` polyfill covers jsdom's missing dialog methods.

Red-green verified. Without the fix all three fail, the middle one with `expected <form data-testid="outer-form"> to be null` — i.e. `closest("form")` finding the outer form, which is the defect stated literally.

### References

- `apps/dashboard/components/shared/PayNowButton.tsx:208` — the portal and its rationale.
- `apps/dashboard/app/(dashboard)/settings/SettingsForm.tsx:518,880,932,969` — outer form bounds, the call site, and the connect dialog that already sits outside the form.
- `apps/dashboard/components/ui/popover.tsx:24` — Story 16.1's un-portaled popover reasoning, unaffected by this change.

## Dev Agent Record

### Agent Model Used

Claude Opus 5 (1M context)

### Debug Log References

Dialog inventory on `/settings` before and after pressing Pay Now (post-fix). The Pay Now dialog appears only on click, and lands on `BODY`:

```
BEFORE click: 4 dialogs — "Log out of GymOS?", "Regenerate QR code?",
              "Connect your Tara Money account", "Disconnect payment account?"
              (all parent DIV, all inForm false)
AFTER  click: 5 dialogs — + { open: true, parent: "BODY", inForm: false,
                              forms: 1, heading: "Pay Now" }
```

Regression test with the fix stashed (red):

```
× renders no dialog until the button is pressed
× portals the dialog out of the surrounding <form> when opened
× keeps the outer form free of any nested form
AssertionError: expected <dialog …> to be null
AssertionError: expected <form data-testid="outer-form"> to be null
AssertionError: expected <form class="space-y-4 p-6"> to have a length of +0 but got 1
```

### Completion Notes List

- Pre-existing defect, unrelated to Story 1.19 — found while manually QA'ing that fix.
- Invisible on most gyms: `PayNowButton` renders only when billing is not `active`, so only a `past_due`/`grace_period`/`suspended` gym shows the error. Worth remembering when a console error looks unreproducible.
- Functionally the feature already worked, because React repairs hydration mismatches by client-rendering the subtree. The fix removes the invalid markup rather than a broken behaviour — but it also removes the dependency on that recovery path.
- First `createPortal` in `apps/dashboard`. The in-code comment records why this does not contradict Story 16.1's explicit decision *against* portaling popover content, since the two point in opposite directions and a future reader will otherwise see a contradiction.
- The diff looks larger than it is: 102 insertions / 77 deletions, of which everything except the import, the comment, the `{payNowOpen && createPortal(` wrapper and one comma is re-indentation. `git diff -w` shows the real change.
- Verification: typecheck 0 errors; lint 0 errors (15 pre-existing unused-var warnings); tests 35 files / 233 passed (230 before, +3 new).

### File List

- `apps/dashboard/components/shared/PayNowButton.tsx` — MODIFIED: dialog portaled to `document.body`, rendered only while open
- `apps/dashboard/components/shared/PayNowButton.nestedForm.test.tsx` — NEW: 3 regression tests

## Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-09-09 | 1.0 | Fixed the nested-`<form>` hydration error on /settings by portaling the Pay Now dialog out of `SettingsForm`'s form. Country picker inside the dialog verified unaffected. Red-green regression tests added. | Claude Opus 5 (1M context) |
