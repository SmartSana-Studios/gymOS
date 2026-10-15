# PRD Quality Review — GymOS PRD, V1.7 additions (second pass)

Scope: Sections 1.3, 3.1 G-16..G-18 and the four V1.7 metric rows, 4.5, UJ-12..UJ-14, 6.30-6.32 (FR-175..FR-214), NFR-023..NFR-026, Section 8 rows touched, OQ-24..OQ-31, 10.2, glossary additions, Section 12 (incl. assumptions index), addendum H and I. Other sections read for consistency only (4.1, FR-001, FR-072, FR-087..FR-091, FR-126/127, FR-132, FR-141, NFR-001, NFR-013, NFR-021). Prior pass: review-rubric-v17.md. Prior findings are numbered P1..P32 in the order that file lists them (it states 9 low; the body contains 10), mechanical notes M1..M6.

## Prior-finding disposition

| # | Prior finding | Status | Evidence |
|---|---------------|--------|----------|
| P1 (high) | Payment-account replacement by unattributed actor, no Owner signal | Closed | FR-180: "Replacing an existing connection requires the Owner's confirmation ... nothing changes until then"; FR-181 notifications and velocity limit; Section 12 E records the rationale. New wrinkles in N2, N3 |
| P2 (high) | Default-on for existing live gyms | Closed | FR-183: "on for gyms created after V1.7 and off for gyms that exist at release"; 1.3; 10.2 Step 1 item 9 |
| P3 (med) | Restore-on-reenable stated as fact while OQ-30 open | Closed | Still tagged `[ASSUMPTION — ... OQ-30]` in FR-183, but OQ-30 is now a named pre-flight blocker (10.2: "OQ-30 and OQ-31 are answered") |
| P4 (med) | FR-200 optimization techniques, not outcomes | Partially closed | FR-211 now lists verifiable outcomes ("zero errors", "sitemap lists exactly the pages that are indexable"); the validator is still "a stated validator" that is never stated, and the plain-text summary has no stated path |
| P5 (low) | Section 12 G is backlog triage | Closed | Moved to addendum I; Section 12 G is now the assumptions index |
| P6 (med) | G-16 lacks outcome metric | Closed | 3.2 "Gym set-up effort" (median time to first check-in, founder tickets per new gym); baseline still unmeasured, tagged ASSUMPTION |
| P7 (med) | Revocation latency is a restatement of FR-186 | Closed | Folded into "Support-access safety": "a revoked person is refused on their next request (FR-192)" |
| P8 (med) | Directory thesis vs pilot scale and OQ-29 | Closed | FR-212 "At launch, with few gyms, only individual pages are expected to be indexed"; metric marked "conditional on gym count" |
| P9 (med) | Directory metrics not controllable, no AI-search measure | Partially closed | Structured-data validity is now the lead target (controllable). "published pages are indexed within 30 days" still depends on a search engine, no AI-crawler access measure although G-18 names AI-search, and the counter-metric "Thin listings indexed" is still a defect count |
| P10 (low) | Landing pages have no purpose | Closed | FR-196 "call the gym, open WhatsApp, or get directions"; metric counter "visits that end in a call, WhatsApp, or directions tap" (but see N9) |
| P11 (high) | Publish gate holds only at publish time | Closed | FR-199 "The gate is evaluated again on every change: a page that stops meeting it unpublishes itself and the Owner is told why"; UJ-13 exercises it |
| P12 (high) | Takedown and visibility timing unbounded | Closed | FR-207 "within 60 seconds at the origin; CDN copies purged within 5 minutes ... sitemap regenerated within 15 minutes", "same not-found response"; FR-214 points to it |
| P13 (high) | Release gate omits items Section 12 G says gate it | Closed | NFR-023 now carries null-safe checks, payment-insert member/gym check, generated inventory plus CI; 10.2 Step 1 item 8. Residual in N18 |
| P14 (high) | FR-178 does not define delta over Supervisor | Closed | FR-179 is an explicit allow-list with an explicit deny-list and "every denied one has a negative test"; FR-178 ceiling. Residual in N16 |
| P15 (med) | FR-195 "redirects permanently ... for 12 months" | Closed | FR-203 "301, one hop ... for 12 months and is then reserved to the gym"; "rolling 12 months" defined |
| P16 (med) | Who claims a name; name lifecycle | Closed | FR-198 "Only the Owner (or Super Admin) can claim or rename"; FR-203 "stays reserved ... while unpublished, suspended, or renamed". New lifecycle gap in N5 |
| P17 (med) | Geography undefined | Closed | FR-209 ISO country list, controlled city list with alias normalization. Dependency in N6 |
| P18 (med) | NFR-025 under-specified | Closed | NFR-025 "field-measured 75th-percentile ... mid-range Android phone on 4G, for the launch template and for directory pages" |
| P19 (med) | FR-191 field names ambiguous, new fields implied | Closed | FR-197 "New gym fields hold the page content" with a list; FR-206 pins the projection. List omits some gate fields (N12) |
| P20 (low) | "its second factor" ambiguous | Closed | FR-175 "the account's own second factor" |
| P21 (low) | hreflang dependency on OQ-28 | Closed | FR-208 "language alternates are only declared where translated content exists. [ASSUMPTION — OQ-28]" |
| P22 (med) | Suspended gym vs support access | Closed | FR-192 "A gym in suspension (FR-132) is denied to support like every other staff account" |
| P23 (med) | No content policy for public pages | Partially closed | FR-204 adds report form, 5-day answer, appeal, "No page is moderated before publishing"; near-match is defined (FR-202). Still no statement of what is takedown-worthy or what the "reason code" values are |
| P24 (low) | Super Admin second factor | Closed | FR-191. Introduces a new gap (N1) |
| P25 (low) | Section 8 mixes "Moved into V1.7" with exclusions | Open | Rows unchanged in form; cosmetic, accept |
| P26 (high) | No journeys for landing pages and directory | Closed | UJ-13 (visitor and publisher), UJ-14 (Super Admin takedown); UJ-12 rewritten. UJ issues in N4 |
| P27 (med) | "membership" overloaded, "role limits" undefined | Partially closed | FR-188 now enumerates "staff counts, staff-role caps and tier limits, operational notifications ... platform metrics"; "staff membership" still collides with plan/subscription "membership", and attendance/occupancy and member-list exclusion are not listed though the row lives in `members` (addendum H) |
| P28 (med) | Support provisioning and recovery unspecified | Closed | FR-175 (collision refused), FR-176 (single-use invite, 24 h), FR-185, FR-190 (reset) |
| P29 (low) | Persona name reuse (Chidi) | Closed | UJ-12 protagonist is now Idris; Chidi stays Super Admin in UJ-5/10/14 |
| P30 (low) | UJ-12 vs G-16 credentials phrase | Closed | G-16 "without anyone sharing a gym's login credentials"; UJ-12 no longer has Grace reading out credentials |
| P31 (low) | 4.1 diagram not updated | Closed (prose) | 4.1 paragraph: "ranked below Owner and above Manager"; diagram itself unchanged, acceptable |
| P32 (low) | Implementation detail duplicated in FRs | Partially closed | FR-188 still "The single support flag (FR-178) governs all of it"; FR-178 "flag is set in the same statement that creates the membership"; FR-189 "Supabase MFA" |
| M1 | No Assumptions Index | Closed | Section 12 G table; roundtrip checked below |
| M2 | OQ-27 is a pre-flight, not a question | Closed | OQ-27 resolved; item moved to 10.2 pre-flight |
| M3 | Addendum drift | Partially closed | Addendum F, B (`apps/landing`), frontmatter fixed; addendum H header still "FR-175–FR-188" and cites FR-183/FR-179 for the flag (N13) |
| M4 | Section 12 letters C/D/E | Closed | Section 12 now states "C ... D ... E" with FR ranges and delivery order |
| M5 | Cross-reference slips (1.3, 4.5) | Closed | 1.3 "FR-189–FR-191"; 4.5 cells resolve |
| M6 | FR-090 status | Closed | FR-192 "Amendment to FR-090 ... closes FR-090 for every role" |

