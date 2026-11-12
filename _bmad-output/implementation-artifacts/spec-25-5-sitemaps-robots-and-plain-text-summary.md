---
title: '25-5 Sitemaps, robots and plain-text summary'
type: 'feature'
created: '2026-11-12'
status: 'done'
baseline_commit: '770bcf450cbd6d20d71f7c81317cfcc5cb7447da'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-25-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `www.` has no sitemap, no `robots.txt` and no plain-text summary, so crawlers find directory pages only by following links, and nothing proves a removed gym or a thin listing stays out of what they are told to index.

**Approach:** Four dynamic Route Handlers on `apps/landing` read the same directory views and snapshot as the pages: `/robots.txt`, `/sitemap-index.xml`, `/sitemaps/{n}.xml` and `/llms.txt`. A listing is in the sitemap only when the page itself would be indexable, decided by one shared function.

## Boundaries & Constraints

**Always:**
- Sitemap entries, in this order: marketing `/en` and `/fr`; the top directory page in both locales; each country page and each city page in both locales, only when indexable; no gym page, no filtered or paged view. Country rule = the page's own (`country.indexable && s === country.publishedCount && s > 0`, `s` = sum of its city rows), extracted to one function the country page also calls; a city is listed only if its country is listed on the top page and its row is `indexable`. Every `<url>` carries `xhtml:link` alternates en, fr and x-default, equal to the page's own hreflang. All URLs are built from the configured `www.` origin, never the request Host.
- Chunks of at most `SITEMAP_CHUNK_SIZE = 50_000` entries (overridable in the handler deps for tests); the index lists `/sitemaps/1.xml` … `/sitemaps/N.xml` as absolute `<loc>`; chunk `n` outside 1..N, or not `^[1-9][0-9]*\.xml$`, is the uniform not-found.
- `robots.txt`: `User-agent: *`, `Allow: /`, `Sitemap: {www}/sitemap-index.xml`. No `Disallow` (a filtered view needs crawling to read its canonical).
- `llms.txt`: plain UTF-8 text, English, one block per visible gym ordered by page name, at most 5,000 gyms (a last line says the list is cut when more exist). Block fields: name, canonical subdomain URL, category label, city and country code, weekly hours as stored (`Mon 06:00-21:00`, closed days omitted, a line only when hours exist), public plans (`name: 15,000 XAF per month`). A gym appears only if its page would be served (valid content, registered template, one complete language). Fields come from an allowlist: no contact, address, map, about, services, colour or media. Gym text has line breaks and leading `#` or `-` collapsed so one gym cannot forge another block. The header documents it as a voluntary hint, not access control.
- Responses: 200 with `Cache-Control: public, s-maxage=300` (`SEO_CACHE_CONTROL`), `default-src 'none'; frame-ancestors 'none'`, the base security headers, no cookie; every other outcome (missing root domain, database error, bad chunk, non-GET) is `notFoundResponse`, logged with codes only.
- Gate reach (Epic 22 retro 66, 77): a test enumerates every consumer of the indexable decision (top, country, city page; sitemap; chunk) and fetches every `<loc>` of the index and each chunk through the real handlers expecting 200 and no `noindex`; the gym-host paths `/llms.txt`, `/sitemap-index.xml`, `/sitemaps/1.xml`, `/en/gyms`, `/en/gyms/cm` and `/robots.txt` of an unknown gym are each shown to be the uniform not-found; `check-http` runs the same against the built server and is shown failing on a doctored sitemap.

