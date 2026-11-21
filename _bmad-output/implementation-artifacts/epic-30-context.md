# Epic 30 Context: Member Engagement Core — Weekly Ring, Calendar, Leaderboard, Milestones

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Give members a reason to open the app on the days they visit: they set a weekly goal and see a ring and a weekly streak, a calendar of visit days with today's "at risk" state, a monthly gym leaderboard where they can appear as "Anonymous", and a one-time celebration at their 7th, 30th and 100th visit day. Everything is derived from attendance the product already keeps. The aim is pride and protection, never guilt. Production is live with real gyms, so the area ships dark until the operator sets an epoch.

## Stories

- Story 30.1: Engagement Configuration, Weekly Goal & Wording Catalog
- Story 30.2: Engagement Facts, the Fold & Settle
- Story 30.3: Settle Triggers & the At-Risk State
- Story 30.4: Weekly Ring & Streak on Home
- Story 30.5: Attendance Calendar
- Story 30.6: Gym Leaderboard & Anonymous Choice
- Story 30.7: Milestones & Celebration

## Requirements & Constraints

- Weekly goal is 1 to 7 visit days, default 3. A change applies from the next gym-local Monday, so a goal can never be lowered after a bad week. The goal in force is recorded per week and never rewritten.
- Weekly streak is consecutive gym-local weeks that met the goal in force, computed on the server when a week closes. Best streak is never lowered. A week below goal ends the run (Shields and comeback are Epic 31). A bare "0" is never shown.
- A visit day is a gym-local calendar day with at least one counted attendance record; several check-ins count once. Class-only attendance is not a visit day. Voided and rejected check-ins count for nothing. All members see the same features regardless of plan.
- At release, existing history counts for the calendar, totals and the current month's board. Members already past 7, 30 or 100 get those milestones silently, with no celebration. The weekly streak starts from the first full week after release.
- Leaderboard ranks by distinct visit days in the current gym-local month, resets monthly, and is per gym only. It shows the top 10, then the member's row with one neighbour each side and the gap to the one above. Ties share a rank, ordered by who reached the count first. Unranked members are omitted. Under 3 ranked members it shows no names.
- A visible member appears as first name plus last initial, with no photo or phone. Until a member has seen the first-open notice they appear as "Anonymous". They can hide at any time, effective from the next load. Rank carries no prize, discount, session, Shield or stamp, and no role can edit a count or rank.
- Milestone celebration shows once per milestone. One reached offline appears after the visit syncs. The calendar marks milestone days.
- Today's calendar cell shows "at risk" with hours left when the member has not visited today and a visit is needed to keep the streak.
- Wording is editable EN/FR text in the locale files, never fixed in screens. Tone rule: no loss, no countdown pressure, no exclamation marks, no "last chance" or "streak lost".
- NFR: counts are deterministic and recomputable from attendance (late offline visits correct the counts they belong to). Boundaries use the gym's local time, and a later timezone change never moves past days. Ring, calendar and leaderboard must load within 2 seconds on a mid-range Android on 4G at the tier's member cap (baseline to measure). Leaderboard privacy is enforced and tested server-side on every read path (a hidden member's name or identifier never reaches another device, and no cross-gym rows).

## Technical Decisions

- Engagement is an append-only ledger of facts (`engagement_facts`, keyed by member, kind, subject and revision). The effective fact is the highest revision, so replays insert nothing and corrections are never dropped. Streak and state are derived by folding effective facts, not stored as counters. A `rebuild_engagement(member_id)` fold is compared with the live fold in tests.
- `attendance_events.visit_day` is the gym-local date written once at insert and never recomputed. `member_visit_days` is the distinct set from `attendance_counted`. Every count reads `attendance_counted` or `member_visit_days`, never `attendance_events`.
- A watermark table (`engagement_state`: settled_through, dirty_from) drives settling. `record_check_in`, `void_staff_check_in` and settle all take the member lock first and mark `dirty_from`. Settle is idempotent, run by a cron job (per-member short transactions, `skip locked`) and by the mutating RPC `open_engagement()` on first open after a week closes, never by a plain read.
- `private.engagement_state_view(member_id)` is the single source for the open week, at-risk flags and `day_ends_at`. Ring, calendar and later the reminder read only it.
- Singleton `platform_engagement_config` (Super Admin only, audited on the whole row) holds the parameters. `release_week_start` NULL means dark: nothing is settled and `my_engagement().enabled` is false. The operator turns it on with a Monday, recorded in a dated `docs/decisions.md` entry.
- `member_weekly_goals` is written only by the member-owned `set_weekly_goal`, with no date parameter (the server picks next Monday). A trigger refuses any write to the current or a past week. New week helpers: `private.gym_local_week_bounds(tz, at)` (Monday start, DST-safe by adding the interval to the local timestamp) and `private.week_start_of(date)`. Week and month arithmetic is on `date`, using `gym_today`, `gym_local_day_bounds` and `gym_local_month_bounds`.
- `gym_leaderboard(p_month)` is the one SECURITY DEFINER leaderboard function. It answers member callers only, accepts only the current or previous month, returns `(rank, label, visits, is_self)` plus `ranked_total`, and produces "Anonymous" on the server (when hidden or notice unseen). It returns no ids, photos or phones except the caller's own. Preferences are written only by `set_leaderboard_visibility` and `mark_leaderboard_notice_seen`. Milestone `acknowledged_at` is set by one function.
- Conventions: engagement tables enable RLS with no policy and no grants (definer functions only). Member RPCs resolve the caller live (member role, own non-deactivated member row, active gym), not from the token. Staff, support, anon, deactivated members and suspended gyms are refused (writes) or get empty results (reads). None of these RPCs is registered in `private.support_capabilities`, so `support_capabilities.test.sql` stays unchanged.
- Mobile wording lives only in `apps/mobile/src/locales/{en,fr}.json` under `engage.*`. Story 30.1 adds the shared catalog, including reserved empty mascot keys and the Epic 31 wording. Screen stories add their own keys to both files. `pnpm run check:i18n` stays green.
- Testing: the mobile app has no E2E harness. Journey coverage is pgTAP plus component tests. Migration numbers are assigned at merge time, and earlier stories never renumber.

## UX & Interaction Patterns

- No new tab. The calendar (MA-18) and leaderboard (MA-19) are pushed full-screen routes. The celebration (MA-20) is a full-screen overlay pushed automatically over Home once for an unacknowledged non-silent milestone, and closes to Home. The weekly goal (MA-23, `/goal`) is a bottom sheet (up to 60% height, swipe or Android back dismisses without saving). No badge or dot is added to the tab bar.
- Home gets a "This week" card (ring, streak chip, at-risk hint, "Goal: N days" button) and a Leaderboard card. The whole ring card taps through to the calendar.
- Goal ring: equal arc segments, one per goal day (1 to 7). Each visit fills one in the gym colour, and goal met turns all to the success colour with a check. Extra visits add no segments. A new week shows "0 / 3".
- Streak chip appears only after at least one met week. One met week reads "First week done", and "0 weeks" is never shown.
- Profile gets a "Training" card between the account and Notifications cards, with a Weekly goal row. A pending change reads like "3 days, then 4 from Mon 24 Nov". The Badges and Anonymous rows come in Epic 31 or later stories.
- Leaderboard first open shows the notice explaining how the member will appear (first name and last initial) and offers to hide. A "behind" line never names an individual.
- The screen states and copy in the UX spec are the acceptance baseline for each screen story.

## Cross-Story Dependencies

- Order: 30.1 first (config, week helper, goal, wording catalog). 30.2 needs 30.1. 30.3 needs 30.2 and re-creates the Epic 27 `private.record_check_in` and `public.void_staff_check_in`. 30.4 and 30.5 need 30.3 and are independent of each other. 30.7 closes the epic by amending the settle function (30.2), the state read (30.3) and the calendar (30.5), and by pushing its screen from Home (30.4).
- 30.6 touches nothing from 30.2 to 30.5 and can run in parallel once 30.1 has merged.
- Hard dependency on Epic 27: `visit_day`, `member_visit_days`, `attendance_counted`, `record_check_in` and the void function. Epic 31 (Shields, comeback, reminder, badges, share) builds on this epic's fold, state view and wording catalog.
- 30.3 changes live check-in paths, so it needs the full `scripts/ci-local.sh` gate with the existing check-in pgTAP files passing unedited. The other stories add only tables and functions that no existing path calls.
