---
title: '24-8 publish gate, snapshot and unpublish'
type: 'feature'
created: '2026-11-08'
status: 'done'
baseline_commit: 'cabcca4bce8f122d06f85274e68b569e5224e8d0'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-24-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Nothing can make a page public yet. `gym_pages` has no writer, the `public_site` views ignore the page name, and `page_media` is not tied to a page. A half-finished or retracted page must never be visible, and a page that stops meeting the gate must unpublish itself and say why (FR-199, FR-200, FR-206, FR-207, AD-46).

**Approach:** One migration adds `publish_gym_page`, `unpublish_gym_page` and `private.refresh_gym_page` (called by triggers), a pinned snapshot builder, one visibility predicate used by both views, and closes the deferrals that name 24.8. No Owner UI (24.9), no route or templates (24.10), no takedown writer (24.11).

## Boundaries & Constraints

**Always:**
- `publish_gym_page(p_gym_id, p_template)`: `SECURITY DEFINER`, same gate as `set_gym_page_content` (live Super Admin, or Owner/Supervisor/live-assigned support through `support_rpc_gym_id/role('publish_gym_page')`, role check before the `is not active` check; a non-Super-Admin needs an active gym). Takes no content. `p_template` is a name (`^[a-z][a-z0-9-]{1,30}$`; 24.10 owns the registry); null keeps the stored one, a first publish needs one. Refuses with typed `taken_down` when `gym_pages.taken_down_at` is set. Returns `{published, missing[]}`; a failed gate returns `missing` codes and writes nothing.
- Gate, one private function `private.gym_page_gate_missing(gym) -> text[]` shared by publish and refresh: the gym's own `active` name (`state='active'`, `taken_down_at` null; closes the 24-7 deferral), category, a live `logo` and `banner` media row, about (EN or FR) of at least 100 characters after trim, country and city, at least one of contact phone/WhatsApp, hours with at least one non-null day (the CHECK already refuses `{}` and `open == close`), at least one public plan, and `lat`/`lng` both set or both null (closes the 24-5 deferral). Text with control characters other than newline and tab fails the gate.
- Snapshot built inside the function by a fixed `jsonb_build_object` from tenant columns: `name` (gym display name), `about_en/fr`, `services_en/fr`, `address`, `city`, `country`, `category`, `map{lat,lng}`, `hours`, `contact{phone,whatsapp}`, `color` (only when `^#[0-9a-fA-F]{6}$`), `logo`, `banner` (derivative keys), `gallery[]` (keys by `sort_order`), `plans[]` (`name`, `label_en/fr` falling back to the plan name, `type`, `price`, `currency`, `interval`, `duration_days`; public plans only). Null fields are omitted. `content` is replaced and `page_name_id` set to the gym's active name in one statement. Add `name` to the `gym_pages_content_keys` CHECK, a size cap of 64 KiB, and type checks on `plans`, `gallery`, `hours` (closes the 24-4 content-limits deferral). A composite foreign key `(gym_id, page_name_id)` to `page_names` is added.
- Refresh: AFTER row triggers (with `when` old/new comparison, because the 24-5 pin triggers revert in place) on `gyms` page/name/category/country/color columns, `plans` (`is_public`, labels, name, price, currency, interval, duration), `gym_page_media` (insert, `deleted_at`, `sort_order`) and `page_names` (a row becoming `active`, so a rename moves `page_name_id`). `private.refresh_gym_page(gym)` does nothing for an unpublished page; for a published one it re-snapshots if the gate holds, else unpublishes with `unpublished_reason` (the missing codes) and `notify_page_unpublished` tells every active Owner (bilingual `staff_notices` plus `email_outbox`, copy of 0163 `notify_page_name_decision`). It takes the gym row lock first.
- `unpublish_gym_page(p_gym_id)`: same roles, always allowed (also for a suspended gym), sets `unpublished_at`, reason `owner`. Both set the name idle clock through `private.set_page_name_idle(gym, private.page_name_gym_idle(gym))`.
- One visibility predicate in a private view over `gym_pages`, `page_names` and `gyms` (published, `unpublished_at` null, `taken_down_at` null, name `active` and not taken down, gym `active`). `public_site.pages` (adds `name`) and `public_site.page_media` select from it. `page_media` is rebuilt from the snapshot's `logo`, `banner`, `gallery` keys and exposes `page_name_id`, never `gym_id` (closes the 24-6 deferral). Reader grants unchanged.
- Owner decision 2026-11-08 (suspension and names, option B): suspension and deactivation keep the snapshot (the predicate hides it) and the page returns on reactivation while the name is still held. The `page_names_sweep` is changed in this migration: for a gym that is not `active`, once its active name passes `reserved_until` (12 months idle) the sweep unpublishes the page (reason `name_released`, Owner notice) and releases the name and its redirects, under the gym row lock with the same re-checks and row-count guard as today. On reactivation the Owner must claim a name and republish. Tests: a suspended gym with a published page at 11 and 13 months, and reactivation after release.
- Capability rows for the two public functions, `support_audit_actions` rows for each audit action written, every function revoked from `public, anon` (private ones from all client roles), `$verify$` block, `set local lock_timeout = '5s'`, rollback script, hand-spliced `database.ts`, typed errors with EN and FR copy.
- Tests: a snapshot test pins every key path (an extra key fails it; no gym id, plan id, `gym_token`, login phone or `uploaded_by` appears); an enumeration test fails when a function writes `gym_pages` without being on the allowlist; role matrix incl. deactivated support refused on the next call; each gate code has a failing case; known-bad mutations (gate rule removed, predicate term removed, extra key) shown to fail.

