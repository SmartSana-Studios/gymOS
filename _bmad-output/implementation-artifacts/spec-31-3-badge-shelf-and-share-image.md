---
title: '31-3 Badge shelf and share image'
type: 'feature'
created: '2026-11-24'
baseline_commit: '714d5712f6b8f279e4b0bb7b2620a3a24f9ae8e2'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-31-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/epics.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A member has no place to see what they have earned and no way to show a milestone to friends. Epic 30 awards only the 7, 30 and 100 `milestone` facts; there are no badge facts, no shelf, and the celebration screen (MA-20) has one button. Production is live and the engagement epoch is NULL, so the area stays dark until the operator sets it.

**Approach:** One migration (provisional `0192`) writes five badge facts (`first_visit`, `visits_7`, `visits_30`, `visits_100`, `four_weeks`) from the existing award step, back-fills history silently, and adds the read `get_my_badges()`. Mobile gains the Badge Shelf `/badges` (MA-21) with a detail sheet, a Profile "Badges" row, and a device-built 1080 by 1920 share image behind a [Share] button on MA-20 and on earned badges. The criteria of `epics.md` "Story 31.3" and the MA-21, MA-20 and share-image text in `ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md` (lines 2208-2287) plus the `engage.badges.*`, `engage.share.*`, `engage.profile.badges.*` catalog (lines 713-749, 780-781) are the authority; this spec adds the code map and the decisions below.

## Boundaries & Constraints

