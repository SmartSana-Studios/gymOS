---
title: '24-11 takedown, reports, sitemap and media purge'
type: 'feature'
created: '2026-11-09'
status: 'done'
baseline_commit: '248b9c5da0520bb1a3b046e72f158fabc3c982e5'
route: 'dispatch'
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-24-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A bad gym page cannot be removed: `taken_down_at` is read everywhere but has no writer, no reason, no Owner notice and no appeal. Visitors cannot report a page (`/report` is not-found), gym hosts have no `/sitemap.xml` or `/robots.txt`, and unpublished or deleted images stay fetchable (originals keep EXIF) because nothing deletes Storage objects.

**Approach:** One migration (0167) adds the takedown, lift, report and appeal functions and the purge bookkeeping; Super Admin gets a `/pages` screen (Held names, Reports, Appeals); the dashboard banner gets the reason and an Owner-only Appeal; `apps/landing` serves `/sitemap.xml`, `/robots.txt` and a script-free `/report` form; a `pg_cron` job calls a new edge function that deletes objects through the Storage API. Sources: epics.md Story 24.11; AD-44/45/46/47/50/52; PRD FR-203, FR-204, FR-207; EXPERIENCE.md SA-03, SA-16..SA-18, PS-02, PS-03, AD-27 notices. The spine wins over older epic lines; differences go to `docs/decisions.md`.

## Boundaries & Constraints

