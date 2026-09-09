# Sprint Change Proposal — 2026-09-09

**Project:** gym_os
**Author:** smartsana (via `bmad-correct-course`)
**Date:** 2026-09-09
**Mode:** Incremental (each edit proposal reviewed and approved individually)
**Status:** Approved

---

## Section 1 — Issue Summary

### Problem statement

GymOS is at production ship and onboarding its first paying clients (gyms). Two surfaces are not ready for a real customer to see:

1. **The staff Overview — the first screen a new gym Owner opens — is effectively empty.** It renders a heading, one placeholder paragraph, and the Front-Desk Alert Panel. Nothing else.
2. **The Coach Portal is a single page.** A Coach signs in, lands on the staff Overview, and has exactly one sidebar link. They cannot see the classes they are assigned to teach, and they have no portal home.

### How this was discovered

Surfaced during the first-client onboarding readiness pass, not by any story's implementation. This is the same category of finding as the 2026-09-01 Release Hardening entry — a gap visible only when looking at the product as a customer would, rather than story by story.

### Evidence

**The Overview was specified and never built.** `EXPERIENCE.md:1031` has carried the complete AD-02 spec since the 2026-07-04 UX pass: three stat cards (Checked in now / Expiring this week / Revenue MTD), a Currently Checked-In table, an Expiring This Week table, loading skeletons, empty states, click-through targets, and 60-second polling. None of it exists. `apps/dashboard/app/(dashboard)/page.tsx` records the deferral in its own header comment:

> *"AD-02 Overview -- still a minimal shell (story Dev Notes -> Scope Boundary / Open Question 2, resolved: no stat cards or tables here -- those remain deferred to a future story, nothing in the FR Coverage Map assigns them to 4.6)."*

The `overview.body` string still shipping in `en.json`/`fr.json` reads: *"Your gym's activity summary will appear here as more of GymOS comes online."* That promise is now being made to paying customers.

**The Coach Portal gap is structural, not cosmetic.** `Sidebar.tsx:51` gives the `coach` role exactly one nav item (`/coach`). `EXPERIENCE.md:1022` sends every post-login session to `/`. A Coach therefore lands on the staff Overview — a page they have no nav item pointing back to. Meanwhile `classes.coach_id` is `NOT NULL` (`0057:23`) and trigger-enforced to a coach-role member of the same gym (`0057:154`): **every class in the system already has exactly one owning coach, and that coach has no way to see it.**

### Issue classification

The two halves are different in kind, which matters for how they are handled:

| Half | Type | Implication |
|---|---|---|
| Overview | Misunderstanding / deferral of original requirements | Unfinished scope, not new scope. Spec already exists; no UX pass needed for the core. |
| Coach Portal | New requirement emerged from stakeholder | **Contradicts the PRD as written.** Requires FR amendments before it is valid to build. |

---

## Section 2 — Impact Analysis

### Epic impact

All of Epics 1–16 are `done` in `sprint-status.yaml` — nothing is in flight to disrupt. Epic 5 (Coach Portal) is closed and shipped; reopening it would rewrite delivered history. **A new Epic 17 is the correct container.**

- No future epic is invalidated.
- No epic becomes obsolete.
- **Epic 15 (Mobile Experience Quality Pass)** remains an unstarted placeholder blocked on a `bmad-ux` pass. Epic 17's gym-health cards also involve a small UX addition, but the two are independent and neither blocks the other.
- **Resequencing:** Epic 17 becomes the release-blocking priority, ahead of Epic 15.

### Story impact

No existing story is modified or rolled back. Five new stories. Two shipped stories are re-verified rather than changed:

- **Story 5.2 AC#1** (*"Payments, Members, Settings, and Audit Log are absent from the DOM"*) must remain literally true — Story 17.3 re-tests it.
- **Story 4.6** deferred AD-02's cards and tables; Story 17.1 completes what it deferred.

### Artifact conflicts

