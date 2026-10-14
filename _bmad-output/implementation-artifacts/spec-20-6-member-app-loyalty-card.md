---
title: '20-6 Member app loyalty card'
type: 'feature'
created: '2026-10-13'
status: 'done'
baseline_commit: '64f2a50b40c34bdc2447eddddf7cd075851f5736'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-20-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Members cannot see loyalty progress, free sessions or free days anywhere in the app; no reward push exists, so the Home card is the only place a grant becomes visible (FR-169 member view).

**Approach:** Add a flat Rewards card to Home (below quick actions, above the workout-plan/Upcoming Classes sections) fed by `effective_loyalty` for counters, windows and session rows. Grant facts come from two own-row reads (decision below). No migration.

## Boundaries & Constraints

**Always:**
- Card is `flat`, titled "Rewards" / "Récompenses"; absent (not empty) unless `enabled` or an unexpired free session is held. JSON `null` (suspended gym) or a failed read leaves it out; the read never blocks or errors Home (best-effort like occupancy).
- Progress block only when `enabled`: guest counter ("n / N", caption "paid sessions toward your next free session") when the current plan is Pay-per-session or the member has no plan; subscriber counter ("n / K", "on-time renewals toward [R] free days") otherwise. The other counter is never shown. Segments up to N ≤ 12, a continuous bar above. Values are the read-time counters from `effective_loyalty` (idle reset already applied). The stamp row is decorative to screen readers; the block's accessible label is the full sentence ("3 of 5 paid sessions toward your next free session").
- Rows from `effective_loyalty.free_sessions` / `paid_sessions`: free rows "Free session — use by [date]" (gift glyph, success tint); a free session while the current plan is not Pay-per-session is neutral with sub-line "Usable when you're back on Pay-per-session"; paid rows "Paid session — use by [date]" (ticket glyph, accent), soonest first. Each row is one accessibility label with the date spoken in full. Not tappable.
- Footnote (muted small): guest "Progress resets after [guest_window_days] days without a paid session."; subscriber "Renew on time to keep your progress." Window comes from the RPC, never hard-coded.
- Headline "Free session earned — valid for [N] days": shown once per free-session id not yet recorded in device storage (AsyncStorage, per user and gym); recorded when the card renders it. N = whole days from the grant row's `created_at` to `usable_until`. Storage failure shows nothing rather than repeating.
- Free-days line "[R] free days added — your new renewal date is [date]": while the latest subscriber `reward_granted` event's `details.subscription_id` equals the member's latest subscription; R from `details.reward_days`, date from that subscription's `expiry_date`.
- Active gym only. All strings in `en.json` and `fr.json` with parity; "session" qualified in EN.

**Never:** No migration, no `database.ts` change, no write to any loyalty table, no push or notification, no edit to `effective_loyalty`, no change to Profile or the status card, no `raised` card.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Guest mid-program | on, guest 3 of 5, no rows | progress "3 / 5", caption, footnote | N/A |
| Subscriber | on, subscriber 1 of 3, R 30 | "1 / 3", renewals caption, other counter hidden | N/A |
| Free session earned | unseen id held | headline once, row; next render no headline | storage error: no headline |
| Free session dormant | on a monthly plan | neutral row + sub-line | N/A |
| Program off, free session held | enabled false | rows only, no progress, no footnote | N/A |
| Program off, nothing held | enabled false, empty lists | no card | N/A |
| Past idle window | stale count, window elapsed | counter shows reset value | N/A |
| Reward days granted | latest sub id matches event | free-days line with new date | after renewal: gone |
| Suspended gym / RPC error | null or error | no card, Home unaffected | swallowed |
| Chart above 12 | N 20 | continuous bar, same sentence label | N/A |

</frozen-after-approval>

## Code Map

- `apps/mobile/src/app/(tabs)/index.tsx:636-660` -- quick-actions row; render `RewardsCard` after it and before the workout-plan section (`:661`); load alongside the best-effort fetches in `loadHome` using `memberResult.data.id`, `chargingCtx.planType`
- `apps/mobile/src/services/loyalty.ts` (new) -- `getOwnLoyalty(memberId)`: `supabase.rpc('effective_loyalty')`, own `guest_sessions` where `loyalty_grant_id` not null and unconsumed (id, created_at, usable_until), latest `loyalty_events` subscriber `reward_granted` (details), latest subscription id/expiry; parse like `apps/dashboard/services/loyalty.ts` (`parseEffectiveLoyalty`, null on JSON null)
- `apps/mobile/src/lib/rewards.ts` (new) -- pure view model: counter choice, dormant, validity days, headline-unseen, free-days line, stamp segments vs bar; unit-tested
- `apps/mobile/src/components/RewardsCard.tsx` (new) -- uses `Card variant="flat"`, `ListItem`/`IconChip` (Session Chip variant), `Spacing`, `useTheme`
- `apps/mobile/src/lib/sessionState.ts:25` -- `isChargedMember` stays the charging gate; do not reuse for dormant (dormant = plan type is not `pay_per_session`)
- `apps/mobile/src/services/sessionCharging.ts` -- AsyncStorage key-per-user precedent for the seen-grants key
- `apps/mobile/src/locales/{en,fr}.json` -- `home.rewards.*`
- Tests mirror `apps/mobile/src/lib/sessionState.test.ts` and `services/payments.test.ts`; vitest includes `src/**/*.test.ts` only
- Do not touch: migrations, `effective_loyalty`, dashboard, status card

