---
title: '30-2 Engagement facts, the fold and settle'
type: 'feature'
created: '2026-11-22'
status: 'done'
baseline_commit: '01c1ae77df555596d8a155ad30ce40fbafdd70ca'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-30-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/epics.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 30 needs weeks, the weekly streak and the best streak worked out on the server from real visits, correct when a late offline visit arrives. No fact ledger, fold or settle exists. Production is live and `release_week_start` is NULL, so nothing may write a fact or become member-visible yet.

**Approach:** One migration adds `engagement_facts` (append-only, effective fact = highest revision), `engagement_state`, the private fold, settle, derived-state and rebuild functions, a trigger that freezes `release_week_start` once a week fact exists, and a real-session race script. The acceptance criteria of `epics.md` "Story 30.2" are the authority; this spec adds the code map, the decisions below and the edge cases. No screen, no RPC callable by a client, no cron job (30.3).

## Boundaries & Constraints

**Always:**
- One migration `0185_engagement_facts_fold_settle.sql` (0184 is the head, local only; the number is "next free at merge time") with `scripts/rollback-0185-*.sql`, `set local lock_timeout = '5s'` and a closing `do $verify$` block. Every new function: `revoke execute ... from public, anon, authenticated` in the same file (`check:migrations`); all live in `private`; none registered in `private.support_capabilities`.
- Both tables enable RLS with no policy and grant nothing (precedent `member_weekly_goals` in 0184). `settle_engagement` is SECURITY DEFINER with a pinned `search_path`; the fold, derived-state and rebuild functions are STABLE.
- Settle takes the member lock (`for no key update`) as its FIRST statement. Every count reads `member_visit_days`, never `attendance_events`. Week arithmetic is on `date` through `private.week_start_of`.
- GATES REACH THEIR CONSUMERS: a pgTAP scan enumerates every function in `pg_proc` that names `engagement_facts` or `engagement_state` and fails unless it is on a pinned list (settle, the append-only guard, the epoch guard; 30.7 adds one), and asserts none of them has `authenticated` or `anon` EXECUTE.
- Close the two 30.1 deferrals here: the epoch guard (`release_week_start` frozen once any `week` fact exists, in either direction and to NULL) and the frozen goal (a settled week keeps its goal when `goal_default` or the goal history changes). Each has a named pgTAP case.
- The race script's check-in session sets `engagement_state.dirty_from` itself in the same transaction as the real `private.record_check_in`, as a stand-in for the mark 30.3 adds to `record_check_in`. It states so in its header, and 30.3 removes the stand-in.
- Tests that need a late visit set `dirty_from` directly as the table owner for the same reason. Fixtures use `Africa/Douala`, explicit `join_date`, fixed `p_up_to` dates, never the clock.
- Mutation checks, run once and said so: swap the settle lock to run after the `member_visit_days` read and see the race script fail; remove the epoch guard and see its case fail. Restore both.
- Run `bash scripts/ci-local.selftest.sh` after editing `scripts/ci-local.sh`.
- Owner decision 2026-11-22 (as in 30.1): one-line additions to the existing pinned lists are allowed and expected, namely `engagement_facts` and `engagement_state` in the no-policy list of `suspension_rpc_coverage` and in the no-grant list of `support_role_live_gate` (count ten becomes twelve), plus the settle exclusion entry with its inline reason, and `support_request_path` only if a pin there trips. No other edit to an existing test.

