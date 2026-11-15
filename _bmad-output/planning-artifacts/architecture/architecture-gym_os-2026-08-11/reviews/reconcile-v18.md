# Input reconciliation: PRD V1.8 vs architecture spine (AD-53..AD-61)

Date: 2026-11-15. Read-only review. Inputs: PRD sections 6.33-6.40, 7.9, 10.3, OQ-32..36 and the V1.8 assumptions index; addendum section M; spine AD-53..AD-61, the "Counting attendance (V1.8)" convention row, the last "Deferred" bullet, and the existing ADs they lean on (AD-18, 19, 22, 25, 28, 29, 30, 31, 32, 33-35, 39).

## Verdict

The spine covers the PRD at the level of data shape and write paths: one ledger, one leaderboard function, one consume function, one check-in writer, one counting view, one setter per setting. The numbers it does state (3 h visit limit, 14 slots, 18:00, top 10 plus one neighbour each side, same-day void, Manager+ void, role lists for Correct plan and the coach picker) all match the PRD. No AD contradicts a PRD number or role outright.

The weak spot is the *definition layer*. Several "what does this mean" questions that the PRD itself answers in prose are bound by no AD and sit across two or more stories (ring/calendar versus reminder, leaderboard versus challenge, session versus class, void versus ledger). Four places are internally inconsistent or silently wrong and should be fixed in the spine before stories start: the release epoch versus `rebuild_engagement`, the timezone-change rule versus the existing gym-local helper, the daily Shield versus the ledger key, and the FR-044 stale close time against a 3-hour limit.

No PRD sentence cites an AD number that does not exist. Addendum M cites AD-28 (exists, and describes `covered_day`/`consumed_at` correctly). The PRD V1.8 sections cite FR/NFR/OQ only.

---

## 1. Coverage map

"Story" means story-level: no real cross-unit divergence risk, or the PRD already fixes it. "Gap" cross-references section 2.

