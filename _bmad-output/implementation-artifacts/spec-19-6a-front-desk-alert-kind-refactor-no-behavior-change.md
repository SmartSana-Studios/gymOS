---
title: '19-6a Front-desk alert kind refactor (no behavior change)'
type: 'refactor'
created: '2026-10-11'
status: 'done'
baseline_commit: '2596e0a5b1254303503599c7ab1b7d52eaf1f4fc'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-19-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `front_desk_alerts` can only hold subscription-status alerts: `status` is NOT NULL under a three-value CHECK, and the one-active index and every `ON CONFLICT` clause key on `(member_id, status)`. Epic 19.6b needs a second alert kind (`session_required`) with no status, and that change must be proven on live gyms first.

**Approach:** Migration 0110 adds `kind`, makes `status` nullable under a kind-aware CHECK, swaps the one-active index, rewrites the live `ON CONFLICT` clauses in `check_in()` and `mark_class_attendance()`, and pins `kind` in the column-protect trigger. Nothing writes `session_required`; every alert behaves exactly as before.

## Boundaries & Constraints

**Always:** Index swap, clause rewrites and trigger change are one migration, one transaction. The new unique index is created before the old one is dropped. Existing rows backfill `kind = 'subscription_status'`. The two function rewrites change only the `ON CONFLICT` target (plus the comment naming the index); signatures, return types, ACLs, bodies otherwise byte-identical to 0090. The migration header states the clause count found by grep at build time. `do $verify$` self-check at the end (no active duplicates, no null `status` under `subscription_status`, old index gone, new index present). Types spliced by hand into `packages/types/src/database.ts` (decisions.md).

**Never:** No code path writes `kind = 'session_required'`. No client, dashboard, mobile, Realtime-publication or RLS change. No edit to historical migrations 0034/0068/0090. No other V1.6 migration. No change to dismissal, dedupe or alert-count behavior.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Expired scan, repeat | `check_in()` twice, member expired | one active alert, `kind = 'subscription_status'` | N/A |
| At-risk scan | `check_in()` expiring_soon / grace_period | one active alert of that status, deduped | N/A |
| Class attendance on expired member | `mark_class_attendance()` rejection branch | one deduped `expired` alert, returns null | N/A |
| Dismiss then rescan | alert dismissed, member scans again | a new active alert is inserted | N/A |
| Existing rows | alerts present before 0110 | `kind` backfilled, `status` unchanged, non-null | N/A |
| Kind/status mismatch | insert `kind='session_required'` with a status, or `subscription_status` with null status | rejected | CHECK violation |
| Protect trigger | UPDATE of `kind` by an authenticated staff caller | rejected | `only dismissed_at/dismissed_by may be updated` |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0034_real_time_front_desk_alert.sql:11-90` -- table, CHECK, `idx_front_desk_alerts_one_active_per_member_status`, `front_desk_alerts_protect_columns()` (plain, not definer; the only definition)
- `supabase/migrations/0090_suspension_enforcement_in_rpcs.sql:412-627` -- live `check_in()` (clauses at :516, :598); `:1272-~1356` live `mark_class_attendance()` (clause :1334). 0034:210/:292 and 0068:109 are superseded bodies, not edited. No later migration redefines either function.
- `supabase/tests/real_time_front_desk_alert.test.sql`, `class_attendance_marking.test.sql`, `tenant_suspension_enforcement.test.sql`, `rls_tenant_isolation.test.sql`, `suspension_rpc_coverage.test.sql` -- existing suites that must pass unchanged
- `supabase/migrations/0104_align_function_privileges.sql` -- ACLs `create or replace` preserves; do not re-grant
- `scripts/check-migration-guardrails.mjs`, `scripts/pgtap-run.sh`, `scripts/ci-local.sh` -- guardrail lint, pgTAP runner, the gate
- `packages/types/src/database.ts:359` -- `front_desk_alerts` Row/Insert/Update: add `kind`, `status` nullable
- `apps/dashboard/services/frontDeskAlerts.ts`, `apps/dashboard/lib/realtime/frontDeskAlerts.ts` -- read `status` through a local `FrontDeskAlertStatus`; verify typecheck only, no edit
- `docs/decisions.md:117-141` -- V1.6 release runbook entry; add 0110 swap method, lock time, rollback

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0110_front_desk_alert_kind.sql` -- add `kind`, nullable `status`, replace CHECK, `create unique index … (member_id, kind, status) nulls not distinct where dismissed_at is null`, drop old index, `create or replace` `check_in()` and `mark_class_attendance()` from the live `pg_get_functiondef` with the clause rewritten to `(member_id, kind, status)`, replace the protect trigger function with `kind` pinned, `$verify$` block
- [x] `supabase/tests/front_desk_alert_kind.test.sql` + `.negative.test.sql` -- one assertion per matrix row, exercising each rewritten `ON CONFLICT` site (both `check_in()` branches, `mark_class_attendance()`), plus dedupe after dismiss, CHECK both ways, trigger pin
- [x] `scripts/rollback-0110-front-desk-alert-kind.sql` -- forward-fix restoring old index, clauses and trigger; rehearsed on the local DB in a rolled-back transaction
- [x] `packages/types/src/database.ts` -- splice `kind` and nullable `status`
- [x] `docs/decisions.md` -- extend the 0110 runbook row: swap order, lock time, rollback file, `nulls not distinct` decision

