---
title: GymOS PRD — Addendum
type: addendum
linked_prd: prd.md
created: 2026-06-20
updated: 2026-06-20
---

# GymOS PRD — Addendum

> This addendum holds content that belongs downstream (architecture, solution design) or earned a place in the record but does not fit the PRD's capability narrative. The PRD is the authoritative requirements document; this file is supplementary context.

---

## A. Technical Stack

Captured here for team reference; not a PRD requirement. Stack decisions are final unless revisited via `docs/decisions.md`.

| Layer | Technology | Notes |
|-------|-----------|-------|
| Member App | React Native + Expo + TypeScript | Single codebase → Android + iOS; QR, camera, push, offline SQLite |
| Admin Dashboard | Next.js + TypeScript + Tailwind CSS | App Router; protected routes; SSR for sensitive operations |
| Backend | Supabase Cloud | PostgreSQL + Auth + Realtime + Storage + Edge Functions |
| Database | PostgreSQL with RLS | Multi-tenant row-level security |
| Payments | Notch Pay SDK (primary) / Campay SDK (fallback) | Mobile-money aggregation; Cameroon-first |
| Mobile Shipping | EAS Build + Submit | Cloud builds; no Mac required for iOS |
| Error Tracking | Sentry | Dashboard + mobile; single project, environment-tagged |
| i18n | react-i18next (recommended) | Both Next.js and Expo; all strings externalized |

---

## B. Monorepo Structure

```
gymos/
  apps/mobile/          # Expo + Router → Android & iOS
  apps/dashboard/       # Next.js App Router
  apps/super-admin/     # Next.js (separate access)
  packages/types/       # Shared TypeScript + Zod schemas
  supabase/
    migrations/
    functions/
  docs/decisions.md
```

Deferred until duplication hurts: `apps/marketing`, `packages/ui`, `packages/validators`.

---

## C. Deployment & Hosting

| Service | Hosting |
|---------|---------|
| Next.js Dashboard | Vercel |
| Next.js Super Admin | Vercel (separate deployment) |
| Supabase (DB, Auth, Realtime, Storage, Edge Functions) | Supabase Cloud |
| Mobile App | EAS Build + Submit |
| Additional services | Dokploy on VPS — decision pending for V1.5 |

---

## D. Key Architectural Decisions

These decisions are final unless explicitly revisited via `docs/decisions.md`. Reproduced here from the brief for downstream architect reference.

| Decision | Resolution | Rationale |
|----------|-----------|-----------|
| Payment aggregator | Notch Pay only in V1, behind a PaymentProvider interface; Campay deferred to V2 | Dual-provider = 2x integration work for a 1–2 dev team on a 3–4 month timeline; abstraction costs ~2 hours and slots Campay in cleanly later |
| Manual payments | First-class: cash, bank, manual MoMo — mandatory reason + audit log | Core to African gym reality |
| Identity rule | One phone = one platform user; multi-gym via separate `members` rows | Prevents duplicate accounts; simplifies auth |
| Refund posture | V1 records refunds; provider-API execution deferred | Reduces V1 complexity |
| Mobile shipping | Single Expo codebase → Android + iOS via EAS | Velocity over native |
| Fee passthrough | Transaction fees passed to gyms by default | Member-pays-surcharge option deferred |
| Occupancy display | Three member-facing bands; raw counts and 91%+ threshold dashboard-only | Avoids discouraging visits while giving ops the full picture |
| Money storage | Integer amount + explicit `currency` column | No float precision issues; multi-currency ready from day one |
| Audit log | Append-only — no UPDATE/DELETE for any role | Compliance by design |
| Body data | Private by default; no social surface | Avoids body-comparison harm (V1.5 progress tracking) |
| Language | Bilingual EN + FR via i18n from V1; no hardcoded strings | Cameroon bilingual market; foundation for expansion |
| White-label app | One binary; branding applied at runtime per `gym_id` | Single build serves all gyms |
| Currency scope | XAF in V1; `currency` column present from day one | No schema rework for NGN, GHS expansion |
| Timezone | UTC stored in DB; displayed in gym's configured timezone (default: Africa/Douala) | Multi-timezone ready without schema changes |
| Observability | Sentry for errors (V1); PostHog deferred to V1.5 | Right-sized for pilot |
| QR check-in direction | Member scans gym's static entrance QR with the member app | Confirmed 2026-06-20 (overrides brief ambiguity) |
| Grace period | Gym-configurable duration per gym; platform default 3 days | Confirmed 2026-06-20 |
| Coach portal | Exists in V1 (assigned members + session notes); workout plans and classes V1.5 | Confirmed 2026-06-20 (overrides brief's V1.5 assignment) |
| Travel mode | Deferred to V2.0; removed from V1 plan types | Cross-gym RLS query undefined; footgun risk if plan type exists without supporting logic |
| Campay | Deferred to V2; V1 uses Notch Pay only behind PaymentProvider interface | Timeline risk for 1–2 dev team; see decision log #5 |
| Supabase region | EU West (Ireland or Frankfurt); US East prohibited | Intercontinental latency makes <3s front-desk alert NFR unachievable from Cameroon |

---

## E. V2.0 Design Guardrails

These constraints apply to V2.0 features (activity feed, leaderboards, progress tracking). They are not in V1 scope but must travel with V2.0 story writing to preserve the product's original intent.

| Feature | Constraint |
|---------|-----------|
| Activity feed | Share consistency signals only — check-ins and streaks. Never surface body data (weight, measurements, photos) in any social feed. |
| Leaderboards | Rank consistency (attendance streaks, session count), not physique or weight. |
| Progress tracking | Body logs (weight, measurements, photos) are private by default and never surfaced socially, not even with member consent — opt-in social comparison is explicitly out of scope. |
| Quiet-gym alerts | Intended to encourage visits, not to shame inactivity. Copy must be framed as an invitation ("The gym is quiet — good time to come in") not a reminder of absence. |

These guardrails reflect the brief's explicit stance: "progress tracking without the body-comparison trap."

---

## F. Roadmap Context

For downstream planning reference:

| Version | Focus |
|---------|-------|
| V1.0 | Money + attendance core: payments, subscriptions, check-in, occupancy, front-desk renewal alert, coach portal (basic), bilingual UI |
| V1.5 | Coaches (full), classes, workout plans, progress tracking, quiet-gym alerts, reports, E2E tests, PostHog |
| V2.0 | Travel mode (full), meal logging, streaks, challenges, leaderboards, activity feed, NGN/GHS markets |
| V2.5 | Gym-owned merch store |
| V3.0 | Platform-wide marketplace, geofence/BT/WiFi detection, branch management |
| V4.0+ | Wearables, corporate wellness, coach marketplace, franchise, per-gym branded App Store listings |