**Never:** No change to the 24-5 setter or pin triggers. No takedown writer, report form, sitemap or purge (24.11). No route, template or editor (24.9, 24.10). No Storage or Vercel change, no production deploy. No re-encode in SQL. Do not touch `scripts/demo-gym/` or `apps/dashboard/AGENTS.md`. The `pin_plan_public` insert audit (seeds, imports, plan duplication) is read-only: record findings, change nothing.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Publish, gate met | Owner, all fields, 1 public plan | snapshot written, `published_at` set, name idle cleared | N/A |
| Gate not met | no banner, about 60 chars | `{published:false, missing:[no_banner, about_short]}`, nothing written | N/A |
| Half coordinate | lat set, lng null | `missing` contains `map_incomplete` | N/A |
| Caller supplies content | any extra argument | not accepted by the signature | N/A |
| Plan made private | last public plan | page unpublished, reason `no_public_plan`, Owner notice EN/FR | N/A |
| About edited, gate holds | published page | snapshot refreshed in the same transaction | N/A |
| Media deleted | published logo | page unpublished, reason `no_logo` | N/A |
| Rename approved | published page | `page_name_id` moves to new active row, page stays visible | N/A |
| Unpublish | Supervisor, suspended gym | `unpublished_at` set, view returns no row | N/A |
| Suspended gym | published page, under 12 months | view excludes it, snapshot and name kept | N/A |
| Suspended gym, 13 months | published page, name past `reserved_until` | sweep unpublishes (`name_released`), releases name, Owner notice | N/A |
| Taken-down page | `taken_down_at` set | view excludes it, publish refused | `taken_down` |
| Support deactivated | next call | refused | `permission denied` |
| Hostile text | `<`, control char, bad color | refused by CHECK / gate; color omitted | `missing` code |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0160_public_site_reader.sql:67-111` -- `gym_pages` columns and content-key CHECK; `public_site.pages` view (rebuild; keep security_barrier and grants).
- `supabase/migrations/0161_gym_page_content.sql:104-239,329-537` -- gyms page columns, `plans.is_public`/labels, pin triggers and bypass GUC, `set_gym_page_content` as the role-gate/capability/audit model.
- `supabase/migrations/0162_gym_page_media.sql:45-66,247-259` -- media table (live logo/banner unique, gallery max 12) and `public_site.page_media` view (rebuild).
- `supabase/migrations/0163_page_names.sql:344-357,405-446,530-571,987-1081` -- `page_name_has_published_page`, `page_name_gym_idle`, `notify_page_name_decision` (copy shape), `set_page_name_idle`, status trigger, sweep (changes only under option B).
- `supabase/migrations/0140:69-90` -- `support_rpc_gym_id`, `support_rpc_role`.
- `supabase/tests/`: `public_site_reader_privileges.test.sql` (view columns ~250-259, key CHECK pin ~263, visibility matrix 112-130, plan 49), `support_capabilities.test.sql` (count 39 -> 41, `cls` list, plan 146), `support_request_path.test.sql` (E1 array ~231), `suspension_rpc_coverage.test.sql` (writer guard placement), `page_names.test.sql:502,116,516`, `gym_page_content.test.sql`, `gym_page_media.test.sql`.
- `scripts/check-migration-guardrails.mjs`, `scripts/rollback-0163-page-names.sql` (rollback pattern), `packages/types/src/database.ts` (splice; `list_held_page_names` ~3013), `docs/decisions.md` (new entry above line 8).
- `apps/dashboard/services/page-media.ts:240` -- `preparePageLogo`: the app creates the page logo; the gate only requires the row.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- lines naming 24.8 (1639-1689, 1709): close those above; move 24.9/24.10 items there.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0164_publish_gate_snapshot.sql` -- everything above in one file
- [x] `scripts/rollback-0164-publish-gate-snapshot.sql` -- reverse; data-effects note (drops snapshots, restores 0160/0162 views)
- [x] `supabase/tests/gym_page_publish.test.sql` (+ `.negative`) -- matrix rows, gate codes, snapshot key pin, consumer enumeration, role matrix, refresh/unpublish, rename, suspended and taken-down visibility
- [x] Update the five existing pgTAP files listed in the Code Map deliberately
- [x] `packages/types`, `database.ts`, `apps/dashboard/locales/{en,fr}.json` -- types, splice, error and notice copy
- [x] `docs/decisions.md`, `deferred-work.md`, `sprint-status.yaml` -- 24.8 entry, deferrals closed, new ones (renderer escaping to 24.10, gate-checklist read function to 24.9, shared Zod/SQL fixture stays 24.9), plan-insert audit result

