---
baseline_commit: 0acecb2b0f7b1c4e8e0a1d3f6c9b2e7a4d5f8c10
---

# Story 1.19: Gym Switch Leaves Stale Page Content — Client State Survives `router.refresh()`

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a gym owner with more than one gym,
I want the page I am looking at to show the new gym's data as soon as I switch gyms,
so that I do not read or edit the wrong gym's settings while the sidebar tells me I am somewhere else.

**Context — not derived from `epics.md`.** Reported by smartsana on 2026-09-09, testing the multi-gym ownership shipped in Story 1.17:

> "when i switch gym, i notice it switches at the level of the switch button but not the app content. eg i am in gym A and on setting page, say Gym Name is set to 'Gym A', when i switch gym, say to Gym B, the setting page still displays data of Gym A"

This is worse than a cosmetic glitch: Settings is an **editable** form. An owner who switches to Gym B, sees Gym A's values still in the fields and presses Save writes Gym A's data into Gym B — with no warning anywhere, because nothing errored.

### Root cause

`GymSwitcher.handleSwitch()` calls the `switchActiveGym` server action and then `router.refresh()`. Both halves work: the RPC flips `active_gym_id`, `refreshSession()` mints a JWT with the new claim, and `router.refresh()` re-runs the Server Components and delivers the new gym's props.

The bug is what `router.refresh()` deliberately does **not** do: it re-renders, it does not remount, and **client component state is preserved by design**. `SettingsForm` is a client component that seeds roughly ten `useState` values from its server props (`initial.name`, `initial.logoUrl`, `initial.gymToken`, the payment/billing blocks, …). A `useState` initialiser runs only on mount, so every one of those kept the previous gym's value while fresh props arrived and were ignored.

That is exactly why the reported symptom splits the way it does, and the split is the diagnostic:

| | Source | After switch |
|---|---|---|
| Switcher label (`currentGymName`) | server prop, no local state | **updates** ✓ |
| Settings "Gym Name" field | `useState(initial.name)` | **stale** ✗ |

The switcher updating is *proof the server refresh worked*. Anything that assumed the refresh had failed — the RPC, the JWT claim, the cookie, RSC caching — was looking in the wrong place.

`GymSwitcher.tsx`'s own comment asserted the opposite: "`router.refresh()` alone is sufficient for every Server-Component/Server-Action-fetched page in this app (AD-7/AD-8)". That holds only for pages that render server data directly; it is false for any page that hands server data to a client component as seed state. Corrected in this story.

### Reproduced before fixing

Against local dev with `admin@testgym.com` (owner of three local gyms), on `/settings`:

```
BEFORE: switcher "Obama Gym",      field "Obama Gym"
AFTER : switcher "Martin Fitness", field "Obama Gym"   <- stale
network: POST /settings (server action) | GET /settings?_rsc (the refresh)
```

The `?_rsc` fetch confirms fresh server data was delivered and then discarded by the surviving client state.

## Acceptance Criteria

1. **Given** an owner with 2+ gyms on `/settings`, **when** they switch gyms, **then** the Gym Name field (and every other seeded field) shows the newly-selected gym's data, not the previous gym's.
2. **Given** any `(dashboard)` route, **when** the gym changes, **then** client components below the layout re-seed from the new gym's props rather than retaining state from the previous gym.
3. **Given** several switches in a row, **when** each completes, **then** each lands on the correct gym's data — including switching back to the gym the session started on.
4. **Given** the chrome (sidebar/top bar), **when** a switch happens, **then** gym-independent UI state (the mobile nav open/closed flag) is not needlessly reset.
5. **Given** the existing single-gym experience, **when** a user has one gym, **then** nothing changes (no switcher is mounted; the key is stable).
6. A regression test fails without the fix and passes with it.

## Tasks / Subtasks

