---
title: GymOS — Product Requirements Document
status: final
created: 2026-06-20
updated: 2026-08-11
version: "1.5"
audience: Development Team
scope: V1.0 (shipped) + V1.5 — Beta-Ready (this update)
---

# GymOS — Product Requirements Document

> Stable requirement IDs (FR-NNN, NFR-NNN) are never renumbered. V1.0 ended at FR-086 / NFR-010; V1.5 begins at FR-087 / NFR-011. Where a V1.5 requirement changes a V1.0 requirement's behavior, it says so explicitly ("Amendment to FR-XXX") and states the change — V1.0 text is not edited in place, so history stays legible. The exceptions are the two pre-existing FR-071/FR-082 edits below, decided and shipped (Story 1.13) before this convention was adopted for V1.5.

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

### 1.1 What Changed Since V1.0

V1.0 proved the retention spine — payments, attendance, the front-desk alert, multi-tenant isolation — and has shipped (Epics 1–8, all `done`). V1.5 turns that pilot into a beta a gym can run without founder hand-holding, and gives members a reason to open the app between visits.

| Area | V1.0 | V1.5 |
|------|------|------|
| Automated mobile-money provider | Notch Pay as planned (FR-034), never actually carried live traffic | Tara Money formalized as the documented, sole intended provider; one real-money sandbox round-trip passed (Story 4.2, 2026-07-31), but no automated mobile-money payment has yet been collected from a real member in production — production activation is still pending (OQ-7) |
| Member payment routing | Implicit | Into each gym's own Tara Money account |
| Gym SaaS billing | Tier assigned, not collected | Owner-approved recurring, reminder + one-tap pay via Tara Money (gym Owner → GymOS); automated debit deferred pending a card provider (OQ-14) |
| Tenant suspension | Manual (Super Admin) | Automated on SaaS non-payment, after grace |
| Client profile | Name, phone, plan, status | + body metrics, measurements, photos, trends |
| Staff accounts | Super Admin creates Owner only | Owner self-serve: Supervisor, Manager, Receptionist, Coach |
| Coach data access | Assigned members + notes | + member progress data (when assigned) |
| App between-visit value | Status, history | + progress tracking, quiet-gym alerts |
| Classes | Deferred | Scheduling + booking + reminders |
| Workout plans | Deferred | Coach-authored plans |
| WhatsApp invite / OTP fallback | Started, unfinished | Completed |
| Product analytics | Sentry only | + PostHog |
| Test automation | Manual + RLS/payment CI | + E2E automation baseline |

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

| # | Goal | V |
|---|------|---|
| G-1 | Deliver a live pilot with real members and real payments within 3–4 months | 1.0 |
| G-2 | Make every franc auditable — no silent payment failures, all manual actions traceable | 1.0 |
| G-3 | Land the retention moment — front-desk alert catches expiring members at check-in | 1.0 |
| G-4 | Prove the multi-tenant foundation — RLS and schema hold as new gyms are added | 1.0 |
| G-5 | Ship to both Android and iOS from a single codebase | 1.0 |
| G-6 | Launch fully bilingual (English + French) with zero missing-string errors | 1.0 |
| G-7 | Ship a beta a gym can operate end-to-end without founder involvement — including provisioning its own staff | 1.5 |
| G-8 | Give members a reason to open the app between gym visits, measured by non-visit-day app opens | 1.5 |
| G-9 | Complete the Notch Pay → Tara Money cutover with zero lost or double-charged payments | 1.5 |
| G-10 | Keep member body/progress data private by construction — no cross-member and no unauthorized coach access | 1.5 |
| G-11 | Prove classes and workout plans work in a real gym's weekly rhythm without adding operational load | 1.5 |
| G-12 | Stand up GymOS's own SaaS revenue collection (Flow B) — reliable and reconciled with zero cross-account leakage into or out of gym funds, via the reminder-driven, Owner-approved billing model V1.5 ships with (OQ-14) | 1.5 |

### 3.2 Success Metrics

| Metric | Target | Counter-Metric | V |
|--------|--------|----------------|---|
| Pilot live date | Within 3–4 months of dev start | Scope expansion pushing timeline — tracked via sprint velocity | 1.0 |
| Front-desk alert reliability | ≥ 95% of expiring/expired check-ins trigger an alert | Alert-to-renewal-action conversion — if alerts fire but aren't actioned, they become noise | 1.0 |
| Payment reconciliation accuracy | Zero undetected discrepancies in first 30 pilot days | Mandatory-reason field abandonment — if receptionists skip payments to avoid friction | 1.0 |
| Cross-tenant data isolation | Zero cross-tenant leaks in CI and pilot operation | Over-restrictive RLS — access-denied errors per role tracked in Sentry | 1.0 |
| Localization completeness | Zero missing-string errors in EN and FR across all flows | Translation divergence — EN and FR string counts must stay in sync on every PR | 1.0 |
| Beta gym self-sufficiency | ≥ 80% of beta gyms complete a full week with zero founder-support tickets | Founder-intervention rate per gym/week | 1.5 |
| Non-visit-day app opens | ≥ 20% of active members open the app on a non-visit day within 60 days | Progress-logging abandonment after first entry | 1.5 |
| Payment cutover integrity | Zero lost or duplicated payments across migration | Reconciliation discrepancies during cutover | 1.5 |
| Progress-data isolation | Zero unauthorized reads of member body data | Coaches wrongly blocked from assigned members | 1.5 |
| Staff-provisioning safety | Zero privilege-escalation incidents | Legitimate staff-creation actions blocked | 1.5 |
| Class booking reliability | ≥ 95% of bookings honoured (no overbooking) | No-show rate (informational only) | 1.5 |
| SaaS billing collection reliability | Zero missed or duplicated billing cycles across active gyms; zero payments settling to the wrong account (NFR-019) | Suspension false-positive rate — gyms wrongly moved to `suspended` | 1.5 |

