---
title: '30-4 Weekly ring and streak on Home'
type: 'feature'
created: '2026-11-23'
baseline_commit: 'd366f6887434cf9a1e48aa1f8ec73cb2a6fa6c46'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-30-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/epics.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `my_engagement()` and `open_engagement()` exist (30.3) but nothing shows them. Home has no ring, no weekly streak and no at-risk hint, and a member cannot see how close the week's goal is. Production is live and the epoch is NULL, so nothing may change for a member until the operator sets it.

**Approach:** A "This week" section on Home (heading row, goal button, one Card with the Goal Ring, streak chip, caption and footer), driven only by the server row. Pure logic (state choice, caption key, hours left, segments, offline overlay) lives in a tested `src/lib` view model; the card component is thin. The acceptance criteria of `epics.md` "Story 30.4" and the N1 section of `EXPERIENCE.md` are the authority; this spec adds the code map and the decisions below. No migration.

## Boundaries & Constraints

**Always:**
- `enabled` false, `unavailable`, or no result yet and no cache: the section does not render and Home is exactly today's Home (no skeleton flash for a dark epoch: the skeleton shows only while the first fetch runs and only if a cache for this member says `enabled`, or no cache exists and the fetch is in flight for at most 2 s).
- All wording through `t()` from `engage.*` in both locale files; no sentence in a `.tsx`. Keys this story adds, EN/FR parity, also added to the REQUIRED list of `src/locales/engage.test.ts`: `engage.atRisk.weekly`, `.hoursLeft` (plural), `.minutesLeft`, `engage.home.error`, `engage.home.settleError`, `engage.ring.a11y.progress` (plural, "Weekly goal: {{visits}} of {{goal}} visit days this week. {{count}} more visit closes your ring."), `engage.ring.a11y.met`, `engage.ring.cardHint` ("Double tap to open your calendar"). `engage.ring.goalHint.default` takes `{{count}}` (the goal in force; closes the 30.1 deferral that the copy hardcoded "3"), and `engage.test.ts` fails on a literal config value in the catalog.
- Numbers are the server's: `visitsThisWeek`, `goal`, `streakWeeks`, `streakIfMet`, `atRiskWeekly`. The card and view model import no date library, call no `Date` week or day arithmetic, and derive no count. Hours left = `dayEndsAt - serverNow` offset-corrected: `offset = Date.parse(serverNow) - fetchedAtDeviceMs`, `now = deviceNow + offset`, `left = dayEndsAt - now`; whole hours above 60 min (floor, minimum 1 h shown as "1 hour left" down to 60 min), minutes below. Recomputed every 60 s while Home is focused.
- Engagement is fetched once per focus: `getMyEngagement()`; if its row has `needsSettle`, then exactly ONE `openEngagement()` for that focus and the returned row is rendered as is. Never a loop on the flag; a failed settle keeps the last row and shows `engage.home.settleError`, retried only at the next focus. Pull-to-refresh calls `getMyEngagement()` and `openEngagement()` only when `needsSettle`.
- Last good row cached per member and gym in AsyncStorage (`gymos.engageHome.v1.<userId>.<gymId>`, try/catch, fails open as no cache). Offline: cached row, plus one dashed segment per queued scan from `getOfflineCheckIns()` whose `scannedAt >= cached dayStartsAt` (string-to-instant compare only, capped so filled plus dashed never exceeds goal), caption note `engage.ring.pendingSync`; the at-risk hint only while device time `< cached dayEndsAt`, never for a cache from an earlier day. No cache and no connection: `engage.home.error`.
- The expired member: the server already returns `atRiskWeekly` false; the view model also hides the hint when the row is a cache whose `dayEndsAt` has passed.
- Colours: segments `useGymAccentColor()`, complete and met `STATUS_COLORS.success`, hint `STATUS_COLORS.warning`, empty `theme.border`. Glyph beside every colour. Ring is one element, `accessibilityRole="progressbar"`, `accessibilityValue {min 0, max goal, now visits}`, label from `engage.ring.a11y.*`, arcs decorative. Hint: glyph `schedule`, polite live region announced once on focus (never `alert`, not re-announced as minutes tick), pulse via `Animated` opacity 1 to 0.45 over 1.6 s for three cycles on focus then static; with `AccessibilityInfo.isReduceMotionEnabled()` (and its change event) never animated, static 2pt warning outline instead. Stack the card (ring above text) under 360pt width or font scale above 1.3.
- Goal button: 44pt target, label `engage.ring.goalLabel` or, with `pendingGoal`, `engage.ring.goalPending` (date from `pendingEffectiveWeek` formatted by the existing `formatDayMonth` in `weeklyGoalSheet.ts`); opens `/goal`. The default-goal hint shows when `goalIsDefault` and `readGoalHintSeen(userId)` is false; tapping it calls `markGoalHintSeen`; opening the sheet already does (`goal.tsx`).
- Closes three deferrals that name this story (deferred-work.md): (1) Home also consumes `pendingToast` on focus and shows the same toast as Profile (one shared hook, so a goal saved from Home leaves nothing for Profile); (2) a Vitest source-scan pins that `goal.tsx` calls `markGoalHintSeen` and the card reads `readGoalHintSeen`; (3) one `openEngagement()` per focus, no loop (above).
- The Epic 31 slots (Shield chip, comeback card, daily chip, `nextShield` line) render nothing and leave no gap. A 0 streak with `bestStreakWeeks >= 1` shows `engage.streak.best` in place of the chip; a bare "0" is never rendered as a streak.
- Mobile Vitest, `tsc`, `pnpm run check:i18n`, `pnpm run check:claims` pass.

