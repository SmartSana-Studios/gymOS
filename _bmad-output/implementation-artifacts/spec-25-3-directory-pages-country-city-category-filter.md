---
title: '25-3 Directory pages: country, city, category filter'
type: 'feature'
created: '2026-11-12'
status: 'done'
baseline_commit: '6fdd444928fcb75164b2013023dc79a2306aefbb'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-25-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The 25.2 views exist but nothing shows them. A visitor cannot browse gyms by country and city or filter by type, crawlers get no `indexable` signal, and the 25.1 country names are still ICU short forms ("Congo - Kinshasa", "St. Lucia") that would become public headings.

**Approach:** Script-free HTML pages on `www.` in `apps/landing`, served by one Route Handler (`/{en|fr}/gyms`, `/{cc}`, `/{cc}/{city}`) that reads only the three 25.2 views as `public_site_reader`, with the AD-44 header set, `noindex` from the one `indexable` flag, a "Gyms" link on the home page, and a data-only migration that corrects the country names.

## Boundaries & Constraints

**Always:**
- Pages are not React App Router pages (those ship Next scripts). They are strings from `renderToStaticMarkup` (lazy `react-dom/server` import, as `renderPageAsync`), one inline `<style>` block, no `<script>`, no `style=""` attribute (CSP hash), no cookie, no third-party request. Headers come from ONE function: `Content-Type`, `Cache-Control: public, s-maxage=60` (`PAGE_CACHE_CONTROL`), the exact `contentSecurityPolicy(mediaOrigin, hash)` from `@gymos/page-templates`, `SECURITY_HEADERS_BASE`, plus `X-Robots-Tag: noindex` when not indexable. Every non-200 outcome (unknown country or city, bad locale, no `rootDomain` or `mediaOrigin`, database error, page beyond the last) is `notFoundResponse(rootDomain)`, the uniform not-found; a database error logs the code only.
- Data: only `public_site.directory_country`, `directory_city`, `directory_gym` through `readerSql.ts` constants (one unnamed statement each, `$n` params, no quotes in the text, so `scripts/public-site-reader-sql.test.sh` can load and run them as the reader). Gyms `order by lower(name), page_name`, `limit 20 offset (page-1)*20`. Offered categories are `select distinct category from directory_gym where country_code=$1 and city_slug=$2`.
- Routes `app/[locale]/gyms/[[...path]]/route.ts` (`nodejs`, `force-dynamic`). Locale is `en` or `fr` (`isLocale`); `{cc}` is lowercase alpha-2 only (`/CM/` is not-found); `{city}` is the exact `city_slug`. Served and canonical form has no trailing slash (Next 308s the slashed form; the 24.10 not-found links keep their slash). Canonical, `hreflang` en, fr and `x-default` (the `en` URL), and the language link use `https://www.{rootDomain}` from config (scheme `http` for localhost), never the request Host. Canonical of a filtered view is the unfiltered listing with no `page`; page 2 and up are self-canonical.
- `indexable` drives both `<meta name="robots" content="noindex">` and the header, from one boolean per page, tested together. Top page: always indexable. City page: `directory_city.indexable`. A filtered view (`?category=`) never carries `noindex` (AD-50: canonical is the single signal). Unknown or repeated `category` value is ignored (unfiltered view, canonical unfiltered); `page` that is not a positive integer is 1; a page past the last is not-found.
- Country page (closes the 25.2 deferral): its list, count and `indexable` come from the `directory_city` rows of that country. Count is their `published_count` sum `S`; `indexable` is `directory_country.indexable` AND `S == directory_country.published_count` (no second copy of the constant 3). A country with `S == 0` is not listed on the top page and its URL is not-found. Top-page cards use the same `S`.
- Top page: countries with Cameroon (`cm`) first on the same card as every other (no badge, no Cameroon-only wording, address format or structured data), then the rest by localized name (`Intl.Collator(locale)`). Empty state "No gyms are listed yet." / « Aucune salle n'est encore répertoriée. ». Count sentence, not numerals. The hero is copy only; the Africa map is a later story (deferred-work.md), so the hero markup keeps one free column from 1024 px for it.
- Rows show gym name, category label (`CHROME.categories[lang]`), city and optional 48 px logo (`${mediaOrigin}${DEFAULT_MEDIA_PATH}/${logo_key}`) or monogram tile, linking to `{scheme}://{page_name}.{rootDomain}/`; never banner, hours, plans or contact. City and gym names are shown as entered; every other label comes from a new EN/FR directory dictionary. Escaping is React's; hostile names are tested.
- Category pills are plain `?category=<code>` links, offered only for present categories, current one `aria-current="page"` with a check glyph; "All" link; filtered with no results shows the PS-06 stale-link text and a "show all" link. Paging is plain numbered links, shown only above 20 gyms. Breadcrumbs and a language link (same path and query in the other locale) on every page. Look per `apps/landing/DESIGN.md` and `DESIGN.md` "Public Directory": navy hero band, 76 px cards (1/2/3 columns), 80 px rows, 44 px targets, no motion.
- Fonts: Bricolage Grotesque 800 and Figtree (400 and 600, or the variable file) as woff2 in `apps/landing/public/fonts/` under stable names, taken from the main site's own `next/font` output or upstream, OFL licence file alongside, `font-src 'self'`, `font-display: swap`.
- Home: `nav.gyms` ("Gyms" / « Salles ») added to `lib/copy.ts`, shown in `SiteHeader` (nav row from `xl`, menu panel below) and `SiteFooter` as a link to `/{locale}/gyms`. No other directory content on the home page.
- Bare `/gyms` and `/gyms/*` on any non-gym host: one 307 to `/{negotiateLocale}/gyms/*` in `proxy.ts` (assumption). Gym hosts keep the 24.10 decision untouched.
- Country names: migration `0171_directory_country_names.sql` (provisional, next free at merge; data-only `update countries`, no schema change, no re-snapshot because names are read live) corrects these codes, EN then FR: AG "Antigua and Barbuda"; BA "Bosnia and Herzegovina"; BL "Saint Barthélemy"; CD "Democratic Republic of the Congo" / « République démocratique du Congo »; CG "Republic of the Congo" / « République du Congo »; GS "South Georgia and South Sandwich Islands" / « Géorgie du Sud et îles Sandwich du Sud »; HK "Hong Kong" / « Hong Kong »; HM "Heard and McDonald Islands"; KN "Saint Kitts and Nevis"; LC "Saint Lucia"; MF "Saint Martin"; MM "Myanmar" / « Myanmar »; MO "Macao" / « Macao »; PM "Saint Pierre and Miquelon"; SH "Saint Helena"; SJ "Svalbard and Jan Mayen"; ST "São Tomé and Príncipe" / « São Tomé-et-Príncipe »; TC "Turks and Caicos Islands"; TT "Trinidad and Tobago"; VC "Saint Vincent and the Grenadines" / « Saint-Vincent-et-les-Grenadines »; WF "Wallis and Futuna"; CC FR « Îles Cocos (Keeling) ». `scripts/rollback-0171-directory-country-names.sql` restores the 0169 values. A pgTAP file pins the corrected pairs and fails on `&`, ` - `, `St. ` or `SAR` in any `name_en` or `name_fr`, and on a changed row count.
- Gate reach (Epic 22 retro 66): a test enumerates every directory outcome (top, country, city, filtered, paged, bad locale, unknown place, empty, error) and asserts each goes through the one header function; `scripts/landing-gate/check-http.mjs` and `lib/headers.mjs` gain a directory response kind with seeded published gyms, run once for real against a started server (`run-local.sh http`) and once against a known-bad response (a `<script>` or a `Set-Cookie`) to show it fails (Epic 22 retro 77).

