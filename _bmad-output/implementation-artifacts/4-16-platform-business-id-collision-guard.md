---
baseline_commit: b8e6755b713ec4be091bf661389c43e80e66e600
---

# Story 4.16: Platform Business ID Collision Guard

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As GymOS,
I want the per-gym "Connect payment account" flow (Story 4.13) to reject a `business_id_plain` equal to the platform's own `TARAMONEY_BUSINESS_ID`,
so that a gym can't connect an account whose ID collides with the platform's own — which would let that gym's webhook deliveries be misidentified as platform-account traffic (or vice versa) by `TaraMoneyProvider.ts`'s businessId-based routing (Story 4.14).

**Context — read this before touching any AC below.**

This closes a single narrow gap flagged in Story 11.6's code review (2026-08-30) and never fixed:

> "nothing in `gym_payment_credentials`/the Story 4.13 connect flow prevents a gym from registering `business_id_plain` equal to the platform's own `TARAMONEY_BUSINESS_ID` at connect time." [`_bmad-output/implementation-artifacts/deferred-work.md:661`]

**Why this matters (the actual attack/failure surface):** `TaraMoneyProvider.verifyWebhookSignature()` (`supabase/functions/payment-webhook/_shared/payment-providers/TaraMoneyProvider.ts:411-420`) resolves routing by matching an inbound webhook's `businessId` against `Deno.env.get("TARAMONEY_BUSINESS_ID")` **first, unconditionally**, before any gym lookup — this ordering is itself a deliberate prior fix (`docs/decisions.md`'s 2026-08-30 entry) so a gym's self-connected `business_id_plain` can never shadow a genuine platform webhook. That ordering protects webhook *routing*, but nothing stops a gym from *registering* that same value as its own `business_id_plain` in the first place via `connect_gym_payment_credentials()`. The existing `idx_gym_payment_credentials_provider_business_id` partial unique index (`0054_flow_a_gym_routing.sql`) only prevents two *gyms* from colliding with each other — it cannot see the platform's own ID, which lives in an env var/secret, not a table row.

**The core design problem this story must solve, and the required resolution (read in full — this is the crux of the story):**

`connect_gym_payment_credentials()` is a Postgres `SECURITY DEFINER` RPC, directly callable by any authenticated Owner session (`apps/dashboard/services/gym-payment-credentials.ts` is a thin wrapper, not a gate — the RPC's own doc comment at `0054_flow_a_gym_routing.sql:79-83` states the codebase's "Server Actions never trust client input" principle applies *inside the RPC*, not just at the client boundary). The guard therefore **must live inside the RPC**, not only in `apps/dashboard`'s Server Action layer — a direct RPC call bypassing the Next.js app must be blocked too.

The problem: **`TARAMONEY_BUSINESS_ID` is a Supabase Edge Function secret (`Deno.env.get(...)`, `supabase/.env`, set via `supabase secrets set`) — Postgres functions have no built-in way to read it.** It is *not* exposed to `apps/dashboard` either (confirmed: absent from `apps/dashboard/.env.example` and from `docs/deploy-runbook.md`'s dashboard build-env list; it only appears under that doc's separate "Supabase project secrets" list). So neither "read `process.env` in the Server Action" nor "read `current_setting()` of an unset GUC" gets you the real value inside Postgres today — a value must be deliberately placed there.

**Required resolution: store the platform's own business ID as a Supabase Vault secret, mirroring AD-15's existing per-gym-credentials pattern.**

- AD-15 already established Vault as this codebase's "least code to own and maintain" answer for exactly this shape of problem (`ARCHITECTURE-SPINE.md`). `0054_flow_a_gym_routing.sql` already has a live `vault.decrypted_secrets` lookup pattern to copy (`get_gym_payment_credentials_by_business_id`, lines 190–205).
- AD-13 ("Payment provider is DB-row + RPC-driven runtime switching, not an env var") independently argues against inventing a GUC-mirrors-env-var side channel for this — Vault is the codebase's one sanctioned way to get a real value into Postgres from outside a migration.
- `business_id_plain` is explicitly **not a secret** (`0054_flow_a_gym_routing.sql:12-19`'s own comment: TaraMoney's webhook payloads carry it in cleartext on every delivery) — Vault here is just "the place this codebase puts values that arrive at runtime, not migration time," not a confidentiality requirement.

