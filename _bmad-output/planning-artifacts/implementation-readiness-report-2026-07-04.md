---
stepsCompleted: [1, 2, 3, 4, 5, 6]
documentsIncluded:
  prd:
    - _bmad-output/planning-artifacts/prds/prd-gym_os-2026-06-20/prd.md
    - _bmad-output/planning-artifacts/prds/prd-gym_os-2026-06-20/addendum.md
  architecture:
    - _bmad-output/planning-artifacts/architecture.md
  epicsAndStories:
    - _bmad-output/planning-artifacts/epics.md
  ux:
    - _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/DESIGN.md
    - _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md
documentsExcluded:
  - _bmad-output/planning-artifacts/briefs/brief-gym_os-2026-06-20/brief.md
  - _bmad-output/planning-artifacts/prds/prd-gym_os-2026-06-20/reconcile-brief.md
  - _bmad-output/planning-artifacts/prds/prd-gym_os-2026-06-20/review-rubric.md
---

# Implementation Readiness Assessment Report

**Date:** 2026-07-04
**Project:** gym_os (GymOS)

## Document Inventory

**PRD:** `prd.md` + `addendum.md` (no sharded duplicate)
**Architecture:** `architecture.md` (no sharded duplicate)
**Epics & Stories:** `epics.md` (no sharded duplicate)
**UX Design:** `DESIGN.md` (tokens) + `EXPERIENCE.md` (spine)

No duplicate document-format conflicts found. No required documents missing.

## PRD Analysis

### Functional Requirements

Extracted from `prd.md` Section 6 (16 subsections, 6.1–6.16). Stable IDs FR-NNN. 85 total FRs (numbering runs FR-001–FR-083 plus FR-085, FR-086; FR-084 does not exist in the source PRD — not a gap, simply an unused number).

FR-001 – FR-006: Platform Foundation (phone identity, OTP, role hierarchy/RLS, Super Admin platform role, tenant isolation, schema scale)
FR-007 – FR-010: Gym Setup & Onboarding (founder-assisted onboarding, CSV import, no historical migration, onboarding config fields)
FR-011 – FR-013: White-Label Branding (single binary, Settings-driven branding, per-gym stores/themes deferred)
FR-014 – FR-018: Localization (bilingual foundation, language selection/persistence, i18n externalization + CI gate, receipt language, extensibility)
FR-019 – FR-023, FR-082, FR-083: Member Management (CRUD/soft-delete, record fields, Receptionist view/search, Coach scoping, self-service profile, invite generation, deactivation behavior)
FR-024 – FR-026: Membership Plans (plan types, per-gym config + billing interval, integer XAF money)
FR-027 – FR-032: Subscription Lifecycle (state machine, expiring/grace/expired triggers, check-in outcomes by state, renewal reset)
FR-033 – FR-041: Payments (methods, Notch Pay + PaymentProvider interface, idempotent webhooks, reconciliation, verification queue, mandatory fields, fee passthrough, refunds, receipts)
FR-042 – FR-048: Attendance & Occupancy (QR check-in, token validation, one-open-session, check-out, occupancy calc/bands, admin attendance page)
FR-049 – FR-052: Retention Triggers (real-time front-desk alert, alert content/renewal panel, alert stacking/dismiss, latency budget)
FR-053 – FR-056: Coach Portal (role gating, V1 features, assignment/reassignment history, deferred scope marker)
FR-057 – FR-063: Member Mobile App (single Expo codebase, onboarding sequence, Home screen, check-in states, offline check-in, plan/payment/check-in history, profile screen)
FR-064 – FR-069, FR-085: Gym Admin Dashboard (page/role shell, alert panel as primary surface, Members search/filter/export, verification queue page, Audit Log page, Settings page, Subscriptions page)
FR-070 – FR-073, FR-086: Super Admin Dashboard (separate app/auth, V1 capabilities, escalated access, default tiers, member cap enforcement)
FR-074 – FR-078: Push Notifications (Expo routing, V1 schedule, preferences/opt-out, token cleanup, bilingual copy)
FR-079 – FR-081: Audit Log (append-only DB enforcement, audited action types, filtering/export)

**Total FRs: 85**

### Non-Functional Requirements

Extracted from `prd.md` Section 7 (7.1–7.7).

