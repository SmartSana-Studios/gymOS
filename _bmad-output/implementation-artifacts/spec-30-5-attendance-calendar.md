---
title: '30-5 Attendance calendar'
type: 'feature'
created: '2026-11-23'
baseline_commit: '31b4f78c51106b5a5f9e887ceb9404bcf0360444'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-30-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/epics.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A member has no view of the days they came. Home shows only this week's ring, `my_engagement()` already says when today is "at risk", and `member_visit_days` already holds every counted day, but no function returns them to a member and no screen draws them. Production is live and the epoch is NULL, so nothing may change for a member until the operator sets it.

**Approach:** Migration `0187` adds `public.my_visit_days(p_month)` and `public.my_first_visit_day()`. A pushed `/calendar` route (MA-18) draws the month from them, with today's cell and an at-risk line read from `my_engagement()`. Pure logic (grid, cell states, labels, hours left, cache) lives in tested `src/lib` files and the components stay thin, as in 30.4. The criteria of `epics.md` "Story 30.5" and the MA-18 section of `EXPERIENCE.md` (lines 2088-2145) are the authority; this spec adds the code map and the decisions below.

## Boundaries & Constraints

**Always:**
- Both functions follow `my_engagement()`: `language plpgsql stable security definer set search_path to 'public'`, caller resolved live (role `member`, own non-deactivated member row, `private.current_gym_status() = 'active'`), an empty result at every failed step, `revoke execute ... from public, anon, service_role` then `grant execute ... to authenticated`. No member id parameter. Neither is registered in `private.support_capabilities`.
- `my_visit_days(p_month date)` returns `(visit_day date, milestone smallint)`: distinct `visit_day` from `public.member_visit_days` with `visit_day >= p_month and visit_day < p_month + interval '1 month'`, `milestone` NULL on every row, ordered by day. Date comparison only, no timezone arithmetic. `p_month` not the first of a month, or after `date_trunc('month', private.gym_today(gym))`, raises `invalid_month` (errcode `22023`, as `set_weekly_goal` does `invalid_goal`). A month with no visits returns no rows. `my_first_visit_day()` returns `min(visit_day)` or NULL.
- Class-only attendance (`class_bookings.attended_at`) never lights a day; a voided check-in never does; a staff check-in and a late offline visit light their own `visit_day`. A timezone change never moves a stored day.
- New `engage.calendar.*` keys in both locale files with EN/FR parity (i18next `{{count}}` and `_one/_other`, not the UX doc's ICU), all added to the REQUIRED list of `src/locales/engage.test.ts`. No sentence in a `.tsx`. Reuse `engage.atRisk.weekly`, `.hoursLeft`, `.minutesLeft` for the at-risk line. Keys beyond the UX catalog (`calendar.cell.hours` "{{count}} h", `.cell.minutes` "{{count}} m", `.week.a11y` plural "Week of {{date}}, {{count}} visit days", `.heading.a11y`, `.day.today.visited`, `.day.today.none`, retry label if no common one exists) are decided here and recorded in `decisions.md`. The legend carries Visited and Today only; the milestone and Shield keys belong to 30.7 and Epic 31.
- Grid, month and weekday labels are plain `date` arithmetic on `YYYY-MM-DD` strings in one pure file (`src/lib/calendarGrid.ts`): no device timezone, no `Date.now()` for the month shown, formatting through `Intl` with `timeZone: 'UTC'` (reuse `intlLocale` and `formatWeekdayDayMonth` from `weeklyGoalSheet.ts`, export `parseDateOnly` if needed). Weeks start Monday. "Today" is `gymToday` from `my_engagement()`; the next chevron and the server's refusal both follow the gym month.
- At-risk cell and line: shown when `getMyEngagement()` has `atRiskWeekly && !visitedToday && !inReleaseWeek && !goalMet` (the `hintFor` rule), on the current month only. Hours left from `dayEndsAt` and the `serverNow` offset via `msLeftInDay` and `timeLeftParts`, recomputed every 60 s while focused; polite live region announced once on focus, never `alert`; three-cycle pulse then static, static 2pt outline under reduce motion. Extract `AtRiskHint`, the pulse and the reduce-motion check from `WeeklyRingCard.tsx` into shared files (no behaviour change to Home) rather than copying them; export `hintFor`. The calendar calls `getMyEngagement()` only, never `openEngagement()`.
- Offline: each loaded month is cached per member and gym in AsyncStorage (try/catch, fails open), cached months render under `engage.calendar.offline`, an unloaded month shows `engage.calendar.offline.none` and a retry. A scan queued today (`queuedTodayCount(row.dayStartsAt, scans) > 0`) lights today dashed with the detail line `engage.calendar.day.pending`, only when `!visitedToday` (closes the 30.4 deferral about a dashed segment beside a visited day).
- Closes the deferral naming this story: the whole "This week" card on Home opens `/calendar` (`onPressCard` on `WeeklyRingSection`, card-level `accessibilityRole="button"`, `engage.ring.cardHint`), with the goal button and goal hint staying separate targets. The Profile Training card gets a "My visits" row (label `engage.calendar.title`, pushes `/calendar`) inside the card's existing gate, as the epic's first criterion says "from the Profile" although the UX spec lists no such row.
- Decided (owner, 2026-11-23): the NFR-029 load figure for `my_visit_days` (two years of attendance at the largest tier's member cap) moves to Story 30.6, whose load script records it; `deferred-work.md` gets a 30.6 acceptance line for it. 30.5 notes only a one-off local timing in Implementation Notes and its Definition of Done does not wait on 30.6.
- Mobile Vitest, `tsc`, `pnpm run check:i18n`, `pnpm run check:claims`, `pnpm run check:migrations`, full `pgtap` and `scripts/ci-local.sh` pass. Add `'my_visit_days'` and `'my_first_visit_day'` to the E1 array of `support_request_path.test.sql` (both call `current_gym_status()`).

**Never:**
- No milestone star, Shield marker or "Your month" link (30.7, Epic 31). No check-in time anywhere. No new dependency, no new tab or tab badge, no change to `engagement.ts` semantics, no `.from("attendance_events")` in app code (`check:attendance-readers`). No mock designs or HTML previews (project rule).
- The screen never remembers the month viewed and never calls `openEngagement()`. Swipe uses RN `PanResponder`, no gesture library.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Live member, month with visits | first of month, 3 stored days | 3 rows, `milestone` NULL, summary "3 visit days in November" | N/A |
| Month without visits | past or current | no rows; `empty.past` / `empty.current`, grid still drawn | never an error |
| Bad month | 2026-11-15, or next gym month | `invalid_month` 22023 | screen only sends first-of-month and never a future month |
| Not a live member | Owner, staff, support, anon, deactivated, suspended gym, other gym | no rows; other gym's days never visible | N/A |
| Class-only day, voided check-in | `attended_at` set / `voided_at` set | day not lit | N/A |
| Late offline visit | synced next week for a past day | that past day lit on next load, no message | N/A |
| Timezone change | 23:30 visit, owner moves `gyms.timezone` | same `visit_day` before and after | pgTAP case |
| Today at risk | `atRiskWeekly`, not visited | warning outline, `schedule` glyph, "6 h" / "45 m", line under grid | expired member: flag false, no cell |
| Today visited / not visited | rows contain / lack `gymToday` | lit plus outline / outline only | N/A |
| First visit bound | `my_first_visit_day()` NULL or a date | previous chevron disabled at that month, or current month if NULL | N/A |
| Offline | cached month / unloaded month / queued scan today | cached grid plus banner / `offline.none` plus retry / dashed lit today, "Waiting to sync" | N/A |
| Engagement not a success or not `enabled` | dark epoch, unreachable normally | `engage.calendar.error` in the grid slot (no `gymToday`, so no grid) | pull to refresh |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0173_attendance_counting.sql:118-132` -- `attendance_counted`, `member_visit_days` (select distinct member_id, gym_id, visit_day; `security_invoker`); read the view, never `attendance_events`.
- `supabase/migrations/0186_engagement_settle_triggers_state_view.sql:918-989` -- `my_engagement()`: the live-member resolution and revoke/grant to copy; `0184:207-300` `set_weekly_goal` for the 22023 error style. `private.gym_today(uuid)` is `0157:20`.
- New: `supabase/migrations/0187_attendance_calendar.sql` (number assigned at merge time; head is 0186 local) opens `set local lock_timeout = '5s';` and names its rollback; `scripts/rollback-0187-attendance-calendar.sql`.
- `supabase/tests/weekly_goal.test.sql`, `weekly_goal.negative.test.sql`, `engagement_rpc.test.sql` (caller matrix, args, stability, secdef, search_path, grants), `attendance_counting.test.sql:209-216` (timezone change) -- copy structure for new `my_visit_days.test.sql` and `my_visit_days.negative.test.sql`; fixture ids `00000000-0000-0000-0039-...` pattern. `support_request_path.test.sql:~228-236` E1 array gets the two names.
- `packages/types/src/database.ts` -- hand-splice `my_first_visit_day` (`Args: never`) and `my_visit_days` (`Args: { p_month: string }`) before `my_weekly_goal` (~3947).
- New: `apps/mobile/src/services/visitDays.ts` (+ `.test.ts`) -- `getMyVisitDays(month)`, `getMyFirstVisitDay()`, modelled on `services/engagement.ts` and `weeklyGoal.ts`.
- `apps/mobile/src/lib/weeklyRing.ts` -- reuse `msLeftInDay` (33), `timeLeftParts` (42), `queuedTodayCount` (89), `TICK_MS`, cache helpers pattern (`engagementCacheKey` 146); export `hintFor` (~340). `src/lib/weeklyGoalSheet.ts:60-87` -- `intlLocale`, `formatWeekdayDayMonth`.
- `apps/mobile/src/components/WeeklyRingCard.tsx` -- `AtRiskHint` (124-193, private), reduce-motion inline (133-145), `WeeklyRingSection` (28, props 18-23, Card at 56, "not tappable yet" comment 25-27); Home call site `src/app/(tabs)/index.tsx:706`.
- `apps/mobile/src/hooks/use-home-engagement.ts` -- shape to mimic for a calendar hook (seq guard, focus tick 123-129, offline scan read 134-147 with `Platform.OS === 'web'` guard); gym id source as it reads it.
- `apps/mobile/src/app/_layout.tsx:148` -- register `<Stack.Screen name="calendar" />` inside the `isFullyOnboarded` group like `workout-plan`; header pattern `src/app/workout-plan.tsx:259-272` (own header in `SafeAreaView`, `common.back`), default export wrapped in `GymAccentColorProvider`, `useOfflineSync()` for `isConnected`.
- `apps/mobile/src/app/(tabs)/profile.tsx:546-571` -- Training card, Weekly goal row pattern (`goalRow`, `IconChip`, chevron) for the new row.
- Tests: `src/lib/weeklyRing.test.ts` (real i18next instance, `makeT`), `src/lib/weeklyRing.source.test.ts` (source scans; `ARITHMETIC` rule forbids date arithmetic in screen files, so keep it all in `calendarGrid.ts` and give that file its own scan that bans `Date.now`, `new Date(` without UTC and local-time getters), `src/locales/engage.test.ts` REQUIRED list (line 11). There is no renderer and no `__snapshots__`: "snapshot-tested" is met as in 30.4, by a pure view model asserted with `toEqual` per cell state in EN and FR.
- New: `src/lib/calendarGrid.ts`, `src/lib/calendarView.ts` (cell states, labels, summary, detail line, chevron bounds, offline/queued overlay, cache read/write) each with `.test.ts`; `src/components/CalendarGrid.tsx`, `CalendarDayCell.tsx`, `AtRiskHint.tsx`; `src/hooks/use-at-risk-pulse.ts`, `use-calendar.ts`; `src/app/calendar.tsx`.
- `apps/mobile/src/locales/{en,fr}.json` `engage` block; UX copy to translate: EXPERIENCE.md 643-671. `deferred-work.md` lines 2305-2306 (the card `onPress` line) and 2308-2309 (dashed overlay beside a visited day).

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0187_attendance_calendar.sql`, `scripts/rollback-0187-attendance-calendar.sql` -- the two functions, revokes, grants, rollback -- server contract
- [x] `supabase/tests/my_visit_days.test.sql`, `.negative.test.sql`, `support_request_path.test.sql` -- shape, month filter, class-only and voided not lit, staff and late visit lit, pre-release history, 23:30 across a timezone change, bad months, caller matrix for BOTH functions (Owner, manager, supervisor, receptionist, coach, support, anon, no gym claim, deactivated, suspended, member of another gym), E1 array -- gate reaches both consumers
- [x] `packages/types/src/database.ts`, `src/services/visitDays.ts` (+ test) -- types and service
- [x] `src/lib/calendarGrid.ts`, `calendarView.ts` (+ tests, EN and FR fixture per cell state and screen state) -- pure model
- [x] `AtRiskHint.tsx`, `use-at-risk-pulse.ts`, `WeeklyRingCard.tsx`, `weeklyRing.ts` -- extract and export, add `onPressCard`; Home passes `router.push('/calendar')`
- [x] `CalendarGrid.tsx`, `CalendarDayCell.tsx`, `use-calendar.ts`, `app/calendar.tsx`, `_layout.tsx`, `profile.tsx` -- screen, route, Profile row, pull to refresh, swipe, cache
- [x] `locales/{en,fr}.json`, `engage.test.ts`, `weeklyRing.source.test.ts` -- keys, REQUIRED list, scans for the new files, hint-flag-style scan that the Home card and Profile row push `/calendar`
- [x] `docs/decisions.md`, `deferred-work.md` -- dated entry; close the card-tap and dashed-overlay deferrals; add the 30.6 load-figure line per the answer to Open Question 1

**Acceptance Criteria:**
- Given the epics.md Story 30.5 criteria and the I/O matrix, when each cell state and screen state is built through the view model in EN and FR, then the grid, summary, legend, detail line, at-risk line and accessibility labels match MA-18.
- Given `release_week_start` NULL, when a member uses the app, then Home and Profile are unchanged and neither calendar function is called.
- Given the E1 array and the caller-matrix tests, when a new consumer of `current_gym_status()` appears without the role check first, then pgTAP fails.

## Implementation Notes

- Migration `0187_attendance_calendar.sql` and `scripts/rollback-0187-attendance-calendar.sql` are applied to the local database (psql, in one transaction; the local `schema_migrations` table is stale from 0181 on, so no tracking row was written). The number is provisional until merge.
- pgTAP: `my_visit_days.test.sql` (45), `my_visit_days.negative.test.sql` (38), E1 array in `support_request_path.test.sql` extended; `support_capabilities.test.sql` unchanged and green.
- Deviations from the spec text: (1) `engage.calendar.offline` and `engage.calendar.offline.none` cannot both exist in nested JSON, so the banner key is `engage.calendar.offline.banner`; (2) the Profile Training card has no gate (the Weekly goal row has always shown), so the "My visits" row is gated on `getMyEngagement()` returning `enabled`, which keeps Profile unchanged while the epoch is NULL; (3) `CardView` gained `cardHint` and `cardLabel` (the card-level button's hint and one label), so the "Epic 31 slots" key-list test was updated; (4) `.gitignore`d `.expo/types/router.d.ts` was regenerated locally (`regenerateDeclarations`) so `tsc` knows `/calendar`.
- One-off local timing (not the NFR-029 figure, which moves to 30.6): 1,000,000 attendance events over 2,000 members and two years in a rolled-back transaction, `my_visit_days(month)` 13 to 23 ms and `my_first_visit_day()` about 13 ms per call as timed through psql by a member under `authenticated`.
- Verified: mobile Vitest, `tsc --noEmit`, eslint on the new files, `check:i18n`, `check:claims`, `check:migrations`, `check:attendance-readers`, the new and affected pgTAP files. See the build report for the full `scripts/ci-local.sh` result.
- Not done by me: any device or browser pass (the owner does it at epic end).

## Spec Change Log

## Review Triage Log

Pass 1 (Blind Hunter 13 findings, Edge Case Hunter 14, Verification Gap 5; 212 KB diff). No intent_gap, no bad_spec (the queued-scan gate deviates from a clear spec line, so it is a plain implementation bug: a patch). Seven patches, three deferrals, the rest rejected.

| # | Finding (layer) | Verdict | Evidence | Route |
|---|---|---|---|---|
| 1 | A scan queued today does not light today when `goalMet` or `inReleaseWeek`, and not when a past month is on screen (ECH, BH, VG) | medium | `calendarView.ts:184` gates `queued` on `!goalMet && !inReleaseWeek` (copied from the ring) and `viewingCurrent`; the spec says only `!visitedToday`. A visit calendar is not capped by the ring goal; on a past month the detail line says "no visit yet" for a queued visit. | patch |
| 2 | `pg_temp.days(prev month) is not null` can never fail (ECH, BH) | low | `days()` returns `''` or `sqlstate:message`, never NULL (my_visit_days.test.sql:176); a wrongly refused previous month would pass. One-line fix. | patch |
| 3 | A failed pull-to-refresh engagement read with no Home cache nulls a good live snapshot and the grid swaps to a message (ECH) | medium | `use-calendar.ts:135-141`: the else branch leaves `next` null and `setSnapshot(next)` replaces the live row. | patch (keep the last snapshot) |
| 4 | A server error while connected shows "isn't saved on your phone. Connect to see it" (BH) | medium | `offline = !isConnected \|\| loadFailed` feeds `faceFor`, which returns `offlineNone` for an unusable snapshot when offline; the `error` face is unreachable on a connected failure. | patch (face follows connectivity only) |
| 5 | Calendar cache read-modify-write races (month write vs first-visit write, two month writes) (ECH) | low | `update()` does getItem then setItem with no ordering; two overlapping writes drop one. Consequence is a month missing from the offline copy, never wrong data; fix is a four-line serial queue. | patch |
| 6 | The Home card's one button label omits the caption, streak chip, pending-sync note and settle error (ECH claim) | medium | `weeklyRing.ts:425` builds `[title, ringLabel, hint.label]` while its doc comment says it includes the caption; a screen reader lost the streak and caption that were read before 30.5. | patch |
| 7 | The Profile row's `enabled` gate is checked only by a source regex; dropping `&& result.engagement.enabled` keeps every test green (VG) | medium | Only `weeklyRing.source.test.ts` matches the source text; AC 2 (dark epoch leaves Profile unchanged) rests on it. | patch (pure `showMyVisitsRow` plus unit test) |
| 8 | The screen does not follow gym midnight while open; the tick only updates the device clock (BH, ECH) | medium | `use-calendar.ts` tick; same shape as the Home deferral recorded in 30-4 (no AppState or `dayEndsAt` reload). | defer |
| 9 | Week group label is a 1x1 `opacity: 0` text that VoiceOver may skip (BH) | maybe-false (would be medium) | Cannot tell without a device; settle with a VoiceOver pass on the calendar. | defer |
| 10 | `use-calendar.ts` transitions (stale month answer, cache fallback, `shift` bounds, reconnect) have no executed test (VG, BH) | medium | Already recorded in 30.5's deferred-work entry; mutants demonstrated by VG (drop the `current()` guard). A pure reducer would make it testable. | defer |
| 11 | Today lit/summary inconsistent when `visitedToday` is true but the cached month lacks today; week count includes a queued-only today, the summary does not (ECH, VG) | low | Needs an offline open after an online visit with a month cached earlier the same day; fix touches lit, summary and week counts together. | rejected |
| 12 | Reconnect keeps a stale cached month instead of the gym month (ECH) | low | Needs a Home cache from an earlier month; rare, fix adds branches. | rejected |
| 13 | `invalid_month` after a gym timezone change while the screen is open treated as a generic failure (ECH) | low | Needs the Owner to move the timezone backwards across a month edge during the session. | rejected |
| 14 | "My visits" row hides offline, adds a second engagement read per Profile focus, pops in (BH, ECH) | low | Recorded in decisions.md as the gate decision; offline access to the calendar via Home is already a 30-4 deferral. | rejected |
| 15 | Damaged cached `gymToday` crashes the calendar (ECH) | low | Needs corrupted AsyncStorage; 30-4 rejected the same shape for the ring. | rejected |
| 16 | Calendar cache survives sign-out (BH) | low | Keyed per user and gym, device-local; the ring cache has the same rule and 30-4 rejected it. | rejected |
| 17 | `my_first_visit_day` typed `Returns: string` (BH, VG) | false | The Supabase generator emits `string` for scalar functions whatever the nullability; the service handles null. | rejected |
| 18 | Service `isDateOnly` is looser than the grid's (BH) | low | The server returns a Postgres `date`, always valid. | rejected |
| 19 | Support caller's empty answer is "equally explained by no data" in the negative pgTAP (BH) | low | Support has no `members` row either way; E1/E2 in `support_request_path.test.sql` pin role-before-status. | rejected |
| 20 | `splitSummary` uses `indexOf(count)`; 10pt hours text does not scale; summary hidden from assistive tech; literal "←" back control (BH) | low | Count is the first token in both locales and month names have no digits; 10pt is the spec's size; the heading label carries the summary; "←" is the `workout-plan` header pattern. | rejected |
| 21 | `epic-30-context.md` wording changes unrelated to 30.5 (BH) | low | A regenerable compile output from step 1, not a code change. | rejected |

## Design Notes

- Today comes from `my_engagement()` because the two calendar functions return no date; when engagement is not a success, the calendar cannot place today, so it shows its error face instead of guessing from the phone clock.
- Cell text, week labels and the month heading are formatted from `YYYY-MM-DD` strings with `Intl` pinned to UTC, so no phone timezone can move a day. The server never converts a date either: `visit_day` is stored at insert.

## Verification

**Commands:**
- `cd apps/mobile && npx vitest run && npx tsc --noEmit` -- expected: pass
- `pnpm run check:i18n && pnpm run check:claims && pnpm run check:migrations` -- expected: pass
- `bash scripts/ci-local.sh` -- expected: GREEN on the committed head (13-20 min)

**Manual checks (if no CLI):**
- None by me: the owner does browser and device QA once at the end of the epic.