## Tasks & Acceptance

**Execution:**
- [ ] `services/loyalty.ts` -- fetch + parse RPC and the two own-row reads, null-safe -- single data path
- [ ] `lib/rewards.ts` + `lib/rewards.test.ts` -- pure view model, every matrix row -- testable logic outside the component
- [ ] `components/RewardsCard.tsx`, `app/(tabs)/index.tsx` -- card, once-per-grant storage, placement, a11y labels -- MA-09
- [ ] `locales/en.json`, `locales/fr.json` -- strings with plural-aware days, parity -- UX-DR
- [ ] `services/loyalty.test.ts` -- parse null/malformed JSON, row mapping -- RPC contract
- [ ] local gates: apps/mobile `typecheck`, `lint`, `test`; `scripts/ci-local.sh`; sprint-status entry

**Acceptance Criteria:**
- Given a guest at a loyalty gym, when Home renders, then the card shows the guest counter, free and paid rows and the footnote with the RPC's window.
- Given a free session granted since the last render, when Home renders twice, then the headline shows the first time only.
- Given the matrix, when mobile vitest and `scripts/ci-local.sh` run, then all pass.
- On-device QA (user): progress after a paid session, free session at N used next visit, subscriber progress after on-time renewal; ships with the next pending mobile build.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| # | Finding (layer) | Verdict | Evidence / route |
|---|---|---|---|
| 1 | Corrupt seen-grants value never self-heals, headline suppressed forever (EC, BH) | medium, patch | Corrupt JSON / non-array now reads as empty; only a storage exception returns null. Fixed, tested |
| 2 | Enabled with null thresholds renders a bare title (BH) | low, patch | One-line guard returns null with no progress, rows, free-days or headline. Fixed |
| 3 | Rewards fetch awaited inline, delays rest of Home (BH, EC, VG) | medium, patch | Detached with isCurrent guard. Fixed |
| 4 | No tests for loyaltySeen and getOwnLoyalty orchestration (BH, VG) | medium, patch | Added loyaltySeen.test.ts and getOwnLoyalty tests (filters, scope, partial failure). Fixed |
| 5 | Record effect cancelled in flight, grant seen but never shown (BH, EC) | false | A data change re-runs the effect with pending still non-null (seen state updates only after a successful record), so it re-records and shows. Only unmount drops it |
| 6 | Unserialised read-modify-write of seen ids (BH, EC) | low, rejected | Same ids on overlap; loss needs different ids in flight; fix adds a queue |
| 7 | Headline reflects newest of several grants (BH) | low, rejected | Validity is one platform value; spec defines a one-line headline |
| 8 | Hardcoded #4ADE80 (BH) | low, rejected | Same literal Home already uses for success text |
| 9 | Failed refetch hides card; rewardsData not reset on member change (EC, BH) | low, rejected | Spec: failed read leaves card out; member change reloads Home or shows error screen |
| 10 | planType null on subscription error shows guest counter (VG, EC) | false | loadHome returns with loadError before the Rewards fetch when the subscription read errors |
| 11 | Headline on dormant plan; stale past renewal date; Invalid Date; 0 days; client clock skew; a11y role/header; ListItem not used (EC, BH) | low, rejected | Spec-conformant or unreachable from typed columns; fixes add branches |
| 12 | Component and Home wiring untested (VG, BH) | defer | No component harness in apps/mobile; on-device QA owns it. In deferred-work.md |

## Design Notes

Decision (2026-10-13, user): grant facts via own-row reads, not an `effective_loyalty` extension. Renewal creates a new `subscriptions` row (0119), so "reward line stays until next renewal" = event `subscription_id` equals the latest subscription. A held free session at first install counts as unseen; the card never existed before, so it is news.

## Verification

**Commands:**
- `cd apps/mobile && npm run typecheck && npm run lint && npm test` -- expected: clean
- `scripts/ci-local.sh` -- expected: all stages green

### Review Findings

Code review pass (2026-10-13, 4 layers: blind, edge-case, verification-gap, acceptance; diff vs epic/20).