---

## 4. Users & Roles

### 4.1 Role Hierarchy

Roles are scoped per gym except Super Admin, which is platform-wide.

```
Super Admin  (platform-wide; GymOS staff only)
  └─ Owner       (full gym access + settings)
       └─ Supervisor  (Manager-plus: staff management + settings access) [V1.5]
            └─ Manager     (operations; no settings)
                 └─ Receptionist  (front desk; payments; check-in)
                      └─ Coach         (assigned members + session notes only)
                           └─ Member       (own data only)
```

Role enforcement is at the PostgreSQL RLS layer. Client-side role checks are supplementary only. When RLS rejects a request the client thought was allowed, the UI shows "You don't have permission to do that" and logs the denial to Sentry with the user's role, action, and resource — no raw database errors reach the user.

**Supervisor** is new in V1.5 (see 6.17). It sits between Owner and Manager with the same staff-management and Settings access as Owner ("Manager-plus"), but it structurally cannot create another Supervisor or an Owner — only Manager, Receptionist, or Coach, mirroring Owner's own creatable set minus Supervisor itself. The general rule this and every other rung follows: no role may create a role equal to or above its own (NFR-013).

### 4.2 User Profiles

**Gym Owner / Manager**
Replace paper, WhatsApp, and Excel. See every franc reconciled, every member's status, and every expiring membership — and catch those members at the door before they quietly disappear.

**Receptionist**
Front-desk operator. Processes payments, confirms check-ins, acts on renewal alerts.

**Member**
One branded app for gym life: subscription status, QR check-in, payment history, profile, language preference.

**Coach**
Manages assigned members and session notes from a role-gated view inside the dashboard. Sees member goals and experience levels set during onboarding. Workout plans and class scheduling ship in V1.5 (6.21, 6.22).

**GymOS Platform Owner (Super Admin)**
Full visibility across all tenant gyms: gym status, platform-wide metrics. Creates and manages gym accounts in the founder-onboarding flow.

### 4.3 Role Capability Deltas in V1.5

The V1.0 role hierarchy is unchanged in spirit — V1.5 makes the already-defined staff roles operationally real by giving the Owner (and now Supervisor) the means to create and manage them, and extends the Coach's data access to include progress tracking.

| Role | New in V1.5 |
|------|-------------|
| Owner | Create, edit, deactivate, reassign Supervisors, Managers, Receptionists, Coaches; assign members to coaches |
| Supervisor | Same staff-management and Settings access as Owner; creates Manager, Receptionist, Coach only — never Supervisor or Owner |
| Manager | Manage classes and schedules; cannot manage staff accounts or settings |
| Receptionist | Manage class bookings at the desk; check members into classes |
| Coach | Author workout plans; view assigned members' progress data; manage class sessions they lead |
| Member | Log body metrics and progress photos; book classes; opt into quiet-gym alerts; follow a workout plan |

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

### UJ-6: The Owner staffs their gym (V1.5)

Grace's gym just joined the beta. She opens Settings → Staff, clicks Add staff, adds her receptionist Aicha (name, phone, role → Create). Aicha gets an SMS with a temp password and dashboard link. Grace adds her coach Emmanuel, who on login sees only the Coach Portal. Grace never contacts support — the gym is staffed in four minutes.

### UJ-7: Amara tracks her progress (V1.5)

On a rest-day evening Amara opens the app, taps Progress, logs her weight and waist measurement, and adds a photo stored privately. The app shows her weight down 2.4 kg since joining. She didn't train today but she opened the app — exactly the behaviour V1.5 is built to create.

### UJ-8: Emmanuel coaches with real data (V1.5)

Emmanuel opens an assigned client's profile and sees their goal, experience level, and now their progress trend. He writes a note about the plateau and adjusts the workout plan, swapping two exercises. The member sees the update on next app open. A member he isn't assigned to is invisible — including all their progress data.

### UJ-9: Nadia schedules a week of classes (V1.5)

Nadia (Manager) creates a recurring HIIT Tue/Thu 6 PM class, capacity 15, coach Emmanuel. Members book from the app; when it fills, booking closes. An hour before each session, booked members get a reminder push. The receptionist sees who's booked and checks them in.

### UJ-10: Chidi verifies the payment cutover (V1.5)

Chidi, back at GymOS HQ, re-runs the Tara Money round-trip that already passed once (`docs/decisions.md`, 2026-07-31) — this time against GymOS's own now-activated business account instead of the stand-in the original spike used (OQ-7). He swaps one config value, sends a real test charge, and confirms the webhook lands and reconciles. He checks the audit log: no gym's payment ever touched the platform account, and no member was charged twice. The swap changed one config surface behind the `PaymentProvider` interface — payment logic never moved.

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

