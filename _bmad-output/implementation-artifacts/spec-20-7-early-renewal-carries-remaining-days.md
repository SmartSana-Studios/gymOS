---
title: '20-7 Early renewal carries the remaining days'
type: 'feature'
created: '2026-10-15'
status: 'review'
baseline_commit: '4a13709'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-20-context.md'
  - '{project-root}/docs/decisions.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A renewal verified before the current expiry starts the renewed subscription at `current_date`, so the remaining paid days are forfeited, and with them any R free days the loyalty program appended to that period (Epic 20 retro S-3, deferred-work.md review of 20.3). Free days make the loss member-visible.

**Approach:** Migration 0121 re-creates `confirm_renewal` and `complete_verified_payment` (0119 bodies) so the renewed subscription's `expiry_date` runs from the later of today and the latest subscription's `expiry_date`, plus the plan duration. One general rule; rewarded days are not special-cased. Decision recorded in `docs/decisions.md` (2026-10-15).

## Boundaries & Constraints

**Always:**
- Number is **0121** (Epic 21's 21.1 moves to 0122). Both functions keep signature, `SECURITY DEFINER`, grants, locking order (AD-27) and the loyalty hook call.
- `new expiry = greatest(today, previous expiry) + duration_days`; `start_date` stays `current_date`; `expiry_date > start_date` still holds.
- Lapsed (expiry in the past), expiring today, pay-per-session (null expiry) and back-dated renewals produce exactly what they did before.
- Audit metadata of `renewal_confirmed` and `subscription_payment_renewal` gains `carried_days`.
- An early renewal still earns no loyalty stamp; `award_renewal_stamp` is unchanged.
- Rollback script `scripts/rollback-0121-early-renewal-carries-days.sql` restores the 0119 bodies; `prod-apply.mjs` stage `5`; pgTAP.

**Never:** No change to `renew_subscription` (the payment-less manual reset: explicit, reason required, no money taken, keeps starting from today). No UI change: no screen previews the new expiry, they show the stored value after refresh and "Start date: Today" stays true. No change to loyalty rules, idle windows or the sweep.

## I/O & Edge-Case Matrix

| Scenario | State | Expected |
|---|---|---|
| Early, staff renewal | active, expiry today+10, plan 30 d | new expiry today+40, start today, `carried_days` 10 |
| Early, Tara renewal | same, via `complete_verified_payment` | new expiry today+40 |
| Rewarded days present | expiry today+40 (30 + R 10), early | new expiry today+70 |
| On expiry day | expiry today | today+30, `carried_days` 0 |
| Lapsed | expired 5 days ago, not back-dated | today+30 |
| Back-dated | expired 5 days ago, `p_backdate` | old expiry + 30 (as before) |
| Pay-per-session | null expiry | null expiry |
| Early, loyalty on | active, expiry today+10 | no stamp, no progress row |
| Manual reset | `renew_subscription` while active | today + duration (unchanged) |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0121_early_renewal_carries_remaining_days.sql` -- both functions + verify block
- `scripts/rollback-0121-early-renewal-carries-days.sql`, `scripts/prod-apply.mjs` (stage 5)
- `supabase/tests/early_renewal_carry.test.sql`
- `docs/decisions.md` (2026-10-15 entry), `_bmad-output/planning-artifacts/epics.md` (21.1 number)

## Verification

- pgTAP `early_renewal_carry.test.sql` and every existing renewal file pass; `scripts/ci-local.sh` green.
- Production: stage 5 dry run, backup, apply, verification (function bodies contain the carry, grants unchanged, head 0121).
