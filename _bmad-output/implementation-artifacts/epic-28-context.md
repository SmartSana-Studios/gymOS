# Epic 28 Context: Pay-per-Session Validity — Whole Day or Single Use

<!-- Compiled from planning artifacts. Edit freely. Regenerate if planning docs change. Source of truth for acceptance criteria: epics.md "Epic 28 — Stories" (Stories 28.1–28.3 and the epic closing gate). -->

## Goal

A gym chooses whether a paid guest session covers the whole gym-local day (today's behaviour) or a single visit, and a forgotten check-out never lets a member back in free. Every existing and new gym stays Whole day until an Owner or Supervisor chooses otherwise. This epic edits the money path (session consume function, check-in, class attendance) in a live production system, so the existing guest-session test suites must pass unedited and correctness is proved in pgTAP, not only E2E. It builds on Epic 27's single check-in insert path and attendance-to-session link.

## Stories

- Story 28.1: Session Validity Setting and Session Record Changes
- Story 28.2: Single-Use Consumption at Check-In
- Story 28.3: Class Attendance in a Single-Use Gym and Setting-Change Parity

Strictly sequential: 28.1 lays columns, setting and setter; 28.2 makes the consume function and check-in path use them; 28.3 extends the same function to classes and proves setting-change rules end to end. All three merge to `epic/28` and reach master together. The Settings section ships in 28.1, but no production gym may be switched to Single use before 28.3 is on master.

## Requirements & Constraints

- Setting: per-gym Session validity (Whole day or Single use), changed only by Owner or Supervisor, audit-logged with old and new value; matters only while "Charge guests per session" is on.
- Single use: a Pay-per-session check-in consumes one usable session (soonest-lapsing first, paid before free on a tie) that covers that visit. A visit ends at check-out (manual or automatic) or at a platform-configured limit after check-in (default 180 minutes, range 1–1440), whichever is first. While a visit is open and younger than the limit, a second scan is rejected "You're already checked in" at no cost. After that, the next check-in consumes another session, closing the stale open visit.
- Classes: a class marked inside an open visit covered by that visit's own session costs nothing; otherwise a class consumes its own session, which covers nothing else. In Whole day, class coverage is unchanged.
- Changing the setting applies only to check-ins and class marks made afterward; an open visit finishes under the rule it began with; a consumed session keeps the coverage its own row records; no existing row is rewritten. Unused paid sessions still lapse after 7 days and free ones after 60 days under either setting. One guest stamp per consumed paid session (a class covered by a visit earns none; a refund reverses exactly that stamp, counter floors at 0).
- NFR-021 (atomic, member-locked consumption on every entry path, no double-consume, offline replay consumes nothing): the "one consumed session per gym-local day" part now applies to `whole_day` rows only. In Single use the equivalent is one consumed session per open visit. This contradiction between the NFR text and the Single-use rule is recorded, not silently resolved; the PRD sentence should be amended, and no story edits the PRD.
- NFR-028: visit days are stored once and unchanged; two Single-use visits in a day give two `attendance_counted` rows and one `member_visit_days` row.
- NFR-001: every new column, function and read is tenant-isolated and pgTAP-tested across gyms.
- Assumptions binding all stories:
  - A1: the visit limit is evaluated at server receipt time; a visit has ended when `checked_in_at + limit <= receipt time`.
  - A2: the limit applies only to an open visit that is the cover of a consumed, non-voided Single-use session; an open visit begun under Whole day, charging off or an exempt plan finishes under the gym's auto-timeout alone (the earlier of the two applies when both do).
  - A3: in Single use a class during an open visit is covered only if that visit's own session exists (FR-238 stays an assumption).
  - A4: a Super Admin is not a setter of Session validity.
  - A5: the member app gets no new copy for a visit-covered state.
- Each migration ships with a rollback script and regenerated `packages/types/src/database.ts`; full `scripts/ci-local.sh` green per story. Migration numbers are assigned at merge time; earlier stories never renumber.

## Technical Decisions

- 28.1 schema: `gyms.session_validity` (default `whole_day`); `platform_session_config.single_use_visit_limit_minutes` (default 180) with its audit function replaced to carry the new key; `guest_sessions` gains `validity_mode`, `covered_kind` (`day`/`visit`/`class`), `covered_booking_id` (unique where not null), reusing Epic 27's `covered_attendance_id`. CHECK `guest_sessions_cover_matches_kind` plus a deferred constraint trigger requiring a consumed `visit` row to have its attendance id by commit. The one-consumed-per-member-day unique index and covered-day CHECK are rebuilt to apply to `whole_day` rows only. Backfill every consumed row to `whole_day`/`day` without changing any other value. A normalising trigger fills mode and kind for legacy writers and clears all cover columns when `consumed_at` is set back to null (so Epic 27's void needs no edit).
- 28.1 setter: `set_session_validity(p_gym_id, p_validity)`, SECURITY DEFINER, its own pin trigger `private.pin_session_validity()` and its own bypass GUC (one write path per setting, never folded into another pin); direct UPDATE of the column silently reverts for every caller. Null-safe role gate through `private.current_member_role()`; suspended gym refused; one `session_validity_changed` audit row on a real change, none on a no-op. Registered for GymOS Support in `private.support_capabilities` (update `supabase/tests/support_capabilities.test.sql` by arithmetic on the file at merge time). A definer read function `get_session_validity_settings()` exposes the platform limit to Owner/Supervisor only.
- `private.consume_guest_session` keeps one function and one lock. 28.1 only adds mode/kind to its UPDATE; 28.2 changes the signature to `(member, gym, receipt_at, p_kind default 'visit')` returning outcome, session created-at and session id, and updates every caller in the same migration. It is called only by `private.record_check_in` and `mark_class_attendance` (a source-scan test asserts this). The `class` kind raises `class_single_use_unsupported` until 28.3 removes the guard.
- 28.2 order inside `private.record_check_in`: member lock (`FOR NO KEY UPDATE`) first, open-visit handling, consume decision, attendance insert, then set `covered_attendance_id`; the gym setting is read inside the lock. Coverage is judged from the row's own mode, never the gym's current setting. A stale close writes `checked_out_at = checked_in_at + least(timeout, limit)`, `checkout_type = 'auto'`, and an `attendance_stale_check_in_auto_closed` audit row with `reason: 'visit_limit'`; it commits with a denial. The denial contract of `check_in()` stays `null` (older builds must still not admit the guest); the denial reason is read from the attempt row. Occupancy and the auto-timeout job are unchanged: the limit closes a visit only at a later scan.
- 28.3: `mark_class_attendance` keeps its signature and `{ code, message }` error surface and calls the same consume function with `'class'`; class marking never writes `attendance_events` and never closes a stale visit. A class session is set in the same transaction as `attended_at`.
- Lock order (AD-29): class_sessions, payment, member, attendance_events, subscriptions, guest_sessions, loyalty_progress. Race scripts: `scripts/single-use-race.sh` (28.2, wired into `scripts/ci-local.sh`; 28.3 adds a class-vs-scan case and 28.2 a refund-vs-scan case).
- "Unconsume" (not "void") names the session release in code and comments; void already means `guest_sessions.voided_at`.
- Readers to update: `apps/mobile/src/lib/sessionState.ts` and `apps/dashboard/services/guestSessions.ts` carry the new fields; "covered today" stays true only for a consumed row whose `coveredDay` is today; a null `coveredDay` renders as used and never throws.

