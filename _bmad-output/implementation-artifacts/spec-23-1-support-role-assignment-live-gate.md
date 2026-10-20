---
title: '23-1 support role, assignment record and live gate'
type: 'feature'
created: '2026-10-20'
status: 'done'
baseline_commit: 'cfb8d32d3c13c28bfcbee6c18f82841fef200cb8'
route: 'dispatch'
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-23-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** GymOS support staff need a role that reaches no gym until a Super Admin assigns it, and that is re-checked live on every request. Today no `support` role, assignment record, Owner switch column or support branch in the live helpers exists (FR-178, FR-194, FR-177 data half; AD-33/34).

**Approach:** Two migrations (enum value in its own file, then tables, column, trigger, helper changes), pgTAP proof, and the minimal TypeScript type/label update. Support stays denied everywhere until 23.6 opts capabilities in; the Owner switch is off for every existing gym and nothing can change it until 23.3.

**Decision (owner, 2026-10-20, review loopback):** 41 existing migrations have policies of the form `gym_id = private.gym_id()` with no role check, so a live support user whose `gym_id()` resolves would read plans, classes and more before 23.6. Therefore `private.gym_id()` and `private.current_member_role()` return NULL for support rows in 23.1 (support is not resolved by any existing policy or RPC). A new `private.support_gym_id()` returns the live gym for a support user when `support_live` holds; 23.6 opts each capability in by name. This deviates from the epic AC wording (helpers return `support`/the gym) on purpose.

## Boundaries & Constraints

