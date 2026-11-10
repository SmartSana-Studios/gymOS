---
title: '24-12 landing-page gate: isolation, headers and speed baseline'
type: 'chore'
created: '2026-11-09'
status: 'done'
baseline_commit: '5e21aa7ccf6e89ba8d0397c8366cca2bc455a240'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-24-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 24 may not go public until the Step 2 release gate (PRD §10.2; NFR-024, NFR-025, NFR-026) is proven: the public site cannot reach tenant data, every response carries the AD-44 headers, a page is fast enough, a label scan does not hurt the core product, and the page flows have end-to-end tests. Today the header checks are unit calls (none hits a running server), nothing measures LCP, connections or load, and the E2E suite has no page spec.

**Approach:** Extend the isolation pgTAP; add a runnable gate kit in `scripts/landing-gate/` (HTTP header check, LCP baseline, label-scan load check) that takes a base URL, so the same kit runs locally now and against staging later; add a landing-page E2E spec (EN and FR) with `apps/landing` as a second Playwright server; record the result and a signable checklist in `docs/decisions.md`, `sprint-status.yaml` and `epic-24-context.md`. Sources: epics.md Story 24.12; AD-44/AD-47; NFR-024..026; deferred-work.md lines naming 24.12.

## Boundaries & Constraints

**Always:**
- Isolation: `public_site_reader` keeps its strict suite (nothing outside `public_site` except `submit_page_report`). For `anon` (the unauthenticated role) the suite asserts what is true and pinned: zero table/view/sequence privileges on any relation outside `public_site` (none on `public_site` either), and EXECUTE only on a pinned allowlist of non-trigger functions (today: `gym_effective_member_cap`, `phone_has_membership`, `phone_has_staff_membership`, `check_otp_resend_allowed`, `record_otp_resend`, plus `private.has_active_gym_data_escalation`, inert without `USAGE` on `private`; reachability is asserted). A new anon-executable function fails the test. The AC wording "no privilege on any function" cannot hold for the pre-auth OTP helpers; this pinned list replaces it and is recorded in decisions.md. Column and key-path snapshots stay as they are and must pass; each new assertion is shown failing by a known-bad run.
- Headers: a script sends real HTTP requests to a running landing server and asserts the exact AD-44 set (CSP string, `X-Content-Type-Options`, `Referrer-Policy`, HSTS, `Cache-Control`, `Vary`, no `Set-Cookie`) on a published page, a not-found and a redirect, plus byte-identical not-found for unknown, unpublished, taken-down and reserved labels (status, headers except `Date`, body). It prints which headers Next adds itself (the `Vary: rsc...` line of decisions.md 24.10) and fails on any unexpected one.
- LCP baseline: Chromium via Playwright with CDP throttling (CPU 4x, 1.6 Mbps down, 150 ms RTT, 360x640 mobile, cache cold), at least 20 runs, p75 LCP from `PerformanceObserver`, against a representative published page (all ten sections, both languages). Result written to decisions.md labelled **lab, local** or **lab, staging**; a lab number never claims to be field data. The 3 s target stays `[ASSUMPTION]` until the owner has a staging number.
- Load check: random grammar-valid labels (mostly unknown, some real) at stepped concurrency against the base URL; sample `pg_stat_activity` for the role every second and fail if connections exceed the role's `CONNECTION LIMIT` (read from `pg_roles`, not hard-coded); while it runs, probe the core product (dashboard Overview load and the check-in RPC round trip) and fail if either exceeds the story's budget (page load 2 s, scan to alert 3 s) or its median rises over 25% against a run without the scan. Count errors and cached 404s for real labels: the unverified deferred items (one-connection reader pool under concurrency; two serial reads per unknown label) are settled by this run and the outcome recorded; if the pool fails, size the pool and `CONNECTION LIMIT` together in this story.
- E2E (`apps/dashboard/e2e`, EN and FR, one spec file): Owner claims a name, fills the gate, publishes, sees the page on the landing server (second Playwright `webServer`, root domain `localhost`, `Host` header addressing; no real DNS); unpublishes; renames and the old name 301s once; a Super Admin takedown (DB level: a service-role-created user with `is_super_admin`, password grant, RPC `take_down_gym_page`; the aal2 flag must be off, asserted) hides the page; not-found uniformity across unknown, unpublished, taken-down and reserved labels. French runs set `users.preferred_language = 'fr'` and assert visible French labels. The landing server's `next build` in this webServer closes the "no landing build in CI" deferral. `ci-local.sh` and `ci.yml` e2e jobs set the reader password and `PUBLIC_SITE_*` env; `ci-local.selftest.sh` still passes and the e2e stage is shown able to fail.
- Close or re-defer every `deferred-work.md` line that names 24.12 (pool concurrency, serial unknown-label reads, landing build, purge-job staleness). Purge staleness becomes a staging checklist query (`scripts/landing-gate/purge-staleness.sql`: no successful `page_media_purge` `job_runs` row in 15 minutes means fail).
- Sign-off: `docs/decisions.md` gains a 24.12 section with the gate table (each AC: command, result, where run, date), the owner's staging steps (headers, LCP, load, purge job, repeat the DNS precedence check over HTTPS on the real wildcard, Firefox and Safari `__Host-` check) and a checklist the owner signs; `sprint-status.yaml` and `epic-24-context.md` record the result honestly: items not yet run on staging are listed OPEN, never PASS.