**Acceptance Criteria:**
- Given any function that writes `gym_pages`, then a test enumerates them and a new writer, or a gate code without a failing case, fails it
- Given the snapshot, then an added key or a leaked identifier fails the key-path test
- Given `scripts/ci-local.sh` and `check-migration-guardrails.mjs`, then both pass with per-stage lines read and the known-bad mutations shown failing

## Implementation Notes

## Spec Change Log

## Review Triage Log

Pass 1 (layers: blind-hunter, edge-case-hunter, verification-gap; tree at baseline cabcca4 plus the uncommitted build).

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| Refresh trigger on public-plan price/currency/interval/type/duration changes has no behavioral test | medium | patch | verification-gap: removing `old.price is distinct from new.price` from the WHEN clause keeps every assertion green; a live page would keep an old price |
| Refresh trigger on deleting a public plan has no behavioral test (only gym Z, no page, is deleted) | medium | patch | verification-gap: removing `gym_page_refresh_delete` fails only the structural pins; deleting the last public plan would leave a live page violating FR-199 |
| Gym-column refresh trigger exercised for only some columns (contact, hours, services, address, lat, country never edited on a published page) | medium | patch | verification-gap: dropping `page_contact_phone/whatsapp` from the trigger leaves all tests green; stale public contact details |
| Mutation proofs in the negative file are circular (they assert the mutant text differs, not that the real assertions fail) | medium | patch | negative.test.sql:96-173 reads as the reviewers say; AC "shown failing" needs a real run. Fix: run the real test file against each mutant once and record it here |
| No refresh trigger for a hard DELETE of a live `gym_page_media` row (blind + edge-case) | low | patch | triggers cover insert/update only; a hard delete by a purge job or admin SQL leaves a snapshot key whose object is gone and the page live. Direct fix: one more deferred trigger `when (old.deleted_at is null)`, count 7 -> 8 |
| `refresh_gym_page` locks the gym and `gym_pages` rows before checking the page is published | low | patch | every watched edit takes the locks for pages that are not live; widens the deadlock window the build logged. Direct fix: an unlocked early return when no live page exists |
| deferred-work.md "[Closed in 24.8 ...]" prefixes are glued to the line start, turning list items and `summary:`/`evidence:` lines into column-0 text | low | patch | diff lines show the marker ahead of `- **` and ahead of the two-space-indented `summary:`; breaks the entry format. Move the marker to the end of the item |
| `publishGymPageSchema.template` is `.optional()` but the comment and SQL say null keeps the stored template | low | patch | gym.ts:504: `null` is rejected client-side; use `.nullish()` |
| pagePublishSchema.test.ts slices the migration with `indexOf` markers that are not asserted found | low | patch | a -1 index silently makes the slice garbage; add expectations that both markers exist |
| `unpublish_gym_page` is out of alphabetical order in database.ts (before `take_ownership_of_workout_plan`) | low | patch | database.ts:3355-3356; next generated-types diff is noisy. Move it |
| decisions.md says the rollback was "re-applied in a rolled-back transaction" | low | patch | ambiguous wording; say it was rolled back and 0164 re-applied, each run once, against the local database |
| CRLF text fails the gate (`bad_text`) while the 24-5 setter stores it | medium | defer | literal spec rule ("control characters other than newline and tab"); the 24.9 editor is the only input path and must normalise to LF. Already recorded by the build; added as a close-before-24.9 criterion |
| Snapshot carries no timezone, so a renderer cannot label hours or show "open now" | low | defer | not in FR-196..FR-207; adding it changes the content-key CHECK and the pinned test. Recorded for 24.10 |
| Deferred-trigger failure (notify, audit, CHECK) aborts the user's own write at COMMIT; no isolation | low | rejected | the failure is loud, not silent. The audit example is unreachable: `log_audit_event` raises only when a user caller has a gym different from `p_gym_id`; the triggers run in the editing gym's own session or a Super Admin session (no caller gym), and `too_large` guards the CHECK |
| Sweep cannot catch deferred-trigger failures at job commit | low | rejected | the sweep unpublishes the page itself first, so `refresh_gym_page` returns early for every row it touches; nothing it writes can reach the raising paths |
| Sweep can unpublish a page without releasing the name (second UPDATE matches 0 rows) | false | rejected | both statements run under the gym `FOR UPDATE` lock with the same `reserved_until` predicates in one transaction; claim, rename and publish lock the gym first, so the state cannot change between them |
| Unpublish by Super Admin or support is recorded as reason `owner`, with no Owner notice | low | rejected | the frozen text says reason `owner`; the actor is in the audit row. Copy for the staff case belongs to 24.9 |
| Text gate ignores bidi, zero-width and U+2028/9; phone, category and country are not scanned | low | rejected | renderer escaping and lookalikes are 24.10's recorded job (24-5 deferral); phone is E.164-CHECKed and category/country are CHECK-constrained |
| No INSERT trigger on `plans` for a plan inserted already public | false | rejected | `pin_plan_public_insert` forces `is_public = false` for every writer unless the setter's GUC is set, and only an UPDATE sets it; the build's audit found no insert path expecting public |
| Failed gate on publish leaves a live page stale | low | rejected | a live page always meets the gate at commit because every source change has a trigger; the only gap was the media hard delete, patched above |
| Publish gate and snapshot read at READ COMMITTED, so a concurrent commit could push the snapshot over 64 KiB and raise 23514 | low | rejected | needs a concurrent 64 KiB growth between two statements; the CHECK still fails loudly and nothing is written |
| Closed `z.enum` of gate codes breaks the screen if the database ships a new code first; no message-to-code mapper or reason parser | low | rejected | 24.9 owns the mapper (recorded close-before-24.9 in 24.7); the strict enum is the pin that makes a new code fail a test |
| Hardcoded migration number in the vitest and rollback name | low | rejected | same pattern as the accepted `reserved-labels` test; the number is renumbered at merge |
| Spec task "Update the five existing pgTAP files" unchecked; spec and sprint-status statuses differ | false | rejected | checked in this run; eight files were updated; the status values are the spec's `in-review` and the tracker's `review` by design |

