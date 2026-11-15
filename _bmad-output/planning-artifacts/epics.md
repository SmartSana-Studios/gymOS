---
stepsCompleted: [1, 2, 3, 4]
status: final  # V1.8 update complete: Epics 27-31 (21 stories); Could items FR-221/234/235 deferred: V1.7 update complete (Epics 22-25, 37 stories); Epics 1-21 and 26 unchanged
v17UpdateStepsCompleted: [1, 2, 3, 4]
v18UpdateStepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-gym_os-2026-06-20/prd.md
  - _bmad-output/planning-artifacts/prds/prd-gym_os-2026-06-20/addendum.md
  - _bmad-output/planning-artifacts/architecture.md
  - _bmad-output/planning-artifacts/architecture/architecture-gym_os-2026-08-11/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/DESIGN.md
  - _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md
  - _bmad-output/planning-artifacts/sprint-change-proposal-2026-08-11.md
  - _bmad-output/planning-artifacts/prds/prd-gym_os-2026-06-20/prd.md (v1.7, 2026-10-15)
  - _bmad-output/planning-artifacts/prds/prd-gym_os-2026-06-20/prd.md (v1.8, 2026-11-15; FR-219-FR-251, NFR-027-NFR-029; addendum section M)
  - _bmad-output/brainstorming/brainstorm-member-engagement-streaks-calendar-2026-11-14/brainstorm-intent.md
  - _bmad-output/brainstorming/brainstorm-member-engagement-streaks-calendar-2026-11-14/v1.8-gym-feedback.md
---

# gym_os - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for gym_os (GymOS), decomposing the requirements from the PRD, UX Design, and Architecture into implementable stories.

Epics 1–8 are the shipped V1.0 pilot scope (`done` per `sprint-status.yaml`). Epics 9–13, plus the Epic 4 and Epic 6 extensions, are V1.5 "Beta-Ready" scope, added per the 2026-08-11 sprint-change-proposal following the V1.5 PRD merge and the corresponding architecture pass (`ARCHITECTURE-SPINE.md`, AD-3/AD-6/AD-14/AD-15/AD-21/AD-24). No UX mockups exist yet for V1.5 features — acceptance criteria below are anchored in FR/AD wording; UI detail is expected to be refined by a follow-up `bmad-ux` pass before dev work on the more visual stories (progress charts, class booking, workout-plan authoring) begins.

## Requirements Inventory

### Functional Requirements

**6.1 Platform Foundation**
- FR-001: Phone number is the primary identity; one phone maps to one platform user account; a user may be a member at multiple gyms via separate `members` rows.
- FR-002: Registration requires phone verification via OTP; no email-based registration in V1.
- FR-003: Role hierarchy (Member → Coach → Receptionist → Manager → Owner → Super Admin) is enforced via PostgreSQL RLS; `gym_id`/`role` claims injected into the JWT via a Database auth hook (sprint-1 spike); missing claims default to deny-all; RLS rejections show "You don't have permission to do that" and log to Sentry.
- FR-004: Super Admin is a platform-level role, not scoped to any gym, and can act across all tenants.
- FR-005: Each gym is a fully isolated tenant; RLS enforces isolation at the database layer on every query.
- FR-006: The data model supports hundreds of gyms and thousands of members per gym without schema changes.

**6.2 Gym Setup & Onboarding**
- FR-007: V1 gym onboarding is founder-assisted; no self-serve gym signup flow.
- FR-008: The dashboard includes an all-or-nothing CSV import tool with a standardized template (member_name, phone, plan_type, join_date, subscription_status, expiry_date); per-row validation errors shown with row number and reason; expiry date required for all non-pay-per-session plans.
- FR-009: Historical payment and attendance records are not migrated; imported members start with a clean history.
- FR-010: Onboarding configures gym name, logo, primary color, timezone (default Africa/Douala), preferred language, grace period duration, and gym capacity.

**6.3 White-Label Branding**
- FR-011: One app binary serves all gyms, published as "GymOS"; gym-specific branding applies at runtime; branding cached on-device for 24 hours.
- FR-012: Settings page lets the Owner upload a logo (Supabase Storage/CDN), set gym name and primary hex color; changes propagate within 24 hours.
- FR-013: Per-gym App Store listings, custom fonts, and full theme systems are out of V1 scope.

**6.4 Localization**
- FR-014: Platform is bilingual (English + French) from V1 across all UI strings, push copy, onboarding, and error messages.
- FR-015: Language is selected at onboarding start (before phone entry), defaults to device locale, is user-selectable from profile at any time, and persists per account across devices.
- FR-016: All string literals are externalized via an i18n library; CI fails builds containing hardcoded UI strings.
- FR-017: Receipts and payment confirmations follow the gym Owner's language preference.
- FR-018: The i18n foundation supports additional languages without rework.

**6.5 Member Management**
- FR-019: Manager/Owner can create, view, edit, and deactivate member records; soft-delete only.
- FR-020: Member records store name, phone, optional email/DOB/photo, join date, current plan, subscription status, and optional emergency contact.
- FR-021: Receptionist can view/search member records and initiate payments, but cannot create/edit/deactivate.
- FR-022: Coaches can view only their assigned members' profiles.
- FR-023: Members can view/edit their own profile (name, photo, language); phone number changes require admin intervention.
- FR-082: Creating a member generates a personalized onboarding invitation (name, gym name, deep link) that the gym admin sends via SMS/WhatsApp from the dashboard; the deep link pre-associates the phone number so OTP is the first screen shown.
- FR-083: Deactivating a member immediately sets subscription to `expired`, revokes check-in access, retains history-view access, sends no automated push, and is audit-logged with actor + mandatory reason + timestamp.

**6.6 Membership Plans**
- FR-024: V1 plan types: Pay-per-session, Monthly, Coach-inclusive, Class-only; Travel mode deferred to V2.0.
- FR-025: Plan definitions (name, price in XAF, duration, access type) are configurable per gym; monthly and annual billing intervals supported from V1 with gym-set annual discount; billing interval stored independently of tier/price.
- FR-026: All monetary values stored as integers (whole XAF) with an explicit `currency` column; no floating-point monetary storage; V1 currency is XAF only, schema multi-currency-ready.

**6.7 Subscription Lifecycle**
- FR-027: Subscription state machine `active → expiring_soon → grace_period → expired`, driven by a nightly Supabase pg_cron job (02:00 Africa/Douala); job failures are logged to the audit log and surfaced as a Super Admin alert; no auto-retry, no retroactive backfill.
- FR-028: `expiring_soon` triggers 7 days before expiry.
- FR-029: `grace_period` begins the day after expiry; duration gym-configurable, platform default 3 days.
- FR-030: `expired` is set when grace period ends without renewal; member loses gym access but retains app account/history.
- FR-031: Two check-in outcomes for non-active members: accepted (green + yellow dashboard alert) for expiring_soon/grace_period; rejected (red screen + red dashboard alert) for expired.
- FR-032: Renewal resets subscription to `active`, sets new expiry, dismisses the alert immediately, sends push N-04, and appears in payment history immediately.

**6.8 Payments**
- FR-033: V1 payment methods: MTN Mobile Money and Orange Money (automated via Notch Pay), Cash, Bank transfer, Manual mobile money (all manual, mandatory reason).
- FR-034: Notch Pay is the sole V1 aggregator, built behind an internal `PaymentProvider` interface; gated by a one-day sandbox spike (auth, initiate, webhook, idempotency) recorded in `docs/decisions.md`; Payments Epic does not begin on an unverified provider.
- FR-035: Payment webhooks are processed idempotently via a unique constraint on the provider transaction reference.
- FR-036: A nightly reconciliation job matches provider-confirmed payments against internal records; discrepancies (missing internal record, `processing` record with no webhook within 10 minutes, amount mismatch) are flagged on the Payments dashboard.
- FR-037: The Payments page includes a verification queue; Receptionist/Manager can mark queued payments verified or flag for review.
- FR-038: Manual payment entries require payment method, amount, member, auto-populated actor, mandatory reason, and auto-populated timestamp — none optional.
- FR-039: Notch Pay transaction fees are passed through to gyms by default; member-pays-surcharge deferred.
- FR-040: Refunds are recorded (amount, reason, actor, timestamp) in V1; provider-executed refund API calls deferred; audit-logged.
- FR-041: The system generates a payment receipt (member, gym, plan, amount, currency, method, date, transaction reference, actor) for each successful payment.

**6.9 Attendance & Occupancy**
- FR-042: Members check in by scanning the gym's static entrance QR from the member app, recording an attendance event.
- FR-043: The QR encodes a non-guessable per-gym `gym_token`; unresolved tokens show "QR code not recognized"; QR is downloadable/printable from Settings.
- FR-044: Only one open check-in per member at a time (partial unique index); stale open check-ins auto-close (via timeout calc) and are audit-logged.
- FR-045: Check-out is manual (member or receptionist) or automatic via configurable timeout (default 8 hours), executed by the same pg_cron job.
- FR-046: Occupancy = current checked-in members ÷ configured gym capacity.
- FR-047: Member-facing occupancy uses three bands (Low <30%, Medium 30–70%, Busy 71–90%); 91%+ "Full" and raw counts are admin-only.
- FR-048: Admin Attendance page shows current check-ins, today's count, and a filterable check-in/out log.

**6.10 Retention Triggers — Front-Desk Alert**
- FR-049: A check-in event (accepted or rejected) for `expiring_soon`/`grace_period`/`expired` members publishes a real-time alert (yellow grace alert or red denied alert) to all active dashboard sessions via Supabase Realtime.
- FR-050: Alert shows member name, photo, status, days until/since expiry, and a "Renew" button opening an inline renewal panel (pre-populated plan/price/date); max 3 taps for a straight-through cash renewal.
- FR-051: Simultaneous alerts stack (newest on top, max 5 visible, older scroll); each alert is individually dismissible (writes `dismissed_at` + user ID) or auto-dismisses after a gym-configurable duration (default 30 min); a new alert fires on re-scan if dismissed without renewal.
- FR-052: End-to-end latency from QR scan to dashboard alert is under 3 seconds under normal network conditions.

**6.11 Coach Portal (V1)**
- FR-053: Coach Portal is a role-gated dashboard section; Coach role sees only the Coach Portal.
- FR-054: V1 features: assigned member list (sortable, status shown), member profile view (incl. goal/experience), and coach-attributed session notes (add/view/edit); expired members remain visible without auto-notification; coach-to-receptionist escalation deferred to V1.5.
- FR-055: Manager/Owner assigns members to coaches (at most one active coach per member); reassignment ends the prior assignment with `ended_at`; prior coach's notes stay visible to Owner/Manager only, not the new coach; historical assignments queryable.
- FR-056: Workout plan management and class scheduling are deferred to V1.5.

**6.12 Member Mobile App**
- FR-057: Single React Native + Expo + TypeScript codebase ships to Android and iOS via EAS Build + Submit (bundle ID `com.gymos.app`); both platforms ship together.
- FR-058: First-launch onboarding sequence: language selection → phone entry → OTP verification (60s countdown, max 3 resends, 5-min lockout) → profile setup → goal selection → experience level → plan confirmation.
- FR-059: Home screen shows gym branding header, subscription status/expiry, quick actions (Check In / View Plan / Profile), and recent activity summary.
- FR-060: Check-In screen scans the static gym QR with five defined states: success, success-offline, wrong QR, already checked in, expired-denied.
- FR-061: Offline check-in only — recorded locally in SQLite, synced on reconnect; if sync lands after the auto-timeout window, server closes it at `scan_time + timeout_duration`; alert fires at sync time, not scan time; no other flows support offline.
- FR-062: Members can view current plan details, expiry date, payment history, and past check-ins.
- FR-063: Profile screen includes a language selector and photo upload; language changes take effect immediately without re-login.

**6.13 Gym Admin Dashboard**
- FR-064: Next.js gym admin dashboard with role-gated pages: Overview (Receptionist+), Members (Receptionist+; create/edit/deactivate/invite Manager+), Subscriptions (Manager+), Payments (Receptionist+), Attendance (Receptionist+), Audit Log (Manager+), Settings (Owner), Coach Portal (Coach).
- FR-065: The Overview front-desk alert panel is the primary renewal-action surface; real-time via Supabase Realtime, no refresh required.
- FR-066: Members page supports search (name/phone), status filter, and CSV export (max 1,000 rows; specified export columns).
- FR-067: Payments verification queue shows unverified manual payments ordered by submission time with member/amount/method/receptionist/reason.
- FR-068: Audit Log page is read-only, paginated at 50/page, CSV export for Owners.
- FR-069: Settings page lets the Owner configure gym name, logo, primary color, timezone, default language, grace period, capacity, alert auto-dismiss duration, and QR download/regeneration.
- FR-085: Subscriptions page provides a sortable/filterable record list, Manager/Owner-only access, inline manual renewal panel, CSV export (same limits as Members), and back-datable renewal start date for grace/expired members.

**6.14 Super Admin Dashboard**
- FR-070: Separate Next.js Super Admin app, sharing the Supabase project, accessible only via a distinct URL/auth flow; the role bypasses per-gym RLS with all access audit-logged.
- FR-071: V1 Super Admin capabilities: gym list, gym creation (founder-onboarded, triggers SMS invite), gym suspend/deactivate/reinstate, platform metrics, tier CRUD (name/monthly price/annual price/member cap), gym tier assignment/cap override.
- FR-072: Super Admin access to individual member/payment data within a gym requires an explicit, audit-logged support escalation action.
- FR-073: Three default tiers (Hustle 1–30, Grind 31–100, Elite >100 members), all with the same feature set; names/prices/thresholds Super Admin-configurable; new tiers can be added without a code deployment.
- FR-086: Member cap enforcement blocks new member creation at the API level when a gym reaches its tier cap (active + deactivated count both count); dashboard shows an upgrade-prompt message; Super Admin can override the cap or move the gym to a higher tier.

**6.15 Push Notifications**
- FR-074: All push notifications route through Expo Push Notification Service → FCM/APNs; no direct FCM/APNs integration.
- FR-075: V1 notification schedule: N-01 (expiring 7d), N-02 (expiring 1d), N-03 (expired), N-04 (payment confirmed), N-05 (payment failed) — all V1; N-06 (quiet-gym) and N-07 (class reminder) are V1.5.
- FR-076: Notification preferences stored per member in `member_preferences`; members can opt out of non-critical notifications (N-06, N-07); lifecycle (N-01–03) and payment (N-04/05) notifications cannot be opted out of in V1.
- FR-077: Push tokens stored per device; tokens returned invalid by FCM/APNs are cleaned up automatically on the next delivery attempt.
- FR-078: All notification copy is available in English and French, served per member's language preference.

**6.16 Audit Log**
- FR-079: Audit log is append-only at the database level; no role (including Super Admin) can UPDATE or DELETE audit records, enforced via RLS and absent grants.
- FR-080: Audit records are generated for manual payment entries, verifications, refunds, member deactivations, coach assignment changes, Super Admin gym-data escalations, and pg_cron job failures; each record captures actor, action type, target entity, relevant fields, and UTC timestamp.
- FR-081: Audit Log page is filterable by date range and actor; CSV export available to Owners.

**6.17 Staff Management (Owner Self-Serve) — V1.5**
- FR-087: Owner can create staff accounts (Supervisor, Manager, Receptionist, Coach) for their own gym; a Supervisor can create Manager/Receptionist/Coach only; no role may create a role equal to or above its own rung (Owner > Supervisor > Manager > Receptionist > Coach); captures full name, E.164 phone, and role; audit-logged.
- FR-088: A newly created staff member is provisioned like V1.0 owner activation — SMS with temp password + dashboard link; account is `pending_activation` until first login, which requires setting a new password.
- FR-089: Owner/Supervisor can edit a staff member's name and role, and deactivate (soft-delete) a staff account; the same role-ceiling rule applies to edits (cannot raise a target to equal/above own rung, cannot edit own role at all); deactivation revokes access immediately via the FR-090 mechanism and is audit-logged with a mandatory reason; a deactivated Coach's notes/plan authorship are retained, visible to Owner/Manager.
- FR-090: Role changes take effect immediately, not on next token refresh — a server-side role-version/session-invalidation check at the auth-hook/RLS layer rejects a demoted or deactivated user's existing JWT the moment it runs.
- FR-091: One phone maps to one platform user (FR-001); a person may hold different roles at different gyms (separate bindings), but not two roles at the same gym — a new role replaces the prior binding, audit-logged.
- FR-092: A Coach account is a staff role for portal access only; assigning members to a coach remains a separate action (FR-055); a Coach with no assignments sees an empty list with guidance to contact Manager/Owner/Supervisor.

**6.18 Complete Client Profiles — Body & Progress Tracking — V1.5**
- FR-093: Member profile gains an optional body profile (height, starting weight, optional baseline measurements); entered via an optional "Complete your profile" step or any time from Progress; no body data is mandatory.
- FR-094: A member can log progress entries over time — any subset of weight, measurements (waist/chest/hips/arms/thighs), a progress photo, and a note; each entry carries a timestamp and a `client_id` for offline-safe dedupe; a member may soft-delete their own entry.
- FR-095: Body/progress data is private by default via RLS: a member always reads/writes their own; an assigned Coach reads only currently-assigned members' data, ending the instant the assignment ends (FR-055 `ended_at`); no other role (Receptionist/Manager/Supervisor/Owner/other member) can read it. Photo sharing defaults off per-photo (explicit opt-in, not blanket), revocable at any time with no outstanding signed URL surviving revocation (NFR-011); revocation is forward-only, not retroactive to prior views (which aren't tracked).
- FR-096: Member Progress screen shows current weight + change since start, a weight trend chart, logged measurements with trends, a photo timeline (member-only unless shared), and a log-entry action; charts view offline, logging offline queues the entry (FR-097).
- FR-097: Amendment to FR-061 — V1.5 extends offline queueing to progress-entry logging (SQLite, synced on reconnect via `client_id` idempotency); no other flows are offline in V1.5.
- FR-098: In the Coach Portal, an assigned member's profile gains a Progress tab (weight/measurement trends, shared photos); coach can add a note but cannot edit/delete a member's progress entries; unassigned members are invisible and unreadable.

**6.19 Payments — Tara Money (Automated Mobile-Money Option) — V1.5**
- FR-099: Amendment to FR-034 — Tara Money is the designated automated mobile-money provider going forward, replacing Notch Pay in that role (formalizes the 2026-07-31 decision, not new capability). No automated mobile-money payment has actually been collected from a real member in production under either provider to date — only cash/manual methods have carried real member payments; the sandbox spike succeeded (incl. one real-money round-trip) but production activation is pending (OQ-7). Uses the existing `PaymentProvider` interface; Notch Pay remains a documented fallback, never carrying live traffic; provider selection is configuration, not code.
- FR-100: The Tara Money integration passed the same sandbox exit criteria that gated Notch Pay (auth, initiation, webhook, idempotency) in full against a stand-in business account on 2026-07-31, including one real-money round-trip. GymOS's own business account (`9FmIZg9GBB`) was blocked on activation until this session; a credential swap to the real account, re-verifying the same round-trip, is the remaining prerequisite before routing real member payments through it (OQ-7) — a credential swap, not a provider cutover (FR-102), needing no code/migration changes.
- FR-101: Webhook signature verification (NFR-002) is provider-specific; Tara Money verification is implemented and tested against sandbox and real webhook deliveries before cutover; invalid payloads rejected with HTTP 401.
- FR-102: Cutover procedure — new initiations route to Tara Money; in-flight Notch Pay payments reconcile to a terminal state under Notch Pay (reconciliation job polls both during the window); no payment is re-initiated across providers (prevents double-charge); the migration window and reconciliation result are recorded in the audit log; cutover is reversible by configuration for the duration of the beta.
- FR-103: Both MTN Mobile Money and Orange Money are supported via Tara Money (matching V1.0 coverage, FR-033); cash, bank transfer, and manual mobile money remain unchanged first-class manual methods.

**6.20 Payment Gateway — Two Distinct Payment Flows — V1.5**

*Flow A — Member → Gym (membership payments)*
- FR-124: When a member pays their gym by Tara Money, the payment settles directly into that gym's own Tara Money account; GymOS orchestrates (create collect, detect confirmation, reconcile, receipt) but never receives or holds member funds.
- FR-125: GymOS takes no commission on member→gym payments in V1.5; platform revenue comes solely from the SaaS tier fee (Flow B); provider fees are borne by the gym (FR-039), never absorbed or marked up by GymOS.
- FR-126: Each gym must connect its own Tara Money account via a Settings "Connect payment account" flow; credentials are stored encrypted (Supabase Vault), readable only by the payment service, never returned to any client, tenant-isolated.
- FR-127: Cash and Tara Money are co-equal payment options, not primary/fallback; a gym without Tara Money connected loses no ability to operate (cash/manual entry as before); the automated "pay by Tara Money" action simply doesn't surface until connected.
- FR-128: When a member initiates a mobile-money payment, the service resolves the gym's connected credentials (FR-126) and routes through them; if credentials are missing/invalid/revoked, initiation fails gracefully (directs member to the desk) and the Owner is notified their connection needs attention.
- FR-129: Both subscription purchase and renewal use Flow A, including via the front-desk alert panel (FR-050) and self-service app renewal; the subscription lifecycle (FR-027–FR-032) is unchanged — only money routing is now explicitly the gym's own account.
- FR-140: A member can renew their own subscription from the app (Flow A) without visiting the front desk, when status is `expiring_soon`/`grace_period`/`expired`; pays by Tara Money if connected (FR-126) or sees "See front desk to renew with cash" if not (FR-127); on success, subscription resets per FR-032 with immediate confirmation — same outcome as the front-desk panel, member-initiated.

*Flow B — Gym Owner → GymOS (SaaS subscription billing)*
- FR-130: GymOS bills each gym for its platform SaaS subscription per tier (FR-073) and interval; billing for V1.5 is reminder-to-approve, not automated debit — GymOS notifies the Owner when due (FR-135) and the Owner completes the charge via Tara Money into the platform's account (OQ-14, resolved); automated recurring debit deferred pending a card-based provider.
- FR-131: A gym's platform subscription has its own lifecycle: `active` → `past_due` (missed notice or failed charge, gym stays operational, reminders begin) → `grace_period` (retries exhausted, Super-Admin-configurable window, default 7 days, "renew to avoid suspension" banner) → `suspended` (grace elapsed, entire tenant suspended — staff and members cannot log in, data retained; payment restores access immediately).
- FR-132: Suspending a gym for non-payment suspends the entire tenant (every staff/member account) until the subscription is current; reversible immediately on payment; member states/data preserved through suspension; the member-facing suspension surface never mentions billing/payment — that is between GymOS and the Owner only.
- FR-133: Amendment (OQ-14 resolved) — on each gym's billing anchor date, GymOS sends the Owner a payment-due notice with a one-tap Tara Money link; the Owner is never auto-debited; if unpaid, GymOS re-sends on a defined schedule (default 1/3/5 days after due) before moving to `grace_period`; every notice and payment attempt is recorded (FR-135).
- FR-134: Super Admin dashboard gains a Billing view — each gym's tier, interval, SaaS status, next billing date, last payment, failed attempts; Super Admin can mark a payment received (out-of-band), apply a credit/free period, trigger a retry, or suspend/reactivate; all actions audit-logged (FR-080).
- FR-135: Gym Owners receive platform-subscription notifications (upcoming renewal, payment due w/ one-tap link, payment succeeded/failed w/ retry date, entering grace, impending suspension) distinct from member notifications, non-opt-out, sent via both SMS and WhatsApp (both fire, not a fallback chain — reusing FR-118 infrastructure), plus email if the Owner has one on file (new optional field; email is best-effort until a transactional email provider is selected/integrated — not part of the stack today).
- FR-136: Beta accommodation — Super Admin can place a gym on a free/discounted plan via the Free/Test tier (FR-139) rather than ad-hoc discounting; the billing machinery (FR-130–FR-135) is built and exercised even at a 0 XAF price point.
- FR-139: Amendment to FR-073 — a fourth tier, Free/Test, is added (Super-Admin-configurable member cap, monthly/annual price fixed at 0 XAF) for beta/test gyms; assigning it is a tier change like any other, and the billing reminder/reconciliation machinery still runs at 0 XAF so those code paths stay exercised.

*Shared (both flows)*
- FR-137: Both flows reuse V1.0 integrity machinery (idempotent webhooks FR-035, reconciliation FR-036, append-only audit FR-079, integer-XAF storage FR-026); Flow B reconciles against the platform account, Flow A against each gym's account. Amendment to FR-036: the discrepancy definition gains a fourth category — a payment whose settled account doesn't match its declared routing context (FR-138), i.e. a misrouted Flow A/Flow B collect.
- FR-138: The `PaymentProvider` abstraction carries a routing context identifying which account a payment belongs to (a specific gym for Flow A, the platform for Flow B); selects credentials at initiation, verification, and reconciliation; adding a provider or flow changes only the adapter and context, not the calling code.

**6.21 Classes & Scheduling — V1.5**
- FR-104: A Manager or Owner can create classes (name, description, assigned coach, capacity, one-off/recurring schedule); tenant-isolated like all other data.
- FR-105: Any member with an active subscription, any plan type, can book a class session from the app (fixed rule, no per-plan eligibility flag); booking is capacity-limited, closes when full ("This class is full"), enforced server-side against overbooking under concurrency.
- FR-106: A member can cancel a booking up to a gym-configurable cutoff (default 2 hours), freeing the spot; booking/cancellation are not payments.
- FR-107: A Receptionist can view a session's booked members and mark attendance; class attendance is distinct from floor check-in but uses the same member-status rules (expired members can't be marked attended, triggers the front-desk alert FR-049).
- FR-108: The member app shows upcoming booked classes on Home and a Classes screen of available/booked sessions; workout plans and classes are separate features.

**6.22 Workout Plans — V1.5**
- FR-109: A Coach can author a workout plan for an assigned member — a named plan with an ordered exercise list (sets, reps, optional notes), created/edited from the Coach Portal.
- FR-110: A plan is assigned to exactly one member; the member sees their plan and can mark exercises/sessions complete (offline-safe via `client_id`); completion data is visible to the authoring coach.
- FR-111: If a coach assignment ends (FR-055), the previous coach's plan stays visible to the member and Owner/Manager but is not editable by a new coach until they take ownership — mirrors the V1.0 session-note handoff.
- FR-112: A shared exercise library (platform defaults; gym/coach can add gym-scoped custom entries) backs plan authoring.

**6.23 Quiet-Gym Alerts — V1.5**
- FR-113: A member can opt in to quiet-gym alerts (default off); when occupancy drops into the Low band (FR-047) during opening hours, opted-in members receive N-06 (the V1.5 activation of the reserved N-06 notification, FR-075).
- FR-114: Quiet-gym alerts are rate-limited — max 2/day/member, min 3-hour gap, only during configured opening hours.
- FR-115: Quiet-gym alerts use the existing occupancy calculation (FR-046) — no new presence detection.

**6.24 Class Reminders — V1.5**
- FR-116: A booked member receives N-07 60 minutes before the session; class reminders are opt-out (non-critical), per FR-076.

**6.25 WhatsApp Invite & OTP Fallback (V1.0 Carryover Completion) — V1.5**
- FR-117: The Evolution API WhatsApp integration is completed; member invitations (FR-082) can be sent via WhatsApp in addition to SMS, at the gym admin's choice.
- FR-118: OTP delivery uses an ordered fallback chain — Evolution API WhatsApp first, falling through to Twilio WhatsApp, then Twilio SMS, then sent.dm on failure at each step; transparent to the member, channel and outcome logged for observability.
- FR-119: The Evolution API instance configuration (V1.0 Epic 1, Story 1.13 — shipped) is finalized: platform-level, managed by Super Admin, documented in `docs/decisions.md`.

**6.26 Dashboard & App Additions — V1.5**
- FR-120: The Settings page gains a Staff section (Owner and Supervisor) — list staff with role/status, plus Add/Edit/Deactivate (FR-087–FR-089); all other Settings capabilities unchanged.
- FR-121: A new Classes page (Manager for create/edit; Receptionist for bookings and class attendance) lists classes, sessions, booking counts vs. capacity, and assigned coach.
- FR-122: The Coach Portal gains Workout Plans and, per assigned member, a Progress tab; no other dashboard section becomes visible to the Coach role.
- FR-123: The member app gains a Progress tab and a Classes tab alongside Home/Check-In/Profile; notification preferences gain N-06 and N-07 toggles.

**6.27 Registration Fee — post-V1.5**
- FR-147: Each gym can configure a one-time registration fee — a flat amount in whole XAF, set by the Owner or Supervisor on the Settings page (amends FR-069); default 0 XAF means off and FR-148–FR-155 do not apply; every change is audit-logged and applies only to members registered afterward.
- FR-148: When the fee is above 0, a new member starts as "awaiting registration fee" — no member-app access and no plan of any type (including Pay-per-session) until the fee is settled (recorded as paid or waived); staff collect it only; enforced server-side; CSV import exempt; an awaiting member counts toward the member cap (amends FR-019).
- FR-149: The fee is paid once per member and is non-refundable; every existing member is treated as already paid; a member created while the fee is 0 is settled from creation; the fee is per gym; reactivated-member re-payment is deferred (OQ-17).
- FR-150: An Owner, Supervisor, or Manager can waive the fee for a member with a mandatory reason, audit-logged; Receptionists and Coaches cannot.
- FR-151: An Owner or Supervisor can void a manually recorded fee entered in error (wrong member or duplicate) with a mandatory reason, only while the member has no subscription; a void is a correction, not a refund; a Tara-paid fee cannot be voided in the platform.
- FR-152: Staff collect the fee by a manual payment or a staff-initiated Tara Money collection for exactly the gym's fee; at most one non-voided fee payment per member; stored with a purpose distinct from subscription payments and never creates or renews a subscription; a manual fee takes effect immediately, a Tara fee when confirmed.
- FR-153: Amends FR-040, FR-080, FR-143 — no refund against a fee payment (enforced in the data layer); fee entries, fee-amount changes, waivers, and voids are audited; registration fees count toward month-to-date revenue and show as their own line.
- FR-154: Amends FR-008 — imported members are existing members and exempt from the fee; CSV import is never blocked and creates no fee payment.
- FR-155: Amends FR-058 and FR-082 — an awaiting member cannot use the member app (sees a "registration not complete, contact your gym" message and no payment option); the WhatsApp invite is sent once the fee is settled; onboarding then proceeds as FR-058.

**V1.6 (PRD v1.6, 2026-10-11).** These headings use the PRD's own section numbers (`prd.md` §6.27–§6.29); the "6.27 Registration Fee" heading above predates them and is a local label only.

**prd §6.27 Session Guests — Per-Visit Paid Sessions**
- FR-156: A session guest is an ordinary member on a Pay-per-session plan — no new role, account type, or app; normal registration, login, and QR check-in; counts toward the member cap. The plan's price is the price of one session; a 0 XAF Pay-per-session plan is exempt from FR-158–FR-159. Where a registration fee applies, it is settled by waiver or collection like any member — the waiver form offers a one-tap "Session guest" preset reason; no auto-waive.
- FR-157: Per-gym setting **Charge guests per session**, Owner/Supervisor on Settings (amends FR-069), audit-logged with old/new value; **off** for every gym existing at release, **on by default** for gyms created afterward. While off, FR-042–045 and FR-061 behave as before and FR-158–163 do not apply. Turning it on affects only visits from that moment (no effect on past attendance or an open check-in). Before confirming, Settings shows how many Pay-per-session members will need a paid session at their next visit; while off, the loyalty guest rule earns nothing and the form says so.
- FR-158: While on, a **paid session** is created by a payment of the plan price — its own record, one per purchase, linked to exactly one payment; a free session (FR-166) is the same record linked to a loyalty grant, never a payment/receipt/revenue. Paid at the desk (cash or manual mobile money by any role that records payments; bank transfer by Manager/Owner) or in the app by Tara Money where connected. Desk payments take effect immediately (no verification queue); amount fixed to plan price, not entered; reason optional (amends FR-038). Amount determined server-side at payment time; a later price change never alters sessions already paid. One payment in flight per member (a second Tara start or a desk payment is refused while one is awaiting confirmation). A confirmed Tara payment creates the session even if late (with a staff-visible audit entry); a flagged or wrong-account payment never does; a redelivery creates nothing. Payment purpose `session`, reportable separately, never a renewal.
- FR-159: Amends FR-042/FR-044. While on and the member's current plan is Pay-per-session, check-in succeeds only with a usable paid or free session. The first check-in of a gym-local calendar day consumes one session, which then covers all further check-ins that day; the covered day is stored at consumption; a visit open at midnight stays covered. An unused paid session is usable for 7 days from payment (lapse date shown to the member). Consumption order: soonest-lapsing first; on a tie, paid before free. Coverage, lapse, and stamps use server receipt time; an offline scan time is accepted only within the auto-timeout window (FR-045) and can never be covered retroactively or extend coverage to another day. No usable session → rejected, no attendance event, "Pay for your session" state with in-app payment where available or "See the front desk". Enforced server-side for every entry path (NFR-021); a denial must show older builds a see-the-front-desk outcome, not a network error. Non-Pay-per-session plans unaffected; class attendance follows FR-174.
- FR-160: Amends FR-049. A rejected check-in raises a real-time alert to active dashboard sessions via the FR-049 mechanism, as a new alert type (copy/color from UX); recording the member's session payment dismisses it. The alert names the member, shows any payment in flight, and lets the receptionist record the session payment. The rejected attempt is stored (member, gym, timestamp, scan id) for FR-163; it is not an attendance event and not in the attendance log; repeated scans with the same scan id are one attempt.
- FR-161: Amends FR-061. An offline guest check-in at a charging gym is recorded locally with "Check-in saved — your session will be verified" `[UX wording]`. On sync the server applies FR-159's time rules: a usable session → consumed and attendance recorded; none → not attendance, stored as an attempt keyed by scan id (retries not double-counted), FR-160 alert raised — never silently counted or dropped. A permanently failed sync is discarded as today. The app refreshes the gym's charging setting each time it is online; the server's rule at sync time governs.
- FR-162: Session payments are audited (amends FR-080): every payment, consumption, rejected attempt, and refund. Refunds (FR-040) hold in the data layer: a **full** refund of an **unused** session voids it atomically (a racing consumption resolves to exactly one outcome); a **partial** refund does not void; a refund of a **consumed** session is recorded, does not un-consume, the visit stays counted, and **the stamp it earned is reversed** (never below 0; an earned free session is not taken back). Session payments count toward month-to-date revenue as their own line (amends FR-143). Refunding a renewal never reverses the stamp or free days it earned.
- FR-163: Staff Overview gains a **Guest sessions** card (gyms with the setting on), with a today/this-month period control: paid guest sessions, blocked attempts (once per scan id) with distinct members blocked, and free sessions given — each linking to its list. The paid-sessions list can be grouped by recording staff member and shows refunds recorded after consumption. Counts computed server-side (FR-143 `max_rows` caveat). Visible to Owner, Supervisor, Manager.
- FR-174: Amends FR-105/FR-107. While on, marking a Pay-per-session member **attended** at a class requires and consumes a usable session under exactly FR-159's rule (one session covers floor and class that gym-local day, either order; a second class that day costs nothing). Earns the guest stamp. Booking and cancellation stay free and unchanged. No usable session at marking → mark refused, offers the session-payment action in place, then mark again; the refusal raises the same alert and counts in the same blocked-attempt figures. Enforced server-side in the same database function as FR-159 — no dashboard, coach, or script path bypasses it (the coach roster cannot mark such a guest attended without a session). Monthly, Coach-inclusive, and Class-only plans unaffected.

**prd §6.28 Loyalty Program**
- FR-164: Per-gym loyalty program, **off by default**, toggled by Owner/Supervisor on Settings (amends FR-069). When on, the gym sets N (paid sessions per free session, 2–50), K (on-time renewals per reward, 3–24), R (free days per reward, 1–30); the form shows the implied effective discount live. Every change audit-logged with old/new value. Progress is per member per gym, RLS-isolated (NFR-001); two separate counters (guest stamps toward N, subscriber stamps toward K), never converted into each other. Changing N or K never erases progress — at or above a lowered threshold, the member earns one reward at the next qualifying event and the counter returns to 0.
- FR-165: Guest rule — one guest stamp each time a **paid** session is consumed (not at check-in, not for a free session, not for a re-entry on a covered day). At N → one free session, counter to 0. Earns only while both the loyalty program and charging are on; nothing retroactive.
- FR-166: A free session is a session with no payment; added to usable sessions, consumed under FR-159's ordering and same-day coverage, usable **60 days** from earning, then lapses. A member can hold several. A member who leaves Pay-per-session keeps unused free sessions until they lapse (no effect meanwhile; usable again on return). Grant, consumption, and lapse are each audited.
- FR-167: Subscriber rule — for Monthly, Coach-inclusive, and Class-only plans, one subscriber stamp per **on-time renewal**: a verified payment for the member's current plan via manual renewal, the dashboard renewal panel, or in-app renewal (FR-140). Payment-less overrides, plan assignment/change, and staff back-dated renewals earn nothing. On time = verified no later than the end of the day after expiry (gym timezone, at verification). A late renewal neither earns nor erases. At most one stamp per subscription period. At K → R free days added to the renewed subscription's expiry in the same transaction that verifies the K-th renewal; counter to 0; no payment, no amount touched. `[PRD ASSUMPTION: "non-consecutive" and one-stamp-per-period are PM defaults]`
- FR-168: Progress resets to 0 after **90 days** with no qualifying event (subscribers: the longer of 90 days and plan duration + grace period). The reset is evaluated when progress is next read or earned and is audited then; neither app nor dashboard ever shows past-window progress as live. The 90-day and 60-day values are platform defaults stored as data, not gym-configurable in V1.6. All windows are 24-hour multiples from the originating event except FR-159's gym-local covered day.
- FR-169: The member app shows loyalty progress as a count toward the threshold ("3 / 5"), any free session with its expiry, and any unused paid session with its lapse date, in the member's language. The dashboard member page shows the same to staff. No reward push notification in V1.6.
- FR-170: No role — Owner and Super Admin included — can manually add, remove, or edit stamps or free sessions. Recording cash without collecting it, or refunding after consumption, is made visible (FR-163, audit log), not prevented. Rewards granted exactly once per qualifying event, including under webhook redelivery and offline sync (NFR-022). Amends FR-080: stamp earnings, reward grants, consumptions, lapses, resets, and program configuration changes are audited. Stamps are reversed only by FR-162's refund rule.

**prd §6.29 Gym Category & Plan-Type Rules**
- FR-171: Every gym has a category — Gym / Salle de sport, Studio Pilates, Studio Yoga, Fitness Center, Autre. Super Admin chooses it at gym creation (amends FR-071, FR-010) and can edit it; Owner and Supervisor can edit it on Settings (amends FR-069). Every change audited. Existing gyms are set to Gym / Salle de sport at release. Labels localized EN/FR. "Autre" has no free text in V1.6.
- FR-172: In V1.6 the category is descriptive data only — no behavior, plan type, permission, or screen changes; product wording stays "gym" for every category. It exists for V1.7's directory and landing pages.
- FR-173: Clarifies FR-024, amends FR-025. Pay-per-session's definition is unchanged; there is no separate session-price field. (a) A plan's type cannot be changed in place once it has subscriptions — the gym creates a new plan; (b) every change to a plan's type or price is audit-logged; (c) a price change never alters the value or validity of sessions already paid for.

**prd §6.30 GymOS Support Staff — V1.7 (Step 1, ships first)**
- FR-175: Super Admin creates a GymOS support account for one real person on a GymOS-controlled phone/email that matches no existing user (refused on collision, never merged — FR-001). Never shared. Belongs to GymOS, no gym access until a gym is assigned and its second factor is verified (FR-189).
- FR-176: Activation by single-use invite link (24 h expiry, stored hashed, delivered to a Super Admin-verified channel, never a temporary password), bound to that channel; TOTP enrollment happens inside the flow; verified phone and `@gymosapps.com` email on file before assignment. Sign-in is phone + password, then second factor. One verified factor per account; adding/removing one needs AAL2.
- FR-177: Assignment is many-to-many per gym; assign/unassign/remove are Super Admin actions at AAL2 with a mandatory reason (FR-089), audited. A new gym has none by default. Assignment to an un-enrolled person, or while the gym's switch is off, is `pending` until Super Admin confirms. Assign, activate and the Owner's switch are serialized per gym (tested).
- FR-178: In each assigned gym support holds a real staff membership with its own role `support`, ranked below Owner and distinct from Supervisor — no access by default, exactly the FR-179 capabilities, no inheritance. Written only by Super Admin assignment; exists only while the assignment is active. FR-087 ceiling applies (no Owner/Supervisor edits, no creating support, no self role change). No other role in that gym; assignment refused if already member/staff there (FR-091).
- FR-179: Beyond Supervisor, support can: edit gym profile/settings, plans and prices, registration fee, guest charging and loyalty, category, and (Step 2) landing-page content (FR-198); create staff within the ceiling; manage member records and imports; record payments, refunds and registration-fee waivers; connect or replace the payment account (FR-180). Support cannot: change "Allow GymOS Support"; change SaaS tier/interval/billing anchor/Owner contact/subscription status/suspension; deactivate or delete the gym; edit, deactivate or reset credentials of Owner/Supervisor; change any staff phone or trigger a credential reset; or reach anything not listed. The allow-list is the spec: every RPC and column grant enumerated, every denial has a negative test.
- FR-180: Amends FR-126/FR-127. **Decided 2026-10-15 (product owner): no Owner approval step.** Support can connect or replace a gym's Tara Money account directly; the safeguard is the audit trail under the individual's identity (FR-187), not a confirmation. The Owner is notified immediately of every connection change and Super Admin is alerted; changing it needs a second-factor check within 5 min (FR-189); secrets go to Vault and the audit row records that credentials changed, never the value; after a connection change or a support revocation the Owner is prompted to review recent support changes. [PRD FR-180 and spine AD-36 synced 2026-10-15.]
- FR-181: Money- and access-changing support actions are visible to the gym without naming the person: immediate Owner notice of payment-connection proposals/changes; at least daily summary (on days support acted) of refunds, fee waivers, staff creation/edits, and changes to a published page's public contact/about. Velocity limit `[ASSUMPTION]`: 10/h per gym, 20/h per account, 3 payment-connection changes/day per gym; exceeding locks the account for Super Admin review. Staff created/modified by support tagged "created by GymOS Support" and flagged for review on revocation.
- FR-182: To the Owner and staff, support is one fixed row "GymOS Support" in the staff list — never an individual, never a count. Settings states one of four states: off ("turned off by you"), on with no one assigned, on with support assigned, on with an assignment waiting for GymOS to confirm — plus last-acted time. Row not editable/deactivatable from the gym; only control is FR-183.
- FR-183: Per-gym "Allow GymOS Support", Owner-only. On for gyms created after V1.7, off for existing gyms until the Owner turns it on; existing Owners told in-app and by usual channel before release (following FR-157). Off ends all support access immediately; on re-activates assignments active when it went off; assignments made while off stay pending. Audited, visible to Super Admin. `[ASSUMPTION — suspended, not deleted; OQ-30]`
- FR-184: When access ends (unassign, removal, opt-out, deactivation, lock): in-flight operations complete or roll back atomically; the revoked person's pending items are re-owned to a system actor and flagged for the Owner; live subscriptions and signed links stop within 60 s `[ASSUMPTION]`; Owner prompted to review payment/staff changes.
- FR-185: Removing an individual or deactivating the account is Super Admin only, with a reason; the Owner cannot see or act on individuals. Auto-disable after 30 days inactive `[ASSUMPTION]`, quarterly Super Admin recertification, any phone/email change via Super Admin at AAL2.
- FR-186: No gym-side read returns an individual support identity (staff list, audit trail, payment "recorded by", refund approvers, notes, check-ins, exports, live updates, notifications, error logs). Displayed actor server-derived. Attribution columns hold a per-gym opaque identifier, never the platform user id, so one person cannot be correlated across gyms. Each surface has a test.
- FR-187: Every support action is audit-logged under the individual's identity, retained as any staff action, shown to the gym as "GymOS Support". The Owner can file a disclosure request about a specific audit row, answered by Super Admin outside the product within 3 business days `[ASSUMPTION]`; request and answer audited. Customer terms state GymOS is responsible for its support staff `[OQ-31]`.
- FR-188: Support memberships excluded from staff counts, role caps and tier limits, operational notifications (e.g. front-desk alerts), and platform metrics. A support person never receives a gym's operational notifications. One definition (the support role) governs all of it, tested both ways.
- FR-189: Every support account passes TOTP (Supabase MFA); a support session works only at AAL2, a lower-level session sees and does nothing. Enforced in the database and every edge function/service path touching money or secrets through one shared check (NFR-021, NFR-023); no older client build can bypass. Sessions end after 8 h and 15 min idle, enforced by the application `[ASSUMPTION]`; payment-connection change, refund and staff creation need a second-factor check within the last 5 min `[ASSUMPTION]`; repeated wrong codes lock; no "remember this device".
- FR-190: Super Admin resets a support person's second factor: requires AAL2 and a recorded identity check, invalidates sessions, 30-minute cooling-off `[ASSUMPTION]` during which the person is notified on the verified phone and email and can cancel, then re-enrollment via a new single-use invite (FR-176); audited.
- FR-191: Every Super Admin session also requires AAL2, switched on only after the Super Admin account enrolls and verifies its factor in a controlled pre-flight; enrollment never open to an unverified session once on. Recovery mechanism designed in architecture (second factor on a separate device); last resort a documented, audited out-of-band reset by the platform owner; dual control once a second Super Admin exists.
- FR-192: Amends FR-090. Unassign, removal, deactivation, lock, or the Owner's switch off takes effect on the person's next request, not at token expiry. Closes FR-090 for every role: each role-gated policy, RPC, edge function and service path checks current membership, role, deactivation, and for support the assignment, opt-out and second-factor level, live. A suspended gym (FR-132) is denied to support like any staff account.
- FR-193: Amends FR-072. Super Admin read-only escalation stays as the diagnosis tool; support access to member/payment data is by assignment, audited under FR-187. A Super Admin cannot hold a support account: creation checks phone, email and linked identity against every Super Admin and refuses on a match; a Super Admin session cannot be assigned. A support person cannot act on a record tied to their own phone/email.
- FR-194: A support person working in several gyms has an explicit active-gym context (FR-003), re-checked live on every request; no cross-gym action in one request.
- FR-195: A support person never appears on a member-facing surface: receipts, the member app and message templates show the gym, never an individual.

**prd §6.31 Gym Landing Pages — V1.7 (Step 2)**
- FR-196: A gym can have one optional public landing page at `{name}.gymosapps.com`; all gym users still sign in at `owner.gymosapps.com`. The page shows no login, member counts or staff names; a visitor can call, open WhatsApp, or get directions.
- FR-197: New gym fields hold page content: about, services/activities, public plans and session plans with prices, location (address + map position), opening hours, public contact (may differ from the Owner's login phone), gallery, banner, logo, with the existing primary color and category label (FR-171). Existing gyms prompted to fill in; nothing published for them. A screen states exactly what becomes public before publishing.
- FR-198: Owner, Supervisor, or assigned support can edit content and publish/unpublish. Only the Owner (or Super Admin) can claim or rename the page name.
- FR-199: Publishing is explicit and server-validated; requires page name, category, logo, banner, about ≥100 chars, country and city, ≥1 public contact, opening hours, ≥1 public plan. Re-evaluated on every change: a page that stops qualifying unpublishes itself and the Owner is told why. Unpublishing always allowed.
- FR-200: Plan visibility is opt-in per plan; private by default; only public plans appear on the page or anything public.
- FR-201: GymOS prebuilds templates; V1.7 ships at least two under one contract and a conformance suite; swappable without re-entering content. The template system is a self-contained module: validated, versioned content in, rendered page out; presentation only, no gym data (addendum G). *As built (Epic 24 retro 2026-11-11): Classic shipped with 24.10 (owner decision 2026-11-09), a second template, Volt, with 24.13; `docs/decisions.md` 24.13.*
- FR-202: Page name rules: lowercase, 3–30 chars of `a-z0-9-`, no leading/trailing hyphen, no `--`, no `xn--`, not digits only; unique case-insensitively. Reserved names and brand/credential words cannot be claimed; near-matches (edit distance 1, homoglyph/hyphen/digit folding) and generic/place words held for Super Admin approval before first publish, decided within 2 business days; word lists in a Super Admin-maintained table seeded from addendum J.
- FR-203: First come first served by the Owner, one name per gym, reserved while unpublished or suspended up to 12 months; at most two renames in a rolling 12 months (forced renames/overrides don't count); old name 301-redirects (one hop) for 12 months then released; a taken-down name is never released; redirects dropped on takedown/force-rename and cached ≤5 min.
- FR-204: Super Admin can take a page down with a reason code (impersonation, illegal content, trademark, misleading content, privacy, other); blocks republishing until lifted and tells the Owner why. Visitors can report via a public form, answered within 5 business days `[ASSUMPTION]`; Owner has an appeal path. No pre-publication moderation. *As built: a takedown hides the page and blocks republishing but does not unpublish it; lifting returns the page to unpublished and the Owner republishes through the gate (`docs/decisions.md` 24.11).*
- FR-205: Content rendered as text only; no gym HTML/script reaches the page; structured data built by an escaping serializer. Images re-encoded to JPEG/WebP/PNG, metadata (incl. location) stripped, bounded size/dimensions/count, served from a separate cookieless origin, purged on unpublish or delete; uploader attests rights; opaque addresses with no internal identifier.
- FR-206: The public site reads only a published projection (NFR-024) with a defined field list: page name, gym name, category, logo, banner, about, services, public plans/session plans (name, price, duration), address and optional map position, opening hours, public contact, gallery, country, city, primary color, template, last-updated. No internal identifiers, no `gym_token`, no login phone.
- FR-207: An unpublished, taken-down, or suspended-gym page returns the same not-found and leaves address, directory and sitemap within 60 s at origin; CDN purged within 5 min; sitemap regenerated within 15 min `[ASSUMPTION]`. Returns when active and republished unless a takedown is in force. *As built: a suspended gym keeps its snapshot and the page returns on reactivation without a republish ("option B", `docs/decisions.md` 24.8); freshness is the `s-maxage=60` TTL at the Vercel edge, verified on production 2026-11-11, so origin and CDN bounds are both met by the one TTL.*
- FR-208: Page chrome (labels, navigation, structured-data fields) in EN and FR; gym content as entered, language alternates declared only where translated content exists `[ASSUMPTION — OQ-28]`. *Superseded 2026-11-08 (OQ-28, UX update 3): content languages are an open list, each optional; a language is offered only when its required language-bound fields are complete, and at least one complete language is needed to publish. See `epic-24-context.md`.*

**prd §6.32 Directory & Discovery — V1.7 (Step 3)**
- FR-209: Country from the ISO list; city from a controlled list with alias normalization (accents, spelling, case); new city added by Super Admin; place slugs ASCII-folded.
- FR-210: GymOS publishes a directory on the main website: a section per country with ≥1 published gym, city listings below, built only from published pages (FR-206). Any published gym is listed regardless of country; Cameroon is the only country with a prominent entry point at launch; no Cameroon-only assumption in addresses, copy or structured data.
- FR-211: Search and AI-search optimization with verifiable outcomes: every page's and listing's `LocalBusiness`/`HealthClub` structured data validates with zero schema.org errors; sitemap lists exactly the indexable pages; canonical addresses for filtered views; social-sharing metadata; a plain-text site summary for AI crawlers listing each published gym's name, category, city, hours, public plans.
- FR-212: A country or city listing with fewer than 3 published gyms is excluded from indexing and the sitemap `[ASSUMPTION — OQ-29]`.
- FR-213: Amends FR-172. Directory filterable by category (FR-171), category label shown on the public page; category stays descriptive for behavior, plan types, permissions; category changes audited.
- FR-214: A gym that unpublishes, is suspended, or taken down leaves directory, sitemap and listings within the FR-207 times.

**prd §6.33 Member Engagement — Weekly Goal, Streaks & Calendar — V1.8 (Step 3)**
- FR-219: Member sets a weekly goal of 1–7 visit days, default 3; a change applies from the next gym-local week (week = Monday–Sunday, assumption); Home shows a ring that fills per visit day and closes at the goal.
- FR-220: Weekly streak = consecutive gym-local weeks the goal in force was met, computed on the server when a week closes; best streak stored and never lowered; a missed week ends the run unless a Shield saves it.
- FR-221 *(Could)*: Daily streak appears automatically once the member has a current run of 3+ consecutive visit days; no opt-in; hidden when the run ends.
- FR-222 *(Should)*: Streak Shield earned at every 4th consecutive streak week, max 2 held, used automatically to save one missed week or day, never bought or staff-granted, separate from loyalty (FR-170 untouched).
- FR-223 *(Should)*: Comeback — after a broken streak the best streak stays visible; goal of 3 visits (10-day window, assumption) restores active status; never a bare "0".
- FR-224: Attendance calendar — month view, visit days lit, earlier months reachable, today's cell "at risk" with hours left when a visit today is needed (FR-233 conditions a/b), milestone markers on milestone days.
- FR-225: A visit day = a gym-local day with ≥1 attendance record; engagement features read existing attendance (no check-in rule change by them); time per FR-061/FR-159; existing history counts at release (badges silent, weekly streak starts first full week after release); all members see the same features whatever their plan.

**prd §6.34 Gym Leaderboard — V1.8 (Step 3)**
- FR-226: Monthly per-gym leaderboard ranked by visit days in the gym-local month; top 10 plus own row with one neighbour above and below and "N visits behind"; ties share a rank (earliest first); zero-visit members unranked; not on the dashboard in V1.8.
- FR-227: "Anonymous" choice in Profile; appears as Anonymous until the first-open notice has been seen, then first name + last initial (no photo/phone) unless hidden; still counted and ranked.
- FR-228: Anonymous enforced on the server (hidden names/identifiers never reach other devices); own-gym board only; rank carries no prize, no leagues, no champion badge; counts change only through attendance records.

**prd §6.35 Milestones, Badges & Sharing — V1.8 (Step 3)**
- FR-229: Celebration screen once at the 7th, 30th and 100th total visit day at the gym; calendar marks those days; offline milestones shown after sync.
- FR-230 *(Should)*: Badge shelf — First visit, 7, 30, 100 visits, 4 weeks in a row; earned once, never lost, grant nothing.
- FR-231 *(Should)*: Share button on the celebration screen and each earned badge makes an on-device image (milestone, optional month calendar, gym name and logo) handed to the OS share sheet; no other member's data; nothing stored by GymOS.
- FR-232: All goal, celebration, comeback and reminder wording is editable text slots, EN/FR.

**prd §6.36 Streak Reminder, Gym Challenge & Monthly Summary — V1.8 (Step 3)**
- FR-233 *(Should)*: Push N-08 — on by default, one off-switch, max 1/member/day at 18:00 gym-local, only if no visit today and (a) a daily streak of 3+ would end today or (b) the weekly goal can only be met if the member visits today.
- FR-234 *(Could)*: Gym-wide monthly challenge — off by default, one per gym per month, Owner/Supervisor set a numeric target (total member visit days) and a free-text reward, fixed once the month starts, cancellable, audit-logged; app shows progress; GymOS grants nothing.
- FR-235 *(Could)*: "Your month" summary from the 1st of the next month — visit days, best week, change vs previous month; no push.

**prd §6.37 Pay-per-Session Validity — V1.8 (Step 2)**
- FR-236: Per-gym setting Session validity — Whole day (default, today's FR-159 behavior) or Single use; Owner/Supervisor, audit-logged; only while "Charge guests per session" is on.
- FR-237: Single use — a check-in consumes one session covering that visit; a visit ends at check-out (manual/auto) or 3 hours after check-in; a scan during an open younger visit is rejected "already checked in" at no cost; after the visit ends or the limit passes the next check-in consumes another session.
- FR-238 (assumption): In a Single-use gym a class attendance consumes a session unless the member has an open check-in at that gym.
- FR-239: A setting change applies to later check-ins; open visits finish under the old rule; consumed sessions keep their coverage; lapse windows, loyalty (FR-165), the Guest sessions card and the session audit work as before.

**prd §6.38 Plans — Correction & Annual Clarification — V1.8 (Step 1)**
- FR-240: Annual plans are paid once, in full, for the plan's duration under the normal lifecycle; renewal is a new payment; monthly and annual are separate plans; no instalments in V1.8; annual plan cards say price, duration and "paid once".
- FR-241: Correct plan — Owner/Supervisor/Manager replace the plan on a member's current subscription with a mandatory reason; audit records actor, reason, old/new plan, price and expiry.
- FR-242: Allowed only while no payment stands (awaiting verification, in flight and partly refunded payments stand; voided or fully refunded do not); otherwise refused with a refund-first message; a subscription with no payment record can be corrected; to/from Pay-per-session refused while an unused paid session is held.
- FR-243: New expiry = original start date + new plan duration, status recalculated; not a renewal (no stamp, no payment notification); attendance, sessions, stamps, streaks and badges never rewritten; start date cannot change.

**prd §6.39 Classes — Per-Day Schedules & Coach Access — V1.8 (Step 2)**
- FR-244: A recurring class holds schedule slots (weekday + start time, same weekday may repeat), up to 14 (assumption); booking, capacity, cancellation cutoff and reminders work per generated session; one-off classes unchanged.
- FR-245: Existing recurring classes migrate to one slot per selected day at the old time; slot edits apply to future sessions without bookings; sessions with bookings are left and listed to the editor.
- FR-246: Coaches create, edit and cancel their own classes inside the Coach Portal's My Classes; they cannot assign another coach or touch another coach's class; the admin Classes page stays closed to Coach; amends FR-104/121/122/145.
- FR-247: Owner/Supervisor/Manager get a coach picker in the Coach Portal and see that coach's classes and rosters, assigned members with profile, session notes and workout plans, read-only; measurements, photos, progress notes, Overview progress activity and plan completion data stay excluded (FR-095).

**prd §6.40 Staff Check-In — V1.8 (Step 1)**
- FR-248: Receptionist/Manager/Supervisor/Owner check a member in from the Attendance page by name or phone search; same attendance record marked "checked in by staff" with the actor; time is entry time (no back/future-dating); counts for occupancy, streaks, calendar, leaderboard.
- FR-249: Same rules as a scan — one open check-in, FR-031 status outcomes (expired rejected with the renewal action offered in place), Pay-per-session session rule (desk payment offered when none); rejected attempts record no attendance; no separate real-time alert for the staff member's own entry (assumption).
- FR-250: Every staff check-in and rejected attempt is audit-logged; the attendance log marks staff check-ins and shows the actor (support appears as "GymOS Support"); a mistaken staff check-in can be voided by Manager/Supervisor/Owner the same gym-local day with a reason (assumption), after which it stops counting.
- FR-251: GymOS support gets the V1.8 staff actions (session validity, challenge, Correct plan, staff check-in and void) as a Supervisor would, behind the second factor, shown as "GymOS Support" (amends FR-179).

**prd §6.41 Epic 26 carry-over (recorded, not V1.8 work)**
- FR-215: A member record carries an optional birth year, profession and neighborhood, entered by staff and shown with the member.
- FR-216: Birth year shown as approximate age, never as an exact date of birth; existing optional dob unchanged.
- FR-217: A members-only CSV import (name, phone and the three profile fields, no plan) creates members awaiting the registration fee; amends FR-154 for that import.
- FR-218: The plan import is unchanged; a gym with a registration fee of 0 can still run the members-only import, with a warning.

### NonFunctional Requirements

- NFR-001: Multi-tenant data isolation enforced entirely at the PostgreSQL RLS layer; the JWT role-claim injection hook is spiked in week one, before any RLS policy is written — a misconfigured hook defaults to deny-all.
- NFR-002: Payment webhook endpoints validate the Notch Pay request signature before processing; unsigned/invalid payloads rejected with HTTP 401.
- NFR-003: Monetary values are stored as integers with an explicit currency column; no floating-point types for any monetary field.
- NFR-004: The audit log is append-only by design; no migration, script, or application code may issue UPDATE or DELETE against audit records.
- NFR-005: V1 availability is covered by Supabase Cloud and Vercel managed SLAs; no additional uptime commitment until commercial scale.
- NFR-006: The member app supports offline QR check-in only; other flows do not require or support offline operation.
- NFR-007: Sentry is integrated on both the mobile app and the admin dashboard, routed to a single project with dev/staging/prod environment tagging.
- NFR-008: PostHog product analytics is deferred to V1.5; no analytics instrumentation beyond Sentry's crash/error telemetry in V1.
- NFR-009: Pilot scale is ~30 members per gym across 1–3 gyms; architecture must support hundreds of gyms and thousands of members per gym without schema changes or RLS rework.
- NFR-010: The Supabase project must be provisioned in EU West (Ireland or Frankfurt); US East adds 200–400ms of latency that jeopardizes the <3s front-desk alert target; region must be confirmed before project creation (cannot change after data is written).
- NFR-011: Progress photos (FR-094) are stored under access rules mirroring FR-095 — retrievable only by the owning member and, if shared, their assigned coach; object paths non-guessable; no photo served from a public bucket (a new, dedicated bucket separate from the existing public `member-photos` bucket); signed URLs short-lived enough that revoking a photo's sharing invalidates access within that window — no long-lived signed URL survives a revoke.
- NFR-012: The Tara Money cutover (FR-102) must produce zero double-charges and zero lost payments, verified by the reconciliation job reporting zero discrepancies before Notch Pay is stood down as primary.
- NFR-013: Staff provisioning and role editing (FR-087, FR-089) must make privilege escalation impossible — no role can create or edit a target into a role equal to or above its own, and no role can edit its own role, enforced at the RLS/auth-hook layer; CI asserts an Owner cannot mint/promote-to Super Admin, a Supervisor cannot mint/promote-to Supervisor or Owner (incl. on themselves), and a Manager cannot mint or edit staff roles at all.
- NFR-014 (supersedes NFR-008): PostHog product analytics is integrated on app and dashboard, focused on the V1.5 metrics (Section 3.2), carrying no body-measurement or photo content into events; same environment tagging as Sentry (NFR-007).
- NFR-015: An E2E test automation baseline is established covering four priority flows — staff provisioning + role enforcement, the payment cutover path, progress-data access boundaries, and class booking capacity limits; complements, not replaces, V1 CI gates.
- NFR-016: Coach access to member progress data — both the assignment relationship and each photo's per-photo sharing flag (FR-095) — is re-verified on every request against current state; an ended assignment or a revoked photo-share revokes read access with no caching window that outlives either.
- NFR-017: Per-gym Tara Money credentials (FR-126) are stored encrypted at rest (Supabase Vault), accessible only to the server-side payment service, never returned to any client, never logged, never readable across tenants — same isolation guarantees as all tenant data (NFR-001).
- NFR-018: Tenant suspension for SaaS non-payment (FR-131/FR-132) is enforced at the authorization layer, not only the UI — a suspended gym's staff and members are denied at the RLS/auth-hook layer; takes effect on the next request; no tenant data is deleted or mutated.
- NFR-019: FR-125's "GymOS takes no commission on member→gym payments" is auditable, not merely asserted — every Flow A payment's settlement account is verifiable against its gym's connected credentials (FR-126) via the audit log, so a platform-account credit from a Flow A transaction is detectable after the fact.
- NFR-021 (V1.6): Paid-session consumption (FR-159) is atomic and enforced in the database, not only in application code. A member-level lock covers the whole sequence "find a covering consumed session, otherwise consume one, award the stamp, maybe grant a free session", so a session is never consumed twice, a member never has more than one session consumed per gym-local day, two simultaneous scans cannot both consume a different session, and a concurrent scan is never wrongly blocked because another scan holds the only session. A replayed offline sync never consumes a second session. Holds for every entry path (member app, offline sync, any dashboard or script) — an older app build cannot bypass it.
- NFR-022 (V1.6): Loyalty accounting (FR-164–FR-168) is derived from the recorded events that earn it and is idempotent — a duplicated webhook, retried request, or replayed sync grants a stamp or reward at most once per qualifying event. Stamps are earned in the same transaction as the earning event; stamps, free sessions, and every reset or lapse are reconstructible from the audit log. Loyalty state is per member per gym and never readable across gyms (NFR-001).

- NFR-023 (V1.7): Authorization is verified against current state on every request for every role that reaches a gym, support included: membership, role, deactivation, support assignment and opt-out, second-factor level (FR-189, FR-192). A token claim is never the sole basis for a decision — RLS policies, RPCs, edge functions and service-role paths, all through one shared check. A generated inventory of every policy/RPC/function reading the role or gym claim is part of the support-release gate; a CI check fails the build on any that decides from the claim alone. Role-check patterns are null-safe; payment inserts verify the member belongs to the gym.
- NFR-024 (V1.7): The public site (landing pages, directory) is isolated from tenant data: reads only the published projection (FR-206), runs with no privileged database credential, and a test proves the unauthenticated role has no privilege on any other relation or function. The projection column list is pinned by a snapshot test. A public-site defect cannot expose a member, payment, or unpublished field (extends NFR-001). *As built: `anon` keeps TRUNCATE, REFERENCES and TRIGGER on `public` tables and may execute six pre-auth functions, and `public_site_reader` can read `net._http_response`; all are pinned by `public_site_anon_isolation.test.sql` and the `net` exposure was accepted by the owner (`docs/decisions.md` 2026-11-10). "No privilege on any other relation or function" holds for the project's data schemas except that pinned residue.*
- NFR-025 (V1.7): Public pages and directory listings are server-rendered; field-measured p75 largest content paint ≤3 s on a mid-range Android phone on 4G, for the launch template and directory pages `[ASSUMPTION — confirm with a measured baseline]`.
- NFR-026 (V1.7): Because gym-authored pages share a registrable domain with the staff login, `owner.`/`portal.` auth cookies are host-only (never `.gymosapps.com`-scoped) with the `__Host-` prefix; public pages send a strict CSP with no inline script; a security-header test is part of the landing-page gate. A separate domain is the fallback if any of these cannot be met.
- NFR-027 (V1.8): Leaderboard privacy is enforced and tested on the server — a test per read path proves another member's device never receives a hidden member's name, photo or revealing identifier and a gym's board never contains another gym's members; "Anonymous" is produced by the server.
- NFR-028 (V1.8): Engagement counts are deterministic — weekly goal, streaks, Shields, milestones, badges, calendar and leaderboard are derived on the server from attendance (plus goal history); recomputing gives the same result; late offline-synced visits correct the counts they belong to; gym-local day/week/month boundaries; a timezone change does not move past days; a goal change mid-week keeps that week's goal; a Shield cannot be used twice for a period, even under retries.
- NFR-029 (V1.8): Ring, calendar and leaderboard load within 2 s on a mid-range Android phone on 4G at the tier's member cap (assumption, baseline to measure); the N-08 job sends at most one per member per day, is safe to run twice, and never blocks or delays a check-in.

**Performance targets (Section 7.1):** Dashboard page load < 2s on standard broadband; QR scan → front-desk alert end-to-end < 3s; offline check-in sync within 10s of connectivity restore.

**Testing requirements (Section 7.5):** JWT claims hook spiked and verified in sprint 1 before any RLS policy is written; RLS policies covered by automated CI tests against multi-gym fixtures (cross-tenant + role-boundary cases); payment flows covered by integration tests against the Notch Pay sandbox (auth, initiate, webhook, idempotency); mobile app manually QA'd on a physical Android device before each release, iOS via TestFlight; dashboard manual QA only in V1 (no automated E2E — revisit at V1.5); CI gate = RLS tests + payment integration tests + TypeScript checks on every PR.

### Additional Requirements

(from Architecture — technical requirements affecting epic/story sequencing)

- **Starter template specified — impacts Epic 1, Story 1:** Turborepo + pnpm workspaces monorepo; `npx create-next-app@latest -e with-supabase` for both `apps/dashboard` and `apps/super-admin`; `npx create-expo-app@latest` (Expo Router default) + Supabase Expo quickstart for `apps/mobile`. Monorepo initialization is the explicit first implementation story.
- The JWT custom-claims hook (Postgres function, not an HTTP Edge Function) is the true critical path — it blocks every RLS policy, which blocks every service-layer function, which blocks all frontend work. It must be pgTAP-tested in isolation with a CI canary test asserting a known test tenant sees a non-zero, correctly-scoped row count, and must be built and verified before any RLS policy is written (NFR-001).
- RLS policy strategy: one `STABLE` SQL helper (`auth.gym_id()`) reused across all policies; explicit per-action (SELECT/INSERT/UPDATE/DELETE) policies per table, never `FOR ALL`; every table migration enables RLS with a deny-all default in the same migration as its `CREATE TABLE` (no "open table" window); sensitive tables (members, payments, audit_log) each get their own RLS migration file; grant-level `REVOKE UPDATE, DELETE` on the audit log beneath the policy layer.
- Two sandbox spikes gate their respective Epics, both sprint-1: Notch Pay (auth, initiate, webhook, idempotency — FR-034/OQ-2) gates the Payments Epic; an SMS/OTP provider (Cameroon-coverage) spike behind an `OtpDeliveryProvider` interface gates the onboarding/auth Epic. Neither Epic begins on an unverified provider; outcomes recorded in `docs/decisions.md`.
- Background jobs: three independent `pg_cron` jobs (subscription lifecycle, payment reconciliation, check-in auto-timeout), each in its own function/transaction, each logging to a `job_runs` table (job_name, started_at, finished_at, status, error) — not a single shared trigger or an external job queue.
- Edge Functions are reserved for exactly two integrations: `notch-pay-webhook` (signature verification + idempotent write) and `send-sms-hook` (OTP delivery via the `OtpDeliveryProvider` interface). No other custom network-exposed endpoint exists.
- Push notification dispatch (FR-074–078) has no Edge Function of its own: a `pg_net`-based `send_push_notification()` Postgres function is invoked from the subscription-lifecycle cron job (N-01–03) and an `AFTER INSERT/UPDATE` trigger on `payments` (N-04/N-05); stale push token cleanup happens in the same function.
- Member cap enforcement (FR-086) needs two layers: a `BEFORE INSERT` trigger on `members` as the uncircumventable backstop, plus a fast-fail check in the `createMember` Server Action for a friendly error message before the trigger fires.
- Thin per-domain service layer (`services/<domain>.ts` wrapping `supabase-js`) replaces a repository pattern — RLS is the authorization layer and lives in the database, so an app-side repository would be a driftable second copy of the same rules.
- `packages/types` is the only shared package for V1: generated Supabase types (`database.ts`, never hand-edited), Zod schemas per domain, the centralized error-mapping utility (`mapSupabaseError`), the shared Supabase client factory for the two Next.js apps, and shared admin-surface locale strings (mobile locales stay separate — different vocabulary/onboarding flow).
- Realtime channel naming convention `gym:<gym_id>:alerts`; dashboard must implement a polling degrade path if the Realtime channel drops rather than silently receiving no alerts.
- Supabase Branching (persistent branch for staging/pilot, ephemeral preview branches per PR) replaces a hand-provisioned separate staging project; every PR validates its own migrations/RLS changes against an isolated schema copy.
- CI/CD (GitHub Actions): one workflow running TypeScript checks, RLS pgTAP tests against a Supabase preview branch, Notch Pay sandbox integration tests, and the i18n hardcoded-string/key-parity lint gate on every PR — should exist from the first implementation story onward, not bolted on at the end.
- Supabase region (EU West) is locked before any project is created; actual RTT from Cameroonian mobile networks should be measured alongside the Notch Pay sandbox spike in sprint 1, not just asserted (NFR-010).
- No custom REST/GraphQL API: both dashboards and mobile call Supabase directly via `supabase-js`/`@supabase/ssr` through the service layer; business-logic operations (member invite generation, CSV import validation, renewal orchestration) go through Next.js Server Actions, never raw client-side inserts.
- `supabase gen types typescript` → `packages/types` runs in CI on every PR to catch schema/type drift — the de facto contract between Postgres and all three apps.

**V1.5 additions (from `ARCHITECTURE-SPINE.md`, 2026-08-11 pass):**

- **AD-3 — live-state role/status checks:** new `STABLE` helpers `private.current_member_role()` and `private.current_gym_status()` perform live lookups (not JWT-claim reads) and are called from every RLS policy/`SECURITY DEFINER` function gating on role or gym status, including patching the pre-existing `log_audit_event()` call site that currently reads `auth.jwt() ->> 'app_role'` directly — impacts Epic 9 (FR-089/090) and Epic 11 (NFR-018). A CI grep-lint gate forbids new `auth.jwt() ->> 'app_role'` call sites in migrations (27 existing ones are grandfathered).
- **AD-6 — staff-creation RPC pair:** `create_staff_member()` / `update_staff_role()` are `SECURITY DEFINER` RPCs with a hard caller-vs-target role-ceiling allowlist checked via AD-3's helper — structurally distinct from Story 1.5's Super-Admin gym/owner creation (that one bypasses RLS entirely; this runs inside the caller's normal Owner/Supervisor RLS session). Because Postgres functions can't call the Supabase Auth Admin API, a passing ceiling check gates a Server Action calling `supabase.auth.admin.createUser` via the service-role client, reusing Story 1.11's temp-password-over-WhatsApp activation — no second activation flow. Impacts Epic 9, Story 1.
- **AD-14 — SaaS billing is a separate table/RLS audience:** new `saas_billing_payments` table, Super-Admin-scoped RLS, distinct from gym-scoped `payments` (mirrors the `job_runs`/`audit_log` platform-level-concern precedent). `PaymentProvider` gains a discriminated routing context (`{type:'gym', gym_id}` vs `{type:'platform'}`) selecting Vault-stored credentials at initiation/verification/reconciliation. The single shared `payment-webhook` Edge Function dispatches on the routing context carried in the webhook's own reference/metadata — not a second Edge Function; `payment_webhook_events` stays one shared idempotency log regardless of flow. Both jobs' discrepancy detection (the 4-category classification, FR-036/FR-137) is one shared function/module called by both cron jobs. Impacts Epic 11 and the Epic 4 extension.
- **AD-15 — per-gym Tara Money credentials in Supabase Vault** (chosen over pgsodium/app-layer encryption as least code to own) — impacts Epic 4 extension (FR-126) and Epic 11. Note: confirm Supabase Vault's current GA/beta status before treating it as a hard payments dependency — the architecture spine flags it as carrying beta language as of this pass.
- **AD-21 — bounded-capacity booking RPC:** `book_class_session()` is a `SECURITY DEFINER` RPC that `SELECT ... FOR UPDATE`-locks the `class_sessions` row, counts existing bookings, and inserts only if under capacity — one atomic transaction, distinct from the one-open-check-in uniqueness-index pattern (a bounded count can't be expressed by a partial unique index). Class attendance (FR-107) is a status column on `class_bookings`, never a write to `attendance_events` — floor check-in stays `attendance_events`-only. **Flagged in the architecture spine as extrapolation from precedent, not proposal-sourced** — confirm the RPC-vs-lighter-mechanism call during Epic 12 story-writing. Impacts Epic 12.
- **AD-24 — dedicated private bucket for progress photos**, never the existing public `member-photos` bucket (Story 2.6 precedent) — private, signed URLs, non-guessable paths. Impacts Epic 10 (FR-094, NFR-011).

**V1.6 additions (from `ARCHITECTURE-SPINE.md`, 2026-10-11 update, AD-27–AD-32; supersedes the 2026-08-11 notes above where they conflict):**

- **Prerequisite — AD-3 CI grep-lint gate is unbuilt.** No CI step blocks new `auth.jwt() ->> 'app_role'` reads; 52 migration files carry the pattern (new sites in 0098–0102). Build the gate (explicit grandfather list) **before** any V1.6 migration — AD-27, AD-29, AD-30, AD-32 rely on `private.current_member_role()` with no other mechanical guard.
- **Prerequisite — flagged-payment reason discriminator (AD-27).** Late-confirmed and wrong-account Tara payments are both stored `flagged` today. FR-158 needs them distinguishable (a late session confirmation creates the session; a wrong-account one never does) before the session payment branch ships.
- **Prerequisite — old-build check-in denial (AD-29).** *As-built correction (2026-10-12): on hosted PostgREST 14.5 a NULL composite reaches clients as an all-null row, so builds before mobile 1.1.0 show a false success on a refused scan; 1.1.0+ treats an all-null row as a refusal.* `check_in()` keeps its shipped contract (`RETURNS attendance_events`, `null` = blocked). Old mobile builds map `null` to their **expired** screen — a denied guest is not admitted but sees expiry copy. The current build must map `null` at a charging gym to the session-required state by reading the latest attempt; never add a coded row to the return type (old builds read any non-null row as success).
- **AD-27 — `payments.purpose ∈ {subscription, registration_fee, session}`.** Adding `session` amends, in one migration: the CHECK, `protect_payment_purpose_and_void`, the staff-insert policy clause, the notification-trigger skip, the revenue line. Each purpose's effect is one shared `private.` function called from every completion path. Late-confirmation rules are per purpose and intentional (fee: not applied; session: applied + audited). Desk session payments go through a definer RPC that reads the amount from the plan. One in-flight payment per member and purpose: member lock + stale-expiry helper (0100's 10-minute rule) first, partial unique index as backstop. Canonical lock order: `class_sessions` → payment → member (`FOR NO KEY UPDATE`) → `attendance_events` → `subscriptions` → `guest_sessions` → `loyalty_progress`.
- **AD-28 — `guest_sessions`** is the single session record (paid or free, CHECK XOR `payment_id` / loyalty grant), with `usable_until`, `consumed_at`, `covered_day` (gym-local date, written at consumption), `voided_at`; value is the linked payment's amount. No direct write policy for any role. Session refunds are an `AFTER INSERT` trigger on `refunds` (refunds are direct inserts today).
- **AD-29 — one consumption function:** `private.consume_guest_session(member_id, gym_id, receipt_at)` under the member lock, called only by `check_in()` (online + offline sync) and class-attendance marking. Server receipt time governs; days via `private.gym_local_day_bounds()` (0097). Awards the guest stamp itself. 0 XAF plans exempt. V1.6 migration revokes direct INSERT/UPDATE/DELETE on `attendance_events` and `class_bookings` from `authenticated`/`service_role` (after grepping existing service-role writers); `mark_class_attendance()` gains an `attended_at is null` guard; partial unique index `guest_sessions (member_id, covered_day) where consumed_at is not null`.
- **AD-30 — loyalty ledger:** append-only `loyalty_events` unique on `(origin_id, event_type)`; derived `loyalty_progress` (per member per gym, two counters) written only by definer functions in the earning transaction; one `private.award_renewal_stamp()` called from every renewal-verification path (`confirm_renewal`, `renew_subscription`, `complete_verified_payment`, 0031 staff-verify — enumerate by grep); R-day reward extends `expires_at` in the same transaction (AD-18 re-derives state next run); one `effective_loyalty(member_id)` read function for app and dashboard; `private.reverse_session_stamp()` from the refund path; 90/60-day windows on a platform config row. `[ARCH ASSUMPTION — OQ-B]` lapses and resets persisted and audited by a daily `pg_cron` sweep with its own `job_runs` name; reads compute effective state and never write.
- **AD-31 — blocked attempts vs. alert:** `session_attempts` (gym, member, scan id, occurred_at, source `check_in`|`class`), unique on `(gym_id, member_id, scan_id)` where scan_id not null — the only source of FR-163's blocked counts; class marking generates its own id per action. The alert is a `front_desk_alerts` row with a new `kind` column (`status` becomes nullable under a kind-aware CHECK; one-active index rebuilt over `(member_id, kind, coalesce(status,''))`); the index swap and the rewrite of **every** `ON CONFLICT (member_id, status)` site (0034, 0068, 0090 ×3 — grep) ship in one migration; `front_desk_alerts_protect_columns` pins `kind`; dashboard alert queries branch on `kind`. Reuses AD-20's channel and degrade path.
- **AD-32 — one audited setter RPC per gym setting** (`charge_guests_per_session`, loyalty enabled/N/K/R, `category`), role-checked via `private.current_member_role()`, each with **its own** BEFORE UPDATE pin trigger (never another branch in `protect_super_admin_only_gym_columns()`). `charge_guests_per_session` is added `NOT NULL DEFAULT false`, then `SET DEFAULT true` — never `ADD COLUMN … DEFAULT true` (would switch charging on for every live gym). `category` stored as a stable code, labels in `packages/types`, Super Admin admitted by its setter. FR-173: plan type/price change only via a definer RPC that refuses a type change once subscriptions exist and audits type/price changes.
- **Edge Functions stay at 3** `[ARCH PROPOSAL — OQ-A]`: Tara session payments reuse `payment-webhook`'s purpose dispatch; no new function.
- **Production is live with real gyms:** every V1.6 behavior ships behind its per-gym flag (charging off for existing gyms, loyalty off by default). Ops items with no owner yet — migration release order and rollback, backup/PITR, staging, secrets rotation, `job_runs` failure alerting, a hosted-privilege CI check (0104 drift) — must be owned before V1.6 reaches live gyms.

**V1.7 Step 1 — GymOS support staff (architecture spine AD-33–AD-41, amended after reviewer gate 2026-10-15):**
- **AD-33 — support is its own role:** new `member_role` value `support`, denied by default (no existing policy lists it). `support_assignments(support_user_id, gym_id, state pending|active|suspended|ended, …)` is the source of truth; the `members` row (`role='support'`) exists only while `active`, written only by one SECURITY DEFINER function, enforced by a constraint trigger (active assignment AND `gyms.allow_gymos_support`). That function owns FR-175/FR-193 checks. Every staff-target predicate written `role != 'member'` (0062/0063/0064/0090 and like) is rewritten to an explicit staff-role list excluding support.
- **AD-34 — one live gate, read + write:** `private.current_member_role()` returns `support` only when assignment active, switch on, gym not suspended, account activated/unlocked/no reset pending, JWT `aal2`, session still in `auth.sessions`, within AD-40 limits. VOLATILE `private.support_gate_touch()` records last-seen/velocity and returns breaches as a result, never raises. Edge/service paths call `authorize_support_action(actor, gym_id, capability)`. Amends AD-3: for support, `private.gym_id()` checks the live assignment; the claims hook (AD-4) emits support claims only for active assignments at aal2 `[ASSUMPTION — spike]`. Active gym via `switch_active_gym()` only. AD-3's CI grep gate extended with a generated claim-read inventory.
- **AD-35 — capability registry:** `support_capabilities(capability, rpc_name|policy_name)`; catalog test classifies every policy/function mentioning `'supervisor'`; pgTAP matrix asserts the denied set. Money/access writes include `private.support_step_up_ok()`. Support-created staff tagged `created_by_support`, not deactivated on revocation, listed for Owner review.
- **AD-36 — DROPPED 2026-10-15** (no Owner confirmation, see FR-180). The proposal table, hash binding and Owner re-auth are not built. Support connects directly through one audited, step-up-gated function that still derives the masked id and runs the 0083 collision guard server-side.
- **AD-37 — versioned credentials:** unique constraints on `gym_payment_credentials` become partial unique over active rows (`retired_at is null`); `payments.credentials_id` recorded at initiation and backfilled; webhook resolves by `credentials_id` (or business-id match across the gym's non-deleted rows, then sets it); initiation takes the credentials lock shared, apply exclusive; retired credentials kept until no pending/processing payment and ≥7 days (cap 14), then deleted by a job; an unverifiable webhook is rejected 401 before any write (NFR-002, AD-17).
- **AD-38 — TOTP at AAL2, server-function enrollment:** support sign-in phone+password then TOTP; invite single-use, hashed, 24 h, bound to verified phone; factor enroll/remove only through a server function checking `aal` first (spike: a lower session cannot add a factor via the provider; database guard if it can); FR-193 checks at creation, activation and every assignment; Super Admin holds exactly two verified factors on separate devices; `private.is_super_admin()` enforces aal2 while a platform flag is on, support creation refused while off, flag flipped once by a one-time script; reset with 30-minute cooling-off.
- **AD-39 — per-gym proxy actor:** one proxy `users` row per gym (`is_support_proxy`, "GymOS Support", banned auth user created at gym creation, backfilled by script); `private.actor_id()` returns it for support sessions and every attribution column and `log_audit_event()` uses it; real identity in `support_action_identity` (Super Admin-only). Generated inventory over `pg_proc` bodies/triggers lists every writer of `auth.uid()` into an actor column; each must call `private.actor_id()`; CI fails on an unlisted writer; `WITH CHECK (actor_id = auth.uid())` policies become `= private.actor_id()`.
- **AD-40 — application-enforced limits:** `support_session_state(session_id, started_at, last_seen_at)` and `support_stepup(user_id, action, subject_id, expires_at, consumed_at)`; gate denies >8 h or >15 min idle (Super Admin 8 h / 30 min `[ASSUMPTION]`); step-up is a server action (fresh TOTP, 5-minute, single-use, action/subject-bound, keyed to the user, not `amr`); reset/lock/removal clears state and `auth.sessions`; wrong-code lockout is an application counter.
- **AD-41 — table-driven jobs, each its own cron:** velocity counted by `support_gate_touch()`, breach sets `users.support_locked_at`; independent jobs writing `job_runs` (AD-19): `support_inactivity_sweep` (30 d, quarterly recertification, suspended gyms excluded), `support_activity_digest` (daily per-gym Owner summary plus review queue, via AD-25), `payment_connection_cleanup` (AD-37). Revocation re-owns pending items to the proxy actor and flags them (FR-184).
- **Step 1 spikes (verify, not decided):** claims hook receives `aal`; lower-level session cannot add a factor via the provider; deleting `auth.sessions` rows via service-role function; `vault.delete` via SQL and non-superuser definer calling `vault.*` on hosted; hosted MFA factor cap; whether the payment provider returns an account-holder name; `__Host-` cookie behavior under Supabase SSR.
- **Story notes from the Step 1 reviews:** staff login screen becomes a Phone | Email choice with a password; reset-cooling-off executor job; attribution-column inventory; Super Admin session timeout values; the `ALTER TYPE … ADD VALUE` migration and the policy/function classification pass it triggers.
- **Pre-flight (PRD §10.2):** TOTP enabled on production Supabase (done 2026-10-15, OQ-27); OQ-30 and OQ-31 answered; existing Owners told about support access (FR-183); Super Admin factor enrolled with recovery in place and out-of-band recovery documented (FR-191). Precondition recorded by 22.6: `super_admin_aal2` must be ON (enable script run, docs/runbooks/super-admin-recovery.md) before any support account is created.
- **Steps 2–3 have no architecture coverage yet:** subdomain/DNS policy under `gymosapps.com` vs `owner.`/`portal.`, the published projection, name rules, host-only cookies (NFR-026) and public-content control need their own spine pass before landing-page and directory stories are written (spine "Deferred"). Resolved inputs already in the PRD: public site built in `apps/landing`, `*.gymosapps.com` wildcard attached to that Vercel project (PRD §12 F).

### UX Design Requirements

**V1.7 UX gap (recorded 2026-10-15):** the UX spine (`DESIGN.md`/`EXPERIENCE.md`, 2026-10-11) has no V1.7 screens, and PRD narratives UJ-12/13/14 are tagged "confirm before UX". No UX-DR is invented here. V1.7 stories are anchored in FR/AD wording, as V1.5 was; a follow-up `bmad-ux` pass is expected before the visual surfaces (support staff Settings states and confirmation screens, landing-page editor and public templates, directory) are built.

- UX-DR1: Implement the three-token brand system (`primary` #1B2A41, `accent` #E0971F, `background` #FAFAF7) with the per-gym `primary_color` override that replaces `accent` on authenticated member-facing surfaces only — the platform shell (onboarding, login, Super Admin) always uses the platform accent, never the gym color.
- UX-DR2: Build `FrontDeskAlertPanel` as a single variant-driven component (`variant`: `dashboard` | `attendance-row` | `subscription-row`) — no per-page forks — rendered on Overview (AD-02) and Attendance (AD-11); pushes page content down (no z-index overlay), max 5 alerts visible with internal scroll for 6th+, newest-on-top, `aria-live="assertive"` for red alerts and `aria-live="polite"` for yellow, no sound/browser notification in V1.
- UX-DR3: Build `InlineRenewalPanel` as a single reusable component triggered from the front-desk alert, the Subscriptions page row, and the Overview expiring table — expands inline (not a navigation), tablet breakpoint (768–1023px) renders it as a 320px right-side drawer instead; pre-populates plan/price/date; supports the 3-tap straight-through cash-renewal sequence.
- UX-DR4: Implement the Admin Dashboard sidebar as a single role-filtered component: items inaccessible to the current role are absent from the DOM (never shown disabled); Coach role renders only the "Coach Portal" link; responsive behavior collapses to a 64px icon rail (768–1023px) and a hamburger overlay (<768px).
- UX-DR5: Implement the 5-state subscription/member status badge system (Active/green, Expiring Soon/orange, Grace Period/orange+icon, Expired/red, Deactivated/gray, No Active Plan/gray) consistently across Member App Home, Members list, Subscriptions list, and Coach Portal — status must be communicated by color AND label text AND icon, never color alone.
- UX-DR6: Build the Member App onboarding flow (MA-01–MA-08) as a linear, non-skippable sequence with a segmented step-progress indicator (steps 5–8), back navigation to the prior step only, and a sequencing guard that blocks direct navigation into any step out of order.
- UX-DR7: Implement the OTP verification input (MA-03) as six auto-advancing digit boxes with paste-to-fill-and-auto-submit, shake-and-clear on incorrect code, a non-interactive countdown that becomes a tappable "Resend" link at zero, and a hard transition to the OTP Lockout screen (MA-04, back-navigation intercepted) after 3 resend attempts.
- UX-DR8: Implement the Check-In screen's 5 full-screen result states (MA-10: success-online, success-offline-with-sync-indicator, wrong-QR, already-checked-in, expired-denied) as distinct designed moments — each with its own icon, color, copy, haptic, and auto-dismiss/require-tap behavior — not one generic toast.
- UX-DR9: Build the CSV Import flow (AD-07) as a 2-step wizard: upload → validation (all-or-nothing; success preview of first 5 rows, or a per-row error table with row/column/reason) → confirm, with a polling progress indicator for imports over 100 records and an explicit "no records were saved" failure message.
- UX-DR10: Implement the global empty/loading/error state system exactly as specified: loading uses the 300ms/1000ms/3000ms timing rules (nothing → skeleton → skeleton + "Still loading…"), skeleton shapes match each screen's real content dimensions, and every listed empty state (Members, Subscriptions, Payments, Audit Log, Coach Portal, Gym List, Tiers, etc.) uses its specified copy and primary action.
- UX-DR11: Implement the global form-validation pattern: validate on submit only (not per-keystroke, except live-search inputs), inline field-level errors on submit, server-validation errors mapped per-field with an unmapped-error summary above the submit button, and the specific field-level rules tables for MA-02/03/05/06-07, AD-05/07/10/13/16, SA-04/06.
- UX-DR12: Implement the accessibility floor for both surfaces: mobile — `accessibilityLabel` on all interactive elements, 44×44pt minimum touch targets, alert-role announcement on check-in results, digit-by-digit OTP box labeling, font scaling up to +2 steps without clipping; dashboard — full keyboard traversal with visible focus rings (never `outline: none` without a replacement), `aria-live` alert regions, `<table>`/`aria-sort` semantics, focus-trapped modals, and destructive-confirmation buttons labeled with the specific target ("Deactivate Amara K.", not "Confirm").
- UX-DR13: Implement the Admin/Super Admin responsive breakpoint system (≥1280 full sidebar and columns; 1024–1279 hides secondary columns; 768–1023 icon-rail sidebar + reduced columns; <768 hamburger-only with a persistent "use desktop" banner) and the corresponding table column-hiding priority (Last Check-in/Actor/Duration first, then Phone/Email/Join Date/Billing Interval).
- UX-DR14: Implement bilingual (EN/FR) parity as a build-time and content requirement: the Voice and Tone microcopy table's exact strings (front-desk alerts, check-in states, lockout, destructive confirmations, offline banners) in both languages, with EN/FR string counts required to match on every PR (ties to FR-016's CI gate).
- UX-DR15: Implement the Member App interaction primitives: screen-transition animations (slide-left forward / slide-right back / slide-up-down for modals / fade for check-in results / cross-fade for tabs) and haptic feedback (medium impact on check-in success, notification-error on denial, warning on incorrect OTP, heavy impact on confirmed destructive actions).
- UX-DR16: Implement the real-time alert arrival behavior consistently: new alert slides in at the top of the stack, existing alerts shift down, no sound/browser notification/tab badge in V1, and the dashboard offline banner ("You're offline. Data may be outdated." + Refresh) versus the member-app offline banner ("You're offline — check-in still works.") are distinct, surface-specific components.

**V1.5: no UX Design Requirements available.** The UX design contract (`ux-gym_os-2026-07-04/DESIGN.md` + `EXPERIENCE.md`) has not been updated since 2026-07-04 and has no mockups for staff management, progress tracking, classes/booking, workout-plan authoring, the Super Admin Billing view, or the Tara Money connect-account flow — flagged explicitly in the 2026-08-11 sprint-change-proposal as needing a dedicated `bmad-ux` pass, routed separately from this workflow. Stories for Epics 9–13 below derive their acceptance criteria from FR/AD wording and reuse V1.0 UX patterns (UX-DR1–16) where a V1.5 screen is a variant of an existing one (e.g. status badges, empty states, form validation); net-new screens are flagged inline where UI detail is genuinely undefined pending that UX pass.

**V1.6 (UX pass 2026-10-11).** The epics were first written without a UX pass (user decision 2026-10-11); the same day `bmad-ux` extended `DESIGN.md` and `EXPERIENCE.md` (`ux-gym_os-2026-07-04`) for V1.6 and resolved every `[UX]` marker in Epics 19–21. UX-DR17–UX-DR32 below carry that pass into the stories; where a story AC and `EXPERIENCE.md` differ, the story's AC and the section named in the UX-DR are to be read together, and `EXPERIENCE.md` governs copy and layout. UX-DR2, UX-DR5, UX-DR8, UX-DR10, UX-DR11, UX-DR14 and UX-DR15 still apply as base patterns.

- UX-DR17: Add the platform-fixed `info` status token (`#2563EB`; white text 5.17:1, on `#FAFAF7` 4.94:1) as the fifth status-semantic colour next to `success`/`warning`/`danger`/`neutral`. It marks recoverable action-required or pending-verification states only (session-required overlay and alert, "will be verified" overlay, post-sync denial notice, guest "no paid session" badge, refund-notice borders). It never takes the per-gym accent override, is never `danger` (red stays "expired"), and is always paired with a label and an icon.
- UX-DR18: MA-10 gains two full-screen `info` result overlays that require a tap: **"Pay for your session"** (`confirmation_number` icon; body "You need a paid session to check in today. [price] covers the whole day."; [Pay now] shown only when the gym has Tara Money connected → MA-17, [See the front desk] secondary then, primary otherwise; error haptic) and **"Check-in saved — your session will be verified"** (`hourglass_top` icon; warning haptic; replaces the green offline success for a guest at a charging gym). Free-session check-in uses the unchanged green success with the sub-line "Free session used". EN uses a new "See the front desk" key; FR reuses "Voir l'accueil".
- UX-DR19: MA-09 Home for a Pay-per-session member (price > 0) at a charging gym: the `raised` status card swaps the expiry line for a sessions line with three states ("Today covered" `success`; "[N] paid session(s) · use by [date]" `neutral`; "No paid session — pay before you scan." `info`), appending " + [M] free" when held. A **[Pay for a session]** quick action is first in the row only when there is no usable session and Tara is connected. A dismissible `info` post-sync denial notice sits above the status card (several collapse into one with "+[N] more"; no Pay action). Offline banner reads "Offline check-in waiting to be verified…". A session payment shows in recent activity as "Session payment: [amount]". Exempt members see Home exactly as shipped.
- UX-DR20: MA-09 **Rewards card** (`flat`, below the quick actions, above Upcoming Classes; absent — not empty — when the program is off and nothing is held): the Loyalty Progress component (`{components.loyaltyProgress}`: "n / N" `statNumeral`, N pill segments in `accent`, a continuous bar above 12 segments, sentence accessible label, decorative glyphs), only the counter matching the member's current plan, Session Chip rows (`{components.sessionChip}`: paid ticket/`accent`, free gift/`success`, dormant free gift/`neutral` with "Usable when you're back on Pay-per-session"), a once-per-grant "Free session earned — valid for [60] days" headline tracked on the device, the "[R] free days added — your new renewal date is [date]" line for subscribers, and the reset footnote (windows read from config). Lapsed rows drop silently. Active gym only.
- UX-DR21: **MA-17 Pay for Session** (`/pay-session`): pushed full-screen route mirroring `/renew` — plan card with display-only price, "Paying with" payer phone, [Pay [price]], phases idle → sending → pending → stillWaiting (45 s) → verified/flagged reusing the shipped `renew.*` keys, and the inline error table (already in progress, Tara unavailable, charging turned off, plan changed / price 0, payer phone invalid, other). Success shows "Session paid" with [Scan now] replacing the route with MA-10. Offered only when charging is on, Tara is connected, and the member is Pay-per-session with price > 0.
- UX-DR22: Front-desk alert panel **session-required variant** (`kind = 'session_required'`, the same single component): `info` status dot, header "SESSION REQUIRED", body "[Name] · No paid session · [time]" plus "Record a payment so they can scan again.", optional "From class: [name]" and "Scanned offline at [time]" source lines, a "Mobile money payment in progress" line when a Tara session payment is pending, [Record session payment] (no [Renew]), `aria-live="assertive"`, one active alert per member, dismissed server-side on payment and by manual ✕ / auto-dismiss. Dismissal never changes Guest sessions figures. Tablet: the in-flight line truncates first.
- UX-DR23: **Record Session Payment Panel** (sibling of `InlineRenewalPanel`, not a reuse): title "Record session payment"; read-only Amount with caption "plan price — fixed"; Method (Cash default, Manual Mobile Money; Bank Transfer present only for Manager/Supervisor/Owner and absent from the DOM for a Receptionist); optional Note ≤200 chars; Recorded by; two-tap straight-through. Success toast "Session recorded for [Name]. Ask them to scan again." Refusals render inline and keep the panel open for: payment in progress, charging off, not Pay-per-session, price 0, member deactivated, awaiting registration fee, gym suspended, bank transfer not permitted (global permission copy), network. Opens from the alert, the AD-04 header, and an AD-18 refusal row; inline within the trigger, 320px right drawer at 768–1023px, an inline expanding section inside the AD-04 modal. Tab order Method → Note → Record → Cancel; focus returns to the trigger.
- UX-DR24: **AD-04 member detail** is the View mode of `MemberModal.tsx`, not a `/members/:id` page; V1.6 adds sections to the modal. **Sessions** (Unused / Used / muted "Lapsed [date]" and "Voided by refund [date]" for 90 days, link to AD-09 filtered to Purpose: Session) renders for a Pay-per-session member at a charging gym or any member holding session rows. **Rewards** renders when the program is on or an unexpired free session is held, shows both counters and free sessions, and has no edit control for any role including Super Admin (no disabled control either). **[Record session payment]** in the modal header appears to Receptionist+ only for a Pay-per-session member, price > 0, charging on; otherwise absent from the DOM. Coach sees nothing new.
- UX-DR25: **AD-02 Guest sessions card** (Owner/Supervisor/Manager; absent from the DOM for Receptionist and Coach, and for every role while charging is off): a full-width row below row 2 in its own Suspense boundary; "Today / This month" as a `radiogroup` (default Today, remembered per user in `localStorage` as a convenience only); three `statNumeral` figures — Paid sessions, Blocked attempts with "[N] members", Free sessions given — each linking to the matching AD-22 tab and period; zero renders "0"; in-card error with [Retry]; three columns ≥768px, stacked below. Plus a **"Guest sessions: XAF N"** sub-line under Revenue this month, in addition to (not "of which") the subscription headline; hidden if its read fails.
- UX-DR26: **AD-22 Guest Sessions** (`/guest-sessions?tab=paid|blocked|free&period=today|month`, Manager-plus by construction, no sidebar item; a Receptionist who types the URL gets the global permission state): Paid tab (Member, Time, Method, Recorded by, Used, Refund; group by Recorded by or None; Tara payments grouped under "Tara Money (in app)"; "Refunded after use only" chip), Blocked tab (Member, Time, Source "Check-in" or "Class: [name]"; header "[N] attempts · [M] members"; offline attempts note "(synced [time])"), Free given tab (Member, Earned, Use by, Status). Member name opens the AD-04 modal; 50 rows/page; counts are server-side aggregates; the three empty states use their own copy; 6 skeleton rows; page-level error with [Refresh].
- UX-DR27: **AD-13 Settings V1.6 save model.** Each V1.6 section has its own setter and its own save, and is excluded from [Save Settings] (so a general save can neither revert nor be blocked by it; edits in either are kept when the other saves). The page hint gains "…except Registration fee, Charge guests per session, Loyalty program and Category, which save on their own." **Charge guests per session** (Owner/Supervisor): the toggle flips only after a confirmation; turn-on dialog shows the fixed count line ("[N] Pay-per-session members will need a paid session at their next visit", plural-aware, zero and one variants), the scope line, and the old-app-version warning in a `warning` box; [Start charging] stays disabled until the count loads (count failure shows a [Retry]); Escape disabled; focus lands on [Cancel]; a turn-off dialog ("Stop charging guests per session?", sessions kept but unused, "Guests stop earning loyalty stamps" when loyalty is on). **Loyalty program**: inputs with ranges (N 2–50, K 3–24, R 1–30), disabled while off and keeping their last values, a live `aria-live="polite"` effective-discount readout (guest: `round(100/(N+1))`; subscriber: `round(100·R/(K·D+R))` with one line per distinct active non-session plan duration naming the plan, up to 3, hidden with no subscription plans; out-of-range input hides the readout), a charging-off notice, a lowered-threshold note, and a switch-off note. **Category** select in the Branding block with its own [Save category], disabled until changed.
- UX-DR28: **Payments, Subscriptions, Plans amendments.** AD-09: a Purpose filter/column (All / Renewal / Registration fee / Session; included in CSV export), a reason tag beside Flagged (`late_confirmation` "Confirmed late" — a late-confirmed session shows Verified plus the tag; `wrong_account`; `expired_attempt` "Attempt expired"; `reconciliation_mismatch` — a wrong-account or mismatch session stays a discrepancy row with no linked session), desk session payments listed directly as `verified` (never in the Verification Queue), and live `info`-bordered refund notices in the Record Refund modal (full unused / partial / already used, with the loyalty clause only when loyalty is on; renewal notice when loyalty is on) with a success toast naming what actually happened. AD-10: unchanged, no Session purpose, plus a hint under the member field for a Pay-per-session member at a charging gym. AD-08: Last Payment ignores `session` payments. AD-23 Plans: a locked read-only Plan Type with a lock icon and reason (`aria-readonly`, reason via `aria-describedby`); "Price per session (XAF)" label and "XAF 2,000 / session" row text for Pay-per-session; helpers for price edits ("Changing the price doesn't affect sessions already paid.") and price 0 ("At 0 XAF, members on this plan never need a paid session.").
- UX-DR29: **AD-18 marking a session guest**: the "Attended" checkbox stays enabled; with no usable session the checkbox reverts and an inline `role="alert"` row message (`info` left border) reads "No paid session — attendance was not recorded. A front-desk alert has been raised." with [Record session payment] opening the panel in place; after payment the message reads "Session recorded — mark attendance again." and focus returns to the checkbox; the system never auto-marks. Re-marking an attended member is a no-op. The Coach roster (AD-21) stays read-only.
- UX-DR30: **Session vs class terminology.** A paid or free day-visit is a "session" in EN and a "séance" in FR; a class is a "class" / "cours" (or "séance de cours" for an occurrence). V1.6 EN copy always qualifies the word ("paid session", "free session", "guest sessions", "session payment"), never a bare "session". When a V1.6 story touches a screen that shows a class occurrence its FR strings move to "cours" (AD-18 "Prochaine séance" → "Prochain cours", "Aucune séance à venir" → "Aucun cours à venir"). Coach "Notes de séance" (AD-15) is unchanged.
- UX-DR31: **Audit and Super Admin amendments.** AD-12 carries the 18 V1.6 action labels in EN/FR (charge-guests toggled, desk session payment, Tara session payment, late Tara confirmation, session consumed, blocked attempt, refund voids session, refund after consumption, paid session lapsed, plan type/price changed, loyalty config changed, stamp earned, stamp reversed, reward granted, free session used, free session lapsed, progress reset, gym category changed); rule-driven events show Actor "System" when no staff member acted; the exact event-code mapping is settled in each story. Super Admin: SA-02 gets a plain-text Category column after Gym Name (no chip, no filter); SA-03 a `Category: [label] [Change]` row with an inline select, [Save]/[Cancel], toast "Category updated.", no confirmation; SA-04 a required Category select defaulting to Gym / Salle de sport with no free text for Other. SA-03/SA-04 never show or set Charge guests per session or Loyalty (AD-32).
- UX-DR32: **V1.6 haptics and accessibility.** Haptics: "Pay for your session" notification error; "will be verified" notification warning; free-session success medium impact; MA-17 verified notification success, failed notification error. Check-in overlays keep fade-in; MA-17 pushes slide-left/right like `/renew`. Accessibility: session overlays use the `alert` role and are never colour-only; Loyalty Progress glyphs are decorative with a sentence label; Session Chip rows read as one label with dates spoken in full; the post-sync notice is a polite live region with a "Dismiss notice" label; the session alert is assertive and announces the in-flight line only when it appears; panel refusals are `role="alert"` linked by `aria-describedby`; the Charge-guests confirm button is labelled "Start charging" / "Stop charging", never "Confirm"; the readout updates after a 300 ms typing pause with "≈" read as "about".

**Shipped drift recorded by the UX pass (no new work):** `/renew` (Story 4.15), `/awaiting-registration` (Story 18.7, FR-155) and the Plans page (AD-23) are now documented in `EXPERIENCE.md`; the Registration fee Settings field and the Registration-fee dialogs (Epic 18) are shipped and not re-specced. **Flagged for the product owner (not changed here):** UJ-11 has the receptionist doing Manager-plus actions (AD-05 member create, waiving the registration fee), and FR plan wording is inconsistent ("Forfait" vs "Formule").

### FR Coverage Map

FR-001: Epic 2 - Phone-based identity, one user across gyms
FR-002: Epic 2 - Phone OTP registration
FR-003: Epic 1 - Role hierarchy via RLS + JWT claims hook
FR-004: Epic 1 - Super Admin platform-wide role
FR-005: Epic 1 - Per-gym tenant isolation via RLS
FR-006: Epic 1 - Schema scales to hundreds of gyms
FR-007: Epic 1 - Founder-assisted gym onboarding
FR-008: Epic 2 - CSV member import (all-or-nothing)
FR-009: Epic 2 - No historical data migration on import
FR-010: Epic 1 - Gym onboarding configuration fields
FR-011: Epic 1 - Single white-label app binary
FR-012: Epic 1 - Settings-driven branding (logo/name/color)
FR-013: Epic 1 - Per-gym app stores/themes out of V1 scope
FR-014: Epic 1 - Bilingual EN/FR platform foundation
FR-015: Epic 1 - Language selection & persistence
FR-016: Epic 1 - i18n externalization + CI lint gate
FR-017: Epic 1 - Receipts follow Owner's language
FR-018: Epic 1 - i18n foundation extensible to new languages
FR-019: Epic 2 - Member CRUD + soft-delete (Manager/Owner)
FR-020: Epic 2 - Member record fields
FR-021: Epic 2 - Receptionist view/search/initiate-payment
FR-022: Epic 5 - Coach sees only assigned members
FR-023: Epic 2 - Member self-service profile edits
FR-024: Epic 2 - V1 plan types
FR-025: Epic 2 - Per-gym plan config + billing interval
FR-026: Epic 2 - Integer XAF money storage
FR-027: Epic 3 - Subscription lifecycle state machine (cron)
FR-028: Epic 3 - expiring_soon trigger (7 days)
FR-029: Epic 3 - grace_period trigger + duration
FR-030: Epic 3 - expired state + access loss
FR-031: Epic 4 - Check-in outcomes by member state (accept/reject + alert color)
FR-032: Epic 3 - Renewal resets subscription state
FR-033: Epic 4 - V1 payment methods
FR-034: Epic 4 - Notch Pay via PaymentProvider interface (spiked)
FR-035: Epic 4 - Idempotent webhook processing
FR-036: Epic 4 - Nightly payment reconciliation job
FR-037: Epic 4 - Manual payment verification queue
FR-038: Epic 4 - Mandatory manual payment fields
FR-039: Epic 4 - Fee passthrough to gyms
FR-040: Epic 4 - Refund recording (no provider API)
FR-041: Epic 4 - Payment receipt generation
FR-042: Epic 3 - QR check-in records attendance
FR-043: Epic 3 - Per-gym QR token validation
FR-044: Epic 3 - One open check-in per member (+ stale auto-close)
FR-045: Epic 3 - Manual/auto check-out (timeout cron)
FR-046: Epic 3 - Occupancy calculation
FR-047: Epic 3 - Member-facing occupancy bands
FR-048: Epic 3 - Admin Attendance page
FR-049: Epic 4 - Real-time front-desk alert publish
FR-050: Epic 4 - Alert content + inline renewal panel
FR-051: Epic 4 - Alert stacking/dismiss/auto-dismiss
FR-052: Epic 4 - <3s scan-to-alert latency
FR-053: Epic 5 - Coach Portal role gating
FR-054: Epic 5 - Coach Portal V1 features
FR-055: Epic 5 - Coach assignment + reassignment history
FR-056: Epic 5 - Workout plans/classes deferred (V1.5 marker)
FR-057: Epic 2 - Single Expo codebase, Android + iOS
FR-058: Epic 2 - Member app onboarding sequence
FR-059: Epic 3 - Member app Home screen
FR-060: Epic 3 - Check-In screen states
FR-061: Epic 3 - Offline check-in only
FR-062: Epic 3 - Member view of plan details + check-ins (payment-history portion completed in Epic 4, Story 4.9)
FR-063: Epic 2 - Profile screen language/photo (same screen as FR-023)
FR-064: Epic 1 - Dashboard pages/roles shell
FR-065: Epic 4 - Overview alert panel as primary renewal surface
FR-066: Epic 2 - Members page search/filter/export
FR-067: Epic 4 - Payments verification queue page
FR-068: Epic 7 - Audit Log page (read-only)
FR-069: Epic 1 - Settings page configuration
FR-070: Epic 1 - Separate Super Admin app + auth
FR-071: Epic 1 - Super Admin V1 capabilities
FR-072: Epic 1 - Escalated support access (audit-logged)
FR-073: Epic 1 - Default tiers, Super Admin configurable
FR-074: Epic 6 - Expo Push → FCM/APNs routing
FR-075: Epic 6 - V1 notification schedule
FR-076: Epic 6 - Notification preferences/opt-out
FR-077: Epic 6 - Push token cleanup
FR-078: Epic 6 - Bilingual notification copy
FR-079: Epic 1 - Append-only audit log (DB-enforced, built in Story 1.4)
FR-080: Epic 7 - Audit-logged actions + record fields
FR-081: Epic 7 - Audit Log filtering + export
FR-082: Epic 2 - Member invite generation + deep link
FR-083: Epic 2 - Member deactivation behavior
FR-085: Epic 4 - Subscriptions page + manual renewal
FR-086: Epic 2 - Member cap enforcement (trigger + Server Action)
FR-087: Epic 9, Story 9.1 - Staff account creation with role-ceiling enforcement
FR-088: Epic 9, Story 9.2 - Staff activation (temp password SMS, pending_activation)
FR-089: Epic 9, Story 9.3 - Staff edit/deactivate with role-ceiling on edits
FR-090: Epic 9, Story 9.3 - Immediate role-change/deactivation revocation
FR-091: Epic 9, Story 9.4 - One phone, one role per gym
FR-092: Epic 9, Story 9.4 - Coach account is portal-access-only role
FR-093: Epic 10, Story 10.1 - Optional body profile fields
FR-094: Epic 10, Story 10.1 - Progress entry logging (offline-safe)
FR-095: Epic 10, Story 10.2 - Progress/photo RLS privacy + per-photo sharing
FR-096: Epic 10, Story 10.3 - Member Progress screen (charts, trends, timeline)
FR-097: Epic 10, Story 10.1 - Offline queueing extended to progress logging
FR-098: Epic 10, Story 10.4 - Coach Portal Progress tab (read + note only)
FR-099: Epic 4, Story 4.12 - Tara Money formalized as documented provider (amends FR-034)
FR-100: Epic 4, Story 4.10 - Tara Money sandbox spike re-verification against real business account
FR-101: Epic 4, Story 4.11 - Tara Money webhook signature verification
FR-102: Epic 4, Story 4.12 - Notch Pay → Tara Money cutover procedure
FR-103: Epic 4, Story 4.12 - MTN/Orange coverage via Tara Money (parity with FR-033)
FR-104: Epic 12, Story 12.1 - Class creation (Manager/Owner)
FR-105: Epic 12, Story 12.2 - Class booking with server-side capacity enforcement
FR-106: Epic 12, Story 12.2 - Booking cancellation with cutoff
FR-107: Epic 12, Story 12.3 - Receptionist marks class attendance
FR-108: Epic 12, Story 12.4 - Member app classes surfaces
FR-109: Epic 13, Story 13.2 - Coach-authored workout plans
FR-110: Epic 13, Stories 13.2/13.3 - Plan assignment + member completion tracking (offline-safe)
FR-111: Epic 13, Story 13.4 - Plan handoff on coach reassignment
FR-112: Epic 13, Story 13.1 - Shared exercise library
FR-113: Epic 6, Story 6.5 - Quiet-gym alert opt-in (N-06 activation)
FR-114: Epic 6, Story 6.5 - Quiet-gym alert rate limiting
FR-115: Epic 6, Story 6.5 - Quiet-gym alerts reuse existing occupancy calc
FR-116: Epic 6, Story 6.6 - Class reminder (N-07), opt-out
FR-117: Epic 1 - WhatsApp invite completion (Story 1.13, shipped)
FR-118: Epic 1 - OTP fallback chain (Story 1.13, shipped)
FR-119: Epic 1 - Evolution API instance config finalized (Story 1.13, shipped)
FR-120: Epic 9, Story 9.1 - Settings Staff section
FR-121: Epic 12, Story 12.1 - Classes admin page
FR-122: Epic 13, Story 13.2 - Coach Portal Workout Plans tab (Progress tab portion: Epic 10 Story 10.4, shares FR-098)
FR-123: Epic 10, Story 10.3 - Member app Progress tab (Classes tab portion: Epic 12 Story 12.4; N-06/N-07 toggles: Epic 6 Stories 6.5/6.6)
FR-124: Epic 4, Story 4.14 - Flow A settlement into gym's own Tara Money account
FR-125: Epic 4, Story 4.14 - No GymOS commission on Flow A
FR-126: Epic 4, Story 4.13 - Per-gym "Connect payment account" flow (Vault-encrypted)
FR-127: Epic 4, Stories 4.13/4.14/4.15 - Cash/Tara Money co-equal, connection is additive
FR-128: Epic 4, Story 4.14 - Credential resolution + graceful failure on missing/invalid
FR-129: Epic 4, Story 4.14 - Subscription purchase/renewal via Flow A (front-desk + self-service)
FR-130: Epic 11, Story 11.3 - SaaS billing per tier/interval, reminder-to-approve model
FR-131: Epic 11, Story 11.2 - SaaS subscription lifecycle state machine
FR-132: Epic 11, Story 11.4 - Tenant-wide suspension on non-payment
FR-133: Epic 11, Story 11.3 - Payment-due notice + one-tap pay link + resend schedule
FR-134: Epic 11, Story 11.5 - Super Admin Billing view
FR-135: Epic 11, Story 11.3 - Owner SaaS notifications (SMS+WhatsApp+optional email)
FR-136: Epic 11, Story 11.6 - Beta free/discounted plan accommodation
FR-137: Epic 11, Story 11.6 - Shared integrity machinery + 4th discrepancy category (Flow A reconciliation portion: Epic 4 Story 4.14)
FR-138: Epic 4, Story 4.14 - PaymentProvider routing context, `{type:'gym'}` variant introduced for Flow A; extended with `{type:'platform'}` by Epic 11, Story 11.1 for Flow B
FR-139: Epic 11, Story 11.2 - Free/Test tier (amends FR-073)
FR-140: Epic 4, Story 4.15 - Member self-service renewal from app (Flow A)
FR-147: Epic 18, Story 18.1 - Registration fee setting (Owner/Supervisor, audited; amends FR-069)
FR-148: Epic 18, Stories 18.1/18.5 - Awaiting-fee member state and server-side first-subscription gate (staff flow: 18.5; member cap: 18.1)
FR-149: Epic 18, Story 18.1 - Once per member, non-refundable, existing members grandfathered (backfill)
FR-150: Epic 18, Stories 18.2/18.6 - Waive (Owner/Supervisor/Manager, audited)
FR-151: Epic 18, Stories 18.4/18.6 - Void a fee recorded in error (Owner/Supervisor)
FR-152: Epic 18, Stories 18.2/18.3 - Fee collection: manual payment (18.2) and staff-initiated Tara Money (18.3); payment purpose
FR-153: Epic 18, Story 18.4 - Refund block, audit entries, own revenue line (amends FR-040/FR-080/FR-143)
FR-154: Epic 18, Story 18.5 - CSV import exemption (amends FR-008)
FR-155: Epic 18, Stories 18.5/18.7 - Invite after settle (18.5); awaiting-fee blocked state in the app (18.7) (amends FR-058/FR-082)
FR-156: Epic 19 - Session guest = ordinary member on a Pay-per-session plan; plan price = session price; 0 XAF exempt; "Session guest" waiver preset
FR-157: Epic 19 - Per-gym "Charge guests per session" setting (off for existing gyms, on for new; affected-members count; amends FR-069)
FR-158: Epic 19 - Paid session record; desk + in-app Tara payment; server-side amount; one in flight; late/flagged/redelivery rules; purpose `session`
FR-159: Epic 19 - Check-in gate: consume one session per gym-local day; 7-day lapse; ordering; server receipt time; denial state (amends FR-042/FR-044)
FR-160: Epic 19 - Session-required front-desk alert + stored blocked attempts (amends FR-049)
FR-161: Epic 19 - Offline guest check-in verified on sync; attempt on no session (amends FR-061)
FR-162: Epic 19 - Session payment audit, refund rules (void unused / reverse stamp on consumed), own revenue line (amends FR-040/FR-080/FR-143); stamp reversal hook completed in Epic 20
FR-163: Epic 19 - Guest sessions Overview card (paid, blocked, free given; by staff; server-side counts)
FR-164: Epic 20 - Per-gym loyalty program setting with N/K/R and live effective-discount readout; per member per gym; two counters
FR-165: Epic 20 - Guest rule: stamp on paid-session consumption; free session at N
FR-166: Epic 20 - Free session (60-day validity, consumption order, survives plan change)
FR-167: Epic 20 - Subscriber rule: stamp per on-time renewal; R free days at K
FR-168: Epic 20 - 90-day reset / windows as platform data; never shown live past window
FR-169: Epic 20 - Member app + dashboard loyalty progress display
FR-170: Epic 20 - No manual balance edits; exactly-once grants; loyalty actions audited (amends FR-080)
FR-171: Epic 21 - Gym category (5 values), set at Super Admin creation, editable by Super Admin/Owner/Supervisor, audited, EN/FR labels
FR-172: Epic 21 - Category is descriptive only in V1.6; wording stays "gym"
FR-173: Epic 19 - Plan type locked once subscribed; type/price changes audited; price change never alters paid sessions
FR-174: Epic 19 - Class attendance by a guest consumes a session under the same function; booking stays free (amends FR-105/FR-107)
NFR-007: Epic 14, Story 14.1 - Sentry error monitoring (dashboard, super-admin, mobile) — added 2026-09-01, closes a gap architecture.md had described as already shipped
NFR-017 (hardening): Epic 4, Story 4.16 - Platform business ID collision guard, closing the reverse-collision gap flagged in Story 11.6's review — added 2026-09-01
FR-141: Story 1.16 (Epic 1) - In-app Super Admin management (backfilled into the map 2026-10-15; delivered 2026-09-07)
FR-142: Epic 16 - Country-picker phone input everywhere (backfilled)
FR-143: Epic 17, Stories 17.1/17.2 - Staff Overview live operational state, net revenue (backfilled)
FR-144: Epic 17, Story 17.3 - Coach Portal navigation and landing (backfilled)
FR-145: Epic 17, Story 17.4 - Coach My Classes and roster (backfilled)
FR-146: Epic 17, Story 17.5 - Coach Portal Overview (backfilled)
NFR-020: Story 1.16 - Super Admin creation/promotion cannot escalate privilege (backfilled)
FR-175: Epic 23 - Super Admin creates a support account; collision refused
FR-176: Epic 23 - Single-use invite, TOTP enrollment inside the flow
FR-177: Epic 23 - Many-to-many per-gym assignment, pending states, serialized with the Owner switch
FR-178: Epic 23 - `support` role, denied by default, FR-087 ceiling
FR-179: Epic 23 - Capability allow-list and denied set (payment connection included, FR-180)
FR-180: Epic 23 - Support connects/replaces the payment account directly; Owner notified (NO approval step, decided 2026-10-15)
FR-181: Epic 23 - Owner notices and daily digest, velocity lock, created-by-support tagging
FR-182: Epic 23 - Single "GymOS Support" row and four Settings states
FR-183: Epic 23 - Owner-only "Allow GymOS Support" switch, default on for new / off for existing gyms
FR-184: Epic 23 - Revocation semantics: complete or roll back, re-own pending items, 60 s subscription cutoff
FR-185: Epic 23 - Super Admin-only removal, 30-day inactivity disable, quarterly recertification
FR-186: Epic 23 - No gym-side read returns an individual identity; per-gym opaque attribution
FR-187: Epic 23 - Audit under the individual, shown as "GymOS Support"; disclosure request
FR-188: Epic 23 - Support excluded from counts, caps, notifications, metrics
FR-189: Epic 22 - TOTP at AAL2 enforced in DB and every edge path; 8 h / 15 min limits; step-up (applied to support in Epic 23)
FR-190: Epic 23 - Super Admin-triggered support factor reset with 30-minute cooling-off (moved from Epic 22 2026-10-15: no support accounts exist to reset until Epic 23)
FR-191: Epic 22 - Super Admin AAL2 with controlled bootstrap and recovery
FR-192: Epic 22 - Live authorization on the next request for every role (amends FR-090)
FR-193: Epic 23 - A Super Admin cannot hold a support account
FR-194: Epic 23 - Explicit active-gym context, no cross-gym request
FR-195: Epic 23 - Support never appears on member-facing surfaces
FR-196: Epic 24 - Optional public page at {name}.gymosapps.com
FR-197: Epic 24 - Page content fields and "what becomes public" screen
FR-198: Epic 24 - Who edits/publishes vs who claims the name
FR-199: Epic 24 - Server-validated publish gate
FR-200: Epic 24 - Opt-in plan visibility
FR-201: Epic 24 - Template module, two seed templates, contract and conformance suite
FR-202: Epic 24 - Page-name rules, reserved and held words
FR-203: Epic 24 - Name reservation, rename limits, redirects
FR-204: Epic 24 - Takedown and reporting
FR-205: Epic 24 - Text-only rendering, image re-encoding, separate origin
FR-206: Epic 24 - Published projection field list
FR-207: Epic 24 - Unpublish timings
FR-208: Epic 24 - EN/FR page chrome
FR-209: Epic 25 - Country/city controlled lists
FR-210: Epic 25 - Directory built from published pages
FR-211: Epic 25 - SEO and AI-SEO outcomes
FR-212: Epic 25 - Thin listings not indexed
FR-213: Epic 25 - Category filter, amends FR-172
FR-214: Epic 25 - Removal from directory within FR-207 times
FR-215: Epic 26 - A member record carries an optional birth year, profession and neighborhood, entered by staff and shown with the member
FR-216: Epic 26 - The birth year is shown as an approximate age and never as an exact date of birth; the existing optional dob is unchanged
FR-217: Epic 26 - A members-only CSV import (name, phone and the three profile fields, no plan) creates members awaiting the registration fee, so the Owner decides each person individually
FR-218: Epic 26 - The existing plan import is unchanged, and a gym with a registration fee of 0 can still run the members-only import, with a warning
FR-219: Epic 30 - Weekly goal and ring
FR-220: Epic 30 - Weekly streak, settled on the server
FR-221: Epic 31 - Daily streak for members on a run (Could; deferred, no V1.8 story)
FR-222: Epic 31 - Streak Shields (Should)
FR-223: Epic 31 - Comeback state (Should)
FR-224: Epic 30 - Attendance calendar with the at-risk cell
FR-225: Epic 30 - What counts as a visit day; existing history at release
FR-226: Epic 30 - Monthly gym leaderboard
FR-227: Epic 30 - Anonymous choice and first-open notice
FR-228: Epic 30 - Anonymous enforced on the server; no prizes
FR-229: Epic 30 - Milestone celebration at 7, 30, 100 visits
FR-230: Epic 31 - Badge shelf (Should)
FR-231: Epic 31 - Share image (Should)
FR-232: Epic 30 - Wording as editable text, EN/FR
FR-233: Epic 31 - Streak reminder N-08 (Should)
FR-234: Epic 31 - Gym-wide monthly challenge (Could; deferred, no V1.8 story)
FR-235: Epic 31 - "Your month" summary (Could; deferred, no V1.8 story)
FR-236: Epic 28 - Session validity setting
FR-237: Epic 28 - Single use: one session per visit
FR-238: Epic 28 - Class attendance in a single-use gym
FR-239: Epic 28 - Changing the setting; loyalty and reporting unchanged
FR-240: Epic 27 - Annual plans paid once; plan card wording
FR-241: Epic 27 - Correct plan action
FR-242: Epic 27 - When a correction is allowed
FR-243: Epic 27 - What a correction does
FR-244: Epic 29 - Per-day class slots
FR-245: Epic 29 - Migration and slot edits
FR-246: Epic 29 - Coaches create their own classes
FR-247: Epic 29 - Coach picker, body data excluded
FR-248: Epic 27 - Staff check-in
FR-249: Epic 27 - Same rules as a scan
FR-250: Epic 27 - Audit, attribution and void
FR-251: Epic 27 - GymOS support gets the V1.8 staff actions
NFR-023: Epic 22 - Live authorization everywhere; generated claim-read inventory and CI check
NFR-024: Epic 24 - Public site reads only the published projection
NFR-025: Epic 24/25 - p75 LCP target
NFR-026: Epic 24 - Host-only `__Host-` cookies, strict CSP, header test

## Epic List

### Epic 1: Platform Foundation & Gym Onboarding
GymOS staff can create a new gym tenant end-to-end — the owner logs in, configures branding and settings, and the platform enforces strict per-gym data isolation from day one. Delivers UJ-5 (Chidi onboards a new gym) in full.
**FRs covered:** FR-003, FR-004, FR-005, FR-006, FR-007, FR-010, FR-011, FR-012, FR-013, FR-014, FR-015, FR-016, FR-017, FR-018, FR-064, FR-069, FR-070, FR-071, FR-072, FR-073, FR-079

### Epic 2: Member Onboarding & Management
Owners and Managers can add, invite, import, and manage members and plans; a new member completes phone-OTP onboarding into the branded mobile app and lands on their assigned plan. Delivers UJ-1 (Kwame's first login) through plan confirmation.
**FRs covered:** FR-001, FR-002, FR-008, FR-009, FR-019, FR-020, FR-021, FR-023, FR-024, FR-025, FR-026, FR-057, FR-058, FR-063, FR-066, FR-082, FR-083, FR-086

### Epic 3: Subscription Lifecycle & Attendance
Subscriptions automatically progress through active → expiring_soon → grace_period → expired; members check in via QR; occupancy and attendance are tracked and auto-closed.
**FRs covered:** FR-027, FR-028, FR-029, FR-030, FR-032, FR-042, FR-043, FR-044, FR-045, FR-046, FR-047, FR-048, FR-059, FR-060, FR-061, FR-062

### Epic 4: Payments & Front-Desk Retention Alert
Receptionists collect and reconcile mobile-money and manual payments; the real-time front-desk alert fires the instant an at-risk member checks in, with a 3-tap renewal flow. Delivers the product's signature retention moment (UJ-2a, UJ-2b).
**FRs covered:** FR-031, FR-033, FR-034, FR-035, FR-036, FR-037, FR-038, FR-039, FR-040, FR-041, FR-049, FR-050, FR-051, FR-052, FR-062 (payment-history portion), FR-065, FR-067, FR-085

### Epic 5: Coach Portal
Coaches manage their assigned members and session notes in a fully role-gated view. Delivers UJ-4 (Fatima manages her clients).
**FRs covered:** FR-022, FR-053, FR-054, FR-055, FR-056

### Epic 6: Push Notifications
Members receive timely, bilingual push notifications for subscription lifecycle and payment events.
**FRs covered:** FR-074, FR-075, FR-076, FR-077, FR-078

### Epic 7: Audit Log & Compliance
Managers and Owners have an immutable, filterable record of every sensitive action across the platform. Delivers UJ-3 (Nadia reconciles end-of-day payments) in full.
**FRs covered:** FR-068, FR-080, FR-081

**Dependency order:** 1 → 2 → 3 → 4 strictly sequential (each builds on the prior epic's data model). Epics 5, 6, and 7 can proceed in any order once their upstream event sources exist (5 needs 2+3; 6 needs 3+4; 7 needs 1, 2, 4, 5).

---

## V1.5 Epics (2026-08-11 sprint-change-proposal)

Epics 1–8 above are the shipped V1.0 pilot scope. The epics below, plus the Epic 4 and Epic 6 extensions, are V1.5 "Beta-Ready" scope — no UX mockups exist yet for these features (see UX Design Requirements note above); acceptance criteria are anchored in FR/AD wording and flagged inline where UI detail is genuinely undefined pending a follow-up `bmad-ux` pass.

### Epic 9: Staff Management (Owner Self-Serve)
Owners and Supervisors can provision, edit, and deactivate their own staff (Supervisor, Manager, Receptionist, Coach) without a GymOS support ticket; privilege escalation is structurally impossible and role changes take effect immediately. Delivers UJ-6 (Grace staffs her gym) in full. Carries PostHog analytics instrumentation (NFR-014) as the first V1.5 epic to ship, so events exist for everything built after it.
**FRs covered:** FR-087, FR-088, FR-089, FR-090, FR-091, FR-092, FR-120
**NFRs covered:** NFR-013, NFR-014

### Epic 10: Client Progress Tracking
Members log body metrics, measurements, and progress photos between visits under a strict member+assigned-coach-only privacy model; coaches see progress trends only for currently-assigned members, re-verified live on every request. Delivers UJ-7 (Amara tracks her progress) and UJ-8 (Emmanuel coaches with real data) in the progress-visibility portion.
**FRs covered:** FR-093, FR-094, FR-095, FR-096, FR-097, FR-098, FR-122 (Progress tab portion), FR-123 (Progress tab portion)
**NFRs covered:** NFR-011, NFR-016

### Epic 11: SaaS Billing (Gym → GymOS)
GymOS collects its own platform subscription fee from each gym via a reminder-driven, Owner-approved Tara Money flow — automatic suspension after grace on non-payment, Super Admin visibility and manual override, zero cross-account leakage with Flow A member payments. Delivers G-12.
**FRs covered:** FR-130, FR-131, FR-132, FR-133, FR-134, FR-135, FR-136, FR-138 (extends Epic 4's `{type:'gym'}` context with `{type:'platform'}`), FR-139
**NFRs covered:** NFR-018, NFR-019 (shared with Epic 4 extension)

### Epic 12: Classes & Scheduling
Managers schedule one-off/recurring classes; members book and cancel sessions from the app under server-enforced capacity limits; receptionists run class-day attendance. Delivers UJ-9 (Nadia schedules a week of classes).
**FRs covered:** FR-104, FR-105, FR-106, FR-107, FR-108, FR-121, FR-123 (Classes tab portion)

### Epic 13: Workout Plans
Coaches author ordered, named workout plans for their assigned members from a shared exercise library; members view their plan and mark completion offline-safely; plan authorship transfers cleanly on coach reassignment. Delivers UJ-8 (Emmanuel adjusts a plan) in the plan-authoring portion. Carries the E2E test automation baseline (NFR-015) as the last V1.5 epic, once all four priority flows (staff provisioning, payment cutover, progress-data boundaries, class booking capacity) exist to test against.
**FRs covered:** FR-109, FR-110, FR-111, FR-112, FR-122 (Workout Plans tab portion)
**NFRs covered:** NFR-015

**Epic 4 extension: Tara Money Cutover & Flow A Formalization**
Existing Epic 4 (Payments & Front-Desk Retention Alert) gains new stories: Tara Money is re-verified against GymOS's own real business account and cut over from Notch Pay with zero discrepancies; each gym connects its own Vault-encrypted Tara Money account; Flow A payments are explicitly routed and audit-provable as never touching the platform account; members can self-serve renew from the app. Delivers UJ-10 (Chidi verifies the payment cutover) — the Flow A/cutover side.
**New FRs covered:** FR-099, FR-100, FR-101, FR-102, FR-103, FR-124, FR-125, FR-126, FR-127, FR-128, FR-129, FR-137, FR-138 (introduces the `{type:'gym'}` variant; Epic 11 extends it), FR-140
**New NFRs covered:** NFR-012, NFR-017, NFR-019 (shared with Epic 11)

**Epic 6 extension: Quiet-Gym Alerts & Class Reminders**
Existing Epic 6 (Push Notifications) gains new stories activating the two reserved V1.0 notification types: opted-in members get a rate-limited nudge when the gym is quiet (N-06); booked members get a reminder before their class (N-07).
**New FRs covered:** FR-113, FR-114, FR-115, FR-116

**V1.5 dependency order:** Epic 9 first (no new deps beyond V1.0 auth/RLS foundation) → Epic 4 extension (unblocks Epic 11 via the FR-138 `PaymentProvider` routing context) → Epic 11 → Epic 10 and Epic 12 in parallel (independent of each other and of 9/11) → Epic 6 extension (needs Epic 12's booking data for N-07) → Epic 13 last (its E2E baseline needs the other flows already built). Not renaming Epic 4's stale "Notch Pay..." story titles here — that cleanup is assigned directly to the developer per the sprint-change-proposal, not to this planning pass.

---

## Release Hardening (2026-09-01 sprint-change-proposal)

Epics 1–13 above are the fully shipped V1.0 + V1.5 scope — Epic 13 closed the last backlog story with nothing planned behind it. The items below were surfaced by a post-Epic-13 release-readiness review, not by any single story's implementation.

**Epic 4 extension: Story 4.16** — closes a narrow, already-deferred hardening gap in Story 4.13's connect flow (a gym could register a `business_id_plain` colliding with the platform's own `TARAMONEY_BUSINESS_ID`). No new epic; appended to the existing Epic 4 block.

### Epic 14: Observability & Release Hardening
`architecture.md` has described Sentry as "the sole V1 observability tool" since the original architecture pass, but it was never implemented — zero `@sentry/*` packages, zero SDK calls, anywhere in the codebase (confirmed during Story 9.5's PostHog research). This epic finally delivers NFR-007.
**NFRs covered:** NFR-007

### Epic 15: Mobile Experience Quality Pass
**Placeholder — blocked on a `bmad-ux` pass, no story written yet.** Stories 8.3–8.6 shipped the mobile design-system foundation and screen restyles, but a 2026-08-05 real-device verification found the result "reads as a color/theme swap only — general interface quality/layout still doesn't match what was expected from the Figma reference" (`sprint-status.yaml`, epic-8 action items, still `open`). This epic exists to keep that gap tracked, not to prescribe a fix — what's actually wrong (spacing, typography, component fidelity, or something else) hasn't been diagnosed. Writing acceptance criteria against "doesn't match Figma" today would just repeat Epic 8's own outcome; a UX pass has to happen first.

---

## Phone Country Picker (2026-09-07 sprint-change-proposal)

Every phone-number input across the platform is a plain text field today — no country picker, inconsistent `+237` hardcoding (some forms default it, `AddStaffModal` doesn't at all), and no format-shape check before `RenewalModal`'s Mobile-Money branch offers Tara Money collection. `packages/types/src/constants/taraMoneySupportedCountries.ts` already carries a 15-country calling-code list whose own comment states it exists to drive exactly this UX, never wired up. This epic closes that gap.

### Epic 16: Phone Number Country Picker & Auto Country-Code Entry
Every phone-number input (member, staff, gym owner, coach, and the Mobile-Money payer-phone field) gains a country picker that auto-prefixes the correct calling code as the user types, always producing valid E.164. Coverage is global for contact phones, sourced from `libphonenumber-js` (already a dependency); the Mobile-Money payer-phone field in `RenewalModal` is restricted to Tara Money's 15 supported countries, since it's the only field that triggers an automated Tara Money collection call.
**FRs covered:** FR-142

### Story 16.1: Web — Shared Country-Picker PhoneInput (Dashboard + Super-Admin)

As a gym staff member, owner, or Super Admin,
I want every phone field to offer a country picker that auto-fills the correct calling code as I type,
So that phone numbers are captured correctly regardless of country, without having to remember to type a `+` and calling code myself.

**Acceptance Criteria:**

**Given** a new `PhoneInput` component built once and duplicated into `apps/dashboard/components/ui/` and `apps/super-admin/components/ui/` (matching this codebase's existing per-app duplication of `components/ui/input.tsx` — this duplication follows the architecture's own stated convention, it is not a new exception, and does NOT warrant creating a shared `packages/ui` package, which the architecture explicitly defers "until duplication actually hurts")
**When** it renders
**Then** it shows a country picker (flag + dial code + searchable country name) next to the phone field, auto-prefixes the selected country's calling code into the value on selection, and its `onChange` always emits a valid E.164 string or `null`

**Given** country/calling-code data is needed
**When** the component is built
**Then** it sources calling codes from `libphonenumber-js`'s metadata (already a dependency in both `apps/dashboard/package.json` and `apps/super-admin/package.json` at `^1.13.12` — usable client-side, not just the existing server-side `EvolutionApiMessageProvider.ts` use) and country display names from the built-in `Intl.DisplayNames` API (zero new dependency — `libphonenumber-js` only exposes ISO codes and calling codes, not names) — no new country-list package is introduced

**Given** neither app has a `popover` or `command` (cmdk) shadcn primitive installed yet (only `button`, `input`, `label`, `checkbox`, `card`, `badge`, `tabs`, `dropdown-menu` exist in `components/ui/` today)
**When** the searchable country dropdown is built
**Then** shadcn's standard `Popover` + `Command` combo is added to both apps (`npx shadcn add popover command`) and used for the dropdown, rather than hand-rolling a custom dropdown/portal/keyboard-navigation implementation

**Given** this codebase's established controlled-field convention (`useState` + Zod, explicitly NOT react-hook-form — see `MemberModal.tsx`'s own comment on this)
**When** `PhoneInput` is implemented
**Then** it is built as a plain controlled component (`value`/`onChange` props), not wired to any form library, consistent with every call site it's used in

**Given** this codebase's i18n gate (`scripts/check-i18n-key-parity.mjs`, run in CI)
**When** `PhoneInput` introduces new user-facing strings (e.g. "Search country...", "No country found")
**Then** matching keys are added to both `apps/dashboard/locales/{en,fr}.json` and `apps/super-admin/locales/{en,fr}.json` (one key set per app, duplicated like the component itself — not promoted to `packages/types/src/locales`, which this project reserves for security-sensitive shared logic, not cosmetic UI strings) via `react-i18next`'s `useTranslation()`/`t()`, matching every existing call site's pattern

**Given** this codebase's testing convention (Vitest + `@testing-library/react`, co-located `*.test.tsx`, no E2E baseline exists yet)
**When** `PhoneInput` and its rollout into the four fields above are implemented
**Then** a co-located `PhoneInput.test.tsx` is added in each app testing country selection, calling-code auto-prefix, and E.164 emission, plus the existing per-modal test files (if any exist for `MemberModal`/`AddStaffModal`/`CreateGymModal`/`RenewalModal`) are updated to account for the new component, mocking `react-i18next` and Server Actions per this codebase's established pattern

**Given** the two dashboard forms with a real, user-editable phone `<Input>` today — `MemberModal` (create mode only; phone is `disabled` in edit mode and shown as plain text in view mode, both unchanged by this story) and `AddStaffModal`
**When** this story ships
**Then** each is wired to `PhoneInput` with the global country list, defaulting to Cameroon (`+237`) as the pre-selected country, preserving each field's existing `fieldErrors`-driven inline error display

**Given** the one super-admin form with a real, user-editable phone `<Input>` today — `CreateGymModal`'s `ownerPhone` field
**When** this story ships
**Then** it is wired to `PhoneInput` with the global country list, same default, preserving its existing `fieldErrors.ownerPhone` inline error display

**Given** `RenewalModal`'s Mobile-Money branch specifically (`payerPhone`, the only phone field that calls `initiatePaymentAction`)
**When** the payer-phone field renders
**Then** it uses `PhoneInput` restricted to `TARAMONEY_SUPPORTED_COUNTRIES` (not the global list) — the picker only offers those 15 countries — and when the pre-filled value from `getRenewalPreview`'s `memberPhone` doesn't parse as valid E.164 (a legacy pre-convention record), `PhoneInput` falls back to the default Cameroon selection with an empty/raw national-number field, matching today's `DEFAULT_PHONE_PREFIX` fallback behavior, rather than rendering in a broken or unparseable state

**Given** `handleMobileMoneySubmit`'s existing `initiatePaymentSchema.shape.phoneNumber.safeParse(...)` client-side check (already blocks a malformed `payerPhone` with an inline `fieldErrors.payerPhone` before calling `initiatePaymentAction` — confirmed already resolved, see `deferred-work.md`'s struck 2026-08-17 entry)
**When** `PhoneInput` is wired into this field
**Then** that existing validation call is preserved as-is (still fed `PhoneInput`'s emitted E.164 string) — this story does not add new submission-blocking validation, since none is missing

**Given** `EditStaffModal`'s phone field, which is `readOnly`/`disabled` and never submitted (staff phone cannot be edited after creation)
**When** this story ships
**Then** it is explicitly left unchanged — no functional or visual benefit to wiring a non-interactive field into a picker component

**Given** `CsvImportModal` (phone is read-only preview-table text sourced from parsed CSV rows, no `<Input>` exists), `InviteMemberModal` (no phone field, only reads an existing E.164 value for a `wa.me` link), `RecordPaymentModal` (no phone field at all), and super-admin's `GymMembersTable`/`GymDetailPageClient` (phone shown as read-only display text, no `<Input>`)
**When** this story ships
**Then** all are left unchanged — none has an editable phone input to wire

**Given** `SettingsForm.tsx` has no owner/staff phone `<Input>` of its own — billing's `ownerPhone` is only passed as a display prop into a separate `PayNowButton.tsx` component not covered by this story's research — and the Coach portal files (`CoachPortalPageClient`/`CoachMemberDetailPageClient`) were not confirmed to contain an editable phone field either
**When** this story is implemented
**Then** the dev agent verifies both during Task execution (grep for a phone `<Input>` in `PayNowButton.tsx` and the Coach portal files) and either wires them in following this story's same pattern if a real editable field is found, or explicitly notes in Completion Notes that none exists — this gap is flagged here rather than silently dropped

**Given** the existing Zod `e164Phone` schemas (independently redeclared per-file in `payment.ts`, `staff.ts`, `gym.ts`, `csvImport.ts`, `memberOnboarding.ts`, `member.ts` — a deliberate "no shared cross-file consts" project convention, not an oversight)
**When** `PhoneInput` is wired in
**Then** those schemas are unchanged and NOT consolidated into a shared validator — `PhoneInput` is a UI layer producing values those schemas already accept

### Story 16.2: Mobile — Country-Picker Phone Input (Expo)

As a gym member or staff user of the mobile app,
I want the phone-entry screen to offer a country picker instead of a fixed `+237` prefix,
So that I can enter my real phone number correctly regardless of country.

**Acceptance Criteria:**

**Given** `apps/mobile/src/app/onboarding/phone.tsx`'s hardcoded `COUNTRY_PREFIX = '+237'` and single fixed-prefix `TextInput`
**When** this story ships
**Then** they are replaced with a country-picker-enabled input, defaulting to Cameroon, backed by the same calling-code data source used in Story 16.1 (`libphonenumber-js` metadata) via an Expo/React-Native-compatible picker

**Given** the equivalent phone field in `(tabs)/profile.tsx`
**When** this story ships
**Then** it is updated the same way

**Given** `onboarding-context.tsx` and `otp.tsx`
**When** the new picker is wired in
**Then** they continue to receive a fully E.164-formatted phone value unchanged in shape — no downstream OTP or Supabase `signInWithOtp` contract changes

**Given** mobile onboarding/profile phone is a contact field, not a Mobile-Money trigger
**When** the country list is chosen
**Then** it uses global coverage, not the 15-country Tara Money list

---

## Launch Readiness (2026-09-09 sprint-change-proposal)

Epics 1–16 are shipped. This section was surfaced by the first-client (gym) onboarding pass, not by any story's implementation — the same category as the 2026-09-01 Release Hardening entry.

Two gaps, different in kind:

**The Overview was specified and never built.** `EXPERIENCE.md`'s AD-02 spec (stat cards, Currently Checked-In table, Expiring This Week table) has existed since the 2026-07-04 UX pass. `page.tsx` renders a heading, one paragraph, and the Front-Desk Alert Panel — its own comment records the deferral: "no stat cards or tables here -- those remain deferred to a future story." This is not new scope; it is unfinished scope, and it is the first screen a new gym Owner sees. The `overview.body` string still shipping in `en.json`/`fr.json` reads "Your gym's activity summary will appear here as more of GymOS comes online" — a promise now being made to paying customers.

**The Coach Portal is one page.** A Coach's sidebar renders a single link (`Sidebar.tsx:51`). They sign in, land on `/` (`EXPERIENCE.md:1022`), and see the staff Overview with no nav item pointing back to it. Meanwhile `classes.coach_id` is `NOT NULL` and trigger-enforced to a coach-role member of the same gym (`0057:23`, `0057:154`) — every class already has an owning coach who has no way to see it. Closing this required amending FR-053 and FR-122, which forbade any Coach surface beyond the Portal; see `sprint-change-proposal-2026-09-09.md` for the amendment and its rationale.

### Epic 17: Launch Readiness — Overview Build-Out & Coach Portal Depth
The staff Overview becomes a real dashboard — live occupancy, memberships needing attention, net month-to-date revenue, and gym-health figures gated to Manager-plus. The Coach Portal gains its own navigation, an Overview scoped to the Coach's own caseload, and a read-only view of the classes they are assigned to teach, including who is booked. No Coach gains any admin capability: class creation stays Manager/Supervisor/Owner, class attendance stays Receptionist-and-above.
**FRs covered:** FR-143, FR-144, FR-145, FR-146
**Amends:** FR-053, FR-122

**Stories:**

| # | Story | Migration | Depends on |
|---|---|---|---|
| 17.1 | Staff Overview — Operational Cards & Live Tables | **0095** | — |
| 17.2 | Staff Overview — Gym Health Cards (Manager-plus) | **0097** *(amended 2026-09-10; was none)* | 17.1 |
| 17.3 | Coach Portal — Sub-Navigation & Landing | none | — |
| 17.4 | Coach Portal — My Classes & Session Roster | **0096** | 17.3 |
| 17.5 | Coach Portal — Overview | none | 17.3, 17.4 |

**Dependency order:** 17.1 → 17.2 and 17.3 → 17.4 → 17.5 are two independent chains and can run in parallel. 17.1 and 17.3 are the two launch-blocking stories: 17.1 fixes what a new Owner sees first, 17.3 fixes a Coach landing on a page with no way back. 17.2 and 17.5 are depth, not blockers. *(Amended 2026-09-10, decided with the product owner during story creation: **17.4 ships in the same release as 17.3**, and is therefore release-blocking rather than depth. 17.3 gives the Portal a My Classes sub-nav item per FR-144 and `EXPERIENCE.md:229-233`, and that item must not point at an empty page in front of a paying customer — the exact failure this epic exists to correct. The alternative considered and rejected was holding the item out of the sub-nav until 17.4 landed. Note this also puts migration 0096 in the same deploy as 0095.)*

**Scope boundary — what this epic does NOT do.** No Coach gains write access to any class (`manager_or_owner_insert_own_classes` / `manager_or_owner_update_own_classes`, widened to supervisor by `0093:64,67`, are untouched). `mark_class_attendance`'s role check (`0068:41,70`) is untouched, and `ClassesPageClient.tsx:65`'s `canMarkAttendance = role !== "coach"` stays as-is. A Coach never reaches AD-18/AD-19. **This epic modifies zero RLS policies** — its migrations add functions only: 0095 one invoker-rights aggregate, 0096 two `SECURITY DEFINER` Coach reads (`list_my_classes()`, `list_my_class_session_roster()`), 0097 two invoker-rights period-bound helpers, nothing else. *(Amended 2026-09-10 by Stories 17.2 and 17.4; was "two migrations add one aggregate function and one `SECURITY DEFINER` RPC".)*

### Story 17.1: Staff Overview — Operational Cards & Live Tables (AD-02)

As a gym Owner, Manager, or Receptionist,
I want the Overview to show what is happening in my gym right now,
So that the first screen I open answers "who is here, who needs attention, and what have we taken this month" without navigating anywhere.

*Delivers the AD-02 spec written in the 2026-07-04 UX pass and deferred by Story 4.6. No new UX design required. Migration 0095.*

**Acceptance Criteria:**

**Given** `apps/dashboard/app/(dashboard)/page.tsx` today renders only an `<h1>`, the `overview.body` paragraph, and the Front-Desk Alert Panel
**When** this story ships
**Then** it renders AD-02's specified content beneath the alert panel — a three-card stat row followed by the Currently Checked-In and Expiring This Week tables — and the `overview.body` placeholder string ("Your gym's activity summary will appear here as more of GymOS comes online") is deleted from `en.json` and `fr.json`, since the thing it promises now exists

**Given** the "Checked in now" and "Expiring this week" cards each need both a count and a table
**When** their data is fetched
**Then** each uses ONE existing service call, not two — `getCurrentlyCheckedIn()` (`attendance.ts:145`) and `listSubscriptions({ status: 'expiring_soon' })` (`subscriptions.ts:302`) each already return `{ rows, total }`; `total` feeds the card and the first 10 rows feed the table, per AD-02's "max 10 rows"

**Given** "Expiring this week" must agree with the page it links to
**When** the count is computed
**Then** it uses the `expiring_soon` status, not a hand-rolled 7-day date filter — `0021:80` defines `expiring_soon` as "expiry within 7 days", so the card and its AD-08 click-through target read from the same definition and cannot drift apart

**Given** `supabase/config.toml:18` sets `max_rows = 1000`, which silently truncates any row fetch without raising an error
**When** month-to-date revenue is computed
**Then** it is computed by a database aggregate (migration 0095, `gym_revenue_mtd()`), NEVER by fetching payment rows and summing them client-side — a gym exceeding 1,000 payments in a month would otherwise be shown an understated revenue figure with no indication anything was wrong

**Given** refunds are stored in their own table with positive amounts (`0033:11`), not as negative payment rows
**When** `gym_revenue_mtd()` computes its figure
**Then** it returns SUM(`payments.amount` WHERE status = 'verified') minus SUM(`refunds.amount`), both bounded to the current calendar month in the gym's local timezone — a gross figure would overstate takings to the Owner in any month containing a refund

**Given** `payment_status` is an enum of ('pending','processing','verified','flagged') (`0001:20`)
**When** revenue is summed
**Then** only `verified` is counted — `pending` and `processing` are money not yet confirmed, and `flagged` is money under dispute; counting any of them would report revenue the gym does not have

**Given** the three cards are click-through targets per AD-02
**When** a card is clicked
**Then** "Checked in now" → `/attendance`, "Expiring this week" → `/subscriptions?status=expiring_soon`, "Revenue this month" → `/payments` filtered to the current month

**Given** AD-02 specifies "values refresh on page load and via polling every 60 seconds"
**When** the page is open
**Then** the stat cards poll at 60s; the Front-Desk Alert Panel's existing Supabase Realtime subscription is NOT replaced or duplicated by this polling, and continues to behave exactly as Story 4.6 shipped it

**Given** each surface must fail independently — the discipline `page.tsx`'s own comment already documents for the alert panel
**When** any one of the revenue aggregate, the checked-in fetch, or the expiring fetch errors
**Then** that card/table alone renders its error or empty state and the rest of the page still renders; a failed revenue query must never blank the Currently Checked-In table

**Given** AD-02's specified empty states
**When** a table has no rows
**Then** the checked-in table shows "No one is checked in right now." and the expiring table shows "No members expiring in the next 7 days."

**Given** loading
**When** the page is streaming
**Then** 3 skeleton stat cards and 5 skeleton rows per table render, per AD-02's Loading spec, via the existing `<Suspense>` + `loading.tsx` pattern already used across this app

**Given** this app ships bilingual (Story 1.10)
**When** the new strings are added
**Then** `en.json` and `fr.json` both carry every new key and `scripts/check-i18n-key-parity.mjs` passes

**Given** no `StatCard` component exists in `components/ui/` today
**When** the card row is built
**Then** a shared `StatCard` is added and used by all three cards — not three bespoke divs — so Story 17.2's second row reuses it unchanged

### Story 17.2: Staff Overview — Gym Health Cards (Manager-plus)

As a gym Owner, Supervisor, or Manager,
I want a second row of cards showing how the gym is doing, not just what is happening this minute,
So that I can see membership growth and churn risk without building a report.

*Depends on Story 17.1 (reuses its `StatCard`). Extends AD-02 beyond the original three-card spec — see EXPERIENCE.md's V2 amendment. Migration 0097.*

*(Amended 2026-09-10, four decisions made with the product owner during story creation. (1) **Migration 0097, not "no migration".** "New this month" and "Today's classes" are gym-local, but 0095's `private.gym_local_month_bounds()` lives in the `private` schema, which PostgREST does not expose (`supabase/config.toml:13`), so a COUNT query cannot reach it. 0097 adds one `SECURITY INVOKER` wrapper, `gym_local_period_bounds()`, plus a day helper — no new privilege, no RLS change. The release batch becomes 0095 + 0096 + 0097. (2) **"New this month" counts by `join_date`, not creation time** — CSV import (Story 2.4) writes historic join dates, so a gym importing its roster in its first month would otherwise see the whole roster as new. (3) **"Active members" counts `active` + `expiring_soon`**, not `active` alone — both can check in (`0027:22-24`), and excluding the latter would drop the card by exactly row 1's "Expiring this week" figure. (4) **Both status cards link to named filters on `/subscriptions`** (`active_or_expiring`, `at_risk`), which this story adds — the page filtered one status at a time, and `/members?status=` can match a non-current subscription row after a renewal. The ACs below carry each change inline.)*

**Acceptance Criteria:**

**Given** AD-02's minimum role is Receptionist (`EXPERIENCE.md:67`)
**When** a Receptionist opens the Overview
**Then** they see Story 17.1's three operational cards ONLY — row 2 is absent from the DOM, not merely hidden by CSS. Headcount, growth, and churn-risk figures are management information, not front-desk information, and this app's established discipline is absence-from-DOM (Story 5.2 AC#1, `ClassesPageClient.tsx:55`)

**Given** row 2 is visible to Manager, Supervisor, and Owner
**When** it renders
**Then** it shows four cards: "Active members", "New this month", "Today's classes", and "At risk"

**Given** `max_rows = 1000` truncates row fetches but does NOT affect COUNT queries
**When** each of the four figures is computed
**Then** each uses `.select(col, { count: 'exact', head: true })` — the exact pattern `memberCountForGym()` already uses at `members.ts:308` — so no figure can be silently truncated and no row payload is transferred

**Given** "Active members" must mean members who can actually train
**When** it is counted
**Then** it counts `subscriptions_current` rows with status `active` or `expiring_soon` *(amended 2026-09-10; was `active` only)* whose member is not deactivated, links to `/subscriptions?status=active_or_expiring`, and does NOT use `memberCountForGym()` — that function counts every `role = 'member'` row including deactivated and expired members (`members.ts:307-311`), which would overstate the gym's real active base

**Given** "New this month" counts joins
**When** it is computed
**Then** it counts `role = 'member'` rows whose `join_date` *(amended 2026-09-10; was creation time)* falls within the current calendar month in the gym's local timezone, taken from the same `private.gym_local_month_bounds()` helper as 17.1's revenue window, so the two cards describe the same period

**Given** "At risk" is the churn signal
**When** it is computed
**Then** it counts `grace_period` and `expired` combined, links to `/subscriptions?status=at_risk` (a named filter this story adds — the page filtered one status at a time; *amended 2026-09-10*), and renders in the alert colour ONLY when non-zero — a healthy gym with zero at-risk members must not be shown a red number on its dashboard

**Given** "Today's classes" is operational context for the day
**When** it is computed
**Then** it counts `class_sessions` scheduled for today in the gym's local timezone and links to `/classes`

**Given** row 2 may aggregate more slowly than row 1's operational data
**When** the page loads
**Then** row 2 streams in its own `<Suspense>` boundary with 4 skeleton cards — a slow health query must never delay the operational cards above it, which are the ones the front desk needs in real time

**Given** bilingual parity
**When** the new strings are added
**Then** `en.json` and `fr.json` both carry every new key and `scripts/check-i18n-key-parity.mjs` passes

### Story 17.3: Coach Portal — Sub-Navigation & Landing

As a Coach,
I want the Coach Portal to have its own navigation and to be where I land when I sign in,
So that I am not dropped onto a staff page I have no link back from.

*No migration.*

**Acceptance Criteria:**

**Given** a Coach signs in and, per `EXPERIENCE.md:1022`, is sent to `/`
**When** `(dashboard)/page.tsx` resolves a session whose `shell.role` is `coach`
**Then** it redirects to `/coach/overview` — a Coach must never land on the staff Overview, which renders Story 17.1/17.2 content they have no nav item to return to. The redirect lives in `page.tsx`, not `(dashboard)/layout.tsx`, because the layout wraps every dashboard route and a redirect there would need path-matching to avoid looping

**Given** `Sidebar.tsx:51`'s single `nav.coachPortal` item
**When** this story ships
**Then** the top-level sidebar is UNCHANGED — still exactly one link for a Coach — and the three sub-surfaces are reached from a sub-navigation inside the Portal, per EXPERIENCE.md's amended role matrix. Story 5.2 AC#1 ("Payments, Members, Settings, and Audit Log are absent from the DOM") must remain literally true and is re-verified by this story's tests

**Given** the Portal's three surfaces
**When** the sub-navigation renders
**Then** it offers Overview (`/coach/overview`), My Members (`/coach`), and My Classes (`/coach/classes`), with the active surface indicated, and it renders on all three routes plus the member-detail route `/coach/[memberId]`

**Given** `/coach/[memberId]` is a shipped dynamic route linked from Stories 5.3, 10.4, and 13.2
**When** the two new static routes are added as its siblings
**Then** `/coach` continues to serve the AD-14 member list at its existing URL and `/coach/[memberId]` is unmoved — no shipped link, bookmark, or test breaks. Next.js resolves static segments before dynamic ones, and member IDs are UUIDs, so `overview` and `classes` cannot collide with a real member ID

**Given** a non-Coach staff session reaching `/coach/*` directly
**When** it renders
**Then** behaviour matches the existing documented precedent in `coach/page.tsx`'s header comment — this story introduces no new route-level role guard and no new gap

**Given** `/coach/overview` is where every Coach sign-in now lands, so it cannot ship empty
**When** it renders My Members At A Glance *(moved here from Story 17.5, 2026-09-10)*
**Then** it shows the Coach's assigned-member count broken down by subscription status, sourced from `listAssignedMembers()` (`coaches.ts:227`), and links to `/coach`

**Given** a Coach with no assigned members *(moved here from Story 17.5, 2026-09-10)*
**When** they open the Overview
**Then** they see AD-14's established guidance (the existing `coachPortal.emptyNoAssignments` copy) instead of the widget: "No members have been assigned to you yet. Ask your manager, owner, or supervisor to assign members."

**Given** bilingual parity
**When** the sub-nav strings are added
**Then** `en.json` and `fr.json` both carry every new key and `scripts/check-i18n-key-parity.mjs` passes

### Story 17.4: Coach Portal — My Classes & Session Roster

As a Coach,
I want to see the classes I am assigned to teach and who is booked into each session,
So that I know what I am teaching and who to expect, without asking the front desk.

*Depends on Story 17.3. Migration 0096.*

*(Amended 2026-09-10, two decisions made with the product owner during story creation. (1) **0096 adds two functions, not one.** A Coach has no RLS read on `class_bookings` — `gym_staff_read_own_class_bookings` (`0068:37-42`) is owner/manager/receptionist/supervisor only — so the booked count below cannot come from plain reads, and "exactly one new function" could not satisfy it. `list_my_classes()` returns the Coach's classes and sessions with booked counts and no member identity; `list_my_class_session_roster()` is unchanged. Story 17.5's My Next Sessions reuses `list_my_classes()`. (2) **Sessions are listed from 00:00 today in the gym's timezone onward**, not strictly upcoming — `attended_at` is set only once a session has started, so a strictly-upcoming list would hide the class a Coach is teaching right now. Both functions resolve the caller from a live `members` row (`role = 'coach'`, not deactivated) and carry the 0090 suspension guard. The ACs below carry each change inline.)*

**Acceptance Criteria:**

**Given** `classes.coach_id` is `NOT NULL` and trigger-enforced to a coach-role member of the same gym (`0057:23`, `0057:154`)
**When** `/coach/classes` renders
**Then** it lists only classes whose `coach_id` resolves to the calling Coach's own `members.id`, resolved server-side from `auth.uid()` + `private.gym_id()` — never from a client-supplied coach ID

**Given** each listed class
**When** it is expanded
**Then** it shows its `class_sessions` from 00:00 today in the gym's timezone onward *(amended 2026-09-10; was "upcoming")* with `scheduled_at`, capacity, and booked count — served by a `SECURITY DEFINER` function, `list_my_classes()` (migration 0096), that returns the Coach's classes, sessions and booked counts and no member identity, since a Coach has no RLS read on `class_bookings` *(amended 2026-09-10)*

**Given** `0040:81`'s `coach_read_assigned_members` policy restricts a Coach's `members` reads to their own assigned members, so most people booked into their class are invisible to them
**When** a session roster is displayed
**Then** it is served by a new `SECURITY DEFINER` RPC (migration 0096), `list_my_class_session_roster(p_class_session_id uuid)`, which returns ONLY `(member_id, member_name, attended_at)` — NOT by widening any RLS policy. A row-level widening on `members` would hand the Coach every readable column including phone number; an RPC returns exactly the three roster columns and nothing else

**Given** that RPC bypasses RLS by construction
**When** it executes
**Then** it first verifies the caller is the coach of the class owning `p_class_session_id` — joining `class_sessions` → `classes` → `members` on `user_id = auth.uid()` and `gym_id = private.gym_id()`, the exact resolution shape `private.is_assigned_coach()` uses (`0040:39-48`) — and returns an empty set for any session belonging to another coach's class or another gym

**Given** a deactivated Coach must lose access immediately (FR-089, Story 9.3)
**When** the RPC resolves the caller
**Then** it excludes members with a non-null `deactivated_at`, matching `private.current_member_role()`'s own filter (`0061:42`)

**Given** this app's SECURITY DEFINER grant discipline (`0040:51-52`)
**When** the RPC is created
**Then** `revoke execute ... from public` and `grant execute ... to authenticated` are both explicit, not inherited from schema usage

**Given** NO RLS policy is modified by this story
**When** migration 0096 is reviewed
**Then** it contains exactly two new functions — `list_my_classes()` and `list_my_class_session_roster()` *(amended 2026-09-10; was one)* — and their grants — `gym_staff_read_own_class_bookings` (`0068:37`), `gym_staff_read_own_classes` (`0057:101`), `gym_staff_read_own_class_sessions` (`0057:172`), and every `manager_or_owner_*` policy are untouched

**Given** FR-145's read-only boundary
**When** the page renders for a Coach
**Then** there is no create, edit, reschedule, or mark-attendance control anywhere on it — absent from the DOM, not disabled — and `mark_class_attendance`'s role check (`0068:41,70`) and `ClassesPageClient.tsx:65`'s `canMarkAttendance = role !== "coach"` are both unchanged. `attended_at` is displayed as read-only status

**Given** a Coach assigned to no classes
**When** they open My Classes
**Then** they see an empty state consistent with AD-14's tone: "You are not assigned to any classes yet. Your manager schedules classes and assigns a coach."

**Given** this epic's only new privilege
**When** pgTAP coverage is written
**Then** it proves: a Coach retrieves their own session's roster; a Coach retrieves an EMPTY set for another coach's session; a cross-gym session returns empty; a deactivated Coach returns empty; and a member/receptionist caller cannot use the RPC to reach data their existing policies deny

**Given** bilingual parity
**When** the new strings are added
**Then** `en.json` and `fr.json` both carry every new key and `scripts/check-i18n-key-parity.mjs` passes

### Story 17.5: Coach Portal — Overview

As a Coach,
I want a portal home that summarises my own caseload,
So that I can see what I am teaching, who needs me, and who has been active, without opening every client one at a time.

*Depends on Stories 17.3 and 17.4. No migration.*

*(Amended 2026-09-10 by Story 17.3: the My Members At A Glance widget and the no-assigned-members empty state moved to Story 17.3, which ships them as `/coach/overview`'s landing content — a Coach lands there on every sign-in, so it could not ship empty. Both ACs were removed from this list. This story adds the other three widgets alongside it, and must keep 17.3's empty state covering the whole page rather than rendering its own widgets empty. It must also grow `coach/overview/loading.tsx` from 17.3's single skeleton card to AD-20's four (added by 17.3's code review, 2026-09-10).)*

*(Amended 2026-09-10, two decisions made with the product owner during story creation. (1) **A Coach with no assigned members but with upcoming sessions sees My Next Sessions plus the AD-14 guidance** in place of the three member widgets. The whole-page AD-14 message remains for a Coach with no assigned members AND no upcoming sessions — a class-only coach lands here on every sign-in, and the literal rule would hide the one widget that is not about assignments. (2) **Thresholds:** Needs Follow-Up flags a member after 14 gym-local calendar days without a note from this Coach; Recent Progress Activity shows members whose latest entry is within the last 7 gym-local calendar days. Both are named constants, per the threshold AC below.)*

**Acceptance Criteria:**

**Given** `/coach/overview` is the Coach's landing route (Story 17.3)
**When** it renders
**Then** it shows three widgets — My Next Sessions, Needs Follow-Up, and Recent Progress Activity — alongside the My Members At A Glance widget Story 17.3 already ships there

**Given** every figure on this page describes the Coach's own caseload
**When** any widget computes a count or list
**Then** it is scoped by the same assignment rules that scope the rest of the Portal (FR-055) — `private.is_assigned_coach()` for member data, `classes.coach_id` for class data. A member whose assignment was ended with `ended_at` disappears from every widget immediately, with no cache to invalidate

**Given** My Next Sessions
**When** it renders
**Then** it lists the next upcoming `class_sessions` for classes where `coach_id` is the calling Coach, each with `scheduled_at` and booked count, reusing Story 17.4's `list_my_classes()` (filtered to `scheduled_at > now()`) rather than a second implementation, and each row links to that class in `/coach/classes` (17.4 renders each class section with `id="class-<classId>"`) *(amended 2026-09-10 by Story 17.4)*

**Given** Needs Follow-Up identifies clients the Coach has lost touch with
**When** it is computed
**Then** it lists assigned members whose most recent session note authored by this Coach is older than a defined threshold, or who have no note at all — read via `coach_read_own_session_notes` (`0041:61`), which already grants exactly this and needs no migration

**Given** `gym_staff_read_own_attendance_events` (`0025:24`) is restricted to `owner, manager, receptionist` and excludes the Coach role
**When** Needs Follow-Up is built
**Then** it does NOT use check-in recency as a signal, and no attendance policy is widened by this story. Check-in-based follow-up is deferred to a follow-up story; this AC exists so a future implementer does not "fix" the omission by widening attendance access without a decision

**Given** the threshold that defines "needs follow-up"
**When** it is chosen
**Then** it is a single named constant with its rationale in a comment, not a magic number scattered across the query and the UI copy

**Given** Recent Progress Activity
**When** it renders
**Then** it lists assigned members who have logged progress entries recently, read via `coach_read_assigned_progress_entries` (`0067:140`), and each row links to that member's Progress tab (AD-15). Progress *photos* are NOT surfaced here — `progress_photos` has its own separate sharing gate (`coach_read_shared_progress_photos`, `0067:92`), and a member who logged an entry has not thereby consented to their photo appearing on a summary screen

**Given** each widget reads from a different source
**When** any one query fails
**Then** that widget alone renders its error state and every other widget still renders, Story 17.3's included — the same per-surface failure discipline as Story 17.1

**Given** bilingual parity
**When** the new strings are added
**Then** `en.json` and `fr.json` both carry every new key and `scripts/check-i18n-key-parity.mjs` passes

---

## Registration Fee (2026-10-07 PRD update)

Epics 1–17 are shipped or in flight. This section comes from the 2026-10-07 PRD update that added FR-147–FR-155 (`prd.md` §6.6, §6.8, §6.2, §6.12; implementation notes in `addendum.md` §D). It was not surfaced by a story's implementation and there is no separate sprint-change-proposal file — the decisions and their reviewer-gate history are in `prds/prd-gym_os-2026-06-20/.memlog.md`, `review-rubric-regfee.md`, and `review-adversarial-regfee.md`.

A gym can charge a **one-time registration fee**. A new member of a fee gym starts as *awaiting registration fee*: no member-app access and no plan until staff record the fee as paid or waive it. Production is live with real gyms, so two facts shape every story below:

1. **Existing members are never charged, blocked, or changed.** Migration 0098 backfills every existing `members` row as settled, in the same transaction that adds the column (FR-149).
2. **Renewals are never blocked.** The gate is on a member's *first* subscription only. Every renewal path — `confirm_renewal` (`0093:286`), `renew_subscription` (`0093:483`), `complete_verified_payment` (`0030:76`) — raises or skips when the member has no existing subscription, so none of them can reach the gate for a member who is settled, and every existing member is settled.

### Epic 18: Registration Fee — One-Time Fee Before a New Member Gets Access
Owners and Supervisors set a flat per-gym registration fee (0 XAF = off). In a fee gym, a newly created member cannot use the member app or be assigned a plan of any type until staff collect the fee — by cash, bank transfer, manual mobile money, or a staff-initiated Tara Money collection — or an Owner, Supervisor, or Manager waives it with a reason. The fee is paid once per member, is non-refundable, can be voided only when recorded in error, and shows as its own line in month-to-date revenue. Existing members and CSV imports are exempt.
**FRs covered:** FR-147, FR-148, FR-149, FR-150, FR-151, FR-152, FR-153, FR-154, FR-155
**Amends:** FR-008, FR-019, FR-037, FR-040, FR-041, FR-058, FR-069, FR-080, FR-082, FR-143
**NFRs honored:** NFR-001 (tenant isolation), NFR-003 (integer money), NFR-004 (append-only audit)

**Stories:**

| # | Story | Migration | Depends on |
|---|---|---|---|
| 18.1 | Registration Fee Setting, Member State & First-Subscription Gate | **0098** | — |
| 18.2 | Payment Purpose, Manual Fee Collection & Waiver | **0099** | 18.1 |
| 18.3 | Tara Money Fee Collection | **0100** | 18.2 |
| 18.4 | Void, Refund Block & Revenue Line | **0101** | 18.2 |
| 18.5 | Two-Step Member Creation, First-Plan Assignment & Import Exemption | none | 18.1 |
| 18.6 | Dashboard Fee Collection, Waive & Void Surfaces | none | 18.2, 18.3, 18.4, 18.5 |
| 18.7 | Member App — Awaiting-Fee Blocked State & Fee Receipt | none | 18.1, 18.2 |

*Migration numbers are the next free numbers as of 2026-10-07 (latest is `0097`); renumber at build time if another migration lands first.*

**Dependency order:** 18.1 → 18.2 → {18.3, 18.4} in parallel; 18.1 → 18.5; 18.1 + 18.2 → 18.7; 18.6 last, since it surfaces everything. **18.1 is the launch-safety story** — it is the only one that touches production rows, and it ships behind a default fee of 0, so no gym sees any change until an Owner or Supervisor sets a fee. 18.1 through 18.4 are database-first and independently testable without any UI.

**Scope boundary — what this epic does NOT do.**
- **Pay-per-session per-visit charging** (OQ-16) and **reactivated-member re-payment** (OQ-17) are not here. This epic only makes Pay-per-session subscriptions subject to the same fee gate as every other plan type.
- **No member self-service payment of the fee.** `initiate_member_payment` (`0055`, latest `0090:1169`) keeps refusing a member with no subscription; 18.3 adds a test that pins that.
- **No payment is recorded for the first plan's price.** Assigning the first plan creates the subscription exactly as the one-step member form does today, which records no payment (`provisionMemberRow` → `insertSubscription`, `members.ts:589`).
- **Waiving cannot be undone.** Only a recorded fee can be voided (FR-151).
- **The `gyms` UPDATE policy is not widened.** `owner_update_own_gym` (`0014:11`) is owner-only and `0093` did not touch it, so a Supervisor's Settings save is already a silent 0-row no-op (`gym-settings.ts` ~188). That is a pre-existing gap and stays out of scope; the fee goes through its own RPC (18.1) so a Supervisor can set it regardless.

### Story 18.1: Registration Fee Setting, Member State & First-Subscription Gate

As a gym Owner or Supervisor,
I want to set a one-time registration fee and have the platform track which members have settled it,
So that new members cannot be given a plan until the fee is dealt with — while every existing member and every renewal carries on exactly as before.

*Delivers FR-147, FR-148 (server-side rule), FR-149 (grandfathering, member cap). Migration 0098. The safest story to ship first: default fee 0 changes nothing for any gym.*

**Acceptance Criteria:**

**Given** `gyms` has no fee column
**When** migration 0098 ships
**Then** `gyms.registration_fee integer not null default 0` exists with a `check (registration_fee >= 0)` — whole XAF, never floating-point (FR-026, NFR-003); `0` means the gym charges no fee and nothing else in this epic applies to it (FR-147)

**Given** `members` has no fee state — the only implied state is `deactivated_at` and `onboarding_completed_at` (`0003:16`, `0020:22`)
**When** migration 0098 ships
**Then** `members.registration_fee_settled_at timestamptz` exists, following the `deactivated_at` / `onboarding_completed_at` pattern; `NULL` on a `role = 'member'` row means **awaiting registration fee**; any non-null value means settled

**Given** production already holds real members, coaches, and staff rows in `members`
**When** the migration runs
**Then** every existing `members` row — all roles, including deactivated ones — is backfilled with `registration_fee_settled_at = created_at` in the same migration that adds the column, and a trailing `do $verify$` block asserts zero rows have `NULL` afterward (the `0095` / `0093` self-check pattern); no existing member's access, subscription status, or renewal path changes (FR-149)

**Given** a new `members` row is inserted
**When** the gym's `registration_fee` is `0`, or the row's `role` is not `'member'`
**Then** a `BEFORE INSERT` trigger sets `registration_fee_settled_at = now()` — a member created while the fee is 0 is settled from creation and is never charged retroactively if the gym later sets a fee (FR-149)
**Then also** when the fee is above `0` and `role = 'member'`, the column is set to `NULL` (awaiting); the fee is read from the new row's own `gym_id`, never from a client-supplied value

**Given** staff hold INSERT and UPDATE on `members` (`manager_or_owner_insert_own_members` `0093:81`, `manager_or_owner_update_own_members` `0093:84`) and members hold a self-update (`self_update_own_member_onboarding_fields` `0020:31`, pinned by `private.protect_self_managed_member_columns` `0020:45`)
**When** an authenticated session tries to write `registration_fee_settled_at` directly
**Then** the write is rejected or pinned unchanged — the same discipline as `protect_payment_columns_on_staff_verify` (`0031`); only the `SECURITY DEFINER` functions introduced in this epic and `service_role` may change the column, and `protect_self_managed_member_columns` is extended so a member cannot settle their own fee

**Given** `subscriptions` can be inserted by `provisionMemberRow` → `insertSubscription` (`members.ts:589`) and by three SQL renewal functions
**When** any `INSERT` targets a member with `role = 'member'` and `registration_fee_settled_at IS NULL`
**Then** a `BEFORE INSERT` trigger on `subscriptions` raises `registration_fee_not_settled` — for every plan type including `pay_per_session`, from every path (FR-148); the rule is enforced in the database, so no dashboard, import, or script entry point can bypass it

**Given** renewals must never break
**When** pgTAP exercises `confirm_renewal` (`0093:370`), `renew_subscription` (`0093:546`), and `complete_verified_payment` (`0030:126`) for a settled member in a gym that has just changed its fee from 0 to 5000
**Then** all three succeed unchanged — and an existing member who is `expired` or in `grace_period` can still be renewed (FR-149: members with a prior subscription are never blocked)
**Then also** the whole existing pgTAP suite passes with no fixture edits: the 19 test files that insert directly into `subscriptions` stay green because a default fee of 0 settles every fixture member at insert

**Given** `enforce_member_cap` (`0018:70`) counts every `role = 'member'` row on INSERT with no state filter, and `0093:689-697` asserts it stays ungated
**When** a gym is at its cap and a new member is inserted into the awaiting state
**Then** the insert is rejected exactly as today — an awaiting member counts toward the cap (FR-148, OQ-18 resolved 2026-10-07); a pgTAP case proves it and the existing `0093` assertion is left untouched

**Given** `gyms` UPDATE is owner-only (`owner_update_own_gym` `0014:11`) and `private.protect_super_admin_only_gym_columns` (`0014`, extended `0071`) pins super-admin-only columns
**When** this story ships
**Then** `public.set_registration_fee(p_amount integer)` exists as `SECURITY DEFINER`, callable only by `owner` or `supervisor` of the caller's own gym (manager, receptionist, coach, and member are rejected), rejects a negative amount, and is guarded by `private.current_gym_status()` so a suspended gym cannot call it (the `suspension_rpc_coverage.test.sql` introspection stays green)
**Then also** it writes a `registration_fee_changed` audit row through `log_audit_event` with the old and new amount in `metadata` (FR-147, FR-080 amendment); `registration_fee` joins the columns `protect_super_admin_only_gym_columns` pins, so even an Owner cannot change it by a direct UPDATE that skips the audit row
**Then also** a fee change applies only to members inserted afterward — no existing member's `registration_fee_settled_at` is touched

**Given** the Settings page (`settings/page.tsx` → `SettingsForm.tsx`) is visible only to owner and supervisor (`Sidebar.tsx:50`)
**When** this story ships
**Then** a "Registration fee (XAF)" field appears there, an integer ≥ 0 with helper text "0 means no registration fee", saved through a new server action that calls `set_registration_fee` — not through `saveGymSettings`; `getGymSettings` (`gym-settings.ts:67`, an explicit column select) and the `GymSettingsRow` type gain the column; a Manager sees no field

**Given** `auditLabels.ts` maps action types to `audit.actionTypes.*` keys and unmapped types render as the raw string
**When** this story ships
**Then** `registration_fee_changed` is mapped, with EN and FR strings in `apps/dashboard/locales/{en,fr}.json`, and `pnpm check:i18n` passes

**Given** `packages/types/src/database.ts` is generated
**When** this story ships
**Then** it is regenerated and a Zod schema for the fee input lives beside `gymSettingsSchema` (`packages/types/src/schemas/gym.ts:136`); new pgTAP lives in `supabase/tests/registration_fee_foundation.test.sql` with a `.negative.test.sql` companion covering the role matrix, a suspended gym, a cross-gym attempt, a direct column write, and the `NULL`-backfill assertion

---

### Story 18.2: Payment Purpose, Manual Fee Collection & Waiver

As a front-desk staff member or manager,
I want to record a new member's registration fee, or waive it, in one step,
So that the member is settled immediately and can be given a plan.

*Delivers FR-150, FR-152 (manual path). Migration 0099. Database-only — the screens are Story 18.6.*

**Acceptance Criteria:**

**Given** `payments` has no notion of what it pays for — `subscription_id IS NULL` already means "manual, unrenewed" (`0005`), and `complete_verified_payment` (`0030`) turns every `processing → verified` payment into a renewal
**When** migration 0099 ships
**Then** `payments.purpose text not null default 'subscription'` exists with `check (purpose in ('subscription','registration_fee'))` — text plus a check rather than an enum, the same reason `0036` moved `method` off an enum; every existing row takes the default, so no existing payment changes meaning (addendum §D, FR-152)
**Then also** `payments.voided_at timestamptz` is added now (set only by Story 18.4's RPC) and pinned against direct writes in the same style as `protect_payment_columns_on_staff_verify`

**Given** two staff, or a cash entry and a Tara collection, could record the same member's fee at once
**When** this story ships
**Then** a partial unique index on `payments (member_id) where purpose = 'registration_fee' and voided_at is null and status <> 'flagged'` enforces **at most one non-voided fee payment per member** (FR-152) — a `flagged` payment is excluded so a disputed attempt can be retried; the losing writer gets `registration_fee_already_recorded`

**Given** `gym_staff_insert_own_payments` (`0031:50`, widened `0093`) lets staff insert `pending`/`processing` rows
**When** this story ships
**Then** that policy gains `purpose = 'subscription'`, so a fee payment can only be created through the RPCs in this epic — the generic Payments form (`recordManualPayment`, `payments.ts:268`) can never create or mislabel one

**Given** a member is awaiting and the gym's fee is above 0
**When** `public.record_registration_fee(p_member_id uuid, p_method text, p_reason text)` is called by an owner, manager, supervisor, or receptionist of the caller's gym
**Then** it inserts a `payments` row with `purpose = 'registration_fee'`, `status = 'verified'`, `actor_id = auth.uid()`, `currency = 'XAF'`, no `subscription_id`, and **`amount` read from `gyms.registration_fee` server-side — never supplied by the caller** (FR-152 "exactly the gym's fee"), then sets `members.registration_fee_settled_at = now()` in the same transaction
**Then also** a manually recorded fee takes effect immediately and never enters the verification queue (FR-152 `[ASSUMPTION]`, matching how front-desk cash renewals activate at once, FR-050) — this function is the one place to change if a second-person check is later required

**Given** the manual methods are `cash`, `bank_transfer`, and `manual_momo` (the closed Zod enum in `packages/types/src/schemas/payment.ts`), and FR-038 requires a reason
**When** `record_registration_fee` validates its input
**Then** `mobile_money` is rejected (the Tara path is Story 18.3), a blank reason or one over 200 characters is rejected (`payments_reason_length_check`), and the audit action `registration_fee_recorded` carries amount, method, and reason in `metadata`

**Given** the function must be safe for a member who is not due
**When** it is called for a member who is already settled, deactivated, in another gym, not `role = 'member'`, or in a gym whose fee is `0`
**Then** it raises `registration_fee_not_due`, `member_deactivated`, `not_found`, `not_found`, and `registration_fee_not_configured` respectively and writes nothing; it is guarded by `private.current_gym_status()` so a suspended gym cannot call it

**Given** `payments_notify_status_change` (`0046:267`) pushes N-04 "payment confirmed" on `verified`, and an awaiting member has no app access and no active membership
**When** a registration-fee payment becomes `verified` or `flagged`
**Then** the trigger skips it — no N-04 or N-05 is sent for `purpose = 'registration_fee'`; pgTAP asserts no notification row is produced

**Given** an Owner, Supervisor, or Manager decides not to charge a member
**When** `public.waive_registration_fee(p_member_id uuid, p_reason text)` is called
**Then** it requires role `owner`, `supervisor`, or `manager` of the caller's gym (receptionist and coach are rejected, FR-150), a non-blank reason, an awaiting member, and an active gym; it sets `registration_fee_settled_at = now()`, creates **no payment row**, and writes a `registration_fee_waived` audit row with the reason

**Given** `auditLabels.ts` leaves unmapped action types as raw strings
**When** this story ships
**Then** `registration_fee_recorded` and `registration_fee_waived` are mapped with EN and FR strings; Zod schemas for both inputs live in `packages/types/src/schemas/payment.ts`

**Given** new pgTAP lives in `supabase/tests/registration_fee_collection.test.sql`
**When** it runs
**Then** it covers the role matrix for both RPCs, an amount that cannot be client-supplied, a double-record race (second call fails), a disputed (`flagged`) payment being retryable, a direct `purpose = 'registration_fee'` insert being denied by RLS, no N-04 push, a suspended gym, and a cross-gym member

---

### Story 18.3: Tara Money Fee Collection

As a front-desk staff member,
I want to start a Tara Money collection for a new member's registration fee,
So that a member can pay the fee by mobile money at the desk instead of in cash.

*Delivers FR-152 (Tara path). Migration 0100. Staff-initiated only — the member never starts this payment.*

**Acceptance Criteria:**

**Given** `initiatePayment` (`payments.ts:58`) prices from the member's latest subscription's plan (`:81`) and returns `not_found` when none exists, and `initiate_member_payment` (`0055`, latest `0090:1169`) fails with `no_active_plan`
**When** this story ships
**Then** a new staff-only server action and service function `initiateRegistrationFeePayment(memberId)` prices from `gyms.registration_fee` instead — the fee is its own price source (addendum §D); the existing renewal initiators are not modified and their behavior is unchanged

**Given** automated payment is available only to gyms that connected Tara Money (FR-127; `active_payment_provider` RPC)
**When** a gym has no active provider
**Then** the action returns `no_active_provider` and the UI offers manual methods only; a gym that has not connected Tara Money loses nothing

**Given** a member is awaiting and the fee is above 0
**When** staff start a Tara collection
**Then** a `payments` row is inserted with `purpose = 'registration_fee'`, `status = 'processing'`, `method = 'mobile_money'`, the active `provider`, and `amount = gyms.registration_fee`, then the `payment-webhook/initiate/<providerKey>` edge function is called (`index.ts:43`, `amount: payment.amount` at `:200`) so the charged amount always comes from the stored row
**Then also** the payer-phone field follows the same Tara-supported-country restriction as `RenewalModal` (FR-142)

**Given** the partial unique index from Story 18.2 covers `processing` rows
**When** a second Tara attempt (or a cash entry) is made while one is `processing` or `verified`
**Then** it is refused with `registration_fee_already_pending` / `registration_fee_already_recorded` — the same shape as `payment_already_pending` in `0055`

**Given** `complete_verified_payment` (`0030:76-153`, `service_role` only) treats every verified payment as a renewal and is listed in `0090:1689-1692`'s suspension-gate exclusion array
**When** this story ships
**Then** it is redefined with a `purpose` branch: for `registration_fee` it performs the same `processing → verified` update with the same idempotency guard and records `provider_fee_amount`, sets `members.registration_fee_settled_at = now()`, and writes a `registration_fee_paid` audit row (system actor `payment-webhook`) — and it **never inserts a subscription and never sets `payments.subscription_id`** (FR-152); the `subscription` branch is byte-for-byte unchanged
**Then also** the function stays in the `0090` exclusion array and `suspension_rpc_coverage.test.sql` stays green

**Given** webhooks can be delivered twice (FR-035)
**When** the same confirmation arrives again
**Then** it is a no-op — no second settle, no second audit row, no duplicate payment — proven by the existing idempotency pattern

**Given** the existing renewal branch skips a deactivated member and leaves the payment `verified` (`0030:104`)
**When** a fee payment is confirmed for a deactivated member
**Then** it behaves the same way: the payment stays `verified`, the member is not settled, and a `raise notice` records why — consistent with the renewal branch, and revisited under OQ-17
**Then also** `complete_flagged_payment` (`0046`) on a fee payment does not settle the member, sends no N-05 (Story 18.2's skip), and leaves the member free to retry because `flagged` is outside the unique index

**Given** Tara Money automated payments have not yet carried real traffic in production (PRD FR-099 correction; OQ-7)
**When** this story ships
**Then** it is verified end to end in the Tara sandbox, and an awaiting member calling `initiate_member_payment` is pinned by a pgTAP case to still fail — the member cannot self-serve the fee (FR-148)

**Given** new tests accompany the change
**When** they run
**Then** pgTAP covers `complete_verified_payment` for both purposes, a replayed webhook, a deactivated member, and a flagged fee payment; the edge function's existing tests for renewals stay green unchanged

---

### Story 18.4: Void, Refund Block & Revenue Line

As a gym Owner or Supervisor,
I want to correct a fee recorded in error without refunding it, and to see registration-fee income on its own line,
So that a mistaken entry is never permanent and the books stay honest.

*Delivers FR-151, FR-153. Migration 0101.*

**Acceptance Criteria:**

**Given** the fee is non-refundable (FR-149) and Story 18.2 records it as a `verified` row with no way back
**When** `public.void_registration_fee_payment(p_payment_id uuid, p_reason text)` is called
**Then** it requires role `owner` or `supervisor` of the caller's gym, a non-blank reason, an active gym, and a payment in the caller's gym with `purpose = 'registration_fee'`, `status = 'verified'`, and `voided_at IS NULL`

**Given** a voided payment must not erase history
**When** the function succeeds
**Then** it sets `payments.voided_at = now()` (the row is never deleted — the ledger stays append-only), sets the member's `registration_fee_settled_at` back to `NULL` (awaiting registration fee), and writes a `registration_fee_voided` audit row with the reason — a void is a correction, not a refund

**Given** FR-151 restricts voiding to manual entries and to members without a plan
**When** the payment's `method` is `mobile_money`, or the member already has any subscription
**Then** it raises `tara_fee_cannot_be_voided` or `member_already_has_subscription` and changes nothing — a Tara-paid fee has already reached the gym's own account and is corrected outside the platform (FR-151 `[ASSUMPTION]`)

**Given** `refunds` RLS `manager_or_owner_insert_own_refunds` (`0093`) requires a `verified` payment in the same gym and `amount <= p.amount`
**When** this story ships
**Then** the policy gains `purpose <> 'registration_fee' and voided_at is null`, **and** a `BEFORE INSERT` trigger on `refunds` raises for any fee or voided payment as a second line — the block holds in the data layer, not only the UI (FR-153); `listRefundEligiblePayments` (`payments.ts:663`) excludes both so `RecordRefundModal` never offers them

**Given** `gym_revenue_mtd()` (`0095`) returns a single `bigint` of verified payments minus refunds, with no purpose or void filter
**When** this story ships
**Then** it is redefined with the same signature (`returns bigint`, so `getRevenueMtd` at `payments.ts:519` and its single call site at `page.tsx:136` need no change) and now excludes payments where `voided_at IS NOT NULL`; verified, non-voided registration fees stay inside the total (FR-153, FR-143)
**Then also** a new `gym_registration_fee_revenue_mtd() returns bigint` returns only verified, non-voided fee payments over the same gym-local month bounds (`private.gym_local_month_bounds`, `0097`), scoped by `private.gym_id()`; a suspended gym returns `0`

**Given** the Overview's "Revenue this month" card (`page.tsx:186-187`) shows one figure
**When** the gym's fee is above 0, or any fee was collected this month
**Then** the card shows a secondary line "of which registration fees: XAF n" from a new `getRegistrationFeeRevenueMtd()` service call, in EN and FR; a gym with no fee sees the card exactly as before, and polling behavior is unchanged

**Given** `auditLabels.ts` maps action types
**When** this story ships
**Then** `registration_fee_voided` and `registration_fee_paid` (from 18.3) are mapped with EN and FR strings

**Given** the existing revenue test is `supabase/tests/gym_revenue_mtd.test.sql` (`plan(36)`)
**When** this story ships
**Then** it is updated for the void exclusion and a new `registration_fee_void_refund_revenue.test.sql` covers: the full void role matrix (manager and receptionist rejected), Tara rejection, member-with-subscription rejection, double void, cross-gym, refund attempts through both RLS and the trigger, and the fee revenue line across a month boundary in a non-UTC gym timezone

---

### Story 18.5: Two-Step Member Creation, First-Plan Assignment & Import Exemption

As a gym Owner, Supervisor, or Manager,
I want to register a new member first and assign their plan once the fee is settled,
So that the fee gate fits the way I create members — and so a registered member with no plan is no longer a dead end.

*Delivers FR-148 (staff flow), FR-154, FR-155 (invite timing). No migration. Dashboard services and actions.*

**Acceptance Criteria:**

**Given** `createMember` (`members/actions.ts:42`) validates `createMemberSchema` (`member.ts:86`), which requires `planId`, `joinDate`, and `subscriptionStatus`, and `provisionMemberRow` (`members.ts:685`) inserts the member and then a subscription
**When** the gym's `registration_fee` is above 0
**Then** `MemberModal.tsx` (`createMember` call ~`:335`) hides the plan, status, and expiry fields, and `provisionMemberRow` skips `insertSubscription` — the member is created in the awaiting state with no subscription (FR-148, amends FR-019)
**Then also** `createMember` reads the fee **server-side**; it never trusts a client flag. If a client sends plan fields to a fee gym, the action returns `registration_fee_due` before creating anything

**Given** a gym whose fee is `0`
**When** a member is created
**Then** the one-step flow is unchanged — same fields, same subscription insert, same audit entry — and the existing `MemberModal` and `createMember` tests pass unmodified

**Given** no way exists to give a plan to a member who has none: `confirm_renewal` and `renew_subscription` both raise "has no existing subscription", and `listMembers` already falls back to `status: "no_active_plan"` for such members (`members.ts:112`)
**When** this story ships
**Then** a new action `assignInitialPlan(memberId, planId, startDate)` exists for owner, supervisor, and manager (the same set as member creation, `CAN_MANAGE` in `MembersPageClient.tsx:~42`; receptionists still cannot, FR-021) and inserts the first subscription through `insertSubscription` (`members.ts:589`) with `status = 'active'`, `start_date`, and an expiry derived from the plan's `duration_days` — `pay_per_session` gets a null expiry per the trigger at `0018:27`
**Then also** the Story 18.1 gate rejects it with `registration_fee_not_settled` for an awaiting member, surfaced as `registration_fee_due`; it works for any settled member with no subscription, in a fee gym or not
**Then also** it records no payment for the plan price (scope boundary above), writes a `member_plan_assigned` audit row, and respects the existing `member_cap_reached` path

**Given** the members list renders `MemberBadgeStatus` (`memberLabels.ts`) and filters by `VALID_STATUS_FILTERS` (`members.ts:~140`)
**When** this story ships
**Then** an awaiting member shows an "Awaiting registration fee" badge, the filter list gains that status, and the list query selects `registration_fee_settled_at`; a settled member with no plan keeps the existing "no plan" display

**Given** CSV import (`confirmCsvImport`, `csvImport.ts` ~`:353`) loops `provisionMemberRow` with all-or-nothing rollback, and every row creates a subscription
**When** the gym's fee is above 0
**Then** each imported member is settled before its subscription insert — `provisionMemberRow` accepts an `importExempt` option that sets `registration_fee_settled_at` through the service-role admin client (the same client already used for cleanup, `members.ts:628` / `:516`) between `insertMember` and `insertSubscription`; an authenticated session still cannot write the column (Story 18.1) (FR-154, FR-149)
**Then also** the all-or-nothing rollback is unchanged, no fee payment is created, the import is never blocked by the fee, and each per-row audit entry carries `via: "csv_import"` and `registration_fee_exempt: true`

**Given** `sendMemberInvite` (`actions.ts:222`) re-fetches the member through `getMemberForInvite` (`members.ts:255`)
**When** the member is awaiting
**Then** it returns `registration_fee_due` and sends no WhatsApp message, and "Send Invite" / `InviteMemberModal` are disabled with an explanation; once the member is settled the invite behaves exactly as FR-082 describes (amended by FR-155) — the invite is sent only after the fee is settled

**Given** strings must be bilingual
**When** this story ships
**Then** every new label, error, and badge has EN and FR entries and `pnpm check:i18n` passes; Vitest covers the fee and no-fee `createMember` paths, `assignInitialPlan`, and a fee-gym CSV import including a mid-file failure rolling everything back

---

### Story 18.6: Dashboard Fee Collection, Waive & Void Surfaces

As front-desk staff, a manager, or an owner,
I want to collect, waive, or void a registration fee from the screens I already use,
So that settling a new member takes seconds at the desk.

*Delivers FR-148 (UI), FR-150, FR-151, FR-152, FR-153 (surfaces). No migration. Calls the RPCs from 18.2, 18.3, and 18.4.*

**Acceptance Criteria:**

**Given** an awaiting member appears in `MembersPageClient.tsx`
**When** staff open the member's actions
**Then** a "Collect registration fee" action shows the gym's fee amount, and no plan assignment is offered until the member is settled; after settlement "Assign plan" (Story 18.5) and "Send invite" become available

**Given** the collection modal
**When** staff choose a method
**Then** they can pick Cash, Bank transfer, or Manual mobile money — which calls `record_registration_fee` with a mandatory reason (FR-038; pre-filled "Registration fee" and editable) — or, when Tara Money is connected, Tara Money, which asks for the payer phone using the same country-restricted input as `RenewalModal` (FR-142) and calls `initiateRegistrationFeePayment`; the amount is displayed but never editable

**Given** a Tara collection is `processing`
**When** the modal is open or reopened
**Then** it shows a waiting state and refreshes the member row when the webhook settles it — the member never appears awaiting after a confirmed payment — reusing the existing Tara UX pattern in `components/shared/RenewalModal.tsx`; a `flagged` result shows an error and allows a retry

**Given** FR-021 and FR-150 split the roles
**When** the UI renders actions
**Then** a receptionist sees "Collect" but not "Waive" or "Void"; a manager sees "Collect" and "Waive"; an owner or supervisor sees all three — the UI mirrors the RPC checks and the RPC remains the authority

**Given** staff decide not to charge
**When** they choose "Waive"
**Then** a modal requires a reason, explains the member will be settled without a payment, and calls `waive_registration_fee`; the action cannot be undone from the UI

**Given** the Payments page has only a pending queue and discrepancies — there is no all-payments ledger and no per-member payment history in the dashboard
**When** this story ships
**Then** the member row and member detail show the fee state — "Awaiting", "Paid XAF n on <date>", or "Waived by <name>" — rather than adding a ledger page; fee payments carry a "Registration fee" label via `paymentLabels.ts` wherever the Payments page renders a payment

**Given** FR-151 allows voiding only a manual fee on a member with no plan
**When** an owner or supervisor views such a member
**Then** a "Void (recorded in error)" action opens a modal with a mandatory reason and the explicit line "This is not a refund", calling `void_registration_fee_payment`; it is hidden for a Tara-paid fee (with a hint that Tara fees are corrected outside the platform) and for a member who already has a plan

**Given** `RecordRefundModal` and `listRefundEligiblePayments` come from Story 18.4
**When** staff open the refund flow
**Then** registration-fee payments are never offered — verified in the UI as well as the data layer

**Given** all audit action types from this epic are now emitted
**When** the audit log renders
**Then** `registration_fee_changed`, `registration_fee_recorded`, `registration_fee_paid`, `registration_fee_waived`, `registration_fee_voided`, and `member_plan_assigned` all show friendly EN and FR labels, with no raw snake_case strings; the audit viewer's existing date and actor filters work with them

**Given** this project's manual-QA convention
**When** this story is ready for review
**Then** the Dev Agent Record lists the browser checks the product owner will run: collect by cash and by Tara sandbox, waive, void, the receptionist/manager/owner/supervisor role matrix, a fee-0 gym unchanged, and an existing member renewing in a fee gym

---

### Story 18.7: Member App — Awaiting-Fee Blocked State & Fee Receipt

As a new member whose gym has not yet settled my registration fee,
I want the app to tell me clearly to contact my gym instead of showing an error,
So that I know what to do, and so my fee later appears in my payment history like any other payment.

*Delivers FR-155 and FR-041 (fee receipt). No migration. Mobile only.*

**Acceptance Criteria:**

**Given** `useSessionState` (`use-session.tsx:54-122`) resolves the member row selecting `onboarding_completed_at, gym_id` (`:106-114`) and `_layout.tsx:53-151` routes through three mutually exclusive `Stack.Protected` groups
**When** the member row exists and `registration_fee_settled_at` is `NULL`
**Then** the select adds `registration_fee_settled_at` and the hook exposes `isAwaitingRegistration`; a fourth protected group `awaiting-registration` is added beside `suspended`, excluded from `isFullyOnboarded` and from the onboarding group exactly as `showSuspended` is, and **suspended takes precedence** when both apply (FR-155)

**Given** `suspended.tsx` is the existing neutral block-screen precedent (message key, logout button, no billing language)
**When** this story ships
**Then** a new screen modelled on it says registration is not complete and to contact the gym, offers a "Check again" action and Log out, and offers **no payment option** (FR-155, FR-148 — no member self-service); the exact copy and layout are `[ASSUMPTION]` pending the UX pass noted in FR-155

**Given** an awaiting member's phone passes `phone_has_membership` (`0019:31`) and their non-deactivated row mints claims through the claims hook (`0065:77`), so `self_read_own_membership` (`0013:23`) lets them read their own row
**When** they sign in
**Then** they land on the blocked screen — never the generic "load error" a deactivated member sees today at `onboarding/plan.tsx`

**Given** staff settle the fee and assign a plan after the member first sees the blocked screen
**When** the member taps "Check again" or brings the app to the foreground
**Then** the session state refreshes and they continue into onboarding exactly as FR-058 describes — the blocked state never lingers stale
**Then also** a member who is settled but not yet assigned a plan reaches `onboarding/plan.tsx`'s existing `noPlanAssigned` branch (`:106-181`); this story **verifies** what that branch allows (whether such a member can complete `onboarding_completed_at`, `~:200`) and either confirms it shows a clear "your gym will assign a plan" state or fixes it so it does

**Given** "cannot use the member app" must not rest on the client alone
**When** this story ships
**Then** it confirms by test that an awaiting member — who has no subscription — cannot check in, book a class, or start a payment (`initiate_member_payment` → `no_active_plan`, pinned in Story 18.3); any gap found is recorded in `deferred-work.md` rather than silently widening this story

**Given** a fee payment is a `payments` row with no `subscription_id`, and the history list shows `history.payments.planUnavailable` for a null plan (`history/index.tsx:~400`) while the receipt shows `paymentDetail.planUnavailable` (`history/payment/[id].tsx:~140`)
**When** a settled member opens their history or a fee receipt
**Then** `loadPaymentsPage` (`payments.ts:42-71`) and `getPaymentReceipt` (`payments.ts:116`) select `purpose`, and a fee payment reads "Registration fee" in place of a plan name on both screens (FR-041, FR-152); amount, currency, method, date, reference, and actor are unchanged; a waived member simply has no payment row

**Given** the mobile app has its own locale files, deliberately separate from the dashboard
**When** this story ships
**Then** every new string has EN and FR entries in `apps/mobile/src/locales/{en,fr}.json` under the existing top-level sections, and the `check:i18n` gate passes

**Given** a mobile change costs a build and TestFlight/Play cycle
**When** this story is planned
**Then** it ships in one mobile release with any other pending mobile work, and the product owner's on-device QA covers: blocked screen, "Check again" after settlement, and a fee receipt in history

---

## V1.6 — Session Guests, Loyalty & Gym Category (2026-10-11 PRD v1.6)

Epics 1–18 are shipped or in flight. This section comes from PRD v1.6 (`prd.md` §6.27–§6.29, FR-156–FR-174, NFR-021/NFR-022; decision trail in `prds/prd-gym_os-2026-06-20/.memlog.md`) and the 2026-10-11 architecture spine update (`ARCHITECTURE-SPINE.md` AD-27–AD-32). The 2026-10-11 UX pass (`EXPERIENCE.md` / `DESIGN.md`, UX-DR17–UX-DR32) was reconciled into these stories the same day; copy and layout decisions that were marked `[UX]` are now fixed by it.

Production is live with real gyms, so every V1.6 behavior ships behind a per-gym switch: **Charge guests per session** is off for every gym that exists at release, and the **loyalty program** is off by default. Until an Owner or Supervisor turns one on, no existing gym sees a change.

**Decisions recorded 2026-10-11 (user accepted PM/architect recommendations):**
1. **Old mobile builds** — accept: an old build shows a refused guest its *expired* screen (not admitted, wrong copy). The new mobile build ships before charging is used, and the Charge-guests confirmation warns the owner that guests on old app versions see an "expired" message. No minimum-version gate.
2. **OQ-A** — Edge Function count stays 3; Tara session payments reuse `payment-webhook`'s purpose dispatch.
3. **OQ-B** — a daily `pg_cron` sweep persists and audits loyalty lapses/resets; every read computes the effective value and never writes. Accepted as satisfying FR-168.
4. **Ops gaps** — one checklist story (19.0) owned by the product owner covers release order and rollback, backup/PITR, staging, secrets rotation, and `job_runs` failure alerting before charging is enabled at any live gym.

### Epic 19: Session Guests — Per-Visit Paid Sessions
At a gym that turns on **Charge guests per session**, a Pay-per-session member can check in — or be marked attended at a class — only with a paid or free session. One session covers the whole gym-local day; an unused paid session lapses after 7 days. The desk records the session payment from the session-required alert, guests can pay in the app by Tara Money, offline scans are verified on sync, refunds follow data-layer rules, and the owner sees paid sessions, blocked attempts, and who collected on a Guest sessions card. Prerequisite guardrails (AD-3 CI gate, hosted-privilege check, flagged-payment reason) ship first, because this is the first epic that depends on them.
**FRs covered:** FR-156, FR-157, FR-158, FR-159, FR-160, FR-161, FR-162, FR-163, FR-173, FR-174
**Amends:** FR-038, FR-040, FR-042, FR-044, FR-049, FR-061, FR-069, FR-080, FR-105, FR-107, FR-143, FR-024, FR-025
**NFRs honored:** NFR-021 (atomic, database-enforced consumption), NFR-001, NFR-003, NFR-004, NFR-019
**Architecture:** AD-27, AD-28, AD-29, AD-31, AD-32 (charging setting, plan rules), AD-3 gate
**UX:** UX-DR17–UX-DR19, UX-DR21–UX-DR23, UX-DR25–UX-DR26, UX-DR28–UX-DR30, UX-DR32 (screens MA-09, MA-10, MA-11, MA-13, MA-14, MA-17, AD-02, AD-04, AD-08, AD-09, AD-10, AD-12, AD-13, AD-18, AD-22, AD-23)

### Epic 20: Loyalty Program — Free Sessions & Free Days
Guests earn one free session for every N paid sessions consumed; subscribers earn R free days for every K on-time renewals. Members see their progress, free sessions, and paid-session lapse dates in the app; staff see the same on the member page. Rewards are granted exactly once, progress resets after 90 idle days, and no one — Super Admin included — can edit a balance by hand. Builds on Epic 19 (the guest rule earns on consumption; a free session is a `guest_sessions` row); the subscriber rule stands alone. Off by default.
**FRs covered:** FR-164, FR-165, FR-166, FR-167, FR-168, FR-169, FR-170
**Amends:** FR-069, FR-080; completes FR-162's stamp reversal
**NFRs honored:** NFR-022 (idempotent, reconstructible loyalty), NFR-001, NFR-004
**Architecture:** AD-30, AD-32 (loyalty settings), AD-18 note (R-day extension)
**UX:** UX-DR20, UX-DR24, UX-DR27, UX-DR31 (screens MA-09 Rewards card, AD-04 Rewards section, AD-13 Loyalty program, AD-12 labels)

### Epic 21: Gym Category
Every gym carries a business category — Gym / Salle de sport, Studio Pilates, Studio Yoga, Fitness Center, Autre — chosen by Super Admin at gym creation and editable by Super Admin, Owner, or Supervisor, audited, labelled in EN and FR. Descriptive only in V1.6; it feeds V1.7's directory and landing pages. Independent of Epics 19–20; can ship first or in parallel.
**FRs covered:** FR-171, FR-172
**Amends:** FR-010, FR-069, FR-071
**Architecture:** AD-32 (category setter, stable code)
**UX:** UX-DR27 (Category in AD-13), UX-DR31 (SA-02/SA-03/SA-04, AD-12 label)

---

## V1.7 — GymOS Support Staff, Landing Pages & Directory (2026-10-15 PRD v1.7)

Epics 1–21 are shipped or in flight. This section comes from PRD v1.7 (`prd.md` §6.30–§6.32, FR-175–FR-214, NFR-023–NFR-026) and the architecture spine AD-33–AD-41. Delivery order is fixed by the product owner (PRD §10.2): support staff first, then landing pages, then the directory; each step has its own gate.

**Decisions recorded 2026-10-15 (product owner):**
1. **Support collapses to two epics** (22, 23) instead of five.
2. **No Owner approval of payment connection.** Support connects or replaces the Tara Money account directly; the safeguard is the audit trail under the individual's identity plus an immediate Owner notification. This drops the proposal flow; PRD FR-180 and spine AD-36 were synced to match the same day. AD-37 (versioned credentials) is unaffected.
3. **Epics 24–25 are outlines only.** Landing pages and directory have no architecture coverage yet (spine "Deferred") and no V1.7 UX; stories are written after that pass.

### Epic 22: Secure Sign-In Foundation — Access Ends Immediately, Second Factor for Super Admin and Support
Deactivating, removing or locking an account takes effect on its next request for every role, not at token expiry; Super Admin signs in with an authenticator code after a controlled bootstrap; the shared second-factor gate, session limits and step-up exist for support to use.
**FRs covered:** FR-189, FR-191, FR-192
**Amends:** FR-090, FR-072 (gate groundwork)
**NFRs honored:** NFR-023, NFR-021, NFR-001
**Architecture:** AD-3 (amended), AD-34 (read/write gate), AD-38, AD-40; Step 1 spikes (claims hook `aal`, factor enrollment guard, `auth.sessions` deletion)

### Epic 23: GymOS Support — Assigned Staff Who Work Inside a Gym
Super Admin creates support people by invite and assigns them to gyms many-to-many. The Owner has one "Allow GymOS Support" switch and sees one "GymOS Support" row. Support configures the gym and handles transactions, payment connection included, within an enumerated allow-list; the gym never sees who they are, and every action is audited under the individual.
**FRs covered:** FR-175–FR-188, FR-190, FR-193, FR-194, FR-195
**Amends:** FR-072, FR-087, FR-089, FR-091, FR-126, FR-127, FR-157 precedent
**NFRs honored:** NFR-023, NFR-001, NFR-013
**Architecture:** AD-33, AD-35, AD-37, AD-39, AD-41 (AD-36 dropped)
**Depends on:** Epic 22. Includes a product-owner pre-flight checklist story (Owner notification, OQ-30/OQ-31, Super Admin factor and recovery).

### Epic 24: Gym Landing Pages
A gym publishes an optional public page at `{name}.gymosapps.com` from content it enters, with two seed templates under one contract, a name it claims, and takedown/report handling.
**FRs covered:** FR-196, FR-197, FR-198, FR-199, FR-200, FR-201, FR-202, FR-203, FR-204, FR-205, FR-206, FR-207, FR-208
**NFRs honored:** NFR-024, NFR-025, NFR-026
**Architecture:** AD-42–AD-48 (spine pass 2026-10-15). **Depends on:** Epic 23 done (PRD §10.2); a `bmad-ux` pass is expected before 24.9 and the template visuals.

### Epic 25: Directory & Discovery
Published gyms appear in country and city listings with validating structured data and sitemap, filterable by category.
**FRs covered:** FR-209, FR-210, FR-211, FR-212, FR-213, FR-214
**NFRs honored:** NFR-024, NFR-025
**Architecture:** AD-49–AD-52 (spine pass 2026-10-15). **Depends on:** Epic 24 gate passed (PRD §10.2); the `bmad-ux` pass for the directory ran 2026-11-12 (`DESIGN.md` "Public Directory", `EXPERIENCE.md` PS-04…PS-06).

---

## V1.8 — Member Engagement & First-Gym Feedback (2026-11-15 PRD v1.8)

Epics 1–26 are shipped or in flight. This section comes from PRD v1.8 (`prd.md` §6.33–§6.40, FR-219–FR-251, NFR-027–NFR-029; FR-215–FR-218 stay with Epic 26) and the architecture spine AD-53–AD-61 (added 2026-11-15 after a three-reviewer gate). Delivery order is PRD §10.3 / §13: desk fixes first, then gym operations, then member engagement; each step has its own gate.

**Decisions recorded 2026-11-15 (product owner):**
1. **Five epics (27–31), not four.** Session validity (Epic 28) touches the money path (the session consume function) and classes (Epic 29) do not, so they are separate epics that can run in parallel.
2. **Epic 27 lays the attendance foundation** (stored visit day, the protected counting view, one check-in insert path) inside the staff check-in story, because Epics 28, 30 and 31 read it. There is no separate technical epic.
3. **Epic 31 is the cut line, and the cut is made.** Its Could items (daily streak FR-221, gym challenge FR-234, "Your month" FR-235) are deferred to a later release and have no stories in V1.8 (PRD §10.3 item 8 allows this). Their design is kept: UX screen MA-22 and the challenge settings, spine AD-61 `gym_challenges`, and the `day_shield` fact kind.
4. **Screen-heavy stories carry a UX gate.** The V1.8 UX pass ran on 2026-11-15 and extended `ux-gym_os-2026-07-04` (MA-18–MA-23, UX AD-30–AD-32); the screen states and copy there are the acceptance baseline, and many carry `[ASSUMPTION]` / `[NOTE FOR UX]` tags to settle in the story.
5. **Shorter plan: 21 stories, not 34.** Paired backend and screen stories were merged and small stories folded into neighbours (27: 4, 28: 3, 29: 4, 30: 7, 31: 3). Stories are in the section "V1.8 — Stories (Epics 27–31)" at the end of this document.

### Epic 27: Desk Fixes — Check a Member In at the Entrance, Correct a Wrong Plan
Staff check in a member who cannot use their phone, void a mistaken check-in the same day, and correct a plan assigned by mistake with a reason and an audit trail; annual plan cards say what the member pays.
**FRs covered:** FR-240, FR-241, FR-242, FR-243, FR-248, FR-249, FR-250, FR-251
**Amends:** FR-025 (clarified), FR-031, FR-044, FR-048, FR-080, FR-179
**NFRs honored:** NFR-028 (visit-day storage), NFR-001, NFR-021
**Architecture:** AD-56, AD-59, AD-53 (visit day only), AD-35, AD-39. **Depends on:** none. Lays the attendance foundation for Epics 28, 30, 31. UX gate: staff check-in and Correct plan screens.

### Epic 28: Pay-per-Session Validity — Whole Day or Single Use
A gym chooses whether a paid session covers the whole day or a single visit; a forgotten check-out never lets a member back in free, and existing gyms behave exactly as before.
**FRs covered:** FR-236, FR-237, FR-238, FR-239
**Amends:** FR-157, FR-159, FR-174
**NFRs honored:** NFR-021, NFR-028
**Architecture:** AD-55, AD-61 (setter), AD-29, AD-28. **Depends on:** Epic 27 (record_check_in, visit link).

### Epic 29: Classes — A Different Time Each Day, and Coach Access
A class runs at its own time on each day; coaches create their own classes; Owner, Supervisor and Manager see any coach's classes and members through a coach picker that never reaches body data.
**FRs covered:** FR-244, FR-245, FR-246, FR-247
**Amends:** FR-053, FR-104, FR-121, FR-122, FR-145
**NFRs honored:** NFR-011, NFR-016, NFR-001
**Architecture:** AD-57, AD-58, AD-34, AD-35. **Depends on:** none (independent of 27–28). UX gate: slot editor, coach-create flow, coach picker.

### Epic 30: Member Engagement Core — Weekly Ring, Calendar, Leaderboard, Milestones
A member sets a weekly goal and sees a ring and a weekly streak, a calendar of the days they came with today's "at risk" state, a monthly gym leaderboard where they can appear as "Anonymous", and a celebration at their 7th, 30th and 100th visit.
**FRs covered:** FR-219, FR-220, FR-224, FR-225, FR-226, FR-227, FR-228, FR-229, FR-232
**NFRs honored:** NFR-027, NFR-028, NFR-029, NFR-001
**Architecture:** AD-53, AD-54, AD-56 (counting views), AD-61 (weekly goal). **Depends on:** Epic 27. UX gate: ring, calendar, leaderboard, celebration, notice.

### Epic 31: Member Engagement Extras — Shields, Reminder, Badges, Sharing
Members keep a streak through illness with Streak Shields and a comeback state, get one evening reminder when it matters, collect badges and share a milestone image. The daily streak, the gym-wide challenge and the monthly summary (all *Could*) are deferred to a later release and have no stories in V1.8.
**FRs covered:** FR-222, FR-223, FR-230, FR-231, FR-233 (Should). **Deferred, no stories in V1.8:** FR-221, FR-234, FR-235 (Could)
**NFRs honored:** NFR-028, NFR-029
**Architecture:** AD-53 (Shield and comeback fold), AD-60, AD-25, AD-19. **Depends on:** Epic 30. UX gate: Shield chips and comeback card, reminder toggle, badge shelf, share image.

---

### Epic 19 — Stories

| # | Story | Migration | Depends on |
|---|---|---|---|
| 19.0 | V1.6 Release Readiness — Ops Checklist (product owner) | none | — |
| 19.1 | CI Guardrails — Live-Role Lint Gate & Hosted-Privilege Check | none | — |
| 19.2 | Flagged-Payment Reason (Late vs. Wrong Account) | **0106** | 19.1 |
| 19.3 | Charge-Guests Setting, Session Record & Plan-Type Rules | **0107** | 19.1 |
| 19.4 | Desk Session Payment | **0108** | 19.3 |
| 19.5 | In-App Tara Money Session Payment | **0109** | 19.2, 19.4 |
| 19.6a | Front-Desk Alert `kind` Refactor (no behavior change) | **0110** | 19.1 |
| 19.6b | Check-In Gate, Blocked Attempts & Session-Required Alert | **0111** | 19.4, 19.6a |
| 19.7 | Class Attendance Consumes a Session | **0112** | 19.6b |
| 19.8 | Session Refunds & Revenue Line | **0113** | 19.4 |
| 19.9 | Dashboard — Charge-Guests Setting, Session Alert, Member Sessions & Plan Lock (built as 19.9a / 19.9b / 19.9c) | none | 19.3–19.8 |
| 19.10 | Guest Sessions Overview Card | **0114** | 19.6b, 19.8 |
| 19.11 | Member App — Pay for Your Session, Offline Verification & Session Lapse | none | 19.5, 19.6b |
| 19.12 | V1.6 Session Guests Enablement | **0115** | 19.0, 19.9, 19.10, 19.11 |

*Migration numbers are the next free numbers as of 2026-10-11 (latest is `0105`); renumber at build time if another migration lands first.*

**Dependency order:** 19.0 and 19.1 first and in parallel (19.0 is non-code). 19.1 → {19.2, 19.3, 19.6a} → 19.4 → {19.5, 19.6b, 19.8} → 19.7 → {19.9, 19.10, 19.11} → 19.12 last. **Production safety:** `charge_guests_per_session` is added `NOT NULL DEFAULT false` in 19.3, so every gym — existing and newly created — stays off through 19.0–19.11; nothing a live gym sees changes until an Owner or Supervisor turns charging on in 19.9's Settings UI. Only 19.12 sets the column default to `true` for gyms created afterward (AD-32), and only once the new mobile build (19.11) is in the stores and 19.0 is signed off. **19.6a runs on every live gym** (it rewrites the existing subscription-alert path), so it ships alone and runs in production for at least a week before 19.6b deploys. **Kill switch:** from 19.6b on, `check_in()` and `mark_class_attendance()` read the gym's flag before calling any V1.6 code, so turning charging off puts a gym back on the pre-V1.6 path.

**Scope boundary — what this epic does NOT do.**
- **No loyalty.** Stamps, free sessions, and their display are Epic 20. This epic creates `guest_sessions` so a free session can be a row later (AD-28), and leaves a single, no-op stamp hook in the consumption and refund paths that Epic 20 fills.
- **No minimum-app-version gate.** Old mobile builds show a refused guest their *expired* screen (decision 1, 2026-10-11); 19.9's confirmation dialog warns the owner instead.
- **No physical access control.** The gate decides whether a *scanned* visit is recorded and admitted by the app (PRD §6.27); unscanned walk-ins stay a desk process.
- **No auto-waive of the registration fee** for Pay-per-session plans (FR-156) — only a one-tap "Session guest" preset reason.
- **No new Edge Function** (OQ-A): Tara session payments go through `payment-webhook`'s existing purpose dispatch.

### Story 19.0: V1.6 Release Readiness — Ops Checklist

As the product owner deploying to live gyms,
I want the operational gaps the architecture spine left open to each have a written answer before charging is enabled anywhere,
So that a bad V1.6 migration or job failure at a paying gym is recoverable and visible.

*Non-code story; owner: product owner. Closes the "Open, not decided" ops list in `ARCHITECTURE-SPINE.md` (Deployment & environments). Gates 19.12.*

**Acceptance Criteria:**

**Given** V1.6 changes payment and check-in paths for gyms that are already live
**When** this story is done
**Then** `docs/decisions.md` has a dated "V1.6 release runbook" entry stating: the deploy order for 0106–0115 relative to the dashboard and mobile releases; for each migration whether it is forward-only or has a written rollback, and what is done if it fails half-way on production

**Given** the Supabase project holds real member and payment data
**When** the runbook is written
**Then** it records the project's actual backup / point-in-time-recovery posture (plan tier, retention window, last tested restore — or "never tested" stated plainly) and a decision to accept or upgrade it

**Given** there is no staging project (CI runs a local `supabase start`)
**When** the runbook is written
**Then** it states where V1.6 migrations are rehearsed against production-shaped data before production (e.g. a Supabase branch or a restored copy) or explicitly accepts the risk of not doing so

**Given** secrets live in Supabase, Vercel, EAS, and Vault (per-gym Tara credentials)
**When** the runbook is written
**Then** it lists each secret's location and a rotation procedure, or explicitly defers rotation with a revisit date

**Given** `pg_cron` jobs log failures to `job_runs` but nothing alerts on them
**When** the runbook is written
**Then** it names how a failed job reaches a human (e.g. a Sentry check-in, a daily `job_runs` query, or an email) — and that mechanism is in place before 19.12

**Given** the checklist is complete
**When** 19.12 is planned
**Then** `sprint-status.yaml` records 19.0 as done with a pointer to the runbook entry

---

### Story 19.1: CI Guardrails — Live-Role Lint Gate & Hosted-Privilege Check

As a developer adding V1.6 migrations,
I want CI to fail a PR that reads the role from the login token in a new migration, or that leaves a new function executable by roles it should not be,
So that the authorization rules V1.6 depends on (AD-3) can't silently regress again.

*Prerequisite for every V1.6 migration (AD-3 status note, 2026-10-11). No migration.*

**Acceptance Criteria:**

**Given** 52 files in `supabase/migrations/` contain `auth.jwt() ->> 'app_role'` (in any spacing variant), including new sites in 0098–0102
**When** this story ships
**Then** a CI step (in `.github/workflows/ci.yml`, alongside the i18n gate) fails the PR if any migration file **not** on an explicit, checked-in grandfather list contains that pattern; the grandfather list is exactly the files that contain it on the story's base commit, and the step's failure message names `private.current_member_role()` as the replacement

**Given** the grandfather list exists
**When** a grandfathered file is edited
**Then** the gate still passes (existing files are not retro-fixed here), and adding a new file to the list requires a reviewer-visible diff to the list file — the list is not regenerated automatically

**Given** a deliberately bad fixture migration with a new `auth.jwt() ->> 'app_role'` read
**When** the gate runs against it in a test
**Then** it fails; with the read replaced by `private.current_member_role()` it passes

**Given** 0104 proved the hosted project's default privileges grant `EXECUTE` on new functions to `anon`, which the local CI database does not reproduce
**When** this story ships
**Then** a CI check fails the PR if a migration creates a function (`create function` / `create or replace function`) without, in the same file, an explicit `revoke execute … from public` and `from anon` for that function (the function-privileges convention in `ARCHITECTURE-SPINE.md`); trigger functions and `private.` helpers follow the same rule

**Given** the hosted-privilege check is a static check, not a live query
**When** the story closes
**Then** `docs/decisions.md` records that limitation and the manual post-deploy query (from 0104's verification block) the product owner runs after each V1.6 migration until a live check exists

---

### Story 19.2: Flagged-Payment Reason (Late vs. Wrong Account)

As a gym owner,
I want the platform to know *why* a Tara Money payment was flagged,
So that a guest whose payment was only confirmed late still gets the session they paid for, while money that landed in the wrong account never does.

*Prerequisite from AD-27. Migration 0106. No behavior change for subscription or registration-fee payments.*

**Acceptance Criteria:**

**Given** late-confirmed and wrong-account payments are both stored as `status = 'flagged'` with no discriminator (late fee confirmations: 0100 header; wrong-account: the FR-036 reconciliation categories)
**When** migration 0106 ships
**Then** `payments.flagged_reason text` exists, nullable, with a CHECK limiting it to a closed set that includes at least `late_confirmation`, `wrong_account`, `expired_attempt`, and `reconciliation_mismatch`, and a CHECK that it is non-null exactly when `status = 'flagged'` for rows flagged after the migration

**Given** production already holds flagged payments
**When** the migration runs
**Then** existing flagged rows are backfilled from the evidence already recorded (the late-payment audit rows of 0100, `expire_stale_registration_fee_payment`'s audit code, the reconciliation job's discrepancy category); any row whose reason cannot be determined is set to `reconciliation_mismatch`, and a trailing `do $verify$` block asserts no post-migration flagged row has a null reason

**Given** every code path that sets `status = 'flagged'` (the 0100 expiry helper, `complete_verified_payment`'s late branch, the reconciliation job(s) of AD-14, and any other site found by grep)
**When** this story ships
**Then** each one sets `flagged_reason` in the same statement; a pgTAP test per path asserts the reason written

**Given** `flagged_reason` must not be forgeable by a client
**When** a direct client UPDATE tries to change it
**Then** it is pinned the same way 0099 pins `purpose`/`voided_at` (`protect_payment_purpose_and_void` is extended, or a sibling INVOKER trigger is added — not a second copy of its body)

**Given** staff already see flagged payments on the Payments page
**When** a flagged payment has a reason
**Then** the dashboard shows the reason as a localized label beside the Flagged badge (EN/FR, UX-DR28): `late_confirmation` "Confirmed late" / "Confirmé en retard", `wrong_account` "Wrong Account Settlement" / "Règlement sur le mauvais compte" (shipped), `expired_attempt` "Attempt expired" / "Tentative expirée", `reconciliation_mismatch` "Amount Mismatch" / "Écart de montant" (shipped); `check:i18n` passes

---

### Story 19.3: Charge-Guests Setting, Session Record & Plan-Type Rules

As a gym Owner or Supervisor,
I want a per-gym switch for charging guests per session, backed by a real session record, and plans whose type and price can't be changed out from under paid sessions,
So that per-visit charging has a safe foundation before anything is enforced.

*Delivers FR-156 (plan price = session price, 0 XAF exempt, "Session guest" waiver preset), FR-157 (setting, data + RPC only), FR-173, the FR-158 session record (AD-28), and the `session` payment purpose (AD-27). Migration 0107. Changes nothing for any gym: the setting defaults off.*

**Acceptance Criteria:**

**Given** `gyms` has no charging flag
**When** migration 0107 ships
**Then** `gyms.charge_guests_per_session boolean not null default false` exists; every existing and newly created gym is off (the default flips to `true` only in 19.12, AD-32)

**Given** the flag must have exactly one write path (AD-32)
**When** this story ships
**Then** `set_guest_charging(p_enabled boolean)` is a `SECURITY DEFINER` RPC that allows only Owner or Supervisor of the caller's gym via `private.current_member_role()` (AD-3), honors suspension like other gym RPCs (0090), writes an audit row with old and new value, and is the only holder of the flag's GUC; a dedicated BEFORE UPDATE pin trigger function (its own function — **not** a new branch in `protect_super_admin_only_gym_columns()`) rejects every other writer including Super Admin and `service_role`

**Given** the owner must see the impact before switching on (FR-157)
**When** `guest_charging_impact()` is called by an Owner or Supervisor
**Then** it returns the count of active members whose current subscription's plan is `pay_per_session` with a price above 0

**Given** sessions need their own record (AD-28)
**When** migration 0107 ships
**Then** `guest_sessions` exists with `gym_id`, `member_id`, `payment_id` (nullable FK to `payments`), `loyalty_grant_id` (nullable, no FK yet — Epic 20), a CHECK that exactly one of the two is non-null, `usable_until timestamptz not null`, `consumed_at`, `covered_day date`, `voided_at`, `created_at`; RLS enabled in the same migration with SELECT for staff of the gym and for the member on their own rows, **no** INSERT/UPDATE/DELETE policy for any role, and `authenticated`/`service_role` table grants limited to SELECT; a partial unique index on `(member_id, covered_day) where consumed_at is not null and voided_at is null` and a unique index on `payment_id` where not null

**Given** the 7-day paid-session validity, 60-day free-session validity, and 90-day loyalty idle window are platform defaults stored as data (FR-159, FR-166, FR-168; AD-30)
**When** migration 0107 ships
**Then** a one-row `platform_session_config` table exists (`paid_session_validity_days` 7, `free_session_validity_days` 60, `loyalty_idle_reset_days` 90), mirroring `messaging_provider_config`'s shape (0050): RLS with Super-Admin SELECT/UPDATE only, `log_audit_event`-audited writes, readable by definer functions; no gym-facing UI in V1.6

**Given** `payments.purpose` is CHECK-limited to `subscription`/`registration_fee` (0099)
**When** migration 0107 ships
**Then** in this one migration (AD-27): the CHECK admits `session`; `protect_payment_purpose_and_void` still pins it; the staff-insert policy clause is unchanged (session payments are created only by definer RPCs, never by direct insert); the payments notification trigger (0099:113) skips `session` rows like fee rows; and a pgTAP test asserts a direct client insert with `purpose = 'session'` is rejected

**Given** the gate keys on plan type and price (FR-173)
**When** this story ships
**Then** `plans.plan_type` and `plans.price` can no longer be changed by direct UPDATE (pinned; the existing `manager_or_owner_update_own_plans` policy keeps working for the other columns); `update_plan_pricing(p_plan_id, p_plan_type, p_price)` is a definer RPC that refuses a type change once any subscription references the plan (error code for "create a new plan instead"), audits every type or price change with old and new value, and never touches existing `guest_sessions` rows

**Given** the dashboard plan form currently writes `plan_type`/`price` directly
**When** this story ships
**Then** the plan-edit Server Action calls `update_plan_pricing` for those two fields; a plan with subscriptions shows its type as read-only with a lock icon and the reason "This plan has members, so its type can't be changed. Create a new plan instead." / "Cette formule a des membres : son type ne peut pas être modifié. Créez plutôt une nouvelle formule." (`aria-readonly`, reason linked by `aria-describedby`; a refused stale change shows the same copy inline on the field; UX-DR28)

**Given** the Plans page (AD-23, shipped) and a Pay-per-session plan
**When** the plan form and list render
**Then** the price label reads "Price per session (XAF) *" / "Prix par séance (XAF) *", the list row reads "XAF 2,000 / session" / "XAF 2 000 / séance" instead of "/ monthly", editing the price of a plan that has subscriptions shows "Changing the price doesn't affect sessions already paid." / "Modifier le prix ne change pas les séances déjà payées.", and a price of 0 shows "At 0 XAF, members on this plan never need a paid session." / "À 0 XAF, les membres de cette formule n'ont jamais besoin de séance payée." (UX-DR28)

**Given** FR-156 asks for a one-tap "Session guest" reason
**When** an Owner, Supervisor, or Manager waives a registration fee (`waive_registration_fee`, 0099:241)
**Then** the waive dialog offers a "Session guest" / "Invité à la séance" preset chip above the Reason field that fills the mandatory reason (meeting its 10-character minimum); free text remains available; no automatic waiver exists (UX, AD-05)

---

### Story 19.4: Desk Session Payment

As a receptionist,
I want to record a guest's session payment at the desk in one step, at exactly the plan's price,
So that the guest can scan in straight away and the money is traceable to me.

*Delivers FR-158 (desk path). Migration 0108.*

**Acceptance Criteria:**

**Given** a member at a gym with charging on whose current plan is Pay-per-session with price > 0
**When** staff call `record_session_payment(p_member_id, p_method, p_reason default null)`
**Then** in one transaction it: takes the locks in the canonical order (AD-27: payment rows first via the stale-expiry check, then the member row `FOR NO KEY UPDATE`); inserts a `payments` row with `purpose = 'session'`, `status = 'verified'`, `amount` read server-side from the member's current plan price (never a parameter), `currency` from the plan, `actor_id` the caller; inserts one `guest_sessions` row linked to it with `usable_until = now() + interval '7 days'` (the 7-day value read from a platform config row, not a literal); writes an audit row; and returns the session

**Given** method rules follow FR-021/FR-033
**When** the method is cash or manual mobile money
**Then** any role that can record payments may call it; **when** the method is bank transfer, only Manager, Supervisor, or Owner may; a Coach or Member is refused; roles are checked with `private.current_member_role()`

**Given** a session payment is fixed-price (amends FR-038)
**When** the RPC runs
**Then** no amount is accepted from the client and the reason (the panel's "Note") is optional and capped at 200 characters server-side, matching the waive-reason cap (UX-DR23); actor, member, method, and timestamp are still recorded

**Given** a Tara session payment for the same member is `pending`/`processing` and not stale
**When** staff call `record_session_payment`
**Then** it is refused with a "payment already in progress" error code (AD-9 `{ code, message }`), and no row is written

**Given** the gym's flag is off, or the member's current plan is not Pay-per-session, or its price is 0
**When** staff call the RPC
**Then** it is refused with a distinct error code each — no session is sold that the gate would never consume

**Given** the member is deactivated, awaiting the registration fee (FR-148), or the gym is suspended
**When** staff call the RPC
**Then** it is refused, mirroring `record_registration_fee`'s (0099:127) guards

**Given** two staff record a payment for the same member at the same moment
**When** both calls run
**Then** both succeed and the member holds two sessions (a desk double-entry is a staff error made visible in FR-163, not prevented); a pgTAP concurrency test proves no deadlock under the canonical lock order

**Given** session payments are listed on the Payments page and the member's history
**When** the dashboard renders a `session` payment
**Then** it is labelled as a session payment (not a renewal, not a fee) in EN/FR, and its receipt (FR-041) says so

---

### Story 19.5: In-App Tara Money Session Payment

As a session guest,
I want to pay for my session from the app with mobile money,
So that I don't have to queue at the desk.

*Delivers FR-158 (Tara path). Migration 0109. Uses `payment-webhook`'s existing dispatch — no new Edge Function (OQ-A).*

**Acceptance Criteria:**

**Given** a member whose gym has charging on, Tara Money connected (FR-127), and whose current plan is Pay-per-session with price > 0
**When** the member calls `initiate_session_payment()`
**Then** it follows `initiate_registration_fee_payment`'s shape (0100:106): runs the stale-expiry helper first (reused, not copied — generalized to take a purpose), locks the member, refuses if a session payment is already in flight, inserts a `pending` `purpose = 'session'` payment with the server-side plan price, and returns what the app needs to start the Tara flow

**Given** an abandoned `processing` session payment older than the stale window
**When** the member or staff starts a new one
**Then** the old row is flagged with `flagged_reason = 'expired_attempt'` and audited, and the new payment proceeds — the member is never wedged

**Given** `complete_verified_payment` (0100:217) dispatches on `purpose`
**When** a `session` payment is confirmed while still `processing`
**Then** it is verified and exactly one `guest_sessions` row is created in the same transaction (through the same `private.` session-creation function 19.4 uses), with `usable_until` 7 days from verification

**Given** `complete_verified_payment` does not lock the member today on its subscription path (AD-27 adversarial finding)
**When** this story rewrites it
**Then** it takes the member lock (`FOR NO KEY UPDATE`) on **every** purpose branch — subscription, registration fee, session — after the payment lock, in the canonical order (payment → member → … ; AD-27), so Epic 20 (20.3) only adds its stamp call and never changes this function's locking; pgTAP proves a concurrent subscription confirmation and a desk action on the same member serialize without deadlock, and every existing payment test still passes

**Given** a confirmation arrives after the attempt was flagged as `expired_attempt` (late)
**When** `complete_verified_payment` processes it
**Then** — unlike a registration fee — the session **is** created, the payment's `flagged_reason` becomes `late_confirmation`, and a staff-visible audit entry is written (FR-158)

**Given** a session payment is flagged `wrong_account` or `reconciliation_mismatch` (FR-036, NFR-019)
**When** any path completes or retries it
**Then** no session is ever created, and it appears as a discrepancy to staff

**Given** the provider redelivers a confirmation
**When** the webhook processes it again
**Then** nothing new is created (`payment_webhook_events` idempotency, AD-17; unique `guest_sessions.payment_id`)

**Given** the member app's payment service already handles fee payments (`apps/mobile/src/services/payments.ts`)
**When** session payments are listed
**Then** the service exposes `isSession` alongside `isRegistrationFee`; the UI that starts a session payment ships in 19.11

---

### Story 19.6a: Front-Desk Alert `kind` Refactor (no behavior change)

As a gym owner whose front desk relies on today's expired/frozen/cancelled alerts,
I want the alert table made ready for a second kind of alert without any change to the alerts I get today,
So that the riskiest part of the check-in work is proven in production before anything new depends on it.

*Prerequisite for FR-160 (AD-31). Migration 0110. Split out of the check-in gate (party-mode review, 2026-10-11): this migration rewrites the live subscription-alert path for **every** gym, whatever its charging flag, so it ships alone and runs in production for at least a week before 19.6b deploys. The index swap and the `ON CONFLICT` rewrites land together in this one migration (AD-31).*

**Acceptance Criteria:**

**Given** `front_desk_alerts.status` is `subscription_status not null` with a three-value CHECK and a one-active index on `(member_id, status)` (0034)
**When** migration 0110 ships
**Then** in the same migration: a `kind text not null default 'subscription_status'` column is added (existing rows backfill to `subscription_status` in the same statement); `status` becomes nullable with the CHECK `(kind = 'subscription_status' and status in (…)) or (kind = 'session_required' and status is null)`; the one-active index is rebuilt over `(member_id, kind, coalesce(status::text, ''))`; **every** `on conflict (member_id, status)` clause (0034, 0068, three in 0090 — found by grep at build time, the count stated in the migration header) is rewritten to the new index; `front_desk_alerts_protect_columns` pins `kind`

**Given** no code in this story writes `kind = 'session_required'`
**When** any check-in, subscription change, or job runs after 0110
**Then** the alerts raised, their dedupe, their dismissal, and their Realtime payloads are identical to before (plus the `kind` field); every existing alert pgTAP test passes unchanged, and a new pgTAP test exercises each rewritten `ON CONFLICT` site

**Given** the index is rebuilt on a live table
**When** 0110 is planned
**Then** the 19.0 runbook entry states how the index is swapped (new index built before the old one is dropped, so the one-active guarantee never lapses), the expected lock time on production's row count, and the rollback (forward-fix migration restoring the old index and clauses, written and tested on the local DB before deploy)

**Given** the dashboard and mobile read alerts
**When** this ships
**Then** no client change is needed; any client query that selects `status` still gets a non-null value for every existing alert

---

### Story 19.6b: Check-In Gate, Blocked Attempts & Session-Required Alert

As a gym owner who charges guests per session,
I want every scanned guest visit to consume a paid session (or be refused and flagged to the desk),
So that a scanned guest visit is always a paid, recorded event.

*Delivers FR-159, FR-160, FR-161 (server side), NFR-021. Migration 0111. Builds on 19.6a's alert `kind` (in production for at least a week first). Flag-off gyms never enter any code this story adds.*

**Acceptance Criteria:**

**Given** a gym with `charge_guests_per_session = false`
**When** `check_in()` runs for any member of that gym
**Then** it reads the flag before calling any V1.6 function and, when off, takes no new lock, calls nothing new, and behaves exactly as before 0111 — this is the operational kill switch (turning charging off returns the gym to the pre-V1.6 path); a pgTAP test proves no `consume_guest_session` call and no `session_attempts` row for a flag-off gym

**Given** NFR-021 requires one database function for consumption
**When** migration 0111 ships
**Then** `private.consume_guest_session(p_member_id, p_gym_id, p_receipt_at)` exists and returns one of *covered*, *consumed*, *denied*, or *exempt*: it first returns *exempt* without locking if the gym's flag is off, the member's current plan is not Pay-per-session, or its price is 0 (re-checked here so every caller is safe, not only `check_in()`); only then locks the member row `FOR NO KEY UPDATE`; computes the gym-local day with `private.gym_local_day_bounds()` (0097); returns *covered* if a non-voided session is already consumed for that day; otherwise consumes the usable session that lapses soonest (paid before free on a tie), setting `consumed_at` and `covered_day`, and returns *consumed*; otherwise *denied*. It calls a `private.on_session_consumed()` hook that is a no-op in this epic (Epic 20 fills it)

**Given** `check_in()` (latest body 0090:412) returns `attendance_events` and signals a block with `null`
**When** this story ships
**Then** `check_in()` keeps the exact signature and return type; after its existing guards and before inserting the attendance event, it calls `consume_guest_session`; on *denied* it inserts a `session_attempts` row, raises the session-required alert, inserts **no** attendance event, and returns `null` — the same signal old builds already handle (they show their *expired* screen; decision 1)

**Given** an offline-synced scan carries `p_scanned_at` and `p_client_scan_id`
**When** `check_in()` evaluates it at a charging gym
**Then** the receipt time is `now()`; the scan time is used as the visit time only if it is within the gym's auto-timeout window (FR-045) of receipt and not before the consumed session's payment, otherwise the visit is treated as a new visit at receipt time; a replay with the same `client_scan_id` short-circuits as today and never consumes a second session

**Given** blocked attempts need their own evidence (AD-31)
**When** migration 0111 ships
**Then** `session_attempts` exists (`gym_id`, `member_id`, `scan_id`, `occurred_at`, `source` in `check_in`|`class`) with RLS (staff of the gym read; no client writes), and a unique index on `(gym_id, member_id, scan_id) where scan_id is not null`; an online scan without a client scan id records one attempt per call

**Given** the session-required alert (FR-160)
**When** `consume_guest_session` returns *denied*
**Then** the alert is inserted with `kind = 'session_required'`, `status` null, deduped by 19.6a's index (one active per member)

**Given** the alert must clear when the guest pays (FR-160)
**When** a session payment is recorded for the member (19.4's RPC or 19.5's completion)
**Then** the shared session-creation function dismisses the member's active `session_required` alert in the same transaction

**Given** `attendance_events` grants INSERT/UPDATE/DELETE to `authenticated` and `service_role` (0006) and `service_role` bypasses RLS
**When** migration 0111 ships
**Then** after a grep for existing direct writers (auto-timeout job, check-out paths, service-role scripts) — each either moved behind a definer function or listed as an accepted exception in the migration header — direct INSERT on `attendance_events` is revoked from both roles, so `check_in()` is the only insert path (AD-29)

**Given** NFR-021's concurrency rules
**When** pgTAP tests run
**Then** they prove: two concurrent check-ins for a member with one usable session → one *consumed*, one *covered*, never two consumptions and never a wrongful denial; a member never has two sessions consumed for one gym-local day; a session consumed at 23:50 gym time does not cover 00:10 the next day; a replayed sync consumes nothing; a gym with the flag off behaves exactly as before for every existing check-in test

**Given** the Realtime alert path (AD-20)
**When** a session-required alert is inserted
**Then** it arrives on the existing `gym:<gym_id>:alerts` channel with its `kind`; the dashboard UI for it ships in 19.9

---

### Story 19.7: Class Attendance Consumes a Session

As a receptionist marking class attendance,
I want marking a session guest attended to use their paid session exactly like a floor check-in,
So that a guest can't attend a class at a charging gym without paying, and doesn't pay twice for the same day.

*Delivers FR-174. Migration 0112.*

**Acceptance Criteria:**

**Given** `mark_class_attendance(p_booking_id)` (latest 0090:1272) returns `class_bookings` and sets `attended_at`
**When** this story ships
**Then** before setting `attended_at` it calls `private.consume_guest_session` (19.6b) under the canonical lock order (`class_sessions` → member → `guest_sessions`); on *covered*, *consumed*, or *exempt* it marks attendance as today; on *denied* it inserts a `session_attempts` row with `source = 'class'` and a server-generated scan id, raises the session-required alert, does not set `attended_at`, and returns a `{ code: 'session_required' }` error to the caller (AD-9)

**Given** a booking already has `attended_at` set
**When** it is marked again
**Then** the function is a no-op that consumes nothing (new `attended_at is null` guard)

**Given** one session covers the floor and classes for the gym-local day (FR-174)
**When** a guest checks in on the floor and then is marked attended at a class the same day (or the reverse), or attends two classes
**Then** only one session is consumed in total; pgTAP covers each order

**Given** booking and cancellation stay free (FR-105/FR-106)
**When** a guest books or cancels
**Then** `book_class_session()` and cancellation are unchanged and consume nothing

**Given** `class_bookings` grants direct writes to `authenticated`/`service_role` (0058)
**When** migration 0112 ships
**Then** direct UPDATE of `attended_at` is pinned or revoked so `mark_class_attendance` is the only path to set it (AD-29); the coach roster view (Story 17.4) therefore cannot mark a charging-gym guest attended without a session

**Given** a gym with `charge_guests_per_session = false`
**When** `mark_class_attendance` runs
**Then** it reads the flag first and, when off, calls no V1.6 function and takes no new lock (same kill switch as 19.6b); pgTAP proves it

**Given** Monthly, Coach-inclusive, and Class-only members
**When** they are marked attended
**Then** behavior is exactly as FR-107 (*exempt*)

**Given** the Classes page (AD-18) shows the attendance checkbox and the coach roster (AD-21) is read-only
**When** marking a Pay-per-session member returns `session_required`
**Then** the checkbox reverts and an inline `role="alert"` row message (`info` left border) reads "No paid session — attendance was not recorded. A front-desk alert has been raised." / "Aucune séance payée — la présence au cours n'a pas été enregistrée. Une alerte a été envoyée à l'accueil." with [Record session payment] / [Enregistrer le paiement de la séance] opening the Record Session Payment Panel in place (19.4's RPC); on success the message becomes "Session recorded — mark attendance again." / "Séance enregistrée — marquez à nouveau la présence." and focus returns to that member's checkbox; the system never auto-marks; the checkbox stays enabled for a guest beforehand (UX-DR29)

**Given** the Classes page shows FR class-occurrence strings
**When** this story ships
**Then** "Prochaine séance" becomes "Prochain cours" and "Aucune séance à venir" becomes "Aucun cours à venir", so "séance" means only a paid or free day-visit on screens this epic touches; AD-15 "Notes de séance" is unchanged (UX-DR30)

---

### Story 19.8: Session Refunds & Revenue Line

As a gym owner,
I want refunds of session payments to behave predictably and session revenue to show on its own line,
So that I can correct mistakes without corrupting attendance and see what guests bring in.

*Delivers FR-162 (refund rules, revenue line). Migration 0113. The stamp reversal is a no-op hook here, filled by Epic 20.*

**Acceptance Criteria:**

**Given** refunds are direct inserts into `refunds` (0033; `payment_id` unique, so one refund per payment) and 0101 already has a `private.block_fee_and_voided_refunds()` trigger
**When** a refund is inserted against a `purpose = 'session'` payment
**Then** an `AFTER INSERT` trigger on `refunds` (data layer, following 0101's precedent) applies FR-162 in the same transaction, taking the member lock first

**Given** the refund amount equals the payment amount and the linked session is unconsumed and not voided
**When** the refund is recorded
**Then** the session's `voided_at` is set and it can no longer be consumed

**Given** a refund races a consumption of the same session
**When** both run concurrently
**Then** exactly one outcome holds — either the session is voided and the check-in is denied/covered by another session, or the session is consumed and the refund is recorded as a refund of a consumed session; a pgTAP concurrency test proves it

**Given** a partial refund
**When** it is recorded
**Then** the session is not voided

**Given** the linked session was already consumed
**When** a refund is recorded
**Then** the session stays consumed, the visit stays counted, and `private.on_session_refunded_after_consumption()` is called — a no-op in this epic, filled by Epic 20 to reverse the stamp

**Given** every session payment, consumption, attempt, and refund must be traceable (amends FR-080)
**When** any of them happens
**Then** an audit row records actor, member, and timestamp; pgTAP asserts one per event type

**Given** `gym_revenue_mtd()` (0101:195) and `gym_registration_fee_revenue_mtd()` (0101:230)
**When** migration 0113 ships
**Then** subscription revenue excludes `session` payments, and `gym_session_revenue_mtd()` returns net session revenue (verified session payments minus their refunds) for the gym-local month (`private.gym_local_month_bounds`, 0095:87); the Overview shows it as its own sub-line under Revenue this month, "Guest sessions: XAF N" / "Séances des invités : N XAF" (UX-DR25) — in addition to the subscription headline, not "of which", and separate from the fee sub-line; it shows when charging is on or session revenue this month is > 0, and hides (headline still renders) if its read fails; refunding a renewal is unaffected

---

### Story 19.9: Dashboard — Charge-Guests Setting, Session Alert, Member Sessions & Plan Lock

As an Owner, Supervisor, or receptionist,
I want to switch charging on knowing who it affects, see and act on session-required alerts, and see a member's sessions,
So that the desk can run per-session charging day to day.

*Delivers FR-157 (UI), FR-160 (UI), the staff half of FR-159's lapse visibility. No migration.*

**Acceptance Criteria:**

**Given** the Settings page (Owner/Supervisor)
**When** it renders
**Then** a "Charge guests per session" / "Faire payer les invités à la séance" toggle shows the current value and does not flip until a dialog is confirmed; Managers and below do not see the control (absent from the DOM)

**Given** an Owner or Supervisor toggles charging on
**When** the confirmation opens (UX-DR27)
**Then** it states the `guest_charging_impact()` count with the fixed plural-aware template ("[N] Pay-per-session members will need a paid session at their next visit"; "1 … member will need …"; zero: "No members are on a Pay-per-session plan yet."), the scope line ("This applies from now on. Past visits and anyone already checked in are not affected."), **and** the old-app-version warning in a `warning` box (decision 1); the buttons are [Cancel] and [Start charging] / [Activer la facturation] (never "Confirm"); Escape is disabled; focus lands on [Cancel]; [Start charging] is disabled until the count has loaded, and a count failure shows "Couldn't count affected members." with [Retry]; confirming calls `set_guest_charging` and toasts "Guests now pay per session."; a server refusal shows "Couldn't change this setting. Try again." and the toggle keeps its stored value

**Given** an Owner or Supervisor toggles charging off
**When** the confirmation opens
**Then** it is titled "Stop charging guests per session?", explains that Pay-per-session members check in without a paid session, that sessions already paid are kept but not used while charging is off and still lapse 7 days after payment (the 7 read from config), adds "Guests stop earning loyalty stamps." when loyalty is on, and has [Cancel] / [Stop charging] / [Arrêter la facturation]; the success toast is "Guests no longer pay per session."

**Given** the Settings page has other sections that save via [Save Settings]
**When** this story ships
**Then** Charge guests per session writes only through its own setter, is excluded from the [Save Settings] payload, and the page hint gains "…except Registration fee, Charge guests per session, Loyalty program and Category, which save on their own." / its FR equivalent, so a general save can neither revert nor be blocked by it (UX-DR27)

**Given** charging is off
**When** the Loyalty section exists later (Epic 20)
**Then** this story only leaves a hook — no loyalty copy here (the turn-off dialog's loyalty clause renders only when loyalty is on)

**Given** a `session_required` alert arrives on the alerts channel
**When** the front-desk alert panel renders it
**Then** it is a new variant of the single `FrontDeskAlertPanel` (UX-DR2, no fork; UX-DR22): `info` status dot and header "SESSION REQUIRED" / "SÉANCE REQUISE", body "[Name] · No paid session · [time]" with "Record a payment so they can scan again.", "From class: [name]" for a class-marking refusal, "Scanned offline at [time]" for a late-synced attempt, a "Mobile money payment in progress" line while a Tara session payment is pending, and [Record session payment] (no [Renew]); `aria-live="assertive"`; one active alert per member; on success the alert dismisses (server-side, 19.6b) and the panel updates; existing subscription alerts are unaffected because every alert query and the panel branch on `kind`

**Given** [Record session payment] is chosen from the alert, the member modal header, or an AD-18 refusal row
**When** the Record Session Payment Panel opens (UX-DR23)
**Then** it shows the fixed read-only Amount ("plan price — fixed"), Method (Cash default and Manual Mobile Money for any recording role; Bank Transfer present only for Manager/Supervisor/Owner and absent from the DOM for a Receptionist), an optional Note ≤200 chars, and Recorded by; confirming calls `record_session_payment`; success toasts "Session recorded for [Name]. Ask them to scan again."; each server refusal code from 19.4 renders its own inline message in EN/FR (payment in progress, charging off, not Pay-per-session, price 0, deactivated, awaiting registration fee, gym suspended, network; a stale bank-transfer attempt reuses the global permission copy) and leaves the panel open; it is a sibling of `InlineRenewalPanel` (inline, 320px drawer at 768–1023px, an expanding section inside the AD-04 modal), with tab order Method → Note → Record → Cancel and focus returned to the trigger

**Given** the Realtime channel drops
**When** the dashboard falls back to polling (AD-20)
**Then** session alerts are included in the polled result

**Given** member detail ships as the View mode of `MemberModal.tsx` opened from AD-03, not a `/members/:id` page (UX-DR24)
**When** the member is on a Pay-per-session plan at a charging gym, or holds session rows
**Then** the modal gains a Sessions section: Unused (source Paid with time, method and recorded-by / Free with earned date, and lapse date, soonest first), Used (date and covered day), muted "Lapsed [date]" and "Voided by refund [date]" rows for the last 90 days, a link to AD-09 filtered to this member and Purpose: Session, and the empty state "No sessions yet."; Coaches see nothing new (neither section renders in AD-15)

**Given** the member modal header
**When** the member is on Pay-per-session with price > 0 at a charging gym and the viewer can record payments (Receptionist+)
**Then** a [Record session payment] action opens the Record Session Payment Panel as an expanding section; in every other case the action is absent from the DOM; AD-10 gets no Session purpose

**Given** a Receptionist+ opens AD-10's member search and selects a Pay-per-session member at a charging gym
**When** the member is chosen
**Then** a hint reads "To sell a session, use Record session payment on the member's page." / "Pour vendre une séance, utilisez Enregistrer le paiement de la séance sur la fiche du membre." so a session is never recorded as a free-amount payment

**Given** the Payments page (AD-09)
**When** session payments exist
**Then** a Purpose filter and column (All / Renewal / Registration fee / Session, EN/FR; carried in the CSV export) distinguish them from renewals and registration fees; desk session payments appear directly in All Payments as `verified` with the recording staff member as Actor and never in the Verification Queue; a late-confirmed session payment shows Verified plus "Confirmed late"; a wrong-account or mismatch session payment stays a discrepancy row with no linked session (UX-DR28)

**Given** a Receptionist+ picks a `session` payment in the Record Refund modal
**When** the amount is entered
**Then** an `info`-bordered notice updates live: full amount on an unused session ("…the unused session will be cancelled and can't be used"), partial ("…keeps the session and can still use it"), already used ("The visit stays counted", plus "The loyalty stamp it earned is removed; a free session already earned is kept." only when loyalty is on); a renewal payment with loyalty on shows "Loyalty stamps and free days from this renewal are not removed."; the success toast names the outcome the server actually resolved ("The session was cancelled." / "The session had already been used."), so a race with a consumption is never hidden (UX-DR28, AD-28)

**Given** the Subscriptions page (AD-08)
**When** it renders each member's Last Payment
**Then** `session` payments are ignored, because a session is never a renewal (AD-27)
*As built: vacuous. The Subscriptions page has no Last Payment column, so no code was needed (19.9c, `docs/decisions.md`).*

**Given** the Audit Log page (AD-12) lists the V1.6 events
**When** a V1.6 audit row renders
**Then** it shows the EN/FR action label from UX-DR31's list (short, past tense, sentence case, following the shipped `audit.actionTypes` style), the settings changes show "old → new" in Details, and rule-driven events show Actor "System" when no staff member acted; the exact event-code-to-label mapping is settled here for the events Epic 19 emits and in Epic 20/21 for theirs

**Given** this story's surface (Settings sections, alert, panel, member modal, Payments, Subscriptions, audit labels) is larger than any other dashboard story in the epic
**When** it is created for development
**Then** it may be split at create-story time into a Settings + Plans half and an alert + panel + member modal + Payments half; if split, 19.12's dependency list and the sprint-status keys follow (no behavior change)

**Given** every new string
**When** the PR is opened
**Then** `en.json` and `fr.json` carry every key and `check:i18n` passes

---

### Story 19.10: Guest Sessions Overview Card

As an Owner, Supervisor, or Manager,
I want a Guest sessions card showing paid sessions, blocked attempts, and free sessions given,
So that I can see whether the desk is collecting.

*Delivers FR-163. Migration 0114 (read RPCs only).*

**Acceptance Criteria:**

**Given** the gym has charging on
**When** the staff Overview (FR-143) renders for Owner, Supervisor, or Manager
**Then** a "Guest sessions" / "Séances des invités" card appears as its own full-width row below the Overview's second card row, in its own Suspense boundary (UX-DR25), with a "Today / This month" `radiogroup` (gym-local via `private.gym_local_day_bounds` / `private.gym_local_month_bounds`; default Today; remembered per user in `localStorage` as a convenience only) and three `statNumeral` figures — Paid sessions, Blocked attempts (with "[N] members"), Free sessions given; with charging off it is absent from the DOM; zero renders "0"; a failed load shows "Couldn't load guest sessions." with [Retry] inside the card without affecting other cards; figures sit side by side at ≥768px and stack below it

**Given** counts must be server-side (FR-143 `max_rows` caveat)
**When** the card loads
**Then** `guest_sessions_summary(p_period)` returns: paid sessions sold (non-voided session payments), blocked attempts (rows in `session_attempts`, counted once per scan id) and distinct members blocked, and free sessions given (always 0 until Epic 20); computed by aggregate SQL, never by summing fetched rows

**Given** each figure links to the new AD-22 page `/guest-sessions?tab=paid|blocked|free&period=today|month` (UX-DR26; reached only from the card, no sidebar item)
**When** a user opens the Paid tab
**Then** it lists Member, Time, Method, Recorded by, Used (covered day or "—") and Refund ("Refunded", "Refunded after use" or "—"), can be grouped by the staff member who recorded each payment (default, or "None"; Tara payments group under "Tara Money (in app)"), and offers a "Refunded after use only" filter chip

**Given** the Blocked attempts tab
**When** it renders
**Then** it lists Member, Time, and Source ("Check-in" or "Class: [name]") under a "[N] attempts · [M] members" header, noting "(synced [time])" for attempts that arrived offline; there is no "paid later" or walk-away column (FR-163 does not ask for one)

**Given** the Free given tab
**When** it renders
**Then** it lists Member, Earned, Use by, and Status (Unused / Used [date] / Lapsed), showing its empty state until Epic 20 ships or loyalty was never enabled

**Given** AD-22 pages
**When** they load
**Then** lists are paged at 50 rows, counts match the card for the same period and come from server-side aggregates, a member name opens the AD-04 modal, the period is carried in the URL, each tab has its own empty-state copy, 6 skeleton rows load, and a page-level error offers [Refresh]

**Given** a Receptionist or Coach
**When** they open the Overview, or a Receptionist types the AD-22 URL
**Then** the card is not rendered, the RPCs refuse them, and the page shows the global "You don't have permission to do that." state

**Given** every new string
**When** the PR is opened
**Then** EN/FR parity passes

---

### Story 19.11: Member App — Pay for Your Session, Offline Verification & Session Lapse

As a session guest,
I want the app to tell me plainly when I need to pay, let me pay there, and be honest when an offline check-in still has to be verified,
So that I'm never confused at the door.

*Delivers FR-159 (app states), FR-161 (app side), FR-158 (in-app UI). No migration. Ships in one mobile release; must be in the stores before 19.12.*

**Acceptance Criteria:**

**Given** `checkin.ts` maps a `null` `check_in()` result to `expired` (line ~96)
**When** the gym has charging on and the member's current plan is Pay-per-session
**Then** a `null` result is resolved to a new `session_required` outcome by reading the member's latest `session_attempts` row (or an equivalent narrow read); otherwise it stays `expired`; the RPC's return type is not changed

**Given** the `session_required` outcome
**When** the check-in result screen renders
**Then** it is a distinct designed full-screen `info` overlay (UX-DR8 pattern, UX-DR17/UX-DR18) with the `confirmation_number` icon, titled "Pay for your session" / "Payez votre séance", body "You need a paid session to check in today. [price] covers the whole day.", requiring a tap and firing the notification-error haptic; [Pay now] opens MA-17 (below) only where the gym has Tara Money connected, with [See the front desk] secondary; otherwise [See the front desk] is primary and closes to Home; it is never the red expired state; older app builds keep showing their expired overlay (decision 1) — the EN "See the front desk" string is a new key and FR reuses "Voir l'accueil"

**Given** MA-17 Pay for Session (`/pay-session`, UX-DR21), entered from the overlay's [Pay now] or Home's [Pay for a session]
**When** it renders
**Then** it shows the plan name, the price as display-only, "Covers the whole day." and the 7-day lapse caption (7 from config), and a "Paying with" payer phone defaulting to the member's number; [Pay [price]] calls 19.5's `initiate_session_payment` (the amount is never sent); phases idle → sending → pending → stillWaiting at 45 s → verified/flagged reuse the shipped `renew.*` keys, with "Session paid" / "Scan the QR code to check in." and [Scan now] replacing the route with MA-10; the error table covers payment already pending, Tara unavailable ("See the front desk to pay with cash"), charging turned off, plan changed or price 0 (each with [Back]), invalid payer phone, and other; offline disables the button; haptics are success on verified and error on failed; a late confirmation still shows the session on Home at next render with no notification

**Given** a Pay-per-session member with price > 0 at a charging gym
**When** Home renders
**Then** the status card shows the sessions line instead of expiry — "Today covered" (`success`), "[N] paid session(s) · use by [date]" (`neutral`, soonest lapse, plural-aware, " + [M] free" appended when held), or "No paid session — pay before you scan." (`info`) — and a [Pay for a session] quick action appears first only when there is no usable session and Tara is connected; "Check In" keeps its label; exempt members see Home as shipped (UX-DR19); the count lives on Home only, not also on the MA-10 scanning screen

**Given** an offline scan at a charging gym for a Pay-per-session member
**When** it is queued
**Then** the app shows "Check-in saved — your session will be verified" / "Enregistrement sauvegardé — votre séance sera vérifiée" (final wording, settles FR-161's deferral) as an `info` overlay with the `hourglass_top` icon, a warning haptic, and a required tap, instead of the plain offline success state, and the Home banner reads "Offline check-in waiting to be verified…" / "Enregistrement hors ligne en attente de vérification…"; on sync, a denial is surfaced on the next Home render as a dismissible `info` notice above the status card — "Your check-in on [date] at [time] wasn't counted — you had no paid session. See the front desk if this is wrong." with [Got it], several denials collapsing into one naming the latest with "+[N] more", and no Pay action — never silently; a verified offline scan shows no notice (UX-DR18, UX-DR19)

**Given** the app may hold a stale copy of the gym's charging flag
**When** the app is online (launch, foreground, check-in screen focus)
**Then** it refreshes the flag; the server's rule at sync time governs regardless

**Given** a guest holds unused paid sessions
**When** Home renders (the check-in screen does not repeat it, so two numbers cannot drift)
**Then** it shows the count and the soonest lapse date (FR-159), in the member's language, on the status card's sessions line and as Session Chip rows in the Rewards card when that card renders

**Given** the payment history
**When** it lists a session payment
**Then** it is labelled "Session" / "Séance" (not a renewal, beside the shipped "Registration fee" label) with the same Verified / Pending / Failed badges (a flagged session payment shows Failed, because it bought no session), and its receipt reads "For: Session — [plan name]" with "Session use by: [date]" while unused or "Used on: [covered day]" once consumed; free sessions never appear as payments, and a session payment row in Home's recent activity reads "Session payment: [amount]" (UX-DR19, MA-11, MA-14)

**Given** the Check-in result and MA-17 flows
**When** the epic's QA runs
**Then** accessibility holds per UX-DR32: result overlays use the `alert` role and carry colour, title and icon; each MA-17 phase change is announced through a polite live region

**Given** a mobile change costs a build and store cycle
**When** this story is planned
**Then** it ships in one release, and the product owner's on-device QA covers: refused → pay in app → scan again; refused → desk pays → scan again; offline scan then sync with and without a session; a second scan the same day costs nothing

---

### Story 19.12: V1.6 Session Guests Enablement

As the product owner,
I want new gyms to start with per-session charging on — and only after everything it depends on is live,
So that FR-157's "on by default for new gyms" lands without surprising any existing gym.

*Migration 0115. Ships last.*

**Acceptance Criteria:**

**Given** 19.0's runbook is signed off, 19.9 and 19.10 are deployed, and the 19.11 mobile build is live in both stores
**When** migration 0115 ships
**Then** it runs only `alter table gyms alter column charge_guests_per_session set default true` — existing rows are untouched, so every gym that existed before stays off (FR-157), and a trailing `do $verify$` block asserts no pre-existing gym's value changed

**Given** gyms created after the migration
**When** Super Admin creates one
**Then** it starts with charging on; a pgTAP test asserts it

**Given** the release
**When** it is complete
**Then** `docs/decisions.md` records the date V1.6 session charging became available and the decisions it rests on (2026-10-11 decisions 1–4)

---

### Epic 20 — Stories

| # | Story | Migration | Depends on |
|---|---|---|---|
| 20.1 | Loyalty Program Setting & Ledger Foundation | **0117** | Epic 19 (19.3) |
| 20.2 | Guest Rule — Stamps on Paid Sessions, Free Session at N | **0118** | 20.1, 19.6b |
| 20.3 | Subscriber Rule — On-Time Renewal Stamps, R Free Days at K | **0119** | 20.1 |
| 20.4 | Refund Reversal, Lapses & 90-Day Reset Sweep | **0120** | 20.2, 20.3, 19.8 |
| 20.5 | Dashboard — Loyalty Settings & Member Loyalty View | none | 20.1–20.4 |
| 20.6 | Member App — Loyalty Card | none | 20.1–20.4 |

*Migration numbers follow Epic 19's (latest planned `0115`); renumber at build time if needed. **As built (2026-10-12): Epic 19 also shipped ad hoc `0116` (session-required alert cooldown), so every migration number in Epics 20 and 21 shifts by one: 20.1 is 0117, 20.2 is 0118, 20.3 is 0119, 20.4 is 0120, 21.1 is 0121 (then 0122, then 0123 once Stories 20.7 and 20.8 took 0121 and 0122 on 2026-10-15).** The story tables and bodies below were renumbered to the as-built numbers on 2026-10-15 (Epic 20 retro S-1). As built, 20.4 (0120) also wraps the loyalty hooks so a hook failure rolls back only the hook, writes a `loyalty_hook_failed` audit row and a `job_runs` failure row, and never rolls back the payment, check-in or refund (retro S-2).

**Dependency order:** 20.1 → {20.2, 20.3} in parallel → 20.4 → {20.5, 20.6}. **Production safety:** the program is off by default for every gym (FR-164) and only 20.5 exposes the switch, so 20.1–20.4 change nothing a live gym sees. 20.2's guest rule earns only while **both** the program and Charge-guests are on (FR-165).

**Scope boundary — what this epic does NOT do.**
- **No discounts.** Rewards are free sessions and free days only; nothing changes the amount sent to a payment provider (PRD §6.28, Section 8).
- **No manual balance edits** by any role, Super Admin included (FR-170), and no correction screen.
- **No reward push notification** (FR-169), and **no cross-gym loyalty** — progress is per member per gym.
- **No gym-configurable windows.** 60-day and 90-day values live in `platform_session_config` (19.3); exposing them to gyms is a later settings change.

### Story 20.1: Loyalty Program Setting & Ledger Foundation

As a gym Owner or Supervisor,
I want a loyalty program I can switch on with my own N, K, and R, backed by a tamper-proof ledger,
So that rewards are accounted for exactly once and nobody can edit a balance by hand.

*Delivers FR-164 (data + RPC), FR-170 (no write path), NFR-022 (ledger shape), the FR-168 read rule. Migration 0117.*

**Acceptance Criteria:**

**Given** `gyms` has no loyalty settings
**When** migration 0117 ships
**Then** `gyms` gains `loyalty_enabled boolean not null default false`, `loyalty_guest_threshold` (N, CHECK 2–50), `loyalty_renewal_threshold` (K, CHECK 3–24), `loyalty_reward_days` (R, CHECK 1–30), with N/K/R nullable only while never configured and required (CHECK) when enabled; every existing gym is off

**Given** each audited gym setting has exactly one write path (AD-32)
**When** this story ships
**Then** `set_loyalty_program(p_enabled, p_n, p_k, p_r)` is a `SECURITY DEFINER` RPC for Owner or Supervisor (via `private.current_member_role()`), suspension-aware, writing one audit row with old and new values; the four columns are pinned by **their own** BEFORE UPDATE trigger function (not a branch in `protect_super_admin_only_gym_columns()` and not 19.3's charging pin)

**Given** loyalty is an append-only ledger (AD-30)
**When** migration 0117 ships
**Then** `loyalty_events` exists (`gym_id`, `member_id`, `event_type` in `stamp_earned`|`reward_granted`|`reward_consumed`|`reset`|`lapse`|`stamp_reversed`, `counter` in `guest`|`subscriber`, `origin_id uuid`, `occurred_at`, details) with a unique index on `(origin_id, event_type)`; RLS: staff of the gym and the member on their own rows may SELECT; no INSERT/UPDATE/DELETE policy and no direct table write grant for any client role; UPDATE/DELETE revoked beneath the policy layer like `audit_log` (NFR-004)

**Given** progress is derived and per member per gym
**When** migration 0117 ships
**Then** `loyalty_progress` exists with one row per `(gym_id, member_id)` holding `guest_stamps`, `subscriber_stamps`, `guest_last_event_at`, `subscriber_last_event_at`, readable like `loyalty_events` and writable only by `private.` definer functions

**Given** `guest_sessions.loyalty_grant_id` has no FK yet (19.3)
**When** migration 0117 ships
**Then** it references the `loyalty_events` row (`event_type = 'reward_granted'`) that granted it

**Given** the app and dashboard must never show past-window progress as live (FR-168)
**When** `effective_loyalty(p_member_id)` is called by the member (own row) or staff of the gym
**Then** it returns guest and subscriber counts **with the idle window applied at read time** (90 days, or for subscribers the longer of 90 days and plan duration + grace period), the thresholds, unused free sessions with expiry, and unused paid sessions with lapse date; it is `STABLE` and never writes (OQ-B decision); it is the only source the app and dashboard use

**Given** cross-gym isolation (NFR-001)
**When** a member of two gyms reads loyalty
**Then** pgTAP proves each gym's staff and each session see only that gym's rows

---

### Story 20.2: Guest Rule — Stamps on Paid Sessions, Free Session at N

As a session guest,
I want each paid session I use to count toward a free one,
So that coming back regularly is rewarded.

*Delivers FR-165, FR-166, the guest half of FR-164's lowered-threshold rule. Migration 0118. Fills 19.6b's `private.on_session_consumed()` hook.*

**Acceptance Criteria:**

**Given** `consume_guest_session` (19.6b) calls `private.on_session_consumed(session_id)` inside its member lock
**When** the consumed session is a **paid** session and the gym has both `loyalty_enabled` and `charge_guests_per_session` on
**Then** in the same transaction one `stamp_earned` (`counter = guest`, `origin_id` = the session id) is inserted and `loyalty_progress.guest_stamps` increments — applying the idle reset first if the previous guest event is outside the window

**Given** a free session is consumed, or a check-in is *covered* by an already-consumed session, or either switch is off
**When** the hook runs
**Then** no stamp is earned; a consumed free session records `reward_consumed` instead

**Given** the guest counter reaches N (or is already at or above a lowered N)
**When** the stamp that reaches it is recorded
**Then** in the same transaction a `reward_granted` event is inserted, a `guest_sessions` row is created linked to it with `usable_until` = now + `free_session_validity_days` (60), and the guest counter returns to 0 — exactly one reward, even if the counter was above N

**Given** a free session exists
**When** the member checks in
**Then** it is consumed under FR-159's ordering (soonest-lapsing first; paid before free on a tie) and covers the gym-local day like a paid session

**Given** a member moves off Pay-per-session holding an unused free session
**When** they return to Pay-per-session before it lapses
**Then** it is usable again; while on another plan it has no effect

**Given** a replayed offline sync, a retried check-in, or a redelivered payment webhook
**When** any of them re-runs consumption
**Then** the `(origin_id, event_type)` unique index means no second stamp or reward is ever written (NFR-022); pgTAP proves each case

**Given** nothing is awarded retroactively (FR-165)
**When** the program is switched on
**Then** sessions consumed earlier earn nothing

**Given** 19.10's Guest sessions card counts free sessions given
**When** free sessions are granted
**Then** the card's figure reflects them (no change to 19.10's RPC needed beyond confirming it counts `loyalty_grant_id` rows)

---

### Story 20.3: Subscriber Rule — On-Time Renewal Stamps, R Free Days at K

As a subscriber,
I want renewing on time to count toward free days,
So that staying loyal pays off.

*Delivers FR-167, the subscriber half of FR-164's lowered-threshold rule, AD-18's R-day note. Migration 0119.*

**Acceptance Criteria:**

**Given** renewals are verified in several places
**When** this story starts
**Then** the developer enumerates every renewal-verification path by grep — at least `confirm_renewal` (latest 0090), `renew_subscription` (0090), `complete_verified_payment`'s subscription branch (0100:217), and the 0031 staff verification-queue path — and lists them in the migration header; each calls one shared `private.award_renewal_stamp(p_payment_id)` in the transaction that verifies the payment

**Given** a verified renewal payment for the member's **current** plan (Monthly, Coach-inclusive, or Class-only) at a gym with the program on
**When** `award_renewal_stamp` runs
**Then** it runs under the member lock in the canonical order (on `complete_verified_payment` that lock is already taken on every branch since 19.5, so this story does not change that function's locking), and earns one `stamp_earned` (`counter = subscriber`, `origin_id` = the payment id) only if the payment was verified no later than the end of the gym-local day after the previous subscription's `expiry_date`, evaluated at verification time

**Given** a payment-less override, a plan assignment or change, a staff back-dated renewal, a Pay-per-session plan, or a late renewal
**When** any of them happens
**Then** no stamp is earned and progress is not erased

**Given** a second renewal is verified before the first period has ended
**When** it is processed
**Then** it earns nothing — at most one subscriber stamp per subscription period

**Given** the subscriber counter reaches K (or is at or above a lowered K)
**When** the stamp that reaches it is recorded
**Then** in the same transaction a `reward_granted` event is inserted, the renewed subscription's `expiry_date` moves out by R days, the counter returns to 0, and no payment or amount is created or changed; the lifecycle job re-derives status from the new date on its next run (AD-18)

**Given** the R free days moved `expiry_date`
**When** the member's next renewal is judged on time or late
**Then** it is judged against the **extended** `expiry_date`: the free days also push the next on-time deadline back by R days. This is intended (user decision, party-mode review 2026-10-11); no "original expiry" column is added, and pgTAP covers a renewal that is late against the original date but on time against the extended one

**Given** a redelivered webhook or retried renewal
**When** it re-runs verification
**Then** no second stamp or extension is written (NFR-022); pgTAP covers each renewal path

**Given** a renewal payment is later refunded
**When** the refund is recorded
**Then** the stamp and any free days it earned are **not** reversed (FR-162)

---

### Story 20.4: Refund Reversal, Lapses & 90-Day Reset Sweep

As a gym owner,
I want loyalty to stay honest when a consumed session is refunded and when rewards or progress expire,
So that balances are always correct and every change is in the audit log.

*Delivers FR-162's stamp reversal, FR-166's lapse, FR-168's persisted reset (OQ-B), FR-159's paid-session lapse audit. Migration 0120.*

**Acceptance Criteria:**

**Given** 19.8 calls `private.on_session_refunded_after_consumption(session_id)` when a consumed session's payment is refunded
**When** that session had earned a guest stamp
**Then** in the same transaction a `stamp_reversed` event is inserted and `guest_stamps` decrements by one, never below 0; a free session already granted is not taken back; a consumed **free** session's refund path cannot occur (free sessions have no payment)

**Given** lapses and resets must be persisted and audited (OQ-B)
**When** migration 0120 ships
**Then** a daily `pg_cron` job (its own function and transaction, logging to `job_runs` under its own name, AD-19) records: a `lapse` event for each free session past 60 days and each unused paid session past 7 days (the session row itself is unchanged — `usable_until` already makes it unusable); and a `reset` event plus counter → 0 for each `loyalty_progress` counter outside its idle window; each one also written to the audit log

**Given** the job runs twice, or misses a day
**When** it next runs
**Then** it records each lapse and reset exactly once (unique `(origin_id, event_type)`), and reads stay correct in the meantime because `effective_loyalty` applies windows at read time

**Given** an earn and a sweep for the same member race
**When** both run
**Then** both take the member lock in the canonical order; pgTAP proves the result is the same as running them one after the other

**Given** the ledger must reconstruct balances (NFR-022)
**When** a pgTAP test replays a member's `loyalty_events` from zero
**Then** the result equals `loyalty_progress` and the member's unused free sessions

**Given** 19.0's runbook names how a failed job reaches a human
**When** this job fails
**Then** that mechanism fires for it too

---

### Story 20.5: Dashboard — Loyalty Settings & Member Loyalty View

As a gym Owner or Supervisor,
I want to switch loyalty on and see what it costs before I save, and my staff to see each member's progress,
So that I can run the program with my eyes open.

*Delivers FR-164 (UI), FR-169 (staff view). No migration.*

**Acceptance Criteria:**

**Given** the Settings page (Owner/Supervisor)
**When** the Loyalty section renders
**Then** it shows the on/off switch and N, K, R inputs with their ranges; as the user edits, a live `aria-live="polite"` readout (updated after a 300 ms typing pause, "≈" read as "about") shows the implied effective discount for each rule: guests "1 free session per [N] paid ≈ [x]%" with x = round(100/(N+1)); subscribers "[R] days per [K] renewals of a [D]-day plan ≈ [x]%" with x = round(100·R/(K·D+R)), one line per distinct duration D among the gym's active non-session plans, naming the plan, up to 3 lines, hidden when the gym has no subscription plans; an out-of-range input hides that readout rather than computing a nonsense percent (UX-DR27); the inputs are N 2–50, K 3–24, R 1–30 with range helper text, are disabled while the switch is off (keeping their last values; saving off stores only the switch), and are required only when switching on; the section has its own [Save loyalty program] / [Enregistrer le programme de fidélité], is excluded from [Save Settings], calls `set_loyalty_program`, and toasts "Loyalty program saved."; validation is submit-only per UX-DR11 with the field errors "Enter a whole number from 2 to 50" / "…3 to 24" / "…1 to 30" and a server-refusal summary "Couldn't save the loyalty program. Try again."

**Given** Charge guests per session is off
**When** the Loyalty section renders
**Then** an info line under the Guests rule reads "Guests earn nothing while Charge guests per session is off." / "Les invités ne gagnent rien tant que la facturation à la séance est désactivée." (FR-157/FR-165)

**Given** lowering N or K
**When** the owner is about to save
**Then** a note above the save button explains that members at or above the new threshold earn one reward at their next qualifying event; nothing is erased

**Given** the switch is turned off and not yet saved
**When** the section renders
**Then** an inline note (no dialog) reads "No new stamps are earned while the program is off. Free sessions already earned stay usable until they lapse."

**Given** the member detail modal (AD-04 View mode, UX-DR24)
**When** the gym's program is on (or the member holds unexpired rewards)
**Then** a Rewards section shows both counters, "Guest progress" and "Subscriber progress" ("3 / 5"), and free sessions with expiry (unused paid sessions with lapse date are shown once, in the Sessions section) — all from `effective_loyalty`; there is no edit control for any role, Super Admin included, not even a disabled one (FR-170); a muted line reads "Balances change only through the program's rules." / "Les soldes ne changent que selon les règles du programme."

**Given** every new string
**When** the PR is opened
**Then** EN/FR parity passes


*As built (2026-10-15):* the epic also carried two owner-requested UI changes not covered by the ACs above: the Settings page was rebalanced (Payments, Billing and Staff moved to the left column, so the right column keeps Localization, Membership, Loyalty, Attendance and Front desk alerts) and arrow text links (View all, Manage staff, back links) became outline buttons with lucide arrows in the dashboard and Super Admin. `SettingsForm.tsx` was later split into per-section files with no behavior change.
---

### Story 20.6: Member App — Loyalty Card

As a member,
I want to see how close I am to my next reward and what free sessions or days I have,
So that I know what I've earned.

*Delivers FR-169 (member view). No migration. Ships in one mobile release.*

**Acceptance Criteria:**

**Given** the member's gym has the program on, or the member holds an unexpired free session
**When** Home renders (placement settled: Home, below the quick actions and above Upcoming Classes; Profile has no change — UX-DR20)
**Then** a flat "Rewards" / "Récompenses" card (never `raised`; Home's one raised card is the status card) shows the Loyalty Progress component ("3 / 5" with segments, or a bar above 12) with caption "paid sessions toward your next free session" for a guest or "on-time renewals toward [R] free days" for a subscriber — only the counter that applies to the member's current plan — plus Session Chip rows for free sessions ("Free session — use by [date]"; a dormant one in `neutral` with "Usable when you're back on Pay-per-session") and unused paid sessions ("Paid session — use by [date]", soonest first), a footnote ("Progress resets after [90] days without a paid session." / "Renew on time to keep your progress."; windows read from config) — all from `effective_loyalty`, in the member's language; the progress block hides when the program is off, leaving only session rows; lapsed rows drop off silently

**Given** a free session was just granted
**When** the card first renders after the grant
**Then** a one-line headline above the rows reads "Free session earned — valid for [60] days" / "Séance gratuite gagnée — valable [60] jours", shown once per grant and tracked on the device (60 read from config), because no reward push exists

**Given** progress has passed its idle window but the sweep has not run yet
**When** the card renders
**Then** it shows the reset value (read-time window), never the stale count

**Given** the program is off and the member holds nothing
**When** Home renders
**Then** no loyalty card appears

**Given** a member of two gyms
**When** they switch gyms (AD-4)
**Then** the card shows only the active gym's progress

**Given** no reward push exists in V1.6
**When** a reward is granted
**Then** the member sees it the next time the card renders; no notification is sent

**Given** a subscriber reward of R free days was granted
**When** the card renders
**Then** it says both that R free days were added and the new renewal date — "[R] free days added — your new renewal date is [date]" / "[R] jours offerts ajoutés — votre nouvelle date de renouvellement est le [date]" — and stays until the next renewal, so the moved date does not look like an error

**Given** the Rewards card's accessibility (UX-DR32)
**When** a screen reader reads it
**Then** the stamp row is decorative and the progress block's label is the sentence ("3 of 5 paid sessions toward your next free session"); each Session Chip reads as one label with the date spoken in full ("Free session, use by 2 December")

**Given** a mobile change costs a build and store cycle
**When** this story is planned
**Then** it ships with any other pending mobile work, and on-device QA covers: progress after a paid session, free session appears at N and is used next visit, subscriber progress after an on-time renewal

---

### Epic 21 — Stories

| # | Story | Migration | Depends on |
|---|---|---|---|
| 21.1 | Gym Category — Column, Setter & Super Admin | **0123** | 19.1 |
| 21.2 | Settings — Gym Category Field (Owner/Supervisor) | none | 21.1 |

*Independent of Epics 19–20: 21.1 may ship before them, in which case it takes the next free migration number at merge time and later stories renumber, never the reverse. Migration numbers above assume Epic order.*

---

### Story 21.1: Gym Category — Column, Setter & Super Admin

As a Super Admin,
I want to choose a gym's category when I create it and change it later,
So that every gym is classified for V1.7's directory and landing pages.

*Delivers FR-171 (data, setter, Super Admin create/edit) and FR-172. Migration **0123**. Architecture: AD-32 (stable code, own setter, own pin trigger, Super Admin admitted), AD-3 (role via `private.current_member_role()` / Super Admin check, never the JWT `app_role`). Precedent: 0105 `gyms.country` and the `createGym` action in `apps/super-admin/app/(admin)/gyms/actions.ts`.*

**Acceptance Criteria:**

**Given** migration 0123
**When** it runs on a database with live gyms
**Then** `gyms.category text NOT NULL DEFAULT 'gym'` is added with a CHECK limiting it to the five stable codes `gym`, `pilates_studio`, `yoga_studio`, `fitness_center`, `other`, and every existing gym reads `gym` in the same statement (FR-171 release default)

**Given** the column exists
**When** an authenticated user runs a direct `UPDATE gyms SET category = …` (Owner, Supervisor, Manager, or any other role)
**Then** a dedicated BEFORE UPDATE pin trigger (`private.pin_gym_category()`, its own function, not a branch in `protect_super_admin_only_gym_columns()`) restores the old value unless the setter's own GUC is set, matching the 0098 `registration_fee` shape

**Given** `set_gym_category(p_gym_id uuid, p_category text)` (`SECURITY DEFINER`, `search_path` pinned)
**When** the caller is a Super Admin, or the Owner or Supervisor of that gym
**Then** the category is updated and one `audit_log` row is written with old and new code, actor, and gym; a call that does not change the value writes no audit row

**Given** the same setter
**When** the caller is a Manager, Coach, Front Desk, member, or staff of another gym, or `p_category` is not one of the five codes
**Then** it raises a typed error and nothing changes; the role check uses `private.current_member_role()` plus the Super Admin check, never `auth.jwt()->>'app_role'` (19.1 lint passes)

**Given** function privileges (AD-3 convention, 0104)
**When** the migration is applied
**Then** EXECUTE on `set_gym_category` is revoked from `public` and `anon` and granted to `authenticated` only, and the trigger function is not executable by any client role; the hosted-privilege check from 19.1 passes

**Given** `packages/types`
**When** this story lands
**Then** a `GYM_CATEGORIES` constant and `gymCategorySchema` (Zod enum of the five codes) exist, with EN/FR labels: Gym / Salle de sport, Pilates Studio / Studio Pilates, Yoga Studio / Studio Yoga, Fitness Center / Centre de fitness, Other / Autre (final wording, UX pass 2026-10-11); labels are never stored

**Given** the Super Admin Create Gym modal
**When** a Super Admin creates a gym
**Then** a required Category select (default Gym / Salle de sport) is shown, validated by `gymCategorySchema` client-side and re-checked server-side in `createGym` before the first write, and the inserted gym carries that code (FR-071, FR-010); the pin trigger is BEFORE UPDATE only, so the insert is not affected

**Given** the Super Admin gym detail page (`apps/super-admin/app/(admin)/gyms/[id]`, exists today)
**When** a Super Admin changes the category
**Then** a `Category: [label] [Change]` row under Owner turns into an inline select with [Save] / [Cancel], saving calls `set_gym_category` with no confirmation (descriptive and audited), the new label shows with the inline status "Category updated." / "Catégorie mise à jour." (as built: the gym detail page has no toast host), and a refusal shows the generic mapped error inline (setter refusals are plain messages, not typed codes); the gyms list shows a plain-text Category column after Gym Name in the admin's language (no chip, no filter — UX-DR31); Gym Detail does not show Charge guests per session or Loyalty state

**Given** "Autre / Other"
**When** it is chosen
**Then** no free-text field appears (FR-171, V1.6)

**Given** any category
**When** any screen, plan type, permission, or flow is used
**Then** behavior is identical to today and product wording stays "gym" (FR-172); a test asserts the setter touches only `category`

**Given** pgTAP / RLS tests
**When** CI runs
**Then** they cover: release default on existing rows, CHECK rejects an unknown code, direct UPDATE reverted for every client role, setter allowed for Super Admin/Owner/Supervisor and refused for the others, audit row content, no audit on a no-op

---

### Story 21.2: Settings — Gym Category Field (Owner/Supervisor)

As a gym owner or supervisor,
I want to see and change my gym's category on Settings,
So that it describes what my business actually is.

*Delivers FR-171 (Settings edit; amends FR-069). No migration.*

**Acceptance Criteria:**

**Given** an Owner or Supervisor on Settings
**When** the gym profile section renders
**Then** a "Category" / "Catégorie" select sits in the Branding block under Primary Colour, shows the current value's label in the user's language with the five options, and carries the helper "Describes your business. It doesn't change how GymOS works." / "Décrit votre activité. Cela ne change pas le fonctionnement de GymOS."

**Given** they choose another category
**When** the field renders
**Then** its own [Save category] / [Enregistrer la catégorie] is enabled only when the value changed (a no-op save is disabled); "Other" opens no free-text field

**Given** they save
**When** the save runs
**Then** it calls `set_gym_category` (not the generic gym update), toasts "Category saved." / "Catégorie enregistrée.", and the field reflects the stored value; a refusal shows "Couldn't save the category. Try again." inline and an unselected value "Select a category"

**Given** the shipped sidebar gives Settings to Owner and Supervisor only (UX pass 2026-10-11)
**When** a Manager would be a "Settings viewer"
**Then** that case does not occur and is not built — no read-only category variant exists; the control is absent from the DOM for any role that cannot open Settings

**Given** the existing Settings form schema (`gymSettingsSchema`)
**When** the page saves other fields
**Then** `category` is not part of that payload and unsaved category edits survive [Save Settings] (and vice versa), so a general save can never be silently reverted by the pin trigger (UX-DR27)

**Given** every new string
**When** the PR is opened
**Then** EN/FR parity passes

---

### Epic 22 — Stories

| # | Story | Migration | Depends on |
|---|---|---|---|
| 22.1 | Spike — Claims Hook `aal`, Factor-Enrollment Guard, Session Deletion, Cookie Behavior | none | none |
| 22.2 | Claim-Read Inventory & CI Check (Report Mode) | none (script + CI) | 22.1 |
| 22.3 | Live Authorization in the Database | next free at merge time | 22.2 |
| 22.4 | Live Authorization in Edge Functions & Service Paths | none | 22.3 |
| 22.5 | Super Admin Second-Factor Enrollment (Flag Off) | next free at merge time | 22.1 |
| 22.6 | Super Admin Bootstrap, Second Device & Recovery | none (script + runbook) | 22.5 |
| 22.7 | Session Limits & Step-Up | next free at merge time | 22.4, 22.6 |

*22.5 can run in parallel with 22.2–22.4 (two independent chains converging at 22.7). Migration numbers are assigned at merge time; earlier stories never renumber.*

*Production is live with real gyms: 22.3 and 22.4 change authorization on every existing path, so each ships behind the full `scripts/ci-local.sh` gate and the RLS/role matrix tests; 22.6 is the only story that can lock out the sole Super Admin and is run by the product owner, not by CI.*

---

### Story 22.1: Spike — Claims Hook `aal`, Factor-Enrollment Guard, Session Deletion, Cookie Behavior

As the product owner,
I want the open assumptions behind support access answered against the real auth provider before any code depends on them,
So that Epics 22–23 are built on verified behavior, not on guesses written into an architecture note.

*Delivers the Step 1 spike list in `ARCHITECTURE-SPINE.md` "Deferred" (AD-34, AD-38, AD-40, NFR-026). No product code. Output is a decision entry in `docs/decisions.md`, newest-first.*

**Acceptance Criteria:**

**Given** a test user with a verified TOTP factor on the local Supabase stack
**When** the user signs in, steps up to AAL2, and the custom access-token hook runs
**Then** the spike records whether the hook's event contains the session's `aal` (or `amr`) and how the claim reaches the token, with the exact field path, so AD-34's `[ASSUMPTION — hook receives aal]` is resolved yes or no

**Given** a session at AAL1 for a user who already has one verified factor
**When** the session calls the provider's enroll-factor endpoint directly (bypassing any app code)
**Then** the spike records whether a second factor is created; if it is, the decision entry states that **22.5 must add a database-level guard** and names the object to guard

**Given** a service-role function
**When** it deletes rows from `auth.sessions` for a given user
**Then** the spike records whether the user's next request is refused within one request (not at token expiry), and whether refresh tokens are also invalidated, so FR-192 and FR-184's "next request" can be built on it or on an alternative

**Given** hosted Supabase (staging project, not production)
**When** the spike checks the MFA factors-per-user cap and whether TOTP enrollment is enabled
**Then** the cap and the setting are recorded; production is **not** modified (TOTP is already enabled there per OQ-27, 2026-10-15)

**Given** the dashboard and super-admin apps
**When** the spike sets a `__Host-` prefixed auth cookie through the Supabase SSR helpers
**Then** the entry records whether the helpers preserve the prefix, `Secure`, `Path=/` and the absence of a `Domain` attribute, so NFR-026 is either confirmed or flagged as needing a separate domain

**Given** all spike items are answered
**When** the story closes
**Then** `docs/decisions.md` has one dated entry with a result per item and a "changes to later stories" list, and `ARCHITECTURE-SPINE.md`'s Deferred bullet is updated to point to it

---

### Story 22.2: Claim-Read Inventory & CI Check (Report Mode)

As a platform engineer,
I want a generated list of every policy, function and edge function that decides from the token's role or gym claim,
So that the live-authorization retrofit has a finite, checkable target and no new claim-only check can slip in.

*Delivers the inventory half of NFR-023. Extends the AD-3 CI grep gate and the 19.1 lint. Report mode only: the check publishes the list and fails only on **new** entries beyond the committed baseline.*

**Acceptance Criteria:**

**Given** the local database after all migrations
**When** the inventory script runs
**Then** it lists every RLS policy (`pg_policies`), every function and trigger body (`pg_proc`) that reads `auth.jwt()`, `app_role` or `gym_id` from the claim, and every edge function source file that reads them, each with kind, name, and a classification `claim-only`, `live-checked` or `exempt`

**Given** a policy or function that calls `private.current_member_role()` or `private.gym_id()` (the live helpers)
**When** it is classified
**Then** it is `live-checked`; one that reads the claim directly and has no live helper call is `claim-only`; an `exempt` entry requires a one-line reason in a committed allow-list (for example the claims hook itself)

**Given** the inventory output committed as `docs/` or `scripts/` baseline
**When** CI runs on a PR that adds a new `claim-only` entry
**Then** the check fails with the entry's name and file; the existing baseline entries do not fail it (report mode)

**Given** the baseline
**When** the story closes
**Then** the number of `claim-only` entries is recorded in the story's Dev Notes and in `sprint-status.yaml`, and each entry is tagged to the story that will close it (22.3 database, 22.4 edge)

**Given** the null-safety rule of NFR-023
**When** the script scans policy and function text
**Then** it also flags role checks written as a negated `= any(...)` or `<> any(...)` / `NOT IN` over a role that can be NULL, as a second list (`null-unsafe`), also tagged to 22.3

---

### Story 22.3: Live Authorization in the Database

As a gym Owner,
I want a deactivated or removed staff member to lose access on their very next request,
So that firing someone, or an account being compromised, takes effect immediately and not when their token expires.

*Delivers FR-192 (database half) and NFR-023. Amends FR-090. AD-3 (amended), AD-34 read gate. Migration at merge time. Closes every `claim-only` and `null-unsafe` database entry from 22.2.*

**Acceptance Criteria:**

**Given** `private.current_member_role()` and `private.gym_id()`
**When** they are evaluated for any role
**Then** they derive the result from the current `members` row (exists, not deactivated, gym not suspended per FR-132), never from the token claim alone; they remain `STABLE` and the dashboard Overview and check-in paths stay within the existing performance targets (page load < 2 s, scan → alert < 3 s)

**Given** a staff member whose account is deactivated, or whose role is changed, after their token was issued
**When** their next request reaches any policy or RPC
**Then** it is refused or sees the new role immediately, without waiting for token expiry; a test per role (receptionist, coach, manager, supervisor, owner) proves it for one read policy and one write RPC

**Given** a gym that becomes suspended
**When** any staff session of that gym makes its next request
**Then** it is denied the same as a deactivated account (FR-132), tested for a policy and an RPC

**Given** the `null-unsafe` list from 22.2
**When** each entry is rewritten
**Then** role checks use a null-safe form (explicit `IS NOT DISTINCT FROM` / `coalesce` to a deny value), and a test calls each with a NULL role and asserts denial

**Given** a payment insert
**When** the member's `gym_id` differs from the payment's `gym_id`
**Then** the insert is refused in the data layer (NFR-023), regardless of the caller's role

**Given** the `claim-only` database entries from 22.2
**When** this story closes
**Then** none remain in the database portion of the inventory, the baseline file is regenerated, and `scripts/ci-local.sh` plus the RLS cross-tenant matrix pass

**Given** the Super Admin and the claims hook
**When** this story ships
**Then** the Super Admin flow (cross-tenant, `is_super_admin`) and the hook behave exactly as before; AD-3's rule that `gym_id` stays claim-derived for non-support roles is preserved **plus** the live membership check

---

### Story 22.4: Live Authorization in Edge Functions & Service Paths

As a gym Owner,
I want every server-side path that touches money or secrets to check who is asking against current state,
So that no function running with a service-role key can be used after someone's access has been removed.

*Delivers FR-192 (edge/service half), NFR-023. AD-34 write path groundwork. Closes the `claim-only` edge entries. Edge Function count stays 3 (AD-OQ-A).*

**Acceptance Criteria:**

**Given** a shared module `authorize_action(actor, gym_id, capability)` used by edge functions and service-role server actions
**When** it is called
**Then** it takes the actor **explicitly** (service-role code carries no claims), loads the actor's current membership, role, deactivation state and the gym's suspension state from the database, and returns allow or a typed deny; it never trusts a role from the request body or token alone

**Given** each user-initiated edge function and service-role server action that moves money or reads secrets (payment initiation, credential handling, refund, staff creation, SaaS billing)
**When** it runs
**Then** it calls `authorize_action` before any write, and a deactivated, role-changed or wrong-gym actor receives a denied response with no side effect

**Given** `payment-webhook`
**When** a webhook arrives
**Then** its provider-signature authentication is unchanged and is **not** routed through `authorize_action` (it has no user actor); the inventory records it `exempt` with that reason

**Given** the full inventory
**When** the CI check runs in **enforcing** mode
**Then** it fails the build on any `claim-only` or `null-unsafe` entry not in the exempt allow-list, and the committed baseline contains zero non-exempt entries

**Given** an older mobile or dashboard build
**When** it calls a path that now denies
**Then** the response is the existing "you don't have permission" outcome (FR-003), not a network-style error

**Given** the story closes
**When** `scripts/ci-local.sh` and the Playwright baseline run
**Then** both pass, and Sentry receives one logged event per denied attempt (FR-003) without the actor's token or secrets

---

### Story 22.5: Super Admin Second-Factor Enrollment (Flag Off)

As a Super Admin,
I want an authenticator-app second factor available on my account,
So that the account that creates and assigns support people is protected by more than a password and a phone code.

*Delivers the enrollment half of FR-191. AD-38. Migration at merge time. The requirement is **off** after this story; 22.6 turns it on. Depends on the 22.1 result for the guard.*

**Acceptance Criteria:**

**Given** a platform setting `private.platform_flags('super_admin_aal2')` defaulting to **off**
**When** this story ships
**Then** every existing Super Admin session works exactly as before

**Given** a signed-in Super Admin
**When** they open the Super Admin app's security page and start enrollment
**Then** enrollment runs **only** through a server function that checks the session's `aal` first (a second factor requires `aal2`); the client's direct enroll call is not used, and the factor becomes `verified` only after a correct TOTP code

**Given** the 22.1 finding that a lower-level session can add a factor directly
**When** this story ships
**Then** a database-level guard (or provider setting) prevents a factor being added to a Super Admin from an AAL1 session, with a test that attempts it directly against the provider and fails; if 22.1 found it impossible, a test records that and no guard is added

**Given** `private.is_super_admin()`
**When** the flag is on and the session's `aal` is not `aal2`
**Then** it returns false (so every Super Admin policy and RPC denies); **when** the flag is off it behaves as today; both states are tested

**Given** an account with two verified factors
**When** either factor is removed
**Then** removal requires `aal2` and is audited with actor and timestamp; a Super Admin cannot be left with zero verified factors while the flag is on

**Given** every enrollment, verification and removal
**When** it happens
**Then** one `audit_log` row is written (actor, action, timestamp, never a secret)

---

### Story 22.6: Super Admin Bootstrap, Second Device & Recovery

As the product owner,
I want to turn the second-factor requirement on for Super Admin only after both factors are verified and a recovery path exists,
So that securing the platform cannot lock us out of it.

*Delivers the bootstrap and recovery halves of FR-191 and the pre-flight in PRD §10.2. AD-38. Run by the product owner; first on local and staging, then production. No new product surface.*

**Acceptance Criteria:**

**Given** the one-time script `scripts/enable-super-admin-aal2`
**When** it runs
**Then** it refuses unless the Super Admin account has **exactly two verified factors**, and prints each factor's friendly name and creation time for the operator to confirm they are on separate devices; it does not enable the flag otherwise

**Given** both factors verified
**When** the operator confirms
**Then** the script sets `super_admin_aal2` on in one transaction and writes an `audit_log` row with the operator identity; running it again is a no-op

**Given** the flag is on
**When** a Super Admin session at AAL1 hits any Super Admin route or RPC
**Then** it is denied and redirected to the second-factor prompt; enrollment of a **new** factor by an unverified session is refused (FR-191)

**Given** the runbook `docs/runbooks/super-admin-recovery.md`
**When** it is reviewed
**Then** it documents the out-of-band reset (the platform owner clears factors through a service-role script, itself audited), the preconditions, and what to do if both devices are lost, and states that dual control replaces it when a second Super Admin exists (PRD §8)

**Given** the local and staging environments
**When** the product owner follows the runbook to simulate losing a device
**Then** the Super Admin is able to sign back in, and the dry run's date and result are recorded in `docs/decisions.md`

**Given** support-account creation (Epic 23)
**When** the flag is off
**Then** creation is refused (AD-38); this story records that precondition in the Epic 23 pre-flight checklist

---

### Story 22.7: Session Limits & Step-Up

As a platform operator,
I want elevated sessions to expire on idle and long-lived, and sensitive actions to need a fresh code,
So that a stolen or forgotten signed-in session cannot move money or change access for hours.

*Delivers the session-limit and step-up half of FR-189. AD-40 (amends AD-34's gate). Applied to Super Admin now; Epic 23 applies the same objects to support. Migration at merge time. The 8 h / 15 min support values and Super Admin's 8 h / 30 min are `[ASSUMPTION]` — configured in one place.*

**Acceptance Criteria:**

**Given** `support_session_state(session_id, started_at, last_seen_at)`
**When** a session of a role that requires AAL2 (Super Admin when the flag is on) makes a request
**Then** the gate records `last_seen_at`; a session older than its maximum age or idle longer than its idle limit is denied on its next request, enforced by the application and not by a provider plan setting

**Given** `support_stepup(user_id, action, subject_id, expires_at, consumed_at)`
**When** a user answers a fresh TOTP challenge for a named action and subject
**Then** the server verifies it and records one step-up row valid for five minutes, **single-use and bound** to that action and subject; the step-up check does not read the `amr` claim and is keyed to the user, not the session

**Given** a protected action with a valid step-up
**When** it is performed
**Then** the row is consumed atomically; a second use, a different subject, a different action, or an expired row is refused

**Given** a factor reset, a lock, or a removal for a user
**When** it happens
**Then** that user's `support_session_state` rows are cleared and their `auth.sessions` removed (per the 22.1 deletion result), so the next request is denied

**Given** repeated wrong TOTP codes
**When** an application counter reaches the configured limit
**Then** the account is locked for Super Admin review (the lock is recorded and returned as a result so it commits, AD-34), and the attempt count is audited

**Given** the limit values
**When** they are changed
**Then** they live in one configuration location with the `[ASSUMPTION]` tag, and a test asserts the gate reads them from there

**Given** Super Admin session limits
**When** this story ships
**Then** the Super Admin app shows a re-sign-in prompt with a clear "session expired" message (no data loss on a form: unsaved drafts warn before expiry where the existing UX already warns)

---

### Epic 23 — Stories

| # | Story | Migration | Depends on |
|---|---|---|---|
| 23.0 | Pre-Flight Checklist (Product Owner) | none | 22.6 |
| 23.1 | `support` Role, Assignment Record & Live Gate | next free at merge time | 22.4, 22.7, 23.0 |
| 23.2 | Support Excluded From Counts, Caps, Notifications & Metrics | next free at merge time | 23.1 |
| 23.3 | "Allow GymOS Support" Switch & "GymOS Support" Row | next free at merge time | 23.1 |
| 23.4 | Create Support Account & Invite | next free at merge time | 23.1 |
| 23.5 | Assign, Unassign & Remove | next free at merge time | 23.3, 23.4 |
| 23.6 | Capability Allow-List & Denied-Set Matrix | next free at merge time | 23.5 |
| 23.7 | Hidden Identity — Per-Gym Proxy Actor | next free at merge time | 23.6 |
| 23.8 | Audit Under the Individual, Disclosure & Member-Facing Surfaces | next free at merge time | 23.7 |
| 23.9 | Support Connects the Payment Account | next free at merge time | 23.6, 23.7 |
| 23.10 | Revocation, Owner Visibility & Velocity Lock | next free at merge time | 23.7 |
| 23.11 | Lifecycle — Inactivity, Recertification & Factor Reset | next free at merge time | 23.5, 22.7 |

*Support is **denied by default** from 23.1 on: no existing policy lists `support`, so nothing is reachable until 23.6 opts capabilities in. Support is created with the Owner switch **off for existing gyms** (FR-183), so no live gym is affected until its Owner turns it on. AD-36 (Owner confirmation) was dropped 2026-10-15; 23.9 replaces it with a direct, step-up-gated, notified connection.*

---

### Story 23.0: Pre-Flight Checklist (Product Owner)

As the product owner,
I want the conditions for introducing GymOS Support confirmed before any support code reaches production,
So that existing Owners are told, the legal wording is settled and the platform account is secured first.

*Delivers PRD §10.2 "Pre-flight" and FR-183's notification obligation. No application code; a checklist recorded in `docs/decisions.md` and `sprint-status.yaml`, following Story 19.0.*

**Acceptance Criteria:**

**Given** story 22.6 is done (support-account creation is refused while `super_admin_aal2` is off, AD-38)
**When** the checklist is reviewed
**Then** it records that the Super Admin has two verified factors, `super_admin_aal2` is on in production, and the recovery runbook was exercised (date recorded)

**Given** OQ-30 (assignments suspended, not deleted, on opt-out) and OQ-31 (customer-terms wording and the 3-business-day disclosure answer)
**When** each is answered
**Then** the answer is recorded in the PRD's Open Questions table and in `docs/decisions.md`; an unanswered one blocks 23.3 and 23.8 respectively

**Given** existing gyms start with support **off** (FR-183)
**When** the release is prepared
**Then** the Owner notice text (EN/FR, in-app and the gym's usual channel) is written and approved, and its send date is recorded **before** the release date

**Given** the assumptions tagged for Step 1 (velocity limits, 60 s cutoff, 30-day inactivity, 30-minute cooling-off, 8 h / 15 min limits, 5-minute step-up)
**When** the checklist is closed
**Then** each value is confirmed or changed, and the confirmed values are written to the single configuration location created in 22.7

**Given** the deferrable items raised in planning (velocity lock, daily digest, quarterly recertification, inactivity sweep)
**When** the checklist is closed
**Then** each is recorded as **kept** or **deferred**; a deferred item's story AC in 23.10/23.11 is marked deferred, not deleted

---

### Story 23.1: `support` Role, Assignment Record & Live Gate

As a Super Admin,
I want a distinct support role that has no access until I assign it,
So that a GymOS support person can never reach a gym by inheriting what a Supervisor can do.

*Delivers FR-178, FR-194 (and the data half of FR-177). AD-33, AD-34 (amended AD-3). Migration at merge time. Includes the `ALTER TYPE … ADD VALUE` step, which must commit before use (own migration file).*

**Acceptance Criteria:**

**Given** the `member_role` enum
**When** the migration runs
**Then** the value `support` is added in its own migration file ahead of any statement that uses it, and no existing policy, function or CHECK lists `support`, so it is denied by default

**Given** `support_assignments(support_user_id, gym_id, state, …)` with state `pending | active | suspended | ended`
**When** the table is created
**Then** it has RLS enabled with no client policy (Super Admin reads through a function), a partial unique index allowing one non-ended row per (person, gym), and timestamps and reason columns

**Given** `gyms.allow_gymos_support boolean NOT NULL`
**When** the migration runs on a database with live gyms
**Then** every existing gym reads **off** and gyms created afterwards default **on** (FR-183), and the column is written only by the setter delivered in 23.3 (until then nothing can change it, so support stays off everywhere)

**Given** the invariant "active support membership ⇒ assignment `active` AND `gyms.allow_gymos_support`"
**When** anything inserts or updates a `members` row with `role = 'support'` without it
**Then** a constraint trigger refuses it; the only writer is one `SECURITY DEFINER` function used by assignment and activation

**Given** `private.current_member_role()` and `private.gym_id()`
**When** evaluated for a support user
**Then** they return `support` / the gym only if the assignment is `active`, the switch is on, the gym is not suspended, the account is activated, unlocked, has no reset pending, the session is AAL2, the session exists in `auth.sessions` and is inside the 22.7 limits; otherwise NULL, evaluated live on every request

**Given** the claims hook (AD-4)
**When** it runs for a support user
**Then** it emits `gym_id` and `app_role = 'support'` only for an `active` assignment at `aal2` (per the 22.1 result); a support user never gets a claim for a pending, suspended or ended assignment

**Given** a support person with several active assignments
**When** they call `switch_active_gym(gym_id)`
**Then** it succeeds only for an active assignment, and a request in one call acts on exactly one gym (FR-194); a request that names another gym is refused

**Given** `scripts/ci-local.sh`
**When** it runs
**Then** the 22.2 inventory shows no new `claim-only` entry and the pgTAP suite proves a support user with an active assignment sees **zero rows** from every tenant table before 23.6

---

### Story 23.2: Support Excluded From Counts, Caps, Notifications & Metrics

As a gym Owner,
I want GymOS Support to be invisible to my staff numbers, limits and alerts,
So that having support does not use up my staff allowance or put a GymOS person on my front-desk alerts.

*Delivers FR-188. AD-33's predicate rewrite. Migration at merge time.*

**Acceptance Criteria:**

**Given** every staff-target predicate written as `role != 'member'` (0062/0063/0064/0090 and any like it)
**When** the migration is applied
**Then** each is rewritten to an explicit list of staff roles that excludes `support`, and a catalog test fails if a function or policy mentions `'supervisor'` without being classified as including or excluding `support`

**Given** a gym with support active
**When** staff counts, per-role caps and tier limits (AD-26) are computed
**Then** the support membership is not counted, tested in both directions (counted would fail the test)

**Given** operational notifications (front-desk alerts, quiet-gym alerts, class reminders to staff)
**When** a notification fans out for a gym
**Then** no support person receives it, and a test with an active assignment proves zero rows

**Given** platform and gym metrics (Overview cards, Super Admin gym lists, PostHog events)
**When** they count users or staff
**Then** support memberships are excluded through one shared definition of "support member" (the `support` role)

**Given** the staff-management RPCs (`update_staff_role`, deactivate, delete, reset)
**When** a caller targets a support membership from inside a gym
**Then** the call is refused, whatever the caller's role

---

### Story 23.3: "Allow GymOS Support" Switch & "GymOS Support" Row

As a gym Owner,
I want one switch that decides whether GymOS may help my gym,
So that I stay in control of whether anyone from GymOS can act inside it.

*Delivers FR-182, FR-183. Migration at merge time. Owner-only. Depends on OQ-30's answer (23.0).*

**Acceptance Criteria:**

**Given** `gyms.allow_gymos_support` (column and defaults delivered in 23.1)
**When** this story's migration runs
**Then** the column gains a pin trigger so it is changed only by the one audited setter below

**Given** the setter `set_allow_gymos_support(p_gym_id, p_on)`
**When** the caller is that gym's Owner
**Then** the value changes, one audit row records old and new, and Super Admin can see it; any other role, including Supervisor, Manager and support, is refused using `private.current_member_role()`

**Given** the switch is turned off
**When** it commits
**Then** all support access to the gym ends on the next request (live gate), active assignments become `suspended`, and the support memberships are removed in the same transaction

**Given** the switch is turned on again
**When** it commits
**Then** assignments that were active when it was switched off become `active` again, and assignments made while it was off remain `pending` (FR-177, FR-183)

**Given** the Owner's Settings and the staff list
**When** a gym has the setting
**Then** the staff list shows one fixed row "GymOS Support" (never an individual, never a count) that cannot be edited or deactivated, and Settings states exactly one of: off ("turned off by you"), on with no one assigned, on with support assigned, on with an assignment waiting for GymOS to confirm, plus the time support last acted, in EN and FR

**Given** an older dashboard build
**When** it loads a gym with the new setting
**Then** it still renders (unknown row ignored), and the Owner notice delivered through 23.0 covers the change

---

### Story 23.4: Create Support Account & Invite

As a Super Admin,
I want to create a support person's account and send them a single-use invite,
So that a real person can set up their own access without me ever knowing or sending a password.

*Delivers FR-175, FR-176, FR-193 (creation checks). AD-38. Migration at merge time. Requires the `super_admin_aal2` flag on (22.6).*

**Acceptance Criteria:**

**Given** the Super Admin app's "GymOS support" section, signed in at AAL2
**When** the Super Admin enters a person's name, GymOS-controlled phone and `@gymosapps.com` email
**Then** the account is created inactive; creation is refused if the phone or email matches any existing user, any Super Admin, or any linked identity (never merged), with a message that does not reveal which user matched

**Given** `super_admin_aal2` is off
**When** creation is attempted
**Then** it is refused (AD-38)

**Given** an account is created
**When** the Super Admin sends the invite
**Then** a single-use link is created, stored hashed, expires in 24 hours, is bound to the account's verified phone, and is delivered to a channel the Super Admin has verified; no temporary password exists anywhere

**Given** the invitee opens the link
**When** they complete the phone one-time code, set a password and enroll TOTP
**Then** the account becomes `activated` only after a verified factor; a second use, an expired link or a wrong phone fails with one generic message

**Given** the account has an unverified email or phone
**When** its state is read
**Then** it is flagged `not assignable` with the missing item named (FR-176; 23.5 enforces the refusal at assignment); the email is not a sign-in method until verified

**Given** every step
**When** it happens
**Then** one `audit_log` row is written (actor, action, target, timestamp, never the link or secret) and the checks in FR-193 run again at activation

---

### Story 23.5: Assign, Unassign & Remove

As a Super Admin,
I want to assign support people to gyms and take them off again,
So that the right people can help the right gyms, and I can end access at any moment.

*Delivers FR-177, FR-185 (removal), FR-193 (assignment check). Migration at merge time.*

**Acceptance Criteria:**

**Given** a Super Admin at AAL2
**When** they assign a support person to a gym with a mandatory reason
**Then** the assignment is created `active` only if the person is activated, the gym's switch is on, and the person has no other membership or staff row in that gym (FR-091); otherwise it is created `pending` or refused with a typed reason

**Given** a `pending` assignment
**When** enrollment completes and the switch is on
**Then** it becomes `active` only when a Super Admin confirms it explicitly, never automatically

**Given** concurrent assignment and the Owner's switch change on the same gym
**When** both run
**Then** they are serialized per gym (advisory lock) so the invariant "active ⇒ switch on" never breaks, tested with a concurrent transaction

**Given** a Super Admin session or a person who is a Super Admin
**When** assignment is attempted
**Then** it is refused (FR-193)

**Given** unassign, remove, or deactivate with a mandatory reason
**When** it commits
**Then** access ends on the person's next request (22.3), the support membership is removed, and one audit row records actor, target gym or account, and reason; the Owner cannot see or perform any of these

**Given** the Super Admin app
**When** a Super Admin views a gym or a person
**Then** they see assignments and states, and the individual's name is visible to Super Admin only

---

### Story 23.6: Capability Allow-List & Denied-Set Matrix

As a gym Owner,
I want support to do exactly what GymOS promised and nothing else,
So that "help me set up my gym" never becomes "change my billing or remove me".

*Delivers FR-179. AD-35. Migration at merge time. This is the story that makes support useful; before it, support sees nothing.*

**Acceptance Criteria:**

**Given** `support_capabilities(capability, rpc_name | policy_name)`
**When** this story ships
**Then** it lists every RPC and policy that admits `support`, each named in the allow-list of FR-179: gym profile and settings, plans and prices, registration fee, guest charging and loyalty settings, category, staff creation within the ceiling, member records and imports, payments, refunds and registration-fee waivers; the payment connection is added by 23.9

**Given** the catalog test
**When** it runs
**Then** every policy and function mentioning `'supervisor'` is classified as including or excluding support, and an unclassified one fails CI

**Given** the denied set (tier, interval, billing anchor, Owner contact, subscription status, suspension, deactivate/delete gym, `allow_gymos_support`, Owner and Supervisor edits, any staff phone change, any credential reset)
**When** a pgTAP matrix calls each RPC and attempts each column write as a support user
**Then** every denied one fails, and each has its own named negative test

**Given** money- and access-changing writes admitted for support (refunds, waivers, staff creation)
**When** called
**Then** each requires a valid step-up row (22.7) bound to the action and subject, and refuses without it

**Given** the FR-087 ceiling
**When** support creates staff
**Then** it cannot create an Owner, a Supervisor or another support account, and cannot change its own role

**Given** staff created by support
**When** they are written
**Then** they are tagged `created_by_support` and are **not** deactivated when the person is revoked (they are listed for Owner review in 23.10)

---

### Story 23.7: Hidden Identity — Per-Gym Proxy Actor

As a gym Owner,
I want everything support does to appear as "GymOS Support" with no way to tell which person did it,
So that I deal with GymOS as a company and a person cannot be traced across the gyms they work in.

*Delivers FR-186. AD-39. Migration at merge time plus a one-time backfill script. The largest story in the epic: it touches every function that writes an actor.*

**Acceptance Criteria:**

**Given** gym creation
**When** a gym is created
**Then** one proxy `users` row (`is_support_proxy`, display name "GymOS Support", null phone and email) backed by a banned `auth.users` row exists for it, and gym creation fails closed if the proxy cannot be created; existing gyms are backfilled by a one-time script

**Given** `private.actor_id()`
**When** a support session writes
**Then** it returns the gym's proxy id; for any other caller it returns `auth.uid()`, and `log_audit_event()` writes it with `actor_display_name = 'GymOS Support'`

**Given** the generated inventory over `pg_proc` bodies and triggers (0034/0035/0036/0037/0061/0063/0090/0093/0099/0100/0108/0110/0119/0121, `connected_by` in 0052/0054/0083, and any later one)
**When** CI runs
**Then** every function that writes `auth.uid()` into an actor column calls `private.actor_id()`, and CI fails on an unlisted writer; RLS `WITH CHECK (actor_id = auth.uid())` policies on support-writable tables become `= private.actor_id()`

**Given** the proxy user
**When** staff lists, counts, exports, notifications and Realtime payloads are produced
**Then** `is_support_proxy` excludes it from person-level counts, exports and notifications

**Given** a support person's own `users` and `members` rows
**When** an Owner or staff member queries those tables
**Then** they are unreadable from any gym-side policy, including raw base-table reads and Realtime

**Given** the same support person acting in two gyms
**When** attribution columns are compared across the gyms
**Then** they hold two different opaque proxy ids, so the person cannot be correlated

---

### Story 23.8: Audit Under the Individual, Disclosure & Member-Facing Surfaces

As GymOS,
I want every support action recorded under the real person, and the gym shown only "GymOS Support",
So that we stay accountable for our staff without exposing them to the gym.

*Delivers FR-187, FR-195, FR-186's per-surface tests. AD-39. Migration at merge time. Wording for the disclosure answer depends on OQ-31 (23.0).*

**Acceptance Criteria:**

**Given** a support action
**When** it is written to the audit log
**Then** the gym-visible row shows "GymOS Support" and the proxy id, and a separate `support_action_identity(subject_table, subject_id, real_user_id, gym_id)` row holds the real person, readable by Super Admin only

**Given** each surface (staff list, audit trail, payment "recorded by", refund approvers, member notes, check-ins, exports, live updates, notifications, error logs)
**When** a per-surface test reads as Owner, Supervisor and Manager of a gym where support acted
**Then** none returns the real person's id, name, phone or email

**Given** the member app, receipts and message templates
**When** they render something support created or changed
**Then** they show the gym, never an individual or "GymOS Support" as a person (FR-195)

**Given** an Owner
**When** they file a disclosure request about a specific audit row
**Then** it is stored, visible to Super Admin, answered outside the product within 3 business days `[ASSUMPTION]`, and both the request and the answer are audited

**Given** the displayed actor
**When** a client attempts to set it
**Then** the server ignores it; the displayed actor is always derived server-side

---

### Story 23.9: Support Connects the Payment Account

As a GymOS support person,
I want to connect or replace a gym's Tara Money account for the Owner,
So that a gym can start taking mobile-money payments without the Owner doing technical setup.

*Delivers FR-180 (amended 2026-10-15: no Owner approval) and AD-37. Migration at merge time. AD-36 is dropped.*

**Acceptance Criteria:**

**Given** a support session with an active assignment and a valid step-up (22.7, action `payment_connection`, bound to the gym)
**When** support submits the Tara Money credentials
**Then** one audited `SECURITY DEFINER` function validates them, stores the secret in Vault, derives the masked identifier server-side, runs the 0083 business-id collision guard, and activates the connection; without a valid step-up it refuses

**Given** a replacement of an existing connection
**When** it applies
**Then** the previous `gym_payment_credentials` row is retired (`retired_at`), not deleted, and the unique constraints are partial over active rows (AD-37), so rolling back to a previous merchant is a new active row

**Given** a payment initiated before the swap
**When** its webhook, status check or reconciliation runs after it
**Then** it verifies under `payments.credentials_id` recorded at initiation (backfilled for existing payments), never under the active row by `connected_at`

**Given** a webhook whose credential is deleted
**When** it arrives
**Then** it is rejected 401 before any database write (NFR-002, AD-17)

**Given** any payment-connection change
**When** it commits
**Then** the Owner is notified immediately ("GymOS Support updated your payment account"), Super Admin is alerted, and the audit row records that credentials changed, never their value

**Given** a retired credential
**When** no payment under it is `pending` or `processing` and at least 7 days (cap 14) have passed
**Then** a `payment_connection_cleanup` job deletes the secret from Vault and records the run in `job_runs`

---

### Story 23.10: Revocation, Owner Visibility & Velocity Lock

As a gym Owner,
I want to know what support did and to be safe when their access ends,
So that nothing is half-finished or unreviewed after a person leaves.

*Delivers FR-181, FR-184. AD-41. Migration at merge time. Items marked deferred in 23.0 are skipped, not deleted.*

**Acceptance Criteria:**

**Given** a revocation (unassign, removal, opt-out, deactivation, lock)
**When** it commits
**Then** operations already started complete or roll back atomically, items created by that person that are still pending are re-owned to the gym's proxy actor and flagged for the Owner, and live subscriptions and signed links stop within 60 seconds `[ASSUMPTION]`

**Given** staff created or modified by support
**When** support is revoked
**Then** they are listed in a review queue for the Owner and tagged "created by GymOS Support" in the staff list, and none is deactivated automatically

**Given** `support_activity_digest` (its own cron, writing `job_runs`)
**When** support acted that day
**Then** the Owner receives one summary through the existing notification path (AD-25) listing refunds, fee waivers, staff creation and edits, and changes to a page's public contact or about text (the last once Epic 24 exists), and payment-connection changes were already notified immediately in 23.9

**Given** the velocity limit (10/h per gym, 20/h per account, 3 payment-connection changes/day per gym — `[ASSUMPTION]`)
**When** it is exceeded
**Then** `support_gate_touch()` sets `users.support_locked_at`, the breach is returned as a result so the lock commits (AD-34), and Super Admin is alerted for review

**Given** a locked account
**When** Super Admin reviews
**Then** they can unlock with a recorded reason; the lock, unlock and reason are audited

**Given** a gym in suspension
**When** a support person makes a request
**Then** they are denied like every staff account (FR-132), and no job counts that gym toward inactivity

**Given** a live support caller writes an audit event (retro 67, moved from 23.8)
**When** the action type is not one the allow-listed capabilities produce
**Then** the write is refused with a typed error (`support_audit_action_not_allowed`), and reading a real identity writes one audit row

---

### Story 23.11: Lifecycle — Inactivity, Recertification & Factor Reset

As a Super Admin,
I want idle support accounts to switch off by themselves and lost authenticators to be reset safely,
So that old access does not linger and a real person can get back in without a back door.

*Delivers FR-185 (inactivity, recertification) and FR-190. AD-38, AD-41. Migration at merge time. Inactivity and recertification parts are skipped if deferred in 23.0.*

**Acceptance Criteria:**

**Given** `support_inactivity_sweep` (its own cron, writing `job_runs`)
**When** an account has had no activity for 30 days `[ASSUMPTION]`
**Then** it is disabled and Super Admin is told; suspended gyms are excluded so an idle gym does not disable its support

**Given** quarterly recertification
**When** a person's due date passes
**Then** Super Admin must recertify before further access; the due date and recertification are audited

**Given** a Super Admin at AAL2 resets a support person's second factor
**When** they record an identity check
**Then** the person's sessions are invalidated, a 30-minute cooling-off starts `[ASSUMPTION]` during which phone and email changes are frozen and the person is notified on the verified phone and the email on file and can cancel

**Given** the cooling-off ends without cancellation
**When** the executor job runs
**Then** the old factor is removed and a new single-use invite is issued (23.4), and the person must re-enroll before any access

**Given** a cancellation during cooling-off
**When** the person cancels
**Then** the reset is abandoned, sessions stay revoked, and Super Admin is alerted

**Given** any change to a support person's phone or email
**When** it is made
**Then** it goes through Super Admin at AAL2 only and is audited

---

### Epic 24 — Stories

| # | Story | Migration | Depends on |
|---|---|---|---|
| 24.0 | Pre-Flight Checklist (Product Owner) | none | Epic 23 |
| 24.1 | Spike — Pooler Role, DNS Precedence, `__Host-` Cookies, AutoSSL | none | Epic 23 |
| 24.2 | Wildcard Delegation & Reserved-Label CI Check | none (DNS + CI) | 24.1 |
| 24.3 | Staff Session Cookies — `__Host-` Prefix, Host-Only | none | 24.1 |
| 24.4 | `public_site` Schema & Hardened Reader Role | next free at merge time | 24.1 |
| 24.5 | Page Content Fields & Public Plans | next free at merge time | 24.4 |
| 24.6 | Page Media — Private Originals, Re-Encoded Derivatives | next free at merge time | 24.5 |
| 24.7 | Page Names — Claim, Hold, Rename, Redirect | next free at merge time | 24.2, 24.5 |
| 24.8 | Publish Gate, Snapshot & Unpublish | next free at merge time | 24.5, 24.6, 24.7 |
| 24.9 | Landing-Page Editor & Publish Screen (Dashboard) | none | 24.8 |
| 24.10 | Public Page Route & Launch Template | next free at merge time (0166: `public_site.page_redirects`, `default_language` in the snapshot) | 24.3, 24.8 |
| 24.11 | Takedown, Reports, Sitemap & Media Purge | next free at merge time | 24.8, 24.10 |
| 24.12 | Landing-Page Gate — Isolation, Headers & Speed Baseline | none | 24.10, 24.11 |
| 24.13 | Landing Template Redesign (Classic redesign, Volt template, template modal; added during the epic, spec `spec-24-13`) | none | 24.10 |
| (24.11 follow-up) | Super Admin Pages actions menu and Active tab (PR #125, no story of its own) | 0168 `list_published_pages` | 24.11 |

*Step 2 starts only after Epic 23 is done (PRD §10.2). Nothing is public until a gym publishes: existing gyms have no page, no name and no public plan until their Owner acts (FR-197). No V1.7 UX spec exists; screens are anchored in FR/AD wording and a `bmad-ux` pass is expected before 24.9 and the launch template's visual design in 24.10. FR-211 structured data and the directory belong to Epic 25.*

---

### Story 24.0: Pre-Flight Checklist (Product Owner)

As the product owner,
I want the owner-side decisions and access for Epic 24 recorded before any code ships,
So that the build does not stall on an open question or an unavailable system.

*Docs only. Output is one dated `docs/decisions.md` entry, PRD OQ-28 resolved, and `sprint-status.yaml` synced. Answers recorded 2026-11-01.*

**Acceptance Criteria:**

**Given** OQ-28 (content language)
**When** the owner answers
**Then** it is recorded in `docs/decisions.md` and the PRD, and the stories it changes (24.5, 24.8, 24.9, 24.10) carry the consequence

**Given** the Step 2 assumption values (FR-204, FR-207)
**When** the owner reviews them
**Then** they are confirmed or changed in the same entry

**Given** the infrastructure the spike and DNS stories need (A2 Hosting DNS zone, Vercel `apps/landing`, a staging Supabase project, a throwaway test label)
**When** the owner confirms access
**Then** the entry records what is available, and any missing item blocks only the story that needs it

**Given** the PRD's UX expectation for the editor and the launch template
**When** the owner decides when it happens
**Then** the entry records the timing and 24.9 and 24.10 name it as a prerequisite

---

### Story 24.1: Spike — Pooler Role, DNS Precedence, `__Host-` Cookies, AutoSSL

As the product owner,
I want the four unverified assumptions behind the public site answered on the real stack,
So that Epic 24 is built on verified behavior and the fallbacks already decided in AD-42–AD-44 are triggered only if needed.

*Delivers the Epic 24 spike list in AD-42, AD-43, AD-44. No product code. Output is a dated `docs/decisions.md` entry.*

**Acceptance Criteria:**

**Given** the hosted Supabase project (staging) and a throwaway login role with `SELECT` on one view
**When** the spike connects through the pooler with the role's `role.project_ref` username
**Then** the entry records whether it works in transaction mode, the connection limit behavior, and password rotation, and states **use direct role** or **use pre-minted JWT fallback** (AD-42)

**Given** a test wildcard on a throwaway subdomain of the real zone
**When** `dig` and a live request check `owner.`, `portal.` and `www.` against a random label
**Then** the entry records that explicit records and other-project hostnames win over the wildcard, or the exact exception found (AD-43)

**Given** the `@supabase/ssr` helpers in the dashboard and super-admin apps
**When** a sign-in sets the session with `cookieOptions { name: '__Host-…', secure: true, path: '/' }` and no `domain`
**Then** the entry records that every chunk carries the prefix, that the session persists across refresh and sign-out, and what breaks locally over plain HTTP; **or** states **use the separate-domain fallback** (AD-44)

**Given** A2 Hosting's certificate tooling
**When** `_acme-challenge` is delegated on a throwaway label
**Then** the entry records whether AutoSSL still issues for the apex and `mail.` names, so the AD-43 accepted risk is confirmed or the exact conflict is named

**Given** all items answered
**When** the story closes
**Then** `docs/decisions.md` has one entry with a result and a "changes to later stories" list, and AD-42/43/44's `[ASSUMPTION]` tags are resolved in the spine

---

### Story 24.2: Wildcard Delegation & Reserved-Label CI Check

As the product owner,
I want every gym page address to resolve and be certified without touching the mail zone,
So that `{name}.gymosapps.com` works while `owner.`, `portal.`, `www.` and mail stay exactly as they are.

*Delivers FR-196 (address), AD-43. Ops story run by the product owner; the CI check is code.*

**Acceptance Criteria:**

**Given** the `apps/landing` Vercel project
**When** `*.gymosapps.com` is added and Vercel DNS is enabled for the zone **without changing nameservers**
**Then** the project shows the wildcard as valid and the apex nameservers remain A2 Hosting's

**Given** the A2 zone
**When** the `NS _acme-challenge → ns1/ns2.vercel-dns.com.` and `CNAME * → cname.vercel-dns-0.com.` records are added
**Then** a random label serves the landing app's not-found response over a valid wildcard certificate, and `owner.`, `portal.`, `www.`, the apex and mail resolve and behave as before (checked by a before/after record diff and a test mail in and out)

**Given** a committed DNS zone export `docs/dns/gymosapps.com.zone`
**When** CI runs
**Then** it fails if the export contains a label that is not in the reserved list (FR-202 list ∪ zone labels), and the list is generated from one source shared with the proxy (AD-43)

**Given** rollback
**When** the story closes
**Then** the record changes needed to remove the wildcard are written down and tested on a throwaway label

**Given** the three apps read `VERCEL_ENV` and `VERCEL_GIT_COMMIT_SHA` in several places (analytics environment, build id, `apps/dashboard/vercel.json`, `turbo.json`)
**When** this story closes
**Then** those reads go through one small host-neutral module per app (`appEnvironment()` and `buildId()` with `APP_ENV` and `GIT_SHA` as the primary variables and the Vercel ones only as fallback), existing behavior and tests are unchanged, and a grep finds no other `VERCEL_ENV` or `VERCEL_GIT_COMMIT_SHA` read outside that module

---

### Story 24.3: Staff Session Cookies — `__Host-` Prefix, Host-Only

As a gym Owner,
I want my dashboard session to be unwritable from any other address under the main domain,
So that a gym's public page can never be used to hijack or overwrite my staff login.

*Delivers NFR-026 (cookie half), AD-44. Resolved by the 24.1 result. Every signed-in staff member signs in once more after this ships.*

**Acceptance Criteria:**

**Given** the dashboard and super-admin apps
**When** a session cookie is issued
**Then** it has no `Domain` attribute, `Path=/`, `Secure`, `SameSite=Lax` and the `__Host-` prefix on every chunk, and a unit test fails if either app emits an auth cookie without them

**Given** an existing signed-in session with the old cookie name
**When** the user's next request arrives after release
**Then** they are sent to sign-in once with the existing "session expired" copy and the old cookie is cleared; a form left open at release loses unsaved input, so the release notice (23.0 pattern) warns staff to save first

**Given** local development over HTTP
**When** the app runs with the environment gate
**Then** it uses an unprefixed name, and the production build refuses to start with that gate set

**Given** the 24.1 result is the separate-domain fallback
**When** this story would otherwise ship
**Then** it is replaced by the decision entry and Epic 24 proceeds on the separate domain

**Given** `scripts/ci-local.sh` and the Playwright baseline
**When** they run
**Then** sign-in, sign-out, role redirect and refresh paths pass for both apps

---

### Story 24.4: `public_site` Schema & Hardened Reader Role

As the product owner,
I want the public site to see only a narrow set of views through its own role,
So that a defect in the public site cannot expose a member, a payment or an unpublished field.

*Delivers NFR-024, AD-42. Migration at merge time. Follows the Function-privileges convention.*

**Acceptance Criteria:**

**Given** the migration
**When** it runs
**Then** schema `public_site` exists, `public_site_reader` is a login role with no membership in any other role, `CONNECTION LIMIT` and `statement_timeout` set, `default_transaction_read_only = on`, and all privileges from `PUBLIC` revoked on the schema

**Given** the privilege test
**When** it enumerates every relation, function and sequence privilege for the role, including those inherited from `PUBLIC`, default privileges and role memberships
**Then** it fails on anything beyond `USAGE` on `public_site` and `SELECT` on its views (plus `submit_page_report()` once 24.11 adds it)

**Given** the view column list
**When** a snapshot test runs
**Then** it pins every column and fails on any change, and pins the allowed top-level keys of the snapshot `content` payload

**Given** `apps/landing`
**When** it connects
**Then** it does so only as `public_site_reader`, with no Supabase client library, anon key, service-role key or JWT secret in its dependencies or environment (a CI check greps the package and env manifest)

**Given** the 24.1 result is the pre-minted JWT fallback
**When** the story is built
**Then** the landing app holds only that signed token, and a test proves it cannot reach any non-`public_site` relation

---

### Story 24.5: Page Content Fields & Public Plans

As a gym Owner,
I want to enter what my public page should say and choose which plans it shows,
So that a visitor sees my gym accurately and I never expose a plan I want kept private.

*Delivers FR-197 (data), FR-200. Migration at merge time. Setter RPCs follow AD-32; support is admitted through the AD-35 registry (FR-179). **OQ-28 (2026-11-01): about, services and public plan labels are stored as optional English and French fields; the setter and Zod schema validate both, and either may be empty.***

**Acceptance Criteria:**

**Given** the migration
**When** it runs on live gyms
**Then** `gyms` gains about, services, address, map position, opening hours, public contact, and city and country already exist or are added as controlled values, all nullable, and every existing gym has an empty page and **nothing public**

**Given** `plans.is_public boolean NOT NULL DEFAULT false`
**When** the migration runs
**Then** every existing plan is private (FR-200), and only the page-content setter changes the flag

**Given** the page-content setter RPC (`SECURITY DEFINER`, role checked with `private.current_member_role()`)
**When** the caller is the Owner, a Supervisor or an assigned support person of that gym
**Then** content and plan visibility change and one audit row records old and new values; any other role is refused

**Given** the public contact
**When** it differs from the Owner's login phone
**Then** it is stored separately and the login phone is never written to the page fields (FR-197)

**Given** input validation
**When** content is saved
**Then** the Zod schema in `packages/types` bounds lengths, rejects markup characters as text-only input (FR-205), and validates phone and WhatsApp format (E.164, FR-142)

---

### Story 24.6: Page Media — Private Originals, Re-Encoded Derivatives

As a gym Owner,
I want to upload a logo, banner and gallery images safely,
So that my page looks right and no one can learn where a photo was taken or find my internal id in a URL.

*Delivers FR-205 (images), AD-47. Migration at merge time (buckets, `gym_page_media`).*

**Acceptance Criteria:**

**Given** the upload server function
**When** an Owner, Supervisor or assigned support uploads a file
**Then** only JPEG, WebP and PNG are accepted, size, pixel dimensions and per-gym count are bounded, and a rejected file returns a typed error with localized copy

**Given** an accepted image
**When** it is stored
**Then** the original goes to the private bucket `gym-page-media-src`, a derivative re-encoded with metadata stripped (orientation applied first) goes to the public bucket `gym-page-media` under a random key containing no `gym_id`, and `gym_page_media` records both and the uploader's attestation that they may publish it

**Given** an image with GPS metadata
**When** the derivative is read
**Then** no EXIF, XMP or IPTC data remains (tested on a fixture)

**Given** the page logo
**When** it is prepared for publish
**Then** it is re-encoded into the new bucket from the gym's existing logo, never linked to `gym-logos` and never copied raw

**Given** an image deleted by the gym
**When** the delete is requested
**Then** the row is marked and removal of the public derivative is left to the 24.11 purge job; the public view stops exposing it immediately

---

### Story 24.7: Page Names — Claim, Hold, Rename, Redirect

As a gym Owner,
I want to claim a name for my page that nobody else can take or impersonate,
So that my address is mine, stable when I rename, and safe from look-alikes.

*Delivers FR-202, FR-203, AD-45. Migration at merge time (`page_names`, `page_name_words`). Owner-only claiming.*

**Acceptance Criteria:**

**Given** `page_names`
**When** a name is submitted
**Then** a CHECK enforces 3–30 characters of `a-z0-9-`, no leading or trailing hyphen, no `--`, no `xn--`, not digits only, and a unique index on `lower(name)` over non-released rows refuses a duplicate

**Given** `claim_page_name()`
**When** the caller is the gym's Owner (or Super Admin)
**Then** it succeeds for one name per gym; any other role, including Supervisor and support, is refused (FR-198)

**Given** a name that is reserved, contains a credential or brand word, or equals a zone label
**When** it is claimed
**Then** it is refused with a typed error; a name within edit distance 1 of an existing page or reserved name, equal after homoglyph, hyphen and digit folding, or a generic or place word, is **held** for Super Admin approval and shows "name under review"

**Given** the Super Admin held-names list
**When** a Super Admin approves or rejects with a reason
**Then** the decision is audited and the Owner is notified; held names are answered within 2 business days `[ASSUMPTION]` (a reminder to Super Admin after 2 days)

**Given** a rename
**When** an Owner renames a gym that already has an active name
**Then** at most two renames in any rolling 12 months are allowed (forced renames excluded), the old name becomes a 301 redirect (one hop) for 12 months then is released, and a name of a taken-down page is never released

**Given** an unpublished or suspended gym
**When** time passes
**Then** its name stays reserved to it for up to 12 months

---

### Story 24.8: Publish Gate, Snapshot & Unpublish

As a gym Owner,
I want to publish my page only when it is complete and take it down instantly when I choose,
So that the public never sees a half-finished or retracted page.

*Delivers FR-199, FR-200 (retraction), FR-206, FR-207 (origin), AD-46. Migration at merge time (`gym_pages`, `public_site` views, triggers). **OQ-28: the published projection and snapshot carry the optional EN and FR content fields; the FR-206 field list and its snapshot test include both.***

**Acceptance Criteria:**

**Given** `publish_gym_page()` (`SECURITY DEFINER`; Owner, Supervisor or assigned support)
**When** it runs
**Then** it re-validates the gate (name, category, logo, banner, about ≥ 100 characters, country and city, at least one public contact, opening hours, at least one public plan) server-side, builds `content` itself with a fixed `jsonb_build_object` from tenant columns and only public plans, accepts no content from the caller, and replaces the snapshot atomically

**Given** a published page
**When** any source column in the projection changes (a plan made private, the about text edited)
**Then** a trigger calls `refresh_gym_page()` to re-snapshot if the gate still holds, or unpublishes with a reason shown to the Owner when it does not

**Given** unpublish
**When** the Owner or any permitted role unpublishes
**Then** `unpublished_at` is set, the `public_site` view stops returning the row, and unpublishing is always allowed

**Given** a gym that is suspended (FR-132) or a page that is taken down
**When** the view is read
**Then** the single visibility predicate (published, not taken down, name active, gym active) excludes it

**Given** the snapshot payload
**When** the snapshot test runs
**Then** every key path is pinned; an extra key added to the builder fails the test, and no internal identifier, `gym_token` or login phone appears (FR-206)

**Given** the role gate
**When** a deactivated or opted-out support person calls the function
**Then** it is refused on the next request (live gate, AD-34)

---

### Story 24.9: Landing-Page Editor & Publish Screen (Dashboard)

As a gym Owner,
I want a place in my dashboard to fill in, preview and publish my page,
So that putting my gym on the web takes minutes and I always know what becomes public.

*Delivers FR-197 (screen), FR-198, FR-199 (reasons), FR-201 (selection). EN/FR. No V1.7 UX exists; follow the existing Settings patterns until the UX pass. **Prerequisite (24.0, 2026-11-01): the `bmad-ux` pass runs after 24.8 and before this story. The editor offers an EN and an FR field for about, services and plan labels, each optional (OQ-28).***

**Acceptance Criteria:**

**Given** the dashboard Settings
**When** an Owner, Supervisor or assigned support opens "Landing page"
**Then** they can edit the 24.5 fields, upload images (24.6), choose which plans are public, and choose a template, with the gate checklist showing what is still missing

**Given** the Owner
**When** they open the name section
**Then** they can claim or rename a name (24.7) and see "name under review" while held; Supervisor and support see the name read-only (FR-198)

**Given** the publish action
**When** the Owner presses it
**Then** a screen first lists exactly the fields that become public and the uploader attestation, and only then calls `publish_gym_page()`; an automatic unpublish shows its reason on this screen and by the existing Owner notification path

**Given** existing gyms
**When** an Owner first opens Settings after release
**Then** they are prompted to fill the page in and nothing is published (FR-197)

**Given** language preference
**When** the screen renders
**Then** all UI copy is EN/FR through the existing i18n layer and no hand-written error copy

---

### Story 24.10: Public Page Route, Template Contract & Launch Template (Classic)

*Superseded 2026-11-09 (owner): ONE template ships, Classic (DESIGN.md "Classic template"); seeds A and B are deferred library growth (`deferred-work.md`). The migration column in the table above was "none"; the story needs one (redirect lookup, `default_language`). See `docs/decisions.md`, 24.10.*

As a visitor,
I want to open a gym's page and see what it offers, how to call it and where it is,
So that I can decide to visit without an account.

*Delivers FR-196, FR-201, FR-205 (text-only), FR-206, FR-207 (behavior), FR-208; NFR-025, NFR-026. AD-43, AD-44, AD-48. Visual design awaits the UX pass (after 24.8, before 24.9, per 24.0); the contract and one template ship here. **OQ-28: show the visitor's language when that content exists, else the other; declare language alternates only where both exist.***

**Acceptance Criteria:**

**Given** a request to `{name}.gymosapps.com`
**When** the proxy runs
**Then** it takes the first label of `Host`, validates it against the name grammar and reserved list without touching the database for non-names, overwrites any inbound `x-tenant-*` header, and rewrites to the single page route; unknown, reserved, unpublished, taken-down and suspended-gym labels return the **same** not-found response with `s-maxage=30`

**Given** a published page
**When** the route renders
**Then** it reads one row from `public_site` as `public_site_reader`, parses it with the `.strict()` `PageContentV1` and fails closed to not-found on a mismatch, renders the launch template with `renderToStaticMarkup` (no executable script element, no hydration payload; a JSON-LD data block is allowed), and responds with `Cache-Control: public, s-maxage=60`

**Given** the response headers
**When** the header test runs
**Then** the exact CSP of AD-44 is asserted (`script-src 'none'`, a per-page style hash, `img-src` the media origin only, `frame-ancestors 'none'`), plus `nosniff`, `Referrer-Policy` and HSTS, and the page sets no cookie

**Given** the page content
**When** it renders
**Then** the page shows the gym name, category label, about, services, public plans and session plans with prices, address and map link, hours, gallery, banner and logo, with call, WhatsApp and directions links, no login, no member counts, no staff names, and all gym text as text nodes (no `dangerouslySetInnerHTML`, lint-enforced)

**Given** locale
**When** the page chrome renders
**Then** labels are EN or FR per the gym's `default_language` (fixed per page, no negotiation, AD-50) and gym content is shown as entered; language alternates are declared only where translated content exists (FR-208)

**Given** a renamed gym
**When** the old name is requested within 12 months
**Then** it returns a 301 to the current name in one hop with cache lifetime ≤ 5 minutes

**Given** the template module
**When** its contract test runs with a fixture snapshot
**Then** `render(content, locale)` is the module's only export, it imports no database or network client, and a second fixture proves a template swap changes only `template`

**Given** the two seed templates (a dark member-app echo and a light plain one, `.working` directions A and B promoted to `mockups/`)
**When** the conformance suite runs
**Then** both pass against fixture gyms covering full, no banner, no gallery, no map position, no hours, one and eight plans, very long name and about, hostile markup, EN and FR, and a deliberately broken fixture template fails the suite for each rule it violates (section order, CSP, script, contrast, tap target, style budget, font allowlist)

**Given** a template declaring fonts
**When** it is built
**Then** fonts come only from the self-hosted allowlist (Barlow 700 and 800) under `font-src 'self'`, and the header test asserts the policy

**Given** a gym picks a template in 24.9
**When** it publishes
**Then** the page renders with that template and the gym's `primary_color` as the only variable color

---

### Story 24.11: Takedown, Reports, Sitemap & Media Purge

As GymOS,
I want to remove an impersonating or illegal page quickly and clean up behind it,
So that a bad page stops being served and its images and address do not linger.

*Delivers FR-204, FR-207 (sitemap, media), AD-46, AD-47. Migration at merge time (`page_reports`, `submit_page_report()`).*

**Acceptance Criteria:**

**Given** a Super Admin at AAL2
**When** they take a page down with a reason code (impersonation, illegal content, trademark, misleading content, privacy, other)
**Then** `taken_down_at` is set, the page leaves the view immediately, republishing is blocked until lifted, the Owner is told why, and the name stays reserved to that gym forever

**Given** the public form
**When** a visitor submits a report
**Then** `submit_page_report()` (the single function granted to `public_site_reader`) stores it with a per-source rate limit and a size bound, the report has no read path from the public role, and Super Admin sees it in a queue answered within 5 business days `[ASSUMPTION]`

**Given** a takedown
**When** the Owner disagrees
**Then** an appeal request reaches Super Admin with a recorded decision, and no page is moderated before publishing

**Given** a gym host's `/sitemap.xml` (a dynamic route with `s-maxage` ≤ 300, AD-52)
**When** it is requested
**Then** it lists only that gym's own canonical URL while the page is visible, returns the uniform not-found once it is unpublished, taken down or suspended, and no refresh job exists

**Given** `page_media_purge` (its own cron writing `job_runs`)
**When** a page is unpublished or an image is deleted
**Then** the public derivative is deleted through the Storage API within 15 minutes and `purged_at` is recorded, and republishing re-derives from the retained original

**Given** a suspended gym
**When** it is reactivated
**Then** its page returns only if it is still published and no takedown is in force (FR-207)

---

### Story 24.12: Landing-Page Gate — Isolation, Headers & Speed Baseline

As the product owner,
I want proof that the public site is isolated and fast before any gym publishes,
So that launching public pages cannot expose tenant data or slow the core product.

*Delivers the Step 2 release gate (PRD §10.2) for NFR-024, NFR-025, NFR-026. Product-owner run; mostly tests and a checklist.*

**Acceptance Criteria:**

**Given** the unauthenticated and `public_site_reader` roles
**When** the isolation suite runs
**Then** neither has any privilege on any relation or function outside `public_site` (plus `submit_page_report()`), and the column and key-path snapshots pass

**Given** the staging pages
**When** the security-header test runs
**Then** the exact policy of AD-44 is present on a published, a not-found and a redirect response

**Given** a representative published page
**When** a field-style measurement runs on a mid-range Android profile over 4G
**Then** p75 largest contentful paint is recorded as the baseline against the 3 s target (NFR-025 `[ASSUMPTION]`) and the result is written to `docs/decisions.md`

**Given** a load check with random valid labels
**When** it runs against staging
**Then** database connections stay within the role's limit and the core product's Overview and check-in latencies are unaffected (page load < 2 s, scan to alert < 3 s)

**Given** the E2E baseline (NFR-015)
**When** the suite runs
**Then** it includes publish, unpublish, rename-with-redirect, takedown and not-found-uniformity specs in English and French

**Given** the checklist
**When** it is signed
**Then** `sprint-status.yaml` and the Epic 24 retrospective prerequisites record the gate result


### Epic 25 — Stories

| # | Story | Migration | Depends on |
|---|---|---|---|
| 25.1 | Country & City Controlled Lists, Gym City Selection | next free at merge time | Epic 24 (24.5) |
| 25.2 | Directory Views & Listing Correctness | next free at merge time | 25.1, 24.8 |
| 25.3 | Directory Pages — Country, City, Category Filter | none | 25.2, 24.10 |
| 25.4 | Structured Data Serializer & Validation | none | 25.3 |
| 25.5 | Sitemap Index, Robots & Plain-Text Summary | none | 25.3 |
| 25.6 | Directory Gate — SEO Verification & Removal Timing | none | 25.4, 25.5 |
| 25.7 | Directory Africa Map & Old City-Slug Redirects | next free at merge time (a fourth `public_site` view) | 25.3 |

*Step 3 starts only after Step 2's gate (24.12) is passed (PRD §10.2). The directory has no tables of its own: every listing is a view over the Epic 24 snapshot (AD-49), so unpublishing, takedown and suspension leave it without extra code. At launch, with few gyms, only individual pages are expected to be indexed (FR-212). The directory UX pass ran 2026-11-12 (`DESIGN.md` "Public Directory", `EXPERIENCE.md` PS-04…PS-06): the directory is its own set of pages on the rebranded main site, and the top page carries one Africa map with a dot per city that has a gym (static SVG, no script, city coordinates from 25.1).*

---

### Story 25.1: Country & City Controlled Lists, Gym City Selection

As a gym Owner,
I want to pick my city from a list instead of typing it,
So that my gym appears in the right place in the directory however I spell it.

*Delivers FR-209. AD-49. Migration at merge time. Super Admin adds cities; existing free-text values are mapped, not discarded.*

**Acceptance Criteria:**

**Given** the migration
**When** it runs
**Then** `countries(code, name_en, name_fr)` is seeded from ISO 3166 and `cities(id, country_code, slug, name, lat numeric(9,6), lng numeric(9,6))` exists with a unique `(country_code, slug)`, slugs ASCII-folded, `lat` and `lng` nullable but both set or both null and range-checked (-90..90, -180..180), a `city_aliases(id, country_code, alias_norm, alias, city_id, is_name)` table holds every spelling that reaches a city (its own name included, `is_name`) with a unique `(country_code, alias_norm)` (AD-49, as built in 0169), and `gyms.city_id` is added nullable

**Given** the Super Admin city form
**When** a city is added or edited
**Then** it accepts a latitude and longitude (both or neither) used only to place the city's dot on the directory map; a city without them is still listed and simply has no dot; coordinates are those of the city, never of any gym

**Given** gyms that already have a city or country stored as text
**When** the backfill runs
**Then** each is mapped to a city by alias normalization (accents, spelling, case); unmapped gyms keep `city_id` null, are listed for Super Admin, and are never published to the directory until mapped (the 24.8 gate requires a city)

**Given** the Owner or Supervisor's gym profile address
**When** they choose a country and city
**Then** the city control offers only the controlled list for that country, a typed alias resolves to its city, and an unknown city shows "ask GymOS to add it" without free-text entry

**Given** a Super Admin
**When** they add or edit a city with aliases
**Then** the change is audited, slug collisions are refused with a typed error, and renaming a city never changes the stored `city_id` of any gym

**Given** a city is renamed or its slug changes
**When** the change is saved
**Then** a trigger re-snapshots every dependent gym page (AD-49), the old slug is kept in `city_slug_history` and 301-redirects for 12 months, and an alias already resolving to another city in that country is refused (unique `(country_code, alias_norm)`)

**Given** a gym's country or city is changed after publishing
**When** the 24.8 trigger runs
**Then** the page is re-snapshotted if the gate still holds and the old listing stops including the gym within the AD-46 freshness bound

---

### Story 25.2: Directory Views & Listing Correctness

As a visitor,
I want listings that only show gyms that are actually live,
So that every gym I find can be opened and contacted.

*Delivers FR-210 (data), FR-212, FR-213 (filter), FR-214. AD-49. Migration at merge time (views and grants only).*

**Acceptance Criteria:**

**Given** `public_site.directory_country`, `directory_city` and `directory_gym`
**When** they are queried as `public_site_reader`
**Then** they are built only from the AD-46 visibility predicate joined to `cities`, expose no internal identifier, and add no new privilege beyond the view list (the 24.4 grant test still passes and its snapshot is updated deliberately); `directory_city` also exposes the city's `lat` and `lng` (null when unset) and no gym position

**Given** a listing with fewer than 3 published gyms `[ASSUMPTION — OQ-29]`
**When** `indexable` is read
**Then** it is false, computed in the view from one constant in one place, and no counter column exists

**Given** a gym that unpublishes, is taken down or is suspended
**When** any listing view is read
**Then** the gym is absent and `published_count` reflects it immediately (FR-214), tested for each of the three cases

**Given** a category filter
**When** the view is queried with a category code
**Then** it returns only gyms of that category, and a category change by Owner, Supervisor, Manager or support (audited since 21.1) re-snapshots the page and moves it between filtered results within the freshness bound

**Given** a country with one published gym and no city with a gym
**When** the views are read
**Then** the country is listed (FR-210: any published gym regardless of country) and nothing assumes Cameroon

---

### Story 25.3: Directory Pages — Country, City, Category Filter

As a visitor,
I want to browse gyms by country and city and filter by type,
So that I can find a place to train near me.

*Delivers FR-210, FR-213. AD-50. Runs on `www.` in `apps/landing`; reads only the 25.2 views.*

**Acceptance Criteria:**

**Given** `/{locale}/gyms/`
**When** it renders
**Then** it lists each country with at least one published gym, with Cameroon as the only prominent entry point at launch and no Cameroon-only wording, address format or structured data

**Given** `/{locale}/gyms/` with published gyms in cities that have coordinates
**When** it renders
**Then** *(MOVED to Story 25.7 at the 25.3 size gate, 2026-11-12; 25.3 ships the hero as copy only and keeps one free column from 1024 px for the map)* its hero draws one Africa map as an inline SVG generated at build time from Natural Earth (public domain; provenance recorded), with one dot per city that has a published gym, radius growing with the gym count, each dot a link to that city's page; the page makes no request to a third party and runs no script (AD-44)
**And** the map is `aria-hidden` with its links out of the tab order, because the country cards carry every link; a city without coordinates has no dot but is listed; gyms in countries outside the map are listed and counted; with no published gym anywhere no map is drawn
**And** no country has its own map or any highlight, and the country and city pages carry no map
**And** the home page carries no directory content beyond a "Gyms" link in header and footer (the directory is its own pages)

**Given** `/{locale}/gyms/{country}/` and `/{locale}/gyms/{country}/{city}/` where `{country}` is the lowercase ISO alpha-2 code and `{city}` the city slug, the same in both locales
**When** they render
**Then** they list the gyms (name, category label, city, link to the gym's canonical subdomain page), carry `hreflang` alternates for `en` and `fr` plus `x-default`, and a self-referencing canonical

**Given** `?category=<code>`
**When** a filtered view renders
**Then** it shows only that category, its canonical points to the unfiltered listing, it carries no `noindex` (a canonical is the single signal), and it is excluded from the sitemap

**Given** a listing whose single `indexable` flag is false
**When** it renders
**Then** it still serves with `noindex` in both the meta tag and the `X-Robots-Tag` header and is excluded from the sitemap (25.5); the same boolean drives both, tested together

**Given** the country names seeded by 25.1 from `Intl.DisplayNames` (short forms such as "Congo - Kinshasa", "Antigua & Barbuda", "St. Barthélemy")
**When** they are shown as directory headings, card titles or structured-data values
**Then** each name shown has been reviewed for a public heading in both languages, and any that reads badly is corrected by a migration before this story ships (deferred from 25.1 review)

**Given** the page chrome
**When** it renders in `en` or `fr`
**Then** labels come from the dictionary, city and gym names are shown as entered, and responses carry `s-maxage` no greater than 300

**Given** the response headers
**When** the Epic 24 header test runs against these routes
**Then** the same script-free policy of AD-44 applies and no cookie is set

---

### Story 25.4: Structured Data Serializer & Validation

As a gym Owner,
I want search engines to understand my page and listing,
So that my gym shows up with the right name, place and hours.

*Delivers FR-211 (structured data). AD-51, AD-48. No migration.*

**Acceptance Criteria:**

**Given** the serializer in `packages/page-templates`
**When** a gym page renders
**Then** it emits one `HealthClub` JSON-LD object with `name`, `url`, `image`, `telephone`, `address` (`PostalAddress`), `geo` only when a map position exists, and `openingHoursSpecification` from the stored hours, via `JSON.stringify` with `<`, `>` and `&` escaped

**Given** a directory listing
**When** it renders
**Then** it emits an `ItemList` of `ListItem` entries pointing at the gyms' canonical URLs

**Given** fixtures covering a full gym, a gym with no map position, a gym with no hours, and gym text containing `</script>` and HTML
**When** CI validates them against the schema.org definitions and the required-property tests
**Then** all pass with zero errors and the hostile text appears only as escaped data

**Given** the AD-44 policy `script-src 'none'`
**When** a page with JSON-LD is rendered
**Then** the data block is present and no script executes (verified in the header test)

**Given** social-sharing metadata
**When** a page renders
**Then** `og:title`, `og:description`, `og:image` (the opaque derivative key) and `og:url` are present and use only published fields

---

### Story 25.5: Sitemaps, Robots & Plain-Text Summary

As a search engine or AI crawler,
I want an accurate list of what to index and a plain-text summary,
So that I find every live gym and never a removed one.

*Delivers FR-211 (sitemap, summary), FR-212, FR-214. AD-52, AD-50, AD-46. No migration. Replaces the earlier "combined index" design after the Step 3 review.*

**Acceptance Criteria:**

**Given** the per-gym `/sitemap.xml` and `/robots.txt` delivered in 24.11
**When** this story ships
**Then** they are unchanged and still pass the 24.11 tests, and the `www.` sitemap index below does not list any gym page

**Given** `www.`'s `/sitemap-index.xml` (an explicit route)
**When** it is requested
**Then** it lists chunk URLs `/sitemaps/{n}.xml` of at most 50,000 URLs each containing only `indexable` listings and marketing pages and no gym page and no filtered view, and a test requests the index and every `<loc>` and asserts each returns 200

**Given** the proxy path allowlist (AD-50)
**When** a gym host is asked for `/llms.txt`, `/sitemap-index.xml`, `/{locale}/gyms/…` or any other path
**Then** it returns the uniform not-found, and every canonical and `og:url` is built from the constant origin, never the request `Host`

**Given** `GET /llms.txt` on `www.`
**When** it is requested
**Then** it returns plain text listing each published gym's name, category, city, hours and public plans from the same views, contains no field outside the AD-46 projection, and is documented as a voluntary hint and not an access control

**Given** an unpublish, takedown or suspension
**When** the next request after the `s-maxage` window arrives
**Then** the gym's sitemap, the listing and the plain-text summary no longer include it (within the FR-207 15-minute bound `[ASSUMPTION]`), and a thin listing never appears in the index

---

### Story 25.6: Directory Gate — SEO Verification & Removal Timing

As the product owner,
I want evidence that the directory is correct, indexable where it should be and clean when gyms leave,
So that launching discovery cannot publish a removed gym or misleading markup.

*Delivers the Step 3 release gate (PRD §10.2) for FR-211–FR-214 and NFR-025. Product-owner run; mostly checks and a checklist.*

**Acceptance Criteria:**

**Given** one staging gym page and one listing
**When** the Rich Results Test and the schema.org validator run on their public URLs
**Then** both report zero errors, and the results are recorded in `docs/decisions.md`

**Given** Google Search Console for `www.` and one gym subdomain
**When** each host's own sitemap is submitted
**Then** the entry records that both are accepted and which gym page and listing URLs are discovered, resolving the AD-52 `[ASSUMPTION]`

**Given** a staging gym that unpublishes, is taken down, and is suspended in turn
**When** timings are measured
**Then** the page, the listing, the sitemap and the plain-text summary each drop it within the FR-207 bounds (origin ≤ 60 s, CDN ≤ 5 min, sitemap ≤ 15 min), recorded per case

**Given** the directory and listings with a realistic seed
**When** a field-style measurement runs on a mid-range Android profile over 4G
**Then** p75 LCP is recorded against the 3 s target (NFR-025 `[ASSUMPTION]`)

**Given** the E2E baseline (NFR-015)
**When** the suite runs
**Then** it covers browse by country and city, category filter, thin-listing `noindex`, and removal on unpublish, in English and French

---

### Story 25.7: Directory Africa Map & Old City-Slug Redirects

As a visitor,
I want the directory's top page to show where gyms are and an old city link to keep working after a rename,
So that I can find a place to train at a glance and never meet a dead link.

*Split out of 25.3 (size gate, 2026-11-12, owner decision) and of 25.1 (the 301 promise). Review of 25.3 found both items had no story to carry them. Not a prerequisite of 25.6; close it before the first city is renamed in production.*

**Acceptance Criteria:**

**Given** `/{locale}/gyms/` with published gyms in cities that have coordinates
**When** it renders
**Then** its hero draws one Africa map as an inline SVG generated at build time from Natural Earth 110 m (public domain; provenance recorded; generator script, committed generated module, local Natural Earth projection proven equal to d3), with one dot per city that has a published gym, radius growing with the gym count, each dot a link to that city's page; labels are CSS-only, the halo is dropped under `prefers-reduced-motion`, a caption names the map; the page makes no request to a third party and runs no script (AD-44)
**And** the map is `aria-hidden` with its links `tabindex=-1`, because the country cards carry every link; a city without coordinates has no dot but is listed; gyms in countries outside the map are listed and counted; with no published gym anywhere no map is drawn
**And** no country has its own map or any highlight, and the country and city pages carry no map (`DESIGN.md` "Africa map")

**Given** a city renamed within the last 12 months (`city_slug_history`)
**When** `/{locale}/gyms/{cc}/{old-slug}` is requested
**Then** it answers a 301 to the current city URL in one hop with cache lifetime of 5 minutes at most, through a fourth `public_site` view that exposes only the redirect (the reader role reads no base table), with the grant test updated to name it
**And** after 12 months, or for a slug that was never a city's, the answer is the uniform not-found

## Epic 1: Platform Foundation & Gym Onboarding

GymOS staff can create a new gym tenant end-to-end — the owner logs in, configures branding and settings, and the platform enforces strict per-gym data isolation from day one. Delivers UJ-5 (Chidi onboards a new gym) in full.

### Story 1.1: Monorepo & Starter Initialization

As a developer,
I want the monorepo scaffolded with Turborepo, both Next.js dashboards, and the Expo mobile app,
So that all three apps share a consistent structure and can be developed together from day one.

**Acceptance Criteria:**

**Given** a fresh repository
**When** `pnpm dlx create-turbo@latest` and the per-app starter commands are run
**Then** `apps/dashboard`, `apps/super-admin`, `apps/mobile`, and `packages/types` exist per the architecture's directory structure
**And** `turbo dev` runs all three apps plus local Supabase (via local Docker) concurrently
**And** a GitHub Actions workflow exists running TypeScript checks on every push

### Story 1.2: Supabase Region Verification Spike

As a developer,
I want to measure RTT from a Cameroonian mobile network against EU West Ireland vs. Frankfurt,
So that the Supabase Cloud project's region is locked in before any data is written and the <3s front-desk alert budget stays achievable.

**Acceptance Criteria:**

**Given** candidate regions EU West Ireland and Frankfurt
**When** RTT is measured from a representative Cameroonian mobile network
**Then** the lower-latency region is selected
**And** the outcome is recorded in `docs/decisions.md`
**And** the Supabase Cloud project is not created until this decision is recorded (region cannot change after data is written; local Docker-based dev from Story 1.1 is unaffected)

### Story 1.3: Tenant Isolation Foundation — JWT Claims Hook & RLS Deny-All

As a platform operator,
I want every table protected by RLS with a working JWT gym/role claims hook,
So that gym data can never leak across tenants, even before any feature-specific policy exists.

**Acceptance Criteria:**

**Given** a new migration creates a tenant-scoped table
**When** the migration runs
**Then** RLS is enabled with a deny-all default in that same migration (no "open table" window)
**And** the `auth.gym_id()` helper function exists and is `STABLE`

**Given** the JWT claims hook is installed
**When** a known test tenant logs in
**Then** a pgTAP canary test asserts they see a non-zero, correctly-scoped row count

**Given** the claims hook is misconfigured or a claim is missing
**When** a user logs in
**Then** access defaults to deny-all (fails closed)
**And** the denial is logged to Sentry

### Story 1.4: Append-Only Audit Log Foundation

As a platform operator,
I want the audit log to exist and be structurally impossible to alter from the very first sensitive action onward,
So that every subsequent epic can log to it, and the audit trail is trustworthy from day one.

**Acceptance Criteria:**

**Given** the `audit_log` table
**When** it is created (alongside the other core tables, before any feature epic ships)
**Then** no role — including Super Admin and `service_role` — has UPDATE or DELETE grants on it, enforced at the grant level beneath RLS

**Given** any migration, script, or application code
**When** it attempts an UPDATE or DELETE against `audit_log`
**Then** the operation fails

**Given** the table's columns
**When** a record is written
**Then** it captures actor (user ID + display name), action type, target entity ID, relevant fields (amount/method/reason as applicable), and a UTC timestamp — the shape every later story's "audit-logged" acceptance criteria writes against

### Story 1.5: Super Admin — Create & Onboard a Gym

As GymOS platform staff (Super Admin),
I want to create a new gym record and owner account,
So that a new customer gym can be onboarded and its owner can access the platform.

**Acceptance Criteria:**

**Given** the Super Admin Gyms page
**When** I fill in gym name, owner name, owner phone, and subscription tier, then submit
**Then** a gym record and owner account are created, the gym appears in the Gym List, and the owner receives an SMS with login instructions

**Given** a gym name that already exists on the platform
**When** I submit the Create Gym form
**Then** I see an inline error
**And** no record is created

**Given** a newly created gym set to Active status
**When** the owner logs in for the first time
**Then** they land on their own gym's dashboard with no visibility into any other tenant

### Story 1.6: Super Admin — Tier Management & Gym Lifecycle

As GymOS platform staff,
I want to manage subscription tiers and suspend, deactivate, or reinstate gyms,
So that I can adjust pricing and handle account lifecycle without a code deployment.

**Acceptance Criteria:**

**Given** the Tier Management page
**When** I create, edit, or delete a tier
**Then** the change takes effect immediately for new gym assignments
**And** existing gyms are not automatically reclassified

**Given** a tier currently assigned to one or more gyms
**When** I attempt to delete it
**Then** deletion is blocked with an error naming the affected gym count

**Given** an active gym
**When** I suspend, deactivate, or reinstate it and provide a reason
**Then** the status change is reflected in the Gym List
**And** the action is audit-logged

**Given** the Platform Metrics page
**When** I view it
**Then** total gyms, total members, and total payments processed are displayed as platform-wide aggregates

### Story 1.7: Super Admin — Escalated Gym Data Access

As GymOS platform staff,
I want to access a specific gym's member or payment data only through an explicit escalation,
So that routine platform administration never silently exposes tenant data.

**Acceptance Criteria:**

**Given** a Gym Detail page with no active escalation
**When** I view the page
**Then** I cannot see individual member or payment records for that gym

**Given** I click "Access gym data" and enter a mandatory reason
**When** I submit
**Then** access is granted
**And** the escalation is audit-logged with my identity, the reason, and a timestamp

### Story 1.8: Gym Owner Login & Role-Filtered Dashboard Shell

As a Gym Owner, Manager, Receptionist, or Coach,
I want to log into my gym's admin dashboard and see only the navigation my role permits,
So that I can access exactly the tools relevant to my job.

**Acceptance Criteria:**

**Given** valid email/password credentials
**When** I log in
**Then** I land on the Overview page with a sidebar showing only the nav items my role can access (absent, not disabled, for inaccessible items)

**Given** invalid credentials
**When** I submit the login form
**Then** an inline error appears below the password field
**And** no session is created

**Given** I am logged in as a Coach
**When** the dashboard renders
**Then** only the "Coach Portal" link appears in the sidebar

### Story 1.9: Gym Branding & Operational Settings

As a Gym Owner,
I want to configure my gym's branding and operational settings,
So that the dashboard and member app reflect my gym's identity and policies.

**Acceptance Criteria:**

**Given** the Settings page
**When** I upload a logo and set a primary hex color, then save
**Then** the dashboard sidebar/nav reflects the new branding immediately
**And** the change is available for the member app's next branding-cache refresh (24h)

**Given** I set timezone, default language, grace period duration, gym capacity, and alert auto-dismiss duration
**When** I save
**Then** all values persist and are available to downstream features (subscription lifecycle, front-desk alerts)

**Given** I click "Regenerate QR code"
**When** I confirm the warning dialog
**Then** the old code is invalidated immediately
**And** a new one is generated and downloadable

### Story 1.10: Bilingual (EN/FR) Platform Foundation

As a platform user,
I want every screen available in English and French,
So that I can use GymOS in my preferred language from day one.

**Acceptance Criteria:**

**Given** the i18n library is wired into both Next.js dashboards
**When** a PR introduces a hardcoded UI string
**Then** CI fails the build

**Given** the EN and FR locale files
**When** either file is missing a key present in the other
**Then** CI fails with a key-parity error

**Given** a user selects a language preference
**When** they navigate any screen
**Then** all strings render in the selected language with no missing-string fallback
**And** the preference persists across devices

## Epic 2: Member Onboarding & Management

Owners and Managers can add, invite, import, and manage members and plans; a new member completes phone-OTP onboarding into the branded mobile app and lands on their assigned plan. Delivers UJ-1 (Kwame's first login) through plan confirmation.

### Story 2.1: SMS/OTP Provider Sandbox Spike

As a developer,
I want to validate `TwilioSmsProvider` (behind an `OtpDeliveryProvider` interface) against real Cameroon phone numbers,
So that member phone verification is proven to work before the onboarding epic is built on top of it.

**Acceptance Criteria:**

**Given** a Cameroonian test phone number
**When** an OTP is requested through Supabase's Send SMS Hook → `TwilioSmsProvider`
**Then** the SMS arrives and the code verifies successfully
**And** the outcome is recorded in `docs/decisions.md`
**And** if the spike fails, no onboarding-flow code ships until an alternative provider is validated and documented

### Story 2.2: Membership Plan Configuration

As a Manager or Owner,
I want to configure my gym's membership plans,
So that members can be assigned pricing and billing terms specific to my gym.

**Acceptance Criteria:**

**Given** the plan configuration UI
**When** I create a plan of type Pay-per-session, Monthly, Coach-inclusive, or Class-only
**Then** I can set its name, price in XAF, duration, access type, and billing interval (monthly or annual)

**Given** an annual billing interval
**When** I set an annual price
**Then** the gym-configured discount is reflected and stored independently of tier/price fields

**Given** any monetary field
**When** it is stored
**Then** it is an integer XAF value with an explicit `currency` column — never a float

### Story 2.3: Manager/Owner — Create, Edit & Deactivate Members

As a Manager or Owner,
I want to create, edit, and deactivate member records,
So that I can maintain an accurate member roster without ever losing history.

**Acceptance Criteria:**

**Given** the Members page
**When** I create a member with name, phone, and a plan configured in Story 2.2, plus optional email, date of birth, profile photo, and emergency contact
**Then** a member record is created with join date and subscription status, and appears in the Members list

**Given** the gym is at its tier's member cap
**When** I attempt to create another member
**Then** creation is blocked with "You've reached your plan limit ([N]/[Max] members). Contact GymOS to upgrade." — enforced both as a fast-fail check in the create action and as a database trigger backstop

**Given** an existing member
**When** I deactivate them and provide a mandatory reason
**Then** their subscription is set to `expired`, they lose check-in access, they retain app history access, no automated push is sent, and the action is audit-logged

**Given** the Members page
**When** I search by name or phone, or filter by subscription status
**Then** the list updates accordingly (300ms debounce), and I can export the current filtered view to CSV (max 1,000 rows, standard export columns)

**Given** a Receptionist (not Manager/Owner)
**When** they view the Members page
**Then** they can search, filter, view, and export records but cannot see create/edit/deactivate actions

### Story 2.4: CSV Member Import

As a Manager or Owner,
I want to bulk-import members via a standardized CSV template,
So that I can onboard an existing member base without manual entry.

**Acceptance Criteria:**

**Given** the CSV Import modal
**When** I download the template and upload a filled CSV
**Then** all rows are validated before any are written

**Given** any row fails validation (e.g., invalid phone format, unconfigured plan_type, missing expiry_date for a non-session plan)
**When** I submit
**Then** the entire import is rejected, zero records are written, and each failing row shows its row number and reason

**Given** a CSV with all rows valid
**When** I confirm the import
**Then** all members are created with a clean history (no historical payments/attendance migrated)

### Story 2.5: Member Invitation via Deep Link

As a Manager or Owner,
I want to send a new member a personalized invitation,
So that they can install the app with their phone number pre-associated.

**Acceptance Criteria:**

**Given** a newly created member record
**When** I click "Send Invite"
**Then** a message containing the member's name, gym name, and a deep link is generated for me to copy or share via SMS/WhatsApp

**Given** the member taps the deep link
**When** the app opens (or falls back to the Play Store/App Store)
**Then** the deep link's phone number is available to pre-associate at the OTP step (the onboarding screen itself is delivered in Story 2.6)

### Story 2.6: Member App — Phone/OTP Onboarding Through Profile Setup

As a new gym member,
I want to verify my phone number and set up my profile,
So that I can access my gym's branded app.

**Acceptance Criteria:**

**Given** the app's first launch
**When** I select a language, enter my phone number, and receive an OTP
**Then** I can enter the 6-digit code and it auto-submits on the 6th digit

**Given** a deep link from a Manager/Owner invite (Story 2.5)
**When** the app opens via that link
**Then** the OTP screen is the first screen shown, with the phone number from the deep link pre-associated

**Given** 3 failed resend attempts
**When** I request a 4th resend
**Then** I am routed to a 5-minute lockout screen with back-navigation disabled

**Given** OTP verification succeeds for a new account
**When** I proceed
**Then** I set my name and optional photo (profile setup)

**Given** a phone number that already has a platform user account from a different gym
**When** that phone verifies successfully at a new gym
**Then** a new `members` row is created for this gym, linked to the same existing platform user account — no duplicate account is created

### Story 2.7: Member App — Goal, Experience & Plan Confirmation

As a new gym member,
I want to set my fitness goal and experience level and confirm my assigned plan,
So that my coach has context and I understand my membership terms.

**Acceptance Criteria:**

**Given** profile setup is complete
**When** I select a goal (Lose Weight / Build Muscle / Improve Fitness / General Wellness) and an experience level (Beginner / Intermediate / Advanced)
**Then** both are saved to my profile and visible to my assigned coach (once assigned)

**Given** my gym's pre-assigned plan
**When** I view the Plan Confirmation screen
**Then** I see plan name, duration, price in XAF, activation date, and expiry date as read-only

**Given** I tap "Confirm and start"
**When** the request succeeds
**Then** my onboarding data is saved, I'm marked as fully onboarded, and I land on a confirmation/landing state (the full Home screen experience — status badge, quick actions, recent activity — is delivered in Epic 3, Story 3.7)

**Given** a network failure on confirm
**When** the save fails
**Then** an inline error appears with a retry option and I remain on the confirmation screen

### Story 2.8: Member Self-Service Profile Management

As a member,
I want to view and edit my own profile,
So that I can keep my display name, photo, and language preference current.

**Acceptance Criteria:**

**Given** the Profile screen
**When** I edit my name or upload a new photo
**Then** the change saves and displays immediately

**Given** I attempt to change my phone number
**When** I look for that option
**Then** it is not editable from the app — the screen states "Contact your gym to change your number"

**Given** I switch my language toggle (EN/FR)
**When** I do so
**Then** the app re-renders in the new language immediately without requiring re-login

### Story 2.9: Evolution API Sandbox Spike & OTP Provider Fallback Chain

> **Note:** Backfilled 2026-08-13 — this story was originally raised via `sprint-change-proposal-2026-08-08.md` Section 4.4 (approved) and shipped without an `epics.md` header (documentation-drift gap flagged in `sprint-status.yaml`). Added here verbatim from the approved proposal so downstream tooling that parses `epics.md` can resolve it. The story file `_bmad-output/implementation-artifacts/2-9-evolution-api-sandbox-spike-otp-provider-fallback-chain.md` and `ARCHITECTURE-SPINE.md`'s AD-11/AD-12 remain the authoritative source for implementation detail.

As a developer,
I want to validate Evolution API against a real send/receive round-trip and wire it into an ordered fallback chain ahead of the existing Twilio/sent.dm providers,
So that OTP delivery gains a lower-friction primary channel without weakening reliability if it's unavailable.

**Acceptance Criteria:**

**Given** the already-running Evolution API instance
**When** I send a test OTP-shaped message and confirm delivery
**Then** the outcome is recorded in `docs/decisions.md` (send succeeds, response shape confirmed, instance-disconnect behavior observed and documented)

**Given** the spike passes
**When** `EvolutionApiProvider` (implements `OtpDeliveryProvider`) is added to `send-sms-hook`
**Then** the `OTP_PROVIDER` env var is retired, and the hook tries providers in order — Evolution API → Twilio WhatsApp → Twilio SMS → sent.dm — advancing to the next on any failure

**Given** the Evolution API instance is disconnected or misconfigured
**When** an OTP is requested
**Then** the chain falls through to Twilio WhatsApp (then SMS, then sent.dm) and the OTP still arrives

**Given** the spike fails
**When** that occurs
**Then** Evolution API is not added to the chain until a fix is validated and documented — the existing three-provider chain (Twilio WhatsApp → Twilio SMS → sent.dm) ships and remains the production path

### Story 2.10: Automated Member Invite via Evolution API

> **Note:** Backfilled 2026-08-13 — raised via `sprint-change-proposal-2026-08-08.md` Section 4.5 as a revision to Story 2.5, then re-tracked as an independent story (`2-10`) per `sprint-change-proposal-2026-08-11.md`'s correct-course decision, leaving Story 2.5 above as a historical record of the original manual-only flow. Depends on Story 2.9's `EvolutionApiProvider`/chain infrastructure.

As a Manager or Owner,
I want member invitations to send automatically via the Evolution API WhatsApp gateway instead of requiring a manual copy/share step,
So that onboarding a new member takes one click, with the original manual flow retained only as a fallback.

**Acceptance Criteria:**

**Given** a newly created member record
**When** I click "Send Invite"
**Then** the system automatically sends the personalized invitation (member's name, gym name, deep link) via WhatsApp through the Evolution API gateway — no manual copy/share step required

**Given** the automated send succeeds
**When** it completes
**Then** the dashboard shows a confirmation ("Invite sent to [name] via WhatsApp")

**Given** the automated send fails (Evolution API unreachable, instance disconnected)
**When** the failure occurs
**Then** the dashboard shows an inline error and offers the existing manual copy/share-via-WhatsApp flow as a fallback — the same UI Story 2.5 originally shipped, now demoted to a fallback path rather than the primary flow

**Given** a member who was already sent an invite (successfully or not)
**When** Manager/Owner clicks "Send Invite" again from the member's row
**Then** a new automated send attempt is made via Evolution API (same success/failure/fallback behavior as the original send) — resending is not blocked or rate-limited beyond what Evolution API itself enforces

**Given** the member taps the deep link (unchanged from original)
**When** the app opens (or falls back to the Play Store/App Store)
**Then** the deep link's phone number is available to pre-associate at the OTP step

## Epic 3: Subscription Lifecycle & Attendance

Subscriptions automatically progress through active → expiring_soon → grace_period → expired; members check in via QR; occupancy and attendance are tracked and auto-closed.

### Story 3.1: Subscription Lifecycle Cron Job

As a Manager or Owner,
I want member subscriptions to automatically transition through their lifecycle states,
So that I don't have to manually track every member's expiry.

**Acceptance Criteria:**

**Given** a member's expiry date is 7 days away
**When** the nightly pg_cron job runs at 02:00 Africa/Douala
**Then** their status transitions to `expiring_soon`

**Given** a member's expiry date has passed
**When** the job runs the next day
**Then** their status transitions to `grace_period` for the gym-configured duration (default 3 days)

**Given** a member's grace period has ended without renewal
**When** the job runs
**Then** their status transitions to `expired`, they lose gym access, and they retain app account/history

**Given** the job fails (timeout or infrastructure error)
**When** the failure occurs
**Then** it is logged to the audit log and surfaced as an alert on the Super Admin dashboard, with no automatic retry and no retroactive backfill on the next successful run

### Story 3.2: Manual Renewal Reset

As a Manager, Owner, or Receptionist,
I want a manual renewal to reset a member's subscription,
So that a payment or admin override immediately restores their access.

**Acceptance Criteria:**

**Given** a member in any non-active state
**When** a renewal is recorded (payment or manual override)
**Then** their subscription resets to `active` with a new expiry date based on plan duration

**Given** a renewal completes
**When** it is processed
**Then** any open front-desk alert for that member dismisses immediately and the renewal appears in their payment history immediately

### Story 3.3: QR Code Generation & Gym Token Validation

As a Gym Owner,
I want a unique, printable QR code for my gym's entrance,
So that members can check in by scanning it.

**Acceptance Criteria:**

**Given** a gym's Settings page
**When** the gym is created
**Then** a non-guessable `gym_token` UUID is generated and encoded into a downloadable/printable QR code

**Given** a member scans a QR code
**When** the token doesn't match any gym
**Then** the app shows "QR code not recognized — make sure you're scanning your gym's code" and no check-in is recorded

### Story 3.4: Member Check-In & One-Open-Session Enforcement

As a member,
I want to check in by scanning my gym's QR code,
So that my visit is recorded without paperwork.

**Acceptance Criteria:**

**Given** a valid gym QR scan and no open check-in for this member
**When** the scan completes
**Then** an attendance event is recorded and a success confirmation is shown

**Given** a member already has an open check-in
**When** they scan again
**Then** the second scan is rejected with "You're already checked in," enforced via a partial unique index

**Given** a member has a stale open check-in (e.g., from an app crash)
**When** they scan again
**Then** the system auto-closes the stale check-in at `original_check_in_time + timeout_duration`, records the new check-in, and logs the auto-close to the audit log

### Story 3.5: Check-Out — Manual & Auto-Timeout

As a member or receptionist,
I want check-ins to close automatically or on demand,
So that attendance duration and current occupancy stay accurate.

**Acceptance Criteria:**

**Given** an open check-in
**When** the member or a receptionist triggers check-out
**Then** `checked_out_at` is set to the current time

**Given** an open check-in exceeds the gym's configured auto-timeout (default 8 hours)
**When** the same pg_cron job runs
**Then** the session is auto-closed

**Given** the cron job runs late
**When** it next runs successfully
**Then** overdue open sessions are closed at that time

### Story 3.6: Occupancy Display & Admin Attendance Page

As a Gym Owner, Manager, or Receptionist,
I want to see current occupancy and a filterable attendance log,
So that I understand gym activity in real time.

**Acceptance Criteria:**

**Given** the gym's configured capacity and current checked-in count
**When** occupancy is calculated
**Then** the member-facing app shows one of three bands (Low <30%, Medium 30–70%, Busy 71–90%), never raw counts or the 91%+ "Full" state

**Given** the Attendance dashboard page
**When** I view it
**Then** I see currently checked-in members, today's attendance count, and a check-in/check-out log filterable by date and member

### Story 3.7: Member App — Home Screen & Status Display

As a member,
I want my home screen to show my subscription status and quick actions,
So that I know where I stand at a glance.

**Acceptance Criteria:**

**Given** my subscription status
**When** I open the Home screen
**Then** I see a status badge (Active/Expiring Soon/Grace Period/Expired/No Active Plan), my plan name, expiry date, and quick actions for Check In and View Plan

**Given** my status is `expired`
**When** the Home screen renders
**Then** the "Check In" quick action is replaced with "See front desk"

**Given** I have recent check-in activity
**When** the Home screen loads
**Then** the last 2–3 check-in events are shown, tappable through to check-in history (the feed is extended to include payment events in Epic 4, Story 4.9, once payment records exist)

### Story 3.8: Member App — Check-In Result States

As a member,
I want clear feedback after scanning the gym QR,
So that I know immediately whether I've been let in.

**Acceptance Criteria:**

**Given** a successful online check-in
**When** the scan completes
**Then** a green confirmation with timestamp is shown and auto-dismisses after 2.5 seconds

**Given** a successful offline check-in
**When** the scan completes without connectivity
**Then** a green confirmation with a "syncing" indicator is shown, and the check-in syncs when connectivity resumes

**Given** an expired (beyond grace) member scans
**When** the server rejects the check-in
**Then** a full-screen red "Access denied" state is shown that does not auto-dismiss

### Story 3.9: Member App — Offline Check-In Queueing

As a member without connectivity,
I want my check-in to still work,
So that a bad signal at the gym doesn't block my entry.

**Acceptance Criteria:**

**Given** no network connectivity
**When** I scan the gym QR
**Then** the check-in is recorded locally in SQLite and a success state is shown immediately

**Given** connectivity resumes
**When** the queued check-in syncs
**Then** it reaches the server; if the auto-timeout window has already passed, the server sets `checked_out_at` to `scan_time + timeout_duration`; the check-in event this produces is timestamped at sync time, not scan time (front-desk alerting on this event is Epic 4, Story 4.6's concern)

### Story 3.10: Member App — Plan Details & Check-In History

As a member,
I want to view my plan details and past check-ins,
So that I can track my own attendance and membership terms without asking the front desk.

**Acceptance Criteria:**

**Given** the History screen's Check-ins tab
**When** I view it
**Then** it shows a reverse-chronological, paginated list of my check-ins, or "No check-ins yet. Scan the QR at your gym to get started." if empty

**Given** the Plan Details screen
**When** I view it
**Then** I see plan type, price, duration, active-from date, expiry date, and billing interval as read-only

**Note:** The History screen's Payments tab and the Payment Detail (receipt) view are delivered in Epic 4 (Story 4.9), once payment records exist.

## Epic 4: Payments & Front-Desk Retention Alert

Receptionists collect and reconcile mobile-money and manual payments; the real-time front-desk alert fires the instant an at-risk member checks in, with a 3-tap renewal flow. Delivers UJ-2a/UJ-2b (the renewal moment) and UJ-3 (Nadia's reconciliation, partially — full audit trail in Epic 7).

### Story 4.1: Notch Pay Sandbox Spike

As a developer,
I want to validate Notch Pay's sandbox (auth, initiate, webhook, idempotency) before building on it,
So that the Payments Epic doesn't start on an unverified provider.

**Acceptance Criteria:**

**Given** the Notch Pay sandbox
**When** I run auth, a payment initiation, and a webhook round-trip
**Then** sandbox auth succeeds, initiation returns a reference, and the webhook is received and processed

**Given** a duplicate webhook delivery
**When** it's replayed
**Then** the idempotency test passes — no duplicate payment record is created

**Given** the spike fails any exit criterion
**When** that occurs
**Then** no payment code ships until an alternative integration is validated and documented in `docs/decisions.md`

### Story 4.2: Notch Pay Payment Integration

As a member or receptionist,
I want to pay via MTN Mobile Money or Orange Money through Notch Pay,
So that renewals can be completed without handling cash.

**Acceptance Criteria:**

**Given** the `PaymentProvider` interface
**When** Notch Pay is wired in as the concrete implementation
**Then** a payment can be initiated, and its webhook is verified for signature validity before any DB write (unsigned/invalid payloads are rejected with HTTP 401)

**Given** a webhook is delivered twice for the same transaction reference
**When** both are processed
**Then** only one payment record exists (enforced via a unique constraint on the provider transaction reference)

**Given** a successful payment
**When** it completes
**Then** a receipt is generated with member name, gym name, plan, amount, currency, method, date, transaction reference, and actor

**Given** Notch Pay charges a transaction fee
**When** a payment is processed
**Then** the fee is passed through to the gym by default — the platform does not absorb it, and no member-facing surcharge option exists in V1

### Story 4.3: Manual Payment Entry & Verification Queue

As a Receptionist or Manager,
I want to record cash, bank transfer, or manual mobile-money payments and have them verified,
So that non-automated payment methods are captured with a clear audit trail.

**Acceptance Criteria:**

**Given** the Record Payment form
**When** I submit method, amount, member, and a mandatory reason/note
**Then** the payment is recorded with an auto-populated actor and timestamp, and appears in the Verification Queue

**Given** the Verification Queue
**When** I view it
**Then** unverified payments are ordered by submission time, each showing member, amount, method, submitting receptionist, and reason note

**Given** a queued manual payment
**When** a Receptionist or Manager marks it Verified or flags it for review
**Then** the queue count updates and the payment's status reflects the action

**Given** a manual payment entry or a verification action
**When** either occurs
**Then** it is written to the audit log with actor, amount, method, reason, and timestamp

### Story 4.4: Payment Reconciliation & Discrepancy Flagging

As a Manager or Owner,
I want a nightly reconciliation job to flag payment discrepancies,
So that no franc goes unaccounted for.

**Acceptance Criteria:**

**Given** a Notch Pay webhook event with no matching internal payment record
**When** the nightly reconciliation job runs
**Then** it is flagged as a discrepancy on the Payments dashboard

**Given** an internal payment in `processing` status with no webhook received within 10 minutes
**When** the job runs
**Then** it is flagged as a discrepancy

**Given** an amount mismatch between a webhook payload and its internal record
**When** the job runs
**Then** it is flagged as a discrepancy with both amounts shown

### Story 4.5: Refund Recording

As a Manager or Owner,
I want to record a refund when a member disputes a payment,
So that the dispute is tracked even though the gym pays the member out-of-band.

**Acceptance Criteria:**

**Given** a disputed payment
**When** I record a refund with amount, mandatory reason, and actor
**Then** the refund is saved, timestamped, and audit-logged

**Given** V1 scope
**When** a refund is recorded
**Then** no provider-executed refund API call is triggered (recording only)

### Story 4.6: Real-Time Front-Desk Alert

As a Receptionist, Manager, or Owner,
I want an instant alert when an at-risk member checks in,
So that I can catch them before they leave without renewing.

**Acceptance Criteria:**

**Given** a member with status `expiring_soon` or `grace_period` checks in (accepted)
**When** the check-in event lands
**Then** a yellow alert publishes in real time (<3s) to all active dashboard sessions for that gym via Supabase Realtime, on both Overview and Attendance

**Given** a member with status `expired` checks in (rejected)
**When** the check-in event lands
**Then** a red alert publishes in real time to the same surfaces

**Given** multiple alerts arrive simultaneously
**When** more than 5 exist
**Then** they stack newest-on-top (max 5 visible, older scrollable within the panel)

**Given** an alert is dismissed (manually or after the gym-configured auto-dismiss duration, default 30 min)
**When** the same member scans again without having renewed
**Then** a new alert fires

**Given** an offline check-in (Story 3.9) that syncs after connectivity resumes
**When** the resulting check-in event lands at sync time
**Then** the alert fires based on the sync-time timestamp, not the original scan time — the member's at-risk status is evaluated as of when the event actually reaches the server

### Story 4.7: Inline Renewal Panel

As a Receptionist,
I want to renew a member's subscription directly from the front-desk alert,
So that I can collect payment in the same moment I catch them.

**Acceptance Criteria:**

**Given** a front-desk alert
**When** I tap "Renew"
**Then** an inline panel opens pre-populated with the member's current plan, renewal price in XAF, and today's date as the start date — no navigation away

**Given** the pre-populated panel with no changes needed
**When** I tap "Confirm Renewal"
**Then** the payment is recorded, the subscription resets to active, the alert dismisses, and the member receives push N-04 — in 3 taps total for a straight-through cash renewal

**Given** a renewal submission fails
**When** the error occurs
**Then** an inline error is shown and the panel stays open for retry

### Story 4.8: Subscriptions Page & Manual Renewal

As a Manager or Owner,
I want a dedicated Subscriptions page with manual renewal capability,
So that I can act on any member's subscription, not just ones currently checked in.

**Acceptance Criteria:**

**Given** the Subscriptions page
**When** I filter by status or plan type
**Then** the list updates accordingly, sortable by member name, status, and expiry date

**Given** a member in grace_period or expired status
**When** I select "Renew" from their row
**Then** the same Inline Renewal Panel opens, with the option to back-date the renewal start to the member's original expiry date

**Given** the filtered list
**When** I export to CSV
**Then** the export respects the same 1,000-row limit and column schema as the Members export

### Story 4.9: Member App — Payment History & Receipt Detail

As a member,
I want to view my payment history and individual receipts,
So that I can confirm what I've paid without asking the front desk.

**Acceptance Criteria:**

**Given** the History screen's Payments tab
**When** I view it
**Then** it shows a reverse-chronological, paginated list of my payments (date, plan/method, amount in XAF, status), or "No payments on record yet." if empty

**Given** a payment row
**When** I tap it
**Then** I see the full receipt: member name, gym name, plan, amount, currency, method, date, transaction reference, actor, and status — read-only, no refund action available to the member

**Given** the Home screen's Recent Activity feed (built in Epic 3, Story 3.7, scoped to check-ins only)
**When** a payment is recorded for the member
**Then** the feed is extended to show combined check-in and payment events, reverse-chronological, tappable through to this screen for payment rows

## Epic 5: Coach Portal

Coaches manage their assigned members and session notes in a fully role-gated view. Delivers UJ-4 (Fatima manages her clients).

### Story 5.1: Coach Member Assignment

As a Manager or Owner,
I want to assign members to coaches,
So that each coach only sees the clients they're responsible for.

**Acceptance Criteria:**

**Given** the Members page
**When** I assign a coach to a member who has no current coach
**Then** the assignment is saved and the member appears in that coach's portal

**Given** a member already has an assigned coach
**When** I assign a new coach
**Then** the previous assignment is ended with an `ended_at` timestamp (not deleted), and the previous coach's session notes remain visible to Owner/Manager only — not to the new coach

**Given** a member's assignment history
**When** I view it from the member's profile
**Then** all past coach assignments are queryable

**Given** any coach assignment change (new assignment or reassignment)
**When** it is saved
**Then** it is written to the audit log with actor, target member, and timestamp

### Story 5.2: Coach Portal — Assigned Member List

As a Coach,
I want to see only my assigned members,
So that my portal reflects exactly my caseload.

**Acceptance Criteria:**

**Given** I log in as a Coach
**When** the dashboard renders
**Then** only the Coach Portal is accessible — Payments, Members, Settings, and Audit Log are absent from the DOM

**Given** my assigned member list
**When** I view it
**Then** it's sortable by name and plan and shows each member's subscription status, including `expired` members (visible, not auto-notified)

**Given** a member not assigned to me
**When** I attempt to access their profile directly (e.g., by URL) or search for them
**Then** RLS blocks the query and they do not appear in my list or detail view — I can only ever see members assigned to me

**Given** I have no assigned members
**When** I view the portal
**Then** I see "No members have been assigned to you yet. Ask your manager to assign members."

### Story 5.3: Coach Portal — Member Detail & Session Notes

As a Coach,
I want to view a client's profile and add session notes,
So that I can track their progress across sessions.

**Acceptance Criteria:**

**Given** an assigned member's detail view
**When** I open it
**Then** I see name, plan, subscription status, contact info, goal, and experience level (set during their onboarding)

**Given** the session notes section
**When** I add a note
**Then** it saves with my name and a timestamp and appears at the top of the list

**Given** a note I authored
**When** I edit it
**Then** the change saves and shows "Edited [timestamp]"

**Given** a note authored by a different coach (from a prior assignment)
**When** I view the notes list
**Then** I cannot edit it (Owner/Manager can view all coaches' notes; I see only my own for editing)

## Epic 6: Push Notifications

Members receive timely, bilingual push notifications for subscription lifecycle and payment events.

### Story 6.1: Expo Push Token Registration & Cleanup

As a member,
I want my device registered to receive push notifications,
So that I get timely alerts about my membership.

**Acceptance Criteria:**

**Given** the app has notification permission
**When** it launches
**Then** an Expo push token is registered and stored per device

**Given** FCM or APNs returns a token as invalid
**When** the next delivery attempt occurs
**Then** the stale token is cleaned up automatically

### Story 6.2: Subscription Lifecycle Notifications (N-01, N-02, N-03)

As a member,
I want to be notified as my membership approaches and reaches expiry,
So that I can renew before losing access.

**Acceptance Criteria:**

**Given** a member's expiry date is 7 days away
**When** the lifecycle cron job transitions their status
**Then** push N-01 ("Membership expiring — 7 days") is sent via the `send_push_notification()` Postgres function, in the member's language

**Given** a member's expiry date is 1 day away
**When** the job runs
**Then** push N-02 is sent

**Given** a member's status transitions to `expired`
**When** the job runs
**Then** push N-03 is sent

**Given** these are lifecycle notifications
**When** a member views notification preferences
**Then** N-01–N-03 cannot be opted out of

### Story 6.3: Payment Notifications (N-04, N-05)

As a member,
I want to be notified when a payment succeeds or fails,
So that I know my membership status is up to date.

**Acceptance Criteria:**

**Given** a payment is recorded (webhook success or manual verification)
**When** the `AFTER INSERT/UPDATE` trigger on `payments` fires
**Then** push N-04 ("Payment confirmed") is sent in the member's language

**Given** a payment webhook reports failure
**When** the trigger fires
**Then** push N-05 ("Payment failed") is sent

**Given** these are payment notifications
**When** a member views notification preferences
**Then** N-04/N-05 cannot be opted out of

### Story 6.4: Notification Preferences

As a member,
I want to control which non-critical notifications I receive,
So that I'm not overwhelmed with alerts I don't want.

**Acceptance Criteria:**

**Given** the member's notification preferences (stored in `member_preferences`)
**When** they exist for non-critical categories (V1.5 items N-06/N-07)
**Then** the member can opt out from the app

**Given** all notification copy
**When** it is sent
**Then** it is available in English and French, served per the member's language preference

## Epic 7: Audit Log & Compliance

Managers and Owners have an immutable, filterable record of every sensitive action across the platform. Delivers UJ-3 (Nadia reconciles end-of-day payments) in full.

### Story 7.1: Audit Record Coverage Verification

As a Manager or Owner,
I want confirmation that every sensitive action across the platform writes to the audit log established in Epic 1,
So that I have a complete record without any staff member having to remember to log it, and no action type was missed.

**Acceptance Criteria:**

**Given** the append-only `audit_log` table (built in Epic 1, Story 1.4)
**When** a manual payment entry, payment verification, refund, member deactivation, coach assignment change, Super Admin gym-data escalation, or pg_cron job failure occurs
**Then** an audit record is created with actor (user ID + display name), action type, target entity ID, relevant fields (amount/method/reason as applicable), and a UTC timestamp

**Given** the full list of action types required by FR-080
**When** this story is reviewed against every prior epic's stories
**Then** each action type is confirmed to already write a correctly-shaped record (no gaps left unaddressed by Epics 1, 2, 4, or 5)

### Story 7.2: Audit Log Dashboard Page

As a Manager or Owner,
I want to browse and filter the audit log,
So that I can reconstruct what happened and by whom.

**Acceptance Criteria:**

**Given** the Audit Log page
**When** I view it
**Then** it is strictly read-only — no hover-editable state, no context menu, no row selection, no edit/delete/flag buttons anywhere

**Given** the page
**When** I filter by date range and actor
**Then** the results update accordingly, paginated at 50 records per page

**Given** I am an Owner
**When** I click CSV export on the filtered results
**Then** a CSV downloads; Managers do not see this export option

## Epic 8: Front-of-House Polish — Settings Redesign, E-Ink Display Support & Mobile Visual Refresh

Raised directly by the user (2026-08-05), not derived from the original PRD — a pre-deployment visual/polish pass. The dashboard Settings page is functionally complete but visually flat with its most operationally important element (the check-in QR code) buried at the bottom; the mobile app is functionally complete but visually minimal (system font, ad hoc inline hex colors, no real dark theme). Full context and decisions locked in with the user during planning: `C:\Users\Admin\.claude\plans\peaceful-inventing-umbrella.md`.

### Story 8.1: Settings Page Redesign & QR Code Prominence

As a gym Owner or Manager,
I want the Settings page to be visually clear and to show the check-in QR code prominently at the top,
So that the QR code — the single most operationally important thing on this page — is immediately visible rather than buried at the bottom in a small thumbnail.

**Acceptance Criteria:**

**Given** the Settings page
**When** I load it
**Then** the QR Code section renders first, above Branding/Localization/Membership/Attendance/Front Desk Alerts, at a larger size (200–240px) than today's 120px

**Given** the existing manual QR regeneration flow (confirm dialog, `regenerateQrCode` server action)
**When** the page is restyled
**Then** the same confirm-dialog behavior and server action are preserved unchanged — this is a presentational-only change, no new auto-regeneration

**Given** the rest of the page's sections
**When** I view them
**Then** they render using the dashboard's existing `Card` component and `lucide-react` section icons instead of today's uniform bordered boxes, with the four numeric fields (grace period, capacity, check-in timeout, alert auto-dismiss) laid out in a responsive 2-column grid

### Story 8.2: E-Ink Display Endpoint

As a gym Owner whose front desk uses an e-ink display instead of a printed QR poster,
I want a device-pollable endpoint that returns the gym's current check-in QR code as an image,
So that the display can refresh itself without a human reprinting or re-uploading anything after a manual QR regeneration.

**Acceptance Criteria:**

**Given** a gym's `gym_token`
**When** a device sends `GET` to the new `gym-qr-display` Edge Function with that token
**Then** it receives a `200` response with `Content-Type: image/png` containing a QR code encoding that exact token, rendered server-side (no session/auth beyond the token itself — same trust model as a printed poster)

**Given** an unknown or malformed token
**When** the endpoint is polled
**Then** it returns a generic `404` with no information about why

**Given** this is the first unauthenticated endpoint outside the two existing Edge Functions (`payment-webhook`, `send-sms-hook`)
**When** the story is complete
**Then** `docs/decisions.md` records why a 3rd Edge Function was chosen over a Next.js API route, matching `architecture.md`'s "no external API surface outside Edge Functions" constraint

### Story 8.3: Mobile Design System Foundation — Dark Theme, Per-Gym Accent & Barlow Typography

As a gym member using the mobile app,
I want the app to use my gym's branded accent color on a polished dark theme with proper typography,
So that the app feels premium and reflects my specific gym's branding rather than a generic hardcoded color.

**Acceptance Criteria:**

**Given** a gym has set `gyms.primary_color` in Settings (Story 8.1's Branding section)
**When** a member of that gym opens the app
**Then** the app's accent color (buttons, active states, progress fill, selected borders) uses that gym's color; gyms with no `primary_color` set fall back to the default brand gold (`#E0971F`)

**Given** the redesigned dark theme
**When** any screen renders
**Then** colors come from `constants/theme.ts`'s token system (a filled-out `dark` variant within the existing `Colors.light`/`Colors.dark` shape, kept light-mode-extensible for a future release) rather than hardcoded inline hex

**Given** the app's headers ("Home", "Check In", etc.)
**When** they render
**Then** they use the Barlow font (bold/extra-bold, uppercase, letter-spaced) loaded via `expo-font`, gated behind the existing splash sequencing so no system-font flash occurs

### Story 8.4: Mobile Shared UI Primitives

As a developer building/maintaining the mobile app,
I want a shared library of themed UI primitives,
So that button, card, badge, progress-bar, OTP-input, and segmented-control styling isn't copy-pasted and drifting across every screen.

**Acceptance Criteria:**

**Given** the patterns already duplicated per-screen today (buttons, bordered cards, status badges, the 4-segment onboarding progress bar, the 6-box OTP entry, the History segmented control)
**When** this story is complete
**Then** each has exactly one themed implementation under `apps/mobile/src/components/ui/` (`Button`, `Card`, `Badge`, `ProgressSteps`, `OtpInput`, `SegmentedControl`), consuming Story 8.3's tokens and per-gym accent color

**Given** `OtpInput`
**When** it replaces the existing 6-box entry in `onboarding/otp.tsx`
**Then** the underlying hidden-`TextInput` auto-advance/paste-fill logic is preserved exactly — this is a restyle, not a rewrite of behavior

### Story 8.5: Mobile Screen Restyle — Tabs, Plan Modal, Tab Bar & Splash

As a gym member,
I want the Home, Check-In, History, Profile, and Plan screens to use the new design system,
So that the app's main daily-use surfaces match the new visual quality.

**Acceptance Criteria:**

**Given** `(tabs)/index.tsx`, `checkin.tsx`, `history/index.tsx`, `history/payment/[id].tsx`, `profile.tsx`, and `app/plan.tsx`
**When** restyled
**Then** they use Story 8.4's primitives and Story 8.3's tokens, with all existing data-fetching, navigation, and business logic unchanged — check-in's scan/result states keep clear green=success/red=error semantics

**Given** the native tab bar (`components/app-tabs.tsx`)
**When** restyled
**Then** only `backgroundColor`/`indicatorColor`/label colors change to the new tokens — `NativeTabs` structure/shape is not replaced (explicit user direction: no custom pill tab bar)

**Given** `components/app-tabs.web.tsx` and the splash screen (`components/animated-icon.tsx`/`.web.tsx`)
**When** restyled
**Then** the leftover "Expo Starter" placeholder branding/Docs link is replaced with real app branding, and the splash badge's Expo-blue gradient is recolored to the new brand tokens

### Story 8.6: Mobile Screen Restyle — Onboarding Flow

As a new gym member,
I want the onboarding flow (language, phone, OTP, profile, goal, experience, plan confirmation) to match the app's new visual quality,
So that first impressions of the app are polished, not the current plain/minimal styling.

**Acceptance Criteria:**

**Given** all 8 onboarding screens (`language`, `phone`, `otp`, `lockout`, `profile`, `goal`, `experience`, `plan`)
**When** restyled
**Then** they use Story 8.4's primitives (`Button`, `Card`, `ProgressSteps`, `OtpInput`) and Story 8.3's tokens/Barlow typography, with the existing step sequencing/guards (`onboarding/_layout.tsx`'s `SequencingGuard`) and all validation/submission logic unchanged

**Given** the 4-segment progress bar currently copy-pasted across `profile`/`goal`/`experience`/`plan`
**When** restyled
**Then** all four screens use the single extracted `ProgressSteps` component from Story 8.4

---

## Epic 9: Staff Management (Owner Self-Serve)

Owners and Supervisors can provision, edit, and deactivate their own staff (Supervisor, Manager, Receptionist, Coach) without a GymOS support ticket; privilege escalation is structurally impossible and role changes take effect immediately. Delivers UJ-6 (Grace staffs her gym) in full.

### Story 9.1: Staff Creation with Role-Ceiling Enforcement

As a gym Owner or Supervisor,
I want to create staff accounts for my gym with a specific role,
So that I can build out my team without contacting GymOS support.

**Acceptance Criteria:**

**Given** I am an Owner
**When** I open Settings → Staff and add a new staff member with name, E.164 phone, and role (Supervisor, Manager, Receptionist, or Coach)
**Then** `create_staff_member()` (a `SECURITY DEFINER` RPC) creates the account after checking my role against a hard target-role allowlist, and the creation is audit-logged with actor, target role, and timestamp

**Given** I am a Supervisor
**When** I attempt to create a staff member
**Then** I can create Manager, Receptionist, or Coach — the same set an Owner can create, minus Supervisor — and any attempt to create a Supervisor or Owner is rejected by the RPC's allowlist check, not merely hidden in the UI

**Given** I am a Manager
**When** I look for a way to create staff
**Then** no staff-creation UI or RPC grant is available to me at all — the RPC's allowlist has no row granting Manager any target role

**Given** any Owner or Supervisor attempting to create an Owner or Super Admin account
**When** the RPC runs
**Then** it is rejected regardless of caller role — no role may ever create an Owner or Super Admin through this path

**Given** the Settings → Staff section
**When** I view it
**Then** it lists all staff with name, role, and status (FR-120), visible to Owner and Supervisor only

### Story 9.2: Staff Activation via Temporary Password

As a newly created staff member,
I want to receive my login credentials and set my own password on first login,
So that I can access the dashboard securely without GymOS involvement.

**Acceptance Criteria:**

**Given** a staff account just created via Story 9.1
**When** the creation RPC's role-ceiling check passes
**Then** a Server Action calls `supabase.auth.admin.createUser` via the service-role admin client, the account is marked `pending_activation`, and an SMS is sent with a temporary password and the dashboard link — reusing Story 1.11's existing WhatsApp/SMS temp-password mechanism, not a new activation flow

**Given** a `pending_activation` staff account
**When** the staff member logs in with the temporary password for the first time
**Then** they are required to set a new password before reaching the dashboard, and the account transitions out of `pending_activation`

**Given** a staff account that has already completed first login
**When** they log in again
**Then** no password-reset prompt appears — the temp-password flow only triggers once

### Story 9.3: Staff Edit, Deactivation & Immediate Access Revocation

As a gym Owner or Supervisor,
I want to edit a staff member's name/role or deactivate their account, with changes taking effect immediately,
So that role changes and offboarding are secure, not dependent on the staff member's client cooperating.

**Acceptance Criteria:**

**Given** I am an Owner or Supervisor editing a staff member's role
**When** I attempt to raise their role to equal or above my own rung
**Then** the edit is rejected by `update_staff_role()`'s ceiling check (same allowlist shape as creation, FR-089) — I cannot promote a Manager to Supervisor, for example

**Given** I am an Owner or Supervisor
**When** I attempt to edit my own role
**Then** the edit is rejected outright — self-escalation is structurally impossible, not just discouraged, regardless of what role I'd be changing to

**Given** a staff member I deactivate
**When** I confirm deactivation
**Then** a mandatory reason is required, the deactivation is audit-logged with actor + reason + timestamp, and — if they're a Coach — their session notes and any authored workout plans are retained and remain visible to Owner and Manager

**Given** a role change or deactivation just saved
**When** the affected staff member's existing session makes its next request
**Then** `private.current_member_role()` and `private.current_gym_status()` (the new live-lookup helpers, AD-3) are checked at the RLS/auth-hook layer and reject the stale JWT immediately — no "next token refresh" window; this closes the gap the JWT-claims-only model (FR-003) would otherwise leave open

**Given** the pre-existing `log_audit_event()` function, which currently reads `auth.jwt() ->> 'app_role'` directly
**When** this story ships
**Then** `log_audit_event()` is updated to call `private.current_member_role()` instead, so a demoted actor's audit entries reflect their current role, not a stale claim

### Story 9.4: Multi-Gym Staff Binding Rules

As the platform,
I want to enforce that one phone number maps to exactly one role per gym,
So that a person's access at each gym is unambiguous even if they hold different roles across gyms.

**Acceptance Criteria:**

**Given** a phone number with an existing role binding at Gym A
**When** that same person is granted a role at Gym B
**Then** a separate binding is created for Gym B — the person now holds two independent role bindings, one per gym, per FR-001's one-phone-one-platform-user model

**Given** a phone number already bound to a role at a specific gym
**When** an Owner/Supervisor at that same gym assigns them a different role
**Then** the new role replaces the prior binding at that gym (not a second binding), and the replacement is audit-logged

**Given** a Coach account with no members currently assigned
**When** they log into the Coach Portal
**Then** they see an empty state reading "No members have been assigned to you yet. Ask your Manager, Owner, or Supervisor to assign members." — amending Story 5.2's copy, which predates the Supervisor role, to include all three roles that can now perform assignment-adjacent staff actions

### Story 9.5: PostHog Analytics Instrumentation

As GymOS,
I want product analytics events flowing from both the dashboard and mobile app,
So that V1.5's success metrics (Section 3.2) — beta gym self-sufficiency, non-visit-day app opens, and the rest — are measurable, not just asserted.

**Acceptance Criteria:**

**Given** the dashboard and mobile app
**When** PostHog is integrated (NFR-014)
**Then** events are routed with the same dev/staging/prod environment tagging already used for Sentry (NFR-007)

**Given** any event involving a member
**When** it is captured
**Then** it carries no body-measurement or photo content — PostHog integration ships alongside Epic 9 specifically so this constraint is enforced before Epic 10's progress-tracking events exist to violate it

**Given** the V1.5 success metrics in PRD Section 3.2
**When** instrumentation is complete
**Then** at minimum, staff-creation events (this epic), and hooks for non-visit-day app opens and beta-gym support-ticket-free weeks are wired, so later epics only need to add their own event calls, not a new analytics integration

---

### Story 9.6: Multi-Gym Session Switching *(backlog stub — added 2026-08-20, not yet elaborated via create-story)*

As a staff member who holds an active role at more than one gym (Story 9.4),
I want to choose which gym I'm acting on behalf of and switch between them without logging out,
So that I can actually do my job at both gyms, not just have the platform correctly record that I hold both.

**Context:** Story 9.4 (Multi-Gym Staff Binding Rules) makes it possible for a person to correctly hold two independent, simultaneously-active role bindings at two different gyms — but does not change how a session picks which one is "active." `custom_access_token_hook()` (`0009_auth_hook_gym_claims.sql`) has always resolved a login's `gym_id`/`app_role` claims to "the most recently created, non-deactivated membership" — a documented V1 limitation that predates Epic 9 entirely. Today, a multi-gym staff member has no way to see or act on their other gym from one logged-in session; their next login (or token refresh) silently lands them wherever their newest binding is. This story is the first to actually need to close that gap, since it's the first place multi-gym staff bindings are created in normal product use (a member's own multi-gym membership has existed since FR-001/Epic 2, but has had the identical limitation this whole time, never prioritized).

**Acceptance Criteria (draft — needs full create-story elaboration before dev):**

**Given** a staff member with 2+ active, non-deactivated `members` bindings across different gyms
**When** they log in
**Then** they are shown a gym-selection step, or the dashboard shell shows a switcher, rather than being silently routed to whichever binding happens to be newest

**Given** a logged-in multi-gym staff session
**When** they use the switcher to select a different gym they hold an active binding at
**Then** their session's `gym_id`/`app_role` claims update to that gym without a full logout/login, and every RLS-scoped query reflects the newly-selected gym immediately

**Given** a staff member with only one active gym binding (the overwhelming majority case)
**When** they log in
**Then** no switcher is shown at all — this story must not add friction to the common single-gym login path

**Open architectural question, not resolved by this stub:** `custom_access_token_hook()` is invoked by GoTrue itself, not app code — it has no channel today for the app to say "mint this next token for gym B, not gym A." Whatever mechanism this story picks (a dedicated switch-gym endpoint that forces a token refresh with a hint, a short-lived claim override, or a schema change to track a "currently selected gym" per session) is a real design decision for create-story/architecture to make, not assumed by this stub.

---

## Epic 4 (extension): Tara Money Cutover & Flow A Formalization

New stories added to the existing Epic 4 (Payments & Front-Desk Retention Alert). Tara Money is re-verified against GymOS's own real business account and cut over from Notch Pay with zero discrepancies; each gym connects its own Vault-encrypted Tara Money account; Flow A payments are explicitly routed and audit-provable as never touching the platform account; members can self-serve renew from the app. Delivers UJ-10 (Chidi verifies the payment cutover) — the Flow A/cutover side.

### Story 4.10: Tara Money Sandbox Re-Verification Against Real Business Account

As a developer,
I want to re-run the Tara Money round-trip (auth, initiate, webhook, idempotency, one real-money charge) against GymOS's own now-activated business account (`9FmIZg9GBB`),
So that production reliance on Tara Money (FR-100) rests on the real account, not the stand-in ("Temporal") account the 2026-07-31 spike used.

**Acceptance Criteria:**

**Given** `supabase/.env` currently configured against the Temporal stand-in credentials
**When** the credentials are swapped to the real `9FmIZg9GBB` business account
**Then** no code or migration change is required — this is a configuration swap behind the existing `PaymentProvider` interface (FR-100)

**Given** the swapped credentials
**When** the same exit criteria that gated the original spike are re-run — sandbox auth, payment initiation returns a reference, webhook received and processed, idempotency test passes, one real-money round-trip
**Then** all criteria pass against the real account, and the outcome (including the real-money transaction reference) is recorded in `docs/decisions.md`, resolving OQ-7

**Given** the re-verification fails any criterion
**When** that occurs
**Then** production reliance on Tara Money does not proceed — Story 4.12's cutover is blocked until a passing re-run is recorded

### Story 4.11: Tara Money Webhook Signature Verification

As the platform,
I want Tara Money's webhook signature verified before any payment write,
So that unsigned or forged payment callbacks can never create or update a payment record.

**Acceptance Criteria:**

**Given** the shared `payment-webhook` Edge Function
**When** a Tara Money webhook is received
**Then** it is verified using Tara Money's signature scheme (provider-specific per NFR-002) before any DB write

**Given** an unsigned or invalid Tara Money webhook payload
**When** it is received
**Then** it is rejected with HTTP 401 and no payment record is created or modified

**Given** Tara Money sandbox and real webhook deliveries (post Story 4.10)
**When** signature verification is exercised against both
**Then** both are covered by integration tests before Story 4.12's cutover proceeds

### Story 4.12: Notch Pay → Tara Money Cutover

As the platform,
I want new payment initiations to route to Tara Money while in-flight Notch Pay payments reconcile cleanly,
So that the cutover (FR-102) produces zero double-charges and zero lost payments (NFR-012).

**Acceptance Criteria:**

**Given** the `payment_providers` table and `activate_payment_provider()` RPC (AD-13)
**When** the cutover is executed
**Then** Tara Money becomes the active provider via that RPC — no direct table write — and all new payment initiations route to it; Notch Pay remains a documented fallback behind the same `PaymentProvider` interface, configured but not receiving new traffic

**Given** Notch Pay payments already in `processing` state at cutover time
**When** the reconciliation job runs during the migration window
**Then** it polls both providers until each in-flight payment reaches a terminal state under Notch Pay — no payment is re-initiated against Tara Money to prevent a double-charge

**Given** the migration window
**When** it completes
**Then** the window's start/end and the reconciliation job's result (zero discrepancies required per NFR-012) are recorded in the audit log

**Given** a need to revert during the beta
**When** an Owner or Super Admin issue requires it
**Then** the cutover is reversible via `activate_payment_provider()` back to Notch Pay — configuration only, no data migration required

**Given** both MTN Mobile Money and Orange Money, supported under Notch Pay in V1.0 (FR-033)
**When** the cutover completes
**Then** both are confirmed working under Tara Money too (FR-103) — coverage parity, not a reduction; cash, bank transfer, and manual mobile money are unaffected either way

**Given** FR-099's amended framing
**When** this story ships
**Then** documentation (PRD, `docs/decisions.md`) reflects that Tara Money has been the intended, documented provider since 2026-07-31, and that this story is the one that actually begins routing real member payments through it — not a re-announcement of an already-shipped fact

### Story 4.13: Per-Gym Tara Money Account Connection

As a gym Owner,
I want to connect my own gym's Tara Money account from Settings,
So that member mobile-money payments settle directly into my gym's account, never GymOS's.

**Acceptance Criteria:**

**Given** the Settings page
**When** I open "Connect payment account"
**Then** I can authorize my gym's Tara Money merchant credentials, which are stored in Supabase Vault (AD-15) — encrypted, readable only by the server-side payment service, never returned to any client, and tenant-isolated (NFR-017)

**Given** a gym that has not connected Tara Money
**When** members and staff use the gym
**Then** cash and the other manual payment methods (FR-033) work exactly as before — connecting is additive, never a prerequisite for operating (FR-127)

**Given** a gym with Tara Money connected
**When** a member or receptionist looks for a mobile-money payment option
**Then** the automated "pay by Tara Money" action is now visible, alongside cash/manual entry, not replacing them

**Given** Supabase Vault's GA/beta status
**When** this story is implemented
**Then** its current status is confirmed against Supabase's documentation before treating it as a hard dependency (flagged in `ARCHITECTURE-SPINE.md`), and the outcome is recorded in `docs/decisions.md`

### Story 4.14: Flow A Explicit Gym-Account Routing & Auditability

As GymOS,
I want every member→gym payment to be provably routed to that gym's own account and never GymOS's platform account,
So that FR-125's "GymOS takes no commission" claim is auditable, not merely asserted (NFR-019).

**Acceptance Criteria:**

**Given** the `PaymentProvider` interface (unchanged in shape since V1.0)
**When** this story ships
**Then** it gains a discriminated routing context, starting with the `{type:'gym', gym_id}` variant Flow A needs (FR-138, AD-14) — Epic 11's Flow B later extends this same context with a `{type:'platform'}` variant; the type is additive, not a breaking change to this story's Flow A usage

**Given** a member payment (Flow A)
**When** it is initiated
**Then** the `PaymentProvider` resolves the gym's connected credentials via the `{type:'gym', gym_id}` routing context and routes through them — GymOS orchestrates (create collect, detect confirmation, reconcile, receipt) but never receives or holds member funds (FR-124)

**Given** a gym whose Tara Money credentials are missing, invalid, or revoked
**When** a member attempts a mobile-money payment
**Then** initiation fails gracefully, directs the member to the front desk (FR-127's cash fallback), and the Owner is notified their connection needs attention (FR-128)

**Given** the reconciliation job (Story 4.4, extended)
**When** it runs
**Then** it checks each Flow A payment's settled account against its gym's connected credentials, flagging any payment that settled to or credited the platform account — a misrouted-but-otherwise-clean payment that reference/amount matching alone couldn't catch (FR-137's fourth discrepancy category)

**Given** a completed audit period
**When** an Owner or Super Admin reviews the audit log
**Then** every Flow A payment's settlement account is verifiable against the gym's own credentials — proving no platform-account credit occurred, not merely asserting it (NFR-019, G-2)

**Given** a renewal via the front-desk alert panel (FR-050) and a renewal initiated by a member from the app (Story 4.15)
**When** either occurs
**Then** both route through this same Flow A gym-account path — the subscription lifecycle (FR-027–FR-032) is unchanged either way; money routing is now explicitly the gym's own account regardless of which surface initiated the payment (FR-129)

### Story 4.15: Member Self-Service Renewal

As a member,
I want to renew my own subscription from the app without visiting the front desk,
So that I don't have to wait for a receptionist when my membership is expiring or has lapsed.

**Acceptance Criteria:**

**Given** my subscription status is `expiring_soon`, `grace_period`, or `expired`
**When** I open the app
**Then** a "Renew" action is surfaced showing my current plan and the renewal price

**Given** my gym has Tara Money connected
**When** I tap Renew
**Then** I pay by Tara Money, routed through my gym's connected account (Story 4.13/4.14) — the same Flow A path as a front-desk renewal, just member-initiated

**Given** my gym does not have Tara Money connected
**When** I tap Renew
**Then** I see "See front desk to renew with cash" instead of a payment action (FR-127)

**Given** a successful self-service payment
**When** it completes
**Then** my subscription resets per FR-032 (new expiry, alert dismissed, appears in payment history immediately) and I see an immediate in-app confirmation — the same outcome as the front-desk renewal panel (FR-050), just self-initiated

### Story 4.16: Platform Business ID Collision Guard

As GymOS,
I want the per-gym "Connect payment account" flow (Story 4.13) to reject a `business_id_plain` equal to the platform's own `TARAMONEY_BUSINESS_ID`,
So that a gym can't connect an account whose ID collides with the platform's own — which would let that gym's webhook deliveries be misidentified as platform-account traffic (or vice versa) by `TaraMoneyProvider.ts`'s businessId-based routing (Story 4.14).

**Acceptance Criteria:**

**Given** a gym Owner submitting a `business_id_plain` via `connect_gym_payment_credentials` (initial connect or Settings' reconnect flow)
**When** the submitted value equals the platform's own `TARAMONEY_BUSINESS_ID`
**Then** the RPC rejects it with a clear error, and no credentials row is written or updated

**Given** the existing `provider_key` + `business_id_plain` unique index (migration 0054)
**When** this story ships
**Then** it is left unchanged — that index already prevents one gym from registering another gym's business ID; this story closes only the platform-collision gap, which the index can't cover since the platform's ID lives in an env var, not a table row

**Given** the `deferred-work.md` entry this story closes (Story 11.6 review, 2026-08-30)
**When** this story ships
**Then** that entry is marked resolved with a reference to this story

---

## Epic 11: SaaS Billing (Gym → GymOS)

GymOS collects its own platform subscription fee from each gym via a reminder-driven, Owner-approved Tara Money flow — automatic suspension after grace on non-payment, Super Admin visibility and manual override, zero cross-account leakage with Flow A member payments. Delivers G-12.

### Story 11.1: PaymentProvider Routing Context & SaaS Billing Table

As the platform,
I want the `{type:'gym', gym_id}` routing context Epic 4's Story 4.14 introduced extended with a `{type:'platform'}` variant, plus a dedicated table for platform-level billing,
So that Flow B (gym→GymOS) payments are structurally separate from Flow A (member→gym) payments, never sharing RLS audience or credentials.

**Acceptance Criteria:**

**Given** the new `saas_billing_payments` table
**When** it is created
**Then** it is Super-Admin-scoped RLS, distinct from the gym-scoped `payments` table — mirroring the `job_runs`/`audit_log` platform-level-concern precedent (AD-14)

**Given** the `PaymentProvider` routing context (Story 4.14 introduced the `{type:'gym', gym_id}` variant for Flow A)
**When** Flow B is added
**Then** the context gains a `{type:'platform'}` variant selecting GymOS's own platform credentials at initiation, verification, and reconciliation (FR-138); adding this variant changes only the adapter and context, not any Flow A calling code

**Given** the single shared `payment-webhook` Edge Function
**When** a webhook is received
**Then** it dispatches on the routing context carried in the webhook's own reference/metadata to decide whether the event resolves against `payments` or `saas_billing_payments` — no second Edge Function is created, and `payment_webhook_events` remains one shared idempotency log for both flows

### Story 11.2: SaaS Subscription Lifecycle & Free/Test Tier

As GymOS,
I want each gym's platform subscription to progress through its own lifecycle independent of member subscription states,
So that billing status and gym-access status are cleanly separable concepts.

**Acceptance Criteria:**

**Given** a gym on a paid tier
**When** its billing lifecycle runs
**Then** it progresses `active` → `past_due` (missed notice or failed charge; gym stays operational, reminders begin) → `grace_period` (retries exhausted; Super-Admin-configurable window, default 7 days; "renew to avoid suspension" banner shown to Owner) → `suspended` (grace elapsed)

**Given** a mid-cycle SaaS tier change
**When** it is applied
**Then** the new price takes effect at the next billing cycle — no proration (OQ-15, resolved)

**Given** the existing three tiers (Hustle/Grind/Elite)
**When** the Free/Test tier is added (FR-139, amending FR-073)
**Then** it has a Super-Admin-configurable member cap and monthly/annual price fixed at 0 XAF; assigning a gym to it is a tier change like any other, and the full billing reminder/reconciliation machinery still runs at the 0 XAF price point so those code paths stay exercised during the beta

### Story 11.3: Payment-Due Reminders & One-Tap Pay

As a gym Owner,
I want to be notified when my platform subscription payment is due, with a one-tap way to pay,
So that I never lose access to GymOS because I missed a bill I didn't know about.

**Acceptance Criteria:**

**Given** my gym's billing anchor date
**When** it arrives
**Then** I receive a payment-due notice with a one-tap Tara Money payment link, sent via both SMS and WhatsApp (both fire — not a fallback chain, since missing this notice risks suspension), reusing the Evolution API/Twilio infrastructure from FR-118

**Given** I have an email on file (a new optional field on my Owner account, mirroring FR-020's optional member email)
**When** the notice is sent
**Then** email is attempted as a best-effort third channel — SMS and WhatsApp remain the guaranteed channels regardless of email delivery success

**Given** I don't pay by the due date
**When** the reminder schedule runs
**Then** I receive re-sent notices on the default 1/3/5-day-after-due schedule before my gym moves to `grace_period`

**Given** every notice sent and payment attempt made
**When** they occur
**Then** each is recorded, giving GymOS a complete audit trail of the billing conversation with each Owner

**Given** I am never auto-debited (mobile money doesn't support it, OQ-14 resolved)
**When** I receive any payment-due communication
**Then** the copy is explicit that I must take action to pay — no language implies an automatic charge is coming

### Story 11.4: Tenant Suspension Enforcement

As GymOS,
I want a gym's entire tenant suspended at the authorization layer when its SaaS subscription lapses,
So that suspension can't be bypassed by a client ignoring UI state, and access is restored the instant payment succeeds.

**Acceptance Criteria:**

**Given** a gym that reaches `suspended` status (Story 11.2)
**When** any staff or member of that gym makes a request
**Then** they are denied at the RLS/auth-hook layer (via `private.current_gym_status()`, AD-3) — not only hidden by the UI — taking effect on the next request, with no tenant data deleted or mutated (NFR-018)

**Given** a suspended gym's successful SaaS payment
**When** it is confirmed
**Then** the gym returns to `active` and access is restored immediately — reversible, symmetric with the suspension mechanism

**Given** a member of a suspended gym
**When** they open the app
**Then** the suspension surface never mentions billing or payment — that relationship is between GymOS and the Owner only (FR-132); the member sees a neutral "temporarily unavailable" message, not a dunning notice

### Story 11.5: Super Admin Billing View

As a Super Admin,
I want visibility into every gym's SaaS billing status with manual override actions,
So that I can operate the beta (marking out-of-band payments, granting credits) without waiting on the automated flow.

**Acceptance Criteria:**

**Given** the Super Admin dashboard
**When** I open the new Billing view
**Then** I see each gym's tier, interval, SaaS status, next billing date, last payment, and failed-attempt count

**Given** a gym I need to accommodate (e.g., a beta gym, or a payment I confirmed happened outside Tara Money)
**When** I use the Billing view
**Then** I can mark a payment received (out-of-band), apply a credit or free period, trigger a retry, or suspend/reactivate the gym directly

**Given** any action I take from this view
**When** I confirm it
**Then** it is audit-logged with actor, action, target gym, and timestamp (FR-080)

### Story 11.6: Cross-Flow Reconciliation & Beta Accommodation

As GymOS,
I want Flow A and Flow B reconciliation to share one discrepancy-detection module and catch cross-account misrouting,
So that a bug can't quietly settle a gym's Flow B billing payment into a member-payment account or vice versa.

**Acceptance Criteria:**

**Given** the reconciliation job
**When** it runs for either flow
**Then** it uses one shared function/module for the 4-category discrepancy classification (missing internal record, unconfirmed-in-time, amount mismatch, wrong-account-settlement per FR-137) — Flow B reconciles against the platform account, Flow A against each gym's account, but the classification logic itself is not duplicated per flow

**Given** a Free/Test tier gym (Story 11.2) with a 0 XAF billing cycle
**When** its billing cycle runs
**Then** the full reminder/reconciliation machinery executes at the 0 XAF price point — exercising the same code paths as a paying gym, per FR-136

**Given** a beta gym Super Admin has credited via Story 11.5
**When** the reconciliation job evaluates that gym's cycle
**Then** the credited period is correctly excluded from `past_due` calculations — a credit is not mistaken for a missed payment

### Story 11.7: Pay Now — Tier Selection & Alternate Payment Methods *(backlog stub — added 2026-08-28, not yet elaborated via create-story)*

As a gym Owner paying my GymOS subscription,
I want to change my tier at payment time and pay through more than one method,
So that Pay Now isn't limited to whatever tier is already on file, paid only by the mobile-money number I happen to be holding.

**Context:** Surfaced live during Story 11.4's manual verification of the suspended-gym Owner recovery screen (`<PayNowButton>`, `apps/dashboard/components/shared/PayNowButton.tsx`, extracted from Story 11.3's Settings Billing card). Today's flow is Story 11.3's shipped shape only: `initiate_saas_billing_payment()` charges whatever tier/interval is already on `gyms.tier_id`/`saas_billing_interval`, via one direct mobile-money USSD prompt to a single phone number — no tier change, no alternate method. Three real gaps identified:
1. **No tier/interval selection at Pay Now time** — an Owner who wants to change plans has no path to do that from this screen; they'd need a separate, not-yet-built tier-change flow.
2. **No hosted-checkout fallback.** TaraMoney's real API (confirmed via `https://dikalosarl.mintlify.site/` — this project had no prior documentation of this beyond the direct mobile-money collection endpoint already implemented in `TaraMoneyProvider.ts`) exposes a `createPaymentLink()` method returning a hosted URL (`https://pay.taramoney.com/link/{id}`) and an `EmbedPay` iframe component (`https://taramoney.com/pay/{collectionId}`), both distinct from the direct `mobilePay()` API call this codebase currently uses exclusively. Tara's own marketing pages (`taramoney.com/business`) additionally claim Bank Card acceptance as a merchant capability — **this specific claim is unconfirmed at the API/technical-docs level** (the `/sdk/react-sdk` page explicitly says its own embedded UI supports "Mobile Money payments only... No card payments, alternative wallets... mentioned"), so whether the hosted payment *link* (as opposed to the SDK's embedded component) actually surfaces card/Stripe/Google Pay/Alipay needs direct verification against a real Tara dashboard/account before this story's design is finalized — do not assume it from the marketing copy alone.
3. **No country/operator selector.** The direct mobile-money API supports 14+ countries with specific per-country operators (confirmed via `/api/mobile-pay`: Benin (MTN, Moov), Burkina Faso (Moov, Orange), Cameroon (MTN, Orange), Congo-Brazzaville (Airtel, MTN), Congo-Kinshasa (Vodacom, Airtel, Orange), Côte d'Ivoire (MTN, Orange, Wave), Gabon (Airtel), Ghana (MTN, AirtelTigo, Vodafone), Kenya (MPesa), Rwanda (Airtel, MTN), Senegal (Free, Orange, Wave), Sierra Leone (Orange), Tanzania (Airtel, Vodacom, Tigo, Halotel), Uganda (Airtel, MTN), Zambia (operators undocumented)) — today's Pay Now dialog has no way to pick a country, defaulting to whatever number the Owner types with no operator/country context or flag iconography.

**Also worth reconciling at create-story time, not required by this stub:** the fetched webhook docs (`/api/webhooks`) describe an `X-Tara-Signature` HMAC-SHA256 verification scheme, but this codebase's actual, real-production-verified `TaraMoneyProvider.verifyWebhookSignature()` (Story 4.1, 2026-07-31 live test) uses a plain shared-secret `tara-webhook-secret` header match instead — either the docs describe a newer/different API version, or a legacy verification mode is still in effect for this account. Confirm which is actually live before touching that code path.

**Acceptance Criteria (draft — needs full create-story elaboration before dev, including direct confirmation against a real Tara dashboard/account of which payment methods the hosted checkout link actually surfaces):**

**Given** the Pay Now dialog (Settings Billing card and/or the suspended-gym Owner screen)
**When** the Owner opens it
**Then** they can select a tier/interval to pay for, not just re-pay whatever is already on file

**Given** the Pay Now dialog
**When** the Owner wants to pay via mobile money
**Then** a country selector (with flags, scoped to Tara's actually-supported country list) drives which operators are offered, rather than a bare phone-number field with no country context

**Given** the Pay Now dialog
**When** the Owner doesn't want to (or can't) pay via mobile money
**Then** a "Continue on Tara" link/action is offered, routing to Tara's own hosted checkout product (`createPaymentLink()`/`EmbedPay`) for whatever alternate methods that surface actually supports — confirmed against real Tara docs/dashboard, not assumed

---

## Epic 10: Client Progress Tracking

Members log body metrics, measurements, and progress photos between visits under a strict member+assigned-coach-only privacy model; coaches see progress trends only for currently-assigned members, re-verified live on every request. Delivers UJ-7 (Amara tracks her progress) and UJ-8 (Emmanuel coaches with real data) in the progress-visibility portion.

### Story 10.1: Body Profile & Progress Entry Logging

As a member,
I want to log an optional body profile and ongoing progress entries (weight, measurements, a photo, a note),
So that I can track my fitness journey over time without any of it being mandatory.

**Acceptance Criteria:**

**Given** the new `progress_entries` table and body-profile columns
**When** they are created
**Then** RLS is enabled with a member-own-row-only default in the same migration (matching the project's no-open-table-window convention) — Story 10.2 then adds the assigned-coach read grant and the dedicated private photo bucket on top of this baseline, it does not establish privacy from scratch

**Given** my member profile
**When** I complete the optional "Complete your profile" step, or visit Progress at any later time
**Then** I can enter height, starting weight, and optional baseline measurements (FR-093) — none of it is required to use the app

**Given** the Progress screen
**When** I log an entry
**Then** I can include any subset of weight, measurements (waist/chest/hips/arms/thighs — all five fields ship per OQ-10), a photo, and a note; the entry is stamped with a timestamp and a `client_id` for offline-safe dedupe

**Given** a progress entry I logged
**When** I choose to remove it
**Then** it is soft-deleted — I can only delete my own entries, never another member's

**Given** I am offline
**When** I log a progress entry
**Then** it queues locally (SQLite) and syncs on reconnect via `client_id` idempotency (FR-097, amending FR-061) — the only V1.5 flow other than check-in that supports offline

### Story 10.2: Progress Data & Photo Privacy

As a member,
I want my body data and progress photos private by default, with explicit control over what I share with my coach,
So that this sensitive information is never exposed without my active consent.

**Acceptance Criteria:**

**Given** my progress data (measurements, weight, notes)
**When** any role attempts to read it
**Then** only I can always read/write it, and my currently-assigned Coach (if any) can read it — no Receptionist, Manager, Supervisor, Owner, or other member can ever read it, enforced by RLS (FR-095)

**Given** my coach assignment ends
**When** the `ended_at` timestamp is set (FR-055)
**Then** that former coach's read access ends at that instant — re-verified live on every request, no caching window (NFR-016)

**Given** a progress photo I upload
**When** it is stored
**Then** it lands in a dedicated private Storage bucket — never the existing public `member-photos` bucket used for profile photos — with non-guessable object paths (AD-24, NFR-011)

**Given** a photo I've shared with my coach
**When** I revoke that sharing
**Then** access is revoked immediately — no outstanding signed URL survives the revoke, achieved via short-lived signed URLs (NFR-011); the revocation is forward-only and doesn't retroactively track whether the coach already viewed it

**Given** a new photo I upload
**When** it is saved
**Then** sharing defaults to off — an explicit per-photo opt-in action, never a blanket setting

### Story 10.3: Member Progress Screen

As a member,
I want a dedicated Progress screen showing my trends over time,
So that I have a concrete reason to open the app between gym visits.

**Acceptance Criteria:**

**Given** the app's new Progress tab (FR-123)
**When** I open it
**Then** I see my current weight and change since my starting weight, a weight trend chart, logged measurements with their trends, and a photo timeline (visible only to me unless I've shared a given photo)

**Given** the Progress screen
**When** I want to log a new entry
**Then** a log-entry action is available directly from this screen (Story 10.1)

**Given** I am offline
**When** I open Progress
**Then** previously-synced charts and data render from local cache; logging a new entry still queues per Story 10.1

### Story 10.4: Coach Portal Progress Tab

As a Coach,
I want to see my assigned members' progress trends and add notes,
So that I can adjust their plans based on real data, not just what they tell me.

**Acceptance Criteria:**

**Given** an assigned member's profile in the Coach Portal
**When** I open their new Progress tab (FR-122)
**Then** I see their weight/measurement trends and any photos they've shared with me — never unshared photos

**Given** a member's progress entries
**When** I view them
**Then** I can add a note, but I cannot edit or delete the member's own progress entries — those remain member-owned

**Given** a member not currently assigned to me
**When** I attempt to access their Progress tab by any means
**Then** it is invisible and unreadable — RLS blocks the query the same way Story 5.2 already blocks their profile

---

## Epic 12: Classes & Scheduling

Managers schedule one-off/recurring classes; members book and cancel sessions from the app under server-enforced capacity limits; receptionists run class-day attendance. Delivers UJ-9 (Nadia schedules a week of classes).

### Story 12.1: Class Creation & Scheduling

As a Manager or Owner,
I want to create classes with a name, description, assigned coach, capacity, and schedule,
So that my gym can run a structured weekly program.

**Acceptance Criteria:**

**Given** the new Classes admin page (FR-121)
**When** I create a class
**Then** I set name, description, assigned coach, capacity, and either a one-off or recurring schedule; the class is tenant-isolated like all other data (FR-104)

**Given** the Classes admin page
**When** I view it
**Then** it lists classes, their sessions, current booking counts vs. capacity, and the assigned coach

**Given** a Receptionist
**When** they open the Classes page
**Then** they can view bookings and mark class attendance (Story 12.3) but cannot create or edit classes — creation/editing is Manager/Owner only

### Story 12.2: Class Booking with Capacity Enforcement

As a member,
I want to book a class session from the app,
So that I can reliably reserve my spot in a class I want to attend.

**Acceptance Criteria:**

**Given** any member with an active subscription, on any plan type
**When** they attempt to book a class session
**Then** booking is allowed — there is no per-plan class-eligibility flag (FR-105, OQ-9 resolved)

**Given** a class session at capacity
**When** a member attempts to book
**Then** booking closes with "This class is full" — enforced via `book_class_session()`, a `SECURITY DEFINER` RPC that `SELECT ... FOR UPDATE`-locks the session row, counts existing bookings, and inserts only if under capacity, as one atomic transaction (AD-21) — this prevents overbooking even under concurrent booking attempts

**Given** a member's existing booking
**When** they cancel it before the gym-configurable cutoff (default 2 hours before the session)
**Then** the spot is freed for another member to book; cancellation past the cutoff is not permitted

**Given** booking and cancellation actions
**When** they occur
**Then** neither is a payment — no money changes hands as part of class booking (FR-106)

### Story 12.3: Class Attendance Marking

As a Receptionist,
I want to mark which booked members actually attended a class session,
So that the gym has an accurate record separate from general floor check-in.

**Acceptance Criteria:**

**Given** a class session's list of booked members
**When** I view it from the Classes page
**Then** I can mark each member as attended

**Given** class attendance
**When** it is recorded
**Then** it is a status column on `class_bookings` — never a write to `attendance_events`, keeping floor check-in and class attendance as distinct concepts (AD-21) while reusing the same member-status rules

**Given** an expired member with a class booking
**When** I attempt to mark them attended
**Then** it is rejected the same way floor check-in rejects them, and it triggers the same front-desk alert (FR-049, FR-107)

### Story 12.4: Member App Classes Surfaces

As a member,
I want to see my upcoming booked classes and browse available sessions from the app,
So that I know my schedule without asking the front desk.

**Acceptance Criteria:**

**Given** the app's Home screen
**When** I have upcoming booked classes
**Then** they appear in a summary alongside my existing subscription-status and quick-actions content

**Given** the new Classes tab (FR-123)
**When** I open it
**Then** I see available sessions I can book and my currently-booked sessions, with capacity and booking/cancellation actions from Story 12.2

**Given** workout plans and classes
**When** either is presented in the app
**Then** they remain distinct, separately-navigable features — a class booking is never conflated with a workout plan (FR-108)

---

## Epic 6 (extension): Quiet-Gym Alerts & Class Reminders

New stories added to the existing Epic 6 (Push Notifications), activating the two reserved V1.0 notification types: opted-in members get a rate-limited nudge when the gym is quiet (N-06); booked members get a reminder before their class (N-07).

### Story 6.5: Quiet-Gym Alert Opt-In & Delivery

As a member,
I want to opt in to being notified when my gym is quiet,
So that I can pick a less crowded time to train if I prefer that.

**Acceptance Criteria:**

**Given** my notification preferences
**When** I view them
**Then** quiet-gym alerts default to off, and I can opt in explicitly (FR-113)

**Given** I've opted in
**When** gym occupancy drops into the Low band (FR-047) during the gym's configured opening hours
**Then** I receive N-06 — the V1.5 activation of the reserved N-06 notification type (FR-075)

**Given** the occupancy calculation used to trigger N-06
**When** it runs
**Then** it reuses the existing occupancy calculation (FR-046) exactly — no new presence-detection mechanism is introduced (FR-115), preserving the honest-estimate guarantee

**Given** N-06 has recently fired for me
**When** occupancy would trigger it again
**Then** it's rate-limited to a maximum of 2 per day per member with a minimum 3-hour gap between alerts (FR-114)

### Story 6.6: Class Reminder Notification

As a member,
I want a reminder before a class I've booked,
So that I don't forget to show up.

**Acceptance Criteria:**

**Given** a class session I've booked
**When** 60 minutes remain before the session starts
**Then** I receive N-07, the class-reminder notification (FR-116)

**Given** my notification preferences
**When** I view them
**Then** N-07 is opt-out, not opt-in — it's non-critical per FR-076, so it's on by default but I can turn it off

### Story 6.7: Notification History Screen

As a member,
I want to see my past notifications in one place,
So that I can review what I've been sent without digging through Profile.

**Acceptance Criteria:**

**Given** no member-facing notification history exists today — `private.class_reminder_dispatches`/`private.quiet_gym_alert_dispatches`/`private.payment_notification_dispatches` are internal delivery-tracking bookkeeping only (no RLS, no message content, `private` schema)
**When** this story ships
**Then** a new `public.notifications` table stores one row per notification actually sent to a member (copy already resolved in the member's language, a `type` matching the existing N-01–N-07 taxonomy, `created_at`, nullable `read_at`), gated by RLS so a member can only read their own rows and can only update their own rows' `read_at` column

**Given** each existing dispatch call site (lifecycle cron N-01–N-03, the `payments` trigger N-04/N-05, quiet-gym-alert N-06, class-reminder N-07)
**When** it sends a push
**Then** it also inserts one matching row into `public.notifications`, so the in-app history reflects exactly what was pushed — no new notification types, no change to any existing send condition/rate-limit/opt-out logic

**Given** the mobile app's Home screen
**When** a member is on Home
**Then** a bell icon in the header opens a new Notifications screen, badged with the count of rows where `read_at is null`

**Given** the Notifications screen
**When** it loads
**Then** it shows a reverse-chronological history list only, each row marked read on view — **amended same day, on-device QA:** the two existing opt-out toggles (Quiet-gym alerts, Class reminders) were originally planned to relocate here into a Preferences section, but stay in `apps/mobile/src/app/(tabs)/profile.tsx` unchanged instead, per explicit user request; no Preferences section exists on this screen

**Given** N-01–N-05 are non-opt-out lifecycle/payment notifications (Story 6.4)
**When** the history list renders them
**Then** they appear (so a member can review why they were charged or reminded) but never gain a toggle in Preferences — opt-out continues to apply only to N-06/N-07, unchanged

---

## Epic 13: Workout Plans

Coaches author ordered, named workout plans for their assigned members from a shared exercise library; members view their plan and mark completion offline-safely; plan authorship transfers cleanly on coach reassignment. Delivers UJ-8 (Emmanuel adjusts a plan) in the plan-authoring portion.

### Story 13.1: Shared Exercise Library

As a Coach,
I want a library of exercises to draw from when building a workout plan, with the ability to add my own,
So that I'm not typing every exercise name from scratch each time.

**Acceptance Criteria:**

**Given** the exercise library
**When** a Coach starts building a plan
**Then** they see platform-default exercises available to every gym (FR-112)

**Given** a Coach or gym needs an exercise not in the platform defaults
**When** they add a custom entry
**Then** it is gym-scoped — visible to coaches at that gym only, not leaking into other gyms' libraries (tenant isolation, same as all other data)

### Story 13.2: Coach-Authored Workout Plans

As a Coach,
I want to author a named workout plan with an ordered list of exercises for an assigned member,
So that I can give them a structured program to follow between sessions.

**Acceptance Criteria:**

**Given** an assigned member
**When** I create a workout plan from the Coach Portal's Workout Plans tab (FR-122)
**Then** I give it a name and an ordered list of exercises, each with sets, reps, and an optional note (FR-109)

**Given** a plan I've authored
**When** I edit it
**Then** changes save and the member sees the update on their next app open

**Given** a plan
**When** it is assigned
**Then** it belongs to exactly one member — plans are not shared across members (FR-110)

**Given** a member not assigned to me
**When** I attempt to author or view a plan for them
**Then** RLS blocks it — the same assignment boundary that governs progress data and session notes governs workout plans

### Story 13.3: Member Plan View & Completion Tracking

As a member,
I want to view my assigned workout plan and mark exercises or sessions complete,
So that I can follow my coach's program and track my own adherence.

**Acceptance Criteria:**

**Given** my assigned workout plan
**When** I open it in the app
**Then** I see the named plan with its ordered exercise list, sets, reps, and any coach notes

**Given** an exercise or session in my plan
**When** I mark it complete
**Then** the completion is logged offline-safely via `client_id` (FR-110), the same offline pattern as progress-entry logging (Story 10.1)

**Given** my completion data
**When** my coach views my plan
**Then** they see what I've completed — completion data is visible to the authoring coach

### Story 13.4: Plan Handoff on Coach Reassignment

As a member whose coach has changed,
I want my existing workout plan to stay visible even though my new coach didn't write it,
So that I don't lose my program just because my coach changed.

**Acceptance Criteria:**

**Given** a coach assignment that ends (FR-055's `ended_at`)
**When** the member's new coach (if any) views the member's profile
**Then** the previous coach's plan remains visible to the member and to Owner/Manager, but the new coach cannot edit it

**Given** the new coach
**When** they want to make changes to the existing plan
**Then** they must explicitly take ownership of it first — mirroring the V1.0 session-note handoff pattern (Story 5.1) — before any edit is permitted (FR-111)

### Story 13.5: E2E Test Automation Baseline

As the development team,
I want automated end-to-end coverage of GymOS's four highest-risk V1.5 flows,
So that regressions in privilege escalation, payment cutover, progress-data privacy, or class capacity are caught by CI, not discovered in production.

**Acceptance Criteria:**

**Given** the E2E baseline (NFR-015)
**When** it is established
**Then** it covers exactly four flows: staff provisioning + role enforcement (Epic 9, NFR-013), the payment cutover path (Epic 4 extension), progress-data access boundaries (Epic 10, NFR-016), and class booking capacity limits (Epic 12, AD-21)

**Given** the existing V1 CI gates (RLS pgTAP tests, payment integration tests, TypeScript checks, i18n parity)
**When** the E2E suite is added
**Then** it complements those gates rather than replacing any of them — this is the project's first E2E investment, added once all four flows it tests exist to be tested (Epic 13 being the last V1.5 epic in the build sequence)

**Given** the staff-provisioning privilege-escalation guarantee specifically (NFR-013)
**When** the E2E suite runs
**Then** it asserts an Owner cannot mint or promote-to Super Admin, a Supervisor cannot mint or promote-to Supervisor or Owner (including on themselves), and a Manager cannot mint or edit staff roles at all — dedicated coverage before this guarantee ships, per the sprint-change-proposal's success criteria

---

## Epic 14: Observability & Release Hardening

`architecture.md` names Sentry as "the sole V1 observability tool," present across all four surfaces (dashboard, super-admin, mobile, Edge Functions) with dev/staging/prod environment tagging. It was never built. This epic delivers NFR-007.

### Story 14.1: Sentry Error Monitoring

As the development team,
I want unhandled exceptions across the dashboard, super-admin, and mobile app captured to Sentry with dev/staging/prod environment tagging,
So that a production error is surfaced automatically instead of discovered only when a user reports it (NFR-007).

**Acceptance Criteria:**

**Given** a real `SENTRY_DSN` configured per app
**When** an unhandled exception occurs in `apps/dashboard`, `apps/super-admin`, or `apps/mobile`
**Then** it is captured to Sentry, tagged using the same three-value environment convention Story 9.5 already established for PostHog — `VERCEL_ENV` → `prod`/`staging`/`dev` for the two Next.js apps, `EXPO_PUBLIC_APP_ENV` for mobile — not a new convention invented from scratch

**Given** no `SENTRY_DSN` is configured (e.g. local dev)
**When** the app runs
**Then** Sentry initialization no-ops safely, matching the existing PostHog module's own no-DSN-configured fallback pattern (`apps/dashboard/lib/analytics.ts`) — never blocking or crashing local dev or CI

**Given** `architecture.md`'s existing error-handling convention (Server Actions/service functions return `{ data, error }` for expected, user-facing errors; only genuine bugs throw)
**When** Sentry is wired
**Then** it captures exactly those genuine-bug throws (React error boundaries, unhandled promise rejections, Server Action crashes) — not the expected `{ error }` returns the UI already handles, avoiding alert noise

**Given** Edge Functions are named in `architecture.md` as a fourth Sentry surface
**When** this story ships
**Then** Edge Function instrumentation (a separate Deno SDK, a different runtime) is explicitly out of scope, flagged as a follow-up — matching this codebase's existing precedent of narrowing scope when a surface's toolchain genuinely differs (e.g. Story 9.5 excluding `apps/super-admin` from PostHog)

**Given** a captured error reaches Sentry
**When** this story ships
**Then** it delivers capture only — alerting rules, on-call routing, and dashboards are an operational follow-up, not part of this story's scope

---

## Epic 15: Mobile Experience Quality Pass

Stories 8.3–8.6 shipped the mobile design-system foundation and screen restyles. A 2026-08-05 real-device verification (`sprint-status.yaml`, epic-8 action items) found the result "reads as a color/theme swap only." A 2026-09-02 `bmad-ux` pass (`_bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/DESIGN.md` + `EXPERIENCE.md`, updated in place) diagnosed the real cause by comparing shipped code against reference craft: the dark theme and Barlow condensed-header typography (Story 8.3) were already correct — the actual gap is that `Card.tsx` has no elevation/shadow and isn't used on Home/Profile (which hand-roll bare bordered rows instead), there's no iconography anchoring list rows, and the launch (splash/icon) assets were never rebranded from Expo-starter defaults. This epic fixes those four things. It does not add photography — GymOS is white-label multi-tenant, so per-gym stock imagery would look generic across different tenants' real facilities; the fix stays icon + data-forward (`.memlog.md`, 2026-09-02 decisions).

### Story 15.1: Splash Screen & App Icon Fix

As a gym member,
I want the app's launch screen and icon to reflect GymOS's actual brand instead of an unbranded default,
So that my first impression of the app looks intentional rather than like an unfinished template.

**Acceptance Criteria:**

**Given** `apps/mobile/app.json`'s `expo-splash-screen` config currently sets `backgroundColor: "#208AEF"` — an Expo-starter default unrelated to `Brand.primary` (`#1B2A41`) or the mobile dark theme's actual background (`#0A0F17`)
**When** this story ships
**Then** `backgroundColor` is updated to `#0A0F17` (DESIGN.md's App Launch spec), matching the dark theme the rest of the app already uses

**Given** `apps/mobile`'s icon is defined across **three separate surfaces**, not one file — `app.json`'s top-level `icon` (`assets/images/icon.png`), `ios.icon` (`assets/expo.icon`, an Xcode 16 Icon Composer bundle: `icon.json` layer config + `Assets/expo-symbol 2.svg` + `Assets/grid.png`), and `android.adaptiveIcon` (`foregroundImage`/`backgroundImage`/`monochromeImage` PNGs plus its own separate `backgroundColor: "#E6F4FE"`) — and all three are currently the unbranded Expo starter default (generic blue "A" glyph / "expo-symbol" layer / light-blue adaptive background), confirmed via inspection of `app.json` and each asset, not assumed
**When** this story ships
**Then** all three surfaces are rebranded consistently from the same source mark (the accent-orange bar-glyph cropped from `apps/dashboard/public/gymos-logo-full-white.webp` — no new brand design needed): `icon.png` replaced (1024×1024); `expo.icon/icon.json`'s `fill` changed from the default Expo-blue gradient to a GymOS token (`primary` `#1B2A41` solid or a `primary`→`accent` gradient) and its `expo-symbol`/`grid` layers replaced with the GymOS mark, keeping the bundle's Icon Composer JSON structure valid; `android.adaptiveIcon.backgroundColor` changed from `#E6F4FE` to `primary` (`#1B2A41`) and its three PNG layers regenerated from the same mark
**Then also** `splash-icon.png` (currently a blank placeholder, separate from all three icon surfaces above) is replaced with the same mark, sized per Expo's splash `imageWidth` convention, on the `#0A0F17` background from this story's first AC

**Given** `react-logo*.png`, `expo-logo.png`, `expo-badge*.png`, and `tutorial-web.png` are unreferenced Expo-starter template leftovers (verify via grep across `apps/mobile/src` and `app.json` before deleting — confirm zero references, don't assume)
**When** this story ships
**Then** any confirmed-unreferenced file among them is deleted as part of the same asset cleanup

**Given** the app is launched cold on a real device or simulator
**When** the splash appears then transitions to the first screen
**Then** the transition reads as one continuous brand (dark background, accent mark) rather than a blue flash followed by a color change — verified manually, this story doesn't ship without on-device confirmation (per this project's manual-QA convention, `sprint-status.yaml` action items)

---

### Story 15.2: Shared Component Library — Card Elevation, Icon Chip, List Item, Stat Tile

As a mobile app developer,
I want the shared UI primitives DESIGN.md now specifies (Card `raised`, Icon Chip, List Item, Stat Tile) built as reusable components,
So that Home and Profile — and future screens — can apply them without each screen hand-rolling its own bordered-row treatment.

**Acceptance Criteria:**

**Given** `apps/mobile/src/components/ui/Card.tsx`'s `elevated` prop currently only swaps background color, with no shadow/elevation styling defined
**When** this story ships
**Then** Card gains a `raised` variant applying DESIGN.md's Elevation & Depth spec (iOS `shadowColor/Opacity/Radius/Offset`, Android `elevation: 4`, no border) while the existing bordered default (`flat`) behavior is unchanged for every existing caller (`Card.tsx`'s current consumers in `(tabs)/profile.tsx` etc. must render identically to before)

**Given** no Icon Chip component exists yet
**When** this story ships
**Then** a new `IconChip.tsx` exists at `apps/mobile/src/components/ui/`, taking a MaterialIcons glyph name and a semantic tint (`accent`/`success`/`warning`/`danger`/`primary`), rendering per DESIGN.md's `iconChip` spec (36×36, radius 8, 1px border)

**Given** no List Item component exists yet (Home/Profile currently hand-roll bordered rows per-screen)
**When** this story ships
**Then** a new `ListItem.tsx` exists, composing IconChip + title + trailing meta text, matching EXPERIENCE.md's Member App Component Library List Item spec, with a tap target ≥44×44pt per the existing Interaction Primitives / Accessibility Floor rule

**Given** no Stat Tile component exists yet, and `ThemedText`'s `type` prop has no numeral-emphasis variant
**When** this story ships
**Then** `ThemedText` gains a `statNumeral` type (Barlow ExtraBold 800, 32/36, no uppercase/letter-spacing — distinct from `title`/`subtitle`'s uppercase treatment) and a new `StatTile.tsx` composes it with a `small` caption inside a `raised` Card

**Given** these are new shared primitives with no existing screen consuming them yet
**When** this story ships
**Then** it ships the four components with their own isolated coverage (matching this repo's existing component-testing convention) but does **not** modify Home or Profile screens — that's Stories 15.3/15.4, kept separate so a primitives regression and a screen-layout regression are never bisected together

---

### Story 15.3: Home Screen Craft Pass (MA-09)

As a gym member,
I want the Home screen's status card, upcoming classes, and recent activity to look like a designed product surface instead of a flat list of bordered text rows,
So that the app feels finished rather than a color swap over a starter template.

*Depends on Story 15.2 (Card `raised`, IconChip, ListItem, StatTile must exist first).*

**Acceptance Criteria:**

**Given** the subscription status card in `apps/mobile/src/app/(tabs)/index.tsx` currently renders as a hand-rolled bordered `View` (`styles.statusCard`)
**When** this story ships
**Then** it renders as the new Card `raised` variant — the one `raised` card on this screen per EXPERIENCE.md's Card-usage rule — with a leading IconChip tinted to the same status color the Status Badge already uses (the existing `grace_period` warning glyph moves into the chip, not duplicated)

**Given** `expiring_soon`/`grace_period` states currently show "Expires [date]" as plain prose (`home.expiresOn`/`home.gracePeriodNote` i18n keys, existing `expiryDate` value already computed client-side)
**When** the day-count framing applies
**Then** the numeric day count renders with `statNumeral` emphasis inline in the same sentence — no new data fetched or computed, this is a typographic change to an existing value

**Given** Recent Activity and Upcoming Classes currently render as bare rows (`styles.activityRow`, `borderTopWidth: 1`, no icon)
**When** this story ships
**Then** each section's rows render as ListItem components (IconChip tint: check-in → `accent`, payment → `success`, class → `accent`) wrapped in one `flat` Card per section, per EXPERIENCE.md's updated MA-09 spec

**Given** existing navigation (status card → MA-13, activity rows → History/MA-14, upcoming classes → MA-16) and all existing `onPress` handlers are correct today
**When** this story ships
**Then** every route and handler stays wired exactly as before — this is a presentational-only change; no IA, destination, or data-fetching logic changes

**Given** the offline sync banner, loading skeletons, and the "No activity yet…" empty state are pre-existing and correctly specified
**When** this story ships
**Then** their copy and trigger conditions are unchanged — only the loaded/non-empty activity-row container changes visually

---

### Story 15.4: Profile Screen Craft Pass (MA-12)

As a gym member,
I want Profile's settings rows grouped and iconified instead of a flat stack of hairline-divided text rows,
So that it's easier to scan and feels consistent with the rest of the redesigned app.

*Depends on Story 15.2.*

**Acceptance Criteria:**

**Given** `apps/mobile/src/app/(tabs)/profile.tsx` currently renders Edit profile / Body Profile+Log entry / History / Language as separate bordered rows (`styles.row`, `borderTopWidth: 1`, no icons)
**When** this story ships
**Then** Edit profile, History, and Language rows are grouped into one `flat` Card with leading IconChips (`person`/`history`/`language` glyphs, `primary` tint), per EXPERIENCE.md's updated MA-12 spec; the Body Profile / Log Progress Entry row (a Story 10.1/12.4 addition not currently documented in EXPERIENCE.md's MA-12 layout — a pre-existing spine gap, not introduced by this story) keeps its current position and behavior, gaining only the same Card-grouping treatment as its neighbors, not a new IA slot

**Given** the Notifications section currently renders inline within the same undifferentiated row stack, with exactly two `Switch` controls (`quietGymAlertsOptedOut`, `classReminderOptedOut` — EXPERIENCE.md's spine additionally describes a third "Renewal & payment reminders" toggle that is not present in shipped code; this pre-existing spine/code drift is out of scope for this story, which does not add a third toggle)
**When** this story ships
**Then** the two existing notification rows render inside their own separate `flat` Card, each gaining a `bell`-glyph IconChip, with the existing `Switch` controls, optimistic-toggle-with-rollback behavior, and description text unchanged

**Given** "Log out" currently renders as just another row in the same stack
**When** this story ships
**Then** it renders standalone (outside both Cards) with a `danger`-tinted IconChip, per EXPERIENCE.md's updated MA-12 spec — the existing confirmation `Alert` and sign-out behavior (including the Progress/Workout-Plan cache clears on sign-out) are unchanged

**Given** navigation destinations, edit-mode behavior, the language-toggle optimistic update, and the notification-toggle optimistic update are all pre-existing and correct today
**When** this story ships
**Then** none of that logic changes — this is a presentational/containment-only pass, the same discipline as Story 15.3

---

## Epic 26: Member Roster Import & Profile Fields

**Goal:** A gym that takes over an existing roster (a paper or spreadsheet file with names, phones, ages, professions and neighborhoods, and no plan data) can load it in one step and then decide, person by person, who owes the registration fee and which plan they get.

**Owner decisions (2026-10-23):** (1) the age is stored as a **birth year**, shown as an approximate age; (2) imported members are **awaiting the registration fee** and have **no plan**, the opposite of today's plan import, which settles each row; (3) when the gym's fee is 0 the import is **allowed with a warning** (the owner sets fees and settings before importing); (4) names are one field, first name then last name, Title Case; (5) built on `epic/23` so migration numbers follow Epic 23's (0154 onward); (6) the real roster file is personal data: never committed, never printed, and tests use synthetic rows.

**Requirements covered:** FR-215, FR-216, FR-217, FR-218.

### Epic 26 — Stories

| # | Story | Migration | Depends on |
|---|---|---|---|
| 26.1 | Member Profile Fields: Birth Year, Profession, Neighborhood | next free at merge time (0154 on epic/23) | 2.3, 18.1 |
| 26.2 | Members-Only CSV Import: No Plan, Awaiting the Fee | none expected (the importer reuses the member-creation path) | 26.1, 18.5, 2.4 |

---

### Story 26.1: Member Profile Fields: Birth Year, Profession, Neighborhood

As an Owner or front-desk staff member,
I want to record and see a member's birth year, profession and neighborhood,
So that I know who my members are, and a roster I take over does not lose that information.

*Delivers FR-215, FR-216. Adds three nullable columns to `public.members`. Nothing about who can read or write a member row changes: the existing member policies and RPCs apply to the new columns exactly as they do to `phone`.*

**Acceptance Criteria:**

**Given** the `members` table
**When** the migration ships
**Then** `birth_year smallint` (between 1900 and 2100), `profession text` and `neighborhood text` (each at most 120 characters after trimming) exist, all nullable, every existing row is null, and the existing `dob` column is untouched and still optional

**Given** an Owner, Supervisor, Manager or Receptionist creating or editing a member
**When** they fill the three optional fields and save
**Then** the values are saved trimmed, a blank value is saved as null, a birth year outside 1900 to the current year is refused inline, and nothing is required

**Given** a member with a birth year
**When** the member detail, the members list or an export shows their age
**Then** it shows an approximate age (the current year minus the birth year, labelled as approximate in EN and FR), never a date of birth, and a member without a birth year shows nothing rather than a zero

**Given** the member export
**When** it is generated
**Then** it includes the three fields, and the existing formula-injection guard applies to the two text fields

**Given** the writers of `members` rows (the create and edit member paths, the plan CSV import, the support staff-creation path, the members-only import in 26.2)
**When** a test enumerates them
**Then** each either accepts and validates the three fields or leaves them null, and a writer that is added later without being listed fails the scan

**Given** the privacy policy page and `docs/privacy-policy.md`
**When** this story ships
**Then** both list the new data categories (birth year, profession, neighborhood) and their purpose, in EN and FR, and the member app neither shows nor collects them in this epic

**Given** the platform rules on hidden identity, audit and the gym-scoped member policies
**When** the fields are added
**Then** no policy, trigger or audit action changes, and a pgTAP test proves a member of another gym still cannot read them

---

### Story 26.2: One CSV Template: Only Name and Phone Required, Plan Optional

As an Owner taking over an existing roster,
I want to import names, phones and profile details without any plan data,
So that every person is on file awaiting the registration fee and I decide each case individually.

*Delivers FR-217, FR-218. ONE import template (Story 2.4's, extended); there is no second template and no mode. Header `member_name,phone,plan_type,join_date,subscription_status,expiry_date,birth_year,profession,neighborhood`; only `member_name` and `phone` are required, the rest may be absent or blank. A row with a plan behaves exactly as before (Story 18.5: settled in a fee gym); a row without a plan creates no subscription and is left awaiting the fee by the 0098 trigger.*

**Acceptance Criteria:**

**Given** a file with only `member_name` and `phone` (or the old six columns)
**When** it is imported into a fee gym
**Then** a row without a plan creates a member with no subscription awaiting the fee, a row with a plan is imported and settled as before, and the result states how many were created and how many are awaiting

**Given** a fee-0 gym and a file with rows that have no plan
**When** it is validated
**Then** a clear warning is shown, Confirm is gated on an acknowledgement, and the server refuses to confirm without an explicit acknowledgement

**Given** a row without a plan
**When** it carries a subscription status or an expiry date
**Then** it is a row error saying a plan is required; its join date is optional (blank is the UTC import date, a future date is an error)

**Given** the usual validation (repeated phone, existing member, bad birth year or text over 120 characters, more than 1000 rows, tier cap)
**When** any row fails
**Then** nothing is imported and the errors say why; a mid-import failure rolls earlier rows back and audits nothing

**Given** the audit
**When** a row without a plan is imported
**Then** its `member_created` row has `join_date`, `via` and `awaiting_registration_fee` and no name and no phone; a plan row's audit is unchanged

**Given** a CSV file of real members
**When** this story is built and tested
**Then** the tests use synthetic rows only, and no real member data is committed, logged or printed

**Given** the member-creation path
**When** a test enumerates the callers of `provisionMemberRow`
**Then** an unlisted caller fails the scan


---

## V1.8 — Stories (Epics 27–31)

Stories for the V1.8 epics listed in the V1.8 section above. Written 2026-11-15 from PRD v1.8, spine AD-53–AD-61, the V1.8 UX contract additions (MA-18–MA-23, UX AD-30–AD-32) and the code facts in the architecture reviews. **UX screen ids** (e.g. "UX AD-30") are distinct from **spine decision ids** (e.g. "spine AD-30"). 21 stories; the Could items FR-221, FR-234 and FR-235 have no stories in this release (see Epic 31).


---

### Epic 27 — Stories

| # | Story | Migration | Depends on |
|---|---|---|---|
| 27.1 | Protected Attendance Counting: Stored Visit Day, Counting Views, Reader Allowlist (no behaviour change) | next free at merge time | none |
| 27.2 | One Check-In Insert Path: `private.record_check_in` (no behaviour change for a scan) | next free at merge time | 27.1 |
| 27.3 | Staff Check-In and Void: Check In a Member at the Entrance, Undo a Mistake the Same Day | next free at merge time | 27.2 |
| 27.4 | Correct Plan and Annual Plan Wording | next free at merge time | none |

*Two independent chains: 27.1 → 27.2 → 27.3 (attendance) and 27.4 (plans). 27.4 touches no attendance object and can run in parallel with the whole attendance chain. The only shared files are `supabase/tests/support_capabilities.test.sql` (pinned totals and name arrays) and `apps/dashboard/app/(dashboard)/audit/auditLabels.ts`: 27.3 and 27.4 both edit them, so each story updates them by arithmetic on the file as it stands at merge time, never to a hard-coded total. Migration numbers are assigned at merge time (head was 0172 on 2026-11-15); earlier stories never renumber.*

*Production is live with real gyms. 27.1 and 27.2 change what every check-in, occupancy count and attendance page reads and writes, with the stated promise that nothing a member or a desk sees changes (the one named exception is the "today" count in 27.1). 27.3 adds the first staff write into attendance. 27.4 rewrites a subscription's plan and expiry. Each ships behind the full `scripts/ci-local.sh` gate, each migration carries a `scripts/rollback-NNNN-*.sql`, and the existing pgTAP suite passes without fixture edits except the tests each story names.*

*Epic 27 carries the whole of PRD §10.3 Step 1 (desk fixes). All eight FRs are Must for that gate; none carries a Should or Could tag. Epics 28, 30 and 31 read what 27.1 and 27.2 build (`visit_day`, `attendance_counted`, `member_visit_days`, `record_check_in`); they must reuse those objects and never redefine them. The engagement watermark (`dirty_from`) is deliberately absent from Epic 27: Epic 30 wires it into `record_check_in` and `void_staff_check_in`.*

*Naming note: "UX AD-nn" always means a screen in `EXPERIENCE.md`; "spine AD-nn" means an architecture decision. The two share numbers 30 and 31.*

---

### Story 27.1: Protected Attendance Counting: Stored Visit Day, Counting Views, Reader Allowlist

As a platform engineer,
I want every attendance count to read one protected view over a stored gym-local visit day,
So that a voided visit can never be counted by one query and not another, and a later timezone change can never move a past day.

*Delivers the data side of FR-225 and NFR-028 (visit-day storage), NFR-001 (tenant isolation of the new views); amends FR-048 (the page's counts). Spine AD-56 (view, policies, reader inventory), AD-53 (`visit_day` and `member_visit_days` only), AD-1, AD-22. No behaviour change except one named correction: the Attendance page's "today" count stops using the UTC day. Nothing writes `voided_at` in this story; the void arrives in 27.3.*

**Acceptance Criteria:**

**Given** the `attendance_events` table (columns today: `id, gym_id, member_id, checked_in_at, checked_out_at, checkout_type, created_at, client_scan_id`)
**When** the migration ships
**Then** it adds `visit_day date` and `voided_at timestamptz` (nullable, no default), and `voided_at` is the **only** void column this story adds (`voided_by`, `void_reason`, `source`, `entered_by` are 27.2's), because the views and policies below need it and it is always null until 27.3

**Given** every existing row
**When** the migration backfills `visit_day`
**Then** each row gets the gym-local calendar date of `checked_in_at` in **the gym's current `gyms.timezone`**, with the same fallback as `private.gym_today` (an empty or unresolvable zone means UTC); the backfill is one statement, the column is set `NOT NULL` afterwards, and a pgTAP fixture proves a 23:30 UTC check-in is the next local day for `Africa/Douala` (UTC+1) and the same day for `UTC`

**Given** the backfill choice
**When** the story closes
**Then** `docs/decisions.md` has one dated entry (newest first) stating: the project keeps no history of timezone changes, so the current zone is the best available reading of every past row; the default zone `Africa/Douala` has no daylight saving, so for gyms that never changed zone (all of them at release) the result is exact; and NFR-028's "a later timezone change does not move past days" holds from this point on because `visit_day` is written once and never recomputed

**Given** the helper that computes a gym-local date
**When** it is created
**Then** one function `private.gym_local_date(p_gym_id uuid, p_at timestamptz) returns date` (STABLE, `SECURITY DEFINER`, `search_path public`, EXECUTE revoked from `public` and `anon`, per the migration guardrails) is the single definition used by the backfill, the trigger below and, in 27.2, `private.record_check_in`; its fallback matches `private.gym_today` (0157) exactly and a pgTAP test pins both to the same answer for a null, empty, invalid and valid zone

**Given** any insert into `attendance_events`, from any role or function
**When** `visit_day` is not supplied
**Then** a `BEFORE INSERT` trigger sets it from the row's own `checked_in_at` through `private.gym_local_date` (the recorded visit time, offline scans included, exactly as FR-061 and FR-159 already fix it; V1.8 adds no new time rule); a `BEFORE UPDATE` trigger raises if `visit_day` changes; and the existing pgTAP fixtures that insert attendance rows as `postgres` pass **without edits**

**Given** the offline path (FR-061)
**When** a scan stamped 23:50 local on Sunday syncs at 00:20 on Monday
**Then** the stored `visit_day` is Sunday (the scan's recorded, clamped `checked_in_at`, not the receipt time) and a pgTAP test proves it

**Given** the views
**When** the migration ships
**Then** `attendance_counted` is created `WITH (security_invoker = true)` over an **explicit column list** (`id, gym_id, member_id, checked_in_at, checked_out_at, checkout_type, visit_day, created_at, client_scan_id`, never `select *`, and never `entered_by` or any void column, so no later column silently leaks) with `where voided_at is null`; `member_visit_days(member_id, gym_id, visit_day)` is the distinct set of those columns read **from `attendance_counted`**; both grant SELECT to `authenticated` only (revoked from `anon` and `public`); class-only attendance writes no `attendance_events` row and is therefore not a visit day (spine AD-53, AD-21)

**Given** a member of gym A, a Receptionist of gym A, an Owner of gym B, and a gym with status `suspended`
**When** each selects from `attendance_counted` and `member_visit_days`
**Then** the member sees only their own rows, the Receptionist sees every row of gym A and none of gym B, the Owner of B sees none of gym A, a suspended gym returns zero rows to its own members and staff (the RESTRICTIVE `tenant_active_gate` applies through `security_invoker`), and `anon` is refused (pgTAP; NFR-001)

**Given** a row whose `voided_at` is set by a fixture (as `postgres`)
**When** a staff member, the row's member, `attendance_counted` and `member_visit_days` read it
**Then** the base-table SELECT policies for the ordinary roles (`gym_staff_read_own_attendance_events`, `member_read_own_attendance_events`, as last rewritten in 0124, keeping the `tenant_active_gate` and the live-role helpers) no longer return it, and neither view returns it; `service_role` is unchanged (it bypasses RLS) and the views still exclude the row for it

**Given** the base-table readers of `attendance_events`
**When** the story runs its grep over `supabase/migrations`, `supabase/functions`, `apps`, `packages` and `scripts` (the reality check lists, and the story re-derives rather than trusts, `member_occupancy_band()` from 0025, `private.gym_occupancy_band()` from 0056, `apps/dashboard/services/attendance.ts` lines 162, 238 and 301, the mobile `history/index.tsx:109` and `checkin.ts:53`)
**Then** the story records the complete list in its Dev Notes, and the **live** bodies of both occupancy functions (the last migration that redefined each, found by grep over all migrations, not assumed) are re-created to count from `attendance_counted` with an unchanged signature, grants and result for every existing fixture

**Given** the Attendance page
**When** it loads
**Then** "Currently Checked In" (line 162) and the Daily Log (line 301) read `attendance_counted`, and the "today" count (line 238, which builds its day with `todayUtcDate()`) counts rows of `attendance_counted` inside the gym-local day from the existing `gym_local_period_bounds()` wrapper (0097); this is the **one intended behaviour change**: for a Douala gym a check-in between 00:00 and 01:00 local used to count for yesterday and now counts for today, and a Vitest test with the clock at 23:30 UTC and zone `Africa/Douala` pins it

**Given** the two member-app reads (`history/index.tsx`, `checkin.ts`)
**When** the story decides whether to move them
**Then** they stay on the base table and are listed in the allowlist with the reason "member policy hides voided rows (27.1); no mobile build is forced"; the member's own History, offline queue and check-in confirmation are unchanged and the mobile test suite passes with no edit

**Given** the CI check of base-table readers
**When** a PR adds a new reader of `attendance_events`
**Then** two checks fail it: (a) a node script in the shape of `scripts/check-migration-guardrails.mjs` (plain Node, zero dependencies, committed baseline JSON in the shape of `scripts/claim-inventory.baseline.json`, each entry carrying a one-line reason) scans `apps`, `packages` and `supabase/functions` for `.from("attendance_events")` (and `from('attendance_events')`) outside the allowlist, and is wired into the `static` stage of `scripts/ci-local.sh` and mirrored in `.github/workflows/ci.yml`; (b) a pgTAP test enumerates `pg_proc` bodies and `pg_policies` expressions that mention `attendance_events` and compares them with a committed list (at this point: `check_in`, `check_out`, `check_out_member`, `run_check_in_auto_timeout_job`, the two view definitions, the two SELECT policies, the backfill is a migration and exempt); a test adds a fake offender in each place and sees both fail

**Given** the one-open-check-in index `idx_attendance_events_one_open_per_member` and the grants revoked in 0111 (INSERT, UPDATE, DELETE from `authenticated` and `service_role`)
**When** the migration ships
**Then** both are untouched (the index swap is 27.2's), a pgTAP test re-asserts the revoked privileges, and the checks in `scripts/prod-apply.mjs` still pass against a migrated database

**Given** performance (NFR-001 targets: page load under 2 s, scan to alert under 3 s)
**When** the views are queried for the Attendance page and the occupancy function runs
**Then** partial indexes `(gym_id, visit_day) where voided_at is null` and `(member_id, visit_day) where voided_at is null` exist, `EXPLAIN` on a 100,000-row fixture shows index use for the page's three reads, and the scan path (`check_in`) takes no measurable extra time (the trigger adds one lookup)

**Given** the migration and `packages/types/src/database.ts`
**When** the story closes
**Then** the types are regenerated (the `attendance_events` row gains `visit_day` and `voided_at`, the two views appear), `scripts/rollback-NNNN-attendance-counting.sql` restores the policies and occupancy bodies of the previous heads and drops the views, triggers, helper and columns, and the existing pgTAP suite (including `occupancy_display_admin_attendance_page.test.sql`, `check_in_session_gate*.test.sql` and `suspension_rpc_coverage.test.sql`) passes unchanged

---

### Story 27.2: One Check-In Insert Path: `private.record_check_in`

As a platform engineer,
I want one function to be the only place that inserts an attendance row, with the member lock taken first every time,
So that a staff check-in in 27.3 can follow exactly the rules of a scan, and nothing else can ever count a visit differently.

*Delivers the path half of FR-249's "same rules as a scan" (the staff entry itself is 27.3), amends FR-044. Honors NFR-021 (session consumption atomic, one lock for every entry path), NFR-001. Spine AD-56, AD-22, AD-29, AD-31 (source column prepared, staff behaviour is 27.3), AD-35 (unchanged here). The existing scan behaves identically: this is proved, not asserted. The engagement watermark (`dirty_from`) is NOT part of this story (Epic 30 wires it).*

**Acceptance Criteria:**

**Given** the shipped `public.check_in(p_scanned_at timestamptz default null, p_client_scan_id uuid default null) returns attendance_events` (live body in 0124, session gate from 0111)
**When** this story starts, **before any migration is written**
**Then** a characterisation test `supabase/tests/check_in_record_path.test.sql` is committed first and passes against the unmodified `check_in()`; for each state of the matrix it records the return (null or a row), the exception text where one is raised, and the **side effects** (rows in `attendance_events`, `front_desk_alerts` with `kind`, `session_attempts`, `guest_sessions` consumed state, `loyalty_events`, `audit_log` action types); the matrix is: every FR-031 state (`active`, `expiring_soon`, `grace_period`, `expired`), a deactivated member, a member awaiting the registration fee, a member with no plan, a suspended gym (the raised gym-not-active exception, 0090), a Pay-per-session member at a charging gym with a covered session, a consumable paid session, a consumable free session, no session (denied), a 0 XAF plan (exempt), an open check-in (FR-044, the `already has an open check-in` exception text), a stale open check-in past `gyms.checkin_timeout_hours` (auto-closed with the audit row `attendance_stale_check_in_auto_closed`, then a new row), an offline replay with the same `client_scan_id` (returns the existing row, inserts nothing), an offline scan inside the auto-timeout window (scan time honoured), a future scan time (clamped to now), and an offline scan older than the window (inserted and closed at scan time plus the timeout, FR-061)

**Given** the characterisation test and the migration
**When** the migration replaces the body of `check_in()`
**Then** the **same test file, unedited, passes**; together with `check_in_session_gate*.test.sql`, `check_in_one_open_session_enforcement.test.sql`, `check_out_manual_auto_timeout.test.sql`, `class_session_gate*.test.sql`, `loyalty_*` and `session_*` suites, none of which may be edited (this is the "scan outcomes are identical before and after" proof)

**Given** `private.record_check_in(p_member_id uuid, p_gym_id uuid, p_source text, p_actor uuid, p_at timestamptz, p_client_scan_id uuid default null) returns` a result carrying the outcome (`checked_in`, `blocked_expired`, `blocked_session`, `already_open`, `replayed` and the member's status for the warning) and the inserted `attendance_events` row
**When** it is created
**Then** it is `SECURITY DEFINER`, `search_path public`, EXECUTE revoked from `public`, `anon` and `authenticated` (it is called only from definer functions, the shape of `private.consume_guest_session`), and it holds, in this order and nothing else before them: **(1) the member lock `SELECT … FROM members … FOR NO KEY UPDATE` always** (today the shipped body takes it only when charging is on), (2) the replay short-circuit, (3) the gym status check (the raised gym-not-active exception), deactivation and the FR-031 outcome, (4) AD-22 open-check-in handling including the FR-044 stale auto-close, (5) the AD-29 session gate through `private.consume_guest_session`, (6) time clamping, (7) the one `insert into attendance_events` setting `visit_day` explicitly through `private.gym_local_date` (the 27.1 trigger stays as a backstop and a pgTAP test asserts the two agree), then the existing loyalty stamp hook `private.on_session_consumed` exactly as today; the lock order of AD-29 (class_sessions, payment, member, attendance_events, subscriptions, guest_sessions, loyalty_progress) is kept

**Given** `check_in()`
**When** the migration ships
**Then** it keeps its signature, `RETURNS attendance_events`, its role gate (`private.current_member_role()` = member, gym from `private.gym_id()`), its grants, and the contract that a refusal returns SQL `NULL` (so every older mobile build keeps mapping `null` to its `expired` outcome, spine AD-29), and its body becomes: gate, then `private.record_check_in(…, 'qr', auth.uid(), …)`, then map the outcome; `blocked_*` outcomes return `NULL` having committed the same alert and `session_attempts` rows as before

**Given** the table `attendance_events`
**When** the migration ships
**Then** it adds `source text not null default 'qr' check (source in ('qr','staff'))`, `entered_by uuid null` (referencing the same table the other attribution columns, such as `payments.actor_id`, reference), `voided_by uuid null` (same reference), `void_reason text null`, with CHECKs that `entered_by` is not null if and only if `source = 'staff'`, that `voided_at`, `voided_by` and `void_reason` are all null or all set, and that a set `void_reason` is 5 to 300 characters after trimming; every existing row is `source = 'qr'` (all earlier check-ins were scans) and `entered_by` is null; `attendance_counted` is replaced (`CREATE OR REPLACE VIEW`, appending) to add `source` and never `entered_by`

**Given** the one-open-check-in index
**When** the migration swaps it
**Then** `idx_attendance_events_one_open_per_member` is dropped and re-created **under the same name** (the mobile client matches that name in the 23505 error text, `checkin.ts:121`) as a partial unique index `where checked_out_at is null and voided_at is null`, in one transaction with no window where no index exists; the open-check-in lookups and the stale-close `FOR UPDATE` inside `record_check_in` read `voided_at is null`; and a pgTAP test shows a second open check-in is still refused with the same SQLSTATE and message, and that an open row with `voided_at` set (fixture) no longer blocks a new one

**Given** the updaters of `attendance_events` (`check_out()`, `check_out_member(uuid)`, `run_check_in_auto_timeout_job()`, and the stale branch now inside `record_check_in`)
**When** the migration ships
**Then** they remain the only functions that set `checked_out_at`, their bodies are unchanged, and a pgTAP test enumerates `pg_proc` for `insert into … attendance_events` and finds **exactly one** function, `private.record_check_in`, and for `update … attendance_events` and finds exactly the listed updaters (the 27.1 reader allowlist is updated to match; 27.3 adds `void_staff_check_in`)

**Given** `supabase/tests/suspension_rpc_coverage.test.sql` (which pins, around lines 322 to 350, that `current_gym_status` appears before the first `insert into` or `update attendance_events` in every public `SECURITY DEFINER` body) and the verification block of the 0111 migration (which checks that `check_in()`'s source contains `consume_guest_session`)
**When** the body moves
**Then** the coverage test is the **one named existing test that is edited**: it now requires the status check before the first insert inside `private.record_check_in`, requires that every public function touching `attendance_events` either does so itself with the check first or calls `private.record_check_in`, and still fails on a seeded offender; the new migration's own verification block asserts `record_check_in`'s source contains `consume_guest_session` and `current_gym_status`, and `check_in()`'s contains `record_check_in`

**Given** two sessions scanning for the same member at the same time (NFR-021)
**When** the race script `scripts/check-in-member-lock-race.sh` (the shape of `scripts/session-refund-race.sh`) holds the member lock in one `psql` session and calls `check_in()` in a second
**Then** the second blocks until the first commits, for a **non-charging** gym as well as a charging one, a pgTAP assertion shows the lock statement is the first statement of `record_check_in`, and two simultaneous scans produce exactly one open row and one consumed session

**Given** the direct-write revokes from 0111
**When** the migration ships
**Then** they are unchanged and re-asserted (INSERT, UPDATE, DELETE not granted to `authenticated` or `service_role` on `attendance_events`); the mobile `check-in` tests (`checkin.test`), the dashboard attendance tests and the member History read pass with no edit; and the returned row carries the new columns without breaking an older client (it reads a non-null row as success and ignores unknown fields)

**Given** the migration and types
**When** the story closes
**Then** `packages/types/src/database.ts` is regenerated, `scripts/rollback-NNNN-record-check-in.sql` restores the 0124 body of `check_in()` and the old index predicate (valid because no row can be `staff` or voided before 27.3), and `docs/decisions.md` records that `record_check_in` is the only inserter, naming the updater list

---

### Story 27.3: Staff Check-In and Void: Check In a Member at the Entrance, Undo a Mistake the Same Day

As a Receptionist,
I want to check in a member who cannot use their phone, and as a Manager to void a check-in entered on the wrong person the same day,
So that the member gets in, the visit counts like any other, and a desk mistake does not cost the wrong member a session or a place in the streak.

*Delivers FR-248, FR-249, FR-250, FR-251 (check-in and void), FR-025 untouched; amends FR-031, FR-044, FR-048, FR-080, FR-179. Honors NFR-021 (a staff entry consumes a session through the one function under the one lock), NFR-001, NFR-028 (void leaves counts consistent). Spine AD-56, AD-29, AD-30 (stamp reversal), AD-31 (staff attempts are evidence, no alert), AD-35 (registry), AD-39 (per-gym proxy actor), AD-22. `[ASSUMPTION]` from the PRD carried here: the entry time is the time of entry and cannot be dated to the past or future (FR-248); no separate real-time alert for the staff member's own entry (FR-249); a staff entry can be voided the same gym-local day by Manager or above with a mandatory reason (FR-250); remote support check-in counts like any visit (the cost, a possible `counted_for_engagement` flag, is raised in the summary, not built).*

*UX gate: UX AD-11 "V1.8: Check in a member, entry marker, void", UX AD-30 Check in a member (modal, result states R1 to R12), the Void modal and its refusal table, the Entry column, UX AD-12 "V1.8: New action labels", and the AD-22 "Blocked attempts → Source: Desk check-in" line in `EXPERIENCE.md`; the screen states and copy there are the acceptance baseline. This is the largest story of the epic: build the database half and its pgTAP first, then the dashboard.*

**Acceptance Criteria:**

**Given** the staff check-in function
**When** the migration ships
**Then** `public.staff_check_in(p_member_id uuid)` exists with **no time parameter and no scan-id parameter** (so entry cannot be dated to the past or future), `SECURITY DEFINER`, EXECUTE revoked from `public` and `anon`, callable by a live Receptionist, Manager, Supervisor or Owner of the member's gym (role and gym resolved live through `private.current_member_role()` and `private.gym_id()`, so a deactivated or role-changed staff member is refused on the next request, NFR-023), and by a live GymOS Support caller through `private.support_rpc_gym_id('staff_check_in')` and `private.support_rpc_role('staff_check_in')` (AD-35); a Coach, a member, `anon` and a staff member of another gym are refused; a member id of another gym returns the same coded `member_not_found` as a missing id (no existence oracle)

**Given** the call
**When** it runs
**Then** it calls `private.record_check_in(member_id, gym_id, 'staff', private.actor_id(), now())` (so `entered_by` is the staff member, or the per-gym proxy id for support, never a platform user id, AD-39), inherits the member lock, AD-22, the FR-031 outcomes, the FR-159 session gate and the stale-open handling of FR-044 from 27.2 unchanged, and **returns a coded result** (a staff caller has no old builds, so the null contract of a scan does not apply): `outcome`, `attendance_id`, `checked_in_at`, `member_status`, `expiry_date`, `days_since_expiry`, `grace_ends_on`, `since` (for `already_checked_in`), `session_amount` (for `session_required`)

**Given** the outcome codes
**When** a pgTAP test drives each state
**Then** they map one-to-one onto the UX AD-30 result states: R1 `checked_in` (status Active); R2 `checked_in_expiring_soon`; R3 `checked_in_grace_period`; R4 `rejected_expired` (also the "today" variant); R5 `session_required` (Pay-per-session at a charging gym with no usable session under FR-159, amount from the plan); R7 `already_checked_in`; R8 `refused_deactivated`, `refused_registration_fee_due`, `refused_no_plan` (each mirroring what a scan does today for that member, read from the body after 27.2, returned as a coded outcome and not raised); R9 the shipped gym-not-active exception, unchanged; R6, R10, R11 and R12 are client compositions (below) and have no outcome of their own; a Pay-per-session member at a gym with charging off, or on a 0 XAF plan, gets R1 with no session step (FR-156)

**Given** a rejected staff attempt (R4, R5, R8)
**When** the function returns
**Then** **no `attendance_events` row exists**, the attempt is **committed** (the function returns normally; it never raises to report a refusal, or the audit row would roll back), one `audit_log` row `staff_check_in_rejected` holds actor, member, time, outcome and reason code, an R5 also writes a `session_attempts` row with `source = 'staff'`, and **no `front_desk_alerts` row of any `kind` is created** for any staff outcome, accepted or rejected (FR-249); an R7 writes nothing (a no-op is not audited); the scan path's alerts and `session_attempts` are unchanged (regression, `front_desk_alert_kind*.test.sql` and `session_alert_cooldown*.test.sql` pass unedited)

**Given** `session_attempts`
**When** the migration ships
**Then** the `source` CHECK becomes `('check_in','class','staff')`; the Guest-sessions screen's Blocked attempts → Source shows **"Desk check-in" / « Arrivée à l'accueil »** for `staff`; the card's blocked counts include them (a refused desk attempt for a member with no session is evidence of an unpaid visit, AD-31) and a pgTAP test pins the count with one scan attempt and one staff attempt

**Given** an accepted staff check-in
**When** it commits
**Then** one `audit_log` row `staff_check_in` carries time and outcome ("Checked in with a warning" for R2 and R3); the visit appears in the member's own History through the unchanged member policy (staff-entered rows read exactly like scans), counts in `attendance_counted`, `member_visit_days`, occupancy (`member_occupancy_band` rises by one), "Currently Checked In" and the Daily Log; a Pay-per-session entry consumes the covered session through `private.consume_guest_session` and awards the stamp through the AD-30 path exactly as a scan does; and check-out (`check_out_member`, auto-timeout) closes it unchanged

**Given** a Receptionist at a gym with "Charge guests per session" on and a Pay-per-session member with no usable session
**When** the dashboard shows R5 and the Receptionist taps [Record payment and check in]
**Then** the existing **Record Session Payment Panel** (`record_session_payment`, 0108, same fixed amount, same refusals including "a mobile money payment … is already in progress") opens inline inside the modal at every width (no drawer), and on success the client calls `staff_check_in` again and shows R6 "Session recorded. [Name] is checked in at [time]." with no payment toast; if the second call fails or returns a non-success outcome the modal shows R10 with [Check in [Name]] retrying **only** the check-in (the payment stands, nothing is charged twice, a component test pins that the payment function is not called twice); bank transfer stays Manager and Owner only (FR-033, FR-158)

**Given** an expired member (R4), or an expiring or grace member (R2, R3) where the staff member taps [Renew now]
**When** the existing **Inline Renewal Panel** (`confirm_renewal`, FR-050) completes
**Then** the check-in completes automatically with no further tap (owner decision 2026-11-15), the modal shows R6 "Membership renewed. [Name] is checked in at [time].", and the renewal itself raises no front-desk alert of its own (a rejected R4 earlier left none); a component test covers renew-then-complete and the failure variant R10

**Given** the 12 result states of UX AD-30
**When** component tests render each
**Then** R1 to R12 each exist with the icon, label, `role` (`status` or `alert`), colour token (never colour alone), the EN and FR copy keys of `attendance.checkIn.*` and the actions listed in `EXPERIENCE.md`; R11 (network failure) keeps the modal on step 1 with [Check in [Name]] enabled and the "Not sure it went through? Search again" line, and the server's one-open-check-in rule makes the retry safe (a test double-submits and gets one row); R12 (offline) disables the confirm with the reason beside it

**Given** the modal's step 1
**When** the Receptionist types
**Then** the search is auto-focused, debounced 300 ms, needs 2 letters or 3 digits, matches name (contains, accent-insensitive) and phone (digits, any country-code form) within this gym only, returns at most 8 rows with "Showing the first 8. Type more to narrow the list.", shows each row as a radio option with avatar, name, full phone, plan name and status badge, a muted "In the gym since [time]" tag for a member already inside (read from `attendance_counted`), a Pay-per-session row shows the plan name and never a session count, the line "Entry time: now ([time]). It can't be changed." has no time or date field, the confirm button is named "Check in [Name]" and disabled until a row is chosen, there is no second confirmation, and after R1 to R3, R6 or R7 [Check in another member] returns to step 1 with an empty search and focus in the field

**Given** GymOS Support
**When** a support person (assigned, switch on, session at AAL2, FR-189) calls `staff_check_in`
**Then** the function is registered in `private.support_capabilities` (`capability`, `kind = 'rpc'`, `object_name = 'staff_check_in'`) in the same migration; it calls `private.support_stepup_require('support_staff_check_in', p_member_id::text)` first, so without a fresh step-up it raises the coded `step_up_required` and the dashboard raises the existing SA-21 prompt with the bound-action line "You're about to: Check in [Name]" and then retries; the entry, the audit row, the Entry cell and the void text all show **"GymOS Support"**, role "Support", never a name, initials or count; and a revoked, unassigned, AAL1 or switch-off support caller is refused (FR-192 next request)

**Given** the support registry test
**When** the migration ships
**Then** `supabase/tests/support_capabilities.test.sql` is the named existing test that changes: its pinned totals and both sorted name arrays gain `staff_check_in`, `void_staff_check_in` and `list_attendance_log` (computed from the file at merge time; the reality check recorded 43 objects, 21 policies and 22 RPCs, and later epics may have moved that), the catalog test that classifies every function mentioning `'supervisor'` still passes, and the existing `gym_staff_read_own_attendance_events` policy keeps its registry row after its rewrite

**Given** the void function
**When** the migration ships
**Then** `public.void_staff_check_in(p_attendance_id uuid, p_reason text)` exists, callable by a live Manager, Supervisor or Owner (Receptionist, Coach and member refused; support through the AD-35 registry with step-up, bound-action line "You're about to: Void the check-in of [Name]"), `SECURITY DEFINER`, EXECUTE revoked from `public` and `anon`; an attendance id of another gym is `attendance_not_found`; `p_reason` is trimmed and must be 5 to 300 characters; and it runs under the **member lock taken first** (member read from the attendance row, then the attendance row re-read `FOR UPDATE`)

**Given** a staff entry on the current gym-local day
**When** a Manager voids it
**Then** in one transaction: it sets `voided_at = now()`, `voided_by = private.actor_id()` and `void_reason`; if the visit is open it also sets `checked_out_at = now()` and `checkout_type = 'void'` (the `checkout_type` CHECK gains `'void'`; this closes the visit and releases the one-open slot, so the same member's real scan is accepted immediately, pgTAP proves it); it appends one `audit_log` row `staff_check_in_voided` with the original entry time and reason; it never touches a milestone or badge (none exist yet) and **never sets `dirty_from`** (Epic 30 amends the function to do so); and occupancy, `attendance_counted` and `member_visit_days` drop the visit

**Given** the session this visit consumed
**When** the entry consumed a paid or free session
**Then** `guest_sessions` gains a nullable `covered_attendance_id` (foreign key to `attendance_events`, unique where not null; the name matches spine AD-55, which Epic 28 reuses, never redefines), set by `private.record_check_in` in the same transaction when `consume_guest_session` returns *consumed*; the void clears `consumed_at` and `covered_day` and `covered_attendance_id` (the session returns to **Unused** with its original `usable_until`, no marker), appends `stamp_reversed` through `private.reverse_session_stamp()` (the counter floors at 0, a granted free session is never revoked, AD-30), and **does not reverse the desk payment** (the refund path of FR-040 owns it); the transition is named "unconsume" in code and comments, never "void" (spine AD-28 already uses void for `guest_sessions.voided_at`); a pgTAP test covers a paid session and a free session, and records the AD-30 key consequence in `docs/decisions.md`: because `stamp_earned` and `stamp_reversed` are unique on `(origin_id, event_type)`, a released session that is consumed again earns no second stamp

**Given** a later same-day visit that relies on the voided entry's session (Whole day coverage)
**When** the void is attempted
**Then** it is refused with the coded `later_visit_relies` and the field `later_is_staff_entry`, nothing changes, and the modal shows the UX refusal ("Can't void this check-in: [Name]'s later visit today relies on the same paid session." plus "Void the later check-in first." only when the later visit was a staff entry); a void of an entry that did **not** consume a session (it was itself covered by an earlier visit, or charging is off) succeeds and releases nothing

**Given** the other refusals
**When** the void is attempted
**Then** each is a coded refusal with the UX copy: a scan row (`source = 'qr'`) is `not_staff_entry` ("Only check-ins entered by staff can be voided."), a row from an earlier gym-local day (`visit_day` is not `private.gym_today(gym_id)`) is `not_same_day`, a row already voided is `already_voided` and the list refreshes, a reason shorter than 5 or longer than 300 characters is `invalid_reason`, and a network failure keeps [Void check-in] enabled; **a scan can never be voided** (FR-250: a correction of a staff mistake, not an anti-cheat measure)

**Given** the Attendance page
**When** it renders
**Then** [Check in a member] is a primary action in the header for Receptionist and above and GymOS Support and absent from the DOM for Coach; both tables gain an **Entry** column (plain text, never colour-coded): "QR scan" / « Scan du QR » for a scan and every row from before V1.8, and the neutral "By staff" / « Par le personnel » pill followed by "· [Name]" for a staff entry (the name hidden under 1024 px, the pill always kept; "By staff · GymOS Support" for support; a name that fails to resolve shows "By staff" and never blocks the row); [Void] appears (Manager and above, support) only on a staff entry made on the current gym-local day and not already voided, next to [Check Out] in Currently Checked In and alone on a closed Daily Log row, with an accessible name including the member and time

**Given** the base-table SELECT policies of 27.1 that hide voided rows from staff
**When** the Daily Log needs to show voided rows (muted, with the "Voided" pill in the Check-out cell and the tooltip "Voided by [Name] on [date] at [time]. Reason: [reason]", shown by default with no toggle and never deletable)
**Then** it reads one new `public.list_attendance_log(p_from timestamptz, p_to timestamptz, p_member_id uuid default null)` (`SECURITY DEFINER`, live role and gym, uniform empty result for others, registered for support) that returns voided rows too, plus for each row the resolved Entry label, the voided-by label, the reason and, for a same-day staff entry not yet voided, the two booleans the Void modal needs (`consumed_session`, `earned_stamp`); Currently Checked In and every count stay on `attendance_counted`; the base-table readers allowlist of 27.1 is updated in the same story

**Given** the attribution surfaces (FR-186, one test each)
**When** a support person checks a member in and then voids it
**Then** the label "GymOS Support" and no real identity appears in: the Entry cell, the Daily Log row detail, the void dialog and toast text, the `audit_log` read (UX AD-12), the raw `attendance_events` row a staff client can select (`entered_by` and `voided_by` hold only the per-gym proxy id), `list_attendance_log`, and the Realtime payload of the table; and the AD-39 inventory lists the three new columns

**Given** the Void modal (focus opens on [Keep check-in], Escape disabled)
**When** it renders
**Then** it shows the explanation, the reason field with a 0 / 300 counter, and the conditional lines only when they apply ("The paid session this check-in used is given back to [Name]." with "The payment stays on record. Refund it in Payments if you need to."; "The loyalty stamp it earned is removed."), a success closes it, mutes the row, removes it from Currently Checked In and shows the toast "Check-in voided. [Name] is no longer counted as in the gym."; the member is **not** notified; and a second desk sees the change through the existing realtime channel or, if Realtime does not deliver an update for a row the new policy hides, on its next refetch, and the story records which in its Dev Notes after testing it (never a stale open row that can be voided twice: a double void returns `already_voided`)

**Given** UX AD-12
**When** the audit page renders
**Then** `auditLabels.ts` has the three labels in EN and FR ("Member checked in by staff" / « Arrivée d'un membre enregistrée par le personnel », "Staff check-in not accepted" / « Arrivée par le personnel refusée », "Staff check-in voided" / « Arrivée par le personnel annulée ») with the Details cells of the UX table (time and outcome, reason code in plain words, original entry time and reason), a new `auditLabels.epic27.test.ts` in the shape of `auditLabels.epic23.test.ts` pins them, Actor shows the staff member's name and role or "GymOS Support" with role "Support", and a rejected attempt by a Receptionist is visible to Manager and above through the page's existing access

**Given** language parity
**When** `scripts/check-i18n-key-parity.mjs` runs
**Then** every new key (`attendance.checkIn.*`, the Entry column, the Void modal, the labels, the Desk check-in source) exists in EN and FR, with no missing keys

**Given** the E2E baseline (NFR-015)
**When** `scripts/ci-local.sh` runs the e2e stage
**Then** a new spec `apps/dashboard/e2e/desk-fixes.spec.ts` (shared with 27.4) has a staff-check-in group: a Receptionist checks in an Active member (R1) and sees the Entry cell; an Expired member is refused (R4), renews in place and is checked in (R6); a Pay-per-session member at a charging gym with no session records the desk payment and is checked in (R5 then R6); a Receptionist sees no [Void], a Manager voids the entry, the row is muted and the member can scan in

**Given** the migration and types
**When** the story closes
**Then** `packages/types/src/database.ts` is regenerated, `scripts/rollback-NNNN-staff-check-in.sql` is provided (valid only while no staff entry exists; once one does, rollback voids or deletes by hand under the owner's decision, and the rollback header says so), the existing mobile and dashboard check-in suites pass unedited, and `docs/decisions.md` records the Realtime finding and the stamp-key consequence

---

### Story 27.4: Correct Plan and Annual Plan Wording

As an Owner, Supervisor or Manager,
I want to correct a plan assigned by mistake, with a reason, before any payment stands, and to see plainly what an annual plan costs,
So that a wrong plan never needs a developer or a database edit, and an annual plan is never mistaken for a monthly instalment.

*Delivers FR-241, FR-242, FR-243, FR-240, FR-251 (Correct plan); amends FR-025 (clarified), FR-080, FR-179. Honors NFR-001, NFR-021 (one lock order). Spine AD-59, AD-35, AD-39, AD-29, AD-30 (no stamp, no ledger event), AD-31 not involved. `[ASSUMPTION]` from the PRD carried here: Pay-per-session correction refused while an unused paid session is held, and the registration fee unaffected (FR-242); a correction earns no stamp and sends no notification (FR-243); annual plan cards state price, duration and "paid once" (FR-240); no preview of the new expiry in V1.8 (owner decision 2026-11-15).*

*UX gate: UX AD-31 Correct Plan (modal, form state, refusal states F1 to F12, success, audit line), UX AD-04 "V1.8: Correct plan, subscription start, Sessions wording" and UX AD-23 "V1.8: annual plan wording" in `EXPERIENCE.md`; the screen states and copy there are the acceptance baseline. The Sessions-section wording of UX AD-04 for Single use belongs to Epic 28 and is not built here.*

**Acceptance Criteria:**

**Given** the lifecycle thresholds of FR-027, today written inline in `run_subscription_lifecycle_job()` (live body in 0045; it compares the UTC `current_date`, only moves forward, and never sets a row back to `active`)
**When** the migration ships
**Then** `private.subscription_status_for(p_expiry_date date, p_grace_days integer, p_today date) returns subscription_status` exists as a pure function (IMMUTABLE, no table access): a NULL expiry returns `active` (Pay-per-session); `expiry + grace < today` returns `expired`; `expiry < today` returns `grace_period`; `expiry <= today + 7` returns `expiring_soon`; otherwise `active`; **the job is not modified** (no behaviour change to a production cron)

**Given** the function and the job
**When** a pgTAP test `subscription_status_equivalence.test.sql` runs
**Then** for every expiry offset from -12 to +12 days around a fixed `today`, for grace values 0, 3 and 7, it inserts an `active` subscription, runs the real `run_subscription_lifecycle_job()` with the clock aligned to `today`, and asserts the status equals `subscription_status_for(...)`, so any future change to either side fails the test; it also pins the NULL case and the boundary days (`expiry = today`, `expiry = today + 7`, `expiry + grace = today`)

**Given** a member with a current subscription
**When** an Owner, Supervisor or Manager opens the member and the modal asks `public.correct_plan_eligibility(p_member_id uuid)` (read-only, `SECURITY DEFINER`, live role and gym, uniform empty result for anyone else)
**Then** it returns the current subscription (id, plan, price, duration, `start_date`, `expiry_date`, status) and either no block or the **most recent standing payment** with its state (`verified`, `pending`, `in_flight`, `partly_refunded`), amount, method, date, refunded amount and the count of further standing payments, from **one SQL helper `private.subscription_standing_payments(subscription_id)`** that `correct_subscription_plan` also calls, so the UI and the database cannot split the rule

**Given** the definition of "stands" (FR-242)
**When** pgTAP drives each payment on the current subscription
**Then** a payment stands unless it is voided (`payments.voided_at` set) or fully refunded (`refunds.amount = payments.amount`, one refund row per payment): `verified` stands (F1), `pending` awaiting verification stands (F2), `processing` (a Tara Money payment in flight) stands (F3), a partly refunded payment stands (F4), `flagged` stands and uses the F2 message `[ASSUMPTION — the PRD names no flagged state; it awaits a decision like a pending one]`, two standing payments name the most recent and add "+ [N] more payments on this plan are still recorded." (F5), a voided payment and a fully refunded payment do not block and are not mentioned, and a subscription with **no payment record** (an imported member, a payment-less renewal override from `renew_subscription`) is correctable with its recorded `start_date` as the base

**Given** payments that are not subscription payments
**When** the standing check runs
**Then** the registration fee payment (FR-148) and session payments (`guest_sessions.payment_id`) never count as standing payments of the subscription and the fee is unaffected by a correction; and because some payment paths link `payments.subscription_id` late, the helper also counts a member's unlinked `pending` or `processing` renewal payment created since the current subscription row was created, found by grep over every payment-creating path (`confirm_renewal`, `renew_subscription`, `complete_verified_payment`, the verification queue of 0031, the Tara initiation path) and listed in the Dev Notes, failing closed

**Given** the function
**When** it ships
**Then** `public.correct_subscription_plan(p_member_id uuid, p_new_plan_id uuid, p_reason text, p_subscription_id uuid default null)` is `SECURITY DEFINER`, EXECUTE revoked from `public` and `anon`, callable by a live Owner, Supervisor or Manager (Receptionist, Coach, member and a staff member of another gym refused; a deactivated member is correctable, as the UX states), and by GymOS Support as a Supervisor through `private.support_rpc_gym_id('correct_subscription_plan')`, `private.support_rpc_role(...)` and the registry; the optional `p_subscription_id` (the id the modal showed) is how the stale refusal F10 is detected `[ASSUMPTION — the signature of spine AD-59 gains one optional parameter; without it a renewal that lands while the modal is open cannot be told from the subscription the staff member saw]`; refusals raise `P0001` with the code as message and a JSON `detail`, in the existing `{ code, message }` error shape (AD-9)

**Given** the call
**When** it runs
**Then** it **locks the member row first** (`FOR NO KEY UPDATE`), **then the current subscription row** (`FOR UPDATE`; "current" is the same row `subscriptions_current` and the member page show, since a renewal inserts a new row), in that order and no other (the AD-29 order), **re-checks the standing-payment rule under those locks**, and refuses in this order: no current subscription `no_current_subscription` (F8); `p_subscription_id` given and different `subscription_changed` (F10); gym not active (the shipped exception); new plan not in this gym or gone `plan_not_found` (F9); new plan equals current `same_plan` (F7); a standing payment `payment_stands` with the detail of F1 to F5; a move to or from a Pay-per-session plan while the member holds an **unused paid session** (`guest_sessions` with `payment_id` set, `consumed_at` null, `voided_at` null, `usable_until` in the future; free sessions do not block) `session_held` with the soonest lapse date (F6); a reason that is not 5 to 300 characters after trimming `invalid_reason`

**Given** an allowed correction
**When** it runs
**Then** it sets, in one `UPDATE` (the 0018 trigger `enforce_subscription_expiry_matches_plan_type` requires plan and expiry to change together): `plan_id = new plan`; `expiry_date = current subscription's start_date + new plan's duration_days + loyalty days already granted on that row`, where loyalty days are the sum of `details->>'reward_days'` over `loyalty_events` rows `event_type = 'reward_granted'`, `counter = 'subscriber'` whose `details->>'subscription_id'` is this row's id (0119 writes them; the story verifies the keys against the live function), so a granted reward is never taken away; **a NULL expiry and status `active` for a Pay-per-session target**; `status = private.subscription_status_for(new_expiry, gyms.grace_period_days, private.gym_today(gym_id))`; **`start_date` never changes**; and a correction to the plan the member already had is refused, not recomputed

**Given** the expiry arithmetic
**When** pgTAP checks it
**Then** a Monthly (30 days) to Annual (365 days) and back both land exactly on `start_date + duration` for a row with no reward; a row that earned a reward of R days lands on `start_date + duration + R`; a From-Pay-per-session to Monthly row uses the row's recorded `start_date`; a new expiry already in the past yields `expired` or `grace_period` by the function and the success response says so (UX `successExpired`); and the story's Dev Notes record that the formula follows the spine (the current row's `start_date`, as renewals insert a new row) and that **an early renewal carries remaining days into `expiry_date` (migration 0121) which the formula does not re-add**, reachable only when that renewal's payment has been voided or fully refunded, with the audit row's `basis_start_date` making the basis visible `[ASSUMPTION — flagged to the owner as an open question, not decided here]`

**Given** what a correction must not do (FR-243)
**When** pgTAP compares row counts and values before and after
**Then** `payments`, `refunds`, `notifications`, `loyalty_events`, `loyalty_progress`, `guest_sessions`, `attendance_events`, `session_attempts` and `front_desk_alerts` are unchanged, no stamp is earned and no reward is granted or removed, the registration fee state is unchanged, and the next `run_subscription_lifecycle_job()` run changes nothing for that row and sends nothing; exactly **one** `audit_log` row `subscription_plan_corrected` exists with actor (the proxy actor for support, AD-39), member, subscription id, old and new plan id and name, old and new price, old and new expiry, old and new status, `basis_start_date`, `loyalty_days_added` and the reason

**Given** a renewal or a payment arriving while a correction runs (NFR-021)
**When** the race script `scripts/correct-plan-race.sh` (the shape of `scripts/session-refund-race.sh`) runs both orders against `complete_verified_payment`, `confirm_renewal` and a Tara initiation
**Then** if the payment commits first the correction is refused (`payment_stands` or `subscription_changed`) and the payment's extension is never overwritten, and if the correction commits first the payment proceeds on the corrected subscription; the Dev Notes list which payment paths take the member lock and which are covered by the re-check under the subscription lock; and the lifecycle job's bulk UPDATE blocked on the row lock re-evaluates its predicate on the new values (a pgTAP or script case)

**Given** GymOS Support
**When** a support person corrects a plan
**Then** the registry rows for `correct_subscription_plan` and `correct_plan_eligibility` are added in the same migration and `supabase/tests/support_capabilities.test.sql` (pinned totals and both sorted name arrays) is updated by arithmetic on the file at merge time; the function calls `private.support_stepup_require('support_correct_plan', p_member_id::text)` and the dashboard raises the SA-21 prompt with the bound-action line "You're about to: Correct plan for [Name]" and confirm label [Correct plan]; the audit row and the audit page show "GymOS Support"; and an unassigned, revoked, AAL1 or switch-off support caller is refused

**Given** the member page (UX AD-04)
**When** it renders for an Owner, Supervisor or Manager of a member with a current subscription
**Then** a secondary [Correct plan] / [Corriger la formule] button sits in the header between [Edit] and [Deactivate] (absent from the DOM for Receptionist and Coach, and when there is no current subscription), the page gains a read-only **"Subscription started" / « Abonnement débuté le »** date beside Expiry Date (omitted for Pay-per-session; shown to every role that opens the page), and the Plan field uses the plan summary line; after a correction the page refreshes in place with the new plan, expiry and status badge and no "corrected" marker

**Given** the modal (UX AD-31)
**When** it opens
**Then** it shows a skeleton and "Checking payments…" while `correct_plan_eligibility` runs; a block replaces the form immediately (neutral border, info icon, no red, `role="alert"`, only the named link [Open payments] filtered to the member and [Close]) so nobody types a reason for an action that cannot happen; with no block it shows the read-only current plan block (name, price, duration, "Paid once" on annual, start date, expiry), the select of this gym's plans **except the current one** each as the plan summary line (or "There is no other plan to choose. Add a plan in Plans first." with a link and no fields), the required reason (5 to 300, counter, blank blocks the button), the always-visible rule line "The new expiry is counted from the start date ([date]), not from today.", and the two notes ("[Name]'s app shows the new plan the next time it opens." and "The registration fee is not affected."); there is **no preview** of the new expiry; Escape closes it and the unsaved reason is lost; a load failure shows "Couldn't check this member's payments. Try again." with [Retry] and no form

**Given** the refusal and result states of UX AD-31
**When** component tests render each
**Then** F1 to F12 exist with their EN and FR keys (`blocked.*`, `refused.sessionHeld`, F7 back to the form with the field marked, F9 back to the form with the select refreshed, F10 and F8 with [Close], F11 inline above the buttons with [Correct plan] enabled, F12 the global "You don't have permission to do that."), a server refusal received on submit but not shown at open (a payment that landed meanwhile) renders the matching F state, success closes the modal, refreshes the page and shows the toast with the new plan, expiry and status (`members.correctPlan.success`, the Pay-per-session variant, and `successExpired` with the past expiry), and focus returns to the [Correct plan] button

**Given** the plan wording (FR-240, UX AD-23)
**When** the Plans page, the PlanModal and every plan select render
**Then** one reusable plan summary line, built once, produces "[price] XAF · [duration] days · Paid once" for an annual plan (EN) and « 250 000 XAF · 365 jours · Payé en une fois » (FR) and is used by the AD-23 list, the PlanModal helper, every plan select in the dashboard (AD-05 assign plan, the Inline Renewal Panel, the Correct plan select) and the plan name area of the member modal; the AD-23 list row for an annual plan reads "XAF 250,000 · 365 days · Paid once" in place of the shipped "/ monthly" suffix, with a muted second line "Includes 15% annual discount" / « Dont 15 % de remise annuelle » when `annual_discount_percent` is set; the monthly row stays "XAF 25,000 / monthly · 30 days" and the Pay-per-session row "XAF 2,000 / session"; the existing component tests that assert the old annual suffix are the tests that change, named in the PR

**Given** the PlanModal with Billing Interval Annual
**When** the staff member fills it
**Then** under the field it shows "Members pay the full price once. The plan then runs for [D] days. Renewing is a new payment." with [D] from the Duration field (before it is filled, "…for the duration below."), then "To let members pay monthly, create a separate monthly plan. Paying an annual plan in instalments isn't available."; switching the interval never changes the Duration; Duration is not pre-filled with 365; the member app, the public gym page and the Plans data are unchanged (FR-240 says "on the dashboard")

**Given** UX AD-12
**When** the audit page renders a `subscription_plan_corrected` row
**Then** `auditLabels.ts` shows "Plan corrected" / « Formule corrigée » with the Details cell "Annual → Monthly · 250,000 → 25,000 XAF · expires 02 Nov 2027 → 02 Dec 2026 · Reason: …" carrying both plans, both prices, both expiries and the reason in the one row, the label is added to `auditLabels.epic27.test.ts` (created in 27.3, or created here if 27.4 merges first), and `scripts/check-i18n-key-parity.mjs` passes with every new key in EN and FR

**Given** the member's app
**When** a correction commits
**Then** the member's own existing reads (home, plan, subscription) return the new plan on their next load with no push, no notification row and no mobile code change, and an RLS test proves a member of another gym can read neither the old nor the new row

**Given** the E2E baseline (NFR-015)
**When** `scripts/ci-local.sh` runs the e2e stage
**Then** `apps/dashboard/e2e/desk-fixes.spec.ts` gains a plan group: a Manager corrects an unpaid Annual to Monthly with a reason and sees the new expiry counted from the start date; the same action on a member with a verified payment shows F1 with [Open payments]; an annual plan card reads "Paid once" in EN and FR

**Given** the migration and types
**When** the story closes
**Then** `packages/types/src/database.ts` is regenerated, `scripts/rollback-NNNN-correct-plan.sql` drops the three functions and registry rows (a corrected subscription is left as it is, the rollback header says so), the existing subscription, renewal, loyalty and support suites pass unedited except `support_capabilities.test.sql`, and `docs/decisions.md` records the early-renewal carry limitation and the extra `p_subscription_id` parameter


---

### Epic 28 — Stories

| # | Story | Migration | Depends on |
|---|---|---|---|
| 28.1 | Session Validity Setting and Session Record Changes | next free at merge time | Epic 27 (`private.record_check_in`, `attendance_events` source and void columns, `attendance_counted`, `void_staff_check_in`) |
| 28.2 | Single-Use Consumption at Check-In | next free at merge time | 28.1 |
| 28.3 | Class Attendance in a Single-Use Gym and Setting-Change Parity | next free at merge time | 28.2 |

*Strictly sequential: 28.1 lays the columns, the setting and its setter; 28.2 makes the consume function and the check-in path use them; 28.3 extends the same function to classes and proves the setting-change rules end to end. Migration numbers are "next free at merge time"; earlier stories never renumber.*

*All three stories merge to `epic/28` and reach master together at the end of the epic (local CI gate per epic). The Settings section ships in 28.1, but no production gym can be switched to Single use before 28.3 is on master. Until then every gym is `whole_day` and behaves byte-for-byte as today.*

*Production is live with real gyms and this epic edits the money path (`private.consume_guest_session`, `check_in()`/`private.record_check_in`, `mark_class_attendance`). Each story therefore ships behind the full `scripts/ci-local.sh` gate, the existing guest-session pgTAP suites run without fixture edits (the only tests that change are the ones a story names), and tenant isolation and session-correctness are pgTAP-tested, not just E2E-tested.*

*Contradiction recorded, not silently resolved: NFR-021 says "a member never has more than one session consumed per gym-local day". FR-237 and PRD §10.3 step 2 item 2 ("a second visit on the same day consumes a second session") make that false in Single use. Stories 28.1 and 28.2 read NFR-021 as applying to Whole day rows (`validity_mode = 'whole_day'`), and the one-per-open-visit rule is the Single-use equivalent. The PRD sentence should be amended to say so; no story edits the PRD.*

*Assumptions added by these stories (each is also tagged where it is used): (A1) the visit limit is evaluated at server receipt time, and a visit has ended when `checked_in_at + limit <= receipt time`; (A2) a visit's limit applies only to an open visit that a Single-use session was consumed for, so an open visit that began under Whole day or with charging off finishes under FR-044's timeout alone; (A3) in Single use a class during an open visit is covered only if that visit's own session exists (FR-238 stays `[ASSUMPTION]`); (A4) a Super Admin is not a setter of Session validity (AD-61 names Owner and Supervisor); (A5) the member app shows no new copy for a visit-covered state in this epic.*

---

### Story 28.1: Session Validity Setting and Session Record Changes

As an Owner or Supervisor,
I want to choose in Settings whether a paid session covers the whole day or one visit,
So that my gym's rule is mine to set, and nothing about how guests are charged changes until I choose.

*Delivers FR-236 (setting, setter, audit, Settings section), the schema half of FR-237 and FR-239 (the session record remembers the rule it was consumed under), NFR-021 (Whole day behaviour preserved). Amends FR-157, FR-159. Spine AD-55, AD-61 (setter), AD-32 (one setter, one pin trigger, excluded from the general save), AD-28, AD-29, AD-35 (support registry). UX gate: UX AD-13 "Session validity" section in EXPERIENCE.md; the screen states and copy there (Group D keys `settings.sessionValidity.*`, `settings.chargeGuests.helperSingleUse`, `settings.saveHint.v18`) are the acceptance baseline. No behaviour change for any existing gym: nothing in this story writes a Single-use row.*

**Acceptance Criteria:**

**Given** the `gyms` table
**When** the migration ships
**Then** `gyms.session_validity text not null default 'whole_day'` exists with CHECK `session_validity in ('whole_day','single_use')`, every existing and every new gym is `whole_day`, and no gym-creation path (Super Admin Create Gym, the self-signup path, seeds) needs a change to get that default

**Given** `platform_session_config` (singleton, super-admin-only RLS, 0107)
**When** the migration ships
**Then** it gains `single_use_visit_limit_minutes integer not null default 180 check (single_use_visit_limit_minutes > 0 and single_use_visit_limit_minutes <= 1440)`, the existing singleton row reads 180, and the read idiom `select c.<col> from platform_session_config c limit 1` keeps working for the existing columns

**Given** `private.audit_platform_session_config_update()` hard-codes the three old and new keys of its jsonb
**When** the migration ships
**Then** the function is replaced so the `old` and `new` objects also carry `single_use_visit_limit_minutes`, and a pgTAP case updates only that column as Super Admin and asserts one `platform_session_config_updated` audit row whose `old` is 180 and `new` is the new value (a change to only the new column must not be silently unaudited)

**Given** AD-32's rule that each setting has exactly one write path
**When** the setter is built
**Then** `set_session_validity(p_gym_id uuid, p_validity text) returns void` is `SECURITY DEFINER`, has its own BEFORE UPDATE pin trigger function `private.pin_session_validity()` (a new function, not a branch of `protect_super_admin_only_gym_columns()` or of another setting's pin) and its own GUC `app.session_validity_update_bypass`, and follows the shape of `set_gym_category` (0123) with `private.current_member_role()` in place of any JWT read

**Given** the setter
**When** it is called
**Then** the role gate is null-safe: Owner and Supervisor of `private.gym_id()` succeed; Manager, Receptionist, Coach, an ordinary Member, an anonymous caller and a caller with a null role each get `permission denied`; a Super Admin session also gets `permission denied` `[ASSUMPTION A4 — AD-61 names Owner and Supervisor; `category` admits Super Admin, this setting does not]`; a call naming another gym's id is refused; a suspended gym's staff are refused (FR-132); a value other than the two codes raises `invalid_session_validity`

**Given** a successful change
**When** the setter commits
**Then** exactly one audit row `session_validity_changed` is written in the same transaction with metadata `{ old_validity, new_validity }`, gym-scoped, actor the caller (via `private.actor_id()` for support, AD-39); a call that sets the current value returns without writing or auditing; the audit page (`apps/dashboard/app/(dashboard)/audit/auditLabels.ts`) maps the action to `audit.actionTypes.sessionValidityChanged` and renders "Whole day → Single use" (EN) and the FR equivalent; the existing audit-label test enumerates the new action

**Given** an Owner (or Manager, via the existing `owner_update_own_gym` paths, or `service_role`)
**When** they run a direct `UPDATE gyms SET session_validity = ...` (including through the general Settings save)
**Then** the pin trigger reverts the column with no error and no audit row, for every caller including Super Admin and `service_role`, and a pgTAP case proves it for each; a unit test of the Settings page's general save asserts its update payload never contains `session_validity`

**Given** GymOS Support (AD-35)
**When** the setter is registered
**Then** `private.support_capabilities` gains `('session_validity', 'rpc', 'set_session_validity')`, the function resolves its gym and role through `private.support_rpc_gym_id('set_session_validity')` and `private.support_rpc_role`, a support member of an assigned gym at `aal2` succeeds and is shown to the gym as "GymOS Support" (FR-186); an unassigned gym, an opted-out gym (FR-183), a suspended assignment and an `aal1` session each get `permission denied`; `supabase/tests/support_capabilities.test.sql` is edited in the same story to the new exact totals and sorted name arrays (the counts are read from the file at merge time, not assumed here)

**Given** the Settings page needs the visit limit to write "3 hours" and Owners cannot read `platform_session_config`
**When** the section loads
**Then** a read function `get_session_validity_settings()` (STABLE, SECURITY DEFINER, `search_path` pinned) returns `(session_validity, single_use_visit_limit_minutes)` for `private.gym_id()` only, for Owner and Supervisor (and support through the same registry entry, read kind); it returns nothing for another role and never another gym's value; `[ASSUMPTION — a definer read function is the smallest way to expose the platform value without opening the table to gyms]`

**Given** the Settings page (UX AD-13)
**When** an Owner or Supervisor opens it
**Then** a "Session validity" section sits directly under "Charge guests per session" and above "Loyalty program", with the radio group Whole day / Single use, the two descriptions (`settings.sessionValidity.wholeDayDesc`, `settings.sessionValidity.singleUseDesc` with `[H]` filled from the platform value, never typed into the string; minutes are shown as hours, to one decimal only when not a whole hour), `settings.sessionValidity.classNote` and `settings.sessionValidity.applies` visible, and the section is absent from the DOM for Manager, Receptionist and Coach (they cannot open Settings today; a component test asserts it for every role)

**Given** the section
**When** the user changes the choice
**Then** [Save session validity] (`settings.sessionValidity.save`) is enabled only while the choice differs from the saved value, saving calls only `set_session_validity`, shows the toast `settings.sessionValidity.saved`, and on error shows `settings.sessionValidity.error` inline with the radio left where the user put it; there is no confirmation dialog; the section saves on its own and the page hint reads "…, Session validity and Gym challenge" via `settings.saveHint.v18`

**Given** "Charge guests per session" is off, or the loyalty program is on
**When** the section renders
**Then** with charging off the section is still editable and shows `settings.sessionValidity.chargingOff`; the loyalty note `settings.sessionValidity.loyaltyNote` shows only when loyalty is on and the chosen option is Single use; the "Charge guests per session" helper reads "One session covers the whole day." under Whole day and `settings.chargeGuests.helperSingleUse` under Single use; the charging turn-on dialog's scope line is unchanged

**Given** the dependent wording
**When** the story closes
**Then** every key above exists in EN and FR in `packages/types` (or the dashboard i18n files, wherever Group D lives) and `scripts/check-i18n-key-parity.mjs` passes with no missing key and no hard-coded string in the new components

**Given** `guest_sessions`
**When** the migration ships
**Then** it gains nullable `validity_mode text check (validity_mode in ('whole_day','single_use'))`, `covered_kind text check (covered_kind in ('day','visit','class'))`, and `covered_booking_id uuid references class_bookings(id)` (`covered_attendance_id` already exists, added by Story 27.3 with its unique index; this story reuses it and does not redefine it), with an index `unique (covered_booking_id) where covered_booking_id is not null`; the foreign keys do not cascade a delete into a consumed session

**Given** the AD-55 cover rule
**When** a row is consumed
**Then** a CHECK `guest_sessions_cover_matches_kind` enforces: an unconsumed row (`consumed_at is null`) has `validity_mode`, `covered_kind`, `covered_day`, `covered_attendance_id` and `covered_booking_id` all null; a consumed `day` row is `whole_day`, has `covered_day` and neither id; a consumed `visit` row is `single_use`, has no `covered_day` and no booking id; a consumed `class` row is `single_use`, has `covered_booking_id` and no `covered_day` and no attendance id. A constraint trigger, `DEFERRABLE INITIALLY DEFERRED`, additionally requires that a consumed `visit` row has `covered_attendance_id` set **by commit** (PostgreSQL cannot defer a CHECK, and 28.2 sets the id after the attendance insert in the same transaction), and a pgTAP case proves a transaction that consumes a visit row and never sets the id fails at commit

**Given** the shipped index `guest_sessions_one_consumed_per_member_day` (0107) and CHECK `guest_sessions_consumed_has_covered_day` (0111)
**When** the migration ships
**Then** both are rebuilt in one transaction: the unique index on `(member_id, covered_day) where consumed_at is not null and voided_at is null and validity_mode = 'whole_day'`, and the CHECK as `consumed_at is null or validity_mode is distinct from 'whole_day' or covered_day is not null`; a pgTAP case proves two consumed `whole_day` rows for one member and day are still refused, and two consumed `single_use` visit rows for one member and day are accepted

**Given** consumed rows that exist in production today
**When** the migration backfills
**Then** every row with `consumed_at is not null` (voided or not) gets `validity_mode = 'whole_day'` and `covered_kind = 'day'`, no `covered_day`, `consumed_at`, `usable_until` or `voided_at` value changes, and a pgTAP case counts consumed rows before and after and asserts none lacks a mode

**Given** older fixtures, scripts and the shipped consume function write `consumed_at` and `covered_day` with no mode
**When** a BEFORE INSERT OR UPDATE trigger `private.guest_sessions_normalise_cover()` runs
**Then** a consumed row with `covered_day` set and no mode and no kind is stored as `whole_day` / `day`; and a row whose `consumed_at` is set back to null (the Epic 27 void releasing a session) has `validity_mode`, `covered_kind`, `covered_day`, `covered_attendance_id` and `covered_booking_id` all cleared, so `void_staff_check_in` needs no edit and the CHECK still holds; both are pgTAP-tested

**Given** `private.consume_guest_session` as shipped (0111, same signature)
**When** this story ships
**Then** its body is replaced with the same logic plus `validity_mode = 'whole_day', covered_kind = 'day'` in its single `UPDATE`; the signature, the return columns, the `exempt|covered|consumed|denied` outcomes and the `null` denial contract of `check_in()` are unchanged, and `audit_session_consumed()` (0113) adds `validity_mode` and `covered_kind` to its metadata while keeping `covered_day`, `consumed_at` and `source`

**Given** the readers
**When** the story closes
**Then** `apps/mobile/src/lib/sessionState.ts` (`GuestSessionRow`, `resolveSessionsLine`, the PostgREST `or` filter, `resolveReceiptSessionDates`) and `apps/dashboard/services/guestSessions.ts` (`MemberGuestSession`, the select list) carry `validityMode`, `coveredKind`, `coveredAttendanceId`, `coveredBookingId`; "covered today" in `sessionState.ts` stays true only for a consumed row whose `coveredDay` is today (a Single-use row has none); a consumed row with a null `coveredDay` renders as used with its consumed date and never throws; the generated types in `packages/types/src/database.ts` are regenerated

**Given** the whole existing guest-session surface
**When** the story is verified
**Then** these run unchanged and pass with no fixture edits: pgTAP `check_in_session_gate`, `check_in_session_gate.negative`, `class_session_gate`, `class_session_gate.negative`, `charge_guests_setting`, `charge_guests_setting.negative`, `charge_guests_default`, `desk_session_payment`, `desk_session_payment.negative`, `in_app_session_payment`, `in_app_session_payment.negative`, `loyalty_guest_rule`, `loyalty_guest_rule.negative`, `loyalty_foundation`, `loyalty_hook_reconciliation`, `loyalty_sweep_and_reversal`, `loyalty_sweep_and_reversal.negative`, `session_refund`, `session_refund.negative`, `session_gate_scoping`, `session_state_hygiene`, `session_alert_cooldown`, `session_alert_cooldown.negative`, `guest_sessions_overview`, `guest_sessions_overview.negative`; vitest `sessionState.test.ts`, `guestSessions.test.ts`, `MemberModal.sessions.test.tsx`, `support.identityLeak.test.ts`; the full Playwright suite (there is no guest-session Playwright spec before this epic, so the E2E claim is that no existing spec changes or breaks). The only test files edited are `support_capabilities.test.sql` and the audit-label test, both named above

**Given** a member of another gym, or any role without access
**When** they read `session_validity`, call `get_session_validity_settings()` or select `guest_sessions` cover columns
**Then** tenant isolation holds: another gym's staff and members see nothing, and the member sees only their own rows' cover columns, as for every other column today (NFR-001), pgTAP-tested

---

### Story 28.2: Single-Use Consumption at Check-In

As a guest at a Single-use gym,
I want each visit to need its own paid session, and a second scan during a visit to cost me nothing,
So that I pay for what I use, and the gym is never short-changed because someone forgot to check out.

*Delivers FR-237, the Single-use half of FR-239 for check-in, NFR-021 (atomic, member-locked, every entry path), NFR-028 (visit days are unchanged by a second same-day visit). Amends FR-159, FR-161, FR-044. Spine AD-55, AD-29 (one function, one lock, denial contract), AD-28, AD-31 (attempts and alert on denial), AD-30 (one stamp per consumed paid session). Covers both entry points of `private.record_check_in` (Epic 27): the QR scan through `check_in()` and the staff check-in. `[ASSUMPTION A1, A2]` below.*

**Acceptance Criteria:**

**Given** `private.consume_guest_session`
**When** this story ships
**Then** its signature becomes `(p_member_id uuid, p_gym_id uuid, p_receipt_at timestamptz, p_kind text default 'visit')` returning `(outcome text, session_created_at timestamptz, session_id uuid)` (dropped and recreated in one migration, every caller updated in the same migration), `p_kind` accepts `visit` and `class`, `class` in a `single_use` gym raises `class_single_use_unsupported` until Story 28.3 removes the guard (pinned by one pgTAP case that 28.3 replaces), execute stays revoked from `public`, `anon` and `authenticated`, and it remains called by nothing but `private.record_check_in` and `mark_class_attendance` (a source-scan test asserts the callers)

**Given** the member lock
**When** a Pay-per-session member with charging on and a price above 0 checks in at a `single_use` gym
**Then** `private.record_check_in` takes the member lock (`FOR NO KEY UPDATE`) first, then the open-visit handling, then the consume decision, then the attendance insert, in that order, and the function reads `gyms.session_validity` inside that lock; an `exempt` result (charging off, plan not Pay-per-session, price 0) is returned exactly as today with no session touched

**Given** a Single-use gym and a member with one usable session and no open check-in
**When** the member checks in (morning)
**Then** the soonest-lapsing session (paid before free on a tie, FR-159's ordering) is consumed with `validity_mode = 'single_use'`, `covered_kind = 'visit'`, `covered_day` null, `consumed_at` = server receipt time; the attendance row is inserted; **after** the insert, in the same transaction, `covered_attendance_id` is set to the new attendance id (the deferred constraint of 28.1 passes at commit); one guest stamp is earned through `private.on_session_consumed` and the `session_consumed` audit row is written (FR-165, FR-162)

**Given** the same member who checked out (manual or automatic) and holds a second usable session
**When** they check in again the same gym-local day (evening)
**Then** a second session is consumed, a second `visit` row is bound to the new attendance id, a second stamp is earned, the one-per-day unique index of 28.1 does not fire (it covers `whole_day` rows only), and the member has two consumed sessions that day

**Given** the member has an open visit younger than the visit limit
**When** they scan again (double scan, including two scans from two devices)
**Then** the existing open-check-in rejection is returned ("You're already checked in", the shipped `check_in: member % already has an open check-in` path and its mapped client message), **before** the consume function is called: no session is consumed, no stamp is earned, no `session_attempts` row and no front-desk alert is written, and the first visit's `covered_attendance_id` is unchanged

**Given** the visit limit (`platform_session_config.single_use_visit_limit_minutes`, default 180) `[ASSUMPTION A1]`
**When** the member scans with an open visit whose `checked_in_at` is 179, 180 and 181 minutes before receipt time
**Then** at 179 minutes the scan is rejected "already checked in" and costs nothing; at 180 and 181 the visit has ended (the test is `checked_in_at + limit <= receipt time`, the same comparison the shipped stale test makes), it is closed with `checked_out_at = checked_in_at + limit` exactly (never now(), never in the future relative to the new check-in) and `checkout_type = 'auto'`, one `attendance_stale_check_in_auto_closed` audit row is written with metadata `reason: 'visit_limit'` and `visit_limit_minutes`, and a new session is consumed for the new visit; a pgTAP case changes the platform value to 90 and repeats the boundary at 89, 90 and 91 minutes to prove the value is read, not hard-coded

**Given** a visit that began under Single use with a covering session `[ASSUMPTION A2]`
**When** the stale test runs
**Then** the limit applies only to an open visit that is the `covered_attendance_id` of a consumed, non-voided `single_use` session; an open visit with no such session (charging was off, the member was exempt, or the visit began under Whole day) is judged by `gyms.checkin_timeout_hours` alone, exactly as FR-044 today; and where the gym's timeout is shorter than the limit the effective stale test is the earlier of the two, so the open row is closed at `checked_in_at + least(timeout, limit)`

**Given** the limit and the gym timeout are different things (AD-55)
**When** an open visit is between the limit and `checkin_timeout_hours`
**Then** occupancy (`member_occupancy_band`, `private.gym_occupancy_band`, Currently Checked In) and the auto-timeout job still count it until the member scans, a staff member checks them out, or `checkin_timeout_hours` passes; the limit closes a visit only at the moment of a later scan; a pgTAP case asserts occupancy at limit + 1 minute is unchanged and the auto-timeout job still closes at `checked_in_at + checkin_timeout_hours` (FR-045)

**Given** a member who forgot to check out and returns after the limit with **no** usable session
**When** they scan
**Then** the stale visit is closed at `checked_in_at + limit` as `auto` and audited, the scan is denied with `null` (the shipped contract), one `session_attempts` row (`source = 'check_in'`) and one `session_required` front-desk alert are written, no attendance row is inserted, and the stale close **commits with the denial** (as the shipped stale close does); after the desk records the session payment (FR-158) a rescan consumes it and succeeds

**Given** the denial contract for older app builds (AD-29)
**When** a Single-use denial occurs
**Then** the return value is the same `null`, with no new result type and no coded row, and the current mobile build maps it to the "Pay for your session" state through `resolveRefusal` (unchanged), while an old build still shows its expired copy and does not admit the guest; the "reason" is read from the attempt row, never the return value (a test asserts the function's return type is unchanged for `check_in()`)

**Given** an offline scan (FR-161)
**When** it syncs
**Then** FR-159's time rules govern: the open-visit age and the limit are judged at server receipt time; the scan time is honoured only when it is within the gym's auto-timeout window of receipt and not before the covering session existed, otherwise receipt time is used; a replay of the same `client_scan_id` returns the stored row and consumes nothing; with no usable session the sync is denied as an attempt keyed by its scan id and the FR-160 alert is raised; an offline scan whose honoured scan time is already older than the visit limit at receipt consumes one session and is recorded closed at `scan time + limit` as `auto` in the same transaction (the shipped immediate-stale pattern), so it cannot block a later scan; all four cases are pgTAP-tested

**Given** the staff check-in path of Epic 27 (`staff_check_in`, `source = 'staff'`)
**When** staff check in a Single-use guest
**Then** the same function path applies with no separate rule: an open visit younger than the limit is rejected "already checked in" at no cost; a guest with no session is denied with a `session_attempts` row `source = 'staff'` and no front-desk alert (FR-249), and after the desk payment the check-in completes and consumes one session; `void_staff_check_in` on that visit releases exactly the session bound to it (28.1's normalising trigger clears the cover columns), appends the `stamp_reversed` event, and is allowed even when a later same-day visit exists, because in Single use no later visit relies on this session's coverage

**Given** a member in a `whole_day` gym, and a gym with charging off
**When** they check in, check out and check in again
**Then** behaviour is byte-for-byte today's: one consumed `day` row, the second scan `covered`, no `visit` row ever written; the whole list of suites in Story 28.1's regression AC passes again, unchanged, after this story's migration

**Given** the setting is flipped while a member has activity that day
**When** the gym moves Whole day → Single use at 10:00 after a 09:00 session was consumed as `day`
**Then** that `day` row still covers the member's later check-ins that day (coverage is judged from the row's own `validity_mode`, never the gym's current value), a return at 11:00 consumes nothing, and the first check-in after the day's `day` row no longer applies (next day) consumes a `visit` session; and when the gym moves Single use → Whole day while a visit is open, that open visit finishes under the limit rule it began with (a scan after the limit closes it at `checked_in_at + limit` and consumes a new `day` session), and a later same-day return after check-out consumes a `day` session and then covers the rest of the day

**Given** concurrent scans (NFR-021)
**When** two check-ins for one Single-use member run at the same instant, with two usable sessions
**Then** exactly one visit is created and exactly one session is consumed and exactly one stamp is earned; the other is rejected "already checked in" with no cost; pgTAP asserts the sequential equivalent and the backstops (the open-check-in partial unique index of AD-22 and `unique (covered_attendance_id)`), and a two-connection script `scripts/single-use-race.sh` (the shape of `scripts/session-refund-race.sh`) proves the real interleaving, is wired into `scripts/ci-local.sh`, and passes; a second script case races a refund of the only unused session against a scan and proves exactly one outcome

**Given** engagement counts (NFR-028, FR-225)
**When** a member has two Single-use visits on one gym-local day
**Then** `attendance_counted` has two rows and `member_visit_days` has one row for that day for the member (several check-ins in a day count once), a denied scan adds neither, and a visit that arrives late through offline sync takes the gym-local day of its honoured recorded time

**Given** the existing suites and the tests this story must change
**When** the story closes
**Then** `suspension_rpc_coverage.test.sql` and the `check_in()` source check in 0111's verify block still pass with the order of the open-visit handling, consume and insert described above (updated only if Epic 27 has not already updated them, and named in the story if so); new pgTAP files `single_use_check_in.test.sql` and `single_use_check_in.negative.test.sql` carry the cases: morning and evening, double scan, forgotten check-out with and without a session, boundary at 179/180/181 minutes and at 89/90/91 with the platform value changed, concurrent scans, setting flip in both directions mid-day and mid-visit, offline replay, staff path and void, whole_day regression, tenant isolation (another gym's member and staff cannot read or consume the session), an exempt plan (price 0) and a non-Pay-per-session member consuming nothing

---

### Story 28.3: Class Attendance in a Single-Use Gym and Setting-Change Parity

As a guest at a Single-use gym who attends a class,
I want the class to cost nothing extra when I am already inside on a paid visit, and its own session when I am not,
So that I am charged once for what I attended, and the owner's session counts, stamps and audit stay trustworthy whichever rule the gym uses.

*Delivers FR-238 `[ASSUMPTION — class inside an open Single-use visit; confirm in stories (OQ-35)]`, FR-239 in full, FR-174 amended, NFR-021 for the class path. Spine AD-55, AD-29, AD-21 (class marking never writes `attendance_events`), AD-28, AD-30, AD-31. UX: Guest Sessions UX AD-22 "Used" column and the Sessions section of UX AD-04 (Single-use wording); the "Desk check-in" source row of UX AD-22 is Epic 27's (FR-249), this story only proves it still renders, see the last AC. Assumptions A3 and A5.*

**Acceptance Criteria:**

**Given** `mark_class_attendance(p_booking_id uuid)` (keeps its signature and its `{ code, message }` error surface, AD-9)
**When** this story ships
**Then** it calls `private.consume_guest_session(member, gym, now(), 'class')` (the same function, nothing new), the Story 28.2 guard `class_single_use_unsupported` is removed and its pgTAP case replaced, the existing `attended_at is null` guard still makes a re-mark consume nothing, and class attendance still never writes `attendance_events`

**Given** a Single-use gym and a Pay-per-session member with an open visit younger than the visit limit, whose visit is the `covered_attendance_id` of a consumed `single_use` session `[ASSUMPTION A3 — FR-238 requires the visit's own session]`
**When** staff or the coach mark the member attended at a class
**Then** the outcome is `covered`: no session is consumed, no stamp is earned, no row is written to `guest_sessions`, `class_bookings.attended_at` is set, and a second class in the same open visit also costs nothing

**Given** a Single-use gym and a member with no open visit, or an open visit older than the limit, or an open visit that no Single-use session covers (opened before charging was switched on)
**When** the member is marked attended at a class
**Then** one usable session is consumed (FR-159's ordering) with `validity_mode = 'single_use'`, `covered_kind = 'class'`, `covered_booking_id` = the booking, `covered_day` and `covered_attendance_id` null, set in the same transaction as `attended_at` (so a refused or failed update leaves no consumed session); one stamp is earned; and the class marking does not close a stale open visit and does not write attendance (AD-21)

**Given** a class-bound session `[FR-238 assumption: it covers nothing else]`
**When** the member later scans in at the gym the same day
**Then** the check-in consumes another session as a `visit` (the class session covers neither the floor nor a second class that is not in the same visit), and a second class the same day with no open visit consumes a second `class` session; the reverse also holds: a class marked inside a visit consumes nothing

**Given** a Whole day gym, or any `whole_day` row already consumed that day
**When** a class is marked
**Then** FR-174 is unchanged: a consumed `day` row covers the class, a class that consumes a session in a Whole day gym writes a `day` row that also covers the floor that day and a second class costs nothing; in a Single-use gym a `whole_day` row consumed earlier that day (the setting was flipped) still covers the class, because coverage is judged from the row's own mode

**Given** no usable session at a Single-use gym
**When** a class is marked
**Then** the existing denial stands: `attended_at` stays null, one `session_attempts` row (`source = 'class'`, fresh scan id, `class_session_id`) and one `session_required` front-desk alert are written, and the caller receives the same `{ code, message }` error as today; an exempt plan (price 0) and a member not on Pay-per-session are marked as before

**Given** two simultaneous class marks, or a class mark racing a scan, for one member
**When** they run
**Then** at most one session is consumed per distinct need (one `class` row per booking via `unique (covered_booking_id)`, one `visit` row per attendance via `unique (covered_attendance_id)`), the lock order of AD-29 holds, and the `scripts/single-use-race.sh` script of 28.2 gains a class-vs-scan case that passes

**Given** FR-239, a setting change
**When** the owner flips Whole day → Single use, or Single use → Whole day
**Then** the change applies to check-ins and class marks made after it; a visit already open finishes under the rule it began with; a consumed session keeps the coverage its own row records (`validity_mode`, `covered_kind`) and no existing row is rewritten (a pgTAP case snapshots every `guest_sessions` row of the gym before and after a flip and asserts they are identical); each of the four combinations (flip with a `day` row, with an open `visit` row, with a `class` row, and with no activity) has a case

**Given** lapse windows (FR-159, FR-166)
**When** the setting is flipped
**Then** an unused paid session still lapses 7 days after its payment and an unused free session 60 days after it is earned, read from `platform_session_config`, and the daily loyalty sweep (`run_loyalty_sweep_job`) lapses and audits the same rows under either setting; a consumed row is never lapsed; one pgTAP case per window under each setting

**Given** loyalty (FR-165, FR-239)
**When** a Single-use member consumes sessions
**Then** exactly one guest stamp is earned per consumed paid session (two visits and one class-with-own-session in a day earn three stamps; a class covered by an open visit earns none; a free session earns none), a refund of a consumed session reverses exactly that session's stamp and does not take back a free session already earned (FR-162), the counter never goes below 0, the effect of N is unchanged, and stamps are earned only while both the loyalty program and charging are on; tested against the same fixtures as `loyalty_guest_rule`

**Given** the Guest sessions card and drill-down (FR-163, UX AD-22) and the session audit (FR-162)
**When** a Single-use gym has consumed sessions
**Then** the card's paid count, the Paid tab and the blocked counts count consumed sessions by `consumed_at` and attempts as before, under either setting, the counts are server-side aggregates, and `session_consumed`, `session_refund_applied` and `session_attempt_blocked` audit rows are written for visit and class sessions exactly as for day sessions (`session_consumed` metadata carries `validity_mode`, `covered_kind` and, for `class`, `covered_booking_id`); a pgTAP case in `guest_sessions_overview` style asserts the totals are identical for the same sequence of consumptions under Whole day (one per day) versus Single use (one per visit)

**Given** the member modal Sessions section (UX AD-04) and the Used column of UX AD-22
**When** a session was consumed under Single use
**Then** a `visit` row reads "Used · visit on [date], [time]" and a `class` row reads "Used · class [name], [date]" (`members.sessions.usedVisit`, `members.sessions.usedClass`, labels `members.sessions.coveredVisit` and `members.sessions.coveredClass`), a `day` row keeps today's "Covered day" wording in either gym, rows keep the label they were recorded under after a flip, and the AD-22 Used column reads "covered day", "visit [date], [time]" or "class [name], [date]" by `coveredKind`; the date and time are gym-local (the gym's timezone, never UTC), EN and FR keys exist with no hard-coded string, and component tests cover the three row kinds in both locales; a session returned by an Epic 27 void shows as Unused with its original lapse date

**Given** the member app `[ASSUMPTION A5]`
**When** the member is inside a covered Single-use visit
**Then** the Home sessions line is unchanged in structure (usable count and soonest lapse), `sessionState.ts` is covered by vitest cases for `visit` and `class` rows (never counted as "covered today"), and no new member-facing copy is added in this epic; an Owner-facing note on older builds (UX AD-13 `[NOTE FOR UX]`) is left to the UX pass and does not hold this story

**Given** the "Desk check-in" source value of UX AD-22 (Epic 27, FR-249)
**When** a staff check-in is denied for a Single-use guest
**Then** the Blocked tab shows the row with the "Desk check-in" source if Epic 27 wrote `session_attempts.source = 'staff'`, and this story adds no source value of its own; if Epic 27's label is absent the story records that as a defect against Epic 27, not extra scope here

**Given** the PRD §10.3 Step 2 items 2 and 5
**When** the E2E spec `apps/dashboard/e2e/single-use-validity.spec.ts` runs (APIRequestContext against the real RPCs, the pattern of `class-booking-capacity.spec.ts`, its own gym and members created through the fixtures, torn down afterwards)
**Then** it proves in order: an Owner switches the gym to Single use through the Settings section and the audit row appears; a Pay-per-session guest with a recorded session payment checks in and is admitted (one session consumed); a second scan during the visit is rejected "You're already checked in" at no cost; after check-out and a second recorded payment the same guest's second visit the same day is admitted and a second session is consumed; a class marked inside that visit costs nothing, and a class marked with no open visit consumes its own session; the Guest sessions card counts consumed sessions per visit; a gym-level flip back to Whole day leaves every consumed session's coverage untouched; and a Receptionist and a Coach get no Session validity section and a refused setter

**Given** the epic's closing gate
**When** Story 28.3 closes
**Then** `scripts/ci-local.sh` passes in full (static, unit, pgTAP, E2E, the race scripts), the Epic 28 requirement list FR-236 to FR-239, NFR-021 and NFR-028 each trace to at least one passing named test in the stories above, and `sprint-status.yaml` records the epic's last_updated entry


---

### Epic 29 — Stories

| # | Story | Migration | Depends on |
|---|---|---|---|
| 29.1 | Class Schedule Slots Foundation (No UI Change) | next free at merge time | none |
| 29.2 | Per-Day Slot Editor and Cancel Class | next free at merge time | 29.1 |
| 29.3 | Coaches Create, Edit and Cancel Their Own Classes | next free at merge time | 29.1, 29.2 |
| 29.4 | Coach Picker for Owner, Supervisor and Manager | next free at merge time | 29.1, 29.2 (server half); 29.3 (the My Classes list component the Classes tab reuses) |

*Epic 29 is independent of Epics 27 and 28 and can run in parallel with them. Inside the epic the chain is 29.1 → 29.2 → 29.3 → 29.4; the server half of 29.4 (the read functions and the CI check) needs only 29.1 and 29.2 and may start once 29.2 has merged. Migration numbers are assigned at merge time (the next free number then; disk head today is 0172, and Epics 27, 28, 30 and 31 take numbers too); earlier stories never renumber.*

*Production is live with real gyms and real classes with real bookings: 29.1 rewrites the daily session job and expands every existing recurring class, 29.3 widens who may write `classes`, and 29.4 adds the only staff read path onto coach data. Each story ships behind the full `scripts/ci-local.sh` gate, the existing pgTAP suite passes without fixture edits unless a story names the test that must change, and every new `SECURITY DEFINER` function passes the live-authorization claim inventory (`scripts/claim-inventory.mjs`, no new `claim-only` entry), `suspension_rpc_coverage.test.sql` and the AD-35 catalog test in `support_capabilities.test.sql`.*

*Vocabulary. "Spine AD-nn" is an architecture decision in `ARCHITECTURE-SPINE.md`; "UX AD-nn" is a screen in `EXPERIENCE.md` (UX AD-18 Classes list, UX AD-19 Create/Edit class, UX AD-21 Coach Portal My Classes, UX AD-14/UX AD-15 Coach member list and detail, UX AD-20 Coach Overview, UX AD-32 Coach Picker). `classes.coach_id` references `members.id`, not a user; "the caller's own member row" is resolved from `auth.uid()` and the live role, never from a client value. `weekday` follows the existing 0 = Sunday .. 6 = Saturday convention (`extract(dow ...)`, as `classes.recurrence_days`).*

*Names that exist today (verified in `supabase/migrations`): `classes` (0057), `class_sessions` with unique `(class_id, scheduled_at)` (0057), `class_bookings` with unique `(class_session_id, member_id)` and `attended_at` (0058, 0068), `private.materialize_sessions_for_class(uuid)` (0057, service_role only), `public.materialize_class_sessions(uuid, boolean)`, `public.create_class(...)` and `public.update_class(...)` (0057, 0058, live bodies in 0124), the daily cron job `class_session_materializer` running `run_class_session_materializer_job()` (0057, `0 2 * * *`, logs to `job_runs`), `list_my_classes()` and `list_my_class_session_roster(uuid)` (0096), `book_class_session(uuid)` (0058, row-locks the session), `cancel_class_booking(uuid)` (0058, hard-deletes the booking row), `mark_class_attendance(uuid)` (0068, 0110, 0112, 0124), `list_bookable_class_sessions()` and `list_my_class_bookings()` (0078), `private.is_own_coach_id(uuid)` (0041: true when the `members` row with that id has `user_id = auth.uid()`; it checks neither gym nor role nor deactivation), trigger `classes_validate_coach_trigger` (0057), CHECK `classes_schedule_matches_type` (recurring needs days, time and start date). There is no cancel function and no cancel column for a class or a session today.*

---

### Story 29.1: Class Schedule Slots Foundation (No UI Change)

As a gym owner whose classes already run every week,
I want each recurring class's times stored as one row per weekday-and-time, with the daily job reading those rows,
So that the next stories can give a class a different time on each day without changing a single existing session, booking or screen.

*Delivers FR-244 (data model, slot cap, per-session booking unchanged), FR-245 (migration of existing classes; edit rule on the data side), NFR-001 (booking and session reads stay inside the performance targets); spine AD-57, AD-21 (lock order), AD-1; amends FR-104. No UX gate: no screen changes, the Schedule column and the Create/Edit class modal read and write exactly as today. Priority tag: FR-244 and FR-245 follow the PRD's release gate 10.3 item 3 and 6; the 14-slot cap is `[ASSUMPTION]` (FR-244) and is pinned here; the rule for slot edits is `[ASSUMPTION]` (FR-245, OQ-35), confirmed in this story.*

**Acceptance Criteria:**

**Given** the migration is applied
**When** the schema is inspected
**Then** `class_schedule_slots(id uuid pk, class_id uuid not null references classes(id) on delete cascade, gym_id uuid not null references gyms(id), weekday smallint not null check (weekday between 0 and 6), start_time time not null, created_at timestamptz not null default now())` exists with a unique constraint on `(class_id, weekday, start_time)` and an index on `gym_id`
**And** `start_time` has no seconds (`date_trunc('minute', start_time) = start_time` CHECK), because times are entered "to the minute" (UX AD-19)
**And** `recurrence_start_date` stays on `classes`; no column is added to `classes`, `class_sessions` or `class_bookings` in this story

**Given** a slot insert whose `gym_id` differs from its class's `gym_id`
**When** it is attempted (as the definer functions below, and as a superuser fixture)
**Then** a before-insert/update trigger refuses it (same tenancy shape as `classes_validate_coach_trigger`), and a slot cannot be moved to another class or gym by update

**Given** a class that already has 14 slots
**When** a 15th slot is inserted (for the same or a different weekday)
**Then** a trigger refuses it with a stable message ("a class can have at most 14 weekly times")
**And** the trigger takes `SELECT ... FOR UPDATE` on the class row before counting, so two concurrent inserts of the 14th and 15th slot cannot both pass; a pgTAP test proves the count after 14 inserts, the refusal of the 15th, and that deleting one slot allows another
**And** inserting the same `(class_id, weekday, start_time)` twice is refused by the unique constraint, while the same weekday at two different times is accepted (FR-244)

**Given** RLS and grants on `class_schedule_slots`
**When** each role reads it
**Then** any authenticated user of the gym reads that gym's slots (`gym_id = private.gym_id()`, the same rule as `gym_staff_read_own_classes`: class metadata is readable by the gym by design, FR-145), and a restrictive `tenant_active_gate` policy denies a suspended gym exactly as on `classes` (migration 0124 pattern)
**And** `INSERT`, `UPDATE` and `DELETE` are revoked from `authenticated`, `anon` and `service_role`: the only writers are the definer functions below (the 0111 pattern), proven by a test that a Manager, an Owner, a Coach and the service role each get a permission error on a direct write
**And** another gym's slots return zero rows for every role (cross-tenant negative test per role; AD-1)

**Given** every existing `classes` row with `schedule_type = 'recurring'`
**When** the migration runs
**Then** each class gets one slot per entry of its `recurrence_days`, all at its `recurrence_time`, so the set of `(weekday, start_time)` per class equals `unnest(recurrence_days) x recurrence_time` exactly
**And** a `do $$ ... $$` block at the end of the migration raises (rolling back the migration) if any recurring class ends with zero slots, if any slot count differs from `cardinality(recurrence_days)`, or if the `class_sessions` or `class_bookings` row counts or their `md5` over `(id, class_id, scheduled_at)` / `(id, class_session_id, member_id, attended_at)` differ before and after
**And** a pgTAP test with a fixture of recurring classes (a daily class, a Tue/Thu class, a Sunday-only class to exercise weekday 0, a class with a past `recurrence_start_date`, a class with booked and attended sessions) proves the slot sets, and that `class_sessions` and `class_bookings` are byte-identical before and after, and that one-off classes get no slot
**And** the migration is idempotent on a re-run in the local reset (`insert ... on conflict do nothing`)

**Given** a recurring class
**When** the schema is checked
**Then** `classes_schedule_matches_type` is replaced so a recurring class requires only `recurrence_start_date`; `recurrence_days` and `recurrence_time` stay on the table, nullable for recurring rows, and one-off rows still require `one_off_session_at` and null recurrence columns
**And** a deferred constraint trigger (initially deferred, so create-then-insert-slots in one transaction passes) refuses to commit a recurring class that has no slot, and refuses to commit a one-off class that has one
**And** `recurrence_days` and `recurrence_time` are not dropped (spine AD-57: they stay for legacy and one-off rows; the clean-up migration is out of scope for Epic 29 and recorded in `deferred-work.md`)

**Given** `private.materialize_sessions_for_class(p_class_id)` and `run_class_session_materializer_job()`
**When** the daily job `class_session_materializer` runs, or `create_class`, `update_class` or `materialize_class_sessions` call the shared function
**Then** a recurring class's sessions are generated from `class_schedule_slots` (weekday of each date in the 4-week rolling window, the slot's `start_time` converted with the gym's `timezone` at generation, dates on or after `recurrence_start_date`), inserted with `on conflict (class_id, scheduled_at) do nothing`, and the job still logs one `job_runs` row with `job_name = 'class_session_materializer'`
**And** an equivalence test builds, for each fixture class from the migration test, the set of `(class_id, scheduled_at)` the pre-migration function would have produced from `recurrence_days`/`recurrence_time` (computed inline in the test) and proves the slot-based function produces the same set, including across a daylight-saving gym time zone and for a Sunday slot
**And** running the job twice in a row inserts no row the second time, and a manual `materialize_class_sessions` after the job inserts none either (idempotent on `(class_id, scheduled_at)`)
**And** the rolling-window definition (`current_date .. current_date + 4 weeks`, server date) is deliberately unchanged here; its gym-local-day imprecision is existing behaviour, recorded in `deferred-work.md`, not fixed in this story

**Given** `create_class(...)` and `update_class(...)` keep their current signatures in this story (the dashboard is unchanged)
**When** a Manager, Supervisor or Owner creates or edits a recurring class through them
**Then** the function derives the slots as one per selected day at the single time and writes them (and, for compatibility, keeps writing `recurrence_days` and `recurrence_time`), so a class created after this migration through today's UI behaves exactly as a migrated one
**And** the Schedule column and the modal show the same days and time as before the migration for every fixture class (a component test on the unchanged `ClassesPageClient` and `ClassModal` with fixture data, and the existing `class_creation_scheduling*.test.sql` suites pass without edit)

**Given** a private function `private.apply_class_slots(p_class_id uuid, p_slots jsonb)` that returns the left-unchanged sessions (the single regeneration path used by `update_class` now and by 29.2's functions later; `service_role` and definer callers only)
**When** the slot set of a recurring class is replaced
**Then** it takes the class row lock (`FOR UPDATE` on `classes`) first, then locks the candidate future session rows (`class_sessions where class_id = p_class_id and scheduled_at > now()`) `FOR UPDATE` in `scheduled_at` order, never the other way round: this is AD-21's order (`book_class_session` locks a session row, and the class lock is always taken first by writers)
**And** a future session that has no booking, **re-checked under the session lock**, and no longer matches any slot (local weekday and local time of `scheduled_at` in the gym's time zone) is deleted; a session that matches a slot is kept whether or not it has bookings; sessions that match no slot **and have at least one booking** are left exactly as they are and returned to the caller as `(class_session_id, scheduled_at, booked_count)`, never deleted and never raising
**And** past sessions (`scheduled_at <= now()`) are never touched, and the missing sessions for the new slots are then generated through the shared materializer
**And** the function is the reverse of migration 0058's rule: for a **recurring** class, `materialize_class_sessions(p_class_id, true)` and `update_class` no longer raise "cannot reschedule class ... existing bookings on its future sessions"; they regenerate under the rule above (`[ASSUMPTION]` decided here: one-off classes are unchanged by FR-244 and keep the 0058 refusal, so test section (u) of `class_booking_with_capacity_enforcement.test.sql`, whose fixtures 8094 and 8095 are one-off, passes without edit)

**Given** a booking that lands on a future session while a slot edit is running
**When** two sessions (two database connections, as the existing class-booking concurrency tests do) run `book_class_session` and `apply_class_slots` against the same unbooked, no-longer-matching session
**Then** whichever commits first wins consistently: either the booking is made and the session is kept and listed as left unchanged, or the session is deleted and the booking attempt gets the not-found result; in no ordering is a booking row orphaned, a foreign-key error raised to the editor, or a deadlock reported; a repeat run of the pair (50 iterations) shows no deadlock

**Given** a gym whose time zone is later changed
**When** the daily job next runs
**Then** new sessions use the new zone and existing sessions are not moved (consistent with how the current job behaves); stated in Dev Notes, no code

**Given** the new functions and trigger bodies
**When** the repo-wide checks run
**Then** `scripts/claim-inventory.mjs` shows no new `claim-only` entry, `scripts/check-migration-guardrails.mjs` passes, the `suspension_rpc_coverage` test passes for any new public function (the "gym is not active" guard and no comments in the body, as `list_my_classes`), and `support_capabilities.test.sql` totals and name lists are unchanged (nothing here is a support capability)
**And** `packages/types/src/database.ts` is regenerated and the dashboard type-check passes with no source change

---

### Story 29.2: Per-Day Slot Editor and Cancel Class

As a Manager, Supervisor or Owner,
I want to give a class a different time on each day, see which booked sessions an edit left alone, and cancel a class that will not run again,
So that the gym's real weekly timetable fits in one class and a class that stops can be ended in one action.

*Delivers FR-244 (per-day editor, up to 14 slots, duplicates refused), FR-245 (edits apply to future sessions without bookings; sessions with bookings listed to the editor), and the `cancel_class` function that spine AD-57 and FR-246 rely on; NFR-001; spine AD-57, AD-21, AD-34 (live write gate), AD-35 (not a support capability), AD-1; amends FR-104, FR-121. UX gate: UX AD-18 (Schedule column, [Cancel class], Cancelled badge, "Old time" tag), UX AD-19 (weekly-times editor and the "left unchanged" result view) and the Cancel class dialog in EXPERIENCE.md; the screen states and copy there, and the keys in "Group F" and `classes.cancel.*`, are the acceptance baseline. Priority: the `[ASSUMPTION]` tags in the UX text (Monday-first order, pre-fill, cancelled classes stay listed, the server can tell an old-time session by comparing) are carried as written.*

**Acceptance Criteria:**

**Given** the existing `create_class` / `update_class` signatures used by the live dashboard
**When** this migration lands
**Then** new overloads `create_class(..., p_slots jsonb)` and `update_class(..., p_slots jsonb)` exist (every old parameter kept in the same order, plus a trailing `p_slots jsonb` with **no** default so PostgREST resolves by argument names unambiguously), the old signatures stay and keep working unchanged for the rollout window (production is live: the migration deploys before the dashboard), and a pgTAP test proves both signatures resolve and behave
**And** `p_slots` is a JSON array of `{weekday, start_time}` (`weekday` 0 = Sunday .. 6 = Saturday, `start_time` `HH:MM`); the server rejects with stable messages: no slot for a recurring class, more than 14, a malformed or out-of-range weekday or time, a duplicate `(weekday, start_time)` in the array, seconds in a time, and `p_slots` supplied for a one-off class
**And** `update_class(..., p_slots)` returns `jsonb` `{ "left_unchanged": [ {class_session_id, scheduled_at, booked_count, capacity} ... ] }` (empty array when nothing was left), produced by 29.1's `private.apply_class_slots`; it is never an error to have bookings
**And** a recurring class saved with different times per day stores `recurrence_days = null`, `recurrence_time = null` (the legacy columns cannot express it); `update_class` on a one-off class is unchanged

**Given** a recurring class with future sessions, some booked
**When** its slots change (a time moved, a day added, a day removed, a weekday given a second time)
**Then** pgTAP proves: unbooked future sessions that no longer match are deleted and the new ones appear; a booked session that no longer matches is kept with its bookings and returned in `left_unchanged`; a booked session that still matches is untouched and not returned; past sessions are untouched; repeating the same edit returns the same `left_unchanged` list and changes no row (idempotent, no orphan duplicates); "Mon 07:00 → 07:30" with the 07:00 session booked yields the old session listed and a new 07:30 session created beside it
**And** a switch between One-off and Recurring follows the same rule (leaving recurring lists booked future sessions; entering recurring creates slots), and `recurrence_start_date` continues to bound generation

**Given** `public.cancel_class(p_class_id uuid)` and the columns it needs
**When** this migration lands
**Then** `classes` gains `cancelled_at timestamptz` and `cancelled_by uuid references members(id)`, and `class_sessions` gains `cancelled_at timestamptz` (these are the only schema changes of the story besides the overloads and the view below); a CHECK keeps `cancelled_by` null whenever `cancelled_at` is null
**And** `cancel_class` is `SECURITY DEFINER`, revoked from `public` and `anon`, granted to `authenticated`, and gated by the live role read (`private.current_member_role()` in `manager`, `supervisor`, `owner`; Receptionist and Coach refused in this story, Coach own-class access arrives in 29.3) and `gym_id = private.gym_id()`; it returns `{ "bookings_cancelled": N }`, where N is the number of bookings on the class's future sessions at the moment of cancelling, computed by the server (the dialog shows the server's number)
**And** it takes the class row lock, then the future session rows `FOR UPDATE`, sets `cancelled_at` and `cancelled_by` on the class and `cancelled_at` on every future session (`scheduled_at > now()`), **flags rather than deletes** (a session row is never deleted by it, booking rows stay, past sessions and all attendance stay untouched), and writes one audit row with action `class_cancelled` and "[N] bookings cancelled" in the metadata
**And** cancelling an already cancelled class raises the stable message mapped to `classes.cancel.already`; another gym's class, a missing class and an unauthorised caller get the uniform not-found / permission message (no information about other gyms); a deactivated or suspended-gym caller is refused through the live gate (AD-34)
**And** a cancelled class is excluded from the daily job (`private.materialize_sessions_for_class` returns without inserting), `update_class` and `materialize_class_sessions` refuse it with the same "already cancelled" message, and `book_class_session`, `mark_class_attendance` and `cancel_class_booking` treat a cancelled session as not bookable, not markable and not "cancellable by the member" (the booking stays on record) with their own stable messages; the class reminder job (N-07, `private.send_class_reminder`) sends nothing for a cancelled session (pgTAP: a booked, cancelled session with a reminder due produces no `class_reminder_dispatches` row)
**And** `cancel_class` is **not** registered in `private.support_capabilities` and `support_capabilities.test.sql` totals and name arrays are unchanged; it mentions `'supervisor'`, so the catalog test's classification of such functions is extended in the same story (Support is refused with the uniform denied result)

**Given** booked members whose class is cancelled
**When** the class is cancelled in V1.8
**Then** no push, SMS or in-app notification is sent (product owner decision 2026-11-15; recorded as a story note and in `docs/decisions.md`): a pgTAP test proves no `notifications` row and no dispatch row is created by `cancel_class`
**And** the mobile Classes screen (MA-16) reads the cancelled state: `list_bookable_class_sessions()` omits sessions of a cancelled class, `list_my_class_bookings()` returns `class_cancelled boolean` for each booking, and the booking shows the neutral badge "Cancelled" / « Annulé » on MA-16 and on Home's upcoming-classes list (which drops it); `[ASSUMPTION]` this member-side display is not drafted in the UX contract (`[NOTE FOR UX]` in UX AD-18): the story reuses the shared "Cancelled" badge style and adds the EN and FR mobile keys, with a mobile component test and EN/FR parity check; whether a single session can be cancelled without cancelling the class is out of scope and stays recorded as not drafted

**Given** the sessions of a class and its slots
**When** the dashboard lists sessions for UX AD-18
**Then** a `security_invoker` view `class_sessions_with_match` (class_session id, `matches_slots boolean` computed by comparing the session's local weekday and local time in the gym's zone with the class's slots, `cancelled_at`) is the single source of the "Old time" tag; a one-off class's session always matches; RLS on `class_sessions` is unchanged and a gym-B reader sees no gym-A rows
**And** `list_my_classes()` is dropped and re-created with the same named columns plus `slots jsonb` (array of `{weekday, start_time}`), `cancelled_at` and per-session `matches_slots`, the legacy `recurrence_days` and `recurrence_time` columns removed from its output, and `services/classes.ts` (`listClasses`, `listMyClasses`) and `coach/classes/page.tsx` read slots instead of `recurrence_days` / `recurrence_time`; the existing `classes.listMyClasses.test.ts` is updated for the new shape and still proves an empty result for a non-coach, another gym's coach and a suspended gym

**Given** the Classes page (UX AD-18) as Manager, Supervisor or Owner
**When** it renders
**Then** the Schedule column shows recurring times grouped by identical hour, Monday first, 24-hour, in the gym's time zone, three groups then "+N more" with a tooltip carrying the full list ("Mon 07:00 · Wed 18:30 · Sat 09:00", "Tue, Thu 18:00 · Sat 09:00"); a migrated class reads "Tue, Thu 18:00" exactly as before (component tests with fixtures for one group, three groups, four groups, a one-off class and a migrated class)
**And** each row has [Edit] and [Cancel class] / [Annuler le cours] for Manager and above, both absent from the DOM for Receptionist (existing role test extended); a cancelled class shows the neutral "Cancelled" / « Annulé » badge, sorts below live classes, and offers neither action; the "Old time" tag (`classes.times.oldTimeTag`) appears in the expanded row of a future session with bookings that does not match the class's times

**Given** the Create / Edit class modal (UX AD-19)
**When** a Manager, Supervisor or Owner picks Recurring
**Then** the weekly-times editor replaces the Days and Time lines: one row per time with Day select (Monday to Sunday) and 24-hour Time, [Remove] per row, [+ Add a time] appending a row pre-filled with the next weekday after the last row and the last row's time and moving focus to its Day select, the counter "[n] of 14" always visible, rows re-sorted Monday first on blur and on save with the polite announcement `classes.times.sorted`, the time-zone line `classes.times.timezone`
**And** at 14 rows [+ Add a time] stays visible with `aria-disabled` and shows `classes.times.limit`; the same weekday may appear twice at different times; an identical day and time on a later row shows `classes.times.error.duplicate`; no row (the only row removed) shows `classes.times.error.none` on save; a row with no day or time shows `classes.times.error.day` / `classes.times.error.time`; errors are inline per row with `aria-describedby` and an error summary on submit
**And** switching One-off and Recurring keeps what was entered for the other mode until save; opening a migrated class shows its old days as one row per day at its old hour with no banner and no "migrated" label

**Given** a class that has upcoming sessions is edited
**When** the modal opens
**Then** the info notice `classes.times.editNotice` sits above "Weekly times"
**And** on Save the modal shows the result view in place: heading `classes.times.saved.title` and `classes.times.saved.summary`; when `left_unchanged` is not empty, `classes.times.left.title` (or `classes.times.left.title1`) with `classes.times.left.help` and one row per session formatted by `classes.times.left.row` (day, date, hour, "n / capacity booked"), read-only, with [Done]; when it is empty an edit shows `classes.times.left.none` with [Done]; a create (never has bookings) closes on save as today
**And** focus moves to the result heading and [Done] returns focus to the class's [Edit] button; a booking that lands during the save never produces an error, the session is simply listed (the concurrency rule of 29.1)

**Given** the Cancel class dialog (UX AD-18; Escape disabled)
**When** a Manager and above opens it for a class with 8 upcoming bookings
**Then** it shows `classes.cancel.title` and `classes.cancel.body` with the server's count, buttons [Keep class] / [Cancel class] (not the generic [Cancel]), `classes.cancel.bodyNoBookings` for zero, success toast `classes.cancel.toast`, and the refusals `classes.cancel.already`, `classes.coach.ownOnly` (stale Coach case reserved for 29.3) and `classes.cancel.error` for any other failure
**And** the audit log (UX AD-12) shows the new labels `audit.actionTypes.classTimesChanged` ("Class weekly times changed", details: class name, old → new summary, "[N] sessions with bookings left unchanged") and `audit.actionTypes.classCancelled` ("Class cancelled", details: class name, "[N] bookings cancelled"); `update_class` and `create_class` write the corresponding audit rows

**Given** EN and FR
**When** `scripts/check-i18n-key-parity.mjs` runs
**Then** every key in "Group F" (`classes.times.*`, `classes.cancel.*`, `classes.coach.*` where used here), the two audit labels and the new mobile keys exist in both `apps/dashboard/locales/{en,fr}.json` and the mobile catalog with matching placeholders and counts

**Given** a Receptionist, a Coach and a member
**When** each calls `create_class`, `update_class` (either signature) or `cancel_class` directly, or writes `classes`, `class_sessions` or `class_schedule_slots` directly
**Then** every call is refused (negative tests per role, including a Manager of gym B against a gym A class: uniform not-found), the existing `class_creation_scheduling.negative.test.sql` and `class_attendance_marking*.test.sql` pass without edit, and an E2E spec `apps/dashboard/e2e/class-weekly-times.spec.ts` covers the golden path (create a class with three different times, book a session as a member, move a time, see it listed as left unchanged with the "Old time" tag, cancel the class, see "Cancelled")

---

### Story 29.3: Coaches Create, Edit and Cancel Their Own Classes

As a Coach,
I want to create, change and cancel the classes I teach from My Classes,
So that I run my own timetable without asking a manager for every change, while the admin Classes page and other coaches' classes stay closed to me.

*Delivers FR-246 (Coach create, edit, cancel own classes; cannot assign another coach or change another coach's class; Manager, Supervisor and Owner keep full control), FR-053 (unchanged: the admin Classes page stays closed to the Coach role), FR-145 (amended: the read-only rule no longer applies to a coach's own classes; the roster and attendance marking stay read-only, FR-107), FR-122, FR-121; NFR-001; spine AD-57, AD-34 (live write gate), AD-35, AD-21, AD-1. UX gate: UX AD-21 (My Classes: [+ Create class], [Edit], [Cancel class], empty state) and UX AD-19 Coach mode in EXPERIENCE.md; the screen states and copy there are the acceptance baseline. Reuses 29.1's `private.apply_class_slots` and 29.2's overloads, `cancel_class`, editor and dialog.*

**Acceptance Criteria:**

**Given** `create_class(..., p_slots)`, `update_class(..., p_slots)` and `cancel_class(p_class_id)` from 29.2
**When** a caller with the live role `coach` (read through `private.current_member_role()`, never the token claim, AD-34) invokes them
**Then** the function resolves the caller's own member row (`members.user_id = auth.uid()`, `gym_id = private.gym_id()`, `role = 'coach'`, `deactivated_at is null`) and checks `private.is_own_coach_id(<coach id>)` together with that live row, because `is_own_coach_id` alone checks neither gym, role nor deactivation
**And** on **create**, `p_coach_id` must be the caller's own member id or null (null is stored as the caller): any other value raises the stable message mapped to `classes.coach.ownOnly`, so a Coach cannot create a class for another coach
**And** on **update** and **cancel**, the class's current `coach_id` must be the caller's own member id **and** the new `p_coach_id` (if supplied) must also be the caller's own member id (the check applies to the old row and to the new values, so a Coach can neither edit another coach's class, nor reassign their own class to someone else, nor adopt a class that is about to be assigned to them); the refusal for another coach's class, another gym's class and a missing class is the same message and shape, so a Coach learns nothing about classes they do not own
**And** Manager, Supervisor and Owner keep every existing behaviour of the functions on every class of their gym, with the same check expressed as "not limited to their own classes", and the existing role-matrix tests for those roles pass without edit

**Given** a Coach deactivated, moved to another role, or whose gym is suspended after their token was issued
**When** they call any of the three functions on their next request
**Then** the call is refused through the live gate (a deactivated coach loses the gate through the live `members` read, not through the claim; a suspended gym raises the standard "gym is not active" error as `list_my_classes` does), proven by one pgTAP case each
**And** a class whose coach is reassigned by a Manager from coach A to coach B stops being editable by A and becomes editable by B on the next request (test), and sessions, bookings and attendance of the reassigned class are untouched

**Given** the direct table paths
**When** a Coach writes `classes`, `class_sessions`, `class_schedule_slots` or `class_bookings` directly through PostgREST
**Then** every write is refused: the RLS write policies on `classes` stay Manager, Supervisor and Owner only and **no Coach write policy is added** (`[ASSUMPTION]` decided here, consistent with the definer-only writes of AD-29 and 29.1: the coach grant is the three functions, gated by `private.is_own_coach_id` plus the live row, not table policies), proven by negative tests for insert, update and delete on each table
**And** a Coach has no read on `class_bookings` and no new read: the roster stays `list_my_class_session_roster(uuid)` and attendance marking stays Receptionist and above (`mark_class_attendance` refuses a Coach, test unchanged)

**Given** `list_my_classes()` and `list_my_class_session_roster(uuid)`
**When** a Coach creates a class
**Then** it appears in `list_my_classes()` for that Coach immediately, in the UX AD-18 list for Receptionist and above, and in the members' class list after its sessions are generated (create materializes the first window synchronously, as today)
**And** a cancelled own class appears in the Coach's list with the "Cancelled" badge and no [Edit] or [Cancel class] (as UX AD-18), its future sessions flagged cancelled and excluded from the roster function's results; the roster function still returns empty for another coach's session, another gym's session and a deactivated Coach (existing behaviour, `coach_portal_my_classes.test.sql` passes without edit)

**Given** a Coach on the Coach Portal My Classes screen (UX AD-21)
**When** it renders
**Then** the page shows [+ Create class] (`classes.coach.create`), and each class row shows [Edit] and [Cancel class]; roster and attendance remain read-only, with no mark-attendance control, checkbox or booking add/remove, absent from the DOM
**And** [+ Create class] and [Edit] open the same modal as 29.2 in Coach mode: **Coach** is plain text of the signed-in coach (`classes.coach.fixed`, helper `classes.coach.fixedHelp`), not a select; the weekly-times editor, the notice and the "left unchanged" result view behave exactly as 29.2; [Cancel class] opens 29.2's dialog
**And** the empty state is `classes.coach.empty` with [+ Create class]; a stale tab after reassignment that triggers the server refusal shows `classes.coach.ownOnly` and refreshes the list; a Manager, Supervisor or Owner opening the same class in UX AD-19 still sees the full Coach select
**And** a Coach's request for the admin Classes route `/classes` is still refused with the global "You don't have permission to do that." and the sidebar still has no Classes item for the Coach role (the FR-053 regression test, unchanged)

**Given** audit
**When** a Coach creates, edits or cancels an own class
**Then** the audit log shows "Class created" (`audit.actionTypes.classCreatedByCoach`), "Class weekly times changed" and "Class cancelled" with the Coach as actor, and the same rows for Manager and above creating classes use the existing class-created label

**Given** negative and cross-tenant tests
**When** the suite runs
**Then** pgTAP files `coach_own_classes.test.sql` and `coach_own_classes.negative.test.sql` cover: Coach A creating for Coach B (refused), Coach A editing and cancelling Coach B's class (refused, class and sessions unchanged), Coach A reassigning own class to B (refused), Coach of gym A on a gym B class (refused, uniform), a Coach passing a manager's member id, a Receptionist and a member (refused), a Coach calling `cancel_class` on an already cancelled class (the "already" message), and the 14-slot cap and duplicate refusal for a Coach exactly as for a Manager
**And** `support_capabilities.test.sql` still passes with unchanged totals (no Coach function is a support capability) and `scripts/claim-inventory.mjs` shows no new `claim-only` entry
**And** `apps/dashboard/e2e/coach-own-classes.spec.ts` (new) proves: a Coach creates a class with two different times, sees it in My Classes, edits one time, cancels it; a second Coach does not see it; the first Coach cannot open `/classes`; and the existing `progress-data-privacy.spec.ts` still passes
**And** EN and FR parity holds for every key used (`classes.coach.*`, audit labels)

---

### Story 29.4: Coach Picker for Owner, Supervisor and Manager

As an Owner, Supervisor or Manager,
I want to choose any coach of my gym and see that coach's classes, class lists, assigned members, session notes and workout plans, read-only,
So that I can check on my coaches' work without being given any coach's members' body or progress data.

*Delivers FR-247 (coach picker; body and progress data stay excluded; Receptionist and Coach have no picker; limited to the caller's own gym), FR-053 (amended: the Coach Portal also opens for Owner, Supervisor and Manager through the picker; Coach and admin pages otherwise unchanged), FR-145, FR-122; NFR-011, NFR-016 (progress access remains re-verified on every request, untouched), NFR-001; spine AD-58, AD-34 (live read gate), AD-35 (not a support capability, FR-251), AD-1. UX gate: UX AD-32 Coach Picker, picker-mode amendments of UX AD-14, UX AD-15, UX AD-20 and UX AD-21, and the sidebar role table in EXPERIENCE.md (V1.8 sidebar change and role visibility); the screen states and copy there, and "Group G" keys, are the acceptance baseline. Priority tags: the PRD marks FR-247 as part of the gym-operations step; the picker's `[ASSUMPTION]` UX tags (active coaches only, `?coach=` query parameter, default tab Classes, pre-select with a single coach, read-only banner style) are carried as written; OQ-34 is resolved (2026-11-15).*

**Acceptance Criteria:**

**Given** the read functions the picker needs
**When** the migration lands
**Then** these `SECURITY DEFINER` functions exist, each with a `p_coach_id uuid` parameter, `STABLE`, `set search_path = public, pg_temp`, `REVOKE ... FROM public, anon`, `GRANT ... TO authenticated`, and shaped like `list_my_classes()` and `list_my_class_session_roster(uuid)` (0096): `list_coach_classes(p_coach_id)` (one row per class and per session from 00:00 today in the gym's time zone, plus slots, `cancelled_at`, booked count), `list_coach_class_session_roster(p_coach_id, p_class_session_id)` (exactly `(member_id, member_name, attended_at)`), `list_coach_assigned_members(p_coach_id)` (the chosen coach's currently assigned members, `coach_assignments.ended_at is null`, with profile columns below, plan name, subscription status and expiry, and the latest session-note snippet of that coach), `get_coach_assigned_member(p_coach_id, p_member_id)` (the one-member header for UX AD-15), `list_coach_member_session_notes(p_coach_id, p_member_id)` (the chosen coach's own notes only, newest first, with author and time) and `get_coach_member_workout_plan(p_coach_id, p_member_id)` (the ordered plan: exercise, sets, reps, note, plan author name; no completion data), plus `list_picker_coaches()` for the select (this gym's active Coach-role members: id and name)
**And** each function (1) reads the live role and refuses with an **empty result** (never an error that reveals state) unless the caller is Owner, Supervisor or Manager of the caller's gym through the live check (`private.current_member_role()` and `private.gym_id()`, AD-34, not the claim), (2) raises the standard "gym is not active" error for a suspended gym exactly as `list_my_classes` does (so `suspension_rpc_coverage.test.sql` passes), (3) filters every table it touches on `gym_id = private.gym_id()`, (4) **asserts first** that `p_coach_id` is a member of `private.gym_id()` with role `coach` (null-safe; a coach of another gym, a non-coach id, a null and a random uuid all return an empty result), and for the member-scoped functions that the member is **currently assigned to that coach**, (5) returns `RETURNS TABLE` with a named column allow-list, never `select *`, never a row type, never `to_jsonb` of a row, and carries no comments in the function body (the coverage meta-test scans `prosrc`)
**And** the assigned-member profile columns are exactly: member id, name, phone, photo URL, goal, experience level, status, plan name, expiry date, join date; `members.starting_weight_kg`, `height_cm`, `birth_year`, `dob`, `emergency_contact`, `email`, `neighborhood`, `profession` are **not** returned (body measurements sit on the `members` row, so a profile `select *` would leak them), proven by a column-allow-list test per function against `pg_proc`/`information_schema` result columns

**Given** the body and progress boundary (FR-247, FR-095, NFR-011, NFR-016)
**When** the CI check `scripts/check-coach-picker-isolation.mjs` (plus a pgTAP twin `coach_picker_isolation.test.sql`) runs in `scripts/ci-local.sh` and in the GitHub Actions workflow
**Then** it finds every picker function by name pattern and by a committed allow-list (`scripts/coach-picker-functions.json`, so a function renamed out of the pattern still fails), walks `pg_depend` **transitively** (functions called, views read, tables, policies' functions, types) and fails with the object path when any picker function depends on `progress_entries`, `progress_photos`, the progress notes table, `workout_plan_completions` or the Coach Overview's progress feed (the function or view behind the UX AD-20 "Recent Progress Activity" and "Needs Follow-Up" lists, named by grep of `apps/dashboard/app/(dashboard)/coach/overview` and the migrations that define it; the real object names go into the deny list, since no object is literally named "measurements" or "progress notes")
**And** a self-test feeds the check a fixture function that reaches `progress_entries` through a helper view two levels down and proves the check fails, and a fixture that reaches a progress table only through another picker function's dependency also fails; the check also fails if a picker function appears in `private.support_capabilities`, or if a function in the allow-list cannot be found (a stale list)
**And** the deny list is built from the real table names verified in `supabase/migrations` at story time (`progress_entries` 0066, `progress_photos` 0067, `workout_plan_completions` 0081, and the progress-notes table of FR-098 under its real name), and a comment in the check says that a new body-data table must be added there

**Given** a seeded gym with a coach, assigned members and body data
**When** the positive pgTAP test `coach_picker_no_body_data.test.sql` seeds, for the coach's assigned member, a progress entry with measurements and weight, a progress photo (shared and not shared), a progress note, a workout plan with a recorded plan completion, a session note, a class booking and a Coach-Overview-visible progress event
**Then** it calls **every** picker function as Owner, Supervisor and Manager of that gym and proves, by scanning the full text of every returned row for each seeded value (weights, measurements, photo path, note text, completion marks) and for the member's `starting_weight_kg` and `height_cm`, that none appears; the session note and the plan as authored do appear; the test fails if a new picker function is added to the allow-list without being called here
**And** RLS on `progress_entries`, `progress_photos`, the progress notes table and `workout_plan_completions` is unchanged: a diff of `pg_policies` for those tables before and after the migration is empty (test), so an Owner, Supervisor or Manager still reads no progress data by any direct read (existing `progress-data-privacy.spec.ts` passes without edit)

**Given** every unauthorised caller and every tenant boundary
**When** the negative tests run
**Then** a Receptionist, a Coach (including the chosen coach calling the picker for themselves or for another coach), a member, an anonymous caller, a GymOS Support session (aal2, live assignment: refused, not registered in `private.support_capabilities`, FR-251) and a deactivated Owner each get an empty result from every picker function, and a Manager of gym B passing a gym A coach id gets an empty result from every function (cross-gym test per function)
**And** a coach who is deactivated returns empty, a coach whose assignment of a member ended returns no member and no note for that pair, a member assigned to coach A asked for with coach B's id returns empty (the assignment is checked against the chosen coach), and an Owner who becomes deactivated loses access on the next request (live gate)
**And** `support_capabilities.test.sql` still passes with its pinned totals unchanged, and its catalog section classifies the picker functions as non-support; `scripts/claim-inventory.mjs` shows no new `claim-only` entry

**Given** the Coach Portal as Owner, Supervisor or Manager (UX AD-32)
**When** they open Coach Portal from the sidebar
**Then** the sidebar item is present for those three roles and absent for Receptionist and GymOS Support (route returns the global "You don't have permission to do that."), and for the Coach role the portal is their own, with no picker, no banner, and a typed `?coach=` ignored (their own id is resolved server-side) (the role table in the V1.8 sidebar paragraph; `Sidebar.test.tsx` and `CoachPortalNav.test.tsx` extended)
**And** with nothing chosen the page shows `coach.picker.choose` with the select focused and loads no coach data; the select (`coach.picker.label`) lists the gym's active coaches, is carried as `?coach=<id>` so back, refresh and a shared link keep it, is pre-set when the gym has exactly one coach, and changing the coach reloads the current tab and keeps it
**And** a gym with no coaches shows `coach.picker.noCoaches` with an [Open Staff] link for Owner and Supervisor and `coach.picker.noCoachesManager` for Manager; a coach id not in the gym or not a coach shows `coach.picker.unavailable` and clears the select; a deactivated coach shows `coach.picker.inactive`

**Given** a chosen coach
**When** the read-only banner and tabs render
**Then** the neutral, non-dismissible banner `coach.picker.banner` is always visible under the select, the sub-navigation is **Classes** and **Members** only (no Overview; default tab Classes), and a direct address of `/coach/overview?coach=...` or of a member's Progress tab shows the single message `coach.picker.partUnavailable` with links to Classes and Members, never any content
**And** the Classes tab is UX AD-21 in read-only mode built from `list_coach_classes` and `list_coach_class_session_roster` (sessions from 00:00 today, booked counts, roster with name and attendance status), with no [+ Create class], [Edit] or [Cancel class] in the DOM and a text link [Open in Classes] (`coach.picker.openInClasses`) to UX AD-18; empty state `coach.picker.noClasses`
**And** the Members tab is UX AD-14 in read-only mode built from `list_coach_assigned_members` (same columns, search and sort), empty state `coach.picker.noMembers`; a row opens UX AD-15 in picker mode

**Given** UX AD-15 in picker mode
**When** it renders for a member currently assigned to the chosen coach
**Then** the header shows avatar, name, status, plan, expiry, goal, experience and phone only; the tabs are **Session Notes** and **Workout Plan** only (the Progress tab is absent from the DOM, not locked, blurred or empty); the expired bar reads `coach.picker.expiredBar`; the persistent line `coach.picker.noBodyData` sits under the tabs
**And** Session Notes lists only the chosen coach's own notes newest first with author and time and no [+ Add note], Edit or hover affordance; Workout Plan shows the ordered exercises with sets, reps and notes, the line `coach.picker.planAuthor` when the plan's author is not the chosen coach, and no [Edit], [+ New plan], drag handle, Move up/down, [Take ownership] banner, completion mark or progress count of any kind
**And** a member who is not currently assigned to the chosen coach shows `coach.picker.notAssigned` with [Back to members] (`coach.picker.backToMembers`) and never the profile; the picker never shows a count, chart, thumbnail, "last logged" date or "no data yet" placeholder for any body or progress item (component tests assert none of those elements render)
**And** the picker issues no write: no server action in the picker route calls an insert, update or delete, proven by a test that renders the whole flow with a Supabase client double that throws on any non-`rpc` read and on any RPC outside the allow-list

**Given** performance and scale
**When** the picker lists a coach with 40 classes and 200 assigned members
**Then** `list_coach_classes` and `list_coach_assigned_members` return within the existing page-load target (NFR-001, p95 < 2 s on the local seed), each result set stays under the API `max_rows` cap (1000) or is paged by the story with a test at the cap boundary (the same caveat `list_my_classes` records), and both functions are covered by an index check (`explain` shows no sequential scan on `class_sessions`, `coach_assignments` or `class_bookings` for the seeded size)

**Given** EN and FR
**When** `scripts/check-i18n-key-parity.mjs` runs
**Then** every "Group G" key used here (`coach.picker.*`, `coach.portal.nav`) exists in both locales with matching placeholders, and an E2E spec `apps/dashboard/e2e/coach-picker.spec.ts` proves, with seeded body data present: an Owner and a Manager see the coach's classes, rosters, assigned members, notes and plans; no measurement, photo, progress note, plan-completion mark or Overview feed is anywhere in the DOM or in the network responses; a Receptionist and a Coach have no picker; a Manager of another gym cannot open the coach by URL


---

### Epic 30 — Stories

| # | Story | Migration | Depends on |
|---|---|---|---|
| 30.1 | Engagement Configuration, Weekly Goal & Wording Catalog | next free at merge time | none |
| 30.2 | Engagement Facts, the Fold & Settle | next free at merge time | 30.1, Epic 27 (`visit_day`, `member_visit_days`, `attendance_counted`) |
| 30.3 | Settle Triggers & the At-Risk State | next free at merge time | 30.2, Epic 27 (`record_check_in`, `void_staff_check_in`) |
| 30.4 | Weekly Ring & Streak on Home | none | 30.1, 30.3 |
| 30.5 | Attendance Calendar | next free at merge time | 30.3, Epic 27 (`member_visit_days`) |
| 30.6 | Gym Leaderboard & Anonymous Choice | next free at merge time | 30.1, Epic 27 (`attendance_counted`) |
| 30.7 | Milestones & Celebration | next free at merge time | 30.2, 30.3, 30.4, 30.5 |

*30.6 shares no table or function with 30.2–30.5 and can run in parallel with them once 30.1 has merged (it only needs the `engage.*` catalog and the Epic 27 views). 30.4 and 30.5 are independent of each other once 30.3 has merged. 30.7 closes the epic because it amends the settle function (30.2), the state read (30.3) and the calendar (30.5), and pushes its screen from Home (30.4). Migration numbers are assigned at merge time (the latest at planning time is 0172, and Epics 27–29 land first); earlier stories never renumber.*

*Production is live with real gyms. 30.3 re-creates two Epic 27 check-in functions (`private.record_check_in`, `public.void_staff_check_in`), so it ships behind the full `scripts/ci-local.sh` gate with the existing check-in pgTAP files passing unedited. Every other story adds tables and functions that no existing path calls. The engagement area stays **dark** until the operator sets `platform_engagement_config.release_week_start` (30.1): the migrations and the mobile code can be deployed ahead of the 1.8.0 release with no member-visible effect.*

*Conventions for every story in this epic (not repeated in each story). (1) Every count reads `attendance_counted` or `member_visit_days` (spine AD-56), never `attendance_events`; the day of a visit is the stored `visit_day`, never recomputed from the gym's current timezone (spine AD-53); week and month arithmetic is on `date`, using `private.gym_today`, `private.gym_local_day_bounds`, `private.gym_local_month_bounds` and the new week helper (30.1). (2) Class-only attendance (`class_bookings.attended_at`) writes no `attendance_events` row and is **not** a visit day (spine AD-53; reality review §2): no story in this epic counts it. (3) The member-facing RPCs of this epic resolve the caller live (spine AD-34), not from the token: `private.current_member_role() = 'member'`, `private.gym_id()`, the member's own `members` row with `deactivated_at is null`, and `private.current_gym_status() = 'active'`; staff, support, anon, deactivated members and members of a suspended gym get a refusal (writes) or an empty result (reads). None of these RPCs is registered in `private.support_capabilities` (FR-251: no member-app capability for support), so `supabase/tests/support_capabilities.test.sql` keeps its pinned counts and names unchanged; each story that adds an RPC asserts that. (4) The engagement tables enable RLS, carry no policy and grant nothing to `anon`, `authenticated` or `service_role`: the definer functions are the only door (spine AD-1, AD-30 ledger precedent, FR-228 "no role can edit a count or rank"). (5) Mobile wording lives only in `apps/mobile/src/locales/{en,fr}.json` under the `engage.*` namespace (FR-232); every screen story adds its own keys to **both** files and `pnpm run check:i18n` stays green. (6) Screens carry the line "UX gate: ... in EXPERIENCE.md; the screen states and copy there are the acceptance baseline". The mobile app has no E2E harness (the Playwright baseline covers the dashboard); the release-gate E2E of PRD 10.3 Step 3 item 11 is met here by pgTAP journey tests plus component tests, and a mobile E2E spec is not claimed.*

---

### Story 30.1: Engagement Configuration, Weekly Goal & Wording Catalog

As a member,
I want to choose how many days a week I want to come and see that choice in my Profile,
So that the ring and the streak measure my own target, and the app's wording can change without a redesign.

*Delivers FR-219 (goal, range, default, next-week rule; Must), FR-232 (wording as editable EN/FR text; Must), and the configuration and week helper that FR-220, FR-222 and FR-223 read. Spine AD-53 (`platform_engagement_config`, `member_weekly_goals`, `private.gym_local_week_bounds`), AD-61 (the weekly goal has exactly one write path), AD-34 (live caller), AD-1. `[ASSUMPTION]` Monday week start, default 3, range 1–7 (OQ-33, confirmed against pilot data after release). UX gate: MA-23 Weekly Goal sheet and the MA-12 Profile "Training" card with its Weekly goal row in EXPERIENCE.md; the screen states and copy there are the acceptance baseline. Migration at merge time.*

**Acceptance Criteria:**

**Given** the migration
**When** it runs on a database that already holds gyms and members
**Then** `platform_engagement_config` exists as a singleton (unique index on `((true))`, the `platform_session_config` pattern) with one seeded row: `goal_min` 1, `goal_max` 7, `goal_default` 3, `shield_every_weeks` 4, `shield_cap` 2, `comeback_visits` 3, `comeback_window_days` 10, `daily_streak_min` 3 and `release_week_start` NULL, with CHECKs (`goal_min >= 1`, `goal_min <= goal_default <= goal_max`, `shield_cap >= 0`, every other integer `> 0`, and `release_week_start` is NULL or a Monday (`extract(isodow from release_week_start) = 1`))
**And** no existing table, function or policy is altered, and the existing pgTAP suite passes with no edited file

**Given** `release_week_start` is NULL (the seed)
**When** any later story reads the epoch
**Then** NULL means the engagement area is **dark** (nothing is settled, `my_engagement().enabled` is false in 30.3); the operator turns it on by setting a Monday, and the exact statement is recorded in a dated `docs/decisions.md` entry together with this meaning of NULL `[ASSUMPTION — dark launch, so migrations and the mobile build can be deployed before the 1.8.0 release]`

**Given** the config table's grants
**When** a Super Admin, an Owner, a member and an anonymous caller each try to select and update it
**Then** only the Super Admin can read and update (RLS `private.is_super_admin()`, the `platform_session_config` policies), insert and delete are refused for everyone, and an Owner or member read returns nothing or is refused

**Given** an UPDATE of any config column by the Super Admin
**When** it commits
**Then** an audit entry is written (`log_audit_event`, action `platform_engagement_config_updated`, `gym_id` null) whose metadata holds `old` and `new` built from the **whole row** (`to_jsonb(old)` and `to_jsonb(new)`), not a hand-listed set of keys
**And** a pgTAP test updates **each column in turn** (read from `information_schema.columns`, so a column added later is covered) and asserts the entry names that column's old and new value (the 0107 audit trigger hard-coded its keys, so a new column was silently unaudited)

**Given** `private.gym_local_week_bounds(p_timezone text, p_at timestamptz)` returning `(week_start timestamptz, next_week_start timestamptz)`, IMMUTABLE, beside `gym_local_month_bounds`, with no EXECUTE for `anon` or `authenticated` beyond what the month helper has
**When** it is called for Africa/Douala, America/Los_Angeles and Europe/Paris
**Then** the week is Monday 00:00 gym-local to the next Monday 00:00 gym-local; an instant that is Sunday 23:30 UTC is Monday 00:30 in Douala and so falls in the **new** week; an instant exactly at Monday 00:00 local belongs to the new week and one second earlier to the old one
**And** the Paris week containing the last Sunday of March has `next_week_start - week_start = 167 hours` and the one containing the last Sunday of October 169 hours, because the interval is added to the local timestamp and not to the timestamptz (the 0095 rule)
**And** a second IMMUTABLE helper `private.week_start_of(p_day date) returns date` returns the Monday on or before a date and is the only way later stories turn a `visit_day` into its week

**Given** the table `member_weekly_goals(member_id, gym_id, effective_week date, goal smallint, created_at)` with a primary key `(member_id, effective_week)`, `effective_week` a Monday (CHECK), `goal` between 1 and 7 (CHECK)
**When** a member, a staff member of the same gym and a member of another gym each try to select, insert, update or delete a row directly
**Then** all are refused (RLS enabled, no policy, no grants), and a pgTAP test asserts `has_table_privilege` is false for `anon`, `authenticated` and `service_role` on all four verbs

**Given** a member with no goal row, whose gym is in Africa/Douala
**When** they call `set_weekly_goal(p_goal smallint)` on a Wednesday
**Then** exactly one row is inserted with `effective_week` = the next gym-local Monday (computed on the server through the week helper; there is no date parameter) and the function returns `(goal, effective_week, current_goal, current_goal_is_default)` where `current_goal` is still 3 (the default applies meanwhile, NFR-028)
**And** choosing 3 on a member with no rows still records an explicit row at 3 `[ASSUMPTION — UX MA-23]`

**Given** a member whose goal row for next Monday already exists
**When** they call `set_weekly_goal` again in the same week with another value
**Then** the pending row is **replaced** (same `effective_week`, new goal; it is not history yet) and no unique-key error is raised
**And** when they call it with the goal that is currently in force while a pending row exists, the pending row is deleted (the change is cancelled); when they call it with the goal in force and no pending row exists after at least one explicit row, nothing is written and the same result is returned

**Given** the goal-history trigger
**When** anything (including a SECURITY DEFINER function or the table owner) tries to insert, update or delete a row whose `effective_week` is less than or equal to the current gym-local week start
**Then** it is refused, so a goal already in force or in the past can never be lowered or rewritten (FR-219: "a goal cannot be lowered after a bad week")

**Given** a member on Wednesday with a goal of 3 in force
**When** they set 5 and the test reads `my_weekly_goal()`
**Then** it returns `current_goal` 3, `pending_goal` 5 and `pending_effective_week` the next Monday, `goal_min` 1 and `goal_max` 7 from the config, and it is STABLE and writes nothing
**And** with the clock moved to that Monday the same call returns `current_goal` 5 and no pending goal, and the earlier week's value is unchanged

**Given** values of `p_goal` of 0, 8, -1 and NULL
**When** `set_weekly_goal` is called
**Then** each is refused with a stable error code (`invalid_goal`) and nothing is written; the range is read from `platform_engagement_config`, so a config change of `goal_max` to 6 refuses 7 without a code change

**Given** callers who are not a live member: an Owner, a Receptionist, a support person, an anonymous caller, a deactivated member, a member whose gym is suspended, and a member of gym B passing nothing that names gym A
**When** each calls `set_weekly_goal` and `my_weekly_goal`
**Then** writes are refused and reads return no row, no `member_weekly_goals` row appears for anyone, and a member can only ever affect their own row (the function takes no member id)
**And** the functions are `revoke ... from public, anon`, granted to `authenticated` only, and `support_capabilities.test.sql` passes unchanged

**Given** a member at a gym with a timezone change after they set a goal
**When** the Owner changes `gyms.timezone` between Douala and Nairobi
**Then** `member_weekly_goals.effective_week` (a stored date) does not move, and the pending goal still takes effect on that date

**Given** `apps/mobile/src/locales/en.json` and `fr.json`
**When** this story ships
**Then** both gain, verbatim from the EN and FR columns of the V1.8 string catalog in EXPERIENCE.md, the namespaces `engage.goal.*`, `engage.ring.*`, `engage.streak.*`, `engage.shield.*`, `engage.comeback.*`, `engage.celebration.*`, `engage.profile.section`, `engage.profile.goal.*`, `engage.profile.reminder.*`, `engage.updatedAt` and `n08.*` (the Shield, comeback, celebration and reminder wording is added now so Epic 31 needs no wording work; the server-side N-08 copy store is Epic 31's), and the **reserved mascot keys** `engage.celebration.mascot.7`, `.30`, `.100`, `engage.comeback.mascot`, `engage.shield.mascot` and `n08.mascot`, present in both files with the **empty string** as value
**And** the namespaces for the calendar, at-risk hint, leaderboard, Home error states and Anonymous rows are added by the screen stories 30.4, 30.5 and 30.6 that render them

**Given** a Vitest file in `apps/mobile` that holds the required key list for this story (copied from the catalog rows, one array)
**When** it runs
**Then** it fails if any required key is missing from either file, if a key's placeholders (`{n}`, `{date}`, `{goal}` and the plural variables) differ between EN and FR, if a plural key lacks `one` or `other` in either language, if any `engage.*` or `n08.*` value contains an exclamation mark or the words "last chance" or "streak lost" (the tone rule: no loss, no countdown), or if a mascot key is non-empty
**And** `pnpm run check:i18n` (the repo's key-parity gate, which already walks `apps/mobile/src/locales`) passes with the new keys

**Given** MA-23 and the Profile row (UX gate)
**When** the member opens Profile
**Then** a new `flat` "Training" Card (`engage.profile.section`) sits between the account Card and the Notifications Card with one row, **Weekly goal**, glyph `flag`, value "3 days" (`engage.profile.goal.value`), a chevron; with a pending change the value reads "3 days, then 4 from Mon 24 Nov" (`engage.profile.goal.pending`); the Badges and Anonymous rows are not added here
**And** tapping the row opens the MA-23 bottom sheet at route `/goal` (slide up, up to 60% of the screen, swipe down or Android back dismisses without saving)

**Given** the Weekly Goal sheet
**When** it renders
**Then** it shows the title, the prompt, seven option pills "1" to "7" (one row at 360pt or wider, two rows 1–4 and 5–7 below that), each 44pt wide at least, the member's current goal pre-selected with a check glyph and the word "current" in its accessible name (`engage.goal.option.a11y`, `engage.goal.current`), the effect line, the `engage.goal.why` line and a primary **[Save goal]** button
**And** the effect line reads `engage.goal.effective` ("Starts Monday 24 Nov. This week stays at 3.") when the choice differs from the current goal, `engage.goal.noChange` when it equals it, and `engage.goal.pending` when a change is already pending (the new choice then replaces the pending one)
**And** [Save goal] is disabled until the choice differs from the current or pending goal

**Given** the member taps [Save goal] online
**When** `set_weekly_goal` succeeds
**Then** a Light impact haptic fires, the sheet closes, the toast `engage.goal.saved` ("Goal saved. Starts Mon 24 Nov") shows, and the Profile row shows the pending form; when the call fails the sheet stays open with `engage.goal.error` above the button
**And** offline, the options still work but [Save goal] is disabled with `engage.goal.offline` (a goal change is never queued, because the effective Monday depends on the server's gym-local week)

**Given** a member who has never set a goal
**When** the sheet opens
**Then** "3" is selected, and a member whose `my_weekly_goal()` says `current_goal_is_default` sees the one-time hint `engage.ring.goalHint.default` dismissed when they open the sheet (device storage `[ASSUMPTION — UX]`)

**Given** English and French
**When** the sheet and the Profile row render in each
**Then** every string comes from the catalog, long French strings do not clip at 360pt width and +2 text size, option pills have 44pt targets, and a Vitest that swaps one catalog value for a sentinel proves the screen shows the sentinel (FR-232: wording is data, not screen text)

---

### Story 30.2: Engagement Facts, the Fold & Settle

As a member,
I want my weeks, streak and best streak to be worked out on the server from my real visits and to stay correct when a late visit arrives,
So that the streak I see can be trusted and never depends on my phone.

*Delivers FR-220 (weekly streak settled on the server, best streak never lowered; Must), FR-225 (visit day, release epoch, existing history; Must) and NFR-028 (deterministic counts, late offline visit, goal in force kept, timezone change). Spine AD-53 (ledger, fold, settle, epoch), AD-56 (counting views), AD-29 (member lock order), AD-1. `[ASSUMPTION]` "Consecutive" is strict: a week below goal ends the run (FR-220); existing attendance counts and the streak starts from `release_week_start` (FR-225). Shield and comeback arrive in Epic 31 through the same fold. No UX gate (no screen). Migration at merge time.*

**Acceptance Criteria:**

**Given** the migration
**When** it runs
**Then** `engagement_facts(member_id, gym_id, kind, subject_key, revision, outcome, goal, visits, silent, acknowledged_at, detail jsonb, created_at)` exists with primary key `(member_id, kind, subject_key, revision)`, `kind` CHECKed to `week`, `day_shield`, `milestone`, `badge`, `comeback` (the five kinds of AD-53, so Epic 31 alters no table), `revision >= 1`, and per-kind CHECKs: a `week` fact has `outcome` in (`met`, `missed`, `saved`), `goal` 1–7 and `visits >= 0`, `subject_key` the week's Monday as `YYYY-MM-DD`; a `milestone` fact has `subject_key` in (`7`, `30`, `100`) and no outcome
**And** `engagement_state(member_id primary key, gym_id, settled_through date, dirty_from date, updated_at)` exists
**And** both tables enable RLS with no policy and no grant to `anon`, `authenticated` or `service_role` (asserted with `has_table_privilege`), and a member's `member_id` foreign key cascades on member delete

**Given** `engagement_facts` is append-only
**When** anything tries to UPDATE or DELETE a row
**Then** a trigger refuses it, with exactly two exceptions: a DELETE caused by the owning `members` row being deleted (cascade), and an UPDATE that sets `acknowledged_at` from NULL to a timestamp on a `milestone` fact while the transaction-local flag set only by the acknowledge function of 30.7 is on (no other column may change)
**And** a pgTAP test proves a direct UPDATE of `outcome` or `visits`, an UPDATE of `acknowledged_at` without the flag, and an UPDATE that tries to clear `acknowledged_at` are all refused

**Given** several revisions of the same `(member_id, kind, subject_key)`
**When** the effective fact is read through `private.effective_engagement_facts(p_member_id uuid)`
**Then** it returns the **highest revision** per subject, so a replay inserts nothing and a correction is never dropped by a unique key (AD-53)

**Given** `private.engagement_fold(p_member_id uuid)`, STABLE, returning `(streak_weeks int, best_streak_weeks int, last_settled_week date, shields_held int, comeback_state text)`
**When** it folds the effective `week` facts in week order
**Then** `met` adds 1 to the run, `missed` sets the run to 0, a week that is not the Monday after the previous week's (a gap) also restarts the run, and `best_streak_weeks` is the highest run ever reached, so it never decreases as weeks are added
**And** a week with outcome `saved` keeps the run unchanged and adds nothing (FR-220: a Shield-saved week keeps the streak without adding to its count), kinds `day_shield`, `badge` and `comeback` are accepted and ignored, `shields_held` is 0 and `comeback_state` is `'none'` in this epic, and a pgTAP case inserts a synthetic `saved` fact and a `comeback` fact as the table owner to prove the fold neither errors nor miscounts, so Epic 31 plugs its Shield earn/spend and comeback steps into this one function without changing its callers or the tables
**And** the fold reads facts only: no attendance, no config, no clock

**Given** `private.settle_engagement(p_member_id uuid, p_gym_id uuid, p_up_to date)`, called with `private.gym_today(gym_id)` by the cron job and by `open_engagement()` in 30.3 and with a fixed date by tests
**When** it runs
**Then** it first takes the member lock (`select ... from members where id = p_member_id for no key update`, spine AD-29 and AD-53), before reading `member_visit_days` or writing any fact; it raises when the member does not belong to `p_gym_id`
**And** when `release_week_start` is NULL it writes nothing and leaves `dirty_from` untouched (dark)
**And** the member's start week is `greatest(release_week_start, week_start_of(min visit_day from member_visit_days))`; a member with no counted visit day writes nothing, so a gym's dormant never-visited members cost no rows

**Given** a member with visit days before and after `release_week_start`
**When** settle runs with `p_up_to` three weeks after the epoch
**Then** no fact exists for any week before `release_week_start` (weeks before the epoch are never settled), the calendar and total visit count still include those earlier days (they read `member_visit_days`), and the first week fact is the epoch week
**And** a week is closed only when `p_up_to >= week_start + 7`; the open week never gets a fact

**Given** a closed week
**When** settle evaluates it
**Then** `visits` is the number of distinct `visit_day` values in `member_visit_days` between the Monday and the Sunday (date comparison, no timezone arithmetic), `goal` is the goal in force that week, and `outcome` is `met` when `visits >= goal` and `missed` otherwise, written as revision 1 with the goal and visit count used
**And** the goal in force is the goal of the effective fact when the week already has one (frozen: a later change of the default or of the goal history never rewrites a settled week), otherwise the `member_weekly_goals` row with the greatest `effective_week` at or before that Monday, otherwise `goal_default`
**And** empty weeks between the member's start week and the last closed week get `missed` facts, so a closed week with no visits is distinguishable from an unsettled one

**Given** settle is called twice with the same arguments and no new attendance
**When** the second call finishes
**Then** it inserts no fact, `engagement_state.settled_through` is unchanged and the call returns zero weeks written (idempotent)
**And** `settled_through` is the Monday of the last settled closed week, `dirty_from` is cleared by every successful run, and a run never moves `settled_through` backwards

**Given** `engagement_state.dirty_from` is set to a Monday inside already-settled weeks
**When** settle runs
**Then** it re-evaluates every week from `least(dirty_from, settled_through + 7)` to the last closed week, and inserts a **new revision** only for a week whose `(outcome, goal, visits)` differs from its effective fact; a week whose recount is identical gets no new row

**Given** the platform epoch
**When** an operator tries to change `release_week_start` after any `week` fact exists
**Then** a second trigger on the config table refuses it (moving the epoch would invalidate settled history); setting it while no fact exists is allowed (NFR-028)

**Given** `private.rebuild_engagement(p_member_id uuid, p_up_to date)` (diagnostic, returns, never writes) and `private.engagement_derived_state(p_member_id uuid)` (the same shape read from the effective facts)
**When** both are called for the same member
**Then** each returns `(streak_weeks, best_streak_weeks, last_settled_week, weeks jsonb)` where `weeks` is the ordered array of `{week, visits, goal, outcome}`; rebuild re-derives visits and outcomes from `member_visit_days` and takes the goal in force as settle does, and the two results are **equal as jsonb** (derived state, not row counts, per AD-53)

**Given** the NFR-028 pgTAP test `engagement_determinism.test.sql` with fixtures in Africa/Douala
**When** it runs these cases and compares `engagement_derived_state` with `rebuild_engagement` after each
**Then** all hold:
- a **late offline visit**: a Sunday visit synced on the Tuesday after the week was settled `missed` (goal 3, two visits) makes the week `met` as **revision 2**, `visits` 3, and the derived state equals the rebuild (the week of the visit, not the week of receipt, is corrected);
- a **void**: a same-day voided staff visit lowers the open week's count only, writes no fact, and never lowers `best_streak_weeks` (Epic 27 permits a void only on the visit's own gym-local day, so a closed week is never lowered);
- a **goal change mid-week**: a goal of 3 in force, changed to 5 on a Wednesday, leaves that week's fact at goal 3 and the next week's at goal 5, and the member who made 3 visits in the changed week is `met`;
- a **timezone change**: a 23:30 Douala visit has `visit_day` D; after `gyms.timezone` changes to Africa/Nairobi, the member's visit days, week facts and rebuild are identical and the visit is still on D;
- a **default change**: `goal_default` changed from 3 to 4 after a week settled leaves that week's `goal` at 3, and a new unsettled week uses 4;
- a **regained streak**: met, met, missed, met gives `streak_weeks` 1 and `best_streak_weeks` 2.

**Given** `scripts/engagement-race.sh` (the `scripts/session-refund-race.sh` pattern: real second session inside the DB container, throwaway gym, default 8 iterations, wired into `scripts/ci-local.sh`'s pgtap stage and `.github/workflows/ci.yml` beside the refund race)
**When** a settle of a member and an offline check-in whose recorded time is in the just-closed week start at the same moment behind a third session holding the member lock
**Then** whichever commits first, the final state after one more settle shows the visit counted in the right week and `engagement_derived_state` equals `rebuild_engagement` (the week never stays `missed` with the visit present), and no iteration deadlocks or leaves `dirty_from` unset
**And** the test fails if `record_check_in` is run with the lock order changed (member lock must come first and unconditionally, because the shipped `check_in` takes it only when charging is on)

**Given** two members in different gyms and a staff member of each
**When** each calls any function of this story through the API
**Then** none of the helper functions is callable by `authenticated` (all in `private`, EXECUTE revoked), and the tenant-isolation test shows that a settle for a member of gym A never reads or writes a row for gym B

**Given** `supabase/tests/suspension_rpc_coverage.test.sql`
**When** it runs with the new SECURITY DEFINER settle function that writes the engagement tables
**Then** it passes with the function listed in the exclusion array with an inline reason (a system path called by the cron job, which skips suspended gyms, and by `open_engagement`, which refuses a suspended gym before calling it); no other edit to that test and no other existing test file is changed

---

### Story 30.3: Settle Triggers & the At-Risk State

As a member,
I want my week to be settled when it ends and the app to know whether a visit today matters,
So that Home and the calendar tell me the truth in the same words, and reading never changes anything behind my back.

*Delivers FR-219 and FR-220 (the open week, goal, count and settled streak the screens read; Must), FR-224 (the at-risk definition and `day_ends_at`; Must), NFR-028 (late visits reach the right week), NFR-029 (check-in never waits on settle). Spine AD-53 (`engagement_settle` job, `open_engagement()`, `private.engagement_state_view`), AD-19 (job independence, `job_runs`), AD-56 (`record_check_in`, `void_staff_check_in`), AD-29, AD-34. `[ASSUMPTION]` the at-risk hint is hidden for an expired subscription (owner decision 2026-11-15, EXPERIENCE.md MA-09). No UX gate (no screen). Migration at merge time; amends two Epic 27 functions.*

**Acceptance Criteria:**

**Given** `private.record_check_in` and `public.void_staff_check_in` as Epic 27 left them
**When** this story's migration re-creates them
**Then** the only change to each body is one added statement in the same transaction, after the attendance row is written and with the member lock already held: `insert into engagement_state(member_id, gym_id, dirty_from) values (..., private.week_start_of(<the row's visit_day>)) on conflict (member_id) do update set dirty_from = least(coalesce(engagement_state.dirty_from, excluded.dirty_from), excluded.dirty_from)`, and the migration review shows the rest of each body byte-identical to Epic 27's final version
**And** nothing else runs inside a check-in or a void: no settle, no fold, no fact insert, no milestone check (FR-225: engagement features change no check-in rule), and a pgTAP test asserts a QR check-in, a staff check-in and a void write exactly one `engagement_state` upsert and no `engagement_facts` row
**And** the dirty mark is the single indexed upsert on the primary key and is not wrapped in an exception handler, so a dirty mark can never be silently lost (a lost mark would leave a week missed for good, NFR-028)

**Given** the existing Epic 27 check-in and void pgTAP files, `check_in_session_gate*.test.sql`, `check_in_one_open_session_enforcement.test.sql` and `suspension_rpc_coverage.test.sql`
**When** the full pgTAP suite runs after the migration
**Then** every file passes **without any edit** (outcomes, the `NULL` refusals, the session consumption, the stamps, the alerts and the audit entries are unchanged), and `check_in()` returns the same row shapes as before
**And** with `release_week_start` NULL a check-in still succeeds and still writes only the dirty mark

**Given** a check-in whose recorded time falls in a previous, already-settled week (an offline scan within the auto-timeout window, FR-061)
**When** it commits
**Then** `engagement_state.dirty_from` is the Monday of the **recorded** visit's week (its stored `visit_day`), not the week of receipt, and a later `dirty_from` never replaces an earlier one

**Given** a void of a staff check-in
**When** it commits
**Then** `dirty_from` is the week of the voided visit's `visit_day`, and no milestone, badge or week fact is deleted or edited by the void (FR-230)

**Given** the cron job `engagement_settle`, registered with `cron.schedule` (upsert by name) at five past every hour, running as a procedure with a commit per member
**When** it runs
**Then** it logs a `job_runs` row (`job_name = 'engagement_settle'`, `started_at`, `finished_at`, `status`, `error`) and shares no lock, function or code path with `check_in()` (AD-19)
**And** candidates are members of **active, non-suspended** gyms with `deactivated_at is null` whose `engagement_state.dirty_from` is not null or whose `settled_through` is before the Monday of the gym's last closed week (gym-local, so each gym's week closes within an hour of its own Monday 00:00), ordered by `member_id`, processed in batches
**And** each member is settled in its **own short transaction** after `select ... from members ... for no key update skip locked`; a member whose row is locked (a check-in in flight) is skipped and picked up on the next run, so the job never holds a lock a scan needs and never blocks a check-in

**Given** one member whose settle raises an error
**When** the job runs over ten members
**Then** the other nine are settled and committed, the failing member's error is captured, and the run ends with `job_runs.status = 'failure'` and an `error` text naming the count and the first error (one bad member never fails the run, AD-19)
**And** a run with no failure ends `success`; a job re-run immediately afterwards settles nothing and inserts no fact

**Given** `release_week_start` NULL
**When** the job runs
**Then** it logs `success`, settles nothing and touches no member

**Given** `private.engagement_state_view(p_member_id uuid)`, STABLE, returning one row
**When** it is called for a member
**Then** it returns exactly: `enabled` (config epoch is set), `gym_today date`, `week_start date`, `week_end date`, `in_release_week` (the open week is before the epoch), `goal`, `goal_is_default` (no explicit goal row ever), `pending_goal` and `pending_effective_week`, `visits_this_week`, `goal_met`, `visited_today`, `streak_weeks` (the **settled** streak from the fold, never counting the open week), `streak_if_met` (settled streak plus one when the open week's goal is already met and the week is after the epoch, else NULL), `best_streak_weeks`, `has_settled_week`, `days_left_in_week` (including today), `visits_needed`, `at_risk_weekly`, `at_risk_daily`, `daily_run`, `shields_held`, `comeback_state`, `day_starts_at timestamptz`, `day_ends_at timestamptz`, `server_now timestamptz`, `needs_settle boolean` and `pending_milestone smallint`
**And** `daily_run`, `shields_held` and `comeback_state` are constants (NULL, 0, `'none'`) and `at_risk_daily` is false until Epic 31 fills them, and `pending_milestone` is NULL until 30.7, so later stories re-create the function body without changing its row type
**And** `needs_settle` is true when `dirty_from` is not null or the gym's last closed week is after `settled_through` (and the epoch is set), which is how the app learns it must call `open_engagement()`

**Given** the weekly at-risk rule (FR-233 (b))
**When** `visits_needed = goal - visits_this_week` and `days_left_in_week` are computed from `week_start + 6 - gym_today + 1` on dates
**Then** `at_risk_weekly` is true only when the member has **not visited today**, the goal is not met, `visits_needed = days_left_in_week` (no rest day remains), the open week is after the epoch, and the member's current subscription is not `expired`; pgTAP boundary cases with goal 3:
- Saturday, 1 visit, none today: needed 2, left 2: true;
- Friday, 1 visit: needed 2, left 3: false (a rest day remains);
- Sunday, 1 visit: needed 2, left 1: false (cannot be met);
- Sunday, 2 visits, none today: needed 1, left 1: true;
- Saturday, 1 visit including one today: false (visited today);
- goal 7 on a Monday with 0 visits: needed 7, left 7: true, and false on the same Monday after a visit that day (the definition applies literally; a goal of 7 is at risk all week until a visit is made each day);
- the same Saturday case for a member whose subscription is `expired`: false;
- a Pay-per-session member with no subscription expiry: treated like any other member (no plan gating, FR-225).
**And** the release week returns false for both flags (UX MA-09: no hint in the release week)

**Given** `day_ends_at`
**When** it is computed
**Then** it is the next gym-local midnight from `private.gym_local_day_bounds(gyms.timezone, now())` (so a 23-hour or 25-hour DST day is right), `day_starts_at` is the matching start, and `server_now` is `now()` so a client can derive hours left without trusting the phone clock; the calendar, the ring and (in Epic 31) the reminder read these flags and this value only

**Given** a member in a gym whose timezone was changed after the member's earlier visits
**When** the view is read
**Then** `visits_this_week` and the week bounds use the stored `visit_day` and the gym's current timezone only for "today" and `day_ends_at`; past days do not move (NFR-028)

**Given** `public.my_engagement()` (STABLE, no arguments, read only) and `public.open_engagement()` (VOLATILE, no arguments)
**When** a live member calls `my_engagement()`
**Then** it returns the view row for that member's own member row and **writes nothing**: a pgTAP test asserts `provolatile = 's'`, and that `engagement_state` and `engagement_facts` row counts and contents are identical before and after
**And** when the same member calls `open_engagement()` it settles through `private.settle_engagement(member, gym, gym_today)` under the member lock and returns the same row type after settling; calling it twice returns the same state and writes nothing the second time; it is the only member-callable function that settles (plain reads never mutate)

**Given** callers who are not a live member (Owner, Receptionist, support, anon, deactivated member, a member of a suspended gym)
**When** each calls `my_engagement()` or `open_engagement()`
**Then** each gets no row or a refusal, and no engagement row is written for anyone; both functions are revoked from `public` and `anon`, the member id is never a parameter (no IDOR), and `support_capabilities.test.sql` passes unchanged
**And** two members of the same gym each see only their own row

**Given** a Pay-per-session member, a member on a monthly plan, a member awaiting the registration fee and a member whose subscription is `grace_period`
**When** each calls `my_engagement()`
**Then** each gets a row (all members see the same features whatever their plan, FR-225); an expired member gets the row with `at_risk_weekly` false

**Given** the journey test `engagement_journey.test.sql` (PRD UJ-15 without Shields, in Africa/Douala, with the clock moved by test)
**When** a member with goal 3 checks in on three days of week 1, misses week 2 entirely, and meets the goal in week 3, with `open_engagement()` called each Monday
**Then** the settled streak reads 1 after week 1, 0 after week 2 (best stays 1), 1 after week 3, the ring counts (`visits_this_week`) follow the check-ins, a late offline visit for week 2 synced during week 3 turns week 2 into `met` (revision 2) and the streak becomes 3 with best 3 on the next `open_engagement()`, and at no point does a plain `my_engagement()` change a row

**Given** the generated database types and the mobile service layer
**When** this story ships
**Then** `packages/types/src/database.ts` is regenerated, and `apps/mobile/src/services/engagement.ts` exposes typed `getMyEngagement()` and `openEngagement()` with a Vitest that mocks the client and covers the success, empty (non-member) and error shapes

---

### Story 30.4: Weekly Ring & Streak on Home

As a member,
I want a ring on Home that fills with each day I visit and a streak I can see growing,
So that I know where I stand this week and feel the pull to keep it going.

*Delivers FR-219 (ring; Must), FR-220 (weekly streak display; Must), the Home half of FR-224 (at-risk hint; Must), FR-232 (wording from the catalog), FR-225 (same for every plan), NFR-028 (the screen shows the server's numbers), NFR-029 (loads independently, within the budget). Spine AD-53 (reads `my_engagement`, calls `open_engagement` on first open after a week closes), AD-56. No mascot. Shield chips, the comeback card and the daily chip are Epic 31 (their slots exist but render nothing). UX gate: MA-09 amendment N1 "This week" card and all its states in EXPERIENCE.md; the screen states and copy there are the acceptance baseline. No migration.*

**Acceptance Criteria:**

**Given** the Home screen with `my_engagement().enabled` true
**When** it renders
**Then** the **N1 "This week" section** appears after the quick actions and before the Rewards card: a heading row with "This week" (`engage.ring.title`) and a goal button "Goal: 3 days" with a pencil glyph (`engage.ring.goalLabel`, 44pt target, opens the `/goal` sheet of 30.1), and one `flat` Card, tappable as a whole, containing the Goal Ring, the weekly streak chip, the caption and the footer row
**And** when `enabled` is false (epoch not set) the section does not render at all and Home is unchanged from today

**Given** the Goal Ring (`{components.goalRing}`, 120pt, react-native-svg)
**When** a member has goal G (1 to 7) and V visit days this week
**Then** the ring has exactly G equal arc segments with small gaps, the first `min(V, G)` filled in the gym accent colour, the rest in the `border` colour, the centre shows "V / G" in `statNumeral` with the word "days" beneath (`engage.ring.unit`), and visits beyond the goal add no segments (the centre stays "G / G" and the caption is `engage.ring.caption.extra`)
**And** when `goal_met` every segment is `success` green with a check glyph, a new week with no visits shows "0 / 3" (a progress figure, not a streak), and the ring is one element with role `progressbar` and `accessibilityValue {min 0, max G, now V}` whose label is the sentence "Weekly goal: 2 of 3 visit days this week. 1 more visit closes your ring." (and "Weekly goal met: 3 of 3."), arcs decorative, in EN and FR

**Given** the weekly streak chip (`{components.streakChip}`)
**When** `streak_weeks` is 5
**Then** it shows the flame glyph and "5 weeks in a row" (`engage.streak.weeks`); at exactly 1 settled week it reads "First week done" (`engage.streak.first`); it is never shown as "0 weeks" and its accessible label is the sentence, never "0"
**And** while `shields_held` is 0 the line `engage.streak.nextShield` is not shown in this epic (Shields are Epic 31), and when `streak_weeks` is 0 and `best_streak_weeks` is at least 1 the card shows the muted line `engage.streak.best` ("Best: 8 weeks") in place of the chip `[ASSUMPTION — UX to confirm; Epic 31's comeback card supersedes it]`, so the card never shows a bare zero

**Given** the card's states (each tested with a fixture row of `my_engagement()` and rendered in EN and FR)
**When** the data matches a state of the UX table
**Then** the card renders exactly that state's ring, streak area, caption key and footer:
- **Loading**: a 120pt circle skeleton and two text-line skeletons in a card of about 168pt, loading independently of the status card;
- **Release week** (`in_release_week`): ring fills normally, no streak chip, caption `engage.streak.startsMonday`, no footer;
- **First week** (`has_settled_week` false, not the release week): ring fills, no chip, the line `engage.streak.firstWeek`, caption `engage.ring.caption.progress` or `.fresh`, at-risk hint if it applies;
- **No goal chosen yet** (`goal_is_default`): 3 segments and, once, the hint `engage.ring.goalHint.default` under the goal button, dismissed by tapping it or opening the goal sheet (dismissal stored on the device);
- **Goal change pending** (`pending_goal` set): the goal button reads `engage.ring.goalPending` ("Changes to 4 days on Mon 24 Nov") and the ring uses the current week's goal;
- **In progress**: caption `engage.ring.caption.progress` ("2 more visits close your ring"), at-risk hint only when `at_risk_weekly` is true;
- **Fresh week, 0 visits**: caption `engage.ring.caption.fresh`, streak chip kept;
- **Goal met**: caption `engage.ring.caption.metStreak` using `streak_if_met` (or `engage.ring.caption.met` with no streak yet), the chip shows the **settled** count, and no at-risk hint;
- **At risk**: ring and streak unchanged, the footer shows the hint (see below);
- **Offline**, **Error**, **Settle failed**, **Expired status** (below).

**Given** `at_risk_weekly` is true
**When** Home is visible
**Then** the footer row shows the hint with glyph `schedule` in the warning colour, the line `engage.atRisk.weekly`, and the hours left (`engage.atRisk.hoursLeft`, minutes under one hour), recomputed every minute while Home is visible from `day_ends_at` and the offset between `server_now` and the device clock taken at fetch time (so a wrong or travelling phone clock still shows the gym's day); a Vitest with a skewed device clock proves the hours shown are right
**And** the pulse runs for three cycles on focus and then stays static, and with the system reduce-motion or animations-off setting it never pulses (a static 2pt warning outline and the glyph remain); nothing flashes more than once a second
**And** the hint is announced once on focus in a polite live region (never `alert`), is not re-announced as minutes tick, and is never shown once the goal is met or when `at_risk_weekly` is false
**And** the namespace `engage.atRisk.*` is added to both locale files by this story with EN/FR parity

**Given** an **expired** member (subscription status `expired`)
**When** Home renders
**Then** the ring and streak chip show as normal and the at-risk hint is hidden (the server already returns false, and the screen also does not show a stale cached hint)

**Given** `needs_settle` is true when Home gains focus (first open after a week closes, or after a check-in that left `dirty_from` set)
**When** the screen loads
**Then** it calls `open_engagement()` **once per focus**, shows the card's loading skeleton for at most 2 seconds, then the settled state; a plain pull-to-refresh calls `my_engagement()` and calls `open_engagement()` only when `needs_settle` is true
**And** when `open_engagement()` fails the card keeps its last known state and shows the small line `engage.home.settleError`, retried on the next focus, never blocking the card

**Given** no connection
**When** Home opens
**Then** the card shows the last `my_engagement()` result stored on the device (per member and gym) plus the segments for scans queued on this device **today only** (a scan whose recorded time is at or after the cached `day_starts_at`; the device does no timezone arithmetic), each shown as one segment with a dashed outline and the caption note `engage.ring.pendingSync` `[ASSUMPTION — an earlier-day queued scan lights its day after sync]`; the at-risk hint shows from cached flags only when the device clock is still before the cached `day_ends_at`, otherwise it is hidden; the existing offline banner shows
**And** with no cache and no connection the card is replaced by the error card `engage.home.error` with pull to refresh; `engage.home.error` and `engage.home.settleError` are added to both locale files

**Given** wording
**When** a Vitest swaps a catalog value (`engage.ring.caption.met`) for a sentinel
**Then** the card shows the sentinel, and the screen file contains no literal English or French sentence (FR-232); the reserved Shield, comeback and daily slots render nothing and leave no gap

**Given** a Pay-per-session member and a monthly-plan member
**When** each opens Home
**Then** both see the same card (no plan gating, FR-225)

**Given** a member checks in and returns to Home
**When** the check-in result overlay has gone and Home focuses
**Then** the ring fills for the visit once `open_engagement()` has run, and the card never computes visit counts, streaks or week bounds itself; a component test fails if the screen file imports a date library to derive a week or a day

**Given** performance
**When** Home renders the card
**Then** `my_engagement()` is called once per focus (no per-segment calls), the card's skeleton does not wait for the status card, and the server-side timing of the call is recorded by the load script in 30.6 against NFR-029

---

### Story 30.5: Attendance Calendar

As a member,
I want a calendar of every day I came, and to be told calmly when a visit today keeps my week going,
So that I can see what I have built and know when today matters.

*Delivers FR-224 (calendar, earlier months, today's "at risk" cell with hours left; Must), FR-225 (stored history counts, class-only attendance does not, same for every plan), NFR-028 (late visits light their own day; past days do not move), NFR-029 (loads within the budget), NFR-027 (own data only). Spine AD-53, AD-56 (`member_visit_days`). Milestone markers are added by 30.7. UX gate: MA-18 in EXPERIENCE.md; the screen states and copy there are the acceptance baseline. Migration at merge time.*

**Acceptance Criteria:**

**Given** `public.my_visit_days(p_month date)` (STABLE, SECURITY DEFINER, no member id parameter) returning one row per visit day `(visit_day date, milestone smallint)`, and `public.my_first_visit_day()` (STABLE, no arguments) returning the member's earliest counted `visit_day` or NULL (so a month with no rows still has a way to bound the previous-month chevron)
**When** a live member calls it with the first day of a month
**Then** it returns the member's distinct `visit_day` values in that month from `member_visit_days` (date comparison against `p_month` and `p_month + 1 month`, no timezone arithmetic), `milestone` is NULL on every row in this story (30.7 fills it without changing the signature); the summary line count is the number of rows returned
**And** `p_month` that is not the first of a month, or is after the gym's current gym-local month, is refused with a stable error code, and a month with no visits returns no rows, never an error

**Given** callers who are not a live member (Owner, Receptionist, support, anon, deactivated, suspended gym) and a member of another gym
**When** each calls `my_visit_days`
**Then** each gets no rows, the member of another gym can never read gym A's days, a member reads only their own rows even when passing another member's gym month, and `support_capabilities.test.sql` passes unchanged

**Given** a member who attended a class (a `class_bookings.attended_at` set) on a day with no check-in
**When** the calendar loads that month
**Then** that day is **not** lit (class-only attendance is not a visit day, convention 2)
**And** a staff-entered check-in (Epic 27) lights its day exactly like a scan, a voided one does not, and a visit synced late through offline sync lights its own past day on the next load with no message (NFR-028)

**Given** existing attendance from before the release
**When** the member opens the calendar in the first week after release
**Then** every earlier day with an attendance record is lit as stored (FR-225: history counts), and a day before the member's first visit is an empty past day

**Given** the MA-18 screen at route `/calendar`, opened from the Home "This week" card or from the Profile
**When** it renders
**Then** the header bar shows the back arrow and "My visits" (`engage.calendar.title`) with no tab bar; the month bar shows the previous chevron, the month and year in `smallBold`, and the next chevron (44pt targets, the next chevron disabled at 40% opacity on the current month: no future months); one summary line "9 visit days in November" (`engage.calendar.monthSummary`, numeral as `statNumeral`); the month grid in a `flat` Card with a Monday-first weekday header and 4 to 6 rows of day cells (44pt); the legend row; and the day detail line
**And** the screen always opens on the current month (the month viewed is not remembered), the previous chevron is disabled at the member's earliest month with any visit (or the current month if none), and pull to refresh reloads the month
**And** the namespaces `engage.calendar.*` are added to both locale files by this story with EN/FR parity, and the grid generation is plain calendar-date arithmetic on dates (no device timezone, no `Date.now()` for the month shown; "today" comes from `gym_today` in the server response)

**Given** the cell states (`{components.calendarDayCell}`), each rendered from a fixture and snapshot-tested in EN and FR
**When** a month is shown
**Then** the cells match the UX table: **empty past day** (outline, muted numeral); **visit day** (accent fill, check glyph, on-accent numeral); **today, not yet visited, nothing at risk** (2pt accent outline, bold numeral); **today, visited** (lit plus the outline); **future day** (40% opacity, no outline, not tappable); **day outside the month** (blank, not focusable); **offline queued visit today** (lit with a dashed outline and the detail line "Waiting to sync")
**And** shape or glyph always accompanies colour; the Shield markers and milestone star are not drawn in this story (30.7 and Epic 31)

**Given** `my_engagement().at_risk_weekly` is true and the member has not visited today
**When** the current month is shown
**Then** today's cell is the **at-risk** cell: a 2pt warning outline pulsing (three cycles on focus, then static; none with reduce motion), glyph `schedule` top-right and the hours left in 10pt text inside the cell ("6 h", "45 m" under an hour), and an **at-risk line** under the grid with the same strings as Home's hint (`engage.atRisk.weekly` and the hours), so the information is also in readable text
**And** the conditions are read from `my_engagement()` (spine AD-53: the calendar, the ring and the reminder read only that function), the cell and the line are shown whether or not the reminder (Epic 31) ships or is switched on, and an expired member sees no at-risk cell (the flag is false)
**And** the hours left recompute every minute while the screen is visible from `day_ends_at` and the `server_now` offset, not the phone clock; the hint is announced once on focus and never as `alert`

**Given** the day detail line
**When** the screen opens and when a cell is tapped
**Then** it initially shows today's line, then names the tapped date and, for a lit day, "Visited"; it never shows a check-in time; tapping moves a 2pt focus ring there and navigates nowhere; swiping left or right moves a month (disabled while a screen reader is on)

**Given** the states of the screen
**When** each is forced
**Then** the behaviour matches the table: **Loading** (month bar and legend at once, the grid as 35 rounded-square skeletons); **current month with no visits** (`engage.calendar.empty.current`, grid still rendered); **past month with no visits** (`engage.calendar.empty.past`); **offline** (cached months render with `engage.calendar.offline`, a month never loaded shows `engage.calendar.offline.none` and a retry); **error** (`engage.calendar.error` in the grid slot, pull to refresh)

**Given** accessibility
**When** a screen reader traverses the calendar
**Then** the month heading is a header read first with the summary ("November 2026. 9 visit days."), each cell is its own element in reading order with a full-sentence label ("Tuesday 12 November, visited" / "Wednesday 13 November, no visit"), each row of cells is grouped and labelled "Week of 10 November, 3 visit days", and a cell is never described by colour alone

**Given** a member in a gym whose timezone changes
**When** the Owner changes `gyms.timezone`
**Then** previously lit days stay on their stored `visit_day`, and a pgTAP case on `my_visit_days` for a 23:30 visit shows it on the same day before and after the change

**Given** the load script of 30.6
**When** it runs `my_visit_days` for a member with two years of attendance at the largest tier's member cap
**Then** the server time is recorded there against NFR-029; this story's Definition of Done lists that figure

---

### Story 30.6: Gym Leaderboard & Anonymous Choice

As a member,
I want to see where I stand among my gym's members this month and to choose whether others see my name,
So that I get a little healthy company without anyone being named who has not agreed to it.

*Delivers FR-226 (monthly gym leaderboard; Must), FR-227 (Anonymous, first-open notice; Must), FR-228 (server-side enforcement, no prizes; Must), NFR-027 (privacy enforced and tested per read path), NFR-029 (the 2-second target, baseline recorded), NFR-001 (a gym never sees another gym's board). Spine AD-54 (`gym_leaderboard`), AD-1, AD-34, AD-56. `[ASSUMPTION]` ties share a rank and are ordered by who reached the count first; one neighbour above and below; members with no visit in the month are not ranked; fewer than 3 ranked shows no names (FR-226); decided 2026-11-15 (OQ-32): "Anonymous" until the notice is seen. UX gate: MA-19 (list, notice, states), the MA-12 Profile Anonymous toggle row and the MA-09 N3 Leaderboard card in EXPERIENCE.md; the screen states and copy there are the acceptance baseline. Migration at merge time.*

**Acceptance Criteria:**

**Given** the migration
**When** it runs
**Then** `member_preferences` gains `leaderboard_hidden boolean not null default false` and `leaderboard_notice_seen_at timestamptz` (NULL for every existing and every new row, so no existing member is named before seeing the notice, FR-227), on the per-gym `member_preferences` row (a member in two gyms sees the notice once at each)
**And** the existing `protect_self_managed_member_preferences_columns` trigger is extended so a member's **direct** UPDATE of either column is refused (error `leaderboard_columns_write_protected`, not a silent pin-back) unless the transaction-local flag set only inside `set_leaderboard_visibility` and `mark_leaderboard_notice_seen` is on; existing updates of the two notification opt-out columns keep working unchanged and the existing preferences pgTAP files pass unedited

**Given** `set_leaderboard_visibility(p_hidden boolean)` and `mark_leaderboard_notice_seen()` (SECURITY DEFINER, no member id parameter, live-member gate with the suspension guard)
**When** a live member calls them
**Then** `set_leaderboard_visibility` writes `leaderboard_hidden` on the caller's own preferences row only and does **not** touch the notice column; `mark_leaderboard_notice_seen` sets `leaderboard_notice_seen_at = now()` only when it is NULL (idempotent); opening the leaderboard never marks the notice seen
**And** for a staff member, support person, anon, deactivated member or suspended gym both are refused and write nothing, `p_hidden` NULL is refused, and `support_capabilities.test.sql` passes unchanged

**Given** `public.gym_leaderboard(p_month date)`, SECURITY DEFINER, STABLE, returning rows with this **exact** column allow-list: `position int`, `rank int`, `label text`, `is_anonymous boolean`, `visits int`, `is_self boolean`, `is_tied boolean`, `visits_behind int` (set only on the caller's row), `ranked_total int`, `self_ranked boolean`
**When** a live member calls it with the first day of the current gym-local month or of the previous one
**Then** it resolves the caller live (AD-34) and returns rows for **that member's gym only**, with `private.gym_id()` and `private.current_member_role() = 'member'` and `private.current_gym_status() = 'active'`, and a month that is neither of those two is refused with the stable error `invalid_month` (the server decides which month is current from the gym's timezone, never the device)
**And** no row contains a member id, photo, phone, user id, email, name column or any column outside the allow-list (asserted by comparing the function's result column names to the list)

**Given** the ranking rules
**When** visits are counted
**Then** `visits` is the number of distinct `visit_day` values of the member in that month from `attendance_counted` (a day on or after the first and before the first of the next month; a voided visit and class-only attendance count for nothing), eligible members are those with `deactivated_at is null` and a role that is not `support` (null-safe: `role is distinct from 'support'`), and a member with zero visits is not ranked
**And** order is `visits` descending, then the time the member reached that count (the earliest check-in time on their Nth distinct visit day, N = their visits) ascending, then member id (never returned); `rank` is the competition rank over `visits` alone, so ties share a rank (1, 2, 2, 4), `is_tied` is true for each member sharing a rank with another, and `position` is the 1-based place in the full order

**Given** a gym with 43 ranked members and a caller at position 17
**When** the board is returned
**Then** the rows are positions 1 to 10, the position 16 row, the caller's row (`is_self` true, `visits_behind` = the visits of the position-16 row minus the caller's, 0 when level, NULL when first), and the position 18 row; a caller at position 10 gets rows 1 to 10 and 11; a caller at positions 1 to 9 gets positions 1 to 10 only (neighbours are already in the list); a tie crossing position 10 shows exactly the first 10 positions by the order above
**And** `ranked_total` is the count of all ranked members (43) on every row, `self_ranked` is false and no `is_self` row exists for a caller with no visits that month (unranked), and `position` lets the client draw the separator where positions are not consecutive

**Given** fewer than 3 ranked members (0, 1 or 2) in the month
**When** the board is called
**Then** exactly **one** row is returned with `position`, `rank`, `label` and `visits` NULL, `is_self` false, `ranked_total` 0, 1 or 2, and `self_ranked` set, so the screen can choose `engage.leaderboard.empty.month`, `.onlyYou` or `.unranked` with no name, no own row and no neighbours, and nobody can be identified by elimination; the rule applies to both months

**Given** the label rule
**When** another member's row is built
**Then** `label` is the first space-separated token of `members.name` followed by a space, the first letter of the **last** token and a period ("CHANTAL N."; a single-token name is shown alone, with no period and no initial), the capitalisation being the one stored (names are saved in capitals, migration 0159, owner decision 2026-10-25: the UX examples show "Chantal N." only for readability), and is the literal `'Anonymous'` with `is_anonymous` true when `leaderboard_hidden` is true **or** `leaderboard_notice_seen_at` is NULL
**And** the caller's own row carries the label **as others see it** (so a hidden or unseen caller sees `'Anonymous'` with `is_anonymous` true), the screen shows "You" and the `engage.leaderboard.hidden.self` line; the screen maps `is_anonymous` to the localised "Anonymous" / « Anonyme » string, the server being the only place that decides who is anonymous (NFR-027)

**Given** the NFR-027 pgTAP test `leaderboard_privacy.test.sql`, one block per read path (`gym_leaderboard`, `my_leaderboard_settings()` below, and the Home card's use of `gym_leaderboard`)
**When** it runs with seeded gyms A and B
**Then** for member M1 hidden, M2 with the notice unseen, M3 visible, M4 deactivated and M5 a support member, as seen by viewer V of gym A: M1 and M2 appear as `'Anonymous'` with their rank and visits intact, M3 by label, M4 and M5 not at all, no result contains any M name text or id, and flipping M1 to visible changes only M1's label on V's next call (nothing is stored or cached, so a hide never leaves a name behind)
**And** a viewer of gym B never receives any gym A row and vice versa; a staff caller (Owner, Manager, Receptionist, Coach), a support caller and an anon caller each get an **empty** result; a deactivated member and a member of a suspended gym get an empty result; two viewers of the same gym receive identical rows for the top 10 except for `is_self` and `visits_behind`
**And** the function has no INSERT, UPDATE or DELETE in its body and `provolatile` is `'s'`

**Given** `public.my_leaderboard_settings()` (STABLE, no arguments)
**When** a live member calls it
**Then** it returns `(hidden boolean, notice_seen boolean, own_label text)` for the caller only, where `own_label` is the label as the server would show the caller **if visible** (so the notice can preview "MIREILLE K."), and it returns nothing for anyone else; the preview contains only the caller's own name

**Given** FR-228
**When** a test enumerates the tables and functions of the loyalty, session, stamp, Shield and payment families
**Then** none reads `gym_leaderboard`, a rank or a visit count from it, no table stores a rank, and `has_table_privilege` is false for every role on the engagement and attendance count paths, so no role can edit a count or rank directly and rank carries no prize, discount, session, Shield or stamp; the footnote `engage.leaderboard.footnote` ("Just for fun: rank earns no prizes") is in both locale files

**Given** the MA-19 screen at route `/leaderboard`, opened from the Home leaderboard card or the Profile link
**When** the member opens it for the first time (`my_leaderboard_settings().notice_seen` false)
**Then** the first-open notice sheet shows **before** the list: opaque and full height, the list behind it is **not rendered** and `gym_leaderboard` is not called yet; Icon Chip `groups`, the title, the body with the preview of the member's own label from `own_label`, the line saying never the photo or phone number, `engage.leaderboard.notice.until`, `engage.leaderboard.notice.change`, and two equal-weight 52pt buttons stacked, **[Show my name]** (primary) and **[Appear as Anonymous]** (secondary), neither pre-selected
**And** [Appear as Anonymous] calls `set_leaderboard_visibility(true)` **first** and only then `mark_leaderboard_notice_seen()`, so a failure between the two leaves the member hidden and never named; [Show my name] calls only `mark_leaderboard_notice_seen()`; both buttons show a spinner and are disabled until the call returns, and on success the sheet closes and the list loads
**And** there is no swipe-down and no tap-outside dismissal; the back arrow or Android back leaves for Home with the notice **not** marked seen and the member still shown as Anonymous (leaving never names anyone); a failure shows `engage.leaderboard.notice.error` and re-enables the buttons; offline both buttons are disabled with `engage.leaderboard.offline.notice` while the member can still leave

**Given** the board screen after the notice
**When** it renders in each state
**Then** it matches the UX states: segmented control "This month" | "Last month" (default This month, the second tab calls with the previous month); the list as rows of `{components.leaderboardRow}` (rank numeral, a neutral Icon Chip `person` or `visibility_off`, never a photo, the label, "11 visits"), ties show the same rank and the word `engage.leaderboard.row.tied`, a separator row labelled "Rows between are not shown" where positions are not consecutive, the member's own row labelled "You" with a 2pt accent border and a "You" tag, the behind/level/leading line under it (not on the previous month), the footnote, and the visibility row with the toggle; there is no crown, medal, gold or special treatment of ranks 1 to 3
**And** the states **loading** (6 row skeletons, then the member's row; under 2 s), **unranked** (`engage.leaderboard.unranked`, no neighbours), **fewer than 3 ranked** (`engage.leaderboard.notEnough` replaces the list, with the supporting line, the visibility row still shown), **hidden** (own row "You" plus `hidden.self`, rank and count unchanged), **offline** (cached board with `engage.updatedAt` and a banner, the toggle and notice buttons disabled), **error** (`engage.leaderboard.error` in the list slot with pull to refresh, the visibility row still shown) each render as specified; rows are not tappable and no member id, phone or photo reaches the device
**And** the screen reads every label from the server and a Vitest asserts it never derives a label, a rank, a tie or a total on the device

**Given** the Profile "Training" card of 30.1
**When** it renders
**Then** it gains the row "Appear as Anonymous on the gym leaderboard" (glyph `visibility_off`) as a toggle showing the stored choice (on = hidden), saved immediately and optimistically with the existing inline error and revert on failure, a helper line stating the current effect (`engage.profile.anonymous.helperOn`, `.helperOff` with the member's own label, or `.helperUnseen` while the notice is unseen) and the link "See the leaderboard" to MA-19
**And** turning the toggle **on** saves at once; turning it **off** while the notice is unseen does **not** save but opens the notice sheet (the same sheet, unchanged), and choosing there saves; the toggle never affects the member's count, rank, ring or streak; the helper never says the change is instant for others (it applies from their next load); the toggle's accessible label states its state

**Given** the Home leaderboard card (N3)
**When** Home renders
**Then** it shows the member's own standing from `gym_leaderboard` only: "Rank 9 of 43 this month" (`engage.home.rank`, rank and `ranked_total` from the server), the behind line, `engage.leaderboard.level` or `engage.leaderboard.leading`, `engage.leaderboard.unranked` for no visit, `engage.leaderboard.notEnough` when fewer than 3 are ranked, no names on Home, a loading rectangle of about 72pt, the last cached rank with `engage.updatedAt` offline, and `engage.leaderboard.error.short` with tap-to-retry on error; a member who has not seen the notice still sees their own rank here and no notice appears (only MA-19 opens it)
**And** the namespaces `engage.leaderboard.*`, `engage.home.rank` and `engage.profile.anonymous.*` are added to both locale files by this story with EN/FR parity

**Given** `scripts/engagement-load.sh` (seeded in a throwaway gym on the local stack, removed on exit)
**When** it seeds the **largest tier's** member cap read from `tiers.member_cap` at run time (about a month of attendance each, mixed hidden and visible) and calls `gym_leaderboard`, `my_engagement` and `my_visit_days` 50 times each as different members, 10 at a time
**Then** it prints p50 and p95 server time per function and writes the baseline to `docs/decisions.md` (a dated entry, newest first) against NFR-029's 2-second target, with the device-side figure to be added at the owner's end-of-epic check (the on-device 4G measurement cannot run in CI)
**And** when the p95 of `gym_leaderboard` exceeds 1 second the story adds the supporting index (for example on `attendance_events (gym_id, visit_day)`, checked with `EXPLAIN` so it is not a sequential scan) before closing, and a stored or cached board is **not** built here (the spine allows a cache only if the baseline still fails, and it never holds names); the script's seeding is synthetic only

**Given** the rest of the suite
**When** the full pgTAP suite and `scripts/ci-local.sh` run
**Then** the existing preferences, tenant-isolation and support-capability tests pass unchanged, and `supabase/tests/leaderboard_privacy.test.sql` plus a `leaderboard_ranking.test.sql` (ties, the 10-row boundary, neighbours at positions 1, 9, 10, 11, last, the unranked caller, the fewer-than-3 case, both months, the month validation) are added

---

### Story 30.7: Milestones & Celebration

As a member,
I want a moment of recognition at my 7th, 30th and 100th visit day, shown once,
So that I feel proud of what I have built.

*Delivers FR-229 (milestone at the 7th, 30th and 100th visit day, shown once, offline milestone shown after sync, calendar marker; Must), FR-225 (history at release is silent), FR-232 (celebration wording from the catalog), NFR-028 (milestones recompute and never double), and the "a void never reverses a milestone" half of FR-230 that Epic 30 can own. The badge shelf, the Share button and the badge rows are Epic 31. Spine AD-53 (milestone facts, `acknowledged_at` set by one function), AD-56. `[ASSUMPTION]` a milestone earned before `release_week_start` is written silent; this includes a milestone reached in the release week itself, because AD-53 defines the epoch as the line (the PRD says "existing history at release"). UX gate: MA-20 without the Share button, and the milestone markers of MA-18, in EXPERIENCE.md; the screen states and copy there are the acceptance baseline. Migration at merge time.*

**Acceptance Criteria:**

**Given** `private.award_milestones(p_member_id uuid)`
**When** it runs for a member with N distinct `visit_day` values in `member_visit_days` (all of the member's time at that gym)
**Then** for each of 7, 30 and 100 that N has reached and for which no `milestone` fact exists, it inserts one fact (`kind = 'milestone'`, `subject_key` the number, `revision` 1) and nothing else; a milestone fact is never inserted twice for the same number (replay inserts nothing)
**And** it is called only from the tail of `private.settle_engagement` (re-created by this migration with one added call and otherwise identical to 30.2's body; 30.2's tests pass unedited), and never from `record_check_in` or `void_staff_check_in` (a scan only sets the dirty mark; the app read that follows runs the award)

**Given** a member whose Nth visit day (the Nth distinct day in order) is before `release_week_start`
**When** the milestone is awarded
**Then** the fact is written `silent = true` with `acknowledged_at = now()` (no celebration), whatever the value of N, and a member with 120 visit days all before the epoch gets three silent milestones and no pending celebration
**And** a milestone whose Nth day is on or after the epoch is `silent = false` and `acknowledged_at` NULL

**Given** a milestone fact exists and a staff check-in that was the 7th visit day is voided (the count drops to 6)
**When** settle runs again and later the member visits again (the count returns to 7)
**Then** the milestone row is unchanged, `acknowledged_at` is unchanged, no second row or second celebration appears, and the calendar marker follows the 7th distinct day as now derived (a void never reverses a milestone, FR-230; AD-53)
**And** a late offline visit that makes an earlier date the 7th day moves the **marker** (derived from `member_visit_days`) but writes no new fact

**Given** `public.my_engagement()`
**When** a member has unacknowledged, non-silent milestones
**Then** `pending_milestone` returns the **highest** such number (30 when both 7 and 30 are waiting), NULL otherwise; the view row type is the one 30.3 defined
**And** an offline visit that earns a milestone appears as `pending_milestone` after the visit syncs and the next `open_engagement()` runs on Home focus, possibly hours later, with no special case (FR-229)

**Given** `public.acknowledge_milestone(p_milestone smallint)` (SECURITY DEFINER, the **only** function that sets `acknowledged_at`, live-member gate, no member id)
**When** the member calls it for the milestone they were shown
**Then** it sets `acknowledged_at = now()` on that milestone and on every **lower** unacknowledged milestone of the same member (the app shows only the highest and the lower ones are acknowledged silently), by raising the transaction-local flag that 30.2's append-only trigger requires, changing no other column
**And** a second call is a no-op and returns the same result, a call for a milestone the member does not hold or for a number other than 7, 30 or 100 is refused or a no-op without writing, and a staff, support, anon, deactivated or suspended-gym caller is refused; `support_capabilities.test.sql` passes unchanged

**Given** two gyms and two members
**When** member A calls `acknowledge_milestone` or reads `pending_milestone`
**Then** A can never acknowledge or read B's milestone, and the NFR-001 isolation test shows no cross-member or cross-gym effect

**Given** the NFR-028 test of 30.2
**When** it is extended
**Then** `engagement_derived_state` and `rebuild_engagement` also return the sorted array of milestone numbers reached and compare equal after the late-visit, void and timezone cases, and the journey test of 30.3 gains a case where a member's 7th visit day arrives by offline sync after the week was settled and the milestone becomes pending exactly once

**Given** `my_visit_days(p_month)` of 30.5
**When** the month contains the day that is the member's 7th, 30th or 100th distinct visit day
**Then** that row's `milestone` column is 7, 30 or 100 (derived from the ordered distinct days, never stored), a milestone that exists as a fact whose day is now in another month shows in that month, and the signature is unchanged
**And** MA-18 draws on such a cell the small star-badge corner (glyph `star`, 14pt) over the lit cell, adds the legend entry "Milestone", and the day detail line says "Your 30th visit"; the cell label reads "Friday 15 November, your 30th visit"; shape and text, not colour alone; snapshot tests in EN and FR

**Given** MA-20 at route `/celebration/:milestoneId`, where `milestoneId` is the milestone number
**When** Home mounts and `pending_milestone` is not NULL (after the check-in result overlay has gone)
**Then** the screen is pushed over Home about 600 ms after Home has painted, as a full-screen overlay on the dark background with no tab bar and no back arrow, never from a tab and never from a push notification; the screen is not shown to an expired or suspended member (the root guards win)
**And** an already-acknowledged milestone number opens to Home instead

**Given** the celebration card
**When** it renders
**Then** it shows, centred at 480pt maximum width: an empty zero-height **mascot slot** bound to `engage.celebration.mascot.7|30|100` that renders nothing and leaves no gap while those keys are empty (and renders the key's text when a test sets one, with no layout change); a `{components.celebrationOverlay}` card with the gym logo (48pt, omitted if not in the branding cache) and the gym name, the milestone numeral in the celebration numeral size, the word "visits" (`engage.celebration.unit`), the headline (`engage.celebration.<n>.headline`) and one sentence (`engage.celebration.<n>.sub`); and a read-only mini month calendar of the current month with lit days only (28pt, no numerals, no at-risk) when the screen height is at least 640pt and never at +2 text size
**And** there is **no Share button and no "See your badges" link** in this epic; **[Keep going]** is the only button, 52pt, primary

**Given** the motion rules
**When** the screen appears
**Then** a Success notification haptic fires (it fires with reduced motion too), the numeral counts up from 0 to the milestone over 700 ms and the card scales from 96% to 100% with a fade over 400 ms, with **no confetti, no looping animation and no sound**; with the system reduce-motion setting there is no count-up and no scale, the card shows its final state with a 150 ms cross-fade; a Vitest with reduced motion mocked on and off proves both variants, and a test fails if any looping animation or sound asset is referenced by the screen

**Given** the member taps [Keep going] or uses Android back
**When** the screen closes
**Then** `acknowledge_milestone(n)` is called and the member returns to Home (never back into the check-in overlay); swipe down does nothing
**And** when the call fails (offline) the screen still closes, the acknowledgement is retried silently, the milestone number is stored on the device as shown so the celebration is **not shown twice**, and a later successful retry clears the server flag; the shown-store is cleared if the member signs out or switches gym

**Given** several milestones waiting after a long offline gap
**When** Home mounts
**Then** only the highest is celebrated, the lower ones are acknowledged by the same call, and none is shown afterwards

**Given** accessibility and wording
**When** the screen renders in EN and FR
**Then** it is announced once as an `alert` with `engage.celebration.a11y` ("Milestone: 30 visits at {gym}"), focus starts on the headline, the numeral and the mini calendar are decorative (`accessibilityRole: 'none'`), the 52pt button has a clear label, every string comes from the catalog (a sentinel-value Vitest, FR-232), the headlines and sentences contain no exclamation marks or loss wording, and EN and FR key counts match

**Given** the release epoch and history
**When** a member with 35 visit days before `release_week_start` and 2 after opens the app on the first day after the epoch
**Then** the 7th and 30th milestones exist as silent facts, the calendar shows the earlier days and markers on the stored 7th and 30th days, no celebration appears, and the member's next milestone (the 100th) is celebrated when it is reached

**Given** the full suite
**When** `scripts/ci-local.sh` runs
**Then** the pgTAP files `engagement_milestones.test.sql` and the extended determinism and journey tests pass, the component tests for MA-20 and the calendar marker pass, no Epic 27–29 test is edited, and `check_in()` behaviour is byte-for-byte unchanged (no award runs inside a check-in)


---

### Epic 31 — Stories

| # | Story | Migration | Depends on |
|---|---|---|---|
| 31.1 | Streak Shields and Comeback | next free at merge time | Epic 30 (engagement_facts, fold, `private.engagement_state_view`, Home "This week" card, wording catalog) |
| 31.2 | Streak Reminder N-08 | next free at merge time | Epic 30 (`private.engagement_state_view`, `platform_engagement_config.release_week_start`, Profile Training/Notifications sections) |
| 31.3 | Badge Shelf and Share Image | next free at merge time (badge award and `get_my_badges()` only; the share image has no migration) | Epic 30 (milestone award path, celebration screen MA-20, calendar read), 31.1 (the "4 weeks in a row" badge is awarded from the fold's first earned Shield) |

*Scope of this release: only the Should items ship (FR-222, FR-223, FR-230, FR-231, FR-233). FR-221, FR-234 and FR-235 are Could items and get no stories now; see "Deferred (no stories in V1.8)" at the end of this section.*

*31.1 and 31.2 can run in parallel (31.2 reads only the at-risk flags that Epic 30 already puts in `private.engagement_state_view`, and neither touches the other's tables). 31.3 starts after 31.1 is merged to the epic branch. 31.2 and any later epic that adds a notification type both re-create `private.process_notification_deliveries()` in whole (the last-writer-wins hazard of spine AD-32): the story that merges second copies the live definition at merge time, not the one in its own branch. Migration numbers are assigned at merge time (latest at planning time: 0172, with Epics 27-30 ahead of this epic); earlier stories never renumber.*

*Production is live with real gyms: every story here ships behind the full `scripts/ci-local.sh` gate. 31.1 changes the fold that every member's streak is derived from, so its rebuild-equivalence test (NFR-028) is the release gate for it. 31.2 sends a push to members on a schedule and defaults on, so its at-most-once tests are the release gate for it. None of the three changes `check_in()`, `record_check_in`, `consume_guest_session`, authorization or the support registry; each story states the regression assertion that proves it.*

---

### Story 31.1: Streak Shields and Comeback

As a member who trains regularly,
I want one missed week not to wipe out my streak, and a clear way back if it does end,
So that illness or a holiday does not make me feel I have lost everything I built.

*Delivers FR-222 (Should), FR-223 (Should), FR-232 (Shield and comeback wording), NFR-028 (Shield, comeback and correction determinism), FR-170 untouched; spine AD-53 (Shield and comeback fold), AD-19 (settle job unchanged), AD-61 (config singleton); UX gate: MA-09 (Shield chips, comeback card N2, "Shield saved" and "Shield earned" states) in EXPERIENCE.md; the screen states and copy there are the acceptance baseline.*

*Extends, and does not replace, Epic 30's fold: `engagement_facts` (append-only, keyed `(member_id, kind, subject_key, revision)`, effective fact = highest revision), `private.settle_engagement`, `rebuild_engagement(member_id)`, `engagement_state(member_id, settled_through, dirty_from)`, `private.engagement_state_view(member_id)` and `platform_engagement_config`. Where this story needs a config column that Epic 30 did not create (Shield interval 4, Shield cap 2, comeback visits 3, comeback window 10 days), it adds it to the singleton with the existing audit trigger; the values are the PRD defaults (OQ-33) and are not read from anywhere else. The facts this story writes use the kinds AD-53 already names: `week` (outcome `met`, `missed` or `saved`), `comeback`, and `day_shield` (designed, never written in V1.8). No new table.*

**Acceptance Criteria:**

**Given** a member whose run has `n` met weeks and who holds fewer than 2 Shields
**When** a week settles as met and that week makes the run's met-week count a multiple of 4 (the 4th, 8th, 12th ... consecutive met week)
**Then** the fold reports one more Shield held, so a member with a run of 4 holds 1, a run of 8 holds 2 (if none was spent), and `engagement_state_view` returns `shields_held`, `weeks_to_next_shield` (1 to 4) and `shield_cap` (2) read from `platform_engagement_config`
**And** a Shield earned at the cap is not stored: a run of 12 with none spent still holds 2, and `weeks_to_next_shield` is null while the cap is held
**And** no Shield row or counter is written anywhere: the number held is derived only by folding the effective `week` facts in order, so a corrected week corrects every later Shield (AD-53)

**Given** a member with an active run and at least 1 Shield held
**When** a week closes as missed (below the goal in force that week, FR-220)
**Then** the settle writes that week's effective fact as `saved` (with the goal and visit count used), the held count falls by 1, the streak count is unchanged (a saved week keeps the streak but adds nothing to it), the best streak is unchanged, and no `comeback` fact is written
**And** the same member with 2 held, missing two weeks in a row, spends both; a third missed week with none left ends the run (one Shield saves one period)
**And** a week saved by a Shield does not count toward the next Shield: with a run of 6 that spent a Shield on week 7 and met weeks 8 and 9, the next Shield is earned when the run's met-week count reaches 8, not earlier
**And** `engagement_state_view` returns the newest saved week (`week_start`, streak length after it) so the app can show the "Shield saved" notice

**Given** a member with an active run and no Shield held
**When** a week closes as missed
**Then** the run ends: the effective fact for that week is `missed`, the current streak is 0 internally, the best streak is raised only if the ended run was longer than the previous best and is never lowered, and a `comeback` fact `started` is written (subject_key the missed week's start date, revision 1)
**And** consecutive is strict: a week below the goal with no Shield ends the run, and a missed visit inside a week that still meets the goal costs nothing and spends nothing `[ASSUMPTION, FR-220]`
**And** a member who is not in a run (no met week yet, or the run already ended) never spends a Shield on a missed week, and a member's held Shields at the moment a run ends are always 0 (a run only ends when none is held)
**And** a member who restarts after a break earns a Shield again only after 4 more consecutive met weeks `[ASSUMPTION, FR-222]`

**Given** a week that was settled as `saved` or `missed` and a visit arrives late (an offline scan that syncs, FR-061) or a staff check-in is voided (`void_staff_check_in`, AD-56)
**When** `record_check_in` or the void sets `dirty_from` to the earliest week it touches and the next settle runs
**Then** settle re-folds from `dirty_from` to the present under the member lock and inserts the next `revision` only for each week, `comeback` subject and run whose effective value changed (a replay inserts nothing and an A to B to A sequence flips back)
**And** a late visit that turns a `saved` week into `met` gives the Shield back and adds the week to the streak count (so every later 4th-week Shield moves, and a Shield that was earned at a week which is no longer the 4th is no longer held)
**And** a void that turns a `met` week into `missed` spends a held Shield on it or ends the run, and re-evaluates every later week in the same transaction
**And** a Shield cannot be used twice for the same period: one effective `week` fact exists per `(member, week_start)`, so two settles racing (cron plus first-open) under the member lock, or the same settle retried, leave one `saved` fact, one Shield spent and one revision per change (pgTAP, two-session race script)

**Given** a member whose streak ended with no Shield (a `comeback` `started` fact exists)
**When** the fold evaluates visit days from the day the missed week closed
**Then** the comeback goal is `comeback_visits` (3) visit days within `comeback_window_days` (10) days, counted from the first visit day after the run ended (the window is the 10 gym-local days starting with that visit day, inclusive), reading `member_visit_days` only (FR-225: several check-ins in a day count once; a class-only attendance is not a visit day, AD-56)
**And** reaching the third visit day inside the window writes `comeback` `completed` (subject_key the window's start date); a window that ends with fewer than 3 writes `comeback` `lapsed` for that window, and the next visit day starts a new window `[ASSUMPTION, FR-223: 10 days is a proposal, OQ-35]`
**And** a week that settles as met while a comeback is open starts a new run (count 1) and also closes the comeback as `completed` with `completed_by = 'week'` `[ASSUMPTION: FR-223 leaves open what happens when the goal is met before three visits, for example at a goal of 1; closing the card here avoids showing a comeback card beside a live streak chip]`
**And** completing a comeback restores active status only: the new streak is counted from the first week the goal is met again, no count is invented, and no Shield, stamp, session or other reward is granted (FR-223, FR-170)
**And** `engagement_state_view` returns `best_streak` (always, never null once a run has existed), `comeback` (`state` one of none, active, lapsed, restored; `visits_done`, `visits_goal`, `window_ends_on`) and never a bare 0: the streak is returned as null, not 0, when no run is active

**Given** the Shield and comeback fold
**When** the daily streak does not exist yet (FR-221 is deferred to a later release)
**Then** the `day_shield` fact kind and the reservation rule "a missed day uses a Shield only when the member holds two, so the last Shield is always kept for the weekly streak" (AD-53 `[ASSUMPTION, resolves OQ-35]`) exist in the fold design as a single step guarded by `private.engagement_daily_streak_enabled()`, which returns false in V1.8
**And** the day path is inactive: running settle on a member with 5 consecutive visit days and 2 Shields writes no `day_shield` fact and leaves the Shield count unchanged (pgTAP)
**And** a pgTAP test replaces `private.engagement_daily_streak_enabled()` inside a rolled-back transaction to return true and proves the reservation rule on synthetic data (a missed day spends a Shield with 2 held, never with 1; a whole missed week that would end both streaks spends one Shield on the weekly streak and ends the daily one), so the rule is pinned before the daily streak story reuses it

**Given** the existing rebuild equivalence test (NFR-028)
**When** this story extends it
**Then** `rebuild_engagement(member_id)` returns the derived state (current streak, best streak, Shields held, comeback state and window, per-week outcomes) and the test compares it with the live fold, not row counts, over seeded attendance that includes: a run that earns a Shield at week 4 and spends it at week 6; two Shields held and both spent; a run ended with no Shield followed by a comeback that completes; a comeback window that lapses and restarts; a late offline visit (stamped Sunday 23:50 and synced after Monday's settle) that turns a saved week back into met; a void that turns a met week into missed; and a gym timezone changed after the weeks were settled (past `visit_day` values do not move)
**And** a repair from `rebuild_engagement` appends the difference and never truncates `engagement_facts`, and never touches `acknowledged_at` or `silent` on milestone and badge facts
**And** the week fold reads the stored `visit_day` and the goal in force that week from the week fact, so a goal change after the week began does not change that week's outcome or any Shield decision (NFR-028)

**Given** Shields, comeback and loyalty
**When** any role calls any function in this story, or searches the schema for a write path
**Then** there is no function that buys, gives, transfers or grants a Shield or edits a streak, comeback or best-streak value; `anon` and `authenticated` hold no INSERT, UPDATE or DELETE on `engagement_facts` (unchanged from Epic 30) and no new function is granted to staff roles or registered in `private.support_capabilities` (`supabase/tests/support_capabilities.test.sql` is unchanged, FR-251 is not widened)
**And** nothing in this story reads or writes the loyalty ledger, `guest_sessions` or stamps (FR-170 untouched), proven by a pgTAP test that a completed comeback and an earned Shield leave the loyalty ledger and `guest_sessions` row counts identical

**Given** the settle and read paths already live from Epic 30
**When** this story ships
**Then** the existing pgTAP suite passes without fixture edits except the Epic 30 fold and `engagement_state_view` tests that this story names and extends; `check_in()`, `record_check_in` and `void_staff_check_in` bodies are not edited, and a test shows a check-in writes no `engagement_facts` row and calls no fold code (it only sets `dirty_from`)
**And** the extended `engagement_state_view` is dropped and re-created with its return columns extended, EXECUTE is revoked from `public` and `anon` and granted only as Epic 30 granted it (the default-privilege trap: a new function is anon-executable unless revoked), and a pgTAP test asserts `has_function_privilege('anon', ...)` is false
**And** the view answers from the member's own facts and `member_visit_days` only (no per-call full-history scan beyond Epic 30's), so the ring, calendar and leaderboard NFR-029 target is not regressed; an `explain` check on a seeded 3-year member shows no sequential scan of `attendance_events`

**Given** the Home "This week" card on the mobile app (UX gate MA-09)
**When** the extended state arrives
**Then** the Shield chip (`engage.shield.chip`, glyph `shield`) shows only when 1 or 2 are held (never "0 Shields"), its tap target is 44pt and it opens the explainer sheet (`engage.shield.explainer.title`, `.body` with `{max}` from the server, [Got it] `engage.shield.gotIt`); the muted line `engage.streak.nextShield` shows below the streak chip when fewer than the cap are held and `engage.streak.shieldMax` at the cap
**And** the card renders every Shield and comeback row of the UX state table by name: "Shield saved a week" (chip shows the preserved length, notice row `engage.shield.saved.week` with {date} and {n}, dismissible, persisted on the device until dismissed), "Shield earned" (chip +1, notice `engage.shield.earned`), at most one notice row at a time, newest first, each dismissed on its own; the at-risk hint's optional second line `engage.atRisk.shieldReady` shows when a Shield is held; the calendar legend entry `engage.calendar.legend.shield` and the week-saved glyph are supplied with the data Epic 30's calendar already renders
**And** the comeback card N2 shows the phases "Active, no comeback visit yet" (3 empty stamp segments, no "0 / 3" numeral), "Visits 1 or 2" ("1 / 3", accessible label `engage.comeback.progress`), "Window lapsed" (`engage.comeback.windowRestart`, no failure wording, no warning or red tint) and "Restored" (one-time `engage.comeback.restored.title` and `.body`, then gone on next load, the chip reading "Best: n weeks" until the first new week is met), with `engage.comeback.title`, `.best` (best streak in `statNumeral`) and `.goal` built from `{n}` and `{days}` returned by the server, never hard-coded 3 and 10
**And** a bare "0" is never rendered: with no run and no best streak the streak area is hidden, as Epic 30 already specifies

**Given** the new wording
**When** the mobile EN and FR catalogs are checked
**Then** every key in the UX catalog groups `engage.shield.*` and `engage.comeback.*` plus `engage.streak.nextShield`, `engage.streak.shieldMax`, `engage.atRisk.shieldReady` and `engage.calendar.legend.shield` exists in both `apps/mobile/src/locales/en.json` and `fr.json` with the UX plural forms (`one` and `other`), the existing i18n parity check (`scripts/check-i18n-key-parity.mjs`) passes with no missing key, and the words "freeze", "insurance" and "token" appear in no Shield string (UX glossary; FR uses "bouclier")
**And** the wording lives in the same editable catalog Epic 30 uses for the ring and celebration (FR-232), so changing a word changes no screen code

**Given** offline and staleness states
**When** the device is offline or the settle call fails
**Then** Home shows the last known Shield and comeback state without error, a visit queued on the device is shown as the pending (dashed) segment only and never changes a Shield or comeback figure locally (the server is the only place a streak, Shield or comeback is decided, FR-220), and `engage.home.settleError` shows as Epic 30 specified if `open_engagement()` fails

**Given** the full gate
**When** `scripts/ci-local.sh` runs
**Then** pgTAP covers: earning at 4 and 8 and the cap; spending on a missed week; the saved week not counting; two missed weeks with one Shield; run end with best streak kept; comeback start, completion, lapse and restart; the met-week-closes-comeback assumption; late-visit and void corrections cascading to later Shields; the double-settle race; the inactive day path and its rolled-back activation proof; no write path for staff or support; loyalty untouched; anon privilege; the extended rebuild equivalence; and the existing suite unchanged
**And** the mobile component tests cover each Shield and comeback state named above in EN and FR, plural forms at 1 and 2, the dismissal persistence, and reduced text-size layout; there is no new device E2E harness in this repo, so the release gate 10.3 item 1 (Shields and the comeback state work) is evidenced by the pgTAP scenarios plus these component tests, and manual browser/device QA stays with the product owner at the end of the epic

---

### Story 31.2: Streak Reminder N-08

As a member who is one visit away from keeping my week,
I want a single, calm evening reminder when a visit today is what keeps my week on track, and a switch to turn it off,
So that I do not lose a week by forgetting, and I never feel nagged.

*Delivers FR-233 (Should), FR-232 (N-08 wording), NFR-029 (at most one per member per day, safe to run twice, never blocks a check-in), Amendment to FR-076 (N-08 is a non-critical notification with one off-switch), FR-075 (new row N-08); spine AD-60, AD-25, AD-19, AD-53 (at-risk flags read from `private.engagement_state_view` only); UX gate: the "Streak reminder" toggle in MA-12 Notifications Card and the N-08 EN and FR copy (`n08.*`, `engage.profile.reminder.*`) in EXPERIENCE.md; the screen states and copy there are the acceptance baseline.*

*Real code facts this story follows (verified against migrations 0045, 0056, 0059, 0084): `private.send_push_notification(p_subscription_id, p_notification_code)` serves only N-01 to N-03 and raises `unsupported notification code` for anything else, so N-08 gets its own sender `private.send_engagement_reminder(p_member_id uuid)`; each family has its own dispatch and delivery tables (`private.class_reminder_dispatches` is unique on `(class_session_id, member_id)` and claimed with `on conflict do nothing returning id`); `public.notifications.type` is an inline CHECK on N-01..N-07 (0084) and each sender inserts one history row after its claim succeeds; `private.process_notification_deliveries()` is one function replaced in whole by each family; `member_preferences` opt-outs are `<x>_opted_out boolean not null default false` with self read/update policies and a protect trigger that pins only `member_id` and `gym_id`; cron registration is `cron.schedule(name, expr, command)` upserting by name; the language is read from `users.preferred_language` (fr, else en). `private.gym_today(gym_id)` is the gym-local date and is what `gym_local_date` means below.*

**Acceptance Criteria:**

**Given** the schema
**When** the migration ships
**Then** `private.engagement_reminder_dispatches (id uuid pk, member_id uuid not null references members on delete cascade, gym_id uuid not null references gyms, gym_local_date date not null, sent_at timestamptz not null default now(), status text not null default 'pending' check in ('pending','queued','no_tokens'), updated_at, unique (member_id, gym_local_date))` and `private.engagement_reminder_deliveries` (the identical column shape and indexes of `private.class_reminder_deliveries`: `dispatch_id`, `expo_push_token`, `push_request_id`, `expo_ticket_id`, `receipt_request_id`, `status` in push_pending, receipt_pending, delivered, failed, device_not_registered, unique `(dispatch_id, expo_push_token)`, and the two unique request-id indexes) exist in the `private` schema with no grant to `anon` or `authenticated`
**And** `public.notifications.type` CHECK is extended to `('N-01'..'N-08')` by dropping and re-adding the constraint, and `apps/mobile/src/services/notificationHistory.ts` (`NotificationType`) and the history screen's type-to-icon map in `apps/mobile/src/app/notifications.tsx` gain N-08
**And** `member_preferences.streak_reminder_opted_out boolean not null default false` is added, every existing row reads false (on by default, FR-233), the member's own row is readable and updatable through the existing self policies, another member's row is neither, and `memberPreferencesUpdateSchema` in `@gymos/types` and `apps/mobile/src/services/notificationPreferences.ts` carry the new field

**Given** `private.process_notification_deliveries()`
**When** this story re-creates it
**Then** the new definition starts from the live definition at merge time (not from the one in this branch), keeps every existing family's polling branch byte-for-byte equivalent in behaviour, and adds the `engagement_reminder_deliveries` branch (push request, receipt check, failed and `device_not_registered` handling) in the same shape as the class-reminder branch
**And** the existing notification pgTAP files (`class_reminder_notification`, `quiet_gym_alerts`, `payment_notifications`, `subscription_lifecycle_notifications`, `notification_history` and their `.negative` variants) pass without fixture edits except `notification_history.test.sql` where it pins the CHECK list, which this story names and extends to N-08

**Given** the cron job
**When** it is registered
**Then** exactly one job `engagement_reminder` runs `*/15 * * * *` through a `run_engagement_reminder_job()` function (EXECUTE revoked from `public`, `anon` and `authenticated`), and it writes one `job_runs` row per run with `job_name = 'engagement_reminder'`, status `success` or `failure` and the error text on failure
**And** the job selects only gyms whose gym-local time (from `gyms.timezone`, via the existing gym-local helpers, never the server's UTC date) is at or after 18:00 and before 21:00 `[ASSUMPTION, adversarial review L-02: the 18:00 target is the first 15-minute tick at or after 18:00 local; the 21:00 limit lets a later tick catch up when one run was missed, and the unique dispatch key keeps it to one]`, and only gyms that are active (not suspended or cancelled)
**And** nothing is sent while `now()` is before `platform_engagement_config.release_week_start` (the engagement epoch), so enabling the job at release does not notify every existing member on the first evening before their first settled week `[ASSUMPTION: rollout guard, no extra flag]`

**Given** a candidate member in a gym in the window
**When** the job evaluates them
**Then** the member is eligible only if all hold: the member row is active (not deactivated); `streak_reminder_opted_out` is false; the member's subscription status is not `expired` (a member who would be refused at the door, owner decision 2026-11-15); the member has no visit day today (`member_visit_days` for `private.gym_today(gym_id)`, read from `attendance_counted` so a voided visit does not count as a visit); and `private.engagement_state_view(member_id)` reports FR-233 condition (b) true: the weekly goal in force can still be met but only if the member visits today, i.e. the visit days still needed this week are at least 1 and equal the gym-local days left in the week, today included (Monday start, Sunday the last day)
**And** the job reads the at-risk flag, the visits still needed and the days left only from `engagement_state_view`; it never recomputes week boundaries, goals or visit counts itself, and never writes `engagement_facts`
**And** a Pay-per-session member, a rare visitor and a member with no streak are eligible exactly like any other (no plan gating, FR-225), and a member who holds a Shield is still reminded (the Shield does not suppress the reminder; the Home hint shows "a Shield is ready" at the same moment, UX) `[ASSUMPTION: resolves adversarial review L-02 for AD-60]`

**Given** FR-233 condition (a) (a daily streak of 3 or more days would end today)
**When** this release ships
**Then** condition (a) is inactive, because it needs the daily streak (FR-221), which is deferred: only condition (b) sends in V1.8, the `n08.daily.*` copy keys are not used, and the job's selection reads a single `at_risk_weekly` style flag from the view so that a later daily-streak story adds condition (a) by reading one more flag, with no change to the claim, dispatch table or schedule (document this in the function's migration header)

**Given** an eligible member
**When** the job sends
**Then** it claims first: `insert into private.engagement_reminder_dispatches (member_id, gym_id, gym_local_date) ... on conflict (member_id, gym_local_date) do nothing returning id`, and calls `private.send_engagement_reminder(member_id)` only if a row was returned, so two overlapping runs, or the same run twice, send at most one per member per gym-local day (NFR-029)
**And** the visit and eligibility checks run again immediately before the claim, so a member who checked in between selection and send is skipped, and no lock a scan takes (the member lock, `record_check_in`'s lock order) is acquired by the job: it reads `attendance_counted` and the state view only
**And** the member's claim, history row (`public.notifications` type `N-08`), push request and delivery rows are one transaction per member (the existing N-06/N-07 shape), so a failure for one member rolls back only that member (their claim included, so the next tick retries) and does not stop the batch; a failure is counted into the `job_runs` row
**And** a dispatch row that exists with no delivery rows is never re-sent that day (at most once beats at least once for a reminder), and a failed push for a claimed dispatch is retried by `process_notification_deliveries()`, not by re-claiming
**And** a member with no registered push token still gets a claimed dispatch with status `no_tokens` and a history row, exactly as N-07

**Given** the sender
**When** it builds the message
**Then** the title and body come from the weekly copy `n08.weekly.title` ("Your week is in reach" / "Votre semaine est à portée") and `n08.weekly.body` with `{n}` = the visits still needed (1 or more, plural-aware: "1 visit" / "2 visits"; "encore 1 visite" / "encore 2 visites"), in the member's language (`users.preferred_language`, fr else en); the push title is that string and never the gym name; the push payload carries `notificationCode: 'N-08'` and no deep link, so tapping it opens the app on Home as any push does today, and no response handler is added `[UX: N-08 push opens Home, not the calendar]`
**And** wording is not a fixed string inside screens (FR-232): the strings are read by key from the same wording store the engagement copy uses; if Epic 30 delivered only the device i18n catalog and there is no server-readable store (the N-07 reminder text is hard-coded in `send_class_reminder`, 0059:115-121, although AD-60 says "the same copy store"), the function holds the two languages inline like N-07 and a pgTAP test pins each string byte-for-byte to the UX catalog keys `n08.weekly.title` and `n08.weekly.body`, with the choice recorded in this story's Dev Notes
**And** the history row (Home bell and notification history screen) carries the same title and body, and the history screen renders N-08 with a primary-tinted icon

**Given** the member's preference
**When** the member opens Profile (MA-12) Notifications Card
**Then** a "Streak reminder" row (`engage.profile.reminder.label`, bell Icon Chip, helper `engage.profile.reminder.helper` with `{time}` read from the same configuration the job uses, formatted "6 pm" in EN and "18 h" in FR) shows a toggle that is on by default, independent of the quiet-gym and class-reminder toggles, saved immediately on change with an optimistic flip and the existing inline error toast and revert on failure
**And** turning it off sets `streak_reminder_opted_out = true` and the next job tick sends nothing to that member, even if a claim has not yet happened; turning it on again resumes the next qualifying day; the toggle is hidden only if N-08 is not shipped (it is shipped here)

**Given** the existing notification limits
**When** N-06 and N-07 have been sent to the same member on the same day
**Then** N-08 is still sent (N-08 shares no limit with N-06 or N-07), and a sent N-08 does not suppress N-06 or N-07; the N-01 to N-05 mandatory notifications are untouched and cannot be opted out of (FR-076)

**Given** the job and `check_in()`
**When** the reminder job is slow, failing or running
**Then** a check-in (`check_in()`, `staff_check_in`) completes with the same result and without waiting: the job and the check-in share no lock, no table write and no code path (a static test asserts neither `check_in()` nor `record_check_in` references `engagement_reminder_*`, and that the job body does not take the member lock), and a two-session script test holds the job's per-member transaction open while a scan succeeds (NFR-029)
**And** no existing check-in, attendance, session or authorization behaviour changes; the existing check-in pgTAP suite passes without fixture edits

**Given** the tests (`supabase/tests/engagement_reminder.test.sql` and `.negative.test.sql`)
**When** `scripts/ci-local.sh` runs
**Then** pgTAP and job tests prove:
- double run: running the job twice in the same tick, and two ticks in the window, produce exactly one dispatch row, one history row and one push request per qualifying member per gym-local day;
- crash after claim: an error injected after the claim inside the member's transaction leaves no dispatch row and no request (the next tick sends once), and a committed claim with no delivery rows is never re-sent that day;
- DST and timezones: gyms in `Africa/Douala` (UTC+1), `Europe/Paris` across the spring and autumn change days, `America/Sao_Paulo`, `Asia/Kolkata` (UTC+5:30) and `Asia/Kathmandu` (UTC+5:45) are selected only inside their own 18:00 to 21:00 window, exactly once per local day, and a gym just before and just after the window is not selected; the "days left in the week" uses the gym-local weekday, not the UTC weekday, around local midnight;
- opted out: a member with `streak_reminder_opted_out = true` gets nothing;
- expired: a member whose subscription is `expired` gets nothing, while `expiring_soon` and `grace_period` are still reminded;
- already visited today: a member with a visit day today (including one synced offline with today's recorded time) gets nothing, and a member whose only visit today was voided is still reminded;
- condition (b) boundaries: needed equals days left sends (goal 3, 0 visits, Friday; goal 1, Sunday, no visit; goal 3, 2 visits, Sunday), needed less than days left sends nothing (rest day remains), needed greater than days left sends nothing (cannot be met), goal already met sends nothing;
- before `release_week_start` nothing is sent; a suspended gym sends nothing;
- tenant isolation: a member of gym A never receives a reminder built from gym B's data, and `anon`/`authenticated` cannot read or write either new table or call the job function;
- N-06 and N-07 independence, the `notifications.type` CHECK accepting N-08 and still rejecting N-09, and the extended delivery processor polling the new delivery table
**And** the mobile tests cover the toggle states (on by default, off, save failure revert), helper text with the `{time}` token in EN and FR, and `NotificationType` including N-08; EN and FR strings for `engage.profile.reminder.*` and `n08.weekly.*` exist in both catalogs with no missing key

---

### Story 31.3: Badge Shelf and Share Image

As a member,
I want a shelf of the badges I have earned and a button that turns a milestone into a picture I can post,
So that I can be proud of what I have built and show my gym to my friends, without giving anything away about me.

*Delivers FR-230 (Should), FR-231 (Should), FR-232 (badge and share wording), FR-225 (existing history counts silently at release), NFR-028 (badge determinism); spine AD-53 (badge facts, never reversed), AD-60 (the share image has no server side), AD-25; UX gate: MA-21 Badge Shelf, the Share button on MA-20 and on earned badges (badge detail sheet), and the share image spec ("Composition equals the shared image", 1080 by 1920 px) in EXPERIENCE.md; the screen states and copy there are the acceptance baseline. The badge facts reuse Epic 30's `engagement_facts` (kind `badge`); there is no new table. The share image has no server endpoint, table or storage.*

**Acceptance Criteria:**

**Given** the badge set
**When** the migration ships
**Then** the V1.8 badges are five codes stored as `badge` facts with `subject_key` in `first_visit`, `visits_7`, `visits_30`, `visits_100`, `four_weeks` (FR-230 `[ASSUMPTION]`: the set beyond 7, 30 and 100 is a proposal confirmed in OQ-35), each carrying `earned_on` (date) and `silent` (boolean) in its payload, with one effective row per `(member_id, subject_key)` and revision 1 only (a badge is never revised, reversed or deleted)
**And** a badge is earned once and never lost: a void (`void_staff_check_in`), a late-visit correction or a rebuild that lowers the visit-day count below a threshold leaves the badge row and its `earned_on` unchanged, and a later visit that reaches the threshold again inserts nothing (pgTAP)
**And** a badge grants nothing: no function in this story writes the loyalty ledger, `guest_sessions`, a Shield, a stamp or any plan or discount value, proven by identical row counts in those tables before and after earning all five badges

**Given** a member's total visit days and the fold
**When** the award step Epic 30 runs from settle's tail (`private.award_milestones(member_id)` on first open and from the cron settle, never inline in the scan transaction) is extended
**Then** it writes `first_visit` at the 1st visit day, `visits_7` at the 7th, `visits_30` at the 30th, `visits_100` at the 100th (counted from `member_visit_days`, one per visit day over the member's time at that gym), with `earned_on` the gym-local date of the n-th visit day, and `four_weeks` the first time the fold reports a Shield earned (31.1), with `earned_on` the last day of the week that earned it ("4 weeks in a row" is the week a Shield is earned, FR-230)
**And** the award is idempotent and runs under the member lock: awarding twice, or racing settle and first-open, inserts each badge once (unique key), and a visit that arrives late through offline sync (FR-061) awards the badge on the next settle with `earned_on` the n-th visit day's true date
**And** earning `visits_7`, `visits_30` or `visits_100` is the same award as the milestone of Epic 30 and never produces a second celebration; `first_visit` and `four_weeks` produce no celebration screen (FR-229 celebrates only 7, 30 and 100)

**Given** members with history before release (FR-225 `[ASSUMPTION]`)
**When** the migration runs on production data
**Then** every existing member who already passed 1, 7, 30 or 100 visit days gets those badges written with `silent = true` and `earned_on` the real date of that visit day from stored `visit_day` (a timezone change does not move it), no `acknowledged_at` celebration is created, and no `four_weeks` badge is back-filled because weeks before `release_week_start` are never settled
**And** the back-fill is idempotent (running it twice inserts nothing), runs per gym without a long lock on `attendance_events` (batched, per-member short transactions), and the pgTAP test seeds members at 0, 1, 6, 7, 29, 30, 99, 100 and 250 visit days and asserts the exact badge sets

**Given** a member
**When** the member app opens the shelf
**Then** `get_my_badges()` (a member-owned SECURITY DEFINER read; EXECUTE revoked from `public` and `anon`, granted to `authenticated`; it resolves the caller's own live member row and returns an empty set for a deactivated, support or unauthorised caller; it never mutates, so a plain read never awards, AD-53) returns exactly five rows in shelf order with `code`, `earned` (boolean), `earned_on`, `silent`, and for unearned badges the progress needed by the tile: `visits_remaining` for the three visit badges (threshold minus total visit days, never negative), nothing for `first_visit`, and `weeks_progress` (0 to 3, the current run's met weeks, 0 meaning no run started) for `four_weeks`
**And** a pgTAP test proves the function returns only the caller's own rows (member A never sees member B's earned dates, nor another gym's), returns a stable shape for a member with no visit (five unearned rows, never empty), and that staff roles get no extra reach

**Given** the Badge Shelf screen MA-21
**When** the member opens `/badges` from the MA-12 Profile "Badges" row (value `engage.profile.badges.value`, "2 of 5") or from MA-20 [See your badges] (which acknowledges the milestone and replaces the route so Back returns to Home)
**Then** the screen shows the header and `engage.badges.title`, the summary `engage.badges.summary` ("2 of 5 earned"), a two-column grid of five tiles in the order First visit, 7, 30, 100, 4 weeks (glyphs per UX), and the footnote `engage.badges.grantsNothing`; the 4-weeks tile is shown because Shields ship in 31.1
**And** the tile states render as the UX table names them: Earned (accent Icon Chip, check corner, "Earned 14 Oct" `engage.badges.earnedOn`); Earned silently at release (identical, the real historic date); Locked in reach (outline, neutral glyph, no lock icon, "12 more visits to go" `engage.badges.locked.visits`, `engage.badges.locked.first`, "2 of 4 weeks" `engage.badges.locked.weeksProgress`); Locked with no 4-week streak started (`engage.badges.locked.weeks`); a tile never shows "locked" as its only text and never "0 of N" as a failure
**And** tapping an earned tile opens the badge detail bottom sheet (large chip, name, date, [Share]); tapping a locked tile opens the same sheet without Share, showing the progress line; pull to refresh reloads; loading shows 5 tile skeletons; a failed load shows the `engage.badges.error` card; offline shows the cached tiles (cached on the device after the last load) and Share still works; a new member sees five locked tiles with progress lines, never an empty screen
**And** all strings `engage.badges.*` exist in EN and FR with no missing key (`scripts/check-i18n-key-parity.mjs` passes), and the tiles meet the accessibility floor (tile accessible label states name, earned or not, and date or progress)

**Given** the share library decision (made in this story, binding nothing before it is verified)
**When** the developer starts the story
**Then** they verify on the web, on the day of the work, the current published version of each candidate, its changelog, its maintenance status and its compatibility with the app's Expo SDK 57 (react-native 0.86, `expo` ~57.0.20 in `apps/mobile/package.json`) before adding any dependency; the default plan, pre-checked at planning time on 2026-11-15, is `react-native-view-shot` pinned to the version Expo SDK 57 bundles (5.1.0 in `expo/bundledNativeModules.json`; npm latest at that date 6.2.1, recommended for SDK 58 only) to capture an off-screen React view, plus `expo-sharing` at the SDK 57 version (~57.0.18) to open the OS share sheet with `shareAsync` and to test `isAvailableAsync()`; `expo-file-system` (~57.0.6) and `react-native-svg` (15.15.4, `toDataURL`) are already installed and are the fallback capture route if view-shot cannot meet the 1080 by 1920 requirement or a verified incompatibility appears; the installed version is the one `npx expo install` selects for SDK 57, never a floating range
**And** the choice, the exact versions, the evidence (source URLs, dates, what was checked) and the rejected options (a canvas or Skia drawing library: heavy and not already a dependency; a server-rendered image: forbidden by AD-60; React Native's built-in `Share`: cannot share an image file on Android) are written as one dated entry at the top of `docs/decisions.md` (newest first), and the `ARCHITECTURE-SPINE.md` Deferred bullet that says the library is "chosen at story time" is updated to point to it
**And** the entry records that both candidates add native code, so the feature ships only in a new EAS store build (the app uses no over-the-air update channel today), and that an older installed build must not receive a bundle that imports a missing native module; the story states the build order for the product owner (build first, then it is safe to release) and does not run the build itself

**Given** the Share button on MA-20 and on the badge detail sheet
**When** the member taps [Share]
**Then** the button shows its spinner and stays disabled with its label unchanged (no width change), the app renders the image on the device from local data only, writes it to the app's cache directory as a PNG of exactly 1080 by 1920 px (the portrait ratio of a WhatsApp status) on the same dark background as the card, and calls the OS share sheet with that file (`mimeType image/png`, `UTI public.png`, `dialogTitle` from the catalog); on iPad the sheet is anchored to the button
**And** the milestone composition carries: gym logo (omitted without error if not cached or not loadable) and gym name, the milestone numeral and headline, the optional mini month calendar of the member's current month with lit days only (shown when the card has room, as MA-20 specifies: height at least 640pt, never at +2 text sizes) and the caption `engage.share.caption.7`, `.30`, `.100` with `{gym}`; the badge composition carries the badge name and glyph, the date earned, the gym name and logo, the calendar where it fits and `engage.share.caption.badge`; the image equals what the member sees on the card ("composition equals the shared image")
**And** the image contains no member name, no phone number, no payment figure, no other member's data and no GymOS watermark (owner decision 2026-11-15); a component test renders the composition for a member named "Aïcha Test" with a phone number, a plan price and a loyalty reward in state, serialises the tree and asserts none of those strings appear, and that the composition's props type has no field for them (a type-level test), and that nothing but the gym's name and logo, the milestone or badge, the date and the member's own lit days enter the composition
**And** the share caption is in the member's app language (EN and FR keys both exist), and nothing is sent to any GymOS service: a test asserts that tapping Share makes no network call to Supabase or any other host (the existing client mock records zero calls), and no table, endpoint, storage bucket or analytics event records what was shared (FR-231: GymOS stores nothing about what was shared)

**Given** the share result handling (UX Share flow, step 4)
**When** the flow ends or fails
**Then** the share sheet closed with no target chosen: nothing happens, no message, the screen stays; shared: nothing happens, no toast (the OS shows its own)
**And** image could not be made (the capture throws, out of memory, the cache file cannot be written, or a storage or file permission error): the inline message `engage.share.error` shows above the buttons with [Try again] (`engage.share.retry`), the button returns to its normal state and the screen otherwise works
**And** the OS reports that the share sheet cannot be opened, or `isAvailableAsync()` is false: the inline message `engage.share.unavailable` shows and the Share button is hidden on the next view of the screen
**And** permission-denied: the flow never asks for a photo-library or storage permission, because the image is written only to the app's own cache directory and handed to the share sheet (no save-to-gallery action is offered); if the platform nevertheless refuses the file hand-off, it is shown as `engage.share.error` (retry), not as a permission prompt, and a test asserts the permission request APIs are never called
**And** the temporary image file is deleted after the share sheet closes and on failure, and any older leftover file in the cache directory is removed at the next share, so no image of the member persists on the device
**And** offline: building and sharing the image works without network (a test runs the flow with the network mock failing)

**Given** the existing celebration screen (MA-20, Epic 30)
**When** this story adds Share
**Then** MA-20 gains [Share] as the primary button with [Keep going] secondary and the [See your badges] text link, exactly as the UX layout orders them, and the screen without Share (Epic 30) is unchanged in behaviour for acknowledge, reduced motion, offline and "already acknowledged" handling; the existing Epic 30 celebration tests pass without edits except the button-order assertions this story names

**Given** the determinism and gate requirements
**When** `scripts/ci-local.sh` runs
**Then** the NFR-028 rebuild equivalence test is extended so that `rebuild_engagement` returns the badge set and the live fold equals it, including the silent release back-fill, a late offline visit that earns a badge, and a void that does not remove one (a stored `earned_on` wins over a recomputed one after a void, and the test says so)
**And** the existing pgTAP suite passes without fixture edits except the Epic 30 award-step tests this story extends; `check_in()` and `record_check_in` are not edited; no new table is created, no endpoint or edge function is added, and no new `private.support_capabilities` entry is made (`support_capabilities.test.sql` unchanged)
**And** the mobile component tests cover the shelf in every tile state in EN and FR, the badge detail sheet with and without Share, the Share flow's every result state above with the library mocked at its module boundary, and the composition's privacy assertions; the on-device behaviour of the real library (that the PNG really is 1080 by 1920 and opens WhatsApp) is checked by the product owner on a device build, which is the one thing automated tests here cannot show, and the story's Dev Notes list the exact steps for that check

---

### Deferred (no stories in V1.8)

The Could items of this epic are **not** built in this release. PRD 10.3 item 8 and the Release Definition say Could items ship "only if ready" and "their absence never holds the release", and epics.md decision 3 (2026-11-15) makes Epic 31 the cut line. They are recorded here so a later release can take them without redesign.

| Requirement | Why deferred | What a later story reuses |
|---|---|---|
| FR-221 Daily streak (Could) | Not required to ship; the weekly streak stays the main streak. Its absence leaves FR-233 condition (a) and the Shield "day" path inactive, which stories 31.1 and 31.2 state. | The `day_shield` fact kind, the "last Shield is reserved for the weekly streak" rule and its rolled-back activation test (31.1), `private.engagement_daily_streak_enabled()`, `engagement_state_view`'s daily run and the `n08.daily.*` and `engage.atRisk.daily` keys already in the UX catalog, MA-09's compact daily chip, and the reminder's single extra flag (31.2). |
| FR-234 Gym-wide monthly challenge (Could) | Needs a Settings screen, a setter pair and a Home card; not needed for the gate. | Spine AD-61 `gym_challenges (gym_id, month, target, reward text, cancelled_at)` with its two audited setters (Owner and Supervisor, support-registered, AD-32 pin pattern, `support_capabilities.test.sql` pinned counts), `gym_challenge_progress()` counting distinct `(member, visit_day)` pairs from `attendance_counted` with counts only, the UX Home challenge card and the Settings challenge form with its `engage.challenge.*` keys. Open points from the adversarial review L-03 (create on a cancelled not-yet-started month, gym-local "month has started", excluded support-proxy rows) are carried to that story. |
| FR-235 "Your month" summary (Could) | Pure summary, no gate. | UX MA-22 Your Month (`/month/:yyyy-mm`) and its Home "N5" card with `engage.month.*` keys, and `member_visit_days` and `private.gym_local_month_bounds` for the month's visit days, best week and change from the month before. |

---

#### Notes for the epic owner (assumptions and open points carried by these stories)

- Spine AD-60 names `private.engagement_state` as the source of the at-risk flags; the spine's AD-53 and the story brief name `private.engagement_state_view(member_id)` for that and `engagement_state` for the watermark table. These stories use `engagement_state_view`.
- AD-60 says N-08 wording comes "from the same copy store as N-06 and N-07", but no such store exists: the N-07 text is inline in `private.send_class_reminder` (0059:115-121). Story 31.2 resolves it by reading Epic 30's wording store if it is server-readable, else inline with a byte-for-byte test (see the AC).
- Added assumptions (all tagged in the ACs): a met week while a comeback is open closes it (31.1); the 18:00 to 21:00 catch-up window and the no-send-before-epoch rule (31.2); a held Shield does not suppress the reminder (31.2); the badge `earned_on` is stored and immutable (31.3).
- Product risk noted, not changed: FR-233 condition (b) as written reminds every opted-in member, including one with no streak, on the day a goal becomes only just reachable (for example a goal of 3 and no visit by Friday). The PRD's own metric (reminder opt-out rate, PRD section 3) is what judges it after release.
