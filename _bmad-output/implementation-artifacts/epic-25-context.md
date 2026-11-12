# Epic 25 Context: Directory & Discovery

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Published gyms appear in country and city listings on the main site, filterable by category, with validating structured data, sitemaps and a plain-text crawler summary. The directory owns no data: every listing is a view over the Epic 24 published snapshot, so unpublish, takedown and suspension remove a gym everywhere with no extra code. Starts after the Epic 24 gate; at launch most listings are thin and only gym pages are expected to be indexed.

## Stories

- Story 25.1: Country & City Controlled Lists, Gym City Selection
- Story 25.2: Directory Views & Listing Correctness
- Story 25.3: Directory Pages: Country, City, Category Filter
- Story 25.4: Structured Data Serializer & Validation
- Story 25.5: Sitemaps, Robots & Plain-Text Summary
- Story 25.6: Directory Gate: SEO Verification & Removal Timing
- Story 25.7: Directory Africa Map & Old City-Slug Redirects (split out of 25.3 and 25.1; not a 25.6 prerequisite)

## Requirements & Constraints

- Places are controlled lists, not free text. Only Super Admin adds cities. Legacy text values that cannot be mapped stay unmapped, are listed for Super Admin and cannot publish (the publish gate requires a city).
- Any country with a published gym is listed; nothing assumes Cameroon. Cameroon is only ordered first, as a plain card, with no Cameroon-only wording, address format or structured data.
- One boolean `indexable` (fewer than 3 published gyms is thin; assumption, one constant in one place) drives both `noindex` and sitemap exclusion. A thin listing looks identical to visitors. The top page is always indexable.
- A removed gym leaves listings, sitemap and summary within the bounds (origin 60 s, CDN 5 min, sitemap 15 min), and counts follow.
- Listings show gym name, category, city, optional logo and a link to the gym's canonical subdomain; never banner, hours, plans or contact. Alphabetical, no ranking or featured gyms, 20 per page with plain numbered links.
- Category filter is plain `?category=<code>` links, offered only for categories present in that city. A filtered view canonicalizes to the unfiltered listing, has no `noindex`, and is out of the sitemap.
- Release gate (25.6): Rich Results Test and schema.org validator at zero errors, Search Console accepting each host's sitemap, removal timing per case, p75 LCP vs the 3 s assumption, EN and FR E2E.

## Technical Decisions

- Listings are `public_site` views (`directory_country`, `directory_city`, `directory_gym`) over the snapshot joined to cities, using the one visibility predicate. They carry computed `published_count` and `indexable`, expose no internal ids, and add no privilege beyond the view list (update the reader-role grant-test snapshot deliberately). `directory_city` exposes city lat/lng, never a gym position. No listing table or counter column.
- Data: `countries(code, name_en, name_fr)` from ISO 3166; `cities` with unique `(country_code, slug)`, ASCII-folded slugs, nullable lat/lng (both or neither, range-checked); `gyms.city_id`. Aliases are a separate table, as the spine describes and 25.1 built it (migration 0169): `city_aliases(id, country_code, alias_norm, alias, city_id, is_name)`, unique `(country_code, alias_norm)`, the city's own name stored as the `is_name` row; `cities.lat`/`lng` are `numeric(9,6)`. The epic's earlier `aliases text[]` column was not built.
- A city rename or slug change re-snapshots dependent pages through a trigger calling the existing refresh function; old slugs are kept in `city_slug_history` and 301 for 12 months; renames never change a gym's `city_id`.
- Routes on `www.` in `apps/landing`: `/{en|fr}/gyms/`, `/{country}/` (lowercase ISO alpha-2, same in both locales), `/{city}/`. Each has `hreflang` en/fr plus `x-default` and a self-referencing canonical. Canonicals and `og:url` use a constant origin, never the request Host. `s-maxage` at most 300, no cookies, AD-44 script-free headers.
- Proxy per-host allowlist: a gym host serves only `/`, `/robots.txt`, `/sitemap.xml` and the report form; `www.` serves marketing, `/{locale}/gyms/...`, `/robots.txt`, `/sitemap-index.xml`, `/sitemaps/{n}.xml`, `/llms.txt`. Everything else gets the uniform not-found. The 24.11 gym-host sitemap and robots stay unchanged.
- Sitemaps are dynamic Route Handlers reading the views (not Next's cached `sitemap.ts`). The `www.` index is an explicit route with chunks of at most 50,000 URLs, only indexable listings and marketing pages, no gym pages (a sitemap may list only its own host). A test fetches the index and every `<loc>` and expects 200. `/llms.txt` is plain text from the same views and nothing outside the projection, a voluntary hint, not access control.
- Structured data: one serializer in `packages/page-templates` emits `HealthClub` per gym page (category in description and keywords; `geo` only with a map position; opening hours) and `ItemList` per listing, as `JSON.stringify` with `<`, `>`, `&` escaped in inert `application/ld+json`. CI validates fixtures including hostile `</script>` text. Open graph tags use published fields only.

## UX & Interaction Patterns

- Directory is its own pages on the rebranded main site; home gains only a "Gyms" link in header and footer. Tokens come from `apps/landing/DESIGN.md`; never a gym's colour.
- Navy hero band (breadcrumb, `h1` with place name as accent, one count sentence, no stat numerals), then light content. Cards 76 px minimum in 1/2/3 columns; listing rows 80 px minimum with 48 px logo or monogram; category pills 44 px, current one filled with a check glyph and `aria-current`. No motion except map halos.
- Africa map (Story 25.7, not 25.3), top page only: static inline SVG built at build time from Natural Earth 110 m (public domain, record provenance, committed generated module), no script or third-party request. One orange dot per city with a published gym, radius 5 + 3.2 x sqrt(gyms) in a 760 viewBox, linking to the city page with a 44 px hit area, CSS-only labels hidden under 640 px. `aria-hidden` with `tabindex=-1` links because the country cards carry every link. No dot for cities without coordinates or countries off the map; no country highlighted; no map when nothing is published; visible caption. No map on country or city pages.
- Empty states, breadcrumbs, language switch link and draft copy (flagged to confirm) are in the UX files. Bare `/gyms/` redirects once by `Accept-Language` (assumption).

## Cross-Story Dependencies

- Order: 25.1 (needs 24.5) -> 25.2 (also 24.8) -> 25.3 (also 24.10) -> 25.4 and 25.5 -> 25.6; 25.7 (map needs 25.1 coordinates via 25.2; old-slug 301 needs a fourth view) follows 25.3 and is closed before the first production city rename.
- Shipped by 25.3: directory pages are a script-free Route Handler under `apps/landing/app/[locale]/gyms/[[...path]]` with `lib/directory/*`; one header function and one indexable flag drive both meta and `X-Robots-Tag`; `www.` origin comes from the configured root domain. Only 25.1 and 25.2 have migrations, numbered at merge time.
- Reuses Epic 24: snapshot refresh triggers, reader role and grant test, uniform not-found handler, header test, `apps/landing` proxy. 25.6 needs a staging environment, which Epic 24 closed without; coordinate with the owner.
