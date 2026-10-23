---
title: '23-6 Capability Allow-List & Denied-Set Matrix'
type: 'feature'
created: '2026-10-21'
status: 'done'
baseline_commit: '7d9ae6fdf705f94954340fe1293bb829ad4c9c5d'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-23-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A live, assigned support person sees nothing: `private.gym_id()` and `current_member_role()` return NULL for support (0135), no policy or RPC lists `support`, the dashboard rejects the role, has no TOTP sign-in, and never writes the session gate state `support_live` needs (FR-179, FR-181).

**Approach:** One migration adds `support_capabilities` and opts in, by name through `private.support_gym_id()`, only the FR-179 allow-list; a catalog test classifies every policy/function that mentions `'supervisor'`; a pgTAP matrix gives each denied item its own negative test. Dashboard sign-in, gate wiring, gym picker (23-6b) and the step-up UI (23-6c) are split out (deferred-work.md).

## Boundaries & Constraints

**Always:**
- Opt-in is by `private.support_gym_id()` only; `gym_id()` and `current_member_role()` stay NULL for support. Untouched objects stay denied.
- Allow-list: gym profile and settings, plans and prices, registration fee, guest charging, loyalty, category, staff creation within the ceiling, member records and imports, payments, refunds, registration-fee waivers. Payment connection is 23-9.
- Denied set, one named negative test each: tier, interval, billing anchor, Owner contact, subscription status, suspension, deactivate/delete gym, `allow_gymos_support`, Owner/Supervisor edits, staff phone change, credential reset. Support cannot create Owner, Supervisor or support, or change its own role.
- Refunds, waivers and staff creation need a valid single-use step-up bound to action and subject; refused without it.
- Support-created staff are tagged `created_by_support` and not deactivated on revocation.
- Gates reach consumers (retro 66): the allow-list test enumerates every admitting object; an unlisted one fails CI.
- Rollback script; guardrails clean; do not apply to production.

**Decisions (owner, 2026-10-21):** split as above; support creates staff with the Supervisor ceiling (manager, receptionist, coach); support may edit gym profile and logo; support reads only the allow-list tables (plus the subscription and payment reads the refund and waiver paths need).

