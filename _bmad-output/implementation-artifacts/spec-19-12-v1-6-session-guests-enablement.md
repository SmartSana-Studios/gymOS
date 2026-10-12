---
title: '19-12 V1.6 session guests enablement (migration 0115)'
type: 'feature'
created: '2026-10-12'
status: 'done'
baseline_commit: '2867104cb336fc428e0937aa5951e34b3a295c4c'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-19-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `gyms.charge_guests_per_session` defaults to `false` (0107), so a gym created after V1.6 still starts with per-session charging off, contradicting FR-157.

**Approach:** Migration 0115 only changes the column default to `true`; existing rows are untouched. Prove it with a trailing `do $verify$` block and a pgTAP test, add a forward-fix rollback script, and record the release in `docs/decisions.md`.

## Boundaries & Constraints

**Always:**
- 0115 runs exactly `alter table gyms alter column charge_guests_per_session set default true` plus its verify block; no data write, no function or trigger change.
- The verify block asserts the default is `true`, the column is still `NOT NULL`, and the count of gyms with the flag `true` is unchanged from before the statement (captured in the same transaction).
- pgTAP: a gym inserted without the column starts `true`; a gym that existed before the `set default` keeps its value (insert with explicit `false`, assert unchanged); the setter RPC and pin trigger still behave (existing 0107 tests stay green).
- Existing pgTAP files that insert gyms without the flag and rely on it being off get the flag pinned `false` explicitly in their fixtures; no assertion changes.
- Rollback script is forward-fix only: `set default false`; rows already created `true` stay `true`.
- Decision (date): the `docs/decisions.md` entry is written now as "0115 ready, built 2026-10-12" with no production date; the owner appends an "Enabled in production: <date>" line when applying 0115, which satisfies the AC's "became available".
- Do not apply 0115 to production in this story. The runbook gates (restore test, rotation procedure, `job_runs` alert Action, 19.11 build live in both stores, Epic 18 retro item 22) are the owner's; the migration ships in the repo, the owner applies it last.

**Never:** No `ADD COLUMN … DEFAULT true`, no backfill, no change to Super Admin create-gym code (`apps/super-admin/services/gyms.ts` inserts without the column and inherits the default), no regenerated `database.ts` unless the generator output actually changes.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| New gym | insert after 0115, flag omitted | `charge_guests_per_session = true` | N/A |
| Pre-existing gym | row present before 0115 | value unchanged | verify block raises on any change |
| Explicit value | insert with `false` | stays `false` | N/A |
| New gym, plan price 0 or non-per-session | flag on | members stay exempt (19.6b rule) | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0107_charge_guests_setting_session_record.sql` -- adds the column `NOT NULL DEFAULT false` (l.59), pin trigger and setter; its verify block asserts default false, which is correct for 0107 only; read-only here
- `supabase/migrations/0114_guest_sessions_overview_rpcs.sql` -- latest migration; style for the trailing `do $verify$` block
- `scripts/rollback-0114-guest-sessions-overview-rpcs.sql` -- rollback script shape to copy
- `supabase/tests/charge_guests_setting.test.sql` -- fixture/test style (fixed ids `…0000000320xx`)
- `supabase/tests/{subscription_lifecycle_notifications,member_management_rls,registration_fee_foundation,manual_renewal_reset,subscriptions_page_manual_renewal,subscription_lifecycle_cron}.test.sql` -- insert gyms with pay_per_session plans and never mention the flag; may break under default true, pin `false` in the gym insert if so
- `scripts/session-refund-race.sh`, `scripts/epic18-qa/seed.mjs` -- insert gyms; the race script sets the flag explicitly, the QA seed inherits the default (check it for check-in assumptions)
- `apps/super-admin/services/gyms.ts:943` -- gym creation; inherits the default, do not touch
- `docs/decisions.md` -- newest-first; add the entry at the top and re-verify any cited line numbers afterwards
- `scripts/migration-guardrails.grandfather.json` -- no change expected (no `app_role` read, no function)

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0115_enable_charge_guests_default.sql` -- `set default true` + `do $verify$` block -- FR-157
- [x] `supabase/tests/charge_guests_default.test.sql` -- new-gym-on, existing-gym-unchanged, explicit-false, not-null still enforced
- [x] six existing pgTAP files above -- pin `charge_guests_per_session = false` in gym fixtures only where the full suite shows a break
- [x] `scripts/rollback-0115-enable-charge-guests-default.sql` -- forward fix `set default false`, documented
- [x] `docs/decisions.md` -- V1.6 enablement entry: date per the resolved Open Question, decisions 1–4 (2026-10-11), release order position, rollback pointer, owner gates still required before apply
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- 19-12 status and last_updated entry