**Decisions (owner, 2026-11-09, delegated "decide"):** (1) No staging exists, so the build delivers the kit and tests, runs everything locally, records local results and lists staging items OPEN; the story is done when the kit, tests and checklist exist and pass locally, and the gate stays UNSIGNED until the owner runs the kit on staging and signs, which keeps Epics 24 (release) and 25 blocked on that sign-off. (2) Keep the full spec; the E2E spec stays in this story.

**Never:** No production or staging change (no migration apply, deploy, DNS, Vercel or env change). No new runtime dependency in `apps/landing`; the kit may use Playwright (already in the repo) and `pg`. No weakening of an existing privilege or header assertion to make a test pass. No lighthouse install. Do not touch `scripts/demo-gym/`, `apps/dashboard/AGENTS.md`, migration files (unless the load check fails the pool and a pool/limit change is needed), or the AD-44 policy.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| New anon-executable function | migration adds a non-trigger function without revoke | isolation pgTAP fails naming it | N/A |
| Header drift | server adds a header or drops one on any of the three responses | `check-http` exits non-zero, names response type and header | N/A |
| Hidden causes | unknown, unpublished, taken-down, reserved label | identical status, headers, body | any difference fails |
| Load over limit | scan drives role connections above its limit | load check fails with the peak | outcome recorded in decisions.md |
| Core probe slower | Overview or check-in probe over budget or +25% | load check fails | N/A |
| Staging not available | kit run locally only | result recorded as local; staging items OPEN | gate not signed |
| E2E in French | `preferred_language = 'fr'` | same flows pass with French labels | N/A |

</frozen-after-approval>

## Code Map

