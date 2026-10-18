---
title: 'Live authorization in the database'
type: 'feature'
created: '2026-10-15'
status: 'done'
baseline_commit: '74fd5925df2bd5a91b816ee2f4d4fb3a93148d7a'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-22-context.md'
  - '{project-root}/scripts/claim-inventory.baseline.json'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A deactivated or demoted staff member keeps access until their token expires: 59 policies and functions gate on the `app_role` token claim, `private.gym_id()` and `private.is_super_admin()` trust the claim alone, and a payment can reference a member of another gym.

**Approach:** One migration (0124, next free) with a rollback script. `private.gym_id()` returns the claimed gym only while a live, non-deactivated membership exists; `private.is_super_admin()` also requires the live `users.is_super_admin` flag; every direct `app_role` claim gate becomes `private.current_member_role()` in a null-safe form; the three null-unsafe functions and the payment trigger are fixed; payments reject a member of another gym. The claim-inventory baseline is regenerated.

## Boundaries & Constraints

**Always:** Helpers stay `STABLE`; role gates use `(select private.current_member_role())` so Postgres evaluates it once per query; role comparisons are null-safe (`is distinct from`, or `coalesce(... , false)` with an explicit deny); the claims hook, Super Admin escalation path and `gym_id` claim derivation (AD-3) are unchanged; suspension stays enforced by the existing `tenant_active_gate` and RPC guards, proven live by tests; the migration SQL is generated from the live definitions, committed explicitly, and proven in a rolled-back transaction on the local DB first; rollback script `scripts/rollback-0124-*.sql` restores the previous definitions.

**Never:** No `session_id` / `auth.sessions` check here (decided by the product owner 2026-10-15: it lands in 22.7 with session limits, so 22.3 stays about membership state and the 143 pgTAP fixtures are not reworked), no support role (Epic 23), no edge or server code (22.4), no new role names. Amended by the product owner 2026-10-15: policies that already use the live helpers may be rewritten only to wrap the helper call as `(select ...)` (InitPlan, once per query), proven identical after unwrapping.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Deactivated after token | staff token with old `gym_id`/`app_role`, member row `deactivated_at` set | `gym_id()` and `current_member_role()` NULL; read policy returns 0 rows, write RPC raises | per role: receptionist, coach, manager, supervisor, owner |
| Role changed | token says `manager`, member row now `receptionist` | gates use `receptionist` immediately | N/A |
| Suspended gym | active session of a suspended gym | denied by existing gate: one policy, one RPC | N/A |
| NULL role | caller with no membership row | each rewritten function denies | assert denial per function |
| Cross-gym payment | `payments.gym_id` differs from the member's `gym_id`, any role | insert refused | raises check/trigger error |
| Super Admin | claim `super_admin` and live flag true | behaves as before; flag false: denied | N/A |
| Member | member token, own rows | unchanged | N/A |

</frozen-after-approval>

## Code Map

- `private.gym_id()` (0009), `private.current_member_role()` (0061), `private.is_super_admin()`, `private.is_super_admin_live()` (exists, definer, `users.is_super_admin` by `auth.uid()`), `private.current_gym_status()` -- the helpers; `idx_members_active_gym_user (gym_id,user_id) where deactivated_at is null` already supports the lookup.
- 59 mixed entries from `node scripts/claim-inventory.mjs`, all `auth.jwt() ->> 'app_role'` role gates: Group A 35 policies (mechanical, enum vs text cast, wrap in `(select …)`); Group B 17 functions with `if not (claim = …)` which fails OPEN on NULL (rewrite to `is distinct from` / `coalesce`); Group C 5 `coalesce(claim = any(...), false)` registration-fee functions; Group D 2 `is distinct from 'owner'` credential functions.
- `private.protect_payment_columns_on_staff_verify()` -- trigger reading `app_role` claim; use the live role.
- null-unsafe: `public.create_staff_member`, `public.update_staff_role`, `private.guest_sessions_period` -- `not in (...)` over a nullable role.
- `public.payments` -- no FK or check ties `member_id` to `gym_id`; local data has 0 mismatches. Use a BEFORE INSERT/UPDATE trigger (covers service role and definer RPCs, avoids validating prod history).
- `scripts/rollback-0123-gym-category.sql`, `supabase/tests/*.test.sql` (143 files) -- rollback and pgTAP style; `scripts/claim-inventory.baseline.json`, `scripts/check:claims`.

