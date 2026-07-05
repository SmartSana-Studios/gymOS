---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-gym_os-2026-06-20/prd.md
  - _bmad-output/planning-artifacts/prds/prd-gym_os-2026-06-20/addendum.md
  - _bmad-output/planning-artifacts/architecture.md
  - _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/DESIGN.md
  - _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md
---

# gym_os - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for gym_os (GymOS), decomposing the requirements from the PRD, UX Design, and Architecture into implementable stories.

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
