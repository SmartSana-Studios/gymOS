# Epic 27 Context: Desk Fixes — Check a Member In at the Entrance, Correct a Wrong Plan

<!-- Compiled from planning artifacts. Edit freely. Regenerate if planning docs change. Source of truth for acceptance criteria: epics.md "V1.8 — Stories (Epics 27–31)", Epic 27 section. -->

## Goal

Staff check in a member who cannot use their phone, void a mistaken check-in the same day, and correct a plan assigned by mistake with a reason and an audit trail; annual plan cards say what the member pays. This epic is PRD §10.3 Step 1 (desk fixes) and lays the attendance foundation (stored visit day, protected counting view, one check-in insert path) that Epics 28, 30 and 31 read. First feedback from the first onboarded gym drives it.

## Stories

- Story 27.1: Protected Attendance Counting: Stored Visit Day, Counting Views, Reader Allowlist (no behaviour change except the Attendance page "today" count)
- Story 27.2: One Check-In Insert Path: `private.record_check_in` (no behaviour change for a scan)
- Story 27.3: Staff Check-In and Void: Check In a Member at the Entrance, Undo a Mistake the Same Day
- Story 27.4: Correct Plan and Annual Plan Wording

Two independent chains: 27.1 → 27.2 → 27.3 (attendance) and 27.4 (plans). 27.4 touches no attendance object and may run in parallel with the attendance chain.

## Requirements & Constraints

- FR-240 annual plan wording ("Paid once", dashboard only); FR-241/242/243 Correct plan (reason, only while no payment stands, what a correction does not do); FR-248/249/250 staff check-in (entry time is now, same rules as a scan, no front-desk alert, same-day void by Manager or above with a reason); FR-251 GymOS Support gets `staff_check_in`, `void_staff_check_in`, `correct_subscription_plan`, `correct_plan_eligibility`.
- NFR-028: `visit_day` is written once at insert and never recomputed; a later timezone change never moves a past day.
- NFR-021: one lock order (AD-29: class_sessions, payment, member, attendance_events, subscriptions, guest_sessions, loyalty_progress); `record_check_in` takes the member lock first for every gym, charging or not.
- NFR-001: every new view and function is tenant-isolated and pgTAP-tested across gyms, suspended gyms and `anon`.
- Production is live with real gyms: 27.1 and 27.2 change what every check-in, occupancy count and attendance page reads and writes, with the promise that nothing a member or desk sees changes. The existing pgTAP suite passes with no fixture edits except the tests each story names.
- Each migration ships with `scripts/rollback-NNNN-*.sql`, regenerated `packages/types/src/database.ts`, and full `scripts/ci-local.sh` green.
- The engagement watermark (`dirty_from`) is deliberately absent from this epic; Epic 30 wires it into `record_check_in` and `void_staff_check_in`.

## Technical Decisions

- 27.1: `attendance_events` gains `visit_day date NOT NULL` (backfilled in the gym's current zone) and `voided_at`. `private.gym_local_date(gym, timestamptz)` is the single definition (fallback identical to `private.gym_today`). Views `attendance_counted` (security_invoker, explicit column list, `voided_at is null`) and `member_visit_days`. Base-table SELECT policies hide voided rows. Both occupancy functions re-created over `attendance_counted`. A CI node script plus a pgTAP `pg_proc`/`pg_policies` enumeration fail any new base-table reader of `attendance_events`. The Attendance page "today" count moves from the UTC day to the gym-local day (the one intended behaviour change).
- 27.2: a characterisation test of the unmodified `check_in()` is committed first and must pass unedited after the rewrite. `private.record_check_in` is the only inserter (member lock first, replay, gym status, FR-031, AD-22 stale-open, AD-29 gate, clamp, insert with explicit `visit_day`). `attendance_events` gains `source`, `entered_by`, `voided_by`, `void_reason` with CHECKs. The one-open index keeps its name (mobile matches it in the 23505 text) and gains `voided_at is null`. `suspension_rpc_coverage.test.sql` is the one existing test edited. Race script `scripts/check-in-member-lock-race.sh`.
- 27.3: `staff_check_in(p_member_id)` with no time and no scan-id parameter; returns coded outcomes R1–R8 instead of raising; rejected attempts commit one `staff_check_in_rejected` audit row and no alert; `session_attempts.source` gains `staff`. `void_staff_check_in` for Manager and above, same gym-local day, mandatory reason. Largest story: database and pgTAP first, then the dashboard.
- 27.4: pure `private.subscription_status_for`, an equivalence test against the real lifecycle job (the job itself is not modified), `private.subscription_standing_payments`, `correct_plan_eligibility`, `correct_subscription_plan` (member lock, then subscription lock, re-check under locks). One reusable plan summary line used by every plan select. Race script `scripts/correct-plan-race.sh`.
- Shared files between 27.3 and 27.4: `supabase/tests/support_capabilities.test.sql` (pinned totals and name arrays) and `apps/dashboard/app/(dashboard)/audit/auditLabels.ts`; each story updates them by arithmetic on the file as it stands at merge time, never to a hard-coded total.
- Migration numbers are assigned at merge time (head 0172 on 2026-11-15); earlier stories never renumber.

## UX & Interaction Patterns

- UX gate for 27.3 and 27.4: `EXPERIENCE.md` UX AD-11, AD-30 (Check in a member, results R1–R12, Void modal), AD-12, AD-31 (Correct plan, F1–F12), AD-04, AD-23, and the AD-22 "Desk check-in" source line. Screen states and copy there are the acceptance baseline. No mock-ups: design lives as text in the spec files.
- All new strings in EN and FR; `scripts/check-i18n-key-parity.mjs` must pass.

## Cross-Story Dependencies

- 27.2 depends on 27.1; 27.3 on 27.2; 27.4 on nothing.
- Epic 28 depends on `record_check_in`, the source and void columns and `void_staff_check_in`; Epics 30 and 31 read `attendance_counted` and `member_visit_days`. They must reuse these objects and never redefine them.
- 27.3 must carry two items from the 27.2 review as acceptance criteria: (1) `check_out()`, `check_out_member` and `run_check_in_auto_timeout_job` read the open row with `voided_at is null` (a voided open row can sit beside a live one after 0174), proved by a pgTAP case per updater; (2) `private.record_check_in` reads the gym status through `private.current_gym_status()` (session gym), so a support caller must be shown to resolve it for the `p_gym_id` it passes.
- Spine decisions: AD-56, AD-59, AD-53 (visit day only), AD-35, AD-39, AD-29, AD-30, AD-31, AD-22.

## Workflow

- Branch `epic/27` from master; one `story/27-N-…` branch per story, merged into `epic/27` after review and a green `scripts/ci-local.sh`; master and GitHub Actions only at epic end, then production release in the usual order (R2 backup, migrations, then dashboard deploy). Owner browser QA once at the end of the epic.