- [x] Diagnose (AC #1)
  - [x] Read `GymSwitcher`, `switchActiveGym`, `(dashboard)/layout.tsx`, `SettingsForm`
  - [x] Rule out caching: confirm no `"use cache"`/`unstable_cache`/`revalidate` anywhere in the app
  - [x] Use the switcher-updates-but-content-does-not split to establish the server refresh succeeds
  - [x] Reproduce end-to-end in a real browser against local dev, capturing the `?_rsc` refetch
- [x] Fix (AC #1, #2, #3, #4)
  - [x] Key the page subtree on `shell.gymId` in `(dashboard)/layout.tsx` via a `Fragment`
  - [x] Keep the key off `DashboardChrome` so `mobileNavOpen` is not reset (AC #4)
  - [x] Correct `GymSwitcher.tsx`'s inaccurate "`router.refresh()` alone is sufficient" comment
- [x] Verify (AC #1, #3, #6)
  - [x] Re-run the reproduction: field now tracks the switcher
  - [x] Three consecutive switches across `/settings` and `/members`, including returning to the starting gym
  - [x] Confirm no new console errors versus the pre-fix build
  - [x] Add a regression test; confirm it fails without the fix (red) and passes with it (green)
  - [x] Typecheck, lint, full suite

### Review Findings

Adversarial code review, 2026-09-09 (Blind Hunter + Edge Case Hunter + Acceptance Auditor, diff `0acecb2^..b04f11f`).

- [x] [Review][Patch] The new remount destroys `PayNowButton`'s in-flight payment watch — `watchedPaymentId`/`paymentPhase` previously survived `router.refresh()`; they no longer survive a gym switch. **Decided 2026-09-09 — cancel deliberately, and say so in code** [apps/dashboard/components/shared/PayNowButton.tsx:80-92]. Nothing is lost financially: the send/webhook is the authority (`saas_billing_payments` is off the `supabase_realtime` publication, Story 11.3), so a payment verifying after a switch still lands server-side and shows on the next load of that gym — only the live in-page confirmation is forfeited. Blocking the switch would trap a multi-gym Owner behind a poll that runs 45s before it even says "still waiting"; persisting the watch buys a cross-gym confirmation-banner problem. Polling gym A's payment from gym B's screen was never right, so the remount's behaviour is correct — it was just undocumented, which is what the comment fixes.
- [x] [Review][Patch] The keyed subtree does not cover the layout's suspended-gym branch, where the same staleness bug is live and money-adjacent [apps/dashboard/app/(dashboard)/layout.tsx:79,87] — also add suspended/error-branch cases to the regression test, which hard-codes `suspended: null`
- [x] [Review][Patch] A gym switch on mobile leaves the nav drawer open — `GymSwitcher` is the only interactive element in the sidebar not given `onNavigate` [apps/dashboard/components/shared/Sidebar.tsx:87-93]
- [x] [Review][Patch] The corrected comment promotes a rationale this very diff invalidated — `FrontDeskAlertPanel` is now remounted wholesale, so its React-Query re-keying is no longer the mechanism keeping it correct [apps/dashboard/components/shared/GymSwitcher.tsx:40-43]
- [x] [Review][Defer] The regression test pins an element-tree shape, not the re-seeding behaviour, and dies on `undefined.key` if `DashboardChrome` ever gets a second child [apps/dashboard/app/(dashboard)/layout.gymSwitchRemount.test.tsx:89-110] — deferred, pre-existing
- [x] [Review][Defer] Dev Notes' "only three components seed state this way" inventory is wrong — at least seven more do [_bmad-output/implementation-artifacts/1-19-gym-switch-stale-page-content.md:100] — deferred, pre-existing
- [x] [Review][Defer] Unsaved edits on any `(dashboard)` page are now silently discarded by the remount, with no dirty-check confirm [apps/dashboard/app/(dashboard)/layout.tsx:129] — deferred, pre-existing

## Dev Notes

### Why the key goes where it goes

```tsx
<DashboardChrome ...>          {/* NOT keyed: holds only mobileNavOpen */}
  <Fragment key={shell.gymId}> {/* keyed: everything gym-scoped remounts */}
    {children}
  </Fragment>
</DashboardChrome>
```

A `Fragment` key forces the remount without adding a DOM node. Keying `DashboardChrome` itself would also work for the data bug but would reset the mobile nav on every switch (AC #4), and would remount the switcher mid-interaction.

### What was checked and deliberately left alone

- **`DashboardChrome`, `Sidebar`, `TopBar`** — only client state is `mobileNavOpen`, which is gym-independent. They take fresh props each render, so they are correct outside the keyed subtree.
- **`FrontDeskAlertPanel`** — its React Query key is `["frontDeskAlerts", gymId]`, so it already re-keys on gym change. Verified, not modified.
- **`cacheComponents: true`** — no `"use cache"` directives exist in this app, so no server-side cache was holding stale data. Ruled out early rather than assumed.
- A pre-existing dev-only console error on `/settings` ("Next.js encountered uncached data during prerendering or a navigation") was measured **identically with and without this change** and is therefore out of scope here — recorded so it is not mistaken for a regression from this fix.

### The general hazard, for future pages

Any client component that does `useState(props.somethingFromTheServer)` under `(dashboard)` is a candidate for this class of bug on *any* server-driven context change, not just gym switching. The layout key now covers gym changes app-wide, so new pages inherit the fix. Only three components currently seed state this way (`SettingsForm`, `StaffPageClient`, `PayNowButton`), all inside the keyed subtree.

### Testing standards

`app/(dashboard)/layout.gymSwitchRemount.test.tsx` asserts the invariant on the layout's returned element tree. `DashboardLayoutData` is an async Server Component, so the test reaches it through the `Suspense` element and awaits it directly — no renderer or DOM needed, and the assertion is on the one structural property that matters (the key), not on incidental markup.

Red-green verified rather than assumed: with the fix stashed, the two key assertions fail with `expected null to be 'gym-a'`; the third (unrelated prop pass-through) correctly still passes.

The first draft of this test mutated a shared `shell` object and restored it at the end of the test body — a failing assertion skipped the restore and leaked the wrong gym into the next test, which surfaced during the red run. Rebuilt via `beforeEach` instead.

### References

- `apps/dashboard/app/(dashboard)/layout.tsx` — the fix and its rationale.
- `apps/dashboard/components/shared/GymSwitcher.tsx` — corrected comment; `handleSwitch` itself unchanged.
- `apps/dashboard/services/session.ts:326` — `switchActiveGym`; verified correct, not modified.
- Story 9.6 — original gym-switching implementation, whose `router.refresh()` assumption this corrects.

## Dev Agent Record

### Agent Model Used

Claude Opus 5 (1M context)

### Debug Log References

Pre-fix reproduction, `/settings`, three-gym owner:

```
BEFORE: {"switcher":"Obama Gym","field":"Obama Gym"}
AFTER : {"switcher":"Martin Fitness","field":"Obama Gym"}
network: POST /settings | GET /settings?_rsc
```

Post-fix, same scenario plus consecutive switches:

```
### /settings
  start           : {"switcher":"Obama Gym","field":"Obama Gym"}
  -> SmartSana Fitness  switcher=SmartSana Fitness  field=SmartSana Fitness  OK
  -> Martin Fitness     switcher=Martin Fitness     field=Martin Fitness     OK
  -> Obama Gym          switcher=Obama Gym          field=Obama Gym          OK
### /members
  -> SmartSana Fitness / Martin Fitness / Obama Gym                          OK
```

Regression test, fix stashed (red):

```
× keys the page subtree on gymId so a gym switch remounts client state
× changes that key when the active gym changes, forcing a remount
AssertionError: expected null to be 'gym-a'
Tests  2 failed | 1 passed (3)
```

### Completion Notes List

- Server side was never broken. The RPC, the JWT refresh and the RSC refetch all worked throughout; only client state seeded at mount was stale. The switcher label updating is what proves this, and it is the fastest way to recognise this class of bug again.
- Data-integrity angle worth noting beyond the reported symptom: Settings is an editable form, so before this fix an owner could have saved Gym A's values onto Gym B without any error being raised.
- One-line behavioural change (a keyed `Fragment`), covering every current and future `(dashboard)` page rather than patching `SettingsForm` alone — the same bug was latent in `StaffPageClient` and `PayNowButton`.
- `GymSwitcher.tsx`'s comment claiming `router.refresh()` was sufficient for every page in the app was actively misleading during diagnosis and has been corrected.
- Verification: dashboard typecheck 0 errors; lint 0 errors (15 pre-existing unused-var warnings in test files); tests 34 files / 230 passed (227 before, +3 new).

### File List

- `apps/dashboard/app/(dashboard)/layout.tsx` — MODIFIED: `Fragment key={shell.gymId}` around `children`, with rationale
- `apps/dashboard/components/shared/GymSwitcher.tsx` — MODIFIED: corrected the inaccurate `router.refresh()` sufficiency comment
- `apps/dashboard/app/(dashboard)/layout.gymSwitchRemount.test.tsx` — NEW: 3 regression tests

## Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-09-09 | 1.0 | Fixed stale page content after a gym switch: keyed the `(dashboard)` page subtree on `gymId` so client components re-seed instead of surviving `router.refresh()`. Added red-green-verified regression tests. | Claude Opus 5 (1M context) |
