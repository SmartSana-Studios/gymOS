# Epics 30 + 31 — combined local QA kit (member engagement)

Epic 30: weekly goal, ring, streak, at-risk hint, attendance calendar, gym leaderboard, milestone celebration.
Epic 31: Streak Shields, comeback, N-08 streak reminder, Badge Shelf, share image.
Story 31.4 moved the whole engagement area off Home: the tab bar reads **Home, Check In, Classes, Streak, Profile** in **every** state (five tabs, the Streak tab is never hidden). There is **no Progress tab in any state**: Progress (body measurements and photos) is a row at the end of Profile -> Training, always shown, and opens as a full-screen page with a Back arrow. Wherever a part below says "Streak tab", it means that fourth tab; Home only keeps one small line ("3-week streak" or "1 of 3 this week") that opens it. With the area off, the Streak tab is still there but shows only its heading and one line, "Your weekly streak is coming soon." (FR "Votre série hebdomadaire arrive bientôt."), and Home has no streak line.
Everything is on the **member app** (phone). There is no dashboard or Super Admin screen in these epics. Local Supabase only, never prod.

## Setup (once per devcontainer boot)

```
node scripts/epic30-31-qa/seed.mjs                 # wipes + recreates "Epic19 QA Gym", epoch ON, 14 leaderboard members, phones A and B as "new" (~15 s)
scripts/epic19-qa/start-mobile.sh                  # Metro + 2 Cloudflare tunnels; prints the exps:// URL for Expo Go (SDK 57)
```

**Sign in on the phone** (every part below uses this): `+237 699000001` (phone **A**, "Amina Njoya") or `+237 670000001` (phone **B**, "Boris Ekani"), OTP **123456**.
Staff logins (only for the QR in the offline step): `owner@epic19qa.test`, password `Epic19Pass!`, dashboard `cd apps/dashboard && pnpm dev`, Settings page shows the gym QR.

Re-running `seed.mjs` deletes the gym, so the phone session goes stale: **sign out and in again**. Signing out also clears the device's dismissed Shield notices, which is how you see a notice a second time.
Names are upper-cased by the local database ("CHLOE N.", "AMINA N."): not a bug in the app.

**Put a phone member in a state** (then pull to refresh on the phone, or reopen the app):

```
node scripts/epic30-31-qa/state.mjs --list         # every persona and what it shows
node scripts/epic30-31-qa/state.mjs <persona> [A|B]   # prints the server's answer (streak, Shields, comeback, badges...) so you can compare with the screen
node scripts/epic30-31-qa/checkin.mjs [A|B]        # a REAL check-in through check_in() (same path as a QR scan); `... out` checks out
node scripts/epic30-31-qa/epoch.mjs off|on         # dark launch switch
node scripts/epic30-31-qa/board.mjs full|two|none  # how many OTHER members are ranked on this month's board
node scripts/epic30-31-qa/job.mjs reminder|settle  # run the N-08 reminder job / the hourly settle job now
node scripts/epic30-31-qa/teardown.mjs             # RUN BEFORE ci-local or any pgTAP run: deletes the QA gym and sets the epoch back to NULL
```

Today's weekday changes what you see (the week's Monday-first days are computed from today): on a Monday some personas have no "earlier this week" days and `state.mjs` says so. Gym-local time is UTC+1.
Expo Go note: `expo-notifications` is stubbed in the QA build, so **no real push** and a real push token cannot be tested here (see part 8). `react-native-view-shot` and `expo-sharing` are native: if the share steps (part 9) will not run in Expo Go, that part needs the GymOS development or store build, which the spec says is needed anyway for the real 1080 x 1920 and WhatsApp check.

---

## 0. Dark launch (the epoch switch)
Sign in as **A**. State: `state.mjs streak3 A`, then `epoch.mjs off`.

| Do | Expect |
|---|---|
| Home, pull to refresh | No streak line, no "This week" card. The tab bar still shows **five tabs** including **Streak** (no Progress tab). Home has no streak line and no "This week" card. Open the Streak tab: heading "Streak" and the one line "Your weekly streak is coming soon.", no ring, no Leaderboard card, no calendar, no Badges row, no Back arrow. |
| Profile | No My visits or Badges rows, no Streak reminder toggle, no leaderboard toggle (the Weekly goal row is always there). The Training card ends with the **Progress** row, shown in every state: tap it, the Progress page opens with a Back arrow, "Log entry" and the entries and photo screens work, Back returns to Profile. |
| `epoch.mjs on`, pull to refresh Home | The bar does not change (the Streak tab was already there). Home now shows the line "3-week streak". Open the Streak tab: the "coming soon" line is replaced by the "This week" card (a streak of 3), the Leaderboard card, the month calendar and a Badges row. Profile -> Training ends with the same **Progress** row as in the dark state (Back returns to Profile). |

