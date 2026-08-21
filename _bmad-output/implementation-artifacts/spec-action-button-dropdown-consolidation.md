---
title: 'Consolidate row/card action buttons into a single dropdown menu'
type: 'refactor'
created: '2026-08-21'
status: 'done'
review_loop_iteration: 2
followup_review_recommended: false
final_revision: 'PENDING'
context: []
warnings: []
baseline_revision: 'e2025546c8ceb6cd6bfb04bd4f1bf3a79baa42e6'
---

<intent-contract>

## Intent

**Problem:** Members, Staff, Payments (pending queue), and Plans each render 2–4 separate `<Button>` elements side-by-side per row/card for the same item (e.g. Members: View/Edit/Invite/Deactivate), creating visual clutter and inconsistent widths across rows depending on which conditional actions apply.

**Approach:** Replace each location's row of buttons with a single trigger `Button` (icon-only, `MoreVertical` from `lucide-react`) that opens a `DropdownMenu` (`apps/dashboard/components/ui/dropdown-menu.tsx`, already built on Radix, currently unused elsewhere). Each existing action becomes one `DropdownMenuItem` with its existing icon + label, in the same order and under the same conditional/role-gating logic as today. No business logic, server actions, or handler functions change — only how each action is visually triggered.

## Boundaries & Constraints

