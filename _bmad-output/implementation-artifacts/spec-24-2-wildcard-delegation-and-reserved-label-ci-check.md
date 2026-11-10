---
title: '24-2 Wildcard delegation prep: zone export, reserved-label CI check, host-neutral env, rollback runbook'
type: 'feature'
created: '2026-11-08'
status: 'done'
route: 'dispatch'
baseline_commit: 'a767748ec70432abf800b2993190a3b13742fa4e'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-24-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Before `*.gymosapps.com` goes live, nothing stops a gym claiming a name that collides with a real zone label (`mail`, `webmail`, `cpanel`, ...), the zone is not versioned, and the apps read `VERCEL_ENV` / `VERCEL_GIT_COMMIT_SHA` directly, which ties them to one host (AD-43).

**Approach:** This pass is the code half of 24.2 only. Commit a faithful zone export, one reserved-label list (FR-202 list ∪ zone labels ∪ `smtp`, `imap`, `pop`, `test`) read by both the proxy and a CI check, route the two Vercel variables through one module per app, and write the wildcard rollback runbook. The ops half (Vercel wildcard domain, A2 `NS`/`CNAME`, AutoSSL run, test mail, rollback rehearsal) stays with the product owner and keeps the story open.

## Boundaries & Constraints

**Always:** The list has one source (a plain JSON file) that a Node script reads directly and a typed TS module re-exports; a test asserts they agree. Labels that fail the AD-45 grammar (underscore labels, `_tcp`, `_domainkey`) are ignored by the zone check and counted in its output. Env behavior stays identical: existing tests pass unchanged. New gates end in `|| return 1` in `ci-local.sh` and are mirrored by hand in `ci.yml`. Gates are shown to fail on a known-bad input.

**Never:** No DNS, Vercel, A2 or production change. No host-routing logic in `apps/landing/proxy.ts` (24.10). No change to `apps/dashboard/AGENTS.md` or `scripts/demo-gym/`. No new test runner in `apps/landing`. Do not "fix" the super-admin client analytics environment (defer note only).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Real zone passes | committed export, committed list | exit 0, prints labels checked and ignored | N/A |
| Unreserved zone label | zone has `shop A 1.2.3.4` | exit 1, line names `shop` and its zone line | N/A |
| Non-name owners | `@`, `*`, `_tcp`, `default._domainkey` | ignored, not failures | counted in output |
| Zone syntax | `$ORIGIN`, `$TTL`, `;` comments, FQDN and relative owners, blank owner inherits previous | parsed to the label directly under the apex | unparseable line: exit 1 with its number |
| Bad list entry | uppercase, duplicate, or grammar-invalid label | exit 1 naming it | N/A |
| Missing file | zone export or list absent | exit 1 with the path | N/A |
| `APP_ENV` set | `APP_ENV=production`, `VERCEL_ENV=preview` | `appEnvironment()` is `production` | N/A |
| Vercel fallback | `APP_ENV` unset, `VERCEL_ENV=preview` | `preview` | N/A |
| Neither / unknown | unset or `foo` | `development` | N/A |
| Build id | `GIT_SHA` over `VERCEL_GIT_COMMIT_SHA`; neither gives `"dev"` | as stated | N/A |
| Stray read | source file outside the module reads either variable | gate exits 1 naming file:line | tests, docs, `node_modules`, `.next` excluded |

</frozen-after-approval>

## Code Map

