---
title: "GymOS — Product Brief"
status: final
created: 2026-06-20
updated: 2026-06-20
version: "1.2"
audience: Development Team
---

# GymOS — Product Brief

## Executive Summary

GymOS is a white-label gym management SaaS built for African fitness businesses. It replaces the fragmented stack of paper records, WhatsApp groups, and spreadsheets that most gym owners rely on today with an integrated platform: a branded member mobile app (Android and iOS), a gym admin dashboard, a coach portal, and a super admin layer for the platform owner.

The product is built around one core thesis — **retention**. Every feature maps to one of three loops: keeping members engaged between visits, catching members who are about to churn, and opening revenue beyond the base SaaS fee. The signature moment is a real-time front-desk alert the instant an expiring member checks in — putting renewal collection at the point of maximum willingness to pay.

V1 targets Cameroon-first gyms with mobile-money payments (MTN MoMo + Orange Money), an Android-first member base, and 1–3 founder-onboarded pilot gyms. The target is a live pilot with real members and real payments in 3–4 months, built by a team of 1–2 full-stack developers.

---

## The Problem

Gym owners in Cameroon and across Africa manage operations with tools that were never designed for this:

- **Paper records and WhatsApp** for member tracking — no audit trail, no history, no alerts
- **Spreadsheets** for payments — cash and mobile-money transactions go unreconciled; revenue disappears silently
- **Manual attendance** — no reliable check-in system; gym occupancy is guesswork
- **Missed renewals** — expiring memberships lapse quietly with no trigger to intervene
- **No coach tools** — coaches manage assigned members through personal messages and memory

The cost is twofold: operational chaos for the gym owner, and invisible churn that compounds month over month.

---

## The Solution

GymOS is a multi-tenant SaaS platform with four distinct surfaces:

| Surface | Stack | Who uses it |
|---|---|---|
| **Member Mobile App** | React Native + Expo (Android + iOS) | Gym members |
| **Gym Admin Dashboard** | Next.js + TypeScript + Tailwind | Gym owners, managers, receptionists |
| **Coach Portal** | Embedded in dashboard (role-based) | Coaches |
| **Super Admin Dashboard** | Next.js (separate access) | GymOS platform owner |

One app binary in the Play Store and App Store serves all gyms. Members log in and the app fetches their gym's branding at runtime — they experience it as their gym's app. Each gym sees only its own data. The platform owner sees across all tenants.

---

## Core Philosophy: The Retention Thesis

Every feature in GymOS maps to one of three retention loops:

| Loop | The Question It Answers | Key Features |
|---|---|---|
| **Keep members coming** | Why open the app on a rest day? | Progress tracking, workout logs, quiet-gym alerts, streaks, activity feed |
| **Catch members leaving** | How do we intervene before they churn? | Renewal alerts, grace periods, front-desk alert on check-in |
| **Monetize the audience** | What revenue exists beyond SaaS fees? | Gym merch store (V2.5), platform marketplace (V3) |

The front-desk alert is the product's signature moment: when an expiring or expired member scans in, the dashboard instantly alerts the receptionist so renewal can be collected face-to-face — at the exact moment the member has already decided to show up.

---

## Who This Serves

**Gym Owners and Managers**
Replace paper, WhatsApp, and Excel. See every franc reconciled, every member's status, and every expiring membership — and catch those members at the door before they quietly disappear.

**Members**
One branded app for gym life: membership status, check-in via QR, workout logging, progress tracking (weight, measurements, photos — private by default), class booking, quiet-gym notifications, and streaks. All offline-aware.

**Coaches**
Manage assigned members, session notes, workout plans, and class schedules from a role-gated view inside the dashboard.

**GymOS Platform Owner**
Full visibility across all tenant gyms: billing, feature tiers, support, and platform-wide metrics. Revenue from SaaS fees plus, eventually, marketplace transaction margin.

---

## Pricing Model

GymOS charges gym owners a recurring subscription fee with monthly and annual billing options. Annual plans carry a discount to incentivize commitment and improve platform cash flow.

- **Billing unit:** per gym — not per member, not per transaction
- **Intervals:** monthly and annual
- **Transaction fees:** passed through to gyms by default; not absorbed by the platform
- **Feature gating:** enforced at the Super Admin layer via the gym's subscription status

> **Open item:** Specific tier names, price points, and per-tier feature limits to be confirmed before the billing and Super Admin onboarding Epic.

---

## What Makes This Different