NFR-001: Multi-tenant isolation enforced entirely at the PostgreSQL RLS layer; JWT claims hook spiked and verified before any RLS policy is written.
NFR-002: Payment webhook signature validation; unsigned/invalid payloads rejected with HTTP 401.
NFR-003: Monetary values stored as integers with an explicit currency column; no floats.
NFR-004: Audit log append-only by design; no UPDATE/DELETE from any code path.
NFR-005: V1 availability covered by Supabase Cloud/Vercel managed SLAs.
NFR-006: Offline support scoped to QR check-in only.
NFR-007: Sentry integrated on mobile + dashboard, single project, environment-tagged.
NFR-008: PostHog analytics deferred to V1.5.
NFR-009: Pilot scale ~30 members/gym across 1–3 gyms; architecture must scale to hundreds of gyms without schema/RLS rework.
NFR-010: Supabase region locked to EU West (Ireland/Frankfurt) before project creation; RTT verification required.

Plus dedicated **Performance targets** (dashboard <2s load, QR-to-alert <3s, offline sync <10s) and **Testing requirements** (JWT hook spike-and-verify sequencing, RLS CI tests, Notch Pay sandbox integration tests, manual mobile QA, no dashboard E2E in V1, CI gate composition).

**Total NFRs: 10** (plus Performance and Testing sub-sections)

### Additional Requirements

- **Out of Scope — V1** (PRD Section 8): 19 explicitly deferred items (self-serve signup, Travel mode, Campay, workout plans, class scheduling, progress tracking, quiet-gym alerts, class reminders, PostHog, E2E automation, provider refund API, streaks/leaderboards/activity feed, multi-currency beyond XAF, merch store, marketplace, geofence/BT/WiFi presence, per-gym App Store listings, custom fonts/themes, AI/wearables/corporate wellness, Dokploy/VPS). None of these appear in the Epics & Stories document — confirmed correctly excluded.
- **Resolved Open Questions** (PRD Section 9): tier structure (OQ-1), Notch Pay spike gating (OQ-2), grace period default (OQ-3), Travel mode deferral (OQ-4), auto-timeout default (OQ-5), alert auto-dismiss default (OQ-6) — all resolved, all reflected in the FR text already extracted above.
- **Addendum technical stack, monorepo structure, deployment, and key architectural decisions** (Section A–F of `addendum.md`) — these are downstream/architecture-facing, not PRD requirements; cross-checked in the Architecture Analysis step below rather than treated as additional PRD requirements.

### PRD Completeness Assessment

The PRD is complete and internally consistent: every FR has a stable ID, no renumbering has occurred (confirmed by the explicit "Do not renumber" instruction and the FR-084 gap being a genuine skip, not a collision), out-of-scope items are explicit and versioned, and open questions are resolved with rationale recorded. No ambiguity found that would block epic/story validation.

## Epic Coverage Validation

I read `epics.md` in full — all 7 epics, 46 stories, and every acceptance criterion — rather than trusting the document's own FR Coverage Map at face value.

### Coverage Matrix Summary

All 85 FRs trace to a story with genuine, testable acceptance criteria. Full one-line-per-FR mapping is already recorded in `epics.md`'s own FR Coverage Map (verified accurate against actual story content, not just claimed). Rather than reproduce all 85 rows here, this section calls out only the FRs that needed independent scrutiny:

| FR Number | PRD Requirement | Epic Coverage | Status |
| --- | --- | --- | --- |
| FR-062 | Member views plan details, payment history, and check-ins | Epic 3 Story 3.10 (plan + check-ins) + Epic 4 Story 4.9 (payment history) | ✓ Covered, split across two stories with an explicit cross-reference note in 3.10 |
| FR-021 | Receptionist can view/search members AND initiate payments | Epic 2 Story 2.3 (view/search restriction) + Epic 4 Story 4.3 (payment initiation) | ✓ Covered, but split across epics without a cross-reference note (unlike FR-062) |
| FR-085 | Subscriptions page, Manager/Owner-only access | Epic 4 Story 4.8 | ⚠ Partial — page content, filtering, renewal, and export are all AC'd; the "Manager/Owner-only" access restriction itself has no negative-case AC (no "Given a Receptionist, when they navigate to Subscriptions, then access is blocked") |
| FR-064 | Per-page minimum-role table (Overview/Members/Subscriptions/Payments/Attendance/Audit Log/Settings/Coach Portal) | Epic 1 Story 1.8 (sidebar-level mechanism) | ⚠ Partial — the role-filtered *sidebar* mechanism is established and AC'd once in Epic 1; individual pages built in later epics (Attendance in Epic 3, Payments/Subscriptions in Epic 4, Audit Log in Epic 7) don't each re-assert their own minimum-role AC. Relies on RLS (Story 1.3) as the real enforcement backstop, which is architecturally sound, but page-level access isn't independently tested per page. |

