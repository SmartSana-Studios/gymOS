---
title: '30-6 Gym leaderboard and anonymous choice'
type: 'feature'
created: '2026-11-23'
baseline_commit: '2be05550dd8db1f85de737d18d06f134b81ab0dc'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-30-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/epics.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A member cannot see where they stand among their gym's members, and nothing yet protects a member from being named on a board before they agreed to it. Production is live; the engagement epoch is NULL, so nothing may change for a member until the operator sets it.

**Approach:** Migration `0188` adds two `member_preferences` columns, a trigger that refuses direct writes to them, two member RPCs (`set_leaderboard_visibility`, `mark_leaderboard_notice_seen`) and two reads (`gym_leaderboard(p_month)`, `my_leaderboard_settings()`). The server alone decides who is "Anonymous" and builds every label, rank, tie and total. Mobile adds the `/leaderboard` route (MA-19, with its first-open notice), the Profile Anonymous row (MA-12) and the Home Leaderboard card (N3), all reading the server's answer only. `scripts/engagement-load.sh` records the NFR-029 baseline. The criteria of `epics.md` "Story 30.6" and MA-19, the MA-12 Anonymous row and MA-09 N3 in `EXPERIENCE.md` (lines 2149-2205, 1853-1868, 1596-1603; copy catalog 673-709, 782-785) are the authority; this spec adds the code map and the decisions below.

## Boundaries & Constraints

