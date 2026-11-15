# V1.8 reconciliation: PRD V1.8 layer vs. brainstorm-intent.md, v1.8-gym-feedback.md, .memlog.md

Reviewed 2026-11-15. Read-only review; PRD not edited. Scope: Sections 1.4, 3.2 (last 3 rows), 4.6, UJ-15..17, 6.33-6.41, 7.9, 8, OQ-32..35, 10.3, Glossary, 13. FR-044, FR-095, FR-157, FR-159, FR-174, FR-053/104/122 read only to resolve citations.

Authority order used: .memlog.md (later entries supersede) > brainstorm-intent.md > v1.8-gym-feedback.md.

## Verdict

**Faithful on every decided number; not yet clean.** All headline numbers match across sections (table in section 5). No contradiction of an explicit owner decision was found on who-can-do-what, the 7/30/100 milestones, Anonymous, no-anti-cheat, no-instalments, or loyalty separation. The problems are: (a) one decided parameter missing from the inputs but stated as fact (comeback "within 10 days"); (b) the MoSCoW tiers are flattened, so Could/Should items are inside the release gate; (c) two "forgiveness" / Shield semantics that the inputs leave ambiguous and the PRD resolves silently in the harsher direction; (d) a handful of untagged additions; (e) qualitative intent (pride, share-image purpose) that the FR structure does not carry.

Severity: H = fix before stories, M = fix or tag, L = note.

---

## 1. Contradictions and number/threshold problems

### C1 (H) Comeback "within 10 days" is not in any input and is not tagged
- Inputs: intent Should "3-visit comeback goal"; memlog line 28 "3-visit comeback goal to restore badge status". No time window anywhere.
- PRD: FR-223 "a goal of **3 visits within 10 days**", repeated in Glossary. Only "what restored status looks like" carries `[ASSUMPTION]`. Not in the Section 13 assumptions index, not in OQ-33 or OQ-35.
- Effect: a window turns a goal into a deadline (a member who fails it is back to the broken state), which is a behavior change the owner never saw. Also silent on what happens when the 10 days lapse.
- Fix: tag `[ASSUMPTION]`, add to the index and OQ-33, or drop the window.

### C2 (H) Could items sit inside the release gate; Should/Could tiers are not in the FRs
- Inputs/Section 13: Could = daily streak, challenge, "Your month". Should = Shield+comeback, reminder, badge shelf, share.
- PRD: FR-234 and FR-235 are labelled *(Could)*. FR-221 (daily streak) is **not** labelled Could, and 10.3 Step 3 item 1 makes "the daily streak appears only after 3 consecutive visit days" a done-condition. 10.3 item 8 lets only the challenge and summary slip. So the daily streak, and the daily-streak parts of FR-222 (Shield on a missed day), FR-224 and FR-233(a), are effectively Must. Should items (FR-222/223, FR-230, FR-231, FR-233) are also hard gate items 1, 4, 5 with no Should marker.
- Fix: label FR-221 *(Could)* and move it to item 8, or state that the owner promoted it; tag Should in the FRs or say the gate promotes them.

### C3 (M) "A missed week ends the streak" vs. "a missed week is forgiven"
- Intent Must: "A missed week is forgiven, not a hard reset (see Shield and Comeback)". Memlog line 28: "weekly ring forgives (miss a week, streak counts weeks hit)".
- PRD FR-220: "A missed week **ends** the streak unless a Streak Shield saves it." Glossary: "consecutive weeks".
- The inputs are ambiguous (forgiveness may mean "best streak stays visible" or "streak survives one miss"). The PRD picked the harsher reading and did not tag it. Forgiveness is a Must in the intent but, in the PRD, it depends wholly on Should items (Shield, comeback).
- Fix: confirm with the owner which reading is meant; tag as `[ASSUMPTION]` either way. Note the Must tier then has no forgiveness if Shield slips.