**Never:**
- No change to `record_check_in`, `void_staff_check_in`, `set_weekly_goal`, any 30.1 object or any cron job. No `open_engagement`, `my_engagement`, view, milestone award, badge, shield or comeback logic (the fold ignores those kinds). No client-callable function. No fact written while `release_week_start` is NULL.
- No mock designs or HTML previews (project rule).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Dark | `release_week_start` NULL, any member | settle writes nothing, `dirty_from` untouched | N/A |
| Dormant | member with no counted visit day | nothing written, no state row | N/A |
| Pre-epoch visits | visits before the epoch | no fact before the epoch; days still in `member_visit_days`; first fact is the epoch week | N/A |
| Open week | `p_up_to` inside the week | no fact (closed only when `p_up_to >= Monday + 7`) | N/A |
| Empty week | gap between start week and last closed week | `missed` fact with 0 visits | N/A |
| Replay | settle twice, same arguments | second call writes 0 facts, `settled_through` unchanged | N/A |
| Late visit | Sunday visit synced Tuesday into a `missed` week, `dirty_from` set | new revision 2, `met`, visits 3; derived equals rebuild | N/A |
| Identical recount | dirty week recounts the same | no new row | N/A |
| Void | same-day void | open week count drops, no fact, best streak unchanged | N/A |
| Wrong gym | member not in `p_gym_id` | nothing read or written | raises |
| Epoch move | any `week` fact exists | refused | trigger raises |
| Mutation | UPDATE `outcome`/`visits`, `acknowledged_at` without flag or cleared | refused | trigger raises |
| Synthetic kinds | owner inserts `saved` and `comeback` facts | fold neither errors nor miscounts | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0184_engagement_config_weekly_goal.sql` -- `platform_engagement_config` (release_week_start, goal_default, goal_min/max), `member_weekly_goals(member_id, effective_week, goal)` history, `private.week_start_of`, the no-policy-no-grant table pattern (line 130-150) and history guard trigger (156-200) to copy for the append-only guard.
- `supabase/migrations/0173_attendance_counting.sql` 118-145 -- `attendance_counted` and `member_visit_days(member_id, gym_id, visit_day)`; the only count source. `0157_renewal_start_date_gym_local.sql` `private.gym_today`.
- `supabase/migrations/0174_record_check_in.sql` 81-110 -- `private.record_check_in(member, gym, source, actor, at, client_scan_id)`, lock `for no key update` at line 109; the race script calls it for real. Do not edit.
- `supabase/migrations/0178_single_use_check_in.sql` 440 -- `void_staff_check_in` (same-day void only). Do not edit.
- `scripts/check-in-member-lock-race.sh` -- the race-script pattern (container self re-exec, last-line verdict `race: all passed`, `hold_lock`, `scan_sql`, throwaway gym cleanup); `scripts/session-refund-race.sh` for 8 iterations. Wire the new `scripts/engagement-race.sh` at `scripts/ci-local.sh` ~129 and `.github/workflows/ci.yml` ~134.
- `supabase/tests/suspension_rpc_coverage.test.sql` 94-110 -- exclusion array (add `('private','settle_engagement', reason)`), plus the pinned no-policy table list; `supabase/tests/support_role_live_gate.test.sql` -- pinned no-grant table list.
- `supabase/tests/weekly_goal.test.sql`, `gym_local_week_bounds.test.sql` -- fixture style, independent date oracle, `pg_temp.claims`. New files: `engagement_facts.test.sql`, `engagement_fold.test.sql`, `engagement_settle.test.sql`, `engagement_determinism.test.sql` (the six NFR-028 cases), `engagement_isolation.test.sql`.
- `packages/types/src/database.ts` -- no change expected (no table is client-readable); check `pnpm gen` diff rules in `docs/decisions.md` before skipping.
- `docs/decisions.md` -- dated entry: fact ledger, frozen goal per settled week, epoch frozen after first fact, release procedure still the 30.1 statement.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0185_engagement_facts_fold_settle.sql` + `scripts/rollback-0185-*.sql` -- tables with CHECKs, append-only trigger (cascade and flagged-ack exceptions), epoch guard trigger on `platform_engagement_config`, `effective_engagement_facts`, `engagement_fold`, `settle_engagement`, `engagement_derived_state`, `rebuild_engagement`, verify block
- [x] `supabase/tests/engagement_facts.test.sql` -- shape, CHECKs per kind, grants, cascade delete, append-only refusals, effective revision
- [x] `supabase/tests/engagement_fold.test.sql` -- met/missed/gap/saved, best never lowered, synthetic `saved` and `comeback` facts
- [x] `supabase/tests/engagement_settle.test.sql` -- the matrix above, dirty re-evaluation, frozen goal, epoch guard, function scan
- [x] `supabase/tests/engagement_determinism.test.sql` -- late visit, void, goal change mid-week, timezone change, default change, regained streak; derived equals rebuild after each
- [x] `supabase/tests/engagement_isolation.test.sql` -- two gyms and staff; no helper callable by `authenticated`; a gym A settle never touches gym B
- [x] `scripts/engagement-race.sh`, `scripts/ci-local.sh`, `.github/workflows/ci.yml` -- settle vs offline check-in behind a third session holding the member lock, 8 iterations
- [ ] the three pinned tests and `docs/decisions.md` -- one-line pin additions and the dated entry

**Acceptance Criteria:**
- Given the full `scripts/ci-local.sh`, when run, then it is green and no existing test is edited beyond the pin additions named above.
- Given `release_week_start` is NULL, when anything in this story runs, then no fact or state row exists and nothing member-visible changes.

## Implementation Notes

- Migration `0185_engagement_facts_fold_settle.sql` + `scripts/rollback-0185-engagement-facts-fold-settle.sql`; pgTAP `engagement_facts` (75), `engagement_fold` (38), `engagement_settle` (127), `engagement_determinism` (57), `engagement_isolation` (33); `scripts/engagement-race.sh` wired into `scripts/ci-local.sh` and `.github/workflows/ci.yml`; one-line pins in `suspension_rpc_coverage` and `support_role_live_gate` (`support_request_path` did not trip); dated `docs/decisions.md` entry. `database.ts` untouched (nothing client-readable).
- Beyond the spec: the function scan pins four functions (`effective_engagement_facts` names the table); a week whose effective fact is `saved` stays `saved` on a below-goal recount; settle keeps `dirty_from` when the clock went backwards across a Monday over the dirty week; derived and rebuild always return a row.
- Verified: pgtap-run 226/226 (agent), the eight touched files re-run in review 8/8; race script 8/8 alone; mutation checks (settle lock after the visit read fails the race; epoch trigger dropped fails 4 cases), rollback rehearsed twice; check:migrations, check:claims, ci-local.selftest pass.
- NOT done: full `scripts/ci-local.sh` (no stamp), `supabase db reset` replay from scratch, real `pg_prove` (image not cached locally).

