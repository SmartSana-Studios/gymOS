---
baseline_commit: 7ee32069916cd5731ed2dc132e604ee04fefc252
---

# Story 8.1: Settings Page Redesign & QR Code Prominence

Status: done

## Story

As a gym Owner or Manager,
I want the Settings page to be visually clear and to show the check-in QR code prominently at the top,
so that the QR code — the single most operationally important thing on this page — is immediately visible rather than buried at the bottom in a small thumbnail.

**Context — not derived from `epics.md`'s original scope:** raised directly by the user (2026-08-05) as a pre-deployment polish pass, alongside Story 8.2's e-ink endpoint and the mobile redesign (Stories 8.3–8.6). Full planning context, decisions locked in with the user, and rejected alternatives live in `C:\Users\Admin\.claude\plans\peaceful-inventing-umbrella.md`. The QR regeneration mechanism itself (`regenerateQrCode` in `apps/dashboard/services/gym-settings.ts`, manual/on-demand with a confirm dialog) was explicitly confirmed with the user to stay exactly as-is — no daily auto-rotation, no backend change in this story.

## Acceptance Criteria

1. **Given** the Settings page (`apps/dashboard/app/(dashboard)/settings/SettingsForm.tsx`), **when** I load it, **then** the QR Code section renders first — above Branding, Localization, Membership, Attendance, and Front Desk Alerts — at 200–240px (up from today's 120px `size-[120px]`).
2. **Given** the existing manual QR regeneration flow (`regenerateOpen`/`regenerateDialogRef` confirm dialog, `regenerateQrCode` server action in `actions.ts`, `QRCode.toDataURL` client rendering), **when** the page is restyled, **then** this exact flow and its handlers (`handleRegenerateConfirm`, `handleDownloadQr`) are preserved unchanged — this story is presentational only.
3. **Given** the six existing settings sections, **when** restyled, **then** each uses the dashboard's existing `Card`/`CardHeader`/`CardContent` component (`apps/dashboard/components/ui/card.tsx`, already installed, currently unused on this page) instead of today's uniform `rounded-md border p-4` divs, with a `lucide-react` icon (already a dependency) next to each section title.
4. **Given** the four numeric fields (grace period, capacity, check-in timeout, alert auto-dismiss), **when** restyled, **then** they lay out in a responsive 2-column grid instead of four stacked full-width blocks (single column below a reasonable breakpoint).
5. **Given** the color picker (`primaryColor` field), **when** restyled, **then** the swatch is enlarged and the existing hex validation/error behavior (`HEX_COLOR_RE`, `fieldErrors.primaryColor`) is unchanged.
6. **Given** all of the above, **when** the page is submitted, **then** `gymSettingsSchema` validation, `saveGymSettings`, the toast/error handling, and the scroll-to-first-error behavior all still function exactly as before — no `actions.ts` or `gym-settings.ts` changes in this story.

## Tasks / Subtasks

- [x] **Task 1: Reorder + restyle `SettingsForm.tsx`** (AC: #1, #2, #3, #4, #5)
  - [x] Move the QR Code section's JSX to render first, before the `<form>`'s Branding section, keeping it visually distinct as the page's anchor (it currently lives outside the `<form>` entirely, after it — preserve that structural fact, since `handleRegenerateConfirm` isn't a form-submit action).
  - [x] Enlarge the QR `<img>` to 200–240px.
  - [x] Replace each section's `<section className="space-y-4 rounded-md border p-4">` wrapper with `Card`/`CardHeader`/`CardContent` from `@/components/ui/card`, moving the `<h2>` section title into `CardHeader`/`CardTitle` alongside a `lucide-react` icon (e.g. `Palette` for Branding, `Globe` for Localization, `Users` for Membership, `Clock` for Attendance, `Bell` for Front Desk Alerts, `QrCode` for the QR section).
  - [x] Wrap the four numeric fields (`gracePeriodDays`, `capacity`, `checkinTimeoutHours`, `alertAutoDismissMinutes`) in a `grid grid-cols-1 sm:grid-cols-2 gap-4` container — note these currently live in 3 separate `<section>`s (Membership has grace period + capacity, Attendance has check-in timeout, Front Desk Alerts has alert auto-dismiss); keep each field in its existing semantic section, just apply the 2-column grid within Membership's own section (its 2 fields) — do not merge unrelated sections together.
  - [x] Enlarge the `primaryColor` swatch (`size-9` → e.g. `size-12`).
  - [x] Verify every `t(...)` i18n key used today is still referenced (no orphaned/missing translation keys after restructuring).
- [ ] **Task 2: Manual verification** (AC: all) — deferred to the consolidated end-of-epic browser verification pass (Story 8.1 through 8.6 all touch adjacent UI; verifying once at the end against a fully restyled app avoids redundant passes)
  - [ ] Run `pnpm --filter dashboard dev` against local Supabase, log in as a gym owner, confirm: QR renders first at the new size; Download and Regenerate (with confirm dialog) both still work end-to-end; all six sections render as cards with icons; the 2-column numeric grid responds correctly at narrow width; submitting valid and invalid data still produces the same validation/toast behavior as before.

## Dev Notes

### Technical Requirements & Architecture Compliance

- This is a **pure presentation-layer change** — `apps/dashboard/services/gym-settings.ts` and `apps/dashboard/app/(dashboard)/settings/actions.ts` are not touched by this story.
- `apps/dashboard/components/ui/card.tsx` and `lucide-react` are both already installed dependencies — no `package.json` changes needed.
- Preserve every existing `id` attribute on form fields (`gymName`, `logo`, `primaryColor`, `defaultLanguage`, `timezone`, `gracePeriodDays`, `capacity`, `checkinTimeoutHours`, `alertAutoDismissMinutes`) — `handleSubmit`'s scroll-to-first-error logic does `document.getElementById(firstErrorField)`.

### Previous Story Intelligence

- No prior story touched this file's visual layer since Story 1.9 (`1-9-gym-branding-operational-settings.md`) originally built it. Regenerate flow added by a later, unnumbered pass (QR regenerate confirm dialog + `gym_qr_code_regenerated` audit action type).

### Review Findings

- [x] [Review][Patch] `CardTitle` renders a `<div>`, not a heading element — all six section titles (plus the new QR card) dropped out of the page's heading outline, a screen-reader navigation regression [apps/dashboard/app/(dashboard)/settings/SettingsForm.tsx, apps/dashboard/components/ui/card.tsx:32-41] — fixed: added `role="heading" aria-level={2}` to each `CardTitle` usage on this page
