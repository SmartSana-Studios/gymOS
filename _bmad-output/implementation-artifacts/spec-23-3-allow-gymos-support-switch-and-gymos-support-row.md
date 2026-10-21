---
title: '23-3 Allow GymOS Support switch and GymOS Support row'
type: 'feature'
created: '2026-10-21'
baseline_commit: '04b323bd243883685a6c00fe26ceb09b99ea9574'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-23-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `gyms.allow_gymos_support` (23-1) can be changed only by a setter that does not exist yet, so every gym stays off, and an Owner has no way to see or control GymOS access (FR-182, FR-183).

**Approach:** Migration 0137 adds the Owner-only audited setter `set_allow_gymos_support(p_gym_id, p_on)` (the only opener of the existing `gymos.allow_support_setter` guard), an Owner-only status read, and the suspend/restore mechanics. The dashboard adds an Owner switch with a one-state readout in Settings (EN/FR) and a fixed "GymOS Support" staff row.

## Boundaries & Constraints

**Always:**
- Caller authority is `private.gym_id() = p_gym_id` and `private.current_member_role() = 'owner'` only; Supervisor, Manager, Receptionist, Coach, support and Super Admin are refused. The gym must be `active` (fail-closed `is distinct from`).
- Off: in one transaction, under a per-gym advisory lock (`private.support_gym_lock(gym)`, the key 23-5 reuses), set the column, move `active` assignments to `suspended` marked `suspended_by_switch`, and call `private.support_set_membership(id, false)` for each. On: only assignments marked `suspended_by_switch` return to `active` (marker cleared, membership restored via `support_set_membership(id, true)`); `pending` and other `suspended` ones are untouched. An unchanged value writes and logs nothing.
- One `audit_log` row per change: action `allow_gymos_support_changed`, metadata old and new, no individual's identity. Super Admin reads it through the existing platform audit policy.
- Also from the 23-1 deferral: `support_assignments.updated_at` trigger. Transition rules and state CHECKs stay with 23-5.
- Staff row and readout never show an individual or a count. The row shows while the switch is on. Readout states: off ("turned off by you"); on, none assigned; on, assigned; on, assignment waiting for GymOS to confirm; plus "last acted" time from the newest `private.support_session_state.last_seen_at` of the gym's non-ended assignments (none yet = "not yet"). Read only through an Owner-only function, since `support_assignments` has no client policy.
- Gates reach consumers (retro 66): a pgTAP scan lists every function whose body writes `allow_gymos_support`; only the setter and the 23-1 guard may.
- Rollback script `scripts/rollback-0137-*.sql`; revokes `from public, anon`; guardrails clean.

**Never:** no support creation, assignment, allow-list or proxy actor (23-4..23-7); do not apply to production; do not change older dashboard queries (they must keep rendering).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error Handling |
|----------|--------------|----------|----------------|
| Owner turns off | switch on; one active, one pending assignment | column false; active -> suspended+marker; its support membership deactivated; pending untouched; one audit row | N/A |
| Owner turns on | after the above, plus one pending created while off | marked one -> active with membership; both pending stay pending | N/A |
| Non-owner | Supervisor, Manager, support, Super Admin, other gym's Owner | refused, nothing written | exception "permission denied" |
| Suspended gym / no change | gym not active; or same value | refused; or no-op, no audit row | exception / none |
| Direct write | `update gyms set allow_gymos_support` | refused by the 23-1 guard | exception |
| Older build | dashboard without the new code loads the gym | still renders | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0135_support_assignments_live_gate.sql` -- guard `private.guard_allow_gymos_support` (GUC `gymos.allow_support_setter`), `support_set_membership`, assignment table. Next migration number 0137.
- `supabase/migrations/0123*.sql` -- `set_gym_category` is the setter/audit/status-check pattern to copy.
- `supabase/tests/support_role_live_gate.test.sql`, `support_excluded_from_counts.test.sql` -- fixtures for live support users.
- `apps/dashboard/services/gym-settings.ts` (`setLoyaltyProgram` style RPC wrapper), `app/(dashboard)/settings/page.tsx`, `SettingsForm.tsx` (right/left column sections, `StaffSection` at ~202), `app/(dashboard)/settings/staff/page.tsx` + `components/StaffPageClient.tsx` (staff list), `services/staff.ts` `listStaff`.
- `apps/dashboard/locales/en.json`, `fr.json` -- Owner-facing strings; `packages/types/src/database.ts` -- regenerate types.
- Reuse the 23-1 deferral lines in `deferred-work.md`; close the "23.3 must call support_set_membership" one.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0137_allow_gymos_support_switch.sql` -- `suspended_by_switch` column, updated_at trigger, `private.support_gym_lock`, `set_allow_gymos_support`, `get_gymos_support_status`, revokes
- [x] `scripts/rollback-0137-allow-gymos-support-switch.sql` -- drop the new objects
- [x] `supabase/tests/allow_gymos_support_switch.test.sql` -- matrix rows, role refusals, audit row, concurrent-lock proof, writer scan, ACLs
- [x] `apps/dashboard/services/gym-settings.ts` + `gymosSupport` unit tests -- setter and status wrappers
- [x] `SettingsForm.tsx` + new `GymosSupportSection.tsx` (Owner only) + `staff/components/StaffPageClient.tsx` -- switch with confirm, readout, fixed row (no edit, no deactivate)
- [x] `locales/en.json`, `fr.json`; `packages/types/src/database.ts`
- [x] `docs/decisions.md`, `deferred-work.md`, e2e smoke if a Settings spec exists