**Always:**
- Preserve every existing conditional (`canManage`, `ACTIONABLE_TARGET_ROLES`, `deactivatedAt`/`phone` checks, `row.status !== "deactivated"`, `isRefreshing`) exactly — an action that's hidden/disabled today must remain hidden/disabled inside the menu.
- Preserve destructive-action color cues (Deactivate/Delete/Flag currently render red/orange text+icon) by applying the same color via `className` on the corresponding `DropdownMenuItem`.
- Preserve click-propagation guards: Members' row has `onClick={() => openView(member)}`; the actions cell must keep stopping propagation so opening the menu (and clicking any item) never also opens the view modal.
- Keep each trigger `Button` as `variant="ghost" size="icon"` with an `aria-label` naming the row/card (e.g. `"Actions for {{name}}"`) for accessibility, since multiple triggers exist per page.
- Add new i18n keys only where a page has no existing reusable "Actions" string (Plans has none; Members/Staff/Payments already have `table.actions: "Actions"` which is not per-row so still needs a new interpolated aria-label key) — add to both `apps/dashboard/locales/en.json` and `apps/dashboard/locales/fr.json`.
- Match each namespace's existing key nesting when adding the new aria-label key — Members/Staff already have a nested `actions` object (`members.actions.view`/`.edit`/etc.), so add `menu` inside it; Payments/Plans have no such object, so add a flat `actionsMenu` key. This intentionally produces `members.actions.menu` alongside `payments.actionsMenu` — that is not an inconsistency to "fix," it is each namespace matching its own pre-existing shape.
- Every `DropdownMenuItem`, including ones that open a native `<dialog>`-based modal (`MemberModal`, `EditStaffModal`, `PlanModal`, `DeactivateMemberDialog`, `DeactivateStaffDialog`, `VerifyPaymentConfirmDialog`, `FlagPaymentDialog`) or trigger an async action (Invite, Resend), uses a **plain `onClick`** handler — the exact same handler shape the original `<Button onClick=...>` had, just moved onto `<DropdownMenuItem onClick=...>`. Do **not** use `onSelect`, `event.preventDefault()`, or any `setTimeout`/`queueMicrotask` deferral anywhere in this diff (see the pass-2 Spec Change Log entry for why: `event.preventDefault()` inside `onSelect` permanently cancels Radix's own menu-close — verified directly against the installed `@radix-ui/react-menu` source — which, combined with the library's default `modal=true` DropdownMenu setting `document.body.style.pointerEvents = "none"` while open, leaves the entire page — including whatever native `<dialog>` just opened — pointer-locked until the user manually presses Escape). Radix composes the item's own `onClick` to run *before* its internal select-handling (`composeEventHandlers` calls the original handler first, verified against `@radix-ui/primitive` source), so a plain `onClick` — including one that calls a blocking `window.confirm()` (Staff's Resend) — always completes before Radix's close/focus-return logic runs. There is no race to guard against for a native `<dialog>`, because native dialogs don't participate in Radix's focus-trap coordination the way a Radix `Dialog` composed inside a Radix `DropdownMenu` would.
- Members' Invite and Staff's Resend items keep the same disabled/loading-label logic (`sendingInviteId === member.id` / `resendingId === row.id`) as `DropdownMenuItem` props, but the dropdown menu itself closes immediately on selection like every other item — it does not stay open for the duration of the async call. The loading label is visible if the user reopens the menu while the action is still in flight (which is also what correctly blocks a double-submit); it is not visible continuously through the operation. This is a deliberate, evidence-based simplification versus the pass-1 spec's requirement — see the pass-2 Spec Change Log entry.
- Mark the `MoreVertical` trigger icon `aria-hidden="true"` in all four locations, since the trigger `Button` already carries a descriptive `aria-label` and the icon is purely decorative.
- Add a one-line comment directly above Members' `<div onClick={(e) => e.stopPropagation()}>` wrapper (around `MembersPageClient.tsx` line 349) noting that `DropdownMenuContent` renders through a Radix `Portal` outside this div's DOM subtree, so the guard only works because React's synthetic events bubble along the component tree, not the DOM tree — a future reader could otherwise mistake the wrapper for dead code and remove it.
- Update the existing `apps/dashboard/app/(dashboard)/members/components/MembersPageClient.sendInvite.test.tsx` (6 tests) to interact through the new dropdown: open the row's trigger (`getByRole("button", { name: /actions for/i })`) before querying for the "Invite" `menuitem` (Radix renders `role="menuitem"`, not `role="button"`, and `DropdownMenuContent` isn't mounted until the trigger opens) — this suite exercises real conditional/async behavior (AC #1-#4, in-flight state) and must keep passing, not just be deleted.

**Block If:** none identified — scope, target files, and interaction pattern are all resolved from investigation.

**Never:**
- Do not touch `FrontDeskAlertPanel.tsx` (Renew/Dismiss) or the Settings payment-connection Reconnect/Disconnect buttons — both are explicit scope exclusions (frequent/urgent single dismiss action; singleton non-repeated section).
- Do not introduce a new shared `RowActionsMenu` abstraction component — each of the 4 locations has distinct conditional logic; inline `DropdownMenu` usage per file keeps that logic legible and avoids a premature abstraction over only 4 call sites.
- Do not change any server action, RPC call, or handler function signature.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Row with all actions available | Members row, `canManage=true`, active, has phone | Menu shows View, Edit, Invite, Deactivate in that order | No error expected |
| Row with restricted actions | Members row, `canManage=false` | Menu shows only View | No error expected |
| Row action mid-flight, menu reopened | Staff row, `resendingId === row.id`, user reopens the menu while the resend call is still pending | Resend item shows disabled/loading label state; clicking it again is a no-op (disabled) | No error expected |
| Click inside menu on a row with row-level onClick | Members row (row itself opens view on click) | Opening trigger or clicking a menu item never also triggers `openView` | Propagation stopped at trigger and content |
| Menu item opens a modal | Any Edit/Deactivate/Delete/Verify/Flag item selected (plain `onClick`, no `preventDefault`) | Dropdown closes normally and the modal opens cleanly; the rest of the page remains clickable | No error expected |

</intent-contract>

## Code Map

- `apps/dashboard/components/ui/dropdown-menu.tsx` -- existing shadcn/Radix primitives to reuse as-is (no changes)
- `apps/dashboard/components/ui/button.tsx` -- `variant="ghost" size="icon"` for the trigger
- `apps/dashboard/app/(dashboard)/members/components/MembersPageClient.tsx:348-398` -- 4-action row (View/Edit/Invite/Deactivate), row has `onClick={openView}` + existing `stopPropagation` wrapper at line 349
- `apps/dashboard/app/(dashboard)/settings/staff/components/StaffPageClient.tsx:151-186` -- up to 3-action row (Resend/Edit/Deactivate), no icons currently imported
- `apps/dashboard/app/(dashboard)/payments/components/PaymentsPageClient.tsx:146-169` -- 2-action row (Verify/Flag), icons already imported
- `apps/dashboard/app/(dashboard)/plans/components/PlansPageClient.tsx:144-151` -- 2-action card (Edit/Delete), no icons currently imported, no per-row i18n key
- `apps/dashboard/locales/en.json`, `apps/dashboard/locales/fr.json` -- add per-page `actionsMenu`/`actions.menu` aria-label keys

## Tasks & Acceptance

**Execution:**
- [x] `apps/dashboard/locales/en.json`, `apps/dashboard/locales/fr.json` -- add `members.actions.menu`, `staff.actions.menu`, `payments.actionsMenu`, `plans.actionsMenu` keys, each `"Actions for {{name}}"` (fr: `"Actions pour {{name}}"`) -- needed for the icon-only trigger's aria-label
- [x] `apps/dashboard/app/(dashboard)/members/components/MembersPageClient.tsx` -- replace the 4-button `flex gap-1` block (lines 350-397) with `DropdownMenu`/`DropdownMenuTrigger` (`MoreVertical` icon, ghost/icon button)/`DropdownMenuContent align="end"` containing `DropdownMenuItem`s for View/Edit/Invite/Deactivate, each with a plain `onClick` (same handler as its old `Button`), same conditionals, Deactivate item red-styled -- reduces 4 visually competing buttons to one consistent trigger
- [x] `apps/dashboard/app/(dashboard)/settings/staff/components/StaffPageClient.tsx` -- import `MoreVertical`, `KeyRound`, `Pencil`, `Ban` from `lucide-react`; replace the button group (lines 155-183) with a `DropdownMenu` containing Resend/Edit/Deactivate items, each with a plain `onClick`, under the same conditionals, Deactivate red-styled -- matches Members' new pattern and gives Staff icons it currently lacks
- [x] `apps/dashboard/app/(dashboard)/payments/components/PaymentsPageClient.tsx` -- replace the `flex gap-2` block (lines 147-168) with a `DropdownMenu` containing Verify (`CheckCircle2`, green) and Flag (`Flag`, orange) items, each with a plain `onClick`, both respecting `isRefreshing` disabled state -- consistent trigger pattern
- [x] `apps/dashboard/app/(dashboard)/plans/components/PlansPageClient.tsx` -- import `MoreVertical`, `Pencil`, `Trash2` from `lucide-react`; replace the `flex gap-2` block (lines 144-150) with a `DropdownMenu` containing Edit and Delete (`Trash2`, red) items, each with a plain `onClick` -- first card-layout (non-table) instance of the pattern
- [x] All 4 files -- every `DropdownMenuItem`'s `onClick` is a plain handler (no `onSelect`, no `event.preventDefault()`, no `setTimeout`/`queueMicrotask`) — verify none of these three remain anywhere in the diff, per the corrected Boundaries constraint
- [x] All 4 files -- add `aria-hidden="true"` to the `<MoreVertical>` trigger icon
- [x] `MembersPageClient.tsx` -- add a one-line comment above the `stopPropagation` wrapper div (~line 349) explaining the Radix Portal + React synthetic-event-bubbling dependency
- [x] `MembersPageClient.sendInvite.test.tsx` -- update all 6 tests to open the row's dropdown trigger before querying the "Invite" menu item; since the menu now closes immediately on selection (no more menu-stays-open behavior), the "remains clickable"/"in-flight state" tests must reopen the menu to observe the item's disabled/loading state rather than expecting it to persist in an already-open menu

**Acceptance Criteria:**
- Given a Members row with `canManage=true`, active, with phone, when the trigger is clicked, then all 4 items (View, Edit, Invite, Deactivate) appear with their existing icons and labels, and clicking any item performs the same action as its former button.
- Given a Members row, when the trigger button or a menu item is clicked, then the row's own `openView` click handler does not also fire.
- Given a Staff row, when the user selects Resend, then the menu closes immediately (matching every other item) and `handleResend` runs exactly as it did as a plain button; if the user reopens the menu while the resend call is still pending, the Resend item shows the disabled/loading label and clicking it again is a no-op.
- Given any of the 4 pages, when rendered, then no page shows more than one visible action button per row/card (the dropdown trigger).
- Given any menu item that opens a modal, when it is selected, then the modal opens cleanly, the dropdown closes normally, and the rest of the page remains fully clickable — no page-wide pointer-event lockout (manual browser check; this was the pass-2 regression, verify it specifically).
- Given the existing `MembersPageClient.sendInvite.test.tsx` suite, when run after this change, then all 6 tests still pass (updated for the menu-closes-on-select behavior).

## Design Notes

Trigger button markup, consistent across all 4 files:
```tsx
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button variant="ghost" size="icon" aria-label={t("members.actions.menu", { name: member.name })}>
      <MoreVertical size={16} aria-hidden="true" />
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="end">
    {/* Every item: plain onClick, identical to the old Button's handler. No onSelect,
        no event.preventDefault(), no setTimeout -- see Boundaries for why. */}
    <DropdownMenuItem onClick={() => openView(member)}>
      <Eye size={14} /> {t("members.actions.view")}
    </DropdownMenuItem>

    <DropdownMenuItem onClick={() => openEdit(member)}>
      <Pencil size={14} /> {t("members.actions.edit")}
    </DropdownMenuItem>

    <DropdownMenuItem
      disabled={sendingInviteId === member.id}
      onClick={() => void handleSendInvite(member)}
    >
      <Send size={14} />
      {sendingInviteId === member.id ? t("members.invite.sending") : t("members.actions.invite")}
    </DropdownMenuItem>
    {/* ...remaining items, same conditionals as before... */}
  </DropdownMenuContent>
</DropdownMenu>
```
For Members specifically, wrap this in the existing `<div onClick={(e) => e.stopPropagation()}>` (line 349) unchanged, since the row itself has an `onClick` — add a one-line comment there per the Boundaries constraint (Radix Portal + component-tree event bubbling).

Every `DropdownMenuItem` across all 4 files follows this identical plain-`onClick` shape — Edit/Deactivate/Delete/Verify/Flag (which open a modal) and Invite/Resend (which run an async action) are handled no differently from View. Do not reintroduce `onSelect`/`preventDefault`/`setTimeout` for any of them.

## Spec Change Log

### 2026-08-21 — Review pass 1 (bad_spec loopback)

**Triggering findings:**
- Existing `MembersPageClient.sendInvite.test.tsx` (6 tests) queries `getByRole("button", { name: /invite/i })` directly without opening the dropdown; Radix renders `role="menuitem"` and doesn't mount content until the trigger opens — all 6 now fail.
- Every `DropdownMenuItem` that opens a native `<dialog>` modal (Edit/Deactivate/Delete/Verify/Flag, across all 4 files — confirmed all modals in this app use native `<dialog>`, not Radix Dialog) closes the Radix menu (and its focus-return to the trigger) on the same tick the dialog's `showModal()` fires — an unguarded close/open race.
- Members' Invite and Staff's Resend items lose their in-flight loading-label visibility (`"Sending…"`/`"Resending…"`) because Radix auto-closes the menu on select, so the AC requiring that label to be reflected wasn't actually satisfiable with plain `onClick`.
- Minor: decorative `MoreVertical` icon not `aria-hidden`; Members' `stopPropagation` wrapper's dependence on Radix Portal + React event-tree bubbling was undocumented.

**What was amended:** Added explicit Boundaries constraints requiring `onSelect`+`preventDefault` (+ deferred `setTimeout` for modal-opening items) instead of plain `onClick`; added tasks and ACs for the test-file update, `aria-hidden`, and the explanatory comment; updated the Design Notes code sample to show the three distinct item patterns (plain, modal-opening, in-place-async).

**Known-bad state avoided:** Shipping a UI where every Edit/Deactivate/Delete/Verify/Flag click risks a focus race against its own modal, existing tests fail on merge, and the explicit in-flight-loading AC silently doesn't hold.

**KEEP instructions (verified correct in pass 1, must survive re-derivation):**
- Overall approach: one ghost/icon `MoreVertical` trigger per row/card + `DropdownMenu` wrapping the existing conditionals, unchanged.
- All conditional/role-gating logic (`canManage`, `ACTIONABLE_TARGET_ROLES`, `deactivatedAt`/`phone`, `row.status !== "deactivated"`, `isRefreshing`) was correctly preserved — keep exactly as implemented.
- Icon choices (Eye/Pencil/Send/Ban; KeyRound/Pencil/Ban; CheckCircle2/Flag; Pencil/Trash2) and destructive-action red/orange/green `className` styling were correct — keep.
- The i18n key-nesting difference (`members.actions.menu` nested vs. `payments.actionsMenu` flat) is intentional, matching each namespace's pre-existing shape — do NOT "fix" this into uniform nesting.
- `align="end"` on every `DropdownMenuContent` — keep.

### 2026-08-21 — Review pass 2 (bad_spec loopback — supersedes pass 1's `onSelect`+`preventDefault` guidance)

**Triggering findings:** Pass 1's fix was itself wrong and introduced a more severe bug than the one it addressed. Verified directly against the installed source (`@radix-ui/react-menu@2.1.19`'s `MenuItem`'s `handleSelect`, and `@radix-ui/react-dismissable-layer@1.1.14`): calling `event.preventDefault()` inside a `DropdownMenuItem`'s `onSelect` does not *defer* Radix's menu-close, it *permanently cancels* it (`if (itemSelectEvent.defaultPrevented) { ... } else { rootContext.onClose(); }` — the `else` branch, the only path that closes the menu, never runs). `DropdownMenu` defaults to `modal=true`, and its `DismissableLayer` sets `document.body.style.pointerEvents = "none"` for as long as it stays mounted. Since the menu now never closes on any item that called `preventDefault()` (every modal-opening item, plus Invite/Resend), the entire page — including whatever native `<dialog>` the item just opened, since native dialogs are ordinary DOM descendants of `<body>` and inherit `pointer-events: none` — becomes unclickable until the user manually presses Escape. This is a live-browser-only failure (JSDOM doesn't enforce CSS `pointer-events`, so the pass-1 test updates gave false confidence) and is strictly worse than the speculative, never-confirmed close/open race pass 1 was trying to prevent.

