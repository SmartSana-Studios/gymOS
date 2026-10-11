# PRD Quality Review — GymOS PRD, V1.6 additions

Scope: Section 1.2, G-13..G-15, three V1.6 rows in 3.2, 4.4, UJ-11, 6.27-6.29 (FR-156..FR-173), NFR-021/022, Section 8 new rows, OQ-16 (resolved) and OQ-19..OQ-24, 10.1, glossary additions, Section 12, addendum section G. Diffed against `prd.v1.5.bak`; `prd.md` was not edited.

## Overall verdict

V1.6 is a well-argued, tightly scoped increment. It has a real thesis (stop the guest revenue leak, then give guests a reason to return), a rollout flag that leaves existing gyms untouched, honest "Amendment to FR-XXX" discipline, and a V1.7 backlog fenced off with no FR IDs. What is at risk: the central guarantee ("every guest visit is a recorded, paid event", "100% by construction") is contradicted by the offline path, which is parked as a UX-copy question although it is a policy decision. G-14's "a program the gym can afford" has no guardrail in the spec, and a handful of small internal inconsistencies (UJ-11 vs FR-165, "selected period", free-vs-paid consumption order) would surface as story-writing questions. Cross-references all resolve; there are no duplicate IDs.

Dimension judgments: Decision-readiness adequate; Substance over theater strong; Strategic coherence adequate; Done-ness clarity adequate; Scope honesty strong; Downstream usability adequate; Shape fit strong.

## Decision-readiness — adequate

Decisions are stated as decisions (default-off for existing gyms, default-on for new; no manual stamp edits; discount rewards excluded because they would touch payment amounts). OQ-16 is closed cleanly with the PM recommendation recorded. OQ-19..OQ-24 are genuinely open and have owners and due points. Trade-offs are named in places (FR-170 forbids manual adjustment and says what it gives up, a correction path, in OQ-22).

Two things are dodged. The offline path is the one place where the headline guarantee leaks, and it is routed to UX (OQ-20, owner "UX (Sally)") even though "what happens at the door while the guest is offline and unpaid" is a business rule. And the loyalty ranges (N 2-50, K 2-24, R 1-60) permit offers that cost a gym a third to a half of its revenue per guest or subscriber, with nothing in the spec acknowledging that trade-off.

### Findings
- **high** Offline check-in is a physical bypass of the paid-session guarantee, and the decision is mis-assigned (FR-161, OQ-20, §3.2 row 1, NFR-021) — FR-161 lets an offline unpaid guest scan, see "Check-in saved", and walk in; the leak is only flagged later. §3.2 claims "100% of guest check-ins ... backed by a paid session by construction (FR-159)" and NFR-021 says the guarantee "cannot be bypassed", which is true only of the *record*, not of *entry*. OQ-20 calls it a "UX decision" and owns it to UX. FR-161 also leaves the post-sync flow undefined: when the receptionist records payment after an offline flag, does the earlier check-in then become attendance, and what happens to occupancy/capacity in the meantime. *Fix:* make the door policy a PM decision (accept the risk explicitly, or require connectivity/online-verify for guests at charging gyms, or a staff-confirm step), restate the §3.2 claim as "every *recorded attendance* is backed...", and add one FR sentence defining what happens to a flagged offline check-in once paid.
- **high** G-14 promises a program "the gym controls and can afford" but nothing makes it affordable (G-14, FR-164, §3.2 row 3) — N=2 gives a free visit per two paid (33% off); K=2, R=60 gives 60 free days per two monthly renewals (about 50% off), and these are Owner-settable with no warning, projected-cost display, or tighter bounds. The only mitigation is an after-the-fact counter-metric. *Fix:* either narrow the ranges (e.g. R <= duration of the plan, N >= 3), or add a requirement that the setting shows an effective-discount line ("equals about X% off") before save; otherwise drop "can afford" from G-14.
- **low** Rationale missing for the 7-day unused-session lapse and the 90/60-day windows (FR-159, FR-168) — values are stated but not argued, and 7 days is not listed with the "platform defaults stored as data" in FR-168. *Fix:* one clause of rationale; add 7 days to FR-168's default list or say it is fixed.

