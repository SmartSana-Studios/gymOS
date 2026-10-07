# PRD Quality Review — GymOS PRD (registration-fee update, FR-147..FR-154, OQ-16, OQ-17)

Scope: the uncommitted diff to `prd.md` (updated 2026-10-07) and its interaction with existing requirements. Untouched parts of the PRD are not re-litigated. Reviewer only; no files other than this one were written.

## Overall verdict

The change is well-scoped and faithful to the user-confirmed decisions on the core rules (flat integer-XAF fee, default 0 = off, once per member, non-refundable, all plan types, Owner/Manager-only audited waiver with mandatory reason, prior-subscription exemption, CSV exemption, verified-only unlock, separate revenue line, reactivation deferred, per-visit charging split out with the unpaid-visit behaviour tagged as a PM recommendation). IDs follow the append-to-section-end rule, are unique, and every FR/OQ cross-reference resolves. What is at risk is the seams with existing requirements. FR-147 gives Managers a Settings capability the role model says they do not have. FR-151's "verified only" rule is not reconciled with how front-desk cash payments actually become verified. FR-148 and FR-153 disagree about CSV import. The surrounding sections (Settings table, audit list, Release Definition, 1.1, UJ-1) were not touched. Verdict: **adequate** — fix the two high findings and the medium cross-section gaps before this feeds story creation.

## Decision-readiness — adequate

The decisions that matter are stated as decisions (FR-148 gate, FR-149 once and non-refundable, FR-150 waiver authority), and OQ-16 is a genuinely open question with a recommendation attached ("PM recommendation: deny the check-in … not 'allow now, owe later', since the platform has no receivables ledger"). That is a real trade-off with the rejected option named.

Two weaknesses. OQ-17 is not actually open: its own text says "Until resolved, a reactivated member keeps their paid, waived, or exempt status — this follows from FR-149 and is not a separate decision." The question is really a deferred feature (re-registration fees), and it presupposes a "reactivation" capability that no FR defines (the PRD has deactivation, FR-083, but no member reactivation). Separately, OQ-16 is mostly a record of decided direction rather than a question; only the unpaid-visit behaviour and offline check-in are open, and the row mixes the two.

### Findings
- **medium** OQ-17 is a deferral dressed as a question (§9, OQ-17) — the answer is already given by FR-149 ("has ever had a subscription is exempt"; FR-083 sets `expired` and never removes the subscription), and "reactivated" refers to a capability with no FR. *Fix:* move it to Section 8 as "Re-registration fee on reactivation — deferred" (or keep as a one-line assumption on FR-149), and state in FR-149 that deactivation/reactivation never re-triggers the fee in V1.5.
- **medium** OQ-16 recommendation misdescribes FR-049 (§9, OQ-16) — it proposes to "raise the existing front-desk denied alert (FR-049)". FR-049 fires only for members with status `expiring_soon`, `grace_period`, or `expired`, and FR-031 supplies "membership expired" copy. An unpaid Pay-per-session visit is none of those. Also "collect cash and admit the member" has no existing mechanism (the Attendance page offers manual check-out, FR-064). *Fix:* reword to "a new denied-alert reason modelled on FR-049" and note that manual admit is new capability for the follow-on story.
- **low** The Out-of-Scope row's target column reads "Follow-on after the registration fee (OQ-16)" (§8) — not a version, unlike its neighbours. Acceptable (precedent: "Decision pending") but give it a version bucket if one is known.

## Substance over theater — strong

No personas, innovation, or boilerplate NFR added. Every new FR carries a concrete rule or threshold. The change adds little furniture. The one thing missing is a one-line rationale for why the fee exists, which matters because it adds friction at the exact moment the PRD's retention thesis (Section 1) wants conversion. The PRD records no such rationale (the memlog only records the user's answers).

