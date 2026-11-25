---
title: '31-2 Streak reminder N-08'
type: 'feature'
created: '2026-11-24'
baseline_commit: 'b3149cc7446dd654cf504ebcf3d8dff8e6fe19d0'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-31-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/epics.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A member can lose a week they were one visit away from keeping simply by forgetting. No push exists for it: `private.send_push_notification` only serves N-01 to N-03, `notifications.type` stops at N-07, and Profile has no switch. Production is live and the engagement epoch is NULL, so nothing may be sent to anyone until the operator sets it.

**Approach:** One migration (provisional `0191`) adds the N-08 dispatch and delivery tables, the `streak_reminder_opted_out` preference, the sender `private.send_engagement_reminder`, the `private.run_engagement_reminder_job()` cron job (`engagement_reminder`, every 15 minutes) and the `process_notification_deliveries()` branch. The job reads only `engagement_state_view` flags. Mobile gains the Profile toggle, the N-08 history type and icon. The criteria of `epics.md` "Story 31.2" and the MA-12 and `n08.*` catalog in EXPERIENCE.md are the authority; this spec adds the code map and the decisions below.

## Boundaries & Constraints

**Always:**
- Server contract exactly as `epics.md` 31.2. Migration `0191_streak_reminder_n08.sql` (provisional number, opens `set local lock_timeout = '5s';`) and `scripts/rollback-0191-streak-reminder-n08.sql` (rehearse apply, rollback, apply, rollback, apply on the local DB). Every created or replaced function gets `revoke execute ... from public, anon, authenticated` (plus `service_role` where it is cron-only) in the same file, asserted with `has_function_privilege` in pgTAP.
- Tables `private.engagement_reminder_dispatches` (unique `(member_id, gym_local_date)`) and `private.engagement_reminder_deliveries` copy the class-reminder shape of 0059 column for column, indexes included, RLS on, granted to `service_role` only. `public.notifications.type` CHECK is dropped and re-added to N-01..N-08 (still rejecting N-09). `member_preferences.streak_reminder_opted_out boolean not null default false`; the existing self policies and protect trigger need no change.
- `private.process_notification_deliveries()` is replaced in whole. Start from the live definition at merge time (read it from the local DB with `pg_get_functiondef`; 0059 is the last file that defines it), add the fifth `union all` branch for `engagement_reminder_deliveries` in the exact shape of the class-reminder branch, change nothing else.
- Job `private.run_engagement_reminder_job()` (private, not public: a public function with "engagement" in its name fails `engagement_facts.test.sql:196`) is registered by `cron.schedule('engagement_reminder', '*/15 * * * *', ...)` and writes one `job_runs` row per run (`success`, or `failure` with the error text and a `log_audit_event` like `run_class_reminder_job`; the count of members that failed goes in the success run's log via `raise warning`, as the class job does). Add `engagement_reminder` (interval '45 minutes') to `scripts/job-runs-alert.sql`.
- Window and epoch are config, not literals: add `reminder_window_start_hour smallint not null default 18` and `reminder_window_end_hour smallint not null default 21` to `platform_engagement_config` (check `0 <= start < end <= 24`; the existing audit trigger already covers the row). The job selects gyms that are `active`, whose gym-local time of day (from `gyms.timezone`, never UTC) is in `[start, end)`, and whose gym-local date is at or after `release_week_start` (NULL means nothing is sent). A new public `my_streak_reminder_hour()` (stable, security definer, authenticated only, any signed-in caller, returns `reminder_window_start_hour`) is the only read the app has for the helper's `{time}`.
- Eligibility is decided by `private.engagement_state_view(member_id)` alone: `at_risk_weekly` true and `visits_needed` as the `{n}` for the text. Around it the job adds only non-engagement facts: member active, role `member`, `streak_reminder_opted_out` false, no dispatch row today. It never recomputes week boundaries, goals or visit counts, never reads `attendance_events`, never takes a member lock and never writes `engagement_facts`. `at_risk_daily` is ignored; the migration header records that a later daily-streak story reads that one flag, with no change to the claim, tables or schedule.
- Per member, inside one `begin ... exception` block (a savepoint, so a failure rolls back only that member including the claim): re-read the state view, claim with `insert into private.engagement_reminder_dispatches (member_id, gym_id, gym_local_date) values (..., private.gym_today(gym)) on conflict (member_id, gym_local_date) do nothing returning id`, and only if a row came back call `private.send_engagement_reminder(p_member_id)`. The sender (one parameter, per the epic) reads the claimed pending dispatch of today, reads the state view for `{n}` and re-checks `at_risk_weekly` (raising if it is false, which rolls the claim back so the next tick retries), inserts the `public.notifications` history row (`N-08`, same title and body as the push), enqueues one `net.http_post` per `device_push_tokens` row in its own exception block, inserts the delivery rows and sets the dispatch `queued` or `no_tokens`. A dispatch with no deliveries is never re-sent that day. Language is `users.preferred_language` (`fr`, else `en`).
- Wording: no server-readable store exists (N-07 is inline in `send_class_reminder`), so the sender holds both languages inline, byte-for-byte from `n08.weekly.title` and `n08.weekly.body_one/_other` (the push body uses the `{{count}}` form: "Come in today: 2 visits left to close your ring." / "Venez aujourd'hui : encore 2 visites pour fermer votre cercle."). A Vitest test reads the migration text and the two locale files and fails on any difference, so the app catalog and the SQL cannot drift; pgTAP also pins the rendered strings. The push title is never the gym name; `data` carries `notificationCode: 'N-08'` and `gymId` and no deep link; no response handler is added. The choice is recorded in Dev Notes.
- Independent of N-06, N-07 and the mandatory notifications: N-08 shares no limit with them and a sent N-08 suppresses nothing. A Pay-per-session member and a member who holds a Shield are reminded like anyone else (no plan gating).
- Mobile (`apps/mobile/src`): `memberPreferencesUpdateSchema` gains `streakReminderOptedOut` and its refine accepts it alone; `notificationPreferences.ts` reads and writes it; `NotificationType` and the `notifications.tsx` icon map gain N-08 (`notifications-active` or the nearest existing MaterialIcons name, primary tint); Profile Notifications card gets the `engage.profile.reminder.label` row with bell Icon Chip, on by default, optimistic flip with revert and the existing inline error toast on failure, accessible label stating its state, helper `engage.profile.reminder.helper` with `{{time}}` formatted by a pure `lib/streakReminder.ts` ("6 pm" EN, "18 h" FR, from the value `my_streak_reminder_hour()` returns; if that read fails the helper line is omitted, never a guessed time). All logic is in the pure file with EN and FR tests; the screen stays thin. `packages/types/src/database.ts` gains the column, the function and the config columns.
- Existing pins edited, each by one disclosed line: `notification_history.test.sql` (CHECK list N-01..N-08, the only named edit), `scripts/job-runs-alert.sql` expected list, and any scan that enumerates private functions or cron jobs and flags the new ones (stop and report anything that needs more). The existing notification pgTAP files (`class_reminder_notification`, `quiet_gym_alerts`, `payment_notifications`, `subscription_lifecycle_notifications`, `notification_history` negative, `notification_preferences` and their `.negative` variants) pass unedited. `check:migrations`, `check:claims`, `check:attendance-readers`, `check:i18n`, `tsc`, mobile Vitest, full pgTAP, `scripts/engagement-race.sh` and `scripts/ci-local.sh` pass.
- Gates reach their consumers (Epic 22 retro 66): a pgTAP scan proves no function except `private.run_engagement_reminder_job` and `private.send_engagement_reminder` writes the two new tables, nothing here writes `engagement_facts`, the loyalty ledger, `guest_sessions`, stamps or `attendance_events`, and `check_in()`, `record_check_in` and `void_staff_check_in` are untouched (prosrc hash pinned as in 31-1). Shown failing against a mutant that makes `record_check_in` call the sender.
- Decided here, recorded in a dated top entry of `docs/decisions.md`: inline wording with a drift test, the job in `private`, window hours as config, sender takes one parameter and reads its claimed dispatch, gym-local date for the epoch check, the epoch stays NULL in production so nothing is sent yet.

**Never:**
- No change to `check_in()`, `record_check_in`, `void_staff_check_in` or the settle path; no call from a scan to the sender; no write to `attendance_events` or `engagement_facts`; no new support capability; no deep link or response handler; no gym name as the push title; no daily-streak copy (`n08.daily.*` stays unused); no failure, guilt or "streak in danger" wording; no new dependency; no mock designs or HTML previews (project rule).
- No production deploy and no push (epics 30 and 31 are tested and pushed together after 31-3). Not run by me: device or browser QA, a real Expo push.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Sends once | goal 3, Sunday 18:15 gym-local, 2 visit days this week (1 still needed, 1 day left), no visit today | one dispatch, one history row N-08, one delivery per token, status `queued` | N/A |
| Second tick same day | same member, 18:30 | no second claim, no second row | N/A |
| Two overlapping runs | two sessions call the job at once | one dispatch, one history row | unique key |
| Outside window or dark | gym local 17:45 or 21:00, or epoch NULL, or gym local date before epoch, or gym suspended | nothing sent | N/A |
| Not eligible | opted out, expired subscription, deactivated, coach, visited today, goal already met, goal still reachable without today | nothing sent | N/A |
| Voided visit | only visit today voided, eligibility otherwise holds | member is reminded | N/A |
| Visit between select and claim | member checks in after selection | skipped by the re-read | N/A |
| Holds a Shield, Pay-per-session, no streak | otherwise at risk | reminded | N/A |
| No push token | at risk, no `device_push_tokens` | dispatch `no_tokens`, history row exists, no delivery | N/A |
| One member fails | sender raises for member A | A's claim rolled back, B and C sent, run `success` with a warning | per-member savepoint |
| Whole run fails | job body raises | one `job_runs` failure row with the error, audit event | N/A |
| Language and plural | `fr` and `en`, `visits_needed` 1 and 2 | exact catalog strings, singular and plural | N/A |
| Preference toggle | opt out then in | `streak_reminder_opted_out` true then false, next tick follows it, another member's row untouched | revert on error |
| Same day as N-06 and N-07 | both already sent | N-08 still sent, neither suppressed | N/A |
| Delivery processing | ticket ok, ticket error, `DeviceNotRegistered` | `delivered`, `failed`, `device_not_registered`, invalid token cleaned | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0059_class_reminder_notification.sql` -- dispatch and delivery shape (30-70), `send_class_reminder` (81-180), `process_notification_deliveries` four branches (195-440), job function and cron (460-488). Live `send_class_reminder` and its history row: `0084_notification_history.sql:462-570` (CHECK at line 20), job body after 0181 at `0181:1043-1100`.
- `supabase/migrations/0190_streak_shields_comeback.sql:740-900` -- `engagement_state_view` columns `at_risk_weekly`, `visits_needed`, `days_left_in_week`, `visited_today`, `enabled`; the at-risk rule is already `enabled and not in_release and not visited_today and not goal_met and needed = days_left and sub_status <> 'expired'`. `0184:20-60` config table and audit trigger. `0157:20` `private.gym_today`. `0047` `member_preferences` and its self policies.
- New: `supabase/migrations/0191_streak_reminder_n08.sql`, `scripts/rollback-0191-streak-reminder-n08.sql`, pgTAP `engagement_reminder.test.sql` (fixtures `00000000-0000-0000-00NN-...`, NN unused: grep first; model `engagement_job.test.sql` and `class_reminder_notification.test.sql`), `scripts/engagement-race.sh` extended with an overlapping-run phase.
- Tests to touch: `notification_history.test.sql:19-21` (the CHECK list), `scripts/job-runs-alert.sql:12-30`. Check without editing first: `engagement_isolation.test.sql`, `engagement_facts.test.sql:196`, `support_request_path.test.sql`, `suspension_rpc_coverage.test.sql` (new private writers of the two tables are not gated tables), `support_excluded_from_counts.test.sql`.
- `packages/types/src/schemas/memberPreferences.ts`, `packages/types/src/database.ts`.
- Mobile: `services/notificationPreferences.ts`, `services/notificationHistory.ts:3`, `app/notifications.tsx:35-41`, `app/(tabs)/profile.tsx` (state 93-96, load 280, 498, toggles 411-432, card 770-800), new `lib/streakReminder.ts` and test, a drift test reading the migration and `locales/{en,fr}.json` (`n08.weekly.*`, `engage.profile.reminder.*` already exist; add no new key unless a string is missing), `lib/weeklyRing.source.test.ts` scans for the new file.
- `docs/decisions.md` top entry; `deferred-work.md` (search for lines naming 31-2 or N-08 before closing).

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0191_streak_reminder_n08.sql`, `scripts/rollback-0191-streak-reminder-n08.sql` -- tables, CHECK, preference column, config columns, sender, job, cron, delivery branch, `my_streak_reminder_hour`, grants, verify block, rollback -- server contract
- [x] `supabase/tests/engagement_reminder.test.sql`, `notification_history.test.sql`, `scripts/engagement-race.sh`, `scripts/job-runs-alert.sql` -- every I/O row, privilege matrix, consumer scan and mutant, strings pinned, delivery processor branch, existing families unchanged -- gates reach their consumers
- [x] `packages/types`, `services/notificationPreferences.ts`, `notificationHistory.ts`, `notifications.tsx`, `lib/streakReminder.ts` (+ tests), `profile.tsx`, drift test -- toggle, history type, helper time
- [x] `docs/decisions.md`, `deferred-work.md` -- dated entry, close lines naming 31-2 or N-08

**Acceptance Criteria:**
- Given the epics.md Story 31.2 criteria and the I/O matrix, when the migration, pgTAP, race script and Vitest run, then every listed server and screen state matches, in EN and FR.
- Given `release_week_start` NULL, when the job runs, then it writes one `job_runs` success row and no dispatch, history or delivery row.
- Given any function other than the job and sender writes the new tables, or `check_in()`, `record_check_in` or `void_staff_check_in` change, or a new function is anon-executable, then pgTAP fails.

## Implementation Notes

- **Wording choice (Dev Notes, as the epic asks):** inline, no server-readable store. The four strings live in `private.engagement_reminder_text(language, n)` in 0191, a small immutable function the sender calls (one deviation from "the sender holds both languages inline": visits needed always equals the days left, so a test can reach only one plural form per day through the sender; the function lets pgTAP pin all four). `apps/mobile/src/lib/streakReminder.drift.test.ts` pins the SQL to `locales/{en,fr}.json`.
- **Per-member re-read:** the selection holds non-engagement facts only; the one `engagement_state_view` read per member sits right before the claim inside the member's savepoint (so "re-read" and "read" are the same read; a second read in the selection would double the cost for at-risk members). The sender reads it again and raises if the member is no longer at risk.
- **Time:** pgTAP sets the window around the real current hour and the goal default to the days left (see the file header). The real `engagement_reminder` cron job records its own committed `job_runs` rows on the local database, so the test counts only rows stamped with its own transaction time.
- **Existing pins edited beyond the two the spec named** (one line each, all disclosed in docs/decisions.md): `engagement_config.test.sql` (smallint rule in the audit probe), `engagement_settle.test.sql` (pinned function list), `suspension_rpc_coverage.test.sql`, `support_proxy_actor.test.sql`, and `scripts/job-runs-alert.test.sh` (job list).
- **Not run by me:** `scripts/ci-local.sh` (needs a committed head), device or browser QA, a real Expo push.

## Spec Change Log

## Review Triage Log

Pass 1 (Blind Hunter 15, Edge Case Hunter 10, Verification Gap 2). Verdict | route | evidence.

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | Opt-out, deactivation, role, gym status not re-checked between selection and claim (BH, EC) | medium | patch | Verified in 0191: the per-member block re-reads only `at_risk_weekly`; the epics AC says the off-switch holds "even if a claim has not yet happened" and eligibility is re-run before the claim. Fix in the sender (raises, rolling the claim back), so pgTAP can reach it |
| 2 | A run where every member fails reads `success` with only a warning (BH) | medium | patch | The epics AC says "a failure is counted into the `job_runs` row"; the spec's "warning only" wording under-delivered it. Smallest fix: the success row's `error` carries "n of m failed, first: ..." (alert watches `status`, unchanged) |
| 3 | No test runs the schema refine or the service's column mapping and `getStreakReminderHour` guard (VG, BH) | medium | patch | Confirmed: no `notificationPreferences.test.ts`, no schema test; dropping the refine clause or the select column breaks the switch with CI green |
| 4 | Drift test reads `0191_streak_reminder_n08.sql` by literal path (BH) | low | patch | Migration numbers are assigned at merge (epic context); a renumber fails with ENOENT. One-line glob |
| 5 | `toast ?? saveErrorToast` hides a failed-save message behind another toast (EC, BH) | low | patch | Direct correction: the error toast takes priority |
| 6 | Profile wiring (handler arguments, retry assignments, toast) has no behavioural test (VG) | medium | defer | No render or hook harness in the repo (same as the 31-1 deferred entry); the logic that can be decided is already in `streakReminder.ts` |
| 7 | One transaction, no batch cap, state view read for every member of every window gym on 12 ticks (BH) | maybe-false | defer | Spec Design Notes decided "no bound". Read-only savepoints take no xid, so the subtransaction cache argument does not hold; the per-tick time at 10k members is unmeasured |
| 8 | One invalid `gyms.timezone` aborts every run (EC, BH) | low | reject | The only write path is zod-enum validated (31-1 triage); the fix adds a guard on a state no path can reach |
| 9 | Benign race (member visits between the two reads) counted as a failed member and warned (EC) | low | reject | Warning noise only; the count is now surfaced by #2 and a race is rare |
| 10 | `job_runs.finished_at = now()` gives zero duration (EC) | low | reject | Every job in the repo does the same |
| 11 | Claim lands after midnight with window end 24 (EC) | false | reject | `now()` is the transaction start, so `gym_today` is the same value for selection and claim |
| 12 | `my_streak_reminder_hour` NULL without a config row (EC) | false | reject | The singleton row is inserted by 0184 and a unique index on `(true)` keeps it |
| 13 | Race script sleeps, global side effects of phase D, leaked tmp files (EC, BH) | low | reject | Same shape as phases A to C; documented to need a pristine DB |
| 14 | Accessible label does not state the state (EC, BH) | false | reject | Sibling toggles set the same label and `accessibilityState.checked` (profile.tsx 794-795); that is "like the other notification toggles" |
| 15 | Job's epoch and gym-date guard unobservable (BH) | low | reject | Mandated by the epics AC; already recorded in deferred-work.md by the implementation |
| 16 | `fr-CM` gets English push while app helper uses `startsWith('fr')` (BH) | low | reject | Same `lower(...) = 'fr'` rule as N-07 and the spec ("fr else en"); preferred_language holds `en` or `fr` |
| 17 | Rollback restores the 0059 processor, no retention for new tables, search_path without pg_temp, helper wording approximate, global counts in pgTAP, md5 pin notes, icon-map test (BH) | low | reject | Each matches an existing precedent (0181 rollbacks, class reminder tables, `send_class_reminder`) or is spec-decided; none names a path that breaks |

## Design Notes

- Why a savepoint, not a commit per member: the epic says one transaction per member, but a plain function cannot commit; `run_class_reminder_job` already isolates members with `begin ... exception`, which rolls back only that member's claim, history row and deliveries. A procedure with COMMITs (as `engagement_settle_job`) is not needed because the job holds no member lock and writes no engagement fact.
- Cost: only members of gyms inside their window, active, not opted out and without a dispatch today reach the state view, 12 ticks in a 3-hour window; the fold is the same cost Home pays per open. Record the per-tick count in the pgTAP `explain`-style note, no bound is added.

## Verification

**Commands:**
- `bash scripts/ci-local.sh` -- expected: GREEN on the committed story head (13-20 min)
- `pnpm --filter mobile test`, `tsc --noEmit`, `pnpm check:i18n`, `pnpm check:migrations` -- expected: pass
- `scripts/engagement-race.sh` -- expected: exits 0 with the overlapping-run phase

**Manual checks (if no CLI):**
- Left to the owner's combined browser and device QA of epics 30 and 31: Profile toggle in EN and FR, a real N-08 push on a device build, N-08 row in notification history.
