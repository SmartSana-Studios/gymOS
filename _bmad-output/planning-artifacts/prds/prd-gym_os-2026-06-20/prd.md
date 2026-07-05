---
title: GymOS — Product Requirements Document
status: final
created: 2026-06-20
updated: 2026-06-20
version: "0.4"
updated: 2026-06-21
audience: Development Team
scope: V1.0
---

# GymOS — Product Requirements Document

## 1. Overview

GymOS is a white-label gym management SaaS built for African fitness businesses. It replaces the fragmented stack of paper records, WhatsApp groups, and spreadsheets most gym owners rely on today with an integrated platform: a branded member mobile app (Android and iOS), a gym admin dashboard, a coach portal, and a Super Admin layer for the platform owner.

The product is organized around a single thesis: **retention**. Features map to three loops that build on each other across versions:

| Loop | Question it answers | V1 features |
|------|---------------------|-------------|
| **Keep members coming** | Why open the app between visits? | QR check-in, subscription status, coach session notes |
| **Catch members leaving** | How do we intervene before they churn? | Renewal alerts, grace periods, front-desk alert at check-in |
| **Monetize the audience** | What revenue exists beyond SaaS fees? | Gym merch store (V2.5), platform marketplace (V3) |

V1 builds loops 1 and 2. Loop 3 requires the member base and trust that loops 1 and 2 create. The signature V1 interaction is a real-time front-desk alert the instant an expiring member checks in, putting renewal collection at the point of maximum willingness to pay.

V1 targets Cameroon-first gyms with mobile-money payments (MTN MoMo + Orange Money), an Android-first member base, and 1–3 founder-onboarded pilot gyms. Target: a live pilot with real members and real payments in 3–4 months, built by a 1–2 person full-stack team.

---

## 2. Problem

Gym owners in Cameroon and across Africa manage operations with tools never designed for the job:

- **Paper records and WhatsApp** for member tracking — no audit trail, no history, no alerts
- **Spreadsheets** for payments — cash and mobile-money transactions go unreconciled; revenue disappears silently
- **Manual attendance** — no reliable check-in system; occupancy is guesswork
- **Missed renewals** — expiring memberships lapse quietly with no trigger to intervene
- **No coach tools** — coaches manage assigned members through personal messages and memory

The cost is twofold: operational chaos for the gym owner, and invisible churn that compounds month over month.

---

## 3. Goals & Success Metrics

### 3.1 Goals

| # | Goal |
|---|------|
| G-1 | Deliver a live pilot with real members and real payments within 3–4 months |
| G-2 | Make every franc auditable — no silent payment failures, all manual actions traceable |
| G-3 | Land the retention moment — front-desk alert catches expiring members at check-in |
| G-4 | Prove the multi-tenant foundation — RLS and schema hold as new gyms are added |
| G-5 | Ship to both Android and iOS from a single codebase |
| G-6 | Launch fully bilingual (English + French) with zero missing-string errors |

### 3.2 Success Metrics

| Metric | Target | Counter-Metric |
|--------|--------|----------------|
| Pilot live date | Within 3–4 months of dev start | Scope expansion pushing timeline — tracked via sprint velocity |
| Front-desk alert reliability | ≥ 95% of expiring/expired check-ins trigger an alert | Alert-to-renewal-action conversion — if alerts fire but aren't actioned, they become noise |
| Payment reconciliation accuracy | Zero undetected discrepancies in first 30 pilot days | Mandatory-reason field abandonment — if receptionists skip payments to avoid friction |
| Cross-tenant data isolation | Zero cross-tenant leaks in CI and pilot operation | Over-restrictive RLS — access-denied errors per role tracked in Sentry |
| Localization completeness | Zero missing-string errors in EN and FR across all flows | Translation divergence — EN and FR string counts must stay in sync on every PR |

> **V1.5 metric target (to be formalized at V1.5 planning):** Quiet-gym alerts and progress tracking drive a measurable increase in member app opens on non-visit days. Baseline established from V1 pilot data before V1.5 launches.

---

## 4. Users & Roles

### 4.1 Role Hierarchy

Roles are scoped per gym except Super Admin, which is platform-wide.

```
Super Admin  (platform-wide; GymOS staff only)
  └─ Owner       (full gym access + settings)
       └─ Manager     (operations; no settings)
            └─ Receptionist  (front desk; payments; check-in)
                 └─ Coach         (assigned members + session notes only)
                      └─ Member       (own data only)
```

Role enforcement is at the PostgreSQL RLS layer. Client-side role checks are supplementary only. When RLS rejects a request the client thought was allowed, the UI shows "You don't have permission to do that" and logs the denial to Sentry with the user's role, action, and resource — no raw database errors reach the user.

### 4.2 User Profiles

**Gym Owner / Manager**
Replace paper, WhatsApp, and Excel. See every franc reconciled, every member's status, and every expiring membership — and catch those members at the door before they quietly disappear.

**Receptionist**
Front-desk operator. Processes payments, confirms check-ins, acts on renewal alerts.

**Member**
One branded app for gym life: subscription status, QR check-in, payment history, profile, language preference.