**Never:**
- No migration, no change to `engagement.ts` semantics, no new dependency (no test renderer: node-env Vitest only), no new tab or tab badge, no calendar route or leaderboard card, no `Date.now()`-derived "today". No mock designs or HTML previews (project rule).
- The card is not tappable as a whole in this story: `/calendar` does not exist until 30.5 (route absent would show an unmatched screen). The card's `onPress` is added by 30.5 (recorded in deferred-work.md as a 30.5 acceptance line).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Dark | `enabled` false | no section | N/A |
| Goal 3, 2 visits | in progress | 2 of 3 segments accent, "2 / 3", caption progress count 1 | N/A |
| Over goal | 5 visits, goal 3 | all success, check, "3 / 3", caption extra count 2 | N/A |
| Fresh week | 0 visits | "0 / 3", caption fresh, chip kept if streak >= 1 | N/A |
| Streak | 5 / 1 / 0 with best 8 / 0 with best 0 | "5 weeks in a row" / "First week done" / "Best: 8 weeks" / nothing | N/A |
| Release week | `inReleaseWeek` | ring only, caption `startsMonday`, no chip, no hint | N/A |
| First week | `hasSettledWeek` false | `firstWeek` line, no chip | N/A |
| At risk | hint true, 6 h left; 40 min | `atRisk.weekly` + "6 hours left"; "40 min left" | skewed phone clock still shows gym hours |
| Goal met | `goalMet` | success ring, `metStreak` with `streakIfMet`, chip shows settled count, no hint | `met` when no streak |
| Settle | `needsSettle` | one `openEngagement()`, skeleton at most 2 s | failure: last row + `settleError` |
| Offline | cache + 1 queued scan today | cached segments + 1 dashed, `pendingSync` | no cache: `engage.home.error` |

</frozen-after-approval>

## Code Map

