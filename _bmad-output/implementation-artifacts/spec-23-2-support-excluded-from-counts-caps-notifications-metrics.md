---
title: '23-2 support excluded from counts, caps, notifications and metrics'
type: 'feature'
created: '2026-10-20'
status: 'done'
baseline_commit: 'b0a9a8e0ed13b0f2c5d843ced704c4970327a072'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-23-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A `support` membership (23-1) lives in `members` beside staff, and several staff-target predicates are written `role != 'member'` or count every row, so support would be counted as staff, appear in the Owner staff list, be a valid target of in-gym staff RPCs, and inflate Super Admin member counts (FR-188, AD-33).

**Approach:** One migration adds `private.staff_roles()` (the explicit owner/supervisor/manager/receptionist/coach list) as the single shared definition and rewrites each affected predicate to use it. A catalog test classifies every function/policy that mentions `'supervisor'` or negates `'member'` as including or excluding support, so a new one fails CI unclassified (retro 66). TS list queries follow.

## Boundaries & Constraints

**Always:**
- Rewrites keep behavior identical for the five existing roles; only `support` changes.
- Staff-management RPCs (`update_staff_role`, `deactivate_staff_member`, `staff_account_for_reset`, and the replace-in-place branch of `create_staff_member`) refuse a support target with the existing "not found or not eligible" style message, whatever the caller's role.
- Phone-collision guards (`phone_has_staff_membership`, `enforce_staff_member_phone_separation`) deliberately KEEP counting support as staff-side (a support person's phone must not double as a member's); classify them as "includes support".
- `platform_metrics().total_members` and `gym_member_count()` exclude support. `enforce_member_cap` already counts `role = 'member'` only; it stays and is pinned by a test.
- Every new/replaced function keeps `revoke ... from public, anon`; a `scripts/rollback-0136-*.sql`; guardrails and claim inventory clean.

**Never:** no support UI or Owner row (23.3), no allow-list (23.6), no proxy actor (23.7); do not change any RLS policy role list (they are explicit lists and already exclude support); do not apply the migration to production.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error Handling |
|----------|--------------|----------|----------------|
| Staff RPC targets support | Owner/Supervisor calls update_staff_role, deactivate, reset, or create_staff_member (same phone/user) on a support row | refused, row unchanged | exception "not found or not eligible" |
| Counts | gym with active support membership plus owner and 2 members | member cap counts 2; `gym_member_count` = owner + 2 members; `platform_metrics` same; a counted-support variant would fail | N/A |
| Notifications | active assignment, front-desk alert and quiet-gym job run | support reads 0 alerts; no dispatch to support | N/A |
| Unclassified mention | new function mentions `'supervisor'` without being listed | catalog test fails | test failure |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0135_support_assignments_live_gate.sql` -- support writer/trigger; next free number is 0136.
- Latest definitions (read live via `pg_proc`, not the first migration): `update_staff_role` (0063), `deactivate_staff_member`, `staff_account_for_reset` (0062), `create_staff_member` (9.x), `gym_member_count` (0011), `platform_metrics`, `phone_has_staff_membership`, `enforce_staff_member_phone_separation`, `enforce_member_cap`, `run_quiet_gym_alert_job`.
- 27 functions and ~32 policies mention `'supervisor'` (explicit lists, exclude support). `private.capability_roles` is the 23.6 allow-list precedent; leave it.
- `supabase/tests/support_role_live_gate.test.sql`, `suspension_rpc_coverage.test.sql` -- test style and fixtures for a live support user.
- TS: `apps/dashboard/services/staff.ts:122` (`.neq("role","member")` becomes `.in("role", staff roles)`); `apps/super-admin/services/gyms.ts:549` (gym members list: exclude support); dashboard member queries already use `.eq("role","member")`.
- `scripts/rollback-0135*.sql` -- rollback style.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0136_support_excluded_from_staff_counts.sql` -- `private.staff_roles()`; rewrite the four staff RPCs, `gym_member_count`, `platform_metrics`; revokes
- [x] `scripts/rollback-0136-support-excluded-from-staff-counts.sql` -- restore the prior bodies
- [x] `supabase/tests/support_excluded_from_counts.test.sql` -- matrix rows in both directions; zero-alert proof; catalog classification test (list of every `'supervisor'`/`<> 'member'` function and policy, classified); consumer scan
- [x] `apps/dashboard/services/staff.ts`, `apps/super-admin/services/gyms.ts` + unit tests -- exclude support from the staff list and the Super Admin gym members list
- [x] `apps/dashboard/services/session.ts` -- no change expected; confirm `support` stays out of `STAFF_ROLES`

**Acceptance Criteria:**
- Given the migration applied, when the catalog test runs, then no function or policy matching `'supervisor'` or `<> 'member'` is unclassified.
- Given `scripts/ci-local.sh` (note: `loyalty_subscriber_rule` is a known UTC-midnight clock flake, unrelated), when it runs, then every other stage is green with no new `claim-only` entry.

## Implementation Notes

## Spec Change Log

## Review Triage Log

Round 1 (blind-hunter, edge-case-hunter, verification-gap):
| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| Staff list can drift from the member_role enum (hardcoded list, no tie) | medium | patch | Added a pgTAP assertion that staff_roles() = enum minus member and support. |
| No ACL regression test for the six re-granted functions (anon-EXECUTE trap) | medium | patch | Added anon=false and service_role=true assertions for each (plan 53). |
| Rollback script silent about the test list and app-side changes it leaves behind | low | patch | Header note added. |
| Quiet-gym "no dispatch" proof has no positive control | medium | defer | Structural proof exists (`m.role = 'member'` in the function body); a positive control needs the occupancy and window fixtures. deferred-work.md. |
| Policy classification is a heuristic, not a per-policy list | false | false | Any policy naming support fails the "no policy lists support" test; an explicit-list supervisor policy is excluding by structure. |
| role NULL drops rows from `<> support` | false | false | members.role is NOT NULL (checked in the catalog). |
| Deactivated support row lets Owner add that phone as staff via create_staff_member | low | rejected | Needs the Owner to know a hidden support phone; the fix adds guards beyond a direct correction. |
| Other Super Admin member views not filtered | false | false | gyms.ts:94 and :202 embed members only to find the owner; counts go through gym_member_count. |
| listGymMembers test does not check count; TS role list duplicated; regex blind spots; procedures not scanned; test cruft; grant surface of staff_roles(); lock_timeout wrapping | low | rejected | Cosmetic or speculative; fixes add machinery. The count comes from the same filtered query. |

## Design Notes

Why keep phone guards inclusive: they protect identity separation, not staff counts; excluding support would let a support phone double as a member account.

## Verification

**Commands:**
- `scripts/pgtap-run.sh supabase/tests/support_excluded_from_counts.test.sql` -- expected: all ok
- `node scripts/check-migration-guardrails.mjs` -- expected: clean
- `scripts/ci-local.sh` -- expected: GREEN, read per-stage lines