Totals: 32 findings + 6 mechanical. Closed 26 + 5, partially closed 5 + 1, open 1 + 0, no longer applicable 0.

## Overall verdict

The revision closed every high finding and nearly every medium: the money-moving risk now has an Owner confirmation, the existing-gym default is decided, the publish gate is an invariant, takedown has numbers, the claim and name rules are specific, and the public half has journeys. The PRD is usable for story creation. What remains is one new high (Super Admin AAL2 has no bootstrap or lockout path although the platform appears to have a single Super Admin) and a cluster of consistency slips the revision introduced: G-16 and 1.3 say the Owner confirms "any change" of the payment account while FR-180 exempts first connection, UJ-14 describes a page the reserved-name rule forbids, and notification timing differs between FR-180, FR-181 and the gate.

Dimension judgments: Decision-readiness strong; Substance over theater strong; Strategic coherence adequate; Done-ness clarity adequate (was thin); Scope honesty strong; Downstream usability adequate; Shape fit strong.

## Decision-readiness — strong

Trade-offs are now argued where they matter: Section 12 E records why replacement needs the Owner ("one support account could otherwise redirect every assigned gym's member payments"), why TOTP over OTP, why a hidden account was rejected, and why existing gyms start off. Open questions are real and each names a blocker (OQ-28..OQ-31). The remaining decisions a story writer would otherwise make by guess are in the findings below.