## Substance over theater — strong

No persona, innovation, or NFR theater. UJ-11 has a named protagonist and exercises the block, alert, free-session, and owner-view paths. NFR-021/022 carry product-specific, testable claims (atomic consumption, replayed sync, redelivered webhook), not boilerplate. Section 12 is correctly labelled as non-committal and carries no FR IDs.

### Findings
- **low** FR-158 and FR-168 embed implementation detail in requirements (FR-158 `session` purpose value; FR-168 "stored as data so exposing them later is a settings change"; NFR-021 "enforced in the database"). For a brownfield PRD that feeds architecture this is defensible, and addendum G already carries the same material. *Fix:* leave the intent ("reportable separately", "not gym-configurable now"), move column/enum names to the addendum.

## Strategic coherence — adequate

The arc is coherent: close the leak (G-13), reward return and on-time renewal (G-14), then a minimal category field as the V1.7 prerequisite (G-15). The sequencing (charging first, loyalty on top of recorded sessions) follows from the thesis rather than from convenience. Counter-metrics are named for every V1.6 SM row, which is above the norm.

### Findings
- **medium** G-15 has no success metric (§3.1 G-15, §3.2) — three SM rows were added for G-13 (one) and G-14 (two); G-15 ("open the product to studios") has none, and FR-172 makes the category purely descriptive, so nothing in V1.6 can show the goal being met. *Fix:* add a simple SM (share of newly created gyms with a non-default category; studios onboarded) or reword G-15 as a V1.7 enabler, not a V1.6 outcome.
- **medium** Adoption SM is ambiguous given default-on for new gyms (§3.2 row 1 vs FR-157) — "≥60% of gyms with at least one Pay-per-session member turn ... on within 30 days of release" only makes sense for existing gyms, as new gyms start with it on. Also "100% ... by construction" is a design invariant, not a metric. *Fix:* scope the metric to gyms existing at release and measure retained-on rate for new gyms separately; move the 100% claim to FR-159.
- **medium** Metrics lack instrumentation and baselines (§3.2, NFR-014) — NFR-014 says PostHog is "focused on the V1.5 metrics"; the three V1.6 rows (walk-away rate within 15 minutes, free-sessions-over-paid share, on-time renewal rate versus prior 60 days) are not tied to any event or data source, and "rises versus the pre-release pilot baseline" has no number and no baseline exists for paid guest sessions (the leak is the absence of that record). *Fix:* extend NFR-014 to V1.6 events or state they are derived from DB tables; give the repeat-visit metric a numeric target flagged `[ASSUMPTION]`.

## Done-ness clarity — adequate

Most FRs have verifiable consequences: ranges for N/K/R, 7/60/90-day windows, calendar day in gym timezone, no attendance event on rejection, exactly-once rewards, server-side amount. 10.1 gives a six-point gate that maps to FR IDs. Gaps are edge-case ambiguities that story authors will hit.