| Requirement | Bound by | Note |
| --- | --- | --- |
| FR-219 goal 1-7, default 3, next-week effect | AD-53, AD-61 | Range 1-7 and default 3 are not stated in any AD (Gap B2). Week = Monday start not stated (Gap A9). |
| FR-220 weekly streak, best streak | AD-53 | Best streak storage not named (derived from ledger, fine). Display of the in-progress week: Gap A8. |
| FR-221 daily streak (Could) | AD-53 (partly) | Ledger key conflict for a daily Shield: Gap C3. |
| FR-222 Shield, cap 2, every 4 weeks | AD-53 | Cap 2 and "every 4" not in spine. OQ-35 "reserve last Shield" undecided: Gap A10. |
| FR-223 Comeback (3 visits, 10 days) | AD-53 (event names only) | No lapse event; window is time-based, `origin_key` is week/milestone: Gap A10. |
| FR-224 calendar and at-risk cell | AD-53 (calendar read), AD-60 (evaluates a/b) | The at-risk state has two consumers and one definition lives only in the job: Gap A1. |
| FR-225 visit day, release behaviour, same features for all | AD-53 (`silent`), convention row | Visit-day definition: Gap A2. Release epoch: Gap C1. "No check-in rule changed": Gap B3. |
| FR-226 leaderboard | AD-54 | Ties, unranked-at-zero, who is a "member": Gap A4, A5. |
| FR-227 Anonymous + first-open notice | AD-54 | Notice state shape and its single write path: Gap A3. |
| FR-228 server enforcement, no prizes, no edits | AD-54, AD-56 | Read grants on ledger tables unspecified: Gap B5. |
| FR-229 milestones 7/30/100 | AD-53 | Void effect: Gap A6. Offline sync display: story. |
| FR-230 badges | AD-53 (`badge_earned`) | `origin_key` for badges undefined (minor). Set is PRD-assumption. |
| FR-231 share image | AD-60 | Library deferred to the story (stated). Logo source: story. |
| FR-232 wording as editable EN/FR text | none | Gap B1. |
| FR-233 N-08 reminder | AD-60 | 18:00, one per day, unique key, own job: bound. a/b evaluation duplicated with FR-224: Gap A1. |
| FR-234 challenge | AD-61 | Counting, roles, creation timing, cancel role, read path: Gap A7. |
| FR-235 "Your month" | none | Story-level. Could, derived from `attendance_counted`; the convention row covers its counting. |
| FR-236 Session validity setting | AD-55, AD-61, AD-32 | Bound. |
| FR-237 Single use, 3 h visit | AD-55 | Stale-close timestamp problem: Gap C4. |
| FR-238 classes in Single use | AD-55 (one sentence) | Gap A5b below (class vs open visit; class with no open visit). |
| FR-239 change of setting, loyalty, reporting | AD-55 ("no setting change alters an existing row"), AD-29/30 | Largely bound. Open-visit-under-old-rule is implied only. |
| FR-240 annual plan clarification | none | Story-level (plan card text; data already exists, FR-025). |
| FR-241-243 Correct plan | AD-59 | "Original start date" and loyalty R-day extension: Gap A11. |
| FR-244 slots (14 max, repeat weekday) | AD-57 | Bound; numbers match. |
| FR-245 migration and edits | AD-57 | Bound. |
| FR-246 coaches create classes | AD-57 | Coach cannot reassign `coach_id` on edit/create: not stated (minor, story with a test). |
| FR-247 coach picker | AD-58 | Bound; support exclusion matches FR-251. |
| FR-248 staff check-in | AD-56 | Bound. |
| FR-249 same rules as scan | AD-56 | Side effects of the shared path (alerts, `session_attempts`) for staff attempts: Gap A12. |
| FR-250 audit, void | AD-56 (+AD-39) | Void effect on sessions/stamps/milestones: Gap A6. |
| FR-251 support registry | AD-61, AD-56, AD-59, AD-35 (indirect) | Registry entries not enumerated, void and cancel not named: Gap A13. |
| NFR-027 | AD-54 | Test per read path stated; read paths other than `gym_leaderboard` not enumerated (Gap A7 challenge progress). |
| NFR-028 | AD-53, convention row | Timezone-change clause not met by the stated mechanism: Gap C2. |
| NFR-029 | AD-54 (cache clause), AD-60 | Bound. Measurement approach is story-level. |

---

## 2. (a) Gaps: independently built stories could implement incompatibly, no AD binds it

### A1. "At risk today" is defined twice (FR-224, FR-233; AD-53, AD-60) -- highest risk

FR-224 says the calendar cell's at-risk state uses conditions (a) and (b) of FR-233 **whether or not the reminder ships or is switched on**. AD-60 puts the evaluation of (a) and (b) inside the `engagement_reminder` job. AD-53 says the ring, calendar and open week are read from `attendance_counted`, but does not name a function that returns the at-risk flag or hours left. Result: the calendar story builds its own query (or computes on the device, which the convention row forbids) and the reminder story builds another; they will differ on the points the PRD leaves implicit (days left in the week "today included", goal in force for the week, whether a Shield counts as saving, member already visited today, a daily streak of exactly 3).
Fix: one STABLE function (for example `member_engagement_today(member_id)` returning `visited_today`, `at_risk`, `reason` a/b, `hours_left`, `days_needed`) read by the calendar/Home and called per member by the reminder job. Bind FR-224 and FR-233 to it in AD-53 or AD-60.

### A2. Visit-day definition is not pinned to a timestamp (FR-225, FR-061, FR-159; AD-29, convention row)

