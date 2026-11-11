---
title: '24-10 public page route, template contract and launch template'
type: 'feature'
created: '2026-11-09'
status: 'done'
baseline_commit: 'b64f292a6b8a6a3f954fc15810fa31b44448feb0'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-24-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A gym can publish a snapshot (24.8) and the Owner has the screens (24.9), but nothing serves it: `apps/landing` is the marketing site only, has no database access, no host routing, no template code, no `PageContentV1`, no redirect lookup and sets no security headers. A visitor cannot open `{name}.gymosapps.com`.

**Approach:** The landing proxy takes the first Host label, validates it and rewrites to one Route Handler. The handler reads one row as `public_site_reader`, parses it with a strict `PageContentV1`, renders a pure template from a new `packages/page-templates` with `renderToStaticMarkup`, and answers with the exact AD-44 headers. A small migration adds the redirect lookup and exposes `default_language`. A conformance suite gates the registry. Sources: EXPERIENCE.md PS-01, "Template contract", PS-02; DESIGN.md "Public Page Templates" (Classic table); AD-43/44/46/48/50. Where the spine and an older epic line disagree, the spine wins and the difference is recorded in `docs/decisions.md`.

## Boundaries & Constraints

**Always:**
- Host handling (proxy): first label of `Host` under the configured root domain (env `PUBLIC_SITE_ROOT_DOMAIN`, `localhost` in dev). Apex and `www` keep the marketing site. Any other host (`*.vercel.app`, unknown root) is not a gym host. A label failing the name grammar or in the reserved list returns not-found without a database call. Inbound `x-tenant-*` headers are deleted, then the proxy sets its own. Grammar is one shared function in `packages/types` (today a copy in `scripts/check-reserved-labels.mjs`; the script imports it).
- Not-found is ONE response (same status 404, markup, headers, `Cache-Control: public, s-maxage=30`) for: bad grammar, reserved, unknown, unpublished, taken down, suspended, released name, any path other than `/`, `/{code}` of a supported language (and, until 24.11, `/robots.txt`, `/sitemap.xml`, `/report`), a `PageContentV1` parse failure (logged, no gym data in the log), an unknown template, an unsupported `schema_version`, a database error (same status and body, `s-maxage=30`). Copy per PS-02, both languages in one block. Language-agnostic markup, no cause, no gym name.
- Data access: server-only module in `apps/landing`, driver `pg`, env `PUBLIC_SITE_READER_{HOST,PORT,DATABASE,USER,PASSWORD}` (separate variables; user is `public_site_reader.<project_ref>`), pool max 1 per instance, no session state (no `SET`, no prepared statements), one retry on `53300`, 2 s connect timeout. Queries select from `public_site.*` only. `check-landing-no-supabase` keeps passing; the new names are added to `turbo.json` build env.
- Page response: `200`, `Cache-Control: public, s-maxage=60`, no `Set-Cookie`, headers exactly: `Content-Security-Policy: default-src 'none'; img-src <media origin>; style-src 'sha256-<hash of the one style block>'; font-src 'self'; connect-src 'none'; script-src 'none'; base-uri 'none'; form-action 'self'; object-src 'none'; frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Strict-Transport-Security: max-age=63072000; includeSubDomains`. Media origin comes from env `PUBLIC_SITE_MEDIA_ORIGIN` (the storage origin; AD-47 serves derivatives from it); the hash is computed from the exact emitted style text.
- Language (owner decision 2026-11-08, EXPERIENCE.md "Language rule"; it supersedes the epic AC wording "fixed per page, no negotiation" and AD-50's "no hreflang"): complete languages = those whose `about_xx` is present in the snapshot. `/` shows the best `Accept-Language` match among them, then `default_language` if complete, then the first in `PAGE_CONTENT_LANGUAGES`; `/{code}` of a complete language shows it; `/{code}` of a supported incomplete language serves the fallback choice without `hreflang`; other codes are not-found. `Vary: Accept-Language` on `/`. `hreflang` alternates, `x-default` and the language link or menu only when at least two languages are complete. `<html lang>` and fallback blocks carry their `lang`. Chrome dictionaries exist for every language in `PAGE_CONTENT_LANGUAGES` or the template is not registered. Read languages from the list, never assume two.
- Redirect: an old name within its 12 months answers `301` to `https://{current}.{root}/` (path `/`), one hop, `Cache-Control: public, max-age=300, s-maxage=300`. If the current page is not visible, the answer is the uniform not-found, not a redirect. Lookup is a new `public_site.page_redirects` view (migration 0166, next free number at merge).
- Migration 0166 also adds `default_language` to the snapshot builder, the `gym_pages_content_keys` CHECK, the gym refresh trigger column list and a one-off refresh of published pages. `schema_version` stays 1 (nothing is in production; documented); the reader accepts exactly version 1 and fails closed otherwise. Pinned key-path test, `public_site_reader_privileges.test.sql`, `database.ts` splice, rollback script `scripts/rollback-0166-*.sql` and the `$verify$` block follow the 0164/0165 pattern.
- `PageContentV1` (strict, in `packages/types`): the snapshot keys plus `default_language`, wrapped with `template` and `schema_version`; one fixture snapshot is rendered by both a vitest and checked against the pgTAP key list (as 24.9 did for status).
- Template module: `packages/page-templates` exports `render(content, locale)` per template and a registry; it imports no database, network, `fs` or Supabase module (test scans imports). Every string from the gym is a React text node; no `dangerouslySetInnerHTML` (ESLint rule enforced in both packages). Exception allowed once: the JSON-LD block is NOT built in this story (Epic 25).
- Page content (PS-01): ten sections in the fixed order; omit-never-empty; plan = name as entered plus details from the template dictionary (EN and FR from the UX table), price as stored with currency code and language grouping; gallery images get a generic localized alt ("Photo N of M"), banner empty alt, logo alt = gym name; Directions = Google Maps directions link to the stored position (an `[ASSUMPTION]` in the UX spec, recorded); no "open now", no timezone key (decision recorded: hours are bare text, no `timezone` content key); `tel:` and `https://wa.me/<digits>` links; external links `rel="noopener noreferrer"`; "Report this page" link renders (to `/report`, which is not-found until 24.11; epic releases together); footer GymOS link to `www.`.
- Color: `primary_color` is the only variable color; the server computes `--on-gym` (white or ink at 4.5:1, else platform accent pairing) and passes it to the template.
- Fonts: Barlow 700 and 800 as self-hosted woff2 under `apps/landing/public/fonts/` with the OFL licence text, served from the page's own origin; system sans fallback always declared. Source: `@expo-google-fonts/barlow` TTFs converted to woff2.
- Conformance suite (runs in CI): renders every registered template against fixtures (full, no banner, no gallery, no map position, no hours, one plan, eight plans with 60-character names, very long name and About (2,000 characters), hostile entity-encoded markup in name/plan/About/Services/address/city, EN and FR, language cases (a)-(d) of the UX table, half-filled French About on a live page, non-XAF currency, very light and very dark gym colors). Rules: section order, no executable script or handler, exact CSP and header policy, style budget (one inline block, size cap), font allowlist, contrast (AA) per color, tap target at least 44 px, contact actions inside the first screen at 360x640, 768x1024 and 1366x768, no horizontal scroll or clipped text at 360, 768 and 1280 (headless Chromium via Playwright, a failing run if the browser is missing). Known-bad fixture templates, one per rule, must each fail exactly their rule. A swap test proves only `template` changes.
- Owner decision 2026-11-09 (supersedes the epic AC "two seed templates"): ONE template ships, Classic (DESIGN.md Classic table; no mock). Seeds A (dark) and B (light) are not built; they go to `deferred-work.md` as library growth. The suite is proven by Classic plus known-bad fixtures, and the swap test uses a second fixture, not a second shipped template. Registry and contract stay generic so a template is one added module.
- Dashboard: `PAGE_TEMPLATES` in `apps/dashboard/lib/pageTemplates.ts` must be a subset of the registry; a cross-package test fails otherwise.
- `docs/decisions.md` records: language rule supersession, no timezone key, `schema_version` stays 1, media origin and Vary choices, Directions provider, driver and pool choice, epics.md "migration: none" for 24.10 corrected. `deferred-work.md`: close the 24.10 lines; add new ones. `sprint-status.yaml` updated.

**Never:** No takedown writer, report form, sitemap, robots, purge (24.11). No JSON-LD, directory (Epic 25). No client JavaScript, hydration payload, cookie, analytics, third-party map tiles or fonts. No `@supabase/*`, anon/service-role/JWT env in `apps/landing`. No change to the 24.5 setter, the gate codes or publish/unpublish functions. No production migration, no Vercel/DNS/env change, no deploy (the owner sets `PUBLIC_SITE_*` env and revokes `net._http_response` privileges on production before release; listed as a release gate in decisions.md). No thumbnail preview in the editor. No alt-text field. Do not touch `scripts/demo-gym/` or `apps/dashboard/AGENTS.md`. Do not regenerate `database.ts`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Visible page | `fit.gymosapps.com/`, Accept-Language `fr`, EN+FR complete | 200 FR, link to `/en`, hreflang fr/en/x-default, exact headers, no cookie | N/A |
| One complete language | Only EN complete, visitor prefers FR | EN, no link, no hreflang | N/A |
| Incomplete code | `/fr`, FR About under 100 chars | EN served, 200, no hreflang | N/A |
| Unknown code | `/de` | uniform not-found | `s-maxage=30` |
| Old name | `old.gymosapps.com/` within 12 months, current visible | 301 to current, `max-age=300` | N/A |
| Old name, current hidden | page unpublished | uniform not-found | no redirect |
| Hidden causes | unpublished, taken down, suspended, released, reserved, grammar-invalid | byte-identical not-found | no database call for non-names |
| Spoofed header | inbound `x-tenant-name: other` | overwritten by the proxy | N/A |
| Hostile text | name `&lt;script&gt;` entities, 300-char unbroken string | inert text, no element, no overflow at 360 | N/A |
| Bad content | extra key, wrong type, version 2, unknown template | uniform not-found, logged without data | fail closed |
| Database down | `53300` or timeout | one retry then not-found | logged |

</frozen-after-approval>

## Code Map

- `apps/landing/proxy.ts` (matcher `["/"]`, apex locale redirect only), `lib/i18n.ts`, `next.config.ts` (no `headers()`), `app/privacy/route.ts` (Route Handler pattern) -- extend proxy to gym hosts, add the single page Route Handler and not-found response; marketing routes unchanged.
- `packages/types/src/schemas/gym.ts:270-604` (`pageSnapshotSchema` 572, languages list 529, hours 277), `constants/reservedLabels.{json,ts}` -- add `PageContentV1`, name-grammar function, host-label parser; `scripts/check-reserved-labels.mjs:23` has the grammar copy to replace.
- `supabase/migrations/0164_publish_gate_snapshot.sql:137-184,263-322,511-600` (snapshot, `gym_page_visible`, views, refresh triggers), `0165_gym_page_status.sql:65-113` (current snapshot builder), `0163_page_names.sql:24,510,1022` (redirect rows), `supabase/tests/public_site_reader_privileges.test.sql`, `gym_page_publish.test.sql` key paths -- new 0166, model on 0164 view style.
- `scripts/check-landing-no-supabase.mjs:25` (allows `PUBLIC_SITE_READER_*`), `scripts/ci-local.sh:64-117`, `.github/workflows/ci.yml:49`, `turbo.json` env, `scripts/__tests__/vercel-ignore-build-step.test.mjs` -- wire new package tests (including Playwright layout stage) and env names.
- `apps/dashboard/lib/pageTemplates.ts` -- constant to cross-check against the registry.
- `_bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md:3351-3480`, `DESIGN.md:151-196`, `mockups/template-seed-{a-dark,b-light}.html` -- behavior, Classic table, seed references; `ARCHITECTURE-SPINE.md:281-335` (AD-43..51).
- `apps/mobile/src/app/_layout.tsx:2-6`, `@expo-google-fonts/barlow` -- Barlow source for woff2.
- Do not reuse: dashboard `pageMediaUrl` (needs Supabase URL); landing's `next/font/google` Inter/Sora (blocked by `font-src 'self'` on gym pages).

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0166_*.sql`, rollback script, pgTAP -- `public_site.page_redirects`, `default_language` in snapshot/CHECK/trigger, refresh of published pages; reader privilege and key-path tests updated deliberately; known-bad mutation shown failing
- [x] `packages/types` -- `PageContentV1`, name grammar, host-label parser, `database.ts` splice, tests
- [x] `packages/page-templates` -- contract, registry, chrome dictionaries (EN, FR, plan dictionary), template(s) per Q1, `--on-gym` computation, escaping, import-scan test, ESLint rule
- [x] `packages/page-templates` conformance suite -- fixtures, rules, known-bad templates, Chromium layout checks
- [x] `apps/landing` -- proxy host logic, page Route Handler, reader module, headers, not-found, redirect, fonts + licence, config; tests for every matrix row
- [x] CI wiring -- ci-local stages, ci.yml, turbo env, guardrail script tests; per-stage lines read, one known-bad run
- [x] Docs -- decisions.md, deferred-work.md, sprint-status.yaml, epic-24-context.md refresh

**Acceptance Criteria:**
- Given any Host/path, then a test enumerates the proxy's outcomes (page, redirect, uniform not-found) and the not-found responses are byte-identical across causes
- Given a snapshot, then the exact header set is asserted, there is no `Set-Cookie`, and the CSP style hash matches the emitted style block
- Given hostile snapshot text, then no element is created from it (DOM parse assertion) in every template and language
- Given a template registered or offered by the dashboard, then it passed the suite; an unregistered template renders not-found
- Given `scripts/ci-local.sh`, `check-migration-guardrails.mjs` and the landing no-supabase gate, then all pass, per-stage lines read
- Given a preview deploy, then the owner verifies the CDN honors `Vary: Accept-Language` and a real HTTPS request on a wildcard host (recorded by the owner; not a CI gate)

## Implementation Notes

- Built as specified, one template (Classic). Where the spec was silent or the platform pushed back, see `docs/decisions.md` (2026-11-09) and `deferred-work.md` ("Deferred from: build of spec-24-10"): render pipeline split (`renderPageAsync` because Next refuses a static `react-dom/server` in the server layer), `render(content, locale, env)` third argument, tiles in one row, plain-text language link, pay-per-session without an interval chip, known-bad fixtures are Classic output with one flaw (headers and DOM) or one CSS rule (Chromium).
- Verification: see the 2026-11-09 `last_updated` line in `sprint-status.yaml`.

## Spec Change Log

- 2026-11-09, review pass 2 (owner decision 1a): the Language bullet's "`Vary: Accept-Language` on `/`" is implemented as "on `/` only when two or more languages are complete" (one complete language cannot make the response differ), and an incomplete `/{code}` that falls back also carries `Vary` when two languages are complete. The frozen block is not edited; the narrowing is recorded in `docs/decisions.md` (24.10, supersessions).

## Review Triage Log

Pass 1 (layers: blind-hunter, edge-case-hunter, verification-gap; diff `b64f292` plus the uncommitted build, spec and lockfile excluded).

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| Proxy matcher excludes `_next/image` and `_next/static`, so a gym host does not answer the uniform not-found for them; `config.matcher` is never evaluated by a test (blind + verification-gap) | medium | patch | `proxy.ts:58-60`; reverting the matcher to `["/"]` keeps all 11 proxy tests green and would let a forged `x-tenant-name` through on `/gym-site` |
| Nothing ties `proxy.ts` rewrite target and `x-tenant-*` names to `app/gym-site/route.ts`; `GET` untested (verification-gap) | medium | patch | renaming the header read in route.ts keeps every test green and takes every gym page to not-found |
| Font files and the immutable cache rule are not asserted; layout stage turns a missing font into 404 and carries on (verification-gap) | medium | patch | `layout.ts` catch returns 404; no test reads `public/fonts` or `headers()` |
| No `query_timeout`; pool options untested (edge + verification-gap) | medium | patch | role-level `statement_timeout` 3 s is not proven through the pooler (24.4 deferral); `max: 1` or ssl flipped keeps all reader tests green |
| `Vary: Accept-Language` set with one complete language (blind) | low | patch | direct correction: Vary only when two or more languages are complete; fewer cache variants for the common one-language page |
| Whitespace-only About counts as complete in `completePageLanguages` (edge) | low | patch | unreachable through the database (completeness is 100 trimmed characters) but the Zod side is the fail-closed layer; one-line `.trim()` |
| Invalid root domain (`https://gymosapps.com`) silently serves marketing everywhere (edge) | low | patch | direct correction: validate the value and log one config line |
| Render-error catch discards the error name; `reader_config_missing` has no code (blind + edge) | low | patch | direct: log the name only, give the error a code |
| Grammar test titled "agrees with the SQL grammar" only checks the migration text (blind + verification-gap) | low | patch | rename and correct the comment; the SQL table is in `page_names.test.sql` |
| Deploy order: dashboard schema requires `default_language`; the rollback strips it (blind + edge) | medium | patch | migrations deploy before dashboard code; state it in the rollback header and the release gate |
| `check-reserved-labels.mjs` needs Node 22.18 for type stripping, engines say 22.13 (edge) | low | patch | guard with a one-line message |
| Purity scan misses a bare `import "fs"` (edge) | low | patch | the scan is the gate named in the spec; one regex |
| Registry does not run the conformance suite; tests hard-code `classic` (edge) | medium | patch | spec AC: a registered template passed the suite; iterate `REGISTERED_TEMPLATES` |
| `publishRows` comment says the languages row shows the default language; the screen does not (verification-gap) | low | patch | comment correction; the key is listed to satisfy the every-key-has-a-row test |
| Transient database, render or config error answers the cached uniform 404 (`s-maxage=30`), so a live page looks unpublished for up to 30 s (blind + edge) | medium | rejected | frozen spec: "a database error ... same status and body, `s-maxage=30`" and matrix row "Database down: one retry then not-found"; the fix edits the frozen block. Surfaced to the owner at the checkpoint |
| Pool of one with a 2 s checkout timeout under concurrent requests (blind + edge) | maybe-false | defer | spec fixes `max 1`; whether a Vercel instance serves overlapping requests on one pool decides it; settles on the first preview deploy under load (24.12 baseline) |
| Every unknown valid label costs two serial reads and random labels bypass the 30 s cache (blind) | maybe-false | defer | real cost, unmeasured; one combined query or a firewall rule is a design choice for 24.12 |
| "Report this page" link is dead until 24.11 (blind) | false | rejected | spec Boundaries: renders to `/report`, not-found until 24.11, the epic releases together |
| `PUBLIC_SITE_READER_*` names look client-exposed (blind) | low | rejected | the names are already allowed by `check-landing-no-supabase.mjs` and decisions.md since 24.4; Next inlines only `NEXT_PUBLIC_` |
| `rejectUnauthorized:false` and silent pool `error` listener (blind) | low | rejected | the TLS gap is already in deferred-work.md for before the first real publish; the silent listener is deliberate and commented |
| Thin logging, no log on redirects or unknown names (blind) | low | rejected | logging every miss on a public wildcard host is noise; the error paths log codes |
| `<> 8` triggers in the migration verify block; key-path regex anchored on `about_en`; ASCII-only `label_fr` fixture (blind) | false | rejected | the verify block runs once at apply time and cannot break later; the others are test style |
| 301 for an old name drops a requested `/fr` (blind) | low | rejected | spec: the redirect goes to `https://{current}.{root}/` |
| `schemeFor` twice, duplicate name-length constants, loose `PAGE_MEDIA_KEY_PATTERN`, `tenantPath!`, non-GET gets Next's 405 (blind + edge + verification-gap) | low | rejected | cosmetic or unreachable: the key comes from a uuid in the snapshot builder, a 405 reveals no cause, `classifyPagePath("")` is not-found |
| Migration's one-off refresh could unpublish live production pages (blind) | false | rejected | production is at 0159: no `gym_pages` table, so the loop runs over zero rows; the deploy script already requires a fresh backup |
| PUBLIC_SITE_MEDIA_ORIGIN accepts `http:` in production (edge) | low | rejected | owner-set value; the CSP is built from it verbatim and tests use http locally |
| Conformance rule throws when a template renders Call with no phone; layout context not closed on throw; hours `{}` renders seven Closed rows (edge) | low | rejected | the gate guarantees a contact and non-empty hours (the 24.5 CHECK refuses `{}`); a throw in the suite fails it |

### Review Findings

Pass 2 (2026-11-09): blind, edge-case, verification-gap and acceptance layers over the committed branch diff against `epic/24` (2ea61c7, 87 files, one unchunked pass).

- [x] [Review][Patch] (decided 1a: accept the narrowing, record it in docs/decisions.md and the spec Spec Change Log) `Vary: Accept-Language` is sent on `/` only when two or more languages are complete — the frozen Language bullet says "`Vary: Accept-Language` on `/`" without that condition. Pass 1 changed it as a "direct correction" without renegotiating the frozen block. With one complete language the response cannot differ, so no visitor is harmed; the cost is a deviation from frozen text, and the `header-policy` conformance rule reads `decision.vary` from the implementation, so it cannot catch it. `decisions.md` records "with `Vary: Accept-Language`" and not the narrowing. The same function also adds `Vary` on an incomplete `/{code}` when two languages are complete (the spec limits it to `/`, but that fallback does depend on Accept-Language). Options: accept the narrowing and record it in `docs/decisions.md` plus a spec change-log line; or restore the always-on `/` Vary. [`packages/page-templates/src/language.ts` decideLanguage, `renderCore.ts`] (acceptance-auditor, medium)
- [x] [Review][Patch] (decided 2a: node test in the pgtap stage running both statements as public_site_reader) The two SQL statements `apps/landing/lib/gym-site/db.ts` sends (`public_site.pages where name = $1`, `public_site.page_redirects where old_name = $1`) are never run against the migrated schema by any automated test; landing tests mock `pg` and only regex the text. Changing `where name` to a wrong column keeps every stage green and answers a cached 404 for every gym page in production. The only run is the manual `next start` recorded in sprint-status. Needs a place to run: a node test inside the pgtap stage, a new `ci-local.sh` stage that starts from the local DB, or pgTAP blocks fed from exported constants. [`apps/landing/lib/gym-site/db.ts:71-80`, `gymSite.test.ts`, `reader.test.ts`] (verification-gap, medium if the text drifts)
- [x] [Review][Patch] The `page_redirects` same-gym join (`a.gym_id = r.gym_id`) is pinned by no test: fixtures publish one gym only, so deleting the join keeps every assertion green and a second published gym could receive another gym's old name (`limit 1` picks arbitrarily). Add two-gym pgTAP cases (A has a redirect row, B is visible: A's old name resolves only to A's current name, and not to B when A's page is hidden), plan +2. [`supabase/tests/public_site_reader_privileges.test.sql:332-353`, `supabase/migrations/0166_public_page_route.sql:148`] (verification-gap, medium)
- [x] [Review][Patch] `docs/decisions.md` (24.10 "Host routing") still says the proxy matcher is "everything except `_next/static` and `_next/image`"; `proxy.ts` uses `["/:path*"]` and `wiring.test.ts` asserts those two paths ARE matched. Correct the sentence. [`docs/decisions.md:16`] (acceptance-auditor + verification-gap, low)
- [x] [Review][Patch] Language fixtures (a) to (d) run the Chromium layout stage at 360x640 only and with five of the rules (no `text-overlap`, `visual-order`); the spec bullet requires no horizontal scroll or clipped text at 360, 768 and 1280 and the first-screen rule at all three sizes. Run them through the same viewports and rule set as the standard fixtures (watch CI time). [`packages/page-templates/src/conformance/registered.layout.test.ts:42-51`] (acceptance-auditor, low)
- [x] [Review][Defer] No `next build` of `@gymos/landing` in `ci.yml` or `ci-local.sh`: the `renderPageAsync` lazy import and `transpilePackages` are only proven by a manual build; breaking them fails first on the Vercel build (loud, not silent) [`packages/page-templates/src/renderPageAsync.ts`, `apps/landing/next.config.ts`] — deferred: pipeline-cost decision; fails loudly at deploy; settle with a CI build stage when 24.12 adds the landing gate