**FR-082** — When a Manager or Owner creates a new member record in the dashboard and clicks "Send Invite," the system automatically sends the personalized onboarding invitation (member's name, gym name, a deep link to the GymOS app) via WhatsApp, routed through the self-hosted Evolution API gateway (FR-071). The deep link pre-associates the member's phone number, so the OTP screen is the first thing they see in the app. Manager/Owner may resend at any time from the member's row. If the automated send fails, the dashboard shows an inline error and falls back to the manual copy/share-via-WhatsApp option as a safety net — the original V1.0 UI, demoted from primary path to fallback, not removed.

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

Members with `expired` status remain visible in the coach's list with their status shown — the coach is not automatically notified but can see the status. Coach-to-receptionist escalation for expiring or expired clients (e.g., coach flags a member for a renewal conversation) is deferred to V2.0 (Section 8); verbal communication is expected through V1.5.

**FR-055** — A Manager or Owner assigns members to coaches from the Members page. A member may be assigned to at most one coach at a time. When a new coach is assigned to a member who already has one, the previous assignment is ended with an `ended_at` timestamp (not deleted). Session notes from the previous coach remain visible to Owner and Manager only — not to the new coach. Historical assignment records are queryable from the member's profile.

**FR-056** — Workout plan management and class scheduling are deferred to V1.5. Resolved in V1.5 — see 6.21 Classes & Scheduling (FR-104–FR-108) and 6.22 Workout Plans (FR-109–FR-112).

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

**FR-066** — The Members page supports: search by name or phone, filter by subscription status (all / active / `expiring_soon` / `grace_period` / expired), and bulk CSV export. Export is limited to 1,000 rows per download in V1; apply a filter to reduce results before exporting larger sets. Export columns: member_name, phone, plan_type, subscription_status, expiry_date, join_date, last_check_in_date.

**FR-067** — The Payments page verification queue shows all unverified manual payments ordered by submission time. Each row shows the member, amount, method, submitting receptionist, and mandatory reason note.

**FR-068** — The Audit Log page is read-only. Records cannot be edited or deleted from any role. Paginated at 50 records per page. CSV export available to Owners.

**FR-069** — The Settings page allows the Owner to configure: gym name, logo, primary color, timezone, default language, grace period duration (in days), gym capacity (number of members), front-desk alert auto-dismiss duration (in minutes; default 30), and QR code download/regeneration.

**FR-085** — The Subscriptions page provides:

| Element | Detail |
|---------|--------|
| Record list | All member subscriptions, sortable by member name, status, and expiry date |
| Filters | By subscription status (active / `expiring_soon` / `grace_period` / expired) and by plan type |
| Access | Manager and Owner only (matches FR-064 table) |
| Manual renewal | Manager or Owner selects a member row → opens the inline renewal panel (same panel as the front-desk alert, FR-050) → selects plan, payment method, confirms |
| Export | CSV export of the filtered list (same 1,000-row limit and column schema as the Members page export, FR-066) |
| Renewal start date | Defaults to today; if the member is in `grace_period` or expired, the receptionist/manager may back-date to the original expiry date to avoid losing the member a day |

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
| Messaging instance management | View the active Evolution API WhatsApp instance ID and connection status; update the instance ID used for platform-wide WhatsApp sends (OTP delivery and member invitations) when a number disconnects, without a code deployment |

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

### 6.17 Staff Management (Owner Self-Serve) — V1.5

**FR-087** — A gym Owner can create staff accounts for their own gym: Supervisor, Manager, Receptionist, and Coach. A Supervisor can create Manager, Receptionist, and Coach accounts — the same set an Owner can create, minus Supervisor itself. Neither an Owner nor a Supervisor can create an Owner or a Super Admin. A Manager cannot create staff at all. In general, no role may create a role equal to or above its own rung (Owner > Supervisor > Manager > Receptionist > Coach — see NFR-013). Captures full name, phone (E.164), and role. Staff creation is audit-logged.

**FR-088** — A newly created staff member is provisioned like V1.0 owner activation: an SMS with a temporary password and dashboard link. First login requires setting a new password. Until first login the account is `pending_activation`.

**FR-089** — An Owner or Supervisor can edit a staff member's name and role, and deactivate (soft-delete) a staff account. The same ceiling rule as FR-087 applies to role *edits*, not only creation: an editor cannot raise a target's role to equal or above their own rung, and cannot edit their own role at all (self-escalation is structurally impossible, not just discouraged). Deactivation revokes access immediately, via the same server-side revocation check as FR-090 (a role change and a deactivation are the same security-sensitive event — losing access entirely), and is audit-logged with a mandatory reason. A deactivated Coach's notes and plan authorship are retained, visible to Owner and Manager.

**FR-090** — Role changes take effect immediately, not on the staff member's next voluntary token refresh or re-login. Because role/gym claims are carried in the JWT (FR-003), immediate revocation requires a server-side check independent of client cooperation — a role-version or session-invalidation marker verified at the same auth-hook/RLS layer that already enforces deny-all-by-default. A demoted or deactivated staff member's existing JWT is rejected the moment that check runs, closing the security window a client-side-only refresh would leave open.

**FR-091** — One phone number maps to one platform user (FR-001). A person may hold different roles at different gyms — each a separate binding. A person cannot hold two roles at the same gym; a new role replaces the prior binding (audit-logged).

**FR-092** — A Coach account is a staff role for portal access. Assigning members to that coach remains a separate action on the Members page (FR-055). A Coach with no assignments sees an empty list with guidance to contact their Manager/Owner/Supervisor.

---

### 6.18 Complete Client Profiles — Body & Progress Tracking — V1.5

**FR-093** — The member profile is extended with an optional body profile: height, starting weight, and optional baseline measurements. Entered during an optional "Complete your profile" step or any time from Progress. No body data is mandatory.

**FR-094** — A member can log progress entries over time — any subset of: weight, body measurements (waist, chest, hips, arms, thighs), a progress photo, and a note. Each entry carries a timestamp and a `client_id` for offline-safe dedupe. A member may soft-delete their own entry.

**FR-095** — Body and progress data is private by default. RLS visibility rules:
- A member can always read and write their own body/progress data.
- An assigned Coach can read the progress data of members currently assigned to them — and only those members.
- A Coach's access ends the instant their assignment ends (FR-055 `ended_at`).
- No other role — Receptionist, Manager, Supervisor, Owner, or another member — can read a member's measurements or photos.
- Progress photos: readable only by the owning member and, if the member opts in per-photo, their assigned coach. Sharing defaults to off for every new photo — an explicit per-photo action, not a blanket setting. A member can revoke a photo's sharing at any time; revocation takes effect immediately (no outstanding signed URL remains valid past revocation, per NFR-011) and applies going forward — it does not retroactively determine whether the coach already viewed it, which is not tracked.

**FR-096** — The member Progress screen shows current weight and change since start, a weight trend chart, logged measurements with trends, a photo timeline (member-only unless shared), and a log-entry action. Charts view offline; logging offline queues the entry (FR-097).

**FR-097** — Amendment to FR-061. V1.0 limited offline support to check-in. V1.5 extends offline queueing to progress entry logging, stored locally (SQLite) and synced on reconnect via `client_id` idempotency. No other flows are offline in V1.5.

**FR-098** — In the Coach Portal, an assigned member's profile gains a Progress tab showing weight/measurement trends and shared photos. The coach can add a note but cannot edit or delete a member's progress entries. Unassigned members are invisible and unreadable.

---

### 6.19 Payments — Tara Money (Automated Mobile-Money Option) — V1.5

**FR-099** — Amendment to FR-034. Tara Money (a Cameroon mobile-money service with a developer API — create a collect, then detect payment via callback/status) is the designated automated mobile-money provider going forward, replacing Notch Pay in that role — this requirement formalizes that decision (`docs/decisions.md`, 2026-07-31) rather than introducing new capability. **Correction:** no automated mobile-money payment has actually been collected from a real member in production under either provider to date; only cash and other manual methods (FR-033) have carried real member payments. The sandbox spike (FR-100) succeeded, including one real-money round-trip, and was re-verified against GymOS's own real business account (OQ-7, resolved — `docs/decisions.md`, 2026-08-13, Story 4.10), but production activation itself is still pending Story 4.12's cutover. Tara Money is offered alongside cash and the manual methods (FR-033), not as a replacement for them. It uses the existing `PaymentProvider` interface; business logic is unchanged. Notch Pay remains a documented fallback behind the same interface, never actually carrying live traffic. Provider selection is configuration, not code.

**FR-100** — The Tara Money integration was gated by a sandbox spike with the same exit criteria that gated Notch Pay (OQ-2): sandbox auth, payment initiation returns a reference, webhook received and processed, idempotency test passes. The spike passed in full against a stand-in business account on 2026-07-31 (`docs/decisions.md`), including one real-money round-trip. **No member has been charged, and no member payment has been collected, through that stand-in account or any other account since** — the spike proved the integration works, it did not put it into production use. GymOS's own business account (`9FmIZg9GBB`) was blocked on activation until this session. A credential swap to the real account and re-verifying the same round-trip against it are now done (OQ-7, resolved — `docs/decisions.md`, 2026-08-13, Story 4.10); only actually beginning to route real member payments through it remains before production reliance (Story 4.12's cutover, still backlog). This is a credential swap, not a provider cutover (FR-102) — it needs no code or migration changes, but it is a hard prerequisite for G-9 and Section 10 item 2, not a formality.