### Findings
- **low** No stated purpose for the fee (§6.6, FR-147; §1.1) — a reader cannot tell whether this is gym-revenue, member-commitment, or a local-market norm, so cannot judge the onboarding-friction trade-off. *Fix:* one sentence in FR-147 or Section 1.1, using only what the user has actually said (do not invent).

## Strategic coherence — adequate

The fee is a gym-side revenue/onboarding feature in a PRD whose thesis is retention, and it adds a gate to the member's first conversion. That tension is not acknowledged. Success Metrics (§3.2) and Goals (§3.1) are untouched: no counter-metric for the friction the gate creates (e.g., members stuck at the new "awaiting registration fee" state, FR-154), although the PRD's own convention is to pair every metric with a counter-metric. G-2 ("every franc auditable") is the natural home for the waiver/fee audit requirement but is not referenced.

### Findings
- **medium** Release Definition and Section 1.1 silent on the change (§10, §1.1) — the Release Definition lists six beta-ready capabilities and none mentions the fee; the 1.1 "What Changed" table has no row. A reader cannot tell whether FR-147–FR-154 gate Beta-Ready, are additive, or are post-beta. The new FRs also carry no version tag (V1.5 sections elsewhere are suffixed "— V1.5"), and they sit in V1.0-era sections 6.2/6.6/6.8/6.12. *Fix:* add a 1.1 row ("Member registration fee: none -> optional per-gym one-time fee"), state in §10 whether it is gating, and mark the FRs as V1.5.
- **low** No counter-metric or guardrail for the gate (§3.2) — e.g., plan-assignment blocked by an unverified fee payment. *Fix:* optional: add a counter-metric or note under G-2; at minimum reference the waiver audit under G-2.
- **low** User journeys not touched (§5) — UJ-1 (Kwame "confirms his Monthly plan" at step 5) and UJ-5 (Chidi/owner Settings walk-through) now behave differently when a fee is set. *Fix:* a sentence in UJ-1 ("if the gym charges a registration fee, Kwame sees it first…") or a short new UJ with a named protagonist covering collect/waive at the desk.

## Done-ness clarity — adequate

Most new FRs are testable. FR-148 is the strongest: it enumerates the entry points (dashboard, CSV import, member app), the unlock condition, and server-side enforcement. FR-149 gives a checkable exemption rule. FR-150 gives role, mandatory reason, and audit fields. FR-151 enumerates the non-unlocking payment states. Weak points are around who verifies, correction paths, and a few undefined terms.