**Acceptance Criteria:**
- Given the Owner toggles the switch, when it commits, then the next request by an affected support session fails the live gate with no further action.
- Given an older dashboard build or a non-Owner, when the staff list and Settings load, then they render and the switch is absent for non-Owners.
- Given `scripts/ci-local.sh`, when it runs, then every stage is green (read the per-stage lines).

## Implementation Notes

## Spec Change Log

## Review Triage Log

Round 1 (blind-hunter, edge-case-hunter, verification-gap):
| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| Staff row repeats on every page of a paginated list | medium | patch | Row is rendered above `pg.pageItems` (StaffPageClient.tsx:162); show on page 1 only. |
| Staff row says "Active" even when nobody is assigned | low | patch | Status cell reuses `staff.status.active`; replace with a dash (direct correction). |
| No tests: StaffPageClient row, getAllowGymosSupport, SettingsForm owner gate, saveAllowGymosSupport, section failure paths, supervisor read of the column | medium | patch | Verification-gap searched the repo: no test references them; supervisor RLS read is the FR-183 "every role sees the row" claim. |
| getAllowGymosSupport drops the query error unlogged; a throw fails the staff page | low | patch | gym-settings.ts:654; wrap in mapAndLog and `.catch(() => false)` in staff/page.tsx. |
| Section: re-read failure after a committed save shows saveFailed; fallback state can be wrong | medium | patch | GymosSupportSection.tsx:117; keep the re-read out of the save catch, fall back to a "saved" toast and keep the previous state's assignment info. |
| Lock test accepts any advisory lock | low | patch | Assert the lock key (classid/objid from hashtextextended) so removing support_gym_lock fails. |
| database.ts types last_acted_at as non-null | low | patch | Function returns null; hand-spliced type. |
| window.confirm spy never restored | low | patch | One-line afterEach. |
| Owner of a suspended gym cannot switch off | low | rejected | Spec (frozen) requires active gym; support_live already denies every support session while the gym is suspended (g.status='active' leg). |
| Re-enable restores an account offboarded while off | low | defer | Accounts are deactivated by 23-10/23-11, which do not exist yet; they must end or lock the assignment. |
| 23-5 must check the switch before pending -> active | low | defer | guard_support_membership already refuses a membership while the switch is off; the assignment-state half is 23-5's. |
| last_acted_at joins session state across gyms | low | rejected | Placeholder until 23-8 (Design Notes); fix needs a gym column on session state. |
| "Next request fails the live gate" not tested end to end | maybe-false | rejected | support_live has a leg `a.state = 'active'` and `g.allow_gymos_support` (0135:116-118), proven in 23-1 tests; would be low. |
| NULL allow_gymos_support | false | false | Column is `boolean not null`. |
| Section stale after prop change, two-tab toggle, window.confirm, a11y, locale formatting, name==role string, sequential fetch, rollback leaves types, duplicate descriptions | low | rejected | Cosmetic or speculative; fixes add machinery. |

## Design Notes

Restore needs a marker because `suspended` will also be reached by 23-5/23-10; only switch-caused suspensions may return on re-enable. The "last acted" time is session activity until 23-8 provides audited support actions.

## Verification

**Commands:**
- `scripts/pgtap-run.sh supabase/tests/allow_gymos_support_switch.test.sql` -- expected: all ok
- `node scripts/check-migration-guardrails.mjs` -- expected: clean
- `scripts/ci-local.sh` -- expected: GREEN
