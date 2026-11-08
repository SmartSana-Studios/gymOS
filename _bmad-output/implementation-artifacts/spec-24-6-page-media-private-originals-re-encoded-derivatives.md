---
title: '24-6 page media: private originals, re-encoded derivatives'
type: 'feature'
created: '2026-11-08'
status: 'done'
baseline_commit: '0ad9d73d2b726fd5ed05fc53e42fe8de0add93cd'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-24-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A gym cannot put images on its page. A raw upload would leak GPS/EXIF data and, if served from the existing logo bucket, would expose `gym_id` in the URL (FR-205, AD-47).

**Approach:** One migration adds two buckets (private originals, public derivatives), a `gym_page_media` table and two audited RPCs (register, delete). A dashboard server function validates, re-encodes with sharp (orientation applied, metadata stripped), stores both files, then registers the row. A second function re-encodes the existing gym logo into the new bucket. No UI, no publish, no purge job.

## Boundaries & Constraints

**Always:** Buckets: `gym-page-media-src` (private, no client policies at all) and `gym-page-media` (public). Writes to both go through the server function using the service-role client, only after the caller has been admitted by the register RPC's role check (Owner, Supervisor, live-assigned support, super admin; same admission as `set_gym_page_content`, own capability row `('gym_page','rpc','register_page_media')` and `('gym_page','rpc','delete_page_media')`, audit actions added to `private.support_audit_actions`). Accept only JPEG, WebP, PNG by decoded content (magic bytes via sharp), never by the client mime or extension. Bounds: 4 MiB (Vercel caps a request body near 4.5 MB), 4096 px longest side input, derivative resized to at most 1600 px (logo 512 px) and written as WebP; 12 live gallery images per gym, one live banner, one live logo (a new banner or logo marks the previous row deleted). Derivative key is `crypto.randomUUID()` + `.webp`, no `gym_id` anywhere in it; original key is `{gym_id}/{uuid}`. Derivative uploaded with `Cache-Control: max-age=300`. `gym_page_media` records gym, kind (`logo|banner|gallery`), original key, derivative key, uploader, `attested_at` and the attestation text version, `deleted_at`. Upload requires an explicit attestation boolean (true) that the uploader may publish the image; absent or false is refused. Typed errors (`unsupported_type`, `too_large`, `too_many_pixels`, `limit_reached`, `attestation_required`, `not_admitted`) with EN and FR copy in `apps/dashboard/locales`. If registering fails after upload, remove both objects. Delete = RPC sets `deleted_at` only; the new view stops exposing it at once; object removal is 24.11. A pgTAP/vitest fixture with GPS EXIF proves no EXIF, XMP or IPTC remains in the derivative. Logo preparation reads the object from `gym-logos`, re-encodes into the new bucket as kind `logo`, never links or copies it raw. Migration is the next free number (provisional 0162) with `set local lock_timeout = '5s'`, `$verify$` block, rollback script `scripts/rollback-0162-*.sql`, hand-spliced `database.ts`. Add a `public_site.page_media` view (derivative key and kind and sort only, no gym_id, deleted and non-published excluded) granted to `public_site_reader` only, and edit `public_site_reader_privileges.test.sql` deliberately (columns, views-only list). Add sharp as a direct dashboard dependency.