### Findings
- **high** "Verified only" is not reconciled with front-desk reality (§6.8, FR-151 vs FR-037, FR-050, FR-067, UJ-2a/UJ-3, FR-075 N-04) — FR-151 says "a manual payment waiting in the verification queue (FR-037) … does not unlock plan assignment" and, in the same paragraph, "In the dashboard, staff collect or waive the fee in the same step where a plan would be assigned." For cash these cannot both hold unless the cash entry is born `verified` or a second person/step verifies it. The existing PRD is itself inconsistent on this: UJ-3 and FR-067 show manual payments sitting unverified in a queue, while FR-050/UJ-2a have "Confirm Renewal" record a cash payment and activate immediately. FR-037 also lets a Receptionist verify, with no rule against verifying one's own entry. As written, an engineer cannot tell whether a receptionist collecting cash at the desk can complete the sign-up in one step. *Fix:* state the cash/manual path explicitly (e.g., "a manual fee payment becomes `verified` when X does Y; the recording user may/may not verify their own entry"), and make "same step" consistent with it.
- **medium** FR-148 vs FR-153 disagree on CSV import (§6.6 FR-148, §6.2 FR-153) — FR-148 says the gate "holds for every way a subscription is created: … CSV import (FR-008, FR-153)", while FR-153 says imported members are exempt and import "is never blocked by FR-148". Every FR-008 row requires `plan_type` and `subscription_status`, so imported members always get a subscription and are already exempt under FR-149; FR-153 is correct but FR-148 should not list CSV import as a place the rule applies. *Fix:* in FR-148 reword to "... CSV import is exempt (FR-153)".
- **medium** Refund ban leaves no correction path (§6.8, FR-152 vs FR-040) — FR-040's remedy for "a member disputes a payment" is a manual refund entry; FR-152 removes it for the fee. That is the confirmed decision, but it leaves duplicate cash entries, wrong-member entries, and a member who pays the fee twice (e.g., Tara plus cash) with no resolution; FR-035 idempotency only covers duplicate webhooks. *Fix:* add the error-correction route (e.g., flag/reject in the verification queue before verify, FR-037) and say what happens to a duplicate/overpaid fee, or mark it as an open item.
- **medium** "Once per member" is ambiguous across gyms (§6.6, FR-149 vs FR-001) — FR-001 says one user may be a member at several gyms, each a separate `members` row. *Fix:* "once per member per gym".
- **medium** FR-154 leaves the post-gate member state undefined (§6.12) — step 5 does not complete until the fee is verified or waived, but FR-059's Home screen presumes a current subscription, and nothing says how the member learns the fee was verified or waived (N-04 is "Payment confirmed" with "your membership is active" copy per UJ-2a, wrong for a fee-only payment). The member's phone must also reach this screen while FR-151 offers staff collection in "the step where a plan would be assigned", a dashboard step that no FR defines (Subscriptions page = manual renewal; Members page = create/edit; FR-021 bars Receptionists from creating members). *Fix:* specify the post-gate landing state, the notification on fee verified/waived, and where in the dashboard fee collection/waiver is initiated.
- **low** FR-147 has no validation bounds (§6.6) — "whole XAF" and default 0 are testable, but non-negative-integer enforcement and any maximum are unstated. *Fix:* one clause.
- **low** "appear as their own line" (§6.8, FR-152) is ambiguous — a separate stat card on the Overview, a breakdown row, or the Payments page? Also "verified registration fees count toward … month-to-date revenue" restates FR-143, which already counts all verified payments; only the separate line is new. *Fix:* name the surface(s) and drop the redundant clause.
- **low** Receipt field mismatch (§6.8, FR-151 vs FR-041) — FR-041 receipt fields include `plan`, which does not exist for a fee payment. *Fix:* "receipt shows 'Registration fee' in place of plan".

## Scope honesty — adequate

The deferrals are explicit (OQ-16 and OQ-17, the Section 8 row, "reviewer gate not yet run" in the memlog). The `[ASSUMPTION: exact copy and screen flow to be settled in UX]` tag on FR-154 is appropriate. However, several additions go beyond the user-confirmed decisions without a tag. None looks wrong, but the PRD's own convention is to tag inferences.

### Findings
- **medium** Untagged additions beyond confirmed decisions (§6.6–6.12) — items not in the confirmed list and not marked ASSUMPTION or PM recommendation: (a) "set by the Owner or Manager in Settings" (FR-147; also contradicts the role model, below); (b) "never charged retroactively when a gym introduces or raises its fee" and "Changing the fee later affects only members who have not yet paid or been waived" (FR-149), a reasonable derivation of the exemption decision but a distinct rule; (c) fee identified distinctly "on the Payments page, in the member's payment history, and on the receipt" (FR-151); (d) member-app payment by Tara Money for the fee and an "awaiting registration fee" state (FR-154); (e) "collect or waive … in the same step" (FR-151). *Fix:* tag (a), (c), (d), (e) `[ASSUMPTION]` or `[NOTE FOR PM]`, and add them to the assumption trail in `.memlog.md`. The memlog's "confirmed PM defaults" line covers exemption, waiver, refund ban, verified-only, and revenue line, but not these.
- **low** Open-items density is fine: the change adds two OQs and one inline assumption on a single feature. No concern.

## Downstream usability — adequate

