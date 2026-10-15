# Adversarial and fact-check review: AD-49..AD-52 (V1.7 Step 3, directory and SEO)

Date: 2026-10-15. Scope: AD-49..AD-52 only, read against FR-208..FR-214, NFR-024..026, AD-42..AD-48. Spine not edited.

## Part 1. Adversarial findings

Each finding names two units that obey every AD yet diverge or leave a hole.

### Critical

None.

### High

**H1. The "sitemap index" does not exist as specified (AD-52).**
Next.js `generateSitemaps` emits chunk files at `/sitemap/[id].xml` and no index document (see fact F2). AD-52 says `sitemap.ts` + `generateSitemaps` "produces a sitemap index plus chunks" and robots points `Sitemap:` at "the central index". Unit A (robots route) writes `Sitemap: https://www.gymosapps.com/sitemap.xml`, which 404s because only `/sitemap/0.xml` exists. Unit B (sitemap) ships chunks and believes the index is free. Fix: name an explicit route handler that writes the `<sitemapindex>` (and says which URL robots.txt cites), with a CI test that fetches every `<loc>` in the index and the robots target.

**H2. Sitemap freshness silently defeated by Next default caching (AD-52 vs AD-46).**
Next's `sitemap.ts` is a cached route handler by default unless it uses a request-time API or dynamic config (F2). AD-52 requires regeneration at most 15 min and `s-maxage` at most 300, and introduces a `public_sitemap_refresh` cron with no stated output. The landing role is `default_transaction_read_only`, so the cron cannot write a table, and AD-49 forbids listing tables. A story that follows the letter ships a build-time static sitemap: an unpublished gym stays listed until the next deploy, breaking FR-207 and FR-214 with every AD "satisfied". Fix: state the mechanism (`export const revalidate = 900` or `dynamic = 'force-dynamic'` plus CDN `s-maxage`) and delete or define the cron's output artifact.

**H3. Cross-host `Sitemap:` design is unproven at the scale it implies (AD-52).**
Per host `robots.txt` pointing at one central index means N thousand hosts each cite a file listing all N hosts. sitemaps.org permits cross-submission only for hosts that cite the sitemap (F4), and Google's own guidance is one sitemap per site containing only that site's URLs, referenced from that site's robots.txt (F3). No source confirms Google honors a combined multi-host index this way; the ASSUMPTION marker defers it to a Search Console check that cannot cover thousands of hosts. Simpler and standard-conformant: each gym host serves its own `/sitemap.xml` with its single URL, robots cites that; the `www` index lists only `www` URLs (directory). Discovery then rests on directory links, so see H4.

**H4. Thin-listing rule can orphan gym pages (AD-49 vs AD-50 vs AD-52).**
`indexable = published_count >= 3`. Below it the listing is excluded from the sitemap (AD-52), but AD-49/AD-50 never say the page itself emits `noindex`. Unit A omits it from the sitemap only (thin page still indexable via links); unit B adds `noindex,follow`. Worse: if all listings are noindex at launch (FR-212 expects this) and gym hosts' sitemaps are not discoverable (H3), gym pages are reachable only via links on noindex pages, and Google reduces link-following on long-term noindex pages (unconfirmed, F6). Fix: AD-49 must declare `indexable=false` => `<meta robots noindex,follow>` AND sitemap exclusion from the same boolean; and at launch the gym page URLs must be submitted by a path that does not depend on listings.

**H5. noindex plus canonical-to-unfiltered on filtered views (AD-50).**
AD-50 gives `?category=` views both `rel=canonical` to the unfiltered listing and `noindex, follow`. Google says not to use noindex to steer canonical selection and calls canonical the preferred mechanism (F5); conflicting signals can leave Google ignoring either. Pick one: canonical only (the page stays crawlable, consolidates), or noindex only with a self canonical. Also state that `robots.txt` must not disallow `?category=` or the canonical is never seen.

**H6. City and country place data change out from under snapshots (AD-49 vs AD-46).**
AD-46's trigger fires on "every source column in the projection". A Super Admin editing `cities.name`, `cities.slug`, `aliases`, or moving a city is not a tenant column, so `gym_pages.content` keeps the old city (page JSON-LD `addressLocality` and body) while `directory_city` joins live and lists the gym under the new name. Slug change has no redirect lifecycle (AD-45 covers only page names), so `/fr/gyms/cm/old-slug/` 404s and its inbound links die. Aliases are unconstrained arrays: two cities in one country can share an alias, so normalization at entry is non-deterministic. Fix: trigger on `cities`/`countries` that refreshes dependent snapshots; slug immutable or a `city_slug_redirects` table; unique alias per country enforced by a normalized unique index.

