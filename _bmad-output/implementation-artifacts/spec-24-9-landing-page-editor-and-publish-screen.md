---
title: '24-9 landing-page editor and publish screen'
type: 'feature'
created: '2026-11-08'
status: 'done'
baseline_commit: 'b4464e2bc48a0d590e6f87c6ee1a823857b4109f'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-24-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The database can publish a page (24.5 to 24.8) but no screen drives it. `gym_pages` is closed to every client role, so the dashboard cannot read page status, the missing gate codes, the media list or the would-be public content. Content, page-name and publish RPCs have no dashboard service or action (FR-197 screen, FR-198, FR-199 reasons, FR-201 selection).

**Approach:** One migration adds a read-only `get_gym_page_status` function; the dashboard gains `/settings/landing-page` (editor) and `/settings/landing-page/publish` (what becomes public, attestation, publish, unpublish), with services, actions, EN/FR copy and tests. UX source: `EXPERIENCE.md` "Landing page" screens (read it first); where it and the shipped database disagree, the database wins and the difference is recorded.

## Boundaries & Constraints

**Always:**
- `get_gym_page_status(p_gym_id) -> jsonb`, read-only, `security definer`, same admission as `get_gym_page_name` (live Super Admin, or Owner/Supervisor/live-assigned support via `support_rpc_gym_id/role`; a capability row; no audit row). Returns: state (`not_started | in_progress | ready | published | offline_gate | offline_suspended | offline_name_released | taken_down`), template, `published_at`, `unpublished_reason` parsed to codes, `missing[]` from `private.gym_page_gate_missing`, `bad_text_fields[]` (which of gym name, about, services, address, city, plan name holds `<`, `>` or a control character), per-language completeness (code, complete, characters, characters still needed), live media rows (id, kind, derivative key, sort order, no gym id, no uploader), and the would-be snapshot from `private.gym_page_snapshot`. Revoked from `public, anon`; `$verify$` block, rollback script `scripts/rollback-0165-*.sql`, hand-spliced `database.ts`, `set local lock_timeout = '5s'`.
- Content languages come from ONE list (today `en`, `fr`) shared by editor tabs, completeness line, publish rows and the status function; nothing else hard-codes an EN/FR pair. A language is complete when About is at least 100 characters after trim.
- Editor saves through `set_gym_page_content` (content patch plus `p_plans`); CRLF and lone CR are normalised to LF in about, services and address before Zod and before the call; plan visibility is one "Show on my page" switch per plan, default off, no label fields. `<` and `>` are rejected inline, naming the field and language.
- One shared valid/invalid fixture (emoji length UTF-16 vs code points; lat/lng rounding: SQL rounds to 6 places, Zod rejects 90.0000004) is run by both a vitest and a pgTAP test.
- Name section: Owner (and Super Admin) call `claim_page_name`; Supervisor and support see read-only text "Only the Owner can change the page name."; the service maps `permission denied` and `claim_page_name: gym ... is not active` to typed name errors (one mapper test per code against the real message). Absent controls are removed from the DOM, not disabled.
- Publish screen lists exactly the fields in the would-be snapshot (rows generated from the status function's snapshot, not a second field list), the public address, the languages offered with "Not included" for an incomplete one, and "Never shown" text; one attestation checkbox gates [Publish page]; the server result is trusted (`published:false` lists the missing items with anchors; `taken_down` shows no Publish button). Unpublish is a confirm modal, always allowed.
- Status banner per unpublish reason (one EN/FR sentence per gate code plus `name_released`, bulleted in checklist order) on the editor and the publish screen. Taken-down shows its banner without an Appeal button (24.11 owns the writer).
- Settings gains a "Landing page" row (status badge plus label plus icon, [Open]) for Owner, Supervisor and support only; no sidebar entry. First Settings visit shows [Set up my page]/[Not now]; dismissal is remembered per user in browser storage (try/catch); nothing is published either way.
- All copy EN and FR through the i18n layer (`pageEditor.*`); a parity test pins `pageEditor.*` and `pageMedia.errors.*` keys in both locales. Template picker offers `classic` from one constant module (24.10 owns the registry); the swap never re-asks for content.
- Images use the existing 24.6 actions with the attestation; gallery limit comes from `PAGE_MEDIA_MAX_GALLERY` (12, as shipped; the UX line saying 10 is corrected in `EXPERIENCE.md`, owner decision 2026-11-08). Logo comes from Branding through `preparePageLogoAction`.
- Owner decisions 2026-11-08: (1) `private.gym_page_snapshot` omits `about_xx` and `services_xx` for a language whose About is under 100 characters after trim, in migration 0165, using the same completeness rule as the status function (one SQL definition); the 24.8 key-path test is updated deliberately and a test covers a half-filled French About on a live page. (2) `register_page_media` caps uploads per gym at 30 per rolling 24 hours (all kinds, deleted rows counted), raising `limit_reached`; one pgTAP case at 30 and 31.

**Never:** No change to the 24.5 setter, the 24.8 gate codes, publish/unpublish functions or the snapshot key list (the snapshot builder change above only omits values, it adds no key). No public route, template renderer or conformance suite (24.10). No takedown writer, appeal, report form, sitemap or purge (24.11). No visual page preview (the route does not exist; the publish list is the preview). No alt text ("Describe this image"): the media table and snapshot have no field for it. No Storage or Vercel change, no production deploy. Do not touch `scripts/demo-gym/` or `apps/dashboard/AGENTS.md`. Do not regenerate `database.ts`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Gate not met | no banner, About 60 chars | status `in_progress`, [Review & publish] disabled, items link to fields, French shows "needs 40 more characters" | N/A |
| Pasted Windows text | About with `\r\n` | saved as LF, page publishes | N/A |
| Hostile gym name | plan name contains `<` | `bad_text_fields` names the plan; banner names the field | typed error, no raw message |
| Last public plan off | live page | warning first, page goes offline with reason shown | N/A |
| Supervisor opens name | any state | read-only text, no claim control in the DOM | N/A |
| Owner claims name | valid | state `held`: "name under review" or `active` | typed code per error |
| Publish | all met, box ticked | success region focused, address, [Copy link], 2-minute note | N/A |
| Publish, gate fails server-side | stale checklist | nothing written, missing list with anchors | N/A |
| Taken-down page | `taken_down_at` set | banner, no Publish button | `taken_down` |
| Deactivated support | next call | refused | `permission denied` mapped |
| Existing gym, first visit | no page | prompt, nothing published | N/A |
| Third language added to list | list gains `de` | tab, completeness row, publish row appear without new copy structure | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0164_publish_gate_snapshot.sql:137-257,605-701` -- `private.gym_page_snapshot`, `gym_page_gate_missing` (13 codes), `gym_page_gate_phrase`, `publish_gym_page`, `unpublish_gym_page`; model for gates and `$verify$`.
- `supabase/migrations/0163_page_names.sql:578,836,879` -- `claim_page_name`, `get_gym_page_name` (admission and capability-row model for the new read function).
- `supabase/migrations/0161_gym_page_content.sql:329-537` -- `set_gym_page_content` patch/`p_plans` contract; `0162_gym_page_media.sql:76-183` -- media functions and limits.
- `packages/types/src/schemas/gym.ts:270-512` -- content, media, name and publish Zod schemas and code lists (add the languages list, status schema, CRLF normaliser, shared fixture).
- `apps/dashboard/services/page-media.ts`, `app/(dashboard)/settings/page-media-actions.ts` -- 24.6 template: typed `PageMediaError`, `pageMediaCodeFromDbError`, actions. Reuse as is.
- `apps/dashboard/app/(dashboard)/settings/page.tsx`, `SettingsForm.tsx` (~205), `StaffSection.tsx`, `staff/page.tsx` -- row pattern, Suspense sub-route pattern, role booleans; `GymosSupportSection.tsx:~63-80` -- hand-rolled `role="switch"`; `components/ui/{badge,tabs,dialog,checkbox,card}.tsx`.
- `apps/dashboard/services/gym-settings.ts:451`, `services/session.ts:24` (`mapAndLog`), `settings/actions.ts` -- action/service pattern with `{data, error}`.
- `apps/dashboard/locales/{en,fr}.json` -- existing `pageMedia`, `pageNames`, `pagePublish` blocks; new `pageEditor` block.
- Tests to update: `supabase/tests/support_capabilities.test.sql` (plan 146, count 41 to 42, `cls` list), `gym_page_publish.test.sql:793-803` (gym_pages mention allowlist), `apps/dashboard/lib/pagePublishSchema.test.ts`; `scripts/check-migration-guardrails.mjs`; next migration number 0165.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0165_gym_page_status.sql`, `scripts/rollback-0165-gym-page-status.sql` -- read function, capability row, verify block, snapshot omits incomplete-language text, 30-per-24h upload cap in `register_page_media` (update `gym_page_media.test.sql` and the 24.8 key-path test deliberately)
- [x] `supabase/tests/gym_page_status.test.sql` (+ shared fixture test) -- role matrix, every state, every gate code appears in `missing`, `bad_text_fields`, language completeness, no gym id/uploader leak, deactivated support refused
- [x] `packages/types` (`schemas/gym.ts`, `database.ts` splice) -- languages list, status schema, normaliser, fixture
- [x] `apps/dashboard/services/landing-page.ts`, `settings/landing-page/actions.ts` -- status, save, plan switches, claim, publish, unpublish; typed error mappers
- [x] `apps/dashboard/app/(dashboard)/settings/landing-page/{page,publish/page}.tsx` and client components -- editor sections, tabs, checklist, name section, images, template card, banners, publish list, modals
- [x] `settings/LandingPageSection.tsx`, first-visit prompt -- Settings row and prompt
- [x] `apps/dashboard/locales/{en,fr}.json` -- `pageEditor.*` plus parity tests
- [x] `_bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md` -- change "gallery (up to 10)" to 12, one line
- [x] vitest for services, actions, mappers, CRLF, tab behaviour, role-gated DOM; `docs/decisions.md`, `deferred-work.md` (close the 24.9 lines, move name-replaced and name-released Owner notices to 24.11 with an acceptance criterion, record dropped alt text), `sprint-status.yaml`

**Acceptance Criteria:**
- Given the status function, then a test enumerates every client-readable page fact and fails when a gym id, uploader, plan id or token appears
- Given any gate code, then the checklist has an EN and FR phrase and an anchor, and a missing mapping fails a test
- Given `scripts/ci-local.sh` and `check-migration-guardrails.mjs`, then both pass with per-stage lines read and a known-bad mutation (status function granted to anon) shown failing
- Given a first preview deploy, then an image upload is verified end to end (recorded by the owner; not a CI gate)

## Implementation Notes

## Spec Change Log

## Review Triage Log

Pass 1 (layers: blind-hunter, edge-case-hunter, verification-gap; diff `b4464e2` plus the uncommitted build, spec excluded from the diff).

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| Remove-language warning decided from unsaved form text (`otherCompleteLanguage`, LandingPageEditor.tsx:198) | medium | patch | reads `form.about`, but removal saves only the nulls; a live page can go offline with no warning (blind + edge) |
| Save commits, then the follow-up `getLandingPageData` read fails: editor shows an error for a stored save (services/landing-page.ts:271) | medium | patch | `return getLandingPageData()` after the RPC succeeded; the error banner says save failed (blind + edge) |
| No unsaved-changes guard: Review & publish, links, tab close drop typed edits and the publish list shows the saved content | medium | patch | everyday path; smallest fix is a dirty flag with `beforeunload` and a confirm on the Review & publish link |
| Focus refresh can overwrite fresher post-save data; runs during a save (LandingPageEditor.tsx:89-101) | medium | patch | `refresh` has no sequence check and no `saving` guard (blind + edge) |
| CRLF/control normalisation only in the client form; service and action pass input to Zod unchanged (spec: normalise before Zod and before the call) | medium | patch | services/landing-page.ts:252-264 parses `setGymPageContentSchema` directly; a direct Server Action call stores CR and fails the gate later |
| Publish list prints the raw category code (PublishScreen.tsx:104) | medium | patch | `snap.category ?? na`; the editor uses `gymCategoryLabel`; Owner sees `pilates_studio` |
| Decimal comma refused in lat/lng; `1e1` and `0x10` accepted by `Number()` | low | patch | direct correction: normalise the comma, require a decimal pattern before `Number()`; French keypads type a comma |
| Accessibility: plan switch has `aria-labelledby` and a dead `aria-label`; template card is `role=radio` with `tabIndex` and no behaviour; field errors have no `aria-describedby` | medium | patch | the accessible name loses "Show on my page"; a focusable radio that does nothing misleads keyboard users |
| Comment says the gym id is never accepted from the browser; image actions pass `gymId` from the client | low | patch | one-line comment correction; the database checks the id against the caller (24.6) |
| Settings row wiring untested: removing `canSeeLandingPageRow(role) &&` or `landingPageState=` keeps all tests green | medium | patch | verification-gap; add the `page.test.tsx` cases and a role-matrix render of the row |
| `ImagesSection` (attestation gate, size precheck, upload form, gallery full) has no test | medium | patch | verification-gap; removing `!attested ||` keeps every test green |
| Remove-language confirm, error and live-warning paths untested | medium | patch | verification-gap; only the button's existence is asserted |
| Real status JSON never parsed by the strict Zod schema; pgTAP key list and `PAGE_STATUS_STATES` not tied to Zod | medium | patch | a key added to SQL and pgTAP but not Zod passes both suites and fails closed in production; add a vitest reading the pgTAP key list and state `case` |
| `cleanPageText` control range not pinned to the gate's class | medium | patch | dropping `\u007f-\u009f` keeps tests green; paste with NEL then fails `bad_text` |
| "No hard-coded EN/FR pair" test lists a nonexistent file and skips missing files silently; `plan_not_in_gym`, `unknown_key` mappers not pinned to 0161 text | low | patch | direct corrections to two tests |
| Upload cap: hard-deleted `gym_page_media` rows (24.11 purge) reset the 24-hour count | medium | defer | unreachable until 24.11 writes a purge; becomes a 24.11 acceptance criterion |
| `limit_reached` is shared by the 12-image and 30-per-day limits | low | rejected | the spec's frozen decision names `limit_reached`; the copy was reworded to name both limits; a new code is a spec change |
| Stored snapshots of already-live pages keep an incomplete language until the next refresh | low | rejected | nothing is published anywhere (0160-0164 are not in production); the pre-deploy check is recorded in deferred-work.md |
| Strict response schemas make a deploy-order gap fail closed (`load_failed`) | low | rejected | deliberate: strictness is the pin; migrations deploy before dashboard code |
| Concurrent editors overwrite each other (every field re-sent) | low | rejected | last-write-wins is the pattern of every Settings form; a version column is new public surface |
| Plan deleted elsewhere keeps its id in the form and the save is refused | low | rejected | rare; a reload fixes it and the error is typed |
| Publish screen lists plans by name only; no per-language labels | false | rejected | the owner decision (2026-11-08) is name as entered plus translated details; the labels stay unused |
| Publish attestation is client-only and unrecorded | false | rejected | the spec asks for one checkbox that gates the button; image attestation is recorded at upload |
| `bad_text` flags text of an incomplete language that is not published | low | rejected | the 24-5 CHECK already blocks `<` and `>` on page columns; only control characters remain and the editor strips them |
| Hours "gym time zone" copy; timezone key not closed | false | rejected | the timezone-key deferral names 24.10, not 24.9; the gym already has a time zone setting |
| Publish button enabled while codes are missing; success region needs `host`; focus timeout not cleared | low | rejected | the spec has the server re-validate and list what is missing; none is met in everyday use |
| Hard-coded domain, media URL fallback, duplicated limits, `TYPE_KEY` copy, dead `textFocusRef`, `testData.ts` under `app/` | low | rejected | cosmetic; `testData.ts` is not a route file |
| `publishRows` is a second field list | false | rejected | rows are filled from the snapshot values; the key registry is pinned to the strict snapshot schema by a test, so a new key fails CI |
| `landingPageUserKey` is shared by all support users in one browser | low | rejected | one browser, dismissal only hides a prompt |
| `validateForm` is a third copy of the rules, not run against the shared fixture | low | rejected | only the inline message degrades; the server stays authoritative |
| Serial status RPC on every Settings render; two-read status without a shared snapshot; regex in `$verify$` | low | rejected | not met in everyday use; the fix adds complexity |
| `epic-24-context.md` recompile dropped the 24.2 host-neutral line and FR ids | low | rejected | the compile rules say to describe by purpose and keep it short; the 24.2 spec holds that criterion |

### Review Findings (pass 2, 2026-11-08)

Layers: blind-hunter, edge-case-hunter, verification-gap, acceptance-auditor; diff `b4464e2..HEAD` (8161 lines, run unchunked at the owner's choice). 0 decision-needed, 6 patch, 3 defer, 27 rejected.

- [x] [Review][Patch] "Back to Settings" link drops unsaved edits without asking (medium): pass 1 guarded only the Review & publish link and `beforeunload`; `beforeunload` does not fire for Next client-side navigation [apps/dashboard/app/(dashboard)/settings/landing-page/components/LandingPageEditor.tsx:249]
- [x] [Review][Patch] Phone error shows an example with spaces ("+237 6 XX XX XX XX") that the validator rejects (`E164_RE` takes no spaces); change the EN and FR example to an unspaced E.164 number (medium) [apps/dashboard/locales/en.json:687]
- [x] [Review][Patch] `pageEditor.errors.tooLong` says "2,000 characters" for address (300) and city (100); pass the field's limit as `{{max}}` (low) [apps/dashboard/lib/pageEditorForm.ts:117]
- [x] [Review][Patch] Publish screen treats `offline_suspended` as live: shows [View page] and "This page is live" for a page that returns not-found; show both only for `published` (low) [apps/dashboard/app/(dashboard)/settings/landing-page/components/PublishScreen.tsx:46]
- [x] [Review][Patch] Editor wiring of the warn-before-offline dialog is tested only for the last public plan; add an `it.each` on a published page for About under 100 in every language, empty city, no phone or WhatsApp, and no open day, each expecting its `gateItem.*` line and no save before confirm (medium, verification-gap) [apps/dashboard/app/(dashboard)/settings/landing-page/components/LandingPageEditor.test.tsx:201]
- [x] [Review][Patch] Record two small drifts: hours validation (overnight windows allowed, only open = close refused, as shipped in 24.5) against EXPERIENCE.md "closing must be after opening", under "Differences from EXPERIENCE.md" in `docs/decisions.md`; and correct the `gymPageStatusContract.test.ts` comment that overstates its protection (the pinned list covers only the paths the test gyms exercise) (low) [docs/decisions.md]
- [x] [Review][Defer] Third language is not a one-place change: `GYM_COLUMNS`, `toContent`, `CLEANED_CONTENT_KEYS`, the strict snapshot schema, `private.gym_page_gate_missing`, the `bad_text` concatenation and the refresh triggers (0164) still name the EN/FR pair, and the number 100 is repeated in 0165 and 0164 — deferred: the owner kept the gate and snapshot key list untouched on purpose (spec Never list); becomes an acceptance criterion of whichever story adds a third language, with a pgTAP check that iterates `gym_page_languages()` against the gate, `bad_text` and the triggers
- [x] [Review][Defer] `epic-24-context.md` still says gallery "up to 10" and "optional Describe this image" (line 60) and lists the 24.9 open items as open (line 47) — deferred: the fix edits an agent-context file; refresh it when the context is next recompiled, before 24.10 starts
- [x] [Review][Defer] Editor reads `gyms` page columns and `plans` with plain table selects; an assigned-support caller may get no row from RLS and see `load_failed` (medium if true, unverified) — deferred: the owner's support-role browser pass settles it; if it fails, read both through the status function or a new read RPC

#### Rejected (pass 2)

| Finding | Why |
|---|---|
| The "2 business days" name-review SLA is invented (blind, auditor) | false: EXPERIENCE.md lines 407 and 2687 carry "We'll tell you within 2 business days" and its FR twin |
| Counter counts CRLF before cleaning (edge) | false in a browser: a textarea's `.value` is always LF-normalised, so raw CR never reaches the counter |
| Publish attestation is client-only (edge) | already rejected in pass 1 (the spec asks for one gating checkbox) |
| Publish success hidden when `host` is null; `failedMissing` outlives a refresh (edge) | already rejected in pass 1 (low, not met in everyday use) |
| Save sends every plan's switch from the load-time form; focus refresh does not merge plans added elsewhere (edge) | already rejected in pass 1 (last-write-wins, rare) |
| Thrown Server Action on save shows "Try refreshing the page" (blind, edge) | low: needs a network drop mid-save; a distinct unknown-outcome path adds a branch and a message |
| `removeLanguage` can run while a save is in flight (edge) | low: both are sub-second and the second call re-saves the cleared fields |
| `refresh` issued by name/images sections during a save can land stale (edge) | low: the sequence number already discards older reads; a rare overlap |
| `focusFirstError` focuses a non-focusable hours card; `toSaveInput` coordinate parse without validation (edge) | low: hours cards still scroll into view; `validateForm` always runs first |
| Held name leaves Claim enabled (edge) | low: the server decides and returns a typed error |
| `predictedBreaks` copies five gate rules against the file header (blind) | the spec requires the warning; the comment is the only inaccuracy and adds no harm |
| Unrelated `gymosSupport` reformatting in `en.json` (blind) | low cosmetic |
| Accessibility: dropdown tabpanel label, "Closed" checkbox name, template card border, copy-link failure, skeleton `aria-busy` (blind) | low: the dropdown mode needs 5 languages (there are 2), one template exists, the rest are cosmetic |
| Plan `label_en/label_fr` public but not shown (blind) | low: the editor has no label fields and 24.5 defaults them to the plan name; pass 1 rejected the same point |
| Sanitiser misses U+2028/2029, zero-width and bidi characters (blind) | low: the gate class is 24.8's; widening it is a gate change |
| Plurals, takenDown copy without a next step, unknown plan type shown as Monthly (blind, auditor) | low: 24.11 owns the taken-down path; the type list is closed by a CHECK |
| `limit_reached` copy says "Remove an image" for the daily cap (auditor) | low: the sentence names both limits and ends "or try again tomorrow" |
| Upload cap consumed by logo re-use and banner replacement; `PAGE_MEDIA_UPLOADS_PER_DAY` unused (blind, verification-gap) | owner decision 2 counts every row; the constant is cosmetic |
| `epic-24-context.md` dropped FR ids and the 24.2 line (blind, auditor) | already rejected in pass 1 |
| `EXPERIENCE.md` edit is three lines; Code Map files not touched (auditor) | harmless; both tests still pass |
| Route guards on the two pages have no test (verification-gap) | low: courtesy redirect only; the service and the database refuse the role |
| `v_state` exact-match on `name_released` (auditor) | low: combined reasons are unreachable today |
| Spec status `done` against sprint-status `review`; empty Implementation Notes (blind) | fix edits the spec under review |
| Rollback script has no automated test (verification-gap) | low: a manual rolled-back run is recorded and the script carries its own `$verify$` |

## Design Notes

The snapshot is the single source for the publish list, so "exactly what becomes public" cannot drift from what is published. The status function returns facts, not copy; the client maps codes to labels, which keeps a new gate code a one-place change.

## Verification

**Commands:**
- `bash scripts/ci-local.sh` -- expected: every stage PASS
- `node scripts/check-migration-guardrails.mjs` -- expected: pass
- `bash scripts/ci-local.selftest.sh` -- expected: pass if `ci-local.sh` is touched

**Manual checks (owner):**
- Local browser pass in EN and FR as Owner, Supervisor and assigned support: fill, upload, claim, publish, unpublish, auto-unpublish banner.
