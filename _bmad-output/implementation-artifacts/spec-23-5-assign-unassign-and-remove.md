---
title: '23-5 Assign, Unassign & Remove'
type: 'feature'
created: '2026-10-21'
status: 'done'
baseline_commit: 'cb33cb1b806ea7e66d5e3e998963050b0ce33333'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-23-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A support account exists (23-4) but cannot be put in a gym or taken out again: nothing writes `public.support_assignments` except the Owner switch (FR-177, FR-185, FR-193).

**Approach:** Migration 0139 adds Super Admin (AAL2, flag on) functions to assign, confirm a pending assignment, unassign, deactivate an account and remove a never-activated account, all under `private.support_gym_lock`, each with a mandatory reason and one audit row. The Super Admin "GymOS support" page and gym detail page show assignments; the individual's name is shown there only.

**Decisions (recorded by the planner, owner may veto at approval):**
- Assign returns a typed result. Refused: target is a Super Admin, no such account, account deactivated, email not assignable, gym not active, a non-ended assignment already exists, or the person has another membership or staff row in that gym (FR-091). Created `active` only when the account is activated and the gym's switch is on; otherwise `pending`.
- Confirm moves `pending` to `active` only on an explicit Super Admin call that re-checks every leg: activated, switch on, gym active, no other membership. Never automatic, including when enrollment completes or the Owner turns the switch on.
- Unassign ends one non-ended assignment (`ended_at` set) and calls `private.support_set_membership(id, false)`.
- Deactivate (activated or not) ends every non-ended assignment, sets a new `private.support_accounts.deactivated_at`, and refuses later assign, confirm and invite. The app then bans the auth user and revokes its sessions. Irreversible in this story.
- Remove is allowed only for an account that was never activated (the mistyped-address case): deletes its invites, `support_accounts` row and auth user. An activated account is deactivated, never deleted, so audit history keeps its target.
- Audit rows carry `gym_id` null (an Owner can read gym-scoped audit rows); the gym, assignment id and reason go in metadata. Actor is the real Super Admin.
- No step-up in this story (not in the acceptance criteria).

## Boundaries & Constraints

