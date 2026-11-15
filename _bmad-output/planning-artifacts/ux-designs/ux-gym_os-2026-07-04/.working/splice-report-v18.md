# V1.8 UX splice report (2026-11-15)

Targets: `EXPERIENCE.md` and `DESIGN.md` in `ux-gym_os-2026-07-04/`. Safety copies (taken before any edit, byte-identical to the originals): `.working/pre-v18-splice/EXPERIENCE.md`, `.working/pre-v18-splice/DESIGN.md`. Method: one script (`uv run python -I`), every anchor resolved to exactly one line before any write, edits applied bottom-up so no index shifted. No unrelated line was rewritten (diff of old lines: 25 in EXPERIENCE.md and 3 in DESIGN.md changed, all listed under "Conflicts amended" or "Frontmatter" below).

## Line counts

| File | Before | After |
|---|---|---|
| EXPERIENCE.md | 4,701 (4,702 with the trailing newline) | 6,534 split-lines (about 6,533 text lines) |
| DESIGN.md | 250 | 323 |

## Blocks applied

About 53 spliced blocks, plus 25 in-place amendments.

Member draft (27 blocks): Surface Index rows MA-18..MA-23; AMEND ROW MA-09; AMEND ROW MA-12; Member IA Home sub-tree; Member IA Profile sub-tree; tab-bar bullets; MA-09 V1.8 (N1 to N5); MA-12 V1.8; screens MA-18, MA-19, MA-20, MA-21, MA-22, MA-23 (one splice); component-library paragraphs; Voice and Tone rows; V1.8 vocabulary; string catalog (EN/FR); text-slot rules and mascot slot; Empty, Loading and Error rows; V1.8 state patterns; haptic rows; interaction paragraph; Accessibility Floor rows; Responsive and offline notes; Flow 16; DESIGN components YAML; DESIGN `warning` row; DESIGN components prose; DESIGN Do's and Don'ts rows.

Admin draft (26 blocks): 1a namespace note; 1b Surface Index AD-30..AD-32 and amendments row; 1c Min Role cell edits (AD-11, AD-14, AD-15, AD-19, AD-21); 2 Admin IA; 3 sidebar and role tables; 4 tone rows, vocabulary, catalog (Groups A to I); 5 screens AD-30, AD-31, AD-32; 6.1 AD-04; 6.2 AD-11; 6.3 AD-12; 6.4 AD-13; 6.5 AD-14 and AD-15; 6.6 AD-18; 6.7 AD-19; 6.8 AD-20 and AD-21; 6.9 AD-22; 6.10 AD-23; 7 Form Validation; 8a empty rows; 8b V1.8 state patterns; 9a interaction bullets; 9b Accessibility rows; 9c Responsive; 10 Flows 17 and 18; 11 DESIGN (no new tokens plus reuse map).