**Never:** No publish gate, snapshot or `gym_pages` write (24.8). No purge cron or Storage deletes (24.11). No editor UI (24.9). No page name (24.7). No change to `gym-logos` bucket or `gyms.logo_url`. No client-side direct Storage writes to either new bucket. No production deploy. Do not touch `apps/dashboard/AGENTS.md` or `scripts/demo-gym/`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Owner uploads JPEG with GPS EXIF | valid, attested | original in private bucket, WebP derivative with no metadata under random key, one row, one audit row | N/A |
| Rotated phone photo | EXIF orientation 6 | derivative upright | N/A |
| GIF, SVG, PDF renamed `.jpg` | wrong content | nothing stored | `unsupported_type` |
| Over 4 MiB or over 4096 px | oversized | nothing stored | `too_large` / `too_many_pixels` |
| 13th gallery image | 12 live exist | refused | `limit_reached` |
| New banner | one live banner | old row marked deleted, new live | N/A |
| Member, coach, other gym's Owner, unassigned support | any | refused before any storage write | `not_admitted` |
| No attestation | false | refused | `attestation_required` |
| Register RPC fails | after upload | both objects removed | typed error |
| Delete | live row | `deleted_at` set, absent from view at once | refused if other gym |
| Logo preparation | gym has `logo_url` | derivative in new bucket, kind logo | no logo: typed error |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0014_gym_settings_owner_access.sql:56-120` -- `gym-logos` bucket pattern (reference only; new buckets differ: private src has no policies).
- `supabase/migrations/0161_gym_page_content.sql:329-357,530` -- setter, admission via `private.support_rpc_gym_id/role` (from `0140:69,83,126`), grants; copy for the two RPCs, capability rows and `support_audit_actions`.
- `supabase/migrations/0160_public_site_reader.sql:98-114` -- `public_site.pages` view pattern; `gym_pages_content_keys` already allows gallery, banner, logo.
- `supabase/tests/public_site_reader_privileges.test.sql:~164,225-246` -- pinned columns and views-only list.
- `supabase/tests/support_capabilities.test.sql` (counts, name arrays), `support_role_live_gate`, `suspension_rpc_coverage` -- update for new RPCs.
- `apps/dashboard/services/gym-settings.ts:10-17,230` and `app/(dashboard)/settings/actions.ts:112-133` -- logo upload pattern, `mapAndLog`, `getCallerGymId`, typed errors, `getServerTranslation`.
- `apps/dashboard/locales/en.json`, `fr.json` (~:266) -- add error copy.
- `packages/types/src/schemas/gym.ts` -- page media Zod types; `database.ts` hand-splice.
- `/workspaces/gym_os/package.json:41` -- sharp only an override; add `sharp` to `apps/dashboard/package.json`. Verify the service-role env var is already available to dashboard server code before relying on it.
- AD-47: `_bmad-output/planning-artifacts/architecture/architecture-gym_os-2026-08-11/ARCHITECTURE-SPINE.md:305`.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0162_gym_page_media.sql` -- buckets, `gym_page_media`, RLS deny-all, register/delete RPCs, capability rows, audit actions, `public_site.page_media` view, grants
- [x] `scripts/rollback-0162-gym-page-media.sql` -- reverse with data-effects note
- [x] `supabase/tests/gym_page_media.test.sql` (+ `.negative`) -- admission per role, limits, replace banner, delete hides from view, no client access to either bucket
- [x] `supabase/tests/support_capabilities.test.sql`, `public_site_reader_privileges.test.sql` and RPC-listing tests -- updated deliberately
- [x] `apps/dashboard/services/page-media.ts` + server action -- validate, sharp pipeline, upload, register, rollback, logo preparation
- [x] `apps/dashboard/services/page-media.test.ts` + EXIF fixture -- matrix rows, GPS/XMP/IPTC absent, key has no gym_id
- [x] `packages/types`, `locales/en.json`, `fr.json`, `apps/dashboard/package.json` -- types, copy, sharp
- [x] `docs/decisions.md`, `sprint-status.yaml` -- 24.6 entry and status

**Acceptance Criteria:**
- Given the setter-style consumers (Owner, Supervisor, support, super admin), then a test enumerates them and a new admitted role without the check fails it
- Given any derivative URL, then it contains no `gym_id` and the private bucket serves nothing to anon or authenticated
- Given full `scripts/ci-local.sh` and `check-migration-guardrails.mjs`, then both pass, per-stage lines read, and a known-bad input shown to fail the new tests

## Implementation Notes

Deviations, all to make the spec work: `register_page_media` has `p_dry_run` so admission runs before any storage write (the spec allows only two RPCs); extra error codes `no_logo` and `upload_failed`; `uploaded_by` uses `private.actor_id()` and the audit identity trigger records the real support person; `next.config.ts` raises the Server Action body limit to 5 MB (the 1 MB default blocked 1-4 MiB uploads); `pnpm-lock.yaml` hand-edited for the sharp importer (regenerating bumped unrelated packages). Migration number 0162 is provisional. Open: sharp bundling on Vercel and real-Storage uploads are unverified until the first preview deploy (see deferred-work.md).

## Spec Change Log

- 2026-11-08, review pass 3, at the owner's direction: upload cap 5 MiB -> 4 MiB (Vercel caps a request body near 4.5 MB, so 5 MiB uploads would fail with an untyped platform 413). Edited the frozen Bounds line and the I/O matrix row; `bodySizeLimit` 6mb -> 5mb. Migration 0162 is still provisional and unapplied to production, so it was edited in place.

## Review Triage Log