### Findings
- **high** Super Admin AAL2 has no bootstrap, enrollment or lockout rule (FR-191, FR-190, FR-141, §8 dual-control row) — FR-191 requires AAL2 for "every Super Admin session"; FR-190 and FR-177 need a Super Admin at AAL2 to reset anyone's factor; §8 defers dual control "when the platform team has a second Super Admin", which says today there is one. Existing Super Admins were created by CLI or in-app (FR-141) and have no enrolled factor. Nothing states how they enroll, what a session at AAL1 can still do, or what happens when the only Super Admin loses their device (no one can reset them). *Fix:* an FR for Super Admin enrollment and recovery (first-sign-in enrollment, a documented break-glass path through the CLI bootstrap with its own audit, no lockout of the platform), and a 10.2 Step 1 item for it.
- **medium** G-16 and 1.3 say "confirms any change of the gym's payment account"; FR-180 exempts first connection (G-16, §1.3 row 1, §4.5 Owner row, FR-180, UJ-12, Section 12 E) — FR-180: connecting where none exists needs no confirmation; UJ-12 has Idris "do it himself". 4.5 says "any replacement", the goal and 1.3 say "any change". *Fix:* say "any replacement" in G-16 and 1.3, or confirm connection too and change UJ-12.
- **medium** Notification timing is inconsistent and one threshold has no value (FR-180, FR-181, 10.2 Step 1 item 4, Section 12 G) — FR-180 "Every change to a gym's payment connection notifies the Owner"; FR-181 "in a summary at least daily on days support acted"; gate item 4 just "notifies". FR-181 and the velocity limit use "refund-over-threshold" with no threshold; Section 12 G calls it "large-refund". *Fix:* state that payment-connection change is notified immediately and the rest daily (or all immediately), and give the refund threshold a value or a gym-configurable setting.
- **medium** Disclosure on request conflicts with absolute statements (FR-187 vs FR-182, FR-185, FR-186, §4.5 Owner, UJ-12) — "never an individual", "The Owner cannot see or act on individuals", "no gym-side read returns an individual identity", versus FR-187 "The Owner can ask for disclosure of the individual behind any audit row". The channel (in-app, ticket, email) and what is disclosed are unspecified, and FR-186's "a test per surface" cannot assert absence if disclosure is a gym-side read. *Fix:* state that the answer is delivered out of band by Super Admin and is not a gym-side read; qualify the absolutes accordingly.
- **low** OQ-26 row still says "support is on by default and a gym may opt out" (OQ-26) — contradicted for existing gyms by FR-183. *Fix:* append "(existing gyms off until enabled, FR-183)".

## Substance over theater — strong

FRs carry real rules (name grammar, reserved list, projection field list, allow-list with deny-list, rolling rename limits). NFR-024..026 carry bounds and tests, not adjectives. Section 12 is now decisions plus index, not triage. Nothing reads as furniture. One pass condition remains soft.

### Findings
- **low** FR-211's "stated validator" is not stated (FR-211, §3.2 Directory) — name it (for example Google Rich Results Test or schema.org validator) or say it is chosen at story time.

## Strategic coherence — adequate

The arc (help from inside, then public presence, then discovery) is stated, ordered and argued; G-16..G-18 map to metrics and each has a counter-metric. Weak points are measurement realism.