**H7. The `{country}` URL segment is undefined (AD-49/AD-50).**
`countries(code, name_en, name_fr)` has no slug; `cities` has one slug for both locales. The path `/{en|fr}/gyms/{country}/` could be ISO code (`cm`), an English slug, or a localized slug. Unit A builds `cameroon`, unit B `cm`; the localized variant breaks hreflang symmetry (the `/fr/` and `/en/` alternates would have different path segments with no mapping). Fix: pin `{country}` as lowercase ISO alpha-2 and `{city}` as the single ASCII slug, same in both locales.

**H8. Directory is reachable on every gym host (AD-43 vs AD-50).**
The wildcard attaches to the same project that serves `www`. The directory routes `/{en|fr}/gyms/...`, `/llms.txt`, `/sitemap/*.xml` are ordinary paths, so `{name}.gymosapps.com/en/gyms/` resolves (or is rewritten to the single gym route by AD-43, in which case `robots.txt`, `llms.txt` on gym hosts are swallowed). Canonical built from the request Host would self-canonicalize thousands of duplicate directories. Fix: canonical origin comes from a constant, never from Host; the proxy rule must list which paths are served on gym hosts (`/`, `/robots.txt`, `/sitemap.xml`) and 404 the rest; `www`-only paths 404 on gym hosts.

### Medium

**M1. Staleness windows disagree.** Unpublish: page 404 in about 60 s to 2 min (AD-46), listing responses `s-maxage` up to 300, sitemap up to 15 min. Dropping from 3 to 2 gyms flips a listing to noindex while the sitemap still lists it for up to 15 min ("Submitted URL marked noindex"). A gym oscillating around the threshold flaps. Add hysteresis or accept and document. ItemList on a cached listing can cite a URL that now 404s.

**M2. `published_count` grain is unspecified.** Country view counting gyms across cities vs per city; a category-filtered view's count vs total. Define one grain per view.

**M3. Pagination and size of listings unspecified.** A city with hundreds of gyms: pagination parameter, canonical per page, ItemList size, statement_timeout (AD-42, a few seconds) for the query.

**M4. Cost on the pooler role.** A 50,000-row chunk query, `llms.txt` (every gym, every plan, one response, no pagination) and the count query run as `public_site_reader` with a few-second `statement_timeout` and a low `CONNECTION LIMIT`. `llms.txt` is unbounded and will time out or exceed response limits as gyms grow; cap it, paginate (`/llms.txt` as index to chunks), or generate from the same chunk source. Needs keyset (not OFFSET) chunking so chunks are stable when rows are inserted.

**M5. Gym pages have no stated canonical (AD-50).** "One URL each" but no `rel=canonical` rule: `?utm_*`, trailing slash, uppercase host, `http`. Add absolute self-canonical from the constant origin.

**M6. llms.txt content hygiene (AD-52).** "From the same views" means it cannot expose non-projection fields, but a story using `select *` on `directory_gym` publishes more than the FR-211 list (name, category, city, hours, public plans), such as phone and address. Enumerate columns. Gym-authored strings (name, plan names) flow unsanitized into a file consumed by AI crawlers: strip newlines and markdown control characters; this is a prompt-injection channel.

**M7. Structured-data edge cases (AD-51).** (a) Hours: overnight spans, closed days, 24 h (`00:00` to `23:59`), multiple intervals per day; no rule for each. (b) `telephone` must carry country code (F7); stored format unspecified. (c) `@context` and `@type` not stated. (d) The FR-199 gate requires hours, so "no hours" cannot publish, but the serializer should still omit rather than emit an empty array if a snapshot predates a rule change. (e) `geo` omitted without map position is correct (F7 lists it as recommended, precision at least 5 decimals when present). (f) `ItemList` has no Google rich result for gyms (F7); it is valid markup and harmless, but "validates with zero errors" does not mean "eligible". (g) `image` comes from the media origin on a different registrable domain: confirm it is crawlable (no `robots.txt` block, no hotlink protection).

**M8. hreflang details (AD-50).** `x-default` target not named (which locale?). Filtered and paginated variants: no hreflang rule. The bare `/gyms/` and `/` behavior (redirect vs negotiation) is unspecified, so a story may add `Accept-Language` negotiation on the directory root and cache it without `Vary`. Every alternate must link back; add a test that crawls the pair set.