## Spec Change Log

## Review Triage Log

Pass 1 (Blind Hunter, Edge Case Hunter, Verification Gap). No patch, no loopback; one defer.

| # | Finding (layer) | Verdict | Evidence | Route |
|---|---|---|---|---|
| 1 | Gym delete with facts untested, depends on RI cascade order (VG, BH, ECH) | low | `members.gym_id` is NO ACTION (`confdeltype = 'a'` on the local DB), so a gym holding facts (a member exists) cannot be deleted by a plain `delete from gyms`; a delete of members and gym in one statement removes the member first. Same unreachable arm the owner had removed from 0184 at 30.1 review. | rejected |
| 2 | Facts go stale when the earliest visit day is voided or all visits vanish (BH, ECH) | false | `void_staff_check_in` voids only a visit whose `visit_day` equals `gym_today` (0178 line 529: `not_same_day`), and the only other `voided_at` writers touch payments and guest_sessions. A day in a closed week can never be voided, and a first visit day of today means no earlier week has a fact. | rejected |
| 3 | Epoch guard races with an in-flight first settle (BH, ECH) | low | Real but needs an operator to change an already-set epoch inside the milliseconds of the first settle commit. A `for share` in settle alone does not fix it (the BEFORE trigger runs before the row wait); it needs the guard to lock the row first as well, so two edits plus a two-session test. Recorded as a known residual in the report. | rejected |
| 4 | TRUNCATE bypasses the append-only guard (BH, ECH) | low | Owner or superuser only; identical finding rejected at 30.1 review (TRUNCATE and `DISABLE TRIGGER` bypass); the fix adds a statement trigger. | rejected |
| 5 | No upper bound on `p_up_to` (BH, ECH) | low | Function is private; callers pass `gym_today` (30.3) or a fixed test date; harm needs a caller bug and the fix adds a guard. | rejected |
| 6 | `engagement_evaluate_weeks` accepts non-Monday arguments (ECH) | false | Both callers derive `p_from` from `week_start_of`, the epoch (CHECKed to a Monday) or `settled_through + 7`, and `p_to` from `week_start_of - 7`; no client can reach it. | rejected |
| 7 | Week CHECK evaluation order; `2026-02-30` raises 22008 not 23514 (BH) | low | The insert is refused either way; only the error code differs. | rejected |
| 8 | No shape CHECKs for `day_shield`, `badge`, `comeback` (BH) | low | The AC requires per-kind CHECKs for `week` and `milestone` only; the other kinds are Epic 31's to constrain. | rejected |
| 9 | Determinism proof partly circular, rebuild shares the evaluator (BH) | low | By design (spec: settle and rebuild cannot drift apart); the hard-coded fact strings in `engagement_determinism` pin the goal, count and outcome independently. | rejected |
| 10 | Race script timing, queue order not confirmed, either revision accepted, host timeout leaves fixtures, cleanup deletes audit rows since start, global epoch on a shared DB (BH, ECH, VG) | low | Same sleep-based pattern as `check-in-member-lock-race.sh`; the spec's outcome is the final state, which every iteration asserts; a developer DB with committed week facts does not exist before 30.3. | rejected |
| 11 | Settle has no role filter (BH) | low | `private`, and 30.3's cron job and `open_engagement` choose the members; staff do not check in. | rejected |
| 12 | Isolation 42501 may come from schema USAGE (BH) | false | `private` USAGE is granted to the client roles (0009), so the refusal is the function-level revoke; the migration verify block also checks it. | rejected |
| 13 | Settle exclusion entry unnecessary; verify block checks volatility of 3 of 9 functions; lock-first source-text assertion brittle (BH, VG) | low | The entry is the spec's instruction; the assertion fails loudly and the race script is the behavioural proof; none causes a wrong result. | rejected |
| 14 | Stand-in `dirty_from` marks in four places with no tracking item (BH) | medium | `engagement-race.sh`, `engagement_settle`, `engagement_determinism` and their `mark_dirty` helpers simulate 30.3's mark; only the race header says 30.3 removes it. | defer (30.3 acceptance, deferred-work.md) |

## Design Notes

- Derived equals rebuild is compared as jsonb of `{streak_weeks, best_streak_weeks, last_settled_week, weeks}`, never row counts, because revisions legitimately add rows.
- A week with an effective fact keeps that fact's goal on re-evaluation; only an unsettled week reads `member_weekly_goals` then `goal_default`.

## Verification

**Commands:**
- `supabase db reset` then `bash scripts/ci-local.sh --only pgtap` -- expected: all files pass, new files and the new race included
- `npm run check:migrations && npm run check:claims` -- expected: pass
- `bash scripts/ci-local.selftest.sh` -- expected: pass
- `bash scripts/ci-local.sh` -- expected: GREEN, stamp written
