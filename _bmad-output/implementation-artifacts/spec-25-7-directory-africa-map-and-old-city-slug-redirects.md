---
title: '25-7 Directory Africa Map & Old City-Slug Redirects'
type: 'feature'
created: '2026-11-13'
status: 'done'
baseline_commit: 'aa244ee4407e4f7d5868e863953c91fb0b070f43'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-25-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/DESIGN.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The top directory page (`/{locale}/gyms/`) has no map, though the hero keeps a free column for one, and a renamed city's old URL `/gyms/{cc}/{old-slug}` is the uniform not-found because the reader role cannot read `city_slug_history`.

**Approach:** (A) Draw one Africa map as inline SVG in the top hero: country shapes generated at build time from Natural Earth 110 m into a committed module, dots placed at request time from `directory_city` lat/lng by a local Natural Earth projection proven equal to d3. (B) A fourth `public_site` view exposes only old-slug -> current-slug, and the directory handler answers it with a one-hop 301.

## Boundaries & Constraints

**Always:**
- AD-44: no script, no third-party request, no `style=` attribute, exactly ONE `<style>` block (map CSS goes into `DIRECTORY_CSS`); the SVG carries no `<style>`, `<image>` or external href.
- Map: top page only. `aria-hidden="true"` SVG, every link `tabindex="-1"`, dot hrefs root-relative `/{locale}/gyms/{cc}/{slug}`. Radius `5 + 3.2 * sqrt(gyms)` in a 760 viewBox, accent dot with 2 px navy-deep ring and 22 % halo (opacity breathing 2.6 s only under `prefers-reduced-motion: no-preference`), transparent hit circle of at least 44 CSS px, CSS-only label (city name and count) on hover/focus, hidden under 640 px. Land `#17253B`, countries with a listed gym `#2B4163`, borders the ground colour. Visible caption; it does not claim completeness. From 1024 px copy left and map right (runs 64 px into the light band); below, the map follows the copy, centred, 560 px at most.
- Dot position is the city's own lat/lng, never a gym position. A city without coordinates, or outside the map extent, has no dot but stays listed and counted. No published gym anywhere: no map.
- Natural Earth data is public domain; provenance (source, version, license note, generator command) is recorded in the generated module header and `docs/decisions.md`. The runtime projection is local code (no d3 at runtime); a test shows it equals d3's `geoNaturalEarth1` at sample points. d3-geo, topojson-client and world-atlas are devDependencies used only by the generator and that test.
- Redirect view reads `private.gym_page_visible` like every `public_site` view (the consumer scan enforces it): a row exists only while the old slug is inside its 12 months AND the current city still has a visible gym (otherwise the target 404s; keep both consistent). It exposes no id, one row per `(country_code, old_slug)`, reader role select only; grant test names it.
- Redirect: 301, `Location` = `https://www.{rootDomain}/{locale}/gyms/{cc}/{current}` (constant origin, query string dropped), `Cache-Control: REDIRECT_CACHE_CONTROL` (at most 5 min), `SECURITY_HEADERS_BASE`, empty body; the stored slug is re-validated with `isCitySegment` before use. Unknown slug, expired slug, no-visible-gym city and any database error stay byte-identical to the uniform not-found (`notFoundResponse`).
- Draft EN/FR map caption comes from EXPERIENCE.md PS-04 (flagged "copy to confirm").

**Never:**
- No map or highlight on country or city pages; no country zoom; no Cameroon-only treatment; no new column on `directory_city`, `gym_page_visible` or any 0169/0170 object; no change to `directoryHeaders`, CSP logic, the proxy allowlist, or country/city markup the 25.6 E2E pins.
- No tiles, map library, or web font at runtime. No redirect chains. No production migration apply in this story (0172 is provisional, next free at merge).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Map, normal | Published gyms in 3 cities with lat/lng | One dot per city, sized by count, each a `tabindex=-1` link; countries with a gym use the lighter fill | N/A |
| City without coordinates | Published city with null lat/lng | Listed in cards, no dot | N/A |
| Country off the map | Published gym in a non-African country | In cards and count, no dot, no fill | N/A |
| Nothing published | Empty views | Empty message, no map markup | N/A |
| Renamed city | `/en/gyms/cm/old-slug`, history row unexpired, current city has a visible gym | 301 to `/en/gyms/cm/new-slug` on `https://www.{root}` in one hop | N/A |
| Expired / never a slug | `expires_at` past, or unknown slug | Uniform not-found (404) | N/A |
| Current city unpublished | Old slug valid, city has no visible gym | Uniform not-found, not a redirect to a 404 | N/A |
| Reader error | Query throws | Uniform not-found, `directory_db_error` logged | Same as other directory reads |