**Coach**
Manages assigned members and session notes from a role-gated view inside the dashboard. Sees member goals and experience levels set during onboarding. Workout plans and class scheduling are deferred to V1.5.

**GymOS Platform Owner (Super Admin)**
Full visibility across all tenant gyms: gym status, platform-wide metrics. Creates and manages gym accounts in the founder-onboarding flow.

---

## 5. User Journeys

### UJ-1: Kwame's first check-in

Kwame, a 28-year-old office worker in Yaoundé, joined a new gym last week. The receptionist added his record and tapped "Send invite" — Kwame got an SMS with his name, the gym name, and a link. He tapped it, the Play Store opened, he downloaded the app.

He opens it for the first time. He picks his language (French), enters his phone number, and waits for the OTP. It arrives in 12 seconds. He verifies, sets his name, picks his goal (Build Muscle), sets his experience (Beginner), and confirms his Monthly plan. The app loads in the gym's colors with their logo in the header.

At the gym entrance, he taps Check In, points his camera at the QR code on the wall, and sees a green confirmation within 2 seconds. His name appears in the Attendance panel on the receptionist's dashboard. No paperwork, no sign-in sheet.

### UJ-2a: The renewal moment — grace period

Amara's monthly plan expired yesterday. She didn't notice. This morning she walks into the gym, opens the app, and scans the entrance QR. The scan succeeds — she's in the 3-day grace period — and her check-in is recorded. But the instant the check-in lands, a yellow banner fires on every open dashboard tab: **"Amara K. — Grace period. Expires [date]. Renew now?"**

The receptionist sees the alert, greets Amara by name, and taps "Renew". An inline panel opens — pre-populated with Amara's current Monthly plan and the renewal price. The receptionist selects Cash, types "Paid at desk", taps Confirm Renewal. The alert clears. Amara's status resets to Active. She gets a push notification: "Payment confirmed — your membership is active." Total time: 45 seconds. Amara has no idea anything was wrong.

### UJ-2b: The expired member at the door

Amara comes back three weeks later, never renewed. Her grace period ended two weeks ago. She opens the app, taps Check In, scans the QR. The app shows a red screen: **"Access denied — membership expired. Please see the front desk."** Her check-in is rejected. But the dashboard fires a red alert: **"Amara K. — Access DENIED. Membership expired [N] days ago. Collect payment to restore access."** The receptionist catches her before she walks away.

### UJ-3: Nadia reconciles end-of-day payments

Nadia manages a gym in Douala. At 7 PM she opens the Payments page. Three cash payments are sitting in the verification queue — each shows the member, amount, the receptionist who recorded it, and the mandatory note ("Paid at desk, member confirmed"). She cross-checks against her cash drawer and marks all three verified.

She runs a quick mental check against the day's check-ins on the Attendance page — everyone who trained today has a matching payment. She closes the laptop knowing nothing is unreconciled.

### UJ-4: Fatima manages her clients

Fatima is a personal trainer at the Douala gym. The gym Owner assigned her 8 clients last week. She logs into the dashboard and sees only the Coach Portal — no payments, no member list, no settings.

She opens a client's profile: sees his goal (Lose Weight), experience level (Beginner), current plan (Coach-inclusive), and subscription status (Active — expires in 12 days). She adds a session note: "Focused on compound lifts. Struggled with form on deadlift. Next session: start with lighter weight and focus on hip hinge." The note saves with her name and the timestamp.

She checks her next client. His status shows "Expiring Soon." Fatima can't process a renewal — that's the receptionist's job — but she makes a mental note to mention it when he comes in tomorrow.

### UJ-5: Chidi onboards a new gym

Chidi works at GymOS HQ. A new gym in Yaoundé has signed up. He opens the Super Admin dashboard, clicks "Create Gym", fills in the gym name, owner's name, and phone number, and clicks Create. The system creates the gym record and sends the owner an SMS with their login credentials.

Chidi sets the gym's subscription to Active. The gym now appears in the gym list. He hands off to the owner, who logs into the dashboard and goes through Settings to upload their logo and set their primary color. Their members haven't been imported yet — the owner will use the CSV import tool tomorrow with GymOS's help.

---

## 6. Functional Requirements

> Stable IDs: FR-NNN. Do not renumber. New requirements append to the end of their section with the next available global number.

### 6.1 Platform Foundation

**FR-001** — Phone number is the primary identity. One phone number maps to one platform user account. A user may be a member at multiple gyms; each gym relationship is a separate `members` row linked to the same user account.

**FR-002** — Registration requires phone verification via OTP. No email-based registration in V1.

**FR-003** — The platform enforces a role hierarchy per gym: Member → Coach → Receptionist → Manager → Owner → Super Admin. Roles are enforced via PostgreSQL RLS policies. Custom role claims (`gym_id`, `role`) are injected into the Supabase JWT via a Database auth hook on login. This hook is a sprint-1 spike item — missing claims fail silently by defaulting to deny-all. When RLS rejects a request, the client shows "You don't have permission to do that" and logs the event to Sentry; no raw PostgreSQL errors reach the UI.

**FR-004** — Super Admin is a platform-level role, not scoped to any gym. Super Admin can act across all tenants.