### Findings
- **medium** Directory counter-metric needs click tracking while page analytics is out of scope (§3.2 "Directory discoverability", §8 "page analytics", FR-196) — "share of visits that end in a call, WhatsApp, or directions tap (informational)" cannot be measured with no analytics on the public page; the privacy stance of public pages (no tracking stated, FR-196) is unaddressed. *Fix:* drop it, or specify a minimal first-party tap counter and add it to the projection/NFR-024 reasoning.
- **medium** "release" is the anchor for V1.7 metrics but there are three releases (§3.2 "Landing-page adoption", "Gym set-up effort", 10.2) — "within 60 days of release" has no step reference; Step 1 ships first, pages later. *Fix:* anchor each metric to its step ("60 days after Step 2").
- **low** "Support actions later reversed by the Owner" is the counter-metric but nothing records a reversal (§3.2 "Gym set-up effort") — define the signal (for example an Owner edit of a support-created or support-edited row within N days) or mark informational.
- **low** Set-up effort target compares against "the pilot gyms' baseline for gyms that use support" — there is no gym-without-support comparison group and the baseline is unmeasured (already tagged ASSUMPTION; note the confound).

## Done-ness clarity — adequate

Most FRs have a testable consequence now: FR-179 (negative test per denied capability), FR-184, FR-186 ("Each surface above has a test"), FR-199, FR-207, NFR-023 (CI check), NFR-024 (snapshot test), NFR-025. Residual softness is mostly lists with "…" and a few undefined terms.

### Findings
- **medium** FR-202 relies on undefined lists (FR-202) — "names containing a credential or brand word", "a brand word", "Generic and place words (`gym`, `fitness`, `yoga`, `cameroon`, …)" have no list owner or location, and the trailing "…" cannot be tested. *Fix:* say the lists live in a Super Admin-maintained table with the initial contents named, and test against that table.
- **medium** Name lifecycle has no release path (FR-203, FR-202) — "one name per gym" yet old names are "reserved to the gym, not released" after the 12-month redirect, so a gym renaming twice a year accumulates names forever; nothing says what happens to a name when a gym is deactivated or deleted; namespace squatting is possible at near-zero cost (Owner claims, renames, holds both). *Fix:* a release rule (old name released after the redirect window unless Super Admin keeps it; all names released on gym deletion) or an explicit decision that names are never released, with the cap on total reserved names.
- **medium** Publishing can be blocked by a Super Admin action with no SLA or visible state (FR-202, FR-209, FR-199) — near-match and generic names are "held for Super Admin approval before first publish"; a city not in the controlled list "is added by Super Admin", and city is a gate field. The Owner's state, notification and expected turnaround are not specified. *Fix:* a held state with Owner notification and a stated response time (assumption-tagged), and an in-app "request a city".
- **medium** Step 1 allow-list references capabilities that do not exist until Step 2 (FR-179, FR-198, 10.2 Step 1 item 6) — FR-179 lists "landing-page content" and FR-198 lets support publish, but gate item 6 says "The allow-list is enumerated and every denied capability has a negative test" at Step 1, and the landing tables and RPCs arrive later. *Fix:* say the allow-list is extended and re-tested when Step 2 ships, and add that to the Step 2 gate.
- **low** FR-199 gate lacks address although FR-196 promises "get directions" (FR-196, FR-199, FR-197) — map position is optional and address is not in the gate. FR-197's field list also omits page name, country and city, which the gate and projection require. *Fix:* add address to the gate (or require map position) and list the missing fields in FR-197.
- **low** FR-179 is silent on editing or deactivating non-Owner, non-Supervisor staff (FR-179, FR-089) — "create staff within the ceiling" is listed; edit and deactivate are not, and "or reach any capability not on this list" reads as denied; FR-181/184 treat support-created staff as touched later. *Fix:* list staff edit and deactivate explicitly, within the ceiling.
- **low** Small untestables (FR-185, FR-189, NFR-026) — "recertified by Super Admin each quarter" (recertify what, evidence?), "repeated wrong codes lock the account" (count and unlock path), "strictest cookie prefix supported" (name `__Host-`), and no reactivation path after the 30-day auto-disable. *Fix:* one clause each.

## Scope honesty — strong

Section 8 marks moved items and names non-goals (custom domains, analytics, booking on the page, dual control, moderation tooling). Open-items density is reasonable: four open or conditional OQs (OQ-28..OQ-31), each blocking a named stage, and every assumption is indexed. Suspension and Super Admin second factor are now stated.

