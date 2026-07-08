# Deferred Work

## Deferred from: code review of story-1-1-monorepo-starter-initialization (2026-07-05)

- next/@supabase deps pinned to "latest" undermines --frozen-lockfile determinism [apps/dashboard/package.json, apps/super-admin/package.json] — pre-existing behavior of the official `create-next-app -e with-supabase` starter, not introduced by hand-authoring; worth pinning to real semver ranges in a later hardening pass.
- TypeScript version spread across the workspace (5.9.2 exact in root/packages/types, ^5 in apps/dashboard & apps/super-admin, ~6.0.3 in apps/mobile) [package.json, apps/dashboard/package.json, apps/mobile/package.json] — stems from using two different official starter ecosystems (Next.js vs Expo), each with its own TypeScript convention; harmonize once versions stabilize.
- packages/types has no `transpilePackages` wiring in either Next app's config (apps/dashboard/next.config.ts, apps/super-admin/next.config.ts) — currently harmless since the package only exports `export {}` (pure types, erased at compile time), but will matter the moment it gains runtime code (Zod schemas, error mapping, Supabase client factory) rather than type-only exports, which this story's own scope explicitly defers to later stories.
- No root-level tsconfig.json, only tsconfig.base.json (repo root) — common in Turborepo setups since the root has no source files to typecheck, but means opening the repo root directly in an editor has nothing to resolve against.
- .env.example bundles a single shared SENTRY_DSN variable across three apps (dashboard, super-admin, mobile) instead of per-app naming — inconsistent with the Supabase vars directly above it, which are explicitly duplicated per-framework (NEXT_PUBLIC_* vs EXPO_PUBLIC_*); its own comment says "wired in a later story," so revisit naming scheme when that story lands.

## Deferred from: code review of story-1-2-supabase-region-verification-spike (2026-07-05)

- `npx supabase projects list` failed with `LegacyPlatformAuthRequiredError` and wasn't retried with a token/login — future spikes (Notch Pay 4.1, SMS/OTP 2.1) remain dependent on manual Dashboard screenshots for region confirmation rather than a scriptable, auditable check.
- The "if region does NOT match" project-recreation/env-swap/re-verify procedure was never exercised in this story (the existing project's region happened to match) — untested path, flag for whichever future spike first hits a mismatch.
- No raw measurement artifacts (exact curl commands, raw output, Dashboard screenshot) were retained alongside the summarized figures in `docs/decisions.md` — the sole audit trail for an "irreversible" decision is paraphrased narration.

## Deferred from: code review of story 1-3-tenant-isolation-foundation-jwt-claims-hook-rls-deny-all (2026-07-06)

- No CHECK constraints on monetary/numeric columns (`tiers.monthly_price/annual_price`, `plans.price`, `payments.amount`, `gyms.grace_period_days/capacity/alert_auto_dismiss_minutes/member_cap`) — all silently accept negative values; belongs with the Epic 2/4 feature stories that populate and validate these values.
- `subscriptions` has no `CHECK (expiry_date > start_date)` and `plans.annual_discount_percent` has no bounds check (e.g. 0–100) — belongs with Epic 2/3 feature stories.
- `payments.provider_transaction_ref` is globally unique rather than gym-scoped — two unrelated gyms' manual/cash payments could collide on a placeholder reference string; payments business logic owned by Epic 4.
- `users.phone` has no `UNIQUE` constraint despite being described as the platform's primary identity mechanism (FR-001) — belongs with Epic 2's phone-OTP onboarding stories (2-1, 2-6), which will define real uniqueness/reuse semantics.
- `handle_new_user()` (the `auth.users` insert trigger) has no exception handling — unlike the login hook, a signup failure here fails loudly by aborting the `auth.users` insert; may be correct behavior but worth an explicit decision when Epic 2's onboarding flow is built.
- `job_runs.status` is nullable with no documented semantics for NULL (presumably "still running") — low severity, unused until Epic 3/4 cron jobs land.

## Deferred from: dev of story 1-4-append-only-audit-log-foundation (2026-07-08)

- `supabase test db` (pgTAP) could not actually be run in the dev environment — Docker was unavailable (`docker: command not found`). `supabase/tests/audit_log_immutable.test.sql` was written and statically self-reviewed against Story 1.3's established test conventions, but has not been executed. **Must be run before this story merges** — same recommendation Story 1.3 closed with.
- `packages/types/src/database.ts` was not regenerated to include the new `audit_log` table/`log_audit_event()` function — both local Docker (`supabase gen types typescript --local`) and remote (`supabase gen types typescript --project-id ...`, `LegacyPlatformAuthRequiredError`, no access token available) were unavailable in this environment. Same blocker as Story 1.2's review note about `npx supabase projects list` failing without a login/token — still unresolved two stories later; worth fixing properly (e.g. `SUPABASE_ACCESS_TOKEN` wired into the dev environment) rather than continuing to defer it story by story.
- `log_audit_event()`'s caller-role boundary (the part of the "never trust caller-supplied actor" design that specifically matters) is only exercised by pgTAP calling it as `authenticated` via `set local role` + `set_config('request.jwt.claims', ...)` — not by a real end-to-end call through Supabase's actual PostgREST/RPC layer. Story 1.3's own review found two real bugs (search_path resolution, RLS-blocking-the-hook-itself) that only manifested via genuine end-to-end testing, not pgTAP alone. Worth the same manual verification pass once Epic 2/4 wires the first real `log_audit_event()` call site.