FR-225: the visit day is the gym-local day of "the attendance record's recorded visit time, exactly as FR-061 and FR-159 set it, offline scans included". AD-29 says server receipt time governs coverage, and a client scan time is honoured only for an offline scan within the auto-timeout window. The convention row says boundaries use "the one existing gym-local helper" but not which column, nor whether the day is computed live in `attendance_counted` or stored at write (AD-28 stores `covered_day` "never recomputed" for sessions: a precedent). Two stories can pick `checked_in_at` versus receipt time and differ for every offline scan near midnight. It also feeds Gap C2.
Fix: `attendance_counted` exposes one `visit_day` column, defined once (recommended: written at insert by `record_check_in`, same rule as AD-29's coverage time).

### A3. The Anonymous notice state (FR-227; AD-54)

AD-54 says the choice and "notice-seen time" live on "the member's own settings row" and the label is Anonymous when hidden or notice unseen. Not bound: (i) the row itself (no AD or existing table is named; the spine has no `member_settings`); (ii) the single write path that sets "seen" and "hidden" (AD-61 covers only the goal; two stories could write the flag from different functions, and a client could set "seen" without showing the notice); (iii) whether opening the board both returns the board and marks the notice seen (a race: the first call must return the member as Anonymous, then flip); (iv) what the caller sees as their *own* label; (v) a tri-state (unseen/visible/hidden) versus two columns; (vi) new members after release start unseen, same as existing ones (PRD says so; AD silent).
Fix: one member-owned function `set_leaderboard_visibility(hidden bool, notice_seen bool)` (or two), the state as one tri-state column, and a pgTAP case for "unseen means Anonymous to everyone else, including after `hidden = false`".

### A4. Leaderboard rules the PRD fixes and AD-54 omits (FR-226)

Ties share a rank and are ordered by who reached the count first; members with zero visits are unranked; "behind the one above" is derived. AD-54 states only the return shape. "Who reached the count first" needs a timestamp per member-month (the visit that made the count) and a deterministic final tiebreak; if two stories differ, ranks differ. Also unspecified: when a tie crosses position 10 (does the board show 11 rows).
Fix: state the ordering key and tie behaviour in AD-54.

### A5. Who counts as a "member" (FR-226, FR-234, AD-54, AD-61, AD-33)

AD-33 gives support a real `members` row with `role = 'support'`, and the spine already warns that predicates written `role != 'member'` must be rewritten. AD-54 and AD-61 do not say that the leaderboard, challenge and engagement settle job rank only `role = 'member'` rows, nor how deactivated members, members awaiting the registration fee, and members with an expired subscription are treated. A staff-entered check-in for a staff or support row would also be countable. Define the eligible-member predicate once (a view or function next to `attendance_counted`).

### A5b. Single-use versus classes (FR-238, FR-174; AD-55, AD-29)

AD-55 says only "class attendance marking calls the same function". The PRD rule has two branches the function description does not cover: (1) member has an open check-in: that visit's session covers the class (needs the function to find the open visit's session and a stale-visit test, since the visit may be over the 3 h limit); (2) no open check-in: the class consumes a session, but `covered_attendance_id` is null because no attendance row exists, and nothing says whether that session then covers a later check-in the same day (whole-day does, FR-174: "and the reverse"; Single use does not obviously). Also open: does a class-attended member with no check-in become a visit day (A2b below). The stamp rule (FR-165: one stamp per consumed paid session) interacts with both branches.

### A2b. Is class attendance a visit day? (FR-225)

FR-225 counts "at least one attendance record at the gym". Class attendance is stored on `class_bookings.attended_at` (AD-29/FR-174), a different record from `attendance_events`. `attendance_counted` reads `attendance_events` only, so a member who only attends classes and never scans gets nothing. The PRD does not say; two stories (leaderboard, ring) will agree only by accident. Needs a one-line decision.

### A6. The staff void's effect on the ledger and on everything else (FR-250, FR-229, FR-230; AD-56, AD-53, AD-29, AD-30)

AD-56: "a void appends reversing rows to the ledger and deletes nothing." AD-53 lists no reversal event for milestones or badges (`shield_returned` and `week_corrected` only), yet FR-229/FR-230 say a badge is "earned once and never lost" and a milestone is celebrated once. If a mistaken staff entry was the 7th visit day, does the 7-visit badge go, stay, or get re-earned later? Because the void is same-day only, closed weeks are essentially never affected, so the real exposure is milestones, badges, the Shield earned that week, and a comeback completion. Not stated for: a voided entry that consumed a Pay-per-session session (return the session? reverse the guest stamp, `stamp_reversed` in AD-30? the desk payment recorded for FR-249 stays a payment), a voided entry that triggered a visit-day on a Sunday whose week is settled just after midnight, or one already shown as a celebration.
Fix: one sentence per downstream (milestone/badge: kept, or reversed with `milestone_reversed`; session: not returned; stamp: unchanged; or the opposite) and add the event types to AD-53.