Cross-references all resolve (FR-008, 009, 024, 026, 033, 037, 040, 041, 049, 058, 061, 083, 124, 127, 143, Section 6.16; OQ-16/OQ-17 referenced from FR-149 and Section 8). No duplicate IDs; FR-147..FR-154 each appear as a definition exactly once. Placement follows the "append to end of section" rule. The surrounding specifications that downstream stories will extract from were not updated.

### Findings
- **high** Settings authority contradicts the role model (§6.6 FR-147 vs §4.1, §4.3, FR-064, FR-069) — FR-147 says the fee is "set by the Owner or Manager in Settings". The role hierarchy says Manager has "operations; no settings"; the §4.3 delta table says Manager "cannot manage staff accounts or settings"; FR-064 gives the Settings page minimum role Owner; FR-069 lists the Settings fields (the fee is not among them); and §4.1 gives the Supervisor "the same … Settings access as Owner", whom FR-147 and FR-150 omit. A story writer will have to guess whether Manager (and Supervisor) can edit the fee. *Fix:* decide the authority (likely Owner, plus Supervisor by the §4.1 rule, or Manager if intended and then say it lives outside Settings like FR-025 plan pricing), then amend FR-064/FR-069 to include the fee and state Supervisor explicitly in FR-147 and FR-150.
- **medium** Audit list not amended (§6.16 FR-080 vs FR-150) — FR-150 says the waiver is "audit-logged … (Section 6.16)" but FR-080's enumerated list of audited actions does not include waivers; and fee-amount changes (a monetary configuration that gates plan assignment) are not audited at all, in a PRD whose G-2 is "every franc auditable". *Fix:* add "registration-fee waivers and fee-amount changes" to FR-080 (or amend it via an Amendment FR).
- **low** Glossary range stops short (§11) — "FR-147–FR-152" omits FR-153 and FR-154, which also belong to the feature; FR-147's "FR-148–FR-152 do not apply" has the same boundary. *Fix:* "FR-147–FR-154".
- **low** Flow A table row "Purpose: Gym membership subscription" (§6.20) now also carries the fee; optional touch.
- **low** OQ-17 Blocker column reads "Nothing; revisit if gyms ask…" (§9) whereas the table uses "—" for none. Cosmetic.

## Shape fit — strong

Multi-stakeholder B2B plus consumer app; the change is a capability slice expressed as amendments to existing FRs (FR-153, FR-154, FR-152 explicitly "Amendment to …"), matching the PRD's established style. Only the user-journey touch noted above is missing.

## Mechanical notes

- IDs: FR-147..FR-154 contiguous after FR-146, unique, placed at the end of 6.6 (147-150), 6.8 (151-152), 6.2 (153), 6.12 (154). Placement matches the "Stable IDs … append to the end of their section" rule. OQ-16 and OQ-17 follow OQ-15.
- Cross-references: all resolve and none are wrong (FR-049 reference in OQ-16 resolves but the described reuse is inaccurate; see above).
- Conflicts with existing FRs: FR-147 vs FR-064/FR-069/§4.1/§4.3 (Settings authority); FR-151 vs FR-050/UJ-2a (immediate cash renewal) and FR-037/FR-067 (queue); FR-148 vs FR-153 (CSV wording); FR-152 vs FR-040 (refund remedy, intentional but leaves a gap).
- Assumptions index: this PRD has no assumptions index section and only one inline `[ASSUMPTION]` tag (FR-154); the tag is present inline and no index roundtrip is possible. Not a regression.
- Formatting: table rows for OQ-16, OQ-17, and the Out-of-Scope and Glossary rows are well-formed with the right column counts. The "updated: 2026-10-07" front-matter bump is correct; `version: "1.5"` unchanged, which is reasonable.
- Capabilities-not-implementation discipline: good. "Enforced server-side" (FR-148) is the only implementation-leaning phrase and is justified as a security property. Statuses `pending`, `processing`, `flagged` match the four `payment_status` values cited in FR-143.
- Typos: none found.