## UX & Interaction Patterns

- Settings (UX AD-13 "Session validity"): section directly under "Charge guests per session", above "Loyalty program"; radio Whole day / Single use; saves on its own (no confirm dialog, toast on success, inline error on failure); absent from the DOM for Manager, Receptionist and Coach; the limit is shown as hours and never typed into the string. Keys `settings.sessionValidity.*`, `settings.chargeGuests.helperSingleUse`, `settings.saveHint.v18`; the general Settings save must never send `session_validity`.
- Member modal Sessions section (UX AD-04) and Guest sessions Used column (UX AD-22): `visit` rows read "Used · visit on [date], [time]", `class` rows "Used · class [name], [date]", `day` rows keep "Covered day"; times are gym-local; a session returned by an Epic 27 void shows as Unused with its original lapse date. The "Desk check-in" source row is Epic 27's; if absent, record a defect against Epic 27, no new source value here.
- All new strings in EN and FR; `scripts/check-i18n-key-parity.mjs` must pass. No mock-ups: design lives as text in the spec files.

## Cross-Story Dependencies

- Depends on Epic 27: `private.record_check_in`, attendance source and void columns, `attendance_counted`, `member_visit_days`, `void_staff_check_in`, `covered_attendance_id` (with its unique index). Reuse these; never redefine them.
- 28.2 depends on 28.1; 28.3 on 28.2. 28.2 releases a session on staff void through 28.1's normalising trigger and stamps through the existing reversal; a void is allowed even when a later same-day visit exists.
- Regression gate for every story: the listed existing guest-session pgTAP suites (check-in and class session gates, charge-guests, desk/in-app session payment, loyalty guest rule and sweep, session refund, alert cooldown, guest-sessions overview) and vitest suites (`sessionState`, `guestSessions`, `MemberModal.sessions`, `support.identityLeak`) pass with no fixture edits. Only `support_capabilities.test.sql`, the audit-label test (`apps/dashboard/app/(dashboard)/audit/auditLabels.ts` mapping), and the one `class_single_use_unsupported` case (28.3) may change. `suspension_rpc_coverage.test.sql` and the `check_in()` source check in 0111's verify block must still pass with the new ordering.
- Epic closing gate (28.3): full `scripts/ci-local.sh`; FR-236..FR-239, NFR-021 and NFR-028 each trace to a named passing test; E2E `apps/dashboard/e2e/single-use-validity.spec.ts`; `sprint-status.yaml` last_updated entry.
- Spine decisions: AD-55, AD-61 (setter), AD-32, AD-29, AD-28, AD-30, AD-31, AD-21, AD-35, AD-39.

## Workflow

- Branch `epic/28` from master; one `story/28-N-…` branch per story, merged into `epic/28` after review and a green `scripts/ci-local.sh`; master and GitHub Actions only at epic end, then production release in the usual order (R2 backup, migrations, dashboard deploy). Owner browser QA once at the end of the epic.