**Acceptance Criteria:**
- Given 0110 applied, when the existing alert, attendance, suspension and tenant-isolation pgTAP suites run, then all pass unchanged.
- Given `scripts/ci-local.sh`, then every stage passes, including `pnpm run typecheck`.
- Given 0110 applied on the local DB, when the rollback script runs inside a rolled-back transaction, then the schema matches the 0109 shape (old index, NOT NULL `status`, no `kind`) and `check_in()` still dedupes.

## Implementation Notes

- Guardrail: the unchanged live bodies contain `auth.jwt() ->> 'app_role'`, so `0110_front_desk_alert_kind.sql` was added to `app_role_reads` in `scripts/migration-guardrails.grandfather.json` and the cap in `scripts/__tests__/migration-guardrails.test.mjs` raised 52 -> 53 (outside the spec file list; the alternative was editing the bodies, which the spec forbids).
- The guardrail also requires a revoke beside every `create or replace function`; 0110 revokes from public, anon (no-op for the two RPCs, removes default PUBLIC execute on the trigger function, which triggers do not need at fire time).
- The first CHECK let `kind = 'subscription_status', status = NULL` through (`NULL IN (...)` is NULL); fixed with explicit `status is not null`, covered by the negative test.
- Backfill of pre-existing rows is asserted by the migration's `do $verify$` block on apply; pgTAP cannot hold pre-0110 rows.

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Route | Evidence |
|---|-------|---------|---------|-------|----------|
| 1 | gap, edge | Dashboard readers select `status` with no `kind` filter and cast to non-null | medium | defer | Unreachable in 19.6a (nothing writes `session_required`); the session-required variant UI is 19.9 and the first writer is 19.6b. Deferred so 19.6b/19.9 filter or branch on `kind`. |
| 2 | gap, blind | Rollback script not exercised by any automated check; no own transaction | low | defer | Rehearsed once by hand and header states `--single-transaction`; a harness is a separate piece of work. |
| 3 | blind | Negative tests assert SQLSTATE only; dismissal lives_ok does not prove dismissal | low | patch | Fixed: constraint/index names matched in messages, plus an assertion that `dismissed_at` was set. Plan 7 -> 8. |
| 4 | edge, blind | Revoke on trigger function strips PUBLIC execute, header calls it a no-op | low | patch | Header comment corrected; harmless since firing a trigger needs no EXECUTE. |
| 5 | edge | Rollback verify queries `information_schema.columns` without `table_schema` | low | patch | Added `table_schema = 'public'`. |
| 6 | blind | "Byte-identical to 0090" contradicted by pasted `pg_get_functiondef` output | false | reject | Normalized diff of both bodies against 0090 shows only the `ON CONFLICT` targets and the index-naming comment differ. |
| 7 | blind, edge | No `lock_timeout`; ADD/DROP/ADD CONSTRAINT take ACCESS EXCLUSIVE | low | reject | Tiny table, short transactions; a timeout would turn a queue into a failed deploy and adds a guard. |
| 8 | blind | `$verify$` block largely tautological | low | reject | It still asserts the post-state (index swap, kind backfill, nullable status); the old-state invariants are enforced by DDL. |
| 9 | blind | Grandfather list grew 52 -> 53 | low | reject | Forced: bodies must stay unchanged and contain `app_role`; recorded in Implementation Notes. |
| 10 | blind | Missing tests for session_required insert via RLS, dismissed session_required, two members | low | reject | No code writes `session_required` here; `authenticated` has no insert grant (0034); belongs to 19.6b. |
| 11 | blind | `kind` free text instead of enum/lookup | low | reject | Epic AC prescribes text with a CHECK. |
| 12 | blind | Sprint-status/spec state mismatch; line citations rot; claim of "no later redefinition" lacks command | low | reject | Process notes; fix edits the spec or is resolved by step 5. Verified by grep of `check_in`/`mark_class_attendance` in 0091-0109. |
| 13 | blind | Types `kind: string`, no literal union | low | reject | Matches generated shape; narrowing belongs with the first consumer. |
| 14 | gap | Spliced `database.ts` nullable `status` not seen by typecheck due to cast | low | reject | Same root as #1. |

## Design Notes

- The epic spells the index `coalesce(status::text, '')`. Proven on local PG 17: enum-to-text is not IMMUTABLE, so that expression is refused ("functions in index expression must be marked IMMUTABLE"). `(member_id, kind, status) nulls not distinct` gives the identical one-active-per-kind guarantee, needs no wrapper function, and keeps `ON CONFLICT (member_id, kind, status)` inferable. Requires PG 15+; local and production are 17.
- Both indexes coexist briefly inside the transaction, so inference and the one-active guarantee never lapse. The table is small and a plain (non-concurrent) build holds a write lock for milliseconds; `CREATE INDEX CONCURRENTLY` cannot run in a migration transaction.

## Verification

**Commands:**
- `bash scripts/pgtap-run.sh` -- expected: all files pass, including the new alert-kind files
- `bash scripts/ci-local.sh` -- expected: static, pgtap, unit, e2e PASS
- `node scripts/check-migration-guardrails.mjs` -- expected: no new violations
