---
title: '27-2 One check-in insert path: private.record_check_in'
type: 'refactor'
created: '2026-11-15'
status: 'ready-for-dev'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-27-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `check_in()` is the only inserter of `attendance_events` and holds the lock, gate and insert logic inline, taking the member lock only at charging gyms. Story 27.3 needs a staff check-in that follows exactly the rules of a scan, and a second hand-copied body would let the two drift.

**Approach:** Move gate, lock, replay, status, open-row, session gate, clamp and insert into `private.record_check_in` (member lock first for every gym), reduce `check_in()` to role gate, call and outcome mapping, and add the source/void columns and the `voided_at`-aware one-open index. A scan behaves identically, proved by a characterisation test committed before the migration and passing unedited after it.

## Boundaries & Constraints

**Always:** The AC text in `epics.md` "Story 27.2" is the acceptance baseline; this spec adds the code facts found at planning time. `check_in()` keeps its signature, `RETURNS attendance_events`, role gate, grants and the contract that a refusal returns SQL `NULL`. `record_check_in` is SECURITY DEFINER, `search_path public`, EXECUTE revoked from `public`, `anon`, `authenticated` in the same file. Its first statement is the member lock (`FOR NO KEY UPDATE`). `entered_by` is set only when `p_source = 'staff'` (a scan passes `auth.uid()` and it is ignored). The one-open index keeps its name. `check_out()`, `check_out_member`, the auto-timeout job and the 0111 write revokes are unchanged. The only existing test edited besides 27.1's reader list is `suspension_rpc_coverage.test.sql`. Migration number is the next free at merge time (0174, files end at 0173); rollback `scripts/rollback-0174-record-check-in.sql`.

**Never:** No `dirty_from` or engagement objects (Epic 30). No staff behaviour: no `staff_check_in`, no void function, no `session_attempts` `staff` source, no UI (27.3). `record_check_in` writes no `front_desk_alerts` and no `session_attempts` rows (a staff entry makes none, FR-249); `check_in()` writes them after mapping a `blocked_*` outcome. No mobile code change. No edit to any `check_in_session_gate*`, `check_in_one_open_session_enforcement`, `check_out_manual_auto_timeout`, `class_session_gate*`, `loyalty_*`, `session_*`, `front_desk_alert_kind*` test.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Scan accepted | active member, no open row | row returned, `source='qr'`, `entered_by` null, `visit_day` set; yellow alert for expiring_soon / grace_period | N/A |
| Blocked expired / no plan | status null or expired | `NULL`; red alert row as before | N/A |
| Blocked session | charging gym, Pay-per-session, no usable session | `NULL`; `session_attempts` row (conflict-skipped per scan id) and `session_required` alert; stale auto-close still commits | N/A |
| Already open | non-stale open row | raises `check_in: member … already has an open check-in` | same text and SQLSTATE |
| Replay | same `client_scan_id`, same member | existing row, nothing inserted | N/A |
| Suspended gym | gym not active | raises `check_in: gym … is not active` | same text |
| Open row with `voided_at` set (fixture) | | does not block a new check-in | N/A |
| Concurrent scans, non-charging gym | two sessions, one member | second waits on the member lock; one open row, one consumed session | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0124_live_authorization_database.sql:765-1036` -- the live `check_in()` body (no later migration redefines it; local DB confirms). Mirror its order exactly; today the lock is taken only `if v_charging` (886) and after the FR-031 block, the replay short-circuit precedes the gym-status check (823, 840), deactivation raises (849), the stale branch audits `attendance_stale_check_in_auto_closed` (912), the gate calls `private.consume_guest_session(member, gym, now())` (941), the offline-immediate-stale close with `'source','offline_sync'` audit follows the insert (1012).
- `private.consume_guest_session` (0111/0118/0120, live) -- already takes the member lock, already calls `private.on_session_consumed` (the loyalty stamp), returns `exempt|covered|consumed|denied`. Reuse unchanged; there is no separate loyalty call in `check_in()`.
- `supabase/migrations/0173_attendance_counting.sql` -- `attendance_counted` (118-130, explicit column list, no `source`), `private.gym_local_date(gym, timestamptz)`, the BEFORE INSERT `visit_day` trigger (stays as the backstop). `visit_day` is passed explicitly from `private.gym_local_date(p_gym_id, v_checked_in_at)`.
- `supabase/migrations/0141_support_proxy_actor.sql:105` -- `private.actor_id()`; 27.3 passes it as `p_actor`. `users(id)` is the reference for `entered_by` and `voided_by` (as `payments.actor_id`).
- `supabase/migrations/0111_check_in_session_gate.sql:576-585` -- verification-block pattern checking a body contains `consume_guest_session`; copy for the new migration's own verify block.
- `supabase/tests/suspension_rpc_coverage.test.sql:303-380` -- two assertions scan `public` secdef bodies matching `current_gym_status() is distinct from 'active'`. After the move `check_in()` no longer matches and drops out silently (the comment at 11.9 warns of this exact trap). Edit: require the guard before the first write inside `private.record_check_in`; require every public function that touches `attendance_events` either carries the guard first or calls `record_check_in`, and that in `check_in()` the `record_check_in` call precedes its first `insert into`; keep the seeded-offender case failing.
- `supabase/tests/attendance_counting.test.sql:463-520` -- the committed reader list (`pg_temp.attendance_readers_outside_list`, and a count of 4 committed function readers). Add `function private.record_check_in(...)`; `check_in(timestamptz,uuid)` stays listed (its `RETURNS attendance_events` signature still matches); count 4 -> 5; plan adjusted. Add two enumerations: exactly one `pg_proc` body with `insert into attendance_events` (`private.record_check_in`), and updaters exactly `record_check_in`, `check_out`, `check_out_member`, `run_check_in_auto_timeout_job`.
- `apps/mobile/src/services/checkin.ts:121` -- matches `idx_attendance_events_one_open_per_member` in the 23505 text; the name must survive.
- `scripts/session-refund-race.sh` -- shape for the new `scripts/check-in-member-lock-race.sh` (runs inside the DB container, detached and polled, verdict is the last transcript line).
- `packages/types/src/database.ts` -- regenerate; hand-splice only this story's columns and signatures if the CLI carries drift (27.1 precedent). `docs/decisions.md` -- newest-first entry; re-verify cited line numbers after adding it.
- Local DB: reset to head by the owner on 2026-11-15; `attendance_counted`, `visit_day` and the 27.1 triggers are present.

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/tests/check_in_record_path.test.sql` -- characterisation test of the UNMODIFIED `check_in()`, its own commit before any migration: every matrix state of the epics AC (FR-031 four statuses, deactivated, registration fee due, no plan, suspended gym, Pay-per-session covered / consumable paid / consumable free / denied, 0 XAF exempt, open check-in, stale open, replay, offline inside window, future clamp, offline older than window), recording return, exception text and side-effect row counts (`attendance_events`, `front_desk_alerts` kind, `session_attempts`, consumed `guest_sessions`, `loyalty_events`, `audit_log` action types) -- the "scan is identical" proof; shown passing before the migration
- [ ] `supabase/migrations/0174_record_check_in.sql` -- columns `source`, `entered_by`, `voided_by`, `void_reason` with the CHECKs; `CREATE OR REPLACE VIEW attendance_counted` appending `source`; swap `idx_attendance_events_one_open_per_member` (same name, `where checked_out_at is null and voided_at is null`, one transaction); `private.record_check_in` (lock, replay, gym status, deactivation, FR-031, `voided_at is null` open lookup and stale close, session gate, clamp, insert with explicit `visit_day`, offline-immediate-stale close); `check_in()` rewritten to gate, call, map (alerts and `session_attempts` written here); re-assert revokes; verify block (`record_check_in` contains `consume_guest_session` and `current_gym_status`, `check_in` contains `record_check_in`)
- [ ] `scripts/rollback-0174-record-check-in.sql` -- restore the 0124 `check_in()`, the old index predicate, the old view, drop `record_check_in` and the four columns (valid: no row is staff or voided before 27.3)
- [ ] `supabase/tests/record_check_in.test.sql` -- column CHECK matrix, index swap (second open refused with same SQLSTATE and message; voided open row does not block), `visit_day` explicit equals the trigger backstop, lock statement first in `prosrc`, EXECUTE revoked from `public`/`anon`/`authenticated`, direct-write revokes re-asserted, a seeded `record_check_in(...,'staff',...)` fixture call sets `entered_by`, `attendance_counted` carries `source` and never `entered_by`
- [ ] `supabase/tests/suspension_rpc_coverage.test.sql`, `supabase/tests/attendance_counting.test.sql` -- the edits named in the Code Map; both shown failing against a seeded offender
- [ ] `scripts/check-in-member-lock-race.sh` -- holds the member lock in one session, calls `check_in()` in a second at a non-charging and a charging gym; second blocks until commit; two simultaneous scans leave one open row and one consumed session
- [ ] `packages/types/src/database.ts`, `docs/decisions.md` -- types; entry that `record_check_in` is the only inserter, naming the updater list, and why alerts stay in `check_in()`
- [ ] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- status transitions and a `last_updated` line

