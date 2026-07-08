---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-gym_os-2026-06-20/prd.md
  - _bmad-output/planning-artifacts/prds/prd-gym_os-2026-06-20/addendum.md
  - _bmad-output/planning-artifacts/prds/prd-gym_os-2026-06-20/reconcile-brief.md
  - _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md
  - _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/DESIGN.md
  - _bmad-output/planning-artifacts/briefs/brief-gym_os-2026-06-20/brief.md
workflowType: 'architecture'
project_name: 'gym_os'
user_name: 'smartsana'
date: '2026-07-04'
lastStep: 8
status: 'complete'
completedAt: '2026-07-04'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**

85 FRs across 16 categories (Platform Foundation, Gym Setup & Onboarding, White-Label Branding, Localization, Member Management, Membership Plans, Subscription Lifecycle, Payments, Attendance & Occupancy, Retention Triggers, Coach Portal, Member Mobile App, Gym Admin Dashboard, Super Admin Dashboard, Push Notifications, Audit Log). No epics/stories document exists yet — this analysis works directly from the PRD.

Architecturally, three clusters dominate:
- **Tenancy & identity** (FR-001–006, FR-070–072): phone-based identity, per-gym `members` rows against one platform user, RLS-enforced isolation, Super Admin as a platform-wide role that bypasses per-gym RLS under audit-logged escalation.
- **Money & lifecycle** (FR-024–041, FR-027–032): plan types, integer XAF + currency column, Notch Pay behind a `PaymentProvider` interface, idempotent webhooks, a four-state subscription lifecycle (`active → expiring_soon → grace_period → expired`) driven by a scheduled job.
- **Real-time retention loop** (FR-042–052): QR check-in, one-open-check-in-per-member invariant, and the front-desk alert — the product's signature real-time interaction.

**Non-Functional Requirements:**