**FR-005** — Each gym is a fully isolated tenant. A user in Gym A cannot read, write, or infer any data from Gym B. RLS enforces this at the database layer on every query.

**FR-006** — The data model is designed to support hundreds of gyms and thousands of members per gym without schema changes. The 1–3 pilot gym scale is an operational expectation, not an architectural ceiling.

---

### 6.2 Gym Setup & Onboarding

**FR-007** — V1 gym onboarding is founder-assisted. There is no self-serve gym signup flow. GymOS staff create the gym record and owner account in the Super Admin dashboard.

**FR-008** — The gym admin dashboard includes a CSV import tool. GymOS provides a standardized CSV template with the following columns:

| Column | Format | Required |
|--------|--------|----------|
| member_name | Text | Yes |
| phone | E.164 format (e.g. +237XXXXXXXXX) | Yes |
| plan_type | Must match a plan configured for this gym | Yes |
| join_date | YYYY-MM-DD | Yes |
| subscription_status | active / expiring_soon / grace_period / expired | Yes |
| expiry_date | YYYY-MM-DD; blank for pay-per-session | Conditional |

The import is **all-or-nothing**: all rows are validated before any records are inserted. If any row fails validation, the entire import is rejected and no data is written. Validation errors are displayed per row with the row number and failure reason. Members imported without an expiry date for a non-session plan are rejected at validation — expiry date is required for all non-pay-per-session plans.

**FR-009** — Historical payment and attendance records are not migrated. Imported members start with a clean history on the platform from the date of import.

**FR-010** — During onboarding, the gym configures: gym name, logo, primary color, timezone (default: Africa/Douala, GMT+1), preferred language (English or French), grace period duration, and gym capacity.

---

### 6.3 White-Label Branding

**FR-011** — One app binary serves all gyms. The binary is published under the GymOS account — the app appears as "GymOS" in the device's app drawer and Play Store / App Store listing in V1. Gym-specific branding (gym name, logo, primary color) is applied within the app after launch, not at the OS or store level. Per-gym App Store listings are deferred to V4+. Branding data is cached on-device for 24 hours; gym logo or color updates propagate on the member's next app launch after the cache expires.

**FR-012** — The gym admin dashboard Settings page allows the gym Owner to: upload a logo (stored in Supabase Storage, served from CDN), enter a gym name displayed in the app header, and set a primary hex color applied to buttons, accents, and navigation highlights. Changes take effect in the member app within 24 hours (next branding cache refresh).

**FR-013** — Per-gym App Store listings, custom fonts, and full theme systems are out of V1 scope (deferred to V4+).

---

### 6.4 Localization

**FR-014** — The platform is bilingual in English and French from V1. All UI strings, push notification copy, onboarding flows, and error messages are available in both languages.

**FR-015** — Language is selected by the member at the start of the onboarding flow (before phone number entry), defaulting to device locale. Language is also user-selectable from the member profile screen at any time. Language preference is stored per user account and persists across devices.

**FR-016** — All string literals are externalized via an i18n library. No hardcoded UI text anywhere in the codebase. CI enforces this — PRs with hardcoded strings fail the build.

**FR-017** — Receipts and payment confirmation documents follow the gym Owner's language preference.

**FR-018** — The i18n foundation is structured to support additional languages in future versions without rework.

---

### 6.5 Member Management

**FR-019** — A Manager or Owner can create, view, edit, and deactivate member records. Soft-delete only — records are deactivated, never deleted, to preserve audit history.

**FR-020** — Member records store: full name, phone number, email (optional), date of birth (optional), profile photo (optional), join date, current plan, subscription status, and emergency contact (optional).

**FR-021** — A Receptionist can view and search member records and initiate payments for a member, but cannot create, edit, or deactivate member records.

**FR-022** — Coaches can view profiles of their assigned members only. Coaches cannot see or access members not assigned to them.

**FR-023** — Members can view and edit their own profile (name, photo, language preference) from the app. Changing a phone number requires admin intervention.

**FR-082** — When a Manager or Owner creates a new member record in the dashboard, the system generates a personalized onboarding invitation. The invitation contains the member's name, the gym name, and a deep link to the GymOS app (a custom URL scheme that opens the app or falls back to the Play Store / App Store). The gym admin copies or sends this message — via SMS or WhatsApp — directly from the dashboard. The deep link pre-associates the member's phone number, so the OTP screen is the first thing they see in the app.

**FR-083** — When a Manager or Owner deactivates a member: (a) the member's subscription is set to `expired` immediately; (b) the member loses check-in access; (c) the member retains app access to view their history; (d) no automated push notification is sent for deactivation — the gym handles communication. The deactivation is audit-logged with actor, reason (mandatory), and timestamp.

---

### 6.6 Membership Plans

**FR-024** — The platform supports the following plan types in V1:

| Plan Type | Description |
|-----------|-------------|
| Pay-per-session | Member pays per visit; no fixed expiry |
| Monthly | Fixed-fee plan with a defined expiry date |
| Coach-inclusive | Monthly plan that includes scheduled sessions with an assigned coach |
| Class-only | Access to scheduled classes only; no general floor access |

Travel mode is deferred to V2.0 (see Section 8).