**Built for the local reality**
- Mobile-money first: MTN MoMo and Orange Money via Notch Pay (primary) and Campay (fallback)
- Cash and bank transfers are first-class payment methods — recorded with mandatory reason, audited — not an afterthought
- Offline-aware mobile app with SQLite queue and sync; works when connectivity is poor
- Android-first member base, iOS shipping from day one via a single Expo codebase
- Bilingual (English + French) from day one — no localization retrofit later

**The retention moment competitors miss**
The front-desk renewal alert at check-in is not a report buried in a dashboard. It is a real-time interrupt at the exact operational moment — member walks in — where the gym can act.

**Audit trail by design**
Every manual payment action is recorded with actor, method, mandatory reason, and timestamp. The audit log is append-only at the database level. Compliance is built in, not bolted on.

**Progress tracking without the body-comparison trap**
Body logs (weight, measurements, photos) are private by default and never surfaced socially. Activity feeds share consistency signals only — streaks and check-ins, never body data. Leaderboards rank consistency, not physique.

---

## Technical Stack

| Layer | Technology | Why |
|---|---|---|
| Member App | React Native + Expo + TypeScript | Single codebase to Android + iOS; QR, camera, push, offline SQLite built in |
| Admin Dashboard | Next.js + TypeScript + Tailwind | Protected routes; server-side logic for sensitive operations |
| Backend | Supabase Cloud | PostgreSQL + Auth + Realtime + Storage + Edge Functions |
| Database | PostgreSQL with RLS | Multi-tenant row-level security; suited for payments, audits, SaaS |
| Payments | Notch Pay / Campay SDKs | Mobile money aggregation; Cameroon-first |
| Mobile Shipping | EAS Build + Submit | Cloud builds; no Mac required for iOS; TestFlight + Play Store internal testing |
| Error Tracking | Sentry (dashboard + mobile) | Unified error visibility across both surfaces |

**Monorepo structure (V1):**
```
gymos/
  apps/mobile/          # Expo + Router → Android & iOS
  apps/dashboard/       # Next.js App Router
  packages/types/       # Shared TypeScript + Zod schemas
  supabase/
    migrations/
    functions/
  docs/decisions.md
```

Deferred until duplication hurts: `apps/marketing`, `packages/ui`, `packages/validators`.

---

## Deployment & Hosting

| Service | Hosting |
|---|---|
| Next.js Dashboard | Vercel |
| Supabase (DB, Auth, Realtime, Storage, Edge Functions) | Supabase Cloud |
| Mobile App | EAS Build + Submit |
| Additional services | Dokploy on VPS — **decision pending for V1.5** |

---

## Key Design Decisions

These decisions are final unless explicitly revisited. New decisions should be recorded in `docs/decisions.md`.

| Decision | Resolution | Rationale |
|---|---|---|
| Payment aggregator | Notch Pay primary, Campay fallback | Structured docs, sandbox, Yaoundé support; gated by one-day sandbox spike |
| Manual payments | First-class: cash, bank, manual MoMo — mandatory reason + audit log | Core to African gym reality, not an edge case |
| Identity rule | One phone = one platform user; multi-gym via separate `members` rows | Prevents duplicate accounts; simplifies auth |
| Refund posture | V1 records refunds; provider-API execution deferred | Reduces V1 complexity; gym pays member out-of-band |
| Mobile shipping | Single Expo codebase → Android + iOS via EAS | Velocity over native; iOS in-app purchase exemption applies (physical service) |
| Fee passthrough | Transaction fees passed to gyms by default | Member-pays-surcharge option deferred |
| Occupancy display | Three member-facing bands (Low / Medium / Busy); raw counts and 91%+ "Full" threshold dashboard-only | Avoids discouraging visits while giving ops the full picture |
| Money storage | Integer amount + explicit `currency` column | No float precision issues; multi-currency ready from day one |
| Audit log | Append-only — no UPDATE/DELETE for any role | Compliance by design |
| Body data | Private by default; no social surface | Avoids body-comparison harm |
| Language | Bilingual English + French via i18n from V1; no hardcoded UI strings | Cameroon bilingual market; foundation for future expansion |
| White-label app | One binary; branding (logo, name, primary color) applied at runtime per `gym_id` | Single build serves all gyms; per-gym App Store listings deferred to V4+ |
| Currency scope | XAF in V1; `currency` column present from day one | No schema rework when NGN, GHS, and other markets open at V2+ |
| Timezone | UTC stored in DB; displayed in each gym's configured timezone (default: Africa/Douala) | Multi-timezone ready without schema changes |
| Observability | Sentry for errors (V1); PostHog deferred to V1.5 | Right-sized for pilot; no product analytics before pilot data exists |

