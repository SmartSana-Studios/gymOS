---
title: '24-7 page names: claim, hold, rename, redirect'
created: '2026-11-08'
type: 'feature'
status: 'done'
baseline_commit: 'f44466cbaef77e581689a1a87688b1bf67572340'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-24-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A gym has no name for its page. Without one rule set, two gyms could claim one name through case, homoglyph or hyphen tricks, a mail or credential-looking name could reach DNS, and a renamed or taken-down name could be re-claimed (FR-202, FR-203, AD-45).

**Approach:** One migration adds `page_names` (rows with a lifecycle) and `page_name_words` (Super Admin-maintained lists), a `SECURITY DEFINER` claim function that refuses, holds or activates, Super Admin approve/reject, a daily sweep, and the database half of rename and redirect. No Owner UI (24.9), no public view or route (24.8, 24.10), no takedown (24.11).

## Boundaries & Constraints

**Always:**
- `page_names(id, gym_id, name, state, origin, held_reason, held_at, decided_at, decided_by, decision_reason, reminded_at, reserved_until, taken_down_at, created_at)`; state `held|active|reserved|redirect|released`; origin `claim|rename|forced_rename`. CHECK = FR-202 grammar (3-30 of `a-z0-9-`, no leading/trailing hyphen, no `--`, no `xn--`, not digits only). Unique index on `lower(name)` over `state <> 'released'`; at most one `active` and one `held` row per gym. RLS on, no client grants (read only through the functions below).
- `page_name_words(kind reserved|brand|generic|place|zone, word, …)`; seeded from addendum J plus every label in `packages/types/src/constants/reservedLabels.json`; `zone` words cannot be removed by the maintenance function. Super Admin changes words only through audited functions.
- `claim_page_name(p_gym_id, p_name)`: caller is the gym's Owner (current gym) or a live Super Admin; Supervisor, Manager, coach, member, support (even assigned) and another gym's Owner get `permission denied`. A non-Super-Admin also needs an active gym. Input is trimmed and lowercased, then checked in order: grammar (typed `invalid_name`); exact reserved, `zone` word, `gymos` prefix, or a name containing a `brand` word (typed `reserved_name`); taken by a non-released row of another gym (typed `name_taken`); then **held** (not an error, returns `state: held`) when any hyphen-separated part of the name is a `generic` or `place` word (owner decision 2026-11-08: one held word holds the name, no exceptions; `x-fitness` is held, `gymnast` is not), or after folding (lowercase, hyphens stripped, `0→o 1→l 3→e 5→s vv→w rn→m`) is equal to or within edit distance 1 of another gym's non-released name, a reserved name, or a brand word; otherwise **active** at once. Edit distance is a plpgsql function (no extension).
- One name per gym. A gym with an active name that claims another is a **rename**: allowed while fewer than two completed renames (origin `rename`, reached `active`) exist in the rolling 12 months, whatever the publish state; typed `rename_limit` otherwise. A held rename leaves the old name serving until approval; on approval (or immediately when not held) the old row becomes `redirect` with `reserved_until = now() + 12 months`, so one hop always points at the gym's current `active` name. A gym's new claim releases its own pending held row first (not counted). Super Admin on behalf of a gym: skips the hold, never the refusals, does not count toward the limit (origin `forced_rename`), and releases the gym's redirect rows at once.
- Decide: `list_held_page_names()` and `decide_held_page_name(p_id, p_approve, p_reason)` for live Super Admin only; reason is required (3-500 chars); approve re-runs the taken/reserved checks, then activates (rename swap as above); reject releases. Both write an audit row. The Owner gets a bilingual `staff_notices` row (and an `email_outbox` row when an address exists) naming the outcome and reason; no individual is named. A held name is due in 2 business days (`private.add_business_days`); the daily sweep sends each Super Admin one reminder notice per overdue name, once (`reminded_at`).
- Lifecycle: an `active` name carries `reserved_until` while its gym is idle (page unpublished or gym not active), set to 12 months from the idle start and cleared when idle ends; `private.set_page_name_idle(gym_id, idle)` is the one setter (24.8 calls it on publish/unpublish; a trigger on `gyms.status` calls it on suspension/reactivation). The sweep releases `active` names past `reserved_until` only if no published page exists, and releases `redirect` rows past `reserved_until`. It never releases a row with `taken_down_at` set or state `reserved` (24.11 sets that for taken-down names; they stay reserved forever). A trigger refuses any `active` row matching the reserved list regardless of which path writes it. The sweep logs to `job_runs` and runs by `cron.schedule` daily.
- `gym_pages.page_name_id` gets its foreign key to `page_names` and a unique index (deferred from 24.4). Add `get_gym_page_name(p_gym_id)` (name, state, pending name, completed renames in window, redirects with expiry; no `held_reason`) for Owner, Supervisor, live-assigned support and Super Admin, with its capability row; claim, decide and word functions get none (support stays denied by default).
- Migration is the next free number (provisional 0163): `set local lock_timeout = '5s'`, `$verify$` block, every function revoked from `public, anon` in the file, rollback script `scripts/rollback-0163-*.sql` with a data-effects note, hand-spliced `database.ts`. Typed errors have EN and FR copy in `apps/dashboard/locales`. Ship a test that enumerates every function writing `page_names` and fails on one not on the allowlist (a gate reaches its consumers).