#### Rejected (pass 2)

- Spec status and task boxes stale, migration number wording, `review_loop_iteration` (blind + acceptance) — the fix edits the spec under review.
- `RenderFn` takes a third `env` argument (acceptance) — already disclosed in Implementation Notes and `decisions.md`; the fix is a spec edit.
- Interval chip skipped for pay-per-session, contact tiles in one row, language link not a pill (acceptance) — disclosed in `deferred-work.md` as layout decisions for the owner's phone pass.
- Known-bad fixtures are post-processed Classic output; `database.ts` splice absent; not-found byte test compares against its own function (acceptance) — approach disclosed, nothing to splice (`public_site` is not in `database.ts`), and the test still proves every path routes to the one function.
- `readConfig()` logs the invalid root domain on every request now that the matcher is `/:path*` (blind + edge, low) — misconfiguration only, and the repeated line is the visible signal that gym hosting is off; memoising adds state for a case that is fixed once at deploy.
- Proxy overhead on every marketing request (blind) — the spec orders every path to pass the header cleanup; no cost measured or shown.
- 301 drops the `/fr` path (blind) — spec: the redirect goes to `https://{current}.{root}/` (same as pass 1).
- Operational errors served as cached 404s; two serial reads per unknown label; pool of one (blind + edge) — already in `deferred-work.md` from pass 1.
- TLS verification off (blind) — already in `deferred-work.md` ("before the first real gym is published").
- 0166 one-off refresh could unpublish live pages; stored snapshots may lack `default_language` (blind + edge) — false: the loop and the `$verify$` check cover every row with `published_at` set and `unpublished_at` null, including suspended and taken-down pages; an unpublished row cannot become visible without a publish, which takes a fresh snapshot.
- DB test gaps for rename chains and mixed-case old names (blind) — a chain resolves through the single `active` name by construction; `old_name` is `lower(name)`.
- Logo `alt={c.name}` beside the `<h1>`, fixed image dimensions (blind, low) — the logo is the gym mark and the h1 is page text; not shown to harm anyone.
- `/report`, `robots.txt`, `sitemap.xml` dead until 24.11 (blind) — spec Boundaries; the epic releases together (same as pass 1).
- `parseAcceptLanguage` does not clamp `q` to 1; `schemeFor` twice; name-length constants twice; per-call `RegExp`; not-found copy outside `CHROME`; `Object.assign(err, {})` in a test (blind, low) — cosmetic or negligible; the test asserts the exact log line, which excludes the secret text (`schemeFor` and the constants were also rejected in pass 1).
- Unit suites run in two sequential turbo calls; font responses lack the AD-44 headers; no `.env.example`; engines bump applies to every app (blind, low) — documented trade-offs; HSTS and nosniff come from the page responses of the same host; `.env.example` is already in `deferred-work.md`.
- Connection dropped by the pooler is not retried (`Connection terminated unexpectedly`); `query_timeout` not retried (edge, low) — the idle drop is unproven (the idle timeout is 10 s and pg removes errored idle clients), and the frozen spec names the retry cases.
- Media origin accepted as `http:` in production; loose root-domain regex (edge, low) — owner-set values, the failure is loud (mixed content, or gym hosting off with a log line).
- Map without address, empty hours rendering seven Closed rows (edge) — false: the publish gate requires country and city and at least one non-null day (`no_hours`), so a published snapshot cannot lack them.
- Incomplete-language `/{code}` has no canonical (edge) — spec orders the fallback without hreflang; canonical links belong to Epic 25 (AD-51).
- Node 23.0 to 23.5 pass the major check but lack type stripping; `dangerouslySetInnerHTML` lint bypass through a quoted key (edge, low) — odd-numbered non-LTS Node, and a deliberate evasion; both fixes add guards for cases nobody meets.
- Non-GET methods get Next's 405; trailing-slash 308 before the proxy; 301 and fonts carry a smaller header set (edge claims) — answered identically for every label whether the gym exists or not, so no information leaks; the header set of the 301 is the spec's.
- Migration refresh also touches taken-down or suspended rows (edge claim) — same refutation as the refresh item above.

## Design Notes

Language negotiation at `/` makes the response depend on a request header, so the CDN must key on it (`Vary: Accept-Language`). If Vercel's cache does not honor `Vary` for this route, fallback is a bounded variant: the proxy rewrites `/` to the chosen `/{code}` internally and the CDN key stays URL-only only if `Vary` is honored; otherwise `/` would serve `default_language` to all and negotiation drops to the explicit links. The preview check above settles it.

## Verification

**Commands:**
- `bash scripts/ci-local.sh` -- expected: every stage PASS
- `node scripts/check-migration-guardrails.mjs` -- expected: pass
- `bash scripts/ci-local.selftest.sh` -- expected: pass (ci-local.sh is touched)

**Manual checks (owner):**
- Preview deploy with `PUBLIC_SITE_*` env set: open a published page in EN and FR on a phone and a desktop, check the 301 after a rename, and the uniform not-found for an unpublished page.
- Before release: verify and revoke `net._http_response` access for the reader on production; set `PUBLIC_SITE_ROOT_DOMAIN`, `PUBLIC_SITE_MEDIA_ORIGIN` and the reader env in the landing Vercel project.
