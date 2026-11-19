---
title: '28-3 Class attendance in a single-use gym and setting-change parity'
type: 'feature'
created: '2026-11-19'
status: 'done'
baseline_commit: 'e055ba7a084ac6b7efdeeab54845861c239c1fe4'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-28-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/epics.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Since 28.2 a class mark in a Single-use gym raises `class_single_use_unsupported` for a charged member, so no production gym may be switched to Single use. The owner also cannot see, in the member modal or the Guest sessions Paid tab, whether a session paid for a visit, a class or a day, and the setting-change, lapse, loyalty and totals rules are not yet proved end to end.

**Approach:** One migration `0179` lets the consume function serve `class` in a Single-use gym (covered by the open visit's own session, else a `class` session tied to the booking), adds the visit/class cover to the Paid-tab RPC, and the dashboard shows the three "Used" wordings. Proof is pgTAP, a class-vs-scan race case, vitest and the E2E spec. Acceptance criteria are Story 28.3 in `_bmad-output/planning-artifacts/epics.md` (lines 7034-7106); this spec adds the Code Map and the corrections found.

## Boundaries & Constraints

**Always:**
- Migration `0179_single_use_class_attendance.sql` (one transaction, verify block) and `scripts/rollback-0179-single-use-class-attendance.sql` (restores the 0178 consume, `mark_class_attendance`, the 0177 `audit_session_consumed` and the 0114 `list_guest_sessions_paid`; refuses while any `covered_kind = 'class'` row exists). Regenerate `packages/types/src/database.ts`.
- `private.consume_guest_session` gets a fifth parameter `p_booking_id uuid default null` (the epic text says four arguments; the immediate CHECK `guest_sessions_cover_matches_kind` needs `covered_booking_id` in the same UPDATE that sets `consumed_at`, so a caller cannot set it afterwards). `drop function` the 4-argument form first, `revoke ... from public, anon, authenticated`. `p_kind = 'class'` with a null booking raises. All other behaviour of the function is unchanged.
- Class order inside the function, in a Single-use gym: (1) the existing `whole_day` cover lookup (a consumed `whole_day` row of the receipt day covers the class, judged from the row's own mode); (2) a visit cover: an open `attendance_events` row, `checked_in_at + least(checkin_timeout_hours, platform visit limit) > receipt time`, that is the `covered_attendance_id` of a consumed, non-voided `single_use` `visit` session returns `covered` with that session's id, consuming nothing; (3) else consume the soonest-lapsing session (paid before free) with `validity_mode='single_use'`, `covered_kind='class'`, `covered_booking_id`, `covered_day` and `covered_attendance_id` null. Reuse the limit/window computation of `record_check_in` (0178 lines 246-258), do not invent a second one.
- A class mark never writes `attendance_events` and never closes a stale visit. The guard `class_single_use_unsupported` is removed. In a Whole day gym a class behaves exactly as today (`day` row that also covers the floor).
- `mark_class_attendance` keeps its signature, role gate, `{ code, message }` surface, `attended_at is null` re-mark guard, lock order (class_sessions, then member) and denial block; its only change is passing the booking id. `attended_at` is set in the same transaction as the consume.
- `audit_session_consumed` metadata gains `covered_booking_id` (one new key, the rest unchanged). The stamp is earned through the existing `on_session_consumed`; nothing there changes.
- `list_guest_sessions_paid` (drop and recreate, re-grant, update the 0114 signature checks that still apply) returns, per row, `covered_kind`, `covered_booking_id`, the class name and class start for a `class` row, and `consumed_at`; columns and ordering otherwise unchanged. Tenant-scoped as today.
- Dashboard: the member modal Sessions Used row and a new Paid-tab "Used" column read "covered day" (`day`/legacy null kind), "visit [date], [time]" and "class [name], [date]"; modal wording "Used · visit on [date], [time]" and "Used · class [name], [date]" (EN and FR; a `day` row keeps today's `covered` wording). Date and time are gym-local (the gym's timezone, never browser or UTC). Keys go under the real namespace `members.modal.sessions.{usedVisit,usedClass,coveredVisit,coveredClass}` and `guestSessions.columns.used` plus `guestSessions.used.{day,visit,class}` (the epic's `members.sessions.*` does not exist). The class name comes from an embed `class_bookings(class_sessions(starts_at, classes(name)))` in the existing select; read the staff SELECT policies of the three tables first and, if a staff role cannot read them, add the fields to an RPC instead. A null cover renders as used, never throws; the existing modal and `guestSessions` fixtures run unedited.
- Mobile: no copy change (A5). Only new vitest cases in `sessionState.cover.test.ts` proving `visit` and `class` rows are never "covered today".
- Existing guest-session suites run unedited. Allowed edits: the `class_single_use_unsupported` cases (`single_use_check_in.test.sql` 578-598, `single_use_check_in.negative.test.sql` 136-139), the `regprocedure`/`aclexplode` literals naming the 4-argument consume (`session_validity_cover.test.sql`, `single_use_check_in.negative.test.sql`), the callers source-scan, the `auditLabels.ts` metadata comment. Each is named in Implementation Notes.
- Gates reach consumers (retro 66): the callers source-scan still lists only `record_check_in` and `mark_class_attendance`; a test enumerates every `session_attempts.source` and `guest_sessions` reader of the Paid tab RPC.
- Race: `scripts/single-use-race.sh` gains a class-vs-scan case (one `visit` row and one `class` row when the class lands before the scan; one `visit` row and no `class` row when it lands inside the open visit; never two consumes for one need). Show it can fail (weaken a lock, rerun, retro 77). `ci.yml` already runs the script.
- Record in `docs/decisions.md`: the fifth-parameter deviation, the voided-visit consequence (a class already marked free inside a visit stays free if staff later voids that visit), the namespace correction, and the closing-gate trace table FR-236..FR-239, NFR-021, NFR-028 to named tests.

**Never:**
- No new attendance rows from class marking, no stale-visit close from a class mark, no edit to `check_in()`, `staff_check_in()`, `record_check_in`, `void_staff_check_in`, the auto-timeout job, occupancy, the 0177 CHECK or unique index, the setter, or `run_loyalty_sweep_job`. No member-app copy. No new `session_attempts.source` value. No PRD edit. No rewrite of any existing row.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Class inside covered visit | single_use, open visit younger than limit, its own consumed session | `covered`: no session, stamp or `guest_sessions` write; `attended_at` set; a second class the same visit also free | N/A |
| Class, no visit | no open visit, or open visit past the limit, or open visit with no single_use cover | One `class` session consumed with `covered_booking_id`, one stamp, `attended_at` set; no attendance row, stale visit not closed | N/A |
| Class then scan | `class` row consumed, member scans in the same day | Scan consumes a second session as `visit`; a second class with no open visit consumes a second `class` row | N/A |
| Re-mark | `attended_at` already set | Nothing consumed | N/A |
| Flip with a `whole_day` row today | single_use now, `day` row consumed this day | `day` row still covers the class | N/A |
| Whole day gym | class marked | Today's behaviour byte for byte | N/A |
| No usable session | single_use, none left | `attended_at` null, one `session_attempts` (`class`), one `session_required` alert, same error as today | Existing `{ code, message }` |
| Exempt | price 0 plan, or not Pay-per-session | Marked as before, nothing consumed | N/A |
| Two class marks or class vs scan | concurrent, one member | At most one consume per need (`unique (covered_booking_id)`, `unique (covered_attendance_id)`) | Second waits on the member lock |
| Setting flip | Whole day <-> Single use with a `day` row, an open `visit` row, a `class` row, no activity | Every `guest_sessions` row of the gym identical before and after; the open visit ends under its own rule | N/A |
| Lapse | flip, unused paid 7 days / free 60 days | Lapsed and audited the same under either setting; consumed rows never lapsed | N/A |
| Refund of a consumed class session | paid, stamped | Reverses exactly that stamp, counter floors at 0, free session never revoked | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0178_single_use_check_in.sql:39-142` -- `consume_guest_session` to replace (class guard 81-84, whole_day cover 89-105, session select 108-118, single_use UPDATE 125-131, `on_session_consumed` 140); `:246-258` and `:370-378` limit/window pattern to reuse; `:617-760` `mark_class_attendance` (consume call 720-721, denial 723-737, `attended_at` 746-748).
- `supabase/migrations/0177_session_validity.sql:93-95,140-157` -- unique index on `covered_booking_id` and the immediate cover CHECK (class row needs mode, kind, booking id, null day, null attendance id); `:104-132` normalise trigger (a void clears the booking id); `:297-323` `audit_session_consumed` to extend.
- `supabase/migrations/0114*.sql:121-231,365,388` -- `list_guest_sessions_paid` and its verify-block oid checks; `scripts/rollback-0178-single-use-check-in.sql` -- rollback pattern and refusal guard.
- `supabase/tests/single_use_check_in.test.sql` (class block 578-598, fixtures 282c01 gym 1 / 282c02 gym 2, `pg_temp.mark` helper :190), `single_use_check_in.negative.test.sql:125-139`, `session_validity_cover.test.sql`, `loyalty_guest_rule.test.sql`, `guest_sessions_overview.test.sql`, `session_refund.test.sql`, `class_session_gate.test.sql:119-126` (pins the `mark_class_attendance` signature) -- patterns and regression suites.
- `scripts/single-use-race.sh` -- add a case after case 3; `$T/$G/$OWNER_U/$PLAN`, `mk_member`, `mk_session`, `scan_sql`, `hold_lock`; class fixture needs a class, class_session, booking and a manager JWT.
- `apps/dashboard/services/guestSessions.ts:17-35,88,120-135,178-215` -- `MemberGuestSession` already has the cover fields; add the booking embed and map class name/start; `listPaidGuestSessions` mapper for the RPC change. `apps/dashboard/lib/guest-sessions.ts:37-52` `PaidGuestSessionRow`.
- `apps/dashboard/app/(dashboard)/members/components/MemberModal.tsx:189-290` (`SessionsSection`, Used rows 255-268); `guest-sessions/components/GuestSessionsPageClient.tsx:196-230` (Paid columns); `apps/dashboard/locales/{en,fr}.json` (`members.modal.sessions` ~1140, `guestSessions` ~2138-2200); `scripts/check-i18n-key-parity.mjs`.
- `apps/dashboard/app/(dashboard)/audit/auditLabels.ts:120-124` -- comment only. `apps/mobile/src/lib/sessionState.ts` -- read only.
- Vitest: `MemberModal.sessions.test.tsx` (mocked `t` returns `key|vars`; add cases beside the existing ones), `guestSessions.cover.test.ts`, `GuestSessionsPageClient.test.tsx`, `sessionState.cover.test.ts`.
- E2E: `apps/dashboard/e2e/desk-fixes.spec.ts` (serial model), `helpers/{auth,fixtures,env,landingGate}.ts` (`createPageGym` makes gym, owner, member, plan only; the spec adds members, class, session and bookings itself and tears down), `settings/SessionValiditySection.tsx` (no test id; select by role and label).

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0179_single_use_class_attendance.sql` -- consume (5-arg, class branch), `mark_class_attendance` pass-through, `audit_session_consumed` key, `list_guest_sessions_paid` columns, grants, verify block -- one transaction
- [x] `scripts/rollback-0179-single-use-class-attendance.sql` -- restore 0178/0177/0114 bodies with the class-row refusal
- [x] `packages/types/src/database.ts` -- regenerate for the RPC change
- [x] `supabase/tests/single_use_class_attendance.test.sql` and `.negative.test.sql` -- every matrix row, tenant isolation, callers source-scan, the four flip combinations with a before/after row snapshot, lapse windows per setting, three-stamp loyalty day, totals identical across Whole day vs Single use, `session_consumed` metadata, refund of a class session
- [x] `supabase/tests/single_use_check_in*.test.sql`, `session_validity_cover.test.sql` -- replace the guard cases and 4-arg literals only
- [x] `scripts/single-use-race.sh` -- class-vs-scan case, shown failing under a weakened lock
- [x] `apps/dashboard` services, `MemberModal.tsx`, `GuestSessionsPageClient.tsx`, `lib/guest-sessions.ts`, `locales/{en,fr}.json`, `auditLabels.ts` comment -- Used wording, gym-local time, EN and FR, component tests for the three row kinds in both locales
- [x] `apps/mobile/src/lib/sessionState.cover.test.ts` -- visit and class rows never "covered today"
- [x] `apps/dashboard/e2e/single-use-validity.spec.ts` -- the PRD 10.3 sequence in the epics AC, own gym torn down afterwards
- [x] `docs/decisions.md`, `sprint-status.yaml` -- decisions, trace table, last_updated entry; then full `scripts/ci-local.sh`

**Acceptance Criteria:**
- Given the Story 28.3 criteria in `epics.md`, when verified, then each has a named passing test, the FR-236..FR-239, NFR-021 and NFR-028 trace table is in `docs/decisions.md`, and every existing guest-session suite passes with only the edits listed above.
- Given a Whole day gym, when a class is marked, then nothing differs from today and no `visit` or `class` row is written.

## Implementation Notes

- Implemented by a dispatched subagent; verified against the diff since baseline (3,483 lines, 24 files outside `_bmad-output`). Migration 0179 applied to the local DB only (NOT production); rollback round trip rehearsed.
- Deviations, named: `p_booking_id` is required only in a Single-use gym past the exempt returns; class cover is judged from the open visit's own single_use session in either gym mode (a class inside an open Single-use visit stays free after a flip to Whole day); `covered_booking_id` is added to `session_consumed` metadata for class rows only (`session_validity_cover.test.sql` pins the shape of other rows); the class start column is `class_sessions.scheduled_at`; the Paid-tab RPC also returns `gym_timezone`; `database.ts` was hand-edited (the generator output carries unrelated noise); the Paid-tab group header colSpan stays 6 with an empty seventh cell so the existing test is not edited.
- Existing tests edited beyond the spec list: `attendance_counting.test.sql` (consume now reads `attendance_events`, joined the committed reader list, filters `voided_at is null`) and `members.writers.scan.test.ts` (allowlist entry for the e2e spec member inserts).
- Gate state after implementation: static, deno, layout PASS; pgtap failed only in the unrelated timing flake `support-assignments-race.test.sh` (205 pgTAP files and the single-use race pass); unit failed once in `members.writers.scan.test.ts` (fixed, not re-run in full); e2e stage not run by ci-local (`next build` security-advisory nudge; the new spec ran 7/7 against a manual build). Full `scripts/ci-local.sh` with a merge stamp is owed after review.
- Review (bmad-build step 4, three layers: blind, edge-case, verification-gap): 19 findings triaged in the Review Triage Log, 3 patches (the predicate-pinning pgTAP case 146 -> 150, mutation-checked; a real PostgREST round trip of the member-modal select in the e2e spec, 8 specs; `guestSessions.used.none`), 0 deferred, 16 rejected. Final gate on the patched tree (uncommitted, so no merge stamp): deno, static, unit, layout PASS; pgtap PASS (205/205 files, race scripts all passed) and e2e PASS after two environment resets: `private.platform_flags.super_admin_aal2` had been left on by an interrupted `support-assignments-race` run (reset to false), and one pgtap run lost every result to a docker cp verification failure (rerun passed). A stamped full `scripts/ci-local.sh` on the committed tree is still owed before epic/28 goes to master.

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Evidence / route |
|---|-------|---------|---------|------------------|
| 1 | gap | The class-in-visit cover predicates `validity_mode='single_use'` and `covered_kind='visit'` are pinned by no test: no case marks a class inside an open visit linked to a `day` row whose `covered_day` is not today | medium | Read in the tests: every open-visit cover is `visit` or `none`; deleting the two predicates makes a past-midnight Whole day class free (a gym that never ran Single use) and no test fails. patch: add one case in each gym mode |
| 2 | gap | The member-modal select (`class_bookings(class_sessions(scheduled_at, classes(name))), gyms(timezone)`) is proved only by a mock that matches the select string; an RLS denial or ambiguous relationship would fail the whole Sessions list unseen | medium | The e2e spec only loads the Paid tab RPC. patch: one real PostgREST round trip of the same select as the Owner in the e2e spec |
| 3 | gap, blind | `usedLabel` borrows `guestSessions.refund.none` as the Paid tab "nothing used" text | low | Renaming the refund key would change the Used column; fix is one new key in EN and FR and a one-word change (direct correction). patch |
| 4 | edge | Whole day gym, open visit covered by a `single_use` session after a flip back: a class mark is free, against "nothing differs from today" | false | The spec's Design Note and the epic AC ("an open visit finishes under the rule it began with", assumption A3) require it; named in Implementation Notes and `decisions.md`; a gym that never ran Single use has no such session (finding 1's case pins it) |
| 5 | edge | Single-use gym, a visit opened under a `whole_day` row before midnight, class after midnight is charged | false | Assumption A3: a class inside an open visit is covered only by that visit's own single_use session; a day row of yesterday covers nothing today, as a scan after midnight also consumes |
| 6 | blind, edge | A class row whose class name embed is null renders "class , date" / "Used · class , date" (pinned by a test) | low | A class booking referenced by a `class` row cannot be deleted (FK without cascade) and staff can read the three tables (finding 2's round trip proves it); reaching null needs an RLS denial, and the fix adds a branch and new copy. Rejected |
| 7 | edge | The fallback date formatter can throw on an unparsable ISO string | low | The value comes from a timestamptz column; no path produces an unparsable string. Rejected |
| 8 | blind | `consume_guest_session` ignores `p_booking_id` for a visit or a Whole day class, and does not check the booking belongs to the member | low | Private function with two callers pinned by the source scan; `mark_class_attendance` derives member and gym from the booking itself. Defence in depth, no named harm. Rejected |
| 9 | blind | A covered class (free inside a visit) leaves no audit row or record | false | The AC says no `guest_sessions` write for a covered class; the attendance itself is `class_bookings.attended_at`. Rejected |
| 10 | blind | Member modal mixes gym-local (visit, class) and browser-local (day row, `usedOn`) dates | low | The day wording is explicitly unchanged by the AC and was browser-local before this story; pre-existing. Rejected |
| 11 | blind | The cover detail is only a `title` tooltip | low | The epic's labels `coveredVisit`/`coveredClass` are the tooltip; the visible text carries the wording. Rejected |
| 12 | blind | The Paid tab day row shows "covered day" with no date | false | UX AD-22 V1.8 reads exactly "covered day" for a day row |
| 13 | blind | Group header `colSpan` 6 plus an empty seventh cell | low | Avoids editing an existing pinned test the spec says to leave unedited; cosmetic. Rejected |
| 14 | blind | `listPaidGuestSessions` does not narrow `covered_kind` as the member mapper does | low | The cover CHECK from 0177 limits the column to three values; the fallback renders "covered day". Rejected |
| 15 | blind, edge, gap | Rollback script: no lock between the class-row check and the drops, copies of bodies not tested, `database.ts` revert not mentioned | low | Manual ops script; 28-1 and 28-2 triage rejected the same (no repo convention of testing rollbacks, the fix adds locks and a harness) |
| 16 | blind, edge | Race case 4 orders arrivals by `sleep` | low | Same shape as `check-in-member-lock-race.sh`; the lock mutation was shown failing both scan-first iterations (28-2 triage 7). Rejected |
| 17 | blind | E2E crosses midnight, drives the class path through RPCs only, no French run | low | The epic AC specifies APIRequestContext against the real RPCs; midnight exposure equals the sibling specs. Rejected |
| 18 | blind | Short date style is ambiguous and the English time assertion depends on ICU | low | `\s` matches the narrow no-break space ICU emits; format follows the locale, as the rest of the dashboard. Rejected |
| 19 | blind | Per-row timezone subquery in the Paid RPC; one long comment line in `auditLabels.ts`; spec and sprint-status absent from the diff | false | The subquery is a single value per call (no cost named); the comment is cosmetic; `_bmad-output` is excluded from the diff by design |

## Design Notes

The booking id is a consume argument because a `class` row has no later "link" step like a visit's `covered_attendance_id` (that one is checked by a deferred trigger, the booking id by an immediate CHECK). Cover is read from the open visit's own session, never from the gym's current setting, so a flip mid-visit changes nothing. Free-inside-a-visit is decided at mark time and is not revisited if staff later void the visit (recorded, not fixed).

## Verification

**Commands:**
- `bash scripts/pgtap-run.sh` and `bash scripts/single-use-race.sh` -- expected: all pass; race verdict `race: all passed`
- `pnpm run check:i18n` and the dashboard and mobile vitest suites named in the Code Map -- expected: pass
- `bash scripts/ci-local.sh` -- expected: every stage PASS, read per-stage lines; `bash scripts/ci-local.selftest.sh` if `ci-local.sh` is touched