**FR-025** — Plan definitions (name, price in XAF, duration, access type) are configurable per gym by the Owner or Manager. The plan types above are templates; gyms set their own pricing and durations. The platform supports **monthly and annual billing intervals** for recurring plans from V1; annual plans carry a gym-set discount to incentivize commitment. Billing interval is stored on the subscription record independently of tier names or price points (OQ-1 does not block billing interval implementation).

**FR-026** — All monetary values are stored as integers (whole XAF francs) with an explicit `currency` column alongside the amount. No floating-point monetary storage anywhere. V1 currency is XAF only; the schema is multi-currency-ready from day one.

---

### 6.7 Subscription Lifecycle

**FR-027** — A member subscription moves through the following states in sequence:

```
active → expiring_soon → grace_period → expired
```

State transitions are executed by a **Supabase pg_cron job** scheduled to run nightly at 02:00 Africa/Douala time. If the job fails (timeout or infrastructure error), the failure is logged to the audit log and surfaced as an alert on the Super Admin dashboard. The job does not retry automatically — a missed run is corrected on the next successful execution; statuses are not retroactively backfilled.

**FR-028** — `expiring_soon` is triggered 7 days before the expiry date.

**FR-029** — `grace_period` begins the day after the expiry date. Duration is set per gym in Settings. Platform default is 3 days if a gym has not configured its own value.

**FR-030** — `expired` is set when the grace period ends without a renewal. An expired member loses gym access but retains their app account and membership history.

**FR-031** — Two distinct check-in outcomes exist for non-active members:

| Member State | Check-in Outcome | Member App Shows | Dashboard Alert |
|---|---|---|---|
| `expiring_soon` or `grace_period` | Accepted — check-in recorded | Green confirmation (normal flow) | Yellow alert: "Amara K. — Grace period. Expires [date]. Renew now?" |
| `expired` (beyond grace period) | Rejected — check-in blocked | Red screen: "Access denied — membership expired. Please see the front desk." | Red alert: "Amara K. — Access DENIED. Expired [N] days ago." |

The front-desk alert fires in both cases. The alert color and copy differ to signal urgency to the receptionist.

**FR-032** — Renewal resets the subscription to `active` and sets a new expiry date based on plan duration. Renewal can be triggered by a successful payment or a manual admin override. On renewal: (a) the front-desk alert for that member dismisses immediately; (b) the member receives push notification N-04 (Payment confirmed); (c) the renewal appears in the member's payment history immediately.

---

### 6.8 Payments

**FR-033** — Supported payment methods in V1:

| Method | Type | Notes |
|--------|------|-------|
| MTN Mobile Money | Automated | Via Notch Pay |
| Orange Money | Automated | Via Notch Pay |
| Cash | Manual | Recorded by Receptionist or Manager; mandatory reason |
| Bank transfer | Manual | Recorded by Manager or Owner; mandatory reason |
| Manual mobile money | Manual | For cases where the payment gateway is unavailable |

**FR-034** — V1 ships with **Notch Pay as the sole mobile-money aggregator**. The payment integration is built behind an internal `PaymentProvider` interface from day one so a second provider can be added later without touching the payment logic. Campay integration is deferred to V2. Integration is gated by a one-day sandbox spike that must be completed before the payments Epic begins; its outcome must be recorded in `docs/decisions.md`. Spike exit criteria: sandbox auth succeeds, payment initiation returns a reference, webhook is received and processed, idempotency test passes (duplicate webhook does not create a duplicate record). **If the spike fails**, no payment code ships until an alternative integration is validated and documented — the payments Epic does not begin on an unverified provider.

**FR-035** — Payment webhooks from the provider are processed idempotently. Duplicate webhook delivery does not create duplicate payment records. Idempotency is enforced via a unique constraint on the provider transaction reference.

**FR-036** — A scheduled reconciliation job runs nightly (same pg_cron window as lifecycle transitions) to match provider-confirmed payments against internal records. A **discrepancy** is any of: (a) a webhook event received from Notch Pay with no matching internal payment record; (b) an internal payment record in `processing` status with no webhook received within 10 minutes of creation; or (c) an amount mismatch between the webhook payload and the internal record. Discrepancies appear as flagged rows on the Payments dashboard page.

**FR-037** — The Payments page includes a verification queue for manual payments awaiting confirmation. A Receptionist or Manager can mark a queued payment as verified or flag it for review.

**FR-038** — All manual payment entries require the following fields — none are optional at the UI level:

- Payment method
- Amount
- Member
- Actor (auto-populated from logged-in user)
- Mandatory reason / note
- Timestamp (auto-populated)

**FR-039** — Transaction fees from Notch Pay are passed through to gyms by default. The platform does not absorb provider fees. A member-pays-surcharge option is deferred.

**FR-040** — Refunds are recorded in the system in V1 (amount, reason, actor, timestamp). Provider-executed refund API calls are deferred. If a member disputes a payment, a Manager or Owner records a manual refund entry with a mandatory reason; the gym pays the member out-of-band. The refund record is audit-logged.

**FR-041** — The system generates a payment receipt for each successful payment. Receipt fields: member name, gym name, plan, amount, currency, payment method, date, transaction reference, actor.