| Artifact | Status | Detail |
|---|---|---|
| **PRD** | **Conflict — amendment required** | **FR-053** (`prd.md:429`): *"Users with the Coach role see only the Coach Portal"*. **FR-122** (`prd.md:767`): *"**No other dashboard section becomes visible to the Coach role.**"* Both forbid what is being asked for. Four new FRs added (FR-143–FR-146; FR-142 was the previous maximum). |
| **Architecture** | **No conflict** | No new components, no stack change, no new integration point, no data-model change. Both new database objects follow patterns already established in `0040`, `0061`, and `0067`. |
| **UX (EXPERIENCE.md)** | **Update required** | AD-02 spec is buildable as-is and needs only a V2 amendment for the second card row. Role matrix (`:208–222`) needs the Coach Portal sub-nav. Two new screens (AD-20, AD-21) added. |
| **Epics** | **New section** | New "Launch Readiness (2026-09-09)" section + Epic 17, following the 2026-09-07 Phone Country Picker precedent. |
| **sprint-status.yaml** | **Update required** | New `epic-17` block, five stories at `backlog`, plus a `last_updated` entry and one new `action_item`. |
| **Deploy / CI / IaC / monitoring** | **No change** | Two migrations follow the existing deploy runbook. No pipeline change. |

### Technical impact

**Two migrations, and — after redesign — zero RLS policies modified anywhere in the epic.**

- **`0095` — `gym_revenue_mtd()`**, a database aggregate.
- **`0096` — `list_my_class_session_roster(p_class_session_id uuid)`**, one `SECURITY DEFINER` RPC with an explicit caller check.

Three findings during analysis materially changed the technical design. Each is recorded because each would have shipped as a defect:

#### Finding 1 — `max_rows = 1000` would have silently understated revenue

`supabase/config.toml:18` sets `max_rows = 1000`. The obvious implementation of "revenue this month" — fetch the month's `payments` rows and sum them client-side — **truncates at 1,000 rows without raising an error**. A busy gym would be shown an understated revenue figure on the first screen it opens, with no indication anything was wrong. Revenue must therefore be a database aggregate (`0095`).

The same trap does *not* apply to Story 17.2's four gym-health cards: those are `count: 'exact', head: true` **COUNT** queries — the pattern `memberCountForGym()` already uses at `members.ts:308` — which `max_rows` does not affect. 17.2 needs no migration.

Two related correctness rules are pinned at requirement level so they cannot be lost in implementation:
- **Revenue is net.** Refunds live in their own table with positive amounts (`0033:11`), not as negative payment rows. A gross figure overstates takings in any month containing a refund.
- **Only `verified` counts.** `payment_status` is `('pending','processing','verified','flagged')` (`0001:20`). `pending`/`processing` is money not yet confirmed; `flagged` is money under dispute.

#### Finding 2 — a Coach cannot see the names on their own class roster

`0040:81`'s `coach_read_assigned_members` policy restricts a Coach's `members` reads to *assigned members only* (`private.is_assigned_coach(id)`). Most people booked into a Coach's class are **not** their coaching clients. A roster built on plain RLS reads would render blank names for nearly everyone.

The original plan — widen `class_bookings` SELECT for the coach role — **would not have fixed this**, and a row-level widening on `members` would have handed the Coach every readable column including phone number.

**Resolution:** a `SECURITY DEFINER` RPC returning exactly `(member_id, member_name, attended_at)` and nothing else. Column-precise, and it removes the need to modify any policy.

#### Finding 3 — `gym_staff_read_own_classes` is misnamed, and FR-145 had to be corrected

Despite its name, `gym_staff_read_own_classes` (`0057:101`) is `gym_id = private.gym_id()` with **no role check**, and it is the *only* read policy on `classes`. It serves the **member app** — members browse and book classes (FR-105, FR-108, Story 12.4). It cannot be narrowed to exclude coaches without breaking the member Classes tab.