**Acceptance Criteria:**
- Given the 27.2 AC set in `epics.md`, when the story closes, then each is met and pgTAP-proven, `check_in_record_path.test.sql` is byte-identical before and after the migration, and the mobile `checkin.test` and dashboard attendance tests pass with no edit.
- Given the whole suite, when `scripts/ci-local.sh` runs on story/27-2 (after an owner-run `supabase db reset`), then every stage line is read and GREEN, and the race script passes.

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Design Notes

`record_check_in` returns a table: `outcome` (`checked_in|blocked_expired|blocked_session|already_open|replayed`), `member_status`, `expiry_date`, the `attendance_events` row. A non-stale open row returns `already_open` with no writes (the stale auto-close is the only write before it, and it only happens when the row is stale), and `check_in()` raises the unchanged FR-044 text for it, so the scan contract is kept and 27.3 maps the same outcome to its coded R7. `check_in()` maps: `replayed` or `checked_in` returns the row; `blocked_*` writes the alert or attempt and returns NULL. Alerts live in `check_in()` because a staff outcome (27.3) never alerts, and a refusal must still commit them, so `check_in()` returns normally after the call.

Gym-status check inside `record_check_in` reads `private.current_gym_status()` (session-resolved, as today and as the coverage test pins). 27.3 must confirm the support-proxy caller resolves that for `p_gym_id`; flagged here, not solved here.

## Verification

**Commands:**
- `bash scripts/ci-local.sh` -- expected: every stage PASS, read per stage, after the owner's `supabase db reset`
- `bash scripts/check-in-member-lock-race.sh` -- expected: last transcript line is the pass verdict
- `bash scripts/ci-local.selftest.sh` -- only if `ci-local.sh` is touched
