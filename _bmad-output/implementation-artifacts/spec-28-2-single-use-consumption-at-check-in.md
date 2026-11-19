---
title: '28-2 Single-use consumption at check-in'
type: 'feature'
created: '2026-11-19'
status: 'done'
baseline_commit: '94a00ee89e4977c8340efa0d80e97e86d9470a88'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-28-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/epics.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 28.1 gave a gym the Session validity setting and the session record's cover columns, but nothing consumes in Single use yet. A guest at a Single-use gym must need a session per visit, a second scan during a visit must cost nothing, and a forgotten check-out must never let the member back in free.

**Approach:** One migration changes `private.consume_guest_session` (new `p_kind`), `private.record_check_in` (visit limit, single-use consume, cover link), `public.void_staff_check_in` (later-visit guard only for `day` cover) and `public.mark_class_attendance` (passes `'class'`). Whole-day and charging-off behaviour stays byte-for-byte. Acceptance criteria are Story 28.2 in `_bmad-output/planning-artifacts/epics.md` (lines 6954-7030); this spec adds the Code Map and the corrections found. No dashboard or mobile change (the visit/class "Used" copy is Story 28.3).

## Boundaries & Constraints

**Always:**
- Migration `0178_single_use_check_in.sql`, rollback `scripts/rollback-0178-single-use-check-in.sql` (restores the 0177/0175/0124 bodies; refuses while any `single_use` row or gym exists).
- `consume_guest_session`: `drop function` the 3-arg form first (a default argument beside it makes 3-arg calls ambiguous), create `(p_member_id, p_gym_id, p_receipt_at, p_kind text default 'visit')`, same return columns, `revoke ... from public, anon, authenticated`. Existing 3-arg callers and tests keep working through the default.
- Coverage is judged from the row's own `validity_mode`, never the gym's current setting. A consumed non-voided `whole_day` row with `covered_day` = receipt day returns `covered` first, in either gym mode. Else in a `single_use` gym a `visit` row is consumed (`validity_mode='single_use'`, `covered_kind='visit'`, `covered_day` null); in a `whole_day` gym a `day` row exactly as today. `p_kind = 'class'` in a `single_use` gym raises `class_single_use_unsupported`; in a `whole_day` gym it behaves as today. Any other kind raises.
- `record_check_in` keeps its order: member lock first, replay short-circuit, status gate, open-visit handling, consume, insert, then `covered_attendance_id` (already set for every `consumed` outcome). Receipt time is `now()`.
- Stale test for an open row: when it is the `covered_attendance_id` of a consumed, non-voided `single_use` `visit` session (assumption A2), effective window is `least(checkin_timeout_hours, platform limit)`; otherwise timeout alone, exactly as today. Close at `checked_in_at + window`, `checkout_type='auto'`; the audit row gains `reason: 'visit_limit'` and `visit_limit_minutes` only when the limit is the binding window (limit <= timeout). Non-limit closes keep today's metadata unchanged. The stale close commits with a denial.
- The offline immediate-stale close uses the same `least(...)` when the session just consumed is a `single_use` visit; the honoured-scan-time rule (timeout window, not before the session existed) is unchanged.
- `void_staff_check_in`: `later_visit_relies` applies only when the bound session's `validity_mode = 'whole_day'`. A `single_use` visit is voidable with a later same-day visit; the release, stamp reversal and the rest are unchanged.
- Denial contract unchanged: `check_in()` still returns null; reason is read from the attempt row. Occupancy and the auto-timeout job are not edited (the limit closes a visit only at a later scan).
- Callers of the consume function are only `private.record_check_in` and `public.mark_class_attendance` (source-scan pgTAP test that fails on any other `prosrc` calling it; this is the gate's consumer list, Epic 22 retro 66).
- Copy function bodies from the latest definitions (0175 `record_check_in` and `void_staff_check_in`, 0124 `mark_class_attendance`, 0177 `consume_guest_session`) and change only what is listed; keep every guard so `support_capabilities.test.sql` and `suspension_rpc_coverage.test.sql` classifications hold. `create or replace` keeps grants; assert them in the migration's verify block.
- Guest-session pgTAP suites run unchanged. The only existing test edits allowed: `session_validity_cover.test.sql` (its `regprocedure` literal is the 3-arg signature) and any test asserting `void_staff_check_in`'s later-visit refusal for a non-`day` row, each named in Implementation Notes.
- `scripts/single-use-race.sh` (shape of `scripts/check-in-member-lock-race.sh`) wired into `scripts/ci-local.sh`; run the full `scripts/ci-local.sh` before merge; show the new gate can fail (mutate and rerun, retro 77).

**Decisions (owner, 2026-11-19):**
- Spec stays whole (one spec, about 3,000 tokens, accepted).
- Platform visit limit (28-1 deferral, Epic 22 retro 67): no Super Admin UI or RPC. `single_use_visit_limit_minutes` stays changeable only by a Super Admin running SQL (28.1's trigger audits it). This story records that decision and the SQL runbook step in `docs/decisions.md`, and a pgTAP case proves a direct change is audited and read by the next scan (covered by the 89/90/91 boundary case).

**Never:**
- No class single-use consumption, class cover, or removal of the `class_single_use_unsupported` guard (Story 28.3). No dashboard or mobile change. No edit to `check_in()`, `staff_check_in()`, the auto-timeout job, occupancy functions, `audit_session_consumed`, or any 28.1 object. No PRD edit. No rewrite of any existing row.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Morning visit | single_use, one usable session, no open visit | Visit row consumed, attendance inserted, `covered_attendance_id` set, one stamp, one `session_consumed` audit | N/A |
| Evening visit | checked out, second usable session, same day | Second visit row, second stamp, two `attendance_counted`, one `member_visit_days` | N/A |
| Double scan | open visit younger than limit | `already_open` ("You're already checked in"), before consume | No session, stamp, attempt or alert |
| Boundary | open visit 179 / 180 / 181 min old (and 89 / 90 / 91 with platform 90) | 179 rejected; 180, 181 close at `checked_in_at + limit` as `auto`, audited `visit_limit`, new session consumed | N/A |
| Timeout shorter than limit | gym timeout < limit | Closed at `checked_in_at + timeout`, no `visit_limit` reason | N/A |
| Uncovered open visit | open visit with no single_use cover | Timeout alone governs | N/A |
| Stale, no session | open visit past limit, no usable session | Stale close commits, scan returns null, one attempt, one `session_required` alert | No attendance row |
| Offline replay / late | same `client_scan_id`; scan older than limit at receipt | Stored row returned, nothing consumed; late scan consumes one, closed at scan time + limit | Denied offline sync: attempt keyed by scan id |
| Staff path | `staff_check_in` / `void_staff_check_in` | Same rules; attempt `source='staff'`, no alert; void releases exactly the bound session even with a later same-day visit | N/A |
| Flip Whole day → Single use mid-day | earlier `day` row today | `day` row still covers; next day consumes a visit | N/A |
| Flip Single use → Whole day, open visit | scan after limit | Stale close at `+limit`, new `day` session, then covers the day | N/A |
| Exempt | charging off, non-PPS plan, price 0 | `exempt`, nothing touched, no limit | N/A |
| Class in single_use gym | `p_kind='class'` | Raises `class_single_use_unsupported` (pinned by one case 28.3 replaces) | Raises |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0177_session_validity.sql:207-292` -- current `consume_guest_session` to extend (day row uses `validity_mode='whole_day', covered_kind='day'`); `:104-135` normalise trigger (clears all cover columns on release, so void needs no clear edit); `:139-158` cover CHECK (a `visit` row has `covered_day` null; `covered_attendance_id` set after insert); `:171-201` deferred trigger (the id must be set by commit).
- `supabase/migrations/0175_staff_check_in.sql:151-346` -- `record_check_in` body to copy; stale branch `:236-263`, gate `:267-277`, honoured-time `:285-295`, link `:311-315`, offline immediate-stale `:318-338`. `:726-896` `void_staff_check_in` (later-visit guard `:826-846`, session lookup `:820-824`, release `:873-875`).
- `supabase/migrations/0124_live_authorization_database.sql:1841-1965` -- `mark_class_attendance`; its consume call is at 1943 (the only edit: pass `'class'`).
- `supabase/migrations/0174_record_check_in.sql` -- `check_in()` caller; outcomes `already_open`, `blocked_session` map unchanged.
- `supabase/tests/record_check_in.test.sql:206-221` and `suspension_rpc_coverage.test.sql:394-420` -- source-order assertions the new body must still satisfy. `session_validity_cover.test.sql:404-440` -- 3-arg `regprocedure` literal to update.
- `supabase/tests/check_in_session_gate.test.sql`, `void_staff_check_in.test.sql`, `session_refund.test.sql` -- unchanged regression suites and fixture patterns for the new `single_use_check_in.test.sql` / `.negative.test.sql`.
- `scripts/check-in-member-lock-race.sh`, `scripts/session-refund-race.sh` -- two-session race shape for `scripts/single-use-race.sh`; `scripts/ci-local.sh:116-133` pgtap stage wiring.
- `scripts/rollback-0177-session-validity.sql` -- rollback pattern. `docs/decisions.md:38` -- Epic 27 entry to extend with the 28.2 entry (NFR-021 contradiction, AD-30 key consequence, platform-limit decision).

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0178_single_use_check_in.sql` -- consume function, `record_check_in`, `void_staff_check_in`, `mark_class_attendance`, grants, verify block -- one transaction
- [x] `scripts/rollback-0178-single-use-check-in.sql` -- restore prior bodies with the refusal guard
- [x] `supabase/tests/single_use_check_in.test.sql` and `.negative.test.sql` -- every matrix row plus: concurrent-equivalent backstops, tenant isolation, exempt plan, non-PPS member, callers source-scan, return type of `check_in()` unchanged, occupancy and auto-timeout unchanged at limit + 1 minute, `engagement counts`
- [x] `supabase/tests/session_validity_cover.test.sql` -- update the 3-arg signature literal only
- [x] `scripts/single-use-race.sh` and `scripts/ci-local.sh` -- two concurrent scans (one visit, one session, one stamp) and refund-vs-scan; wire into the pgtap stage
- [x] `docs/decisions.md` -- 28.2 entry: NFR-021 contradiction, AD-30 key consequence, platform-limit decision and SQL runbook step

**Acceptance Criteria:**
- Given the Story 28.2 criteria in `epics.md`, when verified, then each has a named passing test and the regression suites named in Epic 28's cross-story list pass with no fixture edits beyond those listed.
- Given a `whole_day` gym or charging off, when a member checks in, out and in again, then one consumed `day` row exists, the second scan is `covered`, and no `visit` row is ever written.

### Review Findings

Second review pass 2026-11-19 (bmad-code-review, four layers: blind-hunter, edge-case-hunter, verification-gap, acceptance-auditor; diff `94a00ee..7091392` without `_bmad-output`). The first pass is the Review Triage Log below; findings it already rejected were re-judged and rejected again.

- [x] [Review][Patch] (resolved from Decision: owner chose option 2, fix now) An offline scan whose honoured time falls inside a closed auto-closed single_use visit of the same member must consume nothing (treated as covered by that visit). Needs a `record_check_in` change in 0178, a rollback-body check, and a pgTAP case (two offline scans inside one lapsed visit: one session consumed). Original finding: two offline scans inside one Single-use visit, synced after the visit limit has lapsed, consume two sessions — medium. Scan A (p_at = now - 200 min) consumes a session and is closed on arrival at A + 180 min. Scan B (p_at = now - 199 min) then finds no open row and consumes a second session, also closed on arrival. In a Whole-day gym B would be `covered`. The 28.2 offline AC says each such scan "consumes one session", so the code follows the AC; the AC never says what a second scan inside an already-closed visit window does. The mobile queue (`apps/mobile/src/services/checkin.ts`) keeps every offline scan and does not dedupe, so a member who scans twice while offline for more than 3 hours is charged twice. Options: (a) accept and record the behaviour in `docs/decisions.md`; (b) in `record_check_in`, treat an offline scan whose honoured time falls inside a closed single_use visit of the same member (checked_in_at <= p_at < checked_out_at, `checkout_type = 'auto'`) as `covered`, consuming nothing, with a pgTAP case; (c) defer to Story 28.3. [supabase/migrations/0178_single_use_check_in.sql:339-377] (blind-hunter)
- [x] [Review][Patch] `single-use-race.sh` is wired into `scripts/ci-local.sh` only, not into `.github/workflows/ci.yml`, which runs every sibling race script as its own step (`session-refund-race`, `check-in-member-lock-race`, `correct-plan-race`, `support-assignments-race.test.sh`). The epic-end GitHub Actions run, the final gate, would skip the only real two-session proof for the single-use consume. Add a step after "Correct-plan race" with `DB_CONTAINER=supabase_db_gym_os bash scripts/single-use-race.sh`. Medium; rule 1 (a gate must reach its consumers). [.github/workflows/ci.yml:136-138] (blind-hunter + acceptance-auditor)

**Rejected** (one line each):
- `false` Edge: an offline scan 200 min late is charged for a visit already closed on arrival. The member did make that visit; the AC says it "consumes one session and is recorded closed at scan time + limit", and `off_late` pins it.
- `false` Edge: no `platform_session_config` row switches the limit off. Seeded singleton (unique index on `(true)`), column NOT NULL with a 1..1440 CHECK; first-pass row 4.
- `low` Edge: class guard raises before the whole_day `covered` lookup for a charged member after a mid-day flip. Interim state until 28.3 removes the guard; first-pass row 9.
- `false` Edge: every class mark for a charged member in a Single-use gym raises. This is the specified interim; `class_single_use_unsupported` is in 28.3's acceptance criteria.
- `low` Edge, blind, gap: rollback script takes no lock between its refusal check and the function swap, has no verify block, and has no automated test. Manual ops script; the repo does not test rollbacks (first-pass row 2); the fix adds locks and a harness.
- `false` Edge claim: the close is at `least(timeout, limit)`, not always `checked_in_at + limit`. That is the spec ("the earlier of the two"); the commit message is shorthand.
- `low` Blind: `record_check_in` relies on the default `p_kind = 'visit'`. The callers source scan pins the two callers, so a new caller fails the scan.
- `low` Blind: the verify block matches function source by substring. Behaviour is covered by the pgTAP suites; first-pass row 10.
- `low` Blind: the visit-limit resolution is written twice in `record_check_in`. Developer-only duplication, no named harm; first-pass row 13.
- `low` Blind: `decisions.md` says "unedited" and lists one edit, and keeps the runbook step inside the entry. The runbook placement is the owner's recorded decision; the wording slip is cosmetic.
- `false` Blind: a Single-use visit stays in occupancy until the next scan or the timeout. The accepted design (the limit closes a visit only at a later scan); a forgotten check-out was already counted until the timeout; fix edits the spec.
- `low` Blind, gap: the race script is timing-based, uses fixed `/tmp` paths, and does not race a staff void against a scan. Same shape as `check-in-member-lock-race.sh`; first-pass row 7.
- `false` Blind: `reason: visit_limit` is written when the limit equals the timeout. Specified (`<=`) and pinned by the `eq180` case and the first-pass patch.
- `false` Blind, gap: mobile `sessionState.ts` keys on `covered_day`. 28.1's AC already makes a null `coveredDay` render as used and not "covered today"; 28.3 owns the copy.
- `low` Blind: `consumed(m(10)) = 0` is vacuous (member 10 has no session). The real isolation check is the `member_not_found` assertion before it; first-pass row 6.
- `low` Auditor: the "gate can fail" evidence is one sentence in `decisions.md`. The weakened lock and the disabled limit were run and are recorded; the extra mutations are not worth a harness.
- `false` Auditor: no test enumerates the `record_check_in` callers. The limit sits inside `record_check_in`, so every caller (`check_in`, `staff_check_in`, offline sync) gets it by construction.
- `false` Auditor: no offline case for a scan older than the timeout or before the session existed. That branch is shared with Whole-day and covered by cases G and K in `check_in_session_gate.test.sql`.
- `low` Auditor: `member_occupancy_band()` is not asserted. It agrees with `gym_occupancy_band`, which is.
- `low` Auditor: the `position('''class''' ...)` assertion can never fail. Pinned by behavioural cases; first-pass row 3.
- `low` Auditor: the next-day flip case calls `consume_guest_session` directly, not through `check_in`. The same-day flip cases go through `check_in()`.
- `false` Auditor: the NFR-021 PRD amendment has no owning story. Recorded in `decisions.md` as the epic context requires; first-pass row 11.
- `false` Auditor: the class guard sits after the exempt returns, unlike the frozen matrix. The fix edits the spec; named in Implementation Notes and `decisions.md`; first-pass row 8.
- `low` Gap: a re-consumed released session earns no second stamp, untested for Single-use. No mode-dependent logic touches the stamp key; the Whole-day test pins it.

## Implementation Notes

- Migration `0178_single_use_check_in.sql` (one transaction, verify block asserts grants, shapes and the callers scan) and `scripts/rollback-0178-single-use-check-in.sql` (restores the 0177 consume body, the 0175 `record_check_in` and `void_staff_check_in`, the 0124 `mark_class_attendance`; rehearsed in a rolled-back transaction after the migration). Applied to the local database only; NOT on production.
- Deviation, named: the `class_single_use_unsupported` raise sits after the exempt returns in `consume_guest_session` (an exempt member consumes nothing, and class marking for a monthly member of a charging Single-use gym must not fail). Recorded in `docs/decisions.md`.
- The migration restates `revoke execute ... from public, anon` for `void_staff_check_in` and `mark_class_attendance` because `scripts/check-migration-guardrails.mjs` requires it in any file that defines a public function; the grants are otherwise unchanged by `create or replace`.
- Existing test edits (only): `session_validity_cover.test.sql` (the `regprocedure` literal is the 4-argument signature). No test asserted `void_staff_check_in`'s later-visit refusal for a non-`day` row, so none changed.
- New: `supabase/tests/single_use_check_in.test.sql` (157) and `single_use_check_in.negative.test.sql` (49); `scripts/single-use-race.sh` wired into the pgtap stage of `scripts/ci-local.sh`. The offline immediate-stale audit row also carries `reason` / `visit_limit_minutes` when the limit binds (the spec names the audit addition for the open-row close; the same rule is applied to the offline close for consistency).
- `packages/types/src/database.ts` needs no change: the consume function is in the private schema and no public signature changed.
- Review patch (28-2 review, triage row 1): a limit-equals-timeout case (SU Gym 8, 3 h timeout, 181-minute covered visit) added to `single_use_check_in.test.sql` (157 to 163); mutating `<=` to `<` in `record_check_in` fails the reason and visit_limit_minutes assertions.
- Review patch (second pass, owner chose option 2): `record_check_in` treats an offline scan inside a closed auto single_use visit of the same member as covered (consumes nothing, closed at that visit's close time, audit reason `inside_closed_visit`); `single_use_check_in.test.sql` 163 to 170 (the `off_dbl` case; with the lookup disabled 3 assertions fail, shown, then restored); `ci.yml` gains the `single-use-race.sh` step; decisions.md entry added. The new body was applied to the local DB by running the function statement only; the full migration re-run and a full `ci-local.sh` are owed (the gate stamp for 7091392 is stale).

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Evidence / route |
|---|-------|---------|---------|------------------|
| 1 | gap | No case where gym timeout equals the platform limit; `<=` to `<` in the binding-window test passes every test and drops `reason: visit_limit` | medium | All fixture gyms have 8 h or 2 h timeouts, so only limit<timeout and timeout<limit are exercised. patch: add a 3 h gym case at 181 minutes |
| 2 | gap | Rollback script covered only by a rehearsal, no automated check | low | No repo convention of testing rollback scripts (28-1 triage 9 rejected the same); fix adds a harness. Rejected |
| 3 | gap | "mark_class_attendance passes the class kind" assertion can never fail (string appears elsewhere) | low | The pass-through is pinned by the behavioural cases (single_use raises, whole_day attends) and a regex assertion; the weak assertion removes no protection. Rejected |
| 4 | blind | Missing or NULL platform config row switches the limit off | false | `platform_session_config` is a seeded singleton, never deleted (28-1 triage 14); the column is NOT NULL with a 1..1440 CHECK |
| 5 | blind | NULL or legacy `validity_mode` on a consumed row fails open in consume and void | false | 0177 backfilled every consumed row to `whole_day`/`day`, its normalise trigger fills legacy writers, and the cover CHECK rejects a consumed row with no mode |
| 6 | blind | Isolation assertion on member 10 is vacuous (no session) | low | The real check is the preceding `member_not_found` assertion (line 245) and the gym 1 member count at line 276; the vacuous line adds nothing but removes nothing. Rejected |
| 7 | blind | Race script uses fixed sleeps and does not prove both scans were queued | low | Same shape as `check-in-member-lock-race.sh`; the real interleaving is proved by the lock mutation (weakened lock made it report FAILED). Fix adds polling complexity. Rejected |
| 8 | blind | Frozen matrix says class raises unqualified; code raises after the exempt returns | false | Fix is to edit the spec; rejected by rule. Deviation is correct (an exempt member consumes nothing) and named in Implementation Notes and decisions.md |
| 9 | blind, edge | Class guard raises for a charged member already covered by a whole_day row after a flip, while check-in returns `covered` | low | Interim state: the epic text says all three stories reach master together and 28.3 removes the guard (28-1 triage 4). Rejected |
| 10 | blind | Copied function bodies are not diffed against predecessors; verify-block and test scans differ (comments, dynamic SQL, PUBLIC grantee) | low | Developer-only, no named harm; the migration applied and 201 files pass; the 0175 void and record diffs were read in this review and match the spec. Rejected |
| 11 | blind | New audit metadata has no dashboard label; NFR-021 PRD amendment untracked | false | No dashboard code references the action today (grep), the spec forbids dashboard changes, and decisions.md records the PRD sentence as the epic context requires |
| 12 | blind | Spec Code Map cites line numbers that will rot | false | Fix edits the spec; rejected by rule |
| 13 | blind | Offline close re-queries the session mode | low | Developer-only duplication, no named harm. Rejected |
| 14 | edge | Offline scan with honoured time earlier than the stale close time overlaps the closed visit | false | Receipt-time judging and the honoured-time rule are the story AC and unchanged from the shipped timeout path; the open row is closed first so no index conflict |
| 15 | edge, claim | An open visit with a single_use cover is still limited after charging is switched off or the plan becomes exempt | false | A2: the limit applies to the open visit that is the cover of a consumed single_use session; the visit finishes under the rule it began with. The matrix exempt row concerns a visit that began exempt |
| 16 | edge | `gyms.session_validity` read without a row lock against a concurrent flip | false | The setting applies to check-ins made afterwards; either mode on a racing scan is a valid outcome and the row records its own mode |

## Design Notes

The limit is evaluated against `now()` (receipt time, A1). The cover lookup for an open row is by `covered_attendance_id`, which 0175 already sets for every consumed row, so a Whole-day-era open visit has a `day` cover and gets the timeout alone. Reading `session_validity` inside `consume_guest_session` is safe because `record_check_in` already holds the member lock.

## Verification

**Commands:**
- `bash scripts/pgtap-run.sh` (new and existing suites) and `bash scripts/single-use-race.sh` -- expected: all pass; the race verdict is the last line `race: all passed`
- `bash scripts/ci-local.sh` -- expected: every stage PASS (read per-stage lines, not only the final GREEN)
- `bash scripts/ci-local.selftest.sh` -- expected: pass after the ci-local.sh edit
- `pnpm run check:i18n` -- expected: unchanged and green (no new strings)