The first draft of FR-145 read *"A Coach can never see a class assigned to a different coach."* At the data layer that is **already false for every gym member**, and stating it as a requirement would have documented a guarantee the system does not provide. FR-145 was rewritten to protect the thing that actually is protected — the **roster** — and to state plainly that class metadata is gym-readable by design.

#### Deliberate deferral — check-in-based coach follow-up

`gym_staff_read_own_attendance_events` (`0025:24`) is restricted to `owner, manager, receptionist` and excludes the Coach role (and Supervisor — the pre-existing gap documented at `0068:25–33`). Story 17.5's "Needs Follow-Up" widget therefore uses **session-note recency only**, not check-in recency.

This is deliberate: session-note recency is the stronger coaching signal (it measures whether the Coach has engaged with that client, which is the thing a Coach can act on), it needs no migration, and adding a second attendance-access widening during first-client onboarding would enlarge an epic that currently changes no RLS at all. Story 17.5 carries an explicit AC recording this, so a future implementer does not "fix" the omission by widening attendance access without a decision.

---

## Section 3 — Recommended Approach

### Path evaluation

| Option | Verdict | Effort | Risk | Reasoning |
|---|---|---|---|---|
| **1. Direct Adjustment** | **✅ Selected** | Medium | Low | Additive only. Every existing surface keeps working. No shipped route moves. |
| **2. Potential Rollback** | ❌ Not viable | — | — | Nothing to roll back. Nothing is wrong; things are missing. |
| **3. PRD MVP Review** | ❌ Not applicable | — | — | The MVP already shipped. This adds to a live product; reducing scope is not the lever. |

### Rationale

Direct Adjustment, delivered as a new Epic 17.

- **Half the work is finishing what was already designed.** AD-02 needs no UX pass — the spec has existed since 2026-07-04. This is the lowest-risk way to make the product's first screen presentable before a customer sees it.
- **The Coach Portal half is genuinely new**, and the honest cost is two PRD amendments. Those amendments preserve the original security intent exactly: a Coach still reaches no admin dashboard section, cannot create or edit a class, and cannot mark attendance. What changes is the accidental reading that the Portal must be a *single page*.
- **The redesign shrank the blast radius rather than growing it.** The epic now modifies zero RLS policies. The only new privilege is one `SECURITY DEFINER` function with an explicit caller check and pgTAP coverage proving it denies other coaches, other gyms, and deactivated coaches.
- **Two independent chains allow parallel delivery**, which matters when the deadline is a client onboarding date.

### Timeline and sequencing

Two chains, runnable in parallel:

```
17.1 ──► 17.2          (staff Overview)
17.3 ──► 17.4 ──► 17.5 (Coach Portal)
```

**Launch-blocking:** 17.1 (fixes what a new Owner sees first) and 17.3 (fixes a Coach landing on a page with no way back). **Depth, not blockers:** 17.2, 17.4, 17.5.

If the onboarding date compresses, 17.1 and 17.3 alone remove both customer-visible embarrassments.

### Risk assessment

| Risk | Severity | Mitigation |
|---|---|---|
| Revenue figure silently wrong | **High** | Database aggregate (`0095`); `verified`-only and net-of-refunds pinned in FR-143 and in ACs. |
| Coach sees data they should not | Medium | Zero RLS policies modified. One RPC, explicit caller check, explicit `revoke`/`grant`, pgTAP coverage for cross-coach, cross-gym, and deactivated-coach cases. |
| Receptionist sees management figures | Medium | Row 2 gated to Manager-plus and absent from the DOM, not CSS-hidden — this app's established discipline. |
| Shipped coach routes break | Low | `/coach` and `/coach/[memberId]` are unmoved. New routes are static siblings; Next.js resolves static before dynamic and member IDs are UUIDs. |
| Progress photo consent collapsed | Medium | Explicit AC: `progress_photos` has its own sharing gate (`0067:92`); the summary widget surfaces entries only, never photos. |