## 1. Weekly goal and ring (Epic 30.1, 30.4)
Sign in as **A**. State: `state.mjs new A` (goal 3 = default, nothing visited).

| Do | Expect |
|---|---|
| Streak tab "This week" | Empty ring "days", caption "A fresh week. 3 visits close your ring.", the hint "We started you at 3 days a week. Change it any time; a new goal starts next Monday." No bare "0" streak anywhere. |
| Tap the card | Opens My visits (calendar). Back. The goal button above the card is a separate target (the Weekly goal sheet); after saving, Back lands on the Streak tab with the toast. |
| Profile -> Training -> Weekly goal ("3 days") | Sheet with 1 to 7, current marked. Pick 5: "Starts Monday <date>. This week stays at 3." |
| Save goal | "Goal saved. Starts <date>." The Streak tab now shows "Changes to 5 days on <date>"; the Profile row reads "3 days, then 5 from <date>". Pick 3 again: "This is your current goal." |
| Airplane mode, try to save | "You're offline. Connect to change your goal." |
| `state.mjs halfway A`, refresh | Goal 4, 1 visit: "3 more visits close your ring." |
| `state.mjs ringfull A`, refresh | Full ring: "Goal met. Your streak becomes 1 week when the week ends." |

## 2. At risk (Epic 30.3, 30.4, 31.1)
Sign in as **A**. State: `state.mjs atrisk A` (no visit today, the week can only be closed by visiting today).

| Do | Expect |
|---|---|
| Streak tab | Hint "Visit today to close your ring." and "<n> hours left" (or "<m> min left" in the last hour). Calm: no red, no "last chance", no exclamation mark. |
| My visits | Today's cell shows the at-risk state with the hours left. |
| `state.mjs shieldrisk A`, refresh | Same hint plus a second line "A Shield is ready if you can't make it." and a "1 Shield" chip. |
| `checkin.mjs A`, reopen the app | The hint is gone, today is lit on the calendar, the ring has moved. |

## 3. Calendar (Epic 30.5, 31.1)
Sign in as **A**. State: `state.mjs saved A`.

| Do | Expect |
|---|---|
| Profile -> Training -> My visits | Month grid with the visited days lit, today marked, legend (Visited, Today, Milestone, Saved by a Shield), "<n> visit days in <month>". |
| Previous / next month | Earlier months load (the history goes back before the epoch); a month with none says "No visits in <month>."; you cannot go past the current month. |
| Find the week of last Monday | A week-saved glyph (the Shield saved it), with the legend entry "Saved by a Shield". |
| `state.mjs veteran A` | Milestone marks on the 7th, 30th and 100th visit days (they were silent: no celebration). |
| `state.mjs milestone6 A` | Current month: "No visits yet this month. Your first one lights today." |
| Airplane mode, reopen My visits | "You're offline. Showing your last saved calendar." A month never opened: "This month isn't saved on your phone yet. Connect to see it." |

## 4. Leaderboard and anonymous choice (Epic 30.6)
Sign in as **A**. State: `board.mjs full`, `state.mjs halfway A` (A has 1 visit day this month, so A is ranked below the 14 others). A starts with the first-open notice **unseen**.