No FR has zero story coverage. The three ⚠ items are refinement opportunities (missing negative-case ACs), not missing epics or stories — RLS is the actual security boundary in all three cases, and it's already established in Story 1.3.

### Missing Requirements

**Critical Missing FRs:** None.

**High Priority Missing FRs:** None.

**Moderate observations (not blocking):**
- FR-021's payment-initiation half should get a one-line cross-reference note in Story 2.3, mirroring the pattern already used for FR-062 in Story 3.10 — this is a documentation consistency fix, not a coverage gap (the capability itself exists in Story 4.3).
- FR-085 and the per-page role gates under FR-064 would benefit from an explicit negative-case AC ("Given a Receptionist, when they attempt to access the Subscriptions/Audit Log/Settings page, then access is denied") in their respective stories, to make the RBAC boundary independently testable per page rather than relying solely on the general mechanism from Story 1.8 + RLS.

### Coverage Statistics

- Total PRD FRs: 85
- FRs covered in epics: 85
- Coverage percentage: 100%
- FRs with a documentation/AC refinement opportunity: 3 (FR-021, FR-064, FR-085) — none blocking

## UX Alignment Assessment

### UX Document Status

**Found.** `DESIGN.md` (3 brand tokens) + `EXPERIENCE.md` (full experience spine: 35 screens across Member App/Admin Dashboard/Super Admin, cross-cutting components, form validation, state patterns, accessibility floor, responsive breakpoints, and 6 key flows).

### Alignment Issues

**UX ↔ PRD:** Unusually strong alignment — this is a notable strength, not a gap. The UX spec's six Key Flows map directly onto the PRD's five User Journeys (Flow 1→UJ-1, Flow 2→UJ-2a, Flow 3→UJ-2b, Flow 4→UJ-3, Flow 5→UJ-4, Flow 6→UJ-5). Screen IDs (MA-xx/AD-xx/SA-xx) are used consistently across both documents and Architecture's Requirements-to-Structure map.

Two minor items found:
1. **FR-086's member-cap error copy** ("You've reached your plan limit ([N]/[Max] members). Contact GymOS to upgrade.") is specified in the PRD but absent from `EXPERIENCE.md`'s Voice and Tone microcopy table. The epics/stories already carry the correct PRD copy, so this doesn't block Epic 2 implementation — but the UX doc should be updated for completeness so future microcopy work has one source of truth.
2. **Minor labeling inconsistency internal to the UX doc:** the Form Validation Rules table references "AD-16 Inline Renewal Panel" as if numbered among the dashboard pages, but the Surface Index only runs AD-01–AD-15 (Inline Renewal Panel is correctly a cross-cutting component, not a page). No functional impact, just a stray ID.

**UX ↔ Architecture:** Also strong — Architecture explicitly threads UX screen IDs through its directory structure and FR mapping, and its `FrontDeskAlertPanel`/`InlineRenewalPanel` variant-driven component decisions match the UX spec's Cross-Cutting Components section exactly. One real gap found:

3. **Realtime-to-polling degrade path has no corresponding UX state.** Architecture specifies that the dashboard falls back to short-interval polling if the Supabase Realtime channel drops (a deliberate resilience decision — "a retention-critical alert that fails silently is worse than no alert"). `EXPERIENCE.md`'s Real-Time Alert Arrival section describes only the normal-path behavior (slide-in animation, ARIA live regions) and its Offline banners cover full connectivity loss, but neither covers the partial-degradation case: a receptionist has no visual indicator that alerts are currently arriving via slower polling rather than realtime push. This is worth a small follow-up UX decision before Epic 4's Story 4.6 (Real-Time Front-Desk Alert) is implemented — it doesn't block starting the epic, since the fallback is functionally transparent (alerts still arrive), but it's a real spec gap for a page Architecture itself flagged as retention-critical.

### Warnings

None — UX documentation exists and is not a missing-but-implied situation. The one architecture-driven UX gap (item 3 above) is flagged for follow-up, not blocking.

## Epic Quality Review

