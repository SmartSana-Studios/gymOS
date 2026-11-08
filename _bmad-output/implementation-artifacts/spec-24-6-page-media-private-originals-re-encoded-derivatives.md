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

**Always:** Buckets: `gym-page-media-src` (private, no client policies at all) and `gym-page-media` (public). Writes to both go through the server function using the service-role client, only after the caller has been admitted by the register RPC's role check (Owner, Supervisor, live-assigned support, super admin; same admission as `set_gym_page_content`, own capability row `('gym_page','rpc','register_page_media')` and `('gym_page','rpc','delete_page_media')`, audit actions added to `private.support_audit_actions`). Accept only JPEG, WebP, PNG by decoded content (magic bytes via sharp), never by the client mime or extension. Bounds: 5 MiB, 4096 px longest side input, derivative resized to at most 1600 px (logo 512 px) and written as WebP; 12 live gallery images per gym, one live banner, one live logo (a new banner or logo marks the previous row deleted). Derivative key is `crypto.randomUUID()` + `.webp`, no `gym_id` anywhere in it; original key is `{gym_id}/{uuid}`. Derivative uploaded with `Cache-Control: max-age=300`. `gym_page_media` records gym, kind (`logo|banner|gallery`), original key, derivative key, uploader, `attested_at` and the attestation text version, `deleted_at`. Upload requires an explicit attestation boolean (true) that the uploader may publish the image; absent or false is refused. Typed errors (`unsupported_type`, `too_large`, `too_many_pixels`, `limit_reached`, `attestation_required`, `not_admitted`) with EN and FR copy in `apps/dashboard/locales`. If registering fails after upload, remove both objects. Delete = RPC sets `deleted_at` only; the new view stops exposing it at once; object removal is 24.11. A pgTAP/vitest fixture with GPS EXIF proves no EXIF, XMP or IPTC remains in the derivative. Logo preparation reads the object from `gym-logos`, re-encodes into the new bucket as kind `logo`, never links or copies it raw. Migration is the next free number (provisional 0162) with `set local lock_timeout = '5s'`, `$verify$` block, rollback script `scripts/rollback-0162-*.sql`, hand-spliced `database.ts`. Add a `public_site.page_media` view (derivative key and kind and sort only, no gym_id, deleted and non-published excluded) granted to `public_site_reader` only, and edit `public_site_reader_privileges.test.sql` deliberately (columns, views-only list). Add sharp as a direct dashboard dependency.

**Never:** No publish gate, snapshot or `gym_pages` write (24.8). No purge cron or Storage deletes (24.11). No editor UI (24.9). No page name (24.7). No change to `gym-logos` bucket or `gyms.logo_url`. No client-side direct Storage writes to either new bucket. No production deploy. Do not touch `apps/dashboard/AGENTS.md` or `scripts/demo-gym/`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Owner uploads JPEG with GPS EXIF | valid, attested | original in private bucket, WebP derivative with no metadata under random key, one row, one audit row | N/A |
| Rotated phone photo | EXIF orientation 6 | derivative upright | N/A |
| GIF, SVG, PDF renamed `.jpg` | wrong content | nothing stored | `unsupported_type` |
| Over 5 MiB or over 4096 px | oversized | nothing stored | `too_large` / `too_many_pixels` |
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

Deviations, all to make the spec work: `register_page_media` has `p_dry_run` so admission runs before any storage write (the spec allows only two RPCs); extra error codes `no_logo` and `upload_failed`; `uploaded_by` uses `private.actor_id()` and the audit identity trigger records the real support person; `next.config.ts` raises the Server Action body limit to 6 MB (the 1 MB default blocked 1-5 MiB uploads); `pnpm-lock.yaml` hand-edited for the sharp importer (regenerating bumped unrelated packages). Migration number 0162 is provisional. Open: sharp bundling on Vercel and real-Storage uploads are unverified until the first preview deploy (see deferred-work.md).

## Spec Change Log

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

## Verification

**Commands:**
- `bash scripts/ci-local.sh` -- expected: every stage PASS
- `pnpm --filter dashboard test` -- expected: green
