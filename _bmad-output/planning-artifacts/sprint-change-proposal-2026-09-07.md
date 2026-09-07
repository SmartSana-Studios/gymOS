---
date: 2026-09-07
trigger: "Super Admin UI missing — no way to add admins in-app"
mode: incremental
status: approved
---

# Sprint Change Proposal — 2026-09-07

## 1. Issue Summary

The user asked to add super-admins and found no UI for it anywhere in the
Super Admin dashboard. Investigation found this is **not a bug or an
oversight** — it is a deliberate, documented architectural decision made
during Story 1.12 (`Super Admin Provisioning CLI`, done 2026-08-05):

> An in-app "invite Super Admin" flow ... was discussed with the user and
> rejected in favor of this CLI script. Reasoning discussed: the Super
> Admin team is small and tightly held ... a CLI adds zero new
> public/authenticated-app attack surface, while an in-app flow would add
> a new authorization-sensitive code path ... Revisit if the platform-staff
> team grows enough that routine, self-serve Super Admin invitation
> becomes worth the added surface.

This is recorded both in `1-12-super-admin-provisioning-cli.md` and in
`docs/decisions.md`'s 2026-08-05 entry. The only sanctioned way to create
or promote a Super Admin today is:

```
pnpm --filter @gymos/super-admin provision-super-admin -- --email=someone@example.com
```

The user has decided, when presented with this history, to reverse the
decision and add the in-app UI. This proposal formalizes that reversal.

## 2. Impact Analysis

**Epic Impact:** Epic 1 (Platform Foundation & Gym Onboarding) is
otherwise complete through Story 1.15 (merged at `7221113`). This adds one
new story — **Story 1.16** — with no restructuring of Epic 1 or any other
epic. No other epic is affected. Story 9.1's dashboard staff-creation
boundary (no `member_role` path can ever reach Super Admin — it's a
separate `users.is_super_admin` flag) is unaffected; the new UI lives
entirely in `apps/super-admin`.