I re-read every epic and story's acceptance criteria against the create-epics-and-stories standards (user value, epic independence, no forward dependencies, story sizing) — adversarially, not assuming the prior validation pass caught everything. It didn't: four real forward-dependency violations survived that pass.

### 🔴 Critical Violations

None. No epic is a pure technical milestone with zero user value; no epic-level circular dependency exists; no story is epic-sized. Every epic, taken as a whole, delivers standalone value without requiring a later epic to be usable — the violations below are AC-level wording leaks, not structural epic failures.

### 🟠 Major Issues — RESOLVED 2026-07-04

All 4 fixed directly in `epics.md`: Story 2.5 trimmed and cross-referenced to 2.6; Story 2.7 softened to a landing state with a cross-reference to 3.7; Story 3.7 scoped to check-ins only with a new AC added to Story 4.9 extending Recent Activity to payments; Story 3.9 scoped to sync mechanics only with a new AC added to Story 4.6 covering the offline-sync-triggered alert case. Original findings below, kept for record.

1. **Story 2.5 (Member Invitation via Deep Link) forward-references Story 2.6.** Its AC states "the OTP screen is the first screen shown, with their phone number pre-associated" — but the OTP screen (MA-03) is built in Story 2.6, which comes *after* 2.5. This is a within-epic forward dependency: 2.5 cannot be verified complete until 2.6 exists.
   **Fix:** Trim Story 2.5 to its true scope (generating and sharing the invite message/deep link). Move the "OTP screen is first shown, phone pre-associated" assertion into Story 2.6, where it belongs.

2. **Story 2.7 (Goal, Experience & Plan Confirmation) forward-references Epic 3.** Its final AC says "I land on the Home screen" — but the Home screen (MA-09) isn't built until Epic 3, Story 3.7. This is a cross-epic forward dependency: Epic 2 cannot be demonstrated end-to-end without Epic 3 already existing.
   **Fix:** Soften to "I land on a confirmation/landing state," with a cross-reference note that Story 3.7 delivers the full Home screen — the same pattern already correctly used to split payment history between Stories 3.10 and 4.9.

3. **Story 3.7 (Member App Home Screen) forward-references Epic 4.** Its AC claims "the last 2–3 combined check-in/**payment** events are shown" — payment records don't exist until Epic 4. This is the identical root cause I patched once already for Story 3.10's Payments tab, but it recurred here because the UX spec's MA-09 section bundles both event types into one "Recent Activity" feed and I didn't re-check Story 3.7 against the same pattern.
   **Fix:** Scope Story 3.7 to check-in events only; add an AC to Story 4.9 (or a new small story) extending Recent Activity to include payments once they exist.

4. **Story 3.9 (Offline Check-In Queueing) forward-references Epic 4.** Its AC states "the front-desk alert fires at sync time" — the front-desk alert mechanism isn't built until Epic 4, Story 4.6.
   **Fix:** Scope Story 3.9 to the check-in/sync mechanics only (it already does this well otherwise — the timestamp/conflict-resolution logic is the real deliverable). Relocate the alert-firing assertion to a new AC on Story 4.6 covering the offline-sync-triggered case specifically.

**Common thread:** all four leaked from the same source — the UX spec (`EXPERIENCE.md`) describes end-to-end user-visible behavior that spans multiple epics' worth of implementation, and acceptance criteria copied that end-to-end framing instead of stopping at the current story's actual scope. Worth a general rule going forward: when an AC's "Then" clause names a screen, panel, or event type owned by a later epic, cut it at the epic boundary and add a forward cross-reference note instead (as already done correctly for FR-062/Story 3.10).

### 🟡 Minor Concerns

