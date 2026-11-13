---
title: '25-6 Directory gate: SEO verification and removal timing'
type: 'feature'
created: '2026-11-12'
status: 'done'
baseline_commit: '9b5559b8ec70bbab9f5d0a8fb31ca73a2cf74924'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-25-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Step 3 release gate (PRD 10.2; FR-211..FR-214, NFR-025) has no evidence yet: nothing measures how fast a removed gym leaves every public surface, nothing measures the speed of directory pages, the load check never touches directory routes, and the Rich Results Test, schema.org validator and Search Console steps have no runbook. No staging exists (owner decision 2026-11-09, still true), so those steps cannot run from here.

**Approach:** Build the gate the way 24.12 did: extend `scripts/landing-gate/` and add one E2E spec, run everything locally and label it LOCAL, and write the owner's staging and Search Console steps as an OPEN checklist in `docs/decisions.md`. The gate stays UNSIGNED until the owner runs those steps. The story closes on the kit and the local evidence, as 24.12 did.

## Boundaries & Constraints

**Always:**
- Removal surfaces, enumerated in one list (`lib/removal.mjs`) with a test that fails when a reader of the visibility predicate is missing from it (Epic 22 retro 66): the gym page, the gym-host `/sitemap.xml`, the city listing row and its count, the country page count, `www` `/llms.txt`, and the `www` sitemap (a city with exactly 3 gyms leaves `/sitemaps/1.xml` when one is removed). Cases: unpublish, takedown, suspension. Bounds (FR-207): origin <= 60 s; CDN <= 5 min and sitemap <= 15 min are proven by `Cache-Control: s-maxage <= 300` on every surface plus the origin time, and recorded as "by construction" locally, measured on staging only.
- `removal-timing.mjs` takes `BASE_URL`/`ROOT_DOMAIN` like the other scripts and a `--since <ISO time>` of the owner's action; it polls each surface until it drops and prints elapsed time per surface and case against the bounds. It never creates, publishes or removes anything.
- E2E `directory-gate.spec.ts`, EN and FR (Accept-Language), serial, own gyms and cities chosen from seeded cities nobody else uses, removed in `afterAll`: browse top -> country -> city; category filter (pills only for present categories; filtered view canonical to the unfiltered, no `noindex`); thin city (2 gyms) `noindex` and absent from the sitemap, 3 gyms indexable and present; removal on unpublish and takedown (and suspension) with the measured time asserted <= 60 s. Suspension uses the lifecycle job's transaction-local bypass scoped to one gym through a direct `pg` connection; never `run_saas_billing_lifecycle_job()` (it acts on every gym) and never a bare `gyms.status` update (it silently reverts).
- `seed.mjs` gains an opt-in realistic directory seed (`GATE_DIRECTORY_GYMS`, default 45 in Garoua plus 3 in one more city and 2 in a third), removed by `down`; `lcp.mjs` gains `GATE_LCP_TARGET=gym|directory-top|directory-city` (default `gym`, unchanged) and runs the directory targets in `run-local.sh lcp`; the p75 is recorded against 3 s, never enforced (the target stays an `[ASSUMPTION]`); output says LAB.
- `load.mjs` mixes directory requests (a share, default 20%) with random `?x=<n>` and `?page=<n>` values; it judges the same connection ceiling as today and reports directory latency separately. This closes the deferral naming 25.6 ("before the 25.6 release gate").
- `run-local.sh http` is run once on the final tree (closes the 25.5 deferral "at the latest ... before 25.6") and its result recorded.
- `docs/decisions.md` 25.6 entry: local gate table (command, result, where run), the OPEN owner checklist with exact URLs and commands (Rich Results Test and schema.org validator on one staging gym page and one city listing; Search Console property per host, sitemap submissions for `www` and one gym host, what to record, resolving the AD-52 `[ASSUMPTION]`; staging removal run with `--since`; a field LCP source), and a sign-off block left blank.

