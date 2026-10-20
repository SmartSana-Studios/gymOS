---
title: '23-0 Pre-flight checklist (product owner)'
type: 'chore'
created: '2026-10-20'
status: 'in-progress'
route: 'oneshot'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-23-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 23 introduces GymOS Support on a production platform with real gyms. Story 23.0 requires the owner-side conditions (Super Admin factors, open questions OQ-30/OQ-31, Owner notice, assumption values, deferrable items) to be recorded before any support code ships.

**Approach:** Add one dated 23.0 entry to the top of `docs/decisions.md` recording the owner's 2026-10-20 answers and the facts read from the repo and production notes; update PRD OQ-30; sync `sprint-status.yaml`. No application code, migrations or config changes.

**Decisions (owner, 2026-10-20):**
1. OQ-30 confirmed: opt-out suspends assignments, opt-in restores those that were active, assignments made while off stay pending.
2. All assumption values confirmed unchanged: velocity 10/h per gym, 20/h per account, 3 payment-connection changes/day per gym; 60 s cutoff; 30-day inactivity; 30-minute cooling-off; 3-business-day disclosure answer; Super Admin session limits 8 h absolute and 30 min idle; 5-minute step-up.
3. All four deferrable items kept: velocity lock, daily digest, quarterly recertification, inactivity sweep.
4. Super Admin factors: record the real state (one TOTP factor plus verified recovery email, per the 2026-10-20 owner decision against a second authenticator) and flag that it differs from the AC wording "two verified factors". `enable-super-admin-aal2.mjs` accepts this combination (migration 0128).
5. OQ-31 and the Owner notice have no owner answer yet: record both as open, OQ-31 blocking 23.8 and release, the notice send date blocking release. Draft EN/FR notice text may be added as a draft, never as approved.

</frozen-after-approval>

## Implementation Notes

## Spec Change Log

## Review Triage Log