- `supabase/tests/public_site_reader_privileges.test.sql` -- reader suite (plan 71); add the anon block here or in a sibling `public_site_anon_isolation.test.sql` (pgTAP runner picks up `supabase/tests/*.sql`).
- `apps/landing/lib/gym-site/{handler,db,env,notFound}.ts`, `proxy.ts`, `gymSite.test.ts:142-255` -- header unit tests that the HTTP script mirrors; README.md:129-141 documents the `next start` run; env names `PUBLIC_SITE_*` in `turbo.json:49-56`; reader role `0160:33` (`connection limit 20`), local password via `ALTER ROLE`, host 127.0.0.1:54322.
- `packages/types/src/pageHost.ts:26-39` -- `name.localhost` classifies as gym with root `localhost`.
- `apps/dashboard/playwright.config.ts`, `e2e/fixtures/seed.ts:175`, `e2e/helpers/{auth,env,fixtures}.ts` -- add the second `webServer`, fixture helpers (content, plan, media rows, claim, publish via the RPCs in `services/landing-page.ts:295-428`; the `pg_temp.complete` helper in `supabase/tests/gym_page_publish.test.sql:85-96` is the template; media rows need no Storage objects).
- `apps/dashboard/app/(dashboard)/settings/landing-page/components/{PageNameSection,LandingPageEditor,PublishScreen,UnpublishDialog}.tsx` -- selectors: `#pageNameInput`, "Claim name"/"Rename page", `#publishAttest`, "Publish page", "Unpublish"/"Unpublish page", testids `publish-success`, `public-address`; EN/FR labels in `locales/{en,fr}.json` under `pageEditor.*`.
- `supabase/migrations/0167:252,335` -- `take_down_gym_page`, `lift_gym_page_takedown` (need `private.is_super_admin_live()`; aal2 flag seeded off in `0126`).
- `scripts/ci-local.sh:144-170`, `.github/workflows/ci.yml:150-230`, `scripts/ci-local.selftest.sh`, `scripts/public-site-reader-sql.test.sh` -- e2e stage env, reader password; do not break the `|| return 1` pattern.
- `packages/page-templates/src/conformance/layout.ts:5,38` -- Chromium launch pattern; no LCP/CDP code exists anywhere, no lighthouse.
- `docs/decisions.md` (newest first; new section above the 24.11 heading at line 9), `sprint-status.yaml:475` (24-12 backlog; log lines from ~1790), `epic-24-context.md`.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/tests/` -- anon isolation (relations zero, pinned function allowlist, reachability) with known-bad runs; reader suite still passes
- [x] `scripts/landing-gate/{check-http,lcp,load}.mjs`, `purge-staleness.sql`, `run-local.sh`, README -- the kit, one command locally, `BASE_URL` for staging; unit-testable pure parts (p75, header diff, label generator) with tests; each check shown failing on a known-bad server or input
- [x] `apps/dashboard/e2e/landing-page-gate.spec.ts`, `playwright.config.ts`, fixture helpers, `ci-local.sh`, `ci.yml` -- page flows EN and FR with landing as a second server
- [x] Run the kit locally; if the pool or limit fails, fix it here; write results
- [x] `docs/decisions.md`, `deferred-work.md`, `sprint-status.yaml`, `epic-24-context.md` -- gate table, owner checklist, closed deferrals, honest OPEN list

**Acceptance Criteria:**
- Given the isolation suite, then reader and anon assertions pass and a stray grant or a new anon-executable function fails it (shown)
- Given a running landing server, then `check-http` passes on published, not-found and redirect and fails on a doctored server (shown)
- Given the local kit run, then LCP p75, peak role connections vs limit, and core probe medians with and without the scan are in decisions.md, labelled local
- Given `scripts/ci-local.sh`, `check-migration-guardrails.mjs` and `ci-local.selftest.sh`, per-stage lines read and one known-bad run, then all pass including the new E2E spec in EN and FR
- Given every deferred-work line naming 24.12, then it is closed with evidence or re-deferred with a reason
- Given the checklist, then every staging-only item is OPEN until the owner signs it; nothing is recorded PASS that was not run

## Implementation Notes

Built 2026-11-09, everything run locally (lab, local); the gate is UNSIGNED and every staging item is OPEN (`docs/decisions.md` 24.12 has the gate table, the owner steps and the checklist). Deviations the spec did not foresee: (1) `anon` keeps TRUNCATE, REFERENCES and TRIGGER on the `public` tables (Supabase default privileges), pinned in the test and deferred; (2) `proxy.ts` no longer answers a reserved or malformed label itself (the HTTP check found its headers differed from the other hidden causes); (3) the LCP baseline is OVER the assumed 3 s (3520 ms) and is recorded, not enforced; (4) the e2e stage cleans orphaned page audit rows around the pgTAP stage and the members-writer scan test lists the spec helper; (5) the E2E spec uses one gym per language, not the shared fixture gym. The pool of one connection held under the scan (peak 1 of 20), so no pool or `CONNECTION LIMIT` change and no migration.

## Spec Change Log

## Review Triage Log

Review 1 (blind, edge-case, verification-gap). No intent_gap or bad_spec; 0 loopbacks.

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | check-http hard-codes the body marker "GATE FIT" | medium | patch | `check-http.mjs` includes("GATE FIT"); any real staging page fails. Env `GATE_PUBLISHED_MARKER`. |
| 2 | redirect `location` is `undefined` in `{label}` (staging) mode | medium | patch | `check-http.mjs` ternary; a 301 to a wrong host passes on staging. Always pass the expected location. |
| 3 | staging with `GATE_LABEL_*` unset compares unknown with unknown | medium | patch | `config.mjs` defaults (gate-draft, gate-down) do not exist on staging; uniformity passes vacuously. Require explicit labels in `{label}` mode. |
| 4 | `diffResponses` only ignores Date; x-vercel-id / age / x-vercel-cache differ per request | medium | patch | `headers.mjs:129-141`; staging false-fail blocks signing. Ignore platform per-request headers when platform is set. |
| 5 | `peak > limit` unreachable (Postgres refuses above the limit) | medium | patch | `load.mjs judge`; saturation shows only as errors. Fail on `peak >= limit`. |
| 6 | sampler seeing no sessions passes vacuously (peak 0) | medium | patch | `judge` has no peak 0 guard. Fail when there are no samples or peak is 0 with requests made. |
| 7 | `regressed()` floor 20 ms contradicts spec "median rises over 25%" | medium | patch | `stats.mjs`, `BUDGETS.regressionFloorMs 20`; check-in median 13 ms can triple and pass. Floor to 0, record in decisions. |
| 8 | transport errors push `ms = 0` into the latency list | low | patch | `load.mjs` tally; skews median/p95 down. Direct correction. |
| 9 | exact AD-44 headers never asserted against real Next in anything CI runs | medium | patch | `check-http` runs only in `run-local.sh`; e2e asserts CSP substring only. Assert with `checkResponse` in the e2e spec. |
| 10 | anon column check misses `GRANT ... TO PUBLIC` (grantee 0) | medium | patch | `public_site_anon_isolation.test.sql:46` filters grantee = anon only. Add grantee 0 and a known-bad. |
| 11 | vault / net / cron excluded from the anon sweep with no assertion | medium | patch | purge job uses vault + net.http_post. Assert anon has no privilege on `vault` and `net` (and `cron` if present). |
| 12 | `core-probe` rpc() has no try/catch; failure kills the probe loop; Chromium not closed on a login failure | medium | patch | `core-probe.mjs:31-41`. Count errors, close browser in finally. |
| 13 | `lcp.mjs` records the LCP of a non-200 page | medium | patch | goto status unchecked. Fail unless 200. |
| 14 | CSP checked as a string only; a policy that blocks the banner or fonts passes | low | patch | lcp.mjs: fail on `securitypolicyviolation` / CSP console errors. Small. |
| 15 | e2e language test only compares two JSON files | low | patch | `landing-page-gate.spec.ts` first test; rename to what it checks. |
| 16 | `createPageGym` leaks gym + auth user when it throws before `pg` is assigned | medium | patch | spec/helper cleanup path; later runs trip the E2E Fixture Gym preflight. |
| 17 | `answers{}` persists across a Playwright retry | low | patch | `retries:1`; reset in beforeAll. |
| 18 | phone from `Date.now()` last 6 digits repeats | low | patch | intermittent unique violation. Random digits. |
| 19 | orphan page audit rows cleaned only after a passing e2e stage | medium | patch | `ci-local.sh clean_orphaned_page_audit_rows` skipped when e2e fails; next pgtap fails with an unrelated message. Clean regardless of outcome. |
| 20 | fixture `full-page.json` never validated against the page content schema | low | patch | drift makes http/lcp/load measure an impossible shape. Add a test if the schema is importable from the node test. |
| 21 | `import.meta.url === file://argv[1]` main checks (seed.mjs, media-stub.mjs) | low | patch | breaks on a path with spaces or a symlink; direct fix with pathToFileURL. |
| 22 | core-fixture does not check the created owner | low | patch | TypeError after partial inserts. One guard. |
| 23 | `wait_for` curl in run-local.sh has no timeout | low | patch | one flag. |
| 24 | `run-local.sh` header says "exit 0 only when all three pass" but LCP over target exits 0 | low | patch | doc contradiction; fix the comment and print a visible OVER marker. |
| 25 | landingGate.ts reads locales relative to cwd | low | patch | resolve from the file path. |
| 26 | reserved/malformed labels now cost a handler invocation; trade-off unrecorded | low | patch | decisions.md records why, not the cost. One sentence. |
| 27 | deferral lines for pooler run + purge staleness on the real stack closed on local evidence | medium | patch | deferred-work.md Closed section says the pooler run is still open; keep one open line pointing to the checklist rows. |
| 28 | wiring test composes proxy + handler only for reserved, not malformed hosts | low | patch | add malformed/depth host to `viaProxy` cases. |
| 29 | no real-HTTP header check on /sitemap.xml, /robots.txt, /report | low | defer | spec lists page, not-found, redirect only; 24.11 unit tests pin the handler. Deferred. |
| 30 | hosted DB has more platform schemas than the exclusion list (pgsodium, pgmq ...) | low | defer | staging step 7 is OPEN and will show it; noise, not a hole. |
| 31 | pgTAP test asserts no page audit rows db-wide (root cause of #19) | low | defer | pre-existing test, not caused by this story. |
| 32 | reader password defaults to "" so a misconfigured run fails late | low | reject | failing fast would break e2e runs that never touch the landing server; fix adds a branch with a downside. |
| 33 | landing webServer `reuseExistingServer` | low | reject | same pattern as the other servers in the config; unlikely. |
| 34 | LCP depends on the 147 KB stub gallery size | false | reject | decisions.md states the stub size and labels it lab, local. |
| 35 | shared seeded generator is timing-dependent; README says same seed repeats | low | reject | cosmetic wording; not used for a verdict. |
| 36 | 1 s sampler can miss short peaks | false | reject | spec says sample every second. |
| 37 | "scan to alert 3 s" measured as check-in RPC round trip | false | reject | spec Boundaries define the probe as the check-in RPC round trip. |
| 38 | purge-staleness not automated | false | reject | spec decision: a staging checklist query. |
| 39 | ci.yml reader-role step unexercised by ci-local | false | reject | a mistake fails loudly in the e2e job. |
| 40 | pure.test.mjs imports .ts, Node version unguaranteed | false | reject | `engines.node >=22.18` (type stripping on) and CI uses node 22. |
| 41 | anon TRUNCATE/REFERENCES/TRIGGER residue vs spec "zero table privileges" | false | reject | spec Boundaries already replaced the wording with the pinned list; disclosed in decisions and deferred-work. |

### Review Findings

bmad-code-review, 2026-11-09, full mode, working tree against baseline 5e21aa7 (3200 diff lines; `scripts/demo-gym/` excluded). Layers: Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor. Separate from the in-story Review Triage Log above.

- [x] [Review][Decision] Anon keeps TRUNCATE/REFERENCES/TRIGGER on every `public` table and pg_net's PUBLIC grants; the test exempts them, so Isolation "zero table privileges outside public_site" (AC 1) holds only against a weakened assertion (medium). Accept the pinned residue and say so in the AC, or require a revoke migration (spec Never forbids migrations; it would be a new story). [supabase/tests/public_site_anon_isolation.test.sql] RESOLVED by the owner 2026-11-09: accept the pinned residue (no revoke migration in this story); it stays recorded in decisions.md and deferred-work.md, and the owner signs the gate knowing it.
- [x] [Review][Decision] `apps/landing/proxy.ts` now rewrites reserved and malformed labels to the route handler (needed for byte-identical not-found, FR-207), so each such request costs a Node function invocation where 24.10 answered at the edge; unspecced product change (medium). Accept it, or make the proxy emit the handler's exact response itself. [apps/landing/proxy.ts] RESOLVED by the owner 2026-11-09: accept the rewrite and its invocation cost; no code change.
- [x] [Review][Patch] Records are stale: the sprint-status 24-12 entry says anon test 23 and kit 33 and "all six stages PASS on the dirty tree", but the file has `plan(30)` and decisions.md says 30 and 39; it predates review patches 1-28 and decisions.md still quotes the first run's timings. After the other patches, re-run `scripts/ci-local.sh` on the final tree and correct sprint-status and decisions.md (medium). [_bmad-output/implementation-artifacts/sprint-status.yaml:1839, docs/decisions.md]
- [x] [Review][Patch] Staging mode can pass vacuously: `GATE_LABEL_SUSPENDED` defaults to the nonexistent `gate-paused` in `{label}` mode (unknown compared with unknown) and `GATE_LABEL_REDIRECT_OLD=''` skips the redirect check that the Headers bullet requires. In `{label}` mode require the redirect label and drop the suspended cause unless set; update the config tests (medium). [scripts/landing-gate/lib/config.mjs:missingStagingLabels, labels]
- [x] [Review][Patch] `purge-staleness.sql` has no automated test, yet it closes the 24-11 deferral: add a rolled-back test on the migrated schema (no rows -> FAIL and non-zero; `record_page_media_purge_run(now(), true, ...)` -> PASS; `p_ok => false` -> FAIL), modelled on `scripts/public-site-reader-sql.test.sh`, wired into `ci.yml` and `ci-local.sh`. Also use `coalesce(finished_at, started_at)` in the FAIL message so a row with a null `finished_at` is not reported as "none ever" (medium). [scripts/landing-gate/purge-staleness.sql]
- [x] [Review][Patch] Landing webServer reuses any server already on port 3200 (`reuseExistingServer: !CI`), e.g. one left by `run-local.sh serve` with another reader password or older code, so a local E2E run can pass or fail against the wrong server; and an unset `PUBLIC_SITE_READER_PASSWORD` falls back to `""` and fails late as a 404 at "page shows". Set `reuseExistingServer: false` for the landing entry and fail the spec at start with a named error when the password is unset (low). [apps/dashboard/playwright.config.ts, e2e/landing-page-gate.spec.ts]
- [x] [Review][Patch] `core-fixture.mjs` checks only the database host with `assertLocal(adminDbUrl)`, then creates auth users with the service-role key against `SUPABASE_API_URL` unchecked; point it at a hosted project and it writes there (low, but production is live). Call `assertLocal(apiUrl)`. [scripts/landing-gate/core-fixture.mjs:12,64]
- [x] [Review][Patch] `scripts/landing-gate/README.md:17` says `run-local.sh` exits 0 "only when all pass"; an over-target LCP is recorded, not enforced, and exits 0. Correct it to match the script header (low). [scripts/landing-gate/README.md:17]
- [x] [Review][Defer] The OVER-3 s LCP (p75 3520 ms) may be an artifact of the media stub, which serves one 1600x900 image (~147 KB) for every key including the three gallery images; real derivative sizes were not checked — deferred: settled by the owner's staging LCP run (checklist row) and by sizing the stub's gallery images like the real derivatives.
- [x] [Review][Defer] "Pool of one holds" (peak 1 of 20) is true by construction for one landing instance; it does not exercise many Vercel instances against `CONNECTION LIMIT 20`, the 2 s checkout timeout under overlap, or the transient-error cached 404, and only p95 is reported — deferred: settled by the staging load run; the closing text should say what the local run cannot show.
- [x] [Review][Defer] No real-HTTP check sends spoofed `x-tenant-name` / `x-tenant-path` headers to the apex or to `/gym-site`; covered only by `gymSite.test.ts` and `wiring.test.ts` — deferred: settle by adding the request to `check-http.mjs` and running it on a real `next start`.

#### Rejected

- Hardcoded landing port 3200 in three places (merged into the reuse-server patch for the part that harms).
- `varyLanguage` option never set / lcp.mjs asks for `fr` on a monolingual page — low: the spec requires a page with both languages; the failure is loud and the fix adds a knob.
- LCP fixed 1 s wait, no warm-up run, 10 runs per language — low: lab baseline recorded as such, not enforced.
- Judge divides by a 0 ms baseline median / `GATE_LOAD_STEPS` parses to nothing — low: cannot happen for a real probe, and a bad setting already fails with "no request was made".
- `run-local.sh` reuses an existing dashboard build — low: documented (`GATE_REBUILD=1`); a wrong backend fails the probe loudly.
- Cleanup trap runs `seed.mjs down` before fixtures exist, `ss` missing — false/low: `down` is idempotent and removes only gate-namespaced gyms; the script already runs it at start.
- Core probe session expires after 1 h — false: a run takes minutes.
- `createSuperAdmin` leaks a user on partial failure, `removeGymRows` only logs — low: test helper on a throwaway local database.
- `ci-local.sh` alters the shared local reader password; audit-row cleanup not on a trap — low/false: local-only, and the cleanup also runs before the next pgtap stage; the by-hand run case is already in deferred-work.
- Hardcoded container name and password in `ci.yml` and `run-local.sh` — low: the repo's existing convention (`public-site-reader-sql.test.sh`).
- check-http / lcp / load not in CI — false: the spec defines the kit as run locally now and on staging by the owner; the header judge runs in `test:guardrails` and the E2E.
- Requests send `accept-encoding: identity` — low: the exact set is judged; the compressed case is a staging observation.
- "Closed" overstates the purge-job item — false: deferred-work.md:1988 says it is a staging checklist step with no deployed-stack evidence.
- E2E assertions thin (`lang` regex, locale-files test, no notification / sitemap / robots) — low: not in the spec's E2E list; the language checks come from the raw HTTP assertions.
- `media-stub.mjs` loads `sharp` — low: no new dependency added.
- ci.yml reader-role step first runs on Actions — false: already triaged #39; a mistake fails loudly, and Actions run at epic end by policy.
- Anon test brittle across hosted pg_net / platform schemas, `authenticated` residue unpinned — low: already in deferred-work.md, staging step 7.
- Duplicate doctored-response builders, stray blank line, unindented `try` — low: cosmetic.

## Design Notes

Local numbers are a proxy: same machine runs server, database and load, so connection and latency figures are a floor. The kit exists so the staging run is one command with the same assertions.

## Verification

**Commands:**
- `bash scripts/ci-local.sh` -- expected: every stage PASS
- `bash scripts/landing-gate/run-local.sh` -- expected: all three checks PASS, results printed
- `node scripts/check-migration-guardrails.mjs` and `bash scripts/ci-local.selftest.sh` -- expected: pass

**Manual checks (owner):**
- Staging: run the kit with `BASE_URL`, repeat the DNS precedence check over HTTPS on the real wildcard, Firefox and Safari `__Host-` cookie check, sign the checklist.
