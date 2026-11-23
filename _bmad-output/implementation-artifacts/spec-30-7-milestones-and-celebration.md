---
title: '30-7 Milestones and celebration'
type: 'feature'
created: '2026-11-23'
baseline_commit: 'aee1dc3326128853d44f6328e7b0a6871efba115'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-30-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/epics.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A member who reaches their 7th, 30th or 100th visit day gets no recognition, the calendar cannot mark those days, and `pending_milestone` is still a constant NULL. Production is live and the engagement epoch is NULL, so nothing may change for a member until the operator sets it.

**Approach:** Migration `0189` adds `private.award_milestones` (called only from the tail of `private.settle_engagement`), `public.acknowledge_milestone(smallint)`, a real `pending_milestone` in `private.engagement_state_view_at`, the derived `milestone` column of `my_visit_days`, and a milestone array in `engagement_derived_state` / `rebuild_engagement`. Mobile adds the MA-20 route `/celebration/[milestoneId]` pushed once from Home, and the star marker, legend entry and labels on MA-18. The criteria of `epics.md` "Story 30.7", MA-20 (EXPERIENCE.md 2208-2250 without Share and badges) and the MA-18 milestone rows (2103-2116; copy 658-664, 713-727) are the authority; this spec adds the code map and the decisions below.

## Boundaries & Constraints