- `apps/mobile/src/app/(tabs)/index.tsx` -- `HomeScreen`; quick actions end line 682, `<RewardsCard>` line 684 (new section goes between); `loadHome` line 195 plus `useFocusEffect` 424-429; Rewards best-effort fetch 361-370 is the model (detached, never trips `loadError`); no `RefreshControl` on its `ScrollView` (line 523): add one that calls the whole `loadHome`; offline banner 545-551.
- `apps/mobile/src/services/engagement.ts` (+ test) -- `Engagement`, `getMyEngagement`, `openEngagement`: unchanged.
- `apps/mobile/src/services/weeklyGoal.ts` -- `readGoalHintSeen` / `markGoalHintSeen`; `apps/mobile/src/lib/weeklyGoalSheet.ts` -- `formatDayMonth`, `TFn`; `apps/mobile/src/app/goal.tsx` 68-75 (writes the hint flag), route registered in `_layout.tsx` 138-141.
- `apps/mobile/src/lib/pendingToast.ts`, `app/(tabs)/profile.tsx` 91-110 and 674-680 (toast state, 3 s timer, style 769-779) -- extract into one hook used by Profile and Home.
- `apps/mobile/src/services/checkin.ts` 153 and `lib/sqlite.ts` 51-113 -- `getOfflineCheckIns()` returns `{id, scannedAt}` (device-wide, phone clock); `lib/offline-sync-context.tsx` exposes `isConnected`, `pendingCheckInCount` only.
- `apps/mobile/src/services/loyaltySeen.ts` -- AsyncStorage pattern to copy for the cache; `components/RewardsCard.tsx` -- card pattern, `useGymAccentColor`, polite live region (line 105); `components/ui/Card.tsx`, `ThemedText` (`statNumeral`, `small`, `smallBold`), `constants/subscription-status.ts` `STATUS_COLORS`; `react-native-svg` already used in `app/(tabs)/progress/index.tsx` 6. There is no Skeleton and no reduce-motion helper: build both small.
- `apps/mobile/src/locales/{en,fr}.json` `engage` block (line 496) and `locales/engage.test.ts` REQUIRED list; `scripts/check-i18n-key-parity.mjs`.
- New: `src/lib/weeklyRing.ts` (+ `.test.ts`), `src/components/WeeklyRingCard.tsx`, `src/components/GoalRing.tsx`, `src/hooks/use-focus-toast.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `apps/mobile/src/lib/weeklyRing.ts` + `.test.ts` -- pure view model: card state (loading, dark, error, release week, first week, default goal, pending goal, in progress, fresh, met, extra, at risk, settle failed, offline), caption key and count, streak area, segment list (filled, dashed, success), hours-left with skewed-clock fixtures, cache read/write, offline overlay; EN and FR fixture per state through a real i18next instance
- [x] `apps/mobile/src/components/GoalRing.tsx`, `WeeklyRingCard.tsx` -- svg ring, chip, caption, footer, skeleton, pulse and reduce-motion, stacked layout, a11y labels
- [x] `apps/mobile/src/app/(tabs)/index.tsx` -- heading row, goal button, card slot, once-per-focus fetch and settle, pull-to-refresh, minute tick, cache, Home toast hook
- [x] `apps/mobile/src/hooks/use-focus-toast.ts`, `profile.tsx` -- shared pending-toast hook
- [x] `apps/mobile/src/locales/{en,fr}.json`, `engage.test.ts` -- new keys, `goalHint.default` count, REQUIRED list, literal-config-value check
- [x] source-scan Vitest -- sentinel swap shows the sentinel; screen, card and ring files contain no literal sentence and import no date library; `goal.tsx` writes and the card reads the hint flag; one `openEngagement` per focus
- [x] `docs/decisions.md`, `deferred-work.md` -- dated entry; close the three deferrals; add the 30.5 card-tap line

**Acceptance Criteria:**
- Given the epics.md Story 30.4 criteria, when each state fixture of the matrix is rendered through the view model in EN and FR, then the ring, streak area, caption and footer match the N1 table.
- Given `enabled` false for every plan, when Home renders, then it is unchanged from today and no engagement call writes anything.

### Review Findings

Code review 2026-11-23 (bmad-code-review, second pass on the committed head fd2a8f1: Blind Hunter 15, Edge Case Hunter 13, Verification Gap 2, Acceptance Auditor 10). 1 decision-needed (resolved as a deferral, so 3 defer in total), 3 patch (all applied, mobile vitest 312/312, tsc clean, sheet-hint mutant caught), the rest rejected.

- [x] [Review][Decision] (resolved: deferred, reviewer's call at the owner's request; Home-wide change, recorded in deferred-work.md) The offline card is unreachable: Home's own queries run first and trip Home's error screen offline — medium. `apps/mobile/src/app/(tabs)/index.tsx:236-252` sets `loadError` and returns when the `users`, `gyms` or `members` query fails, before `loadEngagementForHome` (line 260) is called; the section lives inside Home's `!loadError && hasLoadedOnce` branch, and the cache key needs `gym_id`, which only the `members` query supplies. So on a real disconnect the cached ring, the dashed queued-scan segments and `engage.home.error` (epics 30.4 offline AC, spec Offline row) never show; the hook's own cached fallback is dead code in practice. Pass 1 (item 13) rejected this as "existing behaviour", which is true of Home's error screen but does not meet the AC. Options: (a) accept, and move the offline AC to a story that makes Home itself work offline; (b) read the engagement cache from a last-known `gym_id` kept on the device and render the section when Home's queries fail, which needs a decision on what Home shows around it. Sources: acceptance-auditor, edge-case-hunter.
- [x] [Review][Patch] The hours-left clock is not refreshed when a row arrives [`apps/mobile/src/hooks/use-home-engagement.ts:96`] — low. `deviceNowMs` only moves on focus and every 60 s, but `offset` is taken from `receivedAt`; after a pull to refresh (or a slow read) `left` is overstated by up to a minute ("1 hour left" shown at 59 minutes). Fix: `setDeviceNowMs(receivedAt)` where the row or dark outcome is committed. Source: edge-case-hunter.
- [x] [Review][Patch] The "closed" deferral entry buries two open Epic 31 items [`_bmad-output/implementation-artifacts/deferred-work.md:2282`] — low. The struck-through "Catalog wording hard-codes operator-tunable values" entry says the Shield explainer's "Every 4 weeks" (`shield_every_weeks`) and the missing `engage.streak.daily` plural are "still open for Epic 31", but they now sit only inside struck text. Add a live bullet for them (per the persistent rule that a deferral naming a later story is an acceptance line of that story). Sources: blind-hunter, edge-case-hunter.
- [x] [Review][Patch] The sheet's default-goal hint is only tested at goal 3 [`apps/mobile/src/lib/weeklyGoalSheet.test.ts:137`] — low. `weeklyGoalSheet.ts:149` now passes `{ count: goal.currentGoal }`, but every hint case uses the BASE fixture (goal 3), so passing a constant 3 keeps the suite green and brings back the "We started you at 3 days" bug this story closes. Fix: add cases with `currentGoalIsDefault: true` and `currentGoal` 4 ("4 days a week") and 1 ("1 day a week"). Source: verification-gap.
- [x] [Review][Defer] Home does not reload when the app resumes on Home after the gym's midnight or Monday [`apps/mobile/src/hooks/use-home-engagement.ts:120`] — deferred: low-medium, Home's whole data set has this shape (no AppState reload on the tab, `useFocusEffect` does not fire on resume); only the at-risk hint hides itself (left <= 0), the ring, caption and streak show the closed day or week until the next tab focus or a pull to refresh. Settle it with a device pass: background the app on Sunday night, open it Monday on Home. A fix is an AppState reload for the whole Home, which is a Home-level change. Source: edge-case-hunter.
- [x] [Review][Defer] The hook and toast hook have no behavioural test [`apps/mobile/src/hooks/use-home-engagement.ts`, `use-focus-toast.ts`] — deferred: already in deferred-work.md from the build; the verification-gap reviewer re-demonstrated mutants that pass (delete the cache write, the cached fallback or the `gym_id` select; drop the `latest()` guard). Fix with a pure reducer in `lib/weeklyRing.ts`. Sources: verification-gap, blind-hunter, edge-case-hunter.

**Rejected:**
- Skeleton not capped at 2 s when the cache says `enabled` (AA) — false: the spec holds the skeleton for the whole first read when a cache promises a card; the settle skeleton is capped (`weeklyRing.ts:381`).
- Skeleton swaps in on a refocus when the kept row still has `needsSettle` (ECH) — false: that is the spec's Settle row (skeleton at most 2 s), and a settled row has the flag false.
- Card derives `extra` and clamps `visitsNeeded` (AA) — rejected: recorded in decisions.md; the fix is to edit the frozen spec.
- First-week line hidden when the goal is met (AA) — rejected: pass-1 patch 4, deliberate; the fix is to edit the spec.
- `STATUS_COLORS.success/warning` keys do not exist (AA, BH) — rejected: documented in decisions.md; fix is to edit the spec.
- Spec `status: done` against sprint-status `review`, empty Change Log (AA, BH) — rejected: statuses are set by this step; a Change Log entry would edit the spec.
- Offline overlay suppressed in release week (AA) — low: the spec row says "ring only" for that week.
- Hint-flag scan reads the hook, not the card (AA) — low: the hook is the reader; the card only calls `onGoalHintPress`.
- Goal button missing on skeleton and error faces (AA) — low: spec silent, nothing to press yet.
- FR sentence "1 jours" for goal 1 (AA) — low: screen reader only, goal 1 only, and i18next cannot pluralise two numbers in one key.
- "Home is exactly today's Home" overstated for a dark epoch (BH) — low: wording in decisions.md; the extra read is inherent to the feature.
- A stale enabled cache survives an `unavailable` result; cache not cleared at sign-out (BH, ECH) — low: rare, device-local and keyed per user; the fix needs a new cache-removal function.
- Hint read twice by a screen reader; goal-hint target size and role (BH) — low: device-only, owner QA at epic end; the Pressable already has role button.
- Toast copy-paste, `alert` with `polite`, colours not theme-aware (BH) — low: same as pass-1 item 18, Profile's existing style.
- Source scans brittle, `LITERAL_CONFIG` narrow, lazy regex anchor (BH, ECH) — low: known (deferred-work), fix is more than a direct correction.
- `minutesLeft` plural, orphan `cardHint`, `default_other` sentinel (BH) — low: pass-1 item 21.
- Pull to refresh stops before the card loads on early return; `readGoalHintSeen` has no catch (BH) — false for the catch (`services/weeklyGoal.ts:131` try/catch); the early returns happen only when a newer load owns the spinner.
- Queued-scan times kept after reconnect (BH) — negligible: the view passes `NO_SCANS` while online and the next read replaces them within milliseconds.
- Cache validator checks the range of `goal` only (BH); live row with a goal outside 1..7 (ECH) — false for the live path (server enforces 1 to 7), low for a damaged cache.
- Engagement result discarded when a newer load exits early (ECH) — false in effect: that newer load sets `loadError`, so the section is not shown anyway.
- `settleFailed` not reset on a failed read (ECH) — false: the flag stays tied to the kept snapshot it was set for.
- Hint compares the raw device clock with `dayEndsAt` offline (ECH) — low: the spec says "device time < cached dayEndsAt".
- Queued scans counted past the cached week's end (ECH) — low: rare week boundary; the spec fixes the per-scan rule.

## Implementation Notes

## Spec Change Log

## Review Triage Log

Pass 1 (Blind Hunter 14 findings, Edge Case Hunter 14, Verification Gap 2). No intent_gap, no bad_spec; eight patches, two deferrals, the rest rejected.

| # | Finding (layer) | Verdict | Evidence | Route |
|---|---|---|---|---|
| 1 | Failed read shows the error card when the device cache says the epoch is dark (BH) | medium | `buildHomeEngagementView` checks `loadFailed` before `cachedEnabled`; any transient error on a dark gym shows "Couldn't load your week", against "Home is unchanged while dark". | patch |
| 2 | `busy` and the skeleton timer stick when a superseded load never reaches `loadForHome`; overlapping loads share one flag and timer (ECH, BH) | medium | finally and the timer gate only on `isCurrent()`; a newer `loadHome` that exits early leaves both set. | patch (hook-local sequence token) |
| 3 | Hint "Visit today" still shows after an offline scan queued today (ECH) | low | Real; one-line condition. | patch |
| 4 | "Close your ring to start your streak" beside a closed ring and "Goal met" (ECH) | medium | `hasSettledWeek` false and `goalMet` true is a normal first week. | patch |
| 5 | FR accessibility sentence prints "1 jours" and "0 jours" (BH) | low | Real; screen-reader only. `minutesLeft` "1 min restantes" left as the UX catalog has it. | patch (a11y wording only) |
| 6 | AtRiskHint announces twice and restarts the pulse when reduce-motion resolves after mount (BH, ECH) | medium | The effect depends on `reduceMotion`, set asynchronously after mount. | patch |
| 7 | Cache validator accepts `goal` 0 or 99; `arcPaths` divides by it (BH, ECH) | low | Server enforces 1 to 7, so only a damaged cache; one-line range check. | patch |
| 8 | Source scan slice ends at a comment that stripComments removed, so it runs to end of file (ECH) | low | `indexOf('// The device cache')` on stripped text is -1. | patch |
| 9 | Hook sequencing (cache write, cached fallback, settle flag, hint dismissal, queued overlay) and the toast hook are checked only by source regexes (VG) | medium | True; no renderer by decision. A pure reducer would make it testable. | defer |
| 10 | Offline overlay counts scans, not visit days, and ignores `visitedToday` (BH) | low | Matches the frozen spec's per-scan wording; rare (a second scan the same day); transient until sync. Already in deferred-work.md. | rejected |
| 11 | Card does not refresh when connectivity returns while Home stays focused (BH, ECH) | low | Spec says counts are corrected on the next focus or pull; scanning happens on another screen, so Home refocuses. | rejected |
| 12 | Cached row from an earlier day or week shows last week's ring as this week (ECH) | medium (unverified) | Spec says show the last stored result; deciding a week has passed needs date arithmetic the spec forbids on the device. Would be settled by a cache older than its `weekEnd` on a real phone. | defer |
| 13 | Engagement load never runs when Home's own queries fail offline (ECH) | false | The section lives inside Home's own `hasLoadedOnce` gate; Home shows its own error without data, existing behaviour. | rejected |
| 14 | Cache and snapshot reused across users on one mounted hook (ECH) | low | Sign-out leaves the tabs layout; no path keeps the hook mounted across accounts. | rejected |
| 15 | Device-wide offline queue draws another account's scans (ECH) | low | The queue has no member column (Epic 4 design); two accounts with queued scans on one phone is not an everyday case. | rejected |
| 16 | Hours left biased by network latency (BH) | low | A few seconds on an hour-grained display. | rejected |
| 17 | Minute tick re-renders all of Home (BH) | low | One cheap render a minute while focused; moving the tick costs a restructure. | rejected |
| 18 | Success and warning colours in light mode, hard-coded toast colours, role alert with polite (BH) | low | Same constants and toast styling as Profile and `StatusBadge`; the app theme is dark. | rejected |
| 19 | No telemetry for swallowed failures (BH) | low | Best-effort by spec; the settle failure line is visible to the member. | rejected |
| 20 | `captionFor` derives `extra` and clamps `visitsNeeded` (ECH claim) | false | No server field for extra visits exists and the AC asks for the caption; the clamp avoids "0 more visits". | rejected |
| 21 | Orphan `engage.ring.cardHint`, default-goal hint target size, node shims, "93 cases" in decisions.md, epics.md edit in the diff (BH, ECH) | low | The key is required by the spec for 30.5; the epics.md edit is the recorded 30.3 reconciliation. The test count is removed with the patches. | rejected |

## Design Notes

- No render tooling exists, so the AC's "component test" and "rendered in EN and FR" are met by a pure view model tested with fixtures through a real i18next instance, plus source scans for the no-literal, no-date-library, hint-flag and single-settle rules. The card component holds no logic beyond layout.
- `epics.md` Story 30.3 wording was reconciled with the owner-approved candidate and `needs_settle` rule on 2026-11-23 (closes that deferral) and `epic-30-context.md` touched to stay valid.

## Verification

**Commands:**
- `cd apps/mobile && npx vitest run && npx tsc --noEmit` -- expected: pass
- `pnpm run check:i18n && pnpm run check:claims` -- expected: pass
- `bash scripts/ci-local.sh` -- expected: GREEN on the committed head (13-20 min)

**Manual checks (if no CLI):**
- None by me: the owner does browser and device QA once at the end of the epic.