10 NFRs. The load-bearing ones: NFR-001 (RLS as the sole tenancy enforcement layer, hook spiked before any policy is written), NFR-002 (webhook signature validation), NFR-003/FR-026 (integer money, no floats), NFR-004 (audit log append-only, enforced at the grant level), NFR-009 (schema must scale to hundreds of gyms without RLS rework despite a ~30-member pilot), NFR-010 (Supabase region pinned to EU West for the front-desk alert's <3s budget).

**Scale & Complexity:**

- Primary domain: full-stack multi-tenant SaaS (Postgres/Supabase backend, two Next.js web apps, one React Native/Expo mobile app, one payment integration).
- Complexity level: medium-high — driven by correctness requirements (tenant isolation, financial idempotency, an appendonly audit trail, a hard real-time SLA), not by data volume. Pilot scale is ~30 members across 1–3 gyms; architecture must not require rework at hundreds of gyms.
- Estimated architectural components: 2 web apps (gym dashboard, super admin) sharing one Next.js codebase pattern, 1 mobile app, Postgres schema with RLS as the authorization layer, a thin service layer per domain, 1 Edge Function (payment webhook), 3 independent scheduled jobs, Supabase Auth + Realtime + Storage.

### Technical Constraints & Dependencies

- Stack is substantially pre-decided in the PRD addendum: Supabase Cloud (Postgres, Auth, Realtime, Storage, Edge Functions), Next.js + Tailwind for both dashboards, Expo + EAS for the single mobile codebase, Sentry as the sole V1 observability tool, a monorepo (`apps/mobile`, `apps/dashboard`, `apps/super-admin`, `packages/types`, `supabase/`).
- Notch Pay is the sole V1 payment aggregator, gated by a one-day sandbox spike (auth, initiate, webhook, idempotency) — the Payments Epic does not start until this passes or a validated alternative is documented.
- Supabase region must be EU West (Ireland or Frankfurt); this is locked before project creation since it cannot change after data is written. Confirmed as correct in principle, but the underlying RTT assumption should be measured from a Cameroonian mobile network alongside the Notch Pay spike, not just asserted.
- i18n (EN/FR) is enforced by a CI gate that fails builds containing hardcoded UI strings — this is a build-pipeline requirement, not just a code convention.

### Cross-Cutting Concerns Identified

- **RLS/tenancy enforcement** — touches every table and every query; the JWT custom-claims hook (`gym_id`, `role`) is the single point of failure beneath all of it and fails closed to deny-all if misconfigured.
- **Role-based access** — touches every UI surface and route across four client surfaces (Member App, Admin Dashboard, Coach Portal, Super Admin).
- **i18n** — touches every string, CI-enforced.
- **Audit logging** — touches every mutating action; append-only by policy and by grant.
- **Real-time delivery** — touches the check-in → front-desk alert path; carries a hard <3s latency budget and needs an explicit degrade path, not just a fast region.
- **Money handling** — touches payments, subscriptions, refunds, receipts; integer + currency column, idempotent webhook processing.

### Working Decisions (from collaborative review)

These were stress-tested via a cross-functional round table (architecture, engineering, product perspectives) and are carried forward as settled inputs to the technology and pattern decisions ahead, rather than left open:

| Area                               | Decision                                                                                                                                                                                                                                  | Rationale                                                                                                                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Background jobs                    | Three independent `pg_cron` triggers (subscription lifecycle, payment reconciliation, check-in auto-timeout), each in its own function/transaction, each logging to a `job_runs` table (job_name, started_at, finished_at, status, error) | A single shared trigger means one job's failure can silently block or corrupt the others; per-team observability budget for V1 is a queryable status table, not a job queue |
| JWT claims hook                    | Implemented as a Postgres function (not an HTTP Edge Function), pgTAP-tested in isolation, with a CI canary test asserting a known test tenant sees a non-zero, correctly-scoped row count                                                | The failure mode is silent deny-all, not an error — it must be caught by an automated canary, not discovered at a pilot demo                                                |
| Edge Functions                     | Reserved for the Notch Pay webhook receiver only (signature verification + idempotent write)                                                                                                                                              | Deno is a second runtime with a thinner Sentry/debugging story; minimizing its footprint keeps a 1-2 person team in one runtime (Next.js/Node) for everything else          |
| Repository pattern                 | Rejected in favor of a thin per-domain service layer (`services/subscriptions.ts`, etc.) wrapping `supabase-js`, typed via `packages/types`                                                                                               | RLS is the authorization layer and lives in the database; an app-side repository would be a second, driftable copy of the same rules                                        |
| RLS policy strategy                | One `STABLE` SQL helper (`auth.gym_id()`) reused across all policies; explicit per-action (SELECT/INSERT/UPDATE/DELETE) policies per table, not `FOR ALL`; grant-level `REVOKE UPDATE, DELETE` on the audit log beneath the policy layer  | Centralizes the one place tenancy logic can go wrong; grant-level revoke protects against `service_role` bypassing RLS entirely                                             |
| Realtime degrade path              | Dashboard falls back to short-interval polling if the Supabase Realtime channel drops, instead of silently receiving no alerts                                                                                                            | A retention-critical alert that fails silently is worse than no alert — the gym believes the safety net exists when it doesn't                                              |
| Region verification                | EU West is the right call in principle, but actual RTT from Cameroonian mobile networks should be measured alongside the Notch Pay sandbox spike before the region is locked in production                                                | A <3s budget is tight enough that region choice needs verification, not just a documented assumption                                                                        |
| Job queue (BullMQ/graphile-worker) | Explicitly rejected for V1                                                                                                                                                                                                                | A single nightly batch with no retry-with-backoff requirement does not justify the added moving part for a 1-2 person team                                                  |

## Starter Template Evaluation

### Primary Technology Domain

Full-stack multi-app monorepo — two Next.js web apps (gym dashboard, super admin) plus one Expo/React Native mobile app, all against one Supabase backend. No single starter template covers this shape; the right approach is composing verified per-app starters under one monorepo tool.

### Starter Options Considered

| Piece                  | Option                                                                                              | Verdict                                                                                                                                                                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo tooling       | Turborepo + pnpm workspaces                                                                         | **Selected** — the 2026 default combination for this shape (Next.js + Expo + shared packages); Turborepo orders builds so `packages/types` builds before the apps that depend on it, pnpm gives efficient disk usage and strict peer resolution |
| Next.js dashboards     | Official `with-supabase` example (`npx create-next-app -e with-supabase`)                           | **Selected** for both `apps/dashboard` and `apps/super-admin` — ships cookie-based Supabase Auth via `@supabase/ssr`, TypeScript, Tailwind, App Router out of the box; maintained in the Next.js examples repo and by Supabase/Vercel           |
| Mobile app             | `npx create-expo-app` (Expo Router is now the default) + Supabase's official Expo quickstart wiring | **Selected** — Expo Router ships by default in current `create-expo-app`; Supabase's Expo quickstart is the reference integration for auth + client setup                                                                                       |
| Alternative considered | `create-expo-stack` (community CLI bundling Expo Router + Supabase + Nativewind in one command)     | Rejected for V1 — convenient, but a third-party abstraction over choices a 1-2 person team should make and understand explicitly in one extra step                                                                                              |

Versions verified 2026-07-04: Next.js 16.2.10 (current LTS), Expo SDK 57.0.1 (React Native 0.86, React 19.2), Turborepo 2.x + pnpm workspaces.

### Selected Starter Composition

**Initialization commands:**

```bash
# Monorepo root
pnpm dlx create-turbo@latest gymos --package-manager pnpm

# Dashboards (run twice, once per app)
npx create-next-app@latest -e with-supabase apps/dashboard
npx create-next-app@latest -e with-supabase apps/super-admin

# Mobile
npx create-expo-app@latest apps/mobile
cd apps/mobile && npx expo install @supabase/supabase-js @react-native-async-storage/async-storage
```

**Architectural Decisions Provided by Starters:**

**Language & Runtime:** TypeScript everywhere; Node 20+ (Next.js 16's minimum).

**Styling Solution:** Tailwind CSS on both dashboards (matches `DESIGN.md` tokens directly); the Expo app styles independently since Tailwind doesn't apply to React Native — NativeWind is a possible V1.5 addition, not required for the current UX spec.

**Build Tooling:** Turbopack (Next.js 16 default bundler) for the dashboards; Metro for Expo. Turborepo orchestrates both plus `packages/types` build order.

**Testing Framework:** Not inherited from any starter — decided explicitly in the next step rather than implicitly.

**Code Organization:** App Router (`app/`) directory convention on both dashboards; Expo Router (`app/`) directory convention on mobile — the same file-based-routing mental model across all three apps, lowering context-switching cost for a solo/two-person team.

**Development Experience:** `@supabase/ssr` cookie-based session handling pre-configured on the dashboards — this is exactly what the custom-claims JWT hook (from Project Context Analysis) needs to hook into.

**Note:** Project initialization using these commands should be the first implementation story.

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
- JWT custom-claims hook as a Postgres function, CI canary tested, before any RLS policy is written
- RLS policy strategy (`auth.gym_id()` helper, explicit per-action policies, grant-level `REVOKE` on the audit log)
- Notch Pay sandbox spike (payments) and SMS/OTP provider Cameroon-coverage spike (auth) — both sprint-1, both gate their respective Epics
- `OtpDeliveryProvider` abstraction behind Supabase's Send SMS Hook, so OTP delivery is swappable without reworking onboarding

**Important Decisions (Shape Architecture):**
- Three independent `pg_cron` jobs + `job_runs` table instead of one shared trigger
- Thin per-domain service layer, no repository pattern
- Supabase Branching for staging/PR-preview environments instead of a hand-provisioned separate project
- TanStack Query + Supabase Realtime for the front-desk alert panel and other live dashboard surfaces; Server Components for read-heavy pages
- Realtime degrade path: dashboard falls back to polling if the Realtime channel drops

**Deferred Decisions (Post-MVP):**
- WhatsApp OTP delivery — architecturally a drop-in second `OtpDeliveryProvider` implementation, not built for V1 (no FR requires it; avoids gating the pilot on WhatsApp Business Platform approval)
- Shared `packages/ui` component library — deferred until duplication between the two dashboards actually hurts
- NativeWind / Tailwind-for-React-Native on the mobile app — current UX spec doesn't need it
- Redis or any external cache layer — no scale justification at pilot size

### Data Architecture

- **Modeling conventions:** Postgres `enum` types for closed sets (`subscription_status`, `plan_type`, `payment_method`); UUID primary keys via `gen_random_uuid()` except high-write append-only tables (attendance, audit_log), which use `bigint identity` plus a separate UUID for external reference; `created_at`/`updated_at` in UTC on every table; soft-delete via a `deactivated_at` timestamp, never a boolean flag (FR-019).
- **Validation:** Zod schemas live in `packages/types` as the single source of truth, consumed by both Next.js apps and the Expo app at every write boundary (forms, Server Actions, the payment Edge Function).
- **Migrations:** Supabase CLI migrations (`supabase/migrations/*.sql`) applied via `supabase db push` in CI. **Supabase Branching** — a persistent branch for staging/pilot, ephemeral preview branches per PR — replaces hand-provisioning a separate staging project; each PR validates its own migrations and RLS changes against an isolated schema copy before merge.
- **Caching:** None beyond Next.js's built-in request memoization and the already-specified 24h on-device branding cache (FR-011/012). No Redis or external cache layer for V1 — unjustified at 30 members/gym, 1–3 gyms.

### Authentication & Security

- **Member auth:** Supabase Auth phone/OTP. Supabase owns OTP generation, expiry, and verification (not Twilio Verify's hosted OTP service, which would bypass Supabase's own OTP table).
- **OTP delivery — provider-swappable by design:** an `OtpDeliveryProvider` interface (`send(phone, code, locale): Promise<DeliveryResult>`), wired in via Supabase's **Send SMS Hook**, mirroring the `PaymentProvider` pattern already used for Notch Pay. V1 ships one concrete implementation (`TwilioSmsProvider`, pending its own Cameroon-coverage sandbox spike, run in sprint 1 alongside the Notch Pay spike). Local SMS aggregators or a `WhatsAppOtpProvider` (via WhatsApp Business Platform) become drop-in second implementations later without reworking the onboarding flow. SMS-only at launch — WhatsApp is explicitly deferred (see Decision Priority Analysis).
- **Test OTP for dev/staging/CI:** `SMS_TEST_OTP` (a phone-number → fixed-code map, e.g. `+237600000000:000000`) configured in `supabase/config.toml` for local dev and the staging branch **only**, using a small explicitly-reserved set of test numbers, never a wildcard. Backs CI/E2E onboarding tests and the SMS-provider sandbox spike without sending real SMS. **Guardrail:** promoting config to the production Supabase project must explicitly drop `SMS_TEST_OTP` — this is documented as a required step in the deployment checklist, since a leaked test OTP in production would let anyone authenticate as any phone number.
- **OTP resend/lockout enforcement:** server-side (a Postgres function or Edge Function tracking attempt counts + timestamps per phone number), enforcing the 3-resend/5-minute-lockout rule (FR-058, step 1a) regardless of client behavior — the UX spec's countdown is a client-side reflection of server-enforced state, not the enforcement itself.
- **Dashboard/Coach/Super Admin auth:** Supabase Auth email + password (per UX spec AD-01/SA-01) — no alternative needed.
- **Authorization:** RLS is the sole tenancy/role enforcement layer (see Project Context Analysis working decisions) — `auth.gym_id()` helper, explicit per-action policies, grant-level `REVOKE UPDATE, DELETE` on the audit log.
- **API security:** Zod validation at every write boundary; Notch Pay webhook signature verification (NFR-002) in the Edge Function before any DB write.

### API & Communication Patterns

- **No custom REST/GraphQL API.** Both dashboards and the mobile app call Supabase directly via `supabase-js`/`@supabase/ssr`, routed through the thin per-domain service layer — RLS is the authorization boundary, not an API gateway. Operations with business logic beyond CRUD (member invite generation, CSV import validation, renewal orchestration) go through **Next.js Server Actions**, never raw client-side inserts.
- **Type generation:** `supabase gen types typescript` → `packages/types`, run in CI to catch schema/type drift on every PR — this is the de facto contract between Postgres and all three apps.
- **Error handling:** a single error-mapping utility (in `packages/types` or a shared package) mapping Postgres/RLS error codes to the UX spec's exact copy ("You don't have permission to do that", "Something went wrong on our end"), used identically by both dashboards and mobile so EN/FR copy never drifts per-app.
- **Rate limiting:** Supabase Auth's built-in login-attempt limits; custom OTP attempt-tracking (Authentication & Security) for resend/lockout. No additional API-gateway rate limiting needed since there's no custom API surface beyond auth.

### Frontend Architecture

- **State management:** Next.js Server Components for initial page data (Members, Payments, Audit Log tables); **TanStack Query** on the client for interactive pieces — filtered/searched tables, the front-desk alert panel merging Supabase Realtime events into query cache, CSV import progress polling.
- **Component library:** shadcn/ui (included by the `with-supabase` starter), styled against `DESIGN.md`'s three brand tokens. No shared `packages/ui` for V1 (per addendum: deferred until duplication hurts).
- **Mobile state/data:** direct Supabase Realtime subscriptions + local component state; SQLite (`expo-sqlite`) scoped only to the offline check-in queue (FR-061) — no client-side cache library, since the mobile app's data needs are far simpler than the dashboards'.
- **Routing:** App Router (dashboards) / Expo Router (mobile) — provided by the selected starters.

### Infrastructure & Deployment

- **Hosting:** Vercel (both Next.js apps, separate deployments), Supabase Cloud (EU West, pending RTT verification), EAS Build + Submit for mobile (with `eas build --local` kept as a known-working fallback against EAS queue times before a pilot demo).
- **CI/CD:** GitHub Actions — one workflow running TypeScript checks, RLS policy tests (pgTAP against a Supabase preview branch), Notch Pay sandbox integration tests, and the i18n hardcoded-string lint gate on every PR (matches PRD Section 7.5 exactly).
- **Environments:** local dev via Supabase CLI + Docker; one persistent Supabase Branch as staging/pilot; production as a separate Supabase project once past pilot. Sentry environment tags map to `dev` / `staging` / `prod` (NFR-007).
- **Scaling:** no action beyond Supabase's default connection pooling (pgbouncer) — NFR-009's "must scale to hundreds of gyms" is a schema/RLS design property (already addressed), not an infra-provisioning concern at pilot scale.

### Decision Impact Analysis

**Implementation sequence:**
1. Monorepo + starter initialization (Turborepo, both Next.js apps, Expo app)
2. JWT claims hook (Postgres function) + its negative/canary test
3. Core schema + RLS policies (enums, soft-delete convention, `auth.gym_id()` helper, per-action policies, audit-log grant revoke) + RLS CI tests
4. `job_runs` table + three independent `pg_cron` jobs
5. SMS/OTP provider spike (`TwilioSmsProvider` behind `OtpDeliveryProvider`, `SMS_TEST_OTP` for dev/staging) run in parallel with the Notch Pay sandbox spike
6. Payment integration (Edge Function webhook, idempotency, reconciliation job)
7. Service layer + Server Actions for business-logic operations (CSV import, invites, renewals)
8. Frontend build-out (Server Components + TanStack Query + shadcn/ui) once data layer is stable
9. Realtime front-desk alert + polling degrade path
10. CI/CD pipeline wiring (GitHub Actions, Supabase Branching, i18n lint gate) — should exist from step 1 onward, not bolted on at the end

**Cross-component dependencies:**
- The JWT claims hook blocks every RLS policy, which blocks every service-layer function, which blocks all frontend work — this is the true critical path, not the payment integration.
- `packages/types` (Zod schemas + generated Supabase types + error-mapping utility) is a dependency of all three apps — must be versioned/built first in the Turborepo pipeline.
- The `OtpDeliveryProvider` and `PaymentProvider` abstractions share a design pattern (interface + swappable concrete implementation) — worth implementing them with a consistent internal convention so the pattern is recognizable across the codebase.
- The SMS/OTP spike and the Notch Pay spike are independent of each other but share a sprint-1 window and the same "no ship without a validated path" gating logic — both should be tracked the same way in `docs/decisions.md`.

## Implementation Patterns & Consistency Rules

### Pattern Categories Defined

Six conflict-prone areas identified where independently-working AI agents (or the same developer across sessions) could diverge: naming, structure, format, communication, error-handling, and validation timing.

### Naming Patterns

**Database Naming:** snake_case throughout — plural table names (`members`, `payments`, `subscriptions`, `attendance_events`, `audit_log`, `job_runs`); foreign keys as `<singular>_id` (`gym_id`, `member_id`, `coach_id`); indexes as `idx_<table>_<column(s)>`.

**"API" Naming (no custom REST API exists, per Core Architectural Decisions):** Server Actions named `verbNoun` camelCase (`createMember`, `renewSubscription`, `recordPayment`); Postgres RPC functions named snake_case verb_noun (`auth.gym_id()`, `renew_subscription()`); routes match the UX spec's IDs exactly (`/members`, `/members/:id`).

**Code Naming:** Components PascalCase, file name matches component name (`MemberCard.tsx`); hooks `useX.ts`; shared types/interfaces PascalCase, defined once in `packages/types`.

### Structure Patterns

- Tests co-located (`*.test.ts(x)` next to source), not a separate `__tests__` tree; pgTAP tests live in `supabase/tests/`.
- Components organized **by feature/domain** within each app (`app/members/components/`), not by generic type — consistent with the "no shared `packages/ui` for V1" decision.
- Shared code only in `packages/types`; anything app-specific stays in that app's own `lib/`.
- Service layer: `services/<domain>.ts` per app, wrapping `supabase-js`, referencing shared Zod schemas — not shared across apps directly, since Next.js and Expo use `supabase-js` in different runtime contexts.

### Format Patterns

- **No custom API response wrapper.** Server Actions and service-layer functions return `{ data, error }`, matching `supabase-js`'s own convention.
- **Error shape:** `{ code: string, message: string }` — `code` feeds the centralized error-mapping utility; `message` is the already-localized EN/FR user-facing string. Components never hand-write error copy inline.
- **Dates:** UTC `timestamptz` in the DB and over the wire always; locale-specific formatting happens only at the UI render layer, never stored pre-formatted.
- **Field naming boundary rule:** `snake_case` for anything that is a DB row shape (matches `supabase gen types` output directly, no translation layer to drift); `camelCase` only for pure UI-local state/props that never round-trip to the database.
- **Booleans:** native Postgres `boolean` (`true`/`false`), never `0`/`1`.

### Communication Patterns

- **Realtime channels:** `gym:<gym_id>:alerts` naming — scoped per gym, matching the tenancy model directly in the channel name.
- **TanStack Query keys:** array convention `[domain, filters]`, e.g. `['members', { status: 'expired' }]` — prevents cache-key collisions between independently-written screens.
- **Loading states:** TanStack Query's own `isLoading`/`isFetching`, no custom global loading store; skeleton shapes match the UX spec's specified dimensions exactly.

### Process Patterns

- **Error handling:** Server Actions/service functions never `throw` for expected, user-facing errors — they return `{ data: null, error: { code, message } }`. Only genuine bugs throw, caught by Sentry's error boundary. This is the single highest-value convention for cross-agent consistency, since "throw vs. return" is the most common silent divergence point.
- **Validation timing:** on submit only, except live-search inputs (matches the UX spec's global form rule) — Zod validates client-side for immediate feedback AND server-side in the Server Action, which never trusts client input.
- **Retries:** no automatic retry on mutations (renewals, payments) — user-initiated only, matching the UX spec's inline "Try again" pattern, to avoid accidental double-charges. Read queries keep TanStack Query's default retry behavior.

### Enforcement Guidelines

**All AI Agents MUST:**
- Use `packages/types` Zod schemas for every validation — never redefine a schema inline in a component or Server Action
- Use the centralized error-mapping utility for all user-facing error copy — never hand-write an error string
- Follow the snake_case-at-the-DB-boundary / camelCase-only-for-pure-UI-state rule without exception
- Use TanStack Query for all client-side Supabase reads outside Server Components — never a raw `useEffect` + `supabase.from()` fetch
- Return `{ data, error }` from Server Actions/service functions — never throw for expected errors

**Pattern Enforcement:** CI TypeScript checks catch type-shape violations; a code-review checklist item catches inline schema redefinition and hand-written error strings (not easily lint-automatable). Pattern violations or proposed changes get logged as an addition to this architecture document, not silently patched ad hoc.

### Pattern Examples

**Good example — Server Action:**
```ts
export async function renewSubscription(input: RenewSubscriptionInput) {
  const parsed = renewSubscriptionSchema.safeParse(input);
  if (!parsed.success) {
    return { data: null, error: { code: 'validation_error', message: t('errors.renewal_invalid') } };
  }
  const { data, error } = await supabase.rpc('renew_subscription', parsed.data);
  if (error) {
    return { data: null, error: mapSupabaseError(error) };
  }
  return { data, error: null };
}
```

**Anti-pattern — what to avoid:**
```ts
// Inline schema, throws instead of returning, hand-written error string, camelCase leaking into a DB write
export async function renewSubscription(input: any) {
  if (!input.memberId) throw new Error("Member ID is required!");
  const { data } = await supabase.from('subscriptions').update({ newExpiryDate: input.expiryDate });
  return data;
}
```

## Project Structure & Boundaries

### Complete Project Directory Structure

```
gymos/
├── README.md
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── .env.example
├── .gitignore
├── .github/
│   └── workflows/
│       └── ci.yml                          # typecheck + RLS pgTAP + Notch Pay sandbox + i18n key-parity gate
├── docs/
│   └── decisions.md                        # sandbox spikes, deferred-scope changes, pattern amendments
├── apps/
│   ├── dashboard/                          # Gym Admin Dashboard (Next.js)
│   │   ├── package.json / next.config.ts / tailwind.config.ts / tsconfig.json / middleware.ts
│   │   ├── app/
│   │   │   ├── layout.tsx
│   │   │   ├── login/page.tsx                          # AD-01
│   │   │   └── (dashboard)/
│   │   │       ├── layout.tsx                           # sidebar + role-filtered nav
│   │   │       ├── page.tsx                             # AD-02 Overview
│   │   │       ├── members/
│   │   │       │   ├── page.tsx                         # AD-03
│   │   │       │   ├── [id]/page.tsx                    # AD-04
│   │   │       │   ├── new/page.tsx                     # AD-05 create
│   │   │       │   ├── [id]/edit/page.tsx                # AD-05 edit
│   │   │       │   ├── actions.ts                        # createMember, deactivateMember, sendInvite
│   │   │       │   └── components/                       # MemberTable, InviteModal (AD-06), CsvImportModal (AD-07)
│   │   │       ├── subscriptions/
│   │   │       │   ├── page.tsx                          # AD-08
│   │   │       │   └── actions.ts                        # renewSubscription
│   │   │       ├── payments/
│   │   │       │   ├── page.tsx                          # AD-09
│   │   │       │   ├── actions.ts                        # recordPayment, verifyPayment
│   │   │       │   └── components/                       # VerificationQueue, ManualPaymentModal (AD-10)
│   │   │       ├── attendance/
│   │   │       │   ├── page.tsx                          # AD-11
│   │   │       │   └── actions.ts                        # checkOutMember
│   │   │       ├── audit/page.tsx                        # AD-12 (read-only, no actions.ts)
│   │   │       ├── settings/
│   │   │       │   ├── page.tsx                          # AD-13
│   │   │       │   └── actions.ts                        # updateGymSettings, regenerateQrCode
│   │   │       └── coach/
│   │   │           ├── page.tsx                          # AD-14
│   │   │           ├── [memberId]/page.tsx               # AD-15
│   │   │           └── actions.ts                        # addSessionNote
│   │   ├── components/
│   │   │   ├── ui/                                       # shadcn/ui primitives (duplicated per app — cosmetic drift only)
│   │   │   └── shared/                                   # FrontDeskAlertPanel, InlineRenewalPanel, Sidebar
│   │   │       # FrontDeskAlertPanel / InlineRenewalPanel expose an explicit `variant` prop
│   │   │       # ('dashboard' | 'attendance-row' | 'subscription-row') — one component, no per-page forks
│   │   ├── services/                                     # members.ts, subscriptions.ts, payments.ts, attendance.ts, auditLog.ts, settings.ts
│   │   └── lib/ (app-specific glue only — see packages/types for shared Supabase client + error mapping)
│   ├── super-admin/                        # Super Admin Dashboard (Next.js, separate deployment)
│   │   ├── (same config shape as dashboard)
│   │   ├── app/
│   │   │   ├── login/page.tsx                            # SA-01
│   │   │   └── (admin)/
│   │   │       ├── gyms/
│   │   │       │   ├── page.tsx                          # SA-02
│   │   │       │   ├── [id]/page.tsx                     # SA-03
│   │   │       │   └── actions.ts                        # createGym, suspendGym, escalateGymAccess
│   │   │       ├── metrics/page.tsx                      # SA-05
│   │   │       └── tiers/
│   │   │           ├── page.tsx                          # SA-06
│   │   │           └── actions.ts                        # createTier, editTier, deleteTier
│   │   ├── services/ (gyms.ts, tiers.ts, metrics.ts)
│   │   └── lib/ (app-specific glue only)
│   └── mobile/                             # Member App (Expo + Router)
│       ├── package.json / app.json / tsconfig.json / babel.config.js
│       ├── app/
│       │   ├── _layout.tsx
│       │   ├── onboarding/
│       │   │   ├── _layout.tsx                           # sequencing guard — checks progress state before rendering any child route
│       │   │   ├── language.tsx                          # MA-01
│       │   │   ├── phone.tsx                             # MA-02
│       │   │   ├── otp.tsx                               # MA-03
│       │   │   ├── lockout.tsx                           # MA-04
│       │   │   ├── profile.tsx                           # MA-05
│       │   │   ├── goal.tsx                              # MA-06
│       │   │   ├── experience.tsx                        # MA-07
│       │   │   └── plan.tsx                              # MA-08
│       │   └── (tabs)/
│       │       ├── _layout.tsx
│       │       ├── index.tsx                             # MA-09 Home
│       │       ├── checkin.tsx                           # MA-10 — 4 result states (success/denied/already-checked-in/wrong-QR)
│       │       │                                          # are distinct designed moments (own timing/haptic/transition), not one generic toast
│       │       ├── history/
│       │       │   ├── index.tsx                         # MA-11
│       │       │   └── payment/[id].tsx                  # MA-14
│       │       └── profile.tsx                           # MA-12
│       │       # MA-13 Plan Details reached as a modal route from Home/History
│       ├── components/
│       ├── services/ (auth.ts, checkin.ts — offline SQLite queue, profile.ts)
│       ├── lib/ (supabase.ts — platform-specific client/session storage, sqlite.ts, errors.ts)
│       └── locales/ (en.json, fr.json — separate from admin apps; different vocabulary, onboarding flow)
├── packages/
│   └── types/                                            # the ONLY shared package for V1
│       ├── package.json
│       ├── src/
│       │   ├── database.ts                              # generated: supabase gen types typescript (never hand-edited)
│       │   ├── schemas/ (member.ts, subscription.ts, payment.ts, gym.ts — Zod)
│       │   ├── errors.ts                                 # mapSupabaseError — single copy, shared by dashboard + super-admin
│       │   ├── supabase-client.ts                        # shared client factory for dashboard + super-admin
│       │   └── locales/                                  # shared admin-surface strings (payments.*, auth.*, gyms.*)
│       │       ├── en.json                               # imported by dashboard + super-admin (mobile stays separate)
│       │       └── fr.json
│       └── tsconfig.json
└── supabase/
    ├── config.toml                                        # SMS_TEST_OTP lives here for local/staging only
    ├── migrations/
    │   ├── 0001_extensions_and_enums.sql
    │   ├── 0002_gyms_and_tiers.sql                        # + ENABLE ROW LEVEL SECURITY, deny-all, no policies yet
    │   ├── 0003_members_and_users.sql                     # + ENABLE ROW LEVEL SECURITY, deny-all
    │   ├── 0004_subscriptions_and_plans.sql               # + ENABLE ROW LEVEL SECURITY, deny-all
    │   ├── 0005_payments.sql                              # + ENABLE ROW LEVEL SECURITY, deny-all
    │   ├── 0006_attendance.sql                            # + ENABLE ROW LEVEL SECURITY, deny-all
    │   ├── 0007_audit_log.sql                             # + ENABLE ROW LEVEL SECURITY, deny-all, REVOKE UPDATE/DELETE
    │   ├── 0008_job_runs.sql                              # + ENABLE ROW LEVEL SECURITY, deny-all
    │   ├── 0009_auth_hook_gym_claims.sql                  # JWT custom-claims hook, Postgres function
    │   ├── 0010_rls_policies_members.sql                  # split per sensitive table, not one monolith
    │   ├── 0011_rls_policies_payments.sql
    │   ├── 0012_rls_policies_audit_log.sql
    │   ├── 0013_rls_policies_shared_tables.sql            # gyms, tiers, subscriptions, attendance, job_runs
    │   ├── 0014_cron_subscription_lifecycle.sql
    │   ├── 0015_cron_payment_reconciliation.sql
    │   └── 0016_cron_checkin_autotimeout.sql
    ├── functions/                                         # Edge Functions — only these two exist
    │   ├── notch-pay-webhook/
    │   │   ├── index.ts
    │   │   └── _shared/payment-providers/                 # call contract only (charge, verifyWebhookSignature) — entity shapes stay in packages/types
    │   │       ├── PaymentProvider.ts
    │   │       └── NotchPayProvider.ts
    │   └── send-sms-hook/
    │       ├── index.ts
    │       └── _shared/otp-providers/
    │           ├── OtpDeliveryProvider.ts
    │           └── TwilioSmsProvider.ts
    └── tests/                                             # pgTAP — one file per sensitive table, red→green at its own migration
        ├── members_rls.test.sql
        ├── payments_rls.test.sql
        ├── audit_log_rls.test.sql
        ├── rls_tenant_isolation.test.sql                  # cross-cutting: gym A cannot see gym B's rows
        ├── rls_role_boundaries.test.sql
        └── auth_hook_canary.test.sql                      # known test tenant always sees a non-zero, correctly-scoped row count
```

### Architectural Boundaries

**API Boundaries:** No external API surface exists except the two Edge Functions (`notch-pay-webhook` receives Notch Pay's callback; `send-sms-hook` receives Supabase Auth's hook invocation) — both are the only network-exposed custom endpoints in the system. Everything else is `supabase-js` + RLS, or a Next.js Server Action.

**Component Boundaries:** Feature-scoped components live under their route folder (`app/members/components/`); only genuinely cross-cutting UI (`FrontDeskAlertPanel`, `InlineRenewalPanel`, `Sidebar`) lives in `components/shared/`, treated as a variant-driven component (not per-page forks) even without a separate UI package. Data flows one way: Server Components render initial data → TanStack Query owns client-side cache → Supabase Realtime events patch that cache directly (never a separate global store).

**Service Boundaries:** `services/<domain>.ts` is the only layer allowed to call `supabase-js` directly outside of Server Components/Actions — no component calls Supabase directly. Edge Functions are isolated behind their own `_shared/` provider interfaces (`PaymentProvider`, `OtpDeliveryProvider`), which own the call contract only — entity shapes (e.g. `Payment`) stay the generated type from `packages/types` so the interface can't silently redeclare and drift from the schema.

**Data Boundaries:** RLS is the tenant boundary on every table from the moment it's created — every table migration (0002–0008) enables RLS with a deny-all default in the same migration as its `CREATE TABLE`, closing the "open table" window entirely rather than leaving tables unprotected until policies land later. Policies are then added per sensitive table (members, payments, audit_log each get their own migration) rather than one monolithic policy file, so a security review or incident investigation can find "which policy governs this table" in one small file, not buried in a 400-line migration. Super Admin's bypass is not a blanket RLS exemption — it's the explicit, audit-logged escalation action (FR-072). `packages/types/database.ts` is the single generated source of DB row shapes.

### Requirements to Structure Mapping

| FR Category                                        | Location                                                                                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Platform Foundation / tenancy (FR-001–006)         | `supabase/migrations/0001–0003`, `0009` (claims hook), `0010–0013` (RLS policies); `packages/types`                                  |
| Gym Setup & Onboarding, CSV Import (FR-007–010)    | `apps/dashboard/app/(dashboard)/members/components/CsvImportModal.tsx`, `members/actions.ts`                                         |
| White-Label Branding (FR-011–013)                  | `apps/dashboard/.../settings/`, `apps/mobile` branded header components + 24h cache logic                                            |
| Localization (FR-014–018)                          | `packages/types/src/locales/` (dashboard + super-admin, shared source), `apps/mobile/locales/` (separate), CI i18n key-parity check  |
| Member Management (FR-019–023, FR-082–083)         | `apps/dashboard/.../members/`, `services/members.ts`                                                                                 |
| Membership Plans (FR-024–026)                      | `supabase/migrations/0004`, `apps/dashboard/.../settings/` (plan config)                                                             |
| Subscription Lifecycle (FR-027–032)                | `supabase/migrations/0014` (cron), `apps/dashboard/.../subscriptions/`                                                               |
| Payments (FR-033–041)                              | `supabase/functions/notch-pay-webhook/`, `supabase/migrations/0005`, `0011`, `0015` (reconciliation), `apps/dashboard/.../payments/` |
| Attendance & Occupancy (FR-042–048)                | `supabase/migrations/0006`, `0016` (auto-timeout), `apps/dashboard/.../attendance/`, `apps/mobile/app/(tabs)/checkin.tsx`            |
| Retention Triggers / front-desk alert (FR-049–052) | `components/shared/FrontDeskAlertPanel.tsx`, `InlineRenewalPanel.tsx`, Realtime channel `gym:<gym_id>:alerts`                        |
| Coach Portal (FR-053–056)                          | `apps/dashboard/.../coach/`                                                                                                          |
| Member Mobile App (FR-057–063)                     | `apps/mobile/app/onboarding/` (+ sequencing guard), `(tabs)/`                                                                        |
| Gym Admin Dashboard (FR-064–069, FR-085)           | `apps/dashboard/` overall                                                                                                            |
| Super Admin Dashboard (FR-070–073, FR-086)         | `apps/super-admin/`                                                                                                                  |
| Push Notifications (FR-074–078)                    | triggered from within relevant service functions/cron jobs; Expo push token management in `apps/mobile/services/`                    |
| Audit Log (FR-079–081)                             | `supabase/migrations/0007`, `0012` (append-only + grant revoke + policy), `apps/dashboard/.../audit/`                                |

### Integration Points

**Internal communication:** Apps never call each other directly — Supabase (Postgres + Auth + Realtime) is the only shared integration point between dashboard, super-admin, and mobile.

**External integrations:** Notch Pay (webhook → Edge Function), SMS provider (Send SMS Hook → Edge Function), Expo Push Notification Service (from server-side triggers), Sentry (all four surfaces).

**Data flow:** Client mutation → Server Action/service function → Zod validation → `supabase-js` write → RLS check → Postgres → (if relevant) Realtime broadcast → subscribed dashboard clients patch TanStack Query cache.

### File Organization Patterns

- **Config:** per-app `.env.local` (gitignored), root `.env.example` documents every required variable across all apps; `supabase/config.toml` is the single source for local/branch Supabase settings.
- **Source:** feature-first within each app; no cross-app source sharing except `packages/types` (now including the shared Supabase client factory, error mapping, and admin-surface locale strings — promoted from per-app duplication because drift there is a security-disclosure risk, not cosmetic).
- **Tests:** co-located `*.test.ts(x)` per app; `supabase/tests/` for pgTAP, one file per sensitive table plus cross-cutting isolation/canary tests.
- **Assets:** gym logos in Supabase Storage (not committed); static platform assets (GymOS logo, icons) in each app's own `public/`/`assets/` since there's no shared UI package yet.

### Development Workflow Integration

**Dev server:** `turbo dev` runs all three apps + local Supabase (via `supabase start`) concurrently; Turborepo's task graph builds `packages/types` first.

**Build:** `turbo build` builds `packages/types` → both Next.js apps (Turbopack) → Expo app is built separately via EAS (not part of the Turborepo build graph, since EAS runs in the cloud).

**Deployment:** Vercel builds trigger from `apps/dashboard` and `apps/super-admin` independently (two separate Vercel projects pointing at the same monorepo with different root directories); `supabase db push` runs in CI against the target branch/project; EAS builds are triggered manually or via a release workflow, not on every push.

## Architecture Validation Results

### Coherence Validation ✅

**Decision Compatibility:** All technology choices are mutually compatible — Next.js 16.2.10 + Turbopack, Expo SDK 57 (React Native 0.86), Supabase (Postgres, Auth, Realtime, Storage, 2 Edge Functions), TanStack Query, Zod, shadcn/ui, Turborepo + pnpm. No version conflicts found. The `OtpDeliveryProvider`/`PaymentProvider` pattern is applied consistently to both external-integration points that need swappability.

**Pattern Consistency:** Naming, structure, format, and process patterns all trace cleanly to the decisions that motivated them — e.g., the snake_case-at-the-DB-boundary rule exists specifically because `supabase gen types` output would otherwise fight a blanket camelCase rule; the `{ data, error }` return pattern keeps Server Actions and `supabase-js` calls compositionally consistent.

**Structure Alignment:** The project structure enforces the boundaries decided upon — RLS-first migration ordering, per-sensitive-table policy files, provider interfaces scoped to their Edge Function, shared security-critical code (client factory, error mapping) promoted to `packages/types` while cosmetic UI stays duplicated. No contradictions between the Core Architectural Decisions and the file tree that implements them.

### Requirements Coverage Validation ✅

All 85 FRs across 16 categories and all 10 NFRs trace to a specific architectural mechanism (see Requirements to Structure Mapping). Tracing this coverage surfaced five gaps, all resolved below — no Critical gaps found; none blocked starting implementation.

**Gap 1 (Important) — Push notification dispatch had no defined mechanism.** FR-074–078 were covered narratively but no component was responsible for calling the Expo Push API. **Resolution:** the `pg_net` Postgres extension (added to `0001_extensions_and_enums.sql`) calls Expo's Push API directly from a `send_push_notification()` Postgres function — invoked by the subscription-lifecycle cron job (N-01/N-02/N-03) and an `AFTER INSERT/UPDATE` trigger on `payments` (N-04/N-05). Keeps the "only two Edge Functions" boundary true. Stale push token cleanup (FR-077) happens in the same function on delivery failure.

**Gap 2 (Important) — Member cap enforcement (FR-086) had no defined enforcement layer.** **Resolution:** a `BEFORE INSERT` trigger on `members` comparing active+deactivated count against the gym's tier cap is the enforcement of record (cannot be bypassed by any client); `createMember`'s Server Action performs the same check first for a fast, friendly failure ("You've reached your plan limit") before ever reaching the trigger — the trigger is the backstop, not the only line of defense.

**Gap 3 (Important) — No explicit Entity Relationships documentation existed.** Resolved with the relationship diagram below.

**Gap 4 (Minor) — Logging strategy was implicit.** Resolved with the Logging section below.

**Gap 5 (Minor) — Performance considerations were scattered across earlier sections, not consolidated.** Resolved with the Performance Considerations section below.

**NFR coverage:** All 10 NFRs are architecturally addressed — NFR-001 (RLS + hook), NFR-002 (webhook signature check), NFR-003 (integer money), NFR-004 (audit log append-only + grant revoke), NFR-005 (accepted as Supabase/Vercel managed SLA), NFR-006 (offline scoped to check-in only), NFR-007 (Sentry env tagging), NFR-008 (correctly excluded, PostHog deferred), NFR-009 (RLS/schema scale property + pooling), NFR-010 (region + RTT verification spike + degrade path).

### Entity Relationships

```
gyms (1) ──< members >── (1) users              # members bridges gym-scoped identity to one platform user account (FR-001)
gyms (1) ──< subscriptions
gyms (1) ──< payments
gyms (1) ──< attendance_events
gyms (1) ──< audit_log
gyms (1) ──< job_runs (global, not gym-scoped — one row per job execution across all gyms)
gyms (N) ──> tiers                                # gym.tier_id → tiers.id; tiers are platform-wide, not gym-owned
members (1) ──< subscriptions                     # a member's plan history over time
members (1) ──< payments
members (1) ──< attendance_events
members (1) ──< coach_assignments >── (1) coaches # coach_assignments has ended_at for history (FR-055); at most one active per member
members (1) ──< session_notes                     # authored by a coach, scoped to a coach_assignment
members (1) ──< member_preferences                # notification opt-outs (FR-076)
payments (0..1) ──> subscriptions                 # a renewal payment links to the subscription it renewed
audit_log (N) ──> users (actor)                    # every row has an actor; append-only, no reverse FK constraints needed
```

Every child table below `gyms` carries `gym_id` — the column every RLS policy filters on via `auth.gym_id()`.

### Logging

- **Sentry** is the only exception/crash log, across all four surfaces (dashboard, super-admin, mobile, Edge Functions), environment-tagged dev/staging/prod.
- **`job_runs`** is the structured log for background job execution — queried directly, not duplicated into Sentry unless a job throws an actual exception.
- **No verbose application logging** beyond this — Server Actions and service functions don't write to a console/log stream in production; Sentry breadcrumbs plus `job_runs` are the entire V1 observability surface.

### Performance Considerations

- Front-desk alert: < 3s QR-scan-to-dashboard-alert budget via Supabase Realtime (EU West, pending RTT verification) + polling degrade path if the channel drops.
- Dashboard pages: < 2s load via Server Components for initial data.
- Branding: 24h on-device cache avoids a network round-trip on every app launch.
- Database: default Supabase connection pooling (pgbouncer) is sufficient at pilot scale; no additional caching layer.
- Mobile offline check-in: local SQLite write is immediate — the perceived latency is a local operation, not a network one.

### Implementation Readiness Validation ✅

Decision completeness, structure completeness, and pattern completeness are all satisfied following the five gap resolutions above — every critical/important decision now has a documented mechanism, not just a stated intent.

### Architecture Completeness Checklist

**Requirements Analysis**
- [x] Project context thoroughly analyzed
- [x] Scale and complexity assessed
- [x] Technical constraints identified
- [x] Cross-cutting concerns mapped

**Architectural Decisions**
- [x] Critical decisions documented with versions
- [x] Technology stack fully specified
- [x] Integration patterns defined
- [x] Performance considerations addressed

**Implementation Patterns**
- [x] Naming conventions established
- [x] Structure patterns defined
- [x] Communication patterns specified
- [x] Process patterns documented

**Project Structure**
- [x] Complete directory structure defined
- [x] Component boundaries established
- [x] Integration points mapped
- [x] Requirements to structure mapping complete

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION

**Confidence Level:** High

**Key Strengths:** RLS-first migration ordering closes the tenant-isolation gap that most projects like this leave open; the `PaymentProvider`/`OtpDeliveryProvider` pattern gives real vendor flexibility for two of the riskiest external dependencies in the Cameroon market; every architectural decision traces back to a specific FR/NFR rather than existing for its own sake.

**Areas for Future Enhancement:** shared `packages/ui` once the two dashboards' duplication starts hurting; WhatsApp OTP as a second `OtpDeliveryProvider` implementation; a real job queue if background-job complexity grows past what three `pg_cron` triggers can handle; PostHog analytics at V1.5.

### Implementation Handoff

**AI Agent Guidelines:**
- Follow all architectural decisions exactly as documented in this file
- Use implementation patterns consistently across dashboard, super-admin, and mobile
- Respect the project structure and boundaries (especially the RLS-first migration ordering and the two-Edge-Functions-only rule)
- Refer back to this document for all architectural questions rather than making ad hoc calls

**First Implementation Priority:** Monorepo + starter initialization (`pnpm dlx create-turbo@latest`, then the three app-scaffolding commands from the Starter Template Evaluation section), immediately followed by the JWT claims hook (migration 0009) and its CI canary test — this is the true critical path everything else depends on.