### Review Findings

Pass 2 (2026-11-08; layers: blind-hunter, edge-case-hunter, verification-gap, acceptance-auditor; diff `cabcca4..8661b80`, the merged PR #115).

- [x] [Review][Decision] `refresh_gym_page` returns early WITHOUT the gym row lock when no live page exists, against "It takes the gym row lock first" (medium) — an edit that commits while a concurrent `publish_gym_page` is still running (publish read pre-edit rows) is not re-judged by the edit's deferred trigger, so the page goes live on a stale gate until the next change. The unlocked early return came from pass-1 patch #6 (deadlock-window concern) and was never ratified; deferred-work.md admits the gap and the migration header ("takes the gym row lock FIRST, so a concurrent publish or edit cannot interleave") contradicts the code. Raised by blind-hunter, edge-case-hunter, acceptance-auditor. Options: (a) restore lock-first as specced, cost a gym row lock on every plan/media/gym edit; (b) keep the early return, ratify it, fix the header comment and add the two-session race test; (c) keep the early return but add a re-check at the end of `publish_gym_page` after the page row is written (the gate is re-run under the same lock, so a stale gate cannot commit) [supabase/migrations/0164_publish_gate_snapshot.sql:391-399]
  - **Resolved 2026-11-08: option (a), lock-first restored.** Option (c) only narrows the window (an edit committing after the re-check but before the publish commits is still unseen); the lock-first form closes it, and its cost is small because the trigger WHEN clauses already limit refresh to watched-column changes. The migration comment now says why there is no unlocked exit. Still not proven by a two-session test (deferred-work.md).
- [x] [Review][Patch] Refresh-trigger WHEN terms covered only by a sibling column in the same statement (medium) — gyms `name`, `category`, `primary_color`, `page_services_fr`, `page_city` and plans `public_label_en`, `price`, `plan_type`, `duration_days`, `billing_interval` can each be dropped from the `UPDATE OF` list and WHEN clause with every assertion green (e.g. `#abCDef` step fires via `primary_color` so removing `category` is masked; `update_plan_pricing` changes four plan terms in one UPDATE). Add one single-column edit per column on the live page, each followed by `settle()` and a snapshot assertion; then run each single-term mutant once and record it in Mutation proofs [supabase/tests/gym_page_publish.test.sql:2879-2933]
- [x] [Review][Patch] Rollback leaves the name idle clock null for formerly live pages (low) — `delete from public.gym_pages` drops the live pages but their active names keep `reserved_until null`, so after a rollback their names are held forever. After the delete, call `private.set_page_name_idle(g.id, true)` for every gym with an active name [scripts/rollback-0164-publish-gate-snapshot.sql:34]
- [x] [Review][Defer] A taken-down live page that fails the gate is unpublished with a "fix and publish again" Owner notice, which hides the takedown and sends the Owner to a publish that refuses `taken_down` [supabase/migrations/0164_publish_gate_snapshot.sql:391-450] — deferred: no takedown writer exists until 24.11, so `taken_down_at` is never set today; 24.11 acceptance criterion: `refresh_gym_page` skips the reason write and the Owner notice for a taken-down page
- [x] [Review][Defer] `page_names_sweep` can release the name of an active gym whose page is taken down while the `gym_pages` row stays published; clearing the takedown then a new claim republishes it unasked [supabase/migrations/0164_publish_gate_snapshot.sql:788-880] — deferred: unreachable until 24.11 writes `taken_down_at`; 24.11 acceptance criterion
- [x] [Review][Defer] Rollback `delete from public.gym_pages` also deletes `taken_down_at`, so a rollback and re-apply would let a taken-down gym publish again [scripts/rollback-0164-publish-gate-snapshot.sql:34] — deferred: no takedown exists yet; 24.11 must make its rollback or this one preserve takedown rows (or abort when any exist)
- [x] [Review][Defer] Close-before-24.9 and close-before-24.10 obligations live only in deferred-work.md (CRLF normalisation, renderer escaping with a hostile-text case, timezone key, gate-checklist read function, shared Zod/SQL fixture) and not in the 24.9 / 24.10 acceptance criteria in epics.md — deferred: the fix edits another spec (epics.md); move them in when 24.9 and 24.10 are created, per the Epic 22 retro rule

#### Rejected

- Deferred constraint triggers instead of "AFTER row triggers" (acceptance-auditor, low) — the fix is to record it in this spec's Change Log; rationale is already in the migration header and decisions.md.
- Mutation proofs not repeatable in CI, negative-file mutations circular (blind-hunter + acceptance-auditor, low) — already raised in pass 1 and answered by the reviewer-run proofs recorded below; a mutant-runner script is more than a direct correction.
- Trigger and test counts differ across sprint-status, decisions.md and the migration (seven vs eight, 213+86 vs 243) (acceptance-auditor, low) — sprint-status is an append-only history of what was true at that time; the migration and decisions.md agree on eight.
- Rollback `$verify$` block checks less than the migration's (blind-hunter, low) — rare, local-only script; more checks are more than a direct correction.
- Auto-unpublish starts the 12-month name clock with no warning in the notice (blind-hunter, low) — the 11-month warning is already a recorded open item.
- No fallback recipient when a gym has no active Owner (blind-hunter + edge-case-hunter, low) — copies the 0163 notify shape as specced; a gym with no active Owner has nobody to act on a fallback, and the audit row records the unpublish.
- No code for `publish_gym_page: gym not found` and no parser for the comma-joined reason (blind-hunter, low) — the 24.9 mapper owns it (recorded in pass 1).
- `p_template?: string` while the schema allows null (blind-hunter + edge-case-hunter, low) — matches what the type generator emits for a defaulted argument; a hand edit would be reverted on the next generation.
- `gym_pages` typed in the client `Database` without client grants (blind-hunter) — false: the generator types every public table regardless of grants.
- `content.name` vs `public_site.pages.name` differ in meaning (blind-hunter, low) — `name` is the frozen content key in the spec and pinned in the CHECK.
- Writer-allowlist regex misses dynamic SQL and quoted identifiers (blind-hunter, low) — the privilege and trigger walls cover it; a comment is not a defect fix.
- A page with only one language silently omits the other; no renderer fallback rule (blind-hunter, low) — owner decision OQ-28 (both languages optional); the fallback is 24.10's recorded job.
- Snapshot shape undocumented, `schema_version` not bumped (blind-hunter, low) — the key-path test pins the shape; 24.10 owns the reader contract.
- Spec frontmatter `status: done`, `review_loop_iteration: 0`, empty Implementation Notes / Change Log (blind-hunter + acceptance-auditor, low) — fix edits the spec under review.
- Plan `currency` not scanned by `bad_text` (edge-case-hunter, low) — always the `XAF` default in V1, no UI or RPC writes it.
- `settle()` runs `set constraints all immediate`, which could mask a missing trigger (verification-gap, other, low) — known and commented at `publish.test.sql:2948`; the single-column patch above removes the masking for the named columns.
- Role-gate pins are source-text regexes on `prosrc` (verification-gap, other, low) — the behavioural role matrix runs the real calls.
- `PAGE_UNPUBLISH_REASONS` and `PAGE_PUBLISH_ERROR_CODES` not tied to SQL values (verification-gap, other, low) — the consumer is the 24.9 UI, not in this diff.
- Gate and snapshot text rules go beyond the spec wording (acceptance-auditor, informational) — no defect: `<`/`>` are covered by the hostile-text I/O row and the CR handling is the recorded close-before-24.9 item.

## Design Notes

A redirect resolves through the gym's current `active` name (24-7), so the page row needs only `page_name_id`. The snapshot is the only thing the reader sees, which makes the media view a projection of the snapshot and keeps deleted media out the moment the refresh trigger runs. `refresh_gym_page` is private on purpose: nothing but a trigger needs it, so it has no grant to leak.

## Verification

**Commands:**
- `bash scripts/ci-local.sh` -- expected: every stage PASS
- `node scripts/check-migration-guardrails.mjs` -- expected: pass

### Mutation proofs (2026-11-08, run by the reviewer, not the build)

Each mutant was applied inside one transaction together with the real `gym_page_publish.test.sql` (its final `rollback` reverts the mutation); control run 243 ok, 0 not ok. Caught: gate rule `no_contact` removed (tests 18, 19, 220, 236); name-active term removed from the visibility view (172, after the test was added: the first run caught nothing); gym-active term removed (176, 202); extra snapshot key (123 failures); plans DELETE trigger dropped (7, 8, 228, 229); media DELETE trigger dropped (7, 8, 226, after a `settle()` was added: a pending event from earlier edits had masked it); price/currency/interval clause removed from the plans trigger (208); the gyms trigger WHEN clause with hours, address, services_en, country, both contact numbers, or both coordinates removed (213, 217, 215, 220, 222, 219). Single-column mutants of a pair (contact phone alone, lat alone) escape because the test changes both columns at once; the pair mutants are the real proofs. Widened roles is pinned by a source-text assertion, not run as a mutant.

Pass 2 (review, 2026-11-08): ten single-column tests were added to `gym_page_publish.test.sql` (plan 243 -> 258, one edit per column on the live page of gym P, each followed by `settle()`). Control run 258 ok, 0 not ok, then ten single-term mutants (each removes one column from a refresh trigger's `UPDATE OF` list and WHEN clause, in one transaction with the real test file, reverted by its final `rollback`), each caught by exactly one test: gyms `name` (221), `primary_color` (222), `category` (224), `page_city` (226), `page_services_fr` (228); plans `public_label_en` (230), `price` (231), `plan_type` (232), `duration_days` (233), `billing_interval` (234). The interval edit also sets `annual_discount_percent = null` because the CHECK ties the two; the discount is not a watched column, so the interval is still the only term that can fire. Full pgTAP stage after the lock-first change: 180/180 files, no FAIL lines in the log.