**Always:**
- Takedown (`take_down_gym_page(gym, reason, note)`, Super Admin only through `private.is_super_admin_live()`, gym row locked first, `log_audit_event`): reason in impersonation, illegal_content, trademark, misleading_content, privacy, other (`other` needs a note of 3 to 500 characters); sets `gym_pages.taken_down_at` and a new `taken_down_reason`/`taken_down_note`, and `page_names.taken_down_at` on ALL the gym's name rows (redirects drop at once, FR-203; the active name stays reserved to the gym forever, AD-45). The row stays published but hidden; it is not unpublished. Owner notice through `staff_notices` plus `email_outbox` (copy EXPERIENCE.md AD-27, EN and FR).
- Lift (`lift_gym_page_takedown(gym, reason)`, reason 3 to 500): clears `taken_down_at` on `gym_pages` and the active name only (old-name redirects stay dropped), leaves the page UNPUBLISHED so the Owner republishes through the gate (SA-18), and tells the Owner. Reactivating a suspended gym never lifts anything (FR-207: page returns only if published and not taken down).
- GATES REACH THEIR CONSUMERS: the takedown predicate must hold in every consumer, each pinned by a test that enumerates them: `private.gym_page_visible` and all three `public_site` views; `publish_gym_page` (`taken_down`); `private.refresh_gym_page` (no gate-reason write, no Owner notice for a taken-down page); `page_names_sweep` and `set_page_name_idle` (never release or age the name); `get_gym_page_status`; the landing handler for `/`, `/{code}`, `/sitemap.xml`, `/robots.txt`, `/report` GET and POST (byte-identical uniform not-found). The `gym_pages` writer allowlist in `gym_page_publish.test.sql` gains exactly the takedown and lift functions; the `page_names` writer test gains them too.
- Reports: `public_site.submit_page_report(name, reason, details, source_hash)` is the ONLY function the reader may execute (it lives in `public_site` so the reader needs no `USAGE` on `public`; the privilege test is changed deliberately to allow exactly that one function). SECURITY DEFINER, pinned `search_path`. It resolves the visible page itself and writes nothing for an invisible one; reasons are the six codes; details at most 1000 characters; returns `ok | rate_limited | not_found | invalid`. Rate limit: 5 per source hash per hour and 30 per gym per day. `private.page_reports` has RLS on, no grants, no read path from the public role; stores the keyed hash only, never an IP. `due_at` = `private.add_business_days(created_at, 5)`. The reader role stays `default_transaction_read_only`; the landing app runs the call as `begin read write; select ...; commit` on one checked-out client (recorded in decisions.md; tested as the real role against the migrated schema in `scripts/public-site-reader-sql.test.sh`).
- Report handling (Super Admin, `list_page_reports`, `close_page_report(id, outcome, note)`, outcomes `taken_down | dismissed`): queue ordered by due date with an Overdue mark past 5 business days `[ASSUMPTION]`; taking a page down from a report records the link.
- Appeals: Owner only (`submit_page_appeal(reason)`, 1 to 500 characters, one open appeal per takedown, none after an upheld decision, no second appeal); Super Admin `decide_page_appeal(id, lift|uphold, reason 3 to 500)`; the reason reaches the Owner; lift runs the lift above. No page is moderated before publishing.
- `/report` (PS-03): GET shows a plain HTML form (radio reasons, textarea up to 1000, hidden honeypot field, no script, no CAPTCHA, no reporter identity); POST answers in the same response (no redirect, the proxy drops queries) with the confirmation page; validation errors list the problem; a rate-limit message that does not name the page. If the page is not visible, GET and POST return the uniform not-found. Own style hash, `form-action 'self'` already in the CSP, no cookies, `Cache-Control: no-store` on POST. The source hash is `HMAC-SHA256(PUBLIC_SITE_REPORT_KEY, client ip)`; the key is a new server-only env (added to `turbo.json`, the no-supabase guard allowlist and decisions.md release gate); missing key means reports answer the uniform not-found and one logged config line. Copy EN and FR in `packages/page-templates` chrome; language by Accept-Language among chrome languages, else the page `default_language`.
- Sitemap and robots: dynamic handlers on a gym host. `/sitemap.xml` lists only `https://{name}.{root}/` while the page is visible; `/robots.txt` allows all and cites that sitemap; both `s-maxage=300`, `nosniff`, correct content type, uniform not-found when not visible. They reuse the existing `readPage` (no new view, no refresh job).
- Media purge: `gym_page_media` gains `purged_at` (derivative) and `original_purged_at`; rows are never hard-deleted by the purge (they are the tombstones that keep the 30-per-24h count in `register_page_media`). Candidates: derivative where the row is deleted OR the gym's page row is offline (unpublished or taken down); original only where the row is deleted. Owner decision 2026-11-09: a SUSPENDED gym's live page and a gym with no page row keep their images (reactivation restores the page with no publish). A new edge function `page-media-purge`, called by pg_cron job `page_media_purge` (every 5 minutes, pg_net with the existing bearer-secret pattern, runs only with that secret) lists candidates, deletes through the Storage API (removing an object that is already gone is not an error), and only AFTER a confirmed delete marks the row purged (the mark re-checks the candidate rule); no stamp is written before the delete and there is no release path, so a run that is killed or times out is simply retried on the next tick (owner decision 2026-11-09, replacing claim-then-release). It writes one `job_runs` row per run. The re-derive path clears `purged_at` only after `publish_gym_page` has succeeded, and removes the derivatives it uploaded when a later step fails.
- Rename during a takedown (owner decision 2026-11-09): `claim_page_name` refuses, with a typed error, while the gym's page is taken down; after a lift the Owner can rename as usual. A taken-down name is therefore never released (AD-45).
- Name notices (owner decision 2026-11-09, `deferred-work.md` line 1810, retro rule 67): the Owner gets an EN/FR notice (`staff_notices` plus `email_outbox`, copy EXPERIENCE.md AD-28 "Owner notices for names") when a Super Admin claim or forced rename replaces the page name and when the sweep releases an idle name after 12 months. The optional 11-month warning is not built here and is deferred with that reason. It also sweeps orphans (objects with no row, older than 1 hour, which covers gym deletion) a bounded page per run. Republish re-derives: the dashboard publish path rebuilds any derivative with `purged_at` set from the retained original (sharp, as in `services/page-media.ts`) before calling `publish_gym_page`. Within 15 minutes of unpublish or image delete the public URL answers 404.
- Dashboard: banner shows `GymOS took your page down: [reason label]. Your page name stays reserved for you. You can appeal.`; Owner-only [Appeal] modal (required, 500 characters); then `Appeal sent on [date]. GymOS will decide and tell you.`; an upheld appeal shows the decision reason; non-Owners see no button (removed from the DOM). `get_gym_page_status` returns reason, note-free label code and appeal state; EN and FR through the i18n layer; `LandingPageEditor.test.tsx` no-Appeal assertion is changed deliberately.
- Super Admin: `/pages` with tabs Held names, Reports, Appeals (the existing `/page-names` redirects to it), takedown and lift on the gym detail Page block, every server action behind `authorizeOrRedirect("platform.admin_access")` plus the SA-17 step-up, registered in `server-action-gate.test.ts` and `server-actions.denied.test.ts`. Reason labels: one source in `packages/types` (codes, admin labels, visitor labels).
- Rollbacks: `scripts/rollback-0167-*.sql` aborts when any takedown, report or appeal row exists; the 0164 rollback `delete from gym_pages` aborts when any `taken_down_at` is set. Pinned key-path tests unchanged (`taken_down_*` stay out of the snapshot). Migration takes the next free number at merge; production stays at 0159 and nothing is deployed.
- Docs: `docs/decisions.md` (24.11 section: edge function over Vercel cron because the project's Vercel crons are daily, function in `public_site`, read-write transaction, lift leaves the page unpublished, takedown hides without unpublishing, sitemap reuses `readPage`, release gate env and edge-function deploy), `deferred-work.md` (close every line naming 24.11; add new), `sprint-status.yaml`, `epic-24-context.md` refresh.

**Never:** No pre-publication moderation. No reporter identity, IP or cookie stored or set. No client JavaScript on gym hosts. No `@supabase/*` or service-role key in `apps/landing`. No SQL `delete` of Storage objects. No hard delete of media rows by the purge. No change to the gate codes, snapshot columns or `schema_version`. No directory, JSON-LD or sitemap index (Epic 25). No second appeal. No production migration, deploy, Vercel/DNS/env change. Do not touch `scripts/demo-gym/`, `apps/dashboard/AGENTS.md` or the 24.10 conformance rules beyond the `/report` href already there.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Takedown | Super Admin AAL2, visible page, reason `impersonation` | page hidden at once, all name rows flagged, Owner notified, publish raises `taken_down` | non-Super Admin or no AAL2: `permission denied`; `other` without note rejected |
| Taken-down page, any URL | `/`, `/fr`, `/sitemap.xml`, `/robots.txt`, `/report` GET and POST, old name | byte-identical uniform not-found, no redirect | N/A |
| Reactivation | suspended gym with a takedown, status back to active | still hidden | N/A |
| Lift | upheld nothing, Super Admin lifts with reason | page unpublished, active name unflagged, redirects stay dropped, Owner told | reason under 3 characters rejected |
| Report ok | visible page, reason, details 200 chars | confirmation page, one row, hash only | N/A |
| Report spam | sixth report from one source in an hour | rate-limit message, no row, page not named | `rate_limited` |
| Report invalid | honeypot filled, bad reason, details 1001 characters | honeypot: confirmation shown, nothing stored; others: error list | `invalid` |
| Report on hidden page | unpublished or taken down | uniform not-found, nothing stored | `not_found` |
| Appeal | Owner submits twice for one takedown / after upheld | second refused | typed error code |
| Sitemap | visible page / hidden page | one URL with `s-maxage=300` / uniform not-found | N/A |
| Purge | page unpublished; image deleted; edge call fails mid-run | derivative gone within 15 min and `purged_at` set; deleted image also loses the original; claim released and retried | one `job_runs` failure row |
| Republish after purge | derivative purged | dashboard re-derives, `purged_at` cleared, images load | failure blocks publish with an error |
| Gym deleted | media rows cascade away | orphan sweep removes both objects after 1 hour | bounded per run |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0160:76`, `0162:45-62,183-231` (`gym_page_media`, `delete_page_media`: "object removal is 24.11"), `0163:87,405,718-834,987-1081` (`page_names.taken_down_at`, `notify_page_name_decision`, `decide_held_page_name` and `list_held_page_names` as the decision template, `page_names_sweep` as the cron template), `0164:263-280,328-389,391,653,701-754` (`gym_page_visible`, `notify_page_unpublished` as the notice template, `refresh_gym_page`, publish refusal, unpublish), `0165:170-276,286` (`get_gym_page_status`, `register_page_media` cap), `0166` (views, `page_redirects`), `0008` (`job_runs`) -- new 0167 builds on these; next free number is 0167.
- `supabase/tests/gym_page_publish.test.sql:803-815` (writer allowlist), `gym_page_status.test.sql:354-381`, `page_names.test.sql` (writer test), `public_site_reader_privileges.test.sql` (plan 68, function branch ~79-80, view pin ~175-195, "no functions in public_site" ~182) -- deliberate edits.
- `apps/landing/proxy.ts`, `lib/gym-site/{request,handler,notFound,db,readerSql}.ts`, `app/gym-site/route.ts` (GET only), `packages/page-templates/src/{language,chrome,contract,headers,renderPageAsync}.ts`, `templates/classic/index.tsx:257` (`/report` link) -- add POST export, handlers, `submitReport`, chrome copy. Tests to change: `gymSite.test.ts:40,110-112`, `wiring.test.ts:50,60`, `contract.test.ts:192`, `scripts/public-site-reader-sql.test.sh`, `scripts/check-landing-no-supabase.mjs` allowlist.
- `apps/super-admin/app/(admin)/page-names/{page.tsx,actions.ts,components/HeldNamesClient.tsx}` (model), `layout.tsx:29` (nav), `lib/authz.ts`, `lib/authz-action.ts`, `lib/server-action-gate.test.ts`, `app/(admin)/server-actions.denied.test.ts`, `step-up-actions.ts`, `gyms/[id]/components/GymDetailPageClient.tsx`, `lib/email-outbox.ts:89` (bearer helper).
- `apps/dashboard/app/(dashboard)/settings/landing-page/components/{StatusBanner,StatusBadge,LandingPageEditor,PublishScreen}.tsx`, `services/landing-page.ts:94-99`, `services/page-media.ts:129-134` (`removeObjects`, sharp derive), `locales/{en,fr}.json` (~382, 417, 512), `LandingPageEditor.test.tsx:88-93`.
- `packages/types/src/schemas/gym.ts:502,554` (`PAGE_PUBLISH_ERROR_CODES`, status schema) -- add takedown reasons, report and appeal schemas and error codes.
- `supabase/functions/` (only gym-qr-display, payment-webhook, send-sms-hook; no Storage-deleting precedent), pg_net precedents `0045:155`, `0059` -- new `page-media-purge` function; deploy is an owner step.
- Do not reuse: Vercel Cron (project crons are daily; `apps/*/vercel.json`).

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0167_*.sql`, rollback scripts, pgTAP -- takedown/lift/report/appeal/purge functions, tables, columns, cron, status function, refresh/sweep fixes, privilege and writer tests; known-bad mutations shown failing
- [x] `packages/types` -- reason codes and labels, report/appeal/takedown schemas and error codes, tests
- [x] `apps/super-admin` -- `/pages` tabs, takedown/lift on gym detail, actions, gate and denied tests, EN/FR
- [x] `apps/dashboard` -- banner reason, Appeal modal and state, republish re-derive, locales, tests
- [x] `apps/landing` and `packages/page-templates` -- sitemap, robots, `/report` GET/POST, `submitReport`, chrome copy, env, proxy/route wiring, tests for every matrix row
- [x] `supabase/functions/page-media-purge` -- claim, delete, release, orphan sweep, `job_runs`; Deno tests
- [x] CI and docs -- `ci-local.sh`, `ci.yml`, `turbo.json`, reader-SQL test, decisions.md, deferred-work.md, sprint-status.yaml, epic-24-context.md

**Acceptance Criteria:**
- Given a takedown, then every consumer in the Always list is pinned by a test that fails when one skips the predicate
- Given every `deferred-work.md` line that says "close before 24.11", then it is closed or explicitly re-deferred with the owner's reason
- Given `public_site_reader`, then its only executable function is `submit_page_report` and its tables stay the three views
- Given `scripts/ci-local.sh`, `check-migration-guardrails.mjs`, `ci-local.selftest.sh`, per-stage lines read and one known-bad run, then all pass
- Given a preview deploy, then the owner verifies the form on a phone, the sitemap and robots over real HTTPS, and the edge function deploy plus a purge run (recorded by the owner; not a CI gate)

## Implementation Notes

Built 2026-11-09 against baseline 248b9c5; all Tasks done. Evidence is in `docs/decisions.md` (24.11), `deferred-work.md` ("Closed by build of spec-24-11" and "Deferred from: build of spec-24-11") and the sprint-status line. After review pass 1 (owner decisions in the Spec Change Log): the purge lists, deletes, then marks (no claim, no release); `claim_page_name` refuses an Owner while the page is taken down; the Owner name notices are built (the 11-month warning is deferred); the re-derive clears the purge marks only after the publish. Remaining differences from the frozen text: (1) report details are required (PS-03 says 1 to 1000); (2) `submit_page_appeal` takes only the reason (the Owner's gym comes from the session); (3) two Super Admin step-up actions (`take_down_gym_page`, `lift_gym_page_takedown`) were added to `private.stepup_issue`; (4) the replacement notice says the old address no longer works (a Super Admin claim releases it) instead of AD-28's "forwards for 12 months"; (5) the SA-22 word-list screen and Force rename are not built.

## Spec Change Log

- 2026-11-09, review pass 1 (owner decisions, intent_gap resolved): (1) purge marks a row only after a confirmed Storage delete (no claim stamp, no release; supersedes "claims ... setting the timestamp, releases the claim on failure"); (2) a suspended gym's live page and a page-less gym keep their images (candidate rule narrowed from "page is not visible"); (3) `claim_page_name` refuses while the page is taken down; (4) the Owner name notices of `deferred-work.md` line 1810 are built here, the 11-month warning is deferred. KEEP: takedown hides without unpublishing; lift leaves the page unpublished; `submit_page_report` in `public_site` with `begin read write`; tombstone media rows; every takedown consumer pinned by a test with a known-bad mutation.

## Review Triage Log

Pass 1 (layers: blind-hunter, edge-case-hunter, verification-gap; diff `248b9c5` to the working tree, spec excluded; the spec went to the edge-case layer as claims). Routes marked "held" wait for the loopback decisions below; patches survive a loopback.

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| Claim stamps `purged_at`/`original_purged_at` BEFORE the Storage delete; a run killed or timed out mid-batch leaves stamped, undeleted objects that no query selects again (row exists, so the orphan sweep never sees them) (edge + blind + verification-gap) | medium | intent_gap (frozen "claims candidates ... setting the timestamp, deletes, releases the claim on failure") | `page_media_purge_claim` 0167:1114-1148 stamps in the claim; `purge.ts` releases only on a caught failure; a failed `release` call has the same effect. A taken-down page's derivative then stays public with no retry and no alert. Options: stamp after a confirmed delete (idempotent remove; no release path) / a lease column |
| Re-derive: `page_media_rederive_done` clears `purged_at` before `publish_gym_page` commits, so a purge tick in that window re-claims the rebuilt images; a claim already in flight deletes them after the rebuild. The page goes live with missing images and no live-page path repairs it (blind + edge + verification-gap) | medium | patch (clear the stamp only after the publish succeeds) plus held: the in-flight claim window | `rederivePurgedMedia` -> `page_media_rederive_done` happens before the publish call; the comment "the next publish or save re-derives" is wrong (one caller, `publishLandingPage`); fix wording in the migration header, decisions.md and Design Notes |
| Partial re-derive failure leaves the already uploaded derivatives of a page that is still offline in the public bucket with `purged_at` set, so the claim never selects them again (blind) | medium | patch | `rederivePurgedMedia` uploads one by one and calls `rederive_done` at the end; on failure remove the objects uploaded in this attempt |
| `publishLandingPage` proceeds to `publish_gym_page` when `get_gym_page_status` errors or fails to parse, skipping the re-derive (blind + edge) | medium | patch | `landing-page.ts` runs the re-derive only inside the successful-status branch; contradicts the function's own all-or-nothing comment; fail closed with `rederive_failed` |
| Step-up allowlists for `take_down_gym_page` and `lift_gym_page_takedown` are covered by no test; removing either from `private.stepup_issue` or `issueStepUp` leaves every suite green and makes takedown unusable (verification-gap) | high | patch | `step-up-actions.test.ts:57` `it.each` lacks both; no pgTAP calls `stepup_issue` with them; add both and a non-Super-Admin refusal |
| `index.ts` (`makeClient`: RPC names, parameter names, bucket names) is run by no test and is not type-checked in CI (verification-gap) | medium | patch | purge tests use a hand-written fake; extract the adapter to take a supabase-like object and test names, arguments, bucket and key, error to throw |
| The redirect-expiry predicate added to `page_names_sweep` loop 2 is covered by no test and survives the file's own mutation (verification-gap) | medium | patch | fixture redirect `reserved_until` is in the future; section D mutation regex matches loop 1 only; add expired flagged redirect cases before and after a lift and a loop-2 mutation |
| `close_page_report` raises `note_required` for a note over 500 characters; the code list has no `note_invalid` (blind + verification-gap) | low | patch | 0167:516-518; direct correction plus the code in `PAGE_REPORT_CLOSE_ERROR_CODES` and copy |
| Honeypot field named `website` can be autofilled, silently dropping a real report behind a confirmation (edge) | low | patch | direct correction: a non-semantic field name, one place in `reportPage.ts` and its tests |
| An Owner can rename (`claim_page_name`) while the page is taken down; `page_name_promote` turns the flagged active name into a 12-month redirect, and after a lift the sweep's loop 2 releases it, against "a taken-down name is never released" (AD-45) (verification-gap, confirmed here) | medium | intent_gap | `claim_page_name` 0163:578-712 has no takedown check; 0167 sweep loop 2 releases a flagged redirect once the gym is not taken down. The spec says the active name stays reserved forever but not what a rename during a takedown does. Options: refuse the rename while taken down / allow it and never release the flagged name |
| Purge candidate rule excludes a suspended gym's live page and a gym with no page row; the frozen text says "the gym's page is not visible" (edge claim + build report) | low | intent_gap | `page_media_purge_claim` predicate; epic AC lists unpublish and image delete only, and reactivation restores a suspended page without a publish, so the objects must survive it. Needs the owner's confirmation of the narrowing |
| Re-deferred by the build: Owner notice when a Super Admin claim or forced rename replaces the page name, and the 11-month warning (`deferred-work.md` line 1810 says "Close before 24.11 ships (acceptance criterion)", moved here by the owner 2026-11-08) | medium | intent_gap | the frozen spec lists no such task; the build re-deferred with its own reason, unconfirmed. Retro rule 67: a deferral that names a later story is an acceptance criterion |
| No heartbeat: with a Vault secret missing the tick returns silently, `net.http_post` result is never read, nothing detects "no successful purge run in N minutes" (blind) | medium | defer (maybe-false on harm; medium if true) | settles with the first preview deploy: a deployed function writes `job_runs` each tick; absence is visible there. Other cron jobs in the repo share the pattern. 24.12 gate |
| Failing rows are re-claimed first every tick (oldest-first order), and a failing orphan stays at the head of the 50-row orphan page, starving the rest (edge + blind) | maybe-false | defer | needs a Storage key the API persistently rejects; unproven. Back-off or a cursor if it ever happens |
| Orphan sweep scans `storage.objects` with `NOT EXISTS` every tick (blind) | maybe-false | defer | cost unmeasured on a large bucket; settles with the plan on production-size data |
| Uploads on an offline (unpublished) page are purged within 5 minutes; editor thumbnails 404 until republish (edge + blind) | low | defer | already recorded in `deferred-work.md` by the build as a known cost of the frozen design |
| 15-minute bound with a 100-row claim per 5-minute tick (edge claim) | low | rejected | holds below 300 backlog rows; a takedown touches at most 14 rows per gym |
| Step-up enforced only in the Next server actions, not in the database (blind) | low | rejected | the same pattern as every earlier step-up action: `stepup_issue`/`consume` are called by the app; the RPCs sit behind `is_super_admin_live()` (AAL2 and session gate) |
| `consumeStepUp` runs before the RPC, so a typed refusal burns the code (blind + edge) | low | rejected | usability only; the fix reorders a security check |
| `submit_page_report` limits: one actor can fill a gym's 30 per day; IPv6 /64 not truncated; address-less requests share the `unknown` bucket; the rate-limited page does not say which limit applied (blind + edge) | low | rejected | the 30 per gym per day and 5 per source per hour are the frozen limits; Vercel always sets the forwarded address; more complexity for a hypothetical |
| `POST /report` has no CSRF or Origin check and no post/redirect/get (blind) | false | rejected | the form is unauthenticated and spends nothing of the visitor's but a rate slot; any client can POST directly; the frozen spec orders the confirmation in the same response (no redirect) |
| No `statement_timeout` or `lock_timeout` for the report transaction; the pooled connection is held (blind + edge) | false | rejected | the reader role carries `lock_timeout = 1s` and `statement_timeout = 3s` (0160), and an advisory lock wait is bounded by `lock_timeout`; the pool-of-one concern is already in `deferred-work.md` from 24.10 |
| COMMIT succeeds but the result row is missing, failure page, duplicate report (edge) | low | rejected | `submit_page_report` always returns one text value; no path produces the anomaly |
| `page_text_trim` holds raw Unicode characters and JS and Postgres trim classes differ (blind) | low | rejected | cosmetic; a mismatch yields a typed `reason_required`, not a silent failure |
| Sitemap lacks `lastmod` and `xhtml:link` alternates (blind) | false | rejected | AD-52 and the frozen spec: one canonical URL only; hreflang belongs to Epic 25 |
| `ConfirmCloseTakenDown` card has no focus trap (blind) | low | rejected | internal Super Admin screen; fix adds focus management |
| `takeDownPage` logs and continues when a report close fails; batch loops stop at the first `not_open` (blind + edge) | low | rejected | the reports remain in the queue and can be retried; no data lost |
| Banner shows no button when `appeal.state` is `lift` or null while taken down (edge) | false | rejected | a lift clears the takedown in the same transaction; `get_gym_page_status` always returns an appeal object while taken down |
| Rate-limited page loses the typed details (edge) | low | rejected | the frozen spec: the rate-limit page offers no form |
| Report link renders when `PUBLIC_SITE_REPORT_KEY` is unset (edge) | low | rejected | a release-gate env listed in decisions.md; the fail-closed answer is intended |
| `takedown_lifted` is a new `unpublished_reason` with no consumer (blind) | false | rejected | `unpublished_reasons` is `z.array(z.string())` (`gym.ts:630`) and `get_gym_page_status` only matches reasons against the gate codes; an unknown code falls through to the normal state |
| Rollback restores a `get_gym_page_status` predicate that differs from 0167 (edge) | false | rejected | the restored `state <> 'released'` is 0165's own text; the rollback aborts anyway once any takedown row exists |
| Lift unflags held and reserved name rows, the spec says "the active name only" (edge claim) | low | rejected | the code is the safe reading (a pending claim must not stay flagged); wording only |

Pass 2 (layers: edge-case-hunter, verification-gap; blind skipped, its pass-1 findings were all confirmed by the other two layers; diff `248b9c5` to the patched working tree, spec excluded). No intent_gap or bad_spec found.

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| `rollback-0164` guard blocks on any flagged `page_names` row; a lift leaves old-name redirect rows flagged, so after any takedown plus lift the guard can never be satisfied although its message says to lift first (edge) | medium | patch | guard reads `page_names where taken_down_at is not null`; the takedown IS the `gym_pages` row, so guard on `gym_pages` only |
| `GymPageBlock` offers Take down for `in_progress`/`ready` (no `gym_pages` row): the step-up code is consumed and the database answers `no_page` (edge) | low | patch | direct correction: offer it only for states that have a page row |
| `onChanged={refresh}` after an appeal is wired in `LandingPageEditor` and `PublishScreen` but no test sends an appeal through either screen; dropping it leaves the Appeal button after a send (verification-gap) | medium | patch | StatusBanner tests pass their own mock; one test per screen |
| The route's `clientAddress(request.headers)` to `sourceHash` wiring is unasserted; deleting it makes every visitor share the `unknown` bucket and all tests stay green (verification-gap) | medium | patch | wiring test asserts only a 64-hex hash; assert two addresses give two hashes |
| A Super Admin `claim_page_name` on a taken-down gym is untested; the mutation removes the whole block, so dropping `not v_is_super_admin` goes unnoticed (verification-gap) | medium | patch | add a Super Admin claim on a taken-down gym asserting success and a hidden page |
| The sweep's "inactive for 12 months" notice (non-active gym, page not live) has no assertion; only the active-gym variant is pinned (verification-gap) | low | patch | the copy is owner-specified (AD-28); one pgTAP case |
| `rollback-0167` is not run by any automated check and the 24.11 decisions entry does not say it was rehearsed (verification-gap) | low | patch | the build rehearsed rollback then reapply locally; record it in decisions.md as 0164's entry does |
| Super Admin forced claim on a taken-down gym: `page_name_promote(forced)` releases the flagged old name and the new name is unflagged (edge + verification-gap) | maybe-false | defer | medium if the old name should stay reserved after a forced rename; settles with the owner stating whether a Super Admin forced rename may free a taken-down name (the owner's rename rule covered the Owner path only) |
| Delete then republish before the mark: the mark is refused, `purged_at` stays null, `rederive_list` never returns the row, a live page serves a missing image (edge) | low | rejected | the window is the delete-to-mark gap of one run; the owner chose mark-after-delete knowing it, and decisions.md states it |
| `page_media_rederive_done` failing twice after a successful publish leaves stale marks, so a later unpublish never purges those images (edge) | low | rejected | two consecutive database failures right after a successful publish; the code retries once, logs, and decisions.md records it |
| `rebuilt.discard()` after an ambiguous publish error or two concurrent publishes can remove derivatives the committed publish needs (edge) | low | rejected | needs a commit-then-timeout or two simultaneous publishes by one gym; the fix is a status re-read and per-gym serialization |
| Dashboard and migration 0167 deploying out of order breaks the strict status schema (edge) | low | rejected | migrations deploy before dashboard code, stated in decisions.md and the release steps; same order as 24.10 |
| Report limits: gym cap fills, missing address shares one bucket, wording of the rate-limit page (edge) | low | rejected | carried from pass 1 (frozen limits) |
| Vault secrets missing: silent no-op (edge) | maybe-false | carried (pass 1 defer) | same as pass 1 |
| Poison rows pin the head of the candidate or orphan page (edge) | maybe-false | carried (pass 1 defer) | same as pass 1; still unproven |
| `close_page_report` could link a report of another gym to the wrong takedown (edge) | false | rejected | `close_page_report` looks the takedown up by the report's own `gym_id` (0167 near line 534); a report of a gym without an open takedown gets `not_taken_down` |
| One `LoadError` hides all three Pages tabs when reports or appeals fail (edge) | low | rejected | the three loads share one page; fix splits the page state |
| Non-urlencoded or oversize body and C1 control characters give a retry message that cannot succeed (edge) | low | rejected | the body cap and content-type refusal are deliberate; C1 controls in a report are not a visitor case worth a branch |
| `client.ts` and `client.test.ts` are untracked and absent from the diff (edge + verification-gap) | false | rejected | they are committed with the story; nothing is committed yet |
| Spec task wording says claim/release (edge claim) | false | rejected | the owner replaced that design; the Spec Change Log records it |
| Editor thumbnails of an offline page break after the purge (verification-gap) | low | carried (pass 1 defer) | already in `deferred-work.md` |
| `decide_page_appeal` typed errors unreachable for `not_taken_down`; `PAGE_UNPUBLISH_REASONS` lacks `takedown_lifted` (verification-gap) | low | rejected | unreachable (an open appeal implies an open takedown); the constant is not read for the lifted state |

## Design Notes

Purge race: a republish between a claim and the delete can lose a freshly re-derived image for one tick. Accepted and recorded; the next publish or save re-derives (any row whose object is missing is re-derived by the publish path) and the window is seconds long.

## Verification

**Commands:**
- `bash scripts/ci-local.sh` -- expected: every stage PASS
- `node scripts/check-migration-guardrails.mjs` -- expected: pass
- `bash scripts/ci-local.selftest.sh` -- expected: pass

**Manual checks (owner):**
- Preview deploy with the new `PUBLIC_SITE_REPORT_KEY` env and the `page-media-purge` edge function deployed: submit a report on a phone, take a test page down and appeal it, and watch a purge run clear an unpublished page's image.