---

## Platform Specifications

### Localization

The platform is bilingual from V1: **English and French**.

- All UI strings, push notification copy, onboarding flows, and error messages are available in both languages
- Language is user-selectable in the mobile app and dashboard; default detected from device/browser locale
- i18n library choice is left to the team (e.g., `react-i18next` for both Next.js and Expo); all string literals must be externalized — no hardcoded UI text anywhere
- Document output (receipts, reports) follows the gym owner's language preference
- The i18n foundation built in V1 supports future language additions without rework

### Branding / White-Label

Each gym configures its branded identity in the dashboard Settings:

- **Gym name** — displayed in the app header and onboarding screens
- **Logo** — uploaded via dashboard, stored in Supabase Storage, served from CDN
- **Primary color** — single hex value applied to buttons, accents, and navigation highlights in the member app

Branding is fetched at app launch per `gym_id` and applied at runtime. One binary serves all gyms. Per-gym App Store listings, custom fonts, and full theme systems are deferred to V4+.

### Currency

- **V1:** XAF (CFA Franc) only — stored as integers (whole francs, no floats)
- **Schema:** every monetary value stored with an explicit `currency` column alongside the integer amount from day one
- **Display:** amounts formatted per locale (XAF in V1; other currencies as markets expand)
- **V2+ expansion:** Nigeria (NGN), Ghana (GHS), and other African markets anticipated; payment provider support validated per market before launch

### Timezone

- All timestamps stored in UTC in the database
- Displayed in each gym's configured timezone (default: **Africa/Douala, GMT+1**)
- Gym timezone stored as a configurable field on the `gyms` table from V1 — the display layer reads this field, not a hardcoded constant
- No schema changes required when expansion markets with different timezones are added

### Gym Onboarding (V1)

V1 gyms are **founder-onboarded** — no self-serve signup. The process:

1. GymOS provides a **CSV template** with standardized columns (member name, phone, plan type, join date, subscription status, expiry date)
2. The gym fills in the template with their existing member list
3. The gym admin dashboard includes a **CSV import tool** to load the member list
4. Payment history and attendance records: **start fresh** — no historical data migrated
5. GymOS team assists with data entry for pilot gyms where needed

Self-serve gym signup is deferred to post-V1.

### Push Notifications

All push notifications route through **Expo Push Notification Service** → FCM (Android) + APNs (iOS).

| Notification | Trigger | Version |
|---|---|---|
| Membership expiring — 7 days out | 7 days before expiry | V1 |
| Membership expiring — 1 day out | 1 day before expiry | V1 |
| Membership expired | On expiry date | V1 |
| Payment confirmed | Payment webhook success | V1 |
| Payment failed | Payment webhook failure | V1 |
| Quiet-gym alert | Occupancy drops to Low (opt-in, max 2/day, min 3hr gap) | V1.5 |
| Class reminder | 60 minutes before a booked class | V1.5 |

- Notification preferences stored per member in `member_preferences`
- Push tokens stored per device; stale tokens cleaned up on delivery failure
- All notification copy available in English and French per member's language preference

### Non-Functional Requirements

**Pilot scale:**
- ~30 members per gym at launch; 1–3 gyms on the platform
- Architecture (RLS, multi-tenant schema) designed to scale to hundreds of gyms and thousands of members per gym without rework — the 30-member figure is a pilot expectation, not an architectural ceiling

**Performance targets (V1):**
- Dashboard page load: under 2 seconds on standard broadband
- QR check-in → front-desk alert: under 3 seconds end-to-end
- Mobile app: offline-capable for check-in and workout logging; sync queued on reconnection

**Uptime:** Supabase Cloud and Vercel managed SLAs cover the platform in V1. No additional uptime commitment before commercial scale.

### Testing Strategy

| Area | Approach | Version |
|---|---|---|
| RLS policies | Automated tests in CI against multi-gym fixtures, including cross-tenant and role-boundary edge cases | V1 |
| Payment flows | Integration tests against Notch Pay sandbox (webhook processing, reconciliation, idempotency) | V1 |
| Mobile app | Manual QA on physical Android device before each release; iOS via TestFlight | V1 |
| Dashboard | Manual QA in V1; no automated E2E (team too small, surface too volatile) | V1 |
| E2E automation | Revisit at V1.5 when team and feature surface stabilize | V1.5 |
| Product analytics | PostHog deferred — no pilot data to act on yet | V1.5 |