### Findings
- **medium** UJ-11 contradicts FR-165 (UJ-11 para 2 vs FR-165) — UJ-11 says that on her fifth paid visit "Ange's app shows 5 / 5 and a free session waiting ... her progress starts again at 0 / 5" after she uses it. FR-165 says that on reaching N stamps the free session is earned and the count "returns to 0" at once, so the app would show 0 / 5 plus a free session. *Fix:* correct UJ-11 to "0 / 5 and a free session waiting".
- **medium** Consumption order between a free session and an unused paid session is unspecified (FR-159, FR-166) — FR-166 says the free session is consumed "in preference to requiring payment", but a member can hold both (FR-158 allows more than one unused paid session). Order changes whether a stamp is earned (FR-165: free earns none) and which lapses first. *Fix:* state the order (e.g. earliest-expiring first, or paid before free so stamps accrue).
- **medium** Guest-sessions card has an undefined period and counting rule (FR-163, FR-143, FR-160) — FR-163 says "for the selected period", but FR-143 defines no period selector (only month-to-date, live). "Blocked unpaid attempts" counts every stored rejected scan (FR-160), so one guest scanning four times inflates it; no de-duplication rule is given and UJ-11's "6 blocked attempts" is not verifiable. *Fix:* name the period (month-to-date, matching FR-143) or add the selector as a requirement; define a blocked attempt (per member per day, or per scan) and say so.
- **medium** "On-time renewal" leaves stamp-farming and early-renewal cases open (FR-167, OQ-21) — "a renewal payment verified on or before the current subscription's expiry date" does not say whether two payments in one cycle, an early renewal on day 1, or a plan change count, nor whether a renewal after a lapsed-and-reactivated subscription counts. OQ-21 covers only the post-expiry allowance. *Fix:* add "at most one stamp per subscription period" and state the plan-change/reactivation treatment, or add it to OQ-21.
- **medium** Stamp earning is not in the audited-action list that NFR-022 relies on (FR-170, NFR-022, FR-080) — NFR-022 says stamps are "reconstructible from the audit log", but FR-170 lists "grants, consumptions, lapses, resets, and program configuration changes"; ordinary stamp earning is not named, and FR-157 cites FR-080 for the charging setting without FR-170/FR-162 adding it to the list. *Fix:* add "stamp earned" and "charging setting change" to the FR-080 amendment, or word NFR-022 as "reconstructible from the stamp ledger".
- **low** In-app payment pending state is not covered (FR-158, FR-159) — a guest pays by Tara Money and scans before the webhook confirms; FR-159 would show "Pay for your session" while a payment is processing. FR-155 and FR-128-era flows have a processing state to mirror. *Fix:* one sentence on the "payment processing" state.
- **low** Midnight edge: a check-in open across the calendar-day boundary (FR-045 timeout is 8 hours) and a re-scan after midnight is not addressed (FR-159). *Fix:* clarify that coverage is evaluated at check-in time.

## Scope honesty — strong

Deferred items are explicit in Section 8 with targets and FR/OQ pointers; the V1.7 backlog is recorded without requirement IDs and with its own OQ-24; inferences carry `[ASSUMPTION]` inline (FR-161, FR-162, FR-167, three SM rows). Open-item density is six new OQs and four assumptions for a feature with money handling and a live user base, which is proportionate and none are blockers except OQ-21 (due "before the loyalty stories are written").

### Findings
- **low** Section 8 row for "Pay-per-session per-visit charging ... Moved into V1.6" now sits in an Out-of-Scope table (Section 8). It is accurate but reads oddly in a deferral list. *Fix:* delete the row, or keep it under a "moved in" note; OQ-16 already records the move.
- **low** Section 12 includes behavioral detail (template swap without re-entry, a single template plus contract, owner login host) that could be mistaken for decided requirements despite the "nothing here is committed" banner. *Fix:* acceptable as is; if desired, prefix the bullet group with "Intent (not committed)".

## Downstream usability — adequate

Cross-reference resolution (checked against the live file): FR-155 (awaiting registration fee, app blocked state) resolves with the meaning assumed; FR-010 (timezone, grace period) resolves; FR-124 and FR-127 (Tara Money Flow A, co-equal options, gym-connected) resolve; FR-143 (staff Overview, net revenue, `max_rows`) resolves; FR-069 (Settings), FR-080 (audit list), FR-049 (alert types), FR-061 (offline), FR-040 (refund), FR-035 (webhook idempotency), FR-021, FR-024/025, FR-147-FR-152, FR-014-FR-018, NFR-001, NFR-014, NFR-015 all resolve with the intended meaning. FR-156..FR-173 and NFR-021/022 are contiguous with no duplicates; OQ-16 and OQ-19..OQ-24 are contiguous. UJ-11 follows UJ-10 and names its protagonist.

