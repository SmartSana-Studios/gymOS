# Sprint Change Proposal — 2026-08-11

**Project:** gym_os
**Prepared by:** Correct Course workflow (BMad), with smartsana
**Trigger:** New requirement (stakeholder-initiated) — adoption of the GymOS V1.5 "Beta-Ready" PRD (`docs/GymOS_PRD_v1.5_2.pdf`, draft 0.1, 2026-08-10) as the next planned release, extending the fully-shipped V1.0 PRD (v0.4).

---

## 1. Issue Summary

**Problem statement:** A complete V1.5 PRD draft was delivered directly by the stakeholder, adding substantial new scope on top of the already-shipped V1.0 platform (Epics 1–8, all `done` per `sprint-status.yaml`): owner self-serve staff management, member body/progress tracking, a payment-provider cutover (Notch Pay → Tara Money) plus an entirely new gym→GymOS SaaS billing relationship, classes/scheduling, workout plans, quiet-gym alerts, and the already-in-flight WhatsApp/Evolution API completion. This is release-scale planning input, not a single bug or deviation — the standard trigger shape for this workflow — but its size warranted a full impact pass before committing artifacts.

**How this was discovered:** Delivered directly by the stakeholder as the next release definition.

**Evidence:** The V1.5 PRD document itself (FR-087–FR-138, NFR-011–NFR-018, Sections 1–10), cross-checked against `prd.md` (v0.4), `epics.md`, `architecture.md`, `.decision-log.md`, `docs/decisions.md`, and the current codebase.

**Issue type:** New requirement from stakeholder, with one embedded strategic pivot (payment provider) that on investigation turned out to already be settled fact, not an open pivot — see Section 2.

---

## 2. Impact Analysis

### Epic Impact

V1.5 does not fit inside the existing 8 epics. Agreed mapping:

| Epic | Status | Scope |
|---|---|---|
| **Epic 9: Staff Management (Owner Self-Serve)** | New | FR-087–092, NFR-013 — Owner-created Manager/Receptionist/Coach/**Supervisor** accounts, privilege-escalation ceiling enforced at the RLS/auth-hook layer |
| **Epic 10: Client Progress Tracking** | New | FR-093–098, NFR-011, NFR-016 — body profile, progress entries, photos, coach visibility |
| **Epic 4 extension: Tara Money Cutover** | Extends Epic 4 | FR-099–103, NFR-012 — formalizes Tara Money as the documented primary provider (see below — largely already shipped) |
| **Epic 11: SaaS Billing (Gym → GymOS)** | New | FR-124–138 (Flow B) — a payment *direction* that does not exist in any prior epic |
| **Epic 12: Classes & Scheduling** | New | FR-104–108, FR-121 |
| **Epic 13: Workout Plans** | New | FR-109–112, FR-122 |
| **Epic 6 extension: Quiet-Gym Alerts + Class Reminders** | Extends Epic 6 | FR-113–116 — activates reserved N-06/N-07, identical shape to N-01–N-05 |
| Epic 1 / Epic 2 (WhatsApp/Evolution API) | Already covered | FR-117–119 — Story 1.13 (`done`) + Stories 2.9/2.10 (`backlog`), from the 2026-08-08 proposal. No new epic. |
| PostHog (NFR-014) / E2E baseline (NFR-015) | Unhomed | Fold into whichever of the six new epics ships first, as 1–2 stories each — not big enough to be their own epic |

**Six new/extended epics of net-new planning surface, on top of two smaller extensions.** This is V2-scale planning work.

### Story Impact

New epics 9–13 require a full `bmad-create-epics-and-stories` pass — not attempted inline in this proposal (see Section 3/5). Epic 4 and Epic 6 get targeted new stories within their existing structure.

### Artifact Conflicts

**PRD (`prd.md`):**
- Still carries two **unapplied** edits from the 2026-08-08 proposal (FR-071 messaging-instance row, FR-082 automated-invite rewrite) — these must land before or alongside the V1.5 merge, not after.
- V1.5's own Section 10 ("Release Definition — Beta-Ready") is a new MVP-style gate layered on top of the already-achieved V1.0 goals — additive, not a scope reduction.
- FR-099's framing ("V1.5 integrates Tara Money... replacing Notch Pay") is **factually stale** — see the Tara Money finding below. Needs rewriting to reflect reality: Tara Money has been the live active provider since Story 4.2 (2026-07-31); this "integration" work is largely already done.
- Nine Open Questions (OQ-7 through OQ-15) — six resolved this session (see Section 4.1), three remain genuinely open pending the Tara Money sandbox re-spike (OQ-7, and the two folded into it below).

**Architecture (`architecture.md`):**
- Same 2026-08-08 catch-up debt (`OtpDeliveryProvider` fallback chain, `WhatsAppMessageProvider`) unapplied.
- Three real design gaps needing resolution before Epic 9/11 story-writing: (1) a new `SECURITY DEFINER` staff-creation RPC with a hard role-ceiling check — structurally different from Story 1.5's admin-client gym-creation pattern; (2) a `PaymentProvider` routing-context extension for Flow B; (3) per-gym Tara Money credential encryption at rest (**resolved this session: Supabase Vault**, see Section 4.1).
- New risk identified: the existing `member-photos` Storage bucket is `public = true` (Story 2.6 precedent) — progress photos (NFR-011) need a **separate, private, signed-URL bucket**. Flagging explicitly so it isn't copy-pasted onto the wrong bucket.

**UX (`EXPERIENCE.md`/`DESIGN.md`):** No mockups exist for staff management, progress tracking, classes/booking, workout-plan authoring, the Super Admin Billing view, or the Tara Money connect-account flow — six epics' worth of missing screens. Needs a dedicated `bmad-ux` pass, not ad hoc extrapolation.

**Other artifacts:** NFR-015 (E2E baseline) is this project's first E2E investment — current CI is pgTAP + typecheck + i18n parity only. NFR-013 needs a dedicated pgTAP suite proving the privilege-escalation ceiling holds (Owner cannot mint Owner/Super Admin; Supervisor cannot mint Supervisor/Owner; Manager mints nothing).

### Technical Impact

Major finding from this session, materially changing the risk picture: **Tara Money is not a proposed, unvalidated pivot.** `docs/decisions.md` (2026-07-31 entries) confirms a real, passed sandbox spike and a full real-money round-trip (Orange Money, real USSD, real webhook, real subscription created) during Story 4.1/4.2 — `payment_providers.taramoney` has been `is_active = true` since then. Notch Pay was never actually shipped as the live provider despite `epics.md` Story 4.1/4.2 still being titled "Notch Pay..." (stale naming, flagged for cleanup). What genuinely remains as new technical work:
- GymOS's own Tara Money business account (`9FmIZg9GBB`) — **confirmed activated this session** (previously blocked on `BUSINESS_NOT_ACTIVATED_PLEASE_CONTACT_SUPPORT`, worked around with a stand-in "Temporal" business). Re-verification against the real business account (not the stand-in) is the immediate next action.
- MTN Mobile Money delivery — never verified against a real MTN send (only Orange Money exercised).
- Per-gym Tara Money credential storage + "Connect payment account" flow (FR-126) — genuinely new; today there is exactly one global credential set.
- `PaymentProvider` routing-context extension for Flow B.
- New `member_role` enum value (`supervisor`) and its creation RPC.

---

## 3. Recommended Approach

**Selected path: Option 3 (MVP/PRD Review) treatment, executed as a Major-scope replan, not a direct in-place patch.**

- **Option 1 (Direct Adjustment):** viable only for the small pieces — Epic 6's quiet-gym/reminder stories, and the already-in-flight WhatsApp work. Not viable for the six new epics; that's new planning surface, not "add a story to the existing plan."
- **Option 2 (Rollback):** not applicable — nothing shipped is being undone.
- **Option 3 (MVP/PRD Review):** the right fit. V1.5 *is* a new release definition (its own Section 10 says so explicitly) and needs the standard planning pipeline — PRD merge → architecture decisions → epics/stories → UX — not a lightweight correct-course patch.

**Effort: High.** Six new epics, two extended epics, one architecture pass, one UX pass, one PRD merge (plus overdue 08-08 catch-up).
**Risk: Medium**, materially reduced from the initial read — the payments risk that looked like the biggest unknown turned out to already be resolved (Tara Money proven live); the real remaining risk is concentrated in the new staff-provisioning security surface (NFR-013) and the net-new SaaS billing flow (Flow B).

**Rationale:** Trying to hand-author six epics' worth of stories inline inside this proposal would duplicate what the dedicated `bmad-architecture`, `bmad-create-epics-and-stories`, and `bmad-ux` workflows already do properly, and risks producing under-designed output for the two genuinely security/architecture-sensitive pieces (staff-provisioning RPC, payment routing context). This proposal's job is to establish the plan and lock in every open decision so those downstream workflows run without re-litigating them.

**Timeline impact:** Tara Money re-verification against the real business account is a same-day check. The staff-provisioning RPC and PaymentProvider routing-context extension are architecture-track items that gate Epic 9 and Epic 11 story-writing respectively. Epic 6's extension and the Epic 4 Tara Money formalization can proceed independently and immediately.

---

## 4. Detailed Change Proposals

### 4.1 PRD (`prd.md`) — Open Questions resolved this session

| # | Question | Resolution |
|---|---|---|
| OQ-8 | Progress photo storage cost/retention at beta scale | **No retention/purge policy for V1.5** — matches this codebase's existing accepted-unbounded-growth convention (`job_runs`, `audit_log`, `otp_resend_attempts`). Revisit if real storage cost emerges. |
| OQ-9 | Which plan types grant class booking — fixed or Owner-configurable? | **Fixed, simplest rule**: any member with an active subscription, any plan type, can book. No per-plan class-eligibility flag. |
| OQ-10 | Default measurement fields for the Cameroon beta cohort | **All five** FR-094 fields ship (waist, chest, hips, arms, thighs) — the schema already needs to support all five per FR-094's "any subset" wording; restricting would be more work, not less. |
| OQ-11 | Do beta gyms need co-owners (>1 Owner per gym)? | **No — one Owner per gym for the beta.** |
| OQ-14 | Tara Money recurring/subscription support for Flow B | **Folded into FR-100's spike scope** — the re-spike (against the now-activated real business account) must also confirm whether a saved-mandate recurring charge exists, or only single collects requiring per-cycle Owner approval. This materially changes Flow B's design (a collection job vs. a reminder-to-approve job) — architecture decision blocked on this answer. |
| OQ-15 | SaaS billing proration on mid-cycle tier change | **No proration.** New price applies at the next billing cycle. Simplifies `run_subscription_lifecycle_job`'s billing-anchor logic — no recalculation branch needed. |

**New decision, not in the original V1.5 draft — a new staff role:**

A **Supervisor** role is added between Owner and Manager in the role hierarchy (`Owner → Supervisor → Manager → Receptionist → Coach → Member`). Scope: Owner's staff-management and Settings access ("Manager-plus"), but structurally cannot create another Supervisor or an Owner (only Manager/Receptionist/Coach, mirroring Owner's own creatable set minus Supervisor itself). Requires a new `member_role` enum value — this is new schema, not new plumbing on existing schema (unlike Manager/Receptionist/Coach, which the enum already supported). Extends FR-087–092 and NFR-013 rather than replacing them; the "no role creates equal-or-above" ceiling rule generalizes cleanly to the new rung without a special case.

**Correction to FR-090's enforcement mechanism:** role changes require **immediate** access revocation, not "next token refresh." This needs a server-side revocation check (e.g. a `role_version`/`session_invalidated_at` claim, checked at the same layer as the existing auth-hook/RLS deny-all foundation) — heavier than the V1.5 draft's original wording implied, but the correct bar given a demoted-but-not-yet-logged-out staff member is a real security window.

**Correction to FR-099's framing:** rewrite to state plainly that Tara Money has been the active, live-proven payment provider since Story 4.2 (2026-07-31) — this is a documentation-accuracy fix, not new scope. `epics.md`'s Story 4.1/4.2 titles ("Notch Pay Sandbox Spike" / "Notch Pay Payment Integration") should be corrected to reflect what was actually built and shipped.

**Still to apply:** the 2026-08-08 proposal's FR-071/FR-082 edits (never applied — see that proposal's Section 4.1), sequenced *before* the V1.5-specific FR-071 Billing-view row is added on top.

### 4.2 Architecture (`architecture.md`)

- **New `SECURITY DEFINER` RPC** for staff creation (Epic 9): caller must be Owner or Supervisor; target role restricted to a hard allowlist below the caller's own rung; Manager gets no grant at all. Distinct in shape from Story 1.5's admin-client gym/owner creation (that one bypasses RLS entirely via Super Admin; this one operates inside a normal Owner/Supervisor RLS session with a role-ceiling check in the function body, not just Zod input validation).
- **`PaymentProvider` routing-context extension** (FR-138): carries which account a payment belongs to (a specific gym for Flow A, the platform for Flow B) — selects credentials at initiation, verification, and reconciliation.
- **Per-gym Tara Money credential storage:** Supabase Vault (agreed over pgsodium/app-layer encryption — least code to own and maintain).
- **New Storage bucket** for progress photos, explicitly separate from the existing public `member-photos` bucket — private, signed URLs, non-guessable paths (NFR-011).
- **Immediate session-revocation mechanism** for FR-090 (see 4.1 above) — needs a concrete design (claim + check location), not yet specified.
- Still to apply: the 2026-08-08 proposal's `OtpDeliveryProvider` fallback chain and `WhatsAppMessageProvider` sections (never applied).

### 4.3 New Epics (routed to `bmad-create-epics-and-stories`, not authored inline here)

Epic 9 (Staff Management), Epic 10 (Client Progress Tracking), Epic 11 (SaaS Billing), Epic 12 (Classes & Scheduling), Epic 13 (Workout Plans) — per the mapping in Section 2. Epic 4 and Epic 6 get new stories within their existing structure (Tara Money formalization; quiet-gym alerts + class reminders).

### 4.4 UX (routed to `bmad-ux`, not authored inline here)

Missing screens flagged: staff management (Add/Edit/Deactivate, role-change/logout messaging), progress tracking (log entry, trend charts, per-photo coach-sharing toggle — a per-entry consent model, not a blanket setting), classes (booking, "class full" state, cancellation), workout-plan authoring (reorderable exercise list — needs to work well on a coach's phone), Super Admin Billing view, Tara Money connect-account flow. Also flagged: the member-facing SaaS-suspension screen (FR-132) must never leak billing/payment language to a member — that's between GymOS and the Owner only.

---

## 5. Implementation Handoff

**Change scope classification: Major.**

**Routed to:**
1. **Product Manager (John / `bmad-prd`):** merge V1.5 content into `prd.md`, applying both the 2026-08-08 catch-up and this session's OQ resolutions and corrections (Sections 4.1). Update `.decision-log.md` with the Tara Money status-correction entry and the Supervisor-role addition.
2. **Architect (Winston / `bmad-architecture`):** resolve the three design gaps in Section 4.2 — staff-creation RPC, payment routing context, credential encryption — before any Epic 9/11 story is written.
3. **PM + Architect (`bmad-create-epics-and-stories`):** generate Epics 9–13 plus Epic 4/6 extensions once the PRD and architecture passes land.
4. **UX Designer (Sally / `bmad-ux`):** design pass for the missing screens in Section 4.4, at minimum the member-facing surfaces (progress tracking, classes) before those epics reach `bmad-dev-story`.
5. **Developer (Amelia):** immediate, independent, no gating — re-verify the Tara Money real-charge round-trip against the now-activated `9FmIZg9GBB` business account (swap `supabase/.env` off the Temporal stand-in credentials), record the result in `docs/decisions.md`, and fix `epics.md`'s stale Story 4.1/4.2 titles.

**Success criteria:** PRD/architecture/epics/UX artifacts all reflect V1.5 with zero unresolved open questions from this proposal; the Tara Money re-verification passes against the real business account; Epic 9's privilege-escalation guarantee has dedicated pgTAP coverage before it ships.

**PRD MVP impact:** Additive — V1.0's shipped MVP is untouched; V1.5 defines its own "Beta-Ready" gate on top (PRD Section 10).