CI runs on every PR: RLS tests + payment integration tests + TypeScript type checks.

---

## V1.0 Scope — Must-Have

**Infrastructure**
- Multi-tenant PostgreSQL schema with RLS; role hierarchy: Member → Coach → Receptionist → Manager → Owner → Super Admin
- Phone-verified registration; one phone = one platform user; multi-gym via separate `members` rows
- Bilingual UI (English + French) with i18n; all strings externalized
- Gym branding (logo, name, primary color) configured in dashboard and applied at runtime in the mobile app
- Gym timezone configurable from V1; `currency` column on all monetary values

**Payments**
- Membership plans: pay-per-session, monthly, coach-inclusive, class-only, travel mode
- Notch Pay (primary) + Campay (fallback); gated by one-day sandbox spike before Epic 5
- Mobile-money webhook + scheduled reconciliation; idempotent processing
- Manual/cash payments: mandatory reason, actor, timestamp, audit-logged
- Subscription lifecycle: active → expiring\_soon → grace\_period → expired
- Refund recording in V1; provider-executed refunds deferred

**Attendance and Occupancy**
- QR-based check-in, manual check-out, configurable auto-timeout
- One open check-in per member enforced by partial unique index
- Three member-facing occupancy bands: Low / Medium / Busy; raw numbers dashboard-only
- Real-time front-desk alert via Supabase Realtime when expiring or expired member checks in

**Notifications**
- Membership expiring: 7-day and 1-day push alerts
- Membership expired: same-day push
- Payment confirmed and payment failed: immediate push

**Gym Admin Dashboard Pages**
Overview · Members · Subscriptions · Payments (with verification queue) · Attendance · Audit Log · Settings (branding, language, timezone)

**Member Mobile App**
Phone-verified sign-up, onboarding (goal / experience / plan), home screen, QR check-in scanner, membership status, profile, language selector

**Gym Onboarding**
CSV import tool in dashboard; GymOS-provided member list template; manual data entry support for pilot gyms

**Shipping**
Android + iOS via EAS Build + Submit; single Expo codebase; bundle ID `com.gymos.app`

---

## What Is Explicitly Out of V1

- Self-serve gym signup
- Coach portal and class scheduling (V1.5)
- Workout plans and progress tracking (V1.5)
- Quiet-gym alerts and class reminders (V1.5)
- PostHog / product analytics (V1.5)
- E2E test automation (V1.5)
- Dokploy/VPS services (decision pending for V1.5)
- Live multi-currency payments beyond XAF (V2+)
- Marketplace / merch store (V2.5+)
- Provider-executed refunds
- Full white-label theme system and per-gym App Store listings (V4+)
- Geofence / Bluetooth / WiFi presence detection (V3)
- AI features, wearables, corporate wellness (V4+)

---

## Roadmap

| Version | Focus | Timeline |
|---|---|---|
| **1.0** | Money + attendance core: payments, subscriptions, check-in, occupancy, front-desk renewal alert, bilingual UI | 3–4 months |
| **1.5** | Coaches, classes, workout plans, progress tracking, quiet-gym alerts, basic reports, E2E tests, PostHog | TBD |
| **2.0** | Travel mode, meal logging, streaks, challenges, leaderboards, activity feed (opt-in sharing), NGN/GHS markets | TBD |
| **2.5** | Gym-owned merch store | TBD |
| **3.0** | Platform-wide marketplace, geofence/Bluetooth/WiFi detection, branch management | TBD |
| **4.0+** | Wearables, corporate wellness, coach marketplace, franchise, per-gym branded App Store listings | TBD |

---

## Success Criteria

1. **Operational trust** — every franc audited, no silent payment failures, all manual actions traceable
2. **Retention moment lands** — front-desk alert catches expiring members at check-in in live pilot
3. **Member re-engagement** — progress tracking and quiet-gym alerts drive app opens on rest days (V1.5)
4. **Multi-tenant foundation holds** — RLS and schema support scaling to new gyms without rework
5. **Shipping velocity** — one Expo codebase ships to both stores; sandbox spike gates payment decisions
6. **Localization correct** — all UI and notifications render in English and French with no missing strings
7. **First live pilot** — 3–4 months to a gym with real members, real payments, and renewals collected at the desk

---

*GymOS development team · v1.2 final · 2026-06-20*