**Story Impact:** New Story 1.16 only. No existing story's acceptance
criteria change. Story 1.12 is superseded in part (its "Rejected
Alternative" reasoning no longer holds as an absolute), but its own
acceptance criteria and shipped code are not touched or removed — the CLI
script stays, retained explicitly for bootstrap (see below).

**Artifact Conflicts:**
- **PRD** — FR-071 (V1 Super Admin capabilities) needs a new capability.
  Per this PRD's own convention, V1.0 requirements (FR-071 is V1.0) are
  amended via a new FR, not edited in place. New **FR-141** (amends
  FR-071) and new **NFR-020** (mirrors NFR-013 for this separate
  `is_super_admin` flag) are added.
- **`docs/decisions.md`** — the 2026-08-05 entry is superseded via a new
  dated entry (not edited in place), per this project's own established
  convention (Story 1.15 superseded Story 1.7's decision the same way).
- **UX** — no Figma/mockup exists for a Super Admin management screen
  (a known, already-flagged V1.5 UX gap). Net-new screen; AC-level UI is
  specified directly in the story, mirroring the dashboard's existing
  Settings → Staff list+modal pattern — the same resolution path every
  other V1.5 story in this gap has used.
- **Architecture** — no `architecture.md` structural change (no new
  Edge Function, no new API surface class); reuses the existing
  service-role-admin-client-inside-a-Server-Action pattern already
  established by `createGym` and the CLI script.

**Technical Impact:** One new migration (a narrow RLS policy on
`public.users` scoped to `is_super_admin = true` rows, so a Super Admin
can list other Super Admins without a platform-wide user-read grant).
One new Server Action module reusing `createGym`'s admin-client pattern
and the CLI's exact `audit_log` `action_type` values
(`super_admin_provisioned` / `super_admin_promoted`) for a unified trail.
One new page + nav destination. No changes to `apps/dashboard` or
`apps/mobile`.

## 3. Recommended Approach

**Direct Adjustment** — add Story 1.16 to Epic 1's backlog; no rollback,
no MVP scope change. This is purely additive: nothing already shipped is
removed or reworked, and the CLI path (Story 1.12) remains valid and
necessary for bootstrap (creating the first Super Admin in an environment
where none yet exists — an in-app flow is structurally gated behind an
existing Super Admin session, so it can never be the *only* path).

- Effort: Medium (one migration, one Server Action module, one new page,
  i18n, manual verification — same shape as Story 9.1's staff-creation
  flow, scaled down since there's no role-ceiling matrix to enforce).
- Risk: Medium — this reintroduces exactly the privilege-escalation
  surface Story 1.12 chose to avoid. Mitigated by reusing this app's
  already-accepted trust boundary (the `(admin)` layout's `app_role ===
  "super_admin"` guard + service-role admin client, identical to
  `createGym`) rather than inventing new authorization logic, and by
  carrying over the CLI's confirm-before-promote safeguard and audit
  action-types verbatim.
- Timeline impact: none beyond the one story's own implementation.

## 4. Detailed Change Proposals

### 4.1 PRD (`prd-gym_os-2026-06-20/prd.md`)

Insert after FR-073 (~line 547):

> **FR-141** — Amendment to FR-071. In-app Super Admin account management
> is added to the Super Admin dashboard: a Super Admin can view the list
> of current Super Admins, create a new Super Admin account, or promote
> an existing platform-staff user (matched by email) to Super Admin —
> entirely in-app, no CLI/database access required. This supersedes
> Story 1.12's CLI-only decision (`docs/decisions.md`, 2026-08-05); the
> CLI script (`provision-super-admin.mjs`) is retained as the bootstrap
> path for creating the very first Super Admin in an environment where
> none yet exists (the in-app flow is necessarily gated behind an
> existing Super Admin session).

Insert after NFR-019:

> **NFR-020** — In-app Super Admin creation/promotion (FR-141) must make
> privilege escalation impossible: the action is only reachable by an
> authenticated Super Admin session, the underlying RPC self-enforces the
> caller's `is_super_admin` status server-side (not merely hidden in the
> UI), no self-promotion path exists for a non-Super-Admin, and every
> create/promote action is audit-logged with actor, target, and timestamp
> — mirroring NFR-013's discipline for staff-role provisioning.

Status: **Approved.**

### 4.2 `docs/decisions.md`

Append (do not edit the 2026-08-05 entry in place):

> ## 2026-09-07 — Super Admin Provisioning: in-app UI added, CLI retained
> for bootstrap — recorded during Story 1.16
>
> **Supersedes Decision 1 of the 2026-08-05 entry** ("Super Admin
> Provisioning CLI: CLI over in-app UI"). That decision is left unedited
> above as historical record, per this project's established convention
> (see Story 1.15's supersession of Story 1.7's Decision 1).
>
> **Decision — an in-app "Admins" screen is added to apps/super-admin,
> alongside the existing CLI script, not instead of it.** The original
> 2026-08-05 reasoning (small trusted team, minimal attack surface) is
> revisited at the user's request. The CLI script
> (`provision-super-admin.mjs`) is retained specifically for bootstrap:
> creating the very first Super Admin in an environment with none yet
> requires a path that doesn't depend on an existing Super Admin session,
> which an in-app flow structurally cannot provide. The in-app flow
> becomes the ordinary path once at least one Super Admin exists.
>
> **Why recorded here:** the 2026-08-05 entry stated the CLI-over-UI
> choice as if permanent; a future reader finding both the CLI script and
> an in-app Admins screen needs to know this was a deliberate later
> addition, not drift/inconsistency.

Status: **Approved.**

### 4.3 New Story 1.16 — Super Admin, In-App Admin Management UI

Not added to `epics.md`, matching Stories 1.11–1.15's own precedent of
skipping `epics.md` for later ad-hoc additions raised directly by the
user rather than derived from it.

**Story:** As a Super Admin, I want to view existing Super Admins and
create/promote new ones from the Super Admin dashboard, so that granting
the platform's highest-privilege role no longer requires CLI/repo access
for routine cases.

**Draft Acceptance Criteria** (to be finalized by `bmad-create-story`):

1. Given the Super Admin dashboard, when a Super Admin opens a new
   "Admins" nav destination, then they see a list of all current Super
   Admins (email, display name if set, and when they were provisioned),
   backed by a new narrow RLS policy on `public.users` scoped to
   `is_super_admin = true` rows only — not a platform-wide user-read
   policy.
2. Given the Admins page, when a Super Admin enters an email with no
   matching `auth.users` row and confirms, then a new Super Admin account
   is created (Admin API `createUser` + generated temp password surfaced
   once in the UI, mirroring `createGym`'s existing pattern) and an
   `audit_log` row is written with `action_type = 'super_admin_provisioned'`
   — reusing the exact `action_type` the CLI script already writes, so
   the audit trail is uniform regardless of path.
3. Given the Admins page, when a Super Admin enters an email matching an
   existing `auth.users` row and confirms (retyping the email to confirm,
   mirroring the CLI's own confirm-before-promote safeguard), then that
   user's `is_super_admin` flips to `true` via the service-role client
   and an `audit_log` row is written with `action_type = 'super_admin_promoted'`.
4. Given this story ships, `provision-super-admin.mjs` (Story 1.12) is
   NOT removed — it remains the only path to create the first Super
   Admin in an environment with none yet. Its usage comment gains a
   one-line note pointing to the new in-app path for the ordinary case.
5. Out of scope for this story (explicitly deferred, matching the CLI's
   own never-had-this scope): demoting/revoking an existing Super Admin.
   No demote UI or RPC is added.

Status: **Approved** (scope confirmed by user; full task breakdown,
dev notes, and technical references to be produced by `bmad-create-story`
before implementation).

## 5. Implementation Handoff

**Scope classification: Moderate** — a new backlog story plus two
planning-artifact edits (PRD, decisions.md), but no rework of shipped
stories and no epic restructuring.

- **Planning artifacts (PRD, decisions.md, sprint-status.yaml):** applied
  directly as part of this correct-course session (see below).
- **Story creation:** run `bmad-create-story` for Story 1.16 to produce
  the full implementation-artifact file (tasks, dev notes, technical
  references) from the draft ACs above.
- **Implementation:** run `bmad-dev-story` against the created Story 1.16
  file — new migration (RLS policy), Server Action module, page/nav/i18n,
  manual verification against local Supabase (per this project's
  standing "no automated E2E in V1" convention).
- **Success criteria:** a Super Admin can list, create, and promote Super
  Admins entirely from `apps/super-admin`, with an audit trail
  indistinguishable in shape from the CLI's own; the CLI script continues
  to work unmodified for bootstrap.
