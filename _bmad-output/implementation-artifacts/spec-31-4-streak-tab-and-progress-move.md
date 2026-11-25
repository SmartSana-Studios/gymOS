---
title: '31-4 Streak tab replaces the Progress tab; Progress moves to Profile'
type: 'feature'
created: '2026-11-24'
baseline_commit: '78b0894b8da35c452ffcc2931f65c4818f53eefc'
status: 'done'
route: 'dispatch'
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-31-context.md'
  - '{project-root}/scripts/epic30-31-qa/README.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The whole engagement area (ring, streak, Shields, comeback, leaderboard card) sits in the middle of Home, below the quick actions and above Rewards and Recent Activity, so a member with history scrolls past it. The owner wants the streak to be a first-class destination: a Streak tab in the place of the Progress tab, with Progress (body measurements and photos) reached from Profile.

**Approach:** Owner decisions (2026-11-24). (1) New Streak tab `(tabs)/streak` is a hub: the This week ring and streak, Shield chip and notices, comeback card, the Leaderboard card, an inline attendance calendar, and a Badges entry. (2) Home keeps one small streak line that opens the tab; the This week section and the Leaderboard card leave Home. (3) Progress leaves the tab bar for good (owner, 2026-11-24, renegotiating the first draft: "we're simply removing it from the menu into the profile"): it is a Profile row, always shown, and its screens move out of the tab group to normal stack routes with the same URLs, because a hidden native tab cannot be navigated to. (4) The Streak tab is shown only while the engagement area is on; when it is dark or unknown the bar has four tabs (Home, Check In, Classes, Profile). Mobile only: no migration, no server change.

## Boundaries & Constraints

**Always:**
- Tab bar, in every state: Home, Check In, Classes, Streak, Profile. No tab is `hidden`; there is no Progress tab in any state. Same on the web tab file.
- One gate, `lib/engagementGate.ts`: a tiny subscribable store with `on | off | unknown`. It starts from the device copy (`readEngagementCache`) for the signed-in member, is set to `on` by an engagement `row` outcome and to `off` by a `dark` outcome (a failed or offline read changes nothing), and is reset to `unknown` on sign-out and on a member change. Its consumers are the Home streak line and the Streak screen (the tab bar no longer reads it: the Streak tab is always present); a test enumerates them and fails when a screen reads the engagement flag any other way. (Profile keeps its own `engagementEnabled` for its older rows; the Progress row does not use the gate.)
- The Streak screen reuses, unchanged: `WeeklyRingSection` and its props (goal button to `/goal`, goal hint, notice dismissal), `useHomeEngagement`, `LeaderboardHomeCard` with `useHomeLeaderboard` (opens `/leaderboard`), `useCalendar`, and `useBadgeRows`. The calendar body (month bar, summary, grid, legend, day selection, swipe) is extracted from `app/calendar.tsx` into `components/CalendarPanel.tsx`, used by both the full screen `/calendar` (still reachable from Profile) and the hub; behaviour and wording unchanged.
- Order on the hub, top to bottom: ring section (card taps still open `/calendar`), Leaderboard card, calendar panel, a Badges row ("n of 5", opens `/badges`). Pull to refresh reloads all four. All wording from the locale files, EN and FR parity.
- Home keeps `useHomeEngagement` (the celebration, the settle and the gate need that one read) and `useHomeCelebration` exactly as now. The celebration is still pushed over Home. Home renders `HomeStreakLine` only for a `card` view: "3-week streak" (or "1 of 3 this week" when no streak is active), one row, 44 pt target, opens `/streak`. No line when hidden, dark, loading or error.
- Profile: a "Progress" row, always shown for a member, in the Training card (it is shown outside the `engagementEnabled` block; the Training card itself must render for a dark gym with this one row), opens `/progress`. The Progress screens (`progress/index`, `progress/entries`, `progress/photo/[id]`) move from `app/(tabs)/progress/` to root `app/progress/` with their content, data and services unchanged and the same URLs; opened from Profile they have a Back header and no tab bar. Existing `router.push('/progress/...')` calls inside them keep working.
- Tab label "Streak" comes from the locale (FR "Série"); the other labels stay as they are.
- Calm tone rules from Epics 30 and 31 apply to every new string.