### C4 (M) "Shield per 4 weeks hit" vs. "when the streak reaches a multiple of 4"
- Intent/memlog: "1 per 4 weeks hit". FR-222: earned "each time the weekly streak reaches a multiple of 4", Glossary: "one per 4 weeks of streak".
- Differences: after a break the streak restarts, so a member who hits 3, breaks, hits 3 earns nothing under the PRD but would under a cumulative "weeks hit" reading. Also unspecified: does a Shield-saved week count toward the next multiple of 4? Is the shield earned when the week closes or when the goal is met?
- Fix: state the counting rule explicitly and tag it.

### C5 (M) Shield on a missed day competes with the weekly Shield
- Intent: Shield saves "a missed week (or, for regulars, a missed day)". FR-221/222 follow this, with an assumption only for the case where one missed week ends both streaks.
- Gap: a regular on a daily streak of 3+ who takes a normal rest day would auto-burn a Shield on the rest day (FR-222 "when a missed day would end a streak, a held Shield is used automatically"), draining the cap-2 stock that protects the main weekly streak. The PRD never says which streak a Shield prefers outside the "both end" case, or whether rest days inside a week that still meets the goal consume one.
- Fix: rule that a Shield is only spent on a missed day if it would not endanger the weekly streak, or that daily streaks are not Shield-protected; decide with the owner.

### C6 (M) "No check-in rule changed" is false as written
- FR-225 and 10.3 Step 3 item 7 ("a test shows no check-in rule changed") and 1.4 ("no change to how a member checks in").
- But FR-237 changes how a Pay-per-session check-in is accepted and charged (Single use), and FR-248 adds a staff check-in method. Both are owner-decided (F1, F5), so the claim, not the features, is wrong.
- Fix: scope the sentence to the engagement features (6.33-6.36), or the item 7 test will either fail or be trivially weakened.

### C7 (M) At-risk cell definition does not match the reminder
- FR-224: at-risk "whenever a visit today is needed **to keep a streak** — the same two conditions as the reminder (FR-233)". FR-233(b) fires when the weekly goal is still reachable and today is the last day it can be met; it has no "has a streak" condition, so a member with no streak gets the reminder, but the calendar (by its own wording) would not show at-risk. The intent defines at-risk as "the streak would break without a visit today".
- Also "the last day on which it can [be met]" is undefined for goals above 1 (goal 3, one visit done, Saturday: is Saturday the last day?). Both FR-224 and FR-233 inherit the ambiguity. Not stated whether a held Shield suppresses at-risk and the reminder.
- Fix: one precise predicate, shared by both; say what a held Shield does.

### C8 (L) UJ-15 contradicts itself
- Week six: she misses two of three evenings, "so the week is saved" by a Shield. Then "on the following Saturday at 18:00 she gets one reminder, because it is the last day the goal can still be met; she goes, and the ring closes." If she can still close the ring, no Shield was needed; if the Shield saved the week, the week had already closed (FR-220 computes at week close), so the Saturday reminder would belong to the next week. Rewrite the order.

### C9 (L) FR-228 "no role can change a member's count" vs. FR-248
- Staff check-in adds a visit and therefore changes counts and rank. The sentence needs "except by recording a real visit (FR-248)". See also G6 below (no way to undo a mistaken staff check-in).

---

## 2. Decided in the inputs, dropped or weakened in the PRD

### G1 (M) Share image: the calendar variant and the WhatsApp purpose
- Intent Should: "image (member's calendar or milestone plus gym name)". Memlog line 26 coach idea "shareable calendar image for WhatsApp status", line 48 "member's calendar/milestone + gym name".
- FR-231: milestone image only (plus gym logo, which is an addition); the calendar image is gone and the Share button exists only on the celebration screen. The intent also frames celebrate-keep-share as "one achievement moment", but nothing lets the member share later from the badge shelf (FR-230) or the calendar.
- Fix: either record that calendar image is dropped, or add it; decide whether Share is also reachable from the shelf.

### G2 (M) Pride / protect-the-streak feeling is not carried by any FR
- Intent: calendar "designed to make the member proud and want to protect the streak"; at-risk cell "pulses and shows the hours left".
- FR-224 is purely mechanical (lit/empty days, at-risk state). The PRD defers screen placement to UX, which is fine, but the *purpose* (pride, protection) is not stated as a design requirement or tied to any metric, and "pulses" is dropped. Same for FR-232: the intent wants copy slots so a mascot can speak them; the FR does not say who edits them (developer string slots vs an owner-facing editor), which matters for effort.
- Fix: add one sentence of design intent to FR-224 and clarify FR-232 as developer-level text slots.

