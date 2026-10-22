---
title: '23-12 GymOS Support page: tabs, action modals and standard tables'
type: 'feature'
created: '2026-10-22'
status: 'done'
baseline_commit: '96477eedbb352e6568380f6a3f5740162925980e'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-23-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Super Admin GymOS Support page is one long scroll: an inline create form, one page-wide "reason" box that silently disables every action button until it is filled, and five unpaginated tables. It does not follow the platform's conventions (modals for forms, standard tables with the rows-per-page selector, action menus on rows).

**Approach:** Rebuild the page's presentation, with no change to any server action or database function: action buttons at the top that open modals, the five sections as tabs, every table on the shared table conventions, and row actions in an "Actions" dropdown like the Members page.

## Boundaries & Constraints

**Always:** Top action buttons: **Create account** (modal: name, email), **Assign to gym** (modal: person, gym, reason), **Run due resets** (button, shows the result). Tabs, in this order: **Accounts**, **Assignments**, **Locked accounts**, **Lifecycle**, **Disclosure requests**; the selected tab lives in the URL (`?tab=`) so a reload or a shared link keeps it. Every table uses `TablePagination` (compact at the top, full below) with `useClientPagination` (default 10), like Gyms and Admins. Row actions are one "Actions" button with a `DropdownMenu` per row (Members page pattern: icon items, only the actions valid for that row). Every action that needs a reason (confirm, unassign, deactivate, remove, unlock, recertify, start reset, change address) opens its own modal with a Reason field (3 to 500 characters), inline validation and a submit button, replacing the page-wide reason box; destructive ones use the same confirm wording as today. Modals use the platform dialog (`CreateGymModal` / `components/ui/dialog.tsx`), close on success and on Escape, and report success or error as a toast or inline message the way the Gyms page does. A new `components/ui/tabs.tsx` mirrors the dashboard's (add `@radix-ui/react-tabs` to the app, same version). The per-gym panel on the gym detail page (`GymSupportPanel`) reuses the same assignments table and modals. All strings EN and FR; light and dark themes; works at phone width.

**Never:** No change to `support/actions.ts`, any migration, the dashboard app or any RPC. No new permission. No change to what the Owner sees. Do not drop any existing action or state (invite pending/expired/used, reset states, lock reasons, overdue banner).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Open page | No `?tab` | Accounts tab, top buttons visible | N/A |
| Reload on a tab | `?tab=locks` | Same tab opens | Unknown value falls back to Accounts |
| Create account | Valid name + @gymosapps.com | Modal closes, row appears, success message | Domain and refusal messages inline in the modal |
| Row action | Click Actions > Unassign | Modal asks for a reason; submit disabled until 3 to 500 characters | Server refusal shown in the modal, stays open |
| Table size | More than 10 rows | Rows-per-page selector and page buttons work per tab | N/A |
| Empty tab | No rows | Existing empty-state text | N/A |
| Gym detail page | Assignments for that gym | Same table and modals, assign button fixed to that gym | Same |

</frozen-after-approval>

## Code Map

- `apps/super-admin/app/(admin)/support/components/SupportPageClient.tsx` -- the page to split: create form, reason box, accounts table.
- `.../SupportAssignmentsPanel.tsx`, `SupportLifecyclePanel.tsx`, `SupportLocksPanel.tsx`, `DisclosureInbox.tsx`, `GymSupportPanel.tsx` -- become tab contents; their `reason` prop goes away; tests beside each exist and must be updated.
- `apps/super-admin/app/(admin)/support/actions.ts` -- unchanged; every call keeps its current signature.
- `apps/super-admin/app/(admin)/gyms/components/GymsPageClient.tsx`, `CreateGymModal.tsx`, `apps/super-admin/components/TablePagination.tsx`, `hooks/use-table-pagination.ts` -- the conventions to copy.
- `apps/dashboard/components/ui/tabs.tsx`, `app/(dashboard)/members/components/MembersPageClient.tsx` (~l.436-480) -- tabs primitive and the row "Actions" dropdown to mirror.
- `apps/super-admin/components/ui/dropdown-menu.tsx`, `dialog.tsx` -- present. `package.json` -- add `@radix-ui/react-tabs`.
- `apps/super-admin/locales/en.json`, `fr.json` -- `support.*` keys; i18n parity check must pass.
- `scripts/epic23-qa/README.md` -- Super Admin rows (A, L) reworded to the new layout.

## Tasks & Acceptance

**Execution:**
- [x] `components/ui/tabs.tsx` + `package.json` -- tabs primitive -- needed by the page.
- [x] `support/components/` -- split the page into tabs; shared `SupportActionModal` (reason + confirm); `CreateSupportAccountModal`; `AssignSupportModal`; row Actions dropdowns -- the new layout.
- [x] `GymSupportPanel.tsx` and the gym detail page -- reuse the assignments table and modals.
- [x] Locale files -- new tab, button and modal strings, EN and FR.
- [x] Vitest -- each tab renders and paginates, `?tab=` round trip, each modal validates the reason and calls the right action with the right arguments, row menus show only valid actions, empty states.
- [x] `scripts/epic23-qa/README.md` -- rewrite rows A1-A16 and L1-L16 for the new layout.

**Acceptance Criteria:**
- Given the page, when a Super Admin opens it, then they see the three top buttons and five tabs, and no inline form or page-wide reason box remains.
- Given any row action, when chosen, then a modal collects the reason and the same server action runs as before.
- Given any table with more than 10 rows, when viewed, then the rows-per-page selector and page buttons behave like the Gyms table.
- Given the gym detail page, when opened, then its support panel works with the same modals.

