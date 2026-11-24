---
title: '31-1 Streak Shields and comeback'
type: 'feature'
created: '2026-11-23'
baseline_commit: 'b613c12cbdadc17a014c112333e300249a293b5d'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-31-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/epics.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 30's fold treats every missed week as a broken streak. `shields_held` and `comeback_state` are constants (0, 'none'), `engagement_evaluate_weeks` holds a stand-in "saved stays saved" rule, and Home shows nothing for Shields or a comeback. Production is live and the engagement epoch is NULL, so nothing may change for a member until the operator sets it.

**Approach:** One migration (provisional `0190`) makes the fold derive Shields, saved weeks, best streak and the comeback from effective `week` facts and `member_visit_days`; settle writes `week` (met, missed, saved) and `comeback` (started, completed, lapsed, withdrawn) facts; the state view family, `engagement_derived_state` and `rebuild_engagement` gain the new columns; the Home card renders Shield and comeback states from the row. The criteria of `epics.md` "Story 31.1" and the MA-09 states in EXPERIENCE.md are the authority; this spec adds the code map and the decisions below.

## Boundaries & Constraints

**Always:**
- Server contract exactly as `epics.md` 31.1. Migration `0190_streak_shields_comeback.sql` (provisional number, opens `set local lock_timeout = '5s';`), `scripts/rollback-0190-streak-shields-comeback.sql` (rehearse apply, rollback, apply, rollback, apply on the local DB). Every created or replaced function gets `revoke execute ... from public, anon` (and `service_role` for new public ones) in the same file; a new public function is granted to `authenticated` only; pgTAP asserts `has_function_privilege('anon', ...)` false for each. No config column is added: `shield_every_weeks` (4), `shield_cap` (2), `comeback_visits` (3), `comeback_window_days` (10) already exist in `platform_engagement_config` (0184).
- The fold is the only place a Shield, saved week, run or comeback is decided, and it is derived in order from effective `week` facts (plus `member_visit_days` for the comeback); no counter or Shield row is stored. `engagement_evaluate_weeks` keeps computing visits and the frozen goal per week and a raw met/not-met; the Shield spend is then decided by folding the weeks in order, so a corrected week cascades. The stand-in "saved stays saved" rule is removed (its pin in `engagement_settle.test.sql` ~347-362 and `engagement_fold.test.sql` ~112-119 are the named edits).
- Fold rules: a met week raises the run's met-week count; every `shield_every_weeks`-th met week of a run earns one Shield, never stored above `shield_cap`. A not-met week inside a run with a Shield held becomes `saved` (held -1, streak and best unchanged, the saved week adds nothing and does not count toward the next Shield); with none held it becomes `missed` (run ends, best = max(best, ended run)) and a `comeback` fact `started` (`subject_key` the missed week's Monday, revision 1) is written. A member not in a run never spends a Shield; held is 0 whenever a run ends; a restart earns a Shield again only after `shield_every_weeks` more consecutive met weeks. A gap in weeks resets the run as today.
- Comeback: counted from the first visit day after the run ended; window = `comeback_window_days` gym-local days starting with that visit day, inclusive; `comeback_visits` distinct visit days inside it write `completed` (`subject_key` the window start, `detail.completed_by = 'visits'`); a window that closes with fewer writes `lapsed`, the next visit day starts a new window (`subject_key` its start date). A week that settles as met while a comeback is open starts a new run (count 1) and closes it `completed` with `detail.completed_by = 'week'`. Completing grants nothing and invents no count. Reads `member_visit_days` only (never `attendance_events`, comments included). A comeback fact whose effective value no longer holds after a correction gets the next revision with outcome `withdrawn`; a replay inserts nothing and A to B to A flips back. `engagement_facts` keeps its 12 columns (extras in `detail`); no CHECK is added for `comeback` or `day_shield`.
- View family (`engagement_state_view_at`, `engagement_state_view`, `open_engagement_at`, `my_engagement`, `open_engagement`) is dropped and re-created together in dependency order with an identical row type, grants as 0186. `streak_weeks` becomes NULL (not 0) when no run is active; `best_streak_weeks` stays. New columns go before `pending_milestone`: `shield_every_weeks`, `shield_cap`, `weeks_to_next_shield` (1 to `shield_every_weeks`, NULL at the cap or when not in a run), `saved_week_start` and `saved_week_streak` (newest effective saved week and the streak after it, else NULL), `shield_earned_week` (Monday of the newest week that earned a Shield, else NULL), `comeback_visits_done`, `comeback_visits_goal`, `comeback_window_days`, `comeback_window_start`, `comeback_window_ends_on` (NULL until a window has started); `shields_held` and `comeback_state` become real (`none`, `active`, `lapsed`, `restored`). `restored` means the latest comeback is `completed` by visits and no met week has started a new run since; completed by a met week reads `none`. Check-in and void bodies stay untouched; settle keeps the member lock first and the 30.x tests that are not named here pass unedited.
- `engagement_derived_state(uuid)` and `rebuild_engagement(uuid, date)` are dropped and re-created adding `shields_held`, `comeback` (state, visits_done, window_start) and per-week outcomes including `saved`; rebuild re-derives from `member_visit_days` through the same evaluate and fold, and the equivalence test compares derived state, not row counts. Repair appends and never truncates, never touches `acknowledged_at` or `silent`.
- `private.engagement_daily_streak_enabled()` (private, returns false, revoked) guards one day-path step; the reservation rule (a missed day spends a Shield only with two held; a whole missed week spends one on the weekly streak and ends the daily run) lives in a pure private helper the settle calls only when enabled. Active-path proof in a rolled-back pgTAP transaction that replaces the guard to return true.
- Gates reach their consumers (Epic 22 retro 66): a pgTAP scan proves no function other than `settle_engagement` writes `week` or `comeback` facts, no write path exists for staff, support, anon or authenticated, nothing here reads or writes the loyalty ledger, `guest_sessions` or stamps (row counts identical after an earned Shield and a completed comeback), and the new private functions are not registered in `private.support_capabilities`. Shown failing against a mutant that adds a fact write to `record_check_in`.
- Calendar week-saved data: a new public `my_saved_weeks(p_month date)` (stable, security definer, same caller guards as `my_visit_days`, returns the Mondays of saved weeks that touch the month; body has no `attendance_events` and no `at time zone`). It is the only added public function; `engagement_facts.test.sql:196` and `engagement_rpc.test.sql:111` get one disclosed line each, and `support_request_path.test.sql` allow-list one line if its scan flags it.
- Mobile logic lives in pure files with EN and FR tests: `lib/shieldView.ts` (chip, next-Shield line, notice choice, comeback phases, plural keys), `services/shieldNotices.ts` (device store, below); `weeklyRing.ts` `CardView` gains the Shield and comeback views; components stay thin: `ShieldChip` (44pt target, a Pressable nested beside the card's outer Pressable, never inside the touch target of /calendar), `ShieldExplainerSheet` (RN `Modal` slide, `[Got it]`), `ShieldNoticeRow`, `ComebackCard` with a small `StampSegments` (extract the `RewardsCard` segment style; no "0 / 3" numeral while empty). New files are added to `SCREEN_FILES` and the arithmetic, literal-sentence and no-device-derivation scans of `weeklyRing.source.test.ts`; no date arithmetic outside `lib/calendarGrid.ts`.
- Parsing: `parseEngagement` and `ENGAGEMENT_FIELDS` gain the new fields; `streakWeeks` becomes nullable (null renders as no run, never a bare 0); the cache key moves `gymos.engageHome.v1` to `v2` so old caches are ignored, not crashed on; every fixture building a full `Engagement` row is updated. The device never derives a Shield or comeback number; a queued visit shows only as the dashed segment.
- Notices: `engage.shield.saved.week` shows when `saved_week_start` is the newest settled week and its id is not dismissed; `engage.shield.earned` when `shield_earned_week` is the newest settled week and not dismissed; at most one at a time, newest first, each dismissed on its own. Dismissal ids persist per user and gym (`gymos.shieldNotices.v1.<userId>.<gymId>`, JSON id set capped at 50, fail-closed on read errors like `services/loyaltySeen.ts`), cleared at the three sign-out sites beside `clearShown()` and the pinned source test updated. The one-time `restored` card is shown once per `comeback_window_start` (same store) and reads gone afterwards.
- Wording: add `engage.atRisk.shieldReady` and `engage.calendar.legend.shield` (EN and FR from EXPERIENCE.md catalog) to both locale files and `engage.test.ts` REQUIRED; `engage.shield.explainer.body` takes the interval as a `{{count}}` placeholder (make it a plural key, EN and FR `one`/`other`, passed `shield_every_weeks` from the row via a new `shield_every_weeks` view column) and the `KNOWN_LITERALS` exception in `engage.test.ts` is removed; `engage.streak.daily` gets a plural form (closes the open `deferred-work.md` lines naming Epic 31); a test fails if "freeze", "insurance" or "token" appears in any `engage.shield.*` string. A week-saved calendar cell label uses `engage.shield.saved.day` already in the catalog; the detail line uses the short form of `engage.shield.saved.week`.
- Calendar (MA-18): `services/visitDays.ts` reads `my_saved_weeks` for the month; `CalendarCache` gains an optional parallel `savedWeeks` map (old caches still read); the Sunday cell of a saved week shows the `shield` glyph in a corner other than the star and schedule slots, hidden from a11y, with a hairline under the week row; the legend appends `shield` fourth. The calendar still never calls `openEngagement`.
- Pins edited by one disclosed line each: `engagement_state_view.test.sql` (column list ~77, whole-row ~109-113), `engagement_milestones.test.sql:144` only if the order changes, `engagement_fold.test.sql`, `engagement_settle.test.sql` (named above), `weeklyRing.test.ts` "Epic 31 slots render nothing" is rewritten. Anything else needing an edit is stopped and reported. `check:migrations`, `check:claims`, `check:attendance-readers`, `check:i18n`, `tsc`, mobile Vitest, full pgTAP, `scripts/engagement-race.sh` and `scripts/ci-local.sh` pass.
- Decided here, recorded in a dated top entry of `docs/decisions.md`: the in-order fold replaces the stand-in saved rule; comeback fact shapes (`withdrawn`, `completed_by` in `detail`); `restored` semantics; the new calendar read; `streak_weeks` NULL contract; notices are device-dismissed ids; the epoch stays NULL in production so nothing changes for members yet.

**Never:**
- No Shield buy, grant, transfer or edit path; no streak, best or comeback edit; no loyalty, stamp or guest-session read or write; no `day_shield` write while the guard is false; no change to `check_in()`, `record_check_in` or `void_staff_check_in`; no write to `attendance_events`; no new support capability; no "freeze", "insurance", "token", failure or red-tint wording; no bare "0" or "0 Shields"; no new dependency; no mock designs or HTML previews (project rule).
- No production deploy and no push (epics 30 and 31 are tested and pushed together after 31-3). Not run by me: device or browser QA.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Earn at 4 and 8, cap | runs of 4, 8, 12 met weeks, none spent | held 1, 2, 2; `weeks_to_next_shield` 4 to 1, NULL at cap | N/A |
| Spend on a miss | held 1, week below goal | week `saved`, held 0, streak and best unchanged | N/A |
| Saved week not counted | run of 6, week 7 saved, 8 and 9 met | next Shield at met-week count 8 | N/A |
| Two misses, two Shields; third miss | held 2, three misses | two `saved`, then `missed`, run ends, `comeback` started | N/A |
| No run | not in a run, week below goal | `missed`, no Shield spent, no comeback | N/A |
| Late visit | saved week turns met | Shield returned, streak +1, later Shields move, new revisions only for changed facts | replay inserts nothing |
| Void | met week turns missed | spends a Shield or ends the run, later weeks re-evaluated | N/A |
| Double settle | cron plus first open under the lock | one `saved` fact, one Shield spent | race script |
| Comeback complete / lapse / restart | 3 days in 10, or 2 days then expiry then a new visit | `completed` (visits), `lapsed`, new window; no reward | N/A |
| Met week during comeback | week met, comeback open | new run count 1, comeback `completed` by week, state `none` | N/A |
| Rebuild equals live | seeded: earn 4 spend 6, two spent, comeback complete, lapse restart, late visit, void, timezone change | derived equals rebuild | N/A |
| Day path | 5 visit days, 2 Shields, guard false | no `day_shield` fact, Shields unchanged | N/A |
| Home states | held 1 or 2, saved, earned, comeback phases, offline, `settleError` | chip only at 1 or 2, one notice, card phases, server numbers, last known when offline | no error shown |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0185_engagement_facts_fold_settle.sql` -- `engagement_facts` (27-60, week shape CHECK; no comeback or day_shield shape), `engagement_fold_weeks` 183, `engagement_fold` 232 (header says Epic 31 plugs in here), `engagement_evaluate_weeks` 266-330 (stand-in saved rule), `effective_engagement_facts` 160. `0189_milestones_celebration.sql`: `settle_engagement` 78 (member lock first, `award_milestones` call ~175), `engagement_state_view_at` 181, `engagement_derived_state` and `rebuild_engagement` 464-494. `0186:678-1060` -- view family, row type (28 columns), grants. `0184:24-93` -- config columns and audit trigger. `0187:25-67` -- `my_visit_days` (model for `my_saved_weeks`).
- New: `supabase/migrations/0190_streak_shields_comeback.sql`, `scripts/rollback-0190-streak-shields-comeback.sql` (restore the 0185, 0186 and 0189 shapes; comeback and saved facts are left, the guard forbids deleting them), new pgTAP `engagement_shields.test.sql` (fixtures `00000000-0000-0000-00NN-...`, NN unused: grep first; helpers from `engagement_rpc.test.sql:20-37`), extend `scripts/engagement-race.sh` (306 lines, phase A model, wired `ci-local.sh:131`, `ci.yml:138`) with a double-settle phase.
- Tests to extend: `engagement_determinism.test.sql` (46-47, tz case 125-134), `engagement_journey.test.sql`, `engagement_settle.test.sql` (60, 77-78 STABLE pins, 347-362), `engagement_fold.test.sql` (31, 41, 112-119), `engagement_state_view.test.sql` (77, 109-113), `engagement_milestones.test.sql` (81-82, 144), `engagement_isolation.test.sql` (82-83), `engagement_facts.test.sql` (39 12 columns, 186-197), `engagement_rpc.test.sql` (103-111), `suspension_rpc_coverage.test.sql` (settle excluded 180; no dynamic `execute format(`), `support_excluded_from_counts.test.sql` (205-217 `cat_count`), `attendance_counting.test.sql` (520-612).
- `packages/types/src/database.ts` -- new view columns and `my_saved_weeks`.
- Mobile (`apps/mobile/src`): `services/engagement.ts` (14-135, parse), `lib/weeklyRing.ts` (`ENGAGEMENT_FIELDS` ~150-180, `isEngagement` 198, `StreakView` 264, `CardView` 291, `streakFor` ~335, `cardLabelFor` ~340, `buildHomeEngagementView` 379, cache key ~144), `hooks/use-home-engagement.ts` (68-159, dismiss state beside `dismissGoalHint`), `components/WeeklyRingCard.tsx` (outer Pressable 55, `StreakArea` 105, header comment 22-24), `components/RewardsCard.tsx:125-140` (segments), `components/ui/IconChip.tsx` (glyph `shield`), `components/LogEntrySheet.tsx:173` (Modal precedent), `services/weeklyGoal.ts:127-145` and `services/loyaltySeen.ts` (store models), `lib/celebrationView.ts:99-135`, sign-out sites `profile.tsx`, `suspended.tsx`, `awaiting-registration.tsx` (`clearShown()`), `services/visitDays.ts`, `hooks/use-calendar.ts`, `lib/calendarView.ts` (legend ~352, `DayCellView` 106-127, cache 364+), `components/CalendarDayCell.tsx`, `app/calendar.tsx` (legend marker map), `locales/{en,fr}.json` (`engage` 496+), `locales/engage.test.ts` (REQUIRED 11-150, `KNOWN_LITERALS` ~232), `lib/weeklyRing.source.test.ts` (SCREEN_FILES 28-57, 88, 108-125, 178-215, ~628, 641), fixtures `weeklyRing.test.ts:72,490-497`, `calendarView.test.ts:76`, `celebrationView.test.ts`, `services/engagement.test.ts:67`.
- `docs/decisions.md` top entry; `deferred-work.md` (close the Epic 31 lines for the explainer `{{count}}` and `engage.streak.daily` plural; search for other lines naming 31-1 before closing).

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0190_streak_shields_comeback.sql`, `scripts/rollback-0190-streak-shields-comeback.sql` -- fold with Shields and comeback, evaluate and settle changes, daily guard and helper, view family, derived and rebuild, `my_saved_weeks`, grants, verify block, rollback -- server contract
- [x] `supabase/tests/engagement_shields.test.sql` and the extended determinism, journey, settle, fold, state_view, milestones, facts, rpc, isolation files, `scripts/engagement-race.sh` -- every I/O row, caller and privilege matrix, loyalty untouched, consumer scan shown failing against a mutant, rebuild equivalence, `explain` on a seeded 3-year member -- gates reach their consumers
- [x] `packages/types/src/database.ts`, `services/engagement.ts`, `lib/weeklyRing.ts` (+ tests, fixtures) -- types, parse, cache v2, nullable streak
- [x] `lib/shieldView.ts`, `services/shieldNotices.ts` (+ tests), `ShieldChip`, `ShieldExplainerSheet`, `ShieldNoticeRow`, `ComebackCard`, `StampSegments`, `WeeklyRingCard.tsx`, `use-home-engagement.ts`, sign-out sites -- Home states
- [x] `services/visitDays.ts`, `use-calendar.ts`, `calendarView.ts` (+ test), `CalendarDayCell.tsx`, `calendar.tsx` -- saved-week glyph, legend, cache
- [x] `locales/{en,fr}.json`, `engage.test.ts`, `weeklyRing.source.test.ts` -- keys, plural explainer, glossary scan, scans for the new files
- [x] `docs/decisions.md`, `deferred-work.md` -- dated entry, close lines naming 31-1 or Epic 31

**Acceptance Criteria:**
- Given the epics.md Story 31.1 criteria and the I/O matrix, when the migration, pgTAP, race script and Vitest run, then every listed server and screen state matches, in EN and FR.
- Given `release_week_start` NULL, when a member uses the app, then Home and the calendar are unchanged and no week, comeback or saved fact exists.
- Given any function other than `settle_engagement` writes a `week` or `comeback` fact, or `check_in()`, `record_check_in` or `void_staff_check_in` change, or a new function is anon-executable, then pgTAP fails.

## Implementation Notes

- Migration `0190_streak_shields_comeback.sql` and `scripts/rollback-0190-streak-shields-comeback.sql` (apply, rollback, apply, rollback, apply rehearsed on the local DB; number provisional). New pgTAP `engagement_shields.test.sql` (159 assertions, includes the consumer scan and its mutant, the cascade case and the restored-to-none case); `scripts/engagement-race.sh` phase C (double settle). Mobile: `lib/shieldView.ts`, `services/shieldNotices.ts`, `ShieldChip`, `ShieldExplainerSheet`, `ShieldNoticeRow`, `ComebackCard`, `StampSegments`, calendar saved-week glyph and fourth legend entry.
- Existing tests edited (disclosed in `docs/decisions.md`): `engagement_state_view` (column list and whole-row), `engagement_fold` 13, `engagement_settle` (`nrows` counts week rows, saved-week block rewritten), `engagement_determinism` 53 and `engagement_isolation` 22 (count comeback facts; isolation gains the seven new private functions), `engagement_journey` (two helper lines read a NULL streak as 0), `engagement_rpc` (one line), `support_request_path` E1 (`my_saved_weeks`).
- Judgment calls: Shield and comeback parameters reach the fold through `private.engagement_shield_params()` (the fold test forbids the config table in the fold's source); the day-path step uses a placeholder definition of a broken daily run (deferred); extra catalog key `engage.shield.saved.weekShort` for the calendar detail line; the mobile parser treats a missing new view field as an error, so the migration ships before the app.
- Review pass 1: 7 patches applied (cascade and restored-to-none pgTAP cases, buildHomeEngagementView wiring tests, failed saved-weeks read not cached, notice store write serialisation and read merge, restored ref reset, comment reword); 5 deferred to `deferred-work.md`; 12 rejected. NOT run: full `scripts/ci-local.sh` on a committed head (next), any device or browser pass.

## Spec Change Log

## Review Triage Log

Pass 1 (Blind Hunter 14, Edge Case Hunter 13, Verification Gap 5 plus 2 other). Verdict | route | evidence.

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | Installed builds break on NULL `streak_weeks` | false | reject | No build in the stores calls `my_engagement` yet: Epics 30 and 31 ship together, and the Epic 30 parser is the one this story changes |
| 2 | Calendar calls `my_saved_weeks` while dark | low | reject | The calendar is only reachable from the enabled card; fix adds a branch for a negligible cost |
| 3 | Dormant member keeps stale comeback facts (all visit days voided) | medium | defer | `settle_engagement` returns before the comeback step; the same early return (0185/0189) already leaves the week facts stale, so the comeback stays consistent with them; pre-existing design |
| 4 | Day-path step incomplete (`p_week_missed` false, no revision, no effect on fold) | low | defer | Inactive while the guard is false; the AC only pins the rule; the daily-streak story must finish it |
| 5 | Comeback subject for a week-closed episode, no `lapsed` fact when closed by a week | low | reject | The AC does not fix that subject; state reads `none` either way |
| 6 | Config change rewrites history | medium | defer | Real, documented in decisions.md; the fix (snapshot or refuse, like `goal_default`) is a design change |
| 7 | Notice missed after a skipped week | false | reject | The spec decided "newest settled week"; the fix edits the spec |
| 8 | Explainer unreachable at 0 Shields | false | reject | UX opens it from the chip, which exists only at 1 or 2 |
| 9 | Restored card recorded on first render; write race; stale in-flight read; ref not cleared on failure | medium | patch | Verified in the hook and `recordDismissed`; smallest fix: serialise writes, merge the read with later dismissals, clear the ref on a false result |
| 10 | `v1` cache key left behind | low | reject | v1 never shipped (Epic 30 unreleased) |
| 11 | No cost bound on evaluate walk | low | reject | 156 weeks for a 3-year member; the cascade needs the walk from the first week |
| 12 | Calendar wording and a11y, no render tests | low | reject | Catalog wording; the repo has no render harness |
| 13 | `splitAround` and the "d / n" literal | low | reject | Numeral is found in a catalog string the app controls |
| 14 | Spec and record ahead of evidence, `0190` hard-coded | false | reject | The record is updated by this pipeline; fix edits the spec |
| 15 | `restored` becoming `none` after a met week not tested | medium | patch | Test gap confirmed: no assertion on that branch |
| 16 | A correction that changes a LATER week's outcome not exercised | high | patch | The cascade is the story's core claim; every correction test keeps later outcomes |
| 17 | `buildHomeEngagementView` to `buildShieldView` wiring (seen, queued visit) untested | medium | patch | Two states ship with no test on the screen's path |
| 18 | Hook dismissal verified by source text only | low | defer | The repo has no hook harness; extraction is a refactor |
| 19 | Failed `my_saved_weeks` cached as authoritative `[]` | medium | patch | Persists a failed read; smallest fix: write `savedWeeks` only on success, with a test |
| 20 | `comeback_live` shows lapsed before settle when a later window exists | low | reject | Transient; the lapsed fact written by settle makes the next read correct |
| 21 | Comeback counts from Monday + 7, skipping the missed week's visits | false | reject | The AC says "from the day the missed week closed" |
| 22 | `p_today` NULL leaves the last window un-lapsed in rebuild | false | reject | `rebuild_engagement` and settle both pass `p_up_to` |
| 23 | Comment in 0190 contains the literal `attendance_events` | low | patch | Spec says comments included; a one-word rewrite |
| 24 | `engagement_fold_weeks` is dead code in 0190 and still pinned | low | defer | Removing it edits four pinned tests; one run arithmetic should remain |

## Design Notes

- Fold shape: `engagement_evaluate_weeks` stays the single place visits and the frozen goal are read; a new pure step walks the weeks in order carrying (run met-count, held, best) and emits each week's outcome; settle compares the emitted outcome with the effective fact and writes revision+1 only on change. Comeback is a second pure walk over the ended-run boundary and the distinct visit days after it, compared with the effective comeback facts the same way.
- Golden example (cap 2, every 4): weeks 1-4 met (met count 4, held 1); week 5 below goal: `saved` (held 0, streak stays 4); weeks 6-9 met (met count 8 at week 9, held 1 again; the saved week 5 did not count); week 10 below goal: `saved` (held 0); week 11 below goal with none held: `missed`, run ends, best 8, `comeback` started on week 11's Monday.

## Verification

**Commands:**
- `bash scripts/ci-local.sh` -- expected: GREEN on the committed story head (13-20 min)
- `pnpm --filter mobile test`, `tsc --noEmit`, `pnpm check:i18n`, `pnpm check:migrations` -- expected: pass
- `scripts/engagement-race.sh` -- expected: exits 0 with the double-settle phase

**Manual checks (if no CLI):**
- Left to the owner's combined browser and device QA of epics 30 and 31: Home with 1 and 2 Shields, saved and earned notices, explainer sheet, comeback card phases in EN and FR, calendar saved-week glyph.