**Never:** No migration, no new view or grant. The 24.11 gym-host `/sitemap.xml` and `/robots.txt` stay byte-identical. No `sitemap.ts`, `generateSitemaps` or build-time file. No `lastmod`, `changefreq` or `priority`. No gym page in a `www.` sitemap. No allowlist or not-found change for other `www.` paths (marketing, `/privacy`, `_next`) — owner-visible later decision. No Search Console or Rich Results step (25.6). No directory page change other than calling the shared function.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error Handling |
|---|---|---|---|
| Nothing published | no rows | index with 1 chunk: `/en`, `/fr`, top page in both locales; `llms.txt` header only | none |
| Thin and ready | city A 2 gyms, city B 3 gyms | city B in the sitemap, city A not; both pages still 200 | none |
| Country disagrees | `s` ≠ country count | country page absent from sitemap, its indexable cities present | none |
| Removed gym | unpublish, takedown, suspension | gone from `llms.txt`, counts fall, thin city leaves the sitemap on the next read | none |
| Many entries | 25,001 cities | 3 chunks at size 50,000 over 50,002+ entries; a chunk has at most 50,000 `<url>` | none |
| Hostile text | gym name `</loc>\n## Evil` | escaped in XML contexts (none exist); one line in `llms.txt` | none |
| Gym host | `/llms.txt`, `/sitemap-index.xml`, `/en/gyms` | uniform not-found, byte-identical to an unknown label | none |
| Database error | reader throws | uniform not-found, `crawl_db_error` logged | no partial body |

</frozen-after-approval>

## Code Map

- `apps/landing/lib/directory/handler.ts` -- `countryPage` indexable expression (extract `countryIsIndexable`), `directoryPath`, `listedByCountry`, `schemeFor` use; reuse, do not change output
- `apps/landing/lib/directory/types.ts`, `lib/gym-site/{readerSql,db}.ts` -- add `CrawlReader` (`readIndexableCities`, `readLlmsPages`), SQL text with no quote characters, mapping; `scripts/public-site-reader-sql.test.sh` loads each statement as the reader
- `apps/landing/lib/crawl/{entries,xml,llms,handler}.ts` (new) -- entry builder, XML and text renderers, `handleCrawl` with deps injected; tests alongside
- `apps/landing/app/{robots.txt,sitemap-index.xml,llms.txt}/route.ts`, `app/sitemaps/[file]/route.ts` (new) -- thin routes like `app/[locale]/gyms/[[...path]]/route.ts` (nodejs, force-dynamic, other methods not-found)
- `packages/page-templates/src/seo.ts`, `index.ts` -- export the shared SEO header set (`seoHeaders(contentType)`); `renderSitemap`/`renderRobots` output unchanged
- `apps/landing/lib/gym-site/{gymSite,wiring}.test.ts`, `lib/directory/directory.test.ts` -- gym-host path rows, country-rule enumeration
- `scripts/landing-gate/{check-http.mjs,lib/headers.mjs,__tests__/headers.test.mjs,README.md}` -- crawler checks; `docs/decisions.md`, `sprint-status.yaml`, `ARCHITECTURE-SPINE.md` AD-52 as-built note

## Tasks & Acceptance

**Execution:**
- [x] `lib/directory/handler.ts`, `lib/directory/indexable.ts` -- one `countryIsIndexable`, called by the country page and the sitemap
- [x] `lib/gym-site/readerSql.ts`, `db.ts`, `lib/directory/types.ts`, `scripts/public-site-reader-sql.test.sh` -- the two reads and their reader-role proof
- [x] `lib/crawl/*`, `app/**/route.ts`, `packages/page-templates/src/seo.ts` -- handlers, renderers, routes, shared headers
- [x] `lib/crawl/*.test.ts`, existing gym-site and directory tests -- I/O matrix, chunking, every `<loc>` 200, hostile text, allowlist-only `llms.txt`, gym-host rows, 24.11 outputs unchanged
- [x] `scripts/landing-gate/*` -- crawler kind, index and chunk fetch, gym-host not-found, doctored-sitemap known-bad
- [x] `docs/decisions.md`, `ARCHITECTURE-SPINE.md`, `sprint-status.yaml` -- 25.5 entry

**Acceptance Criteria:**
- Given the index, when it and every `<loc>` in it are requested, then each returns 200, no URL is a gym page or filtered view, and none is `noindex`
- Given a thin listing, when its gym count reaches 3 or falls below, then it enters or leaves the sitemap on the next read with no other change
- Given `llms.txt`, when parsed, then it holds only allowlisted fields and no removed gym
- Given the 24.11 tests, when run, then they pass unchanged

## Implementation Notes