**Never:**
- Any server, migration, RPC or fact change; any change to the Progress screens' content, data or services beyond moving them and adding the Back header; any change to the celebration, the leaderboard screen, the badge shelf, the share flow or the goal sheet.
- A hidden tab, or a tab that appears or disappears with the gate. A Progress tab in any state.
- A second engagement read cache, a new storage key for engagement data, or a push deep link (N-08 still opens Home).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Engagement on | gate `on` | Five tabs including Streak; Home shows the streak line, no ring section, no Leaderboard card; Profile shows the Progress row | N/A |
| Dark gym | epoch NULL, gate `off` | Five tabs; the Streak hub shows the heading and one calm line ("Your weekly streak is coming soon." / FR equivalent) with the ring, board card, calendar and Badges row absent; no Home streak line; Home otherwise as before except no Progress tab; Profile shows the Progress row | N/A |
| Cold start, no device copy | gate `unknown` | Five tabs; the hub shows the same calm line until the first read answers, then the real hub if it returns `row` | a failed read leaves the calm line |
| Offline start, device copy on | cache says enabled | Streak tab from the device copy; hub shows the cached ring and calendar banners as today | existing offline faces |
| Member signs out and another signs in | gate reset | `unknown` until the new member's copy or read | N/A |
| Open Progress from Profile | tap the row, any gate state | the Progress screens open as a stack screen with a Back header; Back returns to Profile; entries and photo screens open and go back as before | N/A |
| Deep link or old bookmark to `/progress` | any gate state | the Progress screens render | N/A |
| `/streak` opened while the gate is `off` or `unknown` | tab or deep link | the calm line, with no Back arrow needed because the tab bar is there (keep a Back arrow only when the screen was opened by a link with no tab bar) | N/A |

</frozen-after-approval>

## Code Map

- `apps/mobile/src/components/app-tabs.tsx`, `app-tabs.web.tsx` -- tab triggers; remove the Progress trigger, add Streak (`sf flame`, `md local_fire_department`) always present and never `hidden`. Labels are hard-coded English today; only Streak is localised.
- `apps/mobile/src/app/(tabs)/index.tsx` -- Home: lines ~129-131 hooks, 720-728 `WeeklyRingSection` and `LeaderboardHomeCard` to remove, replace with `HomeStreakLine`; keep celebration hook and the engagement read (270-274, 442).
- `apps/mobile/src/hooks/use-home-engagement.ts` -- call the gate on `row` and `dark`; `use-home-leaderboard.ts` unchanged (moves with the card).
- `apps/mobile/src/app/calendar.tsx` -- extract the panel; screen keeps header, back, refresh.
- `apps/mobile/src/app/(tabs)/profile.tsx` -- Training card (~733-796): add the Progress row (always shown, so outside the `engagementEnabled` blocks; make the Training card render for a dark gym with just that row and the existing Weekly goal row as today).
- `apps/mobile/src/app/(tabs)/progress/{index,entries}.tsx`, `photo/[id].tsx` -- MOVE to `apps/mobile/src/app/progress/` (same URLs `/progress`, `/progress/entries`, `/progress/photo/[id]`; there is no `(tabs)/progress/_layout`). Declare the screens in `app/_layout.tsx` as stack screens as the other pushed screens are, add a Back header like `app/calendar.tsx`. Content, data and services unchanged; update the comments and `eslint.config.js` path that name `(tabs)/progress`, and `app/workout-plan.tsx` comments.
- `apps/mobile/src/lib/weeklyRing.ts` (`readEngagementCache`, `buildHomeEngagementView`), `services/engagement.ts` -- reuse; do not change.
- `apps/mobile/src/lib/weeklyRing.source.test.ts`, `badgesView.test.ts`, `calendar` tests -- source-text pins on `app/(tabs)/index.tsx` placement of `WeeklyRingSection` / `LeaderboardHomeCard` / `onDismissNotice` (lines ~26, 111, 149, 157, 240, 248, 382, 428, 499-501, 671, 792): re-point them to the Streak screen; Home now pins the streak line and the celebration.
- `apps/mobile/src/locales/en.json`, `fr.json`, `locales/engage.test.ts` -- new keys `engage.streak.tab`, `engage.streak.title`, `engage.home.line.streak`, `engage.home.line.week`, `engage.profile.progress.row`; `scripts/check-i18n-key-parity.mjs`.
- `scripts/epic30-31-qa/README.md` -- parts 1 to 9 name the Home card; rewrite the paths ("Streak tab").
- `docs/decisions.md`, `ARCHITECTURE-SPINE.md` (member app navigation line) -- dated top entry.