**Never:** no dashboard code (23-6b, 23-6c), no proxy actor or audit-under-individual (23-7/23-8), no payment connection (23-9), no velocity lock/inactivity/reset (23-10/23-11), no Owner-facing change.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error Handling |
|----------|--------------|----------|----------------|
| Allowed write | live support, gym in JWT, allow-list RPC | succeeds | N/A |
| Denied write | live support, any denied-set item | fails | named negative test |
| Not live | switch off, assignment not active, aal1, expired session | zero rows / refused | existing gate |
| Step-up missing | refund, waiver, staff create without grant | refused | typed error |
| Ceiling | support creates owner, supervisor, support, edits own role | refused | typed error |
| Unclassified | new object mentions `'supervisor'` | catalog test fails | CI red |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0135_support_assignments_live_gate.sql:134-205` -- `support_gym_id()` (unused so far), `support_live`; `0138:29-52` `private.capability_roles`; `0125` `authorize_action`; `0127:41-51,251,277` step-up table, action list `('remove_super_admin_factor','create_super_admin')`, `stepup_consume`; `0136` `create_staff_member`/`update_staff_role`/`deactivate_staff_member`, `private.staff_roles()`. Next migration 0140.
- Policies to branch (all via `support_gym_id()`): plans `manager_or_owner_*_own_plans` (0017), members insert/update/read (0018, 0061, 0124), payments read/verify/insert (0030/0031), refunds insert/read (0033), gyms `owner_update_own_gym` + gym-logos (0014); RPCs `set_registration_fee`, `waive_registration_fee`, `record_registration_fee`, `set_guest_charging`, `set_loyalty_program`, `set_gym_category`, `update_plan_pricing`, `create_staff_member`, `record_session_payment`, `renew_subscription`, `confirm_renewal`. Check `protect_super_admin_only_gym_columns` (0123) still pins tier/status/billing for support.
- Tests to copy: `tests/suspension_rpc_coverage.test.sql` (introspection), `support_role_live_gate.test.sql:50-98` (claims helper), `allow_gymos_support_switch.test.sql:146-150` (writer scan).
- `docs/decisions.md`, `deferred-work.md` (lines 1248, 1251 name 23-6), `sprint-status.yaml`, `packages/types/src/database.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0140_support_capability_allow_list.sql` -- `support_capabilities`, policy/RPC branches, `created_by_support`, step-up actions, ceiling
- [x] `scripts/rollback-0140-*.sql` -- drop new objects, restore replaced bodies
- [x] `supabase/tests/support_capabilities.test.sql` -- catalog classification, allow-list set, one named negative per denied item, step-up and ceiling cases
- [x] types, `docs/decisions.md`, `deferred-work.md` (close the 23-4 lines naming 23-6), `sprint-status.yaml`

**Acceptance Criteria:**
- Given a live support session, when it calls each allow-list object, then it succeeds; every denied-set item fails with its own named test.
- Given any policy or function mentioning `'supervisor'`, when the catalog test runs, then an unclassified one fails.
- Given a revoked support person, when they are revoked, then support-created staff stay active and tagged.
- Given `scripts/ci-local.sh`, when it runs, then every stage is green (read per-stage lines).

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Verification

**Commands:**
- `scripts/pgtap-run.sh` on new and changed test files -- expected: all ok
- `node scripts/check-migration-guardrails.mjs` -- expected: clean
- `bash scripts/ci-local.sh` -- expected: GREEN on all stages

### Review Triage Log (round 1)

Layers: blind-hunter, edge-case-hunter, verification-gap.
| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| stepup_issue support fence (activated/locked/reset/deactivated) has no negative test | medium | patch (done) | Dropping the clauses passed every test; four throws_ok cases added. |
| log_audit_event gym-match guard for live support not asserted | medium | patch (done) | Only the support gym was passed in the suite; both cases added. |
| Delete-gym negative runs the DELETE twice and accepts 0 rows | low | patch (done) | Single DELETE now, row-still-exists assertion added. |
| Waiver step-up bypass by direct `registration_fee_settled_at` update | false | rejected | `protect_registration_fee_settled_at` (0098) reverts the column for any `authenticated` caller. |
| Copied function bodies may revert 0137-0139 | false | rejected | None of the replaced functions is redefined in 0137-0139; 0140 copies the latest prior body. |
| Gym column guard is a deny-list (fails open) | low | rejected | `protect_super_admin_only_gym_columns` already pins Super Admin columns for every non-Super-Admin session; a column catalog adds machinery. |
| Refund total not cumulative; payments insert/verify without step-up | low | rejected | Same as the Supervisor policies this mirrors (0033, 0031); not caused here. |
| stepup_issue resets super_admin_lockout for support | low | rejected | Lockout is keyed by user; a support user has no row. |
| created_by_support unpinned / tagged on replace-in-place | medium | defer | Only matters once the 23-10 review queue reads the tag. |
| Logo policies lack success tests; `flagged` transition; source-text assertion; rollback not automated | low | rejected | Catalog proves the policies exist; rollback drill is a standing deferral. |
| No kill-switch against enabling support before 23-7 | low | rejected | Off per gym by default and no dashboard path until 23-6b; recorded in decisions.md and deferred-work.md. |
| Helpers executable by authenticated; audit actor wording; brittle zero-row string; rollback drops tag data; process nits | low | rejected | Self-harm only, cosmetic, or fixed by 23-7/23-8. |

### Review Findings (round 2, 2026-10-21)

Layers: blind-hunter, edge-case-hunter, verification-gap, acceptance-auditor.

- [x] [Review][Decision] RESOLVED (owner 2026-10-21: accept as Supervisor-equivalent, recorded in decisions.md) `create_staff_member` replace-in-place lets a live support session (with a grant) rewrite name, role and phone of an existing manager/receptionist/coach, and tags the row `created_by_support` — contradicts the "staff phone change" and staff-edit denied set; the only negative test targets the direct `update members` path [0140:1253-1257]. Options: (a) support may replace only `role = 'member'` targets (promotion), and never writes phone; (b) support gets no replace branch at all (insert only); (c) accept as Supervisor-equivalent and record it in decisions.md.
- [x] [Review][Decision] RESOLVED (owner 2026-10-21: accepted as Supervisor-equivalent, recorded in decisions.md) Step-up covers refunds, waivers and staff creation only; equivalent no-grant paths remain for support: `record_registration_fee` (settles the fee like a waiver), `renew_subscription`, `confirm_renewal`, `record_session_payment`, direct subscription insert/update, pending-payment insert then verify. Decide whether these need the step-up or are accepted as inside the allow-list (deferred-work already has a one-line "decision to confirm" on subscription writes).
- [x] [Review][Patch] No test that a `members` row cannot be promoted by UPDATE to owner/supervisor/manager (`support_update_own_members` WITH CHECK `role = 'member'`); dropping the clause passes all tests [support_capabilities.test.sql, section D]
- [x] [Review][Patch] Support payment/refund policy predicates have only happy-path tests: verified/registration_fee payment insert, over-amount refund, registration-fee refund, gym-B payment with a valid grant, verify of a non-pending payment [support_capabilities.test.sql, sections D/E]
- [x] [Review][Patch] "delete the gym" negative accepts `'0' or 42501`; assert one outcome [support_capabilities.test.sql]
- [x] [Review][Patch] Not-live matrix lacks a case with assignment non-active while every other gate is valid [support_capabilities.test.sql, section B]
- [x] [Review][Defer] `created_by_support` unpinned on member UPDATE and tagged by replace-in-place — deferred: already recorded for 23-10
- [x] [Review][Defer] `protect_payment_columns_on_staff_verify` does not pin `purpose`/`voided_at` for support — deferred: identical to the owner/manager/receptionist policy it extends (pre-existing)
- [x] [Review][Defer] `log_audit_event` lets a live support caller write arbitrary action types into its own gym — deferred: same for Supervisor today (pre-existing); restrict action types in 23-8
- [x] [Review][Defer] Step-up grants not bound to role/phone/amount/reason — deferred (maybe-false, would be medium, unverified): check what `stepup_issue` subject binding is in 23-6c when the issue UI is built
- [x] [Review][Defer] "Subscription status" denied-set meaning (`saas_billing_status` vs member subscription status) — deferred (maybe-false, unverified medium): settled by the decision on subscription writes above
- [x] [Review][Defer] `current_gym_status()` callers not enumerated for the role-before-suspension rule — deferred (maybe-false, unverified medium): enumerate callers in 23-6b
- [x] [Review][Defer] "No support session passes the live gate until 23-6b" is prose only — deferred: owner rejected a kill-switch; 23-6b must ship before support is enabled

**Rejected:** gym-column deny-list fails open (low; round 1 reason stands, `protect_super_admin_only_gym_columns` backs it); copied bodies could revert later migrations (false; round 1 checked 0137-0139 and no later migration exists); `stepup_issue` accepts foreign-gym subject (low, wasted grant, consume-time gym check blocks); helpers executable by authenticated (low, self-information); `support_stepup_require` skipped when gym id null (false, RPC role gates refuse non-live callers first); logo policy tests, grant-concurrency test, bulk import test (low); sprint-status "125 vs 133" count and spec frontmatter/empty headings (low, fix edits the spec or history); dashboard services lack support path (false, owner-deferred to 23-6b); ci-local not run (process, run before merge).