**M9. AD-44 vs AD-48/AD-51 on "no script".** AD-44 says gym pages emit no `<script>` and that the build test asserts none. JSON-LD is a `<script type="application/ld+json">`. A strict "no `<script` substring" header/HTML test will fail on every page, or a story will relax it. State that only `type=application/ld+json` is allowed and assert exactly that. (It is not blocked by `script-src 'none'`, F8.)

### Low

- L1. `sitemap` `lastmod` not specified; Google uses it only when reliably accurate; use `gym_pages.updated_at`, omit `changefreq`/`priority`.
- L2. A gym with no map position still renders; make sure the template has no map component fallback that fetches a third-party tile (CSP `connect-src 'none'`).
- L3. `statement_timeout` for the count in `generateSitemaps` runs at build/ISR time and can fail the build if the DB is slow; give it a fallback.
- L4. Category rename or removal (FR-213 audited) changes filter codes in canonical `?category=<code>` URLs; codes must be stable.

## Part 2. Fact-check

| # | Claim in AD-49..AD-52 or brief | Verdict | Source |
|---|---|---|---|
| F1 | A sitemap is limited to 50,000 URLs and 50 MB uncompressed | **Confirmed.** Also: a sitemap index may list at most 50,000 sitemaps and is itself capped at 50 MB | sitemaps.org/protocol.html; developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap |
| F2 | Next.js 16 `sitemap.ts` + `generateSitemaps` "produces a sitemap index plus chunks" | **WRONG on the index.** `generateSitemaps` yields chunk files at `/.../sitemap/[id].xml`; the docs describe no index document; `id` is a `Promise<string>` since v16.0.0 (AD must `await` it); `sitemap.js` is cached by default unless a request-time API or dynamic config is used. The `generateSitemaps` reference page itself was not fetched, so "no index anywhere" rests on the file-convention page | nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap (lastUpdated 2026-08-18) |
| F3 | Cross-host `Sitemap:` in robots.txt is a legitimate submission mechanism | **Confirmed** as a mechanism (Google: host sitemaps on one site, reference from each site's robots.txt). **Unconfirmed** that one combined multi-host index referenced from thousands of hosts is processed as intended; Google's example is one sitemap per site containing only that site's URLs | developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap |
| F4 | A sitemap on `www` may list gym-subdomain URLs | **Confirmed only via cross-submit.** By default a sitemap can list only URLs on its own host and protocol; each target host's robots.txt must cite it | sitemaps.org/protocol.html |
| F5 | Canonical to unfiltered plus `noindex` for a filtered view is the right pattern | **Unconfirmed / contradicted.** Google: "We don't recommend using noindex to prevent selection of a canonical page within a single site"; rel=canonical is the preferred solution. Google's page has no filtered-view-specific guidance | developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls |
| F6 | `noindex, follow` keeps passing link discovery on thin listings | **Unconfirmed.** Not in the fetched sources; Google has said long-term noindex pages are eventually treated as nofollow (from memory, not verified here) | not verified |
| F7a | schema.org `HealthClub` is valid for gyms | **Confirmed.** HealthClub is a subtype of both HealthAndBeautyBusiness and SportsActivityLocation, both under LocalBusiness | schema.org/HealthClub |
| F7b | Google LocalBusiness required/recommended properties | **Confirmed.** Required: `address`, `name`. Recommended: `geo` (at least 5 decimals), `openingHoursSpecification`, `telephone` (with country code), `url` (working link), `priceRange` (under 100 chars), `aggregateRating`, `review`, `department`, `menu`, `servesCuisine`. `image` is not in the LocalBusiness table | developers.google.com/search/docs/appearance/structured-data/local-business |
| F7c | `ItemList` of `ListItem` on directory listings | **Valid markup; no gym rich result.** The LocalBusiness page does not mention ItemList; Google's carousel feature covers specific verticals (restaurants) only. Treat as an AI/semantic hint, not an eligibility claim | same page |
| F8 | JSON-LD `<script type="application/ld+json">` is not blocked by `script-src 'none'` | **Unconfirmed from a primary source, strongly supported by reasoning.** CSP governs script execution; a non-JavaScript MIME data block is not executed. No primary source (HTML spec, browser bug) found in this pass; verify in the AD-44 header test by rendering a page with the exact policy and checking the console for violations | search results only (W3C CSP2 policy applicability; MDN-style summaries) |

## Verdict

AD-49 and AD-51 are sound in shape. AD-52 and AD-50 carry the rework: H1, H2, H3 (sitemap index, freshness, cross-host design), H4/H5 (indexing signals), H6/H7/H8 (place identity and host path scope). None is critical because each fails toward under-indexing or stale listing, not toward exposing tenant data (the projection boundary of AD-42 holds).