**Acceptance Criteria:**
- Given 0115 applied to a database with existing gyms, when a gym is inserted without the flag, then it is `true` and every earlier gym's value is unchanged.
- Given the migration file, when the guardrail check runs, then `pnpm check:migrations` passes with no grandfather change.
- Given the full suite, when `bash scripts/ci-local.sh` runs, then every stage passes.

## Implementation Notes

- Applied 0115 to the local DB by psql (local ledger stops at 0106 already). Full pgTAP: only the two 0107 `charge_guests_setting` files broke (their "off by default" premise); the six unmentioned files did not, so only those two got `false` pinned; assertion 1 retitled, no expectation changed. 129+1 files pass.
- Review patch: the snapshot/compare moved from an on-commit-drop temp table into a single DO block (lock + md5 of (id, flag) before and after), so the migration is safe under autocommit.
- decisions.md entry written as "0115 ready" with an owner placeholder line for the production date (user decision).

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Route | Evidence |
|---|-------|---------|---------|-------|----------|
| 1 | blind, edge, gap | `on commit drop` temp table breaks verify when applied outside one transaction, after the default has flipped | medium | patch | Autocommit drops the table at once. Fixed: snapshot, ALTER and compare in one DO block, no temp table. |
| 2 | blind, edge | Count check racy and weak (swapped values keep equal counts) | medium | patch | Same fix: lock gyms access exclusive, compare md5 of ordered (id, flag). |
| 3 | edge, blind | "All existing gyms off" claim wrong: owners may have enabled since 0107 | low | patch | decisions.md and migration header reworded. |
| 4 | blind, edge | decisions.md says "nothing else" but the file does more | low | patch | Reworded with the DO-block description. |
| 5 | blind | Other tests/seed may depend on default off | false | reject | Full pgTAP 129/129 passes after the flip; only the two 0107 files needed pinning. |
| 6 | blind | No query/script for gyms created while default true; apply time not recorded | low | reject | New artifact with no named harm; gyms.created_at plus the owner-appended date identify the cohort. |
| 7 | blind, edge | New gyms on by default bypass set_guest_charging audit/impact dialog | false | reject | Intended by FR-157 and the story; a new gym has no members to warn. |
| 8 | blind | Flag-on behaviour at a new gym untested | false | reject | 0107-0114 suites cover flag-on paths; this story changes only the default. |
| 9 | edge, gap | Pre-existing-row preservation and rollback script have no pgTAP | low | reject | pgTAP is one transaction and cannot straddle the migration; the in-migration hash check is the proof. |
| 10 | edge | Unqualified temp table name via search_path | false | reject | Temp table removed by fix 1. |
| 11 | edge | Assertion 1 retitled, global count | low | reject | Fixtures pin false; the assertion remains exact. |

## Design Notes

`ALTER COLUMN … SET DEFAULT` is catalog-only in Postgres 15+: it takes a brief ACCESS EXCLUSIVE lock, rewrites no rows and does not touch the pin trigger (which fires on UPDATE only). That is why the default flip is its own last migration, separate from the 0107 `ADD COLUMN`.

## Verification

**Commands:**
- `bash scripts/ci-local.sh` -- expected: all stages PASS
- `pnpm check:migrations` -- expected: OK, no new grandfather entries

**Manual checks (owner, at deploy):** the runbook gates in `docs/decisions.md` "V1.6 release runbook" are closed; back up (db-backup green) then apply 0115 last; create a throwaway gym in Super Admin and confirm Settings shows Charge guests on.