**Always:**
- Server contract exactly as `epics.md` 31.3. Migration `0192_badges.sql` (provisional number, opens `set local lock_timeout = '5s';`, ends with a `do $verify$` block) and `scripts/rollback-0192-badges.sql` (rehearse apply, rollback, apply, rollback, apply on the local DB; facts stay on rollback because the append-only guard forbids deletes, say so in the header). `get_my_badges()` gets `revoke execute ... from public, anon, service_role; grant ... to authenticated`, asserted with `has_function_privilege`.
- Storage: `engagement_facts` kind `badge`, `subject_key` one of the five codes, `revision` 1 only, `outcome` null, `silent` is the existing column, and `earned_on` goes in `detail` jsonb (the epic's "payload" is `detail`; there is no payload column). No new table. No CHECK on badge `subject_key` (the existing fixtures `engagement_facts.test.sql:96` and `engagement_fold.test.sql:117` insert a badge `first-week`; "existing suite unedited" wins). Instead, idempotency is `insert ... revision 1 on conflict do nothing` in the only writers, and a pgTAP source scan proves no function writes a badge with revision above 1 or deletes one.
- Award step: extend `private.award_milestones(uuid)` (live in 0189:29-65, called only from `private.settle_engagement`, 0190:730, under the member lock; keep that caller and keep it a no-op while the epoch is NULL). `visits_7/30/100` and `first_visit` (n = 1, 7, 30, 100) read the nth row of `member_visit_days` ordered by `visit_day`; `earned_on` is that `visit_day`, never recomputed from `checked_in_at`. `silent` for a visit badge equals the milestone's own rule (nth visit day before the epoch). `four_weeks`: the first week where `private.engagement_shield_walk` (0190:65-118, same inputs `settle_engagement` builds near 0190:655-700) reports `earned`, `earned_on` that week's Sunday (week + 6), `silent` false. A badge is never lost: a later void or rebuild leaves the row. A void between threshold and award simply means nothing is inserted; once a row exists its `earned_on` wins. Awarding 7, 30 and 100 never adds a second celebration: `pending_milestone` still reads only `milestone` facts, and `first_visit` and `four_weeks` feed nothing that celebrates.
- Release back-fill in the same migration: for every member with at least 1 visit day, insert the visit badges they have already passed with `silent = true` and `earned_on` the stored `visit_day` of the nth visit day, `on conflict do nothing`, never `four_weeks`. It is a per-member keyset loop (as `engagement_settle_candidates`, 0186:521), with no member lock and no touch of `attendance_events` rows (read-only). A `DO` block cannot commit, so "short per-member transactions" is one migration transaction under the 5 s lock_timeout; record that deviation in Dev Notes and `docs/decisions.md`. It writes regardless of the epoch (the shelf is reachable only behind the engagement gate, and the Profile row stays hidden while dark). pgTAP seeds members at 0, 1, 6, 7, 29, 30, 99, 100 and 250 visit days and asserts the exact badge sets, and a second run inserts nothing.
- `get_my_badges()` is `public`, `stable`, `security definer`, `set search_path to 'public'`, shaped on `public.my_saved_weeks` (0190:1344-1387): member role only, `private.gym_id()` null, no live member row or `coalesce(private.current_gym_status()::text,'') <> 'active'` return no rows. For a valid member it always returns exactly five rows in shelf order with `code`, `earned`, `earned_on`, `silent`, `visits_remaining` (threshold minus `count(*)` of the member's `member_visit_days`, floor 0, null for `first_visit` and for earned rows) and `weeks_progress` (0 to 3, from `engagement_state_view` `weeks_to_next_shield` as `interval - weeks_to_next_shield`, clamped, 0 when no run or dark; null unless `four_weeks` is unearned). It never writes. Its source must not name `attendance_events`.
- Share library: on the day of the work, verify on the web (WebSearch/WebFetch) the published version, changelog, maintenance status and Expo SDK 57 / react-native 0.86 compatibility of each candidate before adding any dependency. Default plan per `epics.md`: `react-native-view-shot` at the SDK 57 bundled version (`expo/bundledNativeModules.json`, 5.1.0 at planning) and `expo-sharing` ~57.0.18, installed by `npx expo install`, never a floating range; fallback `react-native-svg` `toDataURL` plus `expo-file-system` (both installed). The decision, exact versions, evidence (URLs, dates), rejected options and the build order go in one dated top entry of `docs/decisions.md`, and `ARCHITECTURE-SPINE.md:514` (and the AD-60 sentence at :391) is updated to point to it. If the packages cannot be installed here (no network), stop and report; do not hand-edit lockfiles.
- Share image: composed at 360 by 640 pt on `#0A0F17` and captured at 1080 by 1920 px (3x), written as PNG to the app cache directory, passed to the OS share sheet (`mimeType image/png`, `UTI public.png`, `dialogTitle` from the catalog, iPad anchored to the button). The composition is a pure view-model in `lib/shareImage.ts` (props type has no field for name, phone, price or reward) rendered by a thin `components/ShareImageComposition.tsx`; milestone and badge variants as `epics.md`. The mini month calendar shows when the card has room (height at least 640 pt and font scale below 1.3, the existing `showMiniCalendar`). The logo is omitted silently if it fails to load. The flow (`lib/shareFlow.ts`) takes its capture, share, availability, file and network functions as injected dependencies so tests can fail them; it never asks for a photo-library or storage permission, deletes the temp file after the sheet closes and on failure, and removes older leftovers in the cache directory first. Result states exactly as `epics.md` (closed or shared: nothing; capture, write or hand-off failure: `engage.share.error` with retry; unavailable: `engage.share.unavailable`, button hidden next view).
- Screens: `app/badges.tsx` registered in `app/_layout.tsx` inside the `isFullyOnboarded` group next to `calendar` and `leaderboard`; hook `hooks/use-badges.ts` (useState, sequence ref, `useFocusEffect`, no react-query exists) with an AsyncStorage tile cache `gymos.badges.v1.<user>.<gym>` (versioned, fail-safe parse, cleared on sign-out like `clearShown`); service `services/badges.ts` (never-throw result union, defensive parse, untyped client); pure `lib/badgesView.ts` builds tiles, summary, labels and accessible labels; bottom sheet `components/BadgeDetailSheet.tsx` modelled on `ShieldExplainerSheet.tsx` (RN `Modal`, words from a view prop). `IconChip` gains a size prop for the 48 pt and large chips. Profile gets the "Badges" row after the calendar row inside the `engagementEnabled` gate (`profile.tsx` ~763). MA-20 gains [Share] primary, [Keep going] secondary, [See your badges] text link that acknowledges and `router.replace('/badges')`; the Epic 30 acknowledge, reduced-motion, offline and already-acknowledged behaviour is unchanged.
- Wording: add every `engage.badges.*`, `engage.share.*` and `engage.profile.badges.*` key from the UX catalog byte for byte in EN and FR, plus the few the catalog lacks (`engage.share.dialogTitle`, badge sheet close and accessible-label keys), no literal sentences in screen files (FR-232 scan), dates formatted through a helper outside the scanned files. Append the keys to `locales/engage.test.ts` `REQUIRED`. `scripts/check-i18n-key-parity.mjs` passes.
- Tests: no render harness exists (vitest `node`, no testing library) and none is added. Component-level claims are proven through the pure view-models and flow with injected fakes plus source scans in the repo's style: every tile state in EN and FR, the sheet with and without Share, every share result state, the privacy test (a composition for "Aïcha Test" with a phone, a plan price and a loyalty reward in state serialises none of those strings, the props type has no such field via a type-level test, and only gym name and logo, milestone or badge, date and own lit days enter), no network call during share, permission APIs never called, offline works. Existing pins edited, each by a disclosed line: `engagement_settle.test.sql:380-405` (two expected function lists gain `get_my_badges`), the Epic 30 award-step tests in `engagement_milestones.test.sql` (only where they assert the award now writes badges), the NFR-028 extension in `engagement_determinism.test.sql` (below), `weeklyRing.source.test.ts` where the close block of the celebration route changes. `check_in()`, `record_check_in`, `void_staff_check_in` stay byte-identical (md5 pins in `engagement_reminder.test.sql:552-555`); no new table, endpoint, edge function or `private.support_capabilities` entry (`support_capabilities.test.sql` unchanged, count stays 50).
- NFR-028: extend the derived-versus-rebuild equivalence so `rebuild_engagement` returns the badge set (both OUT row types dropped and recreated, as 0189 and 0190 did) and the live fold equals it, including the silent back-fill, a late offline visit that earns a badge and a void that does not remove one; the test states that a stored `earned_on` wins over a recomputed one after a void.
- Gates reach their consumers (Epic 22 retro 66): pgTAP scans prove only `private.award_milestones` and the back-fill write `badge` facts, `get_my_badges` and its callers write nothing (table snapshots before and after), a badge grants nothing (identical row counts in the loyalty ledger, `guest_sessions`, Shields, stamps and plan or discount tables after earning all five), and a mutant that makes `record_check_in` name `award_milestones` fails the scan (show it failing once). Every created function is anon-unexecutable. `bash scripts/ci-local.selftest.sh` is run only if `ci-local.sh` is touched.
- Two-session race: extend `scripts/engagement-race.sh` with a phase that races settle and first-open awarding the same badge, expecting one row.

**Never:**
- No edit to `check_in()`, `record_check_in`, `void_staff_check_in`; no award from a read; no write to the loyalty ledger, `guest_sessions`, Shields or stamps; no server endpoint, table, bucket or analytics event for sharing; no photo-library or storage permission; no member name, phone, payment figure, other member's data or GymOS watermark on the image; no lock icon or "0 of N" on a tile; no failure wording; no mock designs or HTML previews (project rule).
- No production deploy, no push, no EAS build (epics 30 and 31 are tested and pushed together after 31-3). The story states the build order for the owner: new store build first, then release. Not run by me: device or browser QA, the real-library 1080 by 1920 and WhatsApp hand-off check.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First visit after release | member's 1st visit day, epoch set | `first_visit` badge, `silent` false, `earned_on` that day, no celebration | N/A |
| 7th, 30th, 100th day | nth visit day reached | badge plus the Epic 30 milestone, one celebration only | N/A |
| Fourth met week | first Shield earned in the fold | `four_weeks`, `earned_on` that week's Sunday, no celebration | N/A |
| Void below threshold | day voided after badge | badge row and `earned_on` unchanged, no reinsert on return | N/A |
| Late offline visit | visit arrives for an earlier date | awarded on next settle, `earned_on` the nth day's true date | N/A |
| Two racing awards | settle and first-open at once | one row per badge | unique key |
| Release back-fill | members at 0,1,6,7,29,30,99,100,250 days | exact silent sets, real dates, no `four_weeks`, second run inserts nothing | N/A |
| New member | no visits | `get_my_badges` five unearned rows, never empty | N/A |
| Other member or gym | member A calls | only A's own rows | N/A |
| Staff, support, deactivated, suspended gym, anon | calls the read | no rows, anon refused 42501 | N/A |
| Shelf states | earned, earned silently, locked in reach, locked no streak | tile text as UX table, EN and FR | N/A |
| Shelf load | loading, error, offline, new member | 5 skeletons, `engage.badges.error` card, cached tiles, five locked tiles | N/A |
| Share success or cancel | sheet closed after or without target | nothing shown, temp file deleted | N/A |
| Capture or write fails | throw, out of memory, cache not writable | `engage.share.error` with retry, button normal, file deleted | N/A |
| Sharing unavailable | `isAvailableAsync()` false | `engage.share.unavailable`, Share hidden next view | N/A |
| Logo missing | not loadable | image without logo, no error | N/A |
| Offline share | network mock fails | image built and shared | N/A |
| MA-20 buttons | milestone 7, 30 or 100 | Share, Keep going, See your badges; See your badges acknowledges then replaces route | ack retried silently if offline |

</frozen-after-approval>

## Code Map

- Server: `supabase/migrations/0189_milestones_celebration.sql:29-65` (`award_milestones`), `0190_streak_shields_comeback.sql:65-118` (`engagement_shield_walk`), `:375-455` (fold), `:544-735` (`settle_engagement`, award call at :730), `:1204` and `:1245-1330` (`engagement_derived_state`, `rebuild_engagement`), `:1344-1387` (`my_saved_weeks`, the read shape), `0185:27-65` (facts table, kind CHECK already allows `badge`), `:160` (`effective_engagement_facts`), `0173:132-136` (`member_visit_days`), `0186:521` (keyset candidates), `0157:20` (`gym_today`).
- Tests to touch: `supabase/tests/engagement_milestones.test.sql` (source rules :130-172), `engagement_determinism.test.sql` (:215-259), `engagement_settle.test.sql:380-405`. Check without editing: `engagement_facts.test.sql:96,171,196`, `engagement_fold.test.sql:117`, `engagement_shields.test.sql:135`, `engagement_reminder.test.sql:545-555`, `support_capabilities.test.sql:93`, `suspension_rpc_coverage.test.sql`, `engagement_dirty_mark.test.sql`. New: `supabase/tests/engagement_badges.test.sql` (fixture ids `00000000-0000-0000-00NN-...`, grep for an unused NN; model `engagement_shields.test.sql:110-135,437-466` and `engagement_rpc.test.sql:116-130`), `scripts/engagement-race.sh` new phase.
- `packages/types/src/database.ts` (hand-spliced, add `get_my_badges` in alphabetical order near `my_*`; precedent in docs/decisions.md 27.1).
- Mobile (`apps/mobile/src`): `app/celebration/[milestoneId].tsx` (320 lines; buttons :259, `close()` :143-150, back :152-158), `lib/celebrationView.ts` (`CelebrationKeys`, `buildCelebrationView` :261-316 exposes only `continueLabel`; `showMiniCalendar` :318-327; `finishCelebration` :157), `services/milestones.ts` (`getGymBranding` :44, `acknowledgeMilestone` :18), `app/(tabs)/profile.tsx` (Training card 727-767, calendar row 750-764), `app/_layout.tsx:144-155`, `app/calendar.tsx` and `hooks/use-calendar.ts` (screen and hook model), `lib/calendarView.ts:403-470` (cache pattern), `components/ShieldExplainerSheet.tsx`, `components/ui/IconChip.tsx`, `CelebrationMiniMonth.tsx`, `locales/{en,fr}.json`, `locales/engage.test.ts:9-110`, `lib/weeklyRing.source.test.ts` (:52-55 SCREEN_FILES, :535-610 celebration source test, :740-745 sheet), `lib/celebrationView.test.ts` (:277,303,322 pins), `apps/mobile/package.json`.
- Docs: `docs/decisions.md` (new top entry above line 8), `_bmad-output/planning-artifacts/architecture/architecture-gym_os-2026-08-11/ARCHITECTURE-SPINE.md:391,514`, `deferred-work.md` (no line names 31-3 today; search again before closing).

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0192_badges.sql`, `scripts/rollback-0192-badges.sql` -- extend `award_milestones`, back-fill, `get_my_badges`, `rebuild_engagement`/`engagement_derived_state` badge set, grants, verify block, rollback -- server contract
- [x] `supabase/tests/engagement_badges.test.sql`, `engagement_milestones`, `engagement_determinism`, `engagement_settle` pins, `scripts/engagement-race.sh` -- every I/O row, privilege matrix, grants-nothing proof, consumer scans, mutant, race -- gates reach consumers
- [x] `packages/types/src/database.ts`, `services/badges.ts`, `hooks/use-badges.ts`, `lib/badgesView.ts` (+ tests) -- read, cache, tiles, labels in EN and FR
- [x] `app/badges.tsx`, `components/BadgeDetailSheet.tsx`, `components/BadgeTile` (or inline in the screen), `IconChip` size, `_layout.tsx`, `profile.tsx` Badges row -- MA-21 and entry points
- [x] `docs/decisions.md` share-library entry (verified web evidence first), then `package.json` + lockfile via `npx expo install`, `lib/shareImage.ts`, `lib/shareFlow.ts`, `components/ShareImageComposition.tsx` (+ tests) -- device-built image and flow
- [x] `celebrationView.ts`, `app/celebration/[milestoneId].tsx`, `celebrationView.test.ts`, `weeklyRing.source.test.ts` -- Share, order of buttons, See your badges
- [x] `locales/{en,fr}.json`, `engage.test.ts` -- all keys, parity
- [x] `ARCHITECTURE-SPINE.md`, `docs/decisions.md`, `deferred-work.md`, Dev Notes (build order for the owner; exact manual device check steps: build, open a 7-visit celebration, Share, confirm 1080 by 1920 PNG and WhatsApp status) -- records

**Acceptance Criteria:**
- Given `epics.md` Story 31.3 and the I/O matrix, when the migration, pgTAP, race script and Vitest run, then every listed server and screen state matches, in EN and FR.
- Given `release_week_start` NULL, when the migration runs on data with history, then silent visit badges exist, `award_milestones` still does nothing, and no celebration or push is produced.
- Given a function other than `award_milestones` or the back-fill writes a badge, or the three check-in paths change, or a new function is anon-executable, then pgTAP fails.
- Given the share flow with network, permission and capture fakes, then no network or permission call is made and every result state matches.

### Review Findings

Code review of `714d571..1ced182` (2026-11-24, pass 2, full mode; layers Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor).

- [x] [Review][Patch] The share status (`error`, `unavailable`) is set only inside `share()` and never reset, so it shows again when another badge or the same sheet is opened, and a capture that fails after the sheet closed lands on an unrelated sheet [apps/mobile/src/hooks/use-share-image.ts:60-139, apps/mobile/src/app/badges.tsx:68] — medium (BH, EH)
- [x] [Review][Patch] `shareImageInputFrom` (the allow-list copy) is called only from its own test; production passes the screen's input straight to `buildShareComposition`, so the FR-231 privacy guard rests on the type alone, and the privacy test proves a function production never runs [apps/mobile/src/lib/shareImage.ts:44,76; hooks/use-share-image.ts] — medium (VG, EH)
- [x] [Review][Patch] `useShareContext` keeps `branding` and `calendar` after the sheet closes or the gym changes, so a failed re-read shows the previous gym's name and logo or last month's days; the branding read has no catch [apps/mobile/src/hooks/use-share-context.ts:20-55] — low-medium (BH, EH)
- [x] [Review][Patch] `ShareImageComposition` text uses `ThemedText` with the device font scale, so at 1.3x and above the capture can overflow the fixed 360 by 640 box, against its own claim that the image does not change with the phone [apps/mobile/src/components/ShareImageComposition.tsx] — low (BH). Fix: `allowFontScaling={false}` on every text node of the composition
- [x] [Review][Patch] Nothing pins that the [See your badges] link calls `close('badges')`, nor that `finishCelebration` runs before `router.replace('/badges')`; a link wired to `close('continue')` passes every test [apps/mobile/src/app/celebration/[milestoneId].tsx:161-173,306] — low-medium (VG)
- [x] [Review][Patch] Member and gym scoping of the cached badge rows (`memberKeyRef` reset, `entry.key === memberKey` checks) is covered only by source-text checks; deleting them would show the previous member's "n of 5" on a shared phone with no failing test [apps/mobile/src/hooks/use-badges.ts] — low-medium (VG). Fix: extract pure `rowsForMember` and `shouldResetShelf` into `lib/badgesView.ts` and table-test them
- [x] [Review][Patch] The logo gate (`logoSettledRef`, waiters, 3 s timeout, the no-logo fast path) has no test, a failed logo is never retried when the logo URL changes, and timed-out waiters are never removed [apps/mobile/src/hooks/use-share-image.ts:69-100, components/ShareImageComposition.tsx] — low-medium (VG, EH). Fix: extract a pure `createLogoGate(timeoutMs)`, test with fake timers, reset `dropped` on a new URL
- [x] [Review][Defer] iOS may present the OS share sheet behind or fail to present it from inside the React Native `Modal` of the badge sheet [apps/mobile/src/components/BadgeDetailSheet.tsx] — deferred: maybe-false, would be medium if true; only an iOS device shows it. Added to the owner's device check
- [x] [Review][Defer] Share tapped before `useShareContext` reads resolve (or offline from a cold start) produces an image with no gym name, logo, caption or calendar while the button looks normal [apps/mobile/src/hooks/use-share-image.ts, use-share-context.ts] — deferred: extends the existing cold-start entry; the choice (disable Share until ready, bounded wait like the logo, or cache branding on disk) is a design decision for the owner
- [x] [Review][Defer] `cleanLeftovers` removes every `gymos-share-*.png` before each share, including a file a previous target may still be reading; an age-based sweep would also serve the Android risk [apps/mobile/src/lib/shareFlow.ts] — deferred: same unverified Android timing as the existing entry; settled by the device check
- [x] [Review][Defer] At densities such as 2.625 the capture size rounds to whole logical points, so the PNG is about 1079 by 1919, not exactly 1080 by 1920 [apps/mobile/src/lib/shareImage.ts:22-25] — deferred: known and recorded; only the owner's device check shows the real output

#### Rejected

- Hard-coded "4 weeks" while `shield_every_weeks` is configurable (BH): low; the UX catalog pins the text, the exemption is logged in `deferred-work.md`, and the interval is operator config with no screen to change it.
- `get_my_badges` and `/badges` do not enforce the dark gate (BH): low; the rows are the member's own, the route is reachable only from the gated Profile row and the celebration, and the app has no deep link to it.
- `silent` and `fromCache` are carried but unused, wrong comment on `BadgeRow.silent` (BH): low; the column is the epic's contract, a comment fix is not worth a pass.
- Two reads of the same RPC per navigation (BH): low; each is one cheap read, and both now share `resolveShelfLoad` and the cache key.
- Cache clearing wired at three sign-out handlers (BH): low; same three sites as the existing `clearShown` pattern, the cache is per user and gym.
- Lockfile still adds `@expo/config-plugins` 57.0.13, `glob@14`, `minimatch@11`, `@expo/plist` (BH): false for the supabase and react-query part (no such line changed); the config-plugins family comes from `expo-sharing@57.0.27` itself, recorded in `docs/decisions.md`.
- Back-fill count not logged, `>= 21` assertion, race phase E uses sleeps (BH): low; the verify block now proves the call ran, the other phases use the same sleeps.
- Back-fill `silent = true` regardless of the epoch (EH): low; the epic AC mandates silent for the release back-fill, and it runs once in the migration while the epoch is NULL in production.
- Unavailable answer while rows are cached keeps showing them, `openCode` outlives a tile reset, `silent`/`earned` mismatch (EH): low; a deactivated member is signed out of the app, and the other two need a member change on a mounted screen.
- Light mode would make the capture dark-on-dark (BH): false; `use-theme.ts` returns the dark palette only, "the app's only shipped theme".
- Existing pgTAP pins edited beyond the spec list, `backfill_badges()` stays installed, no injected network seam, a rejected `shareAsync` maps to `error`, earned tile without a date reads as name only, stale comment in `ShareImageHost` (AA): low; all disclosed in `docs/decisions.md`, and the AC says a refused hand-off is `engage.share.error`.
- Full `ci-local` not green, spec `done` while sprint-status says `review` (AA): process state, not a code defect. The unit stage timeouts are the load flake recorded in memory and reported to the owner.

## Implementation Notes

Dev Notes (2026-11-24, implementation pass; nothing committed, nothing pushed, no build, no deploy).

**What was built.** Migration `0192_badges.sql` (provisional number) and `scripts/rollback-0192-badges.sql`; pgTAP `engagement_badges.test.sql` (121) plus the badge section of `engagement_determinism.test.sql` (99 now) and the disclosed pin edits listed in `docs/decisions.md` (2026-11-24, Story 31.3); `scripts/engagement-race.sh` phase E; `packages/types` `get_my_badges`; mobile `services/badges.ts`, `lib/badgeCodes.ts`, `lib/badgesView.ts`, `hooks/use-badges.ts` (+ `useBadgeRows` for the Profile row), `app/badges.tsx`, `components/BadgeTile.tsx`, `BadgeDetailSheet.tsx`, `IconChip` size prop, `_layout.tsx`, Profile Badges row, sign-out clearing; share: `lib/shareImage.ts`, `lib/shareFlow.ts`, `components/ShareImageComposition.tsx`, `ShareImageHost.tsx`, `hooks/use-share-image.ts`, `hooks/use-share-context.ts`; MA-20 gains Share, Keep going and See your badges; locales EN and FR; `react-native-view-shot` 5.1.0 and `expo-sharing` ~57.0.27 (pnpm lockfile via `npx expo install`).

**Deviations (all also in docs/decisions.md).** The back-fill is `private.backfill_badges()` run once by the migration, in the migration's one transaction under the 5 s lock_timeout (a DO block cannot commit). `rebuild_engagement` lets a stored badge win over a recomputed one. `expo-sharing` is ~57.0.27, not the ~57.0.18 of planning (what `npx expo install` selects today). Three catalog keys keep the literal "4 weeks" and are exempt from the repo's no-literal-config-count test.

**Build order for the owner.** New EAS store build first (iOS and Android; both libraries add native code and the app has no OTA channel), wait until that build is the installed one, then release. The server migration is safe to deploy first (dark, additive, old apps never call `get_my_badges`), but the migration number is provisional and must be assigned at merge time.

**Manual device check (not run here; one pass for epics 30 and 31 after the store build).**
1. Install the new build on one iPhone and one Android phone. Sign in as a member of a gym whose engagement epoch is set (login and account state: restate in the QA message).
2. Profile, Training card: a Badges row after My visits, value "n of 5". Open it: five tiles in order First visit, 7, 30, 100, 4 weeks; earned tiles show the check corner and "Earned 14 Oct" style dates (FR "Obtenu le 14 octobre"); locked tiles show progress text, no lock. Pull to refresh. Airplane mode: the same tiles from the device copy.
3. Tap an earned tile: the sheet shows the large chip, name, date, [Share]. Tap a locked tile: same sheet, no Share, progress line.
4. Reach a 7th visit day (or use the QA kit) and open the app: the celebration shows [Share] (primary), [Keep going], [See your badges]. Tap [Share]: the button shows a spinner without changing width, the OS share sheet opens (iPad: anchored to the button). Choose WhatsApp status (and Save to Files / another target).
5. Confirm the shared image: PNG, exactly 1080 by 1920 px (check in the target app or Files info), dark `#0A0F17` background, gym name and logo, the numeral and headline, the month calendar with only your lit days, the caption; no member name, no phone, no payment figure, no GymOS watermark. Repeat from a badge sheet with an earned badge.
6. Cancel the share sheet: nothing is shown. After sharing: no `gymos-share-*.png` remains in the app cache (Android: Files, app storage; iOS: not inspectable, check a second share still works).
7. Airplane mode: Share still works (a logo that cannot load is simply left out).
8. [See your badges] on the celebration: Back from the shelf returns to Home, and the celebration does not show again.
9. Risks to watch: the off-screen capture at the device's pixel ratio (image exactly 1080 by 1920, not cropped or blank), and on Android whether the target app received the file before the app deleted it.

**Verification run in this pass.** pgTAP: `engagement_badges` 121, `engagement_determinism` 99, all other `engagement_*`, `support_capabilities`, `suspension_rpc_coverage` pass; `scripts/engagement-race.sh` all phases including E; apply, rollback, apply, rollback, apply of 0192; `pnpm --filter mobile test` 1112, `tsc --noEmit`, `pnpm check:i18n`, `check:migrations`, `check:claims` pass. The full `scripts/ci-local.sh` is left to the committed story head.

## Spec Change Log

## Review Triage Log

Pass 1 (Blind Hunter 13, Edge Case Hunter 11, Verification Gap 3 + 2 other). Verdict | route | evidence.

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | `pnpm-lock.yaml` also bumps supabase-js family, react-query, config-plugins, adds glob@14 and minimatch@11 (BH, VG) | high | patch | Confirmed in the diff (`@supabase/supabase-js@2.117.2` to `2.119.2`, `@tanstack/react-query@5.104.1` to `5.108.4`); these packages are shared with the live dashboard and portal and the story's scope is two native modules |
| 2 | Release back-fill call in the migration is observed by no test (VG) | medium | patch | Verified: every test calls `private.backfill_badges()` itself; deleting line 208 passes all tests and ships no history. Add a back-fill check to the `do $verify$` block |
| 3 | Shelf load, offline and failed-read decisions live only in the hook and are source-text asserted; a failed refresh with no readable device copy replaces tiles with the error card; Profile row keeps the previous member's "n of 5" after a user or gym change (VG, EH, BH) | medium | patch | Read `use-badges.ts` `fallback()`: returns error when `cached` is null even if `loadRef` is ready. Extract a pure `resolveShelfLoad` with a table test |
| 4 | `captureSize` returns unrounded 1080/ratio and 1920/ratio, fractional at ratios 2.625 and 2.75 (BH) | medium | patch | Read `lib/shareImage.ts:22-25`: no rounding, no test for fractional ratios. Round and test |
| 5 | Share waits 3 s with no logo because the parent effect resets `logoSettledRef` after the child settled (EH) | low | patch | Read `use-share-image.ts:69-73`: reset sets false regardless of `logoKey`. One-line correction |
| 6 | Odd fifth tile stretches to full width (`flexGrow: 1`) instead of a two-column grid (BH) | low | patch | Read `BadgeTile.tsx` styles: `flexGrow: 1`, `flexBasis: '45%'` in a wrapping row. Direct correction |
| 7 | `get_my_badges` spliced out of alphabetical order in `database.ts` (BH) | low | patch | Cosmetic but a regenerated file would move it; one move |
| 8 | Android may delete the share file before the target app reads it (EH, BH) | maybe-false | defer | Depends on when `expo-sharing` resolves on Android; only a device shows it. Already recorded in `deferred-work.md` by the implementation and named in the owner's device check |
| 9 | Share flow's real file and capture adapters are covered by source-text assertions only; real 1080 by 1920 output unproven (VG, BH) | medium | defer | No render harness exists (spec decision); the device check steps 5, 6 and 9 are the planned proof |
| 10 | Badge share image drops gym name, logo and calendar when opened offline from a cold start, because the context is read over the network (BH) | low | defer | The image is still built and shared (the AC); the gym name survives within a session through `getGymBranding`'s last-good map. A disk cache of the branding is a design change, noted for the owner |
| 11 | Back-fill always writes `silent = true` while the award uses nth day before epoch (BH, EH) | low | reject | The epic AC mandates silent for the release back-fill; the function runs once in the migration while the epoch is NULL in production |
| 12 | "4 weeks" is literal in three catalog keys and the interval is configurable (BH, EH, VG) | low | reject | The UX catalog pins the text; the exemption is already logged in `deferred-work.md` |
| 13 | Unearned badge already due shows "1 more visit to go" while the server returns 0 (BH, EH) | low | reject | UX rule: never "0 more visits"; the clamp is deliberate and the next settle awards it |
| 14 | `nrows` and `nfacts` helpers exclude badge rows (BH) | low | reject | Badge equivalence is asserted explicitly in the new determinism section and `engagement_badges`; the helpers count week and milestone facts as before |
| 15 | `engage.share.preparing` key unused (BH) | low | reject | In the UX catalog for a state the spec does not render; a spinner is the specified feedback |
| 16 | Suspended or deactivated member sees the load-error card (BH, EH) | low | reject | No other state is specified; the member cannot reach the shelf with the area gated |
| 17 | Earned flag and `earnedOn` not cross-checked in parsers (EH) | low | reject | The server shape cannot produce the mismatch; fix adds a guard on an unreachable state |
| 18 | `four_weeks` awarded one settle late because the helper reads stored week facts (EH claim) | false | reject | `award_milestones` is called at the tail of `settle_engagement` (0190:730), after the week facts are written |
| 19 | Spec tasks unticked and change log empty (BH) | false | reject | Tasks are ticked in this pass; the change log records loopbacks only and none occurred |
| 20 | Modal a11y, bare back arrow character, dependency version differs from plan (BH) | low | reject | Same pattern as `ShieldExplainerSheet` and `calendar.tsx`; the version difference is recorded in `docs/decisions.md` |

## Design Notes

- Why the composition is a view-model: the repo has no render harness; a plain data tree is serialisable, so the privacy and parity claims are decidable without adding a test renderer. The component only maps nodes to views.
- Why 360 by 640 captured at 3x: the card reads the same as on screen and the numeral (96) and fonts need no second layout; the owner's device check confirms the real 1080 by 1920 output.
- `four_weeks` earliest week: the held count starts at 0, so the first earned week is the fourth met week of the first run; the walk's `earned` is false at the cap, which cannot happen before the first Shield.

## Verification

**Commands:**
- `bash scripts/ci-local.sh` -- expected: GREEN on the committed story head (13-20 min)
- `pnpm --filter mobile test`, `tsc --noEmit`, `pnpm check:i18n`, `pnpm check:migrations`, `pnpm check:claims` -- expected: pass
- `scripts/engagement-race.sh` -- expected: exits 0 with the badge race phase
- pgTAP `engagement_badges`, `engagement_milestones`, `engagement_determinism`, `engagement_settle` -- expected: pass

**Manual checks (if no CLI):**
- Left to the owner's combined browser and device QA of epics 30 and 31, after the new EAS store build: shelf in EN and FR, Share on MA-20 and on a badge, PNG size, WhatsApp hand-off.
