---
title: '23-10 Revocation, Owner visibility and velocity lock'
type: 'feature'
created: '2026-10-21'
status: 'done'
baseline_commit: '4b0817e890d8ed2dd3d09139caef153468efe5a6'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-23-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** When support access ends nothing tells the Owner what is left behind, support-created staff sit untagged and unreviewed, the Owner hears nothing about what support did, and a runaway support account is never stopped.

**Approach:** One revocation routine shared by every way access ends; an Owner review queue and tag for support-created staff; a daily `support_activity_digest`; a velocity counter in `session_gate_touch` that locks the account; a Super Admin unlock with a recorded reason. Items 23.0 marked deferred are skipped, not deleted (all four were kept).

## Boundaries & Constraints

**Always:** Migration 0144 with a rollback script. Limits live in `private.session_limits_config` (10/h per gym, 20/h per account, 3 payment-connection changes/day per gym, 60 s cutoff, all `[ASSUMPTION]`). Count from `support_action_identity` rows. The breach is returned as a result so the lock commits (never raised). Lock, unlock and reason are audited (`private.support_admin_audit`); mandatory reason on unlock. Notices go through `staff_notices` + `email_outbox` (23-9), names no individual, EN/FR. Gate every revocation path (unassign, deactivate, switch off, lock, suspended gym) on the one routine; a scan test lists every consumer and fails when a new one skips it (retro 66). New raise sites carry no user id. Suspended gyms deny support and are excluded from any inactivity count.

**Decisions (planner, no intent gap):** Since 23-7 support-written rows already carry the gym proxy as actor, "re-owned to the proxy" is already true; revocation instead flags pending payments and subscriptions support started (via identity rows) in an Owner notice. `created_by_support` is pinned by a bypass GUC set only in the insert branch of `create_staff_member` (23-6 deferral). `log_audit_event` for a live support caller accepts only an allow-list of action types (23-8 deferral). Reading a real identity (`get_support_action_identity`) writes one audit row (23-8 deferral). Super Admin lock alert reaches every Super Admin. Per-user wrong step-up counter with audit row for support (23-9 deferral). `set_allow_gymos_support` restore skips assignments whose account is not activated, locked or reset-pending (23-3 deferrals).

**Decisions (owner, 2026-10-21):** Keep 23-10 as one story (token count ~1,900 accepted). The daily digest is delivered as an in-app notice plus email through the outbox, like payment-connection changes.

**Never:** No automatic deactivation of support-created staff. No credential or individual name in any notice. Do not enable support for any gym. No Epic 24 digest line (skipped until it exists).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Unassign / switch off / deactivate | Pending support items exist | Access ends next request (≤60 s), Owner notice lists pending items, review queue filled | N/A |
| Support-created staff | Revocation | Listed in queue, tagged "created by GymOS Support", stay active | N/A |
| Digest | Support acted in the last day | One notice and email with counts of refunds, waivers, staff created/edited | No action: nothing sent; `job_runs` row either way |
| Per-gym breach | 11th action in an hour | Account locked, sessions ended, Super Admin alerted, lock commits | Result `locked`, no raise |
| Per-account / payment breach | 21st action/h, 4th connection change/day | Same | Same |
| Locked account | Support request | Denied | `locked` |
| Unlock | Super Admin AAL2, reason | `support_locked_at` cleared, audit row with reason | `reason_invalid` |
| Suspended gym | Support request or sweep | Denied; not counted | N/A |
| Disallowed audit action | Support calls `log_audit_event` with other type | Refused | typed error |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0135_support_assignments_live_gate.sql:429-500` -- `session_gate_touch`: add the velocity check and return `locked`; `support_live` (88) already denies locked and suspended.
- `supabase/migrations/0139_support_assign_unassign_remove.sql:386-505` -- `unassign_support`, `deactivate_support_account`: call the revocation routine; `0137` `set_allow_gymos_support` (switch off/restore) likewise.
- `supabase/migrations/0127_session_limits_step_up.sql:15-70` -- `session_limits_config`, `session_limit()`: add the velocity keys.
- `supabase/migrations/0142_support_action_identity.sql` -- identity rows to count; `get_support_action_identity` (audit the read).
- `supabase/migrations/0143_support_payment_connection.sql:72-300` -- `staff_notices`, `email_outbox`, `notify_payment_connection_change` (pattern), cron + `job_runs` (663-674).
- `supabase/migrations/0140_support_capability_allow_list.sql:261,1260,1289` -- `created_by_support`; `create_staff_member`.
- `apps/dashboard/app/(dashboard)/settings/GymosSupportSection.tsx`, staff list page -- review queue and tag; EN/FR strings.
- `apps/super-admin/app/(admin)/support/` -- locks list, Unlock action with reason; `actions.ts`.
- `supabase/tests/support_*.test.sql` -- models; `docs/decisions.md` -- record choices.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0144_support_revocation_velocity_lock.sql` + `scripts/rollback-0144-*.sql` -- revocation routine, queue/tag reader, digest + cron, velocity keys and check, lock/unlock, deferral fixes
- [x] `supabase/tests/support_revocation_velocity_lock.test.sql` -- one named test per matrix row, consumer-enumeration scan, gate shown failing
- [x] dashboard review queue, tag, notices EN/FR; Super Admin locks and Unlock; services and tests
- [x] `docs/decisions.md`, sprint-status