**Always:**
- Every function: Super Admin at AAL2 and `super_admin_aal2_required()` as in `create_support_account`; reason 3-500 characters; revoked from `public, anon`; typed refusal codes the app maps to EN/FR text; none reveal another person's data.
- Every function that changes an assignment takes `private.support_gym_lock(gym)` first (the Owner setter takes the same key); "active implies switch on" must hold after any interleaving.
- State rules enforced in the database: `ended` is terminal; `ended_at` is set iff `ended`; `activated_at` is set for `active` and `suspended`. A trigger refuses other transitions (23-1 deferral). Migration aborts if existing rows violate the new CHECK.
- Gates reach consumers (retro 66): a pgTAP scan lists every function that writes `support_assignments` and every writer of `support_accounts` (23-4's list plus deactivate and remove); an unlisted writer fails the test.
- Owner-facing surfaces gain nothing: `get_gymos_support_status` output is unchanged and no Owner role can call any new function.
- Rollback script `scripts/rollback-0139-*.sql`; guardrails clean; do not apply to production.

**Never:** no allow-list, proxy actor, lock/reset/inactivity flows (23-6..23-11); no change to `support_live`; no assignment of a Super Admin; no automatic activation.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error Handling |
|----------|--------------|----------|----------------|
| Assign, ready | activated account, switch on, no other membership | `active`, membership row, one audit row | N/A |
| Assign, not ready | account not activated or switch off | `pending`, no membership | N/A |
| Assign refused | Super Admin target, deactivated, existing open assignment, other membership, inactive gym | typed reason, nothing written | no audit row for the refused target data beyond one refusal row |
| Confirm | `pending`, all legs hold | `active` + membership | switch off or not activated: refused, stays `pending` |
| Race | assign and Owner switch change on one gym, concurrent | invariant holds either order | second waits on the lock |
| Unassign / deactivate | any open state, reason | `ended`, membership deactivated, next request denied | missing reason refused |
| Remove | never activated | account and auth user gone | activated: refused, use deactivate |
| Wrong caller | Owner, support, AAL1, flag off, anon | refused | permission error |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0135_support_assignments_live_gate.sql` -- `support_assignments`, `support_set_membership` (only membership writer), `support_live`; `0137_allow_gymos_support_switch.sql` -- `support_gym_lock`, setter loop to mirror; `0138_support_account_invite.sql` -- `create_support_account` (caller checks, audit via `log_audit_event`), `private.support_audit`, `get_support_accounts`, collision/membership checks. Next migration 0139.
- `supabase/tests/support_account_invite.test.sql`, `allow_gymos_support_switch.test.sql`, `support_role_live_gate.test.sql` -- fixtures, the existing writer scan to extend; the 23-1 test revives `ended` to `active` and must change. Concurrency: copy the two-session pattern of `scripts/super-admin-aal2.test.sh` for a real concurrent-transaction test.
- `apps/super-admin/app/(admin)/support/{actions.ts,page.tsx,components/SupportPageClient.tsx}` -- add actions (`authorizeOrRedirect("platform.support_manage")`, `createAdminClient` for ban, session revoke, auth user delete); `apps/super-admin/app/(admin)/gyms/[id]/page.tsx` -- assignments panel; `locales/en.json`, `fr.json`; `actions.test.ts`, `server-actions.denied.test.ts`, `*.authz.test.ts`.
- `packages/types/src/database.ts`, `docs/decisions.md`, `deferred-work.md`, `sprint-status.yaml`.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0139_support_assign_unassign_remove.sql` -- `deactivated_at`, state CHECK and transition trigger, `assign_support`, `confirm_support_assignment`, `unassign_support`, `deactivate_support_account`, `remove_support_account`, `get_support_assignments` (Super Admin only), revokes
- [x] `scripts/rollback-0139-support-assign-unassign-remove.sql` -- drop new objects
- [x] `supabase/tests/support_assignments.test.sql` + concurrency script -- matrix rows, each refusal, each caller denied, membership removed on end, writer scan, lock race, ACLs
- [x] `apps/super-admin` support page, gym detail panel, actions, locales, authz and denied-action tests
- [ ] types, `docs/decisions.md`, `deferred-work.md` (close the 23-1, 23-3 and 23-4 lines this story owns), `sprint-status.yaml`

**Acceptance Criteria:**
- Given a pending assignment, when enrollment completes and the switch is on, then it stays `pending` until a Super Admin confirms.
- Given the switch is off, when a Super Admin confirms a pending assignment, then it is refused.
- Given unassign, remove or deactivate commits, when the person's next request arrives, then the live gate denies, the support membership is deactivated, and one audit row holds actor, target, reason and no gym-scoped visibility to the Owner.
- Given a Super Admin session or a Super Admin person, when assignment is attempted, then it is refused.
- Given a Super Admin views a gym or a person, then assignments and states show with the individual's name; no Owner endpoint returns it.
- Given `scripts/ci-local.sh`, when it runs, then every stage is green (read per-stage lines).

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Review Triage Log (round 1)

Layers: blind-hunter, edge-case-hunter, verification-gap.
| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| Race script not in ci-local.sh / ci.yml | medium | patch (done) | Neighbouring race scripts are wired; added to both. |
| `admin.signOut(userId)` takes a JWT, error swallowed (no-op) | low | patch (done) | Sessions already ended by `end_user_sessions` and the ban; call removed. |
| Deactivated never-activated account has no Remove in UI | medium | patch (done) | SupportPageClient hid Remove when deactivated; now shown for any non-activated account. |
| `ban_failed` / retry untested | low | patch (done) | Unit test added. |
| Real GoTrue check that a banned user cannot sign in | low | defer | Live gate already denies once assignments end. |
| Rollback 0139 has no automated round trip | low | defer | Same class as the 23-1..23-3 rollback deferrals. |
| Lock-order inversion deactivate vs assign | low | false/rejected | Deadlock detector aborts one side loudly; the window needs a commit between two reads. |
| activate_support_account ignores deactivated_at | false | rejected | It calls `support_invite_check`, which now refuses a deactivated account; deactivate also supersedes invites. |
| Remove FK failure on other referencing rows | false | rejected | A never-activated account never has an active assignment or support membership; pgTAP removal passes. |
| Refusal audit rows inconsistent; not_found races; NULL target audit; ended row facts editable; reason box shared/not cleared; no confirm on unassign/confirm; 500-row limits; reason bounds in three places; typing casts; magic ban duration; race-script flakiness; 23-1 test disables trigger; gym page fatal on support error; NOT VALID | low | rejected | Fail loud, admin-only, rare or cosmetic; fixes add machinery. Gym page: capability is Super Admin only. |

## Verification

**Commands:**
- `scripts/pgtap-run.sh` on the new and changed test files -- expected: all ok
- `node scripts/check-migration-guardrails.mjs` -- expected: clean
- `bash scripts/ci-local.sh` -- expected: GREEN on all stages