Pass 1 (layers: blind, edge-case, verification-gap).

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| decisions.md 24.6 Buckets bullet corrupted by `$verify$` substitution | medium | patch | Confirmed at docs/decisions.md:12, header text spliced mid-sentence |
| Server Action 1 MB body default blocks 1-5 MiB uploads | medium | patch | next.config.ts has no serverActions.bodySizeLimit |
| View taken_down_at / suspended-gym exclusions untested | medium | patch | Test never sets either; deleting the condition passes |
| delete_page_media on suspended gym untested | low | patch | One assertion in the negative test |
| removeObjects stops if first remove throws | low | patch | Second removal never runs; direct fix |
| gymLogoObjectPath: URIError, `#` fragment | low | patch | Direct fix |
| ICC assertion vacuous; byte-limit test misnamed | low | patch | Fixture has no ICC profile; test asserts unsupported_type |
| Unused noFileProvided key; "5 MB" vs MiB copy | low | patch | Direct fix |
| View has no per-page join key | medium | defer | 24.8 owns snapshot tie; recorded as close-before-24.8 |
| Deleted derivatives fetchable until 24.11 purge | low | defer | Accepted in spec; recorded as close-before-flag-on |
| Lost RPC response then objects removed | low | defer | Rare, fix adds a lookup branch; recorded |
| Real Storage / Vercel sharp / concurrency unverified | maybe-false | defer | Settled by first preview deploy; recorded |
| Validation errors returned before admission | false | rejected | Matrix says refused before any storage write; no storage write occurs, nothing about other gyms revealed |
| service_role cannot select gyms (preparePageLogo) | false | rejected | 0002 grants select on gyms to service_role |
| register_page_media trusts caller keys/attestation version | low | rejected | Only own-gym admitted callers; shape enforced; fix adds allow-list surface |
| Animated input becomes static; strict UUID regex; pixel-limit regex branch untested; dead exports; error mapping for not found; rollback leaves buckets | low | rejected | Unlikely in use; fix is more than a direct correction, rollback limitation documented in the script |

### Review Findings

Review pass 2 (2026-11-08, bmad-code-review, 4 layers: blind-hunter, edge-case-hunter, verification-gap, acceptance-auditor).

- [x] [Review][Patch] Server Action wrappers have no test: `attested`, `file instanceof Blob` and `gymId`/`kind` mapping can regress unseen [apps/dashboard/app/(dashboard)/settings/page-media-actions.ts:164-183] — add `page-media-actions.test.ts` (mock `@/services/page-media`; FormData with `attested` absent, "false", "true"; non-Blob `file` becomes null; args forwarded). medium, verification-gap
- [x] [Review][Patch] `delete_page_media` roles are only enumerated by a `prosrc` regex; only the Owner is exercised as succeeding [supabase/migrations/0162_gym_page_media.sql:183-228] — add pgTAP: Supervisor deletes, live-assigned support deletes, super admin deletes another gym's live media, super admin deletes media of a suspended gym, super admin gets `delete_page_media: not found` for an unknown id. medium, verification-gap+acceptance-auditor
- [x] [Review][Patch] `pageMediaCodeFromDbError` maps any message containing "permission denied" to `not_admitted`, hiding real privilege faults (`permission denied for function ...`) from the log [apps/dashboard/services/page-media.ts:88] — match the RPC's exact `permission denied` only; update the test. low, edge-case-hunter
- [x] [Review][Defer] Gym deletion cascades `gym_page_media` rows but leaves every original (EXIF intact) and derivative in the buckets with no key left to find them; a failed rollback removal is only `console.error` — deferred: object lifecycle is 24.11 (purge); fold gym deletion and an orphan sweep into it
- [x] [Review][Defer] No cap on deleted `logo`/`banner`/`gallery` rows or on upload rate per gym; repeated upload/delete cycles grow rows and storage until the purge ships, each upload costs a sharp decode and encode — deferred: 24.11 purge bounds storage; rate limiting is a product call for the 24.9 editor

#### Rejected