---

## Section 4 — Detailed Change Proposals

### 4.1 PRD — `prds/prd-gym_os-2026-06-20/prd.md`

**Amend FR-053** (line 429):

> **OLD:** FR-053 — The Coach Portal is a role-gated section within the gym admin dashboard. Users with the Coach role see only the Coach Portal; all other dashboard sections (Payments, Members, Settings, Audit Log) are inaccessible.
>
> **NEW:** FR-053 — The Coach Portal is a role-gated section within the gym admin dashboard. Users with the Coach role see only the Coach Portal; all other dashboard sections (Payments, Members, Settings, Audit Log, the admin Classes page) are inaccessible. The Coach Portal is itself composed of multiple sub-surfaces (FR-144); "only the Coach Portal" constrains which *dashboard sections* a Coach reaches, not how many pages the Portal has.

*Rationale:* preserves the security intent verbatim while removing the accidental single-page reading. Adds the admin Classes page to the forbidden list — previously unstated, and worth stating now that coaches gain a different classes surface.

**Amend FR-122** (line 767):

> **NEW (appended):** *(V2: superseded in part by FR-144/FR-145 — the Coach Portal gains its own Overview and My Classes sub-surfaces. No **admin** dashboard section becomes visible to the Coach role; that constraint is unchanged.)*

*Rationale:* amends rather than rewrites — FR-122 is shipped history for Epics 10 and 13. Uses the same newest-wins convention FR-056 already established.

**Add four new FRs** (after FR-142, line 551):

- **FR-143** — Staff Overview presents live operational state: stat cards and supporting tables covering current occupancy, memberships needing attention, and month-to-date revenue. Revenue is **net** — verified payments minus refunds recorded in the same period. Every card links through to the full page for its metric. Values refresh on load and by polling; no card renders a stale or unattributed number.
- **FR-144** — The Coach Portal has its own navigation with three surfaces: Overview (default landing), My Members (existing AD-14), and My Classes. A Coach signing in lands on the Coach Portal Overview, not the staff Overview.
- **FR-145** — A Coach can view the classes they are assigned to teach (`classes.coach_id`), including upcoming sessions and the members booked into each. Read-only: creating, editing, and scheduling classes remain Manager/Supervisor/Owner (FR-104, FR-121); marking class attendance remains Receptionist-and-above (FR-107). The Coach Portal's My Classes surface presents only that Coach's own classes. Class *metadata* (name, schedule, coach, capacity) is readable by every authenticated user of the gym by design — that is what lets members browse and book (FR-105, FR-108) — so the guarantee here is not metadata secrecy. The protected data is the **roster**: who is booked into a given session. A Coach can retrieve a roster only for a session belonging to a class they are assigned to, enforced server-side, never by UI filtering.
- **FR-146** — The Coach Portal Overview summarises the Coach's own caseload: their next class sessions, assigned-member count with subscription health, members needing follow-up, and recent progress activity from assigned members. Every figure is scoped by the same assignment rules that scope the rest of the Portal (FR-055) — an ended assignment removes the member from these figures immediately.

### 4.2 UX — `ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md`