**Never:** No product code change, migration, view or grant. No staging or production call, no Search Console, Rich Results or schema.org request from this session (public URLs only; the owner runs them). No change to the AD-44 header set, the 24.11 files or the 25.5 chunk size. Do not enforce the LCP target. No claim that a local number signs the gate. No mock designs.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error Handling |
|---|---|---|---|
| Unpublish | Owner unpublishes a gym in a city of 3 | page 404, listing row and count gone, `llms.txt` block gone, city leaves the sitemap, each within 60 s | a surface still serving after 60 s fails the spec and names the surface |
| Takedown | Super Admin takes the page down | same surfaces; Owner still sees the banner | same |
| Suspension | gym suspended by the scoped bypass | same surfaces; republish is refused | same |
| Thin city | 2 gyms | 200, `noindex` (meta and header agree), not in the sitemap | n/a |
| Filtered view | `?category=` on an indexable city | canonical = unfiltered URL, no `noindex`, not in the sitemap | n/a |
| Staging poll | `--since` older than the first poll | elapsed is `drop time - since`; a surface already gone at the first poll prints "gone before the first poll", not 0 s | no `--since`: exit 2 |
| Known-bad | doctored server that keeps a removed gym in `llms.txt` or the sitemap | `removal-timing` and the spec's judge exit 1 naming the surface | node test shows it failing |

</frozen-after-approval>

## Code Map

- `apps/dashboard/e2e/landing-gate` pattern: `apps/dashboard/e2e/landing-page-gate.spec.ts`, `helpers/landingGate.ts` (`createPageGym` hardcodes Douala: add an optional city slug; reuse `landingGet`, `signedInClient`, `createSuperAdmin`, `removePageGym`); landing server already started by `playwright.config.ts` (root domain `localhost`, `www.localhost` Host header for the directory)
- Publish path without UI: `publish_gym_page`, `unpublish_gym_page` (0164), `take_down_gym_page` (0167), `claim_page_name` (0163/0167); city by `set_gym_location` with seeded city ids (0169: Douala, Garoua, Limbe, Kribi, Buea, Ebolowa, and others)
- `scripts/landing-gate/{seed.mjs,lcp.mjs,load.mjs,check-http.mjs,run-local.sh,README.md}`, `lib/{config,headers,http,stats,lcp,load,labels}.mjs`, `__tests__/` -- extend; new `lib/removal.mjs`, `removal-timing.mjs`
- `apps/landing/lib/{directory,crawl}/*` -- read only (what each surface returns; `SEO_CACHE_CONTROL`)
- `docs/decisions.md` (24.12 entry is the model), `scripts/landing-gate/README.md` (staging section), `sprint-status.yaml`
- Deferrals closed here: deferred-work.md "load check to the directory routes" (25-3 review) and "real-server proof ... before 25.6" (25-5 review)

## Tasks & Acceptance

**Execution:**
- [x] `scripts/landing-gate/lib/removal.mjs`, `removal-timing.mjs`, `__tests__/removal.test.mjs` -- surface list, poll/judge, CLI, known-bad cases
- [x] `scripts/landing-gate/seed.mjs`, `lcp.mjs`, `lib/config.mjs`, `run-local.sh` -- directory seed, directory LCP targets, wiring
- [x] `scripts/landing-gate/load.mjs`, `lib/load.mjs`, tests -- directory share with random query/page values
- [x] `apps/dashboard/e2e/directory-gate.spec.ts`, `helpers/landingGate.ts` -- EN/FR flows, removal timing, city parameter
- [x] `scripts/landing-gate/README.md`, `docs/decisions.md`, `sprint-status.yaml` -- manual, gate table, OPEN checklist, deferrals marked closed

**Acceptance Criteria:**
- Given a gym removed by each of the three causes, when the spec and `removal-timing` run locally, then every surface drops within 60 s at the origin, each time is recorded per case, and a doctored surface is shown failing
- Given the realistic seed, when `lcp.mjs` runs for the top and a city page, then p75 is recorded, labelled LAB, against 3 s with no enforcement
- Given the load check with directory requests, when it runs, then reader connections stay within the limit and directory latency is reported separately
- Given the E2E suite, when it runs (`scripts/ci-local.sh` with `E2E_LANDING_PORT=3230`), then the new spec passes in EN and FR and the 24.12 spec still passes
- Given `docs/decisions.md`, when the owner reads the 25.6 entry, then every staging step is a numbered OPEN item with its command and what to record, and the gate is stated UNSIGNED