</frozen-after-approval>

## Code Map

- `apps/landing/lib/directory/handler.ts` -- `handleDirectory` L73-119 (city branch yields null at `cityPage` L258): add the redirect branch there, modeled on `lib/gym-site/handler.ts` L113-127; `topPage` L172-206 adds map data, hidden when `cards` is empty
- `apps/landing/lib/directory/markup.tsx` -- `DIRECTORY_CSS` L76-136 (1024 px rule L135 is the kept column), hero L218-232: add map sibling of `.hero-copy` for kind `top`
- `apps/landing/lib/directory/{types,copy,indexable}.ts` -- `DirectoryReader` gains `readMapCities` and `readCitySlugRedirect`; copy keys `top.mapCaption` (en/fr); reuse `directoryPath`, `isCitySegment`
- `apps/landing/lib/gym-site/readerSql.ts` + `db.ts` (`createReader`) + `reader.test.ts` -- two new statements (no quote characters, no `;`, `$n` params); `wiring.test.ts` L16-40 pins (seven DIRECTORY_* statements, no lat/lng word) widened deliberately: only the map statement may name lat/lng, over `directory_city` only
- `packages/page-templates/src/headers.ts` L34 -- `REDIRECT_CACHE_CONTROL`, reuse
- `supabase/migrations/0172_directory_city_slug_redirects.sql` (new, provisional) -- view per 0166 `page_redirects` + 0170 grant/verify pattern; `scripts/rollback-0172-*.sql`; `city_slug_history` shape in 0169 L143-152 (`expires_at`, written only by `update_city`)
- `supabase/tests/public_site_reader_privileges.test.sql` (plan 77, view list L184, L198), `directory_views.test.sql` (consumer-scan list L273, plan 74), new `city_slug_redirects.test.sql`; `scripts/public-site-reader-sql.test.sh` (`DIR_NAMES`, fixtures: renamed city, expired row, unknown slug)
- `scripts/directory-map/generate.mjs` (new) + `apps/landing/lib/directory/africaMap.generated.ts` (new, committed) + `mapProjection.ts` (new) -- generator, data, projection; Africa extent, numeric-id to alpha-2 table in the generator
- `apps/dashboard/e2e/directory-gate.spec.ts` -- raw top-page and link-role assertions must still hold (aria-hidden map links are excluded from role queries); `scripts/landing-gate/lib/headers.mjs` `checkDirectoryDocument` must accept the SVG
- `docs/decisions.md` (25.7 entry), `deferred-work.md` (close the two "CARRIED by 25.7" entries), `sprint-status.yaml`

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0172_*.sql`, `scripts/rollback-0172-*.sql` -- fourth view `public_site.directory_city_redirect` (country_code, old_slug, city_slug), security_barrier, grants, comment, `$verify$` block; rollback proven on the local DB
- [x] pgTAP: privileges test, directory_views consumer scan, new `city_slug_redirects.test.sql` (valid, expired, unpublished current city, re-rename, duplicate old slug yields one row, no id column) -- each shown failing by mutation
- [x] `readerSql.ts`, `db.ts`, `types.ts`, `scripts/public-site-reader-sql.test.sh`, `wiring.test.ts`, `reader.test.ts` -- two statements, run as `public_site_reader` in the rolled-back proof
- [x] `handler.ts` -- redirect branch; map data on the top page; handler tests for every I/O row (fakes gain the new reader methods)
- [x] `scripts/directory-map/generate.mjs`, `africaMap.generated.ts`, `mapProjection.ts` -- generate from world-atlas 110 m, add devDependencies, tests: projection equals d3 at sample points, committed module equals a fresh generation, every African alpha-2 in `countries` has a shape or is listed as absent
- [x] `markup.tsx`, `copy.ts` -- map component, CSS inside `DIRECTORY_CSS`, caption; markup tests (aria-hidden, tabindex, no `style=`, one `<style>`, reduced-motion rule, no map on country/city, no map when empty)
- [x] `directory-gate.spec.ts` -- one E2E: rename a city, old slug answers 301 then 200; top page carries the map; existing flows unchanged
- [x] `docs/decisions.md`, `deferred-work.md`, `sprint-status.yaml` -- record provenance, the 0172 apply order (before the first production city rename), and close the carried entries

**Acceptance Criteria:**
- Given published gyms in cities with coordinates, when `/{locale}/gyms/` renders, then the hero holds one Africa map meeting every Always rule and `judgeDirectory` still passes
- Given a city renamed within 12 months whose current city has a visible gym, when the old URL is requested, then one 301 within the cache bound answers; after 12 months or for any other slug the answer is the uniform not-found
- Given the reader role, when it lists `public_site` views, then exactly seven views are readable (the six before plus the new one) and the grant test names `directory_city_redirect`
- Given the unit suites, `tsc`, lint and `scripts/ci-local.sh`, when run with `E2E_LANDING_PORT=3230`, then every stage passes with no `not ok` in the pgTAP log

## Implementation Notes

Migration 0172 (provisional): view `public_site.directory_city_redirect`; rollback script proven. Landing: `map.ts`, `mapProjection.ts` (local Natural Earth projection, equal to d3), `africaMap.generated.ts` (world-atlas 2.0.2, Natural Earth 110 m) from `scripts/directory-map/generate.mjs`; redirect branch in `handler.ts`; two reader statements. The hit circle is 44 view-box units, raised through CSS `r` on small screens: a fixed-size trade-off recorded in decisions.md. Small islands KM, ST, YT, SH have no shape but get a dot by coordinates; CV, MU, SC, RE project outside the box (no dot). Somaliland is drawn as part of SO. Three older pins of the public_site view list were widened (countries_cities, gym_page_publish, landing-gate removal NOT_A_SURFACE). pnpm-lock.yaml entries were applied by hand (pnpm add also bumped unrelated packages); `pnpm install --frozen-lockfile` passes. The full ci-local never passed in one go: pgtap failed twice inside public-site-reader-sql.test.sh (empty psql output, the known docker-exec flake), then 189/189.

## Spec Change Log

## Review Triage Log

Pass 1 (blind-hunter, edge-case-hunter, verification-gap): 0 intent_gap, 0 bad_spec, 5 patch, 0 defer, the rest rejected.

| Finding | Verdict | Evidence / route |
|---|---|---|
| Rollback of 0170 fails while 0172 exists, order not stated (verification-gap, blind, edge) | low | Real: rollback-0170 drops gym_page_visible without cascade. PATCH: state the order in the rollback-0172 header and decisions.md |
| Hit circle about 41 CSS px at 320 px (blind, edge) | low | Real, documented trade-off. PATCH: r 64 to 72 under 360 px |
| figcaption read by screen readers while the SVG is aria-hidden (blind) | low | Real, tiny. PATCH: aria-hidden on figcaption |
| Test name says the cards reach every city (blind) | low | Wording overstated. PATCH: reword |
| E2E finally skips the history delete if the rename back throws (edge) | low | Real test hygiene. PATCH: nested finally |
| Spec pgTAP task unticked (verification-gap, blind) | low | Fixed in the spec by the reviewer pass |
| Overlapping hit circles leave a larger dot partly unreachable (blind) | false | Inherent to the frozen 44 px rule with clustered cities; smaller dots are drawn on top by design and the country cards carry every link; owner browser QA |
| Map read failure turns the top page into 404 (edge) | false | The frozen I/O row says a reader error is the uniform not-found; tested |
| DIRECTORY_MAP_CITIES_SQL unbounded, JS filters (blind, edge) | false | Cities are a Super Admin controlled list; only rows with coordinates |
| dotRadius uncapped; label above the box for more than 60 gyms (blind, edge) | low, rejected | Radius formula is frozen; the label flip needs a new branch and is unreachable at launch scale |
| Touch devices get no label (blind) | false | Labels hidden under 640 px by the frozen spec |
| Lit fill contrast about 1.3:1 (blind) | false | Decorative per DESIGN.md; the cards carry the meaning |
| No 42P01 handling if landing deploys before 0172 (blind) | low, rejected | Same 404 as before plus a log line; apply order recorded in decisions.md |
| Second readCity on an unknown slug (blind, edge) | low, rejected | One indexed read on probes only; removing it needs a flag through cityPage |
| History and city country_code not compared (blind, edge) | false | update_city is the only writer and never changes the country |
| E2E rename passes p_aliases null (blind, edge) | false | 0169 comment: null keeps the aliases |
| dir_map exact output depends on local data (edge) | false | The script already asserts exact dir_countries counts on the same fixture assumption |
| Verify block hard-codes seven views (blind, edge) | false | Runs at migration time, when no later view exists; same as the 0170 pattern |
| Removal of the old URL after takedown not timed (blind, edge) | false | The view row disappears with the gym (pgTAP); a cached 301 lives at most 300 s, inside the 300/900 s deadlines, and shows only a former slug |
| Draft copy and Somaliland/Western Sahara choices need an owner follow-up (blind) | rejected | Copy is flagged in code and UX files; the boundary choice is recorded above; shown to the owner at present |
| LCP not re-measured with the map (blind) | low, rejected | Covered by the 25.6 lab LCP target and the decisions.md 25.6 checklist |
| Code Map lists files not changed; lock edited by hand (blind) | false | Code Map is guidance; frozen-lockfile install passes |

## Design Notes

Dots are positioned at request time, so the projection must exist at runtime: that is why it is local code with a d3-equality test, while the heavy shape data is generated once. The generated module stores the projection parameters (scale, translate, extent) so runtime and generator cannot disagree.

## Verification

**Commands:**
- `pnpm --filter @gymos/landing test && pnpm --filter @gymos/landing typecheck && pnpm --filter @gymos/landing lint` -- expected: pass
- `bash scripts/pgtap-run.sh` (new and edited files) and `bash scripts/public-site-reader-sql.test.sh` -- expected: all ok, no `not ok`
- `pnpm check:migrations` -- expected: OK
- `E2E_LANDING_PORT=3230 bash scripts/ci-local.sh` -- expected: all stages PASS (read per-stage lines)

**Manual checks (if no CLI):**
- Owner browser QA at epic end: map at 1280 px and 390 px, hover label, reduced-motion, FR caption.

### Review Findings

Code review of 77d5812, 2026-11-13 (second, independent pass: blind-hunter 12, edge-case-hunter 7, verification-gap 2, acceptance-auditor 5 raw findings; 4 entries survive, 0 deferred).

- [x] [Review][Patch] Overlapping hit circles: a smaller neighbour's 44-unit hit circle covers a larger dot's body (Douala and Yaounde about 18 view-box units apart), so the larger dot opens the smaller city's page. DECIDED by the assistant on the owner's "decide what is best": draw every visible dot body above all hit circles (two layers) so a dot always wins its own click; the 44 px hit rule is kept for the space around dots; the hit radius is not capped (that would contradict the frozen rule). Add a markup test for the layer order. DONE: `map-zone` links (hit circle + label) in a first layer, `map-dot` links (halo, point, label; halo pointer-events none) in a second; new layer-order test shown failing when the hit circle moves back into the dot layer; decisions.md entry added [apps/landing/lib/directory/markup.tsx:190, apps/landing/lib/directory/map.ts:52]
- [x] [Review][Patch] Close AC4: no single green `E2E_LANDING_PORT=3230 bash scripts/ci-local.sh` run exists for the final tree — the build notes say it never passed in one go (two pgtap flakes inside public-site-reader-sql.test.sh) and E2E was not re-run after the review patches (CSS hit radius, figcaption aria-hidden, e2e nested finally). Run it once, read the per-stage lines, record the result [spec AC4]. DONE 2026-11-13 on the final tree (dirty, no merge stamp): deno, pgtap (no 'not ok'), unit, layout, e2e PASS in one run; static FAILED in that run on 257 errors in the gitignored apps/dashboard/playwright-report/trace/*.js (stale Playwright artifact from an earlier e2e run that dashboard eslint does not ignore, not story code) and PASSED alone with --only static once the e2e stage had rewritten that folder. Not one single all-green run; the pgtap flake did not recur
- [x] [Review][Patch] `main.after-map` is never asserted present when the map shows — only the negative case (`not.toContain('class="after-map"')`) exists, so dropping the className or the `main.after-map{padding-top:104px}` rule passes every test and the desktop map covers the first card row. Assert `<main id="content" class="after-map">` and the rule in the normal map test; assert no class on `<main>` in the no-map top case [apps/landing/lib/directory/markup.tsx:175, apps/landing/lib/directory/directory.test.ts:~826]
- [x] [Review][Patch] Label `text-anchor` and the flip-below placement are untested in rendered markup — `map.test.ts` checks `anchor` data, `directory.test.ts` only the label strings. Assert `text-anchor="start"` for Dakar, `"end"` for Mogadishu in the HTML, and that a dot with `y < 40` renders its label at `d.y + d.r + 22` [apps/landing/lib/directory/markup.tsx:195, apps/landing/lib/directory/directory.test.ts:~821]
- [x] [Review][Patch] The hit-circle test claims "at least 44 CSS px" but only asserts the `r="44"` view-box attribute; the 320/360/390 px behaviour rests on the CSS `r` rules and prose in decisions.md. Reword the comment and test name to say what is checked (attribute plus the two CSS rules) [apps/landing/lib/directory/directory.test.ts:809]

#### Rejected

- Map read failure turns the top page into 404 (blind, edge) — false: the frozen I/O row says a reader error is the uniform not-found "same as other directory reads"; tested; a country-read failure does the same.
- Unknown city slug costs an extra `readCity` (blind, edge, auditor) — low, rejected: probe traffic only, one indexed read; the fix is a flag through `cityPage`; already rejected in pass 1.
- Map read unbounded and uncached, unused non-African rows read (blind, edge) — false/low: cities are a Super Admin controlled list, only rows with coordinates; wasted work only.
- Labels painted under later dots, magic `y < 40` (blind) — low, rejected: label stroke keeps it readable, fix needs z-order machinery.
- "Never a gym's position" test is vacuous (blind) — false: it fails if the top page ever reads gyms page 1; the SQL pin in wiring.test.ts is the main guard.
- E2E rename clobbers aliases, races, or its finally depends on the RPC (blind, edge) — false: 0169 says null aliases keeps them, E2E is serial, the finally is nested and runs the history delete even if the rename back throws; hard-coded count of 3 is the suite's own fixture.
- dir_map assertion depends on other local rows (edge) — false: same fixture assumption as the existing exact `dir_countries` counts in that script.
- Old slug now owned by another city / a gym-less live city shadowed (blind) — false: handler reads the live city first, and a gym-less city's page is a 404 either way.
- No index or EXPLAIN for the redirect view (blind) — maybe-false, would be low (probe traffic, tiny table): rejected.
- Draft copy and coordinate (0, 0) edge (blind) — false: copy flagged in code, UX file and for owner; null and empty coordinates are dropped in `readMapCities`, (0, 0) is a legitimate value.
- 0172 provisional numbering, code-before-view deploy logs db errors (blind) — low, rejected: apply order recorded in decisions.md, same 404 as before.
- No sprint-status entry in the diff (blind) — false: the review diff excluded `_bmad-output`; entries exist.
- decisions.md "27 KB" vs test name "26 KB" (blind) — negligible.
- Infinite halo animation, `outline:none`, no touch labels (blind) — false: decorative, aria-hidden, links are tabindex -1, labels hidden under 640 px by the frozen spec.
- Layout overlap is 64 px only when the map is the taller grid item (auditor) — low, rejected: owner browser QA covers it, a fix is a layout rewrite.
- `Location` scheme follows `schemeFor(rootDomain)` (auditor) — false: https in production, same as every other directory URL.
- 44 px hit rule met via CSS `r` (auditor) — merged into the test-wording patch; the trade-off is a recorded decision.