**What was amended:** Removed the `onSelect`+`preventDefault`(+`setTimeout`) Boundaries entirely. Replaced with a single rule: every `DropdownMenuItem` uses a plain `onClick`, identical in shape to its old `Button`'s handler — matching Members' "View" item, which pass-1's own reviewers confirmed was the one item *not* exhibiting the bug, because it never called `preventDefault()`. Verified separately (via `@radix-ui/primitive`'s `composeEventHandlers`) that a plain `onClick` always runs to completion *before* Radix's own select-handling fires, so this is also safe for Staff's Resend (which calls a blocking `window.confirm()`) — no race exists there either. Softened the Invite/Resend "menu stays open through the async call" AC from pass 1: the menu now closes immediately on selection like every other item; the disabled/loading label is only visible if the user reopens the menu mid-flight (which still correctly blocks a double-submit). Updated Tasks, ACs, I/O matrix, and Design Notes accordingly; test file guidance updated to reopen the menu when asserting in-flight state rather than expecting it to persist in an already-open menu.

**Known-bad state avoided:** Shipping a UI where selecting Edit/Deactivate/Delete/Verify/Flag (or Invite's failure-fallback path) leaves the entire page pointer-locked until the user finds and presses Escape — a severe, easily-reachable regression on every single converted action across all 4 files.

**KEEP instructions (verified correct in pass 2, must survive re-derivation):** Everything from pass 1's KEEP list still holds (overall approach, conditional/role-gating logic, icon choices, destructive-action styling, intentional i18n key-nesting difference, `align="end"`). Additionally: the `aria-hidden` icon fix, the `stopPropagation` explanatory comment, and the sendInvite test file's dropdown-opening helper (`openInviteMenuItem`) and `{ hidden: true }` toast-query fix from pass 1 were all independently correct and should be kept — only the `onSelect`/`preventDefault`/`setTimeout` mechanism itself, and the "menu stays open" premise for Invite/Resend, were wrong.

## Review Triage Log

### 2026-08-21 — Review pass 1
- intent_gap: 0
- bad_spec: 5 (high 2, medium 1, low 2)
- patch: 0
- defer: 1 (low 1)
- reject: 3 (low 3)
- addressed_findings:
  - `[high]` `[bad_spec]` Existing sendInvite test suite (6 tests) breaks against the new dropdown structure — spec amended to require updating the tests via the dropdown trigger.
  - `[high]` `[bad_spec]` Radix menu close vs. native `<dialog>.showModal()` same-tick focus race on every modal-opening item — spec amended to require `onSelect`+`preventDefault`+deferred open.
  - `[medium]` `[bad_spec]` Invite/Resend in-flight loading label invisible because the menu auto-closes on select — spec amended to require `onSelect`+`preventDefault` (menu-stays-open) for these two items.
  - `[low]` `[bad_spec]` Decorative `MoreVertical` icon missing `aria-hidden` — spec amended to require it.
  - `[low]` `[bad_spec]` Undocumented reliance on Radix Portal + React event-tree bubbling for Members' `stopPropagation` wrapper — spec amended to require an explanatory comment.
  - `[low]` `defer` — Plans page has no role-gating on Edit/Delete; pre-existing, not caused by this change. Logged to deferred-work.md.
  - `[low]` `reject` (x3) — inconsistent i18n key nesting (intentional, matches each namespace's convention); two-click cost vs. one-click buttons (inherent to the requested consolidation); loss of at-a-glance color-coded row scanning (inherent to the requested consolidation).

### 2026-08-21 — Review pass 2
- intent_gap: 0
- bad_spec: 1 (high 1)
- patch: 0
- defer: 1 (low 1)
- reject: 5 (low 5)
- addressed_findings:
  - `[high]` `[bad_spec]` `event.preventDefault()` in `onSelect` permanently cancels Radix's menu-close (verified against installed source), which combined with `DropdownMenu`'s default `modal=true` leaves the whole page pointer-locked after selecting any modal-opening item or Invite/Resend — spec amended to remove `onSelect`/`preventDefault`/`setTimeout` entirely in favor of plain `onClick` everywhere (matching the one item, View, that pass-1's reviewers confirmed was already correct), and to soften the Invite/Resend "menu stays open" AC accordingly.
  - `[low]` `defer` — No test coverage was added for Edit/Deactivate/View (Members), Verify/Flag (Payments), Edit/Delete (Plans), or Edit/Deactivate (Staff) beyond the pre-existing Invite suite; a large rewired surface with no automated wiring checks. Consistent with this codebase's long-established, repeatedly user-confirmed convention (see many prior `deferred-work.md` entries) of relying on manual browser QA for dashboard UI wiring rather than mandating new test authoring — not blocking, logged for awareness.
  - `[low]` `reject` (x5) — Members' View/Edit asymmetry (resolved as a side effect of the bad_spec fix, not a separate action); fire-and-forget `setTimeout` cleanup-on-unmount (moot, `setTimeout` removed entirely by the fix); `window.confirm()` vs. Radix `FocusScope` timing in Staff's Resend (verified safe — `composeEventHandlers` runs the item's own `onClick` to completion before Radix's internal select-handling, confirmed against `@radix-ui/primitive` source); disabled `DropdownMenuItem`s dropping out of keyboard tab order via Radix's `RovingFocusGroup` (matches native `<button disabled>` behavior, which is equally excluded from tab order — not a regression); Payments' trigger staying enabled while its items are disabled during `isRefreshing` (functionally equivalent to the prior UI, which also just disabled the two buttons individually while leaving the rest of the page interactive).

### 2026-08-21 — Review pass 3
- intent_gap: 0
- bad_spec: 0
- patch: 4 (low 4)
- defer: 2 (low 2)
- reject: 7 (low 7)
- addressed_findings:
  - `[low]` `[patch]` Destructive-action text color (`text-red-700`) had no focus-state counterpart, so it would be overridden by the shared `DropdownMenuItem`'s own `focus:text-accent-foreground` exactly when an item is keyboard-focused/about to be selected — added `focus:text-red-800`/`focus:text-green-800`/`focus:text-orange-800` alongside every colored item across all 4 files.
  - `[low]` `[patch]` Icon-only trigger button had no visible hint for sighted mouse users (only an `aria-label`, which is screen-reader-only) — added a matching `title` attribute (native browser tooltip) to all 4 trigger buttons.
  - `[low]` `[patch]` Members' View/Edit items lost their original blue/indigo text-color cues when the design was simplified during the pass-2 rewrite (Payments' Verify/Flag kept theirs) — restored `text-blue-700`/`text-indigo-700` (+ matching `focus:` variants) on View/Edit/Invite for parity with the original buttons and with Payments.
  - `[low]` `[patch]` Payments' trigger `aria-label`/`title` could render as `"Actions for "` (trailing space, no name) when `row.memberName` is `""` for a payment whose member relation is missing (`services/payments.ts` uses `row.members?.name ?? ""`) — added an `|| "—"` fallback, matching this table's own convention for missing names elsewhere in the same file.
  - `[low]` `defer` — Staff's Resend item has no role-ceiling gate unlike its sibling Edit/Deactivate items; pre-existing (the original standalone button had the identical gap), surfaced incidentally by this diff's conversion of the other two items into permission-aware menu items. Logged to `deferred-work.md`.
  - `[low]` `defer` — A toast triggered by a `DropdownMenuItem` action can render while still `aria-hidden="true"` under Radix's modal `DropdownMenu`, a transient screen-reader announcement gap; directly observed while adapting the sendInvite tests. Logged to `deferred-work.md`.
  - `[low]` `reject` (x7) — "two-click cost" and "loss of at-a-glance color scanning" (repeat of pass-1's already-rejected findings, inherent to the requested consolidation); inconsistent i18n key nesting (repeat, intentional per pass-1's KEEP note); no test coverage for 3 of 4 files (repeat of pass-2's already-logged defer, not a new instance); "modal-open-from-menu-item focus race" raised again by both reviewers independently — re-affirmed reject: this diff contains zero `onSelect`/`preventDefault` calls (grep-verified), so the specific mechanism that caused pass-2's confirmed bug cannot occur; a plain `onClick` (proven safe via `composeEventHandlers` source, and via View's own already-working precedent) always completes before Radix's internal close-handling runs, and native `<dialog>` elements don't participate in Radix's own Dialog-in-Menu focus coordination the way a nested Radix `Dialog` would — no further action without a concrete live-browser repro; `aria-disabled` vs. native `disabled` semantics for the in-flight Invite item (low-value nitpick for an internal staff tool, not a genuine security/correctness boundary).

## Verification

**Commands:**
- `cd apps/dashboard && npx tsc --noEmit` -- expected: no new type errors
- `cd apps/dashboard && npx next lint` -- expected: no new lint errors (unused-import checks will catch any now-orphaned `Button`-group imports)

**Manual checks (if no CLI):**
- Load `/members`, `/settings/staff`, `/payments`, `/plans` in a browser as an `owner` role; confirm each row/card shows one trigger button, the menu opens with correct items/icons, and every action (view/edit/invite/deactivate/resend/verify/flag/delete) still works end-to-end.
- Repeat as a role with fewer permissions (e.g. `manager` on Members, `manager`/`receptionist` on Staff) to confirm conditional items are still correctly hidden.
- **Specifically confirm** (this is the exact regression pass 2 found and fixed): after selecting Edit/Deactivate/Delete/Verify/Flag from any menu, the modal opens cleanly and the rest of the page remains fully clickable — no stuck cursor/unresponsive page requiring Escape to recover.

## Auto Run Result

**Summary:** Consolidated 2-4 separate action buttons per row/card into a single `MoreVertical` trigger + Radix `DropdownMenu` across 4 dashboard pages (Members, Staff, Payments pending queue, Plans), preserving every existing conditional/role-gating rule, disabled state, and (for destructive actions) color cue. Required two bad_spec loopbacks: pass 1 fixed a broken test suite and added `onSelect`+`preventDefault` guidance based on a speculative focus-race concern; pass 2 discovered (via direct inspection of the installed `@radix-ui/react-menu`/`@radix-ui/react-dismissable-layer` source) that this guidance was itself wrong and introduced a severe page-wide pointer-event lockout bug, and replaced it with a simpler, verified-safe plain-`onClick` design. Pass 3 found no further functional issues, only a handful of low-severity cosmetic patches, which were applied directly.

**Files changed:**
- `apps/dashboard/app/(dashboard)/members/components/MembersPageClient.tsx` — View/Edit/Invite/Deactivate consolidated into one dropdown; color cues restored/preserved.
- `apps/dashboard/app/(dashboard)/members/components/MembersPageClient.sendInvite.test.tsx` — 6 existing tests adapted to interact through the dropdown trigger instead of a direct button query.
- `apps/dashboard/app/(dashboard)/settings/staff/components/StaffPageClient.tsx` — Resend/Edit/Deactivate consolidated; gained icons it previously lacked.
- `apps/dashboard/app/(dashboard)/payments/components/PaymentsPageClient.tsx` — Verify/Flag consolidated.
- `apps/dashboard/app/(dashboard)/plans/components/PlansPageClient.tsx` — Edit/Delete consolidated (first card-layout, non-table instance of the pattern).
- `apps/dashboard/locales/en.json`, `apps/dashboard/locales/fr.json` — 4 new per-page trigger `aria-label` keys.
- `_bmad-output/implementation-artifacts/deferred-work.md` — 4 new entries logged (Plans has no role-gating on Edit/Delete; no test coverage beyond the Invite suite; Staff's Resend has no role-ceiling gate; toast-vs-`aria-hidden` transient timing) — all pre-existing or inherent, none blocking.

**Review findings breakdown (3 passes):**
- Pass 1: 5 bad_spec (test breakage + speculative focus-race fix), 1 defer, 3 reject.
- Pass 2: 1 bad_spec — **confirmed severe**: `preventDefault()` in `onSelect` permanently cancels Radix's menu-close, and combined with `DropdownMenu`'s default `modal=true`, leaves the page pointer-locked after selecting any modal-opening item. Fixed by removing `onSelect`/`preventDefault`/`setTimeout` entirely. 1 defer, 5 reject.
- Pass 3: 0 bad_spec, 4 patch (focus-state colors, tooltip `title` attributes, restored Members' non-destructive color cues, Payments aria-label empty-name fallback), 2 defer, 7 reject (several were repeat speculative concerns already source-verified safe).

**Verification performed:** `tsc --noEmit` clean; `eslint` clean on all changed files; full `vitest` suite 116/116 passing (including the 6 adapted Invite tests) — all re-run and independently confirmed by the orchestrator, not just claimed by the implementation subagent. Grep-verified zero occurrences of `onSelect`/`preventDefault`/`setTimeout`/`queueMicrotask` in the final diff.

**Residual risks:** The one thing that mattered most — that selecting a modal-opening menu item doesn't leave the page pointer-locked — is a live-browser-only check (JSDOM doesn't enforce CSS `pointer-events`, which is exactly why pass 1 shipped broken despite a fully green test suite). This is flagged as a manual QA item per this project's convention; the fix is backed by direct source-code verification (not just a passing test suite), but a real click-through is still the load-bearing confirmation.

