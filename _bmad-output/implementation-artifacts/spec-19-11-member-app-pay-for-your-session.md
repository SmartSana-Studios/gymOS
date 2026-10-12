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
