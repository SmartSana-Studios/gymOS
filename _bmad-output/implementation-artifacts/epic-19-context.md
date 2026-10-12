# Epic 19 Context: Session Guests — Per-Visit Paid Sessions

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Gyms can turn on "Charge guests per session". A Pay-per-session member then checks in, or is marked attended at a class, only with a paid or free session. One session covers the whole gym-local day, and an unused paid session lapses after 7 days. Staff record the session payment from a session-required front-desk alert, guests can pay in the app by Tara Money, offline scans are verified on sync, refunds follow data-layer rules, and owners see paid sessions, blocked attempts and who collected on a Guest sessions card. This is the first epic that depends on the CI guardrails in 19.1/19.2, so those ship first. Everything is off for every gym until an Owner/Supervisor enables it, which keeps live gyms unaffected.

## Stories

- Story 19.0: V1.6 release readiness ops checklist (non-code, product owner)
- Story 19.1: CI guardrails — live-role lint gate & hosted-privilege check
- Story 19.2: Flagged-payment reason (late vs. wrong account) (migration 0106)
- Story 19.3: Charge-guests setting, session record & plan-type rules (migration 0107)
- Story 19.4: Desk session payment (migration 0108)
- Story 19.5: In-app Tara Money session payment (migration 0109)
- Story 19.6a: Front-desk alert `kind` refactor, no behavior change (migration 0110)
- Story 19.6b: Check-in gate, blocked attempts & session-required alert (migration 0111)
- Story 19.7: Class attendance consumes a session (migration 0112)
- Story 19.8: Session refunds & revenue line (migration 0113)
- Story 19.9: Dashboard — setting, session alert, member sessions & plan lock (built as 19.9a setting, 19.9b session alert + record panel + member sessions, 19.9c payments purpose ledger)
- Story 19.10: Guest sessions Overview card (migration 0114)
- Story 19.11: Member app — pay for your session, offline verification & lapse
- Story 19.12: V1.6 session guests enablement (migration 0115)

## Requirements & Constraints

- A session guest is an ordinary member on a Pay-per-session plan; the plan price is the session price; price 0 is exempt from the gate. A one-tap "Session guest" waiver preset exists for the registration fee, but there is no auto-waive.
- The setting is per gym, owner/supervisor only, defaults off for existing gyms and on only for gyms created after 19.12. Turning it on shows the affected-member count and an old-app-version warning.
- Session payment amount always comes from the plan server-side. One payment in flight per member and purpose. Late Tara confirmation of a session payment applies and is audited; a wrong-account payment never creates a session.
- Consumption is atomic and database-enforced: one session per member per gym-local day; the soonest-lapsing usable session is used first (paid before free on a tie); server receipt time governs, including offline scans verified on sync.
- A refused check-in stores a blocked attempt (counted once per scan id) and raises one active session-required alert per member. Dismissing an alert never changes Guest sessions figures.
- Refunds: an unused session is voided; a consumed session stays consumed and the stamp reversal hook is called. Plan type is locked once subscriptions exist; type/price changes are audited and never alter paid sessions.
- Class booking stays free; only marking attendance consumes a session.
- Counts are server-side aggregates. All new strings are bilingual EN/FR, and "session" is always qualified in EN ("paid session"). Staff actions are audited with event labels.
- Out of scope: loyalty/stamps/free sessions (Epic 20), a minimum app version gate (old builds show their expired screen to a refused guest), physical access control, a new Edge Function.

## Technical Decisions

- `payments.purpose` gains `session`. The change amends in one migration: the CHECK, the purpose/void protect trigger, the staff-insert policy clause, the notification skip and the revenue line. Each purpose's effect is a single shared `private.` function called from every completion path.
- `guest_sessions` is the single session record: XOR of `payment_id` or `loyalty_grant_id` (no FK yet), `usable_until`, `consumed_at`, `covered_day`, `voided_at`. It has staff and own-member SELECT only, with no write policy or write grant for any role. A partial unique index on `(member_id, covered_day)` covers non-voided consumed rows.
- `private.consume_guest_session(member_id, gym_id, receipt_at)` returns covered/consumed/denied/exempt. It is the only consumption path, called by `check_in()` (online and sync) and `mark_class_attendance()`. It re-checks the flag, plan and price before locking and uses `private.gym_local_day_bounds()`. It calls a no-op `on_session_consumed()` hook, and the refund path calls a no-op `on_session_refunded_after_consumption()` hook (both are filled by Epic 20).
- `check_in()` keeps its `RETURNS attendance_events` contract, where null means blocked. Never add a coded row, because old builds read any non-null row as success. The current build maps null at a charging gym to the session-required state by reading the latest attempt. Direct INSERT/UPDATE/DELETE on `attendance_events` and `class_bookings` is revoked for authenticated/service_role (grep for service-role writers first).
- Canonical lock order: `class_sessions` → payment → member (`FOR NO KEY UPDATE`) → `attendance_events` → `subscriptions` → `guest_sessions` → `loyalty_progress`. `complete_verified_payment` takes the member lock on every purpose branch.
- Flagged payments get a reason discriminator (late confirmation vs wrong account vs expired attempt vs reconciliation mismatch).
- `front_desk_alerts` gets a `kind` column; `status` becomes nullable under a kind-aware CHECK; the one-active index is rebuilt. Every `ON CONFLICT (member_id, status)` site (0034, 0068, 0090) is rewritten in the same migration, and the column-protect trigger pins `kind`. `session_attempts` (unique on gym, member, scan id) is the only source of blocked counts.
- Setting setter: one audited RPC with role check via `private.current_member_role()` and its own BEFORE UPDATE pin trigger. Add the column `NOT NULL DEFAULT false`, then `SET DEFAULT true` in 19.12; never `ADD COLUMN … DEFAULT true`. Plan type/price changes only via a definer RPC.
- Session refunds are an AFTER INSERT trigger on `refunds`. Tara session payments reuse `payment-webhook`'s purpose dispatch.
- Kill switch: from 19.6b, `check_in()` and `mark_class_attendance()` read the flag before any V1.6 code.
- CI: the AD-3 grep-lint gate blocks new `auth.jwt() ->> 'app_role'` reads (grandfather list); use `private.current_member_role()`. Migrations are numbered from 0106 (renumber if another lands first); each has pgTAP positive plus `.negative` files, a `do $verify$` self-check where it backfills, regenerated `packages/types/src/database.ts`, and a suspension-gating test for new RPCs.