**Always:**
- Server contract exactly as `epics.md` 30.6: column allow-list `position, rank, label, is_anonymous, visits, is_self, is_tied, visits_behind, ranked_total, self_ranked`; the fewer-than-3 single-row form; label rule ("CHANTAL N.", capitals as stored); Anonymous when `leaderboard_hidden` or notice unseen; own row carries the label as others see it; `invalid_month` (errcode `22023`) for any month but the first of the current or previous gym month (`date_trunc('month', private.gym_today(gym))`); eligible = `deactivated_at is null and role is distinct from 'support'` (the epic's literal rule; a staff row with counted visits ranks, followed on purpose, recorded in decisions.md); visits = distinct `visit_day` from `attendance_counted`, tie time = `min(checked_in_at)` on the member's Nth distinct visit day.
- All four functions follow `my_engagement()` / `set_weekly_goal`: `language plpgsql security definer set search_path to 'public'`, `stable` on the two reads, role check first (`private.current_member_role()` is `member`), then `private.gym_id()`, own non-deactivated `members` row, then `private.current_gym_status()`. Reads return empty at every failed step and write the status guard as `coalesce(private.current_gym_status()::text,'') <> 'active'`; the two writes raise `42501` with the literal `private.current_gym_status() is distinct from 'active'` and an `is not active` message before any write (`suspension_rpc_coverage` scan). `revoke execute ... from public, anon, service_role`, `grant execute ... to authenticated`. No member id parameter. None is registered in `private.support_capabilities`. No `'supervisor'` text in any body.
- The trigger `private.protect_self_managed_member_preferences_columns` is re-created with `create or replace`, keeps the three existing pins and the two opt-out booleans writable, and raises `leaderboard_columns_write_protected` (errcode `42501`) when `leaderboard_hidden` or `leaderboard_notice_seen_at` changes without the transaction-local flag (copy `app.engagement_acknowledge` at `0185:114`, set with `set_config(..., true)` only inside the two writers). `notification_preferences.test.sql` and `.negative.test.sql` pass unedited.
- `gym_leaderboard` has no INSERT, UPDATE or DELETE, `provolatile = 's'`, names no `supervisor`. Nothing is stored or cached server-side; a hide never leaves a name behind. Add the supporting index only if the load run shows p95 over 1 s (`idx_attendance_events_gym_visit_day` from 0173 already exists; check with `EXPLAIN`).
- Mobile: a new `src/services/leaderboard.ts` calls the four RPCs (never `updateMemberPreferences`, never `.from('attendance_events')`). Pure logic (view model, row and accessibility labels, state selection, cache) lives in `src/lib/leaderboardView.ts` with tests in EN and FR per state; components stay thin. The device never derives a label, rank, tie, total or `visits_behind` and never builds a month: the two month arguments come from `gymToday` of `my_engagement()` through `calendarGrid.ts`. A Vitest scan bans sort, reduce, split, charAt and rank arithmetic in the board files.
- Notice: one shared component. `/leaderboard` renders it in place (list not rendered, `gym_leaderboard` not called until the member chose); Profile shows it in a full-screen RN `Modal` whose `onRequestClose` and header back only close it (no swipe, no tap-outside). [Show my name] calls only `mark_leaderboard_notice_seen`; [Appear as Anonymous] calls `set_leaderboard_visibility(true)` then `mark_leaderboard_notice_seen()`; buttons disabled with spinner until the call returns; failure shows `notice.error`; offline disables both and shows `offline.notice`. Leaving never marks the notice seen. A cached board is never shown before the notice is chosen.
- Profile row sits in the Training card after "My visits", under the same `enabled` gate; toggle on saves at once, optimistic with revert on failure, per-row pending flag (the Notifications pattern), accessible label states its state; toggle off while the notice is unseen saves nothing and opens the notice. Home card sits between the ring section and `RewardsCard` and shows only the member's own standing; `index.tsx` gets exactly one leaderboard load call and must not mention `gymToday`, `weekStart` and the like (source scan).
- Keys: `engage.leaderboard.*`, `engage.home.rank`, `engage.profile.anonymous.*` in both locale files (EN/FR parity, i18next `_one/_other` + `{{count}}`, `{{n}}`, `{{total}}`, `{{label}}`, `{{gym}}`, `{{min}}`), all added to REQUIRED in `engage.test.ts`; no sentence in a `.tsx`. `{{min}}` is the constant 3 of FR-226; `{{gym}}` comes from the gym name each screen already reads. No ICU braces, no `!`.
- Decided here and recorded in decisions.md: the load script is not wired into `ci-local.sh` or `ci.yml` (a baseline, not a gate); it seeds at `max(member_cap)` of `tiers` (NULL means unlimited and is ignored) and again at 2,000 members, and prints both. Gate shown capable of failing: run the privacy test against a mutant that skips the hidden check and show it fail.
- Epic 22 retro 66/67 (gate consumers, deferrals naming this story). Acceptance lines carried from `deferred-work.md`: the load script also records p50/p95 of `public.my_visit_days(date)` and `public.my_first_visit_day()` for a member with two years of attendance at the same scale (NFR-029); the `invalid_month` bound in `my_visit_days` and `gym_leaderboard` gets a test that fails when `gym_today` is replaced by `current_date` (an injectable clock seam if one is cheap, else a gym whose timezone puts the local month ahead of the UTC month); `epics.md` is NOT edited here (it would stale the epic context), the owner may add the NFR-029 line there. Close those `deferred-work.md` entries.
- Pins edited by one line each, disclosed: `support_request_path.test.sql` E1 array (four names), `support_excluded_from_counts.test.sql` `cat_count` list for `gym_leaderboard`. Anything else needing an edit is stopped and reported. `check:migrations`, `check:claims`, `check:attendance-readers`, `check:i18n`, `tsc`, mobile Vitest, full `pgtap` and `scripts/ci-local.sh` pass.
- FR-228 test enumerates the loyalty, session, stamp, Shield and payment functions and tables and fails when any `prosrc` reads `gym_leaderboard`, `leaderboard_hidden` or a stored rank; no table stores a rank; `has_table_privilege` is false for every role on the engagement and attendance count tables.

**Never:**
- No member id, photo, phone, user id, email or name column in any result; no crown, medal or special rank treatment; no prize, discount, session, Shield or stamp from rank; no tappable row or "who is this"; no mock designs or HTML previews (project rule); no new dependency, tab or tab badge; no server or device cache of names; no device date arithmetic in screen files.
- Migration number `0188` is provisional until merge. No production deploy and no push (epic-end only). Not run by me: device or browser QA.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Caller at position 17 of 43 | current month | rows 1-10, 16, self, 18; `ranked_total` 43; `visits_behind` on self row | N/A |
| Caller at 1-9, 10, 11+ | boundary cases | 1-10 only; 1-10 plus 11; separator where positions are not consecutive | N/A |
| Tie across position 10 | equal visits | first 10 positions by tie time; ties share `rank`, `is_tied` | N/A |
| Fewer than 3 ranked | 0, 1, 2 | one row, `position/rank/label/visits` NULL, `ranked_total`, `self_ranked` | screen picks empty/onlyYou/unranked |
| Unranked caller | no visit this month | top 10, `self_ranked` false, no self row | `unranked` line |
| Hidden M1, unseen M2 | other members | `'Anonymous'` with rank and visits; flip M1 changes only M1 next call | N/A |
| Deactivated or support member | M4, M5 | not present | N/A |
| Other gym, staff, support, anon, deactivated, suspended | caller | empty result; writes refused | `42501` on writes |
| Bad month | not first, older, future | none | `invalid_month` 22023 |
| Direct preference write | member UPDATEs either column | refused | `leaderboard_columns_write_protected`; opt-outs still work |
| First open, notice unseen | `notice_seen` false | notice only, no board call | back leaves, still Anonymous |
| Appear as Anonymous fails midway | hide ok, mark fails | member stays hidden, `notice.error`, buttons re-enabled | N/A |
| Offline | cached board / notice | banner plus `updatedAt`, toggle and buttons disabled; no cached board before the choice | retry on reconnect |
| Error | RPC failure | `engage.leaderboard.error` in list slot, visibility row kept, pull to refresh | Home: `error.short`, tap retries |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0047_notification_preferences.sql:25-117` -- `member_preferences`, trigger `protect_self_managed_member_preferences_columns` (82-99; detects self via `auth.uid()`, silently pins 3 columns, no flag today). `0185:95-125` -- flag pattern (`app.engagement_acknowledge`, `set_config(..., true)`). One row per member is guaranteed (`create_default_member_preferences`, backfilled).
- `supabase/migrations/0184:207-300` (`set_weekly_goal`, write guard 219-247), `0186:918-989` (`my_engagement`, read shape), `0187:25-75` (`my_visit_days`, month check 62-66, grants) -- copy structure. `private.gym_today` `0157:20`. `attendance_counted` / `member_visit_days` `0174:55-70` (has `checked_in_at`, `visit_day`).
- New: `supabase/migrations/0188_gym_leaderboard.sql` (opens `set local lock_timeout = '5s';`, checked by `check:migrations`) and `scripts/rollback-0188-gym-leaderboard.sql`; new pgTAP `leaderboard_ranking.test.sql`, `leaderboard_privacy.test.sql` (one block per read path), `leaderboard_visibility.test.sql` (columns, trigger, both writers, caller matrix), `leaderboard_fr228.test.sql`. Model on `my_visit_days.test.sql` and `weekly_goal.negative.test.sql`; fixture ids `00000000-0000-0000-0039-...` pattern.
- Pins: `support_request_path.test.sql` E1 (~232) add `gym_leaderboard, mark_leaderboard_notice_seen, my_leaderboard_settings, set_leaderboard_visibility`; `support_excluded_from_counts.test.sql` ~210-219 `cat_count`; `suspension_rpc_coverage.test.sql` scan wording (no edit expected).
- `packages/types/src/database.ts` -- splice four functions and the two `member_preferences` columns (row at 1287).
- New: `scripts/engagement-load.sh` modelled on `scripts/engagement-race.sh` (host copies into `supabase_db_gym_os`, detached, verdict last line, fixtures `00000000-0000-0000-0000-00000030f...`, `trap cleanup EXIT`); `tiers.member_cap` nullable (0011:52-53). Dated entry at the top of `docs/decisions.md` (above 30.5).
- Mobile: `src/services/leaderboard.ts` (+ test; model `services/visitDays.ts`, `weeklyGoal.ts`, mock pattern in `visitDays.test.ts`); `src/lib/leaderboardView.ts` (+ test, own cache key per user, gym and month, `readEngagementCache` style); `src/components/LeaderboardRow.tsx`, `LeaderboardNotice.tsx`, `LeaderboardHomeCard.tsx`; `src/hooks/use-leaderboard.ts`, `use-home-leaderboard.ts` (seq guard and cache like `use-home-engagement.ts`); `src/app/leaderboard.tsx` (model `app/calendar.tsx`); register `<Stack.Screen name="leaderboard" />` in the `isFullyOnboarded` group of `_layout.tsx` (~148-151).
- Reuse: `ui/SegmentedControl`, `ui/Button` (`loading`), `ui/IconChip` (check glyphs `person`, `visibility_off`, `groups`, `leaderboard` exist), `ui/Card`, RN `Switch`. Profile `src/app/(tabs)/profile.tsx:566-606` Training card, handlers 352-375 and `quietGymAlertsPending` (88) pattern; Home `src/app/(tabs)/index.tsx:706-713`, load at 260. Profile reads `notice_seen` on focus beside `getMyWeeklyGoal` (104-124).
- Tests: `weeklyRing.source.test.ts` (add the new files to `SCREEN_FILES` 24-41, `ARITHMETIC` applies; add the no-device-derivation scan and the one-load-call scan), `engage.test.ts` REQUIRED (line 11). UX copy to translate: EXPERIENCE.md 673-709, 782-785. `deferred-work.md` lines 2332-2333, 2355, 2366-2367.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0188_gym_leaderboard.sql`, `scripts/rollback-0188-gym-leaderboard.sql` -- columns, trigger, four functions, grants, rollback (rehearse twice) -- server contract
- [x] `supabase/tests/leaderboard_*.test.sql`, `support_request_path.test.sql`, `support_excluded_from_counts.test.sql` -- ranking, privacy per read path, visibility and trigger, caller matrices, FR-228, month-bound clock test, one mutant shown failing -- gates reach every consumer
- [x] `packages/types/src/database.ts`, `src/services/leaderboard.ts` (+ test) -- types and service
- [x] `src/lib/leaderboardView.ts` (+ test), `src/components/Leaderboard*.tsx`, `use-leaderboard.ts`, `use-home-leaderboard.ts` -- view model per state in EN and FR
- [x] `src/app/leaderboard.tsx`, `_layout.tsx`, `profile.tsx`, `index.tsx` -- route, notice, Profile row and Home card
- [x] `locales/{en,fr}.json`, `engage.test.ts`, `weeklyRing.source.test.ts` -- keys, REQUIRED, scans
- [x] `scripts/engagement-load.sh`, `docs/decisions.md`, `deferred-work.md` -- baseline run (p50/p95 for `gym_leaderboard`, `my_engagement`, `my_visit_days`, `my_first_visit_day`), dated entry, close the three deferrals

**Acceptance Criteria:**
- Given the epics.md Story 30.6 criteria and the I/O matrix, when the migration, pgTAP and Vitest run, then every listed server and screen state matches, in EN and FR.
- Given `release_week_start` NULL, when a member uses the app, then Home and Profile are unchanged and no leaderboard function is called.
- Given a new reader of `gym_leaderboard` appears in a loyalty, session, stamp, Shield or payment function, or a name reaches a result for a hidden or unseen member, then pgTAP fails.

## Implementation Notes

- Migration `0188_gym_leaderboard.sql` and `scripts/rollback-0188-gym-leaderboard.sql` (apply, rollback, apply, rollback, apply rehearsed on the local DB; 0188 is applied there, not on production; number provisional). Flag for the trigger is `app.leaderboard_write`. Four new pgTAP files: `leaderboard_ranking` (98), `leaderboard_privacy` (58), `leaderboard_visibility` (71), `leaderboard_fr228` (27).
- Deviations from the spec text: (1) a THIRD pin edited, `support_role_live_gate.test.sql` (`public.gym_leaderboard` added to the functions that may mention the support role), applied as one line and disclosed in `decisions.md` (spec named two); (2) nested JSON cannot hold a key as both string and parent, so `engage.leaderboard.notEnough.title`, `.offline.banner` and `.error.full` are the parents' own strings, plus added keys `.offline.applies`, `engage.profile.anonymous.label`, `.a11yOn`, `.a11yOff`; (3) an anon caller is refused at the privilege (`42501`) rather than getting an empty list; (4) `useHomeEngagement.loadForHome` now resolves to its read's outcome so the Home card reuses that read instead of a second `my_engagement` call; (5) load-script fixture ids are `...0030-f1...`/`...0030-f2...` (the spec's group has room for only 4,096 members).
- Load baseline (server time, p50/p95 ms, 50 calls as different members, 10 at a time; `scripts/engagement-load.sh`, not wired into CI): `gym_leaderboard` 45/78 at max(member_cap)=100 and 99/207 at 2,000 members with two years each; `my_visit_days` 20/52 and 20/49; `my_first_visit_day` 17/43 and 21/54; `my_engagement` 233/336 and 5,413/8,918. No index added (the board uses `idx_attendance_events_gym_visit_day`).
- FINDING outside this story: `my_engagement()` (0186, story 30.3) misses the 2 s NFR-029 target at 2,000 members because the `first_week` sub-select of `private.engagement_state_view_at` seq-scans the gym's counted check-ins. Recorded in `deferred-work.md` and `decisions.md`; needs a story that re-creates the function.
- Verified by me after the subagent: mobile Vitest 698/698, `tsc --noEmit`, `check:migrations`, `check:claims`, `check:i18n`, `check:attendance-readers`, and 12 pgTAP files (the four new, the three pins, `suspension_rpc_coverage`, `support_capabilities`, the two preference files unedited, `my_visit_days`) 12/12. Subagent also ran the full local pgTAP suite (236 of 237 before the third pin, then green) and two mutants (skip the hidden check; `gym_today` replaced by `current_date`), each failing named cases before restore. NOT run: full `scripts/ci-local.sh` (needs a committed head), any device or browser pass.

## Spec Change Log

## Review Triage Log

Pass 1 (Blind Hunter 14 findings, Edge Case Hunter 14, Verification Gap 3; 327 KB diff). No intent_gap, no bad_spec. Six patches (applied by the implementation subagent), one deferral, the rest rejected.

| # | Finding (layer) | Verdict | Evidence | Route |
|---|---|---|---|---|
| 1 | Device copy of the settings is written when the toggle saves with the notice unseen, yet every reader treats a copy as noticeSeen true (ECH) | medium | `profile.tsx` success branch writes the copy without checking `current.noticeSeen`; a later failed read then skips the notice. | patch |
| 2 | `getMyGymName` has no gym filter; a two-gym member reads two rows, `maybeSingle` errors, gym name blank in notice and empty-month copy (BH, VG, ECH) | medium | `services/leaderboard.ts` selects from `gyms` unfiltered; policy "read gyms of own active memberships" returns every live membership. | patch |
| 3 | Home standing cache has no month; after rollover a failed read shows last month's rank as "this month" (BH, ECH) | medium | `readHomeStanding`/`writeHomeStanding` key by user and gym only; both fallbacks show the copy. | patch |
| 4 | Profile offline cold start never shows the Anonymous row (BH) | low-medium | Settings fallback runs only after a successful engagement read; the same shape as the 30.5 Profile pass-2 decision. | patch |
| 5 | A settings read returning during a pending toggle overwrites the optimistic value (ECH) | low | `loadAll`/Profile effect commit unconditionally; window is a refresh in flight when the member toggles. One-line guard. | patch |
| 6 | Dark-area gate and the toggle/notice result mapping pinned only by source text; deleting the dark `return;` or a revert branch keeps all tests green (VG, BH) | medium | Demonstrated by the layer; no renderer exists, so the pure parts are extracted and tested. | patch |
| 7 | Staff rows with counted visits rank as a permanent "Anonymous" and can never choose (BH) | low | Followed the epic's literal rule `role is distinct from 'support'`; the four RPCs refuse non-members, so staff cannot open the notice. Needs an owner decision on the eligibility rule. | defer |
| 8 | Trigger refuses service_role, psql and data fixes (BH, ECH) | low | The sanctioned override is the transaction-local flag; documented in decisions.md by the patch above. | rejected (doc line only) |
| 9 | Server functions do not check the engagement epoch (BH, VG) | low | The epic requires the dark gate on the screens; `my_visit_days` (30.5) is built the same way; with the notice unseen every label is Anonymous, so nothing leaks. | rejected |
| 10 | A failed toggle gives no feedback beyond the revert (BH) | low | The Notifications rows revert without a toast by design (profile.tsx comment); the epic says "existing inline error and revert". | rejected |
| 11 | Toggle shows off while the helper says Anonymous (notice unseen) (BH) | false | The epic specifies "the stored choice" plus `helperUnseen` while the notice is unseen. | rejected |
| 12 | "You're leading" beside "Tied" for a tied first place (BH) | false | The epic sets `visits_behind` NULL when first and the line `leading` for first; the Tied word is the tie signal. | rejected |
| 13 | Leaderboard screen waits on `my_engagement()` (BH) | low | That function's slowness is the recorded 30.3 finding in deferred-work.md; the screen needs `gymToday` from it by design. | rejected |
| 14 | Cached boards keep other members' labels with no sign-out cleanup (BH) | low | Labels the member was already shown on their own device; 30.5 rejected the same shape for the calendar cache. | rejected |
| 15 | Months from a stale engagement copy give `invalid_month` (ECH) | low | Needs an online engagement failure lasting over a month; falls back to the cached board or the error face. | rejected |
| 16 | Blank or punctuated names give an empty label or "JOHN (." (ECH) | low | The epic fixes the label rule literally; names are validated at onboarding. | rejected |
| 17 | Load script: no cap ceiling, leftover epoch after a kill, 30-minute poll on early failure, thin tie spread (BH, ECH) | low | Local-only baseline tool, not a gate; `max(member_cap)` is 100 today. | rejected |
| 18 | `Updated hh:mm` has no date; unused `total` column in `ordered`; "←" glyph; header role inside a button Pressable; empty Spec Change Log (BH, ECH) | low | Same shapes as 30.4/30.5 rejections; the unused window pass is negligible; the Spec Change Log is for loopbacks. | rejected |

## Design Notes

- The server decides `is_anonymous` and the label, so a cached board on the device holds only what the server sent; a hide made after the cache applies from the next load and the offline screen says so.
- Hide-first order in [Appear as Anonymous] means a failure between the two calls leaves the member hidden and un-noticed, never named.
- `{{min}}` is 3 because FR-226 fixes it; the Home card and screen use the server's `ranked_total` to choose the state, never a count of rows.
- Seeding at `max(member_cap)` ignores the unlimited (NULL) tier; the second run at 2,000 members matches the 30.5 timing scale.

## Verification

**Commands:**
- `cd apps/mobile && npx vitest run && npx tsc --noEmit` -- expected: pass
- `pnpm run check:i18n && pnpm run check:claims && pnpm run check:migrations && pnpm run check:attendance-readers` -- expected: pass
- `bash scripts/ci-local.sh` -- expected: GREEN on the committed head (13-20 min; read per-stage lines)
- `bash scripts/engagement-load.sh` -- expected: p50/p95 printed per function (run time a few minutes), baseline recorded

**Manual checks (if no CLI):**
- None by me: the owner does browser and device QA once at the end of the epic.