- Key-shape CHECK `[0-9a-f-]{36}` accepts non-UUIDs — low, rejected: already rejected in pass 1; only own-gym admitted callers can register, the key is a URL to an object that is public anyway.
- `delete_page_media` / `gym not found` / `invalid_kind` fall through to `upload_failed`; suspended gym shown as "not allowed" — low, rejected: already rejected in pass 1; fix adds codes and locale keys, rare in use.
- Validation errors returned before `admit()` — false: matrix requires only no storage write; none happens.
- Logo path `includes("..")` refuses `my..logo.png` — false: `uploadGymLogo` always writes `{gymId}/logo.{ext}`.
- gym-logos download error reported as `no_logo`; blob fully buffered before size check — low, rejected: needs a storage outage or an oversize object in a bucket this code does not fill.
- Double register with the same derivative key after a retry — false: `storeAndRegister` draws fresh UUIDs per call and does not retry. The lost-response case is already in deferred-work.
- CHECK `original_key` NULL-substring passes — false: a NULL substring makes the `and` with the regex false, not NULL.
- `deletePageMediaAction` non-string `mediaId` throws TypeError — false: `RegExp.test` coerces to string and returns false, giving `not_admitted`.
- Dry run to real register window — false: the real call re-admits, and objects are removed on refusal.
- 6 MB `bodySizeLimit` applies to all Server Actions — low, rejected: disclosed in Implementation Notes, required for 5 MiB uploads.
- "Nothing is read before admission" comment is weaker than stated — low, rejected: comment wording, no behavior.
- Constants duplicated across SQL, TS and bucket limits; unused `PAGE_MEDIA_MAX_GALLERY`, `uploadPageMediaFieldsSchema`, `pageMediaRowSchema.gym_id`, `PageMediaErrorCode` omissions; locale copy hard-codes limits — low, rejected: cosmetic, no named caller that diverges.
- Metadata stripping proven for JPEG fixtures only; animated WebP/APNG become one frame; fixture comment and `fill(0)` oddities — low, rejected: one code path (WebP output, no `withMetadata`) strips every input format; fix adds fixtures.
- Rollback deletes `support_audit_actions` rows while audit rows remain; leaves buckets — false: 0161, 0151 and 0144 rollbacks do the same, no FK ties them; bucket limit is documented.
- `public_site.page_media` ordering and duplicate `gym_pages` join — false: `gym_pages.gym_id` is the primary key; ordering belongs to the 24.8 snapshot, already deferred.
- Spec `status: done` vs sprint `review`, pgTAP plan counts 58/37 vs 62/39, stale `last_updated` — false/low: sprint-status entries are an append-only log (the 58/37 entry predates the pass-1 patches); fix edits the spec.
- Extra surface (`p_dry_run`, `no_logo`, `upload_failed`, lockfile) — rejected: disclosed in Implementation Notes, nothing in Never.
- Typed `not_admitted` for admission before validation; `delete` leaves `original_key`/`derivative_key` untested — low, rejected: matrix met; function body only touches `deleted_at`.

Review pass 3 (2026-11-08, bmad-code-review, 4 layers over `0ad9d73` to the working tree incl. staged pass-2 patches; code only, `_bmad-output/` and `scripts/demo-gym/` excluded).

- [x] [Review][Decision] RESOLVED (owner chose option 1: lower to 4 MiB; constant, bucket limit, EN/FR copy, tests, decisions.md and this spec updated, `bodySizeLimit` now 5mb) — Vercel caps a Server Action request body near 4.5 MB, below the 5 MiB (`PAGE_MEDIA_MAX_BYTES`) the spec, bucket limit and copy promise [apps/dashboard/next.config.ts:11-12, apps/dashboard/services/page-media.ts:211] — medium, blind-hunter+edge-case-hunter. `bodySizeLimit: "6mb"` only lifts Next's own limit; on Vercel an upload of 4.5-5 MiB is refused by the platform with an untyped 413 before the action runs, so the typed `too_large` never fires and the UI promise is false. Platform cap recalled from Vercel docs, not verified from this checkout. Fixing means editing the frozen 5 MiB or changing the upload path, so it needs your call. Options: (a) lower the cap to 4 MiB in the constant, bucket limit, copy and spec; (b) keep 5 MiB and have the 24.9 editor downscale client-side before sending; (c) signed-URL direct upload to Storage (new surface, reopens "no client-side Storage writes"); (d) keep as is and verify on the first preview deploy.
- [x] [Review][Patch] Dropping the `..` guard in `gymLogoObjectPath` fails no test; it is the only cross-tenant guard on a service-role `gym-logos` download [apps/dashboard/services/page-media.test.ts:~215-224, apps/dashboard/services/page-media.ts:237] — add `${GYM}/../<other-gym>/logo.png` and the `%2e%2e` form, both expecting null. medium, verification-gap
- [x] [Review][Patch] `pg_temp.mid('%000000000001.webp')` matches both gym A's `bbbb…-000000000001.webp` and the suspended gym's `dddd…-000000000001.webp`; the scalar SQL function returns whichever row comes first, so the delete denial and control assertions depend on heap order [supabase/tests/gym_page_media.negative.test.sql:66,150-161] — use the full key or the row id. Verified in the file. medium, edge-case-hunter+acceptance-auditor
- [x] [Review][Patch] "a failed derivative upload removes the original" asserts only the `gym-page-media-src` removal, not the public `gym-page-media` one, so a branch that leaves the half-written public derivative still passes [apps/dashboard/services/page-media.test.ts:204-210] — add `expect(remove).toHaveBeenCalledWith("gym-page-media", [expect.any(String)])`. low, verification-gap
- [x] [Review][Patch] If the derivative `upload()` rejects instead of returning `{error}`, the original (GPS EXIF intact) stays in the private bucket with no row [apps/dashboard/services/page-media.ts:161-170] — move both uploads inside the try that already calls `removeObjects`. low, edge-case-hunter
- [x] [Review][Patch] The decoder pixel-limit branch (`/pixel limit/i`) is untested: the only `too_many_pixels` test is 4097x8, which the explicit side check catches [apps/dashboard/services/page-media.test.ts, apps/dashboard/services/page-media.ts:61] — add a blank 5000x5000 PNG case. Verified here that sharp throws `Input image exceeds pixel limit` from `metadata()`. low, blind-hunter+edge-case-hunter
- [x] [Review][Patch] Fixture comment says it drops any APP0 sharp wrote; the code keeps sharp's JFIF APP0 and inserts the new segments before it, and `Buffer.from([0,0,0,0]).fill(0)` is dead [apps/dashboard/services/page-media.fixture.ts:~295-297] — correct the comment, drop the dead call. low, edge-case-hunter+blind-hunter
- [x] [Review][Defer] No test checks that every `PAGE_MEDIA_ERROR_CODES` value plus `noLogo` and `uploadFailed` exists in both `en.json` and `fr.json` — deferred: all nine keys are present in both locales today; the UI that renders them is 24.9, so the locale-key test belongs there