1. **Epic 1 and Epic 3 titles read as technical/system-oriented** ("Platform Foundation & Gym Onboarding", "Subscription Lifecycle & Attendance") even though their goal statements and every story underneath are genuinely user-value-driven. Cosmetic — consider renaming (e.g., "Gym Tenant Setup & Platform Access", "Membership Status & Gym Check-In") for a cleaner user-value signal, but not blocking.
2. **Three sprint-1 spike stories** (1.2 Region Verification, 2.1 SMS/OTP Provider, 4.1 Notch Pay) use "As a developer" framing with no end-user persona, deviating from strict user-story format. Each is tied to an explicit, PRD-mandated go/no-go gate with hard exit criteria (FR-034/OQ-2, NFR-010) — a defensible exception for de-risking genuine external-vendor/infra decisions on a 1–2 person team's timeline, not a quality defect.
3. **Story 5.1 (Coach Member Assignment) asserts "the member appears in that coach's portal"** one story before the portal is built (Story 5.2). Lower severity than the Epic 2/3 findings since this reads as a data-scoping assertion rather than a literal UI dependency, but tighten the wording (e.g., "the assignment is saved and scoped so the member will appear in that coach's portal") to remove ambiguity.
4. **FR-027's "surfaced as an alert on the Super Admin dashboard" clause has no implementation home.** Story 3.1 (lifecycle cron) asserts this in its AC, but none of Epic 1's Super Admin stories (1.5–1.7) build a job-health/failure-alert surface. Recommend adding it to Story 1.6's Platform Metrics page (once Epic 3's cron jobs exist to alert on) or a small dedicated story.
5. **Story 6.4 (Notification Preferences) builds opt-out toggles for N-06/N-07**, both of which are V1.5-deferred per the PRD's Out-of-Scope table (Section 8) — meaning in V1 there is nothing for these toggles to actually opt out of. Worth confirming with the user: defer Story 6.4 to V1.5 alongside its notification types, or intentionally pre-build the schema/UI now as forward-compatible scaffolding.

### Best Practices Compliance Checklist

| Epic | User value | Independent | No forward deps | DB timing | Clear ACs | FR traceability |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 2 | ✓ | ✓ (with fixes above) | ⚠ 2 violations | ✓ | ✓ | ✓ |
| 3 | ✓ | ✓ (with fixes above) | ⚠ 2 violations | ✓ | ✓ | ✓ |
| 4 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 5 | ✓ | ✓ | ⚠ 1 minor wording | ✓ | ✓ | ✓ |
| 6 | ✓ | ✓ | ✓ | ✓ | ✓ | ⚠ Story 6.4 scope question |
| 7 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

## Summary and Recommendations

### Overall Readiness Status

**READY** (updated 2026-07-04, post-fix). Zero critical issues: every FR traces to a real story, no epic is a technical milestone in disguise, no epic depends structurally on a later epic to deliver value, and the document is 85/85 FR-complete. The four **Major** forward-dependency violations found during review have been fixed directly in `epics.md`. Remaining items are moderate/minor and can be addressed opportunistically without blocking Sprint Planning.

### Critical Issues Requiring Immediate Action

None. The four Major issues (below) that would have confused whoever implemented Stories 2.5, 2.7, 3.7, or 3.9 first have already been fixed:

1. ~~Story 2.5 forward-references Story 2.6's OTP screen.~~ Fixed.
2. ~~Story 2.7 forward-references Epic 3's Home screen.~~ Fixed.
3. ~~Story 3.7 forward-references Epic 4's payment events in "Recent Activity."~~ Fixed.
4. ~~Story 3.9 forward-references Epic 4's front-desk alert mechanism.~~ Fixed.

### Recommended Next Steps

1. **Fix the 4 Major AC-scoping issues** in `epics.md` — each fix is a localized edit (trim an over-reaching AC, add a cross-reference note), following the same pattern already used correctly for the FR-062 Payments-tab split between Stories 3.10/4.9. I can apply these now if you'd like.
2. **Resolve the Story 6.4 scope question**: confirm whether notification opt-out UI for N-06/N-07 (both V1.5-deferred) should be deferred alongside them, or intentionally built now as forward-compatible scaffolding.
3. **Log a follow-up UX decision** for the Realtime→polling degrade indicator before Epic 4, Story 4.6 begins — a small addition to `EXPERIENCE.md`'s Front-Desk Alert Panel section.
4. **Address the 5 Minor concerns** at your discretion — none block Sprint Planning: epic renaming (cosmetic), spike-story persona framing (defensible as-is), Story 5.1 wording precision, the missing Super Admin job-failure alert surface, and the FR-086 microcopy gap in `EXPERIENCE.md`.
5. Once the 4 Major issues are resolved, proceed to **Sprint Planning** (`bmad-sprint-planning`) — no further readiness re-check is required unless the epics document changes substantially.

### Final Note

This assessment identified **15 issues** across 3 categories (Epic Coverage: 3 moderate; UX Alignment: 3; Epic Quality: 4 major + 5 minor). Zero critical or blocking issues. Address the 4 Major forward-dependency violations before implementation reaches Epic 2/3 — everything else can be improved opportunistically or deferred to your judgment.
