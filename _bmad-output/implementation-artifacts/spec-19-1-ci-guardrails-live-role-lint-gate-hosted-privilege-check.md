---
title: '19-1 CI guardrails: live-role lint gate and hosted-privilege check'
type: 'chore'
created: '2026-10-11'
status: 'done'
baseline_commit: 'd6ada66d9cb9bd121639e949a88b405392dd48a5'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-19-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** AD-3 forbids new `auth.jwt() ->> 'app_role'` reads and the spine requires every new function to revoke EXECUTE from `public` and `anon`, but nothing in CI enforces either; 52 migrations already carry the JWT read and 0104 showed hosted defaults grant `anon` EXECUTE on new functions.

**Approach:** One dependency-free Node script scans `supabase/migrations/` against two checked-in grandfather lists (files as they stand at the base commit) and fails on any non-listed offender. Wire it into `ci.yml` and `scripts/ci-local.sh`, prove it with fixture tests, and document the static-check limitation plus the manual post-deploy query in `docs/decisions.md`.

## Boundaries & Constraints

**Always:** Match `auth.jwt() ->> 'app_role'` in any whitespace variant (including `->`), on raw file text (comment mentions count, so the 52 files in the AC are exactly the list). The failure message names `private.current_member_role()`. A function passes only when the same file has revoke(s) of EXECUTE on it covering both `public` and `anon` (one statement or separate ones; `revoke all` counts); schema-qualified, unqualified-as-`public`, trigger and `private.` functions are all checked. Grandfather lists are hand-edited files; the script never writes them.

**Never:** No migrations, no retro-fix of existing files, no live DB query in CI, no auto-regeneration of the lists. Do not weaken or touch the existing i18n gates.

**Decision (planner, 2026-10-11):** the privilege check gets the same grandfather mechanism as the JWT gate, since 24 existing function-creating files have no revoke at all and would fail otherwise; the list holds exactly the files failing the rule at the base commit (computed by the script, reviewed in the diff).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Clean tree | Base commit, both lists | exit 0 | N/A |
| New JWT read | non-listed file has `auth.jwt() ->> 'app_role'` | exit 1, names file + `private.current_member_role()` | N/A |
| Fixed read | same file uses `private.current_member_role()` | exit 0 | N/A |
| Grandfathered file edited | listed file gains more reads | exit 0 | N/A |
| New function, no revoke / only `from public` | non-listed file | exit 1, names file + function | N/A |
| New function, `from public, anon` or two statements | non-listed file | exit 0 | N/A |
| Stale list entry | list names a file that no longer exists or no longer offends | exit 1 asking to remove it | message names entry |

</frozen-after-approval>

## Code Map

- `.github/workflows/ci.yml` -- `typecheck` job holds the i18n gate steps; add new step beside `check:i18n`.
- `scripts/ci-local.sh` -- `stage_static()` mirrors that job; add the same commands.
- `scripts/check-i18n-key-parity.mjs` -- shape to copy: plain Node, zero deps, `repoRoot` from `import.meta.url`.
- `package.json` -- root scripts (`check:i18n`); add `check:migrations`, `test:guardrails`.
- `supabase/migrations/0104_align_function_privileges.sql` -- hosted default-privilege finding and its `do $verify$` block; source of the manual query.
- `supabase/migrations/0098_registration_fee_foundation.sql` -- example of accepted style (`revoke execute on function private.x() from public;` alone is NOT enough under the new rule).
- `docs/decisions.md` -- newest-first log; new entry under the intro rule; re-check any cited line numbers after inserting.

## Tasks & Acceptance

