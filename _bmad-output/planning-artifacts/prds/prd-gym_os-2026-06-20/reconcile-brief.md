# Reconciliation: Product Brief vs PRD v0.2

## Verdict

The PRD faithfully covers the brief's functional requirements and most technical decisions, but drops several qualitative design philosophy commitments, omits two success criteria from the brief, and leaves four brief-stated roadmap entries absent from the out-of-scope table.

---

## Gaps Found

### 1. Qualitative Design Philosophy — Retention Thesis Loop 3 (Monetize the Audience)

**Brief:** Explicitly names a third retention loop: "Monetize the audience" — gym merch store (V2.5), platform marketplace (V3). This is framed as part of the core product thesis, not just a roadmap bullet.

**PRD:** The out-of-scope table mentions "Gym-owned merch store (V2.5)" and "Platform-wide marketplace (V3.0)" as deferred items. But the **framing as a retention loop** — the idea that the audience GymOS builds through engagement becomes a monetization surface — is not articulated anywhere in the PRD. This matters for future product decisions: the brief is saying member engagement features are investments in a commerce surface, not just retention for its own sake.

---

### 2. Progress Tracking Philosophy — "No Body-Comparison Trap"

**Brief:** Explicitly calls out a qualitative design constraint for progress tracking: "private by default, never social, feeds show consistency signals only." Also: "Leaderboards rank consistency, not physique." This is a product ethics/design voice decision, not just a feature flag.

**PRD/Addendum:** The addendum's architectural decisions table includes "Body data: private by default; no social surface" and the note "Avoids body-comparison harm (V1.5 progress tracking)." But the nuance is partially lost:
- "Feeds show consistency signals only" is not captured anywhere.
- "Leaderboards rank consistency, not physique" is not captured anywhere (leaderboards are deferred to V2.0 in the out-of-scope table, but no design constraint is recorded for when they arrive).
- These are design constraints that need to travel with the leaderboard and activity feed stories into V2.0, or they will be implemented without the brief's intent.

---

### 3. Success Criteria Gap — Member Re-Engagement via Progress Tracking and Quiet-Gym Alerts

**Brief success criterion #3:** "Member re-engagement — progress tracking and quiet-gym alerts drive app opens on rest days (V1.5)."

**PRD:** The PRD's success metrics (Section 3.2) cover the pilot live date, alert reliability, payment reconciliation, RLS isolation, and localization completeness. There is no success metric for member re-engagement on rest days. The quiet-gym alert (N-06) and progress tracking appear in the PRD as V1.5 deferrals, but no corresponding success metric or acceptance signal is defined for V1.5 — the brief intended these to be measurable outcomes, not just features.

---

### 4. Success Criteria Gap — Shipping Velocity as a Gated Decision

**Brief success criterion #5:** "Shipping velocity — one Expo codebase ships to both stores; sandbox spike gates payment decisions."

**PRD:** The Expo single-codebase goal is covered (G-5, FR-057). The Notch Pay sandbox spike is addressed in FR-034 and OQ-2. However, the brief frames the spike as **gating the payment decision itself** — meaning if the spike fails, the payment approach is revisited. The PRD describes the spike's exit criteria (OQ-2) but does not explicitly state the decision consequence: what happens if the spike fails? The brief's intent that the spike is a decision gate, not just a validation checkbox, is not captured.

---

### 5. Roadmap Entries Not in the PRD Out-of-Scope Table

The PRD's out-of-scope table (Section 8) is thorough but omits the following roadmap entries that appear in the brief:

| Brief Roadmap Entry | Present in PRD Out-of-Scope Table? |
|---------------------|-------------------------------------|
| Meal logging (V2.0) | No |
| Coach marketplace (V4.0+) | No |
| Franchise support (V4.0+) | No |
| Branch management (V3.0) | No — addendum Section E mentions it, but the PRD's out-of-scope table omits it |

These are minor omissions (the out-of-scope table need not be exhaustive), but "branch management" in particular is architecturally relevant — it could affect the multi-tenant data model if not planned for.

---

### 6. Pricing Model Detail — Annual Billing Interval

**Brief:** "Monthly and annual billing intervals; annual discount to incentivize commitment."

**PRD:** OQ-1 defers pricing tiers and price points, which is correct. However, the brief also commits to **two billing intervals** (monthly + annual) as a structural decision, not just a pricing decision. This is not captured as a requirement anywhere in the PRD. If the Billing Epic is ever built, the billing interval architecture (monthly vs. annual subscription records, proration logic) needs to be designed — and the PRD gives no signal that annual billing is a committed feature even at the structural level.

---