**Acceptance Criteria:**
- Given any matrix row, the behavior matches.
- Given each 23.10 criterion in `epics.md`, a named test covers it.
- `bash scripts/ci-local.sh` is green.

## Implementation Notes

- Migration `0144_support_revocation_velocity_lock.sql`, rollback `scripts/rollback-0144-support-revocation-velocity-lock.sql`, pgTAP `support_revocation_velocity_lock.test.sql`. The spec's `users.support_locked_at` is the existing `private.support_accounts.locked_at`, with `locked_reason` and `velocity_reset_at` beside it. Decisions in `docs/decisions.md` (Story 23.10).
- Limits: the velocity lock only bites once `session_gate_touch` is called from the dashboard request path (23-6b); the review queue lists support-created staff only; one action counts as one transaction.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route / evidence |
|---|---|---|
| Per-gym / per-payment velocity count locks the toucher, not the offender | medium | patch: only breach when p_user has own rows in the window; two-user pgTAP |
| Revoke notice says "ended" while others remain assigned, and on a reversible lock | medium | patch: wording by cause / remaining assignments |
| No index on support_action_identity (real_user_id, recorded_at) for the per-request count | medium | patch: add index + rollback |
| Consumer scan matches one SQL clause order only (blind, verification-gap, edge-case) | medium | patch: widen regex, seeded reordered-clause failing case |
| deferred-work.md 23-8 entry contradicts diff | low | patch: direct correction |
| Velocity lock never exercised from the dashboard request path | medium | defer: 23-6b wires session_gate_touch; known, support off for every gym |
| 60 s cutoff stored but nothing reads it; no mechanism/test for live subscriptions or signed links | medium (unverified) | defer: dashboard admits no support session until 23-6b; the live gate already denies per request. Settle by testing a Realtime/signed-link path in 23-6b |
| Restore skips a switch-suspended assignment and nothing restores it after unlock | low-medium | defer: Owner toggle or Super Admin re-assign recovers; revisit in 23-11 |
| log_audit_event allow-list has no completeness test against allow-listed RPCs | medium (unverified) | defer: add a catalog scan in 23-6b |
| Digest rolling window, no watermark, duplicate on manual re-run; last error only; counted sent with no Owner | low | reject: daily cron, cosmetic/rare |
| Unlock clears super_admin_lockout of a dual-role user | false | a Super Admin cannot hold a support account (epic constraint), so no dual-role user exists |
| Step-up failure counter never resets | false | 0127 stepup_issue resets failed_count on success (line 271) |
| stepup_record_failure returns locked=false on an already-locked account / lost race | low | reject: locked sessions are ended, cosmetic |
| One action = one transaction, 11th action commits before the lock | low | reject: documented design, breach is returned so the lock commits |
| GUC pin on created_by_support liftable inside the same transaction | low | reject: same pattern as the allow-switch setter GUC |
| FR "Support GymOS" vs "GymOS Support" in SQL notices | low | reject: mixed convention already shipped in 23-3 and 23-9 |
| Review queue UI: stale row after list deactivate, Keep only, clear_support_review ignores deactivated | low | reject: cosmetic, reload clears it |
| get_support_action_identity audit row stores only table and count | low | reject: owner-invisible by design |
| Other issueSupportStepUp callers / `deactivated` code key | low | reject: single caller; code already translated |
| Unlock on locked-notice, repeated revoke resends notice, wrapper untested | low | reject |

## Verification

**Commands:**
- `bash scripts/ci-local.sh` -- expected: GREEN, every stage PASS