## Tasks & Acceptance

**Execution:**
- [ ] `apps/mobile/src/lib/engagementGate.ts` (+ test) -- the store, device-copy bootstrap, reset on member change -- one gate for every consumer
- [ ] `apps/mobile/src/components/app-tabs.tsx`, `app-tabs.web.tsx` -- Progress trigger removed, Streak trigger always present (no `hidden`) -- five tabs in every state; the hub gets a calm off/unknown face (one line, new EN/FR key `engage.streak.off`), with the ring, board card, calendar and Badges row absent
- [ ] `apps/mobile/src/app/(tabs)/streak/index.tsx` -- the hub (ring section, Leaderboard card, `CalendarPanel`, Badges row, pull to refresh, dark and error faces as Home had them) -- the new destination
- [ ] `apps/mobile/src/components/CalendarPanel.tsx`, `app/calendar.tsx` -- extract, no behaviour change -- reuse in the hub
- [ ] `apps/mobile/src/components/HomeStreakLine.tsx`, `app/(tabs)/index.tsx` -- the line replaces the two sections -- Home stays short
- [ ] `apps/mobile/src/hooks/use-home-engagement.ts` -- set the gate on `row` and `dark` -- the bar follows the server
- [ ] `apps/mobile/src/app/progress/*` (moved from `(tabs)/progress/`), `app/_layout.tsx`, `eslint.config.js` -- stack routes with a Back header, same URLs -- reachable while no tab exists for them
- [ ] `apps/mobile/src/app/(tabs)/profile.tsx` -- the Progress row, always shown -- the feature's new door
- [ ] locales, `engage.test.ts`, the re-pointed source tests, a gate-consumer scan test, tests for the line's wording and the I/O matrix rows that are pure (gate reducer, line view model)
- [ ] `scripts/epic30-31-qa/README.md`, `docs/decisions.md`, spine, `sprint-status.yaml`, `deferred-work.md` if anything is deferred

**Acceptance Criteria:**
- Given any gate state, when the app opens, then the bar shows Home, Check In, Classes, Streak, Profile and no Progress; given the gate is `on`, and Home has a streak line but no This week section and no Leaderboard card.
- Given the gate is `off` or `unknown`, when the app opens, then the bar still shows the same five tabs, the Streak tab shows the heading and one calm line (`engage.streak.off`) with none of the four sections, Home renders none of the new elements, and Profile differs from before this story only by the Progress row (source tests pin the off face).
- Given the Streak tab is open, when the member pulls to refresh, then the ring, board card, calendar and badge count reload, and every Epic 30 and 31 state (Shield chip, notices, comeback phases, at-risk hint, offline banners, pending scan) shows exactly as it did on Home.
- Given the member taps the Home streak line, then `/streak` opens; given they tap the ring card, then `/calendar` opens as before; the goal, goal hint and notice dismissal behave as before.
- Given any gate state, when the member taps the Profile Progress row, then the Progress screens open with a Back header, entries and photo screens work, and Back returns to Profile; the Progress services have no diff and the screens differ only by their location and the header.
- Given `pnpm --filter mobile test`, `tsc --noEmit`, `check:i18n`, `check:client-boundary-imports` and the file scans, then all pass; `scripts/ci-local.sh` is GREEN on the committed story head.

### Review Findings

Code review of `epic/31...HEAD` (2 commits, 34 files) on 2026-11-24, four layers (Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor), 0 failed. 0 decision-needed, 5 patch, 2 defer, 20 rejected.