- `docs/dns/gymosapps.com.zone` -- new; build from the owner's 2026-11-01 cPanel paste (labels and values in `docs/decisions.md` 24.1 entry; scratchpad snapshot is session-local). Verify each record against live `dig` before committing. cPanel hides SOA and apex NS: say so in the header.
- `packages/types/src/constants/reservedLabels.json` + `.ts` -- new, beside `taraMoneySupportedCountries.ts`; `packages/types/src/index.ts` exports. Check `tsconfig` allows JSON import; otherwise export a const and have the script read the JSON.
- `scripts/check-reserved-labels.mjs` + `scripts/__tests__/reserved-labels.test.mjs` -- model on `scripts/check-credentials-id.mjs` (pure exported functions, CLI main, one line per violation).
- `scripts/check-host-neutral-env.mjs` + `scripts/__tests__/host-neutral-env.test.mjs` -- second gate, same shape.
- `package.json` (root) -- `check:reserved-labels`, `check:host-neutral-env`; `test:guardrails` already globs the new tests.
- `scripts/ci-local.sh` `stage_static` and `.github/workflows/ci.yml` typecheck job -- add both gates; run `scripts/ci-local.selftest.sh`.
- `apps/dashboard/lib/{analytics-environment,build-id}.ts`, `next.config.ts`; same three in `apps/super-admin` -- reads move to a new `lib/app-env.ts` per app (`appEnvironment(env = process.env)`, `buildId(env)`); `next.config.ts` imports it by relative path (no `@/` alias). Existing: `analytics-environment.test.ts`, `analytics.test.ts`, version route and `UpdateNotice` tests must pass unchanged. Add `app-env.test.ts` per app (env idiom: save/restore `process.env`, dynamic import).
- `docs/runbooks/wildcard-dns-rollback.md` -- new; conventions as `docs/runbooks/deploy-epic-23.md`. Content from the 24.1 entry: remove `_acme-challenge` `NS` records (A2 support ticket), remove `CNAME *`, remove and re-add the Vercel domain if issuance stalls, AutoSSL straight after delegation, A2 certificate renewal window from about 2026-12-01 (expires 2026-12-31), first wildcard renewal about 60 days after issuance.
- Not touched: `apps/landing/proxy.ts`, `apps/mobile` (`EXPO_PUBLIC_APP_ENV`, not Vercel), `VERCEL_URL` / `VERCEL_PROJECT_PRODUCTION_URL` / `VERCEL_FORCE_BUILD`.

## Tasks & Acceptance

**Execution:**
- [x] `docs/dns/gymosapps.com.zone` -- commit the export, checked against live DNS -- AC 3
- [x] `packages/types/src/constants/reservedLabels.*` -- FR-202 labels (`owner, portal, www, api, app, admin, support, mail, staging, dev, gymos, gym-os, auth, cdn, status, docs, help, login, signin, account, billing, pay, payment, tara, taramoney`, prefix `gymos`) plus zone labels plus `smtp, imap, pop, test` -- one source
- [x] `scripts/check-reserved-labels.mjs` and its test -- cover every matrix row incl. a fixture zone that must fail -- AC 3
- [x] `scripts/check-host-neutral-env.mjs` and its test -- grep gate, comments stripped, tests/docs excluded -- AC 5
- [x] `apps/{dashboard,super-admin}/lib/app-env.ts`, `analytics-environment.ts`, `build-id.ts`, `next.config.ts` and tests -- host-neutral reads -- AC 5
- [x] root `package.json`, `scripts/ci-local.sh`, `.github/workflows/ci.yml` -- wire both gates -- AC 3, 5
- [x] `docs/runbooks/wildcard-dns-rollback.md` -- AC 4
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- 24-2 stays `in-progress` (ops half open); append the `last_updated` entry

**Acceptance Criteria:**
- Given the committed zone export and list, when CI runs, then it fails if the export has a grammar-valid label not in the reserved list, and the proxy-side module and the script read the same data.
- Given the reserved-label gate, when run against a fixture zone with an unreserved label, then it exits 1 (shown capable of failing).
- Given the rollback runbook, when read, then it lists every record to remove, who removes it (A2 support for `NS`), the AutoSSL and renewal dates, and says the rehearsal is recorded when the 24.1 cleanup is confirmed by A2.
- Given both apps, when this pass closes, then a grep finds no `VERCEL_ENV` or `VERCEL_GIT_COMMIT_SHA` read outside `lib/app-env.ts`, and existing tests are unchanged and green.
- Given the story, when this pass closes, then it records that the ops half is open: wildcard domain, `NS`/`CNAME` records, certificate, test mail in and out, rollback rehearsal.

## Implementation Notes

## Spec Change Log

## Review Triage Log