**Never:** No Africa map (split to a later story, deferred-work.md; the hero leaves room). No 301 for old city slugs (deferred-work.md: the reader has no view of `city_slug_history`; a renamed city's old URL is the uniform not-found; owner decision 2026-11-12). No structured data, `og:` tags, sitemap, robots, `llms.txt` or `www.` path allowlist (25.4, 25.5). No change to the 25.2 views, the reader role, `gym_pages` or any gym-host behavior. No client JavaScript, hydration payload, cookie, analytics, tile server or third-party font. No ranking, featured gym, gym position or banner. No Cameroon-only copy. No `database.ts` regeneration. No production deploy or Vercel setting.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error Handling |
|---|---|---|---|
| Nothing published | all views empty | `/en/gyms` 200, empty message, indexable | none |
| Cameroon plus another country | CM and SN gyms | CM card first, SN after, same card | none |
| Thin city (2 gyms) | `indexable` false | 200, same markup, `noindex` in meta and `X-Robots-Tag` | none |
| Filtered view | `?category=yoga_studio` | only that category, canonical unfiltered, no `noindex` even if thin | invalid code ignored |
| Stale filter | valid code, none in city | PS-06 message and "show all" link | none |
| 21 gyms | no filter | 20 on page 1, numbered links, `?page=2` shows 1 | `?page=3` not-found; `?page=x` is 1 |
| Removed gym | gym unpublished | absent from page, count and cards, within the cache bound | none |
| Country window | views disagree (`S` != country count) | counts use `S`, country page `noindex` | S = 0: not listed, URL not-found |
| Unknown place / locale | `/en/gyms/zz`, `/de/gyms`, `/en/gyms/CM` | uniform not-found | none |
| Hostile text | gym name `</script><img>` | escaped text, no markup | none |
| Bare path | `GET /gyms/cm` with `Accept-Language: fr` | 307 to `/fr/gyms/cm` | none |

</frozen-after-approval>

## Code Map

- `apps/landing/proxy.ts`, `lib/gym-site/request.ts` -- proxy: add the bare `/gyms` 307 on non-gym hosts only; `decideGymRequest` untouched
- `apps/landing/lib/gym-site/{handler,db,env,notFound,readerSql}.ts`, `app/gym-site/route.ts` -- pattern to copy: injected deps, lazy `pg` reader (`createReader`, retry), `readConfig`, `notFoundResponse`, force-dynamic Node route; add directory statements to `readerSql.ts`, methods to `createReader`
- `packages/page-templates/src/{headers,renderCore,renderPageAsync}.ts`, `src/chrome.ts` -- reuse `contentSecurityPolicy`, `styleHash`, `extractStyleBlock`, `PAGE_CACHE_CONTROL`, `DEFAULT_MEDIA_PATH`, `CHROME.categories`, `GYM_CATEGORY_LABELS`
- `apps/landing/lib/copy.ts`, `components/SiteHeader.tsx` (client component), `components/SiteFooter.tsx`, `lib/i18n.ts` -- add `nav.gyms` and the link; `isLocale`, `negotiateLocale`, `otherLocale`
- `apps/landing/DESIGN.md`, `_bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/{DESIGN.md "Public Directory", EXPERIENCE.md PS-04..PS-06}` -- tokens, sizes, copy (draft copy flagged `[ASSUMPTION]`)
- `apps/landing/public/fonts/`, `next.config.ts` (`/fonts/:file` already immutable) -- add the pair
- `supabase/migrations/0169_countries_cities.sql` (names, seed), `0170_directory_views.sql`; `supabase/tests/directory_views.test.sql`, `countries_cities.test.sql` -- view columns, fixtures to copy for the names pgTAP
- `scripts/public-site-reader-sql.test.sh` -- extend with the directory statements; `scripts/landing-gate/{check-http.mjs,lib/headers.mjs,seed.mjs,README.md,__tests__/headers.test.mjs}` -- the header test to extend
- `scripts/rollback-0169-countries-cities.sql` -- rollback shape; `docs/decisions.md` (newest first), `sprint-status.yaml`, `deferred-work.md` -- 25.3 entries; the two 25.3 deferrals (country names, country count from listed rows) are closed above

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0171_directory_country_names.sql`, `scripts/rollback-0171-directory-country-names.sql`, `supabase/tests/directory_country_names.test.sql` -- corrected names, rollback proven once locally, pins
- [x] `apps/landing/lib/directory/{copy,markup,headers,handler}.ts(x)`, `app/[locale]/gyms/[[...path]]/route.ts`, `lib/gym-site/{readerSql,db}.ts` -- dictionary, components, one header function, handler with injected deps, route, reader methods
- [x] `apps/landing/lib/directory/*.test.ts` -- every matrix row, hostile text, header table, noindex meta and header together, Cameroon order, 21-gym paging, country window
- [x] `apps/landing/lib/copy.ts`, `SiteHeader.tsx`, `SiteFooter.tsx`, `proxy.ts` (+ test) -- Gyms links and the bare-path 307
- [x] `public/fonts/*`, `scripts/public-site-reader-sql.test.sh`, `scripts/landing-gate/*` -- fonts, SQL harness, header test with a known-bad run
- [x] `docs/decisions.md`, `sprint-status.yaml` -- 25.3 entry (route shape, no trailing slash, country `S` rule, filtered never `noindex`, name list, fonts, the map and old-slug deferrals), `last_updated` line

**Acceptance Criteria:**
- Given `/{locale}/gyms`, when it renders, then every country with `S > 0` is listed, Cameroon first on an identical card, with the empty message when nothing is published
- Given a country or city URL, when it renders, then it lists gyms (name, category, city, canonical subdomain link) with `hreflang` en, fr, `x-default` and a self-referencing canonical built from the configured origin
- Given `?category=<code>`, when it renders, then only that category shows, canonical is unfiltered and there is no `noindex`
- Given `indexable` false, when the page is served, then `noindex` is in the meta tag and `X-Robots-Tag`, from the same boolean, tested together
- Given the corrected country names, when `countries` is read, then none keeps an ICU short form, in both languages
- Given the directory routes, when the landing-gate header check runs, then the AD-44 set holds, no cookie is set, `s-maxage` is at most 300, and the check fails on a known-bad response

## Implementation Notes

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|
| 1 | Database or render failure is the uniform not-found, cacheable 30 s, not a 5xx (blind, edge x2) | low | rejected | The frozen Boundaries say every non-200 outcome is `notFoundResponse`, the 24.10 pattern; the fix edits the spec. Recorded in decisions.md |
| 2 | Unknown query strings and `?page=1..999999` miss the CDN key and each cost 2 to 4 reads on the one-connection reader pool; 4 parallel queries on a pool of one (blind, edge x2) | medium (unverified) | defer | Real shape (Vercel keys the cache on the query), size of harm unmeasured; settled by extending `load.mjs` to the directory; entry added |
| 3 | Gym logo `alt` repeats the gym name inside the same link (blind) | low | patch | `markup.tsx:166` `alt={r.name}` next to the `h2`; direct fix `alt=""` |
| 4 | Pager has one link per page, no window (blind, edge) | low | rejected | Windowing adds branches; a city with more than a few pages is far from launch volumes |
| 5 | Title and description identical on page 2 and filtered views (blind) | low | rejected | Fix adds copy and branches; canonical already handles duplicates |
| 6 | Filtered view shows the unfiltered city count ("3 gyms" above 1 row) (blind, edge) | low | patch | `handler.ts:294` uses `city.publishedCount`; direct fix uses the filtered total when a category is set |
| 7 | Invalid gym page name dropped silently, count and rows disagree, stale message shown (blind, edge) | false | rejected | `page_name` comes from `page_names`, whose grammar the database enforces; the handler check is defence in depth only |
| 8 | "No Gym gyms in Douala yet." reads badly (blind) | low | patch | `copy.ts:68` interpolates the label as an adjective; reword so the category is not repeated before "gyms" |
| 9 | French typography (non-breaking space), "Salles à" with articles, draft copy has no gate (blind) | low | rejected | The UX copy is flagged `[ASSUMPTION]`, the owner confirms all draft copy (decisions.md); fix adds branches |
| 10 | Gym ordering uses the database collation, countries and cities the locale collator (blind) | low | rejected | Frozen spec and 25.2 decision: `order by lower(name), page_name` in SQL |
| 11 | No legal or contact footer, no OG, no BreadcrumbList (blind) | false | rejected | OG and structured data are 25.4 by the spec's Never list; chrome follows DESIGN.md "Public Directory" |
| 12 | Bare `/gyms/` takes two hops (proxy to `/en/gyms/`, then Next 308) and the test says "once" (blind) | low | patch | `proxy.ts` keeps the trailing slash; strip it in the redirect target and fix the test rows |
| 13 | Breadcrumb `key={c.label}` collides when a city has its country's name (blind, edge) | low | patch | `markup.tsx:223`; direct fix keys by index |
| 14 | Migration has no row-count check; regex covers four ICU patterns; hard-coded 249 (blind, edge) | low | rejected | Adds branches; the pgTAP file pins every corrected pair; 249 is the same pin 0169 made |
| 15 | Rollback has no automated test (blind, verification) | low | rejected | Repo rehearses rollbacks by hand; proven locally with a checksum |
| 16 | pgTAP pins `name_fr` for only some of the 22 rows (verification) | low | patch | A wrong French value for HM, KN, LC, MF, PM, SH, SJ, TC, TT, WF would pass; add the French assertions and update the plan |
| 17 | The Next route, real reader and real renderer are exercised by no test that CI runs; `check-http` is not in CI (verification) | medium | defer | By design of the 24.x gate kit (`run-local.sh`, owner-run); the implementer ran it against a built server; entry added |
| 18 | Mobile `countryNames.ts` keeps the ICU short forms (verification) | low | defer | Separate list for the phone picker, not the directory; entry added |
| 19 | City-less gym keeps the country page `noindex` for good (edge) | false | rejected | The 0169 triggers and the publish gate unpublish a gym without a city within the AD-46 bound (25.2 triage 1, deferred #7) |
| 20 | Repeated `?page=` takes the first value while `category` rejects repeats (edge) | low | rejected | Cosmetic; a duplicate crawlable URL self-canonicalizes |
| 21 | Blank gym name gives an empty link (edge) | false | rejected | `gyms.name` is NOT NULL with a CHECK and the snapshot always writes it (25.2 triage 2) |
| 22 | Other cosmetic items: double `extractStyleBlock`, mutated argument, comment order, deep import, hard-coded `cm`, non-string `code`, first code point monogram, FM/Cape Verde names (blind, edge) | low | rejected | No named harm; `cm` is the spec's own ordering rule |

### Review Findings

Independent re-review of commit ac4a8a9 (2026-11-12, bmad-code-review; Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor).

- [x] [Review][Decision] RESOLVED 2026-11-12 (owner said "decide"): new story 25.7 carries both; epics.md and sprint-status updated. The Africa map and the old city-slug 301 left the 25.3 criteria with no story to carry them — `epics.md` still lists both under 25.3 and 0169's header says the 301 serving is "25.5"; the deferred-work entries name no later story and `sprint-status.yaml` has no entry for either. Epic 22 retro 67: a deferral that must close before a later story is an acceptance criterion of that story. Choose the carrier (a new story, 25-6, or 25-5) and amend `epics.md`.
- [x] [Review][Patch] The language link is a relative path, the spec requires the configured `https://www.{rootDomain}` origin [apps/landing/lib/directory/handler.ts:frame, `languageHref`] — canonical and the three alternates use `ctx.www`, the language link does not; the test pins `href="/fr/gyms"` and decisions.md says all three use the configured origin.
- [x] [Review][Patch] No test checks that the two `@font-face` URLs resolve to real files [apps/landing/lib/directory/directory.test.ts:520] — the fonts test compares CSS strings only; deleting or renaming `public/fonts/figtree-variable.woff2` passes every CI stage and the pages fall back to system-ui silently. Add an exists, non-empty and `wOF2` magic-byte check over the URLs in `DIRECTORY_CSS`.

#### Rejected

- `?page=1000000` served as page 1 (acceptance) — low: no real listing has a million pages; the fix adds a branch.
- Gate seeds one published gym, so city and country are thin in the real run (acceptance, blind) — low: the spec says only "seeded published gyms"; the `indexable: true` side is pinned by the doctored-server tests.
- Spec `status: done` vs sprint-status `review`; three 25-3 `last_updated` lines (acceptance, blind) — process note; the fix edits the spec under review.
- Deep import of `@gymos/page-templates/src/headers` (acceptance) — false: same `contentSecurityPolicy` function, behaviour identical; already item 22.
- Gate does not assert thin pages are `noindex`; `category=gym` and `page=9` hard-coded (blind, edge) — low/false: staging mode returns before the city checks, locally the fixture gym is a `gym` in a 1-gym city; unit tests pin the flag.
- 307 test double has `no-store` but the proxy sets no cache header, and no `Vary: Accept-Language` (blind) — low: the apex `/` redirect has the same shape and has shipped; no cached-locale failure was shown.
- Reader-SQL harness expects exactly `CM|…|2` (blind, edge) — low: it runs on a clean CI database and `scripts/demo-gym` does not publish pages with a city.
- Gym ordering not proven against accented names (blind) — low: item 10.
- Database error is a cacheable 404 (blind) — item 1, spec-frozen.
- ICU check covers four patterns; FK, PS, UM, FM names (blind) — false for FK ("Falkland Islands") and the rest are the plain CLDR names, not short forms; item 14/22.
- Migration and rollback do not assert 22 rows updated (blind, edge) — low: items 14 and 15; the pgTAP file pins each corrected code.
- FR grammar ("Salles à Le Caire") (blind) — low: item 9, draft copy the owner confirms.
- Filtered view indexable while its canonical is `noindex`; duplicate title on page 2 (blind) — spec-frozen AD-50 and item 5.
- `directory_config_missing` logged on every request; missing `rootDomain` not logged (blind) — low: a misconfiguration signal, not a defect; the fix adds de-duplication state.
- `check-http.mjs` header comment numbers 1, 3, 2 (blind, verification) — low: cosmetic, item 22.
- City count sentence uses `city.publishedCount` when the views disagree (edge) — low: inside the AD-46 refresh window only; the spec says the unfiltered page uses the city's own count.
- Stale-filter page has no current pill (edge) — low: the fix adds a branch for a transient edge.
- Bare `/gyms` 307 for POST and PUT (edge) — low: the route answers 405/404 either way.
- Four parallel reads on the one-connection reader pool (edge) — already deferred in `deferred-work.md` (directory load check).
- Country page lists city cards, not gym rows (edge) — false: the I/O matrix and Code Map define the country page as city cards.

## Design Notes

`S`: the 25.2 country view counts by the snapshot country, the city views by the live `city_id`, so they can differ inside the AD-46 refresh window. The country page therefore trusts the rows it lists and goes `noindex` while the two disagree, without a second copy of the threshold. A filtered view is never `noindex` by the AD-50 text even when its listing is thin; its canonical points at the unfiltered listing, which carries the flag.

## Verification

**Commands:**
- `pnpm --filter @gymos/landing test && pnpm --filter @gymos/landing typecheck && pnpm --filter @gymos/landing lint` -- expected: pass
- `bash scripts/pgtap-run.sh supabase/tests/directory_country_names.test.sql supabase/tests/directory_views.test.sql supabase/tests/countries_cities.test.sql` -- expected: all pass
- `bash scripts/public-site-reader-sql.test.sh` and `bash scripts/landing-gate/run-local.sh http` -- expected: pass, plus the known-bad run failing as intended
- `pnpm check:migrations`; `bash scripts/ci-local.sh` -- expected: GREEN, per-stage lines read

**Manual checks (if no CLI):**
- Owner browser QA at epic end: `/en/gyms`, `/fr/gyms/cm`, a city with a filter, view-source shows no `<script>`.