- Built by a subagent from this spec; verified by reading the diff and rerunning landing vitest (283 pass). The subagent also ran landing-gate node tests (71), `run-local.sh http` PASS, `public-site-reader-sql.test.sh` PASS (with a known-bad run), page-templates 178, and the full `ci-local.sh` (E2E_LANDING_PORT=3230) with every stage PASS on the dirty tree.
- Shared code: `lib/directory/indexable.ts` holds `countryIsIndexable`, the route grammar and `directoryPath`; `seo.ts` gained `seoHeaders` and an exported `xmlEscape` (24.11 output unchanged, pinned by `seo.test.ts`). SQL constants are `CRAWL_CITIES_SQL` and `CRAWL_PAGES_SQL` (the second uses `collate "C"`), named `CRAWL_*` so the 25.3 `DIRECTORY_*` enumeration is untouched.
- Matrix row "Many entries" misstates its arithmetic: 25,001 cities x 2 locales + 6 fixed entries = 50,008, so two files (50,000 and 8), not three. The frozen text is left as written; the test asserts two files and the rule (at most 50,000 `<url>` per file), and a lowered chunk size proves more files.
- Beyond the spec: the index, chunks and `llms.txt` answer the uniform not-found when the media origin is unset (the directory pages do the same, so the sitemap would advertise pages nobody can see); `robots.txt` needs only the root domain. `scripts/public-site-reader-sql.test.sh` gained a second three-gym city, so its 25.3 expectations moved (country count 5, two city rows).
- A row with an unregistered template is skipped from `llms.txt` without a log; invalid content logs paths only.
- `/en` and `/fr` are Next pages, so only the real-server `check-http` run fetches them (the vitest every-`<loc>` test skips them).

## Spec Change Log

## Review Triage Log

Three layers (blind-hunter 12 findings, edge-case-hunter 16, verification-gap 2 plus 2 notes), none failed. Result: 3 patches applied, 1 deferral, the rest rejected.

| # | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|
| 1 | `llms.txt` prints "per month" for a pay-per-session plan (blind, edge) | medium | patch | `llms.ts` `planLine`: the fixture `Per session` is `pay_per_session` with stored interval `monthly`, and the classic template hides the interval for that type (`index.tsx:112`), so the file told crawlers a per-visit price was monthly. Now "per session"; test expectation corrected |
| 2 | Sitemap alternates are only compared with the sitemap itself, never with the hreflang a page emits (verification-gap) | medium | patch | Shown: setting `xDefault` to the fr URL in `entries.ts` kept the old test passing for the page side. New gate-reach test parses `<link rel="alternate" hreflang>` from each `handleDirectory` response and compares it with the entry; it fails under that mutation |
| 3 | `check-http` skips the gym-host rows silently when `GATE_LABEL_UNKNOWN` is empty (blind) | low | patch | `check-http.mjs`: now prints a note saying the rows were not checked (a one-line direct correction) |
| 4 | Query string bypasses the CDN cache: `/llms.txt?x=N` reads up to 5,001 snapshots on the single pooled connection; a huge but well-formed chunk number costs three reads then a 30 s 404 (edge) | medium (unverified at load) | defer | Same exposure as every dynamic public route (a gym page or directory page with a varying query also reaches the database); the heavier `llms.txt` read makes it worth a platform answer (WAF rate rule, or a per-instance memo), not a handler guard. In `deferred-work.md` |
| 5 | Response size: 50,000 entries x 3 alternates is far above Vercel's 4.5 MB function response limit; `llms.txt` bounded by count, not bytes (blind, edge) | low | defer | Reachable only at tens of thousands of listings. Recorded in the same deferred entry |
| 6 | Database error answers a cached 404, not 503 (blind) | low | rejected | The spec's Always names the uniform not-found for every non-200 outcome, as the directory and gym handlers do; the fix edits the spec |
| 7 | `llms.txt` cap counts skipped rows; cut line printed though fewer blocks (blind, edge) | low | rejected | Needs 5,000 visible rows and invalid ones among them; the fix adds a fetch loop |
| 8 | Skipped rows not traceable: no page name in `crawl_content_invalid`, no log for unregistered template (blind) | low | rejected | The spec says "codes only"; the page handler logs the same way |
| 9 | Bidi and zero-width characters, no length limit in `oneLine`; `c.category` or `c.country` unsanitised (blind, edge) | low / false | rejected | `category` and `country` are validated by the strict schema (`gymCategorySchema`, `^[A-Z]{2}$`) before `renderLlms` sees them; the forging guard (one line, no leading `#` or `-`) is the spec's requirement |
| 10 | `llms.txt` departs from the llmstxt.org layout (blind) | low | rejected | The spec fixes the block fields; the fix edits the spec |
| 11 | Reads are not one snapshot; each request does the whole work (blind, edge) | low | rejected | Seconds of skew inside a 15-minute bound; the spec asks for request-time reads with `s-maxage` |
| 12 | Gate `url:` regex accepts a foreign host; `checkUrlset` does not check alternate origin; single-quote meta regex (blind) | low | rejected | The unit tests pin origin, shape and `Disallow`; the gate checks the built server's file shape |
| 13 | `robots.txt` answers 200 while the media origin is missing and the index 404s (edge) | low | rejected | A misconfiguration where every directory page is also not-found; the spec's `robots.txt` needs only the root domain |
| 14 | A non-database exception is logged as `crawl_db_error` (edge) | low | rejected | Same event name as the directory handler; no caller reads it |
| 15 | Duplicate country rows (edge) | false | rejected | `directory_country` groups by code: one row per country |
| 16 | The reader SQL proof fails on a populated local database; lost its thin-country case (edge, blind) | low | rejected | The 25.3 expectations already had this sensitivity; thin and disagreeing countries are proved in pgTAP (25.2) and in the in-memory world test |
| 17 | `countryIsIndexable` adds `s > 0`; "country listed" wording; indexable city of a noindex country is listed (edge, notes) | false | rejected | The country page returns not-found at `s = 0`, so its output is unchanged; the "country disagrees" test asserts the intended behaviour (the country page is absent, its indexable city present) |
| 18 | `collate "C"` order not pinned by the SQL proof (verification-gap) | low | rejected | Affects only which gyms fall past a 5,000 cap; `wiring.test.ts` pins the clause text |
| 19 | Real-routing proof of the four routes is the manual `run-local.sh http` run, not `ci-local.sh` (verification-gap note) | low | rejected | Same arrangement as 25.3 and 25.4; the subagent ran it and PASSED |
| 20 | Hygiene: four near-identical route files, brittle `indexable` source scan, `for (const n of [1])`, `xmlEscape` exported (blind) | low | rejected | Each route file is the established 25.3 shape; the scan is meant to fail on a new reader; no named harm |

## Design Notes

`llms.txt` reads `public_site.pages` (the AD-46 snapshot, hours and plans live only there; the directory views carry neither) with the strict `parsePageContentV1`, so a row the page would refuse is skipped and logged. The 5,000 cap bounds memory and response size; it is a documented ceiling for a voluntary hint, raised when a platform nears it. A sitemap entry per locale (not per place) keeps each `<loc>` a real URL with its own self-canonical.

## Verification

**Commands:**
- `pnpm --filter @gymos/landing test && pnpm --filter @gymos/landing typecheck && pnpm --filter @gymos/landing lint` -- pass
- `pnpm --filter @gymos/page-templates test && pnpm --filter @gymos/page-templates typecheck` -- pass
- `node --test scripts/landing-gate/__tests__/` and `bash scripts/landing-gate/run-local.sh http` (GATE_LANDING_PORT=3230) -- pass, plus the doctored sitemap failing
- `bash scripts/public-site-reader-sql.test.sh` -- pass
- `bash scripts/ci-local.sh` (E2E_LANDING_PORT=3230) -- every stage PASS, per-stage lines read

**Manual checks (if no CLI):**
- Owner at epic end: `www.` `/robots.txt`, `/sitemap-index.xml`, `/llms.txt` in a browser; Search Console submission is 25.6.