- [x] [Review][Patch] Progress screens lost the gym accent colour: they moved out of `(tabs)`, whose layout wrapped them in `GymAccentColorProvider`, and the root layout has none, so `useGymAccentColor()` returns the platform gold for the "Log entry" button and the weight chart; wrap `ProgressScreen` as `calendar.tsx` does and pin it in the "Progress screens are stack routes" test (medium) [apps/mobile/src/app/progress/index.tsx:135]
- [x] [Review][Patch] `progress/entries.tsx` and `progress/photo/[id].tsx` still call a bare `router.back()`, which does nothing after a cold deep link with no history (only `progress/index` got the `canGoBack()` fallback); use `canGoBack() ? back() : replace('/progress')` and update the test that pins the bare call (low) [apps/mobile/src/app/progress/entries.tsx:170, apps/mobile/src/app/progress/photo/[id].tsx:109]
- [x] [Review][Patch] The one-time "you are back" card is recorded as shown by the Streak screen even while it draws nothing (gate off or unknown with a cached snapshot that carries a `restoredId`); pass `{ recordRestoredCard: gate === 'on' }` (low) [apps/mobile/src/app/(tabs)/streak/index.tsx:41]
- [x] [Review][Patch] Stale comments and docs still describe the gated bar or the old IA: `engagementGate.ts` header ("read by exactly three places: the tab bar", "unknown behaves as off (four tabs)"), `use-home-engagement.ts:118` ("tab bar, Home streak line, Profile row"), `(tabs)/_layout.tsx` ("choose Streak or Progress"), `profile.tsx:815` and `onboarding/body-profile.tsx:31` ("Progress tab"), `calendar.tsx` docstring ("pushed from the Home 'This week' card"), the `useCalendar` docstring ("never remembered" is no longer true in the mounted hub), `weeklyRing.source.test.ts` titles that say Home, `docs/decisions.md` ("exactly as before this story" while dark, and "added to the spine's deferred bullet", the line is a standalone bullet after the AD-60 block) and the deferred-work entry that counts two engagement reads (the calendar's `loadAll` makes a third) (low) [apps/mobile/src/lib/engagementGate.ts:5-12]
- [x] [Review][Patch] The QA click-through has no step for the Home streak line opening the Streak tab, the comeback card recorded only on the Streak tab, or a Progress Back with no history, and the dark-state row repeats "Home has no streak line" twice (low) [scripts/epic30-31-qa/README.md]
- [x] [Review][Defer] A reminder tap (N-08) lands on Home, which now shows only "n-week streak" or "x of y this week" with no at-risk cue; the at-risk hint and Shield chip live on the Streak tab, so the member must find the fourth tab — deferred: out of scope by the spec ("a push deep link ... N-08 still opens Home"); options are an at-risk variant of the Home line or an N-08 deep link to `/streak` (medium, unverified on a device) [apps/mobile/src/components/HomeStreakLine.tsx]
- [x] [Review][Defer] A gym whose engagement area is dark still pays, on every Streak focus, for `useCalendar` (`getMyEngagement` plus `getMyFirstVisitDay`), the leaderboard load and a second `useHomeEngagement` read and settle; only the engagement read is needed to turn the gate on — deferred: a design call (start the calendar and board loads only once the gate is `on`, which needs an `enabled` input on `useCalendar`) with two cheap RPCs per focus as the cost (low)

#### Rejected

- ci-local not run and one mobile test (`shareFlow.test.ts` package-version pin) failing — not a code defect: disclosed in sprint-status, caused by the uncommitted SDK 58 bump in the working tree; the gate runs at merge per the epic rule.
- The hub keeps the month and selected day across tab switches (the tab stays mounted) — low, benign, and the fix (reset on blur or at month rollover) adds branches for a case members will rarely notice.
- Pull to refresh does not await the badge count; gate wiring pinned by source text only — already deferred (triage items 16 and 18 and deferred-work).
- Spec self-contradictions (the frozen Approach 4 line, Implementation Notes "tab bar (both files)", the stray Home clause in AC 1, `status: done` and unchecked Tasks) — the fix edits the spec under review; the status is set by this review's step 6.
- Out-of-scope QA script edits (`start-mobile.sh`, `job.mjs`, `lib.mjs`) — disclosed in sprint-status as owner-QA fixes; no spec rule broken.
- `reduceGate` adopts a late outcome while `key` is null — false: it is deliberate (Home can answer before the layout binds), a late answer after sign-out holds a real answer for that member, and `bind` resets the gate for any other member.
- The layout resets the gate while `gymId` is briefly null (a "coming soon" flash) — maybe-false and low: it needs `gymId` to go from set to null while the session stays, which the session hook was not shown to do; the cold-start flash is already recorded in decisions.md as owner device-check risk.
- "Coming soon" shows for `unknown` on a cold start with no device copy, or forever after a failed offline first read — already recorded in decisions.md ("Risk left to the owner's device check").
- `lib.mjs` persona wipe inserts `member_preferences` without `on conflict` — false: the `delete` for the same member runs first in the same script, and the QA pass ran it.
- The at-risk hint could be hidden in both the panel and the ring card — false: `ringShowsHint` is true only when the ring card's own `hint` is non-null.
- The consumer scan covers only `app/` and `components/` — false: `walk(SRC)` reads every file under `src`, hooks and libs included. The mutation check running on the first draft only, and exact-count pins such as `streakLine` appearing 3 times — low, no named harm.
- Tab labels half localised (only Streak is translated) — already accepted as deferral item 5.
- Home still calls `useFocusToast()` though the goal button moved; the Streak toast copies Home's block and its two hard-coded colours — maybe-false (Home may take other toasts) and low.
- Hand-rolled `←` Back glyph on Progress, no RTL handling; the Profile Progress row reuses `goalRow` styles, repeats its label as `accessibilityLabel` and sits under `engage.profile.*`; the off line has no live-region role — low, cosmetic, no named harm.
- At-risk and default-goal hints behave differently from Home — accepted in triage items 4, 14 and 15 as consequences of the approach.
- Spine bullet placement versus the decisions entry — the bullet is correctly placed; the wording mismatch is in the decisions patch above.

## Implementation Notes

- Gate: `lib/engagementGate.ts` (+ `engagementGate.test.ts`: reducer rows, store, consumer scan, tab bar and route pins). Bound in `(tabs)/_layout.tsx`; set in `use-home-engagement.ts` from `outcome.kind`. Consumers: the tab bar (both files), Home and the Streak screen; Profile reads no gate.
- `CalendarPanel` takes the hook's `view`, `refresh`, `shift`, `selectDay`; the hub passes `hideAtRiskHint` (the ring section already shows the hint). `useBadgeRows` got an optional `reloadToken` for the hub's pull to refresh.
- `use-home-engagement.ts` also returns `engagement` (the row behind the view) for `buildHomeStreakLine` (`lib/homeStreakLine.ts`, tested in `homeStreakLine.test.ts` with the Home, Profile and hub source pins).
- Second rework (the second Spec Change Log entry, owner after QA): both tab files have five triggers in every state; the Streak trigger has no `hidden` and neither file imports or reads the engagement gate (`streakOn` is gone). `app/(tabs)/streak/index.tsx` shows, while the gate is not `on`, the heading and one calm line (`engage.streak.off`, EN "Your weekly streak is coming soon.", FR "Votre série hebdomadaire arrive bientôt."); the ring section, Leaderboard card, calendar panel and Badges row render only when the gate is `on` (so nothing says it twice), the Back arrow of the gate-off face is removed, and the loaders (`loadRing`, the calendar hook) still run so the first read can turn the gate on. `bindEngagementGate` stays in `(tabs)/_layout.tsx`; the gate consumers are the Home streak line and the Streak screen only. The earlier line below about `hidden={!streakOn}` and the Back arrow is superseded.
- Review loop 1 rework (Spec Change Log): the Progress trigger is gone from both tab files and the Streak trigger is `hidden={!streakOn}` (web: rendered only while on); the Profile Progress row is always shown, outside every `engagementEnabled` block, at the end of the Training card; `app/(tabs)/progress/{index,entries}.tsx` and `photo/[id].tsx` were `git mv`d to `app/progress/` and registered in `app/_layout.tsx` as `progress/index`, `progress/entries`, `progress/photo/[id]`; `progress/index.tsx` got a Back header (the only edit inside the screens); comments in `workout-plan.tsx` updated (`eslint.config.js` names no `(tabs)/progress` path, so nothing to change there). The `/streak` face with the gate off is a Back arrow to Home (`router.replace('/')`) under the heading; every section already draws nothing for a dark area.
- Not run: ci-local, any device or browser. `shareFlow.test.ts` fails on the owner's uncommitted SDK 58 dependency change (view-shot 6.1.1 vs the pinned 5.1.0), unrelated to this story.

## Spec Change Log

- 2026-11-24, second renegotiation (after loop 1), owner: "gyms must have it, it is for member engagement not for gyms". The Streak tab is always in the bar and never `hidden`; the engagement-off and unknown states show a calm one-line face in the hub instead of removing the tab. Known-bad state avoided: a bar whose length changes with a server flag (and the navigator remount that `hidden` causes). KEEP everything else from the loop 1 entry; only app-tabs (native and web), the Streak screen off face, the locale key, the gate consumer scan and the pins that name the tab bar change.

- 2026-11-24, review loop 1, triggered by finding 1 (a hidden native tab cannot be navigated to). The owner renegotiated the frozen block: Progress is removed from the tab bar in every state and is a Profile row always shown; the Streak tab is hidden unless the gate is `on`; the Progress screens move to root stack routes with unchanged URLs. Known-bad state avoided: a Profile row that pushes to a hidden tab (does nothing on a device) and a dynamic tab swap that remounts the navigator. KEEP: `lib/engagementGate.ts`, the hub (`(tabs)/streak/index.tsx`), `CalendarPanel`, `HomeStreakLine` and `lib/homeStreakLine.ts`, the Home edits, the use-home-engagement gate calls, the locale keys, the re-pointed source tests and the README and decisions edits already in the working tree; only the tab bar, the Profile row, the Progress route move, the gate-consumer scan (Profile row no longer a gate consumer) and their tests change.

## Review Triage Log

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | The spec hides the Progress trigger when the gate is on AND has Profile open `/progress`; a hidden native tab cannot be navigated to, and hiding tabs dynamically remounts the navigator | high | intent_gap | `apps/mobile/node_modules/expo-router/build/native-tabs/types.d.ts:521`: "Marking a tab as `hidden` means it cannot be navigated to in any way." The Profile row would do nothing on a phone. Root cause is inside the frozen block (Always: tab bar, Profile row; Never: no diff to the Progress screens). Reviewers not launched: an intent_gap loopback makes every lower finding moot (step-04 cascade). |
| 2 | Gate reducer: a live outcome for another member replaces the gate and drops the new member's cache seed (BH) | low | patch | Real: reduceGate adopts any outcome key; an in-flight read finishing after a member switch moves the gate to the old key. Fix: adopt only when the gate is unbound or the key matches; add the stale-outcome test. |
| 3 | engagementGate.ts and its test banner say Profile Progress row reads the gate, and "Progress tab" when off (BH) | low | patch | Stale wording after the loopback; fix the two comments. |
| 4 | Home loses the at-risk and Shield cues, the streak line shows only streak or x of y (BH) | low | reject | Owner decision (Approach 2): the section moves to the Streak tab and Home keeps one small line. Trade-off reported to the owner at the end of the review. |
| 5 | Tab labels other than Streak are hard-coded English, so FR reads Home / Check In / Classes / Série / Profile (BH) | low | defer | Pre-existing hard-coded labels; recorded in the spec and decisions entry; localising the whole bar is its own change. |
| 6 | Home and Streak each run useHomeEngagement, so two reads and settles per session; a hidden Streak screen may mount eagerly on a dark gym (BH, EC) | low | defer | Spec Design Notes accept the second read (settle is idempotent); whether native tabs mount a hidden screen eagerly needs a device. |
| 7 | Streak screen shows no Back arrow when the gate is unknown (BH, VG, EC) | low | patch | Real: only gate off shows it; a deep link with no device copy shows a heading and no way out. Fix: show it whenever the gate is not on. |
| 8 | Progress screens keep BottomTabInset padding though there is no tab bar (BH, VG, EC) | low | patch | Real: dead space at the bottom of progress/index and progress/entries. Direct correction of a consequence of the move. |
| 9 | Progress Back header: router.back() does nothing with no history after a deep link (BH, EC) | low | patch | Real; fix: canGoBack() ? back() : replace('/profile'). |
| 10 | Focused Streak tab becomes hidden when a live dark read flips the gate (EC) | low | reject | Cannot happen in practice: the epoch guard freezes the epoch once any week fact exists, so an on gym does not go dark; the fix adds navigation logic for an unreachable state. |
| 11 | Web tab file renders no streak trigger when off, so /streak may not render on web (EC) | maybe-false | reject | Web is not a shipped member surface for this area and the deep-link row is about the stack; would be low if true. |
| 12 | Home line ignores a daily run chip (EC) | false | reject | The daily streak is inactive in V1.8 (state view returns daily_run null and at_risk_daily false); no code path produces the chip. |
| 13 | hideAtRiskHint hides the at-risk hint even when the ring section is in an error, offline or skeleton face (EC, VG) | low | patch | Real but narrow; one-prop fix: hide the calendar hint only when the ring card is showing its own at-risk hint. |
| 14 | The default-goal hint reaches a new member only on the Streak tab (EC) | low | reject | Follows from Approach 2 (the whole This week section moves). |
| 15 | Spec claim that every state shows exactly as on Home is overstated (EC) | low | reject | Wording of the spec; fix is to edit this spec. The real differences are findings 4, 13 and 14. |
| 16 | Gate wiring (hook call, layout bind and reset) and the hub conditionals are pinned only by source text (VG) | medium | defer | The repo has no hook or component render harness (no testing-library); source pins are the repo precedent (weeklyRing.source.test.ts). Close it if a harness is added. The reducer is behaviour-tested. |
| 17 | Hub passes hideAtRiskHint and the panel gates on it, with no assertion (VG) | low | patch | Real gap; add two source-pin lines. |
| 18 | Badge count refresh uses a void reloadToken hook identity trick, is not awaited by pull to refresh, and bumps offline (VG, BH) | low | defer | Small and invisible; a refresh() returning a promise belongs with a hook test harness. |
| 19 | buildHomeStreakLine reads view.ring.accessibilityValue.now as the visit count (BH) | low | reject | Works and is unit tested for the clamp; a view-model field is a larger change for no demonstrated failure. |
| 20 | Streak line row has no accessibility hint that it opens Streak (BH) | low | defer | Needs a new locale key and parity entry; record for a11y pass. |
| 21 | Profile rows still use their own engagementEnabled; allowlisted in the scan (BH) | low | reject | Stated in the frozen block; the older rows are untouched by design. |
| 22 | Tests are mostly source-text regexes (streakLine counted 3 times etc.) (BH) | low | reject | Repo precedent; no named harm beyond rewording churn. |
| 23 | Spine note sits in a deferred list, shareFlow.test.ts pin fails, and other references to the old route (BH) | low | patch | Spine placement is a real wording problem (move the line to the V1.8 decision text). The shareFlow failure is the owner's uncommitted SDK 58 change and is not this story. No other reference to the old route exists (grep over apps, .github, scripts, docs; no Maestro or e2e folder). |

## Design Notes

- Why a gate store instead of a prop: the tab bar is mounted above every screen and decides before any screen has read the engagement row; the device copy answers at once and the server answer corrects it, so a member on a dark gym never sees the swap.
- Hub, text only: heading "Streak"; "This week" ring section as on Home today; the "Leaderboard" card; the month calendar with legend; a row "Badges, 2 of 5". Home line example: "3-week streak" / "1 of 3 this week", chevron at the right.
- Risk to check on a device, not provable here: the Streak tab appearing after the first read for a member with no device copy (superseded: the tab is never hidden, so no remount), and the Progress stack screens (Back, large text).

## Verification

**Commands:**
- `pnpm --filter mobile test`, `pnpm --filter mobile exec tsc --noEmit`, `pnpm check:i18n`, `pnpm check:client-boundary-imports` -- expected: pass
- `bash scripts/ci-local.sh` -- expected: GREEN on the committed story head (13-20 min), run after `node scripts/epic30-31-qa/teardown.mjs`
- Mutation check, run once and said so: make the tab bar read the engagement flag without the gate and see the consumer scan fail; restore.

**Manual checks (if no CLI):**
- Left to the owner's combined QA: the swap with `epoch.mjs off|on`, the hub on a phone in EN and FR, Progress from Profile and Back, the Streak tab at large text, Progress from Profile in a dark gym (`epoch.mjs off`) and in an on gym.