### Findings
- **low** 10.2 pre-flight lists only Step 1 blockers (10.2, §9 OQ-28, OQ-29) — OQ-28 blocks landing stories and OQ-29 directory stories per Section 9 but neither appears in the Step 2 or Step 3 gate text. *Fix:* add a one-line pre-flight to Steps 2 and 3.
- **low** Addendum I marks items "gate" that are not in 10.2 (addendum I first list) — `apps/landing` i18n parity and deploy-drift alerting are labeled as release-gating but have no FR or gate item (the i18n item belongs to Step 2 at the earliest). *Fix:* either add to 10.2 Step 2, or relabel as "fold in".
- **low** Step 1 gate omits FR-190 (second-factor reset) and FR-193..FR-195 (no gate item or test statement) — FR-190 is security-critical and is the item most likely to be skipped. *Fix:* add one gate item naming reset, escalation non-bypass, and the single-active-gym check.
- **low** 10.1 closes with "Section 12 is explicitly not part of this gate" (10.1) — now ambiguous since Section 12 is the V1.7 decisions and index. *Fix:* "V1.7 (Section 10.2) is not part of this gate."

## Downstream usability — adequate

IDs run FR-175..FR-214 contiguously after FR-174 and NFR-023..NFR-026 after NFR-022; every V1.7 cross-reference spot-checked resolves (1.3, 4.5, 10.2, Section 8, glossary, Section 12, UJs, metrics). The assumptions index round-trips: all inline tags (FR-181, FR-183, FR-184, FR-185 x2, FR-187, FR-189 x2, FR-204, FR-207, FR-208, FR-212, NFR-025, UJ-12..14, three 3.2 rows) appear in Section 12 G, and every index row has an inline tag, except that FR-177 is listed alongside FR-183 without its own inline tag (it carries the behavior; harmless). UJs each have a named protagonist.

### Findings
- **medium** UJ-14 contradicts FR-202 (UJ-14, FR-202) — the reported page is named `gymos-pay`, but "any name starting with `gymos`" and `pay` are reserved and cannot be claimed, and the narrative ("blocked for review by the near-match rule, but a gym had published it under a different spelling the rule did not catch") reads as garbled. *Fix:* use a name the rules would actually admit (for example `gym0s-pay` or `tara-momo-pay`), and make the story say which rule failed and what changes.
- **low** UJ-13 carries two protagonists in one narrative and an unnamed Supervisor (UJ-13) — Aminata is the visitor, Grace the publisher; the Supervisor edit is a third party. Acceptable for a short journey; split or name them if UX will source from it.
- **low** Addendum H stale references (addendum H heading and first bullet) — "FR-175–FR-188" while support is FR-175–FR-195; "(FR-183, FR-179)" cited for the single flag, which is FR-178/FR-188; `allow_gymos_support ... default true` with no mention that existing gyms backfill to false (FR-183). *Fix:* correct the range and cites, add the backfill.
- **low** Glossary gaps (§11) — no entry for "Allow GymOS Support", "page name", "takedown", "support assignment"; "staff membership" (FR-178) still overlaps "membership" plans (P27). *Fix:* add four rows; prefer "support assignment" for the binding.
- **low** FR-189 cites NFR-021 (FR-189) — NFR-021 is paid-session atomicity; the intent (database enforcement on every entry path) is analogous, but the cite reads as a mistake. *Fix:* cite NFR-023 only, or say "as NFR-021 does".

## Shape fit — strong

Brownfield, multi-stakeholder B2B plus a public consumer surface; UJs, FR areas and per-step gates fit, and the three-step gate is the right release shape. The PRD embeds some mechanism (see P32), consistent with the V1.6 convention and low impact. No over- or under-formalization: the public half now has journeys, and the support half is capability-spec-like with the Owner's view specified.

## Mechanical notes

- **ID continuity** — FR-174 (V1.6) then FR-175; FR-175..FR-214 and NFR-023..NFR-026 unique and contiguous; header note says "V1.7 begins at FR-175 / NFR-023" (good) but gives no V1.7 end, which could be added.
- **Stale numbers** — none found in the PRD from the old numbering (FR-175..FR-203 / NFR-023..025); the only stale numbers are in addendum H (above) and OQ-26 wording.
- **Glossary drift** — "support person" (4.5, FR-175, glossary) vs "support account" (FR-175, FR-185) vs "support session" (FR-184, FR-189) are used consistently by object; "GymOS Support" quoted consistently; "Allow GymOS Support" quoted consistently.
- **Section 8** — "Moved into V1.7" rows still sit among exclusions (P25).
- **Assumptions index** — round-trips (see Downstream usability). Items that read as assumptions but are untagged: FR-176 24-hour invite expiry, FR-203 "twice in any rolling 12 months", FR-199 "at least 100 characters"; these are stated as decisions, so acceptable.
