---
title: '25-1 Country & city controlled lists, gym city selection'
type: 'feature'
created: '2026-11-12'
status: 'done'
baseline_commit: '6e578ebdeb18a9605259230e587e9df47435fd22'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-25-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A gym's city is free text (`gyms.page_city`), so one city appears under many spellings and the Epic 25 directory cannot group gyms. Country is an ISO-2 text column with no list behind it.

**Approach:** Add migration-seeded `countries`, `cities`, `city_aliases`, `city_slug_history`; store `gyms.city_id`; Owner/Supervisor pick country and city through one new RPC `set_gym_location`, from a Location block in the landing-page editor; Super Admin manages cities (new `/cities` screen); the publish gate, snapshot and refresh trigger move from `page_city` text to `city_id` (AD-49).

## Boundaries & Constraints

**Always:** Decisions: aliases live in `city_aliases(country_code, alias_norm, city_id)` with unique `(country_code, alias_norm)` (AD-49 wins over the epic's `aliases text[]`, which cannot enforce uniqueness). One SQL normalizer (lower, accent-fold via `translate`, collapse spaces/hyphens/apostrophes) is used for aliases, slugs and the backfill; a TS twin gives the same output on a shared fixture. Slugs: ASCII, `^[a-z0-9]+(-[a-z0-9]+)*$`. `cities.lat/lng` both-or-neither, range-checked, city coordinates only. `gyms.city_id` references `cities(id)`; a city is never deleted. A before-update trigger clears `city_id` when `gyms.country` changes and the city's country no longer matches (covers the Owner's Settings save) so the gate fails and 24.8 unpublishes. A slug change inserts `city_slug_history(country_code, old_slug, city_id, expires_at = now()+12 months)`; a new slug equal to another city's unexpired history slug is refused. All city writes are SECURITY DEFINER RPCs gated by `private.is_super_admin_live()` and audited with `log_audit_event` inside the function; typed errors `'<fn>: <code>'`: `slug_taken, slug_reserved, invalid_slug, alias_taken, invalid_coordinates, unknown_country, name_required, not_found`. `countries`/`cities`/`city_aliases` are readable by `authenticated` only (no write policy, no anon, no `public_site_reader` access); history is not client-readable. Decision (owner, 2026-11-12): Owner AND Supervisor may change country and city. `set_gym_location(p_gym_id, p_country, p_city_id)` (SECURITY DEFINER, same gate as `set_gym_page_content` via `private.support_rpc_role`, Super Admin allowed, active-gym check) is the only writer of `city_id` (pinned by trigger + GUC) and an additional writer of `country`; `p_country` must exist in `countries`, the city must belong to it, audited as `gym_location_updated`; it gets a support allow-list catalog row mirroring `set_gym_page_content`. `set_gym_page_content` drops the `city` key (becomes `unknown_key`). The Location block has its own Save button. Snapshot `city` becomes `cities.name`; `gym_pages.content` keys do not change. Seed Cameroon starter cities (Douala, Yaoundé, Bafoussam, Garoua, Bamenda, Maroua, Ngaoundéré, Bertoua, Limbe, Kribi, Buea, Ebolowa) with approximate coordinates. Every gate/list consumer of city is enumerated in a test (Epic 22 retro 66).

**Never:** No directory views, pages, sitemaps or 301 serving (25.2–25.5; this story only stores history). No free-text city entry. No `gyms.country` FK (libphonenumber-era values may not all be ISO). `page_city` column is kept, unused, not dropped. No city delete. No change to gym_pages columns.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error Handling |
|---|---|---|---|
| Backfill match | gym `page_city` "douala"/"Yaoundé " with country CM | `city_id` set via alias norm | none |
| Backfill miss | text matches no alias | `city_id` null, listed in `list_gyms_without_city()` | gate returns `no_city` |
| Editor pick | typed "Yaounde" (alias) | resolves to Yaoundé | unknown text: "Ask GymOS to add it", no save of free text |
| Rename | Super Admin renames city / changes slug | dependent pages re-snapshotted; old slug in history 12 months; gym `city_id` unchanged | `slug_taken`, `slug_reserved`, `invalid_slug` |
| Alias clash | alias normalizes to another city's in same country | refused | `alias_taken` |
| Published gym changes country | `country` updated | `city_id` cleared, page unpublished/re-gated within AD-46 bound | none |
| Supervisor changes country | Supervisor calls `set_gym_location` with country and a city of that country | both saved, audited | none |
| Wrong-country city | `city_id` from another country | refused | `set_gym_location: invalid_city` |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0105_gym_country.sql`, `0161_gym_page_content.sql` -- `gyms.country`; `page_city`, pin trigger, `set_gym_page_content` (only definition; redefine with `create or replace`, `city` key to `city_id`)
- `supabase/migrations/0164_publish_gate_snapshot.sql` -- `gym_page_gate_missing` (`no_city`, `bad_text` use `page_city`), `refresh_gym_page`, `gym_page_refresh_from_name` (template for the city trigger); `0166` has the latest `gym_page_snapshot` and `gym_page_refresh` trigger (add `city_id` to column list and WHEN); `0167` has the latest `get_gym_page_status` and `refresh_gym_page` (`v_started` reads `page_city`)
- `supabase/migrations/0163_page_names.sql` -- model for RPC audit/typed errors, redirect window, `do $verify$` block; `0126` `private.is_super_admin_live()`; `0063` `log_audit_event`
- `apps/dashboard/.../settings/landing-page/components/ContentSections.tsx` (`LocationSection`: country is read-only today; `settings/actions.ts` + `services/gym-settings.ts` stay the Owner's Settings path), `LandingPageEditor.tsx`, `apps/dashboard/lib/pageEditorForm.ts`, `lib/landingPage.ts` (`no_city`), `services/landing-page.ts` (read at ~150, save ~283, error map ~110), `lib/publishRows.ts`
- `apps/super-admin/app/(admin)/layout.tsx` (`NAV_LINKS`), `pages/` and `tiers/` (page/actions/client patterns), `lib/countries.ts`
- `packages/types/src/database.ts`, `schemas/gym.ts` (gate codes, error code lists); locales en/fr in both apps (`scripts/check-i18n-key-parity.mjs`)
- Tests pinning gate order/city: `supabase/tests/support_capabilities.test.sql`, `gym_country.test.sql`, `supabase/tests/gym_page_publish*.test.sql`, `gym_page_status.test.sql` (+ shared fixture `pageContentCases.json`), `gym_page_content.test.sql`, `public_site_*` isolation tests; `scripts/check-migration-guardrails.mjs` (revoke public+anon on every function)

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0169_countries_cities.sql` (provisional number, next free at merge) -- tables, normalizer, seeds (ISO list generated from `Intl.DisplayNames` en/fr, Cameroon cities), `gyms.city_id`, country-change trigger, backfill, RPCs `add_city`, `update_city`, `list_gyms_without_city`, `set_gym_location`, location pin trigger, support catalog row, city re-snapshot trigger, redefined gate/snapshot/status/refresh trigger/`set_gym_page_content`, `do $verify$` block
- [x] `scripts/rollback-0169-countries-cities.sql` -- reverse, restoring 0164/0166/0167/0161 definitions
- [x] `supabase/tests/countries_cities.test.sql` (+ update pinned tests above) -- constraints, backfill, normalizer, every RPC error code, rename re-snapshot, country-change clear, privilege and isolation, consumer scan: no function body except the allow-list reads `page_city`
- [x] Dashboard: city combobox in `LocationSection` (alias-aware, "Ask GymOS to add it"), form/service/schema/checklist changes, tests, en/fr
- [x] Super Admin: `/cities` page (list, add/edit modal with aliases and coordinates, "Gyms without a city" panel), service, actions with typed-error mapping, nav link, tests, en/fr
- [x] `packages/types` -- types and codes; `docs/decisions.md` -- 25.1 entry (decisions above, rollback, tests)

**Acceptance Criteria:**
- Given the migration, when it runs, then the tables, uniques and checks exist, `gyms.city_id` is nullable, and unmapped gyms are listed and fail the gate with `no_city`
- Given Owner or Supervisor in the editor's Location block, when they pick a country and city and save, then only that country's cities are offered, an alias resolves, free text cannot be saved, and a Supervisor's country change is accepted
- Given a Super Admin, when they add/edit a city, then it is audited, collisions return typed errors, and no gym's `city_id` changes
- Given a city rename or slug change, when saved, then dependent pages are re-snapshotted and the old slug is stored for 12 months
- Given a published gym whose city or country changes, when the refresh runs, then the page re-snapshots if the gate holds, otherwise unpublishes

## Implementation Notes

- Additions beyond the spec, accepted: typed error `invalid_alias`; a map action in the Gyms-without-a-city panel (through `set_gym_location`); a renamed city keeps its old name as an alias; per-country advisory lock in the city RPCs. Migration 0169 is provisional. Local DB was migrated through psql. deno and layout ci-local stages were not run by the implementer.
- Review pass 1 patches: items 1-7 above.

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|
| 1 | decisions.md 25.1 entry corrupted (file header pasted mid-bullet, `$'` replacement artifact) | high | patch | docs/decisions.md lines 10-24: intro paragraph sits inside the Normalizer bullet |
| 2 | LocationSection: back to stored country returns before `++loadSeq`, stale response lands under it | medium | patch | LocationSection.tsx 131-134 returns before 135 `++loadSeq`; a late response still passes `seq === loadSeq.current` |
| 3 | Rollback restores page_city only where null | medium | patch | rollback line 19 `g.page_city is null`; legacy text stays stale for a gym that chose another city after 0169 |
| 4 | place_norm / placeNorm miss decomposed (NFD) input | medium | patch | place_norm folds precomposed letters only; typed e+U+0301 misses the alias |
| 5 | listCitiesPage returns an error when only list_gyms_without_city fails, against its comment | low | patch | actions.ts returns `data: null` on `unmappedRes.error` |
| 6 | No test that a gym with only a city reads in_progress (get_gym_page_status v_started) | medium | patch | gym_page_status.test.sql sets other content before any city |
| 7 | predictedBreaks comment says the Location block "never leaves a page without" a city; a Settings country change does | low | patch | landingPage.ts:189 vs trigger gyms_z_clear_city_on_country_change |
| 8 | Backfill and live-page re-judge not exercised by any test; live pages without a mapped city unpublish at deploy | medium | defer | one-shot migration code; needs a rolled-back proof on legacy rows and a dry-run list before prod apply |
| 9 | AC, TA, XK selectable in Settings but absent from countries | low | defer | libphonenumber list vs ISO seed; Cameroon pilot unaffected |
| 10 | Settings country change clears the city and unpublishes with no pre-save warning | medium | defer | by approved intent; a warning is new UI |
| 11 | Country names from Intl.DisplayNames short forms ("Congo - Kinshasa") will be public headings | medium | defer | first public use is 25.3; added to its acceptance criteria |
| 12 | /cities select string with embeds only tested against a mock | low | defer | owner browser QA covers it |
| 13 | Lowercase or padded gyms.country never backfills or passes the gate | false | rejected | 0105 CHECK `^[A-Z]{2}$` makes such values impossible |
| 14 | Unmapped panel cannot map gyms with null or lowercase country | false | rejected | country is NOT NULL and upper-case by CHECK; the non-ISO case is #9 |
| 15 | "Ask GymOS to add it" has no contact path | low | rejected | the AC asks for that text; a channel is new surface |
| 16 | list_gyms_without_city only lists gyms with legacy text; limit 1000 unflagged | low | rejected | matches the AC; 1000 unreachable at launch |
| 17 | No hide flag for a mistaken city | low | rejected | spec Never: no delete; rename fixes a typo |
| 18 | Unbounded reads, 50-item combobox, countries refetched per save | low | rejected | volumes far under limits |
| 19 | Fold table gaps, final sigma, U+02BC | low | rejected | unreachable for the launch country; #4 covers the realistic case |
| 20 | CityModal comma split, edit placeholder, case-only alias edit dropped, rename adds old name as alias, 50-alias cap | low | rejected | contrived or documented in decisions.md; fixes add branches |
| 21 | Hard-coded counts 249/9/233 in verify and plan | low | rejected | deliberate pins that fail loudly |
| 22 | Spec Implementation Notes empty | low | patch | filled in this pass |

### Review Findings

Second review, 2026-11-12 (`bmad-code-review`, four layers: blind-hunter, edge-case-hunter, verification-gap, acceptance-auditor; whole diff `6e578eb..6a68d53`). 0 decision-needed, 5 patch, 2 defer, 26 rejected (the rejected ones include repeats of triage #13-#21 above).

- [x] [Review][Patch] (medium) The Location block offers 7 countries that Settings refuses: AQ, BV, GS, HM, PN, TF, UM [apps/dashboard/services/landing-page.ts:264,289 and apps/dashboard/services/landing-page.ts saveLandingPageLocation] — the `countries` seed has 249 codes; `libphonenumber-js` `getCountries()` has 245, and these 7 are in the seed but not in it (checked by script). `set_gym_location` accepts them as soon as a Super Admin adds a city there. After that `settings/actions.ts:73` (`isSupportedPhoneCountry`) answers `invalidCountry` to every Settings save, because the form always sends `country`; `resolvePhoneCountry` silently falls CSV import back to CM. Fix: filter the editor's country list with `isSupportedPhoneCountry`, and have the location save reject an unsupported code before the RPC, the same rule Settings uses. Sources: edge-case-hunter + blind-hunter.
- [x] [Review][Patch] (medium) No editor test shows the page taking the data a location save returns [apps/dashboard/app/(dashboard)/settings/landing-page/components/LandingPageEditor.test.tsx:722-843] — every Location test uses a `saveLocationAction` mock whose `status` is the unchanged default. Deleting the `applyData(...)` call at `LandingPageEditor.tsx:373-376` leaves them green; so does deleting `onSavedReloadFailed`. Add (a) a save that resolves with `status: ready, missing: []` after `missing: ["no_city"]` and assert the badge/checklist change, (b) `{data: null, error: null, reloadFailed: true}` asserts `loadLandingPageAction` is called and `pageEditor.savedReloadFailed` shows. Source: verification-gap.
- [x] [Review][Patch] (low) Switching the country back to the stored country drops the stored city [apps/dashboard/app/(dashboard)/settings/landing-page/components/LocationSection.tsx:124-137] — `onCountryChange` clears `cityId` and `query` before the `next === storedCountry` branch, which restores only the list. The Owner who flips the select and flips it back has no city chosen and Save is off until the city is typed again. Fix: in that branch also `setCityId(storedCityId)` and `setQuery` to the stored city's name. Sources: edge-case-hunter + blind-hunter.
- [x] [Review][Patch] (low) "1 gyms" on every city row with one gym [apps/super-admin/locales/en.json:467, apps/super-admin/locales/fr.json:467, apps/super-admin/app/(admin)/cities/components/CitiesPageClient.tsx:91] — `rowDetail` is a flat string. Fix: pass `count` and add `_one`/`_other` keys in both locales (keep `check-i18n-key-parity` green). Source: blind-hunter.
- [x] [Review][Patch] (low) The `predictedBreaks` comment says a country change "is not made from this editor" [apps/dashboard/lib/landingPage.ts:188-190] — the Location block's own Save changes `gyms.country` too (it needs a city of the new country, so it does not unpublish). Reword the comment only. Source: edge-case-hunter.
- [x] [Review][Defer] Backfill and the `do $refresh$` loop in 0169 never run against real rows, and no script lists the live pages that will unpublish [supabase/migrations/0169_countries_cities.sql:1576] — deferred: already recorded in `deferred-work.md` (triage #8); must be done before the production apply. Nothing new added there. Sources: verification-gap + acceptance-auditor + blind-hunter.
- [x] [Review][Defer] `epic-25-context.md` (line 31) and `epics.md` story 25.1 AC (line 3857) still describe `cities.aliases text[]` and `numeric(8,5)`; the migration has the `city_aliases` table and `numeric(9,6)` [_bmad-output/implementation-artifacts/epic-25-context.md:31, _bmad-output/planning-artifacts/epics.md:3857] — deferred: the fix edits context/planning docs, not code. Correct both before the 25-2 spec is written, since 25-2 reads this context. Sources: blind-hunter + acceptance-auditor.

Already in `deferred-work.md`, seen again by this review and not added: AC/TA/XK not in `countries` (#9), no warning before a Settings country change unpublishes (#10), country names are ICU short forms (#11), `/cities` embed tested only against a mock (#12).

#### Rejected

- Lowercase or non-ISO `gyms.country` blocks `mapGymToCity` (edge-case-hunter) — false: CHECK `gyms_country_iso2` (0105) forces `^[A-Z]{2}$`; same as triage #13/#14.
- `clear_gym_city_on_country_change` fires on a case or whitespace rewrite of the country (edge-case-hunter) — false: the same CHECK makes such a value impossible.
- Cities read and unmapped list hit the PostgREST 1000-row cap (edge-case-hunter, blind-hunter) — low: 12 seeded cities; the unmapped cap is documented in the migration; same as triage #16/#18.
- Alias with a comma is split; case-only alias edit is a silent no-op (edge-case-hunter) — low: contrived, same as triage #20; a fix adds branches.
- Enter on an exact name replaces it with the first prefix match (edge-case-hunter) — low: needs two city names where one starts with the other, none seeded; Tab keeps the exact hit.
- Typing part of a name and tabbing away leaves Save off with no message (blind-hunter) — low: the dropdown and hint show the way; a message needs new copy in both languages.
- City list load failure leaves the new country selected (edge-case-hunter) — low: the error message shows and re-picking retries.
- Gym with only legacy `page_city` reads `not_started` (edge-case-hunter) — low: the text can no longer be edited, and `list_gyms_without_city` is the route for it.
- Unknown country code gives an empty list instead of `unknown_country` (edge-case-hunter, blind-hunter) — low: the select only sends listed codes.
- Stale `no_country` copy "set it in Settings" (blind-hunter) — low: Settings still has a country select, so the text is not wrong, and the code is nearly unreachable (`gyms.country` is NOT NULL).
- Trigger-driven city clear has no audit row (blind-hunter) — low: by approved intent (#10); the Settings country write is the audited action.
- Supervisors writing `gyms.country` not impact-checked (blind-hunter) — false: the owner approved this in the spec; the consumers (`resolvePhoneCountry`, Settings) were checked and the one real issue is the first patch above.
- Rollback script is unproven and drops cities (blind-hunter) — low: proven locally per decisions.md; the production backup rule already covers every prod migration.
- Country seed generated from ICU, not curated; no hide flag (blind-hunter) — low: the seed is a fixed literal in the migration; name review is already deferred (#11); the unsupported-code part is the first patch.
- Non-Latin city name derives an empty slug and fails late with a generic message (blind-hunter) — low: the error does tell the admin to give a slug; a pre-submit check adds a branch.
- `FieldMessage`, `errId`, `described` copied from `ContentSections.tsx` (blind-hunter) — low: 3 tiny helpers, no divergence shown.
- Address edits are not saved by "Save location" (blind-hunter) — low: the helper text says so and the page's unsaved-change guard still tracks the address.
- Extra serial round trip and countries refetched on every load and save (blind-hunter, edge-case-hunter) — low: volumes tiny.
- Migration "0169" hard-coded and provisional; verify pins 249/12/9 (blind-hunter) — low: known and recorded; the pins fail loudly on purpose (#21).
- Reserved slug list lives only in SQL (blind-hunter) — low: 25.3 and 25.5 add words by migration, the normal route.
- Changing country needs the target country to already have a city (acceptance-auditor, blind-hunter) — false: that is the specified behaviour ("pick a country and city").
- `service_role` loses all access to the new tables (acceptance-auditor) — false: deliberate, asserted by `do $verify$`, and no service-role reader is named.
- `invalid_alias`, rename-keeps-old-name alias, map action, advisory lock go beyond the frozen spec (acceptance-auditor) — rejected: accepted additions recorded in decisions.md; the fix would be to edit the spec under review.
- Spec header says `done` while sprint-status says `review`; empty Spec Change Log; `review_loop_iteration` (blind-hunter, acceptance-auditor) — rejected: the fix is to edit the spec under review.
- `update_city` early return ignores an alias spelling change with the same fold (edge-case-hunter) — low: same as #20.
- Editor loads cities with no limit / country code format check (blind-hunter) — low: same as the cap entry above.

## Design Notes

Coordinates for seeded cities are approximate and for map dots only; the Super Admin can edit them. `list_gyms_without_city()` returns gym id, name, country and the legacy `page_city` text for hand-mapping.

## Verification

**Commands:**
- `bash scripts/ci-local.sh` -- expected: GREEN, per-stage lines read (not only the final line)
- `pnpm check:migrations` and `node scripts/check-i18n-key-parity.mjs` -- expected: pass
- pgTAP run of the new and updated tests -- expected: all pass; run the changed gate test once against a known-bad fixture to show it can fail

**Manual checks (if no CLI):**
- Owner picks "Yaounde" in the editor and the live page snapshot shows "Yaoundé"; Super Admin renames a city and the page updates