## UX & Interaction Patterns

- New platform-fixed `info` status token (blue), used only for recoverable action-required or pending states, always with label and icon; never `danger` and never accent-overridden.
- Member app: MA-10 gets two full-screen `info` overlays ("Pay for your session", "Check-in saved — your session will be verified"); a free-session check-in uses the green success with a "Free session used" sub-line. MA-09 shows a sessions line on the status card, a conditional [Pay for a session] action and a dismissible post-sync denial notice. MA-17 `/pay-session` mirrors `/renew` with its payment phases and an error table, and is offered only when charging is on, Tara is connected and price > 0.
- Dashboard: the front-desk alert panel has a session-required variant (same component, `aria-live="assertive"`, [Record session payment], an in-flight Tara line). A Record Session Payment panel has a fixed amount, Cash default, and Bank Transfer only for manager+. The class roster "Attended" shows an inline message with the same payment action. MemberModal gains Sessions and [Record session payment].
- Settings: a toggle with a confirmation dialog that saves on its own and is excluded from [Save Settings]. Overview: Guest sessions card (manager+, absent when charging is off) plus a revenue sub-line. AD-22 Guest Sessions page (paid / blocked / free tabs). AD-09 gets a Purpose filter and reason tags, and AD-12 audit labels cover the Epic 19 events.

## Cross-Story Dependencies

- 19.0 and 19.1 first and in parallel. 19.1 → {19.2, 19.3, 19.6a} → 19.4 → {19.5, 19.6b, 19.8} → 19.7 → {19.9a/b/c, 19.10, 19.11} → 19.12 last.
- 19.6a changes the existing subscription-alert path on every live gym, so it ships alone and runs in production for at least a week before 19.6b.
- 19.12 flips the default only after 19.0 sign-off and the 19.11 mobile build is in the stores.
- Epic 20 fills the stamp hooks and the `loyalty_grant_id` FK left here; the Guest sessions "free given" count stays 0 until then. The registration fee (Epic 18) gates a session payment for an awaiting member.

## As-built reconciliation (retro 2026-10-12)

Corrections from `epic-19-retro-2026-10-12.md`; the sections above stay as planned.

- **`check_in()` null contract.** On hosted PostgREST 14.5 a NULL composite arrives as an all-null row, not JSON null. Mobile builds before 1.1.0 therefore show a false success on a refused scan, not their expired screen, so the Out-of-scope line "old builds show their expired screen to a refused guest" holds only for builds that map a null/all-null row (1.1.0+, promoted as 1.5). The current build treats an all-null row as a refusal. Charging was on for 0 gyms at close-out.
- **Direct DELETE on `class_bookings` stays granted.** 0112 moved INSERT/UPDATE to column grants that omit `attended_at` and kept DELETE for `authenticated`/`service_role` (`cancel_class_booking()` and the e2e teardown use it). Revoking it is an open decision, not done.
- **Story 19.9 split** into 19.9a/19.9b/19.9c. The AD-08 "Last Payment ignores session" guard is vacuous: the Subscriptions page has no Last Payment column (`docs/decisions.md`, 19.9c).
- **Migration 0116** (session-required alert cooldown, BEFORE INSERT trigger, 15 minutes after a dismissal unless a session was bought since) was added ad hoc after local QA; it has no story. Epic 20's planned 0116-0119 are therefore shifted by one: next free migration is 0117.
- **Gate overrides recorded by the owner:** the 7-day soak between 0110 and 0111 was waived after a live alert test, and 0115 was applied with the tested-restore, secret-rotation and Epic 18 item 22 gates open (`docs/v1-6-staged-deploy.md`).