### G3 (M) History and first-run behavior are undecided
- Everything is "derived from existing attendance" (intent), so at release a member with a long history already has attendance. The PRD does not say whether (a) existing visits count toward the 7/30/100 totals and whether a member with 150 past visits gets a retroactive celebration, a silent badge, or nothing; (b) streaks are computed from history or start at release; (c) a member who joins mid-week is held to a full week; (d) the first goal set mid-week applies at once or from next week (FR-219 says changes apply next week). Not tagged anywhere.

### G4 (L) Leaderboard details the intent left open and the PRD fixes without a tag
- Tie-break by "who reached the count first", "how many visits behind", exactly one neighbour above and below, "members with no visit are not ranked" (intent: "everyone in the gym"), name format "first name and last initial, no photo", "not shown in the dashboard". OQ-32 and the assumption tag cover only default visibility and the name format. No behavior stated for a gym with very few members, or for non-active (expired) members appearing.

### G5 (L) Mascot parking details
- Intent Parked list keeps name proposals (Rep top pick; avoid Momo and Tara) and asset-format guidance (SVG per pose). The PRD points to the brainstorm folder (Section 13) but does not carry the list. Acceptable if intentional; note it.

### G6 (M) No undo for a mistaken staff check-in
- Memlog lines 34 and 36 (coach ideas under Reverse Brainstorming: staff add a missed visit, staff void) were not decisions, and "no anti-cheat" was decided. FR-248 forbids back-dating (an untagged restriction not in F5) and FR-228 forbids hand edits, so a staff check-in on the wrong member permanently counts for streak, rank and the challenge. FR-045 check-out does not remove the visit. Either state it as accepted, or add a staff void with audit (note this would reopen the "no anti-cheat" boundary).

---

## 3. PRD additions the owner never decided and that are NOT tagged `[ASSUMPTION]`

| Where | Addition | Source in inputs |
|-------|----------|------------------|
| FR-223 | 10-day window on the comeback goal | none (see C1) |
| FR-226 | tie-break order, "visits behind" line, one neighbour each side, unranked zero-visit members, dashboard exclusion | intent: "top 10 plus own row and neighbours" only |
| FR-227 | "first name and last initial, no photo" | partly tagged (OQ-32) |
| FR-231 | gym **logo** on the share image; "built on the device"; hand-off to the OS share sheet instead of WhatsApp | intent: "member's calendar or milestone plus gym name" |
| FR-234 | Supervisor may set the challenge (intent: "the owner sets"); target defined as total visit days by all members; progress display "412 / 1,000" | intent: numeric target + free-text reward |
| FR-235 | contents (visit days, best week, change vs prior month), "no push" | intent: "a recap of the member's month" |
| FR-242 | refusing a correction to/from Pay-per-session while an unused paid session is held | tagged (OK) |
| FR-243 | correction earns no loyalty stamp, sends no notification, start date cannot be changed | feedback F3: only "consumed sessions, stamps, attendance never rewritten" |
| FR-240 / 10.3 Step 1 item 4 | annual plan cards **must** state price, duration, "paid once" | feedback F2: "the dashboard **could** make this clearer" |
| FR-244 | slot = weekday + start time; whether the same weekday may appear twice is not stated, but the cap of 14 (tagged) implies two a day | feedback F4a |
| FR-248 | no back-dating or future-dating; search by name **or phone**; audit of rejected attempts (FR-250) | feedback F5: search member, confirm |
| FR-249 | staff screen offers recording the desk payment, then completes the check-in | feedback F5: "consumes or requires a session exactly as a scan does" (close; arguably derived) |
| NFR-028 | determinism "including a later timezone change does not move past days" | not in inputs (sensible; note goal history is also an input to recomputation, which the NFR omits) |
| 3.2 Member habit | "more than half" hide/silence threshold | row is tagged, OK |

Most are reasonable derivations, but 13 says both inputs were "fully decided by the product owner", so each untagged item should be tagged or moved into the Section 13 assumptions index (currently 14 rows, none of the above).