Review 2026-11-08, three layers (Blind Hunter, Edge Case Hunter, Verification Gap). No intent_gap or bad_spec; all real findings are patches, no loopback.

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| resolveAnalyticsEnvironment (now `APP_ENV`-aware) has no test; super-admin has none at all | medium | patch | Only the dashboard test exists and it sets `VERCEL_ENV` only; reverting the function to a direct read would pass. New cases added. |
| `isReservedLabel` (TS) never executed by a test; differs from the script's `isReserved` on case | medium | patch | Existing test only greps the TS source. Vitest case added. |
| `APP_ENV` padded or cased, `GIT_SHA` blank or newline-terminated, silently ignored | low | patch | Trim and lowercase added; tests added. |
| `stripComments` is not regex-literal aware, so the gate can fail open | medium | patch | A regex containing `//` or a quote blanks later code. Replaced with a fail-closed line-start rule. |
| `ALLOWED` matches `lib/app-env.ts` at any depth; `SKIP_DIRS` skips `docs`/`__tests__` at any depth | low | patch | Verified no source folder is hidden today; anchored anyway. |
| "CLI exits 1" test does not run the CLI; tests depend on the cwd | medium | patch | Real CLI spawned against fixture roots for both gates. |
| Runbook step 4 ignores resolver TTL; no check that `owner.`/`portal.` are unaffected | medium | patch | Query the authoritative server; add curl checks. |
| `buildId()` is build-time only and its wiring in `next.config.ts` is untested | low | patch / rejected | Comment added that `GIT_SHA` must be set at build. Wiring test rejected: config glue, and the env gate already forbids the old read. |
| `packages/types` JSON import may break mobile or other consumers | false | rejected | `apps/mobile` typecheck passes with the new export. Metro bundling not exercised. |
| Zone export is a hand-maintained snapshot; a record added in cPanel without updating it bypasses the gate | medium | defer | Inherent to an offline gate; recorded in deferred-work.md with the optional live `dig` comparison. |
| Super-admin client Sentry environment resolves to dev | low | rejected | Pre-existing and deferred by the story (behaviour unchanged is an AC). |
| Default `env = process.env` evaluated in a browser bundle | low | rejected | Pre-existing behaviour (the old code read `process.env.VERCEL_ENV` in the client too). |
| `isReservedLabel` has no consumer; list not enforced anywhere yet | low | rejected | By design: enforcement is 24.7 (page names) and 24.10 (proxy). |
| Reserved list lacks `ns`, `web`, `blog`, `demo`, ... | low | rejected | Composition fixed by FR-202 plus the zone; further words live in the `page_name_words` table (AD-45). |
| Relative owner written with the apex; short or overlapping prefixes; parse depth after an error; ignored labels not named | low | rejected | Loud failures or list-authoring errors caught in code review. |
| `app-env.ts` copies can drift; no drift test | low | rejected | Per-app duplication is the AC ("one small module per app"). |
| Dynamic `process.env[...]`, `NEXT_PUBLIC_VERCEL_ENV`, files outside `apps/` and `packages/` not scanned | low | rejected | Accepted grep-gate limits; a whole-repo grep finds no other read, only comments. |
| Runbook points at an `apps/landing` project absent from the diff | false | rejected | `apps/landing` exists. |

## Design Notes

The zone label is the one directly under the apex: `default._domainkey` gives `_domainkey` (ignored by grammar), `autoconfig` gives `autoconfig`. Super-admin has no `NEXT_PUBLIC_ANALYTICS_ENV` inlining, so its client Sentry `environment` probably always resolves to `dev`; out of scope, record in `deferred-work.md`.

## Verification

**Commands:**
- `pnpm run check:reserved-labels` and `pnpm run check:host-neutral-env` -- expected: exit 0
- `pnpm run test:guardrails` -- expected: all pass, including the fixture-failure cases
- In `apps/dashboard` and `apps/super-admin`: `pnpm vitest run` on `lib/` tests, `pnpm run typecheck` -- expected: pass
- `bash scripts/ci-local.selftest.sh` then `scripts/ci-local.sh` static stage -- expected: pass; read the per-stage lines, not only the final GREEN

**Manual checks:**
- `dig` each record in the export against the live zone: values match.