#### Rejected (pass 3)

- Truncated JPEG accepted because `failOn: "error"` — false: ran sharp on a JPEG cut at 50%; `failOn` error, truncated and warning all refuse it (`premature end of JPEG image`).
- `p_dry_run => NULL` falls through to a real register — false as a harm: the caller already passed admission and every check, so it can register with `false` anyway; no escalation.
- Uppercase gym id fails late as `invalid_original_key` — low, rejected: fails closed, gym id comes from a hand-crafted request only.
- Deleted/replaced derivatives stay fetchable; object removal is 24.11 — duplicate: already in deferred-work.md ("close before the landing-page feature flag is on") and the spec's Never list forbids Storage deletes.
- Register commits but the response is lost, cleanup removes live objects; no orphan sweeper; upload churn unbounded — duplicates of existing deferred-work.md entries.
- `bodySizeLimit` is global to all Server Actions — rejected again (pass 2): disclosed; folds into the Vercel decision above.
- Logo download error reported as `no_logo`; blob buffered before size check; `delete … not found` / `invalid_kind` fall to `upload_failed`; unknown kind shown as `unsupported_type`; expired session shows `upload_failed`; `toAppError` could throw — low, rejected (pass 2 or same class): rare, and each fix adds codes, copy or guards.
- Direct RPC callers can register arbitrary keys/version; 23505 as key-existence oracle — rejected (pass 1): admitted own-gym callers only, keys are random UUIDs.
- Constants and limits duplicated across SQL, TS and copy; attestation version not tied to copy; unused exports — rejected (pass 2): no named caller that diverges.
- `on conflict do nothing` leaves a pre-existing bucket's limits; verify block checks only `public`; rollback leaves buckets and removes audit-action rows; migration number hard-coded — rejected: no pre-existing bucket anywhere, rollback limits documented, same pattern as 0161/0151/0144.
- No alt text, reorder, minimum dimensions, original retention bound; animated/CMYK inputs — rejected: not in the spec, 24.9 and 24.11 own them.
- AC1 test uses a `prosrc` regex, not a role enumeration — low, rejected: behavioral per-role tests cover Owner, Supervisor, support and super admin for both RPCs.
- Validation errors before `admit()`; `uploaded_by` holds the proxy actor; rollback leaves buckets; loose anon-read proof; extra `p_dry_run`/`no_logo`/`upload_failed` — rejected (pass 1/2) or disclosed in Implementation Notes.
- Size check before admission contradicts the header comment — false: the declared `file.size` is read, not the file contents (pass 2).

## Verification

**Commands:**
- `bash scripts/ci-local.sh` -- expected: every stage PASS
- `pnpm --filter dashboard test` -- expected: green