### 7. Quiet-Gym Alert — Rate Limiting Constraints Not in PRD

**Brief:** Quiet-gym alerts are V1.5 (correctly deferred). However, the brief specifies specific rate-limiting constraints for the quiet-gym alert: "opt-in; max 2/day; min 3-hr gap between sends."

**PRD:** FR-075 lists N-06 (Quiet-gym alert) as a V1.5 notification with "Occupancy drops to Low band (opt-in; max 2/day; min 3-hr gap between sends)" — this IS correctly captured in the notification table.

**Verdict on this sub-item:** This is actually NOT a gap. The PRD captures this correctly.

---

### 8. Member App Feature Description — Quiet-Gym Alerts and Class Reminders Listed in Member Value Prop but Not in App Screens

**Brief (Who This Serves — Members section):** "Branded app for gym life — membership status, QR check-in, workout logging, progress tracking, class booking, quiet-gym notifications, streaks. All offline-aware."

**PRD FR-059 (Home screen):** Describes home screen as: gym branding header, current membership status and expiry date, quick-action buttons (Check In, View Plan, Profile), and recent activity summary (last check-in date only).

The brief's "all offline-aware" claim is partially addressed (FR-061 covers offline check-in) but the PRD only grants offline operation to the check-in flow. No other flows are offline-aware in V1. This is an intentional narrowing, but "All offline-aware" as a member value proposition is not corrected or scoped in the PRD's member-facing descriptions — it could create expectation mismatches.

---

### 9. Coach Lifecycle — Coaches See Expiring Members But Cannot Act

**Brief:** "No coach tools — coaches manage through personal messages and memory." The brief's framing implies coaches getting *any* tooling is a meaningful improvement.

**PRD FR-054:** Coaches see subscription status in the assigned member list (including expired), but there is no mechanism for a coach to notify the system or flag a concern about an expiring member. The PRD notes "Fatima can't process a renewal — that's the receptionist's job — but she makes a mental note." This is correct behavior, but there is no lightweight "flag for follow-up" or notification-to-receptionist mechanism. The brief's retention thesis implies every role should be a node in the catch-member-leaving loop. This is a product design gap, not just a missing FR.

---

### 10. Gym Admin Dashboard — Subscriptions Page Capability Gap

**Brief (Dashboard pages listed as V1 must-have):** Lists "Subscriptions" as a V1 must-have dashboard page.

**PRD FR-064:** The Subscriptions page is listed with minimum role Manager and capability "All subscription records; manual renewal initiation." This is present, but the brief also mentions "subscription lifecycle" in that page context. The PRD does not specify what filters or views exist on the Subscriptions page beyond "all subscription records." The Members page has explicit filter specs (FR-066); the Subscriptions page has none. This is a minor specification gap.

---

## Non-Gaps (Notable Deviations Intentionally Made)

- **Coach Portal scope:** Brief says Coach Portal is V1.5. PRD moves basic coach portal (assigned members + session notes) to V1. This is an intentional promotion, recorded in the addendum decision log.

- **Campay as primary fallback:** Brief lists Campay as "fallback" alongside Notch Pay. PRD defers Campay entirely to V2 and gates V1 on Notch Pay only behind a PaymentProvider interface. Intentional — recorded in addendum decision log. The abstraction preserves the brief's intent without the V1 complexity.

- **Travel mode:** Brief includes travel mode as a V1 plan type. PRD defers to V2.0. Intentional — cross-gym RLS complexity is a footgun risk. Recorded in decision log.

- **Occupancy "Full" threshold:** Brief specifies 91%+ as "Full." PRD captures this exactly as dashboard-only (FR-047). Not a gap.

- **App drawer name:** Brief says "GymOS" in app drawer for V1. PRD captures this in FR-011 as "the app appears as 'GymOS' in the device's app drawer and Play Store / App Store listing in V1." Not a gap.

- **Supabase region:** Brief does not specify a region. PRD addendum and NFR-010 add EU West as the required region (with explicit rationale re: latency NFR). This is an intentional addition beyond the brief — it tightens the brief's NFR rather than contradicting it.

- **Member invite mechanism (FR-082):** Brief implies members are onboarded by gyms but does not specify the invite mechanism. PRD adds a concrete deep-link-based invite flow. This is an intentional elaboration, not a contradiction.

- **Stale check-in edge case (FR-044):** Not in brief. PRD adds auto-close logic for stale open sessions. Intentional addition improving correctness.

- **Feature gating moved to V1.5:** Brief says "feature gating via Super Admin subscription status" without assigning a version. PRD defers to V1.5 pending OQ-1. Intentional and reasonable given pricing tiers are unresolved (OQ-1).