**Execution:**
- [x] `scripts/check-migration-guardrails.mjs` -- args `--migrations <dir>`, `--grandfather <file>`, `--print-baseline` (stdout only); implement both checks and stale-entry detection -- the gate
- [x] `scripts/migration-guardrails.grandfather.json` -- `{ "app_role_reads": [...], "function_privileges": [...] }` generated once from `--print-baseline` at the base commit; verify `app_role_reads` has exactly 52 entries -- reviewer-visible list
- [x] `scripts/__tests__/migration-guardrails.test.mjs` + `scripts/__tests__/fixtures/` -- `node:test` cases for every matrix row, running the script against fixture dirs -- AC 3 proof
- [x] `package.json` -- `check:migrations`, `test:guardrails` (`node --test scripts/__tests__/`)
- [x] `.github/workflows/ci.yml`, `scripts/ci-local.sh` -- run both after the i18n parity check
- [x] `docs/decisions.md` -- dated entry: both gates, the grandfather decision, static-check limitation, manual post-deploy query (functions in `public`/`private` where `anon` has EXECUTE, per 0104's verify block), `--print-baseline` is how lists were derived
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- 19-1 status and `last_updated` entry; verify with the `uv run _bmad/scripts/*.py` parser

**Acceptance Criteria:**
- Given the base commit, when `pnpm run check:migrations` runs, then it exits 0 and the JWT grandfather list has exactly 52 files.
- Given a fixture migration with a new `auth.jwt() ->> 'app_role'` read, when the gate runs, then it fails; with `private.current_member_role()` it passes.
- Given a grandfathered file is edited, when the gate runs, then it passes; adding a file to a list needs an edit to the checked-in JSON.
- Given a fixture creating a function without `revoke … from public` and `from anon`, when the gate runs, then it fails naming the function.
- Given `ci.yml` and `ci-local.sh`, when read, then both invoke the gate beside the i18n parity check.

## Implementation Notes

## Spec Change Log

## Review Triage Log
| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| Wrapped/nested JWT reads (`(select auth.jwt())`, `::jsonb`, `-> 'app_metadata'`, `current_setting('request.jwt.claims')`) bypass the gate (edge-case, blind) | low | defer | Frozen intent and the epic AC name the literal `auth.jwt() ->> 'app_role'` pattern; the corpus has zero wrapped or cast forms, so the gate covers every real site today. Broadening is a spec change. |
| Per-file grandfathering lets a listed file gain new offenders (blind, edge-case) | false | n/a | The AC states "when a grandfathered file is edited, the gate still passes" and the frozen matrix has that row. |
| Trailing CASCADE/RESTRICT parsed into the role name (edge-case, verification-gap) | low | patch | Real parse flaw; fails closed, no corpus case. One-line strip. |
| `grant option for` accepted as full revoke; `routine`/`procedure` forms and `create procedure` missed (edge-case, blind) | low | patch | Confirmed in the regexes; the corpus has no procedures today. Small regex edits. |
| Missing arg value throws TypeError; empty migrations dir reports OK; malformed grandfather JSON (edge-case, blind) | medium | patch | An empty or wrong path passing as OK would silently disable the gate in CI. Exit 2 guards. |
| Real-tree test hard-codes 52 and shells to `cat` (blind, edge-case, verification-gap) | medium | patch | The stale-entry remediation the gate prescribes would fail the suite. |
| Missing tests for new guards and exit-2 paths (blind) | low | patch | Folded into the patch above. |
| `create or replace` of an already-revoked function must re-state the revoke; trade-off undocumented (blind) | low | patch | Doc sentence only; the file-local rule is deliberate. |
| decisions.md doubled blank line (blind) | low | patch | Cosmetic, direct fix. |
| Later `grant ... to anon` after the revoke undetected (edge-case, blind) | low | reject | A same-file revoke-then-grant-to-anon does not occur in the corpus (only 0019 and 0092 grant to anon, neither as an undo); a fix needs new grant tracking. The manual hosted query is the backstop. |
| `--`/`/*` inside strings or dollar quotes, `;` split inside `$$`, DO-block revokes (blind, edge-case) | low | reject | Already listed as approximate in the decisions entry; failures are loud for new files and a tokenizer is disproportionate. |
| Overloads revoked by name only (edge-case, blind) | false | n/a | Documented limitation in the spec's Design Notes and decisions entry. |
| Unqualified create vs `private.` revoke name mismatch (edge-case) | low | reject | Fails closed with a visible, fixable message; schema resolution would be speculative. |
| Hosted query covers only anon, public/private schemas; no Node engines field (blind) | low | reject | The spine rule and 0104 concern anon; no `engines` convention exists in the repo. |
| `fn-both` fixture comment line proves nothing (blind) | low | reject | Cosmetic; the stripping behaviour is exercised by the real tree. |
| No automated hosted-state check (verification-gap) | n/a | n/a | Decided in the frozen block; documented limitation. |

## Design Notes

Function matching: parse `create [or replace] function <name>(`, normalise `public.` away and keep `private.`; collect `revoke (execute|all)… on function <name>… from <roles>` statements (strip `--` comments and `/* */` only for this check) and union their role lists. Match by name, ignoring argument lists (overloads share a name; revoking one overload is accepted as a known blind spot, stated in the decisions entry).

## Verification

**Commands:**
- `pnpm run check:migrations` -- expected: exit 0, prints counts
- `pnpm run test:guardrails` -- expected: all fixture tests pass
- `scripts/ci-local.sh --only static` -- expected: PASS
- `uv run _bmad/scripts/*.py` (sprint-status parser) -- expected: parses with no errors
