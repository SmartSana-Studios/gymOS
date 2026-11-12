---
title: '25-4 Structured data serializer and validation'
type: 'feature'
created: '2026-11-12'
status: 'done'
baseline_commit: 'a93bf0f194982a84fe0f8fef1f11fef6b1045613'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-25-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Gym pages and directory listings carry no structured data and no social-sharing tags, so search engines and link previews get only a title and a description, and nothing proves that markup built from gym text cannot break out of its tag.

**Approach:** One serializer in `packages/page-templates` builds a `HealthClub` object per gym page and an `ItemList` per city listing, plus Open Graph tags, and a single head-injection function puts both into every public page as inert `application/ld+json` and `<meta property>` strings. CI validates fixtures (including hostile text) against the schema.org type definitions and a required-property test, and shows the validator able to fail.

## Boundaries & Constraints

**Always:**
- Serializer `src/structuredData.ts` (exported from the package index): `serializeJsonLd(obj)` is `JSON.stringify` then `<` `>` `&` U+2028 U+2029 replaced by `<` `>` `&` ` ` ` `; `jsonLdScript(obj)` wraps it in `<script type="application/ld+json">…</script>`; `injectHead(html, extras)` inserts before the FIRST `</head>` (gym text is escaped, so the first literal one is the real one) and returns the html unchanged-plus-extras; `openGraphTags(og)` returns `<meta property="og:…" content="…">` strings with `& < > " '` escaped. Extras are spliced as STRINGS after `renderToStaticMarkup`, never JSX, so no `dangerouslySetInnerHTML` and no per-template JSON-LD (AD-51). The CSP style hash is computed on the same html and is unaffected; the CSP strings do not change.
- Gym page, from `PageContentV1`, the shown language and `RenderEnv`, in `renderPageWith` for every template and every `/` and `/{code}` response: `{"@context":"https://schema.org","@type":"HealthClub", name, url: `${env.origin}/`, description, keywords, image?, logo?, telephone?, address, geo?, openingHoursSpecification?}`. `description` = category label + ". " + the existing meta-description excerpt (just the label when no About); `keywords` = category label, both in the shown language. `image` = absolute media URLs of banner, then gallery, then logo (no duplicates), omitted when none; `logo` = the logo URL. `telephone` = `contact.phone` (E.164 with `+`); WhatsApp is not emitted; omitted when no phone. `address` = `PostalAddress` with `streetAddress`, `addressLocality` (the city text) and `addressCountry` (the ISO alpha-2 code), each only when stored. `geo` = `GeoCoordinates` only with `map`. `openingHoursSpecification`: one `OpeningHoursSpecification` per group of open days with identical `opens`/`closes` (`dayOfWeek` full English names, times as stored `HH:MM`); a closed or absent day is omitted; no open day omits the property; an overnight span (close before open) is emitted as stored.
- Open Graph on gym pages: `og:type` website, `og:title` (the same string as `<title>`, from one shared `pageTitle` function used by both templates and the tags), `og:description` (the meta-description excerpt, else category and city), `og:url` (`${env.origin}/`, constant origin, never the request Host), `og:image` = banner else logo else first gallery image, an absolute `mediaBase` URL, absent when the gym has no image. Published fields only.
- Directory: a city page with at least one gym row on the page emits `ItemList` (`@context`, `itemListElement` of `ListItem` with `position` = offset+index+1, `url` = the gym's canonical subdomain URL, `name`) for the rows shown, filtered and paged views included; no rows, no `ItemList`. Every directory page (top, country, city) carries `og:type`, `og:title` (= `<title>`), `og:description` (= meta description), `og:url` (= canonical); no `og:image` (a listing has no published image). The handler splices both through the same `injectHead`.
- Validation is network-free: `schema-dts` (devDependency of `packages/page-templates`, `import type` only, exact version at least two weeks old) types the serializer output so `tsc` rejects an unknown property or a wrong value type; a required-property test checks `@context`, `@type`, `name`, absolute `https`/`http` `url`, `address` with `addressCountry`, `ListItem` positions 1..n in order with absolute `url`, and that only the allowed `@type` names occur. Fixtures: full gym, no map position, no hours, all days closed, overnight hours, no image, no phone (WhatsApp only), French, and hostile text (`</script><img onerror=…>`, `&`, `"` in name, about, address, city, plan names) — the hostile text appears only inside the JSON string, escaped, and `JSON.parse` of the block returns the original text.
- Executable script stays banned. The conformance `no-script` rule, `gymSite.test.ts`, `contract.test.ts` and `scripts/landing-gate/lib/headers.mjs` change from "no `<script`" to "no `<script` other than ONE `type="application/ld+json"` block whose text parses as JSON". A new conformance rule `structured-data` runs for every registered template and every fixture and request (so a third template cannot skip it): exactly one block, the type above, og tags present, `og:title` equals `<title>`.
- Gate reach (Epic 22 retro 66, 77): the consumer list is the two registered templates × fixtures × `/` and `/{code}`, and the directory outcomes top, country, city, filtered, paged, empty; a test enumerates them and fails when one lacks the tags. Known-bad runs shown failing: a template without the block, a second block, an executable `<script>`, an ld+json block with invalid JSON, a `HealthClub` with an unknown property (a `@ts-expect-error` line in a test file), and `check-http` against a doctored response.

**Never:** No migration, no change to `PageContentV1`, the snapshot or the views. No sitemap, robots, `llms.txt` or path allowlist (25.5). No Rich Results Test or Search Console step (25.6). No `BreadcrumbList`, `Organization`, `WebSite`, `Offer`, plan or price markup, no `sameAs`, no `priceRange`. No `geo` without a map position and none on a directory page. No `dangerouslySetInnerHTML`, no JSON-LD from JSX, no inline JSON-LD string built by concatenation of gym text. No change to the AD-44 CSP, hreflang, canonical or `noindex` logic, to the `/report` page, to gym-host routing or to the not-found responses. No call to a third-party validator from tests or CI. No `database.ts` regeneration.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error Handling |
|---|---|---|---|
| Full gym | all fields, EN | one `HealthClub` with every property, `og:image` = banner | none |
| No map / no hours | `map` or `hours` absent | `geo` / `openingHoursSpecification` omitted, no empty array | none |
| Mixed hours | Mon–Fri 06:00–21:00, Sat 08:00–12:00, Sun null | two specs, Sun omitted | none |
| Overnight | 22:00–02:00 | emitted as stored | none |
| No image / no phone | WhatsApp only, no media | no `image`, `logo`, `og:image`, `telephone` | none |
| Hostile text | name `</script><img onerror=1>` | only the real opener and closer appear; text sits escaped in JSON; `JSON.parse` equals input | none |
| French request | `/fr` | labels, keywords, description in French; `url` unchanged | none |
| City, 21 gyms | page 2 | one `ListItem`, `position` 21 | none |
| Filtered or empty city | `?category=x`, or no rows | filtered rows listed; no rows: no `ItemList`, og tags still present | none |
| Top or country page | no gym rows | og tags, no `ItemList` | none |

</frozen-after-approval>

## Code Map

- `packages/page-templates/src/{renderCore,index}.ts`, `src/templates/{classic,volt}/index.tsx` -- `renderPageWith` builds extras after `renderToStaticMarkup` and calls `injectHead`; both templates take their title from the new shared `pageTitle` (their head otherwise unchanged); `format.ts` `excerpt`, `chrome.ts` `CHROME.categories`, `contract.ts` `RenderEnv` (`origin`, `mediaBase`) are reused
- `packages/types/src/schemas/{pageContent,gym}.ts` -- field shapes (`hours` is `{open, close} | null` per day, `contact.phone` E.164, `map`, media keys); read only
- `packages/page-templates/src/conformance/{rules,bad,fixtures,known-bad.test,registered.conformance.test}.ts` -- `no-script` rule to relax, new `structured-data` rule, known-bad subjects, hostile fixtures to reuse
- `packages/page-templates/src/contract.test.ts`, `apps/landing/lib/gym-site/gymSite.test.ts` -- the `not.toContain("<script")` assertions to replace with the one-block rule
- `apps/landing/lib/directory/{handler,markup,headers}.ts(x)` -- `frame()` holds the canonical and alternates; rows come from `readGyms` with `offset`; splice the extras where the document string is produced; `DirectoryDocument` gets the og fields it needs; `directory.test.ts` outcome enumeration
- `scripts/landing-gate/{lib/headers.mjs,check-http.mjs,__tests__/headers.test.mjs}` -- `checkDirectoryDocument` currently fails any `<script`; add the structured-data check to the `page` and `directory` kinds
- `packages/page-templates/package.json`, `pnpm-lock.yaml` -- `schema-dts`
- `_bmad-output/planning-artifacts/architecture/.../ARCHITECTURE-SPINE.md` AD-44, AD-51 -- the text this story implements; `docs/decisions.md`, `sprint-status.yaml` -- 25.4 entry

## Tasks & Acceptance

**Execution:**
- [ ] `packages/page-templates/src/structuredData.ts`, `src/index.ts`, `package.json` -- serializer, `pageTitle`, `injectHead`, `openGraphTags`, `schema-dts` typing
- [ ] `src/renderCore.ts`, `src/templates/{classic,volt}/index.tsx` -- splice extras for every response; shared title
- [ ] `src/structuredData.test.ts`, `src/structuredData.fixtures.ts` -- fixtures, required-property validator, escaping and round-trip, `@ts-expect-error` known-bad, the I/O matrix rows
- [ ] `src/conformance/*`, `contract.test.ts`, `apps/landing/lib/gym-site/gymSite.test.ts` -- relaxed `no-script`, new `structured-data` rule, known-bad subjects
- [ ] `apps/landing/lib/directory/*` and its tests -- `ItemList` and og tags on every outcome, enumeration test
- [ ] `scripts/landing-gate/*` -- structured-data check on `page` and `directory`, known-bad run
- [ ] `docs/decisions.md`, `ARCHITECTURE-SPINE.md` AD-51 note, `sprint-status.yaml` -- 25.4 entry and `last_updated`

**Acceptance Criteria:**
- Given any gym page response of a registered template, when it renders, then exactly one valid `HealthClub` block and the og tags are present and match the page `<title>`, with hostile text only inside escaped JSON
- Given a city listing with gyms, when it renders, then an `ItemList` points at each shown gym's canonical subdomain URL with correct positions; every directory page carries og tags
- Given the CSP and header tests, when a page carries JSON-LD, then the AD-44 policy strings are unchanged and no executable script exists
- Given the validator, when fed an unknown property, a missing required property, a second block, invalid JSON or an executable script, then it fails

## Implementation Notes

- `pageTitle` and `metaDescription` live in `src/format.ts` (pure, scanned by the template import test) and are re-exported from `structuredData.ts` and the index; `structuredData.ts` joins the pipeline files exempt from the template-purity scan because it imports the `schema-dts` types.
- `schema-dts` 2.1.0 (2026-10-02). The lockfile was edited by hand for that package only: `pnpm add` also bumped unrelated `latest` specifiers (supabase-js, tanstack query) and that churn was reverted; `pnpm install --frozen-lockfile` passes.
- `renderPageWith` gained the result reason `head` (no `</head>` to inject into); `injectHead` throws, the directory handler turns it into the uniform not-found like any render error.
- Rule split for single-rule known-bad runs: invalid JSON is `no-script`; a missing or second block, unknown property, wrong type, missing og tag are `structured-data`.
- `og` meta strings are `<meta property="og:x" content="...">` (no self-closing slash, as the spec writes them); `'` is escaped as `&#x27;` to match React's own escape of the title.
- Verification: page-templates vitest 172 pass, landing vitest 213 pass, landing-gate node tests 56 pass, `run-local.sh http` (GATE_LANDING_PORT=3230) PASS against the real build, typecheck and lint clean on both packages.

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|
| 1 | The directory "no style block" test stub has no `</head>`, so `injectHead` throws first and the `directory_style_block` guard is unpinned (verification-gap) | medium | patch | `handler.ts:107-118`: the stub `<html><body>no style</body></html>` is caught as `directory_render_error`; test-only fix with `</head>` and 0 and 2 style blocks asserting the log name |
| 2 | `reason: "head"` of `renderPageWith` has no test (verification-gap, blind) | low | patch | `renderCore.ts` try/catch; one test with a renderer that returns a document without `</head>` |
| 3 | Conformance `no-script` accepts an ld+json block with `src` or `defer` (blind) | low | patch | `rules.ts:152-153` checks `type` only; the gate's `scriptsOf` rejects it, so the layers differ; reject any other attribute and add a known-bad flaw |
| 4 | `decodeEntities` throws RangeError on `&#x110000;` and double-decodes `&#38;lt;` (edge, blind) | low | patch | `headers.mjs:61-68`; single-pass decode with a code-point range check |
| 5 | Gym without a country: serializer omits `addressCountry`, validators demand it (edge, blind) | false | rejected | A published gym has a city of its own country (0169 gate `no_city`), so `content.country` is always set on a rendered page; the omitted branch is defensive |
| 6 | The `head` catch also wraps `gymHeadExtras` and hides the cause (edge, blind) | low | rejected | The snapshot is parsed with the strict schema before this point; narrowing the try would turn a throw into a 500 instead of the uniform not-found |
| 7 | ItemList positions skip numbers when a row is dropped for an invalid page name; gate does not compare the first position to the offset (edge) | low | rejected | `page_name` is database-enforced (25.3 triage 7); the unit test pins the offset |
| 8 | Empty `doc.description`; `env.origin` trailing slash; empty image key (edge) | false | rejected | Description is built from non-empty copy; origin and keys are built from validated parts |
| 9 | `serializeJsonLd(undefined)` throws (blind) | low | rejected | Every caller passes an object; the fix adds a guard for an unreachable input |
| 10 | `metaDescription` repeats the `text()` lookup (blind) | low | rejected | Reuse would import from the templates directory into `format.ts`; no named divergence |
| 11 | Validator allowlist is hand-written, not generated from schema.org (blind) | low | rejected | The spec's Always names `schema-dts` typing by `tsc` plus a required-property test; the serializer return type is `WithContext<HealthClub>` and a `@ts-expect-error` pair proves it fails |
| 12 | Consumer enumeration hard-codes the template list and 12 outcomes (blind) | low | rejected | A new template fails the test on purpose so its author sees the list |
| 13 | The ld+json helper and entity decoding are copied in four test files and the gate (blind) | low | rejected | Test-local helpers with different strictness by design; sharing adds a module |
| 14 | No `og:site_name`, `og:locale`, `twitter:card`, `og:image:alt`; no `inLanguage`, `@id`, `numberOfItems`; no ItemList on top and country pages; description carries a prefix and "…" (blind) | low | rejected | Beyond the spec's listed tags and properties, decided in Design Notes; each is a later, owner-visible addition |
| 15 | Bookkeeping: sprint-status trailing newline and blank lines, "Not committed" wording, unreferenced claims in decisions.md (blind) | low | rejected | Process wording that is true at write time; the repository's own convention for these lines |

## Design Notes

AD-51 says per-template JSON-LD must not drift, so the pipeline owns it: `renderPageWith` and the directory handler splice strings after rendering, which also avoids `dangerouslySetInnerHTML` (React would HTML-escape a script child and break the JSON). `og:url` and `url` are `${origin}/` even on `/{code}` language variants, following AD-50 (one URL per gym page). Decisions beyond the epic text: the directory has `ItemList` on city pages only (the only page with gym rows); listing pages carry no `og:image`; opening hours are grouped by identical times.

## Verification

**Commands:**
- `pnpm --filter @gymos/page-templates test && pnpm --filter @gymos/page-templates typecheck && pnpm --filter @gymos/page-templates lint` -- expected: pass
- `pnpm --filter @gymos/landing test && pnpm --filter @gymos/landing typecheck && pnpm --filter @gymos/landing lint` -- expected: pass
- `node --test scripts/landing-gate/__tests__/` and `bash scripts/landing-gate/run-local.sh http` (GATE_LANDING_PORT=3230) -- expected: pass, plus the doctored response failing
- `bash scripts/ci-local.sh` (E2E_LANDING_PORT=3230) -- expected: every stage PASS, per-stage lines read

**Manual checks (if no CLI):**
- Owner, at epic end: view-source of a gym page and a city page shows one `application/ld+json` block and the og tags.
