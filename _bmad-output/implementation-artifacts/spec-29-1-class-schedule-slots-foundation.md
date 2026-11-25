---
title: '29-1 Class schedule slots foundation (no UI change)'
type: 'feature'
created: '2026-11-19'
status: 'done'
baseline_commit: 'be28607701a52559dad76bb5c41a22f244c6b887'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-29-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/epics.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A recurring class stores one time and a list of days on the `classes` row, so it cannot run at a different time on each day. Epic 29's slot editor (29.2) and coach flows (29.3, 29.4) need the times stored as rows first, with the daily job and the class functions reading them, and with no change to any existing session, booking or screen.

**Approach:** Add `class_schedule_slots` with its guards, expand every existing recurring class into slots, point the shared materializer at the slots, and add the single regeneration path `private.apply_class_slots`. `create_class` and `update_class` keep their signatures and now derive slots from the single time and the selected days. The dashboard and mobile app do not change. Acceptance criteria are Story 29.1 in `_bmad-output/planning-artifacts/epics.md` (lines 7130-7203); this spec adds the Code Map and the decisions the investigation forced.

## Boundaries & Constraints

**Always:**
- One migration `0180_class_schedule_slots.sql` (0179 is the head; the number is "next free at merge time") with `scripts/rollback-0180-class-schedule-slots.sql` (conventions of `scripts/rollback-0179-*.sql`: `lock_timeout`, a refusal guard, drop new objects, restore old bodies) and a `do $verify$` block at the end of the migration (patterned on 0111's), which also holds the before/after count and md5 checks of `class_sessions` and `class_bookings` and the slot-count checks from the AC.
- Table, grants and policies follow 0111: `enable row level security`, `revoke all ... from anon, authenticated, service_role`, `grant select ... to authenticated, service_role`, select policy `gym_id = (select private.gym_id())`, and a restrictive `tenant_active_gate` policy as in 0124 (`(select private.current_gym_status()) = 'active' or (select private.is_super_admin())`). Do not name "supervisor" in any new policy or function (it would enter `support_capabilities.test.sql`'s classification).
- Lock order is class row first (`FOR UPDATE` on `classes`), then future session rows `FOR UPDATE` in `scheduled_at` order, never the reverse (spine AD-21; `book_class_session` locks a session row and takes no class lock).
- The shared materializer keeps its signature, `on conflict (class_id, scheduled_at) do nothing`, the `current_date .. current_date + 4 weeks` window and the gym time-zone conversion; only the days/time source changes. `run_class_session_materializer_job()` is not edited.
- Every new function ends with `revoke ... from public, anon` in the same file (`scripts/check-migration-guardrails.mjs`). A new definer function that writes `class_sessions` or `class_schedule_slots` carries the `current_gym_status() is distinct from 'active'` guard with no comments in its body, or an entry in the exclusion view the way `private.materialize_sessions_for_class` has one (`suspension_rpc_coverage.test.sql`).
- `recurrence_days` and `recurrence_time` stay on `classes` and are still written by `create_class` and `update_class`. Regenerate `packages/types/src/database.ts` (only `class_schedule_slots` should appear). Record in `deferred-work.md`: the clean-up migration that drops the two columns, and the rolling window's server-date imprecision.
- Existing pgTAP suites pass without edit, except the one arithmetic change named below. Run the full `scripts/ci-local.sh`; run `scripts/ci-local.selftest.sh` only if `ci-local.sh` is touched (it is, to wire the new race script).

**Never:**
- No UI, dashboard or mobile source change; no change to `list_my_classes`, `book_class_session`, `cancel_class_booking`, `mark_class_attendance`.
- No new column on `classes`, `class_sessions` or `class_bookings`.
- No `cancel_class`, slot editor RPC, or coach grants (29.2, 29.3). No change to one-off class behaviour: the 0058 "cannot reschedule ... existing bookings" refusal stays for one-off classes (fixtures 8094/8095 in `class_booking_with_capacity_enforcement.test.sql`).
- Never move or delete an existing session at migration time; never delete a session that has a booking.
- No direct write grant on `class_schedule_slots` to any role, including `service_role`.

**Decisions (made while planning):**
- Compatibility path for direct recurring inserts: `class_creation_scheduling.test.sql` (class 7042 and the materializer-job case) and `coach_portal_my_classes.test.sql` insert recurring classes straight into `classes` with days and time and no slots, and must pass unedited. An AFTER INSERT trigger on `classes` (definer, not callable) derives slots from `recurrence_days` x `recurrence_time` when both are present and the class has no slot, `on conflict do nothing`. It also serves any other legacy writer (E2E seed, `scripts/epic19-qa`). It does nothing when the columns are null, which is how 29.2 will create slot-only classes. `create_class` and `update_class` still derive and write slots explicitly, as the AC says.
- The deferred "recurring class must have a slot" constraint trigger never fires inside pgTAP's rolled-back transactions unless a test sets constraints immediate; the new tests do so to prove it.
- `suspension_rpc_coverage.test.sql` hard-codes "tenant_active_gate covers 25 tables"; the new gate makes it 26. That number and its message are the one unavoidable edit to an existing test.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Migrate existing classes | recurring classes: daily, Tue/Thu, Sunday-only (weekday 0), past start date, booked and attended | one slot per `recurrence_days` entry at `recurrence_time`; one-off gets none; sessions and bookings byte-identical (counts and md5) | verify block raises, migration rolls back |
| 15th slot | class with 14 slots, insert another (same or other weekday) | refused: "a class can have at most 14 weekly times" | trigger locks class row first so concurrent 14th/15th cannot both pass |
| Duplicate slot | same `(class_id, weekday, start_time)` | unique violation; same weekday at another time accepted | N/A |
| Cross-gym slot | slot `gym_id` differs from its class's gym; or update moves slot to another class/gym | refused | tenancy trigger raises |
| Direct write | Owner, Manager, Coach, `service_role` insert/update/delete | permission error | N/A |
| Cross-tenant read | any role reads another gym's slots | zero rows; suspended gym denied by the restrictive gate | N/A |
| Seconds in time | `start_time` 18:00:30 | refused by CHECK | check violation |
| Recurring class, no slot, at commit | deferred constraint trigger | commit refused; one-off with a slot also refused | raises at commit |
| Daily job / materialize | recurring class with slots | same `(class_id, scheduled_at)` set the pre-migration function produced, incl. a DST zone and a Sunday slot; second run inserts nothing; `job_runs` row logged | N/A |
| Slot replace, session matches a slot | future session, with or without bookings | kept | N/A |
| Slot replace, no match, no booking | future session | deleted (re-checked under the session lock) | N/A |
| Slot replace, no match, has bookings | future session | untouched, returned as `(class_session_id, scheduled_at, booked_count)` | never raises |
| Past session | `scheduled_at <= now()` | never touched | N/A |
| Recurring reschedule with bookings | `update_class` / `materialize_class_sessions(id, true)` | regenerates under the slot rule; no "cannot reschedule" error | one-off keeps the 0058 refusal |
| Booking races slot edit | `book_class_session` vs `apply_class_slots` on one unbooked non-matching session | either booked and kept-and-listed, or deleted and booking gets not-found; never an orphan booking, FK error or deadlock; 50 iterations clean | N/A |
| Gym time zone changed | next daily run | new sessions use the new zone; existing not moved | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0057_*.sql` -- `classes` CHECK `classes_schedule_matches_type` (43-53), `classes_validate_coach_trigger` (140-165, tenancy-trigger template), live `private.materialize_sessions_for_class(uuid)` (189-253, never redefined; service_role only), job `run_class_session_materializer_job()` (453-487) and cron (494-498).
- `supabase/migrations/0124_*.sql` -- live `public.create_class` (1286-1322), `public.update_class` (2362-2433; `select ... for update` at class row, schedule-changed compare 2399-2403, booking refusal 2405-2413, then delete future sessions and re-materialize), live `public.materialize_class_sessions(uuid, boolean)` (1982-2030, refusal 2015-2022), `classes` policies (85-90, 216-219) and the `(select ...)` wrapping style.
- `supabase/migrations/0111_check_in_session_gate.sql` -- table, RLS, revoke/grant, restrictive gate (65-101) and `do $verify$` (551-609) to copy.
- `supabase/migrations/0159_*.sql:76` -- `uppercase_name` trigger on `classes`, unaffected. `0096` `list_my_classes` returns `recurrence_days`/`recurrence_time` unchanged.
- `supabase/tests/class_creation_scheduling.test.sql` (7042 inserted directly at 57-59, materializer calls 158-173 and 283-295) and `.negative.test.sql` (CHECK rejections 121-131: one-off with stray recurrence and recurring missing start date must still reject; a recurring row with no days/time is now valid) -- must pass unedited.
- `supabase/tests/class_booking_with_capacity_enforcement.test.sql` -- section (u) 746-795, one-off fixtures 8094/8095; booking concurrency pattern (two connections) to extend. `coach_portal_my_classes.test.sql:84` direct recurring fixture.
- `supabase/tests/suspension_rpc_coverage.test.sql` -- gate count 25 at 51-52 (to 26); definer-write guard scan 67-82; exclusion view entry pattern at 154. `support_capabilities.test.sql` -- totals and name lists must stay unchanged.
- `scripts/single-use-race.sh` -- model for the new `scripts/class-slot-race.sh` (psql sessions in the DB container, "race: all passed" verdict), wired into `stage_pgtap` of `scripts/ci-local.sh` (116-143).
- `scripts/check-migration-guardrails.mjs`, `scripts/claim-inventory.mjs` (`pnpm run check:claims`) -- must stay clean; `packages/types/src/database.ts` -- regenerate (`npx supabase gen types typescript --local`; zero-byte stdout bug, fallback is the pg-meta endpoint used by earlier stories).
- `apps/dashboard/e2e/fixtures/seed.ts:318`, `scripts/epic19-qa/lib.mjs:106-110` -- direct recurring inserts; covered by the compatibility trigger, verify and do not edit.
- `apps/dashboard/components/classes/ClassesPageClient` and `ClassModal`, `apps/dashboard/services/classes.ts` -- unchanged; add a component test proving the Schedule column and modal show the same days and time for fixture classes.

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/migrations/0180_class_schedule_slots.sql` -- table, CHECKs, unique and index, tenancy and 14-cap triggers, RLS/grants, expansion backfill, replaced CHECK, deferred constraint trigger, compatibility AFTER INSERT trigger, slot-based `private.materialize_sessions_for_class`, `private.apply_class_slots`, updated `create_class`, `update_class`, `materialize_class_sessions`, exclusion-view/guard entries, verify block -- the whole data half
- [ ] `scripts/rollback-0180-class-schedule-slots.sql` -- restore the 0057/0124 bodies and CHECK, drop the new objects; refuse if slots differ from the legacy columns -- reversibility
- [ ] `supabase/tests/class_schedule_slots.test.sql` and `.negative.test.sql` -- schema, cap and its concurrency lock, tenancy, per-role grants and RLS (cross-tenant per role, suspended gym), expansion fixtures with byte-identical sessions/bookings, constraint trigger with `set constraints ... immediate`, materializer equivalence incl. DST and Sunday, idempotence, `apply_class_slots` rules, recurring-versus-one-off reschedule behaviour
- [ ] `scripts/class-slot-race.sh` and `scripts/ci-local.sh` -- 50-iteration book-versus-slot-edit race, wired into the pgtap stage; run once against a deliberately broken ordering to show it can fail
- [ ] `supabase/tests/suspension_rpc_coverage.test.sql` -- gate count 25 to 26
- [ ] `apps/dashboard` component test -- unchanged Schedule column and modal for fixture classes
- [ ] `packages/types/src/database.ts` -- regenerate; `deferred-work.md` -- the two entries; `sprint-status.yaml` -- last_updated entry

**Acceptance Criteria:**
- Given Story 29.1's acceptance criteria in `epics.md` (7130-7203), when the pgTAP, race, vitest and `scripts/ci-local.sh` gates run, then every criterion has a named passing test and every pre-existing suite passes without edit except the gate count above.
- Given a class created through today's UI after the migration, when it is read, then it behaves exactly as a migrated one.
- Given `check:claims`, `check:migrations` and `support_capabilities.test.sql`, then no new `claim-only` entry, no guardrail failure, and unchanged totals.

### Review Findings

Code review pass 2 (2026-11-20, `bmad-code-review`): Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor on `git diff epic/29...HEAD`. All four layers returned. All 6 patches applied the same day (see sprint-status last_updated).

- [x] [Review][Patch] (medium) The 14-slot cap trigger refuses a no-op re-apply of a class that already has 14 slots [supabase/migrations/0180_class_schedule_slots.sql:162-185, 406-409] — `class_schedule_slots_cap` is BEFORE INSERT and counts `>= 14` before `ON CONFLICT DO NOTHING` can see the duplicate, so `apply_class_slots` and `materialize_class_sessions(id, true)` raise "at most 14 weekly times" for a 14-slot class given its own set, and a swap at 14 can fail depending on row order. Proven on the local DB in a rolled-back transaction (13 inserted plus the compat-trigger slot = 14, re-apply of the same 14 raised the cap error from `apply_class_slots` line 39). Unreachable from 29.1's own paths (max 7 slots) but 29.2's editor reaches it. Fix: return `new` from the cap trigger when the row already exists (or insert only missing rows in `apply_class_slots`); add pgTAP for re-apply of 14 and swap-one-at-14. (blind-hunter + edge-case-hunter + acceptance-auditor)
- [x] [Review][Patch] (low) DST test discriminates instant matching from clock matching only when the next transition is spring-forward [supabase/tests/class_schedule_slots.test.sql:281-291] — the fixture takes the next transition of either kind; on a fall-back date 02:30 round-trips, so a clock-time implementation also passes. From late March to late October the test is blind to the rule it names. Fix: pin a gap date (filter on a local time that does not round-trip, or fix 2027-03-28 Europe/Paris). (verification-gap)
- [x] [Review][Patch] (low) `update_class` changing only the start date of a recurring class is never exercised [supabase/tests/class_schedule_slots.test.sql] — the later-start-date case sets `recurrence_start_date` with a direct `update classes` then calls `apply_class_slots`; every `update_class` call passes `current_date`. Reordering the `update classes` after `apply_class_slots` in `update_class` leaves every test green. Fix: one `update_class` call moving the start date later (earlier unbooked sessions gone) and one moving it earlier. (verification-gap)
- [x] [Review][Patch] (low) Race script cases 2 and 3 were never shown capable of failing [scripts/class-slot-race.sh:170-215] — `CLASS_SLOT_RACE_BROKEN=1` swaps in a broken regeneration for case 1 only and skips cases 2 and 3; the triage log's "fails without the lock" for case 2 has no recorded run, and nothing covers the new `for key share of c` of case 3. Fix: remove the cap trigger's class lock and the materializer's `for key share of c` once each against the local DB, run the script, record that each fails, restore (stage edits first). (verification-gap; Epic 22 retro 77)
- [x] [Review][Patch] (low) The deferred-work entry "A migrated class whose `recurrence_time` has seconds fails 0180" is stale [_bmad-output/implementation-artifacts/deferred-work.md:2179] — pass 1 added a pre-flight that refuses before any DDL and names the class ids; the entry still says the INSERT raises and asks for a manual query. Fix: reword to say the pre-flight covers it. (blind-hunter)
- [x] [Review][Patch] (low) Gate evidence for the committed tree is missing [scripts/ci-local.sh] — the last sprint-status entry says full `ci-local.sh` has not run on the committed tree, and no entry records `scripts/ci-local.selftest.sh`, which the spec requires because `ci-local.sh` is touched. Action, not a code change: run both (no edits while ci-local runs), read the per-stage lines, record the result in sprint-status. (blind-hunter + acceptance-auditor)
- [x] [Review][Defer] (low) The `$preflight$` refusals have no test [supabase/migrations/0180_class_schedule_slots.sql:56-78] — deferred: pgTAP databases have an empty `classes` table at migration time, so only a snapshot rehearsal exercises the block; it is already on the pre-deploy checklist (rehearse 0180 and its rollback against a snapshot with recurring classes). (verification-gap)

#### Rejected

- Recurring reschedule now succeeds silently over bookings, `update_class` and `materialize_class_sessions` discard the left-unchanged rows (blind-hunter, edge-case-hunter) — false: the acceptance criteria require this reversal and pass 1 rejected it for the same reason; 29.2's result view ships in the same Epic 29 merge.
- Spec file inconsistent: `status: 'done'` against sprint `review`, unchecked tasks, empty Implementation Notes, the time-zone-change Dev Notes statement missing (blind-hunter, acceptance-auditor) — rejected: the fix is to edit the spec under review. Recorded here so the owner sees it; the behaviour is proven by a test and a deferred-work entry.
- sprint-status `last_updated` entries disagree (73/64 vs 81/65 tests, "6 deferred (seven entries)") (blind-hunter) — low: append-only history, not a code defect.
- Trigger functions' EXECUTE grants not asserted (blind-hunter) — false: a trigger function cannot be called directly ("trigger functions can only be called as triggers"), so a stray grant exposes nothing.
- `$verify$` block thin on triggers and grants (blind-hunter) — low: the pgTAP suites assert the triggers by behaviour; more guards for a one-shot block.
- Rollback unguarded between check and drop, verify thin, never run against real data (blind-hunter, edge-case-hunter) — low: manual operator script; the rehearsal is already owed (pass 1 deferred it).
- Race script fragility: fixed `/tmp` paths, `29f0%02x` ids past about 99 iterations, run-date-dependent case 3 (blind-hunter) — low: test infrastructure, pass 1 rejected the same.
- Component test proves little, uses `as ClassRow` (blind-hunter, verification-gap) — low: the spec asks for exactly an unchanged-screen test; pass 1 rejected it.
- `create_class` / `update_class` with NULL or out-of-range days or seconds raise raw constraint errors (edge-case-hunter) — low: loud failure on input the app never sends (the form offers minutes and weekdays only); the fix adds validation branches that 29.2 owns.
- `apply_class_slots` has no gym-active guard when called directly (edge-case-hunter) — false: it is private, granted to `service_role` only, called by guarded public functions, and sits on the suspension exclusion list by the spec's own rule.
- `for key share of c` in the materializer makes slot edits wait for the daily job (edge-case-hunter, acceptance-auditor) — low: the job runs overnight and already took the same lock through the FK check for any class it inserted into; the lock is what race case 3 needs.
- Matching also requires the session date to be on or after the start date (acceptance-auditor) — false: no bad outcome; it is documented in the migration header, tested, and equals the old regenerate-everything behaviour.
- Verify block compares slot count to distinct days, not `cardinality(recurrence_days)` (acceptance-auditor) — false: stricter and safer with duplicate days, and the set-equality check backs it.
- Pre-flight runs before the share lock, so a class inserted between them can still fail raw (blind-hunter) — low: needs a recurring class with seconds created during the deploy window; the form cannot produce one.

## Implementation Notes

## Spec Change Log

## Review Triage Log

Pass 1 (blind / edge-case / verification-gap). Verdict, then route.

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| Snapshot/verify race on live traffic (blind, edge) | medium | patch | md5/count compared with no lock; a booking or the 02:00 job in the window rolls back a correct migration. Fix: share lock before the snapshot. |
| Seconds in legacy recurrence_time fails raw after DDL (blind, edge) | medium | patch | Prod is live; pre-flight at top naming class ids. |
| `24:00` passes the minute CHECK (edge) | low | patch | One-line CHECK bound, direct correction. |
| update_class type-change refusal over bookings untested (gap) | medium | patch | Removing either half of the `or` leaves every test green. |
| I/O matrix row "gym time zone changed" untested (blind, edge, gap) | medium | patch | Matrix audit: a row needs a covering test. |
| Direct UPDATE of legacy columns leaves slots stale (blind, edge) | low | defer | No app writer updates classes directly (grep); 29.2 stops writing the columns. |
| Slot edit after a zone change judges sessions in the new zone (edge, blind, claim) | low | defer | Daily job unchanged; follows from the design. Recorded. |
| Type-change/one-off delete without session locks (edge) | low | defer | Pre-existing since 0058; the FK has no cascade, so the failure is an error, not data loss. |
| Backfill INSERT proven only by $verify$; rollback unexercised (gap, blind) | low | defer | One-shot; rehearsal before prod recorded. Implementer proved the rollback guard and a clean rollback by hand. |
| DST equivalence window-limited (blind) | low | defer | current_date not injectable. |
| apply_class_slots has no payload validation (blind) | low | defer | Definer callers build the payload; 29.2 validates. |
| Recurring reschedule over bookings now succeeds silently (blind) | false | rejected | The acceptance criteria require exactly this reversal; Epic 29 merges to master as one unit, so 29.2's result view ships with it. |
| Cap trigger runs before tenancy trigger (edge) | false | rejected | Only definer functions and superuser fixtures can insert; no client path reaches it. |
| Race script fragility: fixed /tmp paths, loose greps, case 3 weak (blind, edge) | low | rejected | Test infrastructure; collisions need two concurrent runs; fix is more than a correction. |
| "Lock before count" test is source-text; in-place start_time edit allowed (blind) | false | rejected | Race script case 2 is the real proof (fails without the lock); the spec only forbids moving class or gym. |
| Component test proves little; Code Map path wrong (blind) | low | rejected | The spec asks for an unchanged-screen component test; the path is cosmetic. |
| Start date beyond window, cascade delete, booked-matching in race untested (blind) | low | rejected | Behaviour unchanged from 0057 or handled (`not found` branch); not matrix rows. |
| Verification evidence incomplete (blind) | low | rejected | Not a code defect; the checks are re-run on this side. |

## Design Notes

`apply_class_slots(p_class_id, p_slots jsonb)` is the only regeneration path. Order: lock class; replace the slot rows; lock future sessions in `scheduled_at` order; for each, re-check bookings under the lock, delete if unmatched and unbooked, otherwise leave; then call the materializer for the missing sessions. Matching is on the gym-local weekday and local time of `scheduled_at`. A session that matches a slot is kept whether or not it has bookings.

## Verification

**Commands:**
- `supabase test db` (via `scripts/pgtap-run.sh`) -- expected: all green, per-stage lines read, not only the final GREEN
- `bash scripts/class-slot-race.sh` -- expected: `race: all passed`
- `pnpm run check:migrations && pnpm run check:claims && pnpm run typecheck` -- expected: clean
- `scripts/ci-local.sh` -- expected: every stage PASS