**FR-101** — Webhook signature verification (NFR-002) is provider-specific. The handler verifies using the active provider's scheme. Tara Money verification is implemented and tested against sandbox and real webhook deliveries before cutover. Invalid payloads are rejected with HTTP 401.

**FR-102** — Cutover procedure:
- New payment initiations route to Tara Money.
- Notch Pay payments already in processing reconcile to a terminal state under Notch Pay; the reconciliation job polls both providers during the window.
- No payment is re-initiated across providers (prevents double-charge).
- The migration window and its reconciliation result are recorded in the audit log.
- Cutover is reversible by configuration for the duration of the beta.

**FR-103** — Both MTN Mobile Money and Orange Money are supported via Tara Money (matching V1.0 coverage, FR-033). Cash, bank transfer, and manual mobile money remain first-class manual methods, unchanged.

---

### 6.20 Payment Gateway — Two Distinct Payment Flows — V1.5

Two structurally different payment relationships, both using the Tara Money integration (FR-099) but routing money in opposite directions with separate lifecycles.

|  | Flow A — Member pays Gym | Flow B — Gym Owner pays GymOS |
|---|---|---|
| Payer | Member | Gym Owner |
| Recipient account | The gym's own Tara Money account | The GymOS platform account |
| Purpose | Gym membership subscription | Platform SaaS tier (FR-073) |
| Amount set by | Gym Owner (plan prices) | Super Admin (tier prices) |
| Provider credentials | Per-gym (each gym connects its own) | Single, platform-level |
| On non-payment | Member loses gym access (FR-030) | Whole gym suspended after grace (FR-131) |
| Exists before V1.5 | Yes (V1.0) | No — new in V1.5 |

The same `PaymentProvider` interface serves both; the difference is whose credentials the payment routes through. GymOS never holds member money (FR-124) and earns only the SaaS tier fee (FR-125).

**Flow A — Member → Gym (membership payments)**

**FR-124** — When a member pays their gym by Tara Money, the payment settles directly into that gym's own Tara Money account. GymOS orchestrates (create collect, detect confirmation, reconcile, receipt) but never receives or holds member funds — a technical orchestrator over each gym's own account, not an aggregator. Paying by Tara Money is one option beside cash and the other manual methods (FR-033).