Not spliced (no anchor, hand-off material): member draft section 0 (decisions at a glance) and section 9 (open-question index); admin splice map, Block 12 (open-question index) and coverage table. Admin "optional documentation lines" in Block 11 (one Do's row, one sentence under the `info` token) were skipped as the draft says they are not needed.

## Anchors not found or ambiguous

None. All anchors matched exactly once. Judgment calls where the draft gave no explicit or an inexact anchor:

- Screens MA-18..MA-23 carry no INSERT line in the draft. Placed as one run before `### In-app Renewal (/renew)` (after MA-17), mirroring the Surface Index order.
- AD-30..AD-32: inserted after the last bullet of "V1.7 - Amendments to existing Admin screens", behind a `---`, as the draft says.
- 6.5 is one paragraph "append to AD-14 and AD-15": the full paragraph sits at the end of AD-15; AD-14 gets a one-line pointer to it.
- Draft meta-headings ("### 4.1", "### 4.3 String catalog", "### V1.8 string catalog", "### 2.x", "### 8.x") were not inserted as headings (no new duplicate headings). The catalogs are introduced by bold labels; the two V1.8 state-pattern drafts share one `### V1.8 - New State Patterns` heading (member part first, then admin part).
- The two vocabulary tables are one table (member header plus rows, admin rows appended). Both drafts define "visit"; the admin row's Concept cell was relabelled "What a single visit is (session and attendance rules)" so the table does not give two definitions for one label. FR-copy pass should reconcile.
- Member IA: the existing last children `└── → upcoming booked classes summary` and `└── → Notification Preferences section` were redrawn as `├──` because new children follow them.
- Flow numbers: no existing flow used 16, 17 or 18 (existing run to 15). Flow 16 = UJ-15, Flow 17 = UJ-16, Flow 18 = UJ-17; both drafts' "renumber at splice time" notes were dropped because the numbers are now settled.
- DESIGN.md Typography table: added one row for `celebrationNumeral` (96/104), because the owner accepted the token and the draft only defined it in the YAML. Not in the draft text; derived from its YAML.
- Frontmatter `sources:` — the PRD (`prds/prd-gym_os-2026-06-20/prd.md`, v1.8 is a layer of that file) and the architecture spine were already listed in both files, so they were not duplicated. Added the two brainstorm documents. `updated: 2026-11-15`, `status: final` kept in both.

## Conflicts amended in place (each carries "(amended V1.8)")

EXPERIENCE.md: Admin IA `[Coach role only]` branch; sidebar matrix row "Coach Portal" (now Manager, Supervisor, Owner and Coach); sentence "Coach role: the sidebar renders only the Coach Portal link"; "My Classes is not the admin Classes page ... cannot create or edit a class"; V1.7 "support person sees the sidebar a Supervisor sees" (Coach Portal exception); AD-13 hint-line conflict (V1.7 line gains Session validity and Gym challenge); AD-14 Purpose; AD-15 Progress-tab line; AD-19 Purpose, layout Days/Time lines, Schedule rule, and the two Form Validation rows (Days, Time); AD-21 Purpose, "No write controls" line and Empty state line; SA-21 "Which dashboard actions for support"; Surface Index Min Role cells for AD-11, AD-14, AD-15, AD-19, AD-21 plus the MA-09 and MA-12 rows. DESIGN.md: V1.6 Do's row "Add confetti, badges, or celebratory animation to a reward" (marker added; the new row says it amends it); `warning` colour row. The draft's own `[CONFLICT]` paragraphs stay in the inserted text next to the amended lines (15 `[CONFLICT]` tags in EXPERIENCE.md, up from 9). Draft tag on AD-04 "Coach Notes tab: Manager/Owner see all coaches' notes" was NOT amended: picker mode is AD-32 and AD-04 itself is unchanged.

## Owner/PM decisions applied (all marked "owner decision 2026-11-15" in the text)

- N-08 not sent to expired members; at-risk hint hidden for them (MA-09 text, states tables, 6.1 table, catalog note).
- Leaderboard notice stored per member row, so per gym (MA-19).
- No goal set: default 3 now; first goal applies next Monday (MA-23 bullet replaces the NOTE).
- Shield-saved week keeps the streak, adds nothing to the count (6.1 and MA-09 rows).
- `day_ends_at` from the engagement state (MA-18); `ranked_total` from the board function: `engage.home.rank` is now "Rank {n} of {total} this month" ("Rank 9 of 43 this month" on Home).
- Fewer than 3 ranked: new "Not enough members yet" state (keys `engage.leaderboard.notEnough` and `.notEnough.body`, `{min}` = 3), no names, no own row; replaces the two "nobody ranked" and "only one ranked" board rows (their copy stays as the supporting line); the Home card shows the same line instead of a rank (`[ASSUMPTION]`); Empty-state rows added; "gym member count small" NOTE removed.
- Celebration restrained (count-up and fade only); `celebrationNumeral` accepted (YAML, Typography row, DESIGN note); mascot keys exist and stay empty (NOTE tag removed).
- Share image: no member name, no GymOS watermark.
- Correct plan: no preview of the new expiry and no "already expired" pre-warning (layout, components, catalog rows `preview`, `previewPps`, `warnExpired`, `warnGrace` removed, a11y row, Flow 18 step 2 and 3); the rule text stays in the modal; success toast shows new expiry and status (`members.correctPlan.success` now ends "· [status]"), and a new key `members.correctPlan.successExpired` says so when the new status is expired.
- GymOS Support V1.8 actions raise the existing step-up prompt (SA-21, FR-189): stated in AD-31, AD-30, AD-11, AD-13 and the SA-21 line.
- Picker shows the chosen coach's own session notes only (NOTE removed; 6.5 cross-reference fixed).
- Renewal from an Expired check-in result completes the check-in automatically (AD-30 rule; ASSUMPTION and NOTE replaced).
- Booked members not notified on class cancel in V1.8; kept as `[NOTE FOR UX]` for the story (also flags that MA-16 must show a cancelled class, not drafted).

## Verification

- New screen IDs as headings: MA-18, MA-19, MA-20, MA-21, MA-22, MA-23, AD-30, AD-31, AD-32 each appear exactly once as a heading, and each exactly once as a Surface Index row.
- Duplicate headings introduced: none (headings that were already repeated in the original, "Member App", "Admin Dashboard", "Super Admin Dashboard", are unchanged in kind).
- Flows 1..15 untouched; 16, 17, 18 added once each.
- Tables: every table row in both files has the column count of its header (0 inconsistent rows before and after).
- YAML: both frontmatters parse (PyYAML); DESIGN `components` now has 16 keys (goalRing, streakChip, shieldChip, calendarDayCell, leaderboardRow, badgeTile, goalOption, atRiskPulse, celebrationOverlay, celebrationNumeral, shareImage added).
- Token references: 14 distinct `{namespace.key}` references in the new text, 0 unresolved; every backticked `components.X` in new DESIGN prose resolves. Pre-existing caveat, not introduced here: the YAML (existing `loyaltyProgress`, and the new components) uses the bare names `border`, `surface` and `background` as values, and the old Elevation table already cites `{colors.border}`, but `colors:` defines no `border` or `surface` key. The new text avoids brace references to them; flag for a later DESIGN.md clean-up.
- Tag totals across both spines (EXPERIENCE.md + DESIGN.md): `[ASSUMPTION` 243 (was 141), `[NOTE FOR UX]` 45 (was 25), `[CONFLICT]` 15 (was 9).
- Leftover draft cross-references ("Q4", "section 9", "Block n", "see 4.4") were removed or rewritten; grep finds none.

## Not done / for the caller

- sprint-status.yaml and the `.memlog.md` files were not touched.
- The open-question indexes of both drafts were not spliced, so the remaining `[NOTE FOR UX]` items live only inline.