**Concretely:**

1. Migration seeds nothing (the real value is environment-specific and must never be hardcoded in a committed migration — CI/local/staging/prod each have their own `TARAMONEY_BUSINESS_ID`). It only adds the guard logic, reading a **known-by-name** Vault secret.
2. Use the secret name `platform:taramoney:business_id` (parallel shape to `0052`'s per-gym naming convention `'gym_payment_credentials:' || v_gym_id || ':' || p_provider_key`, but a platform-level, non-gym-scoped name).
3. Seeding that Vault secret in each real environment (local dev, CI, staging, prod) is an **out-of-band manual step**, same class of operation as `supabase secrets set` for the Edge Function secrets — not something a migration can do. Document it in `docs/deploy-runbook.md` next to the existing `TARAMONEY_*` entries: `select vault.create_secret('<value>', 'platform:taramoney:business_id');` run once per environment, value kept in sync with that environment's `TARAMONEY_BUSINESS_ID` Edge Function secret.
4. **If the secret is absent in a given environment (e.g., a fresh local/CI DB before anyone seeds it), the guard must no-op, not error** — this mirrors this codebase's existing tolerance for similar unconfigured-optional-guard gaps (e.g. `TARAMONEY_INITIATION_ENABLED` defaulting enabled when unset). Do not make `connect_gym_payment_credentials()` fail for every gym just because this one Vault secret hasn't been seeded yet in a given environment.

**Where to add the check in `connect_gym_payment_credentials()`** (`0054_flow_a_gym_routing.sql:40-153`, current live definition — no later migration redefines this function): immediately after `v_plain := btrim(p_business_id);` (line 88) and before the `v_masked`/`v_secret_json` construction. Something like:

```sql
select v.decrypted_secret into v_platform_business_id
from vault.decrypted_secrets v
where v.name = 'platform:taramoney:business_id';

if v_platform_business_id is not null and v_plain = v_platform_business_id then
  raise exception 'connect_gym_payment_credentials: business_id_plain matches the platform''s own account';
end if;
```

(new `v_platform_business_id text;` local declared alongside the function's other `declare` locals). This must run **before** the advisory-lock/upsert-vs-insert branch (fail fast, no partial state, no Vault secret created/updated for a rejected attempt) and **before** the audit-log call at the end (a rejected connect must not be logged as `gym_payment_credentials_connected`).

**Given** the existing `provider_key` + `business_id_plain` unique index (migration 0054)
**When** this story ships
**Then** it is left unchanged — that index already prevents one gym from registering another gym's business ID; this story closes only the platform-collision gap, which the index can't cover since the platform's ID lives outside any table row.

## Acceptance Criteria

1. **Given** a gym Owner submitting a `business_id_plain` via `connect_gym_payment_credentials` (initial connect or Settings' reconnect flow), **when** the submitted value equals the platform's own `TARAMONEY_BUSINESS_ID` (resolved via the new `platform:taramoney:business_id` Vault secret), **then** the RPC rejects it with a clear error, and no credentials row is written or updated (no insert, no update, no Vault secret create/update on the gym's own `gym_payment_credentials` entry, no audit-log row). [Source: epics.md#Story 4.16]
2. **Given** the platform Vault secret is not seeded in the current environment, **when** any gym Owner connects any `business_id_plain`, **then** the connect succeeds exactly as before this story shipped (the guard is a no-op, not a hard failure) — this environment-tolerance behavior must have explicit test coverage, not just be assumed. [Derived from the story's own required-resolution design above — not in epics.md verbatim, but necessary for AC #1 to be safely deployable across environments that haven't seeded the secret yet]
3. **Given** the existing `provider_key` + `business_id_plain` unique index (migration 0054), **when** this story ships, **then** it is left unchanged — this story adds a new, independent guard; it does not touch or replace the cross-gym uniqueness constraint. [Source: epics.md#Story 4.16]
4. **Given** the `deferred-work.md` entry this story closes (Story 11.6 review, 2026-08-30, line 661), **when** this story ships, **then** that entry is marked resolved (strikethrough + `**RESOLVED (Story 4.16, <ship date>):**` note, matching this file's own existing convention — see e.g. lines 110 and 286) with a reference to this story and to the new `docs/decisions.md` entry. [Source: epics.md#Story 4.16]

## Tasks / Subtasks

- [x] Task 1: Add the collision guard to `connect_gym_payment_credentials()` (AC #1, #2, #3)
  - [x] Subtask 1.1: Create `supabase/migrations/0083_platform_business_id_collision_guard.sql`. `create or replace function connect_gym_payment_credentials(...)` with the full existing body from `0054_flow_a_gym_routing.sql:40-153` (Postgres `create or replace function` needs the complete body, not a patch) plus the new Vault-lookup guard inserted exactly where specified in the Story context above (after `v_plain := btrim(p_business_id);`, before `v_masked` construction; new local `v_platform_business_id text;`).
  - [x] Subtask 1.2: Add a migration-header comment explaining the design (Vault over GUC/env-var-mirroring, referencing AD-13/AD-15 and the deferred-work.md entry being closed) — matches this codebase's convention of every migration explaining its own "why," not just "what" (see `0054`'s own header for the shape to match).
  - [x] Subtask 1.3: Do **not** touch `idx_gym_payment_credentials_provider_business_id` or any other existing index/constraint (AC #3).

- [x] Task 2: Map the new exception to a friendly, bilingual error (AC #1)
  - [x] Subtask 2.1: In `packages/types/src/errors.ts`, add a new branch in `mapSupabaseError()` immediately after the existing `idx_gym_payment_credentials_provider_business_id` block (~line 90): match on `message.includes("connect_gym_payment_credentials:") && message.includes("platform's own account")`, return `{ code: "payment_business_id_is_platform_account", message: copy.paymentBusinessIdIsPlatformAccount }`.
  - [x] Subtask 2.2: Add `errors.paymentBusinessIdIsPlatformAccount` to both `packages/types/src/locales/en.json` and `fr.json`, alongside the existing `paymentBusinessIdAlreadyConnected` key (same section). Suggested copy — adjust to match this file's existing tone: en "This account can't be connected — it belongs to GymOS's own platform account.", fr "Ce compte ne peut pas être connecté — il appartient au compte de la plateforme GymOS."
  - [x] Subtask 2.3: No `apps/dashboard` code changes needed beyond this — `connectPaymentProvider` (`apps/dashboard/app/(dashboard)/settings/actions.ts:140-180`) already propagates any `AppError` returned by `connectGymPaymentCredentials()` straight through to the UI (established in Story 4.13/4.14); confirm this by reading that action, do not re-plumb it.

- [x] Task 3: Document the new Vault secret's operational requirement (AC #2)
  - [x] Subtask 3.1: In `docs/deploy-runbook.md`, add a bullet under the existing "Supabase project secrets" list (next to the `TARAMONEY_API_KEY`/`_BUSINESS_ID`/`_WEBHOOK_SECRET` bullet, around line 59) documenting the new `platform:taramoney:business_id` Vault secret: what it's for, that it must be seeded once per environment via `select vault.create_secret('<value>', 'platform:taramoney:business_id');`, and that its value must be kept in sync with that environment's `TARAMONEY_BUSINESS_ID` secret. Flag as **[NEEDS]** seeding in any environment where it hasn't been done yet, matching this doc's existing `[NEEDS]` convention.
  - [x] Subtask 3.2: Add a `docs/decisions.md` entry (dated, following this file's existing per-story-entry convention — see the 2026-08-30 Story 11.6 entry for shape) recording the Vault-over-GUC design decision and its rationale, so a future reader doesn't have to re-derive it.

- [x] Task 4: Close the deferred-work.md entry (AC #4)
  - [x] Subtask 4.1: In `_bmad-output/implementation-artifacts/deferred-work.md:661`, strike through the finding and append a `**RESOLVED (Story 4.16, <date>):**` note referencing this migration and the new `docs/decisions.md` entry — match the exact style of the existing resolved entries at lines 110 and 286 in that same file.

- [x] Task 5: pgTAP regression coverage (AC #1, #2, #3)
  - [x] Subtask 5.1: In `supabase/tests/gym_payment_credentials_rls.test.sql`, add a new test section after the existing "Story 4.14: business_id_plain uniqueness" block (currently lines 363–374, right before `reset role;` at line 376). Seed a Vault secret in the test's own setup for this section: `select vault.create_secret('platform-test-biz-id', 'platform:taramoney:business_id');` (or via `select vault.create_secret(...)`, matching the codebase's own Vault-creation call shape used elsewhere), then assert a `throws_like` failure when a gym Owner attempts `connect_gym_payment_credentials('taramoney', 'key', 'platform-test-biz-id', 'secret')` with that exact value, and that a *different* value still succeeds (control case) — reuse the session-simulation `set_config('request.jwt.claims', ...)` pattern already used throughout this file (e.g. lines 39–40).
  - [x] Subtask 5.2: Add a second, separate test asserting AC #2's no-secret-seeded tolerance case: either run this against a database/schema state where the secret genuinely doesn't exist yet (before Subtask 5.1's seed, if ordering allows), or — if pgTAP's transactional-per-file setup makes that awkward — add an explicit `delete from vault.secrets where name = 'platform:taramoney:business_id'` before a normal (non-colliding) connect and assert it still succeeds. Either way, this must be a real, separate assertion, not inferred from the absence of a failure elsewhere.
  - [x] Subtask 5.3: Update `select plan(37);` (line 12) to the new total test count after Subtasks 5.1/5.2 are added.
  - [x] Subtask 5.4: Run the full pgTAP suite locally (`supabase test db` or equivalent per this repo's existing test-running convention) and confirm it is fully green, not just the new tests — this codebase's standing regression discipline (see every prior story's Dev Notes).

- [x] Task 6: Full regression pass (typecheck, lint, i18n parity, pgTAP)
  - [x] Subtask 6.1: Run typecheck + lint (incl. the i18n hardcoded-string gate) and the i18n key-parity check across `packages/types/src/locales/{en,fr}.json` — the new `paymentBusinessIdIsPlatformAccount` key must exist and match in both files or the CI gate fails.
  - [x] Subtask 6.2: Confirm the full pgTAP suite is clean (see 5.4).
  - [x] Subtask 6.3: This is a backend-only (Postgres + `packages/types`) change — no dashboard UI markup changes, so no new manual-browser-QA step is expected beyond confirming the existing Settings "Connect payment account" error-toast path still renders correctly for this new error code (the user does their own manual browser QA; do not claim to have done it yourself).

### Review Findings

- [x] [Review][Decision] Rejection error message names the platform account by design, creating a low-severity ID-guessing oracle — `supabase/migrations/0083_platform_business_id_collision_guard.sql:97-98` raises a message distinct from the generic `payment_business_id_already_connected` case, telling any authenticated Owner precisely when their guess matches GymOS's own real `business_id_plain` (vs. a generic "already connected to another gym" for two colliding gyms). **Resolved:** user chose to keep the distinct, informative message as spec'd — the info-leak is low-severity given `business_id_plain` is documented non-secret elsewhere and the real ID's keyspace makes brute-forcing impractical. No code change.

- [x] [Review][Patch] Guard is not scoped to `provider_key = 'taramoney'` [supabase/migrations/0083_platform_business_id_collision_guard.sql:103] — fixed by gating the guard behind `if p_provider_key = 'taramoney' then`. Manually verified against the running local DB: a `faketest` provider with a colliding `business_id_plain` now connects successfully, while `taramoney` with the same value is still rejected.

- [x] [Review][Patch] Vault secret lookup has no `limit 1`/deterministic ordering [supabase/migrations/0083_platform_business_id_collision_guard.sql:104-108] — fixed by adding `order by v.created_at desc limit 1` to the lookup.

- [x] [Review][Patch] Vault secret value isn't trimmed before comparison [supabase/migrations/0083_platform_business_id_collision_guard.sql:104] — fixed by wrapping the read side in `btrim(v.decrypted_secret)`.

- [x] [Review][Patch] `docs/deploy-runbook.md`'s new bullet sits directly beside a now-stale claim it doesn't correct [docs/deploy-runbook.md:59-62] — fixed: the stale "per-gym Tara Money credentials (FR-126) are not yet built" sentence now correctly states they exist as of Story 4.13, stored per-gym in Vault.

- [x] [Review][Patch] pgTAP suite doesn't directly assert AC #1's "no audit-log row" requirement [supabase/tests/gym_payment_credentials_rls.test.sql:393-422] — fixed: added a before/after `audit_log` count-delta assertion around the rejected attempt (plan 41 → 44).

- [x] [Review][Patch] Guard-rejection test coverage only exercises the reconnect/UPDATE branch [supabase/tests/gym_payment_credentials_rls.test.sql:424-443] — fixed: added a fresh-connect (INSERT branch) rejection case reusing gym A (disconnected earlier in the file, no existing row), plus a follow-up assertion confirming no row was created.

Full pgTAP suite re-run clean post-patch: 44/44 (`gym_payment_credentials_rls.test.sql`), verified directly against the local Supabase Postgres container (`docker exec supabase_db_gym_os psql`) after re-applying the patched migration 0083 via `create or replace function`.

- [x] [Review][Defer] No audit of pre-existing `gym_payment_credentials` rows for a collision predating this guard [deferred] — Stories 4.13–4.15 shipped real per-gym TaraMoney connections before this guard existed; the new guard only blocks *future* collisions. Low practical risk (would require a gym owner to have already, coincidentally or maliciously, entered GymOS's own real business ID pre-guard), and partially mitigated regardless by `TaraMoneyProvider.verifyWebhookSignature()`'s existing env-var-first routing order (2026-08-30 decision) for old and new rows alike. Logged as a one-time manual audit follow-up, not a code defect.

- [x] [Review][Defer] `decrypted_secret` returning `NULL` on a genuine Vault decryption failure is indistinguishable from "secret not seeded" [supabase/migrations/0083_platform_business_id_collision_guard.sql:93-96] — both silently no-op the guard. This is a systemic characteristic of every Vault-backed read already in this codebase (shared by `get_gym_payment_credentials_for_service`/`get_gym_payment_credentials_by_business_id`), not something introduced by this diff, and a real pgsodium decryption failure would surface far more broadly (every payment-credential read) before this guard's silence became the visible symptom.

- [x] [Review][Defer] TOCTOU race between the guard's read and the row write [supabase/migrations/0083_platform_business_id_collision_guard.sql:93-122] — the platform secret could theoretically be seeded/updated to exactly match `v_plain` in the narrow window between the guard check and `pg_advisory_xact_lock`/insert. Requires privileged access to seed Vault secrets, already a fully-trusted actor in this system; negligible practical severity.

- [x] [Review][Defer] No automated reconciliation between `TARAMONEY_BUSINESS_ID` (Edge Function secret) and `platform:taramoney:business_id` (Vault secret) [docs/deploy-runbook.md:70-77] — both are independently operator-managed; drift between them silently defeats the guard. Already disclosed in the runbook's own prose ("if they drift, the guard silently stops matching"); an automated cross-check would be a larger follow-on feature, not a fix to this diff.

## Dev Notes

- **Single source of truth for the live function body:** `connect_gym_payment_credentials()` has exactly one definition in the entire migration history, in `0054_flow_a_gym_routing.sql:40-153` (confirmed via repo-wide grep — no later migration redefines it). Do not edit `0054` in place; add a new `0083` migration with `create or replace function` carrying the full body plus the new guard, per this codebase's append-only-migrations convention (never hand-edit a shipped migration).
- **Do not confuse this with the cross-gym unique index.** `idx_gym_payment_credentials_provider_business_id` (also from `0054`) is a completely separate, already-shipped, already-correct mechanism for a different problem (gym vs. gym). This story adds a second, independent guard (gym vs. platform) — AC #3 explicitly requires leaving the index alone.
- **Vault secret naming:** use exactly `platform:taramoney:business_id` (not `taramoney:platform:business_id` or any other ordering) for consistency with this story's own spec above — pick one and be consistent across the migration, the runbook doc, and the pgTAP test.
- **Fail-fast ordering matters:** the guard must run before the advisory lock (`pg_advisory_xact_lock`) and before any row is touched — a rejected connect attempt must leave the database in exactly the state it was in before the call (no orphaned Vault secret, no partial row, no audit log entry for a rejected attempt).
- **This is a small, self-contained migration + RPC guard** — Low effort/Low risk per the 2026-09-01 sprint-change-proposal. Do not expand scope into building a general "platform config in Vault" mechanism, a UI-facing pre-check, or touching Flow B/SaaS billing's own (separate, `{type:'platform'}`-routed) credential resolution — none of that is in scope here.

### Project Structure Notes

- New migration file: `supabase/migrations/0083_platform_business_id_collision_guard.sql` (next sequential number after `0082_plan_handoff_on_coach_reassignment.sql`).
- Modified: `packages/types/src/errors.ts`, `packages/types/src/locales/en.json`, `packages/types/src/locales/fr.json`, `supabase/tests/gym_payment_credentials_rls.test.sql`, `docs/deploy-runbook.md`, `docs/decisions.md`, `_bmad-output/implementation-artifacts/deferred-work.md`.
- No changes expected in `apps/dashboard`, `apps/super-admin`, `apps/mobile`, or `supabase/functions/*` — this is entirely a Postgres RPC + shared error-mapping change. If implementation reveals a need to touch any app code, treat that as a signal the design above needs re-checking before proceeding, not a normal expansion of scope.

### References

- [Source: epics.md#Story 4.16 (lines 1969-1988)]
- [Source: epics.md#Release Hardening section, lines 518-522]
- [Source: sprint-change-proposal-2026-09-01.md §4.1-4.2]
- [Source: deferred-work.md:661 — the exact gap being closed]
- [Source: ARCHITECTURE-SPINE.md#AD-13, #AD-15]
- [Source: supabase/migrations/0054_flow_a_gym_routing.sql:1-208 — the function being extended, and the existing `vault.decrypted_secrets` lookup pattern to mirror]
- [Source: supabase/functions/payment-webhook/_shared/payment-providers/TaraMoneyProvider.ts:408-420 — why this collision matters (webhook routing precedent)]
- [Source: packages/types/src/errors.ts:81-90 — the sibling error-mapping precedent (`idx_gym_payment_credentials_provider_business_id`) to copy the shape of]
- [Source: docs/deploy-runbook.md:50-68 — confirms `TARAMONEY_BUSINESS_ID` is Supabase-secret-only, not dashboard-visible]
- [Source: docs/decisions.md — 2026-08-30 Story 11.6 entry, the routing-order precedent this story's rationale leans on]

## Previous Story Intelligence (Story 4.15)

Story 4.15 (member self-service renewal, `done`) is the most recent prior story in Epic 4. Relevant carry-forward patterns, not directly reused by this story but consistent with its own conventions:

- Established the pattern of writing out a full "core design problem + recommended resolution" analysis in a story's own Dev Notes before Tasks, specifically because the epics.md AC text alone under-specifies a real design decision — same reason this story does the same for the Vault-secret design above.
- `docs/decisions.md` and `deferred-work.md` are both living documents every story is expected to read and, where relevant, close entries in — not just write to. This story is itself an example of closing a deferred-work.md entry from three stories prior (11.6).

## Change Log

- 2026-09-01: dev-story: implemented all 6 tasks. Migration `0083` adds the platform-collision guard to `connect_gym_payment_credentials()`, reading a new `platform:taramoney:business_id` Vault secret and no-op'ing when it's unseeded; `packages/types` gained the `payment_business_id_is_platform_account` error mapping and bilingual copy; `docs/deploy-runbook.md`/`docs/decisions.md` document the new secret and its design rationale; `deferred-work.md`'s Story 11.6 finding (line 661) is marked resolved; `gym_payment_credentials_rls.test.sql` gained 4 new pgTAP assertions (37 → 41) covering both the rejection and the no-secret-seeded tolerance case. Full regression clean: pgTAP 1726/1726 (+4), typecheck 0 errors across all 4 packages, lint 0 errors on touched files (pre-existing warnings/mobile-eslint-gap only), i18n key-parity clean. No `apps/dashboard`/`apps/super-admin`/`apps/mobile`/Edge Function code touched, matching the story's own scope boundary. Status: ready-for-dev → review.

## Dev Agent Record

### Agent Model Used

claude-sonnet-5

### Debug Log References

- `npx supabase db reset` — applied migrations 0001–0083 cleanly, including the new `0083_platform_business_id_collision_guard.sql`.
- `npx supabase test db` — first invocation hung at "Connecting to local database..." past a 300s timeout (this devcontainer's already-documented `supabase test db`/container-spinup flakiness, per multiple prior stories' `docs/decisions.md` entries); a second attempt with a 400s timeout ran clean.
- `npx supabase test db` (clean run): `All tests successful. Files=83, Tests=1726, ... Result: PASS` — 1726 = the pre-existing suite plus this story's 4 new assertions (37 → 41 in `gym_payment_credentials_rls.test.sql`).
- `npx turbo run typecheck` — 4/4 packages, 0 errors.
- `npx turbo run lint` — dashboard/super-admin clean (0 errors; pre-existing warnings only, none in touched files); `@gymos/mobile#lint` fails with `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL Command "eslint" not found` — pre-existing, documented environment gap (no mobile changes in this story), re-ran lint scoped to `--filter=@gymos/dashboard --filter=@gymos/super-admin --filter=@gymos/types` to confirm 0 errors independent of that gap.
- `npm run check:i18n` — `packages/types/src/locales`: 80 keys, en/fr in parity (includes the new `paymentBusinessIdIsPlatformAccount` key).

### Completion Notes List

- Migration `0083_platform_business_id_collision_guard.sql` carries forward `connect_gym_payment_credentials()`'s full body from `0054` via `create or replace function`, with the new platform-collision guard inserted immediately after `v_plain` is computed and before any row/secret write — a rejected attempt writes nothing (no credentials row, no Vault secret, no audit-log entry) and leaves `idx_gym_payment_credentials_provider_business_id` untouched (AC #1, #3).
- The guard reads a `platform:taramoney:business_id` Vault secret and no-ops (permits the connect) when that secret is unseeded, rather than hard-failing every connect attempt in an environment that hasn't seeded it yet (AC #2) — this environment-tolerance path has its own explicit pgTAP assertion (Task 5), not just an absence-of-failure inference.
- `packages/types/src/errors.ts`'s `mapSupabaseError()` gained a new plain-message-match branch (mirroring the file's existing `raise exception`-style branches, not a `pgErrorCode` constraint match) mapping the new exception to `payment_business_id_is_platform_account` / `copy.paymentBusinessIdIsPlatformAccount`, added to both `en.json`/`fr.json`. Confirmed (by reading, not modifying) that `connectPaymentProvider` (`apps/dashboard/app/(dashboard)/settings/actions.ts`) already propagates any `AppError` from `connectGymPaymentCredentials()` straight to the UI — no app-code changes needed.
- `docs/deploy-runbook.md` gained a `[NEEDS]` bullet documenting the new Vault secret's seeding requirement (per environment) next to the existing `TARAMONEY_*` secrets list; `docs/decisions.md` gained a dated 2026-09-01 entry recording the Vault-over-GUC design rationale.
- `deferred-work.md:661` (the Story 11.6 finding this story closes) is struck through with a `**RESOLVED (Story 4.16, 2026-09-01):**` note referencing the new migration and `docs/decisions.md` entry.
- New pgTAP coverage in `supabase/tests/gym_payment_credentials_rls.test.sql` (37 → 41 assertions): a `throws_like` rejection when a gym (reusing the already-connected Gym C fixture) attempts to connect the platform's Vault-seeded business ID; an `is` check confirming the rejected attempt left Gym C's existing connection untouched; a `lives_ok` control case (a different, non-colliding business ID still connects with the secret seeded); and a second `lives_ok` proving AC #2 — after `delete from vault.secrets where name = 'platform:taramoney:business_id'`, connecting that same value now succeeds because the guard no-ops on an absent secret.
- Full regression clean: pgTAP 1726/1726 (83 files, +4 from this story), typecheck 0 errors across all 4 packages, lint 0 errors on touched files (dashboard/super-admin baseline warnings only; mobile's `eslint` binary is a pre-existing, unrelated environment gap), i18n key-parity clean (80 keys in `packages/types/src/locales`, includes the new key). No dashboard UI markup changed — per Subtask 6.3, manual browser QA of the Settings error-toast path is the user's own domain, not performed here.

### File List

- `supabase/migrations/0083_platform_business_id_collision_guard.sql` (new)
- `packages/types/src/errors.ts` (modified)
- `packages/types/src/locales/en.json` (modified)
- `packages/types/src/locales/fr.json` (modified)
- `supabase/tests/gym_payment_credentials_rls.test.sql` (modified)
- `docs/deploy-runbook.md` (modified)
- `docs/decisions.md` (modified)
- `_bmad-output/implementation-artifacts/deferred-work.md` (modified)