**Never:** No change to `public_site` views or grants (24.8 adds the name-active predicate, 24.10 the redirect lookup). No Owner-facing UI, no publish, no takedown or force-rename screen (24.11). No Storage, DNS or Vercel change. No production deploy. Do not touch `apps/dashboard/AGENTS.md` or `scripts/demo-gym/`. Do not edit the reserved JSON list.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First claim, clean name | Owner, `iron-yard`, nothing similar | row `active`, `reserved_until` ≈ +12 months, audit row | N/A |
| Mixed case, spaces | ` Iron-Yard ` | stored `iron-yard` | N/A |
| Bad grammar | `ab`, `-x-`, `a--b`, `xn--a`, `12345` | nothing stored | `invalid_name` |
| Reserved / zone / brand | `www`, `mail`, `gymos-x`, `my-login-page` | nothing stored | `reserved_name` |
| Duplicate | name held or active at another gym, any case | nothing stored | `name_taken` |
| Near match | `ir0n-yard` vs existing `iron-yard`; `iron-yar` | row `held`, Owner sees "under review" | N/A |
| Support, Supervisor, other Owner | any claim | nothing stored | `permission denied` |
| Approve held rename | Super Admin, reason | new `active`, old `redirect` +12 months, Owner notice | reason missing: error |
| Reject | Super Admin, reason | row `released`, Owner notice with reason | N/A |
| Third rename in 12 months | two completed | nothing stored | `rename_limit` |
| Forced rename | Super Admin | new `active`, redirects released, count unchanged | N/A |
| Sweep | idle name past 12 months; redirect past 12 months | released | taken-down / `reserved` rows untouched |
| Suspended gym, 6 months | status suspended | name still `active`, not released | N/A |
| Overdue hold | held 3 business days, not reminded | one notice per Super Admin, `reminded_at` set; second run silent | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0160_public_site_reader.sql:67-86` -- `gym_pages` skeleton (`page_name_id uuid`, "no FK until page_names exists"); add FK and unique index only; do not touch the `public_site.pages` view (:98-114).
- `supabase/migrations/0161_gym_page_content.sql:329-357,530-537` -- model for a role-admitted `SECURITY DEFINER` function: `is_super_admin_live()`, `support_rpc_gym_id/role`, `current_gym_status()`, capability and `support_audit_actions` inserts, grants.
- `supabase/migrations/0143_support_payment_connection.sql:72-106,236-290,640-674` -- `staff_notices`, `email_outbox` tables, the owner-plus-Super-Admin notice loop (copy its shape into a new `private.notify_page_name_*`; do not edit `notify_payment_connection_change`), `job_runs` logging and `cron.schedule` pattern.
- `supabase/migrations/0142_support_action_identity.sql:337` -- `private.add_business_days`.
- `supabase/migrations/0133_session_gate_hygiene.sql:103-104` -- `cron.schedule` upsert-by-name precedent.
- `packages/types/src/constants/reservedLabels.json` / `.ts`, `scripts/check-reserved-labels.mjs`, `scripts/__tests__/reserved-labels.test.mjs` -- the one reserved source; add a node test that the migration seed contains every JSON label and prefix.
- `supabase/tests/support_capabilities.test.sql:~150-190`, `support_request_path.test.sql:~232`, `suspension_rpc_coverage.test.sql`, `public_site_reader_privileges.test.sql` -- update deliberately (new function lists, reader has no access to `page_names`).
- `scripts/check-migration-guardrails.mjs` -- every new function revoked from `public, anon`; run it.
- `apps/super-admin/app/(admin)/support/{page.tsx,actions.ts,components}`, `(admin)/notices-actions.ts`, `server-actions.denied.test.ts`, `layout.authz.test.ts` -- page/action/authz-test pattern for the held-names screen.
- `apps/dashboard/locales/en.json`, `fr.json`, `packages/types/src/schemas/gym.ts`, `database.ts` -- error copy, Zod types, splice.
- AD-45: `_bmad-output/planning-artifacts/architecture/architecture-gym_os-2026-08-11/ARCHITECTURE-SPINE.md:293-297`; FR-202/203 in `prds/prd-gym_os-2026-06-20/prd.md:1024-1026`; seed lists in `addendum.md` section J.
- `_bmad-output/implementation-artifacts/deferred-work.md:1636-1646` -- 24-4 items naming 24.7: `page_name_id` uniqueness is closed here; `gym_pages.content` nested limits move to 24.8 (append an entry saying so).

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0163_page_names.sql` -- tables, CHECK, indexes, seeds, word functions, claim/decide/read functions, notice helper, idle setter, `gyms.status` trigger, sweep and cron, `gym_pages` FK, grants, `$verify$`
- [x] `scripts/rollback-0163-page-names.sql` -- reverse, data-effects note
- [x] `supabase/tests/page_names.test.sql` (+ `.negative`) -- matrix rows, role matrix, rolling-window boundary, hold/approve/reject, sweep, taken-down rows kept, consumer enumeration, reserved-trigger on a direct insert
- [x] `supabase/tests/support_capabilities.test.sql`, `support_request_path.test.sql`, `public_site_reader_privileges.test.sql`, others the suite names -- update deliberately
- [x] `scripts/__tests__/reserved-labels.test.mjs` -- migration seed covers the JSON list
- [x] `packages/types`, `apps/dashboard/locales/en.json`, `fr.json` -- types, error copy, `database.ts` splice
- [x] `apps/super-admin/app/(admin)/page-names/` -- held-names screen (list with due date and overdue flag, approve/reject with reason), actions, EN/FR, authz tests; the word-list screen is not built (functions only), log it in `deferred-work.md`
- [x] `docs/decisions.md`, `deferred-work.md`, `sprint-status.yaml` -- 24.7 entry, deferrals, status

