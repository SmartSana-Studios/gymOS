# Epic 20 Context: Loyalty Program — Free Sessions & Free Days

<!-- Compiled from planning artifacts (epics.md Epic 20, PRD v1.6 FR-164–FR-170, ARCHITECTURE-SPINE AD-27/AD-30/AD-32) and the Epic 19 as-built reconciliation. Edit freely. -->

## Goal

Guests earn one free session for every N paid sessions consumed; subscribers earn R free days for every K on-time renewals. Members see progress, free sessions and paid-session lapse dates in the app; staff see the same on the member modal. Rewards are granted exactly once, progress resets after 90 idle days, and no role, Super Admin included, can edit a balance by hand. Off by default per gym; only 20.5 exposes the switch, so 20.1–20.4 change nothing a live gym sees.

## Stories

- Story 20.1: Loyalty program setting & ledger foundation (migration **0117**; planned 0116)
- Story 20.2: Guest rule — stamps on paid sessions, free session at N (migration **0118**)
- Story 20.3: Subscriber rule — on-time renewal stamps, R free days at K (migration **0119**)
- Story 20.4: Refund reversal, lapses & 90-day reset sweep (migration **0120**)
- Story 20.5: Dashboard — loyalty settings & member loyalty view (no migration)
- Story 20.6: Member app — loyalty card (no migration; one mobile release)

Migration numbers are the as-built shift (Epic 19 shipped ad hoc `0116`). Latest in tree: `0116_session_alert_cooldown.sql`. Story bodies in `epics.md` still show the old numbers.

## Requirements & Constraints

- FR-164: per-gym program, off by default, Owner/Supervisor only; N 2–50, K 3–24, R 1–30 (nullable only while never configured, required when enabled); live effective-discount readout in the form; every change audited with old/new.
- FR-165: one guest stamp per **paid** session consumption (not at check-in, not free, not a covered re-entry). At N: one free session, counter to 0. Earns only while loyalty **and** charging are on; nothing retroactive. Class attendance also earns (FR-174, via the same consume path).
- FR-166: a free session is a `guest_sessions` row with `loyalty_grant_id`, no payment, usable 60 days (`platform_session_config.free_session_validity_days`), several allowed, consumed under FR-159 ordering, survives plan change (dormant off Pay-per-session).
- FR-167: one subscriber stamp per verified on-time renewal of the current plan (Monthly, Coach-inclusive, Class-only); none for overrides, plan assignment/change, back-dated staff renewal, Pay-per-session, or late renewal; at most one per subscription period. At K: `expiry_date` + R days, counter 0, no payment created. The extended date also moves the next on-time deadline (intended, party-mode 2026-10-11).
- FR-168: 90-day idle reset (subscribers: longer of 90 days and plan duration + grace); windows are platform data in `platform_session_config.loyalty_idle_reset_days`; reads apply the window and never write (OQ-B); a daily sweep persists and audits lapses and resets.
- FR-169: member app Rewards card and dashboard member Rewards section, both from `effective_loyalty` only; no reward push notification.
- FR-170 / NFR-022: no write path for any client role; exactly-once grants under webhook redelivery, retried requests and replayed syncs via unique `(origin_id, event_type)`; ledger replay must equal `loyalty_progress`.
- Out of scope: discounts (nothing changes an amount sent to a provider), manual balance edits or correction screen, reward push, cross-gym loyalty, gym-configurable windows.

## Technical Decisions

- `loyalty_events` append-only, `loyalty_progress` derived (per member per gym, two counters); both SELECT-only for staff of the gym and the member's own rows; writes only by `private.` definer functions. UPDATE/DELETE revoked beneath RLS like `audit_log`.
- `guest_sessions.loyalty_grant_id` (no FK since 0107) gets its FK to the `reward_granted` `loyalty_events` row in 20.1.
- Hooks already in tree, currently no-ops: `private.on_session_consumed()` (0111) filled by 20.2; `private.on_session_refunded_after_consumption()` (0113) filled by 20.4 (stamp reversal).
- `private.award_renewal_stamp(p_payment_id)` is the single subscriber entry point; 20.3 starts by grepping every renewal-verification path (`confirm_renewal`, `renew_subscription`, `complete_verified_payment` subscription branch, 0031 staff queue) and lists them in the migration header.
- Canonical lock order (AD-27): `class_sessions` → payment → member (`FOR NO KEY UPDATE`) → `attendance_events` → `subscriptions` → `guest_sessions` → `loyalty_progress`. `complete_verified_payment` already takes the member lock on every purpose branch (19.5); do not change its locking.
- Setter `set_loyalty_program(p_enabled, p_n, p_k, p_r)`: SECURITY DEFINER, role via `private.current_member_role()` (never JWT `app_role`; 19.1 lint), suspension-aware, one audit row, **its own** BEFORE UPDATE pin trigger (not a branch in `protect_super_admin_only_gym_columns()`, not 19.3's charging pin).
- `effective_loyalty(p_member_id)` is STABLE, never writes, the only read source for app and dashboard.
- Sweep: daily `pg_cron`, own function and transaction, own `job_runs` name, feeds the 19.0 job-runs alert; idempotent via the unique index.
- Migrations: pgTAP positive + `.negative`, `do $verify$` where backfilling, regenerated `packages/types/src/database.ts`, suspension-gating test for new RPCs, rollback script under `scripts/` like 0110–0116.

## UX & Interaction Patterns

- Settings (AD-13): own [Save loyalty program] section excluded from [Save Settings]; live `aria-live="polite"` readout after a 300 ms pause; inputs disabled while off (keeping values); info line when Charge guests is off; lowering note; switch-off inline note; submit-only validation (UX-DR11/UX-DR27).
- Member modal (AD-04 View mode): Rewards section, no edit control for any role, muted "Balances change only through the program's rules."
- Member app (MA-09): flat Rewards card between quick actions and Upcoming Classes, only the counter that matches the current plan, Session Chip rows, once-per-grant headline tracked on device, R-days "new renewal date" line, absent (not empty) when off and nothing held. Never `raised`.
- Audit (AD-12): loyalty event labels in EN/FR, Actor "System" for rule-driven events (UX-DR31).
- EN/FR parity for every string; "session" always qualified in EN.

## Cross-Story Dependencies

- 20.1 → {20.2, 20.3} in parallel → 20.4 → {20.5, 20.6}.
- 20.2 needs 19.6b's hook; 20.4 needs 19.8's refund hook and both 20.2/20.3 event types.
- 19.10's Guest sessions card "free given" already counts `loyalty_grant_id` rows (0114); confirm only.
- Epic 21 is independent; if it ships first it takes the next free migration number and Epic 20 renumbers.

## Epic 19 carry-over that touches this epic

- **PostgREST 14.5 null composite:** any new RPC whose contract relies on a null composite must be exercised through real PostgREST before review (`scripts/epic19-qa` pattern; retro S-1/P-1).
- Refund-vs-consume race: `scripts/session-refund-race.sh` is manual-only; run it for any edit touching lock order in `consume_guest_session` / `apply_session_refund` (retro R-1, action 1).
- `class_bookings` DELETE and `platform_metrics()` semantics were decided 2026-10-12 (`docs/decisions.md`); no Epic 20 impact beyond the next migration touching `class_bookings`.
- Ad hoc production changes get a short spec or `decisions.md` entry (retro P-2/action 10).
- Open owner gates from Epic 19 (tested restore, key rotation, payment-webhook deploy) are not Epic 20 blockers but precede first gym enabling loyalty.
