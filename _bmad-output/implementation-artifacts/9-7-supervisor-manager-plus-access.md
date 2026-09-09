---
baseline_commit: bd91da4
---

# Story 9.7: Supervisor gets the "Manager-plus" access it was specified with

Status: done

## Story

As a gym Supervisor,
I want the access EXPERIENCE.md already defines for my role,
so that the role sitting directly below Owner stops seeing less than a Receptionist.

### The gap, precisely

`EXPERIENCE.md:206` defines the V1.5 Supervisor role as sitting between Owner and Manager, with nav access that is **"Manager-plus: everything Manager sees, plus Settings and Staff — the same footprint as Owner, minus the ability to create another Supervisor."**

Story 9.1 shipped the role and later stories wired the two screens Supervisor specifically needed (Staff, Settings). Nothing ever widened the rest. The result was not a UI oversight but **denial at the database**, measured against identical seed data, one session per role:

| table | manager | supervisor | owner |
|---|---|---|---|
| members | 10 | 10 | 10 |
| subscriptions | 4 | **0** | 4 |
| coach_assignments | 1 | **0** | 1 |
| audit_log | 1 | **0** | 1 |

Those zeros were RLS refusing the read, not empty tables. Supervisor appeared in policies on **2** tables (`members`, `class_bookings`); Manager appeared on **14** where Supervisor did not, and 7 `SECURITY DEFINER` role gates named manager without supervisor.

The contradiction was visible in the product's own copy: the Coach Portal empty state (`EXPERIENCE.md:1651`, amended by Story 9.4) reads *"Ask your Manager, Owner, or Supervisor to assign members"* — while `assign_coach()` rejected a Supervisor outright.

## Acceptance Criteria

1. A Supervisor session reads every table a Manager session reads, on identical rows.
2. A Receptionist session's access is unchanged — the widening is role-specific, not a blanket opening.
3. Every `SECURITY DEFINER` role gate naming manager also names supervisor.
4. The role ceiling (NFR-013) is untouched: a Supervisor still cannot create or promote a Supervisor or an Owner, by any path.
5. Sidebar nav matches `EXPERIENCE.md:208`'s matrix for every role.
6. Full regression stays green.

## Tasks / Subtasks

- [x] **Task 1 — Migration `0093`: widen 26 RLS policies**
  - [x] Generate every statement from the live `pg_policies` catalog and widen its role array mechanically — never transcribe
  - [x] Handle both `'manager'::text` (22 policies) and `'manager'::member_role` (4 policies) shapes
  - [x] End with a self-asserting `DO` block in `0090`/`0091`/`0092`'s style
- [x] **Task 2 — Same migration: widen 7 `SECURITY DEFINER` role gates**
  - [x] Bodies from `pg_get_functiondef()`, before/after diff exactly 7 lines, purely additive
  - [x] Do **NOT** touch `enforce_member_cap()` — it names manager only in a comment and carries no gate
- [x] **Task 3 — App layer**
  - [x] 7 Sidebar nav items; `MembersPageClient`'s `CAN_MANAGE`; `ClassesPageClient`'s `canManage`; `PaymentsPageClient`'s refund button
- [x] **Task 4 — pgTAP**
  - [x] New `supervisor_manager_plus_access.test.sql` — compare Supervisor against Manager per table, never absolute counts
  - [x] Positive controls: Receptionist stays denied, so no equality can pass because a gate was dropped for everyone
  - [x] Anti-rot assertion re-deriving the manager-without-supervisor policy set from `pg_policies`
- [x] **Task 5 — Reconcile the three suites this changed**
- [x] **Task 6 — Regression and records**

## Dev Agent Record

### Agent Model Used

Claude Opus 5 (1M context) — `claude-opus-5[1m]`

### Completion Notes

**All 6 ACs met.** Supervisor now matches Manager on every table measured, Receptionist is unchanged, and the anti-rot assertion pins the invariant so a future manager-only policy fails by name.

**One judgment call that changed an existing deliberate-looking assertion.** `plan_handoff_on_coach_reassignment.negative.test.sql` section (g) asserted a Supervisor *cannot* read workout plans, on the stated grounds of "matching `manager_or_owner_read_own_session_notes`' own precedent". That precedent was part of the same gap, not an independent privacy decision: the policy guarding those tables is `manager_or_owner_read_own_workout_plan`, so Manager and Owner both read them, and excluding only the role between them was incoherent. Flipped, with the Receptionist section retained as the control. **Not to be confused with the real privacy rule**, which is untouched: FR-095 / `EXPERIENCE.md:946` keeps progress entries and photos visible only to the member and their assigned coach, excluding Manager and Owner too — workout plans are not progress data, which is exactly why Manager could always read plans while never reading progress.

**The role ceiling was verified, not assumed.** `manager_or_owner_insert_own_members`' `with check` still ends in `role = 'member'::member_role`, so the widening bought Supervisor the ability to create members and nothing else. Probed directly: a supervisor session attempting a direct INSERT of an owner / supervisor / manager / receptionist / coach row is refused by RLS in every case. The obsolete "cannot INSERT at all" assertion was replaced with three explicit escalation assertions, which are both stronger and durable.

**A failure that was NOT this story's.** Four assertions in `payment_reconciliation_job.test.sql` broke mid-work. The cause was a real `saas_billing_payments` row in `processing` created at 16:45 by the user's own Pay Now click while manually testing the suspended seed gym — over 10 minutes old, so the job correctly flagged it `stale_processing`. The test counted `payment_discrepancies` platform-wide and assumed an empty database, the same latent fragility already repaired in `gyms_super_admin_rls.test.sql`. Scoped its three unrestricted counts to its own fixtures rather than "fixing" a job that was behaving correctly.

### File List

**New**
- `supabase/migrations/0093_supervisor_manager_plus_access.sql`
- `supabase/tests/supervisor_manager_plus_access.test.sql`

**Modified**
- `apps/dashboard/components/shared/Sidebar.tsx`
- `apps/dashboard/app/(dashboard)/members/components/MembersPageClient.tsx`
- `apps/dashboard/app/(dashboard)/classes/components/ClassesPageClient.tsx`
- `apps/dashboard/app/(dashboard)/payments/components/PaymentsPageClient.tsx`
- `supabase/tests/staff_creation_role_ceiling_enforcement.negative.test.sql`
- `supabase/tests/plan_handoff_on_coach_reassignment.negative.test.sql`
- `supabase/tests/payment_reconciliation_job.test.sql`

### Regression

93 pgTAP files, **1955/1955** assertions, zero failures, with dev seed data present. Dashboard vitest **304/304** across 39 files. `pnpm run typecheck` clean. `pnpm run lint` 0 errors, 15 pre-existing warnings. Manual browser QA remains with smartsana.

### Deferred

Not implemented here, agreed separately: the **one-phone-one-membership** rule for members (a phone may hold at most one `role='member'` row, and a phone holding a staff row may not also be a member; staff and Owners keep multi-gym binding and the switcher). Queued as its own story.