**Always:**
- Server contract exactly as `epics.md` 30.7. Migration `0189_milestones_celebration.sql` (provisional number, opens `set local lock_timeout = '5s';`), `scripts/rollback-0189-milestones-celebration.sql` (rehearse apply, rollback, apply, rollback, apply on the local DB). Every created or replaced function gets `revoke execute ... from public, anon` (and `service_role` for new public ones) in the same file; new public function `grant execute ... to authenticated`.
- `private.award_milestones(p_member_id uuid)`: reads `member_visit_days` only (never the string `attendance_events`, comments included; `attendance_counting.test.sql` scans definitions). For each of 7, 30, 100 reached and without a fact, inserts one `kind='milestone'`, `subject_key` the number, `revision` 1, `silent = (Nth distinct day < epoch Monday)`, `acknowledged_at = now()` when silent else NULL; `on conflict do nothing`; inserts nothing else; never from `record_check_in` or `void_staff_check_in` (their bodies stay untouched; 0186's verify block pins this). Returns void; dark epoch awards nothing.
- `private.settle_engagement` is re-created from the **0185 body** (no later migration changed it) with exactly one added `perform private.award_milestones(p_member_id)` before the final `return v_written;`. The return value stays the week-fact count only; no extra lock; the 30.2 tests pass unedited.
- `engagement_state_view_at` re-created with `create or replace` and an identical row type; `pending_milestone` = `max(subject_key::smallint)` over the member's milestone facts that are `not silent` and `acknowledged_at is null`. `public.my_engagement`, `open_engagement` need no change. `engagement_state_view.test.sql` column pins pass unedited.
- `public.acknowledge_milestone(p_milestone smallint) returns smallint`, plpgsql security definer, `set search_path to 'public'`, guards in `set_weekly_goal` order (role `member` via `private.current_member_role()`, `private.gym_id()`, own non-deactivated member row, then the literal `private.current_gym_status() is distinct from 'active'` raising `42501` with an `is not active` message, all before any write), then `perform 1 from members ... for update`. A number other than 7, 30, 100 raises `22023`. It sets `app.engagement_acknowledge` to `'on'` with `set_config(..., true)`, updates only `acknowledged_at = now()` on that milestone and on every lower unacknowledged milestone of the member, resets the flag to `'off'`, and returns `p_milestone` when the member holds it (acknowledged now or earlier), NULL when not held (no write). It is the only function that sets `acknowledged_at`. No member id parameter, no `execute format(`, no `count(`, no literal `'support'` or `'supervisor'`, not registered in `private.support_capabilities`.
- `public.my_visit_days(p_month)` re-created with `create or replace`: `row_number()` over all the member's distinct days (a CTE), filtered to the month afterwards; `milestone = case when rn in (7,30,100) then rn::smallint end`, never stored, same signature and caller guards, body contains no `attendance_events` and no `at time zone` (pinned by `my_visit_days.test.sql`).
- `engagement_derived_state(uuid)` and `rebuild_engagement(uuid, date)` are dropped and re-created (OUT columns change) with an added `milestones jsonb` key: derived reads effective milestone facts (silent included) as a sorted array of numbers; rebuild returns the thresholds reached by the distinct `member_visit_days` count, and `[]` when the epoch is NULL. Revokes re-issued as in 0185. Only the spec cases (late visit, void then return to 7, timezone) are compared; a void that drops the count below 7 is not compared (facts keep the milestone, a rebuild would lose it).
- Mobile logic lives in pure files (`src/lib/celebrationView.ts`: milestone choice, shown-store, motion plan, label keys, mini-month cells) with tests in EN and FR; screens and hooks stay thin. Route `src/app/celebration/[milestoneId].tsx` registered as `<Stack.Screen name="celebration/[milestoneId]" options={{ animation: 'fade', gestureEnabled: false }} />` inside the first `Stack.Protected guard={isFullyOnboarded}` group of `_layout.tsx`. `services/milestones.ts` `acknowledgeMilestone(n)` never throws and returns `success | gym_suspended | error` (a `42501`/`22023` refusal is non-retryable).
- Trigger: a new `use-home-celebration.ts` takes the same engagement read promise as `use-home-leaderboard.ts` (`index.tsx` keeps exactly one `loadEngagementForHome(` and the hook exactly one `loadEngagement(`; `index.tsx` mentions no `gymToday`, `weekStart` and the like, nor `services/visitDays`). Celebrate only from a **live** `row` outcome (never `fromCache`, never the device copy, never dark/unavailable), `subscriptionStatus !== 'expired'`, Home focused; push after about 600 ms once Home has painted; cancel the timer on blur and unmount. Only the highest pending number is shown. A number whose device shown-store entry exists, or that is not 7, 30, 100, is not shown; the route opens to Home for an unknown number.
- Shown-store (`gymos.celebration.v1.<userId>.<gymId>`, fail-closed like `services/loyaltySeen.ts`): written **before** the acknowledge call on [Keep going] or Android back; entry `{milestone, acked}`; a failed ack leaves `acked:false` and is retried silently on each Home load while connected (and on reconnect), clearing the flag on success; cleared at the three sign-out sites (`profile.tsx`, `suspended.tsx`, `awaiting-registration.tsx`) beside `clearCachedProgressPayload()`. There is no gym-switch flow in the app; keying by user and gym covers it.
- Screen: dark background, no tab bar, no back arrow, 480pt max width (card at most 420pt on tablets), reserved empty mascot slot bound to `engage.celebration.mascot.<n>` via `t()` (zero height while empty), `celebrationOverlay` card (radius 24, `#141F30`), gym logo 48pt (omitted when absent) and gym name, numeral in a local 96/104 style, `engage.celebration.unit`, headline and sub for the number, **[Keep going]** as the only button (52pt primary; no Share, no "See your badges", no `cta.share` or `cta.badges` use), read-only mini month calendar (28pt cells, lit days only, no numerals, no at-risk) only when the window height is at least 640pt and the font scale is below the +2 step. Success haptic always (`Haptics.notificationAsync`); with `useReduceMotion()` false: numeral counts 0 to N over 700 ms and the card scales 96% to 100% with a fade over 400 ms (RN `Animated`; the first frame waits until the reduce-motion read resolves); true: final state with a 150 ms cross-fade. No `Animated.loop`, no `loop:`, no `expo-av`, no sound asset, no confetti. Announced once as an `alert` with `engage.celebration.a11y`, focus on the headline, numeral and mini calendar `accessibilityRole: 'none'`. The route's own file does not import `use-at-risk-pulse.ts` beyond `useReduceMotion`.
- Calendar (MA-18): `use-calendar.ts` keeps `milestone` per day; `CalendarCache` gains an optional parallel `milestones: Record<month, Record<date, number>>` (parse, update and empty-cache paths updated, old caches still read). Cell shows the 14pt `star` glyph in a corner other than the top-right glyph slot, hidden from a11y, with shape plus text (never colour alone); legend appends `milestone` third (`engage.calendar.legend.milestone`); the day detail line reads "Your 30th visit"-style from the catalog; cell a11y label uses `engage.calendar.day.milestone7|30|100` (the **catalog** form `{date}: your 30th visit`; the epic's comma form is superseded by the UX catalog, recorded in decisions.md). Add the five calendar keys to both locale files, `engage.test.ts` REQUIRED and the sentinel list in `calendarView.test.ts`; update the whole-object `DayCellView` fixtures only where needed.
- Gym name and logo: the screen reads its own gym's `name, logo_url` filtered by the session `gymId` (the 30.6 unfiltered-query lesson); there is no branding cache; failure omits the logo and falls back to the cached gym name or an empty line, never blocks closing.
- All strings from `engage.celebration.*` and `engage.calendar.*` (EN and FR parity, no `!`, no loss wording, no sentence in a `.tsx`); new files are added to `SCREEN_FILES` and the arithmetic, literal-sentence and no-device-derivation scans of `weeklyRing.source.test.ts`; no date arithmetic outside `lib/calendarGrid.ts` (mini month via `buildMonthGrid`, `monthStartOf`; month from `gymToday` of the live read via `calendarGrid.ts`).
- Pins edited by one disclosed line each: `support_request_path.test.sql` E1 array gets `'acknowledge_milestone'` first; other pins only if a scan flags a new function (check `support_excluded_from_counts` `cat_count`, `support_role_live_gate`, `suspension_rpc_coverage`). Anything else needing an edit is stopped and reported. `my_visit_days.test.sql` gains marker assertions (its April case now returns milestone 7). `check:migrations`, `check:claims`, `check:attendance-readers`, `check:i18n`, `tsc`, mobile Vitest, full pgTAP and `scripts/ci-local.sh` pass.
- Decided here, recorded in a dated top entry of `docs/decisions.md`: milestone `silent` follows the epoch Monday (`Nth day < epoch`); the epoch guard stays frozen on `week` facts only (an existing test pins that), so the operator must not move the epoch once members have opened the app after it; colon form of the calendar label; gym name and logo read on the screen; the ack return value; shown-store design. Epic 22 retro 66/67: the gate "milestone award runs only in settle" has its consumers enumerated by a pgTAP scan (no function other than `settle_engagement` calls `award_milestones`; no function other than `acknowledge_milestone` sets the flag), shown failing against a mutant that adds the call to `record_check_in`.

**Never:**
- No award from `record_check_in`, `void_staff_check_in`, `check_in()` or a read; no second milestone row; no deletion or un-acknowledging of a milestone; no Share button, badge shelf or badge row (Epic 31); no confetti, loop, sound; no tab or tab badge; no push notification; no celebration from a cached or dark read; no mock designs or HTML previews (project rule); no new dependency.
- No production deploy and no push (epic-end only). Not run by me: device or browser QA.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 7th day after epoch | 7 distinct days, Nth day >= epoch | one fact, `silent=false`, `ack` NULL; `pending_milestone` 7 | N/A |
| History before epoch | 120 days all before epoch | three silent facts, ack set, no pending | N/A |
| 35 before, 2 after | epoch between | 7 and 30 silent; 100 celebrated later | N/A |
| Replay settle | facts exist | no insert | N/A |
| Void then return to 7 | 7th day voided, new visit later | row and ack unchanged, no second row; marker follows derived 7th day | N/A |
| Late offline visit | makes earlier date the 7th | marker moves, no new fact | N/A |
| 7 and 30 both waiting | long offline gap | pending 30; ack(30) acks 7 and 30 | N/A |
| Ack twice / not held / bad number | repeat, 12, 8 | same result, NULL no write, `22023` | `42501` for staff, support, anon, deactivated, suspended |
| Two gyms, two members | A acks or reads B | nothing crosses | N/A |
| Home with pending, live row | online | push after ~600 ms once, only if focused | timer cancelled on blur |
| Cached or dark or expired | any | no celebration | N/A |
| Offline Keep going | ack fails | shown-store written, screen closes, retried later, not shown twice | silent |
| Reduce motion | on / off | final state with 150 ms fade / count-up and scale; haptic in both | N/A |
| Short screen, +2 text | height < 640 or large font | mini calendar hidden | N/A |
| Calendar month with 30th day | `milestone` 30 | star, legend, label, detail line, EN and FR | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0185_engagement_facts_fold_settle.sql` -- `engagement_facts` (27-60; milestone CHECK 55-58), append-only guard + flag `app.engagement_acknowledge` (96-124), `settle_engagement` 346-438 (add the call before `return v_written` ~437; dark exits at 374-376, dormant 387-393), `engagement_derived_state` 449-470 and `rebuild_engagement` 473-516 (revoke lines 468, 514). Epoch: `select c.release_week_start from platform_engagement_config c limit 1`.
- `0186_engagement_settle_triggers_state_view.sql:678-806` -- `engagement_state_view_at`; constant `null::smallint` at ~803 becomes the milestone read; row type shared via `select *` (`engagement_state_view` 809, `open_engagement_at` 850, `my_engagement` 918; verify block 1135-1142). `0187_attendance_calendar.sql:25-67` -- `my_visit_days`. `0184:207-` -- `set_weekly_goal` guard model. `0173:106,132` -- `member_visit_days` and its index.
- New: `supabase/migrations/0189_milestones_celebration.sql`, `scripts/rollback-0189-milestones-celebration.sql` (drop `acknowledge_milestone`, `award_milestones`; restore 0185 settle/derived/rebuild shapes, 0186 view, 0187 `my_visit_days`; milestone rows are left, the guard forbids deleting them). New pgTAP `engagement_milestones.test.sql` (fixtures `00000000-0000-0000-00NN-...`, NN unused: grep first; helpers `pg_temp.id/m`, `pg_temp.claims/asrole` from `engagement_rpc.test.sql:20-37`; epoch set per test; settle called with an explicit date).
- Tests to extend: `engagement_determinism.test.sql` (plan 57, helpers 46-47), `engagement_journey.test.sql` (plan 60, `pg_temp.chk`, `open_engagement_at`; add the offline 7th-day case, pending exactly once), `engagement_facts.test.sql` (~110-133 flag cases get real-call tests; 167-175 privilege pin unchanged), `my_visit_days.test.sql` (5, 114, 138, ~186), `support_request_path.test.sql:231-236`. Run the whole `engagement_*` set: other fixtures giving one member 7+ post-epoch days would gain milestone rows.
- `packages/types/src/database.ts` -- add `acknowledge_milestone` first in `Functions` (~2885): `Args { p_milestone: number }`, `Returns: number | null`; `pending_milestone` and `milestone` types already exist (~3957, 3981).
- Mobile (`apps/mobile/src`): `services/engagement.ts:52-53,102,134` (pendingMilestone parsed), `lib/weeklyRing.ts:117-134,179` (`loadEngagement`, cache validator; stale `pendingMilestone` trap), `hooks/use-home-engagement.ts:77`, `hooks/use-home-leaderboard.ts` (model), `app/(tabs)/index.tsx:265-268` (one engagement read handed on), `app/_layout.tsx:106-136`, `app/(tabs)/checkin.tsx` (overlay stays on its tab, no shared flag needed), `services/leaderboard.ts:128-157` (service model), `services/loyaltySeen.ts` (fail-closed store), `services/visitDays.ts:11-41`, `hooks/use-calendar.ts:84` (drops `milestone`), `lib/calendarView.ts` (`DayCellView` ~93, label ~210-218, detail ~262-273, legend ~297, cache 323-395), `components/CalendarDayCell.tsx` (glyph slot ~45), `app/calendar.tsx:~175` (`LegendEntry`), `lib/calendarGrid.ts`, `hooks/use-at-risk-pulse.ts:8-24` (`useReduceMotion`; also holds `Animated.loop`), `app/pay-session.tsx:192` (Success haptic), `components/ui/Button.tsx`, `ui/Card.tsx` (radius override 24), `themed-text.tsx:71`. New: `lib/celebrationView.ts`, `services/milestones.ts`, `hooks/use-home-celebration.ts`, `components/CelebrationMiniMonth.tsx`, `app/celebration/[milestoneId].tsx` (wrap in `GymAccentColorProvider` as `calendar.tsx:25-31`; `typedRoutes` types may be stale: use the href form tsc accepts).
- Locales `locales/{en,fr}.json` 590-615 already hold `engage.celebration.*` (incl. empty mascot keys; `a11y` ends with a period); missing: `engage.calendar.legend.milestone`, `day.milestone7|30|100` (EXPERIENCE.md 658-664). `engage.test.ts` REQUIRED; tests use `makeT` over the real JSON (no .tsx tests exist, no renderer: pure view-model tests plus source scans only). `weeklyRing.source.test.ts` SCREEN_FILES 25-50, ARITHMETIC 68, layout slice 233-239.
- `docs/decisions.md` top entry (above 30.6); `deferred-work.md` (search for lines naming 30-7 before closing: none found at planning).

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0189_milestones_celebration.sql`, `scripts/rollback-0189-milestones-celebration.sql` -- award function, settle tail call, acknowledge function, state view, `my_visit_days`, derived/rebuild, grants, rollback -- server contract
- [x] `supabase/tests/engagement_milestones.test.sql` and the extended determinism, journey, facts, `my_visit_days`, `support_request_path` files -- every I/O row, caller matrix, cross-member and cross-gym isolation, the consumer scan shown failing against a mutant, the 35-before-2-after case -- gates reach their consumers
- [x] `packages/types/src/database.ts`, `services/milestones.ts` (+ test) -- type and service
- [x] `lib/celebrationView.ts` (+ test), `hooks/use-home-celebration.ts`, `components/CelebrationMiniMonth.tsx`, `app/celebration/[milestoneId].tsx`, `_layout.tsx`, `index.tsx`, the three sign-out sites -- celebration flow, shown-store, motion plan on and off
- [x] `use-calendar.ts`, `calendarView.ts` (+ test), `CalendarDayCell.tsx`, `calendar.tsx` -- marker, legend, label, detail line, cache
- [x] `locales/{en,fr}.json`, `engage.test.ts`, `weeklyRing.source.test.ts` -- keys, REQUIRED, scans (no loop or sound, no Share or badges, no second read)
- [x] `docs/decisions.md`, `deferred-work.md` -- dated entry, close any line naming 30-7

**Acceptance Criteria:**
- Given the epics.md Story 30.7 criteria and the I/O matrix, when the migration, pgTAP and Vitest run, then every listed server and screen state matches, in EN and FR.
- Given `release_week_start` NULL, when a member uses the app, then Home and the calendar are unchanged, no milestone fact exists and no celebration appears.
- Given any function other than `settle_engagement` calls `award_milestones`, or any function other than `acknowledge_milestone` raises the flag, or `check_in()`, `record_check_in` or `void_staff_check_in` change, then pgTAP fails.

## Implementation Notes

- Migration `0189_milestones_celebration.sql` and `scripts/rollback-0189-milestones-celebration.sql` (apply, rollback, apply, rollback, apply rehearsed on the local DB, left applied; number provisional). New pgTAP `engagement_milestones.test.sql` (142 assertions, includes the consumer scan and its mutants). Mobile: `services/milestones.ts`, `lib/celebrationView.ts`, `hooks/use-home-celebration.ts`, `components/CelebrationMiniMonth.tsx`, route `app/celebration/[milestoneId].tsx`, calendar marker (`use-calendar.ts`, `calendarView.ts`, `CalendarDayCell.tsx`, `calendar.tsx`).
- Existing tests edited (disclosed): `support_request_path.test.sql` E1 (spec), `engagement_settle.test.sql` pins 125-126 (the scan flagged the two new functions; the test text already named 30.7), `engagement_determinism.test.sql` test 53 and `engagement_journey.test.sql` `rows_of` now count week facts only (their fixtures give one member seven post-epoch days, so a milestone row now exists), `engagement_facts.test.sql` (real-call flag cases), `my_visit_days.test.sql` (April now returns milestone 7, marker assertions). `support_excluded_from_counts` needed no edit.
- Judgment calls: the "+2 text size" is a font scale of 1.3 (the bound where the Home ring card stacks); the push uses `as unknown as Href` because `.expo/types` is generated and stale; a failed gym read leaves the gym name empty (the sub line then reads "at ."; rare, never blocks closing); the epoch guard stays on `week` facts only (recorded in `decisions.md` and `deferred-work.md`).
- Verified by me after the subagent: mobile Vitest 802/802, `tsc --noEmit`, `check:i18n`, `check:migrations`. The subagent also ran the full local pgTAP suite (238/238) and the mutants listed above. NOT run: full `scripts/ci-local.sh` (needs a committed head), any device or browser pass.

## Spec Change Log

## Review Triage Log

Pass 1 (Blind Hunter 13 findings, Edge Case Hunter 16, Verification Gap 2 + 1 note; 3,931-line diff). No intent_gap, no bad_spec. Six patches, the rest rejected.

| # | Finding (layer) | Verdict | Evidence | Route |
|---|---|---|---|---|
| 1 | Android back before the card is visible records and acknowledges a milestone the member never saw; the screen waits on branding and mini-month network reads with no timeout and shows a blank screen with no button (BH x2, ECH) | medium | `[milestoneId].tsx`: `BackHandler` is registered at mount and `close()` calls `finishCelebration` regardless of `visible`; `dataReady` is set only after `Promise.all` of the shown read, `getGymBranding` and `getMyVisitDays`. | patch |
| 2 | Two independent reduce-motion reads; the screen's own read is discarded and the plan comes from `useReduceMotion()` which starts false, so a reduce-motion member can get the count-up and a second haptic (BH, ECH, VG) | medium | `motionKnown` ignores the resolved value (`.then(() => ...)`); the animation effect depends on `plan`. | patch |
| 3 | Expired, load-error and focused gating of the push is covered only by source scans; dropping `subscriptionStatus !== 'expired'` or `focused` keeps every test green (VG) | medium | Demonstrated by the layer; no renderer exists, so the pure parts are extracted and tested. | patch |
| 4 | Calendar milestone plumbing in `use-calendar.ts` is untested; deleting the `milestones` argument ships the MA-18 marker dead with green tests (VG) | medium | `calendarView.test.ts` builds `monthData` by hand; nothing runs the hook mapping or the cache fallback. | patch |
| 5 | The animated numeral is read aloud at intermediate values (BH) | low | The numeral `ThemedText` has role none but is not hidden from the tree; the spec calls it decorative. One-prop fix. | patch |
| 6 | Verify-block comment claims a flag scan it does not make; rollback header sentence garbled; `decisions.md` says nothing else was edited beside a list of edited pins (BH) | low | Comment-only corrections; the flag scan exists in `engagement_milestones.test.sql`. | patch |
| 7 | `my_visit_days` returns markers (and the legend lists Milestone) while the epoch is NULL (BH, ECH) | low | The calendar entry is client-gated on `enabled`; server reads of 30.5 and 30.6 carry no epoch check by the same decision (30.6 pass-1 item 9). | rejected |
| 8 | Epoch guard left to operator discipline (BH) | low | Spec decision: an existing test pins the guard to `week` facts; recorded in `decisions.md` and `deferred-work.md`. | rejected |
| 9 | Verify block does not scan for flag raisers or the single award call (BH, ECH) | low | Enforced by pgTAP (`engagement_milestones.test.sql` consumer scan, shown failing against mutants); only the comment was wrong (patch 6). | rejected |
| 10 | Shown-store write not awaited before navigating; `markShownAcked` is read-then-write; a late retry or lower stale entry can overwrite a higher one (BH, ECH x2) | low | Needs the engagement network read on Home to finish before an AsyncStorage write started earlier, or a store changed under a mounted screen; Home also clears its candidate after pushing. | rejected |
| 11 | Sign-out clears the retry record and is not awaited; forced sign-outs not covered (BH) | low | The spec says the shown-store is cleared at sign-out; the key carries user and gym. | rejected |
| 12 | Calendar cache keeps a stale star when a late visit moves the marker to another month (BH) | low | Needs offline viewing of the old month after the move; an online load of that month rewrites it; same shape as 30.5 cache rejections. | rejected |
| 13 | Milestone label replaces the Today and pending-sync wording on that cell (BH, ECH) | low | The spec and UX catalog define the milestone cell label as one form; composing needs new catalog keys. Owner call, noted in the final report. | rejected |
| 14 | `award_milestones` runs three offset scans per settle (BH) | low | Per-member rows, indexed, at most a few hundred; no measured cost. | rejected |
| 15 | Gym name unreadable gives "at ." (ECH) | low | Needs a failed one-row read right after a live engagement read; never blocks closing; fix adds catalog keys and branches. | rejected |
| 16 | `useReduceMotion` toggling on screen; timer fires mid-transition; `pending_milestone` not gated on `enabled`; callers of the dropped functions; transient null session; failed write plus failed ack; 30.2 pins edited (ECH, BH) | low / false | The effect cleanup clears the timer on every dependency change; the client treats a not-enabled row as dark; a full pgTAP run of 238 files found no runtime caller of the dropped functions; the pin edits are disclosed above and were forced by the new `milestone` fact rows. | rejected |

Patches 1-6 applied by the implementation subagent (re-engaged), verified by me: mobile Vitest 809/809, `tsc --noEmit`, `check:i18n`, `check:migrations`. Guards shown failing against mutants (expired check, focused check, marker mapping) before restore. One unrequested addition, accepted: the accessibility announcement waits up to 1 s for the gym name read so it never says "at ." with an empty name (this also narrows rejected item 15).

## Design Notes

- Milestone facts are decided once (the day of the Nth visit against the epoch) and never recomputed; only the calendar marker is derived live, so a late or voided visit moves the star but never the celebration.
- Hide-then-show order: the shown-store is written before the acknowledge call, so a failed call can only delay the server flag, never re-show the celebration. The server keeps `pending_milestone` until the ack lands; the shown-store suppresses it meanwhile.
- A void that drops the count below 7 is not comparable between the live fold and a rebuild (the fact survives, a rebuild would not award it): this is the stated "a void never reverses a milestone" rule, not a defect.

## Verification

**Commands:**
- `cd apps/mobile && npx vitest run && npx tsc --noEmit` -- expected: pass
- `pnpm run check:i18n && pnpm run check:claims && pnpm run check:migrations && pnpm run check:attendance-readers` -- expected: pass
- pgTAP: the new file, every `engagement_*`, `my_visit_days`, `support_*`, `suspension_rpc_coverage`, `attendance_counting`, then the full suite -- expected: all pass
- `bash scripts/ci-local.sh` -- expected: GREEN on the committed head (13-20 min; read per-stage lines)

**Manual checks (if no CLI):**
- None by me: the owner does browser and device QA once at the end of the epic.