- [x] [Review][Patch] (decided 2026-10-13: hide when `expiryDate` is before today) Free-days line persists for a lapsed or cancelled latest subscription and speaks a past "new renewal date" — The line shows while the reward event's `subscription_id` equals the latest subscription, with no check on that subscription's state or `expiryDate`. A member who earned R free days, then let that subscription expire (or moved to Pay-per-session) without a new `subscriptions` row keeps reading "[R] free days added — your new renewal date is [past date]". The spec rule ("after renewal: gone") does not cover lapse. Options: (a) hide the line when `expiryDate` is before today (recommended, one condition in `buildRewardsView`); (b) keep per spec. [apps/mobile/src/lib/rewards.ts:770-780] (edge-case, blind)
- [x] [Review][Patch] Free-days line ignores `enabled`, contradicting matrix row "Program off, free session held: rows only" — `freeDays` is computed whether or not `loyalty.enabled`; with the program off and a held free session, a matching stale event still renders the line. Gate on `loyalty.enabled`, add a test. [apps/mobile/src/lib/rewards.ts:770] (acceptance)
- [x] [Review][Patch] `getOwnLoyalty` tests do not assert the `loyalty_events`, `subscriptions` or `members` reads — only the `guest_sessions` filters are asserted (the chain stub logs the others, never checked, and renders `order` options as `[object Object]`). Dropping `eq('counter','subscriber')`, flipping `ascending`, or dropping `member_id` scoping leaves every test green. Triage row 4 claims this coverage. Assert `event_type`, `counter`, `order(occurred_at desc)`, `limit(1)`, subscriptions `member_id` + `created_at desc` + `limit(1)`, and `members.eq(id)`. [apps/mobile/src/services/loyalty.test.ts:985-1007] (verification-gap, blind)
- [x] [Review][Patch] Null-threshold guard (triage row 2) has no test — no case in `rewards.test.ts` for enabled with null `guestThreshold` / `renewalThreshold` / `rewardDays`, nor for `rewardDays` 0, a held free session still rendering rows with null progress, or `current` above `total` clamped. [apps/mobile/src/lib/rewards.test.ts] (verification-gap, blind)
- [x] [Review][Defer] Rewards card effects and Home wiring have no automated test (once-only headline latch, record-then-show, detached fetch) [apps/mobile/src/components/RewardsCard.tsx:240-273] — deferred: no React Native component harness in apps/mobile; on-device QA (user) owns it. Triage row 12 cited deferred-work.md but no entry existed; now recorded there.

#### Rejected

- Promise.all rejection drops the whole card (EC): low. supabase-js returns `{ error }` rather than rejecting and `getSession` reads local storage; the outer catch only yields the spec'd "card left out". Guards add branches for an unreached path.
- Late-inserted grant row understates validity days (EC): low. Spec defines N as `created_at` to `usable_until`; no demonstrated path.
- planType null while chargingCtx loads, shows guest counter briefly (EC): false. `setChargingCtx` runs in `loadHome` before the detached rewards fetch, and the subscription-read error path returns first (triage row 10).
- Invalid Date in free-days line / rows (EC): low. Typed `date` and `timestamptz` columns; unreachable.
- Unmount between record ok and `setShown` loses the headline (EC, BH): low. Home is a persistent tab and the record resolves in milliseconds; fix restructures the latch (triage row 5).
- Headline validity reflects only the newest of several grants (EC, BH): low. Platform validity is one value; spec defines one headline line (triage row 7).
- Headline "valid for 0 days" (EC): false. Held grants have `usable_until` after `created_at`; the clamp to 0 is not reachable.
- Client clock skew on `usable_until > now` filter (EC): low. Dropping the filter lets expired unconsumed grants accumulate unboundedly in the read; mild skew only delays one headline.
- "Use by" dates use device time zone (EC, BH): low. Gym-local formatting needs a new prop and spec says date spoken in full; travelling member edge.
- Extra `members` and `getSession` reads per Home load (BH): low. One small own-row query; negligible.
- Stale card after state change (BH): false. `useFocusEffect` re-runs `loadHome` on every tab revisit.
- Headline recorded on render, not visibility (BH): low. Spec: "recorded when the card renders it".
- iOS live region, progress block role, hardcoded `#4ADE80` contrast (BH, AA): low. Same literal Home already uses; a11y role items rejected in triage row 11.
- Free-days line has no dedicated a11y label (AA): false. Plain text is read by screen readers; spec scopes the label rule to rows.
- Rows not built from `ListItem` (AA): low. Behaviour matches spec (not tappable, 44pt, one label); triage row 11.
- Free-session rows not re-checked for expiry on client (AA): low. Stale in-memory only until next Home focus refetch.
- French caption wording, `guestLabel` unused params, DST rounding (BH): low. Wording matches spec captions; unused params harmless; DST shifts by under a day and rounds correctly.
- Spec frontmatter `status: done`, unchecked tasks, empty notes, stale `last_updated` header (BH, AA): rejected per rules, fix is to edit the spec; status is synced in step 6.
