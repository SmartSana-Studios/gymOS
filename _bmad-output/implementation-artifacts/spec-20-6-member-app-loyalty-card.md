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
