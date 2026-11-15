# Intent: GymOS V1.8 Member Engagement (Streaks, Calendar, Community)

**Intent.** V1.8 adds a simple habit layer to the member mobile app so members open it because they want to: a weekly goal ring with a weekly streak, a visual attendance calendar, a per-gym monthly leaderboard, and celebratory milestones. It is for every gym member (any plan, including pay-per-session and rare visitors) and exists to improve retention and training consistency. The guiding constraint is simplicity: everything is derived from existing attendance records, with no change to check-in and no new hardware. Input to the V1.8 layer of the GymOS PRD (currently v1.7).

## Context to respect

- The V1.6 loyalty program (FR-164..170: stamps per paid session or on-time renewal, "3/5" progress, free sessions) exists and stays fully separate. Streaks and milestones do not grant, link to, or alter stamps or free sessions.
- Check-in is a static entrance QR scanned from the member's own app (FR-042/043) and stays exactly as is. Offline check-in queueing (FR-061) already exists. Geofence, BLE and WiFi presence stay deferred to V3.0.
- Day boundaries use the gym-local calendar day, as in FR-159.
- Today the app has no streaks, calendar, celebrations, or reward-related push notifications.

## Scope (MoSCoW)

### Must
- **Weekly goal ring + weekly streak.** Member picks their own weekly goal, 1-7 visits per week, default 3. A goal change applies from the next week. The weekly streak counts consecutive weeks in which the goal was hit. A missed week is forgiven, not a hard reset (see Shield and Comeback).
- **Attendance calendar.** Month view of the member's gym days, designed to make the member proud and want to protect the streak. Today's cell is "at risk" when the streak would break without a visit today: it pulses and shows the hours left. Milestone markers (7, 30, 100) appear on calendar days.
- **Monthly gym leaderboard.** Everyone in the gym, ranked by visits this month, one visit per day counts, monthly reset. Shows the top 10 plus the member's own row and neighbours (not the full list). Members may hide and appear as "Anonymous" and are still counted in rank.
- **Milestone celebration.** A celebration screen when the member reaches a milestone, with thresholds at 7, 30 and 100 **total visits** at the gym (decided; matching the calendar markers, which sit on the day the 7th, 30th and 100th visit happened). Counted from the member's attendance records, one visit per gym-local day.

### Should
- **Streak Shield + Comeback.** A Shield is earned at 1 per 4 weeks hit, with a maximum of 2 held. A Shield automatically saves a missed week (or, for regulars, a missed day). After a break, a "comeback" state keeps the old best streak visible plus a 3-visit comeback goal to restore status. The display never falls to a blank 0.
- **Streak reminder push.** On by default, with one off-toggle in Settings. At most 1 per day, fixed at 18:00 gym-local time. Sent only if (a) a daily streak of 3+ would break today with no visit yet, or (b) the weekly goal is still reachable but today is the last day it can be met. Otherwise none. A member-chosen time is a later improvement.
- **Badge shelf.** Earned milestone badges are kept and viewable.
- **WhatsApp share image.** A Share button on the milestone celebration screen produces an image (member's calendar or milestone plus gym name).

### Could
- **Daily streak for regulars.** Shown automatically only once a member has a current run of 3+ consecutive visit days. No opt-in. The weekly ring stays the main streak.
- **Gym-wide monthly challenge.** Off by default. One per month per gym. The owner sets a numeric target and a free-text reward promise (e.g. a smoothie or a free session). The app never grants money, sessions or loyalty stamps automatically. No individual rank prizes.
- **"Your month" summary.** A recap of the member's month.

### Won't (this version)
- Mascot: deferred, owner already has one (see Parked).
- Leagues: extra complexity.
- "Champion of the month" badge: deferred with leagues.
- Anti-cheat (rotating QR, location, minimum stay, anomaly flags): owner chose to keep check-in untouched.
- Streak-to-loyalty link: loyalty stays separate.
- Owner "streak just broke" list: rejected.

## Cross-cutting decisions

- All members see the same ring, streaks, calendar and leaderboard regardless of plan. There is no plan gating and no plan-upsell mechanism in V1.8.
- No anti-cheat work. Streaks and leaderboard use existing attendance records as-is. This is acceptable only while stakes stay low: leaderboard rank carries no prize, and the challenge reward is a small owner-controlled promise.
- Loyalty program (FR-164..170) stays separate from all V1.8 mechanics.
- Reminder, celebration and comeback copy is written as editable text slots (not hard-coded), so the parked mascot can speak it later without redesign.
- Habit loop framing: calendar (past), ring (this week), at-risk cell and reminder (today), Shield (safety net) are one loop. Milestone celebration, badge shelf and share image are one "achievement moment" and should be built once.

## Notes for PRD and architecture

- "Anonymous" must be enforced server-side: other members' devices never receive the hidden member's name.
- The leaderboard is per gym, with tenant isolation.
- All week, day and month boundaries use the gym-local calendar day (FR-159).
- Builds only on existing attendance records. No change to check-in, QR, or hardware.

## Parked for later

- **Mascot:** the owner already has one. Name proposals: Rep (top pick), Flex, Pump, Streaky, Flamme, Zazou, Kiko, Gogo; avoid Momo and Tara. Assets: SVG per pose preferred, transparent PNG acceptable.
- **Leagues** so newcomers compete with newcomers, and a monthly "Champion" badge.
- Member-chosen reminder time.

## Open items

- None. No owner decision is outstanding (milestones count total visits, settled 2026-11-15).
- Post-release check: revisit the weekly goal default (3) and the reminder time (18:00) with SmartSana usage data.
