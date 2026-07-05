# PRD Quality Review — GymOS v0.2

## Overall verdict
A strong PRD that earns its thesis and holds it consistently across features, metrics, and scope decisions. The main gaps are a missing Subscriptions page spec, the Notch Pay spike having no stated failure disposition, a coach-to-receptionist handoff the retention thesis demands but the PRD omits without acknowledgement, and three ASSUMPTION tags absent from the FRs where they belong.

## 1. Decision-readiness — strong
Trade-offs are named with what was given up (Campay, travel mode, feature gating). The decision log records 16 decisions with rationale and alternatives. Open Questions are genuinely open. NOTE FOR PM callouts appear at real tensions (OQ-1 billing tiers, Notch Pay spike gate). The JWT hook sprint-1 spike callout in FR-003 is a good example of a non-obvious risk surfaced explicitly.

### Findings
- **high** Spike failure path undefined (§ FR-034, OQ-2) — FR-034 defines exit criteria for a passing spike but never states what happens if it fails. A non-decision masquerading as a checkbox. *Fix:* Add "If the spike fails, no payment code ships until an alternative integration is validated and documented in `docs/decisions.md`."

## 2. Substance over theater — strong
User journeys with named protagonists (Kwame, Amara, Nadia, Fatima, Chidi) carry real context and drive decisions. NFRs have product-specific thresholds (3s alert, EU West region requirement, 1,000-row export limit). The retention thesis is a genuine bet, not a marketing tag.

### Findings
- **low** Goal/experience level onboarding (FR-058 steps 3–4) could become persona theater if goal data never connects to a feature beyond coach visibility. The PRD acknowledges this correctly (goal visible to coach). No fix needed — just monitor in V1.5.

## 3. Strategic coherence — strong
The retention thesis is explicit and consistent. Feature prioritization follows from it. Counter-metrics are named for all success metrics. Out-of-scope table maps every deferral to a version. The decision to remove travel mode and Campay from V1 is correctly framed as protecting the thesis, not just reducing scope.

### Findings
- **medium** Coach-to-receptionist handoff for expiring members is a thesis gap not acknowledged as a V1 omission (§ FR-054, UJ-4). Fatima sees "Expiring Soon" in her client list and "makes a mental note." The retention thesis claims every role is a catch-member-leaving node, but there is no escalation mechanism and the PRD does not name the gap explicitly. *Fix:* Add a sentence to FR-054: "Coach-to-receptionist escalation for expiring member clients is deferred to V1.5; verbal communication is expected in V1 pilot."

## 4. Done-ness clarity — adequate
Most FRs have testable consequences. The check-in states table (FR-031, FR-060) is a model for clarity. The payment discrepancy definition (FR-036) is precise. The inline renewal panel taps spec (FR-050) is implementable as written.

### Findings
- **high** Subscriptions page is underspecified (§ FR-064) — Every other dashboard page in the FR-064 table has Key Capabilities. The Subscriptions entry says only "All subscription records; manual renewal initiation." No spec for sortable columns, filter options, role gates, export, or what "manual renewal initiation" looks like step-by-step. *Fix:* Add FR-085 with a full Subscriptions page spec.
- **medium** Three ASSUMPTION tags missing from FRs (§ FR-029, FR-045, FR-051) — Grace period default (3 days), auto-timeout (4 hours), and alert auto-dismiss (15 minutes) appear as stated facts in their FRs, but each has an open PM-confirmation question (OQ-3, OQ-5, OQ-6). A developer reading only the FRs would not know these are unconfirmed. *Fix:* Annotate each with `[ASSUMPTION: pending PM confirmation — see OQ-X]`.

## 5. Scope honesty — strong
Out-of-scope table is explicit and versioned. Deferral decisions are recorded with rationale. OQ-4 was resolved and recorded in the decision log but is missing as a resolved entry from the Open Questions table (§ 9) — the table jumps from OQ-3 to OQ-5 without explanation.

### Findings
- **medium** OQ-4 gap in Open Questions table (§ 9) — resolved decisions should appear as closed entries so future readers understand the numbering and the resolution. *Fix:* Add OQ-4 as "Resolved — travel mode deferred to V2.0. See `.decision-log.md` entries #4 and #16."

## 6. Downstream usability — adequate
FR/UJ IDs are unique. All UJs have named protagonists. Domain nouns ("check-in," "subscription status," "expiry date") are used consistently. The two-level alert state model (yellow/red) is defined in FR-031 and referenced correctly in FR-049 and UJ-2a/UJ-2b.

### Findings
- **low** "Subscription status" and "membership status" are used interchangeably in FR-059 (home screen) and FR-062 (member view). Standardize to "subscription status" throughout to match the data model language in FR-027.

## 7. Shape fit — strong
Multi-stakeholder SaaS with five distinct user roles and meaningful UX across mobile + web. Five named UJs are appropriate and load-bearing — each drives at least one FR decision. The PRD is chain-top (feeds architecture + epics) and the FR detail level matches. No over-formalization; no gaps.

## Mechanical notes
- **ID continuity:** FR-082 and FR-083 appear in §6.5 (Member Management), breaking the sequential FR numbering in that section. IDs are stable and unique — no renumbering needed — but future reviewers may be surprised to find FR-082 before FR-057. Note this in the FR preamble if desired.
- **ASSUMPTION tags:** Three inline assumptions in FRs (FR-029, FR-045, FR-051) have corresponding OQs but are not tagged `[ASSUMPTION]` inline. Inconsistent with FR-021 and FR-047 which do use the tag.
- **UJ protagonists:** All five UJs have named protagonists. UJ-2a and UJ-2b share Amara — appropriate given they are continuations of the same scenario.
- **Glossary:** No formal glossary section. For a chain-top PRD feeding architecture and stories, a one-table glossary of the 8–10 core domain terms (subscription status states, role names, alert types) would reduce friction. Low priority for a V1 dev-team PRD.
