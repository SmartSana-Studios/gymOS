# V1.8 Member App additions — draft for splicing into EXPERIENCE.md and DESIGN.md

> Working file, not a spine. Source: PRD v1.8 FR-219–FR-235, NFR-027–NFR-029, UJ-15; brainstorm intent 2026-11-14; epics.md Epics 30 and 31; architecture AD-53, AD-54, AD-60, AD-61. Text only: no mock-up, wireframe or image is produced (owner rule). "Layout" below is therefore an ordered list top to bottom with sizes, not a drawing.
>
> Every block starts with an explicit splice line (`INSERT AFTER:` / `INSERT BEFORE:` / `APPEND TO SECTION:` / `AMEND ROW:`). Tags: `[ASSUMPTION]` = inferred, to confirm; `[NOTE FOR UX]` = open design question; `[CONFLICT]` = clashes with existing spine text.
>
> **Feature priority carried through (PRD 6.33–6.36).** Must: ring, weekly streak, calendar and at-risk cell, leaderboard, Anonymous, notice, celebration, text slots. Should: Shields, comeback, badge shelf, share, reminder N-08. Could: daily streak, gym challenge, "Your month". A Could or Should element is simply absent from its screen (not an empty state, not a disabled control) when its feature is not shipped, so the screens below degrade cleanly if Epic 31 is cut.

---

## 0. Decisions at a glance

| # | Decision | Status |
|---|---|---|
| 1 | **No new tab.** The tab bar stays at 5 tabs. The ring, streak, Shields, at-risk hint, leaderboard summary and challenge live on Home (MA-09); the calendar (MA-18) and leaderboard (MA-19) are pushed full-screen routes opened from Home; badges (MA-21) and the goal picker (MA-23) are also reachable from Profile (MA-12). | `[ASSUMPTION]` |
| 2 | The weekly ring is the one engagement element at the top of Home's engagement area; everything else is smaller and secondary. The daily streak chip exists only while a run of 3+ days is live. | Owner decision (brainstorm) |
| 3 | The ring card is a `flat` Card, so the status card stays the one `raised` card on Home (existing rule, MA-09). | Follows existing rule |
| 4 | At-risk uses `{colors.warning}` plus a glyph and words, never `{colors.danger}`. A broken streak never uses red. | `[ASSUMPTION]` (see 6.3) |
| 5 | Wording lives in the i18n catalog as editable text slots under `engage.*` and `n08.*` (FR-232, AD-60). No mascot in V1.8; a reserved, empty slot is defined (celebration and comeback), see section 4.4. | Owner decision + `[ASSUMPTION]` for key shape |
| 6 | Streaks never display a bare 0. The ring's own "0 / 3" is progress toward a goal, not a streak, and is allowed. | `[ASSUMPTION]` reading of the owner rule |

---

## 1. Surface Index and Information Architecture

### 1.1 Surface Index rows

INSERT AFTER: the table row beginning `| MA-17 | Pay for Session | /pay-session |` (Member App table, "### Member App" under "## Surface Index — All Screens")

| ID | Screen | Route | Entry Points |
|---|---|---|---|
| MA-18 | Attendance Calendar | `/calendar` | Home "This week" card tap; Home streak and at-risk hint tap; MA-22 [See my calendar]; N-08 push opens Home, not this screen *(V1.8, FR-224, Epic 30)* |
| MA-19 | Gym Leaderboard (+ first-open notice) | `/leaderboard` | Home Leaderboard card tap; MA-12 Anonymous toggle helper link "See the leaderboard" *(V1.8, FR-226–FR-228, Epic 30)* |
| MA-20 | Milestone Celebration | `/celebration/:milestoneId` | Pushed automatically over Home when an unacknowledged non-silent milestone exists after Home loads (7th, 30th, 100th visit day); never from a tab, never from a push *(V1.8, FR-229, FR-231, Epic 30; Share is Should, Epic 31)* |
| MA-21 | Badge Shelf | `/badges` | MA-12 Profile "Badges" row; MA-20 [See your badges]; badge detail sheet opens on top of it *(V1.8, FR-230, FR-231, Epic 31, Should)* |
| MA-22 | Your Month | `/month/:yyyy-mm` | Home "Your [month] is ready" card; MA-18 when the previous month is shown, link "Your [month]" *(V1.8, FR-235, Epic 31, Could)* |
| MA-23 | Weekly Goal (sheet) | `/goal` (modal sheet) | Home "This week" card [Goal: 3 days]; MA-12 Profile "Weekly goal" row *(V1.8, FR-219, Epic 30)* |

AMEND ROW: the `MA-09 | Home |` row, last column. Append: `*(V1.8: "This week" ring card, Shield and comeback states, at-risk hint, Leaderboard card, gym-challenge card, "Your month" card; see MA-09 V1.8)*`

AMEND ROW: the `MA-12 | Profile |` row, last column. Append: `*(V1.8: Training section with Weekly goal, Badges and the Anonymous toggle; Streak reminder toggle in Notifications)*`

### 1.2 Member App IA tree

INSERT AFTER: the line `    │    └── → upcoming booked classes summary [V1.5, links into Classes tab]` (inside the "### Member App IA" code block)

```
    │    ├── "This week" card (in-page)       [V1.8, FR-219/FR-220: ring, weekly streak, Shield chips, daily chip, at-risk hint]
    │    │    ├── → Attendance Calendar (MA-18)   [card tap]
    │    │    │    └── → Your Month (MA-22)       [Could; previous month only]
    │    │    └── → Weekly Goal sheet (MA-23)     [goal button]
    │    ├── Comeback card (in-page)          [V1.8, Should, FR-223]
    │    ├── Leaderboard card (in-page)       [V1.8, FR-226]
    │    │    └── → Gym Leaderboard (MA-19)       [card tap; first open shows the notice]
    │    ├── Gym challenge card (in-page)     [V1.8, Could, FR-234; read-only]
    │    ├── "Your month" card (in-page)      [V1.8, Could, FR-235] → Your Month (MA-22)
    │    └── → Milestone Celebration (MA-20)  [auto-pushed once per milestone; V1.8, FR-229]
```

INSERT AFTER: the line `         └── → Notification Preferences section [in-page, unchanged from V1.0 shipped behavior]` (the last line of the Tab 5 sub-tree; it is the last child today, so re-draw its `└──` as `├──` and add the lines below)

```
         ├── → Weekly Goal sheet (MA-23)      [V1.8, FR-219]
         ├── → Badge Shelf (MA-21)            [V1.8, Should, FR-230]
         │    └── → badge detail sheet → Share [Should, FR-231]
         └── Anonymous toggle, Streak reminder toggle [in-page, V1.8, FR-227, FR-233]
```

### 1.3 Navigation Structure (tab bar decision)

APPEND TO SECTION: "### Member App — Bottom Tab Bar" (after the existing `*(V1.6)* No tab changes.` bullet)

- *(V1.8)* **No tab changes `[ASSUMPTION — proposed by UX, to confirm]`.** MA-18 Attendance Calendar, MA-19 Gym Leaderboard, MA-21 Badge Shelf and MA-22 Your Month are pushed full-screen routes (back arrow, no tab bar), the same pattern as MA-17, `/renew` and MA-13. MA-20 Milestone Celebration is a full-screen overlay route (fade in, no tab bar). MA-23 Weekly Goal is a bottom sheet over Home or Profile (slide up, swipe down to dismiss). The tab bar badge column is unchanged: no badge or dot is added for engagement, because a dot would turn a streak into an obligation.
- **Why no tab.** The habit loop (calendar = the past, ring = this week, at-risk cell = today, Shield = the safety net) is read on the screen members already open, Home, at the moment they decide whether to go to the gym. A sixth tab breaches the 5-tab ceiling set in V1.5. Replacing Progress or Classes would remove the two features V1.5 bet on. Folding the habit loop into Profile would hide it from the screen where it works. Putting a "Body | Habit" switch inside Progress (MA-15) was rejected because MA-15 is private body data (photos, weight) and the habit data is social (leaderboard).
- **Back behaviour (all V1.8 routes).** Back arrow or Android back returns to the route that opened it: Home for MA-18, MA-19, MA-22 opened from Home; MA-18 for MA-22 opened from it; Profile for MA-21 and MA-23 opened from Profile. MA-20 closes to Home (never back into the check-in result overlay). Tapping the Home tab while on a pushed route pops to Home and scrolls to top. Deep link from the N-08 push opens Home (MA-09) with the "This week" card in view, the same rule as every other push ("Deep link for returning authenticated user: open to MA-09").
- **Gym switch.** Everything in V1.8 is for the active gym only (Architecture Decision AD-4): switching gyms swaps the ring, streak, calendar, leaderboard and badges for that gym's own.

---

## 2. Member App screens

### 2.1 MA-09 · Home — V1.8 amendment

INSERT AFTER: the last bullet of MA-09, the line beginning `- **Gym switch:** Home, the status card, and the Rewards card show the active gym only (Architecture Decision AD-4).` (immediately before the `---` that precedes `### MA-10 · Check-In`)

**V1.8 — Weekly ring, streaks, calendar entry, leaderboard and challenge *(FR-219–FR-224, FR-226, FR-233–FR-235; Epics 30 and 31)*.** Everything below sits on Home, and every member at every gym sees it whatever their plan, Pay-per-session guests included (FR-225). Nothing here changes check-in, and nothing changes the status card, the quick actions, the Rewards card or the V1.6 states above. The engagement features are separate from loyalty: no stamp, free session or free day is ever linked to a streak, Shield, badge or rank (FR-170, FR-228).

**Mock:** none. The design is this text (owner rule: no mock designs).

**Layout, top to bottom.** Existing items are marked (existing); new items are numbered N1 to N6.