| Do | Expect |
|---|---|
| Profile -> "See the leaderboard" (or the Leaderboard card on the Streak tab) | Notice "You're on your gym's leaderboard" with your label, "Until you choose, other members see you as Anonymous.", [Show my name] and [Appear as Anonymous]. |
| Close it without choosing, look at the board | Your row is "Anonymous" with "You". |
| Choose [Show my name] | Your row reads "AMINA N.". The board: top 10, then a gap line "Rows between are not shown", then your row with one neighbour either side and "<n> visits behind the member above". Ties show "Tied" (two members have 15). Two other rows read "Anonymous" (hidden members, still ranked) and one more (has not seen the notice). No photos or phones. |
| This month / Last month tabs | Both load; last month is empty or small. Footnote "Each day you visit counts once. The board resets on the 1st. Just for fun: rank earns no prizes." |
| Profile toggle "Appear as Anonymous on the gym leaderboard" on | Helper "Other members see you as Anonymous from their next refresh. You still keep your rank." |
| **Privacy across devices:** sign out, sign in as **B**, open the board | Amina appears as "Anonymous" (toggle on). Sign back in as A, toggle off, refresh as B: "AMINA N.". |
| `board.mjs two` + `state.mjs new A` + `state.mjs new B` | 2 ranked: no names, "Not enough members yet" / "The leaderboard appears once 3 members have visited this month."; you are unranked: "Visit once this month to join the board." |
| `board.mjs none` + `state.mjs halfway A` | "You're the only member on the board so far." or the not-enough card (under 3 ranked shows no names). Then `board.mjs full` to restore. |
| Airplane mode | "You're offline. Showing the last board saved on your phone." and the choice buttons say "Connect to the internet to choose." |

## 5. Milestone celebration (Epic 30.7)
Sign in as **A**. State per row below. The celebration shows once, on the first open after the visit is counted.

| Do | Expect |
|---|---|
| `state.mjs milestone6 A`, then `checkin.mjs A`, then **kill and reopen the app** | Celebration "7 visits": "Seven visits at EPIC19 QA GYM. The habit is taking shape." Buttons: [Share] (primary), [Keep going], link "See your badges". |
| Tap [Keep going], kill and reopen | It does not show again. Calendar marks today as a milestone day; the "First visit" and "7 visits" badges are earned today. |
| `state.mjs milestone29 A`, `checkin.mjs A`, reopen | "30 visits" celebration (7 was silent history). |
| `state.mjs milestone99 A`, `checkin.mjs A`, reopen | "100 visits". |
| `state.mjs veteran A`, reopen | No celebration at all (everything passed was silent back-fill). |
| **Reached offline:** `state.mjs milestone6 A`, phone in airplane mode, scan the gym QR from the dashboard Settings page | Ring shows "1 visit waiting to sync", the calendar day is dashed pending. Turn the network back on: the visit syncs and the celebration appears after the sync, once. |
| Reduced motion on (phone accessibility setting) | The celebration still shows, without the animation. |

## 6. Streak Shields (Epic 31.1)
Sign in as **A**. State per row below. Chip, explainer and notices are all in the Streak tab's "This week" section.

| State | Expect |
|---|---|
| `streak3` | 3-week streak, **no** Shield chip, a muted "next Shield" line (1 week to go). Never "0 Shields". |
| `streak4` | Chip "1 Shield" (44 pt target) and a "You earned a Shield. It will keep a missed week from ending your streak." notice with a dismiss. Tap the chip: sheet "Streak Shield", [Got it]. |
| `shield2` | Chip "2 Shields" and a muted "max Shields" line instead of next-Shield. |
| `saved` | Notices one at a time, newest first: "Your Shield saved the week of <date>. Your streak is still 5 weeks." then "You earned a Shield..." after you dismiss the first. 0 Shields now, so no chip. The streak still reads 5. |
| Dismiss a notice, kill and reopen | It stays dismissed. Sign out and in: it is back (sign-out clears the device record). |
| Wording | No "freeze", "insurance" or "token" anywhere. |

## 7. Comeback (Epic 31.1)
Sign in as **A**. State per row below. The run ended with no Shield; the best streak (2 weeks) stays on the record.

| State | Expect |
|---|---|
| `broken` | Card "Let's get going again", "Visit 3 times in 10 days to get back on track.", **three empty stamp segments, no "0 / 3"**, "Your best streak: 2 weeks. It stays on your record." No red, no warning. |
| `comeback1` | 1 of 3 filled, "1 of 3 visits". |
| `comeback2` then `checkin.mjs A` and reopen | 2 of 3, then the 3rd visit restores: "You're back." "Your new streak starts the first week you close your ring." shown once; after dismissal the chip reads "Best: 2 weeks" until a new week is met. |
| `comebackdone` | The restored state straight away (same message, once). |
| `comebacklapsed` | "Your 10 days start again with your next visit." Calm, no warning. |
| Airplane mode + a queued scan | Only the dashed pending segment shows; no Shield or comeback figure changes locally. |