**FR-125** — GymOS takes no commission on member→gym payments in V1.5. Platform revenue comes solely from the SaaS tier fee (Flow B). Provider transaction fees are borne by the gym (FR-039); GymOS neither absorbs nor marks them up.

**FR-126** — Each gym must connect its own Tara Money account to collect automated mobile-money payments. Settings provides a "Connect payment account" flow where the Owner authorizes their gym's merchant credentials. Credentials are stored encrypted (Supabase Vault), readable only by the payment service, never returned to any client, tenant-isolated.

**FR-127** — Cash and Tara Money are co-equal payment options, not a primary and a fallback. A gym always takes cash and the manual methods (FR-033); connecting Tara Money adds the automated mobile-money option beside them. A gym without Tara Money connected loses no ability to operate — it collects by cash and manual entry as before, and the app simply does not surface the automated "pay by Tara Money" action until the Owner connects. Connecting is an enhancement, never a prerequisite.

**FR-128** — When a member initiates a mobile-money payment, the service resolves the gym's connected credentials (FR-126) and routes through them. A member never sees gym credentials. If credentials are missing, invalid, or revoked, initiation fails gracefully, directing the member to the desk, and the Owner is notified their connection needs attention.

**FR-129** — Both member subscription purchase and renewal use Flow A. Renewal via the front-desk alert panel (FR-050) and self-service renewal from the app both route through the gym's connected account. The subscription lifecycle (FR-027–FR-032) is unchanged; only money routing is now explicitly the gym's own account.

**Flow B — Gym Owner → GymOS (SaaS subscription billing)**

**FR-130** — GymOS bills each gym for its platform SaaS subscription per the gym's tier (FR-073) and interval (monthly/annual). New in V1.5: V1.0 assigned tiers and enforced caps (FR-086) but did not collect the fee. Billing for V1.5 is a reminder-to-approve model, not an automated debit: GymOS notifies the Owner when payment is due (FR-135) and the Owner completes the charge via Tara Money into the platform's account (OQ-14, resolved). Automated recurring debit is deferred to a future version pending a card-based provider.

**FR-131** — A gym's platform subscription has its own lifecycle: `active` → `past_due` → `grace_period` → `suspended`.
- `active` — SaaS fee paid; gym fully operational.
- `past_due` — the Owner missed the payment-due notice or the Tara Money charge failed; the gym stays operational and repeat reminders begin (FR-133, FR-135).
- `grace_period` — retries exhausted; a Super-Admin-configurable window begins (default 7 days). Gym operational; Owner sees a "renew to avoid suspension" banner and is notified.
- `suspended` — grace elapsed; the whole gym tenant is suspended (staff and members cannot log in), data retained. Payment restores full access. Formalizes the Super Admin suspend capability (FR-071).

**FR-132** — Suspending a gym for non-payment suspends the entire tenant — every staff and member account loses access until the subscription is current. Reversible: a successful SaaS payment returns the gym to `active` and restores access immediately. Member states and all data are preserved through suspension. The member-facing suspension surface never mentions billing or payment — that is between GymOS and the Owner only.

**FR-133** — **Amendment — OQ-14 resolved.** SaaS billing is Owner-approved, not automated: on each gym's billing anchor date, GymOS sends the Owner a payment-due notice (channels per FR-135) with a one-tap Tara Money payment link. The Owner is never auto-debited — mobile money does not support that. If unpaid, GymOS re-sends the notice on a defined schedule (default: 1, 3, 5 days after due) before the gym moves to `grace_period`. Every notice and payment attempt is recorded (FR-135). Automated recurring debit is deferred to a future version pending a card-based provider (e.g. Stripe); this FR is amended again when that ships.

**FR-134** — The Super Admin dashboard gains a Billing view: each gym's tier, interval, SaaS status, next billing date, last payment, failed attempts. Super Admin can mark a payment received (out-of-band), apply a credit/free period (beta gyms, FR-136), trigger a retry, or suspend/reactivate. All actions audit-logged (FR-080).

**FR-135** — Gym Owners receive platform-subscription notifications distinct from member notifications: upcoming SaaS renewal, payment due (with the one-tap Tara Money link, FR-133), payment succeeded/failed (with retry date), entering grace, impending suspension. Owner-facing and mandatory (non-opt-out), as they concern continued platform access. Sent via **both SMS and WhatsApp** (not a fallback chain — both fire, since missing this notice risks suspension), reusing the Evolution API/Twilio infrastructure from FR-118, **plus email if the Owner has one on file.** Capturing an Owner email is new in V1.5 — an optional field on the Owner account, mirroring FR-020's optional member email — and requires a transactional email provider, which is not part of the V1.0/V1.5 stack today (addendum §A lists none). Email is a best-effort third channel until that provider is selected and integrated; SMS and WhatsApp are the guaranteed channels regardless.

**FR-136** — Beta accommodation. Super Admin can place a gym on a free or discounted plan (zero-price tier or credited period) so beta gyms aren't charged during validation — formalized as the Free/Test tier (FR-139) rather than left to ad-hoc discounting. The billing machinery (FR-130–FR-135) is built and exercised even at a 0 XAF price point, but whether a given beta gym is charged is Super-Admin policy per gym.

**Shared requirements (both flows)**

**FR-137** — Both flows reuse the V1.0 integrity machinery: idempotent webhooks (FR-035), reconciliation (FR-036), append-only audit (FR-079), integer-XAF storage (FR-026). Flow B reconciles against the platform account, Flow A against each gym's account. Discrepancies in either are flagged. Amendment to FR-036: the discrepancy definition gains a fourth category — a payment whose settled account does not match its declared routing context (FR-138), i.e. a Flow A collect that landed in or credited against the platform account, or a Flow B collect that landed in a gym account. Reference and amount matching alone (the original three FR-036 categories) cannot catch a misrouted-but-otherwise-clean payment.

