---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-gym_os-2026-06-20/prd.md
  - _bmad-output/planning-artifacts/prds/prd-gym_os-2026-06-20/addendum.md
  - _bmad-output/planning-artifacts/architecture.md
  - _bmad-output/planning-artifacts/architecture/architecture-gym_os-2026-08-11/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/DESIGN.md
  - _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md
  - _bmad-output/planning-artifacts/sprint-change-proposal-2026-08-11.md
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

### UX Design Requirements

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