---

### 6.9 Attendance & Occupancy

**FR-042** — Members check in by opening the member app, navigating to the Check-In screen, and scanning a static QR code displayed at the gym entrance. A successful scan records an attendance event (member, gym, timestamp).

**FR-043** — The gym entrance QR code encodes a URL with a `gym_token` query parameter — a non-guessable UUID generated per gym at setup. The app decodes the QR, extracts the token, and sends it to the check-in endpoint. The endpoint validates the token against the `gyms` table to identify the gym before recording the check-in. If the token does not match any gym, the app shows: "QR code not recognized — make sure you're scanning your gym's code." A member scanning the wrong gym's QR cannot accidentally check in there — the token resolves to no gym and the request is rejected. The gym's QR code is downloadable and printable from the Settings page.

**FR-044** — Only one open check-in per member is permitted at a time. A second scan while a check-in is already open is rejected with: "You're already checked in." Enforced via a partial unique index on the attendance table (`WHERE checked_out_at IS NULL`). **Edge case:** if a member scans but has a stale open check-in from a previous session (app crash before checkout, or the auto-timeout job did not run), the system auto-closes the stale check-in (sets `checked_out_at` to `original_check_in_time + timeout_duration`), records the new check-in, and logs the auto-close to the audit log.

**FR-045** — Check-out can be triggered manually (member from the app, or receptionist from the dashboard) or automatically via a configurable auto-timeout (default: 8 hours; configurable per gym in Settings). The auto-timeout is executed by the same pg_cron job as subscription lifecycle transitions. If the job runs late, open sessions are closed on the next successful run.

**FR-046** — Occupancy is calculated as the number of currently checked-in members as a percentage of the gym's configured capacity.

**FR-047** — The member-facing occupancy display uses three bands:

| Band | Threshold |
|------|-----------|
| Low | < 30% of capacity |
| Medium | 30–70% of capacity |
| Busy | 71–90% of capacity |

The 91%+ "Full" threshold and raw occupancy counts are visible on the admin dashboard only, never in the member app.

**FR-048** — The admin dashboard Attendance page shows: currently checked-in members, today's attendance count, and a check-in/check-out log filterable by date and member.

---

### 6.10 Retention Triggers — Front-Desk Alert

**FR-049** — When a member with status `expiring_soon`, `grace_period`, or `expired` triggers a check-in event (accepted or rejected), the system immediately publishes a real-time alert to all active dashboard sessions for that gym via Supabase Realtime. Two alert types exist: a yellow **grace alert** (check-in accepted) and a red **denied alert** (check-in rejected). See FR-031 for copy and color per state.

**FR-050** — The alert displays: member name, profile photo, subscription status, days until or since expiry, and a "Renew" action button. The alert panel appears on both the Overview page and the Attendance page. The "Renew" button opens an **inline renewal panel** within the alert — the receptionist does not navigate away. The panel pre-populates the member's current plan, the renewal price in XAF, and today's date as the new start date; the receptionist may change the plan or payment method. Tapping **Confirm Renewal** records the payment, resets the subscription to `active`, sets a new expiry date, and dismisses the alert. End-to-end tap sequence: alert → Renew → [change plan/method if needed] → Confirm Renewal — a maximum of 3 taps for a straight-through cash renewal.