## Implementation Notes

## Spec Change Log

## Review Triage Log

Iteration 0. Layers: blind-hunter, edge-case-hunter, verification-gap. Verdict | route | evidence.

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| Assign modal person filter (assignable, not deactivated, "not activated" label) unasserted | medium | patch | Every fixture had one qualifying account. Test added in `SupportPageClient.test.tsx`. |
| Disclosure rows reach the tab only through `SupportPageClient`, unasserted | medium | patch | Only the empty state was tested there. Test added with `?tab=disclosure` and one row. |
| Gym column dropped on the gym page, unasserted | low | patch | `GymSupportPanel` test used no rows. Test added in `SupportAssignmentsPanel.test.tsx` (header names, cell count). |
| Dead locale keys: assign.reason, assign.reasonHint, lifecycle.cancel, modal.confirm, modal.confirmUnlock, columns.gym/since/status | low | patch | Exact-key grep over app/ and components/ finds no use. Removed from en and fr; parity passes. |
| Dead re-export of REASON_MAX/MIN from `SupportAssignmentsPanel`; trailing blank line in `SupportLifecyclePanel` | low | patch | Nothing imports the re-export (grep). Both removed. |
| Name, e-mail, address sent untrimmed (create, change address) | false | rejected | `actions.ts` trims displayName, email (lines 78-79) and the new address (622), plus reason (302) and identity note (560). |
| Disclosure answer sent untrimmed | low | defer | The original sent the raw text too; validity is judged on the trimmed length. Whether `answer_audit_disclosure_request` trims is unverified. |
| Tab not re-synced on Back/Forward | false | rejected | Tab changes use `router.replace`, which adds no history entry, so there is nothing to go back to. Only a link to `/support?tab=x` from within the page could diverge, and none exists. |
| Status message never cleared, stale across tabs | low | defer | Pre-existing: the original page also only overwrote `message`. |
| Load errors for locks, lifecycle, inbox render below the tabs while the tab shows its empty state | low | defer | Pre-existing placement in `page.tsx`; the empty-state fallback is unchanged. |
| `resetOpen` treats every non-null `resetState` as open (hides Reset and Change address) | maybe-false | defer | Logic copied unchanged from the original panel. Would need the set of `resetState` values the RPC returns to settle. |
| `runDueFactorResets`, `run()`, `createSupportAccount`, `invite` reject instead of returning `{error}` | false | rejected | Server actions return `{data, error}` by contract; the original code had the same shape. |
| Step-up retry can loop on a second `step_up_required` | false | rejected | Same flow as the original (`onIssued` retries the call); each loop needs a fresh code. |
| Stale target/userId after refresh, modal acts on a snapshot | low | rejected | Server refuses a stale action; same as before. Fix adds revalidation branches. |
| Empty assignable list or empty gyms: submit disabled with no explanation | low | rejected | Same behaviour as the inline form it replaces. |
| `data` null without error in assign | false | rejected | `assignSupport` returns data whenever error is null. |
| Ended assignments list unpaginated | false | rejected | It is a `<details>` summary, not a table, and was already unpaginated. |
| Gym page assign button enabled with no accounts | low | rejected | Opens the same modal as before the change; no regression. |
| Run due resets has no confirm | low | rejected | The original button had none either. |
| No tab badges for locks, overdue disclosures, lapsed recertifications | low | rejected | Spec fixes the tab design and is silent on counts; the overdue marker is kept in the row. Raised to the owner at presentation. |
| `window.confirm` replaced by modal description; fr/en `locks.confirmUnlock` reworded ("you enter") | false | rejected | The reason is now entered after the prompt; spec requires the modal. |
| "Actions" omitted for rows with none; hidden instead of disabled | false | rejected | Spec: "only the actions valid for that row". |
| Pagination page not preserved or clamped | false | rejected | `useClientPagination` keeps state and clamps with `Math.min(page, totalPages)`. |
| Duplicate names give identical menu names | low | rejected | Same labels as the Members page; fix changes visible naming. |
| Narrow-screen tab bar | low | rejected | `overflow-x-auto` wrapper is present; covered by manual QA A16. |
| `deferUntilMenuClosed` timer not cleaned up | low | rejected | A 0 ms timer; unmount inside it is negligible. |
| Unsafe cast in assignments `onDone`; index key in `th`; import order | low | rejected | Cosmetic; fixes would change types or signatures. |
| No fr render test; no Escape-while-busy test; upper-bound reason untested | low | rejected | Parity check covers keys; `maxLength` prevents the upper bound; busy-blocking is deliberate. |
| Toast vs persistent message | false | rejected | Spec allows "toast or inline message". |

## Design Notes

Reason handling moves from shared page state to each modal's own state, so a stale reason can never authorise a different action; `actions.ts` already validates the reason server side.

## Verification

**Commands:**
- `bash scripts/ci-local.sh --only static` and `--only unit` -- expected: PASS (typecheck, lint, i18n parity, vitest).
- Pnpm: if `@radix-ui/react-tabs` does not link offline, run `pnpm install` once.

**Manual checks (if no CLI):**
- Browser on :3001 as `admin@epic23qa.test`: create account, assign, confirm/unassign, unlock, recertify, reset, answer a disclosure; switch tabs, reload, change rows per page; check dark mode and a narrow window.