**Acceptance Criteria:**
- Given `claim_page_name`, the role matrix and every function that writes `page_names`, then a test enumerates them and a new writer or admitted role without the checks fails it
- Given a direct insert of an `active` reserved name by any path, then the trigger refuses it
- Given full `scripts/ci-local.sh` and `check-migration-guardrails.mjs`, then both pass, per-stage lines read, and a known-bad input (removed hold rule, removed window count) shown to fail the new tests

## Implementation Notes

## Spec Change Log

## Review Triage Log

Pass 1 (layers: blind-hunter, edge-case-hunter, verification-gap).

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| decide_held_page_name locks the held row then gyms; claim_page_name and the gyms.status trigger lock gyms first | medium | patch | 0163 decide :~775-772 vs claim `for update` on gyms; opposite order can deadlock |
| Super Admin claiming the gym's own pending held name returns `held` instead of skipping the hold | medium | patch | claim early return `v_held.name = v_name` has no `not v_is_super_admin`; frozen text says Super Admin skips the hold |
| Two gyms claiming near-match names concurrently both go active (only a per-gym lock) | medium | patch | READ COMMITTED, each claim sees no uncommitted row of the other; unique index only covers exact names |
| Sweep releasing an idle active name leaves the gym's redirect rows pointing at nothing | low | patch | sweep updates only the active row; redirects resolve via the active row (direct fix: release them in the same loop) |
| HeldNamesClient submit has try/finally and no catch: a thrown action leaves the dialog open with no message | medium | patch | HeldNamesClient.tsx:59 `finally` only; `pageNames.errors.generic` exists |
| Untested: own taken-down `reserved` name claim, going back to own redirect, withdrawing by re-asking the current name (`page_name_withdrawn`), gym0s-fit prefix hold, near_match_reserved, near_match_brand | medium | patch | grep: no assertion in either SQL file; each branch removable with all tests green |
| "No individual is named" test is vacuous (`and ... or` precedence, bodies never hold a name); unused `\gset` | low | patch | page_names.test.sql:262, :371 |
| public_site_reader_privileges has the two page_names refusals twice, plan 51 | low | patch | lines 315-318 identical pairs; plan(49) is correct |
| reserved-labels.test.mjs asserts a string present in a comment; passes with the check removed | low | patch | `sql.includes("zone words cannot be removed") \|\| ...`; the runtime check is in page_names.test.sql |
| HeldNamesClient: no non-overdue case; hold-reason and error keys never resolved to copy | low | patch | test renders only `overdue: true`; `defaultValue: code` hides a missing key |
| Sweep partial-failure path (`failure` job_runs row) untested | medium | defer | needs a fixture that makes the update or `log_audit_event` raise; recorded |
| `not_admitted` / `gym_not_active` codes have no database message; claim raises `permission denied` and `gym % is not active` | low | defer | no consumer exists until 24.9; 24-6 maps `permission denied` in the service the same way; recorded as close-before-24.9 |
| No `page_name_*` audit labels in the dashboard audit map | low | defer | 24.5 and 24.6 types also unlabeled; one Epic 24 follow-up |
| Brand word matched as a substring refuses `orange-boxing`, `insecure-gym`; Super Admin cannot override a refusal | medium | defer | frozen text says "containing"; hold-instead-of-refuse for short words is a product call, recorded |
| Going back to a redirected name loses the redirect if the hold is rejected | low | rejected | already in deferred-work.md by the build; rare (needs a new near match against a name the gym once had) |
| Held rows never expire and block the name (squatting); no notice to Super Admin at hold time | low | rejected | one held row per gym, gyms are provisioned by Super Admin, reminder after 2 business days is the specified behavior |
| reminded_at stamped when no Super Admin exists; no Owner to notify when a hold is decided | low | rejected | a platform with no Super Admin cannot reach the decision; a hold needs an Owner caller |
| Brand words / min word length / zero-width reason / add_page_name_word duplicate silent | low | rejected | Super Admin-only functions; each fix adds guards or a return signal |
| Sweep audits a release when the update matched 0 rows; job_runs keeps the last error only | low | rejected | selected rows are active and the loop is serial; same job_runs pattern as 0143 |
| No Owner warning before release; get_gym_page_name lacks reserved_until and due_at | low | rejected | not in the spec; 24.9 can extend the read function |
| toLocaleString in a client component may mismatch on hydration | false | rejected | same call is used in support/SupportLocksPanel.tsx:37, SupportLifecyclePanel.tsx:27 and others |
| Approve/Reject buttons share an accessible name; heldAt not shown; stale row after a failed decision; double Enter | low | rejected | cosmetic or rare; fix adds state |
| Cast of the RPC result instead of generated types; English refine message in shared schema; TS and SQL grammar vectors not shared | low | rejected | no named caller that diverges |
| Trigger covers writes not existing rows; audit row shows the deciding Super Admin and reason to the Owner | false | rejected | header states the trigger scope; the Owner receives the reason in the notice anyway |
| Rollback script not exercised; rollback verify block does not check indexes | low | rejected | build ran rollback then re-apply locally; destructive script by design |

## Design Notes

`reserved` state means a taken-down name only (24.11 sets it with `taken_down_at`); a claimed name is `active` whether or not the page is published, and its idle clock (`reserved_until`) is what lets "up to 12 months" lapse. A redirect row carries no target: it resolves through its `gym_id` to the gym's current `active` row, which keeps redirects one hop after any number of renames. Edit distance 1 means one insert, delete or substitution after folding; a hand-written function over names of at most 30 characters is enough at this scale.

## Verification

**Commands:**
- `bash scripts/ci-local.sh` -- expected: every stage PASS
- `node scripts/check-migration-guardrails.mjs` and `node scripts/check-reserved-labels.mjs` -- expected: pass