**FR-138** — The `PaymentProvider` abstraction carries a routing context identifying which account a payment belongs to (a specific gym for Flow A, the platform for Flow B). This context selects the correct credentials at initiation, verification, and reconciliation. Adding a provider or flow changes only the adapter and context, not the calling code.

**FR-139** — Amendment to FR-073. A fourth tier, **Free/Test**, is added to the platform defaults: member cap Super Admin-configurable per gym, monthly and annual price fixed at 0 XAF. It exists specifically for beta/test gyms during validation, giving Super Admin a formal, auditable way to exempt a gym from SaaS billing (FR-130) rather than relying only on ad-hoc per-gym discounting (FR-136). Assigning a gym to Free/Test is a tier change like any other (FR-071 Gym tier assignment) — the billing reminder/reconciliation machinery (FR-130–FR-135) still runs, just at a 0 XAF price point, so those code paths stay exercised during the beta.

**FR-140** — A member can renew their own subscription directly from the app (Flow A, FR-124) without visiting the front desk. When status is `expiring_soon`, `grace_period`, or `expired`, the app surfaces a "Renew" action showing the current plan and renewal price; the member pays by Tara Money if the gym has one connected (FR-126), or sees "See front desk to renew with cash" if not (FR-127). On successful payment, the subscription resets per FR-032 and the member sees an immediate confirmation — the same outcome as the front-desk renewal panel (FR-050), just member-initiated and routed through the gym's connected account (FR-129).

---

### 6.21 Classes & Scheduling — V1.5

**FR-104** — A Manager or Owner can create classes: name, description, assigned coach, capacity, and a schedule (one-off or recurring). Classes are tenant-isolated like all other data.

**FR-105** — Any member with an active subscription, on any plan type, can book a class session from the app (fixed rule — no per-plan class-eligibility flag). Booking is capacity-limited; when full, booking closes ("This class is full"). Enforced server-side to prevent overbooking under concurrency.

**FR-106** — A member can cancel a booking up to a gym-configurable cutoff (default 2 hours), freeing the spot. Booking and cancellation are not payments.

**FR-107** — A Receptionist can view a session's booked members and mark attendance. Class attendance is distinct from floor check-in but uses the same member-status rules — an expired member cannot be checked in and triggers the front-desk alert (FR-049).

**FR-108** — The member app shows upcoming booked classes on Home and a Classes screen of available/booked sessions. Workout plans and classes are separate features.

---

### 6.22 Workout Plans — V1.5

**FR-109** — A Coach can author a workout plan for an assigned member: a named plan with an ordered list of exercises (sets, reps, optional notes), created and edited from the Coach Portal.

**FR-110** — A plan is assigned to exactly one member. The member sees their plan and can mark exercises/sessions complete; completion logging is offline-safe (`client_id`). Completion data is visible to the authoring coach.

**FR-111** — If a coach assignment ends (FR-055), the previous coach's plan stays visible to the member and Owner/Manager but is not editable by a new coach until they take ownership — mirroring the V1.0 session-note handoff.

**FR-112** — A shared exercise library (platform defaults; gym/coach can add custom entries, gym-scoped) backs plan authoring.

---

### 6.23 Quiet-Gym Alerts — V1.5

**FR-113** — A member can opt in to quiet-gym alerts (default off). When occupancy drops into the Low band (FR-047) during opening hours, opted-in members receive N-06 — the V1.5 activation of the reserved N-06 notification (FR-075).

**FR-114** — Quiet-gym alerts are rate-limited: max 2 per day per member, min 3-hour gap, only during configured opening hours.

**FR-115** — Quiet-gym alerts use the existing occupancy calculation (FR-046) — no new presence detection — preserving the honest-estimate guarantee.

---

### 6.24 Class Reminders — V1.5

**FR-116** — A booked member receives N-07 60 minutes before the session. Class reminders are opt-out (non-critical), per FR-076.

---

### 6.25 WhatsApp Invite & OTP Fallback (V1.0 Carryover Completion) — V1.5

**FR-117** — The Evolution API WhatsApp integration is completed, covering the two unfinished V1.0 stories. Member invitations (FR-082) can be sent via WhatsApp in addition to SMS, at the gym admin's choice.