1. Branded header (existing). Offline sync banner and post-sync denial notice (existing, V1.6).
2. Welcome text (existing). Status card, `raised` (existing, still this screen's one).
3. Quick actions (existing).
4. **N1. "This week" section** *(Must)*. Section heading row: "This week" (left) and a text button "Goal: 3 days" with a pencil glyph (right, 44pt target, opens MA-23). Under it one `flat` Card, tappable as a whole (opens MA-18), containing, left to right: the **Goal Ring** (`{components.goalRing}`, 120pt) and a right column with, top to bottom, the **weekly streak chip** (or its first-week or comeback substitute), the **Shield chips** (Should), the **daily streak chip** (Could, only on a 3+ day run), and the ring **caption**. Below those, inside the same card, a **footer row** that holds, at most one at a time: the Shield or comeback notice, or the **at-risk hint** (glyph `schedule`, text, hours left).
5. **N2. Comeback card** *(Should)*. A second `flat` Card directly under the "This week" card, present only while the comeback state is live (see states). Absent otherwise.
6. **N3. Leaderboard card** *(Must)*. Heading "Leaderboard" with a chevron; one `flat` Card; tap opens MA-19.
7. **N4. Gym challenge card** *(Could)*. Heading "Gym challenge"; one `flat` Card; read-only; absent when the gym has no challenge this month.
8. **N5. "Your month" card** *(Could)*. One dismissible `flat` Card, shown only from the 1st of a month for the month just ended (see MA-22).
9. Rewards card (existing, V1.6). Upcoming Classes (existing). Recent Activity (existing).

`[ASSUMPTION]` Placement rationale: the ring comes straight after the quick actions, so the first screenful (status, actions, ring) answers "where do I stand and what do I do now"; the leaderboard and challenge are secondary and sit below the ring; Rewards (V1.6) keeps its position relative to Upcoming Classes, one block lower than before. `[NOTE FOR UX]` Home is now long. If Rewards or Upcoming Classes are pushed out of sight on a 640 pt screen, consider collapsing N3 and N4 into one two-row card; not done in V1.8 to keep each card's tap target obvious.

`[ASSUMPTION]` **Expired members** see the same engagement area, but the **at-risk hint is hidden** while the member's status is `expired` (check-in would be denied, so "visit today" would point to a refusal). The ring and streak chip stay visible. `[NOTE FOR UX]` FR-233 does not exclude expired members from N-08; the server could still send "visit today" to someone the gate will refuse. Needs a PRD decision (see section 9, Q7).

#### N1 · "This week" card

**Components**

- **Goal Ring** (`{components.goalRing}`). The ring is split into as many equal arc segments as the member's goal for the week (1 to 7), with a small gap between them. Each visit day fills one segment in order, in `{colors.accent}` (gym colour). When the goal is met every segment shows `{colors.success}` and a check glyph replaces the numeral's right half (see below). Unfilled segments use the `border` colour. The centre shows `statNumeral` "[visits] / [goal]" (for example "2 / 3") with the caption word "days" in `small` beneath.
  - Visits beyond the goal do not add segments. The centre stays "3 / 3" and the caption reads the extra-visit line (`engage.ring.caption.extra`). `[ASSUMPTION]`
  - A new week with no visits yet shows "0 / 3". This is a goal progress figure, not a streak, so it is allowed.
- **Weekly streak chip** (`{components.streakChip}`), the main streak: flame glyph `local_fire_department` in `{colors.accent}` inside an Icon Chip, then "5 weeks in a row" (`smallBold`). Shown only once at least one week has been settled as met. Never shown as "0 weeks".
  - With exactly 1 settled week it reads "First week done" instead of "1 week in a row".
  - Under the chip, when the member holds fewer than the Shield cap, a `small` muted line shows weeks to the next Shield (`engage.streak.nextShield`), and at the cap the cap line. `[ASSUMPTION]` (shown to make the Shield visible as something being built).
- **Shield chips** *(Should, `{components.shieldChip}`)*. One Icon Chip with glyph `shield` in `{colors.accent}` and the count "1 Shield" or "2 Shields" (`smallBold`). Not shown at 0 held: no "0 Shields". Tapping a Shield chip opens a small explainer bottom sheet (`engage.shield.explainer.*`, [Got it]). The chip tap target is 44pt even though the chip looks smaller; the Shield chip is the only tappable element inside the card besides the goal button and the card itself.
- **Daily streak chip** *(Could, `{components.streakChip}` compact variant)*. "4 days in a row", glyph `bolt`, smaller than the weekly chip, shown only while a current run is 3 or more consecutive visit days. It disappears silently when the run ends; there is no "streak lost" message (FR-221).
- **Ring caption** (`small`). Content depends on state (table below).
- **At-risk hint** (footer row, `{components.atRiskPulse}`). Glyph `schedule` in `{colors.warning}`, then one line (`engage.atRisk.weekly` or `engage.atRisk.daily`), then the hours left (`engage.atRisk.hoursLeft`, switching to minutes under one hour). When the member holds a Shield an optional second `small` line says a Shield is ready (`engage.atRisk.shieldReady`) `[ASSUMPTION]`. `[NOTE FOR UX]` That reassurance may soften the push to come in; kept because the owner wants protection, not pressure. Remove it if pilot data shows it hurts visits.
- The whole card is one tap target for MA-18; its accessible label is built in the Accessibility Floor rows below.

**States of the "This week" card**

| State | Ring | Streak area | Caption (key) | Footer |
|---|---|---|---|---|
| Loading | Circle skeleton 120pt + 2 text-line skeletons, ~168pt tall card, loads independently of the status card | skeleton | skeleton | none |
| Release week `[ASSUMPTION]` (the engagement epoch: weeks before it are never settled, FR-225) | Fills normally | Hidden | `engage.streak.startsMonday` | none |
| First week (member has no settled week yet) | Fills normally | Hidden (no chip). One `small` line: `engage.streak.firstWeek` | `engage.ring.caption.progress` or `.fresh` | at-risk hint if it applies |
| No goal chosen yet (default 3) | 3 segments | as the other states | as the other states, plus a one-time `small` hint under the goal button on first view: `engage.ring.goalHint.default`, dismissed by tapping anywhere on it or by opening MA-23; dismissal stored on the device `[ASSUMPTION]` | none |
| Goal change pending | Current week's goal | as the other states | the goal button reads `engage.ring.goalPending` ("Changes to 4 days on Mon 24 Nov") | none |
| In progress | n of goal filled | Weekly streak chip (+ Shield chips, + daily chip if live) | `engage.ring.caption.progress` ("2 more visits close your ring") | at-risk hint only if FR-233 (a) or (b) holds and the member has not visited today |
| Fresh week, 0 visits | all empty, "0 / 3" | Weekly streak chip kept | `engage.ring.caption.fresh` | none |
| Goal met | All segments `{colors.success}`, check glyph, "3 / 3" | Weekly streak chip shows the **settled** count; caption says what it becomes | `engage.ring.caption.metStreak` ("Your streak becomes 6 weeks when the week ends"); with no streak yet `engage.ring.caption.met` | none; the at-risk hint is never shown once the goal is met |
| At risk | Unchanged | Unchanged | Unchanged | At-risk hint, pulsing glyph (see `atRiskPulse`); hours left updates every minute while Home is visible |
| Shield saved a week (Should) | Current week, normal | Chip shows the preserved length | Normal | One-time notice row `engage.shield.saved.week`, dismiss [Got it], persisted on the device until dismissed |
| Shield earned (Should) | Normal | Shield chip count +1 | Normal | One-time notice row `engage.shield.earned`, dismissible |
| Shield saved a day (Could) | Normal | Daily chip continues | Normal | One-time notice row `engage.shield.saved.day`, dismissible |
| Offline | Last settled state plus any visits queued on this device: the queued visit fills its segment with a dashed outline until synced | Last known | Normal, plus `engage.ring.pendingSync` | Shows the at-risk hint from cached flags only if the cache is from today; otherwise hides it. Banner shown by the existing offline banner |
| Error (load failed, no cache) | Replaced by the error card `engage.home.error` in the card slot, same pattern as MA-09's status-area error | none | pull to refresh | none |
| Settle failed (`open_engagement()` call failed after a week closed) | Last known state | Last known | Last known | A `small` line `engage.home.settleError`; retried on next focus; never blocks the card |
| Expired status | Normal | Normal | Normal | At-risk hint hidden `[ASSUMPTION]` |

At most one notice row (Shield saved, Shield earned, comeback restored) shows at a time, newest first, and each is dismissed on its own. The at-risk hint is a different row and takes the slot only when no notice is pending. `[ASSUMPTION]`

**Interactions**

- Tap card: push MA-18. Tap goal button: MA-23 sheet. Tap Shield chip: explainer sheet.
- Pull to refresh (Home's existing gesture): reloads the card with the rest of Home.
- Home focus after a week has closed: the app calls the settling function once (first open after a week closes, AD-53); the card shows its loading skeleton for that moment, at most 2 seconds, then the settled state.
- On Home mount, if an unacknowledged non-silent milestone exists, MA-20 is pushed over Home after about 600 ms, so the green check-in result overlay (unchanged) has already gone and Home has painted. See MA-20.

#### N2 · Comeback card *(Should, FR-223)*

Shown when a streak has ended and no Shield saved it. It never shows a bare 0 and never uses a warning or red tint; it is a `flat` Card with an Icon Chip glyph `flag` in `{colors.accent}`.

| Phase | Content |
|---|---|
| Active, no comeback visit yet | Title `engage.comeback.title`; line `engage.comeback.best` (best streak stays visible, statNumeral on the number); line `engage.comeback.goal` ("Visit 3 times in 10 days to get back on track"); a Loyalty-Progress-style stamp row of 3 empty segments (`{components.loyaltyProgress}` with 3 segments; the "n / N" numeral is **not** shown while n is 0) |
| Visits 1 or 2 | Same, with the numeral "1 / 3" or "2 / 3" and `engage.comeback.progress` as the accessible label |
| Window lapsed `[ASSUMPTION]` (10 days passed) | Same as Active, plus `engage.comeback.windowRestart`; no failure wording; the count restarts from the member's next visit |
| Restored (3rd visit reached) | One-time `engage.comeback.restored.title` and `.body` replacing the progress block for the rest of that session, dismissible; the card then disappears on next load. The "This week" streak chip shows the best streak in the form "Best: 8 weeks" until the first new week is met, then the new streak count `[ASSUMPTION]` |

`[ASSUMPTION]` What "restored status" looks like (FR-223 leaves it to UX): a warm one-time confirmation and the best streak staying visible on the chip, with no new number invented. `[NOTE FOR UX]` Should the best streak be visible on the chip permanently (not only in comeback), e.g. "5 weeks · best 8"? Not done in V1.8 for simplicity.

#### N3 · Leaderboard card *(FR-226)*

- Section heading "Leaderboard" / chevron (existing List Item pattern). `flat` Card with Icon Chip glyph `leaderboard` in `{colors.accent}`.
- Content, member has at least one visit this month: `statNumeral` rank line "Rank 9 this month" (`engage.home.rank`), and a `small` line "2 visits behind the member above" (`engage.leaderboard.behind`), or `engage.leaderboard.level` when level, or `engage.leaderboard.leading` when first. No names on Home: the card shows the member's own standing only.
- Content, no visit yet this month: `engage.leaderboard.unranked` (zero-visit members are not ranked, FR-226).
- Rank numbers are the server's: the card shows no total ("of 43") because the board function returns no member count `[NOTE FOR UX]` (AD-54 returns rank, label, visits, is_self only; adding a total would be an architecture change; if wanted, raise it).
- Loading: one rounded rectangle ~72pt. Offline: last cached rank with `engage.updatedAt`. Error: hides the numbers and shows `engage.leaderboard.error.short`, tap retries.
- Privacy: this card is shown to every member, and a member who has not yet seen the first-open notice still sees their own rank here. It reveals nothing to others. The notice appears only when MA-19 is opened.

#### N4 · Gym challenge card *(Could, FR-234)*

- Shown only when the gym has a live (not cancelled) challenge for the current month; absent otherwise. A challenge for a future month is not shown. `[ASSUMPTION]`
- Content: heading "Gym challenge"; Icon Chip glyph `groups` in `{colors.accent}`; the progress line "412 / 1,000 visit days this month" (`engage.challenge.progress`, numerals as `statNumeral`); a continuous 8pt bar (the Loyalty Progress rule for more than 12 segments: one pill bar filled to n/N); the reward line "Reward from [Gym name]: a free smoothie" (`engage.challenge.reward`, the reward text exactly as the Owner typed it, **not translated**); `small` muted "A promise from your gym." (`engage.challenge.promise`); and "Ends [date]" (`engage.challenge.ends`).
- Reached state: the bar is full in `{colors.success}`, a check glyph, and `engage.challenge.reached`; the card stays until month end.
- It is for everyone together: `engage.challenge.collective` says nobody is ranked. No member names, no personal contribution figure, no tap action.
- Loading ~96pt rectangle. Error or offline: card hidden for offline with no cache; with cache shows the last figure and `engage.updatedAt`.
- Nothing in this card links to money: no payment, session, Shield or stamp (FR-234).

#### N5 · "Your month" card *(Could, FR-235)*

One dismissible `flat` Card from the 1st of a month, for the month just ended, only if that month had at least one visit `[ASSUMPTION]`. Text `engage.month.homeCard`, [See it] opens MA-22, an "x" dismisses it for good (stored on the device). It disappears by itself after the 7th of the month `[ASSUMPTION]`. No push, no tab badge, no dot (FR-235: can be ignored).

---

### 2.2 MA-12 · Profile — V1.8 amendment

INSERT AFTER: the line `**V1.6:** no change. The Rewards card lives on Home (see MA-09), and there is no reward notification toggle, because no reward push ships in V1.6 (FR-169).` (end of MA-12, before the `---` that precedes `### MA-13 · Plan Details`)

**V1.8 — Training, Anonymous and Streak reminder *(FR-219, FR-227, FR-230, FR-233; Epics 30 and 31)*.**

**Layout changes, top to bottom.** The avatar block, the account `flat` Card (Edit profile, History, Language) and Log out are unchanged.

1. **New `flat` Card, "Training", between the account Card and the Notifications Card.** Rows, each with a leading Icon Chip:
   - **Weekly goal** (glyph `flag`, `primary` tint like the account rows): value "3 days" in `small`, chevron; tap opens MA-23. If a change is pending, the value reads "3 days, then 4 from Mon 24 Nov" (`engage.profile.goal.pending`).
   - **Badges** *(Should)* (glyph `military_tech`, `primary` tint): value "2 of 5" (`engage.profile.badges.value`), chevron; tap pushes MA-21. Absent when badges are not shipped.
   - **Appear as Anonymous on the gym leaderboard** (glyph `visibility_off`, `primary` tint): a toggle, saved immediately on change like every notification toggle (optimistic flip, revert with the existing inline error toast on failure). A `small` helper line under the label states the **current effect** (`engage.profile.anonymous.helperOn` / `.helperOff`), and a text link "See the leaderboard" (`engage.profile.anonymous.link`) opens MA-19.
2. **Notifications Card, new row at the bottom:** **Streak reminder** *(Should)* (bell glyph Icon Chip like the others): toggle, default **on** (opt-out, FR-233; `member_preferences.streak_reminder_opted_out`), independent, saved immediately. Helper line `engage.profile.reminder.helper`. Absent when N-08 is not shipped.

**Behaviour**

- The Anonymous toggle shows the **stored choice** (hidden = on). It is a separate matter from the first-open notice (FR-227): until the member has opened the leaderboard and chosen on the notice, every other member sees "Anonymous" whatever the toggle says. While the notice is unseen, the helper line reads `engage.profile.anonymous.helperUnseen` ("You appear as Anonymous until you open the leaderboard and choose.").
- Turning the toggle **on** (hide) always saves at once. Turning it **off** (show my name) while the notice has not been seen does **not** save at once: it opens the notice (MA-19 notice state) so the member sees how they will appear before they are named `[ASSUMPTION]`. Choosing there saves.
- The change "applies from the next load" (FR-227): the helper line says other members see it from their next refresh, never that it is instant for everyone.
- The Anonymous toggle never affects the member's own count, rank, ring, streak, badges or the challenge total (FR-227: still counted and ranked).
- The Streak reminder toggle's accessibility label states its state, like the other notification toggles.
- Offline: the toggles flip optimistically and then revert with the inline error if the save fails, exactly as the existing notification toggles do. `[ASSUMPTION]` The weekly goal row opens MA-23, which needs a connection to save (see MA-23).
- Language switch: re-renders all new rows; the helper lines and values are catalog strings.

`[NOTE FOR UX]` The privacy toggle sits in "Training" rather than in a separate "Privacy" card. With only one privacy setting in V1.8, a card of its own would look heavier than the choice; if more privacy choices arrive, move it.

---

### 2.3 MA-18 · Attendance Calendar *(V1.8, FR-224, FR-229, FR-222; Story in Epic 30)*

**Purpose:** Let the member see every day they came and be proud of it, move through earlier months, and see today's cell tell them, calmly, when a visit today keeps a week or a run going.

**Entry:** Home "This week" card tap; MA-22 [See my calendar]. **Route:** `/calendar`. **Exit:** back arrow to Home (or MA-22).

**Mock:** none (text design).

**Layout, top to bottom**

1. Header bar: back arrow, title "My visits" (`engage.calendar.title`). No tab bar.
2. Month bar: previous-month chevron (44pt), month and year ("November 2026") in `smallBold` `[ASSUMPTION]` (the `subtitle` style is too large for a control bar), next-month chevron (44pt, disabled and 40% opacity on the current month: no future months).
3. One summary line under the month bar: "9 visit days in November" (`engage.calendar.monthSummary`), the numeral as `statNumeral`.
4. The month grid inside a `flat` Card: weekday header row (Mon to Sun, first letter, `small`; the week starts Monday to match the goal week, FR-219 `[ASSUMPTION]`), then 4 to 6 rows of `{components.calendarDayCell}` cells (44pt, see states).
5. If today is at risk, an **at-risk line** under the grid (glyph, text, hours left; same strings as Home's hint) so the information is also in readable text, not only in the cell.
6. **Legend row** (`small`, wraps): lit cell "Visited", ring outline "Today", marker "Milestone", shield marker "Saved by a Shield" (the last only when Shields are shipped).
7. **Day detail line** (under the legend, `small`): updates when a cell is tapped; initially shows today's line. `[ASSUMPTION]` It names the date and, for a lit day, "Visited"; for a milestone day, "Your 30th visit"; for a Shield-saved day or week, `engage.shield.saved.*` in short form. It never shows a check-in time, to keep the screen to what FR-224 asks for.
8. When viewing the previous month and the "Your month" feature is shipped and the summary exists: a text link "Your [month]" (`engage.month.link`) to MA-22.

**Cell states (`{components.calendarDayCell}`)**

| State | Visual | Not colour alone |
|---|---|---|
| Empty past day | `border` outline, no fill, day numeral in muted text | Numeral only, same as every day |
| Visit day (lit) | Fill `{colors.accent}`, check glyph, numeral in the primary Button's on-accent text colour | Filled shape plus a check glyph |
| Today, not yet visited, nothing at risk | 2pt `{colors.accent}` outline, numeral bold | Thicker outline and the legend entry "Today" |
| Today, visited | Lit (as above) plus the 2pt outline | Fill, check and outline |
| **Today, at risk** | 2pt `{colors.warning}` outline pulsing (see `atRiskPulse`), glyph `schedule` top-right, and the hours left in 10pt text inside the cell ("6 h"; under one hour "45 m") | Outline thickness, glyph, hours text, plus the at-risk line under the grid |
| Milestone visit day | Lit, plus a small star-badge corner (glyph `star`, 14pt) carrying nothing but the shape; the tap detail line says "Your 30th visit" | Star glyph and detail text |
| Day saved by a Shield (daily streak) | `{colors.neutral}` outline with glyph `shield` (not lit: the member did not visit) | Glyph and legend |
| Week saved by a Shield | A small `shield` glyph at the corner of that week's Sunday cell, plus a hairline under that week's row `[ASSUMPTION]` | Glyph and legend |
| Future day | 40% opacity numeral, no outline, not tappable | Opacity and the lack of an outline |
| Day outside the month | Blank, not focusable | n/a |
| Before the member's first visit or before the release `[ASSUMPTION]` | Same as an empty past day. History before release is shown as stored (FR-225) | n/a |
| Offline queued visit today | Lit with a dashed outline until synced | Dashed shape, plus the detail line "Waiting to sync" |

**Interactions**

- Tap a cell: moves a 2pt focus ring there and updates the detail line; no navigation. Haptic: none.
- Swipe left and right on the grid moves a month (a convenience; the chevrons are the primary control, so no gesture is required). `[ASSUMPTION]`
- Previous-month chevron is disabled at the member's earliest month with any visit (or the current month if none) so the member is never walked through empty history. `[ASSUMPTION]`
- Hours left recompute each minute while the screen is visible, computed from the server-supplied end-of-gym-local-day timestamp, not the phone clock, so a travelling member sees the gym's day `[ASSUMPTION]`. `[NOTE FOR UX]` AD-53's `engagement_state_view` returns the at-risk flags; it is not stated that it also returns the day-end instant. Ask architecture to include it, otherwise the device computes it from the gym timezone it already caches for FR-159.
- Pull to refresh reloads the month.

**States**

| State | Treatment |
|---|---|
| Loading | Month bar and legend render immediately; the grid shows 35 rounded-square skeletons, in a `flat` Card |
| Month with no visits (current) | Grid renders empty; summary line `engage.calendar.empty.current` ("No visits yet this month. Your first one lights today.") in a calm tone |
| Month with no visits (past) | `engage.calendar.empty.past` ("No visits in [month]."), grid renders |
| Offline | Cached months render with the banner `engage.calendar.offline`; a month never loaded shows `engage.calendar.offline.none` and a retry |
| Error | Error card in the grid slot `engage.calendar.error`, pull to refresh (same pattern as MA-09) |
| Late sync correction | A visit that arrives late through offline sync lights its own past day on the next load, and counts it; there is no message (NFR-028) |

**Back behaviour:** back returns to Home (or MA-22); the month the member was viewing is not remembered on re-entry; the screen always opens on the current month.

**Accessibility:** see the Accessibility Floor rows (calendar). **Offline:** see Responsive and offline notes.

---

### 2.4 MA-19 · Gym Leaderboard *(V1.8, FR-226–FR-228; Epic 30)*

**Purpose:** Show where the member stands among their own gym's members this month, with a little company, without ever naming anyone who has not agreed to be named.

**Entry:** Home Leaderboard card tap. **Route:** `/leaderboard`. **Exit:** back arrow to Home.

**Mock:** none (text design).

**Layout, top to bottom**

1. Header bar: back arrow, title "Leaderboard" (`engage.leaderboard.title`), subtitle the gym name in `small`.
2. Segmented control: "This month" | "Last month" (`engage.leaderboard.tab.*`). `[ASSUMPTION]` AD-54 accepts the current or previous gym-local month, so exactly these two tabs. Default This month.
3. **The list**, inside one `flat` Card of `{components.leaderboardRow}` rows (56pt minimum):
   - Rows 1 to 10 (the top 10).
   - If the member is **not** in the top 10: a thin separator row with three dots (not tappable, accessible label "Rows between are not shown"), then three rows: the neighbour above, the member's own row (highlighted), the neighbour below. If the member is in the top 10, no separator is drawn, and only the one neighbour **below** the member beyond rank 10 is appended when the member is at rank 10 (so "one neighbour each side" holds); at ranks 1 to 9 the neighbours are already in the list.
   - The member's own row is always shown as "You" (never as "Anonymous" to themselves), with a visible tag "You" and a 2pt `{colors.accent}` border (shape and word, not colour alone). If other members see them as Anonymous, a `small` line inside the row says `engage.leaderboard.hidden.self`.
4. **Under the member's own row**, one line: "2 visits behind the member above" (`engage.leaderboard.behind`), or `engage.leaderboard.level` when tied with the member above, or `engage.leaderboard.leading` when first.
5. **Footnote** (`small`, muted): `engage.leaderboard.footnote` ("Each day you visit counts once. The board resets on the 1st. Just for fun: rank earns no prizes.").
6. **Visibility row** (bottom, a `flat` Card): the **Anonymous toggle**, the same stored setting as MA-12 (`engage.leaderboard.toggle.label`), with the helper line stating how other members see the member now (`engage.leaderboard.visible.self` with the member's own label, or `engage.leaderboard.hidden.self`). Same optimistic save and the same rule as MA-12 for turning it off while the notice is unseen (opens the notice).

**Row anatomy (`{components.leaderboardRow}`):** rank numeral (`smallBold`, 32pt wide, tabular); Icon Chip 36pt with glyph `person` (neutral tint) for a named member or `visibility_off` for an Anonymous one, **never a photo**; label in `smallBold` ("Chantal N." or "Anonymous"); trailing visits "11 visits" in `small`. Ties show the same rank number and the `small` word "Tied" (`engage.leaderboard.row.tied`) and keep the server's order (earliest to the count first). There is no crown, medal, gold or any special treatment of rank 1 to 3 (FR-228: no champion).

**The first-open notice (state of this screen, a modal bottom sheet)**

Shown **before the list** the first time the member opens MA-19 (the server holds `leaderboard_notice_seen_at`; it is null until the member taps one of its two buttons). While it is open the list behind it is **not rendered** (a blurred or skeleton list would still be a view of other members before consent; the sheet is full-height and opaque `[ASSUMPTION]`).

Content, top to bottom: Icon Chip glyph `groups`; title `engage.leaderboard.notice.title`; body `engage.leaderboard.notice.body`, which contains **a preview of the member's own label**, the first name and the first letter of the last name as the server would show it, for example "Mireille K." (the member's own name shown on the member's own device); a line saying never the photo or phone number; the line `engage.leaderboard.notice.until` ("Until you choose, other members see you as Anonymous"); the line `engage.leaderboard.notice.change` ("You can change this any time in your Profile"); two buttons of equal weight stacked: **[Show my name]** (`...cta.show`, primary Button) and **[Appear as Anonymous]** (`...cta.hide`, secondary Button).

- Neither button is pre-selected; both are 52pt tall.
- Both buttons call the server (`mark_leaderboard_notice_seen`; the hide button also sets hidden). Until the call returns, both show a spinner and are disabled. On success the sheet closes and the list loads with the choice in force.
- **No swipe-down dismiss, no tap-outside dismiss.** The only way out without choosing is the back arrow or Android back, which leaves MA-19 for Home. The notice is then not marked seen and the member **still appears as Anonymous**, so leaving never names anyone (FR-227: no existing member is named to the gym before seeing it).
- Failure: inline above the buttons `engage.leaderboard.notice.error` ("Couldn't save your choice. You still appear as Anonymous."), buttons re-enabled.
- Offline: both buttons disabled, inline `engage.leaderboard.offline.notice` ("Connect to the internet to choose."). The member can still leave.
- The same sheet is reused (not a different screen) when MA-12 or MA-19's own toggle is turned off while the notice is unseen, with the title and body unchanged.
- The notice is shown once per member **per account**, not per gym `[NOTE FOR UX]`: the PRD stores `leaderboard_notice_seen_at` on the member's preferences (AD-54, "`member_preferences`"). For a multi-gym member, whether the notice must be seen once per gym is not settled; each gym names the member to a different set of people, so per gym is safer. Raise with architecture.

**States**

| State | Treatment |
|---|---|
| Notice not yet seen | The sheet above, over an empty screen (header and segmented control only) |
| Loading | 6 rows of 56pt skeleton, then the member's row slot; target under 2 s (NFR-029) |
| Normal | List per Layout |
| Member is in the top 10 | List shows ranks 1 to 10, own row highlighted inside it, neighbour line under the own row |
| Member not in the top 10 | Top 10, separator, neighbour above, own row, neighbour below |
| Member unranked (no visit this month) | The top 10 (if any) and, in place of the own row, `engage.leaderboard.unranked`; no neighbours, no behind line |
| Nobody ranked yet (new month) | One empty-state block `engage.leaderboard.empty.month` instead of the list; the own-row slot shows the unranked line |
| Member is the only one ranked | Own row alone, with `engage.leaderboard.onlyYou` |
| Member hidden (Anonymous) | Own row labelled "You" with the `hidden.self` line; the toggle is on; the member's rank and count are exactly as if visible |
| Last month tab | Same layout; the visibility row stays; no "behind" line on the previous month `[ASSUMPTION]` (it is history) |
| Gym member count small | No change; there is no minimum board size and no hiding of a small board `[NOTE FOR UX]` (a board of two reveals who a rank belongs to by elimination; Anonymous still holds because the label is the server's, but a gym owner might prefer a minimum. Not decided) |
| Offline | Last cached board, shown with `engage.updatedAt` and a banner; the Anonymous toggle and notice buttons are disabled. A cached copy holds only what the server already sent; a hide made after the cache was taken applies from the next load, and the screen says so `[ASSUMPTION]` |
| Error | Error card in the list slot `engage.leaderboard.error`, pull to refresh; the visibility row still renders |

**Interactions:** pull to refresh; rows are not tappable (there is no profile to open: no photo, no phone, no member id reaches the device, NFR-027); tapping the toggle follows MA-12. **Back:** back arrow to Home; switching tabs does not push a route.

**Privacy rules shown to the member:** none beyond the notice, but the screen never offers a "who is this" action and never shows another member's photo, phone or identifier.

---

### 2.5 MA-20 · Milestone Celebration *(V1.8, FR-229; Share FR-231; Epics 30 and 31)*

**Purpose:** Mark the member's 7th, 30th and 100th visit day at the gym, once, so they feel proud, and let them share it if they choose.

**Entry:** Pushed automatically over Home when the app has an unacknowledged, non-silent milestone for the active gym. It is never a tab and never a push notification target. **Route:** `/celebration/:milestoneId`. **Exit:** [Keep going] or Android back, to Home.

**When it appears.** Check-in itself is unchanged: the green result overlay keeps its 2.5 s and fade. After it, Home mounts and settles engagement (AD-53), and if a milestone is waiting, the celebration is pushed about 600 ms later. A visit made **offline** produces its milestone after the visit syncs, so the celebration appears on the next Home focus after sync, possibly hours later, with the same screen and copy (FR-229). If several are waiting (for example after a long offline gap), only the highest is shown and the lower ones are acknowledged silently, because the badge shelf keeps all of them `[ASSUMPTION]`. A milestone earned before the V1.8 release is silent (FR-225): no celebration, badge only.

**Mock:** none (text design).

**Layout, top to bottom** (full screen, background `background` `#0A0F17`, no tab bar, no back arrow; content centred, 480pt max width)

1. **Reserved mascot slot** `[ASSUMPTION]`: an empty, zero-height region above the milestone card, bound to the optional catalog keys `engage.celebration.mascot.*`. In V1.8 it renders nothing (zero height) when its keys are empty, so adding a character later changes no layout. See 4.4.
2. **Milestone card**, a `{components.celebrationOverlay}` card (`rounded.hero` 24, surface `#141F30`): gym logo (48pt, from the branding cache; omitted if not cached) and gym name (`smallBold`); the milestone numeral ("30") in the celebration numeral size (see DESIGN additions); the word "visits" (`engage.celebration.unit`); the headline (`engage.celebration.30.headline`); one sentence (`engage.celebration.30.sub`); a read-only **mini month calendar** of the member's current month with lit days (`{components.calendarDayCell}` small variant, 28pt, lit days only, no numerals, no at-risk) where the card has room: `[ASSUMPTION]` shown when the screen height is at least 640pt, hidden below that, and always hidden at +2 text sizes so the card never clips.
3. Buttons, stacked, full width, 52pt: **[Share]** *(Should, primary)*, **[Keep going]** (secondary; primary when Share is absent). A text link **[See your badges]** below, *(Should, only when badges are shipped)*.

**Composition equals the shared image.** The card in item 2 is the same composition used for the image the member shares (see Share), so what the member sees is what they send. The share image is the card rendered at 1080 by 1920 px (the portrait ratio of a WhatsApp status) on the same dark background `[ASSUMPTION]`.

**Interactions**

- On appear: haptic **Success notification** (the same haptic as a completed payment, MA-17; no new haptic type). The numeral counts up from 0 to the milestone over 700 ms and the card scales from 96% to 100% with a fade over 400 ms. No confetti, no looping animation, no sound `[ASSUMPTION]`; `[NOTE FOR UX]` the existing V1.6 rule "Don't add confetti, badges, or celebratory animation to a reward" is about loyalty rewards and stays; a milestone celebration is a different surface and the owner asked for one; this spec keeps it restrained (a single count-up and fade). Confirm.
- **Reduced motion (the system setting):** no count-up and no scale; the card appears at its final state with a 150 ms cross-fade; the Success haptic still fires. The Share and Keep going buttons behave identically.
- [Keep going]: acknowledges the milestone on the server (the single acknowledge function, AD-53) and returns to Home. If the acknowledge call fails (offline), the screen still closes and the acknowledgement is retried silently; the celebration is not shown twice (it is also stored on the device as shown).
- Android back = [Keep going]. Swipe down does nothing.
- [See your badges]: acknowledges and pushes MA-21 (replacing this route, so Back from the shelf returns to Home).

**Share flow *(Should, FR-231; AD-60: no server side)***

1. Member taps [Share]. The button shows a spinner and is disabled (button loading rule); the label stays so the width does not change.
2. The app renders the milestone image on the device from the member's own data: gym name and logo, the milestone numeral and headline, the mini month calendar where it fits, and the share caption text (`engage.share.caption.*`). It contains no other member's data, no phone number, no payment figure, and `[ASSUMPTION]` no member name (see Q4).
3. The image is handed to the phone's own share sheet, so the member picks WhatsApp status, a chat or any target. GymOS receives nothing and stores nothing about what was shared.
4. Result handling:
   - Share sheet closed with no target chosen: nothing happens, no message, the screen stays.
   - Shared: nothing happens, no confirmation toast (the OS shows its own).
   - **Image could not be made** (render failure, out of memory): inline message above the buttons `engage.share.error` with [Try again], and the screen otherwise works.
   - **Sharing not available** on the device: inline `engage.share.unavailable`; the Share button is hidden on the next view.
   - **Logo not cached or not loadable:** the image is made with the gym name only; no error `[ASSUMPTION]`.
   - Offline: sharing works; building the image needs no network.
5. The same flow, with the badge's own composition, is used from MA-21's badge detail sheet.

**States:** appear (above); reduced motion (above); Share error (above); loading is not a state of this screen (it is only pushed when its data is already on the device); the celebration is never shown to an expired or suspended member's blocked app (root guards win). A member who somehow opens the route for an already-acknowledged milestone sees it replaced with Home `[ASSUMPTION]`.

**Accessibility:** announced as one `alert` once, the sentence `engage.celebration.a11y`; the numeral and the mini calendar are decorative (`accessibilityRole: 'none'`); focus starts on the headline. Buttons 52pt.

---

### 2.6 MA-21 · Badge Shelf *(V1.8, FR-230, FR-231; Epic 31, Should)*

**Purpose:** A calm place where the member can see what they have earned and what is next, at any time.

**Entry:** MA-12 "Badges" row; MA-20 [See your badges]. **Route:** `/badges`. **Exit:** back arrow.

**Mock:** none (text design).

**Layout, top to bottom**

1. Header bar: back arrow, title "Badges" (`engage.badges.title`).
2. Summary line: "2 of 5 earned" (`engage.badges.summary`).
3. A two-column grid of `{components.badgeTile}` (three columns at 600pt and wider is not used: tablet keeps the 480pt column, two columns). Order: First visit, 7 visits, 30 visits, 100 visits, 4 weeks in a row. The 4-weeks tile is shown only when Shields are shipped (it ties to the Shield week); otherwise it is absent.
4. Footnote `engage.badges.grantsNothing` ("Badges are just for you. They don't unlock anything.").

**Tile states**

| State | Visual | Text |
|---|---|---|
| Earned | Icon Chip 48pt in `{colors.accent}` with the badge glyph (First visit `flag`, 7 `looks_one`, 30 `local_fire_department`, 100 `military_tech`, 4 weeks `shield`; glyph choices `[ASSUMPTION]`), tile on `flat` surface, check glyph corner | Badge name, "Earned 14 Oct" (`engage.badges.earnedOn`) |
| Earned silently at release | As earned | Same text; the date is the date the milestone visit actually happened, from stored history |
| Locked, in reach | `border` outline, glyph in `{colors.neutral}`, no check | Name and progress, "12 more visits to go" (`engage.badges.locked.visits`), or for First visit `engage.badges.locked.first`, or for 4 weeks "2 of 4 weeks" (`engage.badges.locked.weeksProgress`) |
| Locked, a 4-week streak not started | Same | `engage.badges.locked.weeks` |

A locked tile never says "locked" as the only text and never shows a lock; the progress line is the message. A tile never shows "0 of N" as a failure.

**Interactions**

- Tap an earned tile: a **badge detail bottom sheet** (slide up): large Icon Chip, badge name, date earned, and the **[Share]** button *(Should, FR-231)*, which uses the same flow as MA-20 with a badge composition (badge, gym name and logo, date, and the month calendar where it fits). Tap a locked tile: the same sheet without Share, showing the progress line.
- Pull to refresh.

**States:** loading 5 tile skeletons; error `engage.badges.error` card; offline shows cached tiles and works for Share (the image is built on the device). A new member with no visit sees five locked tiles with progress lines; the screen is never empty.

**Back behaviour:** back to Profile (or to Home when opened from MA-20).

---

### 2.7 MA-22 · Your Month *(V1.8, FR-235; Epic 31, Could)*

**Purpose:** Let the member look back on the month that just ended. No push, can be ignored.

**Entry:** Home "Your [month] is ready" card; MA-18 when viewing the previous month. **Route:** `/month/:yyyy-mm`. **Exit:** back arrow.

**Mock:** none (text design).

**Layout, top to bottom**

1. Header bar: back arrow, title "Your October" (`engage.month.title`).
2. A `flat` Card, one metric per row, each row an Icon Chip + `statNumeral` + `small` caption:
   - **Visit days**: "12" with "visit days in October" (glyph `event_available`).
   - **Best week**: "4" with "visits in your best week, 14 to 20 Oct" (`engage.month.bestWeek`; glyph `emoji_events`).
   - **Compared with last month** (omitted when the member has no earlier month on record): "+3" with "more than in September" (`engage.month.change.up`); same count: "Same as September" (`.same`); fewer: only the earlier month's figure, "September: 15 visit days" (`.down`) `[ASSUMPTION]` so the screen states a fact and never frames a drop as a loss.
3. A read-only mini calendar of that month with lit days (28pt cells), inside a `flat` Card.
4. Buttons: **[See my calendar]** (opens MA-18 on that month) and nothing else; no Share in V1.8 `[ASSUMPTION]` (FR-231 names the celebration and badges only).

**States**

| State | Treatment |
|---|---|
| Month had no visits | The screen is not offered at all (no Home card, no link) `[ASSUMPTION]`; a deep link to it shows `engage.month.none` and a [See my calendar] button |
| First month ever, no earlier month | The comparison row is omitted |
| Loading | 3 metric-row skeletons ~64pt each and a grid skeleton |
| Error | `engage.month.error` card with pull to refresh |
| Offline | The screen opens if it was loaded before; otherwise `engage.month.offline.none` with retry |
| Not yet the 1st / month not ended | Not reachable |

The summary is computed from attendance (FR-235), so a late offline-synced visit corrects it on the next load without a message.

---

### 2.8 MA-23 · Weekly Goal (sheet) *(V1.8, FR-219; Epic 30)*

**Purpose:** Let the member choose how many days a week they want to come, with the next-week rule explained at the moment of choice.

**Entry:** Home goal button; MA-12 Weekly goal row. **Route:** `/goal` (modal bottom sheet, slide up; swipe down or Android back to dismiss without saving). **Exit:** [Save goal] or dismiss.

**Mock:** none (text design).

**Layout, top to bottom (sheet, up to 60% of the screen height)**

1. Grabber and title "Weekly goal" (`engage.goal.title`).
2. Prompt "How many days a week do you want to come?" (`engage.goal.prompt`).
3. **Goal options:** seven pill buttons in one row, "1" to "7", each 44pt wide at 360pt screens or wider; on narrower screens, two rows (1 to 4, 5 to 7) (`{components.goalOption}`). The current goal has a check glyph and the label "current" in the accessible name; the chosen one is filled `{colors.accent}` with a check glyph; unchosen ones have a `border` outline. Single choice, no default pre-selection other than the member's current goal.
4. The **effect line** under the options: when the choice differs from the current goal, "Starts Monday 24 Nov. This week stays at 3." (`engage.goal.effective`); when the same, `engage.goal.noChange`; when a change is already pending, `engage.goal.pending` and the choice replaces the pending one `[ASSUMPTION]`.
5. A `small` line `engage.goal.why` ("A change starts next Monday, so this week's result stays fair.").
6. **[Save goal]** primary Button (disabled until the choice differs from the current or pending goal).

**Behaviour**

- Saves through the member-owned goal function; the new goal is stored with an effective week and never alters the week in progress (FR-219, NFR-028).
- Success: haptic **Light impact** `[ASSUMPTION]`, the sheet closes, a toast `engage.goal.saved` ("Goal saved. Starts Mon 24 Nov"); Home shows `engage.ring.goalPending` until Monday.
- Error: inline above the button `engage.goal.error`; the sheet stays.
- Offline: the options work but [Save goal] is disabled with `engage.goal.offline` `[ASSUMPTION]` (a goal change is not queued, because the next-Monday date depends on the server's gym-local week).
- A member who has never chosen sees "3" selected and the hint `engage.ring.goalHint.default`; choosing 3 and saving records an explicit goal at 3 `[ASSUMPTION]`.
- `[NOTE FOR UX]` A brand-new member who joins mid-week and picks a goal on day one will wait until next Monday for it to apply, because FR-219 has no first-goal exception. That may feel slow and a lower goal can look like a loophole; the rule is kept as written. If pilots show confusion, the exception to ask for is "the first explicit goal applies this week" (PRD change, FR-219).

---

## 3. Cross-cutting components (behaviour)

INSERT AFTER: the paragraph beginning `**Rewards card *(V1.6)*:**` in "### Member App Component Library"

**Goal Ring *(V1.8, `{components.goalRing}`)*:** a read-only progress display with N equal arc segments for a weekly goal of N (1 to 7). Filled segments `{colors.accent}`; complete: all `{colors.success}` plus a check glyph; empty: `border`. The centre "[visits] / [goal]" is `statNumeral`. It has no tap action of its own (the card around it does). Its accessible label is a sentence, not the arcs.

**Streak Chip *(V1.8, `{components.streakChip}`)*:** an Icon Chip plus one `smallBold` line. The weekly variant is the main streak and uses the larger chip; the daily variant (Could) is compact. A streak chip is never rendered at a value of 0; the substitutes are the first-week line, the comeback card, or nothing.

**Shield Chip *(V1.8, `{components.shieldChip}`)*:** Icon Chip glyph `shield` plus a count. Not rendered at 0. Tappable (explainer sheet). Held, used and earned states are communicated by words in notices, not by colour.

**Calendar Day Cell *(V1.8, `{components.calendarDayCell}`)*:** the states in MA-18. Shape or glyph always accompanies colour.

**Leaderboard Row *(V1.8, `{components.leaderboardRow}`)*:** rank, neutral Icon Chip (never a photo), label, visits. The member's own row carries the word "You" and a 2pt accent border. No special treatment for any rank.

**Badge Tile *(V1.8, `{components.badgeTile}`)*:** earned and locked per MA-21.

**At-Risk Pulse *(V1.8, `{components.atRiskPulse}`)*:** a short, bounded outline pulse with a static fallback, always with the glyph and words next to it.

**Celebration Overlay *(V1.8, `{components.celebrationOverlay}`)*:** the MA-20 card and its motion. Used only by MA-20.

---

## 4. Voice and Tone additions

### 4.1 Voice and Tone table rows

INSERT AFTER: the table row beginning `| Step-up wrong code *(V1.7)* |` in "## Voice and Tone" (same table; three columns)

| Context | Write this | Not this |
|---|---|---|
| Ring, in progress *(V1.8, FR-219)* | "2 more visits close your ring." | "You're behind this week." / "Only 2 more!" (no countdown pressure) |
| Ring, goal met *(V1.8)* | "Goal met. Your streak becomes 6 weeks when the week ends." | "Congratulations!!!" (no hype, no exclamation, as in Rewards) |
| Weekly streak *(V1.8, FR-220)* | "5 weeks in a row" | "5 week streak - don't lose it!" |
| First week, no streak yet *(V1.8)* | "Close your ring to start your streak." | "Streak: 0" / "No streak" (never a bare 0) |
| Shield saved *(V1.8, FR-222)* | "Your Shield saved week 6. Your streak is still 5 weeks." | "You missed a week." / "Shield used!" (say what it kept, not what was missed) |
| Shield explained *(V1.8)* | "Every 4 weeks in a row earns a Shield. If you miss a week, a Shield keeps your streak going on its own." | "Streak insurance." (no money word) |
| Comeback *(V1.8, FR-223)* | "Your best streak: 8 weeks. Visit 3 times in 10 days to get back on track." | "Your streak was broken." / "Streak lost: 0" |
| At risk *(V1.8, FR-224)* | "Visit today to close your ring. 6 hours left." | "Last chance!" / "You'll lose your week!" (protect, never threaten) |
| At risk, daily run *(V1.8)* | "Visit today to keep your 4-day run going." | "Don't break your streak!" |
| Calendar empty month *(V1.8)* | "No visits yet this month. Your first one lights today." | "No data." / "You haven't been this month." |
| Leaderboard behind *(V1.8, FR-226)* | "2 visits behind the member above" | "You're losing to Chantal" (no individual named in a comparison line) |
| Leaderboard notice *(V1.8, FR-227)* | "Other members would see you as Mireille K.: your first name and the first letter of your last name. Never your photo or phone number." | "By continuing you agree to appear on the leaderboard." (no consent-by-default wording; the notice offers a real choice) |
| Anonymous *(V1.8)* | "You appear as Anonymous. You still keep your rank." | "Hidden" / "Private mode" |
| Milestone *(V1.8, FR-229)* | "30 visits at Grace Fit. You've built something." | "Level up! You unlocked 30 visits!" (no game language, no unlock; nothing is granted) |
| Share caption *(V1.8, FR-231)* | "30 visits at Grace Fit. One day at a time." | "Join me on GymOS!" (the image advertises the gym, not the app) |
| Share failed *(V1.8)* | "Couldn't make your image. Try again." | "Error generating bitmap." |
| Badge locked *(V1.8, FR-230)* | "12 more visits to go" | "Locked" / "You haven't earned this" |
| Gym challenge *(V1.8, FR-234)* | "Reward from Grace Fit: a free smoothie. A promise from your gym." | "Win a free smoothie!" (no individual prize; GymOS grants nothing) |
| Your month *(V1.8, FR-235)* | "12 visit days in October. +3 more than in September." | "You went 3 times less than last month." (a drop is stated as a fact, never as a loss) |
| Goal change *(V1.8)* | "Starts Monday 24 Nov. This week stays at 3." | "Goal locked." |
| Streak reminder N-08 *(V1.8, FR-233)* | "Your week is in reach. Come in today: 2 visits left to close your ring." | "You haven't trained today!" / "Your streak is in danger!" |

### 4.2 V1.8 vocabulary

INSERT BEFORE: the paragraph beginning `**French translations** must be exact equivalents` in "## Voice and Tone"

**V1.8 vocabulary *(2026-11-15)*.** One term per concept, EN / FR, `[ASSUMPTION — FR terms to be reviewed with the FR copy pass]`:

| Concept | EN | FR | Never |
|---|---|---|---|
| A day with at least one check-in at the gym | visit (in counts: "9 visit days" only where a day count is needed) | visite ("9 jours de visite") | "check-in" in engagement copy (that is the scan), "session" (a paid day-visit, V1.6), "séance" (the FR for a paid session, V1.6) |
| The weekly target | weekly goal ("3 days a week") | objectif hebdomadaire ("3 jours par semaine") | "quota", "target" (the challenge uses target) |
| The progress circle | ring | cercle | "wheel", "donut", "anneau" |
| The consecutive-week count | streak ("5 weeks in a row") | série ("5 semaines d'affilée") | "flamme" as the word for it, "chain" |
| The streak saver | Shield / Streak Shield | bouclier / bouclier de série | "freeze", "insurance", "token" |
| Coming back after a break | comeback / "get back on track" | reprise / « reprendre votre élan » | "restart from zero", "lost streak" |
| The monthly ranking | leaderboard | classement | "league", "ranking board", "top list" |
| Hiding the name | Anonymous | Anonyme | "hidden", "private", "ghost" |
| A milestone reward | badge | badge | "trophy", "prize", "reward" (rewards are V1.6 loyalty) |
| The gym-wide monthly goal | gym challenge | défi de la salle | "competition", "contest" |
| The month look-back | Your month | Votre mois | "report", "stats", "wrapped" |

`[NOTE FOR UX]` FR "visite" vs the V1.6 "séance" rule: the V1.6 vocabulary reserves "séance" for a paid/free session and "cours" for a class. "Visite" keeps the engagement features clear of both. If the FR pass prefers "passage" or "entraînement", change only this table and the catalog (one place).

### 4.3 String catalog (EN and FR, every key)

INSERT BEFORE: the paragraph beginning `**French translations** must be exact equivalents` in "## Voice and Tone" (after 4.2). Plural-aware keys use `one` and `other` forms; `{x}` are placeholders. All keys live in the i18n catalog under the namespace shown; N-08 keys also live in the N-06/N-07 copy store (AD-60). EN and FR counts must match.

**Ring, goal and streak (`engage.ring.*`, `engage.streak.*`, `engage.goal.*`)**

| Key | EN | FR |
|---|---|---|
| engage.ring.title | This week | Cette semaine |
| engage.ring.unit | days | jours |
| engage.ring.goalLabel | Goal: {goal, plural, one {1 day} other {{goal} days}} | Objectif : {goal, plural, one {1 jour} other {{goal} jours}} |
| engage.ring.goalPending | Changes to {goal, plural, one {1 day} other {{goal} days}} on {date} | Passe à {goal, plural, one {1 jour} other {{goal} jours}} le {date} |
| engage.ring.goalHint.default | We started you at 3 days a week. Change it any time; a new goal starts next Monday. | Nous démarrons à 3 jours par semaine. Changez-le quand vous voulez ; un nouvel objectif commence lundi prochain. |
| engage.ring.caption.progress | {n, plural, one {1 more visit closes your ring.} other {{n} more visits close your ring.}} | {n, plural, one {Encore 1 visite pour fermer votre cercle.} other {Encore {n} visites pour fermer votre cercle.}} |
| engage.ring.caption.fresh | A fresh week. {goal, plural, one {1 visit closes your ring.} other {{goal} visits close your ring.}} | Nouvelle semaine. {goal, plural, one {1 visite pour fermer votre cercle.} other {{goal} visites pour fermer votre cercle.}} |
| engage.ring.caption.met | Goal met. Nice week. | Objectif atteint. Belle semaine. |
| engage.ring.caption.metStreak | Goal met. Your streak becomes {n, plural, one {1 week} other {{n} weeks}} when the week ends. | Objectif atteint. Votre série passera à {n, plural, one {1 semaine} other {{n} semaines}} à la fin de la semaine. |
| engage.ring.caption.extra | {n, plural, one {1 extra visit} other {{n} extra visits}} this week. | {n, plural, one {1 visite en plus} other {{n} visites en plus}} cette semaine. |
| engage.ring.pendingSync | {n, plural, one {1 visit waiting to sync} other {{n} visits waiting to sync}} | {n, plural, one {1 visite en attente de synchronisation} other {{n} visites en attente de synchronisation}} |
| engage.streak.weeks | {n, plural, one {1 week in a row} other {{n} weeks in a row}} | {n, plural, one {1 semaine d'affilée} other {{n} semaines d'affilée}} |
| engage.streak.first | First week done | Première semaine réussie |
| engage.streak.firstWeek | Close your ring to start your streak. | Fermez votre cercle pour lancer votre série. |
| engage.streak.startsMonday | Your streak starts next Monday. This week's visits still show on your calendar. | Votre série démarre lundi prochain. Les visites de cette semaine figurent déjà dans votre calendrier. |
| engage.streak.nextShield | {n, plural, one {1 more week to your next Shield} other {{n} more weeks to your next Shield}} | {n, plural, one {Encore 1 semaine avant votre prochain bouclier} other {Encore {n} semaines avant votre prochain bouclier}} |
| engage.streak.shieldMax | You're holding the maximum of {max} Shields. | Vous détenez le maximum de {max} boucliers. |
| engage.streak.daily | {n} days in a row | {n} jours d'affilée |
| engage.streak.best | Best: {n, plural, one {1 week} other {{n} weeks}} | Meilleure série : {n, plural, one {1 semaine} other {{n} semaines}} |
| engage.goal.title | Weekly goal | Objectif hebdomadaire |
| engage.goal.prompt | How many days a week do you want to come? | Combien de jours par semaine voulez-vous venir ? |
| engage.goal.option.a11y | {n, plural, one {1 day a week} other {{n} days a week}} | {n, plural, one {1 jour par semaine} other {{n} jours par semaine}} |
| engage.goal.current | current | actuel |
| engage.goal.effective | Starts Monday {date}. This week stays at {current}. | Commence le lundi {date}. Cette semaine reste à {current}. |
| engage.goal.noChange | This is your current goal. | C'est votre objectif actuel. |
| engage.goal.pending | Your goal changes to {n} on {date}. | Votre objectif passe à {n} le {date}. |
| engage.goal.why | A change starts next Monday, so this week's result stays fair. | Le changement commence lundi prochain, pour que le résultat de cette semaine reste équitable. |
| engage.goal.cta.save | Save goal | Enregistrer l'objectif |
| engage.goal.saved | Goal saved. Starts {date}. | Objectif enregistré. Commence le {date}. |
| engage.goal.error | Couldn't save your goal. Try again. | Impossible d'enregistrer votre objectif. Réessayez. |
| engage.goal.offline | You're offline. Connect to change your goal. | Vous êtes hors ligne. Connectez-vous pour changer d'objectif. |

**Shield and comeback (`engage.shield.*`, `engage.comeback.*`)**

| Key | EN | FR |
|---|---|---|
| engage.shield.chip | {n, plural, one {1 Shield} other {{n} Shields}} | {n, plural, one {1 bouclier} other {{n} boucliers}} |
| engage.shield.saved.week | Your Shield saved the week of {date}. Your streak is still {n, plural, one {1 week} other {{n} weeks}}. | Votre bouclier a sauvé la semaine du {date}. Votre série reste à {n, plural, one {1 semaine} other {{n} semaines}}. |
| engage.shield.saved.day | Your Shield saved {date}. Your run goes on. | Votre bouclier a sauvé le {date}. Votre série continue. |
| engage.shield.earned | You earned a Shield. It will keep a missed week from ending your streak. | Vous avez gagné un bouclier. Il évitera qu'une semaine manquée mette fin à votre série. |
| engage.shield.explainer.title | Streak Shield | Bouclier de série |
| engage.shield.explainer.body | Every 4 weeks in a row earns a Shield. If you miss a week, a Shield keeps your streak going on its own. You can hold up to {max}. Shields can't be bought or given. | Chaque tranche de 4 semaines d'affilée vous rapporte un bouclier. Si vous manquez une semaine, un bouclier maintient votre série tout seul. Vous pouvez en détenir {max} au maximum. Les boucliers ne s'achètent pas et ne se donnent pas. |
| engage.shield.gotIt | Got it | Compris |
| engage.comeback.title | Let's get going again | On s'y remet |
| engage.comeback.best | Your best streak: {n, plural, one {1 week} other {{n} weeks}}. It stays on your record. | Votre meilleure série : {n, plural, one {1 semaine} other {{n} semaines}}. Elle reste à votre palmarès. |
| engage.comeback.goal | Visit {n} times in {days} days to get back on track. | Venez {n} fois en {days} jours pour reprendre votre élan. |
| engage.comeback.progress | {done} of {total} visits | {done} visites sur {total} |
| engage.comeback.windowRestart | Your {days} days start again with your next visit. | Vos {days} jours repartent à votre prochaine visite. |
| engage.comeback.restored.title | You're back. | Vous voilà de retour. |
| engage.comeback.restored.body | Your new streak starts the first week you close your ring. | Votre nouvelle série démarre la première semaine où vous fermez votre cercle. |

**At risk and calendar (`engage.atRisk.*`, `engage.calendar.*`)**

| Key | EN | FR |
|---|---|---|
| engage.atRisk.weekly | Visit today to close your ring. | Venez aujourd'hui pour fermer votre cercle. |
| engage.atRisk.daily | Visit today to keep your {n}-day run going. | Venez aujourd'hui pour garder votre série de {n} jours. |
| engage.atRisk.hoursLeft | {h, plural, one {1 hour left} other {{h} hours left}} | {h, plural, one {1 heure restante} other {{h} heures restantes}} |
| engage.atRisk.minutesLeft | {m} min left | {m} min restantes |
| engage.atRisk.shieldReady | A Shield is ready if you can't make it. | Un bouclier est prêt si vous ne pouvez pas venir. |
| engage.calendar.title | My visits | Mes visites |
| engage.calendar.prev | Previous month | Mois précédent |
| engage.calendar.next | Next month | Mois suivant |
| engage.calendar.monthSummary | {n, plural, one {1 visit day} other {{n} visit days}} in {month} | {n, plural, one {1 jour de visite} other {{n} jours de visite}} en {month} |
| engage.calendar.legend.visit | Visited | Visite |
| engage.calendar.legend.today | Today | Aujourd'hui |
| engage.calendar.legend.milestone | Milestone | Étape |
| engage.calendar.legend.shield | Saved by a Shield | Sauvé par un bouclier |
| engage.calendar.day.visited | {date}: visited | {date} : visite |
| engage.calendar.day.none | {date}: no visit | {date} : pas de visite |
| engage.calendar.day.milestone7 | {date}: your 7th visit | {date} : votre 7e visite |
| engage.calendar.day.milestone30 | {date}: your 30th visit | {date} : votre 30e visite |
| engage.calendar.day.milestone100 | {date}: your 100th visit | {date} : votre 100e visite |
| engage.calendar.day.pending | {date}: waiting to sync | {date} : en attente de synchronisation |
| engage.calendar.day.today.atRisk | Today, {date}: no visit yet. {hoursLeft} | Aujourd'hui, {date} : pas encore de visite. {hoursLeft} |
| engage.calendar.empty.current | No visits yet this month. Your first one lights today. | Aucune visite ce mois-ci pour l'instant. La première s'allumera aujourd'hui. |
| engage.calendar.empty.past | No visits in {month}. | Aucune visite en {month}. |
| engage.calendar.offline | You're offline. Showing your last saved calendar. | Vous êtes hors ligne. Dernier calendrier enregistré affiché. |
| engage.calendar.offline.none | This month isn't saved on your phone yet. Connect to see it. | Ce mois n'est pas encore enregistré sur votre téléphone. Connectez-vous pour le voir. |
| engage.calendar.error | Couldn't load your calendar. Pull down to refresh. | Impossible de charger votre calendrier. Tirez pour actualiser. |

**Leaderboard and notice (`engage.leaderboard.*`, `engage.home.*`)**

| Key | EN | FR |
|---|---|---|
| engage.leaderboard.title | Leaderboard | Classement |
| engage.leaderboard.tab.thisMonth | This month | Ce mois-ci |
| engage.leaderboard.tab.lastMonth | Last month | Mois dernier |
| engage.leaderboard.row.visits | {n, plural, one {1 visit} other {{n} visits}} | {n, plural, one {1 visite} other {{n} visites}} |
| engage.leaderboard.row.you | You | Vous |
| engage.leaderboard.row.anonymous | Anonymous | Anonyme |
| engage.leaderboard.row.tied | Tied | Ex æquo |
| engage.leaderboard.row.gap | Rows between are not shown | Les lignes intermédiaires ne sont pas affichées |
| engage.leaderboard.behind | {n, plural, one {1 visit behind the member above} other {{n} visits behind the member above}} | {n, plural, one {1 visite de retard sur le membre au-dessus} other {{n} visites de retard sur le membre au-dessus}} |
| engage.leaderboard.level | Level with the member above | À égalité avec le membre au-dessus |
| engage.leaderboard.leading | You're leading this month. | Vous êtes en tête ce mois-ci. |
| engage.leaderboard.unranked | Visit once this month to join the board. | Venez une fois ce mois-ci pour entrer au classement. |
| engage.leaderboard.onlyYou | You're the only member on the board so far. | Vous êtes le seul membre classé pour l'instant. |
| engage.leaderboard.empty.month | No visits at {gym} yet this month. Be the first on the board. | Aucune visite chez {gym} ce mois-ci. Soyez le premier du classement. |
| engage.leaderboard.footnote | Each day you visit counts once. The board resets on the 1st. Just for fun: rank earns no prizes. | Chaque jour de visite compte une fois. Le classement repart à zéro le 1er. Pour le plaisir : le classement ne rapporte aucun prix. |
| engage.leaderboard.toggle.label | Appear as Anonymous on the gym leaderboard | Apparaître comme Anonyme dans le classement de la salle |
| engage.leaderboard.visible.self | Other members see you as {label}. | Les autres membres vous voient sous le nom {label}. |
| engage.leaderboard.hidden.self | You appear as Anonymous. You still keep your rank. | Vous apparaissez comme Anonyme. Vous gardez votre rang. |
| engage.leaderboard.notice.title | You're on your gym's leaderboard | Vous êtes dans le classement de votre salle |
| engage.leaderboard.notice.body | Members of {gym} can see a monthly ranking of visits. Other members would see you as {label}: your first name and the first letter of your last name. Never your photo or phone number. | Les membres de {gym} voient un classement mensuel des visites. Les autres membres vous verraient sous le nom {label} : votre prénom et l'initiale de votre nom. Jamais votre photo ni votre numéro de téléphone. |
| engage.leaderboard.notice.until | Until you choose, other members see you as Anonymous. | Tant que vous n'avez pas choisi, les autres membres vous voient comme Anonyme. |
| engage.leaderboard.notice.change | You can change this any time in your Profile. | Vous pouvez le changer à tout moment dans votre profil. |
| engage.leaderboard.notice.cta.show | Show my name | Afficher mon nom |
| engage.leaderboard.notice.cta.hide | Appear as Anonymous | Apparaître comme Anonyme |
| engage.leaderboard.notice.error | Couldn't save your choice. You still appear as Anonymous. | Impossible d'enregistrer votre choix. Vous apparaissez toujours comme Anonyme. |
| engage.leaderboard.offline.notice | Connect to the internet to choose. | Connectez-vous à internet pour choisir. |
| engage.leaderboard.offline | You're offline. Showing the last board saved on your phone. | Vous êtes hors ligne. Dernier classement enregistré affiché. |
| engage.leaderboard.error | Couldn't load the leaderboard. Pull down to refresh. | Impossible de charger le classement. Tirez pour actualiser. |
| engage.leaderboard.error.short | Couldn't load. Tap to retry. | Chargement impossible. Touchez pour réessayer. |
| engage.updatedAt | Updated {time} | Mis à jour à {time} |
| engage.home.rank | Rank {n} this month | Rang {n} ce mois-ci |
| engage.home.error | Couldn't load your week. Pull down to refresh. | Impossible de charger votre semaine. Tirez pour actualiser. |
| engage.home.settleError | Couldn't update your streak just now. We'll try again. | Impossible de mettre à jour votre série pour l'instant. Nous réessaierons. |

**Celebration, share, badges (`engage.celebration.*`, `engage.share.*`, `engage.badges.*`)**

| Key | EN | FR |
|---|---|---|
| engage.celebration.unit | visits | visites |
| engage.celebration.7.headline | 7 visits | 7 visites |
| engage.celebration.7.sub | Seven visits at {gym}. The habit is taking shape. | Sept visites chez {gym}. L'habitude s'installe. |
| engage.celebration.30.headline | 30 visits | 30 visites |
| engage.celebration.30.sub | Thirty visits at {gym}. You've built something. | Trente visites chez {gym}. Vous avez construit quelque chose. |
| engage.celebration.100.headline | 100 visits | 100 visites |
| engage.celebration.100.sub | One hundred visits at {gym}. That's a lasting habit. | Cent visites chez {gym}. C'est une habitude solide. |
| engage.celebration.cta.share | Share | Partager |
| engage.celebration.cta.continue | Keep going | Continuer |
| engage.celebration.cta.badges | See your badges | Voir vos badges |
| engage.celebration.a11y | Milestone: {n} visits at {gym}. | Étape franchie : {n} visites chez {gym}. |
| engage.share.caption.7 | 7 visits at {gym}. One day at a time. | 7 visites chez {gym}. Un jour après l'autre. |
| engage.share.caption.30 | 30 visits at {gym}. One day at a time. | 30 visites chez {gym}. Un jour après l'autre. |
| engage.share.caption.100 | 100 visits at {gym}. One day at a time. | 100 visites chez {gym}. Un jour après l'autre. |
| engage.share.caption.badge | {badge} at {gym}. | {badge} chez {gym}. |
| engage.share.preparing | Making your image… | Préparation de votre image… |
| engage.share.error | Couldn't make your image. | Impossible de créer votre image. |
| engage.share.retry | Try again | Réessayer |
| engage.share.unavailable | Sharing isn't available on this phone. | Le partage n'est pas disponible sur ce téléphone. |
| engage.badges.title | Badges | Badges |
| engage.badges.summary | {n} of {total} earned | {n} sur {total} obtenus |
| engage.badges.first | First visit | Première visite |
| engage.badges.visits7 | 7 visits | 7 visites |
| engage.badges.visits30 | 30 visits | 30 visites |
| engage.badges.visits100 | 100 visits | 100 visites |
| engage.badges.weeks4 | 4 weeks in a row | 4 semaines d'affilée |
| engage.badges.earnedOn | Earned {date} | Obtenu le {date} |
| engage.badges.locked.first | Check in once to earn it | Venez une fois pour l'obtenir |
| engage.badges.locked.visits | {n, plural, one {1 more visit to go} other {{n} more visits to go}} | {n, plural, one {Encore 1 visite} other {Encore {n} visites}} |
| engage.badges.locked.weeks | Keep a streak going for 4 weeks | Gardez une série pendant 4 semaines |
| engage.badges.locked.weeksProgress | {n} of 4 weeks | {n} semaines sur 4 |
| engage.badges.grantsNothing | Badges are just for you. They don't unlock anything. | Les badges sont pour vous. Ils ne débloquent rien. |
| engage.badges.error | Couldn't load your badges. Pull down to refresh. | Impossible de charger vos badges. Tirez pour actualiser. |

**Your month, challenge, Profile and reminder (`engage.month.*`, `engage.challenge.*`, `engage.profile.*`, `n08.*`)**

| Key | EN | FR |
|---|---|---|
| engage.month.title | Your {month} | Votre mois de {month} |
| engage.month.homeCard | Your {month} is ready. | Votre mois de {month} est prêt. |
| engage.month.cta.see | See it | Voir |
| engage.month.dismiss | Dismiss | Fermer |
| engage.month.visitDays | {n, plural, one {visit day in {month}} other {visit days in {month}}} | {n, plural, one {jour de visite en {month}} other {jours de visite en {month}}} |
| engage.month.bestWeek | {n, plural, one {visit in your best week} other {visits in your best week}}, {range} | {n, plural, one {visite pendant votre meilleure semaine} other {visites pendant votre meilleure semaine}}, {range} |
| engage.month.change.up | {n} more than in {prevMonth} | {n} de plus qu'en {prevMonth} |
| engage.month.change.same | Same as {prevMonth} | Comme en {prevMonth} |
| engage.month.change.down | {prevMonth}: {n, plural, one {1 visit day} other {{n} visit days}} | {prevMonth} : {n, plural, one {1 jour de visite} other {{n} jours de visite}} |
| engage.month.link | Your {month} | Votre mois de {month} |
| engage.month.cta.calendar | See my calendar | Voir mon calendrier |
| engage.month.none | No visits in {month}. | Aucune visite en {month}. |
| engage.month.error | Couldn't load your month. Pull down to refresh. | Impossible de charger votre mois. Tirez pour actualiser. |
| engage.month.offline.none | Connect to see your month. | Connectez-vous pour voir votre mois. |
| engage.challenge.title | Gym challenge | Défi de la salle |
| engage.challenge.progress | {done} / {target} visit days this month | {done} / {target} jours de visite ce mois-ci |
| engage.challenge.reward | Reward from {gym}: {reward} | Récompense de {gym} : {reward} |
| engage.challenge.promise | A promise from your gym. | Une promesse de votre salle. |
| engage.challenge.ends | Ends {date} | Se termine le {date} |
| engage.challenge.reached | Target reached. | Objectif atteint. |
| engage.challenge.collective | Everyone's visits count. Nobody is ranked. | Les visites de tous comptent. Personne n'est classé. |
| engage.profile.section | Training | Entraînement |
| engage.profile.goal.row | Weekly goal | Objectif hebdomadaire |
| engage.profile.goal.value | {n, plural, one {1 day} other {{n} days}} | {n, plural, one {1 jour} other {{n} jours}} |
| engage.profile.goal.pending | {n, plural, one {1 day} other {{n} days}}, then {next} from {date} | {n, plural, one {1 jour} other {{n} jours}}, puis {next} dès le {date} |
| engage.profile.badges.row | Badges | Badges |
| engage.profile.badges.value | {n} of {total} | {n} sur {total} |
| engage.profile.anonymous.helperOn | Other members see you as Anonymous from their next refresh. You still keep your rank. | Les autres membres vous voient comme Anonyme dès leur prochain affichage. Vous gardez votre rang. |
| engage.profile.anonymous.helperOff | Other members see you as {label}. | Les autres membres vous voient sous le nom {label}. |
| engage.profile.anonymous.helperUnseen | You appear as Anonymous until you open the leaderboard and choose. | Vous apparaissez comme Anonyme jusqu'à ce que vous ouvriez le classement et fassiez votre choix. |
| engage.profile.anonymous.link | See the leaderboard | Voir le classement |
| engage.profile.reminder.label | Streak reminder | Rappel de série |
| engage.profile.reminder.helper | One reminder at {time}, only when a visit today keeps your week or run going. | Un rappel à {time}, seulement quand une visite aujourd'hui permet de garder votre semaine ou votre série. |
| n08.weekly.title | Your week is in reach | Votre semaine est à portée |
| n08.weekly.body | Come in today: {n, plural, one {1 visit} other {{n} visits}} left to close your ring. | Venez aujourd'hui : {n, plural, one {encore 1 visite} other {encore {n} visites}} pour fermer votre cercle. |
| n08.daily.title | Your {n}-day run | Votre série de {n} jours |
| n08.daily.body | Come in today to keep it going. | Venez aujourd'hui pour la prolonger. |

Notes on the catalog:

- Two N-08 bodies exist. When both FR-233 conditions hold the weekly body is used (the weekly ring is the main streak) `[ASSUMPTION]`. The push title is a catalog string, never the gym name.
- N-08 is scheduled at 18:00 gym-local; `{time}` in the Profile helper is read from the same configuration as the job (OQ-33), so the helper never says a time the job does not use. FR format: "18 h". EN format: "6 pm".
- `engage.challenge.reward` inserts the Owner's reward text as typed, never translated, and the card shows it in the language it was written.
- Dates in these strings are spoken and written in full per the existing accessibility floor ("2 December", not "2/12").

### 4.4 Text-slot rules and the reserved mascot slot

APPEND TO SECTION: "## Voice and Tone" (after the catalog, before the `**French translations**` paragraph)

- **Slots, not screen text (FR-232).** Every string above is a catalog key; a screen never contains literal wording. Goal, ring, celebration, comeback and reminder wording can change without redesigning a screen. In V1.8 there is no in-app editor for these strings: they change by catalog edit and release `[ASSUMPTION]`.
- **No mascot in V1.8.** The owner's mascot is parked. `[NOTE FOR UX]` Where it will speak, the screens already reserve one optional line each: the celebration (`engage.celebration.mascot.7`, `.30`, `.100`), the comeback card (`engage.comeback.mascot`), the streak-reminder push (`n08.mascot`) and the Shield saved notice (`engage.shield.mascot`). **These keys exist and are empty in V1.8**; a screen renders nothing (zero height, no gap) when its mascot key is empty. When the mascot is added the character speaks these lines and the layout does not change. Keep every V1.8 string speaker-neutral: no first-person "I" and no "we" except where the gym is meant (the Leaderboard notice's "Members of {gym}").
- **Tone rule.** Every line states what the member built or what is in reach. A line never states what the member lost, missed or will lose, and never uses exclamation marks, countdown language or "last chance".

---

## 5. State patterns (Empty, Loading, Error) for V1.8

APPEND TO SECTION: "### Empty States" (rows added to the existing table)

| Surface / Context | Copy | Primary action |
|---|---|---|
| MA-18 Calendar, current month, no visit *(V1.8)* | "No visits yet this month. Your first one lights today." | [Check In] only on the Home route; none here |
| MA-18 Calendar, past month, no visit *(V1.8)* | "No visits in [month]." | None |
| MA-19 Leaderboard, nobody ranked *(V1.8)* | "No visits at [Gym] yet this month. Be the first on the board." | None |
| MA-19 Leaderboard, member only one ranked *(V1.8)* | "You're the only member on the board so far." | None |
| MA-19 Leaderboard, member unranked *(V1.8)* | "Visit once this month to join the board." | None |
| MA-21 Badges, none earned *(V1.8)* | Not an empty state: five locked tiles with progress lines | None |
| MA-22 Your Month, no visit *(V1.8)* | "No visits in [month]." (only reachable by link; not offered otherwise) | [See my calendar] |
| MA-09 Comeback card, Shield card, Gym challenge card, "Your month" card *(V1.8)* | Not empty states: **absent** when the state does not apply | — |

APPEND TO SECTION: "### Loading States" (rows added to the existing table)

| Context | Skeleton shape |
|---|---|
| MA-09 "This week" card *(V1.8)* | 120pt circle + 2 text lines, ~168pt card; independent of the status card; may show up to 2 s after a week closes while engagement settles |
| MA-09 Leaderboard card *(V1.8)* | Rounded rectangle ~72pt |
| MA-09 Gym challenge card *(V1.8)* | Rounded rectangle ~96pt; rendered only once the gym is known to have a challenge (no flash otherwise) |
| MA-18 Calendar *(V1.8)* | Month bar and legend at once; 35 square skeletons in a Card |
| MA-19 Leaderboard *(V1.8)* | 6 rows ~56pt; **never rendered behind the first-open notice** |
| MA-21 Badges *(V1.8)* | 5 tile skeletons |
| MA-22 Your Month *(V1.8)* | 3 metric rows ~64pt + grid skeleton |
| MA-20 Celebration *(V1.8)* | No loading state: pushed only when its data is on the device |

APPEND TO SECTION: "### Error States" (rows added to the existing "Per-screen" table)

| Screen | Scenario | Treatment |
|---|---|---|
| MA-09 *(V1.8)* | "This week" data load failure (no cache) | Error card in the card slot: "Couldn't load your week. Pull down to refresh." |
| MA-09 *(V1.8)* | Settle call failed after a week closed | Last known state plus a small line "Couldn't update your streak just now. We'll try again."; retried on next focus |
| MA-18 *(V1.8)* | Calendar load failure | Error card in the grid slot, pull to refresh |
| MA-19 *(V1.8)* | Board load failure | Error card in the list slot; the visibility row still shows |
| MA-19 *(V1.8)* | Notice choice not saved | Inline above the buttons: "Couldn't save your choice. You still appear as Anonymous."; sheet stays |
| MA-12 / MA-19 *(V1.8)* | Anonymous or Streak reminder toggle fails to save | Toggle reverts with the existing inline error toast |
| MA-20 *(V1.8)* | Share image could not be made | Inline "Couldn't make your image." + [Try again]; the screen still works |
| MA-20 *(V1.8)* | Sharing unavailable on the device | Inline "Sharing isn't available on this phone."; Share hidden on next view |
| MA-21 *(V1.8)* | Badge load failure | Error card; pull to refresh |
| MA-22 *(V1.8)* | Month load failure | Error card; pull to refresh |
| MA-23 *(V1.8)* | Goal not saved | Inline above [Save goal]: "Couldn't save your goal. Try again."; sheet stays |

---

## 6. Engagement state patterns, interaction, accessibility, responsive

### 6.1 V1.8 state patterns table

INSERT BEFORE: `## Interaction Primitives`

### V1.8 — New State Patterns (member engagement)

V1.8 adds a per-member engagement state machine. Everything is derived on the server from attendance (NFR-028); the app displays, it never decides. There is no per-gym switch for the core features: they apply to every member of every gym at release, from the first full week after the engagement start (FR-225). The Could features (daily streak, challenge, "Your month") and the Should features (Shields, comeback, badges, share, reminder) are absent from the screens, not disabled, when not shipped.

**Weekly ring and streak states *(FR-219–FR-223)*:**
| State | Rule | Member app |
|---|---|---|
| Goal default | No goal chosen: 3 | Ring of 3; one-time hint; goal button "Goal: 3 days" |
| Goal change pending | Applies from next gym-local Monday; the current week keeps its goal | Goal button "Changes to 4 days on [date]" |
| Release week | Weeks before the engagement start are never settled | Ring works, streak area says it starts next Monday |
| First week | No settled week yet | No streak chip; "Close your ring to start your streak." |
| Open week | Visit days fill segments, one per day | Ring "n / goal" |
| Goal met (open) | Streak counts when the server settles the week | Ring complete; caption states what the streak becomes |
| Week settled, met | Streak +1; Shield earned at every 4th | Chip updates; Shield chip +1 and a one-time notice |
| Week settled, missed, Shield held | The Shield is used automatically | Streak unchanged; one-time notice says which week it saved |
| Week settled, missed, no Shield | Streak ends; best streak kept | Comeback card appears (never "0") |
| Comeback | 3 visits within 10 days restore the status; a lapsed window restarts at the next visit | Comeback card with progress; restored note |
| Daily run (Could) | Run of 3+ consecutive visit days; hidden when it ends; a missed day uses a Shield only when two are held | Compact daily chip appears and disappears silently |
| At risk | FR-233 (a) or (b), no visit today | Hint on Home; today's cell on MA-18; the N-08 push if on |
| Visit made offline | Counts after it syncs; a late visit corrects the week, the month and the milestone it belongs to | Dashed pending segment and cell until synced; no correction message |
| Expired status | Check-in denied by the gate | At-risk hint hidden `[ASSUMPTION]`; everything else shown |

**Milestone, badge and leaderboard states *(FR-225–FR-231)*:**
| State | Rule | Member app |
|---|---|---|
| Milestone reached online | 7th, 30th or 100th visit day at this gym | MA-20 after Home settles; shown once |
| Milestone reached offline | Counted after sync | MA-20 on the next Home focus after sync |
| Milestone before release | Earned silently (badge only) | No celebration |
| Several milestones waiting | Highest shown, others acknowledged silently | One MA-20 |
| Badge | Earned once, never lost, grants nothing | MA-21 tile; no push, no dot |
| Notice unseen | Appears as Anonymous to others whatever the toggle | MA-19 opens on the notice; leaving without choosing keeps Anonymous |
| Notice seen, visible | First name and last initial, no photo or phone | Own row "You"; helper says how others see the member |
| Hidden (Anonymous) | Counted and ranked; label replaced on the server | Own row "You" plus the hidden line |
| Member deactivated or support | Not ranked (AD-54) | No board for them |
| Challenge live / reached / cancelled / none | One per gym per month; reward is a promise | Card with progress / reached state / absent / absent |
| Multi-gym member | Separate engagement per gym | Active gym only |

### 6.2 Interaction primitives additions

INSERT AFTER: the table row `| MA-17 payment failed / not approved *(V1.6)* | Notification error |` (Haptic feedback table, "### Member App (Mobile)")

| Milestone celebration appears *(V1.8, MA-20)* | Success notification (reduced motion does not remove it) |
| Weekly goal saved *(V1.8, MA-23)* | Light impact `[ASSUMPTION]` |
| Shield saved / earned, comeback restored, at-risk hint appears *(V1.8)* | None. These are passive notices on a screen the member opened; a haptic would turn them into alarms |
| Leaderboard notice choice, Anonymous toggle, Streak reminder toggle *(V1.8)* | None (matches the existing notification toggles) |

INSERT AFTER: the paragraph beginning `*(V1.6)* Check-in result overlays keep their fade-in.` (end of "### Member App (Mobile)" interaction primitives)

*(V1.8)* MA-18, MA-19, MA-21 and MA-22 push with slide-left and return with slide-right, like MA-17. MA-20 opens with the same fade as a check-in result overlay and closes to Home with a fade. MA-23 and the badge detail and Shield explainer sheets slide up and swipe down to dismiss (MA-19's first-open notice sheet is the one exception: it cannot be swiped away). The calendar's month swipe is optional (chevrons are primary). `{components.atRiskPulse}` is the only looping motion in the app besides the scan target's pulse, and it is bounded.

### 6.3 Accessibility Floor additions

INSERT AFTER: the table row beginning `| MA-17 phases *(V1.6)* |` in "## Accessibility Floor", "### Member App"

| Requirement | Implementation |
|---|---|
| Goal ring *(V1.8, MA-09)* | The ring is **one** element with role `progressbar` and `accessibilityValue {min 0, max goal, now visits}`; the arcs are decorative (`accessibilityRole: 'none'`). Label: "Weekly goal: 2 of 3 visit days this week. 1 more visit closes your ring." / "Objectif de la semaine : 2 jours de visite sur 3. Encore 1 visite pour fermer votre cercle." When met: "Weekly goal met: 3 of 3." The "This week" card as a whole reads: ring label, then streak ("5 weeks in a row"), then Shields ("1 Shield"), then the at-risk hint, in that order, as one grouped, focusable element with the hint "Double tap to open your calendar"; the goal button and Shield chip are separate focusable children |
| Streak and Shield chips *(V1.8)* | Labels are the sentence: "5 weeks in a row", "1 Shield. Double tap for what a Shield does". A streak is never announced as "0" |
| At-risk hint *(V1.8, MA-09, MA-18)* | The words ("Visit today to close your ring. 6 hours left.") are the signal; the pulse, the glyph and the amber outline are redundant. Announced once when Home focuses (polite live region), **not** re-announced as the minutes tick; the hours left are re-read only when the element is focused. The hint never uses `alert`: it is a reminder, not a result |
| At-risk pulse, reduced motion *(V1.8)* | When the system "reduce motion" setting is on (or the OS animations-off setting), the pulse is removed: a static 2pt `{colors.warning}` outline and the glyph remain. With motion allowed, the pulse runs for 3 cycles on screen focus and then stays static (it never loops forever) `[ASSUMPTION]`. Nothing flashes more than once a second |
| Colour never the only signal *(V1.8)* | Lit day = fill + check glyph; today = thicker outline + "Today" legend; at risk = glyph + hours text + the line under the grid; milestone = star glyph + detail text; Shield = glyph + legend; ring complete = check glyph + text; the member's own leaderboard row = "You" word + thicker border; badge earned = check glyph + "Earned [date]"; challenge reached = check glyph + words |
| Calendar *(V1.8, MA-18)* | The month heading is a header and is read first with the summary: "November 2026. 9 visit days." Each of the 7-column cells is a separate element in reading order (Mon to Sun, row by row), in groups of one per week labelled "Week of 10 November, 3 visit days". Cell labels are the full sentence: "Tuesday 12 November, visited" / "Wednesday 13 November, no visit" / "Friday 15 November, your 30th visit" / "Today, Friday 15 November, no visit yet. 6 hours left" (never "12/11"). Cells of the other months and future days are not focusable. Month chevrons are labelled "Previous month" and "Next month" and the disabled one is announced as dimmed. Changing the month re-announces the heading and the summary. The detail line is a polite live region updated on cell selection |
| Calendar swipe *(V1.8)* | The swipe-between-months gesture has no accessible equivalent need (the chevrons are the control); with a screen reader the swipe is disabled so it does not fight the reader's own swipes |
| Leaderboard *(V1.8, MA-19)* | Each row is one element: "Rank 4, Chantal N., 11 visits" / "Rang 4, Chantal N., 11 visites"; own row: "Rank 9, you, 9 visits. 2 visits behind the member above." Ties: "Rank 4, tied". The separator row is announced "Rows between are not shown". Anonymous rows read "Anonymous". Rows are not buttons and are not announced as tappable |
| Leaderboard notice *(V1.8)* | The sheet is a modal dialog: focus moves to its title on open, is trapped inside, and the list behind is not reachable. Both buttons have labels that state the consequence: "Show my name: other members will see you as Mireille K." / "Appear as Anonymous: other members will see you as Anonymous". Because it can't be swiped away, the back arrow stays reachable |
| Celebration *(V1.8, MA-20)* | Announced once as an `alert` with `engage.celebration.a11y`; focus starts on the headline; the numeral count-up and the mini calendar are decorative. The Success haptic fires with reduced motion on |
| Share *(V1.8)* | [Share] has the label "Share my milestone image". While building: "Making your image" is announced politely; failure uses the inline message in a polite live region |
| Badges *(V1.8, MA-21)* | Tile label: "30 visits badge, earned 14 October" / "100 visits badge, not earned yet, 82 more visits to go". Locked is stated in words in the label, never by dimming only |
| Goal picker *(V1.8, MA-23)* | The seven options are a radio group ("Weekly goal, 3 days a week, selected, current"); each option is 44pt minimum and labelled in full ("5 days a week"); [Save goal] announces "disabled" while nothing has changed |
| Dynamic type *(V1.8)* | Up to +2 text sizes with no clipping, as the floor already says. The ring is a fixed 120pt; at more than 130% text size, or under 360pt width, the "This week" card **stacks** (ring above, text below, all centred) instead of side by side. Calendar day numerals are clamped at 130% inside the cells (the cell size is fixed at 44pt); the detail line, the legend and the at-risk line under the grid are **not** clamped and carry the full information at any size. Leaderboard rows grow in height with the text and wrap the label; the rank numeral keeps its column. The celebration card shrinks its mini calendar away rather than clipping |
| Touch targets *(V1.8)* | Calendar cells 44pt (6pt gaps), goal options 44pt, Shield chip 44pt hit area, chevrons 44pt, toggles and rows as existing |
| Language switch *(V1.8)* | Re-announces the title; all `engage.*` strings and the month and weekday names re-render in the new language; the gym challenge reward text stays as the Owner typed it |

### 6.4 Responsive and offline notes

APPEND TO SECTION: "### Member App" under "## Responsive & Platform Behaviour" (after the width table)

| Screen width | V1.8 behaviour |
|---|---|
| < 360px | "This week" card stacks (ring above text). Calendar uses 6pt side gutters so seven 44pt cells fit down to 320pt (7 x 44 = 308); the legend wraps to two lines; the goal options wrap to two rows (1 to 4, 5 to 7) |
| 360–430px | Nominal: ring beside text, cells 44pt |
| > 600px (tablet) | Content max-width 480px centred, as everywhere; the calendar and badge grid do not widen; the celebration card is capped at 420pt wide |

**Text size and orientation.** Landscape is respected, not designed (as elsewhere): the calendar scrolls and the celebration card scrolls if it does not fit; the mini calendar is hidden on short screens. **Safe areas:** the celebration screen has no back arrow, so its buttons sit above the bottom safe area with 16pt padding.

**Offline behaviour (summary)**

| Screen | Offline |
|---|---|
| MA-09 ring, streak, Shields | Last settled state from the device cache; a visit made offline fills its segment with a dashed outline and "1 visit waiting to sync"; counts and streak are corrected only after sync (the device never settles a week) |
| MA-09 at-risk hint | Shown only from a cache taken the same gym-local day; otherwise hidden. The hours left use the cached day-end instant, not the phone clock `[ASSUMPTION]` |
| MA-18 calendar | Previously loaded months render; today's offline visit shows dashed |
| MA-19 leaderboard | Last cached board, "Updated [time]"; notice buttons and the toggle disabled; a cached board is never shown on first open before the notice is chosen |
| MA-20 celebration | Appears only once the milestone is known on the device (after sync); Share works offline |
| MA-21 badges | Cached; Share works offline |
| MA-22 Your Month | If loaded before, else "Connect to see your month." |
| MA-23 goal | Options work, [Save goal] disabled offline |
| Toggles on MA-12 | Optimistic with revert on failure, as existing |
| The N-08 reminder | A push; works whenever the phone has a connection to receive it; it is not sent from the device |

---

## 7. Key flow

APPEND TO SECTION: "## Key Flows" (after "### Flow 15 · Chidi Takes Down an Impersonating Page *(V1.7, UJ-14)*")

`[ASSUMPTION — number]` This is Flow 16. If the staff-side V1.8 pass also adds flows (UJ-16, UJ-17), renumber at splice time so UJ order is kept.

### Flow 16 · Mireille Keeps Her Week *(V1.8, UJ-15)*

**Protagonist:** Mireille, 31, trains three evenings a week at Martin's gym in Douala, on a monthly plan; the flow is identical for a Pay-per-session guest (FR-225). `[ASSUMPTION]` She joined shortly before the update, so her 30th visit falls after release and is celebrated; a member with 30 or more visits before release would get that badge silently. `[NOTE FOR UX]` UJ-15 compresses the timeline (a 5-week streak, a 30th visit and a Shield all appear within weeks of the update); the steps below keep UJ-15's facts and put them in the order the screens show them, not in strict calendar order. Supporting cast: Martin (Owner), only as the person whose gym name and logo are on the image she shares.

**Entry:** The V1.8 update lands. She opens the app on a Tuesday evening, in French.

1. **MA-09.** Under the status card and the quick actions, "Cette semaine": an empty ring of three segments, "0 / 3", "Nouvelle semaine. 3 visites pour fermer votre cercle." A small line says "Nous démarrons à 3 jours par semaine…". There is no streak yet, so no number is shown.
2. **MA-23.** She taps "Objectif : 3 jours", sees the goal options, and keeps 3. The sheet says a change would start next Monday; she closes it without saving. The default stands.
3. **MA-10, then MA-09.** She scans as she always has; the green overlay is unchanged. Home shows the first segment filled: "Encore 2 visites pour fermer votre cercle." On Thursday the third segment fills, the ring turns green with a check, and the card says "Objectif atteint. Votre série passera à 5 semaines à la fin de la semaine."
4. **MA-09, Monday.** Home settles the week once; the chip now reads "5 semaines d'affilée". Since her fourth consecutive week she has held a Shield: a "1 bouclier" chip sits beside the streak (a one-time notice told her when she earned it).
5. **MA-19, first time.** Out of curiosity she taps the Leaderboard card. Before any list, the notice: "Vous êtes dans le classement de votre salle", with a preview "Mireille K." and the line that until she chooses, others see her as Anonyme. She taps "Apparaître comme Anonyme". The list loads: she is 9th, her row says "Vous", with "2 visites de retard sur le membre au-dessus". Others see "Anonyme" at rank 9.
6. **MA-18.** She taps the ring card and sees November: every evening she came is lit; the 30th visit carries a star.
7. **MA-20.** Some weeks after release, on her 30th visit, the green overlay closes, Home paints, and the celebration comes up: "30 visites" and "Trente visites chez Martin Gym. Vous avez construit quelque chose." She taps "Partager"; the phone's share sheet opens with an image showing the gym's logo and name, the 30 and her month's lit days; she picks her WhatsApp status. Nothing else about her was in the image.
8. **MA-09, Monday of week six.** She had a fever and missed the whole week. Home says: "Votre bouclier a sauvé la semaine du 3 novembre. Votre série reste à 5 semaines." The Shield chip is gone (0 held, so it is not shown). Her streak is not reset, and nothing said she missed anything.
9. **Week seven, Friday.** One visit so far: the ring shows "1 / 3". The status is not at risk yet, because Friday still leaves two days.
10. **Saturday, 18:00.** The one reminder of the day arrives: "Votre semaine est à portée. Venez aujourd'hui : encore 2 visites pour fermer votre cercle." (Saturday and Sunday are the two days left, so the goal is reachable only if she comes today and tomorrow.)
11. **MA-09 and MA-18, Saturday.** Opening Home she sees the hint with the amber glyph, "Venez aujourd'hui pour fermer votre cercle. 4 heures restantes", and today's cell on the calendar has a pulsing amber outline with "4 h". She goes at 19:40; the second segment fills and today's cell lights.
12. **Sunday.** She goes again. The third segment fills, the ring closes, and the card reads "Objectif atteint."

**Climax beat:** Saturday evening. One calm reminder, one amber cell with the hours left, and Mireille walks to the gym because the week she built is worth protecting, not because anything scolded her. The ring closes on Sunday with a streak that survived a fever, a Shield and two evenings.

---

## 8. DESIGN.md additions

### 8.1 Frontmatter components

INSERT AFTER: the line `  sessionChip: { iconChip: iconChip, paidTint: accent, freeTint: success, dormantTint: neutral } # V1.6` in the `components:` block of DESIGN.md frontmatter. Also set `updated:` to the splice date.

```yaml
  goalRing: { diameter: 120, strokeWidth: 12, segmentGapDegrees: 8, maxSegments: 7, numeral: statNumeral, fill: accent, complete: success, track: border } # V1.8
  streakChip: { iconChip: iconChip, glyph: local_fire_department, tint: accent, label: smallBold, compactGlyph: bolt, compactIconSize: 28 } # V1.8, weekly + daily variant
  shieldChip: { iconChip: iconChip, glyph: shield, tint: accent, label: smallBold, hitArea: 44 } # V1.8, not rendered at 0
  calendarDayCell:
    size: 44
    gap: 6
    radius: 8
    numeral: small
    empty: { fill: none, border: border, borderWidth: 1 }
    lit: { fill: accent, glyph: check }
    today: { border: accent, borderWidth: 2 }
    atRisk: { border: warning, borderWidth: 2, glyph: schedule, hoursLabelSize: 10, pulse: atRiskPulse }
    milestone: { glyph: star, glyphSize: 14 }
    shieldSaved: { border: neutral, borderWidth: 1, glyph: shield }
    pending: { borderStyle: dashed }
    future: { numeralOpacity: 0.4 }
    mini: { size: 28, numeral: none } # celebration, share image and "Your month" read-only variant
  leaderboardRow: { minHeight: 56, iconChip: iconChip, glyphNamed: person, glyphAnonymous: visibility_off, rank: smallBold, rankWidth: 32, label: smallBold, visits: small, selfBorder: accent, selfBorderWidth: 2, selfTag: "You", photo: none }
  badgeTile: { radius: 16, border: 1, padding: 16, iconChipSize: 48, earnedTint: accent, earnedGlyph: check, lockedTint: neutral, lockedBorder: border, columns: 2 }
  goalOption: { size: 44, radius: 999, selected: { fill: accent, glyph: check }, unselected: { border: border, borderWidth: 1 }, rowWrapUnderWidth: 360 }
  atRiskPulse: { property: opacity, from: 1, to: 0.45, durationMs: 1600, maxCycles: 3, color: warning, reducedMotion: static }
  celebrationOverlay: { background: background, card: { radius: 24, surface: surface, padding: 24 }, numeral: celebrationNumeral, countUpMs: 700, enterMs: 400, reducedMotionEnterMs: 150, confetti: none, haptic: notificationSuccess }
  celebrationNumeral: { fontFamily: Barlow_800ExtraBold, fontSize: 96, lineHeight: 104 } # NEW TYPE SIZE, see note
  shareImage: { width: 1080, height: 1920, background: background, card: celebrationOverlay, logoMax: 120, calendar: calendarDayCell.mini, watermark: none } # V1.8, built on the device
```

`[NOTE FOR UX]` Tokens that are not in the existing set and could not be avoided: (1) `celebrationNumeral` is a new type size (96/104) above `statNumeral` (32/36); it keeps the same family and weight, as numerals never take a case. Without it the celebration reads as a stat tile, not a moment. (2) `surface` and `border` are the mobile dark theme's existing palette values (`#141F30` and the existing `border`), already referenced by `card.flat` and `loyaltyProgress`; no new colour is introduced. (3) Gym-colour lit cells use `accent`, which is per-gym: a very dark or very light gym colour on the dark `#0A0F17` background has no enforced 3:1 floor on mobile (the web templates do have one). Same exposure as `loyaltyProgress` segments today; the check glyph and the outline already carry the meaning, so no failure of colour independence. Recommend a mobile contrast guard on the per-gym `accent` as a follow-up. `[ASSUMPTION]` glyph names are MaterialIcons (the app's set) and may change at build time.

`[ASSUMPTION]` Contrast (computed from the hex values, to verify in the build): `{colors.warning}` `#D97706` on `#0A0F17` is about 5.0:1 (passes AA for text and UI) and on `#141F30` about 4.3:1 (passes the 3:1 UI floor, below 4.5:1 as text); so the at-risk **words** are set in the body text colour and only the outline and glyph use `warning`. `{colors.success}` `#1E8E3E` on `#0A0F17` is about 4.6:1. `{colors.neutral}` `#6B7280` is used for locked and disabled states only, as it is today.

### 8.2 Colors, one row amendment

AMEND ROW: DESIGN.md "## Colors" table, the `warning` row, "Use" column. Append: ` V1.8: the **at-risk** state of today's calendar cell and the Home hint (outline and glyph only, always with words), because "a visit today keeps this" is a near-term, recoverable reminder. Never `danger`.`

### 8.3 Components prose

INSERT AFTER: the paragraph beginning `**Category label** *(V1.6, dashboard only)*` in "## Components"

**Goal Ring** *(V1.8, `components.goalRing`)* — a 120pt ring of N equal arc segments (N is the member's weekly goal, 1 to 7) with a small gap between segments, 12pt stroke. Filled segments are `accent` (the gym colour on member surfaces); a completed ring is all `success` with a check glyph; empty segments are the `border` colour. The centre is `statNumeral` "visits / goal" with a `small` unit word beneath. Visits beyond the goal never add segments. It sits in a `flat` Card (the "This week" card), never `raised`.

**Streak Chip and Shield Chip** *(V1.8, `components.streakChip`, `components.shieldChip`)* — an Icon Chip with a glyph in `accent`, followed by one `smallBold` line. The weekly streak chip is the larger; the daily chip (only on a run of 3+ days) is compact. Neither chip is ever drawn at a value of 0, and the Shield chip is not drawn when none is held; the substitutes are text lines ("First week done", the comeback card), never a zero.

**Calendar Day Cell** *(V1.8, `components.calendarDayCell`)* — 44pt square, radius 8, 6pt gaps. States: empty (outline), lit (`accent` fill with a check glyph), today (2pt `accent` outline), at risk (2pt `warning` outline, a `schedule` glyph and the hours left in 10pt text), milestone (a star corner glyph on a lit cell), Shield-saved (a `shield` glyph on a `neutral` outline), pending sync (dashed outline), future (dimmed numeral). Every state is distinguished by shape, glyph or text in addition to colour. A 28pt `mini` variant with no numerals is used in the celebration card, the share image and "Your month".

**At-Risk Pulse** *(V1.8, `components.atRiskPulse`)* — the outline of the at-risk cell and the glyph of the Home hint fade between full and 45% opacity over 1.6 s, for at most 3 cycles after the screen gains focus, then stay still. With the system reduce-motion setting on, no animation: a static 2pt outline. The hint's words are always present and are what carries the message.

**Leaderboard Row** *(V1.8, `components.leaderboardRow`)* — a List Item at least 56pt tall inside one `flat` Card: rank in `smallBold` (32pt column, tabular), a 36pt neutral Icon Chip (`person`, or `visibility_off` for Anonymous; **never a photo**), the label in `smallBold`, and the visit count in `small`. The member's own row has a 2pt `accent` border and the word "You". Ranks 1 to 3 are not styled differently (no crown, medal or gold).

**Badge Tile** *(V1.8, `components.badgeTile`)* — a `flat` Card tile with a 48pt Icon Chip, the badge name and one `small` line. Earned: `accent` glyph, a check, and "Earned [date]". Locked: `neutral` glyph, `border` outline, and a progress line such as "12 more visits to go", never a padlock and never "0".

**Goal Option** *(V1.8, `components.goalOption`)* — a 44pt pill showing 1 to 7; selected is `accent` fill with a check glyph, unselected is a 1pt `border` outline. Seven in a row; two rows under 360pt width.

**Celebration Overlay and Share Image** *(V1.8, `components.celebrationOverlay`, `components.shareImage`)* — a full-screen `background` surface holding one `hero`-radius (24) card on `surface`: gym logo and name at the top, the milestone numeral in `celebrationNumeral`, the headline in `title` style, one `default` sentence, and a read-only mini month calendar where it fits. The shared image is this card rendered at 1080 by 1920 px on the same background, with no GymOS wordmark and no member name (see EXPERIENCE.md MA-20, Q4). Motion: a 700 ms numeral count-up and a 400 ms fade and 96% to 100% scale; no confetti, no looping animation; reduce-motion shows the final state with a 150 ms cross-fade. No mascot in V1.8; the card reserves nothing for it (the mascot region has zero height when empty).

**Gym Challenge progress** *(V1.8, Could)* — reuses `loyaltyProgress` in its continuous-bar form (N above 12 segments), 8pt, `accent` fill; reached is `success` with a check glyph. It lives in a `flat` Card.

### 8.4 Do's and Don'ts

APPEND TO SECTION: "## Do's and Don'ts" (rows added to the existing table)

| Do | Don't |
|---|---|
| Pair the at-risk state with the `warning` glyph, the words and the hours left | Use `danger` red for an at-risk day, a missed week or an ended streak. Red means expired or denied; a streak is never a failure |
| Keep a streak chip out of sight when there is nothing to show; use "First week done" or the comeback card | Draw a "0 weeks" or "Streak: 0", ever |
| Say what the member built ("5 weeks in a row") and what is in reach ("2 more visits close your ring") | Say what was lost or missed; use "last chance", countdown wording or exclamation marks |
| Keep the "This week" card `flat` so the status card stays the one `raised` card on Home | Make the ring card `raised` to make it "pop" |
| Use the plain "n / N" numeral and segments for the ring, the comeback card and the challenge | Add confetti or looping animation. The one place for celebration is MA-20, restrained (a count-up and a fade). `[CONFLICT]` with the V1.6 row "Don't add confetti, badges, or celebratory animation to a reward": that rule stays for loyalty rewards, which remain factual; a milestone is not a reward and the owner asked for it |
| Show the same neutral person glyph for every named leaderboard row and a `visibility_off` glyph for Anonymous | Show a photo, an avatar, a phone number or any identifier of another member; give ranks 1 to 3 a crown, medal or gold |
| Show locked badges with progress in words | Show a padlock or a dimmed tile with no explanation |
| Let the share image carry the gym's name and logo and the member's own milestone | Put another member's data, a phone number, a payment figure or a GymOS watermark on the image |

---

## 9. Open questions and assumptions index

`[NOTE FOR UX]` items, in the order they appear above (numbering used in this file):

| # | Question | Where |
|---|---|---|
| Q1 | Home is long with the new cards; collapse the leaderboard and challenge cards into one if Rewards or Upcoming Classes fall below the fold | 2.1 |
| Q2 | Whether the Shield-ready line on the at-risk hint softens the nudge too much | 2.1 |
| Q3 | Show the best streak on the chip permanently, not only in comeback | 2.1 N2 |
| Q4 | Member first name on the share image (default: none, because Anonymous members may share) and any GymOS watermark (default: none) | 2.5, 8.3 |
| Q5 | The leaderboard notice is stored once per account (AD-54); a multi-gym member may need it once per gym | 2.4 |
| Q6 | Minimum board size, a two-member board reveals ranks by elimination | 2.4 |
| Q7 | N-08 and the at-risk hint for an `expired` member (FR-233 does not exclude them; the gate would deny the visit) | 2.1, 6.1 |
| Q8 | FR-219 has no first-goal exception, a mid-week joiner waits until Monday | 2.8 |
| Q9 | Does a Shield-saved week count toward the streak length (AD-53 fold says a week fact can be "saved"; PRD says the streak "survives") | 7 (flow step 8) |
| Q10 | Day-end instant for "hours left" must come from the server's engagement state | 2.3 |
| Q11 | Total ranked members is not returned by the board function; Home cannot say "9th of 43" | 2.1 N3 |
| Q12 | Confetti rule conflict between V1.6 Rewards and V1.8 celebration | 2.5, 8.4 |
| Q13 | New type size `celebrationNumeral` and per-gym accent contrast on dark | 8.1 |
| Q14 | FR terms "visite", "cercle", "bouclier de série", "palmarès" to review in the FR copy pass | 4.2 |
| Q15 | Mascot slot keys exist but empty; confirm the four speaking places | 4.4 |
| Q16 | Leaderboard card position and whether the privacy toggle merits its own Profile card | 2.1, 2.2 |
