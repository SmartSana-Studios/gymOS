---
title: 'Claim-read inventory and CI check (report mode)'
type: 'feature'
created: '2026-10-15'
status: 'done'
baseline_commit: '03ab32f8e2970250d5f5154f3512580c86ffdf26'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-22-context.md'
  - '{project-root}/scripts/check-migration-guardrails.mjs'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Live authorization (22.3 database, 22.4 server paths) needs a finite target, and nothing stops a new policy or function from deciding on the token claim alone.

**Approach:** A generated inventory of every RLS policy, function/trigger body and server source file that reads the role or gym claim, each classified `claim-only`, `live-checked` or `exempt`, plus a `null-unsafe` list. A committed baseline and a CI check that fails only on new non-exempt entries (report mode).

## Boundaries & Constraints

**Always:** Plain Node, zero dependencies, same style and CI wiring as `check-migration-guardrails.mjs`. The script never writes the baseline except via an explicit `--write-baseline`. Classification is deterministic and sorted so the baseline diff is reviewable. Every entry is tagged with its closing story (`22.3` database, `22.4` edge/server). An `exempt` entry needs a one-line reason in a committed allow-list.

**Never:** No migration, no policy or function change, no enforcing mode (that is 22.4). Do not change the existing AD-3 grep gate's behavior. No new runtime dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Claim read | policy/function text matches `auth.jwt()`, `app_role` or `gym_id` claim read, no live helper call | `claim-only` | N/A |
| Live helper | body calls `private.current_member_role()` or `private.gym_id()` | `live-checked` (delegation: the helpers themselves are `claim-only` until 22.3 rewrites them) | N/A |
| Allow-listed | name in exempt list with reason (claims hook, `payment-webhook`) | `exempt`, reason printed | Entry without reason fails the check |
| New offender | new `claim-only` or `null-unsafe` entry absent from baseline | exit 1 naming kind, name, file | N/A |
| Fixed entry | baseline entry no longer present | report "stale baseline" note, exit 0 | N/A |
| Null-unsafe | `<> any(`, `not in (`, `!= any(` over a role | listed under `null-unsafe`, tagged 22.3 | N/A |
| No DB | local stack down | exit 2 with a clear message | N/A |

</frozen-after-approval>

## Code Map

- `scripts/check-migration-guardrails.mjs` -- pattern to follow (args, baseline file, exit codes); AD-3 grep gate stays.
- `scripts/__tests__/migration-guardrails.test.mjs` + `scripts/__tests__/fixtures/` -- test style (`node --test`).
- `scripts/ci-local.sh:stage_static,stage_pgtap` and `.github/workflows/ci.yml` (typecheck and rls-tests jobs) -- wire the offline unit tests into static, the DB-backed run into pgtap/rls-tests (DB via `docker exec supabase_db_gym_os psql`, as `scripts/pgtap-run.sh` does; host has no psql).
- `supabase/migrations/0009_auth_hook_gym_claims.sql:20` `private.gym_id()` (reads `auth.jwt()->>'gym_id'`) and `0061_staff_creation_role_ceiling_enforcement.sql:31` `private.current_member_role()` (live `members` lookup, but keyed on the claim gym) -- the two live helpers.
- Local DB today: 67 policies and 119 functions in `public`/`private` mention `jwt|app_role|gym_id` (rough upper bound, includes helper callers).
- Server sources reading claims: `apps/dashboard/lib/supabase/proxy.ts`, `apps/dashboard/app/(dashboard)/members/actions.ts`, `apps/super-admin/app/(admin)/{layout,page}.tsx`, `apps/super-admin/app/(admin)/gyms/[id]/page.tsx`, `apps/super-admin/app/(admin)/admins/actions.ts`, `lib/i18n/get-request-locale.ts`; edge functions `supabase/functions/*/index.ts` mostly use service role with explicit gym ids.
- `docs/decisions.md` 22.1 entry -- later stories add a `session_id` check; inventory must not treat it as claim-only logic.