## 8. Streak reminder N-08 (Epic 31.2)
Sign in as **A**. State: `state.mjs atrisk A`. Reminder is on by default.

| Do | Expect |
|---|---|
| Profile Notifications card | A "Streak reminder" toggle, **on**. Helper "One reminder at 6 pm, only when a visit today keeps your week or run going." (French: "18 h"). |
| Toggle off, kill and reopen | Stays off. Toggle on again. |
| `job.mjs reminder` (opens the window to the whole day for the run and puts it back) | Prints an N-08 row for AMINA NJOYA "Your week is in reach" / "Come in today: 6 visits left to close your ring." Run it again: no second row (one per day). |
| Notification history on the phone | The N-08 row with a primary-tinted icon. |
| Toggle **off**, then `job.mjs reminder` | No new row for A. |
| `state.mjs ringfull A` (visited today) then `job.mjs reminder` | No row: a member who already visited gets nothing. |
| Check-in is not slowed or blocked by any of this | `checkin.mjs A` returns at once. |
| **Not covered here:** a real push on a device, the 18:00-21:00 window as clock time | Needs a development build registered against this local stack at a real 18:00-21:00 gym-local time. The phone cannot receive a push through Expo Go. |

## 9. Badges and share image (Epic 31.3)
Sign in as **A**. Share steps need a build with the native libraries (see the Expo Go note); the shelf does not.

| Do | Expect |
|---|---|
| `state.mjs streak3 A`. Profile -> Training -> Badges ("2 of 5") | Five tiles in fixed order: First visit, 7 visits, 30 visits, 100 visits, 4 weeks in a row. Earned tiles show a check and "Earned <date>"; locked tiles show progress ("17 more visits to go", "3 of 4 weeks"), never a bare lock and never "0 of N". |
| Tap an earned tile | Sheet with the large chip, name, date and [Share]. A locked tile: same sheet, no Share, a progress line. "Badges are just for you. They don't unlock anything." |
| `state.mjs veteran A`, pull to refresh | "5 of 5". |
| Airplane mode | Same tiles from the device copy. Pull to refresh offline shows an error card or the cached tiles, not a blank. |
| `state.mjs milestone6 A`, `checkin.mjs A`, reopen: celebration, tap [Share] | Button shows a spinner without changing width; the OS share sheet opens (iPad: anchored to the button). Pick WhatsApp status or Files. |
| Check the shared image | PNG, exactly 1080 x 1920, dark #0A0F17 background, gym name and logo, the "7" and headline, a month calendar with only your lit days, caption "7 visits at ... One day at a time." **No** member name, phone, payment figure, GymOS watermark. Repeat from a badge sheet. |
| Cancel the sheet | Nothing is shown. After a share, a second share still works; on Android the temp file `gymos-share-*.png` is gone from app storage. |
| Airplane mode, Share | Still works (a logo that cannot load is simply left out). |
| Tap "See your badges" on the celebration, then Back | Back goes to Home (the celebration is still pushed over Home) and it never shows again. |
| Android: the target app (WhatsApp) | Received the file before the app deleted it (the open risk in deferred-work). iOS: the share sheet is not hidden behind the badge sheet. |

## 10. French, large text, tone
Sign in as **A**. Switch the app language to French (Profile) and repeat quickly: parts 1, 5, 6, 7, 8, 9.

| Do | Expect |
|---|---|
| Every engagement screen in FR | No English left; Shields read "bouclier"; the reminder helper says "18 h". |
| Phone font size at the largest, `state.mjs streak4 A` | Streak tab, Home streak line, calendar, badge tiles and the celebration stay usable (no cut-off, no overlap); the mini calendar on the share image is dropped when there is no room. |
| Across every screen | No exclamation marks, no "last chance", no "streak lost", no guilt wording; shape or glyph accompanies every colour. |

## 11. Load feel (NFR-029, rough)
The tunnels add latency, so this is only a sanity check: the Streak tab (ring, board card and calendar), My visits and the board each fill within about 2 seconds with `board.mjs full` and `state.mjs veteran A`. The server-side baseline at a full gym is `scripts/engagement-load.sh`; the 4G figure on a mid-range Android is the one real device number the owner takes.

## When you are done
```
node scripts/epic30-31-qa/teardown.mjs     # before ci-local / pgTAP: removes the gym, epoch back to NULL
```
Report anything off with the part and step number.