**FR-051** — Multiple simultaneous alerts (e.g., three expired members check in within seconds) are displayed as a stacked alert queue, newest on top, maximum 5 visible at once; older alerts scroll below. Each alert is dismissed individually by a staff member (writes a `dismissed_at` timestamp and the dismissing user's ID to the alert record) or auto-dismisses after 30 minutes (also writes a record; duration is gym-configurable in Settings). A new alert fires for the same member if they scan again after their alert was dismissed without renewal.

**FR-052** — End-to-end latency from QR scan completion to alert appearing on the dashboard is under 3 seconds under normal network conditions. See NFR-010 for Supabase region requirements that affect this target.

---

### 6.11 Coach Portal (V1)

**FR-053** — The Coach Portal is a role-gated section within the gym admin dashboard. Users with the Coach role see only the Coach Portal; all other dashboard sections (Payments, Members, Settings, Audit Log) are inaccessible.

**FR-054** — V1 Coach Portal features:

| Feature | Description |
|---------|-------------|
| Assigned member list | View all members assigned to the coach; sortable by name and plan; shows subscription status |
| Member profile view | Name, plan, subscription status, contact info, goal, and experience level set during onboarding |
| Session notes | Add, view, and edit timestamped session notes per member (coach-attributed) |

Members with `expired` status remain visible in the coach's list with their status shown — the coach is not automatically notified but can see the status. Coach-to-receptionist escalation for expiring or expired clients (e.g., coach flags a member for a renewal conversation) is deferred to V1.5; verbal communication is expected in the V1 pilot.

**FR-055** — A Manager or Owner assigns members to coaches from the Members page. A member may be assigned to at most one coach at a time. When a new coach is assigned to a member who already has one, the previous assignment is ended with an `ended_at` timestamp (not deleted). Session notes from the previous coach remain visible to Owner and Manager only — not to the new coach. Historical assignment records are queryable from the member's profile.

**FR-056** — Workout plan management and class scheduling are deferred to V1.5.

---

### 6.12 Member Mobile App

**FR-057** — The member app ships to Android and iOS from a single React Native + Expo codebase via EAS Build + Submit. Bundle ID: `com.gymos.app`. Both platforms ship together; no Android-only pilot.

**FR-058** — First-launch onboarding flow:

| Step | Screen | Notes |
|------|--------|-------|
| 0 | Language selection | English / French; defaults to device locale; appears before any other screen |
| 1 | Phone number entry | E.164 format enforced |
| 1a | OTP verification | 60-second countdown before "Resend OTP" is enabled; max 3 resend attempts; 5-minute lockout after all attempts exhausted; lockout screen shows "Contact your gym for assistance." If OTP does not arrive within 60 seconds, resend is one tap — no navigation away from the screen. |
| 2 | Profile setup | Name (required), profile photo (optional) |
| 3 | Goal selection | Lose Weight / Build Muscle / Improve Fitness / General Wellness; visible to assigned coach in coach portal |
| 4 | Experience level | Beginner / Intermediate / Advanced; visible to assigned coach |
| 5 | Plan confirmation | Gym's available plans displayed; member confirms or selects their pre-assigned plan |

**FR-059** — Home screen displays: gym branding header (logo, name, primary color), current subscription status and expiry date, quick-action buttons (Check In, View Plan, Profile), and recent activity summary (last check-in date).

**FR-060** — The Check-In screen opens the device camera and scans the gym's static QR code. States:

| State | Display |
|-------|---------|
| Success | Green confirmation with timestamp: "Checked in at [time]" |
| Success (offline) | Green confirmation with syncing indicator: "Checked in — syncing when online" |
| Wrong QR | "QR code not recognized — make sure you're scanning your gym's code." |
| Already checked in | "You're already checked in. See front desk if you need help." |
| Expired — denied | Red screen: "Access denied — membership expired. Please see the front desk." |

**FR-061** — The app supports **offline check-in only**. When a member scans the gym QR without connectivity, the check-in is recorded locally in SQLite and the success state is shown immediately. The check-in syncs to the server when connectivity resumes. Conflict resolution: if the sync arrives after the auto-timeout window has passed, the server accepts the check-in and sets `checked_out_at` to `scan_time + timeout_duration`. The front-desk alert fires at sync time, not at scan time. No other actions (payments, profile updates) are queued offline in V1.

**FR-062** — Members can view: current plan details, expiry date, payment history, and a list of past check-ins from the app.

**FR-063** — The Profile screen includes a language selector (English / French) and profile photo upload. Language change takes effect immediately across the app without requiring re-login.

---

### 6.13 Gym Admin Dashboard

**FR-064** — The gym admin dashboard is a Next.js web application. Pages and their minimum access role:

| Page | Minimum Role | Key Capabilities |
|------|--------------|-----------------|
| Overview | Receptionist | Current check-ins, expiring members, monthly revenue summary, front-desk alert panel |
| Members | Receptionist | Search, filter by status, view profiles; create/edit/deactivate (Manager+); send invite (Manager+) |
| Subscriptions | Manager | All subscription records; manual renewal initiation |
| Payments | Receptionist | All payment records; verification queue; manual payment entry |
| Attendance | Receptionist | Current check-ins; daily log; manual check-out |
| Audit Log | Manager | Append-only payment action log; filterable by date and actor |
| Settings | Owner | Branding, language, timezone, grace period, capacity, QR code download |
| Coach Portal | Coach | Assigned member list; session notes |

**FR-065** — The Overview page front-desk alert panel is the primary surface for renewal action. Alerts are real-time (Supabase Realtime) and require no page refresh.

**FR-066** — The Members page supports: search by name or phone, filter by subscription status (all / active / expiring\_soon / grace\_period / expired), and bulk CSV export. Export is limited to 1,000 rows per download in V1; apply a filter to reduce results before exporting larger sets. Export columns: member_name, phone, plan_type, subscription_status, expiry_date, join_date, last_check_in_date.

**FR-067** — The Payments page verification queue shows all unverified manual payments ordered by submission time. Each row shows the member, amount, method, submitting receptionist, and mandatory reason note.

**FR-068** — The Audit Log page is read-only. Records cannot be edited or deleted from any role. Paginated at 50 records per page. CSV export available to Owners.

**FR-069** — The Settings page allows the Owner to configure: gym name, logo, primary color, timezone, default language, grace period duration (in days), gym capacity (number of members), front-desk alert auto-dismiss duration (in minutes; default 30), and QR code download/regeneration.

**FR-085** — The Subscriptions page provides:

| Element | Detail |
|---------|--------|
| Record list | All member subscriptions, sortable by member name, status, and expiry date |
| Filters | By subscription status (active / expiring\_soon / grace\_period / expired) and by plan type |
| Access | Manager and Owner only (matches FR-064 table) |
| Manual renewal | Manager or Owner selects a member row → opens the inline renewal panel (same panel as the front-desk alert, FR-050) → selects plan, payment method, confirms |
| Export | CSV export of the filtered list (same 1,000-row limit and column schema as the Members page export, FR-066) |
| Renewal start date | Defaults to today; if the member is in grace\_period or expired, the receptionist/manager may back-date to the original expiry date to avoid losing the member a day |

---

### 6.14 Super Admin Dashboard

**FR-070** — The Super Admin dashboard is a separate Next.js application. It shares the same Supabase project as the gym admin dashboard but is accessible only to GymOS platform staff via a distinct URL and authentication flow. The Super Admin role is assigned at the platform level and bypasses per-gym RLS — all Super Admin access to gym-specific data is audit-logged.

**FR-071** — V1 Super Admin capabilities:

| Capability | Description |
|------------|-------------|
| Gym list | View all tenant gyms: name, owner, creation date, member count, subscription status |
| Gym creation | Create and activate a gym account (founder-onboarded flow; triggers owner SMS invite) |
| Gym management | Suspend or deactivate a gym; reinstate a suspended gym |
| Platform metrics | Total gyms, total members, total payments processed (platform-wide aggregates) |
| Tier management | Create, edit, and delete subscription tiers: set name, monthly price (XAF), annual price (XAF), and member cap (integer or unlimited). Changes take effect immediately for new gym assignments; existing gyms are not automatically reclassified. |
| Gym tier assignment | Assign or change a gym's subscription tier; override the member cap for a specific gym |

**FR-072** — Super Admin access to individual member data or payment records within a specific gym requires an explicit support escalation action (not a standard view). Such access is audit-logged with the Super Admin's identity, reason, and timestamp.

**FR-073** — GymOS charges gyms a recurring subscription across three default tiers, differentiated by member count and price. All tiers include the same feature set.

| Tier | Member cap | Monthly price | Annual price |
|------|-----------|---------------|--------------|
| **Hustle** | 1–30 members | Super Admin configurable | Super Admin configurable |
| **Grind** | 31–100 members | Super Admin configurable | Super Admin configurable |
| **Elite** | > 100 members (no cap) | Super Admin configurable | Super Admin configurable |

Tier definitions — names, price points, member thresholds, and the ability to add new tiers — are managed entirely by the Super Admin (see FR-071). The three tiers above are the platform defaults seeded at launch; the Super Admin can edit their prices, adjust member thresholds, or create additional tiers without a code deployment.

**FR-086** — Member cap enforcement: when a gym reaches the maximum member count for their tier, new member creation is blocked at the API level. The dashboard shows: "You've reached your plan limit ([N]/[Max] members). Contact GymOS to upgrade." Active and deactivated members both count toward the cap. The Super Admin can override the cap for a specific gym or move the gym to a higher tier.

---

### 6.15 Push Notifications

**FR-074** — All push notifications route through Expo Push Notification Service → FCM (Android) + APNs (iOS). No direct FCM/APNs integration; Expo EAS handles token management.

**FR-075** — V1 notification schedule:

| ID | Event | Trigger | V |
|----|-------|---------|---|
| N-01 | Membership expiring — 7 days | 7 days before expiry date | 1 |
| N-02 | Membership expiring — 1 day | 1 day before expiry date | 1 |
| N-03 | Membership expired | On expiry date | 1 |
| N-04 | Payment confirmed | Payment recorded (webhook success or manual verification) | 1 |
| N-05 | Payment failed | Payment webhook failure event | 1 |
| N-06 | Quiet-gym alert | Occupancy drops to Low band (opt-in; max 2/day; min 3-hr gap between sends) | 1.5 |
| N-07 | Class reminder | 60 minutes before a booked class | 1.5 |

**FR-076** — Notification preferences are stored per member in `member_preferences`. Members can opt out of non-critical notifications (N-06, N-07) from the app. Membership lifecycle notifications (N-01 through N-03) and payment notifications (N-04, N-05) cannot be opted out of in V1. Note: mandatory notifications may require consent management for future expansion into GDPR-adjacent markets — flagged as a known deferred risk.

**FR-077** — Push tokens are stored per device. A token returned as invalid by FCM or APNs is cleaned up automatically on the next delivery attempt.

**FR-078** — All notification copy is available in English and French, served per each member's language preference.

---

### 6.16 Audit Log

**FR-079** — The audit log is append-only at the database level. No role — including Super Admin — can UPDATE or DELETE audit records. This is enforced via RLS and the absence of UPDATE/DELETE permissions on the audit table for all roles.

**FR-080** — The following actions generate audit records: all manual payment entries, payment verifications, refund records, member deactivations, coach assignment changes, Super Admin gym-data escalations, and pg_cron job failures. Each record contains: actor (user ID + display name), action type, target entity ID, relevant fields (amount, method, reason as applicable), and UTC timestamp.

**FR-081** — The Audit Log dashboard page is filterable by date range and actor. CSV export of filtered results is available to Owners.

---

## 7. Non-Functional Requirements

### 7.1 Performance

| Metric | Target |
|--------|--------|
| Dashboard page load | < 2 seconds on standard broadband |
| QR scan → front-desk alert end-to-end | < 3 seconds under normal network conditions |
| Offline check-in sync | Queued check-in syncs within 10 seconds of connectivity restore |

### 7.2 Security & Data Integrity

**NFR-001** — Multi-tenant data isolation is enforced at the PostgreSQL layer via RLS. Every query against tenant data must pass through RLS-governed policies. The JWT role claim injection hook (FR-003) is spiked in week one, before any RLS policies are written — a misconfigured hook defaults to deny-all and silently blocks all authenticated users.

**NFR-002** — Payment webhook endpoints validate the Notch Pay request signature before processing. Unsigned or invalid webhook payloads are rejected with HTTP 401.

**NFR-003** — Monetary values are stored as integers with an explicit currency column. Floating-point types are not used for any monetary field.

**NFR-004** — The audit log is append-only by design. No migration, script, or application code may issue UPDATE or DELETE against audit records.

### 7.3 Availability

**NFR-005** — V1 availability is covered by Supabase Cloud and Vercel managed SLAs. No additional uptime commitment is made until commercial scale.

**NFR-006** — The member app supports offline QR check-in only. Offline check-ins are queued in SQLite and sync on reconnect. No other flows require or support offline operation in V1.

### 7.4 Observability

**NFR-007** — Sentry is integrated on both the mobile app and the admin dashboard in V1. Error events from both surfaces are routed to a single Sentry project with environment tagging (dev / staging / prod).

**NFR-008** — PostHog product analytics is deferred to V1.5. No analytics instrumentation is added to V1 beyond what Sentry captures as error/crash telemetry.

### 7.5 Testing

| Area | Approach | Version |
|------|----------|---------|
| JWT role claim hook | Spiked in sprint 1; verified before any RLS policy is written | V1 |
| RLS policies | Automated CI tests against multi-gym fixtures; cross-tenant and role-boundary edge cases | V1 |
| Payment flows | Integration tests against Notch Pay sandbox: auth, initiate, webhook, idempotency | V1 |
| Mobile app | Manual QA on physical Android device before each release; iOS via TestFlight | V1 |
| Dashboard | Manual QA in V1; no automated E2E (team too small, surface too volatile) | V1 |
| E2E automation | Revisit at V1.5 when team and surface stabilize | V1.5 |
| CI gate | RLS tests + payment integration tests + TypeScript type checks on every PR | V1 |

### 7.6 Scale Targets

**NFR-009** — Pilot scale: ~30 members per gym, 1–3 gyms. Architecture must support scaling to hundreds of gyms and thousands of members per gym without schema changes or RLS rework.

### 7.7 Infrastructure

**NFR-010** — The Supabase project must be provisioned in a region geographically close to West/Central Africa. EU West (Ireland or Frankfurt) is the recommended selection. US East adds 200–400ms of intercontinental latency on top of Cameroonian mobile network jitter, making the &lt;3s front-desk alert target (FR-052) difficult to meet. Region selection must be confirmed before any Supabase project is created — it cannot be changed after data is written.

---

## 8. Out of Scope — V1

The following are explicitly deferred. Nothing below may be added to V1 scope without an explicit decision recorded in `.decision-log.md`.

| Item | Target Version |
|------|---------------|
| Self-serve gym signup | Post-V1 |
| Travel mode plan type | V2.0 |
| Campay payment provider integration | V2.0 |
| Workout plans | V1.5 |
| Class scheduling (create, manage, book) | V1.5 |
| Progress tracking (weight, measurements, photos) | V1.5 |
| Quiet-gym alerts | V1.5 |
| Class reminders | V1.5 |
| PostHog / product analytics | V1.5 |
| E2E test automation | V1.5 |
| Provider-executed refund API calls | V1.5 |
| Streaks, challenges, leaderboards, activity feed | V2.0 |
| Live multi-currency payments beyond XAF | V2+ |
| Gym-owned merch store | V2.5 |
| Platform-wide marketplace | V3.0 |
| Geofence / Bluetooth / WiFi presence detection | V3.0 |
| Per-gym App Store listings | V4+ |
| Custom fonts, full theme systems | V4+ |
| AI features, wearables, corporate wellness | V4+ |
| Dokploy / VPS services | Decision pending for V1.5 |

---

## 9. Open Questions

| # | Question | Owner | Blocker for |
|---|----------|-------|-------------|
| OQ-1 | **Resolved** — 3 default tiers: Hustle (1–30 members), Grind (31–100), Elite (>100). Same features across all tiers; member count is the only differentiator. Prices are Super Admin configurable (no hardcoded values). Super Admin can add new tiers. See FR-073, FR-086. | — | — |
| OQ-2 | Notch Pay sandbox spike — must be completed in sprint 1. Exit criteria: sandbox auth, payment initiation, webhook receipt, idempotency test all passing. Outcome recorded in `docs/decisions.md`. If spike fails, payments Epic does not begin until an alternative is validated. | Dev team (sprint 1) | Payments Epic |
| OQ-3 | **Resolved** — 3 days confirmed. | — | — |
| OQ-4 | **Resolved** — Travel mode plan type deferred to V2.0. See `.decision-log.md` entries #4 and #16. | — | — |
| OQ-5 | **Resolved** — 8-hour default confirmed (changed from assumed 4 hours). | — | — |
| OQ-6 | **Resolved** — 30-minute default, gym-configurable (changed from assumed 15 min fixed). | — | — |