## Tasks & Acceptance

**Execution:**
- [x] `scripts/claim-inventory.mjs` -- query `pg_policies` and `pg_proc` (+ trigger functions) via `docker exec psql`, scan `supabase/functions` and `apps/*/{app,lib}` sources, classify, detect null-unsafe, print table and JSON -- NFR-023 inventory
- [x] `scripts/claim-inventory.exempt.json` -- allow-list with reasons (claims hook, `payment-webhook`, the two helpers' own definitions only if justified)
- [x] `scripts/claim-inventory.baseline.json` -- committed baseline, each entry tagged `22.3` or `22.4`
- [x] `scripts/__tests__/claim-inventory.test.mjs` + fixtures -- cover every matrix row against fixture SQL and source text (no DB needed: classifier takes already-fetched rows)
- [x] `package.json`, `scripts/ci-local.sh`, `.github/workflows/ci.yml` -- `check:claims` script; unit tests in static, DB run next to pgTAP
- [x] `docs/decisions.md` and `sprint-status.yaml` -- record the claim-only count and per-story tags

**Acceptance Criteria:**
- Given the local database after all migrations, when `pnpm run check:claims` runs, then it prints every entry with kind, name, classification and closing-story tag and exits 0 against the committed baseline.
- Given a fixture policy that reads `app_role` from the claim with no live helper, when the check runs, then it fails naming the entry and file.
- Given the baseline, when the story closes, then the claim-only count and the 22.3/22.4 split are recorded in `sprint-status.yaml` and the decision entry.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| Layer | Finding | Verdict | Evidence / route |
|---|---|---|---|
| gap, edge, blind | SQL claim regex matched any `auth.jwt()` (session_id/aal/sub) | high | patched: only app_role/gym_id/role reads; test added |
| edge, blind | bare `getClaims()` counted; locale files inflated 22.4 | medium | patched; 22.4 count 7 -> 2 |
| gap | directory walk / filters untested; empty scan exits 0 | high | patched: fixture-tree test, zero files exit 2, wider default dirs |
| edge, blind | claim + live helper in one body hidden as live-checked | medium | patched: informational `mixed` list (59), classification stays per AC |
| edge | JSON parse / null rows exit 1, no timeout | medium | patched: exit 2, 60 s timeout |
| edge, blind | stale exempt silently inert | low | patched: note |
| edge | offender message without file | low | patched: "(file unknown)" |
| blind | CLAIM_HELPERS never retired | low | patched: decisions note, 22.3 retires |
| blind | convoluted null-unsafe test | low | patched |
| edge | BEGIN ATOMIC prosrc empty; claims in other schemas | false | checked locally: 0 functions with prosqlbody, 0 in other schemas |
| edge | trigger/function kind flip changes baseline key | low | not patched; rare, fails loudly and is fixed by regenerating the baseline |
| edge, blind | comment stripping inside string literals; 120-char window noise | low | not patched; no known miss in current sources, 3 null-unsafe all real |
| blind | ci.yml uses node, ci-local uses pnpm; no setup-node in rls-tests | low | ubuntu runners ship node; verify on first GitHub run |

## Design Notes

The AC lists two "live helpers", but `private.gym_id()` is itself a claim read today. Classifying its callers `live-checked` is correct only because 22.3 rewrites the helper (ACs 22.3 line 1). So the helper is listed `claim-only` (tag 22.3) and callers are `live-checked` by delegation; this keeps the retrofit a one-place change and avoids ~60 false entries.

App server sources are in scope although the AC names edge functions only: Server Actions are the "service-role server actions" 22.4 retrofits, so they belong in the same inventory under kind `server`.

## Verification

**Commands:**
- `node --test scripts/__tests__/*.test.mjs` -- expected: pass
- `pnpm run check:claims` -- expected: exit 0 against baseline, with stack up
- `bash scripts/ci-local.sh` -- expected: GREEN
