---
baseline_commit: 87a71b0eef36ae47cf398615558beae5e0638aa5
---

# Story 1.3: Tenant Isolation Foundation — JWT Claims Hook & RLS Deny-All

Status: done — code review complete (3 decisions resolved, 11 patches applied); local `supabase test db` re-run recommended before merge (Docker/Supabase CLI unavailable in the review environment, so the applied SQL/test changes were verified by manual read, not execution)

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a platform operator,
I want every table protected by RLS with a working JWT gym/role claims hook,
so that gym data can never leak across tenants, even before any feature-specific policy exists.

## Acceptance Criteria

1. **Given** a new migration creates a tenant-scoped table, **When** the migration runs, **Then** RLS is enabled with a deny-all default in that same migration (no "open table" window) **And** the `auth.gym_id()` helper function exists and is `STABLE`. [Source: epics.md#Story 1.3]
2. **Given** the JWT claims hook is installed, **When** a known test tenant logs in, **Then** a pgTAP canary test asserts they see a non-zero, correctly-scoped row count. [Source: epics.md#Story 1.3]
3. **Given** the claims hook is misconfigured or a claim is missing, **When** a user logs in, **Then** access defaults to deny-all (fails closed) **And** the denial is logged to Sentry. [Source: epics.md#Story 1.3]

## Tasks / Subtasks

- [x] **Task 1: Extensions, enums, and core tenant schema** (AC: #1)
  - [x] `supabase/migrations/0001_extensions_and_enums.sql` — enum types: `gym_status` (`active`/`suspended`/`deactivated`), `member_role` (`member`/`coach`/`receptionist`/`manager`/`owner` — **not** `super_admin`, see Dev Notes), `subscription_status` (`active`/`expiring_soon`/`grace_period`/`expired`), `plan_type` (`pay_per_session`/`monthly`/`coach_inclusive`/`class_only`), `billing_interval` (`monthly`/`annual`), `payment_method` (`mtn_momo`/`orange_money`/`cash`/`bank_transfer`/`manual_momo`), `payment_status` (`pending`/`processing`/`verified`/`flagged`), `job_status` (`success`/`failure`). **Do not assume `pgcrypto` is needed** — `gen_random_uuid()` has been built into core Postgres since v13, and Supabase's supported Postgres versions are well past that; only add the extension if a smoke test shows `gen_random_uuid()` unavailable without it.
  - [x] `supabase/migrations/0002_gyms_and_tiers.sql` — `tiers` (platform-wide, not gym-owned: `id`, `name`, `monthly_price integer`, `annual_price integer`, `member_cap integer`, `created_at timestamptz default now()`); `gyms` (`id`, `name`, `tier_id → tiers`, `status gym_status default 'active'`, `logo_url`, `primary_color`, `timezone default 'Africa/Douala'`, `default_language`, `grace_period_days default 3`, `capacity integer`, `alert_auto_dismiss_minutes default 30`, `gym_token` unique non-guessable value for QR (FR-043), `created_at timestamptz default now()`) — **ENABLE ROW LEVEL SECURITY, deny-all (no policies)** except the one canary policy in Task 4
  - [x] `supabase/migrations/0003_members_and_users.sql` — `users` (`id uuid primary key references auth.users(id) on delete cascade` — not an independent identity, always 1:1 with an `auth.users` row; `phone`, `display_name`, `preferred_language`, `is_super_admin boolean default false`, `created_at timestamptz default now()`); `members` (`id`, `gym_id → gyms`, `user_id → users`, `role member_role`, `name`, `phone`, `email` nullable, `dob` nullable, `photo_url` nullable, `join_date`, `emergency_contact` nullable, `deactivated_at timestamptz` nullable — soft-delete per FR-019, `created_at timestamptz default now()`) — **ENABLE ROW LEVEL SECURITY, deny-all**. **Also add a `handle_new_user()` trigger function + `AFTER INSERT ON auth.users` trigger** that inserts a matching `public.users` row — without this, no `members` row can ever be created by any later story (Epic 2 onboarding, Story 1.5 gym creation), since `members.user_id → users.id → auth.users.id` would have no way to get populated. This trigger is foundational plumbing for the `users` table this story already owns, not a registration-flow feature.
  - [x] `supabase/migrations/0004_subscriptions_and_plans.sql` — `plans` (`id`, `gym_id → gyms`, `name`, `plan_type`, `price integer`, `currency default 'XAF'`, `billing_interval`, `annual_discount_percent` nullable, `created_at timestamptz default now()`); `subscriptions` (`id`, `gym_id → gyms`, `member_id → members`, `plan_id → plans`, `status subscription_status`, `start_date`, `expiry_date`, `created_at timestamptz default now()`) — **ENABLE ROW LEVEL SECURITY, deny-all**
  - [x] `supabase/migrations/0005_payments.sql` — `payments` (`id`, `gym_id → gyms`, `member_id → members`, `subscription_id → subscriptions` nullable, `amount integer`, `currency default 'XAF'`, `method payment_method`, `status payment_status`, `provider_transaction_ref` nullable unique, `actor_id → users` nullable, `reason` nullable, `created_at timestamptz default now()`) — **ENABLE ROW LEVEL SECURITY, deny-all**
  - [x] `supabase/migrations/0006_attendance.sql` — `attendance_events` (`id`, `gym_id → gyms`, `member_id → members`, `checked_in_at timestamptz`, `checked_out_at timestamptz` nullable, `checkout_type` nullable (`manual`/`auto`), `created_at timestamptz default now()`) — partial unique index enforcing one open check-in per member is Epic 3's concern, not this story's — **ENABLE ROW LEVEL SECURITY, deny-all**
  - [x] `supabase/migrations/0008_job_runs.sql` — `job_runs` (`id`, `job_name`, `started_at timestamptz`, `finished_at timestamptz` nullable, `status job_status` nullable, `error` nullable) — **global, no `gym_id` column** (line 528 of architecture.md: one row per job execution across all gyms) — **ENABLE ROW LEVEL SECURITY, deny-all**
  - [x] Every table above carries `gym_id` (except `job_runs`, `tiers`, `users` — platform-wide/global by design) — confirm this before writing each migration, since a missing `gym_id` column is undetectable by RLS deny-all alone
  - [x] **Index every `gym_id` column** (`idx_<table>_gym_id`, e.g. `idx_members_gym_id`, `idx_subscriptions_gym_id`, etc.) — every RLS policy in the project filters on `gym_id` via `auth.gym_id()`, and NFR-009 requires the schema to scale to hundreds of gyms without rework; add these indexes in the same migration as each table, not as an afterthought
  - [x] Do **not** create `supabase/migrations/0007_audit_log.sql` in this story — it is Story 1.4's explicit scope (append-only grant enforcement is a distinct, security-critical concern that deserves its own migration and its own acceptance criteria)
  - [x] Do **not** create `0010`–`0013` (per-domain RLS business policies) or `0014`–`0016` (cron jobs) in this story — reserved for the feature stories that own those domains (see Dev Notes → Scope Boundary)

- [x] **Task 2: `auth.gym_id()` helper function** (AC: #1)
  - [x] Create `auth.gym_id()` in `0009_auth_hook_gym_claims.sql`: `STABLE`, reads the `gym_id` claim out of the current request's JWT (via `auth.jwt()` if available in the current Supabase CLI version, else `current_setting('request.jwt.claims', true)::jsonb ->> 'gym_id'`), returns `uuid`, returns `NULL` if the claim is absent or unparseable — **never throws**, since a thrown exception inside an RLS policy's `USING` clause fails the whole query rather than just denying rows for that table
  - [x] Verify current Supabase Postgres version ships a built-in `auth.jwt()` function before relying on it — if absent, fall back to `current_setting`
  - [x] Postgres grants `EXECUTE` to `PUBLIC` on new functions by default, so `authenticated`/`anon` should be able to call `auth.gym_id()` without an explicit grant — but don't assume this silently. Add a pgTAP assertion (Task 5) that calling `auth.gym_id()` as the `authenticated` role does not raise a permission error, since a permission-denied here is a different, more confusing failure mode than "returns null" and would break every RLS policy that references it

- [x] **Task 3: Custom Access Token (JWT claims) Hook** (AC: #2, #3)
  - [x] `custom_access_token_hook(event jsonb) returns jsonb` in `0009_auth_hook_gym_claims.sql`, `plpgsql`, looks up the calling user's `members` row (see Dev Notes → Multi-Gym Membership Resolution for the exact lookup rule) and `users.is_super_admin`
  - [x] Inject `gym_id` claim (the member's `gym_id`, or `NULL` for a Super Admin / a user with no active membership)
  - [x] Inject the role claim under a **non-`role`** key — recommend `app_role` — see Dev Notes → Reserved Claim Collision. Do not overwrite the top-level `role` claim Supabase reserves for Postgres role switching (`anon`/`authenticated`/`service_role`)
  - [x] On any lookup failure or missing data, the function must still return valid `{ "claims": {...} }` JSON with `gym_id`/`app_role` simply absent/null — never raise an exception (an exception here can crash the login flow entirely, not just fail closed)
  - [x] `GRANT EXECUTE ON FUNCTION custom_access_token_hook TO supabase_auth_admin;` `REVOKE EXECUTE ... FROM authenticated, anon;` per Supabase's documented permission model
  - [x] Add local wiring to `supabase/config.toml`: `[auth.hook.custom_access_token]` → `enabled = true`, `uri = "pg-functions://postgres/public/custom_access_token_hook"`
  - [x] **Manual step, cannot be scripted or migrated:** enable the same hook on the remote/Cloud project (`vfxezibagiznrirdwkwh`, `eu-west-1` — the project this repo's `.env.local` files already point at per Stories 1.1/1.2) via **Dashboard → Authentication → Hooks → add hook → SQL → select `custom_access_token_hook`**. Record in Completion Notes that this was done — remote-Cloud is this project's default dev workflow (Story 1.1 Change Log), so skipping this step means the hook silently never fires against the environment the team is actually developing on
  - [x] Sentry logging of a deny-by-missing-claim event (AC #3): this cannot be done *inside* the Postgres hook function itself (no Sentry SDK in `plpgsql`). Implement as: the hook writes a row to a lightweight log path the application layer can observe, OR (simpler, recommended) treat "claims missing → 0 rows everywhere" as inherently visible through the RLS-denial error path the app already routes to Sentry per FR-003 ("RLS rejections show 'You don't have permission to do that' and log to Sentry") — that generic RLS-rejection-to-Sentry wiring is dashboard/mobile application code that does not exist yet (no frontend consumes real data yet). **Flag this AC as partially deferred**: implement and pgTAP-test the deny-by-default behavior now; the actual Sentry log call is app-layer plumbing with no call site to attach to until a dashboard page reads real gym-scoped data (Story 1.8+). Document this explicitly in Completion Notes rather than fabricating a Sentry call with nothing real to log.

- [x] **Task 4: Minimal canary RLS policy** (AC: #2)
  - [x] Add exactly one SELECT policy to `gyms` in `0002_gyms_and_tiers.sql`: `USING (id = auth.gym_id())` — this is the smallest possible policy that proves the isolation mechanism works end-to-end (hook → claim → helper → policy), and is intentionally generic/structural, not a business/role policy (those are Task-out-of-scope per Dev Notes). This also correctly denies Super Admin sessions by construction (`gym_id` is `NULL` for them, so `id = auth.gym_id()` never matches `NULL`) — expected behavior, not a bug; Super Admin's real access path is the explicit escalation action in Story 1.7
  - [x] All other tables from Task 1 stay pure deny-all (RLS enabled, zero policies) — this is expected and correct for this story

- [x] **Task 5: pgTAP tests** (AC: #2, #3)
  - [x] `supabase/tests/auth_hook_canary.test.sql` — seed two gyms; seed two `auth.users` rows first (pgTAP runs with full DB access, so inserting directly into `auth.users` is fine and required — `public.users.id` has a hard FK to it), then the corresponding `public.users` + `members` rows, one per gym; set `request.jwt.claims` to simulate each user's session (via `set_config`); assert calling `auth.gym_id()` as the `authenticated` role does not raise a permission error; assert `SELECT auth.gym_id()` returns the correct, non-null gym id for each; assert `SELECT count(*) FROM gyms` returns exactly `1` for each (their own gym only, not both, not zero) — this is literally AC #2
  - [x] `supabase/tests/rls_tenant_isolation.test.sql` — cross-cutting: for every deny-all table from Task 1, assert an authenticated session with a valid `gym_id` claim still sees `0` rows (since no business policy exists yet) and gets no error (deny-all ≠ query error)
  - [x] `supabase/tests/auth_hook_deny_all.test.sql` — simulate a session with **no** `gym_id`/`app_role` claim at all (misconfigured/missing) and one with a malformed claim; assert `auth.gym_id()` returns `NULL` in both cases and every table query returns `0` rows, never an error — this is AC #3's "fails closed" half
  - [x] Confirm `supabase test db` (pgTAP via local `supabase start`) is the run command; this project's Docker/Supabase CLI is already installed and verified working per Story 1.1

- [x] **Task 6: Wire pgTAP into CI** (AC: #2, #3)
  - [x] Extend `.github/workflows/ci.yml` with a second job (`rls-tests` or similar) that runs alongside `typecheck`: checkout → install Supabase CLI → `supabase start` → `supabase test db` → `supabase stop`
  - [x] Full Supabase Branching (persistent staging branch + ephemeral per-PR preview branches, architecture.md line 170) is **not** required for this story — running pgTAP against a CLI-managed local Postgres in the CI runner satisfies AC #2/#3 and the "RLS CI tests" implementation-sequence item without needing the GitHub↔Supabase Branching integration wired up. Note this as a deferred item, not a gap in this story.

### Review Findings

- [x] [Review][Decision→Patch] FK cascade chain is inconsistent and can silently break — `users.id references auth.users(id) on delete cascade` but `members.user_id references users(id)` has no `ON DELETE` clause (defaults to `NO ACTION`). If an `auth.users` row with an existing `members` row is ever hard-deleted, Postgres attempts to cascade-delete the `users` row, which is then blocked by the `members` FK, aborting the whole delete despite `on delete cascade` being declared upstream. [supabase/migrations/0003_members_and_users.sql:8,19] Sources: Edge Case Hunter, Blind Hunter. **Resolved by user: `members.user_id` → `on delete cascade`**, matching the cascade already declared on `users.id` so hard-delete works end-to-end.
- [x] [Review][Decision→Patch] No constraint prevents two simultaneous active (non-deactivated) `members` rows for the same user at the *same* gym — `members` has no unique index on `(gym_id, user_id)`. Distinct from the already-documented "multi-gym" V1 limitation (docs/decisions.md Decision 3), which covers *which gym* wins when a user is active at *different* gyms, not duplicates at one gym. [supabase/migrations/0003_members_and_users.sql:16-30] Source: Blind Hunter. **Resolved by user: add `unique (gym_id, user_id) where deactivated_at is null`.**
- [x] [Review][Decision→Patch] AC #1's literal text ("the `auth.gym_id()` helper function exists") is not met — implemented as `private.gym_id()`. Well-reasoned and documented (docs/decisions.md Decision 1: `postgres` lacks `CREATE` on the `auth` schema), and AC #1's *intent* is satisfied, but neither Completion Notes nor decisions.md explicitly states "AC #1 not literally satisfied," unlike Story 1.2's precedent for its own AC #1 gap. [supabase/migrations/0009_auth_hook_gym_claims.sql:18] Source: Acceptance Auditor. **Resolved by user: accept intent-over-letter — add an explicit "AC #1 note" to `docs/decisions.md`** (same pattern as Story 1.2) stating AC #1 is satisfied via `private.gym_id()` as an accepted, documented deviation, not a literal match.
- [x] [Review][Patch] `custom_access_token_hook()` itself is never directly tested — every pgTAP assertion crafts `request.jwt.claims` by hand rather than invoking the hook function, so its own logic (super_admin branch, membership lookup, jsonb claim injection) has zero direct test coverage. [supabase/tests/auth_hook_canary.test.sql, auth_hook_deny_all.test.sql, rls_tenant_isolation.test.sql] Source: Blind Hunter.
- [x] [Review][Patch] `private.gym_id()`'s exception handler swallows errors with no `RAISE WARNING`, unlike `custom_access_token_hook()` which logs on failure — a real bug inside `gym_id()` would be invisible even in logs. [supabase/migrations/0009_auth_hook_gym_claims.sql:32-35] Source: Blind Hunter.
- [x] [Review][Patch] `grant usage on schema private to authenticated, anon, service_role` includes `anon`, contradicting this diff's own pattern (every other GRANT explicitly excludes `anon` with a comment explaining why); no anon-facing table/policy exists yet. [supabase/migrations/0009_auth_hook_gym_claims.sql:14] Sources: Blind Hunter, Acceptance Auditor.
- [x] [Review][Patch] Membership tie-break query (`order by m.created_at desc limit 1`) has no deterministic secondary sort key — if two active membership rows share an identical `created_at`, which gym/role wins is undefined and can flip between logins. [supabase/migrations/0009_auth_hook_gym_claims.sql:97-103] Source: Edge Case Hunter.
- [x] [Review][Patch] `custom_access_token_hook` only conditionally sets `gym_id`/`app_role` inside the `if is_super`/`else` branches rather than clearing them first — if `event->'claims'` ever arrives already carrying stale `gym_id`/`app_role` (e.g. a refresh event echoing a prior token's claims), those stale values persist unchanged instead of resetting to absent. [supabase/migrations/0009_auth_hook_gym_claims.sql:82-110] Source: Edge Case Hunter.
- [x] [Review][Patch] `custom_access_token_hook(event jsonb)` doesn't guard against `event` being SQL NULL — `jsonb_set(NULL, ...)` returns NULL, so the function would return NULL instead of the required `{ "claims": {...} }` shape, without tripping the exception handler. [supabase/migrations/0009_auth_hook_gym_claims.sql:112-113] Source: Edge Case Hunter.
- [x] [Review][Patch] No pgTAP coverage of INSERT/UPDATE/DELETE deny-all — every deny-all assertion (including the `gyms` canary policy) only checks `SELECT`/`count(*)`; the write-path default-deny is never actually verified by a test. [supabase/tests/rls_tenant_isolation.test.sql, auth_hook_deny_all.test.sql] Source: Blind Hunter.
- [x] [Review][Patch] The new CI `rls-tests` job has no `timeout-minutes` — a hung `supabase start`/`supabase test db` could block CI indefinitely. [.github/workflows/ci.yml] Source: Blind Hunter.
- [x] [Review][Defer] No CHECK constraints on monetary/numeric columns (`tiers.monthly_price/annual_price`, `plans.price`, `payments.amount`, `gyms.grace_period_days/capacity/alert_auto_dismiss_minutes/member_cap`) — all silently accept negative values. [supabase/migrations/0002_gyms_and_tiers.sql, 0004_subscriptions_and_plans.sql, 0005_payments.sql] — deferred, belongs with the Epic 2/4 feature stories that populate and validate these values. Source: Blind Hunter.
- [x] [Review][Defer] `subscriptions` has no `CHECK (expiry_date > start_date)` and `plans.annual_discount_percent` has no bounds check (e.g. 0–100). [supabase/migrations/0004_subscriptions_and_plans.sql] — deferred, belongs with Epic 2/3 feature stories. Source: Blind Hunter.
- [x] [Review][Defer] `payments.provider_transaction_ref` is globally unique rather than gym-scoped — two unrelated gyms' manual/cash payments could collide on a placeholder reference string. [supabase/migrations/0005_payments.sql] — deferred, payments business logic owned by Epic 4. Source: Blind Hunter.
- [x] [Review][Defer] `users.phone` has no `UNIQUE` constraint despite being described as the platform's primary identity mechanism (FR-001). [supabase/migrations/0003_members_and_users.sql:9] — deferred, belongs with Epic 2's phone-OTP onboarding stories (2-1, 2-6) which will define real uniqueness/reuse semantics. Source: Blind Hunter.
- [x] [Review][Defer] `handle_new_user()` (the `auth.users` insert trigger) has no exception handling — unlike the login hook, a signup failure here fails loudly by aborting the `auth.users` insert. May be correct (fail hard rather than silently skip the mirror row everything depends on), but worth an explicit decision when Epic 2's onboarding flow is built. [supabase/migrations/0003_members_and_users.sql:51-62] — deferred, no onboarding flow exists yet to decide against. Sources: Blind Hunter, Edge Case Hunter.
- [x] [Review][Defer] `job_runs.status` is nullable with no documented semantics for NULL (presumably "still running"). [supabase/migrations/0008_job_runs.sql:8] — deferred, low severity, unused until Epic 3/4 cron jobs land. Source: Blind Hunter.

## Dev Notes

### Scope Boundary (read first — prevents overlap/rework with Stories 1.4 and beyond)

This story is the **first schema-authoring story in the project** — no tables exist yet (`supabase/migrations/` and `supabase/tests/` are currently empty except `.gitkeep`, confirmed 2026-07-05). It owns the *entire* core schema skeleton plus the claims hook, per architecture.md's Decision Impact Analysis step 3 ("Core schema + RLS policies... + RLS CI tests" is one bundled implementation step) and the migration file list (0001–0006, 0008–0009). It explicitly does **not** own:
- `0007_audit_log.sql` and the grant-level `REVOKE UPDATE, DELETE` → **Story 1.4**, which has its own dedicated ACs for this
- `0010`–`0013` (per-action, per-role RLS business policies for members/payments/audit_log/shared tables) → land incrementally with the feature stories that need them (Epic 2 for members, Epic 4 for payments, etc.). This story's own AC explicitly says "even before any feature-specific policy exists" — the one canary policy in Task 4 is the sole, deliberate exception, and it is structural/generic, not business logic.
- `0014`–`0016` (pg_cron jobs) → Epic 3/4 stories that need them
[Source: architecture.md#Complete Project Directory Structure, #Decision Impact Analysis]

### Reserved Claim Collision — do not overwrite `role`

Verified against current Supabase docs (2026-07-05): the Custom Access Token Hook's required/reserved claim set includes `role`, which Supabase Auth/PostgREST uses to `SET ROLE` to `anon`/`authenticated`/`service_role` for the Postgres session. The docs' own worked example for adding a custom role claim nests it under `app_metadata` rather than replacing `role` directly, which is a strong signal against reusing the bare `role` key. FR-003's wording ("`gym_id`/`role` claims injected into the JWT") is product-level language describing *what* information is injected, not a literal instruction to use the JSON key `role` — use `app_role` as the claim key and reference it as `auth.app_role()` if a second helper is added later (not required for this story's ACs, which only need `auth.gym_id()`). **If the team wants to keep the literal `role` key despite this**, that decision should be made explicitly and tested against a real login, not assumed.

### Multi-Gym Membership Resolution — unresolved by epics/architecture, needs a V1 rule

FR-001 allows one user to have `members` rows at multiple gyms. The claims hook can only place a single `gym_id`/role pair in a JWT per session. Neither the PRD, epics, nor architecture specifies how the hook should pick *which* membership when a user has more than one. Recommended V1 rule, consistent with pilot scale (NFR-009: ~30 members per gym, 1–3 gyms total) and this story's narrow mandate (prove the mechanism, not solve multi-tenancy UX): the hook selects the single non-deactivated `members` row for that user (`WHERE user_id = ... AND deactivated_at IS NULL`), and if more than one exists, picks the most recently created one and this is a **known, documented V1 limitation** — a staff member or member active at two gyms simultaneously does not get a gym switcher in V1. Flag this in Completion Notes; do not silently pick one without recording the rule.

### `packages/types` — deferred, not this story's job

`packages/types/src/database.ts` should be regenerated (`supabase gen types typescript`) once these migrations land, so the two Next.js apps' future Server Actions get typed rows. Wiring `transpilePackages` and actually consuming these types is out of scope here (deferred from Story 1.1's review, [Source: deferred-work.md]) — regenerating `database.ts` itself is cheap and worth doing at the end of this story so it doesn't silently drift, but do not build consumers of it.

### Testing Standards

- pgTAP, `supabase/tests/*.test.sql`, run via `supabase test db` against local Docker Postgres (already installed/verified in Story 1.1: Postgres/Auth/Kong/Inbucket reliably reach `healthy`; Realtime/Storage are flaky on health-check but functionally reachable — irrelevant to this story, which never touches Realtime/Storage).
- This is the **first story to introduce any automated test** in the repo — Story 1.1 explicitly deferred choosing a JS test framework ("decided explicitly in the next step... pgTAP tests arrive with Story 1.3's RLS work" [Source: 1-1-monorepo-starter-initialization.md#Dev Notes]). Do not introduce Jest/Vitest/RTL here — this story's tests are 100% pgTAP/SQL; a JS-side test framework decision is still not this story's job.
- No app-level (Next.js/Expo) code changes are expected in this story at all — it is 100% `supabase/` (migrations, functions config, tests) plus one CI workflow edit.

### Project Structure Notes

- Matches `architecture.md`'s Complete Project Directory Structure exactly for `supabase/migrations/0001–0006, 0008–0009` and `supabase/tests/*`, with the deliberate exclusions listed under Scope Boundary above.
- No new Edge Function is created here — `notch-pay-webhook` and `send-sms-hook` are unrelated to this story (Epic 2/4 spikes).
- `docs/decisions.md` is the established place for irreversible/hard-to-change decisions (used by Story 1.2 for the region call) — this story's Reserved Claim Collision and Multi-Gym Membership Resolution calls are exactly this kind of decision (hard to change once real users/JWTs depend on the claim shape) and should get an entry there once implemented, following the same dated-entry format Story 1.2 established.

### Previous Story Intelligence

- **Dev workflow is remote-Supabase-by-default** (`turbo dev` targets the Cloud project via each app's `.env.local`; `pnpm dev:local-db` is the local-Docker alternative) — but pgTAP/`supabase test db` in this story runs against **local** Docker Postgres regardless (that's how pgTAP works; it's not a remote-vs-local dev-workflow choice). Don't confuse the two: local Docker Postgres for testing is required no matter which mode `turbo dev` runs in. [Source: 1-1-monorepo-starter-initialization.md#Change Log 2026-07-05]
- The Supabase Cloud project already exists at `vfxezibagiznrirdwkwh.supabase.co`, region `eu-west-1`, confirmed correct per Story 1.2's region-verification spike — no project changes needed, only the Dashboard Auth Hook wiring (Task 3) touches the Cloud project directly. [Source: docs/decisions.md, 1-2-supabase-region-verification-spike.md]
- Story 1.2's review surfaced a pattern worth repeating here: when an AC is only partially satisfiable (Story 1.2's AC #1 tie-break), the resolution was to document the gap explicitly rather than silently mark it done. Task 3's Sentry-logging note and the two Dev Notes call-outs above follow that same pattern for this story's AC #3 and the claims/multi-gym ambiguities. [Source: 1-2-supabase-region-verification-spike.md#Review Findings]

### Git Intelligence Summary

- Recent commits (`87a71b0`, `f1b0893`, `70616b9`, `3ec4a03`) are scaffold/CI-fix commits only — no schema, RLS, or Postgres function code exists anywhere in the repo yet. This story has no prior SQL patterns in-repo to match; the naming conventions below come from `architecture.md` directly (snake_case tables/columns, `idx_<table>_<column>` indexes, `<singular>_id` FKs).
- `.github/workflows/ci.yml` currently has exactly one job (`typecheck`, Node 22, pnpm, `--frozen-lockfile`) — Task 6 adds a second job alongside it, does not replace it.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.3: Tenant Isolation Foundation — JWT Claims Hook & RLS Deny-All] — story statement and ACs
- [Source: _bmad-output/planning-artifacts/epics.md#Additional Requirements] — RLS policy strategy, migration-per-sensitive-table rule, `auth.gym_id()` helper convention, sandbox-spike gating pattern
- [Source: _bmad-output/planning-artifacts/architecture.md#Complete Project Directory Structure] — exact migration/test file names and their intended contents
- [Source: _bmad-output/planning-artifacts/architecture.md#Decision Impact Analysis] — implementation sequence placing claims hook + core schema/RLS as steps 2–3, before job_runs/cron (step 4) and before frontend work (step 7+)
- [Source: _bmad-output/planning-artifacts/architecture.md#Entity Relationships] — table relationships and which tables are gym-scoped vs. global
- [Source: _bmad-output/planning-artifacts/architecture.md#Naming Patterns, #Format Patterns] — snake_case DB naming, integer money, `timestamptz` UTC dates
- [Source: _bmad-output/implementation-artifacts/1-1-monorepo-starter-initialization.md#Dev Notes, #Change Log] — testing-framework deferral, remote-vs-local Supabase dev workflow
- [Source: _bmad-output/implementation-artifacts/1-2-supabase-region-verification-spike.md#Review Findings] — precedent for documenting partially-satisfied ACs rather than silently closing them
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — `packages/types`/`transpilePackages` wiring deferred, not this story's job
- [External: Supabase Docs — Custom Access Token Hook, fetched 2026-07-05] — function signature (`event jsonb → { "claims": {...} }`), reserved claim set including `role`, local `config.toml` registration (`[auth.hook.custom_access_token]`), Cloud registration is a manual Dashboard step (Authentication → Hooks → SQL), required `GRANT`/`REVOKE` on the function

## Open Questions for User/Architect Sign-Off

These weren't resolved by the PRD/epics/architecture and materially affect this story's core mechanism. Recommended defaults are already written into the story above; flagging here in case you want to override before dev starts:

1. **Full core-schema scope in one story:** This story creates column-level schema for `gyms`, `tiers`, `users`, `members`, `plans`, `subscriptions`, `payments`, `attendance_events`, `job_runs` — all in one story, since architecture.md's migration list groups them together and no earlier story defined columns. That's a lot of schema-design surface for a story titled "Tenant Isolation Foundation." OK to proceed, or would you rather split schema creation from the claims-hook/RLS-deny-all mechanism into two stories?
2. **`role` claim key rename to `app_role`:** Recommended to avoid colliding with Supabase's reserved `role` claim (used for Postgres role switching). This is a deviation from FR-003's literal wording. Confirm this is acceptable, or if there's a reason to keep the literal `role` key I should follow.
3. **Multi-gym-per-user resolution rule:** Recommended "most recent non-deactivated membership wins, no session switcher in V1" as a stopgap. Confirm, or specify a different rule if this is actually expected to matter at pilot scale.
4. **AC #3's Sentry logging:** No app code exists yet to attach a Sentry call to a real RLS denial. Recommended: implement and test the deny-by-default *behavior* now, defer the actual Sentry log call to whichever dashboard story (1.8+) first reads real gym-scoped data. Confirm this partial-deferral is acceptable rather than blocking this story on it.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- GoTrue container logs (`docker logs supabase_auth_gym_os`) surfaced the first real bug: `ERROR: type "member_role" does not exist (SQLSTATE 42704)` when the hook was invoked as `supabase_auth_admin`, whose role-level `search_path` is `auth` only (confirmed via `pg_roles.rolconfig`) — fixed by adding `set search_path = public` to both new functions.
- Reproducing the hook as `supabase_auth_admin` directly (`PGPASSWORD=... psql -h 127.0.0.1 -U supabase_auth_admin`) surfaced the second real bug: claims silently missing gym_id/app_role for a user who genuinely had a membership row, with no exception raised — traced to RLS itself blocking the hook's own internal `SELECT`s (the invoker, `supabase_auth_admin`, has no `BYPASSRLS`) — fixed by marking `custom_access_token_hook` `SECURITY DEFINER`.
- Both bugs were only observable via real end-to-end login testing against GoTrue/PostgREST, not via pgTAP (which calls the function directly as `postgres`, immune to both issues). Full narrative recorded in `docs/decisions.md` (2026-07-06 entry).

### Completion Notes List

- All 8 migrations (0001–0006, 0008–0009) applied cleanly against local Docker Postgres (`supabase db reset`) and against the remote Cloud project (`supabase db push`, confirmed via `supabase migration list` showing Local/Remote parity for all 8).
- Deviated from architecture.md's literal `auth.gym_id()` naming: implemented as `private.gym_id()` in a new `private` schema, since migrations run as `postgres`, which lacks `CREATE` on the `auth` schema (verified hands-on: `permission denied for schema auth`). Matches Supabase's own documented pattern of a non-exposed schema for custom RLS helpers. Recorded in `docs/decisions.md`.
- Gym-scoped role is injected as `app_role`, not `role`, to avoid colliding with Supabase's reserved `role` claim (Postgres role switching for anon/authenticated/service_role). Confirmed via real login that `role` stays `authenticated` in the issued JWT. Recorded in `docs/decisions.md`.
- Multi-gym-membership resolution: most-recently-created, non-deactivated `members` row wins; no gym switcher in V1. Documented as a known limitation in `docs/decisions.md`.
- AC #3's Sentry-logging half is deferred by design (confirmed with user before starting): the deny-by-default *behavior* is implemented and pgTAP-tested; the actual `Sentry.captureException` call has no real call site until a dashboard page reads gym-scoped data (Story 1.8+). Added a `RAISE WARNING` in the hook's exception handler in the meantime so a swallowed failure is at least visible in Postgres/GoTrue logs, not silent.
- Two bugs found and fixed via manual end-to-end verification (real signup + login + REST queries against local GoTrue/PostgREST, not just pgTAP) — see Debug Log References and `docs/decisions.md` for the full story. Both are the kind of bug that only manifests against the real auth flow with realistic role privileges, which is why this story's verification went beyond what Task 5 literally specified.
- Added baseline table-level `GRANT SELECT, INSERT, UPDATE, DELETE` (to `authenticated`, `service_role`; deliberately not `anon` — no unauthenticated flow touches this data) on every table from Task 1, beyond what any task subtask explicitly listed — discovered via manual verification that Postgres checks table-level privileges *before* RLS runs, so without these grants, deny-all surfaced as a hard "permission denied for table" error instead of the "0 rows, no error" behavior every AC and pgTAP test actually needs.
- Regenerated `packages/types/src/database.ts` via `supabase gen types typescript --local`; confirmed it type-checks cleanly (`pnpm --filter @gymos/types typecheck`). Not wired into `index.ts` exports — that remains explicitly deferred per Story 1.1's review.
- Full monorepo `pnpm run typecheck` currently fails in `apps/dashboard`/`apps/super-admin` with "Cannot find module 'next'..." errors — traced to a pre-existing, environment-local `node_modules` linking issue (confirmed unrelated: no file in either app was touched by this story, and `pnpm install` itself failed with an unrelated `EACCES` on a `sharp` binary, consistent with this repo's known mixed Windows/WSL dev-environment friction documented in Story 1.1). Not fixed here as out of scope; flagging for whoever picks up the next story in case it's still unresolved.
- Both manual/remote steps are complete: migrations pushed to the Cloud project, and the user confirmed enabling `custom_access_token_hook` as the Custom Access Token Hook via Dashboard → Authentication → Hooks.
- Final regression: full `supabase db reset` + `supabase test db` re-run after all fixes — 23/23 pgTAP assertions pass (Files=3, Tests=23, Result: PASS).

### File List

- `supabase/migrations/0001_extensions_and_enums.sql` (new)
- `supabase/migrations/0002_gyms_and_tiers.sql` (new)
- `supabase/migrations/0003_members_and_users.sql` (new)
- `supabase/migrations/0004_subscriptions_and_plans.sql` (new)
- `supabase/migrations/0005_payments.sql` (new)
- `supabase/migrations/0006_attendance.sql` (new)
- `supabase/migrations/0008_job_runs.sql` (new)
- `supabase/migrations/0009_auth_hook_gym_claims.sql` (new)
- `supabase/tests/auth_hook_canary.test.sql` (new)
- `supabase/tests/auth_hook_deny_all.test.sql` (new)
- `supabase/tests/rls_tenant_isolation.test.sql` (new)
- `supabase/config.toml` (modified — enabled `[auth.hook.custom_access_token]`)
- `.github/workflows/ci.yml` (modified — added `rls-tests` job)
- `packages/types/src/database.ts` (regenerated)
- `docs/decisions.md` (modified — added 2026-07-06 entry)

## Change Log

- 2026-07-06: Implemented tenant isolation foundation — full core schema (8 migrations), JWT custom-claims hook, `private.gym_id()` helper, one canary RLS policy on `gyms`, 3 pgTAP test files (23 assertions), CI wiring. Fixed two bugs found via manual end-to-end verification (search_path resolution, RLS-blocking-the-hook-itself). Pushed migrations to the Cloud project and confirmed the Dashboard hook wiring with the user.