### A7. Challenge counting, roles, timing and read path (FR-234; AD-61)

- *Counting:* "total visit days by all the gym's members" is a distinct (member, gym-local day) count, not raw check-ins and not distinct days across members. AD-61 only says "derived from `attendance_counted`". Pick: sum over eligible members (see A5) of distinct visit days in the gym-local month.
- *Creation timing:* FR-234 says one per gym-local month, "fixed once the month starts"; AD-61 "refuses a change once the month has started". Unclear whether an Owner may create a challenge for the current month on day 10 (PRD wording allows it; AD wording reads as forbidden). Decide, and say whether (gym_id, month) is unique and whether a cancelled month can be re-set.
- *Roles:* PRD says Owner or Supervisor sets it but "the Owner can cancel". AD-61 gives cancel "its own function" with no role. Supervisor cancel vs Owner-only cancel will differ between stories (and between FR-251's "exactly as a Supervisor" and the PRD text).
- *Read path:* members must see progress and reached state; no AD names the function that returns the aggregate to a member without exposing members. It is a leaderboard-class read path under NFR-027.

### A8. What the displayed weekly streak is during an open week (FR-220, FR-224; AD-53)

The streak is "computed on the server when a week closes" and the ledger holds closed weeks only. The Home screen, the calendar header, the badge for "4 weeks in a row" (earned in the week the Shield is earned, FR-230) and the share image all show a current-streak number. Does the open week count once its goal is met, or only after Sunday? The PRD gives only the closed rule. Two surfaces will disagree. One read function (see A1) must define it.

### A9. Week and month boundaries (FR-219, NFR-028; convention row)

The convention row names "the one existing gym-local helper". The existing helper (`gym_local_day_bounds`, AD-29) is a day helper. Monday week start (FR-219) and month bounds are not provided by it; `date_trunc('week')` is Monday in Postgres, but nothing says the ledger's `origin_key` (week start date) and the leaderboard's month filter use the same helper rather than two hand-written expressions. Add `private.gym_local_week_start` and `..._month_bounds` to the convention.

### A10. Shield and comeback rules that OQ-35 leaves to "the story"

- Reserve the last Shield for the weekly streak (FR-222, OQ-35): undecided in PRD and AD; the daily-streak story and the weekly-streak story are different people.
- Comeback (FR-223): 3 visits within 10 days, window lapses and restarts from the next visit. AD-53 has `comeback_started`/`comeback_completed` but no lapse event, and the `origin_key` is "week start or milestone number", which does not fit a time window. `rebuild_engagement` has to reproduce the window exactly (NFR-028).
- The constants (cap 2, every 4 weeks, 3 visits, 10 days, daily threshold 3, goal default 3 and range 1-7, milestones 7/30/100, reminder hour 18:00) are not in the spine, whereas the 3-hour visit limit is explicitly a platform config row. The PRD flags them as OQ-33 (revisit with pilot data), so a config row (like the AD-30 windows) is the natural home; otherwise each is a literal in whichever function a story writes first.

### A11. Correct plan: "original start date" and loyalty extension (FR-243; AD-59, AD-18, AD-30)

AD-59 uses the PRD's "original start date" without defining it for a renewed subscription (renewal "sets a new expiry", FR-032; the shape of start date after renewals is not in the spine). Recomputing expiry as start + new plan duration will also **discard** an AD-30 loyalty reward extension (R days added to `expires_at` in the renewal transaction) and any earlier manual override. The PRD says nothing; AD-59 should say whether the extension is preserved (re-added) or lost, and what the "original" date is.

### A12. Rejected staff attempts and the shared check-in path (FR-249, FR-250; AD-56, AD-31)

`record_check_in` "applies AD-22, the FR-031 status outcome and AD-29". In the shipped code those branches also create `front_desk_alerts` (0034/0090) and, for denied session checks, `session_attempts` rows (AD-31) that drive the Guest-sessions card's blocked counts. FR-249 says no separate alert for a staff member's own entry; FR-250 says every rejected staff attempt is audit-logged. AD-56 does not say whether a staff-rejected attempt writes an alert, a `session_attempts` row (a staff retry would inflate FR-163's blocked counts), or only the audit row. Needs a `source`-conditional rule stated once.

Related: AD-56 states `record_check_in` is "the only writer of `attendance_events`" and revokes direct writes from `authenticated`. Check-out (manual member, manual receptionist, FR-044 stale close, FR-045 auto-timeout job) and the void also write that table. Say which functions write `checked_out_at`, or the claim is false.

### A13. Support registry entries (FR-251; AD-35, AD-56, AD-61, AD-59)

FR-251 lists: session validity setter, challenge setting, Correct plan, staff check-in **and its void**. The ADs mention support for `staff_check_in` (AD-56), the two gym setters (AD-61) and Correct plan (AD-59), but: `void_staff_check_in` is not stated to be on the registry; the challenge *cancel* function (AD-61) is not; the coach-picker functions and the member-owned engagement functions are correctly excluded (AD-58 says so; engagement is member-only), but there is no single enumerated list of registry rows for V1.8 (the AD-33/35 convention warns stories to enumerate by grep rather than from a list). Add the six function names to AD-35's registry list or to AD-61, with the proxy-actor rule (AD-39) for each.

### A14. Gym-timezone data model (NFR-028; see also C2)

Setting up per-gym time helpers is not enough if FR-010 lets an Owner change the timezone later (the PRD default is Africa/Douala, editable). The spine does not say the timezone is immutable or historised.

---

## 3. (b) Quiet requirements the AD structure drops

### B1. FR-232: wording as editable text, EN and FR -- no AD

The only wording AD is the existing error-shape convention. The reminder body is composed on the server by `send_push_notification()` (AD-60), the screens are on the device, so the "editable text" has two natural homes and the PRD wants one (and a "character can speak it later"). Decide the store (message-key catalogue in `packages/types` plus a server-side copy for N-08, or a DB table of keys) and bind the reminder, celebration, comeback and goal wording to it, in both languages. Release gate 10.3 Step 3 item 9 tests this.

### B2. Tone and defaults

"Pride, never guilt" and "never shows a bare 0" (FR-223) are copy rules; with no wording AD (B1) they are unenforced. Defaults listed in A10 (goal 3, range 1-7, no goal set means 3) are not in the spine: `member_weekly_goals` has no stated behaviour for a member with no row. The release rule "a member who has not set a goal uses the default of 3" belongs next to the table.

### B3. FR-225 "no check-in rule changed by engagement features" and gate 10.3 Step 3 item 7

No AD makes that testable. The spine's moves that protect it are present but scattered: AD-60's "shares no lock or code path with `check_in()`" and the settle function being called by cron and on read only. Not stated: **who appends `week_corrected` when a late-synced offline visit lands (FR-061, NFR-028)**. If the sync/`check_in()` path appends it, check-in now depends on the ledger (violating FR-225, NFR-029's "a failure never blocks a check-in"); if it is left to the next settle, say so. Add: no engagement code runs inside `check_in()`/`staff_check_in()`/`void_*`, and a test that proves it (AD-56 mentions the void appending reversing rows "A void appends reversing rows", which is a coupling to check this against).

### B4. Release behaviour for existing members (FR-225, FR-229, FR-230) -- partly bound, inconsistent with AD-53's rebuild

AD-53 marks milestone rows `silent` for history settled at release (good, and the prevents-line says no retroactive celebration). Not bound: silent **badges** (First visit, 7, 30, 100) as opposed to milestones; the **streak start** (first full gym-local week after release); the default goal at release; existing history counted in total visits, calendar past days and the current month's leaderboard. See C1 for the conflict with `rebuild_engagement`.

### B5. Who may read the engagement tables (FR-225 "a member sees only their own", FR-228)

AD-53 gives no RLS/grants for `engagement_events`, `member_weekly_goals` and the settings row. AD-30 has an explicit "no role has any write path" clause that FR-170 mirrors; FR-228 ("no role can edit a member's count or rank directly") has no equivalent. Add: member reads own rows only, no staff dashboard read of streaks (the owner "streak just broke" list was rejected, addendum M), no write grant to any role other than the definer functions.

### B6. Smaller quiet items

- FR-240 (annual card text), FR-235 ("Your month"), FR-231 logo source: story-level, fine.
- FR-246: the AD gates create/edit on `classes.coach_id = caller`; it does not say a Coach cannot set `coach_id` to another coach on create or edit. State it in AD-57.
- FR-249/250: a staff check-in for a member whose state is awaiting-registration-fee or deactivated is not mentioned; AD-56 reuses "the FR-031 status outcome" which has no such state.
- The PRD "Section 13" and the 1.8.0 versioning are out of AD scope.

---

## 4. (c) Contradictions between an AD and the PRD (or between ADs)

No numeric or role contradiction. Specific checks:

| Item | PRD | Spine | Result |
| --- | --- | --- | --- |
| Visit limit | 3 hours after check-in or check-out, whichever first (FR-237) | AD-55: 3 hours, platform config row | Match. AD-55 applies it only in `single_use`, as PRD. |
| Goal | 1-7, default 3 (FR-219) | not stated | No contradiction; missing (A10, B2). |
| Shield cap | 2, one per 4 weeks (FR-222) | not stated | Missing (A10). |
| Reminder time | 18:00 gym-local (FR-233) | AD-60: 18:00 window, 15-min cron | Match. |
| Slots | up to 14, same weekday twice at different times | AD-57: 14 (trigger), unique `(class_id, weekday, start_time)` | Match. |
| Leaderboard shape | top 10, own row, one neighbour above and below, "behind" | AD-54 same | Match. |
| Ties order | tie shares rank, ordered by who reached count first | AD-54 silent | Missing (A4). |
| Void | Manager, Supervisor, Owner; same gym-local day; reason | AD-56 "Manager and above, same gym-local day, source='staff'" | Match; reason not stated in AD (the function signature has `reason`). |
| Correct plan roles | Owner, Supervisor, Manager | AD-59 same | Match. |
| Coach picker roles | Owner, Supervisor, Manager | AD-58 same | Match. |
| Challenge roles | Owner or Supervisor sets; Owner cancels | AD-61 silent on roles and cancel | Gap (A7). |
| Challenge creation | one per month, fixed once month starts | AD-61 "refuses a change once the month has started" | Ambiguous (A7). |

Genuine tensions (spine versus PRD, or spine versus itself):

- **C1. Release epoch versus `rebuild_engagement` (AD-53 versus FR-225, NFR-028).** FR-225: the weekly streak starts from the first full gym-local week after release; existing members get silent badges and no retroactive celebration. AD-53: `rebuild_engagement(member_id)` "replays attendance and goal history into a fresh ledger", and the NFR-028 test is that it matches the live ledger. A replay over full history would either produce streaks, Shields and badges from before release (not what the PRD says) or fail the match. The spine needs an explicit `engagement_start` (platform config row or per-gym stamp) that both the settle function and the rebuild honour, with history before it feeding only totals, calendar, silent badges and milestones.
- **C2. NFR-028 timezone clause versus the helper.** NFR-028: "a later timezone change does not move past days". The convention row computes boundaries through the gym's timezone helper, i.e. the *current* timezone applied to old timestamps, which does move past days when `gyms.timezone` changes (calendar, leaderboard and the open-week read are all computed live from `attendance_counted`; only closed weeks are protected, by the ledger). Needs a stored `visit_day` at write time (A2) or a tz history.
- **C3. Daily-streak Shield versus the ledger shape (AD-53).** FR-221/222: a Shield can save a missed *day*. AD-53 reads the daily streak from `attendance_counted` live ("the ledger holds only closed weeks, Shields, ...") so a Shield-saved day has no persisted home, and `shield_used` is unique on `(member_id, event_type, origin_key)` with `origin_key` "the week start date or the milestone number". A daily use on a Monday and a weekly use for that same Monday-started week collide on the key and a daily-saved day is not reproducible from attendance (NFR-028). Either drop day Shields from the first cut (it is Could/Should), or add a period-kind to the key.
- **C4. 3-hour limit versus FR-044 stale close (AD-55, FR-237, FR-044).** FR-237 says a scan after the limit "closes the stale open visit under FR-044's existing handling". FR-044 sets `checked_out_at = original_check_in_time + timeout_duration` where the timeout is the gym's auto-timeout (default 8 h). For a visit 4 h old that would stamp a close in the future, after the new check-in. For Single use the close time should be `min(now, check_in + visit limit)` (or just the limit). Same for occupancy (FR-046) and the "visit has ended" test in `consume_guest_session`. AD-55 does not say which; neither does the PRD.
- **C5. AD-56 "only writer" claim** versus check-out writers (A12 second paragraph).
- **C6. FR-239 versus AD-55 reading the setting inside the consume function.** Fine in the normal case ("a change applies to check-ins made after it", "a visit already open finishes under the rule it began with"), but AD-55 only guarantees that `consume_guest_session` reads the setting at call time. A visit opened under Single use, then the gym switches to Whole day: the session row has `covered_attendance_id` and a null `covered_day`; a same-day re-entry after the visit ends then consumes a *second* session (PRD FR-239: "a session already consumed keeps the coverage it had", so this is right). The reverse (Whole day -> Single use mid-day) leaves a `covered_day` session that still covers the rest of the day (right). Add one test sentence to AD-55 so the story does not "fix" this.

---

## 5. (d) PRD sentences that reference an architecture decision that does not exist

None found.

- PRD sections 6.33-6.40, 7.9 and 10.3 contain no "AD-" citations.
- Addendum M "Technical inputs" cites AD-28 for `guest_sessions` `covered_day` / `consumed_at`: present and accurate (AD-28 also states `covered_day` is "never recomputed", the precedent to reuse for `visit_day`).
- Addendum M also says "keep the calculation idempotent" and "compute at week and month close rather than on every read where possible": AD-53 settles week close; the leaderboard is computed live per read (AD-54), which is within "where possible" and its cache clause. Not a break.
- Addendum M: "cache per gym per month acceptable if it respects [NFR-027]": matches AD-54's cache clause.
- Release gate 10.3 Step 3 item 7 ("a test shows they change no check-in rule") and the NFR-029 baseline have no AD that creates the test or the baseline; they are story obligations, not missing ADs.

---

## 6. Suggested spine edits (smallest set that closes the above)

1. AD-53: add `engagement_start` epoch; define `visit_day` (stored at write) and use it for both ledger and live reads; one read function returning ring, open-week streak display, `at_risk`, `hours_left`; a period kind in the event key (or drop day Shields); state who appends `week_corrected`; add milestone/badge behaviour on void.
2. AD-54: tie order and zero-visit rule; eligible-member predicate; tri-state visibility column and its single write function; challenge progress read path.
3. AD-55: class branch (open visit versus none), stale-close timestamp under the visit limit, FR-239 test sentence.
4. AD-56: which functions write `checked_out_at`; side effects of rejected staff attempts; void effect on session, stamp, milestone.
5. AD-59: define "original start date" and the loyalty extension.
6. AD-61: challenge roles (set and cancel), creation timing, uniqueness, support rows.
7. Convention row: add week and month helpers; list the V1.8 platform config constants (cap 2, 4 weeks, 3 visits, 10 days, daily 3, milestones, default goal, 18:00, visit limit).
8. New short AD or convention row for FR-232: where wording lives, EN/FR, server-side N-08 copy.