---

## 4. Faithful to the inputs (checked, no action)

- Weekly goal 1-7, default 3, change from next week (FR-219; intent, memlog line 58).
- Ring is the main streak; daily streak only at 3+ consecutive days, automatic, no opt-in (FR-221).
- Shield cap 2, automatic, not buyable, not loyalty (FR-222).
- Leaderboard: one visit/day, monthly reset, top 10 + own row, Anonymous still ranked, server-side enforcement, per-gym tenant isolation (FR-226, FR-228, NFR-027).
- Milestones 7/30/100 count total visit days, marker on that day (FR-229; memlog line 62).
- Reminder: default on, one off-toggle, max 1/day, 18:00 gym-local, two conditions, member-chosen time later (FR-233).
- Challenge: off by default, one per month, numeric target + free-text reward, no automatic grant of money/sessions/stamps, no individual prizes (FR-234).
- No plan gating, no upsell (FR-225); loyalty separate (1.4, FR-222, FR-228, FR-239).
- Won't list: mascot, leagues, champion badge, anti-cheat, owner "streak just broke" list, member-chosen time are all in Section 8. The streak-to-loyalty link is stated in the FRs but has no Section 8 row (L).
- F1: Whole day default, Single use = one visit (check-in to check-out), double scan not charged twice, Owner/Supervisor, audit, applies to new check-ins only, class rule and loyalty rule match (FR-236-FR-239).
- F2: no instalments in V1.8, revisit if asked (FR-240, Section 8).
- F3: Owner/Supervisor/Manager, mandatory reason, audit with old/new, swap before payment as main flow, refuse until refunded or voided, no rewrite of sessions/stamps/attendance (FR-241-FR-243, 13). The memlog line 64 "build both" is correctly superseded by line 65.
- F4b: coach picker inside the Coach Portal (FR-247). The feedback wanted staff to see "workout plans and progress"; FR-095 forbids it for measurements and photos, and the PRD surfaces this as OQ-34 and tags it. Good. Note the feedback phrase "read-only unless they already have rights on that data" is simplified to flat "read-only".
- F4c, F5 roles (Receptionist and above; Coach excluded) are consistent with the role tree (4.1) and 4.6.
- Simplicity is stated three times (1.4, FR-225 lead, 13).

## 5. Numeric consistency table

| Number | Source | PRD occurrences | Result |
|--------|--------|-----------------|--------|
| Goal 1-7, default 3 | intent, memlog | FR-219, OQ-33, Glossary, 13, UJ-15 | consistent |
| Shield every 4 weeks, cap 2 | intent, memlog | FR-222, Glossary, OQ-33, 13, UJ-15 ("earned at four weeks") | consistent (counting rule: C4) |
| Milestones 7/30/100 | intent, memlog | FR-229, FR-230, 10.3, 13 | consistent |
| Reminder 18:00, max 1/day | intent | FR-233, OQ-33, UJ-15 | consistent |
| Comeback 3 visits | intent | FR-223, Glossary | "10 days" added (C1) |
| Daily streak 3 days | intent | FR-221, FR-233(a), 10.3, 13 | consistent |
| Leaderboard top 10 | intent | FR-226, 10.3 | consistent |
| 14 slots | none (PRD) | FR-244, 13 | tagged, consistent |
| 2-second load, 30-second check-in, 50% / half | none (PRD) | NFR-029, 3.2 | tagged rows |
| FR ranges | n/a | FR-219..FR-250, NFR-027..029; 6.41 FR-215..218; Section 13 cites 6.33-6.40 for FR-219-250 | consistent |

## 6. Suggested fixes in priority order

1. C1: tag or remove "10 days".
2. C2: label FR-221 Could and align 10.3 and 13; mark Should in the FRs.
3. C3/C4/C5: owner confirmation of weekly-miss, Shield counting and Shield-on-rest-day rules.
4. C6: scope the "no check-in rule changed" claim to 6.33-6.36.
5. G1/G2/G3: decide on calendar share, add the pride sentence, record history and first-run behavior.
6. Tag the section 3 additions or list them in Section 13's index; fix UJ-15 ordering.