**Always:**
- `support` added to `member_role` in its own migration (precedent 0060); no existing policy, function or CHECK lists it.
- `support_assignments(id, support_user_id, gym_id, state pending|active|suspended|ended, reason, created_by, created_at, activated_at, ended_at, updated_at)`: RLS on, no client policy, partial unique index on (support_user_id, gym_id) where state <> 'ended', grants revoked from anon/authenticated.
- `gyms.allow_gymos_support boolean NOT NULL`: existing rows false, default true afterwards; a before-update trigger refuses any change unless the transaction GUC `gymos.allow_support_setter = 'on'` (23.3's setter sets it).
- `private.support_accounts(user_id pk, activated_at, locked_at, reset_pending_at)` holds the "activated / unlocked / no reset pending" facts (nothing writes it until 23.4/23.10/23.11; absent or null activated_at = not live).
- One `SECURITY DEFINER` function is the only writer of a `members` row with `role = 'support'` (it sets the GUC `gymos.support_membership_writer`); a constraint trigger on `members` refuses any such active row unless the assignment is `active` AND the gym's switch is on.
- Live gate `private.support_live(user, gym)`, STABLE: assignment active, switch on, gym status active, account activated/unlocked/no reset pending, JWT `aal` = `aal2` (always, independent of the `super_admin_aal2` flag), session in `auth.sessions` (`jwt_session_alive`), a `support_session_state` row inside `idle_minutes` and `absolute_session_minutes`. Fail closed. `private.gym_id()` and `private.current_member_role()` return NULL for support rows (see Decision); `private.support_gym_id()` returns the live gym only when `support_live` holds. Other roles' behavior is unchanged.
- The claims hook emits `gym_id`/`app_role='support'` only for an active assignment at `aal2`; `switch_active_gym` and `list_own_active_gym_memberships` accept/list a support row only for an active assignment. A request acts on one gym.
- `session_gate_touch` applies its idle/absolute limits to users with a non-ended support assignment as well as Super Admins.
- Every new function: `revoke ... from public, anon`; a `scripts/rollback-NNNN-*.sql` for each migration; guardrails and claim inventory clean (no new `claim-only`).

**Never:** no support UI, no setter/assign/create flows (23.3-23.5), no capability opt-in (23.6), no proxy actor (23.7), no counts/caps exclusion (23.2); do not add `support` to staff zod schemas; do not apply migrations to production; do not touch existing policies' role lists.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error Handling |
|----------|--------------|----------|----------------|
| Live support | active assignment, switch on, aal2, fresh session state, activated | `support_gym_id()` = gym; `gym_id()` and `current_member_role()` NULL; every tenant table with seeded rows returns 0 rows | N/A |
| Any gate leg fails | pending/suspended/ended, switch off, gym suspended, aal1, no/expired state, locked, reset pending, unactivated | NULL role and gym | N/A |
| Direct membership insert | role support without active assignment or switch off | refused by constraint trigger | exception |
| Existing gym | live gym row at migration time | `allow_gymos_support` false; direct UPDATE refused without GUC | exception |
| Two active assignments | support user, two gyms | `switch_active_gym` works for each; non-assigned gym refused | exception |
| Hook | pending/suspended/ended or aal1 | no `gym_id`/`app_role` claim | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0060_*` -- precedent for `ADD VALUE` in own file; next free numbers are 0134 (enum) and 0135.
- `0061:31` `private.current_member_role`; `0124:32` `private.gym_id` (live helpers to extend; keep signatures).
- `0129:15` `custom_access_token_hook` (non-super branch picks `preferred_gym_id`/newest member row; `session_aal` already read; keep the fail-closed handler); `0065:34` `switch_active_gym`; `0074:18` `list_own_active_gym_memberships`.
- `0127` `session_limits_config`/`session_limit()`, `jwt_session_alive()`, `support_session_state`; `0133:13` `session_gate_touch` (short-circuits for non-Super-Admins; add the support branch).
- `0130:65` `guard_owner_not_super_admin` -- template for the members trigger; `0003:39`/`0089` partial unique index on members.
- `private.current_gym_status()` (0063:19) for the suspended check.
- `scripts/claim-inventory.mjs` (`LIVE_HELPERS`), `scripts/check-migration-guardrails.mjs` (revoke rule), `scripts/rollback-0133*` for rollback style.
- Tests: copy `supabase/tests/session_limits_step_up.test.sql`, `owner_never_super_admin.test.sql`, `multi_gym_session_switching.test.sql`, `auth_hook_deny_all.test.sql`.
- TS: `packages/types/src/database.ts:2724` (regenerate), `apps/dashboard/services/session.ts:37` `MemberRole`, `TopBar.tsx:11` and `GymSwitcher.tsx:17` `ROLE_LABEL_KEY` (exhaustive; add `role.support` = "GymOS Support" EN/FR, i18n parity). Not `staff.ts` zod.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0134_member_role_support.sql` + rollback note -- add enum value only
- [x] `supabase/migrations/0135_support_assignments_live_gate.sql` -- tables, column + guard trigger, writer function, members constraint trigger, `support_live`, `session_gate_touch` support branch, `gym_id`/`current_member_role`/hook/`switch_active_gym`/list changes, revokes; plus `scripts/rollback-0135-*.sql` (and for 0134 as precedent allows)
- [x] `supabase/tests/support_role_live_gate.test.sql` -- every matrix row; one assertion per gate leg; catalog test that no policy/function/CHECK (other than the listed new ones) mentions `'support'`; zero-row proof over every tenant table (loop over tables with `gym_id`) for a fully live support user; consumer enumeration test: the set of functions calling `support_live` equals the expected list (fails when a new consumer skips it, retro 66); backfill false for pre-existing gyms; mutation check that removing one gate leg fails a test
- [x] `packages/types`, `apps/dashboard` -- type regen, `MemberRole`, role labels + i18n en/fr
- [x] `scripts/migration-guardrails.grandfather.json` / `claim-inventory` -- only if a check needs it, with reason
- [x] `_bmad-output/implementation-artifacts/epic-23-context.md` -- add under 23.6 dependencies: wire `session_gate_touch` into the dashboard request path for support users (no support session can pass the gate without a state row until then); and a note that 23.4/23.10/23.11 write `private.support_accounts`

**Acceptance Criteria:**
- Given the epic's 23.1 ACs, when `scripts/ci-local.sh` runs, then it is green with no new `claim-only` inventory entry and the zero-rows proof passes.
- Given each gate leg removed in turn (mutation), when pgTAP runs, then a named test fails.

## Implementation Notes

- Loopback 1 re-derivation: `gym_id()` and `current_member_role()` exclude support rows (NULL); `private.support_gym_id()` is the only helper that resolves a live support gym (sole consumer of `private.support_live`). Reused the saved first attempt for everything else.
- Review fixes applied: `session_gate_touch` checks the Super Admin lock and the support lock independently for a dual-role user and writes a `support_session_expired` audit row for support; the members constraint trigger refuses moving or re-roling an active support row outside the writer; `support_set_membership` raises a clear error when the user already has a non-support membership in the gym.
- Tests (`support_role_live_gate.test.sql`, 88 assertions): hook preferred-gym fall-through, absolute expiry through `session_gate_touch` (with audit row), dual-role locks, zero-row proof over every readable `gym_id` table with rows seeded in 10 of them (owner walk asserted non-vacuous; unreadable tables pinned to an explicit list; `insufficient_privilege` is reported, not skipped).
- Per-leg mutation run (each leg of `support_live` neutralised in turn, pgTAP re-run): assignment active (4 fail), owner switch, gym status, activated, locked, reset pending, aal2, session alive, absolute, idle (2 fail) each fail a named test. Turning the `support_accounts` / `support_session_state` inner joins into left joins fails nothing (equivalent: the legs on their columns still deny).

## Spec Change Log

## Review Triage Log

Round 1 (first attempt): one intent_gap, resolved by the owner (Loopback 1).
| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| gym-only policies admit a live support user; zero-row proof vacuous (verification gap) | high | intent_gap | `0017` `gym_staff_read_own_plans` uses `gym_id = private.gym_id()` with no role; fixture tables were empty. Fixed by `support_gym_id()`; proof now seeds 10 tables. |
| Dual-role lock skipped; no support expiry audit; role change away from support unguarded; clear error for existing non-support membership; hook preferred-gym test; absolute expiry test (edge-case, gap) | medium | patch (folded into loopback) | Applied in the re-derivation, each with a test. |
| Rollback scripts untested (gap, blind) | medium | defer | deferred-work.md entry. |
| GUC guards settable by any SQL-capable role (gap, edge) | low | defer | Recorded as accepted in docs/decisions.md; matches the spec. |

Round 2 (after the fix):
| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| No test that dashboard rejects a `support` claim (gap) | medium | patch | Test added to `session.getDashboardShellContext.test.ts`; adding `support` to `STAFF_ROLES` makes it fail. |
| sprint-status cites 74/74 (blind, edge) | low | patch | Updated to 88/88 with the loopback. |
| Deviation from epic AC and owner decision unrecorded (blind) | medium | patch | docs/decisions.md entry and epic-23-context note for 23.6. |
| Hook emits claim for non-live support; switch/list ignore Owner switch (blind, edge) | low | false | Spec-mandated (active assignment at aal2); no helper resolves a support claim, claim inventory shows 0 claim-only. |
| anon revoke on gym_id()/current_member_role() is a new behavior change (blind) | false | false | 0124:2778 already revokes execute from public, anon. |
| audit_log CHECK may reject `support_session_expired` (edge) | false | false | The expiry test asserts the audit row and passes. |
| Silent NULL on deactivate with no row; no-op update on a support row raises; INSERT into gyms bypasses the switch trigger; un-deactivate and mixed-row hook tests (edge, gap) | low | rejected | Unlikely in use; a fix adds guards beyond a direct correction. |
| Members row lingers when assignment ends; support counts as staff (blind, edge) | low | rejected | Stated in 23.3 and 23.2 acceptance criteria; recorded as known in decisions.md. |
| Seven gym-scoped tables unseeded in the zero-row proof | low | rejected | Policies using gym_id()/role deny NULL structurally; the proof covers 10 seeded tables. |

## Verification

**Commands:**
- `scripts/pgtap-run.sh supabase/tests/support_role_live_gate.test.sql` -- expected: all ok
- `scripts/ci-local.sh` -- expected: GREEN, read per-stage lines
- `node scripts/check-migration-guardrails.mjs` -- expected: clean

### Loopback 1 (2026-10-20) — intent_gap resolved by the owner

- Trigger: verification-gap review (confirmed against `0017` `gym_staff_read_own_plans`, same shape in 0057 and 41 migrations): `gym_id()` resolving for support lets gym-only policies admit a live support user; the zero-row test passed only because fixture tables were empty.
- Amended: frozen Intent (Decision), live-gate bullet, matrix row. Known-bad state avoided: any existing policy/RPC resolving a support user.
- KEEP from the first attempt (saved at the scratchpad `23-1-first-attempt.patch` and `first-attempt/` dir): the migration structure, `support_set_membership` writer + constraint trigger, `support_accounts`, `guard_allow_gymos_support`, hook/switch/list filters, `session_gate_touch` support branch, TS/i18n changes, `suspension_rpc_coverage` exclusions, rollback scripts, the pgTAP skeleton.
- Also fix in the re-derivation (patch-class review findings): `session_gate_touch` must check the Super Admin lock AND the support lock for a dual-role user, and write a `support_session_expired` audit row for support; the members trigger must also refuse changing an active support row's role away from support outside the writer; `support_set_membership` raises a clear error when the user already has a non-support membership in the gym; the hook preferred-gym branch gets a test with `active_gym_id` set to a non-live support gym; absolute expiry through `session_gate_touch` gets a test; the zero-row proof seeds a row in every gym-scoped table (or asserts the owner walk sees rows in exactly the tables the support walk checks) and fails rather than skips on `insufficient_privilege`; `plan()` uses `no_plan`-safe counts; record the per-leg mutation run in Implementation Notes. The local DB already has the first attempt's 0134/0135 applied: apply `rollback-0135` (from the saved copy) or reset the local DB before applying the new migrations.

### Review Findings

Code review 2026-10-20 (blind-hunter, edge-case-hunter, verification-gap, acceptance-auditor) of the staged 23-1 diff.

- [x] [Review][Decision] RESOLVED 2026-10-20 (owner chose to leave as is: support accounts are dedicated to GymOS staff, no dual-role users expected; rejected). Claims hook can pick the support row over a dual-role user's ordinary membership — a user with an owner/staff row in gym A and an active support assignment at aal2 in gym B gets `app_role='support'` when B is the preferred or newest row, and `gym_id()` is NULL for it, so they lose their own gym until they switch (blind-hunter, edge-case-hunter, acceptance-auditor; low-medium). Options: order non-support rows first in the fallback select, or leave as is because support accounts are dedicated. The loopback triage rejected only the extra hook *test*.
- [x] [Review][Patch] `support_gym_id()` binding to the JWT `gym_id` claim is untested [supabase/tests/support_role_live_gate.test.sql] — add four assertions while both assignments are live: claim Gym Two gives Gym Two; no claim gives NULL; non-UUID claim gives NULL; claim Gym Three (pending, no support row) gives NULL; bump `plan(88)` to `plan(92)`. Dropping the `m.gym_id = <claim>` clause currently leaves every test green (verification-gap, acceptance-auditor; medium).
- [x] [Review][Patch] Consumer enumeration covers only `support_live` callers [supabase/tests/support_role_live_gate.test.sql:376] — add a catalog scan that fails when a new policy or function reads `support_assignments`, `support_accounts` or calls `support_gym_id()` outside the known list (acceptance-auditor; low-medium; Epic 22 retro 66).
- [x] [Review][Patch] `support_assignments` types missing from `packages/types/src/database.ts` — the diff adds only the enum value and `allow_gymos_support`; regenerate so the Row/Insert/Update block exists (acceptance-auditor; low).
- [x] [Review][Patch] 23-1 deferral sits under the 22-7 heading in `deferred-work.md` — give it its own `Deferred from: code review of spec-23-1...` heading (acceptance-auditor; low).
- [x] [Review][Defer] Assignment lifecycle is ungoverned: no CHECK tying `activated_at`/`ended_at` to `state`, no `updated_at` trigger, the test itself revives `ended` -> `active` [0135 support_assignments] — deferred: 23.3/23.5 own the transitions; add the constraints there.
- [x] [Review][Defer] Invariant "active support membership implies active assignment and switch on" holds only on `members` writes; suspending an assignment or flipping the switch leaves the row active (every consumer checks live) [0135 guard_support_membership] — deferred: 23.3 and 23.5 must call `support_set_membership(.., false)`; carry that into their acceptance criteria (Epic 22 retro 67).
- [x] [Review][Defer] Rollback scripts for 0134/0135 are hand-copied bodies, FK failure on `delete from members where role='support'` untested — deferred: already in deferred-work.md (rollback round trip before the Epic 23 production deploy).

#### Rejected

- Support limits apply to pending/suspended assignees and dual-role users (edge-case-hunter, blind-hunter) — false: the frozen spec says "non-ended support assignment", and the dual-lock comment is intended.
- Unactivated account passes the lock leg in `session_gate_touch` — false: `support_live` requires `activated_at`, so nothing is admitted; the state row is harmless.
- Writer GUC may stay on after a caught exception — false: `set_config(.., true)` is transaction-local and reverts when the subtransaction aborts.
- `support_set_membership(.., false)` returns NULL when nothing to deactivate — false: harmless no-op for the 23.3/23.5 callers.
- `switch_active_gym`/list don't check the Owner switch — false: spec says "active assignment" only; `support_gym_id` enforces the switch live.
- `allow_gymos_support` settable at INSERT or via GUC by SQL-capable sessions — false: spec default-true for new gyms; only service_role/migrations reach it.
- New gyms default the switch to true before consent — false: stated in the spec and covered by the Owner notice (23.0).
- Seven gym-scoped tables unseeded in the zero-row proof — low: already triaged in the loopback; gym-only policies deny NULL structurally.
- Mutation check not committed, plan(88) hard-coded, backfill verified only at apply, extra `exists` read in `session_gate_touch`, 0134 rollback is `select 1` (enum values cannot be dropped), spec `done` vs sprint `review` — low: not worth the added machinery.
- Super Admin with flag off plus a support assignment gets the lock/limits — low: speculative dual-role case, intended "locked by either lock".
- No UI test for a support-only session; other `member_role` consumers unaudited — low/false: `getDashboardShellContext` rejection is tested; `staff.ts` zod deliberately untouched; manual QA covers the UI.
- Raw JWT-claim consumers outside the helpers would admit support — false: claim inventory reports 0 claim-only.