## Implementation Notes

- Removal at the origin is instant (computed views), so every surface of every case was gone at the first poll (at most 0.1 s after the action); the report says "gone before the first poll", not 0 s.
- The realistic seed names sort after "GATE FIT" so the 24.12 fixture stays on page 1 of its city for `check-http`.
- Ports 3101 and 3200 cannot be bound on the machine of this run; the runs used `GATE_DASHBOARD_PORT=3111` and `E2E_LANDING_PORT`/`GATE_LANDING_PORT=3230`.
- `scripts/ci-local.sh` cleanup also removes orphaned `gym_category_changed` audit rows (the spec sets categories through the Owner RPC).

- Review patches (2026-11-13): `--mode cdn` no longer requires `s-maxage` (Vercel hides it); `removal-timing.mjs --check-visible` (run before the action) plus `--since`/`--poll-ms` checks; the E2E sitemap filter now runs on raw `<loc>` entries; per-surface first-poll stamp; the suspension refusal asserts "not active"; the 25-3 load-check deferral reads PARTLY CLOSED. Verification after the patches: landing-gate node tests 101 pass; `run-local.sh http` alone (small seed) PASS; full `ci-local.sh` (E2E_LANDING_PORT=3230): deno, static, unit, layout, e2e PASS; pgtap FAILED once on `scripts/super-admin-aal2.test.sh` ("both factors are still there: expected 2, got 3") and PASSED (188 files) when run alone right after. Cause of the one failure not established (no database or aal2 file was touched by this story); an implementation subagent may still have been running tests against the same local database at the time. Dirty tree, so no merge stamp.

## Spec Change Log

## Review Triage Log

Three layers (blind-hunter 13 findings, edge-case-hunter 17, verification-gap 0), none failed. Result: 7 patches, the rest rejected, 0 intent_gap, 0 bad_spec, 0 defer.

| # | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|
| 1 | `--mode cdn` fails every staging surface on a missing `s-maxage`; Vercel drops `s-maxage` from the client-visible `Cache-Control` (blind, edge) | high | patch | `lib/removal.mjs` `judgeRemoval` pushes "carries no s-maxage" in both modes, and the checklist runs `--mode cdn` with `GATE_PLATFORM=vercel`. In cdn mode the measured time is the proof, so the header rule applies to origin mode only |
| 2 | The spec's "no filtered view in the sitemap" assertion can never fail: `sitemapPaths` keeps `URL.pathname`, which has no query, then filters for `?` (edge) | medium | patch | `directory-gate.spec.ts` sitemapPaths/line 207. A gate must be shown capable of failing: filter the raw `<loc>` strings |
| 3 | `removal-timing.mjs` can PASS with nothing proven: a mistyped label/city, a gym that was never visible, or a row on page 2 all read as "gone before the first poll"; `--since` in the future and `--poll-ms` NaN are not refused (blind, edge) | medium | patch | Surfaces 404/absent = gone, so a wrong place is gone from the start; the E2E has `expectVisibleEverywhere`, the staging CLI has no equivalent. Fix: `--check-visible` (one `probeAll` before the action, exit 1 naming each surface that does not show the gym) plus the two one-line usage checks; checklist item 7 and README gain the step. Markup drift of the row/card probes is caught in CI by the same E2E precondition (rejected as a separate finding) |
| 4 | `firstPollAfterMs` is stamped once per round, so a surface probed late in a serial round has its "at most N s" understated (edge) | low | patch | `pollRemoval` round 0: direct correction, stamp it when that surface's probe starts |
| 5 | The suspension case accepts any error as "republish refused" (blind) | low | patch | `publish_gym_page` raises `... gym % is not active` (gym_page_publish.test.sql:631); assert that text so an unrelated error cannot pass |
| 6 | The load-check deferral is marked CLOSED 2026-11-12 though the work is dated 2026-11-13 and its CDN-key half is only provable on staging (blind) | medium | patch | `deferred-work.md` entry: mark PARTLY CLOSED 2026-11-13, keep the staging load run (checklist item 8) as the open half |
| 7 | The decisions row says `run-local.sh http` PASS, but the command shown ran all checks with the directory seed, while `http` alone uses the small seed the 25.5 deferral was written against (blind) | low | patch | Run `bash scripts/landing-gate/run-local.sh http` alone and record that; fix the row |
| 8 | `s-maxage` parser ignores `stale-while-revalidate`/`stale-if-error` (blind) | low | rejected | The cache header is the pinned AD-44 value (`public, s-maxage=300`, exact-set header test); no directive is emitted; fix adds parsing for a header the product never sends |
| 9 | Surface coverage gaps: country drop under `countryIsIndexable`, category pill, ItemList, deleted gym (blind) | low | rejected | The frozen Always enumerates the surfaces; the fix edits the spec |
| 10 | Brittle parsers: `countryCardCount` 600-char window, `cityPageCount` on "1,234", `readersOfPredicate` comments/policy/table/historical migrations (blind, edge) | low | rejected | The markup is the page's own and the E2E reads it from the real server; no city has 1,000 gyms; the scan fails closed (a dropped view needs a NOT_A_SURFACE line) |
| 11 | Coverage scan reads only `readerSql.ts` (blind, edge) | low | rejected | The other landing files name `public_site.*` only in comments (checked); all SQL lives in `readerSql.ts` |
| 12 | Constants copied into the kit (page size 20, `INDEXABLE_MIN` 3) (blind) | low | rejected | The spec states them; a drift turns the sitemap surface to a printed `n/a`, visible in every run |
| 13 | E2E weak: all drops at the first poll (blind) | low | rejected | True and recorded as Decision 4: the views are computed on read; the staging run is the one that can show a delay |
| 14 | Load check passes with directory OFF on staging; 20% directory share changes the baseline (blind) | low | rejected | The run prints "directory mix: OFF" and checklist item 8 says to set the variables; the Overview comparison is against the no-scan baseline, unchanged |
| 15 | `ci-local.sh` cleanup unverified in CI; `PUBLIC_SITE_READER_PASSWORD` in CI (blind) | low | rejected | `--only pgtap` passed after the fix; the e2e and rls-tests jobs use separate databases; the 24.12 spec already needs the password |
| 16 | Owner checklist lacks sign-off rule, URL Inspection, hreflang report, robots fetch, suspension restore steps (blind) | low | rejected | The sign-off is the owner's call; extra Search Console reports are not required by the story's ACs |
| 17 | Visible-before check ignores an error note; restore on a mid-test failure; restore to a prior status; `seedDirectory` not transactional; filtered `?category=` expected 200 (edge) | low / false | rejected | Playwright serial mode skips the rest after a failure and `afterAll` removes the gyms; fixtures are always `active`; `seed up` runs `down` first; a category absent from the city is a 200 with a message |
| 18 | The `llms.txt` surface counts as proven when the gym was past `llmsCap`; the sitemap surface when the country is thin (edge) | low | rejected | Needs 5,000 visible gyms or a thin country; `--check-visible` (patch 3) reports both before the action |

## Verification

**Commands:**
- `node --test scripts/landing-gate/__tests__/*.test.mjs` -- pass, including the known-bad removal and doctored-sitemap cases
- `GATE_LANDING_PORT=3230 bash scripts/landing-gate/run-local.sh` -- http and load PASS, lcp recorded for gym, directory top and city
- `E2E_LANDING_PORT=3230 bash scripts/ci-local.sh` -- every stage PASS, per-stage lines read

**Manual checks (owner, staging, OPEN):**
- Rich Results Test and schema.org validator on one gym page and one listing; Search Console sitemap acceptance for `www` and one gym host; staging removal run; field LCP.