### Findings
- **low** "Amendment to FR-007" (FR-171) points at the wrong requirement — FR-007 only states "founder-assisted, no self-serve signup". The behavior being changed (what Super Admin enters when creating a gym) lives in FR-071 and FR-010. *Fix:* "Amendment to FR-071 (and FR-010)".
- **low** FR-173 is labelled "Amendment to FR-024" but changes no behavior and repeats FR-156's "the plan's price is the price of one session". It is a clarification, not an amendment, and the V1.0 convention in the header says amendments state a change. *Fix:* relabel "Clarification of FR-024" or fold into FR-156.
- **low** §4.4 says the Receptionist can "admit the guest after an unpaid-check-in alert (FR-160)", but FR-160/UJ-11 have no admit action; the receptionist records payment and the guest scans again. *Fix:* reword to "record the payment so the guest can scan again".
- **low** Glossary drift — "Paid session" is defined as "one recorded payment of the guest's plan price" while "Free session" is "a zero-price paid session" (FR-166); a free session is not a payment. "Loyalty program", "on-time renewal", "free days", and the N/K/R parameters (the latter appearing in §4.4, FR-164, 10.1) are used but not defined in the glossary. The category "Gym / Salle de sport" is a bilingual compound label while FR-171 says labels are localized EN/FR. *Fix:* define "paid session" as the entitlement, with payment and free-grant as the two ways to get it; add the missing terms; state the EN and FR label for each category.
- **low** "Guest" and "session guest" are used interchangeably across FR-160..FR-169 and §4.4 ("Member / guest"). *Fix:* prefer "session guest" in FRs, or note the shorthand in the glossary.

## Shape fit — strong

Multi-stakeholder B2B on a live brownfield product: UJs with named protagonists are load-bearing and present; V1.6 is clearly distinguished from V1.0/V1.5 (section tags, 1.2 before/after table, 4.4 deltas); existing-code references in addendum G match the repo (migrations 0018, 0021, 0030, 0033, `protect_super_admin_only_gym_columns`, `epics.md` ~line 972, Stories 18.1/18.2/18.3/3.9 exist). No over- or under-formalization. One UJ for three features is lean: subscriber loyalty and category have no journey (low; FR-164..FR-167 are specific enough).

## Mechanical notes

- **V1.0 convention respected.** No V1.0 text was edited in place (diff confirms only the header/convention note, new sections, Section 8/9/10/11 rows, and the OQ-16 row changed). V1.6 changes to V1.0/V1.5 behavior are all stated as "Amendment to ..." (FR-042, FR-044, FR-049, FR-061, FR-069, FR-080, FR-143, FR-007, FR-024). Mislabels noted above (FR-007, FR-173).
- **Header convention note.** Correctly updated: "V1.5 ran FR-087-FR-155 / NFR-011-NFR-020; V1.6 begins at FR-156 / NFR-021". NFR range actually used is NFR-021/022, contiguous.
- **Requirement ID continuity.** FR-156..FR-173 (18 IDs) and NFR-021..NFR-022 present once each; section 1.2 and 4.4 ranges (FR-156-FR-163, FR-164-FR-166, FR-171-FR-172) match the 6.27-6.29 content.
- **Assumptions Index.** The PRD has no Assumptions Index section (also true of V1.5); inline `[ASSUMPTION]` tags in V1.6: 3 SM rows, FR-161, FR-162, FR-167. Nothing to round-trip, but the absence means the rubric's roundtrip check cannot pass for any version; consider adding an index at Finalize.
- **Section 10 title** still reads "Release Definition — 'Beta-Ready' (V1.5)" with 10.1 appended for V1.6; consider retitling 10 as "Release Definitions" for navigability.
- **PRD 1.2 table row** "Owner view of the leak | None" cites FR-163, which depends on the undefined period (see Done-ness).
- **Addendum G** is consistent with FR-157, FR-173, NFR-021, FR-035; it does not contradict the PRD. It flags the super-admin-only gym-column trigger for the charging flag but not for category (FR-171 also lets Owner/Supervisor edit category), worth one line.
