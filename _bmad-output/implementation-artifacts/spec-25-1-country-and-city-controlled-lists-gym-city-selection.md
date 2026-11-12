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

## Design Notes

Coordinates for seeded cities are approximate and for map dots only; the Super Admin can edit them. `list_gyms_without_city()` returns gym id, name, country and the legacy `page_city` text for hand-mapping.

## Verification

**Commands:**
- `bash scripts/ci-local.sh` -- expected: GREEN, per-stage lines read (not only the final line)
- `pnpm check:migrations` and `node scripts/check-i18n-key-parity.mjs` -- expected: pass
- pgTAP run of the new and updated tests -- expected: all pass; run the changed gate test once against a known-bad fixture to show it can fail

**Manual checks (if no CLI):**
- Owner picks "Yaounde" in the editor and the live page snapshot shows "Yaoundé"; Super Admin renames a city and the page updates
