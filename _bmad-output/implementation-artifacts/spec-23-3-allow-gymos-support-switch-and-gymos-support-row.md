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

### Review Findings

Round 2 (bmad-code-review, 2026-10-21; Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor).

- [x] [Review][Patch] `updated_at maintained` assertion passes without the trigger (`now()` is constant in the test transaction, so `updated_at >= created_at` always holds); back-date `updated_at` explicitly, update the row, assert it moved [supabase/tests/allow_gymos_support_switch.test.sql:114]
- [x] [Review][Patch] No test for the staff page wiring of `showGymosSupportRow` (`getAllowGymosSupport().catch(() => false)` -> `StaffPageClient`); add a `staff/page.test.tsx` asserting true passes through and a rejection yields false with the list still rendered [apps/dashboard/app/(dashboard)/settings/staff/page.tsx]
- [x] [Review][Patch] Writer scan regex misses aliased (`update gyms g set`), `update only` and `as` forms; widen it [supabase/tests/allow_gymos_support_switch.test.sql:139]
- [x] [Review][Patch] `suspended gym refused` and `direct update refused` pass `null` as the expected message, so any P0001 passes; assert the message [supabase/tests/allow_gymos_support_switch.test.sql:70,76]
- [x] [Review][Patch] The switch-on audit row (`{"old": false, "new": true}`) is never asserted; only the off transition is [supabase/tests/allow_gymos_support_switch.test.sql:132]
- [x] [Review][Patch] Unused locale keys `settings.sectionTitles.gymosSupport` and `settings.sectionDescriptions.gymosSupport` (the section reads `settings.gymosSupport.*`); remove from en and fr [apps/dashboard/locales/en.json:134,146]
- [x] [Review][Patch] Garbled 23-1 edits in deferred-work.md (double parenthetical; `[original:]` text kept inline); rewrite both bullets cleanly [_bmad-output/implementation-artifacts/deferred-work.md:1208]
- [x] [Review][Defer] Rollback `rollback-0137-allow-gymos-support-switch.sql` is undrilled and drops `suspended_by_switch`, the only record of which assignments to restore — deferred: same class as the 0134/0135/0136 entries; extend the rollback round trip to 0137 before the Epic 23 production deploy [scripts/rollback-0137-allow-gymos-support-switch.sql]
- [x] [Review][Defer] Switch-on restore raises (rolling the whole toggle back) if a switch-suspended assignee gained a non-support membership in the gym while off, and does not skip locked or unactivated accounts — deferred: fails loud and closed, not reachable until 23-10/23-11; those stories must end or lock the assignment, and the setter should then skip or tolerate such rows [supabase/migrations/0137_allow_gymos_support_switch.sql:1264]

#### Rejected

- `last_acted_at` joins session state across gyms (blind, edge) — low; spec Design Notes make it a placeholder until 23-8 and the fix needs a gym column on session state. Note for the owner: it is a timestamp only, but it can reflect a shared support user's activity in another gym.
- "Last acted" overstates what the data shows (blind) — low; spec-defined wording.
- `settings/page.tsx` does not catch a thrown status read (edge, blind) — low; the neighbouring `getDashboardShellContext` and `listPlans` calls have the same shape and the service returns errors rather than throwing.
- Fallback readout after a committed switch-on with a failed re-read says "none" (blind) — low; rare double failure, fix adds machinery.
- Staff row hides when `getAllowGymosSupport` fails (blind, auditor) — low; deliberate fail-closed UI choice, already triaged in round 1.
- Audit row carries no counts (blind) — spec freezes the metadata to exactly old and new.
- "Next request fails the live gate" has no test here (auditor, blind, VG) — low; 23-1 pins the `support_live` legs, already triaged in round 1.
- Readout states `none` and `waiting` unasserted (blind) — low; trivial CASE branches, covered by the `assigned` and `off` cases and the UI tests.
- Switch-on skips restore when the value is unchanged but rows are still switch-suspended (edge) — false; only the setter can write the column (23-1 guard), so that state is unreachable.
- Staff row gating on page 1 versus filtered empty state (edge) — maybe-false and low; not enough to act on.
- Spec file `status: done` vs sprint-status `review`, empty Implementation Notes, `37/37` vs `plan(38)` in the history line (blind) — the fix edits the spec or a log under review.
- `database.ts` ordering and `state: string`, locale JSON style, em-dash cell, `window.confirm`, focus-visible, `text-red-600`, French phrasing, e2e task ticked (blind, auditor) — cosmetic or speculative; fixes add machinery.