## Tasks & Acceptance

**Execution:**
- [x] `scripts/generate-0124.mjs` or scratch generator -- build the explicit rewritten definitions from the live DB (policies via `alter policy`, functions via full `create or replace`), review diff, then commit only the SQL
- [x] `supabase/migrations/0124_live_authorization_database.sql` -- helpers, policy and function rewrites, trigger fix, payment gym guard; revoke from `public`/`anon` for new functions
- [x] `scripts/rollback-0124-live-authorization-database.sql` -- restore prior definitions
- [x] `supabase/tests/live_authorization_*.test.sql` -- per role (receptionist, coach, manager, supervisor, owner) one read policy and one write RPC after deactivation and role change; suspended gym; NULL-role per rewritten function; cross-gym payment; Super Admin live flag
- [x] existing pgTAP files -- adjust fixtures only where a forged claim lacks a membership row
- [x] `scripts/claim-inventory.baseline.json`, `docs/decisions.md`, `sprint-status.yaml` -- regenerate (claim-only database entries none, null-unsafe none), record counts and the performance check
- [x] `packages/types/src/database.ts` -- regenerate only if signatures changed

**Acceptance Criteria:**
- Given a deactivated or role-changed staff token, when the next request reaches a policy or RPC, then it is refused or sees the new role, for all five roles.
- Given the new baseline, when `pnpm run check:claims` runs, then no database `claim-only`, `null-unsafe` or `mixed` entry remains.
- Given the Overview and check-in queries on a seeded gym, when timed before and after, then there is no regression beyond the existing targets (record `EXPLAIN ANALYZE` numbers).
- Given `scripts/ci-local.sh` and the RLS cross-tenant matrix, when run, then both pass.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| Layer | Finding | Verdict | Evidence / route |
|---|---|---|---|
| gap, edge, blind | 13-14 suspension assertions loosened to `%` | high | patched: messages pinned, status guard case added |
| gap, blind | log_audit_event NULL-gym fix not tested | high | patched: assertion added; call-site audit done |
| gap, blind | zz_denied regex too broad | medium | patched |
| gap | storage policy, payment trigger, gym_id update, multi-gym untested | medium | patched: cases added |
| edge | 71 extra policy rewrites breach frozen Never | high | owner accepted; equivalence proven (71 identical after unwrapping); spec Never amended |
| blind | perf claim vs numbers, AC wanted EXPLAIN ANALYZE | medium | patched in decisions |
| blind | counts inconsistent | low | patched |
| blind | LIVE_HELPERS trusted by name | low | pgTAP pins helper behaviour; regex test added |
| blind, edge | interim UI vs DB disagreement; error message change | low | documented |
| edge | payment trigger skips supervisor and NULL role | low | pre-existing; deferred-work.md |
| edge | NULL member_id breaks trigger | false | payments.member_id is NOT NULL |
| edge | anon permission denied for function | false | anon has no table grants; error unchanged |
| edge | is_super_admin_live NULL skips check | false | function coalesces to false |
| blind | rollback script not in diff | false | file exists, untracked at review time, proven in rolled-back txn |
| blind | search_path hardening, history not validated | low | style matches existing helpers; history deferred |

## Design Notes

`private.gym_id()` stays `STABLE`, becomes `SECURITY DEFINER` (members RLS calls it, so a plain lookup would recurse) with `search_path = public`: parse the claim as today, then `select m.gym_id from members m where m.user_id = auth.uid() and m.gym_id = claim and m.deactivated_at is null`, else NULL. Suspension is deliberately not folded in: it is already live through `current_gym_status()` and folding it in would also block an Owner from reaching billing to resolve a suspension.

## Verification

**Commands:**
- `supabase db reset` then `bash scripts/pgtap-run.sh` -- expected: all pass
- `pnpm run check:claims` -- expected: exit 0, database entries clear
- `bash scripts/ci-local.sh` -- expected: GREEN