**Role visibility matrix** (`:208–222`) — top-level Coach row unchanged (still one sidebar link, so Story 5.2 AC#1 stays literally true); a nested Coach Portal sub-nav table is added below it (Overview AD-20, My Members AD-14, My Classes AD-21), with an explicit statement that My Classes is **not** AD-18/AD-19 and that a Coach cannot create, edit, or mark attendance.

**Screen inventory** (after `:82`):

| ID | Page | Route | Min Role |
|---|---|---|---|
| AD-20 | Coach Portal — Overview | `/coach/overview` | Coach *(V2, FR-146)* |
| AD-21 | Coach Portal — My Classes | `/coach/classes` | Coach *(V2, FR-145)* |

**Routing decision (deliberate):** `/coach` remains the member list. `/coach/[memberId]` (AD-15) is already shipped and linked from Stories 5.3, 10.4, and 13.2; restructuring to `/coach/members/[memberId]` would move a live route for cosmetic tidiness during onboarding week. The new routes are static siblings of the dynamic segment — Next.js resolves static first, and member IDs are UUIDs, so there is no collision.

**Navigation tree** (`:148–149`) — Coach Portal expanded into its three sub-surfaces.

**AD-02 V2 amendment** (after `:1073`) — a second card row (Active members / New this month / Today's classes / At risk), Manager-plus only; "At risk" = `grace_period` + `expired`, rendering in the alert colour only when non-zero; revenue is net, in gym-local time; row 2 streams in its own boundary so a slow aggregate never delays the operational cards.

**New AD-20 and AD-21 mockups** appended after AD-15, following the same Purpose / Layout / Components / Empty states / Loading structure as every other screen.

### 4.3 Epics — `epics.md`

New section **"Launch Readiness (2026-09-09 sprint-change-proposal)"** inserted at line 631, immediately before `## Epic 1`, following the 2026-09-07 precedent. Contains the two-gap narrative, the Epic 17 definition (FRs covered: FR-143–FR-146; Amends: FR-053, FR-122), the five-story roster table with migrations and dependencies, the two-chain dependency order, and an explicit **"Scope boundary — what this epic does NOT do"** block.

That scope-boundary block exists because this epic amends two security-shaped FRs; a developer picking up Story 17.4 should not have to infer the boundary from what is absent. It states that `manager_or_owner_insert_own_classes` / `manager_or_owner_update_own_classes` (widened to supervisor by `0093:64,67`), `mark_class_attendance`'s role check (`0068:41,70`), and `ClassesPageClient.tsx:65`'s `canMarkAttendance = role !== "coach"` are all untouched.

### 4.4 Stories 17.1 – 17.5

Full acceptance criteria for all five stories were drafted and approved individually during this workflow and are carried into `epics.md`. Summary:

| Story | Migration | Core deliverable |
|---|---|---|
| **17.1** Staff Overview — Operational Cards & Live Tables | **0095** | AD-02 as specified. Reuses `getCurrentlyCheckedIn()` and `listSubscriptions({status:'expiring_soon'})` — each already returns `{rows, total}`, so one call feeds both a card and its table. Deletes the `overview.body` placeholder. Per-surface failure isolation. |
| **17.2** Staff Overview — Gym Health Cards | none | Four COUNT-based cards, Manager-plus, absent from DOM for Receptionist. Explicitly does **not** reuse `memberCountForGym()` — that counts deactivated and expired members and would overstate the active base. |
| **17.3** Coach Portal — Sub-Navigation & Landing | none | Coach redirect from `/` to `/coach/overview`, placed in `page.tsx` not `layout.tsx` to avoid loop-prone path matching. Sidebar unchanged. Story 5.2 AC#1 re-verified. |
| **17.4** Coach Portal — My Classes & Session Roster | **0096** | Coach-scoped class list; roster via `SECURITY DEFINER` RPC returning only `(member_id, member_name, attended_at)`. Deactivated coaches excluded. Explicit `revoke`/`grant`. No RLS policy modified. |
| **17.5** Coach Portal — Overview | none | Four caseload widgets. Session-note recency only (no attendance widening). Progress **entries** only, never photos. |

### 4.5 Sprint status — `sprint-status.yaml`

New `epic-17: backlog` block with five stories at `backlog` and `epic-17-retrospective: optional`; a `last_updated: 2026-09-09` entry recording this correct-course pass; and one new `action_item`.

**New action item (not blocking Epic 17):** the `AD-xx` namespace collision. `AD-nn` means an *Admin Dashboard screen* in `EXPERIENCE.md` (AD-01…AD-21) and an *architecture decision* in `epics.md`/`ARCHITECTURE-SPINE.md` (AD-3, AD-21, AD-24). Screen AD-21 (Coach Portal — My Classes) and architecture AD-21 (bounded-capacity booking RPC) are **both about classes**, which maximises the chance of a developer opening the wrong one. Sequential numbering was kept and the ambiguity mitigated in story text; renumbering the namespace is tracked separately.

---

## Section 5 — Implementation Handoff

### Scope classification: **Moderate**

Not Minor — this amends two FRs, adds four, introduces a new epic, and creates two database objects. Not Major — no replan, no architectural change, no MVP redefinition, no epic invalidated. The plan is complete and the boundaries are explicit; what remains is backlog sequencing plus implementation.

### Handoff

| Recipient | Responsibility |
|---|---|
| **Product Owner / smartsana** | Apply the PRD amendments (§4.1) and UX updates (§4.2). Confirm Epic 17's position ahead of Epic 15. Decide whether 17.2/17.4/17.5 ship before or after first onboarding if the date compresses. |
| **Developer (Amelia)** | Apply the `epics.md` section (§4.3) and `sprint-status.yaml` updates (§4.5), then implement 17.1–17.5 via `bmad-create-story` → `bmad-dev-story`. |
| **Architect (Winston)** | **Consulted, not blocking.** Review migrations `0095` and `0096` before they run against production. Neither introduces a new pattern; both extend existing ones (`0040`, `0061`, `0067`). |

### Success criteria

1. A new gym Owner signing in for the first time sees a populated dashboard — live occupancy, memberships needing attention, and a **net, verified-only** revenue figure that is correct at any transaction volume.
2. A Receptionist sees the three operational cards and **no** headcount, growth, or churn figures — verified as absent from the DOM.
3. A Coach signing in lands on the Coach Portal Overview and can reach all three Portal surfaces without touching a staff page.
4. A Coach sees the classes they are assigned to teach and the members booked into each, and **cannot** create, edit, reschedule, or mark attendance on any of them.
5. pgTAP proves the roster RPC returns an empty set for another coach's session, a cross-gym session, and a deactivated coach.
6. `scripts/check-i18n-key-parity.mjs` passes; `en.json` and `fr.json` carry every new key.
7. `git grep` finds no remaining reference to the `overview.body` placeholder string.
8. Migrations `0095` and `0096` apply cleanly, and the full pgTAP regression suite passes.

### Definition of done for the epic

All five stories `done` in `sprint-status.yaml`; both migrations applied to production via the existing deploy runbook; `docs/decisions.md` carries an entry recording the FR-053/FR-122 amendment and the three technical findings above; Epic 17 retrospective run or explicitly skipped.

---

## Appendix — Findings that changed the design

Recorded because each would have shipped as a defect, and each is the kind of thing that is invisible in review once the code is written:

1. **`max_rows = 1000`** (`supabase/config.toml:18`) silently truncates row fetches. Client-side revenue summing would have understated takings to Owners at busy gyms, with no error. → database aggregate.
2. **`coach_read_assigned_members`** (`0040:81`) would have produced a class roster with blank names for every booked member who is not one of the Coach's coaching clients. The originally-planned `class_bookings` widening would not have fixed it. → `SECURITY DEFINER` RPC, which also avoids handing the Coach phone numbers.
3. **`gym_staff_read_own_classes`** (`0057:101`) is misnamed — no role check, and it serves the member app. FR-145's first draft asserted a guarantee that is already false for every gym member. → rewritten to protect the roster, which is what is actually protected.
4. **`gym_staff_read_own_attendance_events`** (`0025:24`) excludes the Coach role. Check-in-based follow-up was deferred with an explicit AC rather than silently dropped or silently widened.
5. **`payment_status`** (`0001:20`) has four values, only one of which is money the gym actually has. **Refunds** (`0033:11`) are a separate table with positive amounts. Both pinned in FR-143.