**FR-118** — OTP delivery uses an ordered fallback chain, Evolution API WhatsApp first, falling through to Twilio WhatsApp, then Twilio SMS, then sent.dm on failure at each step. Transparent to the member; channel and outcome are logged for observability. (Corrects the V1.5 draft's original "primary SMS, WhatsApp fallback" framing, which had the order backwards relative to the chain already decided and shipping per the 2026-08-08 proposal.)

**FR-119** — The Evolution API instance configuration (V1.0 Epic 1, Story 1.13 — shipped) is finalized: platform-level, managed by Super Admin, documented in `docs/decisions.md`.

---

### 6.26 Dashboard & App Additions — V1.5

**FR-120** — The Settings page gains a Staff section (Owner and Supervisor) listing staff with role and status, plus Add/Edit/Deactivate (FR-087–FR-089). All other Settings capabilities unchanged.

**FR-121** — A new Classes page (Manager for create/edit; Receptionist for bookings and class attendance) lists classes, sessions, booking counts vs capacity, and the assigned coach.

**FR-122** — The Coach Portal gains Workout Plans and, per assigned member, a Progress tab. No other dashboard section becomes visible to the Coach role.

**FR-123** — The member app gains a Progress tab and a Classes tab alongside Home/Check-In/Profile. Notification preferences gain N-06 and N-07 toggles.

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

**NFR-012** — The Tara Money cutover (FR-102) must produce zero double-charges and zero lost payments, verified by the reconciliation job reporting zero discrepancies before Notch Pay is stood down as primary.

**NFR-013** — Staff provisioning and role editing (FR-087, FR-089) must make privilege escalation impossible: no role can create *or edit a target into* a role equal to or above its own, and no role can edit its own role, enforced at the RLS/auth-hook layer. CI asserts an Owner cannot mint or promote-to a Super Admin, a Supervisor cannot mint or promote-to a Supervisor or Owner (including on themselves), and a Manager cannot mint or edit staff roles at all.

**NFR-017** — Per-gym Tara Money credentials (FR-126) are stored encrypted at rest (Supabase Vault), accessible only to the server-side payment service, never returned to any client, never logged, never readable across tenants. They carry the same isolation guarantees as all tenant data (NFR-001).

**NFR-018** — Tenant suspension for SaaS non-payment (FR-131/FR-132) is enforced at the authorization layer, not only the UI: a suspended gym's staff and members are denied at the RLS/auth-hook layer, so suspension cannot be bypassed by a client ignoring UI state. Takes effect on the next request; no tenant data is deleted or mutated.

**NFR-019** — FR-125's "GymOS takes no commission on member→gym payments" is auditable, not merely asserted: every Flow A payment's settlement account is verifiable against its gym's connected credentials (FR-126) via the audit log, so a platform-account credit from a Flow A transaction is detectable after the fact, not just prevented in theory.

### 7.3 Availability

**NFR-005** — V1 availability is covered by Supabase Cloud and Vercel managed SLAs. No additional uptime commitment is made until commercial scale.

**NFR-006** — The member app supports offline QR check-in only. Offline check-ins are queued in SQLite and sync on reconnect. No other flows require or support offline operation in V1.

### 7.4 Observability

**NFR-007** — Sentry is integrated on both the mobile app and the admin dashboard in V1. Error events from both surfaces are routed to a single Sentry project with environment tagging (dev / staging / prod).

**NFR-008** — **Superseded by NFR-014.** PostHog was deferred at V1.0; V1.5 activates it.

**NFR-014** — PostHog product analytics is integrated on app and dashboard, focused on the V1.5 metrics (Section 3.2), carrying no body-measurement or photo content into events. Same environment tagging as Sentry (NFR-007).

### 7.5 Testing

| Area | Approach | Version |
|------|----------|---------|
| JWT role claim hook | Spiked in sprint 1; verified before any RLS policy is written | V1 |
| RLS policies | Automated CI tests against multi-gym fixtures; cross-tenant and role-boundary edge cases | V1 |
| Payment flows | Integration tests against Notch Pay sandbox: auth, initiate, webhook, idempotency | V1 |
| Mobile app | Manual QA on physical Android device before each release; iOS via TestFlight | V1 |
| Dashboard | Manual QA in V1; no automated E2E (team too small, surface too volatile) | V1 |
| E2E automation | Baseline established (NFR-015): staff provisioning + role enforcement, the payment cutover path, progress-data access boundaries, class booking capacity limits. Complements, not replaces, V1 CI gates | V1.5 |
| CI gate | RLS tests + payment integration tests + TypeScript type checks on every PR | V1 |

**NFR-015** — An E2E test automation baseline is established, covering the four priority flows listed above.

### 7.6 Scale Targets

**NFR-009** — Pilot scale: ~30 members per gym, 1–3 gyms. Architecture must support scaling to hundreds of gyms and thousands of members per gym without schema changes or RLS rework.

### 7.7 Infrastructure

**NFR-010** — The Supabase project must be provisioned in a region geographically close to West/Central Africa. EU West (Ireland or Frankfurt) is the recommended selection. US East adds 200–400ms of intercontinental latency on top of Cameroonian mobile network jitter, making the &lt;3s front-desk alert target (FR-052) difficult to meet. Region selection must be confirmed before any Supabase project is created — it cannot be changed after data is written.

### 7.8 Data Privacy — Progress Data (V1.5)

**NFR-011** — Progress photos (FR-094) are stored in Supabase Storage under access rules mirroring FR-095: retrievable only by the owning member and, if shared, their assigned coach. Object paths are non-guessable; no photo is served from a public bucket — a new, dedicated bucket, separate from the existing public `member-photos` bucket used for profile photos (Story 2.6). Signed URLs are short-lived enough that revoking a photo's sharing (FR-095) invalidates access within that same window — no long-lived signed URL survives a revoke.

**NFR-016** — Coach access to member progress data — both the assignment relationship and each photo's per-photo sharing flag (FR-095) — is re-verified on every request against current state; an ended assignment or a revoked photo-share revokes read access with no caching window that outlives either.

---

## 8. Out of Scope

The following are explicitly deferred. Nothing below may be added to scope without an explicit decision recorded in `.memlog.md` (see also the legacy `.decision-log.md`).

| Item | Target Version |
|------|---------------|
| Self-serve gym signup | Post-V1.5 |
| Travel mode plan type | V2.0 |
| Campay payment provider integration | V2.0 |
| Provider-executed refund API calls | V2.0 |
| Coach-to-receptionist escalation for expiring clients | V2.0 |
| Class waitlists (auto-promote when a spot frees) | V2.0 |
| Nutrition / meal logging | V2.0 |
| Progress data export (member downloads history) | V2.0 |
| Streaks, challenges, leaderboards, activity feed | V2.0 |
| Live multi-currency payments beyond XAF | V2+ |
| Gym-owned merch store | V2.5 |
| Platform-wide marketplace | V3.0 |
| Geofence / Bluetooth / WiFi presence detection | V3.0 |
| Per-gym App Store listings | V4+ |
| Custom fonts, full theme systems | V4+ |
| AI features, wearables, corporate wellness | V4+ |
| Dokploy / VPS services | Decision pending |

**Explicit non-goal (privacy model, not a temporary limitation):** Manager/Owner visibility into member progress data is **not planned**. The member + assigned-coach boundary (FR-095) is a product commitment. Any future change requires a recorded decision and member consent handling.

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
| OQ-7 | **Resolved** — re-verification spike passed in full against GymOS's own now-activated business account (`9FmIZg9GBB`), replacing the stand-in account the 2026-07-31 spike passed against (`docs/decisions.md`, 2026-08-13, Story 4.10). Auth+initiate, webhook delivery, and idempotency all confirmed against the real account. **Not yet resolved:** actually routing real member payments through this account is Story 4.12's cutover, still `backlog` — full production reliance on Tara Money (FR-100) remains gated on that separate step. | — | Story 4.12 cutover (backlog) |
| OQ-8 | **Resolved** — no retention/purge policy for progress photos at beta scale; matches this codebase's existing accepted-unbounded-growth convention (`job_runs`, `audit_log`, `otp_resend_attempts`). Revisit if real storage cost emerges. | — | — |
| OQ-9 | **Resolved** — fixed, simplest rule: any member with an active subscription, on any plan type, can book a class. No per-plan class-eligibility flag. | — | — |
| OQ-10 | **Resolved** — all five FR-094 measurement fields ship (waist, chest, hips, arms, thighs); the schema already needs to support all five per FR-094's "any subset" wording. | — | — |
| OQ-11 | **Resolved** — no co-owners; one Owner per gym for the beta. | — | — |
| OQ-12 | WhatsApp/Evolution API compliance and number provisioning; messaging limits and sender identity. | Dev team | FR-117–FR-119 (Stories 2.9/2.10, backlog) |
| OQ-13 | **Resolved** — Tara Money's create-collect + payment-detection flow is confirmed callback/webhook-driven, not poll-based (consistent across every spike to date). The real webhook payload's `businessId` field matched the initiating account (`9FmIZg9GBB`, distinct from the prior stand-in), which is attribution/correlation evidence for per-gym `businessId`/credential scoping (`docs/decisions.md`, 2026-08-13, Story 4.10) — informs but does not by itself confirm fund settlement; Story 4.13's per-gym credential design (AD-15) should independently verify settlement. | — | FR-124, FR-126, FR-128; Story 4.13 |
| OQ-14 | **Resolved** — Tara Money (mobile money) does not support automated recurring debits. Flow B billing for V1.5 is a reminder-to-approve model: GymOS notifies the Owner when payment is due and the Owner completes the charge via Tara Money each cycle. True automated recurring collection is deferred to a future version, pending a card-based provider (e.g. Stripe). See FR-130, FR-133. | — | — |
| OQ-15 | **Resolved** — no proration on mid-cycle SaaS tier change; the new price applies at the next billing cycle. | — | — |

---

## 10. Release Definition — "Beta-Ready" (V1.5)

V1.5 is beta-ready when a gym the founding team has not personally hand-held can:

1. Be created by GymOS (founder-onboarded), then staff itself — add its own Supervisor, Manager, Receptionist, and Coach — with no support ticket (FR-087–FR-092).
2. Take real payments through Tara Money, with the cutover proven clean (FR-099–FR-103, NFR-012).
3. Run the retention loop end to end: front-desk alert (V1.0) plus members returning to the app between visits to log progress (FR-093–FR-098).
4. Operate its weekly rhythm — classes scheduled and booked, workout plans assigned (FR-104–FR-112).
5. Collect its own GymOS platform subscription from gyms via the reminder-driven, Owner-approved billing model (OQ-14, resolved), with zero missed cycles and zero cross-account leakage (FR-130–FR-140, NFR-019, G-12) — the OQ-7 re-verification against GymOS's own activated Tara Money business account is done (resolved), still gated on Story 4.12's cutover before production reliance.
6. Do all of the above bilingually, offline-tolerant where FR-097 requires, with PostHog showing whether the loops work and E2E tests guarding critical paths (NFR-014, NFR-015).

This gate is additive on top of V1.0's already-shipped goals (Section 3.1, G-1–G-6) — a scope layer, not a replacement. Everything in Section 8 is deliberately out, so the beta ships on time rather than growing into V2.

---

## 11. Glossary

| Term | Meaning |
|------|---------|
| RLS | Row-Level Security — PostgreSQL's per-row access control, the primary tenant/role isolation mechanism (FR-005, NFR-001) |
| JWT | JSON Web Token — carries the `gym_id`/`role` claims used for authorization (FR-003) |
| OTP | One-time password, sent via SMS/WhatsApp for phone verification (FR-002) |
| XAF | Central African CFA franc — GymOS's only supported currency in V1.0/V1.5 (FR-026) |
| MoMo | Mobile Money (MTN Mobile Money / Orange Money) |
| SaaS | Software-as-a-Service — here, specifically GymOS's own platform subscription fee charged to gyms (Flow B, FR-130) |
| Flow A / Flow B | The two payment directions in 6.20: Flow A is member→gym, Flow B is gym→GymOS |
| FR / NFR | Functional Requirement / Non-Functional Requirement — stable, never-renumbered IDs (Section 6/7 header note) |
| E2E | End-to-end (test automation), NFR-015 |
| RPC | Remote Procedure Call — a Postgres function invoked from application code, e.g. the staff-creation function (addendum D) |
